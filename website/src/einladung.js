// HeldixClient – Webseite: Einladung (/einladung#<code>).
//
// GET /api/v1/public/invites/<code> (ohne Anmeldung): Wer lädt ein, Server, Voice-Gruppe, Ablauf, Willkommens-Belohnung.
// Angezeigt werden Kopf und Name des Einladenden, der Server und die Belohnung (Vorschau aus dem Cosmetics-Katalog) und
// je nach Lage:
// - „Einladung annehmen“: angemeldet → POST /api/v1/invites/<code>/accept und das Ergebnis (Freund hinzugefügt,
//   Belohnung freigeschaltet, nicht neu → nur Freundschaft). Nicht angemeldet → „Mit Minecraft-Konto annehmen“: Code in
//   sessionStorage merken, Anmeldung über den Dienst (zurück kommt der Browser nach /konto, konto.js leitet hierher
//   zurück), danach wird automatisch angenommen.
// - „Im Browser mitreden“ (nur bei Einladungen mit Voice-Gruppe): voice-panel.js.
// - „HeldixClient herunterladen“ und „Im Launcher öffnen“ (heldixclient://einladung/<code>). Unter Windows lädt der
//   Knopf direkt den Installer mit der Einladung: https://<API>/v1/launcher/download/latest/windows?einladung=<code>
//   (wie die Knöpfe der Download-Seite, download.js). Der Dienst nennt die Datei dann
//   HeldixClient-Setup-<version>-einladung-<code>.exe, der Installer legt den Code für den Launcher ab, und nach der
//   Installation öffnet sich die Einladung von selbst. Andere Systeme: zur Download-Seite wie bisher.
// Abgelaufen oder unbekannt (404): freundliche Meldung mit Download. Der Code steht nur hinter dem # der Adresse.
import { ApiError, api, avatar, busy, copyText, formatDateTime, h, icon, toast } from './app-common.js';
import { loginErrorText, minecraftLoginAvailable, minecraftLoginHref } from './anmelden.js';
import { codeFromHash, forgetInvite, inviteAppLink, inviteWebLink, pendingInvite, rememberInvite, rewardInfo, rewardPreview, SLOT_LABELS, wearHref } from './einladung-common.js';
import { publicGet } from './public-cards.js';
import { detectSystem } from './system.js';
import { mountVoicePanel } from './voice-panel.js';

const $ = (id) => document.getElementById(id);
const page = document.querySelector('.invite-page');
const apiBase = page.dataset.apiBase;
const UUID_RE = /^[0-9a-f]{32}$/;
/** Welches System der Besucher hat (einmal ermittelt) */
let systemPromise = null;

const state = {
  code: null,
  invite: null,
  me: null,
  accepted: null,
  voice: null,
};

function show(view) {
  page.dataset.zustand = view;
  $('einladung-laden').hidden = view !== 'laden';
  $('einladung-weg').hidden = view !== 'weg';
  $('einladung-fehler').hidden = view !== 'fehler';
  $('einladung').hidden = view !== 'einladung';
}

function showGone(kind) {
  const title = $('einladung-weg-titel');
  const text = $('einladung-weg-text');
  if (kind === 'ohne-code') {
    title.textContent = 'Hier fehlt der Einladungs-Code';
    text.textContent = 'Ein Einladungs-Link sieht so aus: heldixclient.com/einladung#abc23def45. Prüf, ob der Link vollständig ist – oder lade HeldixClient einfach so herunter. Freunde einladen kannst du selbst im Konto unter Freunde.';
  } else {
    title.textContent = 'Diese Einladung gilt nicht mehr';
    text.textContent = 'Einladungen gelten 30 Tage, mit Voice-Gruppe 24 Stunden – oder der Link wurde zurückgezogen. Frag einfach nach einem neuen. HeldixClient kannst du trotzdem gleich holen.';
  }
  document.title = 'Einladung – HeldixClient';
  show('weg');
}

