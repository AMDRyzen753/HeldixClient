// HeldixClient – Webseite: Heldix+ (/plus) – geplant, mit Warteliste (Heldix-Dienst ab 1.13.0).
//
// Angemeldet (Cookie): GET /api/v1/plus → { waitlist: { since } | null, granted, team, count } und eintragen bzw.
// austragen mit PUT/DELETE /v1/plus/waitlist. Ohne Anmeldung führt „Im Konto anmelden“ zum Konto (nach der
// Anmeldung kommt man mit #ziel=plus hierher zurück). Die Zahl der Einträge (GET /v1/public/plus → { count }) zeigt die Seite erst ab 50
// (darunter liefert der Dienst null). Bezahlt wird nichts.
import { api, busy, confirmAction, formatDate, toast } from './app-common.js';
import { publicGet } from './public-cards.js';

const $ = (id) => document.getElementById(id);
const NUMBER = new Intl.NumberFormat('de-DE');
const ICONS = { on: 'check', off: 'info', wait: 'clock' };

function setStand(kind, text) {
  const stand = $('plus-stand');
  stand.classList.toggle('is-on', kind === 'on');
  const template = document.getElementById('icons');
  const svg = template?.content.querySelector(`[data-icon="${ICONS[kind] ?? 'info'}"] svg`)?.cloneNode(true);
  stand.replaceChildren(...[svg, Object.assign(document.createElement('span'), { id: 'plus-stand-text', textContent: text })].filter(Boolean));
}

function setCount(count) {
  const box = $('plus-zahl');
  box.hidden = !Number.isFinite(count);
  if (Number.isFinite(count)) box.textContent = `Schon ${NUMBER.format(count)} Spieler auf der Warteliste.`;
}

function show(buttons) {
  for (const id of ['plus-anmelden', 'plus-eintragen', 'plus-austragen', 'plus-konto']) $(id).hidden = !buttons.includes(id);
}

function render(data) {
  setCount(data?.count);
  if (data?.team) {
    setStand('on', 'Als Team-Mitglied kannst du dauerhafte Welten schon nutzen.');
    show(['plus-konto']);
    return;
  }
  if (data?.granted) {
    setStand('on', 'Du bist für die Beta „Dauerhafte Welten“ freigeschaltet – stell eine Welt im Konto dauerhaft online.');
    show(['plus-konto']);
    return;
  }
  if (data?.waitlist?.since) {
    setStand('on', `Du stehst seit ${formatDate(data.waitlist.since)} auf der Warteliste.`);
    show(['plus-austragen']);
    return;
  }
  setStand('off', 'Du stehst noch nicht auf der Warteliste.');
  show(['plus-eintragen']);
}

async function load() {
  try {
    render(await api('GET', '/v1/plus'));
  } catch (error) {
    if (error.status === 401) {
      setStand('wait', 'Zum Eintragen meldest du dich mit deinem Minecraft-Konto an – ohne Passwort.');
      show(['plus-anmelden']);
      try {
        setCount((await publicGet('/v1/public/plus'))?.count);
      } catch {
        setCount(null);
      }
      return;
    }
    if (error.status === 404) {
      setStand('wait', 'Die Warteliste startet in Kürze.');
      show([]);
      return;
    }
    setStand('wait', 'Der Heldix-Dienst ist gerade nicht erreichbar. Versuch es gleich noch einmal.');
    show([]);
  }
}

$('plus-eintragen').addEventListener('click', async (event) => {
  try {
    render(await busy(event.currentTarget, () => api('PUT', '/v1/plus/waitlist')));
    toast('Du stehst auf der Warteliste. Wir melden uns über die Glocke im Launcher, im Konto und im Spiel.', 'success');
  } catch (error) {
    if (error.status === 401) return load();
    toast(error.message, 'error');
  }
});

$('plus-austragen').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const ok = await confirmAction({ title: 'Von der Warteliste nehmen?', text: 'Dein Platz geht dabei verloren. Eintragen kannst du dich jederzeit wieder – dann zählt der neue Zeitpunkt.', confirmLabel: 'Austragen' });
  if (!ok) return;
  try {
    render(await busy(button, () => api('DELETE', '/v1/plus/waitlist')));
    toast('Du stehst nicht mehr auf der Warteliste.');
  } catch (error) {
    if (error.status === 401) return load();
    toast(error.message, 'error');
  }
});

load();
