import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../config/stations.json', import.meta.url));

/**
 * Lädt die Stationskonfiguration und prüft die Pflichtfelder.
 * @param {string} [path]
 */
export async function loadConfig(path = process.env.CONFIG_PATH || DEFAULT_CONFIG_PATH) {
  const raw = JSON.parse(await readFile(path, 'utf8'));
  return validateConfig(raw);
}

export function validateConfig(raw) {
  if (!raw || !Array.isArray(raw.stations) || raw.stations.length === 0) {
    throw new Error('Konfiguration braucht mindestens eine Station in "stations".');
  }
  const stations = raw.stations.map((s, i) => {
    if (!s.name) throw new Error(`Station #${i + 1} hat keinen "name".`);
    return {
      name: s.name,
      query: s.query || s.name,
      globalId: s.globalId || null,
      directions: s.directions || {},
    };
  });
  return {
    refreshSeconds: Number(raw.refreshSeconds) || 30,
    departuresPerStation: Number(raw.departuresPerStation) || 8,
    transportTypes: raw.transportTypes?.length ? raw.transportTypes : ['UBAHN', 'SBAHN'],
    stations,
  };
}
