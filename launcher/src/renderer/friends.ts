// Freunde & Nachrichten (#view-friends, Inhalt in #friends-root). Daten: api.getSocial()/onSocial() und die Nachrichten-Methoden,
// in Echtzeit über api.onChatEvent (Begleiter-Verbindung des Launchers, zählt nicht als „online im Spiel“).
// Abzeichen #friends-badge = offene Anfragen + ungelesene Nachrichten + Party-Einladungen.
//
// Aufbau: oben die Party (party.ts), links die Liste (Hinzufügen, Suche, Anfragen, Favoriten, Online, Offline,
// Vorschläge), rechts die Unterhaltung (Antworten, Reaktionen, Beitreten-Karten, „schreibt …“, eigene löschen). Klick
// auf Kopf oder Namen öffnet die Profilkarte (profilecard.ts), Rechtsklick auf einen Freund das Menü. Im Kopf der Seite
// der eigene Status mit „Nicht stören“. Reiter „Einladen“ (#friends-invite, nur mit Einladungen beim Dienst),
// „Blockiert“ und „Privatsphäre“ ersetzen beide Spalten. Ohne Verbindung zum Heldix-Dienst zeigt die Seite nur den Zustand.
import type {
  BlockedPlayer,
  ChatEvent,
  ChatMessage,
  Friend,
  FriendRequest,
  FriendSuggestions,
  InviteLink,
  InviteState,
  MessageCard,
  OnlineNotify,
  ReactionId,
  ReportReason,
  Settings,
  SocialOverview,
  SocialPrivacy,
} from '../shared/api';
import { $, api, confirmDialog, emit, errorMessage, formatDate, h, state, toast, uiIcon } from './core.js';
import { badgeIcon } from './badges.js';
import { canInviteToParty, focusParty, initParty, inviteToParty, partyInviteCount, partySection, refreshParty } from './party.js';
import { openProfileCard, type ProfileActions } from './profilecard.js';
import { openWorldDialog } from './world.js';
import { hostedWorld, isWorldAddress, onWorldsChange } from './worldstate.js';

type Tab = 'friends' | 'invite' | 'blocked' | 'privacy';

/** Reaktionen (feste IDs wie im Dienst) als Emojis */
export const REACTIONS: { id: ReactionId; emoji: string; label: string }[] = [
  { id: 'like', emoji: '👍', label: 'Daumen hoch' },
  { id: 'love', emoji: '❤️', label: 'Herz' },
  { id: 'laugh', emoji: '😂', label: 'Lachen' },
  { id: 'wow', emoji: '😮', label: 'Staunen' },
  { id: 'sad', emoji: '😢', label: 'Traurig' },
  { id: 'party', emoji: '🎉', label: 'Feiern' },
  { id: 'fire', emoji: '🔥', label: 'Feuer' },
  { id: 'eyes', emoji: '👀', label: 'Augen' },
];
const REACTION_EMOJI = new Map(REACTIONS.map((r) => [r.id, r.emoji]));
/** „schreibt …“ so lange nach dem letzten Ereignis zeigen */
const TYPING_SHOW_MS = 6000;
/** höchstens so oft „schreibt …“ senden */
const TYPING_SEND_MS = 3000;
const NICKNAME_MAX = 24;
const FRIEND_NOTE_MAX = 200;
const STATUS_MAX = 40;

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
  /** Antwort auf diese Nachricht */
  replyTo: number | null;
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
  /** Antwort auf diese Nachricht (Leiste über dem Eingabefeld) */
  replyTo: ChatMessage | null;
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
  reply: HTMLElement;
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
/** Bereich „Freunde einladen“ (null = noch nicht geladen; available = false: Dienst ohne Einladungen) */
let invites: InviteState | null = null;
let invitesError: string | null = null;
let invitesLoading: Promise<void> | null = null;
/** Freunde von Freunden (null = noch nicht geladen) */
let suggestions: FriendSuggestions | null = null;
let suggestionsAt = 0;
/** „schreibt …“ je Freund bis (ms) */
const typingUntil = new Map<string, number>();
let typingTimer = 0;
let typingSentAt = 0;
/** offenes Auswahlfeld für Reaktionen */
let picker: HTMLElement | null = null;
let statusPop: HTMLElement | null = null;

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

/** eigener Spitzname, sonst der Spielername */
function displayName(friend: Pick<Friend, 'name' | 'nickname'>): string {
  return friend.nickname?.trim() || friend.name;
}

