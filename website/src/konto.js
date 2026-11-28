// HeldixClient – Webseite: Konto-Bereich (/konto). Anmeldung per Einmal-Link aus Launcher oder Spiel (#code=…) oder
// mit dem Minecraft-Konto (anmelden.js: Knopf zum Dienst, zurück mit #code=… oder #fehler=<code>), danach:
//
//   Übersicht (Dashboard) und Glocke ........ konto-uebersicht.js
//   Freunde, Profilkarte, Vorschläge ......... konto-freunde.js
//   Nachrichten (Antworten, Reaktionen …) .... konto-chat.js
//   Party und Party-Chat ..................... konto-party.js
//   Freunde einladen ......................... konto-einladungen.js
//   Profil, Privatsphäre, Benachrichtigungen . konto-einstellungen.js
//   Cape & Cosmetics, Figur der Übersicht .... konto-cosmetics.js
//   Meine Welten ............................. konto-welten.js (dauerhafte Welten: konto-hosting.js)
//   Meine Addons ............................. konto-addons.js
//   Support, Blockierte, Meldungen, Sicherheit, Daten: hier
//
// Echtzeit über /api/v1/ws mit dem Web-Cookie (konto-live.js); klappt das nicht, fragt die Seite alle 15 Sekunden nach.
// Rahmen mit Seitenleiste, unterer Leiste (Handy) und Link zum Team-Bereich: app-shell.js.
// Ein Ziel im Link (#code=…&ziel=support) öffnet nach der Anmeldung den passenden Bereich, ziel=team die Seite /team,
// ziel=plus die Seite /plus (Heldix+-Warteliste);
// ohne Anmeldung genügen #reiter=support (oder ältere Links wie #support und #ziel=support). Weitere Werte in der
// Adresse: #reiter=nachrichten&mit=<uuid> öffnet den Chat, #reiter=support&anfrage=<id> die Anfrage,
// #reiter=freunde&teil=einladen (alt) führt zu „Freunde einladen“. Kommt die Anmeldung von einer Einladung (/einladung
// merkt sich den Code im sessionStorage des Tabs), geht es danach dorthin zurück.
import {
  $,
  ApiError,
  api,
  avatar,
  bindCounter,
  busy,
  confirmAction,
  emptyState,
  flashSaved,
  formatDate,
  formatDateTime,
  h,
  icon,
  isPlayerName,
  loadingState,
  openDialog,
  poller,
  reasonLabel,
  relativeTime,
  rerender,
  setSkinSource,
  showError,
  textBlocks,
  timeEl,
  toast,
  uid,
} from './app-common.js';
import { loginErrorText, minecraftLoginAvailable, setupMinecraftLogin } from './anmelden.js';
import { createShell, parseShellHash, sectionHref, shellIcon } from './app-shell.js';
import { markInviteLoginError, pendingInvite, rewardInfo } from './einladung-common.js';
import { initMyAddons } from './konto-addons.js';
import { initChat } from './konto-chat.js';
import { initCosmetics } from './konto-cosmetics.js';
import { initInvites } from './konto-einladungen.js';
import { initSettings } from './konto-einstellungen.js';
import { initFriends } from './konto-freunde.js';
import { createLive } from './konto-live.js';
import { initParty } from './konto-party.js';
import { initOverview } from './konto-uebersicht.js';
import { initWorlds } from './konto-welten.js';
import { initVoiceAccount } from './konto-voice.js';
import { badgeLabel, roleIcon, roleLabel } from './rollen.js';
import { attachmentList, normalizeAttachments } from './support-attachments.js';

// Alle Spielerbilder auf dieser Seite: Minecraft-Köpfe über die Cookie-Sitzung (sonst Initialen).
setSkinSource('auth');

const state = {
  me: null,
  sessions: null,
  support: { tickets: null, ticket: null },
  ended: false,
};

/**
 * Gemeinsamer Stand aller Bereiche (die Module lesen und schreiben ihn, Änderungen melden sie mit emit()).
 * friends: { friends, incoming, outgoing, unread } · conversations: [Conversation] · party: { party, invites, chat }
 * worlds: { available, mine, friends, domain } · invites: Stand aus GET /v1/invites
 * hosting: { worlds, operated, knocks, granted } (dauerhafte Welten, ab Dienst 1.13.0; für Übersicht und Glocke)
 */
const store = { me: null, friends: null, conversations: null, party: null, worlds: null, invites: null, hosting: null };
const listeners = new Map();

/** Bereich, wenn die Adresse keinen nennt. */
const DEFAULT_SECTION = 'uebersicht';
/** Eigene Addons für Übersicht und Glocke, solange „Meine Addons“ zu ist: höchstens so oft. */
const ADDONS_BACKGROUND_MS = 60_000;
const DAY = 24 * 60 * 60 * 1000;
/** Wie der Dienst: 30 Tage ab Anmeldung, höchstens 7 Tage ohne Nutzung (GET /v1/web/sessions nennt kein Ende). */
const SESSION_TTL = 30 * DAY;
const SESSION_IDLE = 7 * DAY;

let shell = null;
let myAddons = null;
let overview = null;
let cosmetics = null;
let invites = null;
let friends = null;
let chat = null;
let party = null;
let worlds = null;
let settings = null;
let live = null;
let voiceAccount = null;
const supportRefresher = poller(() => refreshSupport(), 15_000);
/** Ziele aus dem Einmal-Link (#code=…&ziel=…). */
const TARGETS = new Set(['uebersicht', 'profil', 'freunde', 'nachrichten', 'party', 'einladen', 'welten', 'privatsphaere', 'benachrichtigungen', 'sicherheit', 'daten', 'support', 'addons', 'team', 'plus']);

// ---------------------------------------------------------------------------------------------------------
// Anfragen mit Sitzung: 401 heißt abgemeldet (abgelaufen, anderswo beendet oder Daten gelöscht)
// ---------------------------------------------------------------------------------------------------------

async function call(method, path, body) {
  try {
    return await api(method, path, body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) sessionEnded('Deine Anmeldung ist abgelaufen oder wurde beendet. Melde dich über den Launcher oder im Spiel erneut an.');
    throw error;
  }
}

function sessionEnded(message) {
  if (state.ended) return;
  state.ended = true;
  live?.stop();
  supportRefresher.stop();
  myAddons?.stop();
  cosmetics?.stop();
  invites?.stop();
  overview?.reset();
  for (const module of [friends, chat, party, worlds]) module?.reset();
  Object.assign(store, { me: null, friends: null, conversations: null, party: null, worlds: null, invites: null, hosting: null });
  for (const dialog of document.querySelectorAll('dialog.modal')) dialog.remove();
  showGuest(message);
}

