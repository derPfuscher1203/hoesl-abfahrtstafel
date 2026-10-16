// Demo-Daten für Entwicklung und Screenshots ohne Netzzugang (MVG_MOCK=1).
// Enthält absichtlich auch stadtauswärts fahrende Züge, damit der Filter sichtbar wirkt.
const LINES = {
  'mock:mittersendling': [
    ['S7', 'SBAHN', 'Kreuzstraße'],
    ['S7', 'SBAHN', 'Wolfratshausen'],
    ['S20', 'SBAHN', 'Pasing'],
    ['S20', 'SBAHN', 'Höllriegelskreuth'],
    ['S7', 'SBAHN', 'München Ost'],
  ],
  'mock:harras': [
    ['U6', 'UBAHN', 'Garching, Forschungszentrum'],
    ['U6', 'UBAHN', 'Klinikum Großhadern'],
    ['S7', 'SBAHN', 'Kreuzstraße'],
    ['U6', 'UBAHN', 'Fröttmaning'],
    ['S7', 'SBAHN', 'Wolfratshausen'],
    ['U6', 'UBAHN', 'Münchner Freiheit'],
  ],
  'mock:haar': [
    ['S4', 'SBAHN', 'Geltendorf'],
    ['S4', 'SBAHN', 'Grafing Bahnhof'],
    ['S4', 'SBAHN', 'München Hbf'],
    ['S4', 'SBAHN', 'Ebersberg'],
    ['S4', 'SBAHN', 'Trudering'],
  ],
  'mock:brudermuehlstrasse': [
    ['U3', 'UBAHN', 'Moosach'],
    ['U3', 'UBAHN', 'Fürstenried West'],
    ['U3', 'UBAHN', 'Olympiazentrum'],
    ['U3', 'UBAHN', 'Thalkirchen (Tierpark)'],
  ],
};

export const mockMvg = {
  async findStation(query) {
    const key = query.toLowerCase().replace('ü', 'ue').replace('ß', 'ss').replace(/\s+/g, '');
    return { globalId: `mock:${key}`, name: query };
  },
  async fetchDepartures(globalId) {
    const lines = LINES[globalId] || [];
    const base = Date.now();
    const out = [];
    for (let i = 0; i < 24; i++) {
      const [line, transportType, destination] = lines[i % lines.length];
      const planned = base + (i * 2.5 + (i % 3)) * 60_000;
      const delay = i % 5 === 2 ? 3 : 0;
      out.push({
        line,
        transportType,
        destination,
        plannedTime: planned,
        departureTime: planned + delay * 60_000,
        delayMinutes: delay,
        realtime: true,
        cancelled: i === 7,
        platform: null,
        sev: false,
      });
    }
    return out;
  },
};
