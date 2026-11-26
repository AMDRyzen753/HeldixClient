// Freunde & Nachrichten (#view-friends, Inhalt in #friends-root). Daten: api.getSocial()/onSocial() und die Nachrichten-Methoden.
// Abzeichen #friends-badge = offene Anfragen + ungelesene Nachrichten.
//
// Aufbau: links die Liste (Hinzufügen, Suche, Anfragen, Online, Offline), rechts die Unterhaltung. Reiter „Blockiert“
// und „Privatsphäre“ ersetzen beide Spalten. Ohne Verbindung zum Heldix-Dienst zeigt die Seite nur den Zustand.
import type { BlockedPlayer, ChatMessage, Friend, FriendRequest, ReportReason, Settings, SocialOverview, SocialPrivacy } from '../shared/api';
import { $, api, confirmDialog, emit, errorMessage, formatDate, h, state, toast, uiIcon } from './core.js';

type Tab = 'friends' | 'blocked' | 'privacy';

/** höchstens so viele Zeichen pro Nachricht (Unicode-Zeichen, wie der Dienst zählt) */
const MAX_LENGTH = 500;
/** ab hier zeigt das Eingabefeld, wie viele Zeichen noch gehen */
const COUNTER_FROM = 440;
const MAX_NOTE = 300;
/** offene Unterhaltung so oft nachladen, solange die Seite sichtbar ist */
const POLL_MS = 4000;
/** Nachrichten mit weniger Abstand bilden eine Gruppe (eine Zeitangabe) */
const GROUP_GAP_MS = 5 * 60_000;
/** ab so vielen Einträgen gibt es ein Suchfeld */
const SEARCH_FROM = 8;

interface Pending {
  key: number;
  text: string;
  at: number;
  status: 'sending' | 'failed';
  error: string | null;
}

interface Chat {
  uuid: string;
  /** älteste zuerst */
  messages: ChatMessage[];
  pending: Pending[];
  more: boolean;
  loaded: boolean;
  loading: boolean;
  loadingOlder: boolean;
  error: string | null;
  /** „Neue Nachrichten“ vor dieser Nachricht (beim Öffnen festgelegt) */
  unreadFrom: number | null;
}

interface ListView {
  layout: HTMLElement;
  addInput: HTMLInputElement;
  addButton: HTMLButtonElement;
  search: HTMLElement;
  searchInput: HTMLInputElement;
  list: HTMLElement;
  chat: HTMLElement;
}

interface ChatView {
  uuid: string;
  head: HTMLElement;
  scroll: HTMLElement;
  jump: HTMLButtonElement;
  input: HTMLInputElement;
  counter: HTMLElement;
  send: HTMLButtonElement;
}

let overview: SocialOverview | null = null;
/** zuletzt angemeldeter Spieler – wechselt er, gehören Unterhaltungen und Entwürfe zum alten Konto */
let lastMe: string | null = null;
let tab: Tab = 'friends';
let selected: string | null = null;
/** openFriendChat() kam, bevor die Liste da war */
let pendingOpen: string | null = null;
let filter = '';
let mode = '';
let listView: ListView | null = null;
let chatView: ChatView | null = null;
let menu: HTMLElement | null = null;
let pollTimer = 0;
let pendingKey = 0;
let joining: string | null = null;
let gameBusy = false;

const chats = new Map<string, Chat>();
const drafts = new Map<string, string>();

let blocked: BlockedPlayer[] | null = null;
let blockedError: string | null = null;
let privacy: SocialPrivacy | null = null;
let privacyError: string | null = null;

// ---------- Hilfen ----------
function root(): HTMLElement {
  return $('#friends-root');
}

/** Seite ist zu sehen (Ansicht aktiv und Fenster nicht minimiert/verdeckt) */
function pageVisible(): boolean {
  return !document.hidden && !!document.querySelector('#view-friends.active');
}

function friendByUuid(uuid: string | null): Friend | undefined {
  return uuid ? overview?.friends.find((f) => f.uuid === uuid) : undefined;
}

function charCount(text: string): number {
  return [...text].length;
}

// als RegExp aus Text: so stehen im Quelltext nur Escape-Folgen, nie die (unsichtbaren) Trennzeichen selbst
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
const DIRECTION_CHARS = new RegExp('[\\u200e\\u200f\\u202a-\\u202e\\u2066-\\u2069]', 'g');

/** Steuerzeichen, Zeilentrenner und Schreibrichtungs-Zeichen nimmt der Dienst nicht an */
function cleanText(text: string): string {
  return text.replace(CONTROL_CHARS, ' ').replace(DIRECTION_CHARS, '').trim();
}

const clockFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
function clock(at: number): string {
  return clockFormat.format(at);
}
function fullTime(at: number): string {
  return new Date(at).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function dayLabel(at: number): string {
  const d = new Date(at);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days === 0) return 'Heute';
  if (days === 1) return 'Gestern';
  if (days > 1 && days < 7) return d.toLocaleDateString('de-DE', { weekday: 'long' });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}
function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'gestern';
  if (days < 30) return `vor ${days} Tagen`;
  return `am ${formatDate(at)}`;
}
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Was der Freund gerade macht, z. B. „Auf hypixel.net“ */
function activityText(friend: Friend): string {
  if (!friend.online) return 'Offline';
  switch (friend.activity) {
    case 'menu': return 'Im Menü';
    case 'singleplayer': return 'Einzelspieler';
    case 'multiplayer': return friend.server ? `Auf ${friend.server}` : 'Mehrspieler';
    case 'realms': return 'Realms';
    case 'lan': return 'LAN-Welt';
    default: return 'Online';
  }
}

function canJoin(friend: Friend): boolean {
  return friend.online && friend.activity === 'multiplayer' && !!friend.server;
}

function countLabel(n: number): string {
  return n > 99 ? '99+' : String(n);
}

// ---------- Köpfe (Gesicht aus dem Skin) ----------
const faces = new Map<string, string | null>();
const faceLoads = new Map<string, Promise<void>>();

/** Gesicht (8×8 bei 8,8) und Hut-Ebene (bei 40,8) aus der Skin-Textur als kleines PNG */
function cropFace(skin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth !== 64 || (image.naturalHeight !== 64 && image.naturalHeight !== 32)) return resolve(null);
      const canvas = document.createElement('canvas');
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return resolve(null);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
      // Grundebene ist im Spiel immer deckend
      const base = ctx.getImageData(0, 0, 8, 8);
      for (let i = 3; i < base.data.length; i += 4) base.data[i] = 255;
      ctx.putImageData(base, 0, 0);
      // Hut-Ebene; alte 64×32-Skins haben dort oft eine volle Fläche, die das Spiel dann ausblendet
      const hat = document.createElement('canvas');
      hat.width = 8;
      hat.height = 8;
      const hatCtx = hat.getContext('2d', { willReadFrequently: true });
      if (hatCtx) {
        hatCtx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
        const pixels = hatCtx.getImageData(0, 0, 8, 8).data;
        let transparent = false;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 128) transparent = true;
        if (image.naturalHeight === 64 || transparent) ctx.drawImage(hat, 0, 0);
      }
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => resolve(null);
    image.src = skin;
  });
}

function faceImage(face: string): HTMLElement {
  return h('img', { class: 'friends-face', src: face, alt: '', draggable: 'false' });
}