// ---------------------------------------------------------------------------------------------------------
// Gemeinsamer Stand und Ereignisse
// ---------------------------------------------------------------------------------------------------------

function on(name, listener) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(listener);
}

function emit(name, detail) {
  for (const listener of listeners.get(name) ?? []) {
    try {
      listener(detail);
    } catch (error) {
      console.error(error);
    }
  }
}

/** Zähler, Fenstertitel und Übersicht nach jeder Änderung an Freunden, Nachrichten, Party oder Welten. */
function updateBadges() {
  const incoming = store.friends?.incoming.length ?? 0;
  const unread = (store.conversations ?? []).reduce((sum, conversation) => sum + (conversation.unread || 0), 0);
  shell.setBadge('freunde', incoming, { label: incoming === 1 ? '1 offene Anfrage' : `${incoming} offene Anfragen` });
  shell.setBadge('nachrichten', unread, { label: `${unread} ungelesen` });
  document.title = `${unread ? `(${unread}) ` : ''}Konto – HeldixClient`;
}

function pushOverview() {
  overview.update({ me: state.me, friends: store.friends, conversations: store.conversations, tickets: state.support.tickets, party: store.party, partyAvailable: party?.available(), worlds: store.worlds, invites: store.invites, hosting: store.hosting });
}

// ---------------------------------------------------------------------------------------------------------
// Ansichten: laden, Fehler, Gast, angemeldet
// ---------------------------------------------------------------------------------------------------------

function showView(id) {
  for (const view of ['konto-laden', 'konto-fehler', 'konto-gast', 'konto-app']) $(`#${view}`).hidden = view !== id;
  document.body.classList.toggle('bereich--angemeldet', id === 'konto-app');
  if (id !== 'konto-app') shell.closeAll();
}

/** Anmeldeseite; `target`: Bereich nach der Anmeldung mit dem Minecraft-Konto (z. B. support, team). */
function showGuest(message, target = null) {
  const notice = $('#konto-gast-hinweis');
  notice.textContent = message || '';
  notice.hidden = !message;
  document.title = 'Konto – HeldixClient';
  setupMinecraftLogin($('#konto-gast'), target).catch(() => {});
  showView('konto-gast');
}

function showUnavailable(error) {
  $('#konto-fehler-text').textContent = error?.message || 'Bitte versuche es in ein paar Minuten noch einmal.';
  showView('konto-fehler');
}

async function start() {
  showView('konto-laden');
  let notice = null;
  const params = new URLSearchParams(location.hash.slice(1));
  const code = params.get('code');
  const target = TARGETS.has(params.get('ziel')) ? params.get('ziel') : null;
  // Ob es die Anmeldung mit dem Minecraft-Konto gibt, schon jetzt fragen (der Knopf erscheint dann ohne Verzögerung).
  minecraftLoginAvailable();
  if (code !== null || params.has('ziel') || params.has('fehler')) {
    // Einmal-Code, Ziel und Fehler sofort aus der Adresszeile (und damit aus Verlauf und Lesezeichen) entfernen.
    history.replaceState(null, '', location.pathname + location.search);
  }
  // Anmeldung kam von einer Einladung (/einladung merkt sich den Code in diesem Tab): danach dorthin zurück
  const invite = code !== null || params.has('fehler') ? pendingInvite() : null;
  // Zurück von der Anmeldung mit dem Minecraft-Konto, aber nicht geklappt: Text zum Code (nie der Code selbst)
  if (params.has('fehler')) {
    if (invite) {
      markInviteLoginError(params.get('fehler'));
      location.replace(`/einladung#${invite.code}`);
      return;
    }
    notice = loginErrorText(params.get('fehler'));
  }
  if (code !== null) {
    try {
      const me = await api('POST', '/v1/web/session', { code });
      if (invite?.accept) {
        location.replace(`/einladung#${invite.code}`);
        return;
      }
      // Ziele außerhalb des Kontos: Team-Bereich und Heldix+ (/plus, Warteliste)
      if (target === 'team' || target === 'plus') {
        location.replace(`/${target}`);
        return;
      }
      showApp(me, target);
      toast(`Willkommen, ${me.name}! Du bist jetzt angemeldet.`, 'success');
      return;
    } catch (error) {
      if (error.status === 0 || error.status >= 500) return showUnavailable(error);
      if (invite) {
        markInviteLoginError('abgelaufen');
        location.replace(`/einladung#${invite.code}`);
        return;
      }
      notice = error.message;
    }
  }
  try {
    const me = await api('GET', '/v1/web/me');
    if ((target === 'team' || target === 'plus') && !notice) {
      location.replace(`/${target}`);
      return;
    }
    showApp(me, target === 'team' || target === 'plus' ? null : target);
    if (notice) toast(notice, 'error');
  } catch (error) {
    if (error.status === 401) {
      const hint = target === 'support' ? 'Für eine Support-Anfrage meldest du dich zuerst an – ohne Passwort, über den Launcher oder im Spiel (siehe unten). Danach öffnet sich der Bereich Support.' : target ? 'Melde dich zuerst an – ohne Passwort, über den Launcher oder im Spiel (siehe unten).' : null;
      showGuest(notice ?? hint, target);
    } else showUnavailable(error);
  }
}

function showApp(me, target = null) {
  state.me = me;
  store.me = me;
  state.ended = false;
  state.sessions = null;
  renderHeader();
  settings.render();
  overview.setUser(me);
  cosmetics.setUser(me);
  invites.setUser(me);
  renderTwoFactor();
  showView('konto-app');
  const address = parseShellHash();
  let wanted = target ?? address.section;
  let extra = target ? null : address.extra;
  // Alter Link: Freunde → „Freunde einladen“ ist jetzt ein eigener Bereich
  if (wanted === 'freunde' && extra?.teil === 'einladen') {
    wanted = 'einladen';
    extra = null;
  }
  shell.select(shell.has(wanted) ? wanted : DEFAULT_SECTION, { params: extra });
  friends.refresh().catch(showError);
  chat.refreshConversations().catch(() => {});
  party.refresh().catch(() => {});
  worlds.refresh().catch(() => {});
  if (wanted !== 'welten') worlds.checkHosting().catch(() => {});
  if (wanted !== 'support') refreshSupportList().catch(() => {});
  if (wanted !== 'addons') myAddons.refreshInBackground().catch(() => {});
  if (wanted !== 'sicherheit') loadSessions().catch(() => {});
  live.start();
  supportRefresher.start();
}

