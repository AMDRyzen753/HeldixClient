// HeldixClient – Webseite: Konto-Bereich (/konto). Anmeldung per Einmal-Link aus Launcher oder Spiel (#code=…) oder
// mit dem Minecraft-Konto (anmelden.js: Knopf zum Dienst, zurück mit #code=… oder #fehler=<code>),
// danach Übersicht und Glocke (konto-uebersicht.js), Cape & Cosmetics (konto-cosmetics.js), Freunde, Nachrichten,
// Support, Meine Addons (konto-addons.js), Privatsphäre, Sicherheit und Meine Daten über die Cookie-Sitzung beim
// Heldix-Dienst. Rahmen mit Seitenleiste (auch zum Team-Bereich): app-shell.js.
// Ein Ziel im Link (#code=…&ziel=support) öffnet nach der Anmeldung den passenden Bereich, ziel=team die Seite /team;
// ohne Anmeldung genügen #reiter=support (oder ältere Links wie #support und #ziel=support). Weitere Werte in der
// Adresse: #reiter=nachrichten&mit=<uuid> öffnet den Chat, #reiter=support&anfrage=<id> die Anfrage.
//
// Nachfragen (nur solange die Seite sichtbar ist): Freunde und Unterhaltungen alle 10 s, Support alle 15 s, eigene
// Addons alle 15 s im Reiter „Meine Addons“ und sonst höchstens jede Minute (für Übersicht und Glocke).
import {
  $,
  ApiError,
  activity,
  api,
  avatar,
  bindCounter,
  busy,
  confirmAction,
  dayLabel,
  emptyState,
  flashSaved,
  formatDate,
  formatDateTime,
  formatTime,
  h,
  icon,
  isPlayerName,
  loadingState,
  openDialog,
  poller,
  reasonLabel,
  relativeTime,
  REPORT_REASONS,
  rerender,
  ROLE_LABELS,
  setSkinSource,
  shortWhen,
  showError,
  textBlocks,
  timeEl,
  toast,
  uid,
} from './app-common.js';
import { loginErrorText, minecraftLoginAvailable, setupMinecraftLogin } from './anmelden.js';
import { createShell, parseShellHash, sectionHref, shellIcon } from './app-shell.js';
import { initMyAddons } from './konto-addons.js';
import { initCosmetics } from './konto-cosmetics.js';
import { initOverview } from './konto-uebersicht.js';
import { attachmentList, normalizeAttachments } from './support-attachments.js';

// Alle Spielerbilder auf dieser Seite: Minecraft-Köpfe über die Cookie-Sitzung (sonst Initialen).
setSkinSource('auth');

const SETTINGS = [
  ['visible', 'Für andere erkennbar', 'Andere HeldixClient-Spieler sehen das Heldix-Symbol vor deinem Namen und dein Cape.'],
  ['presence', 'Online-Status für Freunde', 'Freunde sehen, ob du online bist und ob du im Menü oder im Spiel bist.'],
  ['showServer', 'Server für Freunde sichtbar', 'Freunde sehen, auf welchem öffentlichen Server du spielst, und können beitreten.'],
  ['messages', 'Nachrichten von Freunden', 'Freunde können dir Nachrichten schicken.'],
];

const POLL_MS = 10_000;
const PAGE_SIZE = 50;
const MAX_MESSAGE = 500;
const MAX_NOTE = 300;

const state = {
  me: null,
  friends: null, // { friends, incoming, outgoing }
  conversations: null, // [{ uuid, name, last, unread }]
  chat: null, // { uuid, name, messages, more, loadingOlder }
  sessions: null,
  support: { tickets: null, ticket: null },
  ended: false,
};

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
const refresher = poller(refreshLive, POLL_MS);
const supportRefresher = poller(() => refreshSupport(), 15_000);
/** Ziele aus dem Einmal-Link (#code=…&ziel=…), siehe Spezifikation 2 §6. */
const TARGETS = new Set(['uebersicht', 'profil', 'freunde', 'nachrichten', 'privatsphaere', 'sicherheit', 'daten', 'support', 'addons', 'team']);

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
  refresher.stop();
  supportRefresher.stop();
  myAddons?.stop();
  cosmetics?.stop();
  overview?.reset();
  for (const dialog of document.querySelectorAll('dialog.modal')) dialog.remove();
  showGuest(message);
}

// ---------------------------------------------------------------------------------------------------------
// Ansichten: laden, Fehler, Gast, angemeldet
// ---------------------------------------------------------------------------------------------------------