function loadFace(uuid: string): void {
  if (faceLoads.has(uuid)) return;
  const load = api.getPlayerSkin(uuid)
    .then((skin) => (skin ? cropFace(skin) : null))
    .then((face) => {
      faces.set(uuid, face);
      if (!face) return;
      document.querySelectorAll<HTMLElement>('[data-face]').forEach((el) => {
        if (el.dataset.face === uuid) el.replaceWith(faceImage(face));
      });
    })
    .catch(() => {
      // später noch einmal versuchen (z. B. nach einem Netzwerkfehler)
      window.setTimeout(() => faceLoads.delete(uuid), 60_000);
    });
  faceLoads.set(uuid, load);
}

/** Kopf des Spielers; bis das Gesicht geladen ist (oder ohne Skin) der Anfangsbuchstabe */
function head(uuid: string, name: string, size: 'sm' | 'md' = 'sm', status?: 'online' | 'offline'): HTMLElement {
  const face = faces.get(uuid);
  let inner: HTMLElement;
  if (face) inner = faceImage(face);
  else {
    inner = h('span', { class: 'friends-face initials', text: (name.match(/[A-Za-z0-9]/)?.[0] ?? '?').toUpperCase() });
    if (face === undefined) {
      inner.dataset.face = uuid;
      loadFace(uuid);
    }
  }
  return h('span', { class: `friends-avatar ${size}${status ? ` ${status}` : ''}` },
    inner,
    status ? h('span', { class: 'friends-dot', title: status === 'online' ? 'Online' : 'Offline' }) : null);
}

// ---------- Abzeichen in der Seitenleiste ----------
function updateBadge(): void {
  const badge = document.querySelector<HTMLElement>('#friends-badge');
  if (!badge) return;
  const requests = overview?.status === 'online' ? overview.incoming.length : 0;
  const unread = overview?.status === 'online' ? overview.unread : 0;
  const count = requests + unread;
  badge.hidden = count === 0;
  badge.textContent = countLabel(count);
  const parts: string[] = [];
  if (requests) parts.push(requests === 1 ? '1 Anfrage' : `${requests} Anfragen`);
  if (unread) parts.push(unread === 1 ? '1 ungelesene Nachricht' : `${unread} ungelesene Nachrichten`);
  badge.title = parts.join(', ');
}

// ---------- Daten ----------
function applyOverview(next: SocialOverview): void {
  // Neu-Anmeldung desselben Kontos im Hintergrund: Liste stehen lassen statt kurz „Verbinde …“ zu zeigen
  if (next.status === 'connecting' && overview?.status === 'online' && next.me && next.me.uuid === overview.me?.uuid) return;

  if (next.me) {
    if (lastMe && next.me.uuid !== lastMe) resetAccountData();
    lastMe = next.me.uuid;
  }
  const wasOnline = overview?.status === 'online';
  overview = next;
  if (next.status === 'online') {
    // wieder verbunden (eingeschaltet, Fehler behoben): mit der Freundesliste anfangen
    if (!wasOnline) tab = 'friends';
    if (pendingOpen && next.friends.some((f) => f.uuid === pendingOpen)) {
      tab = 'friends';
      selected = pendingOpen;
    }
    pendingOpen = null;
    if (selected && !next.friends.some((f) => f.uuid === selected)) {
      // entfernt oder blockiert (auch von der anderen Seite)
      chats.delete(selected);
      selected = null;
    }
  }
  updateBadge();
  render();
  // ungelesene Nachrichten in der offenen Unterhaltung: sofort holen und als gelesen markieren
  const friend = friendByUuid(selected);
  if (friend && friend.unread > 0 && chatView?.uuid === friend.uuid && pageVisible()) {
    if (chats.get(friend.uuid)?.loaded) void markSeen(friend.uuid);
    void loadLatest(friend.uuid);
  }
}

function resetAccountData(): void {
  chats.clear();
  drafts.clear();
  selected = null;
  pendingOpen = null;
  blocked = null;
  privacy = null;
  filter = '';
  tab = 'friends';
  mode = '';
}

function fallbackOverview(error: unknown): SocialOverview {
  return { status: 'error', error: errorMessage(error), me: null, friends: [], incoming: [], outgoing: [], unread: 0 };
}

async function refresh(): Promise<void> {
  try {
    applyOverview(await api.refreshSocial());
  } catch (error) {
    applyOverview(fallbackOverview(error));
  }
}

// ---------- Aufbau der Seite ----------
function modeKey(): string {
  if (!overview || overview.status === 'connecting') return 'loading';
  if (overview.status !== 'online') return `state:${overview.status}:${overview.error ?? ''}`;
  return tab;
}

function render(): void {
  const el = root();
  const next = modeKey();
  if (next !== mode) {
    mode = next;
    saveDraft();
    closeMenu();
    listView = null;
    chatView = null;
    el.textContent = '';
    el.dataset.mode = next.startsWith('state') ? 'state' : next;
    el.append(renderHead());
    if (next === 'friends') el.append(buildFriends());
    else if (next === 'blocked') el.append(buildPane('blocked'));
    else if (next === 'privacy') el.append(buildPane('privacy'));
    else el.append(renderState());
    if (next === 'friends') {
      renderList();
      renderChat();
    } else if (next === 'blocked') renderBlocked();
    else if (next === 'privacy') renderPrivacy();
    return;
  }
  // gleiche Ansicht: nur Kopf, Liste und Unterhaltung auf den neuen Stand bringen
  el.querySelector('.friends-head')?.replaceWith(renderHead());
  if (mode === 'friends') {
    renderList();
    // ohne Auswahl immer neu (Text hängt davon ab, ob es schon Freunde gibt)
    if (!selected || (chatView?.uuid ?? null) !== selected) renderChat();
    else {
      const friend = friendByUuid(selected);
      if (friend) renderChatHead(friend);
    }
  }
}

function renderHead(): HTMLElement {
  const online = overview?.status === 'online';
  const sub = online && overview?.me
    ? `Angemeldet als ${overview.me.name} beim Heldix-Dienst.`
    : 'Sieh, wer gerade spielt, und schreib deinen Freunden.';
  const tabButton = (id: Tab, label: string) => h('button', {
    type: 'button',
    class: tab === id ? 'active' : '',
    text: label,
    onclick: () => switchTab(id),
  });
  return h('div', { class: 'page-head row friends-head' },
    h('div', { class: 'friends-head-text' },
      h('h2', { class: 'page-title', text: 'Freunde' }),
      h('p', { class: 'page-sub', text: sub })),
    online ? h('div', { class: 'tabs friends-tabs' }, tabButton('friends', 'Freunde'), tabButton('blocked', 'Blockiert'), tabButton('privacy', 'Privatsphäre')) : null);
}

function switchTab(next: Tab): void {
  if (tab === next) return;
  saveDraft();
  tab = next;
  render();
  if (next === 'blocked') void loadBlocked();
  if (next === 'privacy') void loadPrivacy();
  if (next === 'friends') startPolling();
}

// ---------- Zustände ohne Verbindung ----------
function openAccountMenu(event: Event): void {
  // sonst schließt derselbe Klick das Konten-Menü gleich wieder (es hört auf Klicks im Dokument)
  event.stopPropagation();
  $('#account-button').click();
}

async function enableSocial(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    state.settings = await api.saveSettings({ social: true });
    emit('settings');
    await refresh();
  } catch (error) {
    toast(errorMessage(error), 'error');
    button.disabled = false;
  }
}

async function retry(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  button.lastChild!.textContent = 'Verbinde …';
  await refresh();
  if (button.isConnected) {
    button.disabled = false;
    button.lastChild!.textContent = 'Erneut versuchen';
  }
}

