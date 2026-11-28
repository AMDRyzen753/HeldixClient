// Party oben auf der Freunde-Seite (#friends-party; Daten aus main/core/party.ts, Heldix-Dienst ab 1.12.0): Mitglieder
// mit Ort und Leiter (Krone), Freunde einladen (nur der Leiter), Einladungen annehmen/ablehnen, verlassen, entfernen,
// Leitung übergeben, Party-Chat und „Beitreten“ beim Leiter (Quick Play auf Server bzw. geteilte Welt mit passender
// Instanz). Einstellung „Automatisch folgen“ (nur, wenn kein Spiel läuft). Dazu Hinweise mit Knopf: neue Einladung
// („Annehmen“) und Folgen („<Leiter> ist auf <Ziel> – Beitreten“) – nicht bei „Nicht stören“ (die Glocke sammelt weiter).
import type { Friend, Party, PartyFollow, PartyInvite, PartyLocation, PartyMember, PartyState } from '../shared/api';
import { api, emit, errorMessage, h, state, toast, uiIcon } from './core.js';

export interface PartyContext {
  friends(): Friend[];
  /** eigener Spieler beim Dienst (null = nicht verbunden) */
  me(): { uuid: string; dnd: boolean } | null;
  head(uuid: string, name: string, size?: 'sm' | 'md', status?: 'online' | 'launcher' | 'offline' | 'dnd'): HTMLElement;
  openChat(uuid: string): void;
  openProfile(uuid: string): void;
  /** Stand hat sich geändert (Zähler an der Seitenleiste) */
  changed(): void;
}

const MAX_CHAT = 500;
/** Hinweise mit Knopf so lange zeigen */
const ACTION_TOAST_MS = 30_000;

let ctx: PartyContext | null = null;
let current: PartyState | null = null;
let host: HTMLElement | null = null;
let chatOpen = false;
let chatDraft = '';
/** höchste gelesene Nachricht im Party-Chat (ungelesen = neuere von anderen) */
let chatSeen = 0;
let menu: HTMLElement | null = null;
let busy = false;
let joining = false;
let gameBusy = false;
/** zuletzt gesehene Einladungen (neue → Hinweis) */
let knownInvites = new Set<string>();
let lastEnded: PartyState['ended'] = null;

// ---------- Hilfen ----------

export function partyState(): PartyState | null {
  return current;
}

function party(): Party | null {
  return current?.status === 'ok' ? current.party : null;
}

function myUuid(): string | null {
  return current?.me ?? ctx?.me()?.uuid ?? null;
}

