import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoards } from './board.js';
import { loadConfig } from './config.js';

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

async function serveBoardPage(res, board) {
  const template = await readFile(join(PUBLIC_DIR, 'index.html'), 'utf8');
  const html = template
    .replaceAll('__BOARD_ID__', escapeHtml(board.id))
    .replaceAll('__BOARD_TITLE__', escapeHtml(board.title))
    .replaceAll('__BOARD_SUBTITLE__', escapeHtml(board.subtitle))
    .replaceAll('__VERSION__', escapeHtml(VERSION));
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(html);
}

function manifestFor(board) {
  return {
    id: `/${board.id}`,
    name: `${board.title} (${board.id})`,
    short_name: board.id,
    description: board.subtitle || board.title,
    lang: 'de',
    start_url: `/${board.id}`,
    scope: '/',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    orientation: 'landscape',
    background_color: '#0b0f14',
    theme_color: '#0b0f14',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}

export function createApp(boards) {
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
      if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok', version: VERSION });

      if (pathname === '/api/boards') {
        return sendJson(res, 200, boards.boards.map((b) => ({ id: b.id, title: b.title, url: `/${b.id}` })));
      }
      const apiMatch = pathname.match(/^\/api\/boards\/([^/]+)$/);
      if (apiMatch || pathname === '/api/departures') {
        const data = await boards.getBoard(apiMatch ? decodeURIComponent(apiMatch[1]) : boards.boards[0].id);
        if (!data) return sendJson(res, 404, { error: 'Tafel nicht gefunden' });
        return sendJson(res, 200, { ...data, version: VERSION });
      }

      const manifestMatch = pathname.match(/^\/manifest\/([^/]+)\.webmanifest$/);
      if (manifestMatch) {
        const board = boards.findBoard(decodeURIComponent(manifestMatch[1]));
        if (!board) return sendJson(res, 404, { error: 'Tafel nicht gefunden' });
        return sendJson(res, 200, manifestFor(board), MIME['.webmanifest']);
      }

      if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(302, { Location: `/${boards.boards[0].id}` });
        return res.end();
      }

      const pageMatch = pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/);
      const board = pageMatch && boards.findBoard(pageMatch[1]);
      if (board) {
        // Schreibweise vereinheitlichen (/lthq -> /LTHQ), damit die PWA nur eine URL kennt.
        if (pageMatch[1] !== board.id) {
          res.writeHead(301, { Location: `/${board.id}` });
          return res.end();
        }
        return serveBoardPage(res, board);
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
    console.log('Demo-Modus: es werden Beispieldaten statt MVG-Daten angezeigt.');
  }
  const boards = createBoards(config, options);
  const port = Number(process.env.PORT) || 8080;
  const server = createApp(boards).listen(port, () => {
    console.log(`Abfahrtstafel ${VERSION} läuft auf http://0.0.0.0:${port}`);
    for (const b of config.boards) console.log(`  /${b.id}  ${b.title}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
