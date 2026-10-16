import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

const board = { getBoard: async () => ({ generatedAt: 1, refreshSeconds: 30, stations: [] }) };
const server = createApp(board).listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

test('/healthz', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('/api/departures liefert JSON ohne Caching', async () => {
  const res = await fetch(`${base}/api/departures`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal((await res.json()).refreshSeconds, 30);
});

test('liefert die Kiosk-Seite und das Manifest aus', async () => {
  const html = await fetch(`${base}/`);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Abfahrten stadteinwärts/);
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
});

test('Pfade außerhalb von public sind nicht erreichbar', async () => {
  const res = await fetch(`${base}/..%2f..%2fpackage.json`);
  assert.notEqual(res.status, 200);
});
