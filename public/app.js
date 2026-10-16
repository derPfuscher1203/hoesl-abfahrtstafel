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

const board = document.getElementById('board');
const statusEl = document.getElementById('status');
const clockEl = document.getElementById('clock');
const tpl = document.getElementById('station-tpl');

let data = null;
let refreshSeconds = 30;
let lastSuccess = 0;

const fmtTime = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
const fmtClock = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin' });

function minutesUntil(ts) {
  return Math.floor((ts - Date.now()) / 60_000);
}

function renderTime(dep) {
  const el = document.createElement('div');
  el.className = 'time';
  const min = minutesUntil(dep.departureTime);
  if (dep.cancelled) {
    el.textContent = 'fällt aus';
  } else if (min <= 0) {
    el.textContent = 'jetzt';
    el.classList.add('now');
  } else if (min < 60) {
    el.textContent = `${min} min`;
  } else {
    el.textContent = fmtTime.format(dep.departureTime);
  }
  if (!dep.cancelled && dep.delayMinutes > 0) {
    const d = document.createElement('span');
    d.className = 'delay';
    d.textContent = `+${dep.delayMinutes} · ${fmtTime.format(dep.plannedTime)}`;
    el.append(d);
  }
  return el;
}

function renderDeparture(dep) {
  const li = document.createElement('li');
  li.className = 'dep' + (dep.cancelled ? ' cancelled' : '');

  const badge = document.createElement('span');
  badge.className = 'badge ' + (dep.transportType === 'SBAHN' ? 'sbahn' : 'ubahn');
  badge.textContent = dep.line;
  badge.style.background = LINE_COLORS[dep.line] || '#555';

  const dest = document.createElement('div');
  dest.className = 'dest';
  dest.textContent = dep.destination;
  if (dep.sev) {
    const s = document.createElement('small');
    s.textContent = 'Schienenersatzverkehr';
    dest.append(s);
  }

  li.append(badge, dest, renderTime(dep));
  return li;
}

function render() {
  if (!data) return;
  const sections = data.stations.map((station) => {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.station-name').textContent = station.name;
    if (station.error) {
      const note = node.querySelector('.station-note');
      note.hidden = false;
      note.textContent = station.error;
    }
    const list = node.querySelector('.departures');
    // Abgefahrene Züge ausblenden, auch zwischen zwei Abrufen.
    const upcoming = station.departures.filter((d) => d.departureTime > Date.now() - 30_000);
    if (upcoming.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = station.error ? 'Keine Daten' : 'Keine Abfahrten in nächster Zeit';
      list.append(li);
    } else {
      list.append(...upcoming.map(renderDeparture));
    }
    return node;
  });
  board.replaceChildren(...sections);
}

function renderStatus() {
  const footer = statusEl.parentElement;
  const age = (Date.now() - lastSuccess) / 1000;
  const offline = !lastSuccess || age > refreshSeconds * 3;
  footer.classList.toggle('error', offline);
  if (!lastSuccess) {
    statusEl.textContent = 'Keine Verbindung zum Server';
  } else {
    statusEl.textContent = `${offline ? 'Verbindung gestört · ' : ''}Stand ${fmtClock.format(lastSuccess)}`;
  }
}

async function refresh() {
  try {
    const res = await fetch('/api/departures', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    refreshSeconds = data.refreshSeconds || refreshSeconds;
    lastSuccess = Date.now();
  } catch (err) {
    console.warn('Abruf fehlgeschlagen', err);
  }
  render();
  renderStatus();
  setTimeout(refresh, refreshSeconds * 1000);
}

function tick() {
  clockEl.textContent = fmtTime.format(Date.now());
}

// Bildschirm wach halten (Kiosk). Muss nach Sichtbarkeitswechsel neu angefordert werden.
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      await navigator.wakeLock.request('screen');
    }
  } catch {
    /* nicht unterstützt oder verweigert */
  }
}

document.addEventListener('visibilitychange', () => {
  keepAwake();
  if (document.visibilityState === 'visible') render();
});

document.addEventListener('click', () => {
  keepAwake();
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Sicherheitsnetz für Dauerbetrieb: einmal nachts neu laden (Speicher, App-Updates).
setTimeout(() => location.reload(), (() => {
  const next = new Date();
  next.setHours(24, 3 + Math.floor(Math.random() * 10), 0, 0);
  return next - Date.now();
})());

tick();
setInterval(tick, 1000);
setInterval(() => {
  render();
  renderStatus();
}, 10_000);
keepAwake();
refresh();
