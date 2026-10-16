import { normalize } from './filter.js';

const BASE_URL = process.env.MVG_BASE_URL || 'https://www.mvg.de/api/bgw-pt/v3';
const TIMEOUT_MS = 8000;

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'hoesl-abfahrtstafel/1.0' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`MVG antwortet mit HTTP ${res.status} für ${url}`);
  return res.json();
}

/**
 * Sucht die globalId einer Station über die MVG-Ortssuche.
 * Bevorzugt wird ein exakter Namenstreffer im gewünschten Ort (Standard: München).
 * @returns {Promise<{globalId: string, name: string}>}
 */
export async function findStation(query, fetchImpl = fetch, place = 'München') {
  const url = `${BASE_URL}/locations?${new URLSearchParams({ query, locationTypes: 'STATION' })}`;
  const results = await getJson(url, fetchImpl);
  const stations = (Array.isArray(results) ? results : []).filter((r) => r.type === 'STATION' && r.globalId);
  const wantName = normalize(query);
  const wantPlace = normalize(place || 'München');
  const score = (s) => (normalize(s.name) === wantName ? 2 : 0) + (normalize(s.place) === wantPlace ? 1 : 0);
  // Stabile Sortierung: bei Gleichstand bleibt die Reihenfolge der MVG (Relevanz).
  const match = stations.map((s, i) => ({ s, i, score: score(s) })).sort((a, b) => b.score - a.score || a.i - b.i)[0]?.s;
  if (!match) throw new Error(`Station "${query}" nicht gefunden.`);
  return { globalId: match.globalId, name: match.name };
}

/**
 * Lädt die nächsten Abfahrten einer Station und bringt sie in ein schlankes Format.
 */
export async function fetchDepartures(globalId, { transportTypes, limit = 40 }, fetchImpl = fetch) {
  const params = new URLSearchParams({
    globalId,
    limit: String(limit),
    offsetInMinutes: '0',
    transportTypes: transportTypes.join(','),
  });
  const raw = await getJson(`${BASE_URL}/departures?${params}`, fetchImpl);
  return (Array.isArray(raw) ? raw : []).map(toDeparture);
}

export function toDeparture(d) {
  const planned = d.plannedDepartureTime ?? null;
  const realtime = d.realtimeDepartureTime ?? planned;
  return {
    line: d.label,
    transportType: d.transportType,
    destination: d.destination,
    plannedTime: planned,
    departureTime: realtime,
    delayMinutes: d.delayInMinutes ?? 0,
    realtime: Boolean(d.realtime),
    cancelled: Boolean(d.cancelled),
    platform: d.platform ?? null,
    sev: Boolean(d.sev),
  };
}