function showView(id) {
  for (const view of ['konto-laden', 'konto-fehler', 'konto-gast', 'konto-app']) $(`#${view}`).hidden = view !== id;
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
  // Zurück von der Anmeldung mit dem Minecraft-Konto, aber nicht geklappt: Text zum Code (nie der Code selbst)
  if (params.has('fehler')) notice = loginErrorText(params.get('fehler'));
  if (code !== null) {
    try {
      const me = await api('POST', '/v1/web/session', { code });
      if (target === 'team') {
        location.replace('/team');
        return;
      }
      showApp(me, target);
      toast(`Willkommen, ${me.name}! Du bist jetzt angemeldet.`, 'success');
      return;
    } catch (error) {
      if (error.status === 0 || error.status >= 500) return showUnavailable(error);
      notice = error.message;
    }
  }
  try {
    const me = await api('GET', '/v1/web/me');
    if (target === 'team' && !notice) {
      location.replace('/team');
      return;
    }
    showApp(me, target === 'team' ? null : target);
    if (notice) toast(notice, 'error');
  } catch (error) {
    if (error.status === 401) {
      const hint = target === 'support' ? 'Für eine Support-Anfrage meldest du dich zuerst an – ohne Passwort, über den Launcher oder im Spiel (siehe unten). Danach öffnet sich der Bereich Support.' : target ? 'Melde dich zuerst an – ohne Passwort, über den Launcher oder im Spiel (siehe unten).' : null;
      showGuest(notice ?? hint, target);
    }
    else showUnavailable(error);
  }
}

function showApp(me, target = null) {
  state.me = me;
  state.ended = false;
  state.sessions = null;
  renderHeader();
  renderSettings();
  overview.setUser(me);
  cosmetics.setUser(me);
  renderTwoFactor();
  showView('konto-app');
  const address = parseShellHash();
  const wanted = target ?? address.section;
  shell.select(shell.has(wanted) ? wanted : DEFAULT_SECTION, { params: target ? null : address.extra });
  refreshFriends().catch(showError);
  refreshConversations().catch(() => {});
  if (wanted !== 'support') refreshSupportList().catch(() => {});
  if (wanted !== 'addons') myAddons.refreshInBackground().catch(() => {});
  if (wanted !== 'sicherheit') loadSessions().catch(() => {});
  refresher.start();
  supportRefresher.start();
}

/** Kopfzeile und Seitenleiste: eigener Spieler, Rolle (Team-Gruppe nur mit Rolle), Ablauf der Sitzung. */
function renderHeader() {
  const { me } = state;
  shell.setUser(me);
  shell.setMeta(['Angemeldet beim Heldix-Dienst', me.expiresAt ? `Sitzung gültig bis spätestens ${formatDate(me.expiresAt)}` : null]);
}

/** Bereich gewechselt. params: weitere Werte aus der Adresse oder einem Eintrag der Glocke (mit, anfrage). */
function onTab(name, { params = null } = {}) {
  if (name === 'freunde') refreshFriends().catch(showError);
  if (name === 'nachrichten') {
    const uuid = typeof params?.mit === 'string' && /^[0-9a-f]{32}$/.test(params.mit) ? params.mit : null;
    if (uuid && state.chat?.uuid !== uuid) openChat(uuid);
    else if (state.chat) markRead(state.chat.uuid);
    refreshConversations().catch(showError);
  }
  if (name === 'privatsphaere') {
    loadBlocks().catch(showError);
    loadReports().catch(showError);
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
    if (ticket !== null && state.support.ticket?.id !== ticket) openTicket(ticket);
    else if (state.support.ticket?.id) refreshOpenTicket().catch(() => {});
  }
}

/** Profil neu holen (Zwei-Faktor-Stand, Rolle) – beim Öffnen von „Sicherheit“. */
async function refreshMe() {
  const me = await call('GET', '/v1/web/me');
  if (state.ended || !me) return;
  const roleChanged = me.role !== state.me.role;
  state.me = { ...state.me, ...me };
  if (roleChanged) renderHeader();
  renderTwoFactor();
  overview.update({ me: state.me });
}

/** Alle 10 Sekunden (solange sichtbar): Freunde, Unterhaltungen und der offene Chat. */
async function refreshLive() {
  if (state.ended) return;
  await Promise.all([refreshFriends(), refreshConversations(), shell.current() === 'nachrichten' && state.chat ? refreshChat() : null]);
}

// ---------------------------------------------------------------------------------------------------------
// Profil: Einstellungen (Cape und Cosmetics: konto-cosmetics.js)
// ---------------------------------------------------------------------------------------------------------

// Änderungen nacheinander speichern, damit schnelle Klicks in der richtigen Reihenfolge ankommen.
let saving = Promise.resolve();

/** Aufgabe in die Reihe der Speichervorgänge stellen (Einstellungen, Cape, Cosmetics). */
function enqueue(task) {
  saving = saving.then(task, task);
  return saving;
}

/** Profil geändert (z. B. Cape): Hinweise, Übersicht. */
function applyMe(patch) {
  state.me = { ...state.me, ...patch };
  updateProfileHints();
  overview.update({ me: state.me });
}

