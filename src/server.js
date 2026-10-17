import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoards } from './board.js';
import { loadConfig } from './config.js';
import { createLineColors } from './lineColors.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Ändert sich bei jedem Neustart/Update des Containers. Die Tablets vergleichen
// den Wert und laden sich neu, sobald eine neue Version läuft.
export const VERSION = process.env.APP_VERSION || `${pkg.version}-${Date.now().toString(36)}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body, contentType = MIME['.json']) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalizePath(urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR) || rel.endsWith('index.html')) return sendJson(res, 404, { error: 'not found' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    const ext = extname(file);
    // Der Service Worker darf nie gecacht werden; alles andere ist über ?v= versioniert.
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': rel.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

function pagePath(board, view) {
  return view ? `${board.id}/${view.slug}` : board.id;
}

async function serveBoardPage(res, board, view) {
  const template = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
  const html = template
    .replaceAll('__BOARD_PATH__', escapeHtml(pagePath(board, view)))
    .replaceAll('__BOARD_ID__', escapeHtml(board.id))
    .replaceAll('__BOARD_TITLE__', escapeHtml(board.title))
    .replaceAll('__BOARD_SUBTITLE__', escapeHtml(view ? view.name : board.subtitle))
    .replaceAll('__VERSION__', escapeHtml(VERSION));
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(html);
}

function manifestFor(board, view) {
  const path = pagePath(board, view);
  return {
    id: `/${path}`,
    name: view ? `${board.title} – ${view.name}` : `${board.title} (${board.id})`,
    short_name: view ? `${board.id} ${view.slug}` : board.id,
    description: view ? view.name : board.subtitle || board.title,
    lang: 'de',
    start_url: `/${path}`,
    scope: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'any',
    background_color: '#0b0f14',
    theme_color: '#0b0f14',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}

function redirect(res, status, location) {
  res.writeHead(status, { Location: location });
  res.end();
}

/**
 * Löst einen Pfad wie "hoeslhome", "zeno/hp8" oder "LTHQ/stadteinwaerts" auf:
 * zuerst als ganze Tafel-ID, sonst letztes Segment als Teilansicht. null, wenn es das nicht gibt.
 */
function resolvePage(boards, path) {
  const clean = String(path).replace(/\/+$/, '');
  const board = boards.findBoard(clean);
  if (board) return { board, view: null };
  const cut = clean.lastIndexOf('/');
  if (cut < 0) return null;
  const parent = boards.findBoard(clean.slice(0, cut));
  const view = parent && boards.findView(parent, clean.slice(cut + 1));
  return view ? { board: parent, view } : null;
}

const PAGE_PATH = /^\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+)\/?$/;

export function createApp(boards, lineColors = null) {
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
      if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok', version: VERSION });

      if (pathname === '/api/line-colors') return sendJson(res, 200, lineColors ? lineColors.info() : { source: 'none' });

      if (pathname === '/api/boards') {
        return sendJson(
          res,
          200,
          boards.boards.map((b) => ({
            id: b.id,
            title: b.title,
            url: `/${b.id}`,
            views: b.stations.filter((s) => s.slug).map((s) => ({ slug: s.slug, name: s.name, url: `/${b.id}/${s.slug}` })),
          })),
        );
      }
      const apiMatch = pathname.match(/^\/api\/boards\/(.+)$/);
      if (apiMatch || pathname === '/api/departures') {
        const page = apiMatch ? resolvePage(boards, decodeURIComponent(apiMatch[1])) : { board: boards.boards[0], view: null };
        const data = page && (await boards.getBoard(page.board.id, page.view?.slug ?? undefined));
        if (!data) return sendJson(res, 404, { error: 'Tafel nicht gefunden' });
        const lineStyles = lineColors ? lineColors.stylesFor(data.stations) : {};
        return sendJson(res, 200, { ...data, lineStyles, version: VERSION });
      }

      const manifestMatch = pathname.match(/^\/manifest\/(.+)\.webmanifest$/);
      if (manifestMatch) {
        const page = resolvePage(boards, decodeURIComponent(manifestMatch[1]));
        if (!page) return sendJson(res, 404, { error: 'Tafel nicht gefunden' });
        return sendJson(res, 200, manifestFor(page.board, page.view), MIME['.webmanifest']);
      }

      if (pathname === '/' || pathname === '/index.html') return redirect(res, 302, `/${boards.boards[0].id}`);

      const pageMatch = pathname.match(PAGE_PATH);
      const page = pageMatch && resolvePage(boards, pageMatch[1]);
      if (page) {
        // Schreibweise vereinheitlichen (/lthq -> /LTHQ), damit die PWA nur eine URL kennt.
        const canonical = `/${pagePath(page.board, page.view)}`;
        if (pathname !== canonical) return redirect(res, 301, canonical);
        return serveBoardPage(res, page.board, page.view);
      }
      return serveStatic(req, res);
    } catch (err) {
      console.error(err);
      sendJson(res, 500, { error: 'internal error' });
    }
  });
}

async function main() {
  const config = await loadConfig();
  const options = {};
  if (process.env.MVG_MOCK === '1') {
    const { mockMvg } = await import('./mock.js');
    options.mvg = mockMvg;
    options.db = mockMvg;
    console.log('Demo-Modus: es werden Beispieldaten statt MVG-Daten angezeigt.');
  }
  const boards = createBoards(config, options);
  const lineColors = createLineColors();
  // Nicht blockierend: bis die CSV da ist (oder falls sie nie kommt), gelten die eingebauten Farben.
  lineColors.start();
  const port = Number(process.env.PORT) || 8080;
  const server = createApp(boards, lineColors).listen(port, () => {
    console.log(`Abfahrtstafel ${VERSION} läuft auf http://0.0.0.0:${port}`);
    for (const b of config.boards) {
      console.log(`  /${b.id}  ${b.title}${b.subtitle ? ` – ${b.subtitle}` : ''}`);
      for (const s of b.stations) if (s.slug) console.log(`  /${b.id}/${s.slug}  ${s.name}`);
    }
  });
  const shutdown = () => {
    lineColors.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
