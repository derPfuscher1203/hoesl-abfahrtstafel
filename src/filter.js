/**
 * Normalisiert Ortsnamen für einen toleranten Vergleich
 * ("Großhadern" == "Grosshadern", "Fürstenried" == "Fuerstenried").
 * @param {string} s
 */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/str\./g, 'strasse')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesAny(destination, patterns) {
  const d = normalize(destination);
  return patterns.some((p) => d.includes(normalize(p)));
}

/**
 * Entscheidet, ob eine Abfahrt stadteinwärts fährt.
 * Pro Verkehrsmittel gilt: Ist "include" gesetzt, muss das Ziel passen;
 * passt das Ziel auf "exclude", wird die Abfahrt verworfen.
 * Ohne Regel für das Verkehrsmittel wird nichts gefiltert.
 */
export function isInbound(departure, directions = {}) {
  const rule = directions[departure.transportType];
  if (!rule) return true;
  if (rule.include?.length && !matchesAny(departure.destination, rule.include)) return false;
  if (rule.exclude?.length && matchesAny(departure.destination, rule.exclude)) return false;
  return true;
}
