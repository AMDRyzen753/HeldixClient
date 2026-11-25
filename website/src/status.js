// HeldixClient – Webseite: Statusseite (/status). Fragt GET /api/v1/status alle 30 Sekunden (nur sichtbar) und
// zeigt Summen: Dienst online/gestört, Spieler online und insgesamt, Launcher-Version, Laufzeit.
import { formatDateTime, icon, poller } from './app-common.js';

const NUMBER = new Intl.NumberFormat('de-DE');
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const $ = (id) => document.getElementById(id);
let lastGood = null;

/** „3 Tage, 4 Stunden“ – grob genug für eine Laufzeit. */
function duration(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const unit = (value, one, many) => `${value} ${value === 1 ? one : many}`;
  if (days) return hours ? `${unit(days, 'Tag', 'Tagen')}, ${unit(hours, 'Stunde', 'Stunden')}` : unit(days, 'Tag', 'Tagen');
  if (hours) return rest ? `${unit(hours, 'Stunde', 'Stunden')}, ${unit(rest, 'Minute', 'Minuten')}` : unit(hours, 'Stunde', 'Stunden');
  return minutes ? unit(minutes, 'Minute', 'Minuten') : 'gerade gestartet';
}

function setHero(state, title, line) {
  const hero = $('status-hero');
  hero.dataset.state = state;
  $('status-titel').textContent = title;
  $('status-zeile').textContent = line;
  $('status-icon').replaceChildren(icon(state === 'online' ? 'check' : 'warning'));
}

function show(data) {
  const online = Boolean(data?.ok);
  $('wert-dienst').textContent = online ? 'Online' : 'Gestört';
  $('wert-dienst').dataset.state = online ? 'online' : 'offline';
  $('wert-dienst-version').textContent = typeof data?.service === 'string' && data.service ? `Version ${data.service}` : '';
  $('wert-online').textContent = Number.isFinite(data?.online) ? NUMBER.format(data.online) : '–';
  $('wert-spieler').textContent = Number.isFinite(data?.players) ? NUMBER.format(data.players) : '–';
  $('wert-launcher').textContent = typeof data?.launcher === 'string' && data.launcher ? data.launcher : 'noch keine';
  if (Number.isFinite(data?.since)) {
    $('wert-seit').textContent = duration(Date.now() - data.since);
    $('wert-seit-datum').textContent = `seit ${formatDateTime(data.since)}`;
  } else {
    $('wert-seit').textContent = '–';
    $('wert-seit-datum').textContent = '';
  }
}

async function check() {
  $('status-werte').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/v1/status', { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(String(response.status));
    lastGood = Date.now();
    show(data);
    $('status-werte').classList.remove('stale');
    if (data.ok) setHero('online', 'Alles läuft', `Freunde, Nachrichten und Capes funktionieren. Geprüft um ${TIME.format(Date.now())} Uhr.`);
    else setHero('offline', 'Der Heldix-Dienst ist gestört', `Freunde, Nachrichten und Capes können gerade ausfallen. Geprüft um ${TIME.format(Date.now())} Uhr.`);
  } catch {
    setHero(
      'offline',
      'Der Heldix-Dienst ist gerade nicht erreichbar',
      `Freunde, Nachrichten und Capes funktionieren im Moment nicht; das Spiel selbst läuft weiter. Wir versuchen es alle 30 Sekunden erneut${lastGood ? ` – zuletzt erreichbar um ${TIME.format(lastGood)} Uhr` : ''}.`,
    );
    $('wert-dienst').textContent = 'Gestört';
    $('wert-dienst').dataset.state = 'offline';
    $('status-werte').classList.toggle('stale', Boolean(lastGood));
    if (!lastGood) for (const id of ['wert-online', 'wert-spieler', 'wert-launcher', 'wert-seit']) $(id).textContent = '–';
  } finally {
    $('status-werte').setAttribute('aria-busy', 'false');
  }
}

const refresh = poller(check, 30_000);
$('status-neu').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  await check();
  button.disabled = false;
});
check();
refresh.start();