async function saveSettings(patch, savedElement, savedText) {
  try {
    const me = await call('PUT', '/v1/me', patch);
    applyMe(me ?? {});
    flashSaved(savedElement, savedText);
    return true;
  } catch (error) {
    showError(error);
    // Den Stand des Dienstes zeigen, also den alten Wert.
    if (!state.ended) {
      cosmetics.render();
      renderSettings();
    }
    return false;
  }
}

function renderSettings() {
  rerender($('#einstellungen'), undefined, () =>
    SETTINGS.map(([key, label, description]) => {
      const descriptionId = `einstellung-${key}`;
      const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', name: key, 'aria-describedby': descriptionId, dataset: { focusKey: `setting:${key}` } });
      input.checked = state.me[key] !== false;
      return h('label', { class: 'switch-row' }, h('span', { class: 'switch-text' }, h('strong', { text: label }), h('small', { id: descriptionId, text: description })), input);
    }),
  );
  updateProfileHints();
}

/** Hinweise, die von mehreren Einstellungen abhängen. */
function updateProfileHints() {
  $('#cape-unsichtbar').hidden = state.me.visible !== false || !(state.me.cape || cosmetics?.wearsSomething());
  const serverRow = $('#einstellungen [name="showServer"]')?.closest('.switch-row');
  if (serverRow) serverRow.classList.toggle('dim', state.me.presence === false);
}

function onSettingChange(event) {
  const input = event.target;
  if (!input.classList.contains('switch')) return;
  const patch = { [input.name]: input.checked };
  enqueue(() => saveSettings(patch, $('#einstellungen-gespeichert')));
}

// ---------------------------------------------------------------------------------------------------------
// Freunde
// ---------------------------------------------------------------------------------------------------------

async function refreshFriends() {
  const data = await call('GET', '/v1/friends');
  state.friends = {
    friends: Array.isArray(data?.friends) ? data.friends : [],
    incoming: Array.isArray(data?.incoming) ? data.incoming : [],
    outgoing: Array.isArray(data?.outgoing) ? data.outgoing : [],
  };
  renderFriends();
  renderConversations();
  updateBadges();
}

/** Stand für Übersicht und Glocke. */
function pushOverview() {
  overview.update({ me: state.me, friends: state.friends, conversations: state.conversations, tickets: state.support.tickets });
}

function friendByUuid(uuid) {
  return state.friends?.friends.find((friend) => friend.uuid === uuid) ?? null;
}

function renderFriends() {
  const { friends, incoming, outgoing } = state.friends;
  $('#anfragen-karte').hidden = !incoming.length && !outgoing.length;
  rerender($('#anfragen'), JSON.stringify([incoming, outgoing]), () => {
    const parts = [];
    if (incoming.length) {
      parts.push(h('h3', { class: 'list-title', text: `An dich (${incoming.length})` }));
      parts.push(
        h(
          'ul',
          { class: 'rows' },
          incoming.map((request) =>
            h(
              'li',
              { class: 'row' },
              avatar(request.name, request.uuid),
              h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: request.name }), h('div', { class: 'row-sub', text: `möchte mit dir befreundet sein · ${relativeTime(request.at)}` })),
              h(
                'div',
                { class: 'row-actions' },
                h('button', { type: 'button', class: 'button tiny', dataset: { focusKey: `${request.uuid}:accept` }, onClick: (event) => acceptRequest(event.currentTarget, request) }, icon('check'), 'Annehmen'),
                h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `${request.uuid}:decline` }, onClick: (event) => removeRequest(event.currentTarget, request, 'abgelehnt') }, 'Ablehnen'),
              ),
            ),
          ),
        ),
      );
    }
    if (outgoing.length) {
      parts.push(h('h3', { class: 'list-title', text: `Von dir (${outgoing.length})` }));
      parts.push(
        h(
          'ul',
          { class: 'rows' },
          outgoing.map((request) =>
            h(
              'li',
              { class: 'row' },
              avatar(request.name, request.uuid),
              h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: request.name }), h('div', { class: 'row-sub', text: `Anfrage gesendet ${relativeTime(request.at)}` })),
              h(
                'div',
                { class: 'row-actions' },
                h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `${request.uuid}:withdraw` }, onClick: (event) => removeRequest(event.currentTarget, request, 'zurückgezogen') }, 'Zurückziehen'),
              ),
            ),
          ),
        ),
      );
    }
    return parts;
  });

  $('#freunde-anzahl').textContent = friends.length ? `(${friends.length})` : '';
  const sorted = [...friends].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  rerender($('#freunde'), JSON.stringify(sorted), () => {
    if (!sorted.length) return emptyState('Noch keine Freunde. Schick oben eine Anfrage mit dem Spielernamen.', 'friends');
    return h(
      'ul',
      { class: 'rows' },
      sorted.map((friend) =>
        h(
          'li',
          { class: 'row' },
          avatar(friend.name, friend.uuid, { online: Boolean(friend.online) }),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title', text: friend.name }),
            h('div', { class: `row-sub${friend.online ? ' online' : ''}`, text: activity(friend) }),
            friend.since ? h('div', { class: 'row-meta', text: `Freunde seit ${formatDate(friend.since)}` }) : null,
          ),
          h(
            'div',
            { class: 'row-actions' },
            h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `${friend.uuid}:chat` }, onClick: () => openChatFromFriends(friend.uuid) }, icon('chat'), 'Nachricht'),
            h(
              'button',
              { type: 'button', class: 'button tiny ghost quiet-danger', 'aria-label': `${friend.name} entfernen`, dataset: { focusKey: `${friend.uuid}:remove` }, onClick: () => removeFriend(friend) },
              icon('trash'),
              h('span', { class: 'label', text: 'Entfernen' }),
            ),
          ),
        ),
      ),
    );
  });
}

