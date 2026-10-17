import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColorMap, createLineColors, FALLBACK, parseCsv } from '../src/lineColors.js';

// Ausschnitt im Format von Traewelling/line-colors, inkl. Feld mit Komma in Anführungszeichen.
const CSV = [
  'shortOperatorName,lineName,hafasOperatorCode,hafasLineId,backgroundColor,textColor,borderColor,shape,wikidataQid,delfiAgencyID,delfiAgencyName',
  'kvv-anrufverkehre,263,,,#a97c50,#ffffff,,circle,,25,"Zeller Bus, Taxi- und Krankentransporte GmbH"',
  'mvv-db-sbm,S8,db-regio-ag-s-bahn-munchen,4-800725-8,#2d2b29,#ffcd01,,pill,,15017,DB Regio AG S-Bahn München',
  'mvv-db-sbm,S7,db-regio-ag-s-bahn-munchen,4-800725-7,#123456,#ffffff,,pill,,15017,DB Regio AG S-Bahn München',
  'mvv-mvg-ubahn,U6,,7-swm001-6,#0065ae,#ffffff,,rectangle,,8118,U-Bahn München',
  'mvv-mvg-tram,28,,8-swm002-28,#ffffff,#f7a600,#f7a600,rectangle,,14747,Straßenbahn München',
  'mvv-mvg-ubahn,U9,,,kaputt,#ffffff,,rectangle,,8118,U-Bahn München',
  '',
].join('\r\n');

const ok = (body) => async () => ({ ok: true, status: 200, text: async () => body });

test('parseCsv versteht Anführungszeichen und CRLF', () => {
  const rows = parseCsv(CSV);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].delfiAgencyName, 'Zeller Bus, Taxi- und Krankentransporte GmbH');
  assert.equal(rows[1].lineName, 'S8');
});

test('buildColorMap nimmt nur MVV-Betreiber mit gültigen Farben', () => {
  const map = buildColorMap(parseCsv(CSV));
  assert.deepEqual(Object.keys(map).sort(), ['SBAHN:S7', 'SBAHN:S8', 'TRAM:28', 'UBAHN:U6']);
  assert.deepEqual(map['SBAHN:S8'], { background: '#2d2b29', text: '#ffcd01', border: null, shape: 'pill' });
  assert.equal(map['TRAM:28'].border, '#f7a600');
});

test('geladene Farben haben Vorrang, sonst gilt der Fallback', async () => {
  const lc = createLineColors({ url: 'x', fetchImpl: ok(CSV) });
  assert.deepEqual(lc.style('SBAHN', 'S7'), FALLBACK['SBAHN:S7']);
  assert.equal(await lc.refresh(), true);
  assert.equal(lc.style('SBAHN', 'S7').background, '#123456');
  // Nicht in der CSV, aber im Fallback.
  assert.equal(lc.style('UBAHN', 'U3').background, FALLBACK['UBAHN:U3'].background);
  assert.equal(lc.style('SCHIFF', 'X99'), null);
  assert.equal(lc.style('BAHN', 'RB 33').background, '#5b6573');
  assert.equal(lc.info().lines, 4);
});

test('Fehler beim Laden behält den letzten Stand', async () => {
  let fail = false;
  const fetchImpl = async () => {
    if (fail) throw new Error('offline');
    return { ok: true, status: 200, text: async () => CSV };
  };
  const lc = createLineColors({ url: 'x', fetchImpl });
  await lc.refresh();
  fail = true;
  assert.equal(await lc.refresh(), false);
  assert.equal(lc.style('SBAHN', 'S7').background, '#123456');
});

test('stylesFor liefert genau die Linien der Abfahrten', () => {
  const lc = createLineColors({ url: 'x', fetchImpl: ok('') });
  const styles = lc.stylesFor([
    { departures: [{ transportType: 'UBAHN', line: 'U6' }, { transportType: 'SBAHN', line: 'S7' }] },
    { departures: [{ transportType: 'UBAHN', line: 'U6' }, { transportType: 'SCHIFF', line: 'X99' }] },
  ]);
  assert.deepEqual(Object.keys(styles).sort(), ['SBAHN:S7', 'UBAHN:U6']);
});