function renderState(): HTMLElement {
  const status = overview?.status ?? 'connecting';
  let icon = 'friends';
  let title = '';
  let text = '';
  let error = false;
  const actions: HTMLElement[] = [];
  switch (status) {
    case 'disabled':
      title = 'Freunde sind ausgeschaltet';
      text = 'Schalte Freunde & Nachrichten ein, um zu sehen, wer gerade spielt, Freunden zu schreiben und ihrem Server beizutreten. Läuft über den Heldix-Dienst und braucht ein Microsoft-Konto.';
      actions.push(h('button', { class: 'primary', type: 'button', onclick: (e: Event) => void enableSocial(e.currentTarget as HTMLButtonElement) },
        uiIcon('check', 'btn-icon'), h('span', { text: 'Einschalten' })));
      break;
    case 'no-service':
      icon = 'server';
      title = 'Heldix-Dienst nicht eingerichtet';
      text = 'In diesem Launcher ist kein Heldix-Dienst eingetragen. Freunde und Nachrichten gibt es nur mit dem Launcher von heldixclient.com.';
      break;
    case 'no-account':
      icon = 'user';
      title = 'Nicht angemeldet';
      text = 'Melde dich mit deinem Microsoft-Konto an, um Freunde hinzuzufügen und ihnen zu schreiben.';
      actions.push(h('button', { class: 'primary', type: 'button', onclick: openAccountMenu },
        uiIcon('microsoft', 'btn-icon'), h('span', { text: 'Anmelden' })));
      break;
    case 'offline-account':
      icon = 'lock';
      title = 'Nur mit Microsoft-Konto';
      text = 'Mit einem Offline-Konto gibt es keine Freunde und Nachrichten. Wechsle zu einem Microsoft-Konto.';
      actions.push(h('button', { class: 'ghost', type: 'button', onclick: openAccountMenu },
        uiIcon('user', 'btn-icon'), h('span', { text: 'Konto wechseln' })));
      break;
    case 'error': {
      error = true;
      icon = 'warning';
      const message = overview?.error?.trim() || 'Unbekannter Fehler.';
      const unreachable = /nicht erreichbar/i.test(message);
      title = unreachable ? 'Heldix-Dienst nicht erreichbar' : 'Freunde gerade nicht verfügbar';
      text = unreachable ? 'Prüfe deine Internetverbindung. Der Launcher versucht es auch von selbst weiter.' : message;
      actions.push(h('button', { class: 'ghost', type: 'button', onclick: (e: Event) => void retry(e.currentTarget as HTMLButtonElement) },
        uiIcon('refresh', 'btn-icon'), h('span', { text: 'Erneut versuchen' })));
      break;
    }
    default:
      return h('div', { class: 'friends-state' },
        h('div', { class: 'friends-spinner', 'aria-hidden': 'true' }),
        h('h3', { class: 'friends-state-title', text: 'Verbinde mit dem Heldix-Dienst …' }),
        h('p', { class: 'friends-state-text', text: 'Deine Freundesliste wird geladen.' }));
  }
  return h('div', { class: 'friends-state' },
    h('div', { class: `friends-state-icon${error ? ' error' : ''}` }, uiIcon(icon)),
    h('h3', { class: 'friends-state-title', text: title }),
    h('p', { class: 'friends-state-text', text }),
    actions.length ? h('div', { class: 'friends-state-actions' }, ...actions) : null);
}

// ---------- Liste ----------
function buildFriends(): HTMLElement {
  const addInput = h('input', { type: 'text', placeholder: 'Spielername', maxlength: '16', spellcheck: 'false', 'aria-label': 'Spielername' });
  const addButton = h('button', { class: 'primary friends-add-button', type: 'submit', title: 'Freundschaftsanfrage senden' },
    uiIcon('user-plus', 'btn-icon'), h('span', { text: 'Hinzufügen' }));
  const form = h('form', { class: 'friends-add', onsubmit: (e: Event) => {
    e.preventDefault();
    void addFriend();
  } }, addInput, addButton);

  const searchInput = h('input', { type: 'text', placeholder: 'Freunde suchen …', spellcheck: 'false', 'aria-label': 'Freunde suchen' });
  searchInput.value = filter;
  searchInput.addEventListener('input', () => {
    filter = searchInput.value;
    renderList();
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && searchInput.value) {
      event.stopPropagation();
      searchInput.value = '';
      filter = '';
      renderList();
    } else if (event.key === 'Enter') {
      // erster Treffer öffnet die Unterhaltung
      const first = listView?.list.querySelector<HTMLElement>('.friends-row[data-uuid]');
      if (first?.dataset.uuid) selectFriend(first.dataset.uuid);
    }
  });
  const search = h('div', { class: 'search-field friends-search' }, uiIcon('search'), searchInput);

  const list = h('div', { class: 'friends-list-scroll' });
  const chat = h('section', { class: 'friends-chat' });
  const layout = h('div', { class: 'friends-layout' },
    h('aside', { class: 'friends-list' }, form, search, list),
    chat);
  listView = { layout, addInput, addButton, search, searchInput, list, chat };
  return layout;
}

function section(label: string, count: number): HTMLElement {
  return h('div', { class: 'friends-section' }, h('span', { text: label }), h('span', { class: 'friends-section-count', text: String(count) }));
}

function renderList(): void {
  const view = listView;
  if (!view || !overview) return;
  const { list } = view;
  const scrollTop = list.scrollTop;
  list.textContent = '';
  view.layout.classList.toggle('has-chat', !!selected);

  const total = overview.friends.length + overview.incoming.length + overview.outgoing.length;
  view.search.hidden = total < SEARCH_FROM && !filter;
  const query = filter.trim().toLowerCase();
  const match = (name: string) => !query || name.toLowerCase().includes(query);
  const incoming = overview.incoming.filter((r) => match(r.name));
  const outgoing = overview.outgoing.filter((r) => match(r.name));
  const online = overview.friends.filter((f) => f.online && match(f.name));
  const offline = overview.friends.filter((f) => !f.online && match(f.name));

  if (incoming.length) {
    list.append(section('Anfragen', incoming.length));
    for (const request of incoming) list.append(incomingRow(request));
  }
  if (outgoing.length) {
    list.append(section('Gesendet', outgoing.length));
    for (const request of outgoing) list.append(outgoingRow(request));
  }
  if (online.length) {
    list.append(section('Online', online.length));
    for (const friend of online) list.append(friendRow(friend));
  }
  if (offline.length) {
    list.append(section('Offline', offline.length));
    for (const friend of offline) list.append(friendRow(friend));
  }
  if (!list.childElementCount) {
    list.append(query
      ? h('div', { class: 'friends-list-empty' },
        h('div', { class: 'friends-list-empty-title', text: 'Niemand gefunden' }),
        h('div', { text: `Kein Freund und keine Anfrage passt zu „${filter.trim()}“.` }))
      : h('div', { class: 'friends-list-empty compact', text: 'Noch keine Freunde und keine Anfragen.' }));
  }
  list.scrollTop = scrollTop;
}

function friendRow(friend: Friend): HTMLElement {
  return h('button', {
    type: 'button',
    class: `friends-row${friend.uuid === selected ? ' active' : ''}${friend.online ? ' online' : ' offline'}${friend.unread ? ' unread' : ''}`,
    'data-uuid': friend.uuid,
    onclick: () => selectFriend(friend.uuid),
  },
  head(friend.uuid, friend.name, 'sm', friend.online ? 'online' : 'offline'),
  h('span', { class: 'friends-row-text' },
    h('span', { class: 'friends-row-name', text: friend.name }),
    h('span', { class: 'friends-row-meta', text: activityText(friend) })),
  friend.unread > 0 ? h('span', { class: 'friends-unread', text: countLabel(friend.unread), title: friend.unread === 1 ? '1 ungelesene Nachricht' : `${friend.unread} ungelesene Nachrichten` }) : null);
}