async function onFriendSubmit(event) {
  event.preventDefault();
  const input = $('#freund-name');
  const error = $('#freund-fehler');
  const name = input.value.trim();
  error.hidden = true;
  if (!isPlayerName(name)) {
    error.textContent = 'Ein Spielername hat 1 bis 16 Zeichen: Buchstaben, Ziffern und _.';
    error.hidden = false;
    input.focus();
    return;
  }
  const button = event.currentTarget.querySelector('button[type="submit"]');
  try {
    const data = await busy(button, () => call('POST', '/v1/friends/requests', { name }));
    state.friends = { friends: data.friends ?? [], incoming: data.incoming ?? [], outgoing: data.outgoing ?? [] };
    renderFriends();
    updateBadges();
    input.value = '';
    const friend = state.friends.friends.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    toast(friend ? `Ihr seid jetzt Freunde: ${friend.name} hatte dir schon eine Anfrage geschickt.` : `Anfrage an ${name} gesendet.`, 'success');
  } catch (problem) {
    if (problem.status === 401) return;
    error.textContent = problem.message;
    error.hidden = false;
    input.focus();
  }
}

async function acceptRequest(button, request) {
  try {
    const data = await busy(button, () => call('POST', `/v1/friends/requests/${request.uuid}/accept`));
    applyFriends(data);
    toast(`Du bist jetzt mit ${request.name} befreundet.`, 'success');
  } catch (error) {
    showError(error);
  }
}

async function removeRequest(button, request, verb) {
  try {
    const data = await busy(button, () => call('DELETE', `/v1/friends/requests/${request.uuid}`));
    applyFriends(data);
    toast(`Anfrage ${verb === 'abgelehnt' ? 'von' : 'an'} ${request.name} ${verb}.`);
  } catch (error) {
    showError(error);
  }
}

async function removeFriend(friend) {
  const ok = await confirmAction({
    title: `${friend.name} entfernen?`,
    text: `Ihr seht euch nicht mehr in der Freundesliste, und eure Nachrichten werden gelöscht. ${friend.name} erfährt es nicht ausdrücklich, sieht dich aber nicht mehr als Freund.`,
    confirmLabel: 'Entfernen',
    danger: true,
    onConfirm: async () => applyFriends(await call('DELETE', `/v1/friends/${friend.uuid}`)),
  });
  if (!ok) return;
  if (state.chat?.uuid === friend.uuid) closeChat();
  refreshConversations().catch(() => {});
  toast(`${friend.name} ist nicht mehr in deiner Freundesliste.`);
}

function applyFriends(data) {
  if (!data) return;
  state.friends = { friends: data.friends ?? [], incoming: data.incoming ?? [], outgoing: data.outgoing ?? [] };
  renderFriends();
  renderConversations();
  updateBadges();
}

function updateBadges() {
  const incoming = state.friends?.incoming.length ?? 0;
  const unread = (state.conversations ?? []).reduce((sum, conversation) => sum + (conversation.unread || 0), 0);
  shell.setBadge('freunde', incoming, { label: incoming === 1 ? '1 offene Anfrage' : `${incoming} offene Anfragen` });
  shell.setBadge('nachrichten', unread, { label: `${unread} ungelesen` });
  document.title = `${unread ? `(${unread}) ` : ''}Konto – HeldixClient`;
  pushOverview();
}

// ---------------------------------------------------------------------------------------------------------
// Nachrichten
// ---------------------------------------------------------------------------------------------------------

async function refreshConversations() {
  const data = await call('GET', '/v1/messages');
  state.conversations = Array.isArray(data?.conversations) ? data.conversations : [];
  // Offener Chat: neue Nachrichten gelten als gelesen, sobald man hinsieht.
  if (state.chat && shell.current() === 'nachrichten' && document.visibilityState === 'visible') {
    const open = state.conversations.find((conversation) => conversation.uuid === state.chat.uuid);
    if (open && open.unread) markRead(open.uuid);
  }
  renderConversations();
  updateBadges();
}

