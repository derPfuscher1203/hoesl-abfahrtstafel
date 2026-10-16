import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBoards } from '../src/board.js';
import { toDeparture } from '../src/mvg.js';
import { validateConfig } from '../src/config.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/departures-harras.json', import.meta.url), 'utf8'));
const NOW = 1760630280000;

const config = validateConfig({
  boards: [
    {
      id: 'hoeslhome',
      departuresPerStation: 10,
      stations: [
        {
          name: 'Harras',
          walkMinutes: 12,
          directions: { UBAHN: { exclude: ['Großhadern'] }, SBAHN: { exclude: ['Wolfratshausen'] } },
        },
      ],
    },
    {
      id: 'LTHQ',
      transportTypes: ['SBAHN'],
      stations: [
        { name: 'Harras stadtauswärts', slug: 'raus', query: 'Harras', directions: { SBAHN: { include: ['Wolfratshausen'] } } },
        { name: 'Harras stadteinwärts', slug: 'rein', query: 'Harras', directions: { SBAHN: { exclude: ['Wolfratshausen'] } } },
      ],
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

test('filtert Richtung, sortiert nach Abfahrtszeit und gibt Gehzeit mit', async () => {
  const boards = createBoards(config, { mvg: fakeMvg(), now: () => NOW });
  const { board, stations } = await boards.getBoard('hoeslhome');
  assert.equal(board.id, 'hoeslhome');
  assert.deepEqual(
    stations[0].departures.map((d) => `${d.line} ${d.destination}`),
    ['U6 Fröttmaning', 'U6 Garching, Forschungszentrum', 'S7 Kreuzstraße'],
  );
  assert.equal(stations[0].walkMinutes, 12);
  assert.equal(stations[0].stale, false);
});

test('Tafel-ID ist unabhängig von Groß-/Kleinschreibung, unbekannte Tafel liefert null', async () => {
  const boards = createBoards(config, { mvg: fakeMvg(), now: () => NOW });
  assert.equal((await boards.getBoard('lthq')).board.id, 'LTHQ');
  assert.equal(await boards.getBoard('gibtsnicht'), null);
});

test('mehrere Spalten derselben Station teilen sich einen MVG-Abruf', async () => {
  const mvg = fakeMvg();
  const boards = createBoards(config, { mvg, now: () => NOW });
  const { stations } = await boards.getBoard('LTHQ');
  assert.deepEqual(stations[0].departures.map((d) => d.destination), ['Wolfratshausen']);
  assert.deepEqual(stations[1].departures.map((d) => d.destination), ['Kreuzstraße']);
  assert.equal(mvg.calls.departures, 1);
  assert.equal(mvg.calls.find, 1);
});

test('Teilansicht zeigt nur die Station mit dem Slug', async () => {
  const boards = createBoards(config, { mvg: fakeMvg(), now: () => NOW });
  const data = await boards.getBoard('LTHQ', 'Rein');
  assert.deepEqual(data.stations.map((s) => s.name), ['Harras stadteinwärts']);
  assert.equal(data.board.view, 'rein');
  assert.equal(data.board.subtitle, 'Harras stadteinwärts');
  assert.equal(await boards.getBoard('LTHQ', 'quer'), null);
  assert.equal(await boards.getBoard('hoeslhome', 'rein'), null);
});

test('cached Ergebnisse und löst die Station nur einmal auf', async () => {
  let t = NOW;
  const mvg = fakeMvg();
  const boards = createBoards(config, { mvg, now: () => t, cacheMs: 20_000 });
  await boards.getBoard('hoeslhome');
  await boards.getBoard('hoeslhome');
  assert.equal(mvg.calls.departures, 1);
  t += 21_000;
  await boards.getBoard('hoeslhome');
  // Nach Ablauf des Caches wird neu abgefragt; die Fixture-Züge sind dann teils schon weg.
  assert.equal(mvg.calls.departures, 2);
  assert.equal(mvg.calls.find, 1);
});

test('liefert bei MVG-Ausfall den letzten Stand als veraltet', async () => {
  let t = NOW;
  const mvg = fakeMvg();
  const boards = createBoards(config, { mvg, now: () => t, cacheMs: 1000 });
  await boards.getBoard('hoeslhome');
  mvg.setFail(true);
  t += 2000;
  const { stations } = await boards.getBoard('hoeslhome');
  assert.equal(stations[0].stale, true);
  assert.equal(stations[0].departures.length, 3);
  assert.match(stations[0].error, /veraltet/);
});

test('ohne vorherigen Stand gibt es eine leere Liste mit Fehler', async () => {
  const mvg = fakeMvg();
  mvg.setFail(true);
  const boards = createBoards(config, { mvg, now: () => NOW });
  const { stations } = await boards.getBoard('hoeslhome');
  assert.deepEqual(stations[0].departures, []);
  assert.equal(stations[0].error, 'MVG nicht erreichbar');
});

test('Konfiguration wird geprüft', () => {
  assert.throws(() => validateConfig({ boards: [] }), /mindestens eine Tafel/);
  assert.throws(() => validateConfig({ boards: [{ id: 'a b', stations: [{ name: 'x' }] }] }), /"id"/);
  assert.throws(
    () => validateConfig({ boards: [{ id: 'a', stations: [{ name: 'x' }] }, { id: 'A', stations: [{ name: 'y' }] }] }),
    /doppelt/,
  );
});

test('Slugs werden geprüft', () => {
  assert.throws(() => validateConfig({ boards: [{ id: 'a', stations: [{ name: 'x', slug: 'a/b' }] }] }), /slug/);
  assert.throws(
    () => validateConfig({ boards: [{ id: 'a', stations: [{ name: 'x', slug: 'r' }, { name: 'y', slug: 'R' }] }] }),
    /doppelt/,
  );
});

test('altes Format mit nur "stations" wird zur Tafel hoeslhome', () => {
  const { boards } = validateConfig({ stations: [{ name: 'Harras' }] });
  assert.equal(boards[0].id, 'hoeslhome');
  assert.equal(boards[0].stations[0].walkMinutes, 0);
});