/** Seitenleiste: eigener Spieler, Status bzw. Abzeichen, Rolle (Team nur mit Rolle), Ablauf der Sitzung. */
function renderHeader() {
  const { me } = state;
  shell.setUser(me);
  renderSideStatus();
  shell.setMeta([me.role ? h('span', { class: 'rolle-name' }, roleIcon(me.role), roleLabel(me.role)) : null, me.badge && !me.role ? `Abzeichen: ${badgeLabel(me.badge)}` : null, 'Angemeldet beim Heldix-Dienst', me.expiresAt ? `Sitzung gültig bis spätestens ${formatDate(me.expiresAt)}` : null]);
}

/** Zeile unter dem Namen: „Nicht stören“, Statustext oder Verbindung (Echtzeit). */
function renderSideStatus() {
  const me = state.me;
  if (!me) return;
  if (me.dnd) shell.setStatus([shellIcon('moon'), 'Nicht stören'], 'dnd');
  else if (me.statusText) shell.setStatus(`„${me.statusText}“`);
  else if (live?.status() === 'live') shell.setStatus('Live verbunden', 'online');
  else shell.setStatus(me.role ? roleLabel(me.role) : 'Angemeldet');
}

/** Bereich gewechselt. params: weitere Werte aus der Adresse oder einem Eintrag der Glocke (mit, anfrage). */
function onTab(name, { params = null } = {}) {
  friends.onTab(name);
  chat.onTab(name, params);
  party.onTab(name);
  worlds.onTab(name);
  invites.onTab(name, params);
  if (name === 'privatsphaere') {
    loadBlocks().catch(showError);
    loadReports().catch(showError);
    voiceAccount.load().catch(() => {});
  }
  if (name === 'sicherheit') {
    loadSessions().catch(showError);
    refreshMe().catch(() => {});
  }
  myAddons.onTab(name);
  cosmetics.onTab(name, params);
  if (name === 'support') {
    const ticket = params?.anfrage !== undefined && /^[0-9]{1,12}$/.test(String(params.anfrage)) ? Number(params.anfrage) : null;
    refreshSupportList().catch(showError);
    // Neue Anfrage mit Kategorie (z. B. Einspruch gegen eine Voice-Sperre: neu=konto)
    if (ticket === null && ['hilfe', 'fehler', 'konto', 'sonstiges'].includes(String(params?.neu ?? ''))) {
      openSupportForm();
      $('#support-kategorie').value = params.neu;
      if (typeof params.betreff === 'string' && !$('#support-betreff').value) $('#support-betreff').value = params.betreff.slice(0, 120);
      $('#support-betreff').dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (ticket !== null && state.support.ticket?.id !== ticket) openTicket(ticket);
    else if (state.support.ticket?.id) refreshOpenTicket().catch(() => {});
  }
}

/** Profil neu holen (Zwei-Faktor-Stand, Rolle) – beim Öffnen von „Sicherheit“. */
async function refreshMe() {
  const me = await call('GET', '/v1/web/me');
  if (state.ended || !me) return;
  const roleChanged = me.role !== state.me.role;
  applyMe(me);
  if (roleChanged) renderHeader();
  renderTwoFactor();
}

/** Abgleich per HTTP (Rückfall ohne WebSocket alle 15 s, sonst jede Minute und nach dem Verbinden). */
async function pollAll() {
  if (state.ended) return;
  await Promise.all([friends.refresh(), chat.refreshConversations(), shell.current() === 'nachrichten' ? chat.refreshChat() : null, party.refresh()]);
}

/** Nachricht über den WebSocket an das passende Modul. */
function onLiveEvent(message) {
  if (state.ended) return;
  if (friends.handleEvent(message) || chat.handleEvent(message) || party.handleEvent(message) || worlds.handleEvent(message)) return;
  switch (message.type) {
    case 'support':
      toast(`Das Team hat geantwortet: ${message.subject ?? 'Support-Anfrage'}`);
      refreshSupport().catch(() => {});
      break;
    case 'addon-review':
      myAddons.refreshInBackground().catch(() => {});
      break;
    case 'unlock':
      toast(`Freigeschaltet: ${rewardInfo(message.cosmetic).name}! Du findest es unter Profil & Cosmetics.`, 'success');
      cosmetics.setUser(state.me);
      invites.setUser(state.me);
      break;
    case 'invite':
      if (message.name) toast(message.event === 'confirmed' ? `${message.name} ist bestätigt – das zählt für deine Belohnungen.` : `${message.name} hat deine Einladung angenommen.`, 'success');
      invites.setUser(state.me);
      break;
    default:
      break;
  }
}

function onLiveState(status) {
  const chip = $('#freunde-live');
  if (chip) {
    chip.hidden = status !== 'live';
    chip.title = 'Freunde, Nachrichten und Party kommen sofort an.';
  }
  document.body.dataset.echtzeit = status;
  renderSideStatus();
}

// ---------------------------------------------------------------------------------------------------------
// Profil speichern (Einstellungen, Statustext, „Nicht stören“, Cape)
// ---------------------------------------------------------------------------------------------------------

// Änderungen nacheinander speichern, damit schnelle Klicks in der richtigen Reihenfolge ankommen.
let saving = Promise.resolve();

/** Aufgabe in die Reihe der Speichervorgänge stellen (Einstellungen, Cape, Cosmetics). */
function enqueue(task) {
  saving = saving.then(task, task);
  return saving;
}

/** Profil geändert (z. B. Cape, Statustext): alle Ansichten. */
function applyMe(patch) {
  state.me = { ...state.me, ...patch };
  store.me = state.me;
  renderSideStatus();
  emit('me');
  pushOverview();
}

/** PUT /v1/me mit Teil des Profils (ohne Warteschlange); true bei Erfolg. options.onError(problem): eigener Hinweis. */
async function putMe(patch, savedElement, savedText, { onError } = {}) {
    try {
      const me = await call('PUT', '/v1/me', patch);
      applyMe(me ?? patch);
      flashSaved(savedElement, savedText);
      return true;
    } catch (error) {
      if (onError && error.status !== 401) onError(error);
      else showError(error);
      // Den Stand des Dienstes zeigen, also den alten Wert.
      if (!state.ended) {
        cosmetics.render();
        settings.render();
      }
      return false;
    }
}

/** Wie putMe, aber in der Reihe der Speichervorgänge (Schalter, Statustext). */
function saveMe(patch, savedElement, savedText, options) {
  return enqueue(() => putMe(patch, savedElement, savedText, options));
}

// ---------------------------------------------------------------------------------------------------------
// Support-Anfragen
// ---------------------------------------------------------------------------------------------------------

const SUPPORT_CATEGORIES = { hilfe: 'Hilfe', fehler: 'Fehler', konto: 'Konto', sonstiges: 'Sonstiges' };
const SUPPORT_STATUS = {
  open: ['Wartet auf Antwort', 'warning'],
  answered: ['Beantwortet', 'success'],
  closed: ['Geschlossen', ''],
};
const MAX_SUBJECT = 100;
const MAX_TICKET_TEXT = 2000;
const MAX_OPEN_TICKETS = 3;

function supportChip(status) {
  const [label, kind] = SUPPORT_STATUS[status] ?? [status, ''];
  return h('span', { class: `chip${kind ? ` ${kind}` : ''}`, text: label });
}

/** Liste (alle 15 Sekunden, auch für den Zähler am Reiter). */
async function refreshSupportList() {
  const data = await call('GET', '/v1/support');
  state.support.tickets = Array.isArray(data?.tickets) ? data.tickets : [];
  renderSupportList();
}

function renderSupportList() {
  const tickets = state.support.tickets ?? [];
  const unread = tickets.filter((ticket) => ticket.unread).length;
  shell.setBadge('support', unread, { label: unread === 1 ? '1 neue Antwort' : `${unread} neue Antworten` });
  if (state.support.tickets) pushOverview();
  const openCount = tickets.filter((ticket) => ticket.status !== 'closed').length;
  $('#support-limit').hidden = openCount < MAX_OPEN_TICKETS;
  $('#support-neu').disabled = openCount >= MAX_OPEN_TICKETS;
  const current = state.support.ticket?.id ?? null;
  rerender($('#support-liste'), JSON.stringify([tickets, current]), () => {
    if (!tickets.length) return emptyState('Noch keine Anfragen. Wenn etwas nicht klappt, schreib dem Team.', 'info');
    return h(
      'ul',
      { class: 'rows' },
      tickets.map((ticket) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: `row row-button ticket-row${ticket.unread ? ' unread' : ''}`,
              'aria-current': ticket.id === current ? 'true' : undefined,
              dataset: { focusKey: `ticket:${ticket.id}` },
              onClick: () => openTicket(ticket.id),
            },
            h(
              'span',
              { class: 'row-main' },
              h('span', { class: 'row-title' }, ticket.unread ? h('span', { class: 'unread-dot', 'aria-hidden': 'true' }) : null, h('span', { class: 'ticket-subject', text: ticket.subject })),
              h(
                'span',
                { class: 'chips-row' },
                ticket.unread ? h('span', { class: 'chip accent', text: 'Neue Antwort' }) : null,
                supportChip(ticket.status),
                h('span', { class: 'chip', text: SUPPORT_CATEGORIES[ticket.category] ?? ticket.category }),
              ),
              h('span', { class: 'row-meta', text: `#${ticket.id} · zuletzt ${relativeTime(ticket.updatedAt ?? ticket.at)}` }),
            ),
            icon('chevron-right'),
          ),
        ),
      ),
    );
  });
}

