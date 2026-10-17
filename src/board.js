import { isInbound } from './filter.js';
import * as db from './db.js';
import * as mvgApi from './mvg.js';

// Zusätzliche Abfahrten, damit nach dem Ausblenden nicht mehr erreichbarer Züge
// (Gehzeit) im Browser noch genug übrig bleiben.
const EXTRA_DEPARTURES = 6;

const PROVIDER_NAMES = { mvg: 'MVG', db: 'DB' };

/**
 * Hält den Abfahrtsstand aller Tafeln mit kurzem Cache, damit mehrere
 * Tablets die Datenquellen nicht vervielfacht abfragen. Fällt eine Quelle aus,
 * wird – falls konfiguriert – die Ausweichquelle genutzt, sonst der letzte
 * bekannte Stand mit "stale: true" ausgeliefert.
 */
export function createBoards(
  config,
  {
    mvg = { findStation: mvgApi.findStation, fetchDepartures: mvgApi.fetchDepartures },
    db: dbProvider = { findStation: db.findStation, fetchDepartures: db.fetchDepartures },
    cacheMs = 20_000,
    now = Date.now,
  } = {},
) {
  const providers = { mvg, db: dbProvider };
  const typesOf = (board, station) => station.transportTypes ?? board.transportTypes;

  // Stations-ID pro Quelle + Suchbegriff; mehrere Spalten können dieselbe Station nutzen.
  const ids = new Map();
  const idKey = (provider, s) => `${provider}|${s.query}|${s.place ?? ''}`;
  for (const b of config.boards) for (const s of b.stations) if (s.globalId) ids.set(idKey(s.provider, s), s.globalId);

  // Rohdaten pro Quelle + Station + Verkehrsmittel, gemeinsam für alle Spalten/Tafeln.
  const rawCache = new Map();
  const rawInflight = new Map();
  const lastGood = new Map();
  const boardInflight = new Map();
  const idInflight = new Map();

  async function resolveId(provider, station, transportTypes) {
    const key = idKey(provider, station);
    if (ids.has(key)) return ids.get(key);
    if (!idInflight.has(key)) {
      const p = providers[provider]
        .findStation(station.query, undefined, station.place ?? undefined, transportTypes)
        .then((found) => {
          ids.set(key, found.globalId);
          return found.globalId;
        })
        .finally(() => idInflight.delete(key));
      idInflight.set(key, p);
    }
    return idInflight.get(key);
  }

  async function loadRaw(provider, globalId, transportTypes) {
    const key = `${provider}|${globalId}|${transportTypes.join(',')}`;
    const cached = rawCache.get(key);
    if (cached && now() - cached.fetchedAt < cacheMs) return cached.departures;
    if (!rawInflight.has(key)) {
      const p = providers[provider]
        .fetchDepartures(globalId, { transportTypes, limit: 60 })
        .then((departures) => {
          rawCache.set(key, { fetchedAt: now(), departures });
          return departures;
        })
        .finally(() => rawInflight.delete(key));
      rawInflight.set(key, p);
    }
    return rawInflight.get(key);
  }

  async function loadFrom(provider, board, station) {
    const transportTypes = typesOf(board, station);
    const globalId = await resolveId(provider, station, transportTypes);
    const all = await loadRaw(provider, globalId, transportTypes);
    // Liefert die Quelle für diese Station gar nichts (z. B. keine Regionalzüge bei der MVG),
    // gilt das wie ein Fehler, damit die Ausweichquelle greifen kann.
    if (all.length === 0 && station.fallbackProvider && provider === station.provider) {
      throw new Error('keine Abfahrten geliefert');
    }
    const nowTs = now();
    const departures = all
      .filter((d) => transportTypes.includes(d.transportType))
      .filter((d) => isInbound(d, station.directions))
      .filter((d) => d.departureTime == null || d.departureTime >= nowTs - 60_000)
      .sort((a, b) => a.departureTime - b.departureTime)
      .slice(0, board.departuresPerStation + EXTRA_DEPARTURES);
    return { globalId, departures, source: provider, updatedAt: nowTs, stale: false };
  }

  async function loadStation(board, station, index) {
    const cacheKey = `${board.id}#${index}`;
    const base = { name: station.name, walkMinutes: station.walkMinutes };
    const sourceName = PROVIDER_NAMES[station.provider] ?? station.provider;
    try {
      const result = { ...base, ...(await loadFrom(station.provider, board, station)) };
      lastGood.set(cacheKey, result);
      return result;
    } catch (err) {
      console.error(`[${board.id} / ${station.name}] ${sourceName}: ${err.message}`);
      if (station.fallbackProvider) {
        try {
          const result = { ...base, ...(await loadFrom(station.fallbackProvider, board, station)) };
          lastGood.set(cacheKey, result);
          return result;
        } catch (err2) {
          console.error(`[${board.id} / ${station.name}] ${PROVIDER_NAMES[station.fallbackProvider]}: ${err2.message}`);
        }
      }
      const previous = lastGood.get(cacheKey);
      if (previous) return { ...previous, stale: true, error: `Daten veraltet – ${sourceName} nicht erreichbar` };
      return { ...base, globalId: null, departures: [], stale: true, error: `${sourceName} nicht erreichbar` };
    }
  }

  function findBoard(id) {
    return config.boards.find((b) => b.id.toLowerCase() === String(id).toLowerCase()) ?? null;
  }

  /** Teilansicht einer Tafel, z. B. /LTHQ/stadteinwaerts. */
  function findView(board, slug) {
    if (!board || slug == null) return null;
    return board.stations.find((s) => s.slug && s.slug.toLowerCase() === String(slug).toLowerCase()) ?? null;
  }

  /** @returns {Promise<object|null>} null, wenn es die Tafel bzw. Ansicht nicht gibt */
  async function getBoard(id, slug) {
    const board = findBoard(id);
    if (!board) return null;
    const view = slug == null ? null : findView(board, slug);
    if (slug != null && !view) return null;
    // Gleichzeitige Anfragen auf dieselbe Tafel teilen sich einen Abruf.
    if (!boardInflight.has(board.id)) {
      boardInflight.set(
        board.id,
        Promise.all(board.stations.map((s, i) => loadStation(board, s, i))).finally(() => boardInflight.delete(board.id)),
      );
    }
    const all = await boardInflight.get(board.id);
    const stations = view ? all.filter((_, i) => board.stations[i] === view) : all;
    return {
      board: { id: board.id, title: board.title, subtitle: view ? view.name : board.subtitle, view: view?.slug ?? null },
      departuresPerStation: board.departuresPerStation,
      generatedAt: now(),
      refreshSeconds: board.refreshSeconds,
      stations,
    };
  }

  return { boards: config.boards, findBoard, findView, getBoard };
}
