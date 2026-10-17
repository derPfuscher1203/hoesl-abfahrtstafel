import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const PROVIDERS = ['mvg', 'db'];
export const BOARD_ID = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../config/stations.json', import.meta.url));

/**
 * Lädt die Tafel-Konfiguration und prüft die Pflichtfelder.
 * @param {string} [path]
 */
export async function loadConfig(path = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  return validateConfig(raw);
}

function validateStation(s, where) {
  if (!s?.name) throw new Error(`${where} hat keinen "name".`);
  const walk = Number(s.walkMinutes);
  for (const key of ['provider', 'fallbackProvider']) {
    if (s[key] != null && !PROVIDERS.includes(s[key])) throw new Error(`${where}: "${key}" muss ${PROVIDERS.join(' oder ')} sein.`);
  }
  if (s.slug != null && !/^[A-Za-z0-9_-]+$/.test(s.slug)) throw new Error(`${where}: "slug" darf nur Buchstaben, Ziffern, - und _ enthalten.`);
  return {
    name: s.name,
    slug: s.slug || null,
    query: s.query || s.name,
    place: s.place || null,
    globalId: s.globalId || null,
    walkMinutes: Number.isFinite(walk) && walk > 0 ? walk : 0,
    provider: s.provider || 'mvg',
    fallbackProvider: s.fallbackProvider && s.fallbackProvider !== (s.provider || 'mvg') ? s.fallbackProvider : null,
    transportTypes: s.transportTypes?.length ? s.transportTypes : null,
    directions: s.directions || {},
  };
}

function validateBoard(b, defaults, index) {
  const where = `Tafel #${index + 1}`;
  if (!b?.id || !BOARD_ID.test(b.id)) {
    throw new Error(`${where} braucht eine "id" aus Buchstaben, Ziffern, - oder _ (Unterpfade mit /, z. B. "zeno/hp8").`);
  }
  if (!Array.isArray(b.stations) || b.stations.length === 0) throw new Error(`Tafel "${b.id}" braucht mindestens eine Station.`);
  return {
    id: b.id,
    title: b.title || 'Abfahrten',
    subtitle: b.subtitle || '',
    refreshSeconds: Number(b.refreshSeconds) || defaults.refreshSeconds,
    departuresPerStation: Number(b.departuresPerStation) || defaults.departuresPerStation,
    transportTypes: b.transportTypes?.length ? b.transportTypes : defaults.transportTypes,
    stations: b.stations.map((s, i) => validateStation(s, `Station #${i + 1} in Tafel "${b.id}"`)),
  };
}

function checkSlugs(board) {
  const seen = new Set();
  for (const s of board.stations) {
    if (!s.slug) continue;
    const key = s.slug.toLowerCase();
    if (seen.has(key)) throw new Error(`Slug "${s.slug}" ist in Tafel "${board.id}" doppelt.`);
    seen.add(key);
  }
}

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Konfiguration ist leer.');
  const defaults = {
    refreshSeconds: Number(raw.refreshSeconds) || 30,
    departuresPerStation: Number(raw.departuresPerStation) || 8,
    transportTypes: raw.transportTypes?.length ? raw.transportTypes : ['UBAHN', 'SBAHN'],
  };
  // Altes Format (nur "stations") gilt als eine Tafel "hoeslhome".
  const rawBoards = raw.boards ?? (raw.stations ? [{ id: 'hoeslhome', title: 'Abfahrten stadteinwärts', subtitle: 'U-Bahn und S-Bahn', stations: raw.stations }] : []);
  if (!Array.isArray(rawBoards) || rawBoards.length === 0) {
    throw new Error('Konfiguration braucht mindestens eine Tafel in "boards" mit mindestens einer Station.');
  }
  const boards = rawBoards.map((b, i) => validateBoard(b, defaults, i));
  boards.forEach(checkSlugs);
  const ids = new Set();
  for (const b of boards) {
    const key = b.id.toLowerCase();
    if (ids.has(key)) throw new Error(`Tafel-ID "${b.id}" ist doppelt.`);
    ids.add(key);
  }
  return { boards };
}
