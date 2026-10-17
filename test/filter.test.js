import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInbound, normalize } from '../src/filter.js';
import { loadConfig } from '../src/config.js';

test('normalize vereinheitlicht Umlaute, ß und Abkürzungen', () => {
  assert.equal(normalize('Großhadern'), 'grosshadern');
  assert.equal(normalize('Fürstenried West'), 'fuerstenried west');
  assert.equal(normalize('Basler Str.'), normalize('Basler Straße'));
});

test('ohne Regel wird nichts gefiltert', () => {
  assert.equal(isInbound({ transportType: 'UBAHN', destination: 'Irgendwo' }, {}), true);
});

test('exclude verwirft stadtauswärts fahrende Züge', () => {
  const dirs = { UBAHN: { exclude: ['Klinikum Großhadern'] } };
  assert.equal(isInbound({ transportType: 'UBAHN', destination: 'Klinikum Grosshadern' }, dirs), false);
  assert.equal(isInbound({ transportType: 'UBAHN', destination: 'Garching, Forschungszentrum' }, dirs), true);
});

test('include lässt nur passende Ziele durch', () => {
  const dirs = { SBAHN: { include: ['Ost', 'Hauptbahnhof'] } };
  assert.equal(isInbound({ transportType: 'SBAHN', destination: 'München Ost' }, dirs), true);
  assert.equal(isInbound({ transportType: 'SBAHN', destination: 'Wolfratshausen' }, dirs), false);
});

test('Standardkonfiguration: Richtungen der drei Stationen', async () => {
  const config = await loadConfig();
  const byName = Object.fromEntries(config.boards.flatMap((b) => b.stations).map((s) => [s.name, s.directions]));
  const cases = [
    ['Mittersendling', 'SBAHN', 'Kreuzstraße', true],
    ['Mittersendling', 'SBAHN', 'München Ost', true],
    ['Mittersendling', 'SBAHN', 'Wolfratshausen', false],
    ['Mittersendling', 'SBAHN', 'Höllriegelskreuth', false],
    ['Harras', 'UBAHN', 'Garching, Forschungszentrum', true],
    ['Harras', 'UBAHN', 'Fröttmaning', true],
    ['Harras', 'UBAHN', 'Klinikum Großhadern', false],
    ['Harras', 'SBAHN', 'Kreuzstraße', true],
    ['Harras', 'SBAHN', 'Mittersendling', false],
    ['Brudermühlstraße', 'UBAHN', 'Moosach', true],
    ['Brudermühlstraße', 'UBAHN', 'Olympiazentrum', true],
    ['Brudermühlstraße', 'UBAHN', 'Fürstenried West', false],
    ['Brudermühlstraße', 'UBAHN', 'Thalkirchen (Tierpark)', false],
    ['Richtung München', 'SBAHN', 'Geltendorf', true],
    ['Richtung München', 'SBAHN', 'München Hbf', true],
    ['Richtung München', 'SBAHN', 'Grafing Bahnhof', false],
    ['Richtung Grafing', 'SBAHN', 'Grafing Bahnhof', true],
    ['Richtung Grafing', 'SBAHN', 'Ebersberg', true],
    ['Richtung Grafing', 'SBAHN', 'Geltendorf', false],
    ['Moosburg Bahnhof', 'BAHN', 'München Hbf', true],
    ['Moosburg Bahnhof', 'BAHN', 'München Flughafen Terminal', true],
    ['Moosburg Bahnhof', 'BAHN', 'Freising', true],
    ['Moosburg Bahnhof', 'BAHN', 'Regensburg Hbf', false],
    ['Moosburg Bahnhof', 'BAHN', 'Landshut (Bay) Hbf', false],
    ['Moosburg Bahnhof', 'BAHN', 'Passau Hbf', false],
  ];
  for (const [station, transportType, destination, expected] of cases) {
    assert.equal(isInbound({ transportType, destination }, byName[station]), expected, `${station} → ${destination}`);
  }
});