function incomingRow(request: FriendRequest): HTMLElement {
  const accept = h('button', { class: 'primary small', type: 'button' }, uiIcon('check', 'btn-icon'), h('span', { text: 'Annehmen' }));
  const decline = h('button', { class: 'ghost small', type: 'button', text: 'Ablehnen' });
  accept.addEventListener('click', () => void requestAction([accept, decline], async () => {
    applyOverview(await api.acceptFriendRequest(request.uuid));
    toast(`${request.name} ist jetzt dein Freund.`, 'success');
  }));
  decline.addEventListener('click', () => void requestAction([accept, decline], async () => {
    applyOverview(await api.removeFriendRequest(request.uuid));
  }));
  return h('div', { class: 'friends-request incoming' },
    h('div', { class: 'friends-request-top' },
      head(request.uuid, request.name),
      h('span', { class: 'friends-row-text' },
        h('span', { class: 'friends-row-name', text: request.name }),
        h('span', { class: 'friends-row-meta', text: `Anfrage · ${ago(request.at)}`, title: `Möchte mit dir befreundet sein (${fullTime(request.at)})` }))),
    h('div', { class: 'friends-request-actions' }, accept, decline));
}

function outgoingRow(request: FriendRequest): HTMLElement {
  const withdraw = h('button', { class: 'ghost small friends-withdraw', type: 'button', title: 'Anfrage zurückziehen', 'aria-label': 'Anfrage zurückziehen' },
    uiIcon('close', 'btn-icon'), h('span', { class: 'friends-withdraw-label', text: 'Zurückziehen' }));
  withdraw.addEventListener('click', () => void requestAction([withdraw], async () => {
    applyOverview(await api.removeFriendRequest(request.uuid));
    toast(`Anfrage an ${request.name} zurückgezogen.`);
  }));
  return h('div', { class: 'friends-request outgoing' },
    h('div', { class: 'friends-request-top' },
      head(request.uuid, request.name),
      h('span', { class: 'friends-row-text' },
        h('span', { class: 'friends-row-name', text: request.name }),
        h('span', { class: 'friends-row-meta', text: capitalize(ago(request.at)), title: `Anfrage gesendet am ${fullTime(request.at)}` })),
      withdraw));
}

async function requestAction(buttons: HTMLButtonElement[], action: () => Promise<void>): Promise<void> {
  buttons.forEach((b) => (b.disabled = true));
  try {
    await action();
  } catch (error) {
    toast(errorMessage(error), 'error');
    buttons.forEach((b) => (b.disabled = false));
  }
}

