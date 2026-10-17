// Linienfarben aus dem Träwelling-Projekt "line-colors"
// (https://traewelling.github.io/line-colors/, Quelle: GitHub Traewelling/line-colors).
// Die CSV wird beim Start und danach täglich geladen. Ist sie nicht erreichbar,
// gelten die eingebauten Farben unten.

export const DEFAULT_URL = 'https://raw.githubusercontent.com/Traewelling/line-colors/main/line-colors.csv';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 15_000;

// MVG-Verkehrsmittel -> shortOperatorName in der CSV.
export const OPERATORS = {
  UBAHN: 'mvv-mvg-ubahn',
  SBAHN: 'mvv-db-sbm',
  TRAM: 'mvv-mvg-tram',
  BUS: 'mvv-mvg-bus',
};

const u = (bg) => ({ background: bg, text: '#ffffff', border: null, shape: 'rectangle' });
const s = (bg, text = '#ffffff') => ({ background: bg, text, border: null, shape: 'pill' });

/** Eingebaute Farben (Stand Oktober 2026), falls die CSV nicht geladen werden kann. */
export const FALLBACK = {
  'UBAHN:U1': u('#52822f'),
  'UBAHN:U2': u('#c20831'),
  'UBAHN:U3': u('#ec6725'),
  'UBAHN:U4': u('#00a984'),
  'UBAHN:U5': u('#bc7a00'),
  'UBAHN:U6': u('#0065ae'),
  'UBAHN:U7': u('#52822f'),
  'UBAHN:U8': u('#c20831'),
  'SBAHN:S1': s('#1fbce6'),
  'SBAHN:S2': s('#79b833'),
  'SBAHN:S3': s('#962a85'),
  'SBAHN:S4': s('#e41f28'),
  'SBAHN:S5': s('#00527f'),
  'SBAHN:S6': s('#008f5c'),
  'SBAHN:S7': s('#8a372f'),
  'SBAHN:S8': s('#2d2b29', '#ffcd01'),
  'SBAHN:S20': s('#f05972'),
};

/** Neutrale Farben je Verkehrsmittel für Linien ohne eigenen Eintrag (z. B. Regionalzüge). */
export const TYPE_FALLBACK = {
  BAHN: { background: '#5b6573', text: '#ffffff', border: null, shape: 'rectangle-rounded-corner' },
  BUS: { background: '#325868', text: '#ffffff', border: null, shape: 'rectangle' },
  REGIONAL_BUS: { background: '#325868', text: '#ffffff', border: null, shape: 'rectangle' },
  TRAM: { background: '#e30613', text: '#ffffff', border: null, shape: 'rectangle' },
};

/** Minimaler CSV-Parser nach RFC 4180 (Anführungszeichen, "" als Escape, Zeilenumbrüche in Feldern). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...data] = rows;
  return data.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const HEX = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i;

/** Baut aus den CSV-Zeilen eine Map "UBAHN:U6" -> Stil, nur für die MVV-Betreiber. */
export function buildColorMap(records) {
  const byOperator = Object.fromEntries(Object.entries(OPERATORS).map(([type, op]) => [op, type]));
  const map = {};
  for (const r of records) {
    const type = byOperator[r.shortOperatorName];
    if (!type || !r.lineName || !HEX.test(r.backgroundColor)) continue;
    map[`${type}:${r.lineName.replace(/\s+/g, '')}`] = {
      background: r.backgroundColor,
      text: HEX.test(r.textColor) ? r.textColor : '#ffffff',
      border: HEX.test(r.borderColor) ? r.borderColor : null,
      shape: r.shape || 'rectangle',
    };
  }
  return map;
}

export function createLineColors({ url = process.env.LINE_COLORS_URL || DEFAULT_URL, fetchImpl = fetch, now = Date.now } = {}) {
  let colors = {};
  let source = 'fallback';
  let updatedAt = null;
  let timer = null;

  async function refresh() {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const map = buildColorMap(parseCsv(await res.text()));
      if (Object.keys(map).length === 0) throw new Error('keine MVV-Linien in der CSV');
      colors = map;
      source = url;
      updatedAt = now();
      console.log(`Linienfarben geladen: ${Object.keys(map).length} MVV-Linien aus ${url}`);
      return true;
    } catch (err) {
      console.warn(`Linienfarben nicht geladen (${err.message}), ${source === 'fallback' ? 'nutze eingebaute Farben' : 'behalte letzten Stand'}.`);
      return false;
    }
  }

  function schedule(ok) {
    timer = setTimeout(() => refresh().then(schedule), ok ? REFRESH_MS : RETRY_MS);
    timer.unref?.();
  }

  return {
    /** Lädt sofort und danach täglich (nach Fehlern alle 15 Minuten). */
    start() {
      return refresh().then((ok) => {
        schedule(ok);
        return ok;
      });
    },
    stop() {
      clearTimeout(timer);
    },
    refresh,
    style(transportType, line) {
      const key = `${transportType}:${String(line ?? '').replace(/\s+/g, '')}`;
      return colors[key] ?? FALLBACK[key] ?? TYPE_FALLBACK[transportType] ?? null;
    },
    /** Stile für alle Linien, die in den Abfahrten vorkommen. */
    stylesFor(stations) {
      const out = {};
      for (const st of stations) {
        for (const d of st.departures) {
          const key = `${d.transportType}:${d.line}`;
          if (!(key in out)) {
            const style = this.style(d.transportType, d.line);
            if (style) out[key] = style;
          }
        }
      }
      return out;
    },
    info() {
      return { source, updatedAt, lines: Object.keys(colors).length };
    },
  };
}