function renderConversations() {
  const list = $('#unterhaltungen');
  if (!state.conversations || !state.friends) {
    if (!list.firstChild) list.replaceChildren(loadingState());
    return;
  }
  const conversations = state.conversations;
  const withChat = new Set(conversations.map((conversation) => conversation.uuid));
  const others = state.friends.friends.filter((friend) => !withChat.has(friend.uuid)).sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
  const openUuid = state.chat?.uuid ?? '';
  const signature = JSON.stringify([conversations, others.map((friend) => [friend.uuid, friend.name, friend.online]), openUuid]);
  rerender(list, signature, () => {
    if (!conversations.length && !others.length) {
      return emptyState('Noch keine Freunde – Nachrichten gehen nur an Freunde.', 'chat');
    }
    const parts = [];
    if (conversations.length) {
      parts.push(
        h(
          'ul',
          { class: 'conv-items', 'aria-label': 'Unterhaltungen' },
          conversations.map((conversation) => {
            const friend = friendByUuid(conversation.uuid);
            const mine = conversation.last && conversation.last.from === state.me.uuid;
            const preview = conversation.last ? `${mine ? 'Du: ' : ''}${conversation.last.text}` : '';
            return h(
              'li',
              null,
              h(
                'button',
                {
                  type: 'button',
                  class: `conv${conversation.unread ? ' unread' : ''}`,
                  'aria-current': conversation.uuid === openUuid ? 'true' : undefined,
                  dataset: { focusKey: `conv:${conversation.uuid}` },
                  onClick: () => openChat(conversation.uuid),
                },
                avatar(conversation.name, conversation.uuid, { online: friend ? Boolean(friend.online) : null }),
                h(
                  'span',
                  { class: 'conv-main' },
                  h('span', { class: 'conv-top' }, h('span', { class: 'conv-name', text: conversation.name }), h('span', { class: 'conv-time', text: shortWhen(conversation.last?.at) })),
                  h(
                    'span',
                    { class: 'conv-bottom' },
                    h('span', { class: 'conv-preview', text: preview }),
                    conversation.unread ? h('span', { class: 'unread-badge', text: String(conversation.unread), 'aria-label': `${conversation.unread} ungelesen` }) : null,
                  ),
                ),
              ),
            );
          }),
        ),
      );
    }
    if (others.length) {
      parts.push(h('p', { class: 'conv-section', text: conversations.length ? 'Weitere Freunde' : 'Freunde' }));
      parts.push(
        h(
          'ul',
          { class: 'conv-items', 'aria-label': 'Weitere Freunde' },
          others.map((friend) =>
            h(
              'li',
              null,
              h(
                'button',
                { type: 'button', class: 'conv', 'aria-current': friend.uuid === openUuid ? 'true' : undefined, dataset: { focusKey: `conv:${friend.uuid}` }, onClick: () => openChat(friend.uuid) },
                avatar(friend.name, friend.uuid, { online: Boolean(friend.online) }),
                h('span', { class: 'conv-main' }, h('span', { class: 'conv-top' }, h('span', { class: 'conv-name', text: friend.name })), h('span', { class: 'conv-bottom' }, h('span', { class: 'conv-preview muted', text: 'Unterhaltung beginnen' }))),
              ),
            ),
          ),
        ),
      );
    }
    return parts;
  });
  if (state.chat) renderChatHead();
}

function openChatFromFriends(uuid) {
  shell.select('nachrichten');
  openChat(uuid);
}

async function openChat(uuid) {
  const friend = friendByUuid(uuid);
  const conversation = state.conversations?.find((entry) => entry.uuid === uuid);
  const name = friend?.name ?? conversation?.name ?? 'Freund';
  state.chat = { uuid, name, messages: [], more: false, loadingOlder: false, loaded: false };
  $('#chat').classList.add('chat-open');
  $('#chat-leer').hidden = true;
  $('#chat-aktiv').hidden = false;
  $('#chat-fehler').hidden = true;
  renderChatHead();
  renderConversations();
  $('#chat-verlauf').replaceChildren(loadingState('Nachrichten werden geladen …'));
  // Auf dem Handy nicht gleich die Tastatur öffnen (sie würde den Verlauf verdecken).
  if (window.matchMedia('(min-width: 761px)').matches) {
    $('#chat-text').focus();
  } else {
    $('#chat-verlauf').focus({ preventScroll: true });
    $('#chat').scrollIntoView({ block: 'start' });
  }
  try {
    const data = await call('GET', `/v1/messages/${uuid}?limit=${PAGE_SIZE}`);
    if (state.chat?.uuid !== uuid) return;
    state.chat.messages = Array.isArray(data?.messages) ? data.messages : [];
    state.chat.more = Boolean(data?.more);
    state.chat.loaded = true;
    renderMessages('bottom');
    markRead(uuid);
  } catch (error) {
    if (state.chat?.uuid !== uuid) return;
    if (error.status === 404) {
      closeChat();
      toast(error.message, 'error');
      refreshFriends().catch(() => {});
      return;
    }
    $('#chat-verlauf').replaceChildren(emptyState(error.message, 'warning'));
  }
}