async function addFriend(): Promise<void> {
  const view = listView;
  if (!view) return;
  const name = view.addInput.value.trim();
  if (!name) {
    view.addInput.focus();
    return;
  }
  if (!/^[A-Za-z0-9_]{1,16}$/.test(name)) {
    toast('Spielernamen bestehen aus höchstens 16 Buchstaben, Ziffern und _.', 'error');
    view.addInput.focus();
    return;
  }
  if (overview?.me && overview.me.name.toLowerCase() === name.toLowerCase()) {
    toast('Das bist du selbst.', 'error');
    return;
  }
  const known = overview?.friends.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (known) {
    toast(`${known.name} ist schon dein Freund.`);
    selectFriend(known.uuid);
    view.addInput.value = '';
    return;
  }
  view.addButton.disabled = true;
  view.addInput.disabled = true;
  try {
    const before = new Set(overview?.friends.map((f) => f.uuid));
    const next = await api.sendFriendRequest(name);
    const lower = name.toLowerCase();
    const friend = next.friends.find((f) => f.name.toLowerCase() === lower && !before.has(f.uuid));
    const request = next.outgoing.find((r) => r.name.toLowerCase() === lower);
    applyOverview(next);
    if (listView) listView.addInput.value = '';
    if (friend) toast(`${friend.name} hatte dir schon eine Anfrage geschickt – ihr seid jetzt Freunde.`, 'success');
    else toast(`Anfrage an ${request?.name ?? name} gesendet.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    if (listView) {
      listView.addButton.disabled = false;
      listView.addInput.disabled = false;
      listView.addInput.focus();
    }
  }
}

// ---------- Unterhaltung ----------
function chatFor(uuid: string): Chat {
  let chat = chats.get(uuid);
  if (!chat) {
    chat = { uuid, messages: [], pending: [], more: false, loaded: false, loading: false, loadingOlder: false, error: null, unreadFrom: null };
    chats.set(uuid, chat);
  }
  return chat;
}

function saveDraft(): void {
  if (!chatView) return;
  const text = chatView.input.value;
  if (text) drafts.set(chatView.uuid, text);
  else drafts.delete(chatView.uuid);
}

function selectFriend(uuid: string | null): void {
  if (uuid === selected && tab === 'friends' && chatView?.uuid === uuid) {
    chatView?.input.focus();
    return;
  }
  saveDraft();
  closeMenu();
  selected = uuid;
  if (tab !== 'friends') {
    tab = 'friends';
  }
  render();
  if (chatView && pageVisible()) chatView.input.focus();
}

function renderChat(): void {
  const view = listView;
  if (!view) return;
  closeMenu();
  const panel = view.chat;
  panel.textContent = '';
  chatView = null;
  view.layout.classList.toggle('has-chat', !!selected);
  const friend = friendByUuid(selected);
  if (!friend) {
    const none = (overview?.friends.length ?? 0) === 0;
    panel.append(h('div', { class: 'friends-chat-empty' },
      h('div', { class: 'friends-state-icon' }, uiIcon(none ? 'user-plus' : 'chat')),
      h('h3', { class: 'friends-state-title', text: none ? 'Füge deinen ersten Freund hinzu' : 'Wähle links einen Freund' }),
      h('p', { class: 'friends-state-text', text: none
        ? 'Gib links seinen Spielernamen ein. Dein Freund braucht HeldixClient und nimmt die Anfrage an – danach seht ihr, wer gerade spielt, und könnt euch schreiben, auch im Spiel.'
        : 'Dann siehst du hier eure Nachrichten und kannst ihm schreiben.' })));
    stopPolling();
    return;
  }

  const headEl = h('div', { class: 'friends-chat-head' });
  const scroll = h('div', { class: 'friends-messages', role: 'log', 'aria-live': 'polite' });
  const jump = h('button', { class: 'primary small friends-jump', type: 'button', hidden: true }, uiIcon('chevron-down', 'btn-icon'), h('span', { text: 'Neue Nachrichten' }));
  const input = h('input', { type: 'text', class: 'friends-input', placeholder: `Nachricht an ${friend.name}`, 'aria-label': `Nachricht an ${friend.name}`, autocomplete: 'off' });
  const counter = h('span', { class: 'friends-counter', hidden: true });
  const send = h('button', { class: 'primary friends-send', type: 'submit', title: 'Senden (Enter)', 'aria-label': 'Senden', disabled: true }, uiIcon('send', 'btn-icon'));
  const form = h('form', { class: 'friends-composer', onsubmit: (e: Event) => {
    e.preventDefault();
    sendCurrent();
  } }, input, counter, send);
  panel.append(headEl, scroll, jump, form);
  chatView = { uuid: friend.uuid, head: headEl, scroll, jump, input, counter, send };

  input.value = drafts.get(friend.uuid) ?? '';
  input.addEventListener('input', updateComposer);
  scroll.addEventListener('scroll', () => {
    if (nearBottom(scroll)) jump.hidden = true;
  });
  jump.addEventListener('click', () => {
    scroll.scrollTop = scroll.scrollHeight;
    jump.hidden = true;
  });

  renderChatHead(friend);
  updateComposer();
  const chat = chatFor(friend.uuid);
  if (chat.loaded && friend.unread > 0) {
    // inzwischen Neues da: frisch laden, damit „Neue Nachrichten“ an der richtigen Stelle steht
    chat.loaded = false;
    chat.messages = [];
    chat.more = false;
  } else chat.unreadFrom = null;
  renderMessages({ initial: true });
  // markiert erst nach dem Laden als gelesen – sonst fehlt „Neue Nachrichten“
  void loadLatest(friend.uuid);
  if (pageVisible()) startPolling();
}

function renderChatHead(friend: Friend): void {
  const view = chatView;
  if (!view || view.uuid !== friend.uuid) return;
  const keepMenu = menu && view.head.contains(menu) ? menu : null;
  view.head.textContent = '';
  const join = canJoin(friend)
    ? h('button', {
      class: 'primary friends-join',
      type: 'button',
      title: gameBusy ? 'Es läuft schon ein Spiel.' : `Minecraft starten und ${friend.server} beitreten`,
      disabled: gameBusy || !!joining,
      onclick: () => void joinFriend(friend),
    }, uiIcon('connect', 'btn-icon'), h('span', { class: 'friends-join-label', text: joining === friend.uuid ? 'Startet …' : 'Beitreten' }))
    : null;
  view.head.append(
    h('button', { class: 'icon-button friends-back', type: 'button', title: 'Zurück zur Liste', onclick: () => selectFriend(null) }, uiIcon('chevron-left')),
    head(friend.uuid, friend.name, 'md', friend.online ? 'online' : 'offline'),
    h('div', { class: 'friends-chat-title' },
      h('div', { class: 'friends-chat-name', text: friend.name, title: `Befreundet seit ${formatDate(friend.since)}` }),
      h('div', { class: `friends-chat-status${friend.online ? ' online' : ''}`, text: activityText(friend) })),
    ...(join ? [join] : []),
    h('button', {
      class: 'icon-button friends-more',
      type: 'button',
      title: 'Mehr',
      'aria-label': 'Mehr',
      'aria-haspopup': 'menu',
      onclick: (e: Event) => toggleMenu(e, friend),
    }, uiIcon('more')));
  if (keepMenu) view.head.append(keepMenu);
}

async function joinFriend(friend: Friend): Promise<void> {
  if (joining) return;
  joining = friend.uuid;
  renderChatHead(friend);
  try {
    await api.joinFriend(friend.uuid);
    toast(`Minecraft startet und verbindet mit ${friend.server ?? 'dem Server'}.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    joining = null;
    const current = friendByUuid(friend.uuid);
    if (current) renderChatHead(current);
  }
}

function updateComposer(): void {
  const view = chatView;
  if (!view) return;
  const count = charCount(view.input.value);
  view.counter.hidden = count < COUNTER_FROM;
  view.counter.textContent = `${count}/${MAX_LENGTH}`;
  view.counter.classList.toggle('over', count > MAX_LENGTH);
  view.counter.title = count > MAX_LENGTH ? `${count - MAX_LENGTH} Zeichen zu viel` : `noch ${MAX_LENGTH - count} Zeichen`;
  view.send.disabled = !cleanText(view.input.value) || count > MAX_LENGTH;
}

function nearBottom(scroll: HTMLElement): boolean {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 60;
}

interface RenderOptions {
  /** erstes Anzeigen: zu „Neue Nachrichten“ bzw. ans Ende */
  initial?: boolean;
  /** ältere Nachrichten oben eingefügt: Blick auf dieselbe Stelle halten */
  keepAnchor?: boolean;
  toBottom?: boolean;
}

function renderMessages(options: RenderOptions = {}): void {
  const view = chatView;
  if (!view) return;
  const chat = chatFor(view.uuid);
  const friend = friendByUuid(view.uuid);
  const { scroll } = view;
  const wasAtBottom = nearBottom(scroll);
  const oldHeight = scroll.scrollHeight;
  const oldTop = scroll.scrollTop;
  scroll.textContent = '';

  if (!chat.loaded) {
    if (chat.error) {
      scroll.append(h('div', { class: 'friends-chat-note' },
        h('div', { class: 'friends-state-icon error' }, uiIcon('warning')),
        h('p', { class: 'friends-state-text', text: chat.error }),
        h('button', { class: 'ghost small', type: 'button', onclick: () => {
          chat.error = null;
          renderMessages();
          void loadLatest(chat.uuid);
        } }, uiIcon('refresh', 'btn-icon'), h('span', { text: 'Erneut versuchen' }))));
    } else {
      scroll.append(h('div', { class: 'friends-chat-note' }, h('div', { class: 'friends-spinner' }), h('p', { class: 'friends-state-text', text: 'Nachrichten werden geladen …' })));
    }
    return;
  }

  if (chat.more) {
    scroll.append(h('button', {
      class: 'ghost small friends-older',
      type: 'button',
      disabled: chat.loadingOlder,
      onclick: () => void loadOlder(chat),
    }, chat.loadingOlder ? h('span', { class: 'friends-spinner small' }) : uiIcon('clock', 'btn-icon'), h('span', { text: chat.loadingOlder ? 'Lädt …' : 'Ältere laden' })));
  }

  if (!chat.messages.length && !chat.pending.length) {
    scroll.append(h('div', { class: 'friends-chat-note' },
      h('div', { class: 'friends-state-icon' }, uiIcon('chat')),
      h('h3', { class: 'friends-state-title', text: 'Noch keine Nachrichten' }),
      h('p', { class: 'friends-state-text', text: `Schreib ${friend?.name ?? 'deinem Freund'} etwas. Nachrichten bleiben 30 Tage gespeichert und sind auch im Spiel zu sehen.` })));
    return;
  }

  type Item = { id: number | null; text: string; at: number; mine: boolean; pending?: Pending };
  const items: Item[] = [
    ...chat.messages.map((m) => ({ id: m.id, text: m.text, at: m.at, mine: m.mine })),
    ...chat.pending.map((p) => ({ id: null, text: p.text, at: p.at, mine: true, pending: p })),
  ];

  let lastDay = '';
  let group: HTMLElement | null = null;
  let previous: Item | null = null;
  let divider: HTMLElement | null = null;
  const groups: { el: HTMLElement; last: Item }[] = [];
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const day = dayKey(item.at);
    if (day !== lastDay) {
      fragment.append(h('div', { class: 'friends-day', text: dayLabel(item.at) }));
      lastDay = day;
      group = null;
    }
    if (item.id !== null && item.id === chat.unreadFrom) {
      divider = h('div', { class: 'friends-day friends-new', text: 'Neue Nachrichten' });
      fragment.append(divider);
      group = null;
    }
    const failed = item.pending?.status === 'failed' || previous?.pending?.status === 'failed';
    if (!group || !previous || failed || previous.mine !== item.mine || item.at - previous.at > GROUP_GAP_MS) {
      group = h('div', { class: `friends-group ${item.mine ? 'mine' : 'theirs'}` });
      fragment.append(group);
      groups.push({ el: group, last: item });
    }
    groups[groups.length - 1].last = item;
    const p = item.pending;
    const row = h('div', { class: `friends-msg${p ? ` pending ${p.status}` : ''}`, title: p ? '' : fullTime(item.at) },
      h('div', { class: 'friends-bubble', text: item.text }),
      p ? null : h('span', { class: 'friends-msg-time', text: clock(item.at) }));
    group.append(row);
    if (p?.status === 'failed') {
      group.append(h('div', { class: 'friends-failed' },
        uiIcon('warning', 'btn-icon'),
        h('span', { class: 'friends-failed-text', text: p.error ?? 'Nicht gesendet.' }),
        h('button', { type: 'button', text: 'Erneut senden', onclick: () => void deliver(chat, p) }),
        h('button', { type: 'button', text: 'Verwerfen', onclick: () => discard(chat, p) })));
    }
    previous = item;
  }
  // erste und letzte Blase einer Gruppe runden, Zeit unter die letzte
  for (const { el, last } of groups) {
    const rows = el.querySelectorAll<HTMLElement>('.friends-msg');
    rows[0]?.classList.add('first');
    rows[rows.length - 1]?.classList.add('last');
    if (last.pending?.status === 'failed') continue;
    el.append(h('div', { class: 'friends-group-time', text: last.pending ? 'Wird gesendet …' : clock(last.at) }));
  }
  scroll.append(fragment);

  if (options.keepAnchor) scroll.scrollTop = scroll.scrollHeight - oldHeight + oldTop;
  else if (options.initial && divider) scroll.scrollTop = Math.max(0, divider.offsetTop - 16);
  else if (options.initial || options.toBottom || wasAtBottom) scroll.scrollTop = scroll.scrollHeight;
  else scroll.scrollTop = oldTop;
}

