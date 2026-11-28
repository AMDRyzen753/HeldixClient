// HeldixClient – Webseite: eine geteilte Welt (/welt#<code>).
// GET /api/v1/public/worlds/<code> → { name, address, host: { uuid, name }, online, players, maxPlayers, version, access }
// (öffentlich, ohne Anmeldung). Der Code steht hinter dem #, landet also nicht in Server-Protokollen.
// „Mit HeldixClient beitreten“ öffnet heldixclient://welt/<code>; ohne HeldixClient hilft die Adresse.
// Der Kopf des Gastgebers kommt vom Heldix-Dienst (/api/v1/public/heads/<uuid>.png), nie von Mojang.
import { copyText, toast } from './app-common.js';

const CODE = /^[a-hjkmnp-z2-9]{6}$/;
const page = document.getElementById('welt');
const $ = (id) => document.getElementById(id);

function readCode() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim().toLowerCase();
  // Auch ganze Adressen („k7m2xq.welt.heldixclient.com“) und „code=…“ annehmen
  const code = raw.replace(/^code=/, '').split('.')[0];
  return CODE.test(code) ? code : null;
}

function setState(state) {
  page.dataset.zustand = state;
  page.setAttribute('aria-busy', String(state === 'laden'));
  const failed = state === 'fehlt' || state === 'fehler' || state === 'ohne-code';
  $('welt-karte').hidden = failed;
  $('welt-fehler').hidden = !failed;
}

function showError(state, title, text, retry = false) {
  setState(state);
  $('welt-fehler-titel').textContent = title;
  $('welt-fehler-text').textContent = text;
  $('welt-erneut').hidden = !retry;
  document.title = `${title} – HeldixClient`;
}

function show(code, world) {
  const host = typeof world.host?.name === 'string' && world.host.name ? world.host.name : 'unbekannt';
  const online = world.online === true;
  const name = typeof world.name === 'string' && world.name ? world.name : `Welt von ${host}`;
  $('welt-name').textContent = name;
  $('welt-gastgeber-name').textContent = host;
  document.title = `${name} – HeldixClient`;

  const status = $('welt-status');
  status.dataset.status = online ? 'online' : 'offline';
  status.className = `chip chip--lg ${online ? 'chip--online' : ''}`.trim();
  status.querySelector('.dot').className = online ? 'dot dot--online' : 'dot';
  status.querySelector('span:last-child').textContent = online ? 'Gerade geöffnet' : 'Gerade nicht geöffnet';

  const players = Number.isFinite(world.players) ? world.players : 0;
  const max = Number.isFinite(world.maxPlayers) ? world.maxPlayers : null;
  $('welt-spieler').textContent = online ? (max ? `${players} von ${max}` : String(players)) : max ? `bis zu ${max}` : '–';
  $('welt-version').textContent = typeof world.version === 'string' && world.version ? world.version : 'unbekannt';
  $('welt-zugang').textContent = world.access === 'open' ? 'Jeder mit der Adresse' : 'Nur auf Einladung';

  const hint = $('welt-hinweis');
  const full = online && max !== null && players >= max;
  if (!online) hint.textContent = `${host} teilt die Welt gerade nicht. Sobald sie wieder geöffnet ist, kommst du mit demselben Link und derselben Adresse hinein.`;
  else if (full) hint.textContent = `Die Welt ist gerade voll (höchstens ${max} Spieler). Versuch es etwas später noch einmal.`;
  else if (world.access !== 'open') hint.textContent = `Nur Eingeladene kommen direkt hinein. Bist du nicht eingeladen, klopfst du beim Beitreten an – ${host} wird im Spiel gefragt.`;
  else hint.textContent = '';
  hint.hidden = !hint.textContent;

  const address = typeof world.address === 'string' && world.address ? world.address : null;
  $('welt-adresse').textContent = address ?? code;
  $('welt-adresse-box').hidden = !address;
  $('welt-kopieren').onclick = async () => {
    const ok = await copyText(address ?? code);
    toast(ok ? 'Adresse kopiert – in Minecraft unter Mehrspieler → Server hinzufügen einfügen.' : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
  };
  $('welt-beitreten').href = `heldixclient://welt/${code}`;

  const head = $('welt-kopf');
  head.alt = `Kopf von ${host}`;
  if (typeof world.host?.uuid === 'string' && /^[0-9a-f]{32}$/.test(world.host.uuid)) {
    head.addEventListener('error', () => head.setAttribute('src', '/assets/standard-kopf.svg'), { once: true });
    head.src = `/api/v1/public/heads/${world.host.uuid}.png?size=64`;
  }
  setState('ok');
}

async function load() {
  const code = readCode();
  if (!code) {
    showError('ohne-code', 'Kein Welt-Link', 'Öffne den Link, den du vom Gastgeber bekommen hast – er sieht aus wie heldixclient.com/welt#k7m2xq.');
    return;
  }
  setState('laden');
  try {
    const response = await fetch(`/api/v1/public/worlds/${code}`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
    if (response.status === 404) {
      showError('fehlt', 'Diese Welt gibt es nicht', 'Prüf den Link – vielleicht hat der Gastgeber die Welt gelöscht.');
      return;
    }
    const data = await response.json().catch(() => null);
    if (response.status === 503) {
      showError('fehler', 'Welt teilen ist gerade nicht verfügbar', typeof data?.error === 'string' ? data.error : 'Versuch es später noch einmal.', true);
      return;
    }
    if (!response.ok || !data || typeof data !== 'object') throw new Error(String(response.status));
    show(code, data);
  } catch {
    showError('fehler', 'Gerade nicht erreichbar', 'Die Angaben zur Welt konnten nicht geladen werden. Versuch es gleich noch einmal.', true);
  }
}

$('welt-erneut').addEventListener('click', load);
window.addEventListener('hashchange', load);
load();