function amLeader(): boolean {
  const p = party();
  return !!p && p.leader === myUuid();
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function locationText(location: PartyLocation | null): string {
  if (!location) return 'Gerade nicht auf einem Server';
  return location.kind === 'world' ? `In „${location.title}“` : `Auf ${location.title}`;
}

function memberText(member: PartyMember): string {
  if (member.away) return member.awayUntil ? `Ohne Verbindung – bleibt bis ${clock(member.awayUntil)}` : 'Ohne Verbindung';
  if (member.location) return locationText(member.location);
  // Dienst 1.14.0 sagt ausdrücklich, ob der Launcher verbunden ist; sonst ist nur noch eine andere Verbindung da
  if (!member.online) return member.launcher ? 'Im Launcher – bekommt Nachrichten sofort' : 'Nicht im Spiel';
  switch (member.state) {
    case 'singleplayer': return 'Einzelspieler';
    case 'multiplayer': return 'Mehrspieler';
    case 'realms': return 'Realms';
    case 'lan': return 'LAN-Welt';
    default: return 'Im Menü';
  }
}

/** Kann ich diesen Freund einladen? (verbunden, ohne Party oder als Leiter, nicht schon dabei, Platz frei) */
export function canInviteToParty(uuid: string): boolean {
  if (current?.status !== 'ok') return false;
  const p = current.party;
  if (!p) return true;
  if (p.leader !== myUuid()) return false;
  if (p.members.length + p.invites.length >= p.max) return false;
  return !p.members.some((m) => m.uuid === uuid) && !p.invites.some((i) => i.uuid === uuid);
}

/** offene Einladungen an mich (für den Zähler an der Seitenleiste) */
export function partyInviteCount(): number {
  return current?.status === 'ok' ? current.invites.length : 0;
}

function unreadChat(): number {
  const p = party();
  if (!p) return 0;
  const me = myUuid();
  return p.chat.filter((m) => m.id > chatSeen && m.from !== me).length;
}

async function act(task: () => Promise<PartyState>, success?: string): Promise<boolean> {
  if (busy) return false;
  busy = true;
  render();
  try {
    apply(await task());
    if (success) toast(success, 'success');
    return true;
  } catch (error) {
    toast(errorMessage(error), 'error');
    return false;
  } finally {
    busy = false;
    render();
  }
}

export async function inviteToParty(uuid: string, name: string): Promise<void> {
  closeMenu();
  await act(() => api.partyInvite(uuid), `${name} ist in die Party eingeladen.`);
}

export async function joinLeader(): Promise<void> {
  if (joining) return;
  joining = true;
  render();
  try {
    const result = await api.partyJoin();
    toast(`Minecraft startet mit „${result.instanceName}“ und verbindet: ${result.title}.`, 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    joining = false;
    render();
  }
}

// ---------- Hinweise mit Knopf ----------

/** Hinweis oben rechts (wie toast) mit einem Knopf; schließt nach 30 s oder per Klick */
function actionToast(title: string, body: string, label: string, action: () => void, icon = 'friends'): void {
  const container = document.querySelector('#toasts');
  if (!container) return;
  const close = () => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 260);
  };
  const button = h('button', { class: 'primary small', type: 'button', onclick: () => {
    close();
    action();
  } }, uiIcon(icon === 'connect' ? 'connect' : 'check', 'btn-icon'), h('span', { text: label }));
  const el = h('div', { class: 'toast info action-toast', role: 'status' },
    h('span', { class: 'toast-icon action' }, uiIcon(icon, '')),
    h('span', { class: 'action-toast-text' }, h('strong', { text: title }), body ? h('span', { text: body }) : null,
      h('span', { class: 'action-toast-buttons' }, button,
        h('button', { class: 'ghost small', type: 'button', text: 'Später', onclick: close }))));
  container.append(el);
  window.setTimeout(close, ACTION_TOAST_MS);
}

function quiet(): boolean {
  return ctx?.me()?.dnd === true;
}

function showFollow(follow: PartyFollow): void {
  const where = follow.target.kind === 'world' ? `in „${follow.target.title}“` : `auf ${follow.target.title}`;
  if (follow.joined) {
    toast(`Du folgst ${follow.leader.name} ${where} – Minecraft startet.`, 'success');
    return;
  }
  if (quiet()) return;
  actionToast(`${follow.leader.name} ist ${where}`, 'Der Leiter deiner Party ist woanders hin.', 'Beitreten', () => void joinLeader(), 'connect');
}

function noticeInvites(next: PartyState): void {
  const ids = new Set(next.invites.map((i) => i.party));
  if (current && next.status === 'ok') {
    for (const invite of next.invites) {
      if (knownInvites.has(invite.party) || invite.quiet || quiet()) continue;
      actionToast(`${invite.from.name} lädt dich in die Party ein`, invite.members > 1 ? `${invite.members} sind schon dabei.` : '', 'Annehmen',
        () => void act(() => api.partyAccept(invite.party), 'Du bist jetzt in der Party.'));
    }
  }
  knownInvites = ids;
}

// ---------- Stand ----------

function apply(next: PartyState): void {
  const before = current;
  noticeInvites(next);
  if (next.ended && next.ended !== lastEnded && before?.party) {
    if (next.ended === 'removed') toast('Du wurdest aus der Party entfernt.');
    else if (next.ended === 'dissolved') toast('Die Party hat sich aufgelöst.');
  }
  lastEnded = next.ended;
  if (before?.party?.id !== next.party?.id) {
    chatSeen = next.party?.chat.at(-1)?.id ?? 0;
    if (!next.party) chatOpen = false;
  }
  current = next;
  if (chatOpen) chatSeen = next.party?.chat.at(-1)?.id ?? chatSeen;
  render();
  ctx?.changed();
}

/** einmal beim Start */
export function initParty(context: PartyContext): void {
  ctx = context;
  api.onParty(apply);
  api.onPartyFollow(showFollow);
  api.onGameState((game) => {
    gameBusy = game.state === 'preparing' || game.state === 'running';
    render();
  });
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
  void api.getParty().then(apply).catch(() => undefined);
}