function mergeMessages(chat: Chat, incoming: ChatMessage[]): void {
  const known = new Set(chat.messages.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (!fresh.length) return;
  chat.messages = [...chat.messages, ...fresh].sort((a, b) => a.id - b.id);
  // eigene Nachricht kam per Abruf schneller zurück als die Antwort aufs Senden
  for (const message of fresh) {
    if (!message.mine) continue;
    const index = chat.pending.findIndex((p) => p.status === 'sending' && p.text === message.text);
    if (index >= 0) chat.pending.splice(index, 1);
  }
}

async function loadLatest(uuid: string): Promise<void> {
  const chat = chatFor(uuid);
  if (chat.loading) return;
  chat.loading = true;
  let first = !chat.loaded;
  let fromFriend = false;
  try {
    const page = await api.getMessages(uuid);
    // währenddessen neu geöffnet und zurückgesetzt: wie beim ersten Laden behandeln
    first = !chat.loaded;
    chat.error = null;
    if (first) {
      chat.messages = [];
      mergeMessages(chat, page.messages);
      chat.more = page.more;
      chat.loaded = true;
      chat.unreadFrom = page.messages.find((m) => !m.mine && !m.read)?.id ?? null;
    } else {
      const newest = chat.messages.length ? chat.messages[chat.messages.length - 1].id : 0;
      const fresh = page.messages.filter((m) => m.id > newest);
      fromFriend = fresh.some((m) => !m.mine);
      if (page.more && newest > 0 && fresh.length === page.messages.length) {
        // Lücke (viele neue Nachrichten auf einmal): ab der neuesten Seite neu anfangen
        chat.messages = [];
        chat.more = true;
      }
      if (!chat.messages.length && !page.more) chat.more = false;
      mergeMessages(chat, page.messages);
      if (!fresh.length) return;
    }
    if (chatView?.uuid === uuid) {
      const atBottom = nearBottom(chatView.scroll);
      renderMessages(first ? { initial: true } : {});
      if (fromFriend && !atBottom) chatView.jump.hidden = false;
    }
    if (pageVisible() && chatView?.uuid === uuid && (page.messages.some((m) => !m.mine && !m.read) || (friendByUuid(uuid)?.unread ?? 0) > 0)) {
      void markSeen(uuid);
    }
  } catch (error) {
    // Fehler beim Nachladen still übergehen (der Zustand oben zeigt Verbindungsprobleme)
    if (first) {
      chat.error = errorMessage(error);
      if (chatView?.uuid === uuid) renderMessages();
    }
  } finally {
    chat.loading = false;
  }
}

async function loadOlder(chat: Chat): Promise<void> {
  if (chat.loadingOlder || !chat.more || !chat.messages.length) return;
  chat.loadingOlder = true;
  if (chatView?.uuid === chat.uuid) renderMessages({ keepAnchor: true });
  try {
    const page = await api.getMessages(chat.uuid, chat.messages[0].id);
    mergeMessages(chat, page.messages);
    chat.more = page.more;
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    chat.loadingOlder = false;
    if (chatView?.uuid === chat.uuid) renderMessages({ keepAnchor: true });
  }
}

async function markSeen(uuid: string): Promise<void> {
  const friend = friendByUuid(uuid);
  if (friend && overview && friend.unread > 0) {
    overview.unread = Math.max(0, overview.unread - friend.unread);
    friend.unread = 0;
    updateBadge();
    renderList();
  }
  try {
    await api.markRead(uuid);
  } catch {
    // beim nächsten Abruf noch einmal
  }
}

function sendCurrent(): void {
  const view = chatView;
  if (!view) return;
  const text = cleanText(view.input.value);
  if (!text || charCount(text) > MAX_LENGTH) return;
  const chat = chatFor(view.uuid);
  view.input.value = '';
  drafts.delete(view.uuid);
  updateComposer();
  const pending: Pending = { key: ++pendingKey, text, at: Date.now(), status: 'sending', error: null };
  chat.pending.push(pending);
  chat.unreadFrom = null;
  view.jump.hidden = true;
  renderMessages({ toBottom: true });
  void deliver(chat, pending);
}

async function deliver(chat: Chat, pending: Pending): Promise<void> {
  pending.status = 'sending';
  pending.error = null;
  if (chatView?.uuid === chat.uuid) renderMessages({ toBottom: true });
  try {
    const message = await api.sendMessage(chat.uuid, pending.text);
    chat.pending = chat.pending.filter((p) => p !== pending);
    mergeMessages(chat, [message]);
  } catch (error) {
    if (chat.pending.includes(pending)) {
      pending.status = 'failed';
      pending.error = errorMessage(error);
    }
  }
  if (chatView?.uuid === chat.uuid) renderMessages();
}

function discard(chat: Chat, pending: Pending): void {
  chat.pending = chat.pending.filter((p) => p !== pending);
  // Text zurück ins Eingabefeld, falls dort nichts steht
  if (chatView?.uuid === chat.uuid && !chatView.input.value) {
    chatView.input.value = pending.text;
    updateComposer();
  }
  if (chatView?.uuid === chat.uuid) renderMessages();
}

// ---------- Abruf der offenen Unterhaltung ----------
function startPolling(): void {
  if (pollTimer) return;
  pollTimer = window.setInterval(() => {
    if (!pageVisible() || overview?.status !== 'online' || mode !== 'friends' || !chatView) {
      stopPolling();
      return;
    }
    void loadLatest(chatView.uuid);
  }, POLL_MS);
}

function stopPolling(): void {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = 0;
}

/** Seite wieder sichtbar: sofort nachladen, ungelesene markieren und weiter abrufen */
function resume(): void {
  if (!pageVisible() || mode !== 'friends' || !chatView) return;
  const uuid = chatView.uuid;
  if ((friendByUuid(uuid)?.unread ?? 0) > 0 && chats.get(uuid)?.loaded) void markSeen(uuid);
  void loadLatest(uuid);
  startPolling();
}

// ---------- Menü: Entfernen, Blockieren, Melden ----------
function closeMenu(): void {
  menu?.remove();
  menu = null;
}

function toggleMenu(event: Event, friend: Friend): void {
  event.stopPropagation();
  if (menu) {
    closeMenu();
    return;
  }
  const item = (icon: string, label: string, action: () => void, danger = false) => h('button', {
    type: 'button',
    role: 'menuitem',
    class: danger ? 'danger-item' : '',
    onclick: (e: Event) => {
      e.stopPropagation();
      closeMenu();
      action();
    },
  }, uiIcon(icon, 'btn-icon'), h('span', { text: label }));
  menu = h('div', { class: 'friends-menu', role: 'menu', onclick: (e: Event) => e.stopPropagation() },
    item('trash', 'Freund entfernen', () => void removeFriend(friend), true),
    item('ban', 'Blockieren', () => void blockFriend(friend), true),
    h('div', { class: 'friends-menu-line' }),
    item('flag', 'Melden …', () => openReport(friend)));
  chatView?.head.append(menu);
}

async function removeFriend(friend: Friend): Promise<void> {
  const ok = await confirmDialog(`${friend.name} entfernen?`,
    `${friend.name} verschwindet aus deiner Freundesliste und eure Unterhaltung wird für euch beide gelöscht.`, 'Entfernen');
  if (!ok) return;
  try {
    applyOverview(await api.removeFriend(friend.uuid));
    chats.delete(friend.uuid);
    drafts.delete(friend.uuid);
    toast(`${friend.name} ist nicht mehr in deiner Freundesliste.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function blockFriend(friend: Friend): Promise<void> {
  const ok = await confirmDialog(`${friend.name} blockieren?`,
    `Die Freundschaft endet, eure Unterhaltung wird für euch beide gelöscht und ${friend.name} kann dir keine Anfragen mehr schicken. Willst du ${friend.name} melden, tu das vorher – sonst fehlen die Nachrichten als Beleg.`, 'Blockieren');
  if (!ok) return;
  try {
    await block(friend.uuid);
    toast(`${friend.name} ist blockiert.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function block(uuid: string): Promise<void> {
  blocked = await api.blockPlayer(uuid);
  chats.delete(uuid);
  drafts.delete(uuid);
  await refresh();
}

const REASONS: { id: ReportReason; label: string; hint: string }[] = [
  { id: 'spam', label: 'Spam', hint: 'Werbung, Kettenbriefe, immer wieder dasselbe' },
  { id: 'harassment', label: 'Belästigung', hint: 'Beleidigungen, Drohungen, Mobbing' },
  { id: 'inappropriate', label: 'Unangemessene Inhalte', hint: 'Anstößige Nachrichten, Name oder Skin' },
  { id: 'other', label: 'Sonstiges', hint: 'Etwas anderes – bitte unten kurz beschreiben' },
];

function openReport(friend: Friend): void {
  let reason: ReportReason | null = null;
  const reasonButtons = REASONS.map((r) => h('button', {
    type: 'button',
    class: 'friends-reason',
    role: 'radio',
    'aria-checked': 'false',
    onclick: () => {
      reason = r.id;
      reasonButtons.forEach((b, i) => {
        b.classList.toggle('active', REASONS[i].id === r.id);
        b.setAttribute('aria-checked', String(REASONS[i].id === r.id));
      });
      update();
    },
  },
  h('span', { class: 'friends-radio' }),
  h('span', { class: 'friends-reason-text' },
    h('span', { class: 'friends-reason-label', text: r.label }),
    h('span', { class: 'friends-reason-hint', text: r.hint }))));

  const note = h('textarea', { class: 'friends-note', rows: '2', maxlength: String(MAX_NOTE), placeholder: 'Was ist passiert? (freiwillig)', spellcheck: 'true' });
  const noteCount = h('span', { class: 'friends-note-count', text: `0/${MAX_NOTE}` });
  const alsoBlock = h('input', { type: 'checkbox', class: 'switch' });
  const submit = h('button', { class: 'danger solid', type: 'button', disabled: true }, uiIcon('flag', 'btn-icon'), h('span', { text: 'Melden' }));
  const cancel = h('button', { class: 'ghost', type: 'button', text: 'Abbrechen' });

  function update(): void {
    const count = charCount(note.value);
    noteCount.textContent = `${count}/${MAX_NOTE}`;
    noteCount.classList.toggle('over', count > MAX_NOTE);
    submit.disabled = !reason || count > MAX_NOTE;
  }
  note.addEventListener('input', update);
  // eine Zeile: Zeilenumbrüche nimmt der Dienst nicht an
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });

  const close = () => backdrop.remove();
  cancel.addEventListener('click', close);
  /** Meldung ist schon angekommen (nur das Blockieren danach ist fehlgeschlagen): nicht doppelt melden */
  let reported = false;
  submit.addEventListener('click', async () => {
    if (!reason) return;
    submit.disabled = true;
    cancel.disabled = true;
    try {
      const text = cleanText(note.value);
      if (!reported) await api.reportPlayer(friend.uuid, reason, text || undefined);
      reported = true;
      if (alsoBlock.checked) await block(friend.uuid);
      close();
      toast(alsoBlock.checked
        ? `Danke. Deine Meldung ist beim HeldixClient-Team, ${friend.name} ist blockiert.`
        : 'Danke. Deine Meldung ist beim HeldixClient-Team.', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
      submit.disabled = false;
      cancel.disabled = false;
    }
  });

  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => e.target === backdrop && close() },
    h('div', { class: 'modal small friends-report', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('h3', { class: 'modal-title', text: `${friend.name} melden` }),
          h('p', { class: 'modal-sub', text: 'Das HeldixClient-Team sieht sie mit euren letzten 20 Nachrichten als Beleg.' })),
        h('button', { class: 'icon-button', type: 'button', title: 'Schließen', onclick: close }, uiIcon('close'))),
      h('div', { class: 'friends-reasons', role: 'radiogroup', 'aria-label': 'Grund' }, ...reasonButtons),
      h('label', { class: 'stack friends-note-wrap' }, h('span', {}, 'Notiz', noteCount), note),
      h('label', { class: 'toggle-row' },
        h('span', {}, 'Danach blockieren', h('small', { class: 'toggle-sub', text: 'Beendet die Freundschaft und löscht eure Unterhaltung' })),
        alsoBlock),
      h('div', { class: 'modal-actions' }, cancel, submit)));
  document.body.append(backdrop);
  reasonButtons[0]?.focus();
}

