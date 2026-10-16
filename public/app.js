// Linienfarben nach MVG/MVV-Liniennetz.
const LINE_COLORS = {
  U1: '#3c7233',
  U2: '#c4022e',
  U3: '#ed6720',
  U4: '#00a984',
  U5: '#bc7a00',
  U6: '#0065ae',
  U7: '#3c7233',
  U8: '#c4022e',
  S1: '#16bae7',
  S2: '#76b82a',
  S3: '#951b81',
  S4: '#e30613',
  S6: '#00975f',
  S7: '#943126',
  S8: '#000000',
  S20: '#ea516d',
};

const MINUTE = 60_000;
// Ab hier heißt es "Jetzt los!" (Sekunden bis zum Losgehen).
const GO_NOW_MS = 90_000;
// Ab hier wird es eng (gelb).
const HURRY_MS = 4 * MINUTE;
// Zeitfenster, über das sich der Balken bis zum Losgehen füllt.
const BAR_WINDOW_MS = 10 * MINUTE;
const FETCH_TIMEOUT_MS = 10_000;

const BOARD_ID = document.body.dataset.board;
const PAGE_VERSION = document.body.dataset.version;

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const clockEl = document.getElementById('clock');
const tpl = document.getElementById('station-tpl');

let data = null;
let refreshSeconds = 30;
let lastSuccess = 0;
let lastAttempt = 0;
let failingSince = 0;
let loading = false;
let nextTimer = null;
// Differenz zwischen Server- und Tablet-Uhr; Tablets gehen oft falsch.
let clockOffset = 0;

const now = () => Date.now() + clockOffset;
const tz = { timeZone: 'Europe/Berlin' };
const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', ...tz });
const fmtClock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', ...tz });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function badge(dep) {
  const b = el('span', 'badge ' + (dep.transportType === 'SBAHN' ? 'sbahn' : 'ubahn'), dep.line);
  b.style.background = LINE_COLORS[dep.line] || '#555';
  return b;
}

function departureLabel(dep) {
  const min = Math.floor((dep.departureTime - now()) / MINUTE);
  if (dep.cancelled) return 'fällt aus';
  if (min <= 0) return 'jetzt';
  if (min < 60) return `${min} min`;
  return fmtTime.format(dep.departureTime);
}

/** Millisekunden, bis man losgehen muss, um die Abfahrt zu erreichen. */
function leaveIn(dep, walkMinutes) {
  return dep.departureTime - walkMinutes * MINUTE - now();
}

function urgency(ms) {
  if (ms < GO_NOW_MS) return 'go';
  if (ms < HURRY_MS) return 'hurry';
  return 'calm';
}

function renderTime(dep, walkMinutes) {
  const box = el('div', 'time');
  box.textContent = departureLabel(dep);
  if (!dep.cancelled && Math.floor((dep.departureTime - now()) / MINUTE) <= 0) box.classList.add('now');
  if (walkMinutes > 0 && !dep.cancelled) {
    const ms = leaveIn(dep, walkMinutes);
    box.append(el('span', `leave ${urgency(ms)}`, ms < GO_NOW_MS ? 'jetzt los' : `los in ${Math.floor(ms / MINUTE)}`));
  }
  return box;
}

function renderDeparture(dep, walkMinutes) {
  const li = el('li', 'dep' + (dep.cancelled ? ' cancelled' : ''));
  const dest = el('div', 'dest', dep.destination);
  const notes = [];
  if (!dep.cancelled && dep.delayMinutes > 0) notes.push(`+${dep.delayMinutes} min · plan ${fmtTime.format(dep.plannedTime)}`);
  if (dep.sev) notes.push('Schienenersatzverkehr');
  if (notes.length) dest.append(el('small', 'delay', notes.join(' · ')));
  li.append(badge(dep), dest, renderTime(dep, walkMinutes));
  return li;
}

function renderHero(node, dep, walkMinutes) {
  const hero = node.querySelector('.hero');
  hero.hidden = false;
  const ms = leaveIn(dep, walkMinutes);
  const state = urgency(ms);
  hero.className = `hero ${state}`;
  hero.querySelector('.hero-label').textContent =
    state === 'go' ? 'Jetzt los!' : `Los in ${Math.floor(ms / MINUTE)} min`;
  const sub = hero.querySelector('.hero-sub');
  sub.replaceChildren(badge(dep), el('span', 'hero-dest', dep.destination), el('span', 'hero-when', `ab ${fmtTime.format(dep.departureTime)}`));
  const progress = Math.min(1, Math.max(0, 1 - ms / BAR_WINDOW_MS));
  hero.querySelector('.hero-bar span').style.width = `${(progress * 100).toFixed(1)}%`;
}

