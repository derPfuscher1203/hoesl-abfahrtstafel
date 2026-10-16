import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, VERSION } from '../src/server.js';

const boardList = [
  { id: 'hoeslhome', title: 'Abfahrten stadteinwärts', subtitle: 'U-Bahn und S-Bahn' },
  { id: 'LTHQ', title: 'S-Bahn ab Haar', subtitle: 'Alle Abfahrten' },
];
const boards = {
  boards: boardList,
  findBoard: (id) => boardList.find((b) => b.id.toLowerCase() === String(id).toLowerCase()) ?? null,
  getBoard: async (id) => {
    const b = boardList.find((x) => x.id.toLowerCase() === id.toLowerCase());
    return b ? { board: b, generatedAt: 1, refreshSeconds: 30, stations: [] } : null;
  },
};
const server = createApp(boards).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('/healthz', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('/ leitet auf die erste Tafel um', async () => {
  const res = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/hoeslhome');
});

test('Tafel-Seiten werden mit Titel und Version ausgeliefert', async () => {
  const res = await fetch(`${base}/LTHQ`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>S-Bahn ab Haar<\/h1>/);
  assert.match(html, /data-board="LTHQ"/);
  assert.ok(html.includes(`data-version="${VERSION}"`));
  assert.match(html, /\/manifest\/LTHQ\.webmanifest/);
});

test('falsche Schreibweise der Tafel wird umgeleitet, unbekannte gibt 404', async () => {
  const res = await fetch(`${base}/lthq`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), '/LTHQ');
  assert.equal((await fetch(`${base}/gibtsnicht`)).status, 404);
});

test('API liefert Tafel-Daten mit Version, ohne Caching', async () => {
  const res = await fetch(`${base}/api/boards/LTHQ`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.board.id, 'LTHQ');
  assert.equal(body.version, VERSION);
  assert.equal((await fetch(`${base}/api/boards/nope`)).status, 404);
  assert.equal((await (await fetch(`${base}/api/departures`)).json()).board.id, 'hoeslhome');
});

test('jede Tafel hat ein eigenes Manifest mit eigener Start-URL', async () => {
  const res = await fetch(`${base}/manifest/LTHQ.webmanifest`);
  assert.equal(res.headers.get('content-type'), 'application/manifest+json');
  const manifest = await res.json();
  assert.equal(manifest.start_url, '/LTHQ');
  assert.equal(manifest.id, '/LTHQ');
});

test('statische Dateien und Pfadschutz', async () => {
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  assert.notEqual((await fetch(`${base}/..%2f..%2fpackage.json`)).status, 200);
  assert.equal((await fetch(`${base}/index.html`, { redirect: 'manual' })).status, 302);
});