function showSupportPane(which) {
  $('#support-leer').hidden = which !== 'leer';
  $('#support-form').hidden = which !== 'form';
  $('#support-ticket').hidden = which !== 'ticket';
  $('#support').classList.toggle('detail-open', which !== 'leer');
}

function supportBack() {
  state.support.ticket = null;
  showSupportPane('leer');
  renderSupportList();
  $('#support-neu').focus();
}

function openSupportForm() {
  state.support.ticket = null;
  renderSupportList();
  $('#support-fehler').hidden = true;
  showSupportPane('form');
  if (!window.matchMedia('(min-width: 901px)').matches) $('#support').scrollIntoView({ block: 'start' });
  $('#support-kategorie').focus({ preventScroll: true });
}

async function onSupportSubmit(event) {
  event.preventDefault();
  const error = $('#support-fehler');
  error.hidden = true;
  const category = $('#support-kategorie').value;
  const subject = $('#support-betreff').value.replace(/[\r\n]+/g, ' ').trim();
  const text = $('#support-text').value.replace(/\r\n?/g, '\n').trim();
  let problem = null;
  if (!subject) problem = [$('#support-betreff'), 'Bitte einen Betreff eingeben.'];
  else if ([...subject].length > MAX_SUBJECT) problem = [$('#support-betreff'), `Der Betreff ist zu lang (höchstens ${MAX_SUBJECT} Zeichen).`];
  else if (!text) problem = [$('#support-text'), 'Bitte beschreib dein Anliegen.'];
  else if ([...text].length > MAX_TICKET_TEXT) problem = [$('#support-text'), `Die Nachricht ist zu lang (höchstens ${MAX_TICKET_TEXT} Zeichen).`];
  if (problem) {
    error.textContent = problem[1];
    error.hidden = false;
    problem[0].focus();
    return;
  }
  try {
    const data = await busy($('#support-absenden'), () => call('POST', '/v1/support', { category, subject, text }));
    $('#support-betreff').value = '';
    $('#support-text').value = '';
    $('#support-betreff').dispatchEvent(new Event('input'));
    $('#support-text').dispatchEvent(new Event('input'));
    toast('Deine Anfrage ist beim Team. Die Antwort siehst du hier und im Spiel.', 'success');
    if (data?.ticket) showTicket(data.ticket, { focus: true });
    refreshSupportList().catch(() => {});
  } catch (problemError) {
    if (problemError.status === 401) return;
    error.textContent = problemError.message;
    error.hidden = false;
  }
}

async function openTicket(id) {
  state.support.ticket = { id, loading: true };
  renderSupportList();
  showSupportPane('ticket');
  $('#ticket-betreff').textContent = 'Wird geladen …';
  $('#ticket-meta').textContent = '';
  $('#ticket-verlauf').dataset.signature = '';
  $('#ticket-verlauf').replaceChildren(loadingState());
  $('#ticket-anhaenge').dataset.signature = '';
  $('#ticket-anhaenge').replaceChildren();
  $('#ticket-antwort').hidden = true;
  $('#ticket-geschlossen').hidden = true;
  if (!window.matchMedia('(min-width: 901px)').matches) $('#support').scrollIntoView({ block: 'start' });
  try {
    const data = await call('GET', `/v1/support/${encodeURIComponent(id)}`);
    if (state.support.ticket?.id !== id) return;
    showTicket(data.ticket, { focus: true, fresh: true });
  } catch (error) {
    if (error.status === 401 || state.support.ticket?.id !== id) return;
    $('#ticket-betreff').textContent = 'Anfrage nicht gefunden';
    $('#ticket-verlauf').replaceChildren(emptyState(error.message, 'warning'));
  }
}

