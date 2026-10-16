import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBoard } from '../src/board.js';
import { toDeparture } from '../src/mvg.js';
import { validateConfig } from '../src/config.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/departures-harras.json', import.meta.url), 'utf8'));
const NOW = 1760630280000;

const config = validateConfig({
  departuresPerStation: 10,
  stations: [
    {
      name: 'Harras',
      directions: { UBAHN: { exclude: ['Großhadern'] }, SBAHN: { exclude: ['Wolfratshausen'] } },
    },
  ],
});

function fakeMvg() {
  const calls = { find: 0, departures: 0 };
  let fail = false;
  return {
    calls,
    setFail: (v) => (fail = v),
    async findStation() {
      calls.find++;
      return { globalId: 'de:09162:6', name: 'Harras' };
    },
    async fetchDepartures() {
      calls.departures++;
      if (fail) throw new Error('boom');
      return fixture.map(toDeparture);
    },
  };
}

test('filtert Richtung, sortiert nach Abfahrtszeit', async () => {
  const mvg = fakeMvg();
  const board = createBoard(config, { mvg, now: () => NOW });
  const { stations } = await board.getBoard();
  assert.deepEqual(
    stations[0].departures.map((d) => `${d.line} ${d.destination}`),
    ['U6 Fröttmaning', 'U6 Garching, Forschungszentrum', 'S7 Kreuzstraße'],
  );
  assert.equal(stations[0].stale, false);
});

test('cached Ergebnisse und löst die Station nur einmal auf', async () => {
  let t = NOW;
  const mvg = fakeMvg();
  const board = createBoard(config, { mvg, now: () => t, cacheMs: 20_000 });
  await board.getBoard();
  await board.getBoard();
  assert.equal(mvg.calls.departures, 1);
  t += 21_000;
  await board.getBoard();
  assert.equal(mvg.calls.departures, 2);
  assert.equal(mvg.calls.find, 1);
});

test('liefert bei MVG-Ausfall den letzten Stand als veraltet', async () => {
  let t = NOW;
  const mvg = fakeMvg();
  const board = createBoard(config, { mvg, now: () => t, cacheMs: 1000 });
  await board.getBoard();
  mvg.setFail(true);
  t += 2000;
  const { stations } = await board.getBoard();
  assert.equal(stations[0].stale, true);
  assert.equal(stations[0].departures.length, 3);
  assert.match(stations[0].error, /veraltet/);
});

test('ohne vorherigen Stand gibt es eine leere Liste mit Fehler', async () => {
  const mvg = fakeMvg();
  mvg.setFail(true);
  const board = createBoard(config, { mvg, now: () => NOW });
  const { stations } = await board.getBoard();
  assert.deepEqual(stations[0].departures, []);
  assert.equal(stations[0].error, 'MVG nicht erreichbar');
});

test('Konfiguration ohne Stationen wird abgelehnt', () => {
  assert.throws(() => validateConfig({ stations: [] }), /mindestens eine Station/);
});