// ---------------------------------------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------------------------------------

/** Öffentliche Einladung prüfen: Form wie im Dienst, Texte nur als Text. */
function normalizeInvite(data) {
  if (!data || typeof data !== 'object' || !data.inviter || typeof data.inviter.name !== 'string') return null;
  const voice = data.voice && typeof data.voice === 'object' ? { members: Number(data.voice.members) || 0, guests: Number(data.voice.guests) || 0, maxGuests: Number(data.voice.maxGuests) || 4 } : null;
  return {
    code: state.code,
    inviter: { uuid: UUID_RE.test(data.inviter.uuid ?? '') ? data.inviter.uuid : null, name: data.inviter.name.slice(0, 32) },
    server: typeof data.server === 'string' && data.server ? data.server.slice(0, 255) : null,
    voice,
    expires: Number.isFinite(data.expires) ? data.expires : null,
    welcome: typeof data.welcome === 'string' && data.welcome ? data.welcome : null,
  };
}

async function loadMe() {
  try {
    return await api('GET', '/v1/web/me');
  } catch {
    return null;
  }
}

async function start() {
  state.code = codeFromHash();
  const pending = pendingInvite();
  if (!state.code) {
    // Kein Code in der Adresse – vielleicht kommt der Browser gerade von der Anmeldung zurück
    if (pending) {
      history.replaceState(null, '', `/einladung#${pending.code}`);
      state.code = pending.code;
    } else return showGone('ohne-code');
  }
  show('laden');
  $('einladung-fehler-app').href = inviteAppLink(state.code);
  let data;
  const mePromise = loadMe();
  try {
    data = await publicGet(`/v1/public/invites/${state.code}`);
  } catch (error) {
    if (error.status === 404) {
      if (pending?.code === state.code) forgetInvite();
      return showGone('abgelaufen');
    }
    $('einladung-fehler-text').textContent =
      error.status === 429 ? 'Zu viele Anfragen von deinem Netz. Warte eine Minute und versuch es dann noch einmal.' : 'Der Heldix-Dienst antwortet gerade nicht. Versuch es in ein paar Minuten noch einmal – im Launcher klappt es auch.';
    return show('fehler');
  }
  const invite = normalizeInvite(data);
  if (!invite) return showGone('abgelaufen');
  state.invite = invite;
  state.me = await mePromise;
  render();
  show('einladung');

  // Zurück von der Anmeldung: Fehler zeigen oder gleich annehmen (nur einmal)
  if (pending?.code === state.code) {
    forgetInvite();
    if (pending.fehler) notice(loginErrorText(pending.fehler));
    else if (pending.accept && state.me && !isOwn()) accept($('einladung-annehmen'));
  }
}

// ---------------------------------------------------------------------------------------------------------
// Anzeigen
// ---------------------------------------------------------------------------------------------------------

const isOwn = () => Boolean(state.me && state.invite.inviter.uuid && state.me.uuid === state.invite.inviter.uuid);

function notice(text) {
  const box = $('einladung-hinweis');
  box.textContent = text || '';
  box.hidden = !text;
}

function render() {
  const { invite, me } = state;
  const own = isOwn();
  document.title = own ? 'Deine Einladung – HeldixClient' : `${invite.inviter.name} lädt dich ein – HeldixClient`;
  // Kopf: über die Anmeldung (eigener Kopf, Freunde) bzw. öffentlich (Team); sonst Initialen
  $('einladung-kopf').replaceChildren(avatar(invite.inviter.name, invite.inviter.uuid, { size: 'xl', skin: me ? 'auth' : 'public' }));
  $('einladung-titel').textContent = own ? 'Deine Einladung' : `${invite.inviter.name} lädt dich zu HeldixClient ein`;
  $('einladung-server').hidden = !invite.server;
  $('einladung-server-name').textContent = invite.server ?? '';
  $('einladung-app-server').hidden = !invite.server;
  $('einladung-ablauf').textContent = invite.expires ? `Gültig bis ${formatDateTime(invite.expires)}` : '';
  $('einladung-app').href = inviteAppLink(state.code);
  renderActions();
  renderReward();
  renderDownload();
  if (invite.voice) $('einladung-voice-knopf').hidden = false;
}