function showTicket(ticket, { focus = false, fresh = false } = {}) {
  if (!ticket) return;
  const previous = state.support.ticket;
  const same = previous?.id === ticket.id && !previous.loading && !fresh;
  state.support.ticket = ticket;
  // Geöffnet = gelesen: auch in der Liste sofort ohne Markierung.
  const listed = state.support.tickets?.find((entry) => entry.id === ticket.id);
  if (listed) Object.assign(listed, { unread: false, status: ticket.status, updatedAt: ticket.updatedAt });
  renderSupportList();
  showSupportPane('ticket');
  $('#ticket-betreff').textContent = ticket.subject;
  $('#ticket-meta').replaceChildren(
    supportChip(ticket.status),
    h('span', { class: 'chip', text: SUPPORT_CATEGORIES[ticket.category] ?? ticket.category }),
    h('span', { text: `#${ticket.id} · erstellt ${relativeTime(ticket.at)}` }),
  );
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  const box = $('#ticket-verlauf');
  const changed = rerender(box, JSON.stringify(messages), () =>
    messages.map((message) => {
      const mine = message.from === 'player';
      return h(
        'li',
        { class: `ticket-msg ${mine ? 'mine' : 'team'}` },
        h('p', { class: 'ticket-msg-head' }, h('strong', { text: mine ? 'Du' : message.author || 'HeldixClient-Team' }), ' · ', timeEl(message.at, formatDateTime(message.at))),
        h('div', { class: 'ticket-msg-text' }, textBlocks(message.text)),
      );
    }),
  );
  // Anhänge (Absturzberichte und Logs aus dem Launcher): Liste mit Download
  const attachments = normalizeAttachments(ticket.attachments);
  rerender($('#ticket-anhaenge'), JSON.stringify([ticket.id, attachments]), () => attachmentList(ticket.id, attachments, { base: '/v1/support' }));
  const closed = ticket.status === 'closed';
  $('#ticket-antwort').hidden = closed;
  $('#ticket-geschlossen').hidden = !closed;
  if (!same) {
    $('#ticket-fehler').hidden = true;
    $('#ticket-text').value = '';
    $('#ticket-text').dispatchEvent(new Event('input'));
  }
  if (focus) $('#ticket-betreff').focus({ preventScroll: true });
  if (changed && same && box.lastElementChild) box.lastElementChild.scrollIntoView({ block: 'nearest' });
}

async function onTicketReply(event) {
  event.preventDefault();
  const ticket = state.support.ticket;
  if (!ticket?.id) return;
  const input = $('#ticket-text');
  const error = $('#ticket-fehler');
  const text = input.value.replace(/\r\n?/g, '\n').trim();
  error.hidden = true;
  if (!text) {
    error.textContent = 'Bitte schreib eine Antwort.';
    error.hidden = false;
    input.focus();
    return;
  }
  if ([...text].length > MAX_TICKET_TEXT) {
    error.textContent = `Die Antwort ist zu lang (höchstens ${MAX_TICKET_TEXT} Zeichen).`;
    error.hidden = false;
    return;
  }
  try {
    const data = await busy([$('#ticket-senden'), $('#ticket-schliessen')], () => call('POST', `/v1/support/${encodeURIComponent(ticket.id)}/messages`, { text }));
    input.value = '';
    input.dispatchEvent(new Event('input'));
    showTicket(data.ticket);
    refreshSupportList().catch(() => {});
    input.focus({ preventScroll: true });
  } catch (problem) {
    if (problem.status === 401) return;
    error.textContent = problem.message;
    error.hidden = false;
    if (problem.status === 409) refreshOpenTicket().catch(() => {});
  }
}

async function closeTicket() {
  const ticket = state.support.ticket;
  if (!ticket?.id) return;
  let updated = null;
  const ok = await confirmAction({
    title: 'Anfrage schließen?',
    text: 'Danach kann niemand mehr darauf antworten. Brauchst du später noch Hilfe, schreib einfach eine neue Anfrage.',
    confirmLabel: 'Schließen',
    onConfirm: async () => {
      updated = await call('POST', `/v1/support/${encodeURIComponent(ticket.id)}/close`);
    },
  });
  if (!ok) return;
  if (updated?.ticket) showTicket(updated.ticket);
  toast('Die Anfrage ist geschlossen.', 'success');
  refreshSupportList().catch(() => {});
}

/** Offene Anfrage neu laden (nur wenn der Reiter sichtbar ist – das Öffnen gilt als gelesen). */
async function refreshOpenTicket() {
  const id = state.support.ticket?.id;
  if (!id || state.support.ticket.loading) return;
  const data = await call('GET', `/v1/support/${encodeURIComponent(id)}`);
  if (state.support.ticket?.id === id && data?.ticket) showTicket(data.ticket);
}

async function refreshSupport() {
  if (state.ended) return;
  // Eigene Addons im selben Takt mitnehmen, aber selten (Reiter offen: der fragt selbst nach).
  const addons = shell.current() !== 'addons' ? myAddons.refreshInBackground(ADDONS_BACKGROUND_MS) : null;
  await Promise.all([refreshSupportList(), shell.current() === 'support' ? refreshOpenTicket() : null, addons]);
}

// ---------------------------------------------------------------------------------------------------------
// Privatsphäre: Blockierte und eigene Meldungen
// ---------------------------------------------------------------------------------------------------------

async function loadBlocks() {
  const box = $('#blockiert');
  if (!box.firstChild) box.replaceChildren(loadingState());
  const data = await call('GET', '/v1/blocks');
  renderBlocks(Array.isArray(data?.blocked) ? data.blocked : []);
}

function renderBlocks(blocked) {
  rerender($('#blockiert'), JSON.stringify(blocked), () => {
    if (!blocked.length) return emptyState('Du hast niemanden blockiert.', 'ban');
    return h(
      'ul',
      { class: 'rows' },
      blocked.map((entry) =>
        h(
          'li',
          { class: 'row' },
          avatar(entry.name, entry.uuid, { size: 'sm' }),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: entry.name }), h('div', { class: 'row-sub', text: `blockiert ${relativeTime(entry.at)}` })),
          h(
            'div',
            { class: 'row-actions' },
            h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { focusKey: `${entry.uuid}:unblock` }, onClick: (event) => unblock(event.currentTarget, entry) }, 'Freigeben'),
          ),
        ),
      ),
    );
  });
}

