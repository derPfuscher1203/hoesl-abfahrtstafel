import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoard } from './board.js';
import { loadConfig } from './config.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

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

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = normalizePath(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    const ext = extname(file);
    // HTML und Service Worker nie cachen, damit Updates sofort ankommen.
    const noCache = ext === '.html' || rel.endsWith('sw.js') || ext === '.webmanifest';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

export function createApp(board) {
  return createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
      if (pathname === '/api/departures') return sendJson(res, 200, await board.getBoard());
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' });
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
  const board = createBoard(config, options);
  const port = Number(process.env.PORT) || 8080;
  const server = createApp(board).listen(port, () => {
    console.log(`Abfahrtstafel läuft auf http://0.0.0.0:${port}`);
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