/** Freunde-Seite gezeigt: frisch holen */
export function refreshParty(): void {
  void api.getParty(true).then(apply).catch(() => undefined);
}

/** Party-Bereich für die Freunde-Seite (wird bei jedem Neuaufbau der Seite neu eingehängt) */
export function partySection(): HTMLElement {
  host = h('section', { class: 'friends-party', id: 'friends-party', 'aria-label': 'Party' });
  render();
  return host;
}

/** Zum Party-Bereich (aus der Glocke oder einer Benachrichtigung) */
export function focusParty(): void {
  const el = host;
  if (!el?.isConnected) return;
  el.scrollIntoView({ block: 'nearest' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

// ---------- Menüs ----------

function closeMenu(): void {
  menu?.remove();
  menu = null;
}

function openMenu(anchor: HTMLElement, items: (HTMLElement | null)[], className = ''): void {
  closeMenu();
  menu = h('div', { class: `friends-menu friends-party-menu ${className}`, role: 'menu', onclick: (e: Event) => e.stopPropagation() }, ...items);
  const rect = anchor.getBoundingClientRect();
  const box = host?.getBoundingClientRect();
  if (!host || !box) return;
  menu.style.top = `${Math.round(rect.bottom - box.top + 6)}px`;
  menu.style.left = `${Math.max(8, Math.round(rect.left - box.left))}px`;
  menu.style.right = 'auto';
  host.append(menu);
}

function menuItem(icon: string, label: string, action: () => void, danger = false): HTMLElement {
  return h('button', {
    type: 'button',
    role: 'menuitem',
    class: danger ? 'danger-item' : '',
    onclick: (e: Event) => {
      e.stopPropagation();
      closeMenu();
      action();
    },
  }, uiIcon(icon, 'btn-icon'), h('span', { text: label }));
}

/** im Spiel vor „Im Launcher“ vor offline */
const rank = (f: { online: boolean; launcher: boolean }) => (f.online ? 2 : f.launcher ? 1 : 0);

/** Liste der Freunde zum Einladen (im Spiel zuerst, dann im Launcher, dann offline – wie bisher alle einladbar) */
function openInviteMenu(anchor: HTMLElement): void {
  if (!ctx) return;
  const friends = ctx.friends().filter((f) => canInviteToParty(f.uuid))
    .sort((a, b) => rank(b) - rank(a) || (a.nickname || a.name).localeCompare(b.nickname || b.name, 'de'));
  const items: HTMLElement[] = friends.slice(0, 40).map((friend) => h('button', {
    type: 'button',
    role: 'menuitem',
    class: 'friends-party-pick',
    'data-uuid': friend.uuid,
    onclick: (e: Event) => {
      e.stopPropagation();
      void inviteToParty(friend.uuid, friend.nickname || friend.name);
    },
  }, ctx!.head(friend.uuid, friend.name, 'sm', friend.online ? 'online' : friend.launcher ? 'launcher' : 'offline'),
  h('span', { class: 'friends-row-text' },
    h('span', { class: 'friends-row-name', text: friend.nickname || friend.name }),
    h('span', { class: 'friends-row-meta', text: friend.online ? 'Im Spiel'
      : friend.launcher ? 'Im Launcher – sieht die Einladung sofort, mitspielen nach dem Start'
        : 'Offline – sieht die Einladung beim nächsten Start' }))));
  if (!items.length) items.push(h('div', { class: 'friends-party-menu-empty', text: ctx.friends().length ? 'Alle Freunde sind schon dabei oder eingeladen.' : 'Füge zuerst Freunde hinzu.' }));
  openMenu(anchor, [h('div', { class: 'friends-party-menu-title', text: 'In die Party einladen' }), ...items], 'wide');
}

function memberMenu(anchor: HTMLElement, member: PartyMember): void {
  const me = myUuid();
  const items: (HTMLElement | null)[] = [];
  if (member.uuid !== me) {
    items.push(menuItem('chat', 'Nachricht schreiben', () => ctx?.openChat(member.uuid)));
    items.push(menuItem('user', 'Profil ansehen', () => ctx?.openProfile(member.uuid)));
  }
  if (amLeader() && member.uuid !== me) {
    items.push(h('div', { class: 'friends-menu-line' }));
    items.push(menuItem('crown', 'Leitung übergeben', () => void act(() => api.partyTransfer(member.uuid), `${member.name} leitet jetzt die Party.`)));
    items.push(menuItem('close', 'Aus der Party entfernen', () => void act(() => api.partyKick(member.uuid), `${member.name} ist nicht mehr in der Party.`), true));
  }
  if (member.uuid === me) items.push(menuItem('quit', 'Party verlassen', () => void act(() => api.partyLeave(), 'Du hast die Party verlassen.'), true));
  if (items.length) openMenu(anchor, items);
}

// ---------- Darstellung ----------

function render(): void {
  const el = host;
  if (!el || !ctx) return;
  const keepScroll = el.querySelector<HTMLElement>('.friends-party-chat-list')?.scrollTop ?? null;
  const focused = document.activeElement === el.querySelector('.friends-party-chat-input');
  if (menu && el.contains(menu)) closeMenu();
  el.textContent = '';
  const ps = current;
  el.hidden = !ps || ps.status === 'off' || ps.status === 'unsupported';
  if (el.hidden || !ps) return;
  el.classList.toggle('has-party', !!ps.party);
  el.classList.toggle('busy', busy);

  for (const invite of ps.invites) el.append(inviteRow(invite));
  if (ps.status === 'error' && !ps.party) {
    el.append(h('div', { class: 'friends-party-bar' },
      h('span', { class: 'friends-party-icon error' }, uiIcon('warning')),
      h('span', { class: 'friends-party-text' }, h('strong', { text: 'Party gerade nicht verfügbar' }), h('span', { text: ps.error ?? '' })),
      h('button', { class: 'ghost small', type: 'button', onclick: () => refreshParty() }, uiIcon('refresh', 'btn-icon'), h('span', { text: 'Erneut' }))));
    return;
  }
  if (!ps.party) {
    if (ps.invites.length) return;
    const start = h('button', { class: 'ghost small', type: 'button', id: 'party-start', disabled: busy, onclick: (e: Event) => {
      e.stopPropagation();
      openInviteMenu(e.currentTarget as HTMLElement);
    } }, uiIcon('user-plus', 'btn-icon'), h('span', { text: 'Party starten' }));
    el.append(h('div', { class: 'friends-party-bar empty' },
      h('span', { class: 'friends-party-icon' }, uiIcon('friends')),
      h('span', { class: 'friends-party-text' }, h('strong', { text: 'Party' }),
        h('span', { text: 'Spielt zusammen: Lade bis zu 7 Freunde ein – ihr seht, wo jeder ist, folgt dem Leiter und redet im Voice automatisch miteinander.' })),
      start));
    return;
  }

  const p = ps.party;
  const me = myUuid();
  const leader = p.members.find((m) => m.leader) ?? p.members[0];
  const mine = p.members.find((m) => m.uuid === me) ?? null;
  const unread = unreadChat();
  const actions: HTMLElement[] = [];
  const there = !!mine?.location && !!p.target && mine.location.address === p.target.address;
  if (!amLeader() && p.target) {
    actions.push(h('button', {
      class: 'primary small', type: 'button', id: 'party-join',
      title: there ? 'Du bist schon dort.' : gameBusy ? 'Es läuft schon ein Spiel.' : `Minecraft starten und ${leader.name} folgen`,
      disabled: there || gameBusy || joining,
      onclick: () => void joinLeader(),
    }, uiIcon('connect', 'btn-icon'), h('span', { text: joining ? 'Startet …' : there ? 'Schon dort' : 'Beitreten' })));
  }
  if (amLeader() && p.members.length + p.invites.length < p.max) {
    actions.push(h('button', { class: 'ghost small', type: 'button', id: 'party-invite', disabled: busy, onclick: (e: Event) => {
      e.stopPropagation();
      openInviteMenu(e.currentTarget as HTMLElement);
    } }, uiIcon('user-plus', 'btn-icon'), h('span', { text: 'Einladen' })));
  }
  actions.push(h('button', {
    class: `ghost small friends-party-chat-toggle${chatOpen ? ' active' : ''}`, type: 'button', id: 'party-chat-toggle', 'aria-expanded': String(chatOpen),
    onclick: () => {
      chatOpen = !chatOpen;
      if (chatOpen) chatSeen = p.chat.at(-1)?.id ?? chatSeen;
      render();
      if (chatOpen) host?.querySelector<HTMLInputElement>('.friends-party-chat-input')?.focus();
    },
  }, uiIcon('chat', 'btn-icon'), h('span', { text: 'Chat' }), unread > 0 && !chatOpen ? h('span', { class: 'friends-unread', text: String(Math.min(unread, 99)) }) : null));
  actions.push(h('button', { class: 'ghost small', type: 'button', id: 'party-leave', title: 'Party verlassen', 'aria-label': 'Party verlassen', disabled: busy,
    onclick: () => void act(() => api.partyLeave(), 'Du hast die Party verlassen.') }, uiIcon('quit', 'btn-icon'), h('span', { class: 'friends-party-leave-label', text: 'Verlassen' })));

  const auto = h('input', { type: 'checkbox', class: 'switch small', id: 'party-auto-follow' });
  auto.checked = stateSettingsAutoFollow();
  auto.addEventListener('change', () => void saveAutoFollow(auto));
  const head = h('div', { class: 'friends-party-head' },
    h('span', { class: 'friends-party-icon' }, uiIcon('friends')),
    h('span', { class: 'friends-party-text' },
      h('strong', {}, 'Party ', h('span', { class: 'friends-party-count', text: `${p.members.length}/${p.max}` })),
      h('span', { class: 'friends-party-target', id: 'party-target', text: amLeader()
        ? (p.target ? `Du leitest · ${locationText(p.target)}` : 'Du leitest – wohin du gehst, dorthin können die anderen folgen')
        : `${leader.name} leitet · ${locationText(p.target)}` }),
      p.voice ? h('span', { class: 'friends-party-voice', title: 'Ihr seid am selben Ort: Party-Voice ist an' }, uiIcon('mic', 'btn-icon'), 'Voice zusammen') : null),
    !amLeader() ? h('label', { class: 'friends-party-auto', title: 'Folgt dem Leiter von selbst, aber nur, wenn gerade kein Spiel läuft' }, auto, h('span', { text: 'Automatisch folgen' })) : null,
    h('div', { class: 'friends-party-actions' }, ...actions));

  const members = h('div', { class: 'friends-party-members' });
  for (const member of p.members) members.append(memberChip(member));
  for (const invite of p.invites) members.append(invitedChip(invite));
  el.append(head, members);
  if (chatOpen) el.append(chatPanel(p, keepScroll, focused));
}

function stateSettingsAutoFollow(): boolean {
  return state.settings?.partyAutoFollow === true;
}

async function saveAutoFollow(input: HTMLInputElement): Promise<void> {
  input.disabled = true;
  try {
    state.settings = await api.saveSettings({ partyAutoFollow: input.checked });
    emit('settings');
    toast(input.checked ? 'Du folgst dem Leiter jetzt automatisch – aber nur, wenn gerade kein Spiel läuft.' : 'Automatisch folgen ist aus.', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  render();
}

function memberChip(member: PartyMember): HTMLElement {
  const me = myUuid();
  const status = member.online ? 'online' : member.launcher ? 'launcher' : 'offline';
  const more = h('button', { class: 'icon-button small friends-party-more', type: 'button', title: 'Mehr', 'aria-label': `Mehr zu ${member.name}`, onclick: (e: Event) => {
    e.stopPropagation();
    memberMenu(e.currentTarget as HTMLElement, member);
  } }, uiIcon('more'));
  return h('div', { class: `friends-party-member${member.leader ? ' leader' : ''}${member.uuid === me ? ' me' : ''}${member.away ? ' away' : ''}`, 'data-uuid': member.uuid },
    ctx!.head(member.uuid, member.name, 'sm', status),
    h('span', { class: 'friends-row-text' },
      h('span', { class: 'friends-row-name' }, member.uuid === me ? `${member.name} (du)` : member.name,
        member.leader ? h('span', { class: 'friends-party-crown', title: 'Leiter der Party' }, uiIcon('crown', '')) : null),
      h('span', { class: 'friends-row-meta', text: memberText(member) })),
    more);
}

function invitedChip(invite: Party['invites'][number]): HTMLElement {
  const withdraw = amLeader()
    ? h('button', { class: 'icon-button small', type: 'button', title: 'Einladung zurückziehen', 'aria-label': `Einladung an ${invite.name} zurückziehen`,
      onclick: () => void act(() => api.partyCancelInvite(invite.uuid), `Einladung an ${invite.name} zurückgezogen.`) }, uiIcon('close'))
    : null;
  const minutes = Math.max(1, Math.round((invite.expires - Date.now()) / 60_000));
  return h('div', { class: 'friends-party-member invited', 'data-uuid': invite.uuid },
    ctx!.head(invite.uuid, invite.name, 'sm'),
    h('span', { class: 'friends-row-text' },
      h('span', { class: 'friends-row-name', text: invite.name }),
      h('span', { class: 'friends-row-meta', text: `Eingeladen · noch ${minutes} Min.` })),
    withdraw);
}

function inviteRow(invite: PartyInvite): HTMLElement {
  const minutes = Math.max(1, Math.round((invite.expires - Date.now()) / 60_000));
  const accept = h('button', { class: 'primary small', type: 'button', disabled: busy, onclick: () => void act(() => api.partyAccept(invite.party), 'Du bist jetzt in der Party.') },
    uiIcon('check', 'btn-icon'), h('span', { text: party() ? 'Wechseln' : 'Annehmen' }));
  const decline = h('button', { class: 'ghost small', type: 'button', text: 'Ablehnen', disabled: busy, onclick: () => void act(() => api.partyDecline(invite.party)) });
  return h('div', { class: 'friends-party-bar invite', 'data-party': invite.party },
    ctx!.head(invite.from.uuid, invite.from.name, 'sm'),
    h('span', { class: 'friends-party-text' },
      h('strong', { text: `${invite.from.name} lädt dich in die Party ein` }),
      h('span', { text: [invite.members > 1 ? `${invite.members} sind dabei` : null, invite.leader.uuid !== invite.from.uuid ? `Leiter: ${invite.leader.name}` : null,
        `gilt noch ${minutes} Min.`, party() ? 'deine jetzige Party verlässt du dabei' : null].filter(Boolean).join(' · ') })),
    h('span', { class: 'friends-party-buttons' }, accept, decline));
}

function chatPanel(p: Party, keepScroll: number | null, focused: boolean): HTMLElement {
  const list = h('div', { class: 'friends-party-chat-list', role: 'log', 'aria-live': 'polite' });
  if (!p.chat.length) list.append(h('div', { class: 'friends-party-chat-empty', text: 'Noch nichts geschrieben. Der Party-Chat bleibt nur, solange die Party besteht.' }));
  for (const message of p.chat) {
    list.append(h('div', { class: `friends-party-line${message.mine ? ' mine' : ''}` },
      h('span', { class: 'friends-party-line-name', text: message.mine ? 'Du' : message.name }),
      h('span', { class: 'friends-party-line-text', text: message.text }),
      h('span', { class: 'friends-party-line-time', text: clock(message.at), title: new Date(message.at).toLocaleString('de-DE') })));
  }
  const input = h('input', { type: 'text', class: 'friends-party-chat-input', id: 'party-chat-input', placeholder: 'An die Party schreiben …', maxlength: String(MAX_CHAT), autocomplete: 'off', 'aria-label': 'Nachricht an die Party' });
  input.value = chatDraft;
  input.addEventListener('input', () => (chatDraft = input.value));
  const send = h('button', { class: 'primary small', type: 'submit', title: 'Senden', 'aria-label': 'Senden' }, uiIcon('send', 'btn-icon'));
  const form = h('form', { class: 'friends-party-chat-form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send.disabled = true;
    try {
      apply(await api.partyChat(text));
      chatDraft = '';
      input.value = '';
    } catch (error) {
      toast(errorMessage(error), 'error');
    } finally {
      send.disabled = false;
      host?.querySelector<HTMLInputElement>('.friends-party-chat-input')?.focus();
    }
  } }, input, send);
  const panel = h('div', { class: 'friends-party-chat' }, list, form);
  window.requestAnimationFrame(() => {
    list.scrollTop = keepScroll !== null && keepScroll < list.scrollHeight - list.clientHeight - 40 ? keepScroll : list.scrollHeight;
    if (focused) input.focus();
  });
  return panel;
}