function closeChat() {
  state.chat = null;
  $('#chat').classList.remove('chat-open');
  $('#chat-leer').hidden = false;
  $('#chat-aktiv').hidden = true;
  renderConversations();
}

function renderChatHead() {
  const { chat } = state;
  if (!chat) return;
  const friend = friendByUuid(chat.uuid);
  $('#chat-avatar').replaceChildren(avatar(chat.name, chat.uuid, { online: friend ? Boolean(friend.online) : null }));
  $('#chat-name').textContent = chat.name;
  const status = $('#chat-status');
  status.textContent = friend ? activity(friend) : '';
  status.classList.toggle('online', Boolean(friend?.online));
}

function messageNode(message, showTime) {
  const mine = message.from === state.me.uuid;
  return h(
    'div',
    { class: `msg ${mine ? 'mine' : 'theirs'}${showTime ? '' : ' grouped'}`, dataset: { id: String(message.id) } },
    h('span', { class: 'visually-hidden', text: mine ? 'Du: ' : `${state.chat.name}: ` }),
    h('div', { class: 'bubble', text: message.text }),
    showTime ? timeEl(message.at, formatTime(message.at)) : null,
  );
}

function renderMessages(scroll) {
  const box = $('#chat-verlauf');
  const { chat } = state;
  const previousHeight = box.scrollHeight;
  const previousTop = box.scrollTop;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const nodes = [];
  if (chat.more) {
    nodes.push(
      h(
        'div',
        { class: 'older' },
        h('button', { type: 'button', class: 'button tiny ghost', id: 'chat-aeltere', disabled: chat.loadingOlder || undefined, onClick: loadOlder }, chat.loadingOlder ? 'Wird geladen …' : 'Ältere Nachrichten laden'),
      ),
    );
  }
  if (!chat.messages.length) {
    nodes.push(h('div', { class: 'chat-start' }, h('p', { text: `Noch keine Nachrichten mit ${chat.name}. Schreib die erste!` })));
  }
  let lastDay = null;
  chat.messages.forEach((message, index) => {
    const day = dayLabel(message.at);
    if (day !== lastDay) {
      nodes.push(h('div', { class: 'day-sep', role: 'separator', text: day }));
      lastDay = day;
    }
    const next = chat.messages[index + 1];
    const showTime = !next || next.from !== message.from || next.at - message.at > 5 * 60 * 1000 || dayLabel(next.at) !== day;
    nodes.push(messageNode(message, showTime));
  });
  box.replaceChildren(...nodes);
  if (scroll === 'bottom' || (scroll === 'auto' && nearBottom)) box.scrollTop = box.scrollHeight;
  else if (scroll === 'keep-older') box.scrollTop = box.scrollHeight - previousHeight + previousTop;
  else box.scrollTop = previousTop;
}

async function loadOlder() {
  const { chat } = state;
  if (!chat || chat.loadingOlder || !chat.messages.length) return;
  const uuid = chat.uuid;
  chat.loadingOlder = true;
  renderMessages('keep');
  try {
    const data = await call('GET', `/v1/messages/${uuid}?before=${chat.messages[0].id}&limit=${PAGE_SIZE}`);
    if (state.chat?.uuid !== uuid) return;
    const known = new Set(chat.messages.map((message) => message.id));
    chat.messages = [...(data.messages ?? []).filter((message) => !known.has(message.id)), ...chat.messages];
    chat.more = Boolean(data.more);
  } catch (error) {
    showError(error);
  } finally {
    if (state.chat?.uuid === uuid) {
      chat.loadingOlder = false;
      renderMessages('keep-older');
      const older = $('#chat-aeltere');
      if (older) older.focus();
      else $('#chat-verlauf').focus();
    }
  }
}

/** Beim Nachfragen nur neue Nachrichten anhängen (die neueste Seite holen und abgleichen). */
async function refreshChat() {
  const { chat } = state;
  if (!chat || !chat.loaded) return;
  const uuid = chat.uuid;
  let data;
  try {
    data = await call('GET', `/v1/messages/${uuid}?limit=${PAGE_SIZE}`);
  } catch (error) {
    if (error.status === 404 && state.chat?.uuid === uuid) {
      closeChat();
      toast(error.message, 'error');
    }
    return;
  }
  if (state.chat?.uuid !== uuid) return;
  const latest = Array.isArray(data?.messages) ? data.messages : [];
  const lastId = chat.messages.length ? chat.messages[chat.messages.length - 1].id : 0;
  const fresh = latest.filter((message) => message.id > lastId);
  // Nachrichten, die es nicht mehr gibt (z. B. nach 30 Tagen gelöscht), aus der Ansicht nehmen.
  const oldestLatest = latest.length ? latest[0].id : Infinity;
  const stillThere = new Set(latest.map((message) => message.id));
  const kept = chat.messages.filter((message) => message.id < oldestLatest || stillThere.has(message.id));
  if (!fresh.length && kept.length === chat.messages.length) return;
  chat.messages = [...kept, ...fresh];
  if (!chat.messages.length) chat.more = Boolean(data.more);
  renderMessages('auto');
}

