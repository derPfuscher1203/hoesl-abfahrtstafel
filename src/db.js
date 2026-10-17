// Ausweichquelle für Regional- und Fernzüge: die öffentliche DB-HAFAS-REST-API
// (https://v6.db.transport.rest, Projekt "db-rest"). Liefert dasselbe Format wie src/mvg.js.
import { normalize } from './filter.js';

const BASE_URL = process.env.DB_REST_URL || 'https://v6.db.transport.rest';
const TIMEOUT_MS = 10_000;

// MVG-Verkehrsmittel -> Produkt-Schalter der db-rest-API.
const PRODUCTS = {
  BAHN: ['nationalExpress', 'national', 'regionalExpress', 'regional'],
  SBAHN: ['suburban'],
  UBAHN: ['subway'],
  TRAM: ['tram'],
  BUS: ['bus'],
  REGIONAL_BUS: ['bus'],
};
const ALL_PRODUCTS = ['nationalExpress', 'national', 'regionalExpress', 'regional', 'suburban', 'bus', 'ferry', 'subway', 'tram', 'taxi'];
const TYPE_BY_PRODUCT = { suburban: 'SBAHN', subway: 'UBAHN', tram: 'TRAM', bus: 'BUS', ferry: 'SCHIFF', taxi: 'BUS' };

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'hoesl-abfahrtstafel/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DB-API antwortet mit HTTP ${res.status} für ${url}`);
  return res.json();
}

export async function findStation(query, fetchImpl = fetch) {
  const params = new URLSearchParams({ query, results: '8', stops: 'true', addresses: 'false', poi: 'false' });
  const results = await getJson(`${BASE_URL}/locations?${params}`, fetchImpl);
  const stops = (Array.isArray(results) ? results : []).filter((r) => (r.type === 'stop' || r.type === 'station') && r.id);
  const want = normalize(query);
  const match = stops.find((s) => normalize(s.name).startsWith(want)) || stops[0];
  if (!match) throw new Error(`Station "${query}" bei der DB nicht gefunden.`);
  return { globalId: String(match.id), name: match.name };
}

export async function fetchDepartures(stopId, { transportTypes, limit = 40 }, fetchImpl = fetch) {
  const wanted = new Set(transportTypes.flatMap((t) => PRODUCTS[t] ?? []));
  const params = new URLSearchParams({ duration: '180', results: String(limit), language: 'de', remarks: 'false' });
  for (const p of ALL_PRODUCTS) params.set(p, String(wanted.has(p)));
  const raw = await getJson(`${BASE_URL}/stops/${encodeURIComponent(stopId)}/departures?${params}`, fetchImpl);
  // v6 liefert { departures: [...] }, ältere Versionen ein Array.
  const list = Array.isArray(raw) ? raw : (raw?.departures ?? []);
  return list.map(toDeparture);
}

export function toDeparture(d) {
  const planned = d.plannedWhen ? Date.parse(d.plannedWhen) : null;
  const actual = d.when ? Date.parse(d.when) : planned;
  return {
    line: String(d.line?.name ?? d.line?.fahrtNr ?? '?').replace(/\s+/g, ' ').trim(),
    transportType: TYPE_BY_PRODUCT[d.line?.product] ?? 'BAHN',
    destination: d.direction ?? d.destination?.name ?? '',
    plannedTime: planned,
    departureTime: actual,
    delayMinutes: d.delay != null ? Math.round(d.delay / 60) : 0,
    realtime: d.delay != null,
    cancelled: Boolean(d.cancelled),
    platform: d.platform ?? d.plannedPlatform ?? null,
    sev: false,
  };
}
