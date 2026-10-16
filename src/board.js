import { isInbound } from './filter.js';
import { fetchDepartures, findStation } from './mvg.js';

/**
 * Hält den Abfahrtsstand aller Stationen mit kurzem Cache, damit mehrere
 * Tablets die MVG nicht vervielfacht abfragen. Fällt die MVG aus, wird der
 * letzte bekannte Stand mit "stale: true" ausgeliefert.
 */
export function createBoard(config, { mvg = { findStation, fetchDepartures }, cacheMs = 20_000, now = Date.now } = {}) {
  const ids = new Map(config.stations.filter((s) => s.globalId).map((s) => [s.name, s.globalId]));
  const cache = new Map();
  let inflight = null;

  async function resolveId(station) {
    if (!ids.has(station.name)) {
      const found = await mvg.findStation(station.query);
      ids.set(station.name, found.globalId);
    }
    return ids.get(station.name);
  }

  async function loadStation(station) {
    const cached = cache.get(station.name);
    if (cached && now() - cached.fetchedAt < cacheMs) return cached.result;
    try {
      const globalId = await resolveId(station);
      const all = await mvg.fetchDepartures(globalId, { transportTypes: config.transportTypes });
      const nowTs = now();
      const departures = all
        .filter((d) => config.transportTypes.includes(d.transportType))
        .filter((d) => isInbound(d, station.directions))
        .filter((d) => d.departureTime == null || d.departureTime >= nowTs - 60_000)
        .sort((a, b) => a.departureTime - b.departureTime)
        .slice(0, config.departuresPerStation);
      const result = { name: station.name, globalId, departures, updatedAt: nowTs, stale: false };
      cache.set(station.name, { fetchedAt: nowTs, result });
      return result;
    } catch (err) {
      console.error(`[${station.name}] ${err.message}`);
      if (cached) return { ...cached.result, stale: true, error: 'Daten veraltet – MVG nicht erreichbar' };
      return { name: station.name, globalId: ids.get(station.name) ?? null, departures: [], stale: true, error: 'MVG nicht erreichbar' };
    }
  }

  async function getBoard() {
    // Gleichzeitige Anfragen teilen sich einen Abruf.
    inflight ??= Promise.all(config.stations.map(loadStation)).finally(() => {
      inflight = null;
    });
    const stations = await inflight;
    return { generatedAt: now(), refreshSeconds: config.refreshSeconds, stations };
  }

  return { getBoard };
}