const readPending = new Set();
async function markRead(uuid) {
  const conversation = state.conversations?.find((entry) => entry.uuid === uuid);
  if (!conversation || !conversation.unread || readPending.has(uuid)) return;
  readPending.add(uuid);
  try {
    await call('POST', `/v1/messages/${uuid}/read`);
    conversation.unread = 0;
    // Inzwischen neu geladen (älterer Stand vom Dienst): auch dort als gelesen führen.
    for (const entry of state.conversations ?? []) if (entry.uuid === uuid) entry.unread = 0;
    renderConversations();
    updateBadges();
  } catch {
    // Beim nächsten Nachfragen erneut.
  } finally {
    readPending.delete(uuid);
  }
}

async function onSend(event) {
  event.preventDefault();
  const { chat } = state;
  if (!chat) return;
  const input = $('#chat-text');
  const error = $('#chat-fehler');
  const text = input.value.replace(/[\r\n]+/g, ' ').trim();
  error.hidden = true;
  if (!text) return;
  if ([...text].length > MAX_MESSAGE) {
    error.textContent = `Die Nachricht ist zu lang (höchstens ${MAX_MESSAGE} Zeichen).`;
    error.hidden = false;
    return;
  }
  const uuid = chat.uuid;
  const button = $('#chat-senden');
  input.readOnly = true;
  try {
    const data = await busy(button, () => call('POST', `/v1/messages/${uuid}`, { text }));
    if (state.chat?.uuid === uuid && data?.message && !chat.messages.some((message) => message.id === data.message.id)) {
      chat.messages.push(data.message);
      renderMessages('bottom');
    }
    input.value = '';
    input.dispatchEvent(new Event('input'));
    refreshConversations().catch(() => {});
  } catch (problem) {
    if (problem.status !== 401) {
      error.textContent = problem.message;
      error.hidden = false;
    }
  } finally {
    input.readOnly = false;
    input.focus();
  }
}

async function reportPlayer() {
  const { chat } = state;
  if (!chat) return;
  const name = chat.name;
  const uuid = chat.uuid;
  const groupName = uid('grund');
  const noteId = uid('notiz');
  const counter = h('span', { class: 'counter', text: `0/${MAX_NOTE}` });
  const note = h('input', { class: 'input', id: noteId, maxlength: String(MAX_NOTE), autocomplete: 'off', placeholder: 'Was ist passiert?' });
  note.addEventListener('input', () => {
    counter.textContent = `${[...note.value].length}/${MAX_NOTE}`;
  });
  const reasons = h(
    'fieldset',
    { class: 'choices' },
    h('legend', { text: 'Grund' }),
    REPORT_REASONS.map(([id, label]) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: groupName, value: id }), h('span', { text: label }))),
  );
  const ok = await openDialog({
    title: `${name} melden`,
    body: [
      h('p', { text: `Melde ${name}, wenn er dich belästigt, spammt oder gegen die Regeln verstößt.` }),
      reasons,
      h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { for: noteId, text: 'Hinweis (freiwillig)' }), counter), note),
      h(
        'p',
        { class: 'info-box small' },
        icon('info'),
        h('span', { text: `Mit der Meldung gehen die letzten 20 Nachrichten eures Chats an den Betreiber des Heldix-Dienstes und sein Team, damit sie den Fall prüfen können. ${name} erfährt nicht, wer ihn gemeldet hat.` }),
      ),
    ],
    confirmLabel: 'Meldung senden',
    canConfirm: () => Boolean(reasons.querySelector('input:checked')),
    focus: 'input[type="radio"]',
    onConfirm: async () => {
      const reason = reasons.querySelector('input:checked')?.value;
      const text = note.value.replace(/[\r\n]+/g, ' ').trim();
      await call('POST', '/v1/reports', { uuid, reason, ...(text ? { note: text } : {}) });
    },
  });
  if (ok) toast(`Danke! Deine Meldung zu ${name} ist beim Team. Du kannst ${name} zusätzlich blockieren.`, 'success');
}