// ---------- Reiter „Blockiert“ und „Privatsphäre“ ----------
function buildPane(kind: 'blocked' | 'privacy'): HTMLElement {
  return h('div', { class: `friends-pane friends-pane-${kind}` });
}

async function loadBlocked(): Promise<void> {
  try {
    blocked = await api.listBlocked();
    blockedError = null;
  } catch (error) {
    blockedError = errorMessage(error);
  }
  renderBlocked();
}

function renderBlocked(): void {
  const pane = root().querySelector<HTMLElement>('.friends-pane-blocked');
  if (!pane) return;
  pane.textContent = '';
  const body = h('div', { class: 'friends-blocked-list' });
  pane.append(h('div', { class: 'card friends-card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('ban')),
      h('div', {},
        h('h3', { text: 'Blockierte Spieler' }),
        h('p', { class: 'hint', text: 'Sie können dir keine Anfragen schicken und merken nichts davon. Freigeben bringt Freundschaft und Nachrichten nicht zurück.' }))),
    body));

  if (blockedError && !blocked) {
    const again = h('button', { class: 'ghost small', type: 'button', onclick: () => void loadBlocked() }, uiIcon('refresh', 'btn-icon'), h('span', { text: 'Erneut versuchen' }));
    body.append(h('div', { class: 'friends-list-empty' }, h('div', { text: blockedError }), again));
    return;
  }
  if (!blocked) {
    body.append(h('div', { class: 'friends-list-empty' }, h('div', { class: 'friends-spinner' })));
    return;
  }
  if (!blocked.length) {
    body.append(h('div', { class: 'friends-list-empty' },
      h('div', { class: 'friends-list-empty-title', text: 'Niemand blockiert' }),
      h('div', { text: 'Blockieren kannst du Freunde im Chat über das Menü oben rechts.' })));
    return;
  }
  for (const player of blocked) {
    const unblock = h('button', { class: 'ghost small', type: 'button', text: 'Freigeben' });
    unblock.addEventListener('click', async () => {
      unblock.disabled = true;
      try {
        blocked = await api.unblockPlayer(player.uuid);
        toast(`${player.name} ist wieder freigegeben.`, 'success');
        renderBlocked();
      } catch (error) {
        toast(errorMessage(error), 'error');
        unblock.disabled = false;
      }
    });
    body.append(h('div', { class: 'friends-blocked-row' },
      head(player.uuid, player.name),
      h('span', { class: 'friends-row-text' },
        h('span', { class: 'friends-row-name', text: player.name }),
        h('span', { class: 'friends-row-meta', text: `Blockiert seit ${formatDate(player.at)}` })),
      unblock));
  }
}