/** Windows: „HeldixClient herunterladen“ lädt den Installer mit der Einladung im Namen; sonst die Download-Seite */
async function renderDownload() {
  const link = $('einladung-download');
  const hint = $('einladung-download-hinweis');
  const code = state.code;
  link.href = '/download';
  link.querySelector('span').textContent = 'HeldixClient herunterladen';
  hint.hidden = true;
  delete page.dataset.download;
  if (!code || !apiBase) return;
  systemPromise ??= detectSystem().catch(() => ({ os: 'andere' }));
  const system = await systemPromise;
  if (system.os !== 'windows' || state.code !== code) return;
  link.href = `${apiBase}/v1/launcher/download/latest/windows?einladung=${encodeURIComponent(code)}`;
  link.querySelector('span').textContent = 'HeldixClient für Windows herunterladen';
  hint.hidden = false;
  page.dataset.download = 'windows-einladung';
}

function renderActions() {
  const own = isOwn();
  const accept = $('einladung-annehmen');
  const login = $('einladung-anmelden');
  const loginHint = $('einladung-anmelden-hinweis');
  const noLogin = $('einladung-ohne-anmeldung');
  accept.hidden = true;
  login.hidden = true;
  loginHint.hidden = true;
  noLogin.hidden = true;
  if (state.accepted) return;
  if (own) {
    notice('');
    const box = $('einladung-ergebnis');
    const copy = h('button', { type: 'button', class: 'button small', id: 'einladung-kopieren' }, icon('copy'), 'Link kopieren');
    copy.addEventListener('click', async () => {
      const ok = await copyText(inviteWebLink(state.code));
      toast(ok ? 'Einladungs-Link kopiert.' : 'Kopieren ging nicht – markier den Link in der Adresszeile.', ok ? 'success' : 'error');
    });
    box.replaceChildren(
      h('div', { class: 'invite-result-head' }, icon('info'), h('strong', { text: 'So sehen deine Freunde deine Einladung.' })),
      h('p', { text: 'Schick ihnen diesen Link. Wer neu ist und die Einladung annimmt, bekommt die Willkommens-Belohnung; spielt er 30 Minuten mit HeldixClient, zählt er für deine Belohnungen. Deine Einladungen verwaltest du im Konto unter Freunde.' }),
      h('div', { class: 'invite-result-actions' }, copy, h('a', { class: 'button small ghost', href: '/konto#reiter=freunde&teil=einladen' }, icon('friends'), 'Freunde einladen')),
    );
    box.hidden = false;
    return;
  }
  if (state.me) {
    accept.hidden = false;
    accept.querySelector('span').textContent = `Als ${state.me.name} annehmen`;
    return;
  }
  minecraftLoginAvailable().then((ok) => {
    if (state.me || state.accepted) return;
    login.hidden = !ok;
    loginHint.hidden = !ok;
    noLogin.hidden = ok;
    login.href = minecraftLoginHref('freunde');
    page.dataset.minecraftLogin = ok ? 'an' : 'aus';
  });
}

