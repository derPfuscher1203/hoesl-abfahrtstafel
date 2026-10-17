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

test('Ausweichquelle springt ein, wenn die erste Quelle scheitert oder nichts liefert', async () => {
  const cfg = validateConfig({
    boards: [
      {
        id: 'zeno/moosburg',
        transportTypes: ['BAHN'],
        stations: [{ name: 'Moosburg', provider: 'mvg', fallbackProvider: 'db', directions: { BAHN: { include: ['München'] } } }],
      },
    ],
  });
  const train = (destination) => ({ line: 'RB 33', transportType: 'BAHN', destination, departureTime: NOW + 600_000 });
  const dbProvider = {
    findStation: async () => ({ globalId: '8004136' }),
    fetchDepartures: async () => [train('München Hbf'), train('Landshut (Bay) Hbf')],
  };
  // MVG liefert nichts -> DB
  const empty = { findStation: async () => ({ globalId: 'de:1' }), fetchDepartures: async () => [] };
  let boards = createBoards(cfg, { mvg: empty, db: dbProvider, now: () => NOW });
  let st = (await boards.getBoard('zeno/moosburg')).stations[0];
  assert.equal(st.source, 'db');
  assert.deepEqual(st.departures.map((d) => d.destination), ['München Hbf']);
  // MVG wirft -> DB
  const failing = { findStation: async () => { throw new Error('nicht gefunden'); }, fetchDepartures: async () => [] };
  boards = createBoards(cfg, { mvg: failing, db: dbProvider, now: () => NOW });
  st = (await boards.getBoard('zeno/moosburg')).stations[0];
  assert.equal(st.source, 'db');
  assert.equal(st.stale, false);
});

test('Verkehrsmittel pro Station überschreiben die der Tafel', async () => {
  const cfg = validateConfig({
    boards: [
      {
        id: 'zeno/hp8',
        stations: [
          { name: 'U', query: 'A', transportTypes: ['UBAHN'] },
          { name: 'Bus', query: 'B', transportTypes: ['BUS'] },
        ],
      },
    ],
  });
  const seen = [];
  const mvg = {
    findStation: async (q) => ({ globalId: q }),
    fetchDepartures: async (id, { transportTypes }) => {
      seen.push(`${id}:${transportTypes.join(',')}`);
      return [
        { line: 'U3', transportType: 'UBAHN', destination: 'Moosach', departureTime: NOW + 60_000 },
        { line: '54', transportType: 'BUS', destination: 'Lorettoplatz', departureTime: NOW + 60_000 },
      ];
    },
  };
  const { stations } = await createBoards(cfg, { mvg, now: () => NOW }).getBoard('zeno/hp8');
  assert.deepEqual(seen.sort(), ['A:UBAHN', 'B:BUS']);
  assert.deepEqual(stations.map((s) => s.departures.map((d) => d.line)), [['U3'], ['54']]);
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
  assert.throws(() => validateConfig({ boards: [{ id: 'a//b', stations: [{ name: 'x' }] }] }), /"id"/);
  assert.equal(validateConfig({ boards: [{ id: 'zeno/hp8', stations: [{ name: 'x' }] }] }).boards[0].id, 'zeno/hp8');
  assert.throws(() => validateConfig({ boards: [{ id: 'a', stations: [{ name: 'x', provider: 'vbb' }] }] }), /provider/);
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