/** „vor 5 Min.“, „vor 3 Std.“, „vor 2 Tagen“ – der Dienst rundet „zuletzt online“ schon ab (5 Min., Stunden, Tage) */
export function lastOnlineAgo(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 5) return 'gerade eben';
  if (minutes < 60) return `vor ${Math.floor(minutes / 5) * 5} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'vor 1 Tag' : `vor ${days} Tagen`;
}

/** Was in der Liste unter dem Namen steht: Aktivität (online) bzw. „Zuletzt online vor …“ */
function presenceText(friend: Friend): string {
  if (friend.online) return `${activityText(friend)}${friend.dnd ? ' · Nicht stören' : ''}`;
  return friend.lastOnline ? `Zuletzt online ${lastOnlineAgo(friend.lastOnline)}` : 'Offline';
}

function isTyping(uuid: string): boolean {
  return (typingUntil.get(uuid) ?? 0) > Date.now();
}

/** Was der Freund gerade macht, z. B. „Auf hypixel.net“ oder „Teilt ‚Meine Welt‘“ */
function activityText(friend: Friend): string {
  if (!friend.online) return 'Offline';
  // geteilte Welten (Welt teilen): nie die Adresse zeigen
  const world = hostedWorld(friend.uuid);
  if (world) return `Teilt „${world.name}“`;
  if (isWorldAddress(friend.server)) return 'In einer geteilten Welt';
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
  return friend.online && (!!hostedWorld(friend.uuid) || (friend.activity === 'multiplayer' && !!friend.server));
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

/** Kopf eines Spielers für andere Ansichten (z. B. den Einladungsdialog) */
export function playerHead(uuid: string, name: string, size: 'sm' | 'md' = 'sm'): HTMLElement {
  return head(uuid, name, size);
}

/** Kopf des Spielers; bis das Gesicht geladen ist (oder ohne Skin) der Anfangsbuchstabe. status 'dnd' = online, „Nicht stören“ */
function head(uuid: string, name: string, size: 'sm' | 'md' = 'sm', status?: 'online' | 'offline' | 'dnd'): HTMLElement {
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
  return h('span', { class: `friends-avatar ${size}${status ? ` ${status === 'dnd' ? 'online dnd' : status}` : ''}` },
    inner,
    status ? h('span', { class: 'friends-dot', title: status === 'dnd' ? 'Online · Nicht stören' : status === 'online' ? 'Online' : 'Offline' }) : null);
}

function friendStatus(friend: Friend): 'online' | 'offline' | 'dnd' {
  return friend.online ? (friend.dnd ? 'dnd' : 'online') : 'offline';
}

// ---------- Abzeichen in der Seitenleiste ----------
function updateBadge(): void {
  const badge = document.querySelector<HTMLElement>('#friends-badge');
  if (!badge) return;
  const requests = overview?.status === 'online' ? overview.incoming.length : 0;
  const unread = overview?.status === 'online' ? overview.unread : 0;
  const parties = overview?.status === 'online' ? partyInviteCount() : 0;
  const count = requests + unread + parties;
  badge.hidden = count === 0;
  badge.textContent = countLabel(count);
  const parts: string[] = [];
  if (requests) parts.push(requests === 1 ? '1 Anfrage' : `${requests} Anfragen`);
  if (unread) parts.push(unread === 1 ? '1 ungelesene Nachricht' : `${unread} ungelesene Nachrichten`);
  if (parties) parts.push(parties === 1 ? '1 Party-Einladung' : `${parties} Party-Einladungen`);
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
    if (!wasOnline && tab !== 'invite') tab = 'friends';
    // kennt der Dienst Einladungen? (Reiter „Einladen“)
    if (!invites && !invitesLoading) void loadInvites();
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
  invites = null;
  invitesError = null;
  suggestions = null;
  suggestionsAt = 0;
  typingUntil.clear();
  filter = '';
  tab = 'friends';
  mode = '';
}

function fallbackOverview(error: unknown): SocialOverview {
  return { status: 'error', error: errorMessage(error), me: null, friends: [], incoming: [], outgoing: [], unread: 0, realtime: 'off' };
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
    if (next === 'friends') el.append(partySection(), buildFriends());
    else if (next === 'invite') el.append(buildPane('invite'));
    else if (next === 'blocked') el.append(buildPane('blocked'));
    else if (next === 'privacy') el.append(buildPane('privacy'));
    else el.append(renderState());
    if (next === 'friends') {
      renderList();
      renderChat();
    } else if (next === 'invite') renderInvites();
    else if (next === 'blocked') renderBlocked();
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
    ? `Angemeldet als ${overview.me.name} beim Heldix-Dienst${overview.realtime === 'live' ? ' · in Echtzeit verbunden' : ''}.`
    : 'Sieh, wer gerade spielt, und schreib deinen Freunden.';
  const tabButton = (id: Tab, label: string) => h('button', {
    type: 'button',
    class: tab === id ? 'active' : '',
    'data-tab': id,
    text: label,
    onclick: () => switchTab(id),
  });
  return h('div', { class: 'page-head row friends-head' },
    h('div', { class: 'friends-head-text' },
      h('h2', { class: 'page-title', text: 'Freunde' }),
      h('p', { class: 'page-sub', text: sub })),
    online ? statusPill() : null,
    online ? h('div', { class: 'tabs friends-tabs' },
      tabButton('friends', 'Freunde'),
      // nur, wenn der Dienst Einladungen kennt (ab 1.11.0)
      invites?.available ? tabButton('invite', 'Einladen') : null,
      tabButton('blocked', 'Blockiert'),
      tabButton('privacy', 'Privatsphäre')) : null);
}

// ---------- eigener Status und „Nicht stören“ ----------

/** Knopf im Kopf der Seite: eigener Kopf, Abzeichen, Statustext bzw. „Status setzen“, Mond bei „Nicht stören“ */
function statusPill(): HTMLElement {
  const me = overview?.me;
  if (!me) return h('span');
  return h('button', {
    class: `friends-me${me.dnd ? ' dnd' : ''}`,
    type: 'button',
    id: 'friends-status',
    title: 'Eigenen Status und „Nicht stören“ einstellen',
    'aria-haspopup': 'dialog',
    onclick: (e: Event) => {
      e.stopPropagation();
      toggleStatusPop(e.currentTarget as HTMLElement);
    },
  },
  head(me.uuid, me.name, 'sm', me.dnd ? 'dnd' : 'online'),
  h('span', { class: 'friends-me-text' },
    h('span', { class: 'friends-me-name' }, me.name, badgeIcon(me.badge, 14)),
    h('span', { class: 'friends-me-status', text: me.dnd ? `Nicht stören${me.statusText ? ` · ${me.statusText}` : ''}` : me.statusText ?? 'Status setzen …' })),
  me.dnd ? uiIcon('moon', 'friends-me-moon') : uiIcon('chevron-down', 'friends-me-chevron'));
}

function closeStatusPop(): void {
  statusPop?.remove();
  statusPop = null;
}

function toggleStatusPop(anchor: HTMLElement): void {
  if (statusPop) {
    closeStatusPop();
    return;
  }
  const me = overview?.me;
  if (!me) return;
  const input = h('input', { type: 'text', id: 'friends-status-input', maxlength: String(STATUS_MAX), placeholder: 'z. B. Baue an meiner Burg', value: me.statusText ?? '', spellcheck: 'true', autocomplete: 'off', 'aria-label': 'Statustext' });
  const count = h('span', { class: 'friends-note-count', text: `${charCount(input.value)}/${STATUS_MAX}` });
  input.addEventListener('input', () => {
    count.textContent = `${charCount(input.value)}/${STATUS_MAX}`;
    count.classList.toggle('over', charCount(input.value) > STATUS_MAX);
  });
  const dnd = h('input', { type: 'checkbox', class: 'switch', id: 'friends-dnd' });
  dnd.checked = me.dnd;
  const save = h('button', { class: 'primary small', type: 'submit' }, uiIcon('check', 'btn-icon'), h('span', { text: 'Speichern' }));
  const clear = h('button', { class: 'ghost small', type: 'button', text: 'Status löschen', disabled: !me.statusText });
  const submit = async (statusText: string | null) => {
    save.disabled = true;
    clear.disabled = true;
    try {
      applyOverview(await api.setSocialStatus({ statusText, dnd: dnd.checked }));
      closeStatusPop();
      toast(dnd.checked ? 'Nicht stören ist an: keine Hinweise und Benachrichtigungen – die Glocke sammelt alles.' : 'Status gespeichert.', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
      save.disabled = false;
      clear.disabled = false;
    }
  };
  clear.addEventListener('click', () => void submit(null));
  statusPop = h('form', { class: 'friends-status-pop', role: 'dialog', 'aria-label': 'Eigener Status', onclick: (e: Event) => e.stopPropagation(), onsubmit: (e: Event) => {
    e.preventDefault();
    void submit(cleanText(input.value) || null);
  } },
  h('label', { class: 'stack friends-note-wrap' }, h('span', {}, 'Statustext', count), input),
  h('p', { class: 'hint small', text: 'Deine Freunde sehen ihn im Launcher, im Spiel und auf heldixclient.com – auch, wenn du offline bist.' }),
  h('label', { class: 'toggle-row' },
    h('span', {}, 'Nicht stören', h('small', { class: 'toggle-sub', text: 'Keine Hinweise und Töne; Nachrichten kommen trotzdem an, Party-Einladungen still' })),
    dnd),
  h('div', { class: 'button-row' }, clear, save));
  const rect = anchor.getBoundingClientRect();
  statusPop.style.top = `${Math.round(rect.bottom + 8)}px`;
  statusPop.style.left = `${Math.round(Math.max(12, rect.left))}px`;
  document.body.append(statusPop);
  input.focus();
}

function switchTab(next: Tab): void {
  if (tab === next) return;
  saveDraft();
  tab = next;
  render();
  if (next === 'invite') void loadInvites();
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
  const matchFriend = (f: Friend) => match(f.name) || (!!f.nickname && match(f.nickname));
  const incoming = overview.incoming.filter((r) => match(r.name));
  const outgoing = overview.outgoing.filter((r) => match(r.name));
  // Favoriten oben (online zuerst), dann online, dann offline – sortiert kommt die Liste schon aus dem Main-Prozess
  const favorites = overview.friends.filter((f) => f.favorite && matchFriend(f));
  const online = overview.friends.filter((f) => !f.favorite && f.online && matchFriend(f));
  const offline = overview.friends.filter((f) => !f.favorite && !f.online && matchFriend(f));

  if (incoming.length) {
    list.append(section('Anfragen', incoming.length));
    for (const request of incoming) list.append(incomingRow(request));
  }
  if (outgoing.length) {
    list.append(section('Gesendet', outgoing.length));
    for (const request of outgoing) list.append(outgoingRow(request));
  }
  if (favorites.length) {
    list.append(section('Favoriten', favorites.length));
    for (const friend of favorites) list.append(friendRow(friend));
  }
  if (online.length) {
    list.append(section('Online', online.length));
    for (const friend of online) list.append(friendRow(friend));
  }
  if (offline.length) {
    list.append(section('Offline', offline.length));
    for (const friend of offline) list.append(friendRow(friend));
  }
  // Freunde von Freunden (nur ohne Suche, höchstens 5)
  const suggested = !query && suggestions?.enabled
    ? suggestions.suggestions.filter((s) => !overview!.friends.some((f) => f.uuid === s.uuid) && !overview!.outgoing.some((r) => r.uuid === s.uuid)).slice(0, 5)
    : [];
  if (suggested.length) {
    list.append(section('Vorschläge', suggested.length));
    for (const suggestion of suggested) list.append(suggestionRow(suggestion));
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
  const name = displayName(friend);
  return h('button', {
    type: 'button',
    class: `friends-row${friend.uuid === selected ? ' active' : ''}${friend.online ? ' online' : ' offline'}${friend.unread ? ' unread' : ''}${friend.dnd ? ' dnd' : ''}`,
    'data-uuid': friend.uuid,
    title: friend.nickname ? `${friend.nickname} (${friend.name})` : friend.name,
    onclick: () => selectFriend(friend.uuid),
    oncontextmenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      openFriendMenu(friend, { x: e.clientX, y: e.clientY });
    },
  },
  head(friend.uuid, friend.name, 'sm', friendStatus(friend)),
  h('span', { class: 'friends-row-text' },
    h('span', { class: 'friends-row-name' },
      h('span', { class: 'friends-row-label', text: name }),
      friend.badge ? badgeIcon(friend.badge, 14) : null,
      friend.favorite ? h('span', { class: 'friends-star on', title: 'Favorit' }, uiIcon('star', '')) : null),
    h('span', { class: `friends-row-meta${isTyping(friend.uuid) ? ' typing' : ''}`, text: isTyping(friend.uuid) ? 'schreibt …' : presenceText(friend) }),
    friend.statusText ? h('span', { class: 'friends-row-status', text: friend.statusText }) : null),
  friend.unread > 0 ? h('span', { class: 'friends-unread', text: countLabel(friend.unread), title: friend.unread === 1 ? '1 ungelesene Nachricht' : `${friend.unread} ungelesene Nachrichten` }) : null);
}

function suggestionRow(suggestion: FriendSuggestions['suggestions'][number]): HTMLElement {
  const add = h('button', { class: 'ghost small', type: 'button', title: `${suggestion.name} eine Anfrage schicken` }, uiIcon('user-plus', 'btn-icon'), h('span', { text: 'Hinzufügen' }));
  add.addEventListener('click', () => void requestAction([add], async () => {
    applyOverview(await api.requestSuggestion(suggestion.uuid));
    if (suggestions) suggestions = { ...suggestions, suggestions: suggestions.suggestions.filter((s) => s.uuid !== suggestion.uuid) };
    toast(`Anfrage an ${suggestion.name} gesendet.`, 'success');
    renderList();
  }));
  return h('div', { class: 'friends-request suggestion', 'data-uuid': suggestion.uuid },
    h('div', { class: 'friends-request-top' },
      head(suggestion.uuid, suggestion.name),
      h('span', { class: 'friends-row-text' },
        h('span', { class: 'friends-row-name', text: suggestion.name }),
        h('span', { class: 'friends-row-meta', text: suggestion.mutual === 1 ? '1 gemeinsamer Freund' : `${suggestion.mutual} gemeinsame Freunde` })),
      add));
}

/** Vorschläge (Freunde von Freunden) höchstens alle 2 Minuten holen */
async function loadSuggestions(force = false): Promise<void> {
  if (!force && Date.now() - suggestionsAt < 120_000) return;
  suggestionsAt = Date.now();
  try {
    suggestions = await api.getFriendSuggestions();
  } catch {
    suggestions = null;
  }
  if (mode === 'friends') renderList();
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
    chat = { uuid, messages: [], pending: [], more: false, loaded: false, loading: false, loadingOlder: false, error: null, unreadFrom: null, replyTo: null };
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
  // nur Menüs der Unterhaltung schließen (Kontextmenü der Liste und eigener Status bleiben offen)
  if (menu && view.chat.contains(menu)) {
    menu.remove();
    menu = null;
  }
  closePicker();
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
  const input = h('input', { type: 'text', class: 'friends-input', placeholder: `Nachricht an ${displayName(friend)}`, 'aria-label': `Nachricht an ${displayName(friend)}`, autocomplete: 'off' });
  const counter = h('span', { class: 'friends-counter', hidden: true });
  const send = h('button', { class: 'primary friends-send', type: 'submit', title: 'Senden (Enter)', 'aria-label': 'Senden', disabled: true }, uiIcon('send', 'btn-icon'));
  const share = h('button', { class: 'icon-button friends-share', type: 'button', id: 'friends-share', title: 'Server oder Welt teilen', 'aria-label': 'Server oder Welt teilen', 'aria-haspopup': 'menu',
    onclick: (e: Event) => {
      e.stopPropagation();
      openShareMenu(e.currentTarget as HTMLElement, friend);
    } }, uiIcon('plus'));
  const reply = h('div', { class: 'friends-reply-bar', hidden: true });
  const form = h('form', { class: 'friends-composer', onsubmit: (e: Event) => {
    e.preventDefault();
    sendCurrent();
  } }, share, input, counter, send);
  panel.append(headEl, scroll, jump, reply, form);
  chatView = { uuid: friend.uuid, head: headEl, scroll, jump, input, counter, send, reply };

  input.value = drafts.get(friend.uuid) ?? '';
  input.addEventListener('input', updateComposer);
  input.addEventListener('input', () => sendTypingSoon(friend.uuid));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && chatFor(friend.uuid).replyTo) {
      event.stopPropagation();
      setReply(friend.uuid, null);
    }
  });
  scroll.addEventListener('scroll', () => {
    if (nearBottom(scroll)) jump.hidden = true;
  });
  jump.addEventListener('click', () => {
    scroll.scrollTop = scroll.scrollHeight;
    jump.hidden = true;
  });

  renderChatHead(friend);
  updateComposer();
  renderReplyBar();
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

// ---------- Antworten, „schreibt …“, Teilen ----------

function setReply(uuid: string, message: ChatMessage | null): void {
  chatFor(uuid).replyTo = message;
  // die Leiste nimmt Platz weg: war die Unterhaltung unten, bleibt sie unten
  const atBottom = chatView?.uuid === uuid && nearBottom(chatView.scroll);
  renderReplyBar();
  if (atBottom && chatView) chatView.scroll.scrollTop = chatView.scroll.scrollHeight;
  if (message && chatView?.uuid === uuid) chatView.input.focus();
}

function renderReplyBar(): void {
  const view = chatView;
  if (!view) return;
  const chat = chatFor(view.uuid);
  const message = chat.replyTo;
  view.reply.hidden = !message;
  view.reply.textContent = '';
  if (!message) return;
  const friend = friendByUuid(view.uuid);
  view.reply.append(uiIcon('reply', 'btn-icon'),
    h('span', { class: 'friends-reply-text' },
      h('strong', { text: message.mine ? 'Antwort auf deine Nachricht' : `Antwort an ${friend ? displayName(friend) : 'deinen Freund'}` }),
      h('span', { text: message.text })),
    h('button', { class: 'icon-button small', type: 'button', title: 'Antwort abbrechen (Esc)', 'aria-label': 'Antwort abbrechen', onclick: () => setReply(view.uuid, null) }, uiIcon('close')));
}

/** „schreibt …“ an den Freund – höchstens alle 3 s, nur mit Text im Feld */
function sendTypingSoon(uuid: string): void {
  if (!chatView?.input.value.trim()) return;
  const now = Date.now();
  if (now - typingSentAt < TYPING_SEND_MS) return;
  typingSentAt = now;
  void api.sendTyping(uuid).catch(() => undefined);
}

/** „schreibt …“ angekommen: 6 s zeigen (Kopf der Unterhaltung, Liste) */
function showTyping(uuid: string): void {
  typingUntil.set(uuid, Date.now() + TYPING_SHOW_MS);
  refreshTyping();
  window.clearTimeout(typingTimer);
  typingTimer = window.setTimeout(refreshTyping, TYPING_SHOW_MS + 50);
}

function stopTyping(uuid: string): void {
  if (!typingUntil.delete(uuid)) return;
  refreshTyping();
}

function refreshTyping(): void {
  if (mode !== 'friends') return;
  renderList();
  const friend = friendByUuid(chatView?.uuid ?? null);
  if (friend) renderChatHead(friend);
}

/** Menü „Teilen“ im Eingabefeld: Server oder eigene geteilte Welt als Beitreten-Karte */
function openShareMenu(anchor: HTMLElement, friend: Friend): void {
  if (menu) {
    closeMenu();
    return;
  }
  const item = (icon: string, label: string, sub: string, action: () => void) => h('button', {
    type: 'button',
    role: 'menuitem',
    class: 'friends-menu-two',
    onclick: (e: Event) => {
      e.stopPropagation();
      closeMenu();
      action();
    },
  }, uiIcon(icon, 'btn-icon'), h('span', { class: 'friends-menu-text' }, h('span', { text: label }), h('small', { text: sub })));
  menu = h('div', { class: 'friends-menu friends-share-menu', role: 'menu', onclick: (e: Event) => e.stopPropagation() },
    item('server', 'Server teilen …', 'Karte mit „Beitreten“ für einen Server', () => openShareServer(friend)),
    item('world', 'Welt teilen …', 'Eine deiner geteilten Welten', () => void openShareWorld(friend)));
  const box = listView?.chat.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  if (box) {
    menu.style.top = 'auto';
    menu.style.bottom = `${Math.round(box.bottom - rect.top + 8)}px`;
    menu.style.left = `${Math.round(rect.left - box.left)}px`;
    menu.style.right = 'auto';
  }
  listView?.chat.append(menu);
}

/** Karte senden (Text = Rückfall für ältere Clients, setzt der Main-Prozess) */
async function sendCard(uuid: string, card: MessageCard): Promise<boolean> {
  const chat = chatFor(uuid);
  try {
    const message = await api.sendMessage(uuid, '', { card, replyTo: chat.replyTo?.id ?? null });
    mergeMessages(chat, [message]);
    chat.replyTo = null;
    if (chatView?.uuid === uuid) {
      renderReplyBar();
      renderMessages({ toBottom: true });
    }
    return true;
  } catch (error) {
    toast(errorMessage(error), 'error');
    return false;
  }
}

function openShareServer(friend: Friend): void {
  const input = h('input', { type: 'text', id: 'share-server-input', placeholder: 'play.example.de', maxlength: '260', spellcheck: 'false', autocomplete: 'off', list: 'share-server-list', 'aria-label': 'Serveradresse' });
  const list = h('datalist', { id: 'share-server-list' });
  const title = h('input', { type: 'text', id: 'share-server-title', placeholder: 'Titel (freiwillig), z. B. Unser Survival', maxlength: '60', autocomplete: 'off', 'aria-label': 'Titel der Karte' });
  const submit = h('button', { class: 'primary', type: 'submit' }, uiIcon('send', 'btn-icon'), h('span', { text: 'Teilen' }));
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => e.target === backdrop && close() },
    h('form', { class: 'modal small friends-share-dialog', id: 'share-server', role: 'dialog', 'aria-modal': 'true', onsubmit: async (e: Event) => {
      e.preventDefault();
      const target = input.value.trim();
      if (!target) {
        input.focus();
        return;
      }
      submit.disabled = true;
      if (await sendCard(friend.uuid, { kind: 'server', target, title: cleanText(title.value) })) close();
      else submit.disabled = false;
    } },
    h('div', { class: 'modal-head' },
      h('div', {},
        h('h3', { class: 'modal-title', text: `Server mit ${displayName(friend)} teilen` }),
        h('p', { class: 'modal-sub', text: 'Er bekommt eine Karte mit „Beitreten“ – HeldixClient startet und verbindet direkt.' })),
      h('button', { class: 'icon-button', type: 'button', title: 'Schließen', onclick: close }, uiIcon('close'))),
    h('label', { class: 'stack' }, h('span', { text: 'Serveradresse' }), input, list),
    h('label', { class: 'stack' }, h('span', { text: 'Titel' }), title),
    h('p', { class: 'hint small', text: 'Nur öffentliche Adressen (keine IP-Adressen oder Heimnetz-Namen).' }),
    h('div', { class: 'modal-actions' }, h('button', { class: 'ghost', type: 'button', text: 'Abbrechen', onclick: close }), submit)));
  document.body.append(backdrop);
  input.focus();
  // Vorschläge aus der Serverliste der ausgewählten Instanz
  const instance = state.settings?.selectedInstanceId ?? state.instances[0]?.id;
  if (instance) {
    void api.listQuickPlay(instance).then((quick) => {
      for (const server of quick.targets.filter((t) => t.kind === 'server')) list.append(h('option', { value: server.address ?? server.id, text: server.name }));
    }).catch(() => undefined);
  }
}

async function openShareWorld(friend: Friend): Promise<void> {
  let worlds: Awaited<ReturnType<typeof api.listOwnWorlds>>;
  try {
    worlds = await api.listOwnWorlds();
  } catch (error) {
    toast(errorMessage(error), 'error');
    return;
  }
  if (!worlds.length) {
    toast('Du hast noch keine geteilte Welt. Teilen geht im Spiel über das Pausenmenü → „Welt teilen“.');
    return;
  }
  const close = () => backdrop.remove();
  const rows = worlds.map((world) => h('button', {
    type: 'button',
    class: 'friends-share-world',
    'data-code': world.code,
    onclick: async (e: Event) => {
      (e.currentTarget as HTMLButtonElement).disabled = true;
      if (await sendCard(friend.uuid, { kind: 'world', target: world.code, title: world.name })) close();
    },
  }, uiIcon('world', 'btn-icon'), h('span', { class: 'friends-row-text' },
    h('span', { class: 'friends-row-name', text: world.name }),
    h('span', { class: 'friends-row-meta', text: world.online ? 'Gerade geöffnet' : 'Gerade zu – beitreten kann er, sobald du sie öffnest' }))));
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => e.target === backdrop && close() },
    h('div', { class: 'modal small friends-share-dialog', id: 'share-world', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('h3', { class: 'modal-title', text: `Welt mit ${displayName(friend)} teilen` }),
          h('p', { class: 'modal-sub', text: 'Er bekommt eine Karte mit „Beitreten“. Wer nicht eingeladen ist, klopft an.' })),
        h('button', { class: 'icon-button', type: 'button', title: 'Schließen', onclick: close }, uiIcon('close'))),
      h('div', { class: 'friends-share-worlds' }, ...rows)));
  document.body.append(backdrop);
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
      title: gameBusy ? 'Es läuft schon ein Spiel.' : hostedWorld(friend.uuid) || isWorldAddress(friend.server) ? `Minecraft starten und der Welt von ${friend.name} beitreten` : `Minecraft starten und ${friend.server} beitreten`,
      disabled: gameBusy || !!joining,
      onclick: () => void joinFriend(friend),
    }, uiIcon('connect', 'btn-icon'), h('span', { class: 'friends-join-label', text: joining === friend.uuid ? 'Startet …' : 'Beitreten' }))
    : null;
  const typing = isTyping(friend.uuid);
  view.head.append(
    h('button', { class: 'icon-button friends-back', type: 'button', title: 'Zurück zur Liste', onclick: () => selectFriend(null) }, uiIcon('chevron-left')),
    h('button', { class: 'friends-chat-who', type: 'button', title: 'Profil ansehen', onclick: () => openProfile(friend.uuid) },
      head(friend.uuid, friend.name, 'md', friendStatus(friend)),
      h('span', { class: 'friends-chat-title' },
        h('span', { class: 'friends-chat-name', title: `Befreundet seit ${formatDate(friend.since)}` },
          h('span', { text: displayName(friend) }),
          friend.nickname ? h('span', { class: 'friends-chat-realname', text: friend.name }) : null,
          friend.badge ? badgeIcon(friend.badge, 16) : null),
        h('span', { class: `friends-chat-status${friend.online ? ' online' : ''}${typing ? ' typing' : ''}${friend.dnd ? ' dnd' : ''}`, id: 'friends-chat-status',
          text: typing ? 'schreibt …' : `${presenceText(friend)}${friend.statusText ? ` · „${friend.statusText}“` : ''}` }))),
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
    const inWorld = !!hostedWorld(friend.uuid) || isWorldAddress(friend.server);
    toast(inWorld ? `Minecraft startet und verbindet mit der Welt von ${friend.name}.` : `Minecraft startet und verbindet mit ${friend.server ?? 'dem Server'}.`, 'success');
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

  type Item = { id: number | null; text: string; at: number; mine: boolean; pending?: Pending; message?: ChatMessage };
  const items: Item[] = [
    ...chat.messages.map((m) => ({ id: m.id, text: m.text, at: m.at, mine: m.mine, message: m })),
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
    const m = item.message;
    const row = h('div', { class: `friends-msg${p ? ` pending ${p.status}` : ''}${m?.card ? ' has-card' : ''}`, title: p ? '' : fullTime(item.at), 'data-id': m ? String(m.id) : null },
      m ? bubble(m, friend ?? null) : h('div', { class: 'friends-bubble', text: item.text }),
      m ? messageActions(chat, m) : null,
      p ? null : h('span', { class: 'friends-msg-time', text: clock(item.at) }));
    group.append(row);
    if (m && Object.keys(m.reactions).length) group.append(reactionChips(chat, m));
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

// ---------- Blase: Antwort, Karte, Reaktionen, Aktionen ----------

function bubble(message: ChatMessage, friend: Friend | null): HTMLElement {
  const el = h('div', { class: 'friends-bubble' });
  if (message.replyTo) {
    const reply = message.replyTo;
    const who = reply.from === null ? null : reply.from === message.from ? (message.mine ? 'Du' : friend ? displayName(friend) : 'Er') : message.mine ? (friend ? displayName(friend) : 'Er') : 'Du';
    el.append(h('button', {
      class: 'friends-quote',
      type: 'button',
      title: 'Zur Nachricht springen',
      onclick: () => jumpToMessage(reply.id),
    }, h('strong', { text: reply.text === null ? 'Gelöschte Nachricht' : who ?? '' }), reply.text !== null ? h('span', { text: reply.text }) : null));
  }
  // Rückfall-Text der Karte („Komm auf …“) nicht doppelt zeigen
  if (!message.card || !message.text.includes(message.card.target)) el.append(h('span', { class: 'friends-bubble-text', text: message.text }));
  if (message.card) el.append(cardBox(message.card, message.mine));
  return el;
}

function cardBox(card: MessageCard, mine: boolean): HTMLElement {
  const icon = card.kind === 'server' ? 'server' : card.kind === 'world' ? 'world' : 'user-plus';
  const title = card.title || (card.kind === 'server' ? card.target : card.kind === 'world' ? 'Geteilte Welt' : 'Einladung zu HeldixClient');
  const sub = card.kind === 'server' ? card.target : card.kind === 'world' ? 'Geteilte Welt · mit passender Instanz' : 'Einladung – öffnet den Dialog';
  const join = h('button', { class: 'primary small friends-card-join', type: 'button', disabled: gameBusy && card.kind !== 'invite',
    title: gameBusy && card.kind !== 'invite' ? 'Es läuft schon ein Spiel.' : '',
    onclick: (e: Event) => void joinCard(card, e.currentTarget as HTMLButtonElement) },
  uiIcon(card.kind === 'invite' ? 'chevron-right' : 'connect', 'btn-icon'), h('span', { text: card.kind === 'invite' ? 'Öffnen' : 'Beitreten' }));
  return h('div', { class: `friends-card-msg kind-${card.kind}${mine ? ' mine' : ''}`, 'data-kind': card.kind },
    h('span', { class: 'friends-card-icon' }, uiIcon(icon)),
    h('span', { class: 'friends-card-text' }, h('strong', { text: title }), h('span', { text: sub })),
    join);
}

/** „Beitreten“ auf einer Karte: Server per Quick Play, Welt über den Dialog „Welt von …“, Einladung über den Einladungsdialog */
async function joinCard(card: MessageCard, button: HTMLButtonElement): Promise<void> {
  if (card.kind === 'world') {
    openWorldDialog(card.target);
    return;
  }
  if (card.kind === 'invite') {
    try {
      await api.pasteInviteLink(`heldixclient://einladung/${card.target}`);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
    return;
  }
  button.disabled = true;
  try {
    const result = await api.joinServer(card.target);
    toast(`Minecraft startet mit „${result.instanceName}“ und verbindet mit ${result.server}.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    button.disabled = false;
  }
}

function jumpToMessage(id: number): void {
  const row = chatView?.scroll.querySelector<HTMLElement>(`.friends-msg[data-id="${id}"]`);
  if (!row) {
    toast('Diese Nachricht ist weiter oben – lade ältere Nachrichten.');
    return;
  }
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

/** Knöpfe beim Darüberfahren: Antworten, Reagieren, (eigene) Löschen */
function messageActions(chat: Chat, message: ChatMessage): HTMLElement {
  const button = (icon: string, label: string, onclick: (e: Event) => void, extra = '') =>
    h('button', { class: `icon-button small${extra}`, type: 'button', title: label, 'aria-label': label, onclick }, uiIcon(icon));
  return h('span', { class: 'friends-msg-actions' },
    button('reply', 'Antworten', () => setReply(chat.uuid, message)),
    button('smile', 'Reagieren', (e) => {
      e.stopPropagation();
      openPicker(e.currentTarget as HTMLElement, chat, message);
    }),
    message.mine ? button('trash', 'Für beide löschen', () => void deleteOwn(chat, message), ' danger') : null);
}

function closePicker(): void {
  picker?.remove();
  picker = null;
}

function openPicker(anchor: HTMLElement, chat: Chat, message: ChatMessage): void {
  closePicker();
  const me = overview?.me?.uuid ?? '';
  const mine = message.reactions[me] ?? null;
  picker = h('div', { class: 'friends-reaction-picker', role: 'menu', onclick: (e: Event) => e.stopPropagation() },
    ...REACTIONS.map((r) => h('button', {
      type: 'button',
      role: 'menuitemradio',
      class: r.id === mine ? 'active' : '',
      title: r.label,
      'aria-label': r.label,
      'aria-checked': String(r.id === mine),
      'data-reaction': r.id,
      onclick: () => {
        closePicker();
        void react(chat, message, r.id === mine ? null : r.id);
      },
    }, r.emoji)));
  const box = chatView?.scroll.getBoundingClientRect();
  const rect = anchor.getBoundingClientRect();
  if (!box || !chatView) return;
  picker.style.top = `${Math.round(rect.top - box.top + chatView.scroll.scrollTop - 46)}px`;
  picker.style.left = `${Math.round(Math.min(Math.max(8, rect.left - box.left - 120), box.width - 330))}px`;
  chatView.scroll.append(picker);
}

/** Reaktionen unter der Blase: Emoji mit Zahl, eigene hervorgehoben; Klick setzt bzw. nimmt die eigene */
function reactionChips(chat: Chat, message: ChatMessage): HTMLElement {
  const me = overview?.me?.uuid ?? '';
  const counts = new Map<ReactionId, string[]>();
  for (const [uuid, reaction] of Object.entries(message.reactions)) counts.set(reaction, [...(counts.get(reaction) ?? []), uuid]);
  const friend = friendByUuid(chat.uuid);
  const names = (uuids: string[]) => uuids.map((u) => (u === me ? 'Du' : friend ? displayName(friend) : 'Freund')).join(', ');
  return h('div', { class: `friends-reactions${message.mine ? ' mine' : ''}`, 'data-for': String(message.id) },
    ...REACTIONS.filter((r) => counts.has(r.id)).map((r) => {
      const who = counts.get(r.id)!;
      const own = who.includes(me);
      return h('button', {
        type: 'button',
        class: `friends-reaction${own ? ' own' : ''}`,
        title: `${names(who)}: ${r.label}`,
        'data-reaction': r.id,
        onclick: () => void react(chat, message, own ? null : r.id),
      }, h('span', { text: r.emoji }), who.length > 1 ? h('span', { class: 'friends-reaction-count', text: String(who.length) }) : null);
    }));
}

async function react(chat: Chat, message: ChatMessage, reaction: ReactionId | null): Promise<void> {
  try {
    const updated = await api.reactMessage(chat.uuid, message.id, reaction);
    replaceMessage(chat, message.id, { reactions: updated.reactions });
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function deleteOwn(chat: Chat, message: ChatMessage): Promise<void> {
  const ok = await confirmDialog('Nachricht löschen?', 'Die Nachricht verschwindet für euch beide, auch im Spiel und auf heldixclient.com.', 'Löschen');
  if (!ok) return;
  try {
    await api.deleteMessage(chat.uuid, message.id);
    removeMessage(chat, message.id);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

function replaceMessage(chat: Chat, id: number, patch: Partial<ChatMessage>): void {
  let changed = false;
  chat.messages = chat.messages.map((m) => {
    if (m.id !== id) return m;
    changed = true;
    return { ...m, ...patch };
  });
  if (changed && chatView?.uuid === chat.uuid) renderMessages();
}

function removeMessage(chat: Chat, id: number): void {
  const before = chat.messages.length;
  chat.messages = chat.messages.filter((m) => m.id !== id);
  // Antworten darauf zeigen jetzt „Gelöschte Nachricht“
  chat.messages = chat.messages.map((m) => (m.replyTo?.id === id ? { ...m, replyTo: { id, from: null, text: null } } : m));
  if (chat.replyTo?.id === id) chat.replyTo = null;
  if (chat.messages.length !== before && chatView?.uuid === chat.uuid) {
    renderReplyBar();
    renderMessages();
  }
}

// ---------- Echtzeit in Unterhaltungen ----------

function onChatEvent(event: ChatEvent): void {
  const chat = chats.get(event.uuid);
  switch (event.kind) {
    case 'message': {
      if (!event.message.mine) stopTyping(event.uuid);
      if (!chat?.loaded) return;
      const atBottom = chatView?.uuid === event.uuid ? nearBottom(chatView.scroll) : true;
      mergeMessages(chat, [event.message]);
      if (chatView?.uuid !== event.uuid) return;
      renderMessages();
      if (!event.message.mine && !atBottom) chatView.jump.hidden = false;
      if (!event.message.mine && pageVisible()) void markSeen(event.uuid);
      return;
    }
    case 'deleted':
      if (chat) removeMessage(chat, event.id);
      return;
    case 'reaction':
      if (chat) replaceMessage(chat, event.id, { reactions: event.reactions });
      return;
    case 'typing':
      showTyping(event.uuid);
      return;
    case 'read':
      return;
  }
}

/** Nachrichten übernehmen: neue dazu, bekannte ersetzen (Reaktionen); true = etwas hat sich geändert */
function mergeMessages(chat: Chat, incoming: ChatMessage[]): boolean {
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  const fresh: ChatMessage[] = [];
  let changed = false;
  for (const message of incoming) {
    const known = byId.get(message.id);
    if (!known) fresh.push(message);
    else if (JSON.stringify(known) === JSON.stringify(message)) continue;
    byId.set(message.id, message);
    changed = true;
  }
  if (!changed) return false;
  chat.messages = [...byId.values()].sort((a, b) => a.id - b.id);
  // eigene Nachricht kam per Abruf schneller zurück als die Antwort aufs Senden
  for (const message of fresh) {
    if (!message.mine) continue;
    const index = chat.pending.findIndex((p) => p.status === 'sending' && p.text === message.text);
    if (index >= 0) chat.pending.splice(index, 1);
  }
  return true;
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
      // ohne Echtzeit: im Bereich der Seite fehlende Nachrichten wurden gelöscht
      const oldest = page.messages[0]?.id ?? Infinity;
      const latest = page.messages.at(-1)?.id ?? 0;
      const ids = new Set(page.messages.map((m) => m.id));
      const before = chat.messages.length;
      // behalten: auf der Seite, älter als die Seite (wenn es ältere gibt) oder neuer (gerade erst gesendet)
      chat.messages = chat.messages.filter((m) => ids.has(m.id) || (page.more && m.id < oldest) || m.id > latest);
      const removed = chat.messages.length !== before;
      const changed = mergeMessages(chat, page.messages);
      if (!fresh.length) {
        if ((changed || removed) && chatView?.uuid === uuid) renderMessages();
        return;
      }
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
  const pending: Pending = { key: ++pendingKey, text, at: Date.now(), status: 'sending', error: null, replyTo: chat.replyTo?.id ?? null };
  chat.pending.push(pending);
  chat.unreadFrom = null;
  chat.replyTo = null;
  typingSentAt = 0;
  renderReplyBar();
  view.jump.hidden = true;
  renderMessages({ toBottom: true });
  void deliver(chat, pending);
}

async function deliver(chat: Chat, pending: Pending): Promise<void> {
  pending.status = 'sending';
  pending.error = null;
  if (chatView?.uuid === chat.uuid) renderMessages({ toBottom: true });
  try {
    const message = await api.sendMessage(chat.uuid, pending.text, pending.replyTo ? { replyTo: pending.replyTo } : undefined);
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
    // mit Echtzeit-Verbindung kommen neue Nachrichten, Reaktionen und Löschungen von selbst (Rückfall: abfragen)
    if (overview.realtime === 'live') return;
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

// ---------- Menü: Profil, Party, Favorit, Spitzname, Entfernen, Blockieren, Melden ----------
function closeMenu(): void {
  menu?.remove();
  menu = null;
  closePicker();
  closeStatusPop();
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
  menu = h('div', { class: 'friends-menu', role: 'menu', onclick: (e: Event) => e.stopPropagation() }, ...friendMenuItems(friend, item, false));
  chatView?.head.append(menu);
}

type MenuItemFactory = (icon: string, label: string, action: () => void, danger?: boolean) => HTMLElement;

/** Einträge für das Menü zu einem Freund (Kopf der Unterhaltung und Rechtsklick in der Liste) */
function friendMenuItems(friend: Friend, item: MenuItemFactory, withChat: boolean): HTMLElement[] {
  const items: HTMLElement[] = [];
  if (withChat) items.push(item('chat', 'Nachricht schreiben', () => selectFriend(friend.uuid)));
  items.push(item('user', 'Profil ansehen', () => openProfile(friend.uuid)));
  if (canInviteToParty(friend.uuid)) items.push(item('friends', 'In Party einladen', () => void inviteToParty(friend.uuid, displayName(friend))));
  if (withChat && canJoin(friend)) items.push(item('connect', 'Beitreten', () => void joinFriend(friend)));
  items.push(item('star', friend.favorite ? 'Favorit entfernen' : 'Als Favorit (oben)', () => void toggleFavorite(friend)));
  items.push(item('edit', 'Spitzname & Notiz …', () => openNames(friend)));
  items.push(h('div', { class: 'friends-menu-line' }));
  items.push(item('trash', 'Freund entfernen', () => void removeFriend(friend), true));
  items.push(item('ban', 'Blockieren', () => void blockFriend(friend), true));
  items.push(h('div', { class: 'friends-menu-line' }));
  items.push(item('flag', 'Melden …', () => openReport(friend)));
  return items;
}

/** Rechtsklick auf einen Freund in der Liste: Menü an der Maus */
function openFriendMenu(friend: Friend, at: { x: number; y: number }): void {
  closeMenu();
  const item: MenuItemFactory = (icon, label, action, danger = false) => h('button', {
    type: 'button',
    role: 'menuitem',
    class: danger ? 'danger-item' : '',
    onclick: (e: Event) => {
      e.stopPropagation();
      closeMenu();
      action();
    },
  }, uiIcon(icon, 'btn-icon'), h('span', { text: label }));
  menu = h('div', { class: 'friends-menu friends-context-menu', role: 'menu', onclick: (e: Event) => e.stopPropagation() },
    h('div', { class: 'friends-party-menu-title', text: displayName(friend) }),
    ...friendMenuItems(friend, item, true));
  menu.style.left = `${Math.round(at.x)}px`;
  menu.style.top = `${Math.round(at.y)}px`;
  menu.style.right = 'auto';
  document.body.append(menu);
  // am Fensterrand nach innen schieben
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 8) menu.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
  if (rect.bottom > window.innerHeight - 8) menu.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`;
}

// ---------- Favorit, Spitzname, Notiz, Profilkarte ----------

async function toggleFavorite(friend: Friend): Promise<void> {
  try {
    applyOverview(await api.updateFriend(friend.uuid, { favorite: !friend.favorite }));
    toast(friend.favorite ? `${displayName(friend)} ist kein Favorit mehr.` : `${displayName(friend)} steht jetzt oben bei den Favoriten.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

/** Dialog „Spitzname & Notiz“ (nur für dich, der Freund sieht nichts davon) */
function openNames(friend: Friend): void {
  const nickname = h('input', { type: 'text', id: 'friend-nickname', maxlength: String(NICKNAME_MAX), placeholder: friend.name, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Spitzname' });
  nickname.value = friend.nickname ?? '';
  const note = h('textarea', { class: 'friends-note', id: 'friend-note', rows: '3', maxlength: String(FRIEND_NOTE_MAX), placeholder: 'z. B. aus dem Bauprojekt, spielt meist abends', spellcheck: 'true' });
  note.value = friend.note ?? '';
  const noteCount = h('span', { class: 'friends-note-count', text: `${charCount(note.value)}/${FRIEND_NOTE_MAX}` });
  note.addEventListener('input', () => {
    noteCount.textContent = `${charCount(note.value)}/${FRIEND_NOTE_MAX}`;
    noteCount.classList.toggle('over', charCount(note.value) > FRIEND_NOTE_MAX);
  });
  note.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') e.preventDefault();
  });
  const save = h('button', { class: 'primary', type: 'submit' }, uiIcon('check', 'btn-icon'), h('span', { text: 'Speichern' }));
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => e.target === backdrop && close() },
    h('form', { class: 'modal small', id: 'friend-names', role: 'dialog', 'aria-modal': 'true', onsubmit: async (e: Event) => {
      e.preventDefault();
      save.disabled = true;
      try {
        applyOverview(await api.updateFriend(friend.uuid, { nickname: cleanText(nickname.value) || null, note: cleanText(note.value) || null }));
        close();
        toast('Gespeichert – nur du siehst Spitzname und Notiz.', 'success');
      } catch (error) {
        toast(errorMessage(error), 'error');
        save.disabled = false;
      }
    } },
    h('div', { class: 'modal-head' },
      h('div', {},
        h('h3', { class: 'modal-title', text: `Spitzname & Notiz für ${friend.name}` }),
        h('p', { class: 'modal-sub', text: 'Nur für dich – dein Freund erfährt nichts davon.' })),
      h('button', { class: 'icon-button', type: 'button', title: 'Schließen', onclick: close }, uiIcon('close'))),
    h('label', { class: 'stack' }, h('span', { text: `Spitzname (höchstens ${NICKNAME_MAX} Zeichen)` }), nickname),
    h('label', { class: 'stack friends-note-wrap' }, h('span', {}, 'Notiz', noteCount), note),
    h('div', { class: 'modal-actions' }, h('button', { class: 'ghost', type: 'button', text: 'Abbrechen', onclick: close }), save)));
  document.body.append(backdrop);
  nickname.focus();
}

const profileActions: ProfileActions = {
  head: (uuid, name, size) => head(uuid, name, size),
  presence: (friend) => presenceText(friend),
  canJoin: (friend) => canJoin(friend),
  canInvite: (friend) => canInviteToParty(friend.uuid),
  message: (friend) => openFriendChat(friend.uuid),
  invite: (friend) => void inviteToParty(friend.uuid, displayName(friend)),
  join: (friend) => void joinFriend(friend),
  toggleFavorite: (friend) => toggleFavorite(friend),
  editNames: (friend) => openNames(friend),
  remove: (friend) => void removeFriend(friend),
  block: (friend) => void blockFriend(friend),
  report: (friend) => openReport(friend),
};

/** Profilkarte eines Freundes */
export function openProfile(uuid: string): void {
  closeMenu();
  void openProfileCard(uuid, profileActions);
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

// ---------- Reiter „Einladen“ (Heldix-Dienst ab 1.11.0) ----------
const inviteDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });

function loadInvites(): Promise<void> {
  invitesLoading ??= (async () => {
    try {
      invites = await api.getInvites();
      invitesError = null;
    } catch (error) {
      invitesError = errorMessage(error);
    } finally {
      invitesLoading = null;
    }
    // ohne Einladungen beim Dienst: Reiter weg
    if (invites && !invites.available && tab === 'invite') tab = 'friends';
    render();
    renderInvites();
  })();
  return invitesLoading;
}

async function copyLink(link: InviteLink): Promise<void> {
  try {
    await navigator.clipboard.writeText(link.url ?? link.appUrl);
    toast(link.server ? `Link für ${link.server} kopiert.` : 'Einladungslink kopiert.', 'success');
  } catch {
    toast('Der Link ließ sich nicht kopieren.', 'error');
  }
}

async function revokeLink(link: InviteLink, buttonEl: HTMLButtonElement): Promise<void> {
  const ok = await confirmDialog('Link widerrufen?',
    'Wer den Link noch nicht geöffnet hat, kann ihn danach nicht mehr annehmen. Freundschaften und Belohnungen bleiben.',
    'Widerrufen');
  if (!ok) return;
  buttonEl.disabled = true;
  try {
    invites = await api.revokeInvite(link.code);
    invitesError = null;
    toast('Link widerrufen.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  renderInvites();
}

async function createServerLink(input: HTMLInputElement, buttonEl: HTMLButtonElement): Promise<void> {
  const server = input.value.trim();
  if (!server) {
    input.focus();
    return;
  }
  buttonEl.disabled = true;
  input.disabled = true;
  try {
    const link = await api.createInvite(server);
    await copyLink(link);
    input.value = '';
    invites = await api.getInvites();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  renderInvites();
}

function inviteStat(key: string, value: number, label: string): HTMLElement {
  return h('div', { class: 'friends-invite-stat', 'data-stat': key },
    h('span', { class: 'friends-invite-stat-value', text: String(value) }),
    h('span', { class: 'friends-invite-stat-label', text: label }));
}

/** Eingefügter Link eines Freundes: der Main-Prozess prüft ihn und öffnet den Einladungsdialog (invite.ts) */
async function openPastedLink(input: HTMLInputElement, buttonEl: HTMLButtonElement): Promise<void> {
  const text = input.value.trim();
  if (!text) {
    input.focus();
    return;
  }
  buttonEl.disabled = true;
  try {
    await api.pasteInviteLink(text);
    input.value = '';
  } catch (error) {
    toast(errorMessage(error), 'error');
    input.focus();
  } finally {
    buttonEl.disabled = false;
  }
}

/** Karte „Link von einem Freund? Hier einfügen“ (immer im Reiter, auch ohne eigene Einladungen) */
function pasteCard(): HTMLElement {
  const input = h('input', { type: 'text', id: 'invite-paste-input', placeholder: 'heldixclient.com/einladung#…', spellcheck: 'false', maxlength: '2000', autocomplete: 'off', 'aria-label': 'Einladungslink eines Freundes' });
  const button = h('button', { class: 'ghost', id: 'invite-paste-open', type: 'submit' }, uiIcon('chevron-right', 'btn-icon'), h('span', { text: 'Öffnen' }));
  return h('div', { class: 'card', id: 'invite-paste' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('chat')),
      h('div', {},
        h('h3', { text: 'Link von einem Freund? Hier einfügen' }),
        h('p', { class: 'hint', text: 'Einladungslink von der Webseite (heldixclient.com/einladung#…) oder heldixclient://einladung/… – der Launcher zeigt dir die Einladung.' }))),
    h('form', { class: 'friends-invite-row', onsubmit: (e: Event) => {
      e.preventDefault();
      void openPastedLink(input, button);
    } }, input, button));
}

function renderInvites(): void {
  const pane = root().querySelector<HTMLElement>('.friends-pane-invite');
  if (!pane) return;
  pane.textContent = '';
  const intro = h('div', { class: 'card friends-invite-card', id: 'friends-invite' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('user-plus')),
      h('div', {},
        h('h3', { text: 'Freunde einladen' }),
        h('p', { class: 'hint', text: 'Wer über deinen Link neu zu HeldixClient kommt, bekommt sofort den Freundesfunken – und ihr seid gleich befreundet.' }))));
  const cards = h('div', { class: 'cards' }, intro);
  pane.append(cards);

  if (!invites) {
    if (invitesError) {
      intro.append(h('p', { class: 'hint', text: invitesError }),
        h('div', { class: 'button-row' }, h('button', { class: 'ghost small', type: 'button', onclick: () => void loadInvites() }, uiIcon('refresh', 'btn-icon'), h('span', { text: 'Erneut versuchen' }))));
    } else intro.append(h('div', { class: 'friends-list-empty' }, h('div', { class: 'friends-spinner' })));
    cards.append(pasteCard());
    return;
  }
  if (!invites.available) {
    intro.append(h('p', { class: 'hint', text: 'Der Heldix-Dienst kennt noch keine Einladungen.' }));
    cards.append(pasteCard());
    return;
  }
  const current = invites;

  // allgemeiner Link
  const general = current.link;
  if (general) {
    const field = h('input', { type: 'text', class: 'friends-invite-link', id: 'invite-link-input', readonly: true, 'aria-label': 'Dein Einladungslink', spellcheck: 'false' });
    field.value = general.url ?? general.appUrl;
    field.addEventListener('focus', () => field.select());
    intro.append(h('div', { class: 'friends-invite-row' },
      field,
      h('button', { class: 'primary', id: 'invite-copy', type: 'button', onclick: () => void copyLink(general) }, uiIcon('copy', 'btn-icon'), h('span', { text: 'Link kopieren' }))));
    intro.append(h('p', { class: 'hint small', text: general.url
      ? `Gilt bis ${inviteDate.format(general.expires)}. Wer HeldixClient schon hat, öffnet die Einladung direkt im Launcher.`
      : 'Der Link öffnet die Einladung direkt im Launcher deines Freundes.' }));
  }

  // Zähler und Belohnungen
  intro.append(h('div', { class: 'friends-invite-stats', id: 'invite-stats' },
    inviteStat('invited', current.invited, 'Eingeladen'),
    inviteStat('confirmed', current.confirmed, 'Bestätigt'),
    inviteStat('pending', current.pending, 'Ausstehend')));
  intro.append(h('p', { class: 'hint small', text: 'Bestätigt ist eine Einladung, sobald dein Freund insgesamt 30 Minuten mit HeldixClient gespielt hat.' }));

  const rewards = h('div', { class: 'card', id: 'invite-rewards' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('sparkles')),
      h('div', {},
        h('h3', { text: 'Belohnungen' }),
        h('p', { class: 'hint', text: 'Für bestätigte Freunde – du findest sie danach unter Skins & Cosmetics.' }))));
  for (const reward of current.rewards) {
    const done = Math.min(current.confirmed, reward.friends);
    const bar = h('div', { class: 'friends-invite-bar' }, h('div', { class: 'friends-invite-bar-fill' }));
    (bar.firstChild as HTMLElement).style.width = `${reward.unlocked ? 100 : Math.round((done / reward.friends) * 100)}%`;
    rewards.append(h('div', { class: `friends-invite-reward${reward.unlocked ? ' unlocked' : ''}`, 'data-cosmetic': reward.cosmetic },
      h('div', { class: 'friends-invite-reward-top' },
        h('span', { class: 'friends-invite-reward-name', text: reward.name }),
        h('span', { class: 'friends-invite-reward-state' },
          reward.unlocked ? uiIcon('check', 'btn-icon') : null,
          reward.unlocked ? 'Freigeschaltet' : `${done} / ${reward.friends}`)),
      bar,
      h('span', { class: 'friends-invite-reward-sub', text: reward.friends === 1 ? 'ab 1 bestätigtem Freund' : `ab ${reward.friends} bestätigten Freunden` })));
  }
  if (!current.rewards.length) rewards.append(h('p', { class: 'hint', text: 'Gerade gibt es keine Belohnungen.' }));

  // Link für einen Server und offene Links
  const serverInput = h('input', { type: 'text', id: 'invite-server-input', placeholder: 'play.example.de', spellcheck: 'false', maxlength: '260', 'aria-label': 'Serveradresse' });
  const serverButton = h('button', { class: 'ghost', id: 'invite-server-create', type: 'submit' }, uiIcon('server', 'btn-icon'), h('span', { text: 'Link erstellen' }));
  const linksCard = h('div', { class: 'card', id: 'invite-links' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('server')),
      h('div', {},
        h('h3', { text: '„Komm auf meinen Server“' }),
        h('p', { class: 'hint', text: 'Link mit Serveradresse: Wer ihn öffnet, startet HeldixClient und landet direkt auf dem Server.' }))),
    h('form', { class: 'friends-invite-row', onsubmit: (e: Event) => {
      e.preventDefault();
      void createServerLink(serverInput, serverButton);
    } }, serverInput, serverButton));
  const open = h('div', { class: 'friends-invite-list' });
  for (const link of current.invites) {
    const revoke = h('button', { class: 'ghost small friends-invite-revoke', type: 'button', 'data-code': link.code, title: 'Link widerrufen' }, h('span', { text: 'Widerrufen' }));
    revoke.addEventListener('click', () => void revokeLink(link, revoke));
    const meta = [`bis ${inviteDate.format(link.expires)}`, link.accepted === 1 ? '1× angenommen' : `${link.accepted}× angenommen`];
    open.append(h('div', { class: 'friends-invite-item', 'data-code': link.code },
      h('span', { class: 'friends-invite-item-icon' }, uiIcon(link.voice ? 'mic' : link.server ? 'server' : 'user-plus')),
      h('span', { class: 'friends-row-text' },
        h('span', { class: 'friends-row-name', text: link.server ?? 'Allgemeiner Link' }),
        h('span', { class: 'friends-row-meta', text: `${link.voice ? 'Mit Voice-Gruppe · ' : ''}${meta.join(' · ')}` })),
      h('button', { class: 'icon-button', type: 'button', title: 'Link kopieren', 'aria-label': 'Link kopieren', onclick: () => void copyLink(link) }, uiIcon('copy')),
      revoke));
  }
  if (current.invites.length) linksCard.append(h('div', { class: 'friends-section' }, h('span', { text: 'Offene Links' }), h('span', { class: 'friends-section-count', text: String(current.invites.length) })), open);

  cards.append(rewards, linksCard, pasteCard());
}

/** Reiter „Einladen“ öffnen (aus Skins & Cosmetics oder einer Benachrichtigung) */
export function openInviteSection(): void {
  const show = () => {
    if (invites?.available) switchTab('invite');
    else if (invites && !invites.available) toast('Der Heldix-Dienst kennt noch keine Einladungen.', 'error');
  };
  if (overview?.status !== 'online') {
    // nach dem Verbinden dorthin
    tab = 'invite';
    void refresh();
    return;
  }
  if (invites) {
    show();
    void loadInvites();
  } else void loadInvites().then(show);
}

// ---------- Reiter „Blockiert“ und „Privatsphäre“ ----------
function buildPane(kind: 'invite' | 'blocked' | 'privacy'): HTMLElement {
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

type PrivacySwitch = Exclude<keyof SocialPrivacy, 'onlineNotify'>;

const PRIVACY: { key: PrivacySwitch; label: string; sub: string }[] = [
  { key: 'presence', label: 'Online-Status zeigen', sub: 'Freunde sehen, ob du online bist und was du spielst' },
  { key: 'showServer', label: 'Server zeigen', sub: 'Freunde sehen deinen Server und können beitreten' },
  { key: 'showLastOnline', label: 'Zuletzt online zeigen', sub: 'Freunde sehen „zuletzt online vor …“ (gerundet auf 5 Minuten, Stunden bzw. Tage)' },
  { key: 'messages', label: 'Nachrichten annehmen', sub: 'Aus: Freunde können dir nicht schreiben, du ihnen schon' },
  { key: 'visible', label: 'Als HeldixClient-Spieler erkennbar', sub: 'Andere sehen dein Heldix-Symbol und dein Cape' },
  { key: 'suggestable', label: 'In Vorschlägen erscheinen', sub: 'Freunde deiner Freunde sehen dich als Vorschlag – ohne deine Freundesliste' },
  { key: 'showSuggestions', label: 'Vorschläge zeigen', sub: 'Freunde deiner Freunde unter „Vorschläge“ in der Liste' },
];

const ONLINE_NOTIFY: { id: OnlineNotify; label: string }[] = [
  { id: 'all', label: 'Alle Freunde' },
  { id: 'favorites', label: 'Nur Favoriten' },
  { id: 'none', label: 'Keine' },
];

async function setPrivacy(patch: Partial<SocialPrivacy>, input: HTMLInputElement | null): Promise<void> {
  if (input) input.disabled = true;
  try {
    privacy = await api.setSocialPrivacy(patch);
    if ('showSuggestions' in patch) void loadSuggestions(true);
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
      const input = h('input', { type: 'checkbox', class: 'switch', 'data-privacy': option.key });
      input.checked = current[option.key];
      // ohne Online-Status sehen Freunde auch keinen Server und kein „zuletzt online“
      const inactive = (option.key === 'showServer' || option.key === 'showLastOnline') && !current.presence;
      input.disabled = inactive;
      input.addEventListener('change', () => void setPrivacy({ [option.key]: input.checked }, input));
      service.append(h('label', { class: `toggle-row${inactive ? ' friends-inactive' : ''}` },
        h('span', {}, option.label, h('small', { class: 'toggle-sub', text: inactive ? 'Nur mit Online-Status' : option.sub })),
        input));
    }
  }
  service.append(h('div', { class: 'button-row' },
    h('button', { class: 'ghost small', type: 'button', onclick: () => void api.openWebAccount('privatsphaere') },
      uiIcon('external', 'btn-icon'), h('span', { text: 'Daten und Meldungen auf heldixclient.com' }))));

  // Benachrichtigungen: „Nicht stören“ und „ist online“ (beides beim Dienst, gilt auch im Spiel)
  const alerts = h('div', { class: 'card', id: 'friends-alerts' },
    h('div', { class: 'card-head' },
      h('div', { class: 'card-icon' }, uiIcon('bell')),
      h('div', {},
        h('h3', { text: 'Hinweise' }),
        h('p', { class: 'hint', text: 'Gilt im Launcher und im Spiel.' }))));
  const me = overview?.me;
  if (me) {
    const dnd = h('input', { type: 'checkbox', class: 'switch', id: 'privacy-dnd' });
    dnd.checked = me.dnd;
    dnd.addEventListener('change', async () => {
      dnd.disabled = true;
      try {
        applyOverview(await api.setSocialStatus({ dnd: dnd.checked }));
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
      renderPrivacy();
    });
    alerts.append(h('label', { class: 'toggle-row' },
      h('span', {}, 'Nicht stören', h('small', { class: 'toggle-sub', text: 'Keine Hinweise und Systembenachrichtigungen – die Glocke sammelt weiter, Freunde sehen den Mond' })),
      dnd));
  }
  if (privacy) {
    const currentNotify = privacy.onlineNotify;
    const segmented = h('div', { class: 'chip-toggle segmented friends-online-notify', id: 'privacy-online-notify', role: 'radiogroup', 'aria-label': '„Ist online“-Benachrichtigungen' },
      ...ONLINE_NOTIFY.map((option) => h('button', {
        type: 'button',
        role: 'radio',
        class: option.id === currentNotify ? 'active' : '',
        'aria-checked': String(option.id === currentNotify),
        'data-value': option.id,
        text: option.label,
        onclick: () => {
          if (option.id !== currentNotify) void setPrivacy({ onlineNotify: option.id }, null);
        },
      })));
    alerts.append(h('div', { class: 'stack friends-notify-row' },
      h('span', {}, '„Ist online“-Benachrichtigungen', h('small', { class: 'toggle-sub', text: 'Wenn ein Freund ins Spiel kommt (höchstens alle 10 Minuten je Freund)' })),
      segmented));
  }

  const notify = h('input', { type: 'checkbox', class: 'switch' });
  notify.checked = state.settings?.socialNotifications ?? true;
  notify.addEventListener('change', () => void saveSetting({ socialNotifications: notify.checked }, notify));
  const follow = h('input', { type: 'checkbox', class: 'switch', id: 'privacy-auto-follow' });
  follow.checked = state.settings?.partyAutoFollow ?? false;
  follow.addEventListener('change', () => void saveSetting({ partyAutoFollow: follow.checked }, follow));
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
      h('span', {}, 'Benachrichtigungen', h('small', { class: 'toggle-sub', text: 'Bei neuen Nachrichten, Anfragen und Party-Einladungen, wenn der Launcher im Hintergrund ist' })),
      notify),
    h('label', { class: 'toggle-row' },
      h('span', {}, 'Party: automatisch folgen', h('small', { class: 'toggle-sub', text: 'Wechselt der Leiter den Server oder die Welt, startet der Launcher dorthin – nur, wenn gerade kein Spiel läuft' })),
      follow),
    h('label', { class: 'toggle-row' },
      h('span', {}, 'Freunde & Nachrichten', h('small', { class: 'toggle-sub', text: 'Aus: Der Launcher meldet sich nicht beim Heldix-Dienst an' })),
      social));

  pane.append(h('div', { class: 'cards' }, service, alerts, launcher));
}

// ---------- Schnittstelle für app.ts ----------
/** einmal beim Start (Abzeichen, Benachrichtigungen) */
export function initFriends(): void {
  // offene Welten haben sich geändert: Aktivität und „Beitreten“ neu zeichnen
  onWorldsChange(() => {
    if (overview?.status === 'online') render();
  });
  initParty({
    friends: () => (overview?.status === 'online' ? overview.friends : []),
    me: () => (overview?.status === 'online' && overview.me ? { uuid: overview.me.uuid, dnd: overview.me.dnd } : null),
    head: (uuid, name, size, status) => head(uuid, name, size, status),
    openChat: (uuid) => openFriendChat(uuid),
    openProfile: (uuid) => openProfile(uuid),
    changed: () => updateBadge(),
  });
  api.onSocial(applyOverview);
  api.onChatEvent(onChatEvent);
  // Neues bei den Einladungen: Zähler und Belohnungen frisch, wenn der Reiter offen ist
  api.onInviteEvent(() => {
    if (mode === 'invite') void loadInvites();
  });
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
  document.addEventListener('contextmenu', (event) => {
    if (menu && !menu.contains(event.target as Node)) closeMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  render();
  api.getSocial().then(applyOverview, (error: unknown) => applyOverview(fallbackOverview(error)));
}

/** jedes Mal, wenn die Seite gezeigt wird */
export function activateFriends(): void {
  if (overview) void refresh();
  refreshParty();
  void loadSuggestions();
  if (mode === 'invite') void loadInvites();
  if (mode === 'blocked') void loadBlocked();
  if (mode === 'privacy') {
    renderPrivacy();
    void loadPrivacy();
  }
  resume();
}

/** Party-Bereich zeigen (aus der Glocke oder einer Benachrichtigung) */
export function openPartySection(): void {
  if (tab !== 'friends') switchTab('friends');
  window.requestAnimationFrame(() => focusParty());
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