async function blockPlayer(target) {
  const friend = friendByUuid(target.uuid);
  const ok = await confirmAction({
    title: `${target.name} blockieren?`,
    text: [
      friend
        ? `Eure Freundschaft endet, eure Nachrichten werden gelöscht, und ${target.name} kann dir keine Anfragen mehr schicken.`
        : `${target.name} kann dir keine Anfragen mehr schicken.`,
      `${target.name} erfährt nicht, dass du blockiert hast. Freigeben kannst du später unter Privatsphäre.`,
    ],
    confirmLabel: 'Blockieren',
    danger: true,
    onConfirm: () => call('POST', '/v1/blocks', target.uuid ? { uuid: target.uuid } : { name: target.name }),
  });
  if (!ok) return false;
  if (state.chat && state.chat.uuid === target.uuid) closeChat();
  toast(`${target.name} ist blockiert.`, 'success');
  refreshFriends().catch(() => {});
  refreshConversations().catch(() => {});
  return true;
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
            h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `${entry.uuid}:unblock` }, onClick: (event) => unblock(event.currentTarget, entry) }, 'Freigeben'),
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
  const friend = state.friends?.friends.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  try {
    const blocked = await blockPlayer(friend ? { uuid: friend.uuid, name: friend.name } : { name });
    if (!blocked) return;
    input.value = '';
    await loadBlocks();
  } catch (problem) {
    if (problem.status === 401) return;
    error.textContent = problem.message;
    error.hidden = false;
  }
}

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
            h('div', { class: 'row-title' }, h('span', { text: report.reported?.name ?? 'Unbekannt' }), h('span', { class: report.status === 'done' ? 'chip success' : 'chip warning', text: report.status === 'done' ? 'Erledigt' : 'Offen' })),
            h('div', { class: 'row-sub', text: `${reasonLabel(report.reason)} · ${formatDate(report.at)}` }),
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
  const role = ROLE_LABELS[me.role] ?? me.role;
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
  if (twoFactor.enabled && me.role === 'admin') actions.push(h('a', { class: 'button small ghost', href: sectionHref('team', 'team'), id: 'zweifaktor-verwalten' }, icon('friends'), 'Mitglieder und 2FA verwalten'));
  $('#zweifaktor-aktionen').replaceChildren(...actions);
  $('#zweifaktor-hilfe').textContent = twoFactor.enabled
    ? 'Neues Handy oder App verloren? Ein Admin kann deine Zwei-Faktor-Anmeldung zurücksetzen (Team → Team). Danach richtest du sie im Team-Bereich neu ein.'
    : 'Du brauchst eine Authenticator-App (z. B. Aegis, 2FAS, Google oder Microsoft Authenticator). Der Team-Bereich zeigt dir den Schlüssel und fragt einmal nach einem Code.';
}

async function logout() {
  try {
    await busy($('#konto-abmelden'), () => api('POST', '/v1/web/logout'));
  } catch (error) {
    if (error.status !== 401) return showError(error);
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
      h('p', { text: 'Das lässt sich nicht rückgängig machen. Freundschaften, Nachrichten und Einstellungen sind danach weg, und du wirst überall abgemeldet.' }),
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
  shell.mountOverview($('#uebersicht-kacheln'));
  const goTo = (section, then) => {
    shell.select(section, { history: 'push', scroll: true, source: 'user' });
    $('#shell-titel').focus({ preventScroll: true });
    if (then) requestAnimationFrame(then);
  };
  overview = initOverview({
    shell,
    actions: {
      freund: () => goTo('freunde', () => $('#freund-name').focus()),
      nachricht: () => goTo('nachrichten', () => $('#unterhaltungen .conv')?.focus()),
      cosmetics: () => goTo('profil'),
      support: () => goTo('support', () => (!$('#support-neu').disabled ? openSupportForm() : $('#support-limit').scrollIntoView({ block: 'nearest' }))),
      addon: () => goTo('addons', () => myAddons.openWizard()),
    },
  });
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
    saveCape: (cape, savedText) => saveSettings({ cape }, $('#cape-gespeichert'), savedText),
    onLook: (look) => {
      overview.update({ look });
      updateProfileHints();
    },
  });
  $('#konto-erneut').addEventListener('click', start);
  $('#einstellungen').addEventListener('change', onSettingChange);
  $('#freund-form').addEventListener('submit', onFriendSubmit);
  $('#chat-form').addEventListener('submit', onSend);
  $('#chat-zurueck').addEventListener('click', () => {
    const uuid = state.chat?.uuid;
    closeChat();
    const item = uuid && $$focusKey(`conv:${uuid}`);
    if (item) item.focus();
  });
  $('#chat-melden').addEventListener('click', reportPlayer);
  $('#chat-blockieren').addEventListener('click', () => state.chat && blockPlayer({ uuid: state.chat.uuid, name: state.chat.name }));
  $('#block-form').addEventListener('submit', onBlockSubmit);
  $('#export').addEventListener('click', exportData);
  $('#sitzungen-andere').addEventListener('click', endOtherSessions);
  $('#sitzungen-andere .sec-logout-icon').replaceWith(shellIcon('logout'));
  $('#loeschen').addEventListener('click', deleteEverything);
  bindCounter($('#chat-text'), $('#chat-zaehler'), MAX_MESSAGE);
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
  });
  start();
}

function $$focusKey(key) {
  return [...document.querySelectorAll('[data-focus-key]')].find((element) => element.dataset.focusKey === key) ?? null;
}

init();