async function loadPrivacy(): Promise<void> {
  try {
    privacy = await api.getSocialPrivacy();
    privacyError = null;
  } catch (error) {
    privacyError = errorMessage(error);
  }
  renderPrivacy();
}

const PRIVACY: { key: keyof SocialPrivacy; label: string; sub: string }[] = [
  { key: 'presence', label: 'Online-Status zeigen', sub: 'Freunde sehen, ob du online bist und was du spielst' },
  { key: 'showServer', label: 'Server zeigen', sub: 'Freunde sehen deinen Server und können beitreten' },
  { key: 'messages', label: 'Nachrichten annehmen', sub: 'Aus: Freunde können dir nicht schreiben, du ihnen schon' },
  { key: 'visible', label: 'Als HeldixClient-Spieler erkennbar', sub: 'Andere sehen dein Heldix-Symbol und dein Cape' },
];

async function setPrivacy(key: keyof SocialPrivacy, value: boolean, input: HTMLInputElement): Promise<void> {
  input.disabled = true;
  try {
    privacy = await api.setSocialPrivacy({ [key]: value });
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  renderPrivacy();
}

async function saveSetting(patch: Partial<Settings>, input: HTMLInputElement): Promise<void> {
  input.disabled = true;
  try {
    state.settings = await api.saveSettings(patch);
    emit('settings');
    if ('social' in patch) await refresh();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  if (input.isConnected) renderPrivacy();
}

function renderPrivacy(): void {
  const pane = root().querySelector<HTMLElement>('.friends-pane-privacy');
  if (!pane) return;
  pane.textContent = '';

  const service = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('shield')),
      h('div', {},
        h('h3', { text: 'Privatsphäre' }),
        h('p', { class: 'hint', text: 'Gilt überall: im Launcher, im Spiel und auf heldixclient.com.' }))));
  if (!privacy) {
    if (privacyError) {
      service.append(h('p', { class: 'hint', text: privacyError }),
        h('div', { class: 'button-row' }, h('button', { class: 'ghost small', type: 'button', onclick: () => void loadPrivacy() }, uiIcon('refresh', 'btn-icon'), h('span', { text: 'Erneut versuchen' }))));
    } else service.append(h('div', { class: 'friends-list-empty' }, h('div', { class: 'friends-spinner' })));
  } else {
    const current = privacy;
    for (const option of PRIVACY) {
      const input = h('input', { type: 'checkbox', class: 'switch' });
      input.checked = current[option.key];
      // ohne Online-Status sehen Freunde auch keinen Server
      const inactive = option.key === 'showServer' && !current.presence;
      input.disabled = inactive;
      input.addEventListener('change', () => void setPrivacy(option.key, input.checked, input));
      service.append(h('label', { class: `toggle-row${inactive ? ' friends-inactive' : ''}` },
        h('span', {}, option.label, h('small', { class: 'toggle-sub', text: inactive ? 'Nur mit Online-Status' : option.sub })),
        input));
    }
  }
  service.append(h('div', { class: 'button-row' },
    h('button', { class: 'ghost small', type: 'button', onclick: () => void api.openWebAccount('privatsphaere') },
      uiIcon('external', 'btn-icon'), h('span', { text: 'Daten und Meldungen auf heldixclient.com' }))));

  const notify = h('input', { type: 'checkbox', class: 'switch' });
  notify.checked = state.settings?.socialNotifications ?? true;
  notify.addEventListener('change', () => void saveSetting({ socialNotifications: notify.checked }, notify));
  const social = h('input', { type: 'checkbox', class: 'switch' });
  social.checked = state.settings?.social ?? true;
  social.addEventListener('change', () => void saveSetting({ social: social.checked }, social));
  const launcher = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('monitor')),
      h('div', {},
        h('h3', { text: 'Launcher' }),
        h('p', { class: 'hint', text: 'Nur auf diesem PC.' }))),
    h('label', { class: 'toggle-row' },
      h('span', {}, 'Benachrichtigungen', h('small', { class: 'toggle-sub', text: 'Bei neuen Nachrichten und Anfragen, wenn der Launcher im Hintergrund ist' })),
      notify),
    h('label', { class: 'toggle-row' },
      h('span', {}, 'Freunde & Nachrichten', h('small', { class: 'toggle-sub', text: 'Aus: Der Launcher meldet sich nicht beim Heldix-Dienst an' })),
      social));

  pane.append(h('div', { class: 'cards' }, service, launcher));
}

// ---------- Schnittstelle für app.ts ----------
/** einmal beim Start (Abzeichen, Benachrichtigungen) */
export function initFriends(): void {
  api.onSocial(applyOverview);
  api.onGameState((game) => {
    gameBusy = game.state === 'preparing' || game.state === 'running';
    const friend = friendByUuid(chatView?.uuid ?? null);
    if (friend) renderChatHead(friend);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else resume();
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  render();
  api.getSocial().then(applyOverview, (error: unknown) => applyOverview(fallbackOverview(error)));
}

/** jedes Mal, wenn die Seite gezeigt wird */
export function activateFriends(): void {
  if (overview) void refresh();
  if (mode === 'blocked') void loadBlocked();
  if (mode === 'privacy') {
    renderPrivacy();
    void loadPrivacy();
  }
  resume();
}

/** Unterhaltung mit diesem Freund öffnen (aus einer Benachrichtigung oder der Startseite) */
export function openFriendChat(uuid: string): void {
  if (overview?.status === 'online' && overview.friends.some((f) => f.uuid === uuid)) {
    // Suche zurücksetzen, damit der Freund in der Liste zu sehen ist
    if (filter) {
      filter = '';
      if (listView) {
        listView.searchInput.value = '';
        renderList();
      }
    }
    selectFriend(uuid);
    return;
  }
  // Liste noch nicht da (oder veraltet): nach dem nächsten Stand öffnen
  pendingOpen = uuid;
  void refresh();
}