function renderStation(station) {
  const node = tpl.content.firstElementChild.cloneNode(true);
  const walk = station.walkMinutes || 0;
  node.querySelector('.station-name').textContent = station.name;
  if (walk > 0) {
    const w = node.querySelector('.walk');
    w.hidden = false;
    w.querySelector('.walk-min').textContent = `${walk} min`;
  }
  if (station.error) {
    const note = node.querySelector('.station-note');
    note.hidden = false;
    note.textContent = station.error;
  }

  // Nur Abfahrten, die man zu Fuß noch erreicht (bzw. ohne Gehzeit: noch nicht weg).
  const t = now();
  const reachable = station.departures.filter((d) =>
    walk > 0 ? leaveIn(d, walk) >= 0 : d.departureTime > t - 30_000,
  );
  const limit = data.departuresPerStation || 8;
  const list = node.querySelector('.departures');
  let rows = reachable;
  if (walk > 0) {
    const next = reachable.find((d) => !d.cancelled);
    if (next) {
      renderHero(node, next, walk);
      rows = reachable.filter((d) => d !== next);
    }
  }
  rows = rows.slice(0, limit);
  if (rows.length === 0 && node.querySelector('.hero').hidden) {
    list.append(el('li', 'empty', station.error ? 'Keine Daten' : 'Keine erreichbaren Abfahrten in nächster Zeit'));
  } else {
    list.append(...rows.map((d) => renderDeparture(d, walk)));
  }
  return node;
}

// Zeilen ausblenden, die nicht mehr vollständig in die Karte passen.
function trimOverflow() {
  for (const list of boardEl.querySelectorAll('.departures')) {
    const bottom = list.getBoundingClientRect().bottom;
    for (const row of list.children) {
      row.style.visibility = row.getBoundingClientRect().bottom > bottom + 1 ? 'hidden' : '';
    }
  }
}

function render() {
  if (!data) return;
  document.body.classList.toggle('single', data.stations.length === 1);
  boardEl.replaceChildren(...data.stations.map(renderStation));
  trimOverflow();
}

function renderStatus() {
  const footer = statusEl.parentElement;
  const broken = !lastSuccess || now() - lastSuccess > refreshSeconds * 2.5 * 1000;
  footer.classList.toggle('error', broken);
  document.body.classList.toggle('stale', Boolean(lastSuccess) && broken);
  if (!lastSuccess) {
    statusEl.textContent = failingSince ? 'Keine Verbindung zum Server – neuer Versuch läuft' : 'Lade Abfahrten …';
  } else if (broken) {
    statusEl.textContent = `Verbindung gestört – letzter Stand ${fmtClock.format(lastSuccess)}`;
  } else {
    statusEl.textContent = `Stand ${fmtClock.format(lastSuccess)}`;
  }
}

function schedule(ms) {
  clearTimeout(nextTimer);
  nextTimer = setTimeout(refresh, ms);
}

async function refresh() {
  if (loading) return;
  loading = true;
  lastAttempt = Date.now();
  try {
    const res = await fetch(`/api/boards/${BOARD_ID.split('/').map(encodeURIComponent).join('/')}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    // Neue Server-Version (Update/Neustart): Seite neu laden, Server ist ja erreichbar.
    if (body.version && PAGE_VERSION && !PAGE_VERSION.startsWith('__') && body.version !== PAGE_VERSION) {
      location.reload();
      return;
    }
    clockOffset = body.generatedAt ? body.generatedAt - Date.now() : 0;
    data = body;
    refreshSeconds = body.refreshSeconds || refreshSeconds;
    lastSuccess = now();
    failingSince = 0;
  } catch (err) {
    console.warn('Abruf fehlgeschlagen', err);
    failingSince ||= Date.now();
  } finally {
    loading = false;
  }
  render();
  renderStatus();
  // Nach Fehlern schneller erneut versuchen, aber nicht häufiger als alle 5 s.
  schedule(failingSince ? Math.min(refreshSeconds, 5 + Math.floor((Date.now() - failingSince) / 10_000)) * 1000 : refreshSeconds * 1000);
}

// Sicherheitsnetz: Falls der Timer einmal hängen bleibt (Tablet schläft, Browser drosselt),
// stößt der Watchdog den Abruf wieder an.
setInterval(() => {
  if (!loading && Date.now() - lastAttempt > refreshSeconds * 2 * 1000) refresh();
}, 15_000);

function tick() {
  clockEl.textContent = fmtTime.format(now());
}

// Bildschirm wach halten (Kiosk). Nur in sicherem Kontext (HTTPS/localhost) verfügbar.
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {
    /* nicht unterstützt oder verweigert */
  }
}

function wakeUp() {
  keepAwake();
  if (document.visibilityState === 'visible') refresh();
}

document.addEventListener('visibilitychange', wakeUp);
window.addEventListener('online', wakeUp);
window.addEventListener('pageshow', wakeUp);
window.addEventListener('focus', wakeUp);
window.addEventListener('resize', trimOverflow);

// Gleiche Grenze wie in styles.css: Handys scrollen und gehen nicht ungefragt in den Vollbildmodus.
const compact = matchMedia('(max-width: 640px), (max-height: 520px)');

document.addEventListener('click', () => {
  keepAwake();
  if (!compact.matches && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Einmal pro Nacht neu laden (Speicher, Browser-Zustand) – aber nur, wenn der Server
// erreichbar ist, damit das Tablet nicht auf einer Fehlerseite hängen bleibt.
async function nightlyReload() {
  try {
    const res = await fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (res.ok) return location.reload();
  } catch {
    /* später erneut */
  }
  setTimeout(nightlyReload, 5 * MINUTE);
}
const tonight = new Date();
tonight.setHours(24, 3 + Math.floor(Math.random() * 10), 0, 0);
setTimeout(nightlyReload, tonight - Date.now());

tick();
setInterval(tick, 1000);
setInterval(() => {
  render();
  renderStatus();
}, 5000);
keepAwake();
refresh();