async function unblock(button, entry) {
  try {
    const data = await busy(button, () => call('DELETE', `/v1/blocks/${entry.uuid}`));
    renderBlocks(Array.isArray(data?.blocked) ? data.blocked : []);
    toast(`${entry.name} ist wieder freigegeben.`);
    $('#block-name').focus();
  } catch (error) {
    showError(error);
  }
}

async function onBlockSubmit(event) {
  event.preventDefault();
  const input = $('#block-name');
  const error = $('#block-fehler');
  const name = input.value.trim();
  error.hidden = true;
  if (!isPlayerName(name)) {
    error.textContent = 'Ein Spielername hat 1 bis 16 Zeichen: Buchstaben, Ziffern und _.';
    error.hidden = false;
    input.focus();
    return;
  }
  const friend = store.friends?.friends.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  try {
    const blocked = await friends.blockPlayer(friend ? { uuid: friend.uuid, name: friend.name } : { name });
    if (!blocked) return;
    input.value = '';
    await loadBlocks();
  } catch (problem) {
    if (problem.status === 401) return;
    error.textContent = problem.message;
    error.hidden = false;
  }
}

/** Gründe der Voice-Meldungen (ab Dienst 1.13.0, kind: voice). */
const VOICE_REASONS = { insult: 'Beleidigung', harassment: 'Belästigung', hate: 'Hassrede', noise: 'Anschreien/Lärm', other: 'Sonstiges' };

async function loadReports() {
  const box = $('#meldungen');
  if (!box.firstChild) box.replaceChildren(loadingState());
  const data = await call('GET', '/v1/reports/mine');
  const reports = Array.isArray(data?.reports) ? data.reports : [];
  rerender(box, JSON.stringify(reports), () => {
    if (!reports.length) return emptyState('Du hast niemanden gemeldet.', 'flag');
    return h(
      'ul',
      { class: 'rows' },
      reports.map((report) =>
        h(
          'li',
          { class: 'row report-row' },
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title' }, h('span', { text: report.reported?.name ?? 'Unbekannt' }), report.kind === 'voice' ? h('span', { class: 'chip chip--voice', text: 'Voice' }) : null, h('span', { class: report.status === 'done' ? 'chip success' : 'chip warning', text: report.status === 'done' ? 'Erledigt' : 'Offen' })),
            h('div', { class: 'row-sub', text: `${report.kind === 'voice' ? VOICE_REASONS[report.reason] ?? report.reasonLabel ?? report.reason : reasonLabel(report.reason)} · ${formatDate(report.at)}` }),
            report.note ? h('p', { class: 'quote small', text: report.note }) : null,
          ),
        ),
      ),
    );
  });
}

// ---------------------------------------------------------------------------------------------------------
// Meine Daten: Export, alles löschen
// ---------------------------------------------------------------------------------------------------------

async function exportData(event) {
  const button = event.currentTarget;
  try {
    const response = await busy(button, async () => {
      try {
        return await api('GET', '/v1/me/export', undefined, { raw: true });
      } catch (error) {
        if (error.status === 401) sessionEnded('Deine Anmeldung ist abgelaufen. Melde dich über den Launcher erneut an.');
        throw error;
      }
    });
    const blob = await response.blob();
    const header = response.headers.get('Content-Disposition') || '';
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
    let filename = `heldix-daten-${state.me.name}.json`;
    if (match) {
      try {
        filename = decodeURIComponent(match[1]);
      } catch {
        filename = match[1];
      }
    }
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: filename.replace(/[\\/:*?"<>|]/g, '_'), class: 'visually-hidden' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    toast(`${filename} wird heruntergeladen.`, 'success');
  } catch (error) {
    showError(error);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Sicherheit: angemeldete Browser, Zwei-Faktor-Anmeldung (Team)
// ---------------------------------------------------------------------------------------------------------

async function loadSessions() {
  const box = $('#sitzungen');
  if (!box.firstChild) box.replaceChildren(loadingState());
  const data = await call('GET', '/v1/web/sessions');
  renderSessions(data);
}

/** Ende einer Anmeldung: vom Dienst, sonst wie der Dienst rechnet (30 Tage ab Anmeldung, 7 Tage ohne Nutzung). */
function sessionEnd(session) {
  if (session.current && state.me?.expiresAt) return state.me.expiresAt;
  if (typeof session.expiresAt === 'number') return session.expiresAt;
  const created = typeof session.createdAt === 'number' ? session.createdAt : null;
  const used = typeof session.lastUsedAt === 'number' ? session.lastUsedAt : created;
  if (created === null || used === null) return null;
  return Math.min(created + SESSION_TTL, used + SESSION_IDLE);
}

/** Gerät aus dem Text des Dienstes („Firefox · Windows“): Handy oder Rechner – nur fürs Symbol. */
const isPhone = (device) => /iphone|android|ipad|handy|mobil/i.test(String(device || ''));

/** Symbol „Handy“ (gibt es im Heldix-Icon-Set nicht; gleicher Stil). */
function phoneIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ['M8.5 3 H15.5 A2 2 0 0 1 17.5 5 V19 A2 2 0 0 1 15.5 21 H8.5 A2 2 0 0 1 6.5 19 V5 A2 2 0 0 1 8.5 3 Z', 'M11 17.5 H13']) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function renderSessions(data) {
  const sessions = Array.isArray(data?.sessions) ? [...data.sessions] : [];
  sessions.sort((a, b) => Number(b.current) - Number(a.current) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  state.sessions = sessions;
  const others = sessions.filter((session) => !session.current);
  $('#sitzungen-andere').hidden = others.length < 1;
  $('#sitzungen-anzahl').textContent = sessions.length ? `(${sessions.length})` : '';
  overview.update({ sessions });
  rerender($('#sitzungen'), JSON.stringify([sessions, state.me?.expiresAt]), () => {
    if (!sessions.length) return emptyState('Keine Anmeldungen.', 'clock');
    return h(
      'ul',
      { class: 'rows sec-sessions' },
      sessions.map((session) => {
        const end = sessionEnd(session);
        return h(
          'li',
          { class: `row sec-session${session.current ? ' current' : ''}`, dataset: { sitzung: session.id } },
          h('span', { class: 'row-icon', 'aria-hidden': 'true' }, isPhone(session.device) ? phoneIcon() : icon('monitor')),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title' }, h('span', { text: session.device || 'Unbekannter Browser' }), session.current ? h('span', { class: 'chip accent', text: 'Dieser Browser' }) : null),
            h(
              'dl',
              { class: 'sec-times' },
              h('div', null, h('dt', { text: 'Angemeldet' }), h('dd', null, timeEl(session.createdAt, formatDate(session.createdAt)))),
              h('div', null, h('dt', { text: 'Zuletzt aktiv' }), h('dd', null, session.current ? 'jetzt' : timeEl(session.lastUsedAt, relativeTime(session.lastUsedAt)))),
              h('div', null, h('dt', { text: 'Läuft ab' }), h('dd', null, end ? timeEl(end, formatDate(end)) : '–')),
            ),
          ),
          h(
            'div',
            { class: 'row-actions' },
            session.current
              ? h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: 'logout' }, onClick: logout }, 'Abmelden')
              : h('button', { type: 'button', class: 'button tiny ghost', 'aria-label': `${session.device || 'Browser'} abmelden`, dataset: { focusKey: `${session.id}:end` }, onClick: (event) => endSession(event.currentTarget, session) }, 'Abmelden'),
          ),
        );
      }),
    );
  });
}