async function renderReward() {
  const id = state.invite.welcome;
  const card = $('einladung-belohnung');
  card.hidden = !id;
  if (!id) return;
  const known = rewardInfo(id);
  $('belohnung-titel').textContent = known.name;
  const reward = await rewardPreview(id, 160);
  if (!reward) return;
  $('belohnung-titel').textContent = reward.name;
  const slot = reward.slot ? SLOT_LABELS[reward.slot] : null;
  $('belohnung-text').textContent = `Neu bei HeldixClient? Nimm die Einladung an, und ${slot ? `${slot === 'Aura' ? 'die Aura' : slot === 'Cape' ? 'das Cape' : 'das Cosmetic'} ` : ''}„${reward.name}“ gehört dir – andere HeldixClient-Spieler sehen ${slot === 'Aura' ? 'sie' : 'es'} an dir, ganz ohne etwas zu installieren.`;
  if (reward.image) $('belohnung-bild').replaceChildren(h('img', { src: reward.image, alt: '', width: '160', height: '160' }));
  card.dataset.vorschau = reward.image ? 'ja' : 'nein';
}

// ---------------------------------------------------------------------------------------------------------
// Annehmen
// ---------------------------------------------------------------------------------------------------------

const FRIEND_TEXTS = {
  new: (name) => [`Ihr seid jetzt Freunde!`, `Du und ${name} seht euch ab jetzt in der Freundesliste – im Launcher, im Spiel und im Konto. Ihr seht, wo der andere spielt, und könnt euch Nachrichten schreiben.`],
  already: (name) => ['Ihr seid schon befreundet.', `${name} steht schon in deiner Freundesliste.`],
  blocked: (name) => ['Eine Freundschaft ist nicht möglich.', `Mit ${name} kann der Heldix-Dienst keine Freundschaft herstellen.`],
  limit: (name) => ['Die Freundesliste ist voll.', `Du oder ${name} habt schon die höchste Zahl an Freunden. Entfernt erst jemanden, dann klappt es.`],
  self: () => ['Das ist deine eigene Einladung.', 'Schick den Link an Freunde – sie nehmen ihn an, nicht du.'],
};
const REWARD_REASON_TEXTS = {
  'not-new': 'Die Willkommens-Belohnung gibt es nur für neue Spieler – dein Konto beim Heldix-Dienst ist älter als 14 Tage.',
  'already-invited': 'Die Willkommens-Belohnung gibt es nur bei der ersten Einladung – du wurdest schon einmal eingeladen.',
};

async function accept(button) {
  notice('');
  // Nicht angemeldet (z. B. abgelaufen): zur Anmeldung, danach geht es hier weiter
  if (!state.me) return;
  try {
    const result = await busy(button, () => api('POST', `/v1/invites/${state.code}/accept`));
    showResult(result ?? {});
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.me = null;
      renderActions();
      notice('Deine Anmeldung ist abgelaufen. Melde dich noch einmal an, um die Einladung anzunehmen.');
      return;
    }
    if (error instanceof ApiError && error.status === 404) return showGone('abgelaufen');
    // Eigene Einladung: 400 mit code SELF (der Dienst schickt dazu friend: 'self')
    if (error instanceof ApiError && error.status === 400 && error.code === 'SELF') return showResult({ friend: 'self', reward: null, rewardReason: 'self' });
    notice(error?.message || 'Das Annehmen hat nicht geklappt. Bitte versuch es noch einmal.');
  }
}

