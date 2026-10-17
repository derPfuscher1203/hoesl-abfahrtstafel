import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDepartures, findStation, toDeparture } from '../src/db.js';

function fakeFetch(body, seen = []) {
  return async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, json: async () => body };
  };
}

test('findStation nimmt den passenden Halt', async () => {
  const result = await findStation(
    'Moosburg',
    fakeFetch([
      { type: 'location', id: null, name: 'Adresse' },
      { type: 'stop', id: '8004136', name: 'Moosburg' },
      { type: 'stop', id: '123', name: 'Moosburg Bahnhof (Bus)' },
    ]),
  );
  assert.equal(result.globalId, '8004136');
});

test('fetchDepartures fragt nur Züge ab und mappt die Felder', async () => {
  const seen = [];
  const body = {
    departures: [
      {
        when: '2026-10-17T18:12:00+02:00',
        plannedWhen: '2026-10-17T18:10:00+02:00',
        delay: 120,
        platform: '2',
        direction: 'München Hbf',
        line: { name: 'RB 33', product: 'regional' },
      },
      {
        when: null,
        plannedWhen: '2026-10-17T18:20:00+02:00',
        delay: null,
        cancelled: true,
        plannedPlatform: '1',
        direction: 'Landshut (Bay) Hbf',
        line: { name: 'RE  22', product: 'regionalExpress' },
      },
    ],
  };
  const deps = await fetchDepartures('8004136', { transportTypes: ['BAHN'] }, fakeFetch(body, seen));
  const url = new URL(seen[0]);
  assert.equal(url.pathname, '/stops/8004136/departures');
  assert.equal(url.searchParams.get('regional'), 'true');
  assert.equal(url.searchParams.get('bus'), 'false');
  assert.deepEqual(deps[0], {
    line: 'RB 33',
    transportType: 'BAHN',
    destination: 'München Hbf',
    plannedTime: Date.parse('2026-10-17T18:10:00+02:00'),
    departureTime: Date.parse('2026-10-17T18:12:00+02:00'),
    delayMinutes: 2,
    realtime: true,
    cancelled: false,
    platform: '2',
    sev: false,
  });
  assert.equal(deps[1].line, 'RE 22');
  assert.equal(deps[1].cancelled, true);
  assert.equal(deps[1].departureTime, deps[1].plannedTime);
});

test('S-Bahn und Bus werden richtig zugeordnet', () => {
  assert.equal(toDeparture({ line: { name: 'S1', product: 'suburban' } }).transportType, 'SBAHN');
  assert.equal(toDeparture({ line: { name: '54', product: 'bus' } }).transportType, 'BUS');
});