async function endSession(button, session) {
  try {
    const data = await busy(button, () => call('DELETE', `/v1/web/sessions/${encodeURIComponent(session.id)}`));
    renderSessions(data);
    toast(`${session.device || 'Der Browser'} ist abgemeldet.`);
    $('#sitzungen-titel').focus?.();
  } catch (error) {
    showError(error);
  }
}

/** „Überall abmelden (außer hier)“: jede andere Anmeldung einzeln beenden (der Dienst kennt kein „alle“). */
async function endOtherSessions(event) {
  const others = (state.sessions ?? []).filter((session) => !session.current);
  if (!others.length) return;
  const opener = event.currentTarget;
  let failed = 0;
  const ok = await confirmAction({
    title: 'Überall abmelden – außer hier?',
    text: [
      others.length === 1 ? 'Die andere Anmeldung endet sofort.' : `${others.length} andere Anmeldungen enden sofort.`,
      'Dieser Browser bleibt angemeldet. Launcher und Spiel sind davon nicht betroffen.',
    ],
    confirmLabel: 'Überall abmelden',
    onConfirm: async () => {
      let data = null;
      for (const session of others) {
        try {
          data = await call('DELETE', `/v1/web/sessions/${encodeURIComponent(session.id)}`);
        } catch (error) {
          if (error.status === 401) throw error;
          failed++;
        }
      }
      if (data) renderSessions(data);
      else await loadSessions();
    },
  });
  if (!ok) return opener?.focus?.();
  if (failed) toast(`${failed === 1 ? 'Eine Anmeldung ließ' : `${failed} Anmeldungen ließen`} sich gerade nicht beenden. Versuch es gleich noch einmal.`, 'error');
  else toast(others.length === 1 ? 'Die andere Anmeldung ist beendet.' : 'Alle anderen Anmeldungen sind beendet.', 'success');
  $('#sitzungen-titel').focus?.();
}

/** Karte „Zwei-Faktor-Anmeldung“: nur für Team-Mitglieder (GET /v1/web/me → role, twoFactor). */
function renderTwoFactor() {
  const me = state.me;
  const card = $('#zweifaktor');
  if (!me?.role) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  const twoFactor = me.twoFactor ?? { enabled: false, verified: false };
  const status = $('#zweifaktor-status');
  status.className = `chip ${twoFactor.enabled ? 'success' : 'warning'}`;
  status.textContent = twoFactor.enabled ? 'Eingerichtet' : 'Nicht eingerichtet';
  const role = roleLabel(me.role);
  const check = (ok, text) => h('li', { class: ok ? 'ok' : 'todo' }, icon(ok ? 'check' : 'warning'), h('span', { text }));
  $('#zweifaktor-liste').replaceChildren(
    check(true, `Du bist im Team als ${role}.`),
    check(twoFactor.enabled, twoFactor.enabled ? 'Die Zwei-Faktor-Anmeldung ist eingerichtet.' : 'Die Zwei-Faktor-Anmeldung ist noch nicht eingerichtet – ohne sie bleibt der Team-Bereich zu.'),
    twoFactor.enabled ? check(twoFactor.verified, twoFactor.verified ? 'Dieser Browser ist mit einem Code bestätigt (12 Stunden lang).' : 'Dieser Browser ist gerade nicht bestätigt. Der Team-Bereich fragt nach dem Code.') : null,
  );
  const actions = [];
  if (!twoFactor.enabled) actions.push(h('a', { class: 'button small', href: '/team', id: 'zweifaktor-einrichten' }, icon('lock'), 'Jetzt einrichten'));
  else if (!twoFactor.verified) actions.push(h('a', { class: 'button small', href: '/team', id: 'zweifaktor-bestaetigen' }, icon('lock'), 'Code eingeben'));
  else actions.push(h('a', { class: 'button small ghost', href: sectionHref('team', 'uebersicht'), id: 'zweifaktor-team' }, icon('shield'), 'Zum Team-Bereich'));
  if (twoFactor.enabled && (me.permissions ?? []).includes('team.manage')) actions.push(h('a', { class: 'button small ghost', href: sectionHref('team', 'team'), id: 'zweifaktor-verwalten' }, icon('friends'), 'Mitglieder und 2FA verwalten'));
  $('#zweifaktor-aktionen').replaceChildren(...actions);
  $('#zweifaktor-hilfe').textContent = twoFactor.enabled
    ? 'Neues Handy oder App verloren? Ein Admin kann deine Zwei-Faktor-Anmeldung zurücksetzen (Team → Team). Danach richtest du sie im Team-Bereich neu ein.'
    : 'Du brauchst eine Authenticator-App (z. B. Aegis, 2FAS, Google oder Microsoft Authenticator). Der Team-Bereich zeigt dir den Schlüssel und fragt einmal nach einem Code.';
}

async function logout(button) {
  // Echtzeit zuerst beenden: der Dienst schließt die Verbindung beim Abmelden ohnehin (4008)
  live.stop();
  try {
    await busy(button ?? $('#konto-abmelden'), () => api('POST', '/v1/web/logout'));
  } catch (error) {
    if (error.status !== 401) {
      live.start();
      return showError(error);
    }
  }
  sessionEnded('Du hast dich abgemeldet.');
}