function showResult(result) {
  const name = result.inviter && typeof result.inviter.name === 'string' ? result.inviter.name : state.invite.inviter.name;
  const friend = FRIEND_TEXTS[result.friend] ? result.friend : 'new';
  state.accepted = result;
  page.dataset.angenommen = friend;
  const [title, text] = FRIEND_TEXTS[friend](name);
  const ok = friend === 'new' || friend === 'already';
  const parts = [h('div', { class: `invite-result-head${ok ? ' ok' : ''}` }, icon(ok ? 'check' : 'info'), h('strong', { text: title })), h('p', { text })];
  const reward = typeof result.reward === 'string' && result.reward ? result.reward : null;
  if (reward) {
    const info = rewardInfo(reward);
    const box = h(
      'div',
      { class: 'invite-unlocked', id: 'einladung-freigeschaltet', dataset: { cosmetic: reward } },
      h('span', { class: 'invite-unlocked-art', 'aria-hidden': 'true' }, icon('sparkles')),
      h(
        'div',
        null,
        h('strong', { class: 'invite-unlocked-title', text: `Freigeschaltet: ${info.name}` }),
        h('p', { class: 'invite-unlocked-text', text: 'Deine Willkommens-Belohnung gehört jetzt dir. Wähle sie im Konto unter Profil & Cosmetics, im Launcher oder im Spiel – andere HeldixClient-Spieler sehen sie dann an dir.' }),
        h('a', { class: 'button small', href: wearHref(info.slot) }, icon('cape'), 'Jetzt tragen'),
      ),
    );
    parts.push(box);
    rewardPreview(reward, 96).then((preview) => {
      if (!preview) return;
      box.querySelector('.invite-unlocked-title').textContent = `Freigeschaltet: ${preview.name}`;
      box.querySelector('a').href = wearHref(preview.slot);
      if (preview.image) box.querySelector('.invite-unlocked-art').replaceChildren(h('img', { src: preview.image, alt: '', width: '96', height: '96' }));
    });
    parts.push(h('p', { class: 'hint', text: `Spielst du insgesamt 30 Minuten mit HeldixClient, zählt die Einladung auch für ${name} – dafür gibt es dort ebenfalls Belohnungen.` }));
  } else if (REWARD_REASON_TEXTS[result.rewardReason]) {
    parts.push(h('p', { class: 'hint', id: 'einladung-ohne-belohnung', text: REWARD_REASON_TEXTS[result.rewardReason] }));
  }
  const server = typeof result.server === 'string' && result.server ? result.server : state.invite.server;
  const actions = [];
  if (server && friend !== 'self') actions.push(h('a', { class: 'button small', href: inviteAppLink(state.code) }, icon('play'), `Im Launcher öffnen und ${server} beitreten`));
  actions.push(h('a', { class: 'button small ghost', href: '/konto#reiter=freunde' }, icon('friends'), 'Zur Freundesliste'));
  parts.push(h('div', { class: 'invite-result-actions' }, actions));
  const box = $('einladung-ergebnis');
  box.replaceChildren(...parts);
  box.hidden = false;
  renderActions();
}

// ---------------------------------------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------------------------------------

async function openVoice() {
  const section = $('voice');
  if (!state.voice) {
    const names = [];
    if (state.invite.inviter.uuid) names.push([state.invite.inviter.uuid, state.invite.inviter.name]);
    if (state.me) names.push([state.me.uuid, state.me.name]);
    state.voice = mountVoicePanel(section, {
      code: state.code,
      invite: state.invite,
      me: state.me,
      names,
      onChange: (mode) => {
        page.dataset.voice = mode;
      },
    });
    // Namen der Freunde für die Liste (angemeldet)
    if (state.me) {
      api('GET', '/v1/friends')
        .then((data) => state.voice?.addNames((Array.isArray(data?.friends) ? data.friends : []).filter((friend) => UUID_RE.test(friend.uuid ?? '') && typeof friend.name === 'string').map((friend) => [friend.uuid, friend.name])))
        .catch(() => {});
    }
  }
  section.hidden = false;
  section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  section.querySelector('input, button')?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------------------

$('einladung-annehmen').addEventListener('click', (event) => accept(event.currentTarget));
$('einladung-anmelden').addEventListener('click', () => {
  // Der Hash geht beim Umweg über Microsoft verloren: Code für diesen Tab merken
  rememberInvite(state.code, { accept: true });
});
$('einladung-voice-knopf').addEventListener('click', openVoice);
$('einladung-erneut').addEventListener('click', start);
window.addEventListener('hashchange', () => {
  const next = codeFromHash();
  if (next && next !== state.code) {
    if (state.voice?.active) return;
    state.accepted = null;
    state.voice = null;
    $('voice').hidden = true;
    $('voice').replaceChildren();
    $('einladung-ergebnis').hidden = true;
    start();
  }
});
start();
