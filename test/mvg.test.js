import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchDepartures, findStation } from '../src/mvg.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/departures-harras.json', import.meta.url), 'utf8'));

function fakeFetch(body, seen = []) {
  return async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, json: async () => body };
  };
}

test('findStation nimmt die Münchner Station', async () => {
  const seen = [];
  const result = await findStation(
    'Harras',
    fakeFetch(
      [
        { type: 'ADDRESS', name: 'Harras' },
        { type: 'STATION', name: 'Harras', place: 'Irgendwo', globalId: 'de:1:1' },
        { type: 'STATION', name: 'Harras', place: 'München', globalId: 'de:09162:6' },
      ],
      seen,
    ),
  );
  assert.equal(result.globalId, 'de:09162:6');
  assert.match(seen[0], /\/locations\?query=Harras&locationTypes=STATION$/);
});

test('findStation wirft, wenn nichts gefunden wird', async () => {
  await assert.rejects(findStation('Nirgendwo', fakeFetch([])), /nicht gefunden/);
});

test('fetchDepartures fragt nur U-/S-Bahn ab und mappt die Felder', async () => {
  const seen = [];
  const deps = await fetchDepartures('de:09162:6', { transportTypes: ['UBAHN', 'SBAHN'] }, fakeFetch(fixture, seen));
  assert.match(seen[0], /\/departures\?globalId=de%3A09162%3A6&limit=40&offsetInMinutes=0&transportTypes=UBAHN%2CSBAHN$/);
  assert.equal(deps.length, 5);
  assert.deepEqual(deps[0], {
    line: 'U6',
    transportType: 'UBAHN',
    destination: 'Garching, Forschungszentrum',
    plannedTime: 1760630400000,
    departureTime: 1760630520000,
    delayMinutes: 2,
    realtime: true,
    cancelled: false,
    platform: 1,
    sev: false,
  });
  // Ohne Echtzeit fällt die Abfahrtszeit auf den Plan zurück.
  assert.equal(deps[4].departureTime, deps[4].plannedTime);
});

test('HTTP-Fehler der MVG werden gemeldet', async () => {
  const failing = async () => ({ ok: false, status: 503, json: async () => ({}) });
  await assert.rejects(fetchDepartures('x', { transportTypes: ['UBAHN'] }, failing), /HTTP 503/);
});