async function deleteEverything() {
  const name = state.me.name;
  const inputId = uid('bestaetigung');
  const input = h('input', { class: 'input', id: inputId, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: name });
  const ok = await openDialog({
    title: 'Wirklich alle Daten löschen?',
    body: [
      h('p', { text: 'Das lässt sich nicht rückgängig machen. Freundschaften, Nachrichten, Welten und Einstellungen sind danach weg, und du wirst überall abgemeldet.' }),
      h('div', { class: 'field' }, h('label', { for: inputId }, 'Gib zur Bestätigung deinen Spielernamen ', h('strong', { text: name }), ' ein:'), input),
    ],
    confirmLabel: 'Endgültig löschen',
    danger: true,
    canConfirm: () => input.value.trim().toLowerCase() === name.toLowerCase(),
    onConfirm: () => api('DELETE', '/v1/me'),
  });
  if (!ok) return;
  sessionEnded(`Deine Daten beim Heldix-Dienst sind gelöscht, ${name}. Du bist abgemeldet.`);
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------------------

function init() {
  shell = createShell({ root: $('#konto-app'), page: 'konto', defaultSection: DEFAULT_SECTION, onSelect: onTab, onSignOut: logout });
  // Gemeinsamer Zugang der Module zu Stand, Anfragen und zueinander
  const ctx = {
    call,
    shell,
    store,
    on,
    emit,
    hint: (...args) => settings?.hint(...args) ?? false,
    saveMe,
    features: () => ({ extras: Boolean(state.me && ('dnd' in state.me || 'statusText' in state.me)) }),
    worldDomain: () => store.worlds?.domain ?? null,
    worldName: (address) => [...(store.worlds?.mine ?? []), ...(store.worlds?.friends ?? [])].find((world) => world.address === address)?.name ?? null,
    cosmeticName: (id) => cosmetics?.nameById(id) ?? null,
    wearsSomething: () => cosmetics?.wearsSomething() ?? false,
    openChat: (uuid) => chat.openChat(uuid),
    openProfile: (uuid) => friends.openProfile(uuid),
    refreshFriends: () => friends.refresh().catch(() => {}),
    canInviteToParty: (uuid) => party?.canInvite(uuid) ?? false,
    inviteToParty: (friend, button) => party.invite(friend, button),
    blockPlayer: (target) => friends.blockPlayer(target),
    reportPlayer: (target) => friends.reportPlayer(target),
    get live() {
      return live;
    },
  };
  settings = initSettings(ctx);
  friends = initFriends(ctx);
  chat = initChat(ctx);
  party = initParty(ctx);
  worlds = initWorlds(ctx);
  voiceAccount = initVoiceAccount({ call });
  live = createLive({
    call,
    poll: pollAll,
    onEvent: onLiveEvent,
    onState: onLiveState,
    onOpen: () => worlds?.onLiveOpen(),
    onSignedOut: () => sessionEnded('Du wurdest abgemeldet (auf einem anderen Gerät, abgelaufen oder die Sitzung wurde beendet).'),
  });
  overview = initOverview({ shell, onStatus: () => settings.focusStatus(), worldDomain: ctx.worldDomain, openChat: ctx.openChat });
  myAddons = initMyAddons({
    call,
    onUnauthorized: () => sessionEnded('Deine Anmeldung ist abgelaufen oder wurde beendet. Melde dich über den Launcher oder im Spiel erneut an.'),
    onChange: ({ submissions, addons }) => overview.update({ submissions, addons }),
  });
  cosmetics = initCosmetics({
    call,
    enqueue,
    getMe: () => state.me,
    applyMe,
    saveCape: (cape, savedText) => putMe({ cape }, $('#cape-gespeichert'), savedText),
    onLook: (look) => {
      overview.update({ look });
      settings.render();
    },
  });
  invites = initInvites({
    call,
    isCurrent: () => shell.current() === 'einladen',
    onChange: (data) => {
      store.invites = data ? { ...data, rewards: data.rewards.map((reward) => ({ ...reward, name: rewardInfo(reward.cosmetic).name, unlocked: reward.unlocked === true || data.unlocked.includes(reward.cosmetic) })) } : null;
      pushOverview();
    },
  });
  // Jede Änderung am gemeinsamen Stand: Zähler und Übersicht
  for (const name of ['friends', 'conversations', 'party', 'worlds', 'hosting']) {
    on(name, () => {
      updateBadges();
      pushOverview();
    });
  }
  $('#konto-erneut').addEventListener('click', start);
  $('#block-form').addEventListener('submit', onBlockSubmit);
  $('#export').addEventListener('click', exportData);
  $('#sitzungen-andere').addEventListener('click', endOtherSessions);
  $('#sitzungen-andere .sec-logout-icon')?.replaceWith(shellIcon('logout'));
  $('#loeschen').addEventListener('click', deleteEverything);
  $('#support-neu').addEventListener('click', openSupportForm);
  $('#support-abbrechen').addEventListener('click', supportBack);
  for (const back of document.querySelectorAll('[data-support-back]')) back.addEventListener('click', supportBack);
  $('#support-form').addEventListener('submit', onSupportSubmit);
  // Fehlerhinweise verschwinden, sobald man weiterschreibt.
  $('#support-form').addEventListener('input', () => {
    $('#support-fehler').hidden = true;
  });
  $('#ticket-antwort').addEventListener('input', () => {
    $('#ticket-fehler').hidden = true;
  });
  $('#ticket-antwort').addEventListener('submit', onTicketReply);
  $('#ticket-schliessen').addEventListener('click', closeTicket);
  bindCounter($('#support-betreff'), $('#support-betreff-zaehler'), MAX_SUBJECT);
  bindCounter($('#support-text'), $('#support-text-zaehler'), MAX_TICKET_TEXT);
  bindCounter($('#ticket-text'), $('#ticket-zaehler'), MAX_TICKET_TEXT);
  // Neuer Einmal-Link, während die Seite offen ist: neu anmelden. Bereiche (#reiter=…) wechselt die Shell selbst.
  window.addEventListener('hashchange', () => {
    if (/(^|&)(code|ziel|fehler)=/.test(location.hash.slice(1))) start();
    // Alter Link #reiter=freunde&teil=einladen
    else if (/(^|&)teil=einladen(&|$)/.test(location.hash.slice(1)) && !$('#konto-app').hidden) shell.select('einladen', { history: 'replace' });
  });
  start();
}

init();
