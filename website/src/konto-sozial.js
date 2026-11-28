// HeldixClient – Webseite: gemeinsame Bausteine für Freunde, Chat, Party und Welten im Konto.
//
// - Anzeige eines Freundes: Spitzname, Abzeichen, was er gerade macht, „zuletzt online vor …“, „Nicht stören“
// - Beitreten aus dem Browser: Welten und Einladungen öffnen den Launcher (heldixclient://welt/<code>,
//   heldixclient://einladung/<code>); für Server gibt es keinen Link – die Seite kopiert die Adresse und erklärt,
//   wo man sie einträgt (Minecraft → Mehrspieler → Direkt verbinden).
// - Reaktionen: die acht festen IDs des Dienstes als Emojis
import { activity, copyText, h, presenceOf, presenceRank, toast } from './app-common.js';
import { shellIcon } from './app-shell.js';
import { badgeIcon, badgeLabel } from './rollen.js';

/** Reaktionen (REACTIONS in service/src/messages.ts) – Reihenfolge wie im Spiel. */
export const REACTIONS = [
  ['like', '👍', 'Daumen hoch'],
  ['love', '❤️', 'Herz'],
  ['laugh', '😂', 'Lachen'],
  ['wow', '😮', 'Staunen'],
  ['sad', '😢', 'Traurig'],
  ['party', '🎉', 'Party'],
  ['fire', '🔥', 'Feuer'],
  ['eyes', '👀', 'Augen'],
];
export const reactionEmoji = (id) => REACTIONS.find(([key]) => key === id)?.[1] ?? '•';
export const reactionLabel = (id) => REACTIONS.find(([key]) => key === id)?.[2] ?? id;

export const WORLD_CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
export const INVITE_CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** Name, wie du ihn siehst: dein Spitzname, sonst der Spielername. */
export const displayName = (friend) => (friend?.nickname ? friend.nickname : friend?.name ?? '');

/** „zuletzt online vor 5 Min.“ (der Dienst rundet schon: <1 h auf 5 min, <24 h auf Stunden, sonst Tage). */
export function lastOnlineText(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (minutes < 5) return 'zuletzt online gerade eben';
  if (minutes < 60) return `zuletzt online vor ${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `zuletzt online vor ${hours} Std.`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'zuletzt online gestern' : `zuletzt online vor ${days} Tagen`;
}

/** Welt-Code aus einer Adresse <code>.<Welt-Domain> (nur, wenn die Domain bekannt ist oder die Welt bekannt ist). */
export function worldCodeOf(address, worldDomain = null) {
  const match = /^([a-hjkmnp-z2-9]{6})\.(.+)$/.exec(String(address || '').toLowerCase());
  if (!match) return null;
  if (worldDomain && match[2] !== worldDomain) return null;
  return worldDomain ? match[1] : null;
}

/**
 * Was ein Freund gerade macht (eine Zeile): „Spielt auf … · Nicht stören“, „Im Launcher – bekommt Nachrichten sofort“
 * (ab Dienst 1.14.0, launcher: true; mit „Nicht stören“ hat das Vorrang) bzw. „Offline · zuletzt online vor …“.
 */
export function friendLine(friend, { worldName = null } = {}) {
  if (!friend) return '';
  if (friend.online) {
    let text = activity(friend);
    if (worldName && friend.server) text = `In der Welt „${worldName}“`;
    return friend.dnd ? `${text} · Nicht stören` : text;
  }
  if (friend.launcher === true) return friend.dnd ? 'Im Launcher · Nicht stören' : 'Im Launcher – bekommt Nachrichten sofort';
  const last = lastOnlineText(friend.lastOnline);
  return last ? `Offline · ${last}` : 'Offline';
}

/** Abzeichen als kleines Bild mit Titel (oder nichts). */
export function badgeMark(badge, size = 15) {
  if (!badge) return null;
  const image = badgeIcon(badge, { size });
  return image ? h('span', { class: 'badge-mark', title: badgeLabel(badge) }, image) : null;
}

/**
 * Beitreten-Ziel aus einer Karte, einem Party-Ort oder einer Server-Adresse.
 * Ergebnis: { kind: 'world'|'invite'|'server', code?, address, title, href? }
 */
export function joinTarget({ card = null, location = null, server = null, worldDomain = null } = {}) {
  if (card) {
    if (card.kind === 'world' && WORLD_CODE_RE.test(card.target)) return { kind: 'world', code: card.target, address: worldDomain ? `${card.target}.${worldDomain}` : card.target, title: card.title || 'Geteilte Welt', href: `heldixclient://welt/${card.target}` };
    if (card.kind === 'invite' && INVITE_CODE_RE.test(card.target)) return { kind: 'invite', code: card.target, address: card.target, title: card.title || 'Einladung', href: `heldixclient://einladung/${card.target}`, web: `/einladung#${card.target}` };
    if (card.kind === 'server' && card.target) return { kind: 'server', address: card.target, title: card.title || card.target };
    return null;
  }
  if (location) {
    if (location.kind === 'world' && WORLD_CODE_RE.test(location.target)) return { kind: 'world', code: location.target, address: location.address, title: location.title || 'Geteilte Welt', href: `heldixclient://welt/${location.target}` };
    if (location.address) return { kind: 'server', address: location.address, title: location.title || location.address };
    return null;
  }
  if (server) {
    const code = worldCodeOf(server, worldDomain);
    if (code) return { kind: 'world', code, address: server, title: 'Geteilte Welt', href: `heldixclient://welt/${code}` };
    return { kind: 'server', address: server, title: server };
  }
  return null;
}

/** Hinweis nach „Beitreten“ für einen Server (es gibt dafür keinen Launcher-Link). */
export async function copyServer(address) {
  const ok = await copyText(address);
  toast(ok ? `${address} kopiert – in Minecraft unter Mehrspieler → Direkt verbinden einfügen.` : `Server: ${address} – in Minecraft unter Mehrspieler → Direkt verbinden eintragen.`, ok ? 'success' : 'info');
}

/**
 * Knopf „Beitreten“: Welt/Einladung als Link in den Launcher, Server kopiert die Adresse.
 * variant: 'primary' | 'secondary'. label: Text (Standard „Beitreten“).
 */
export function joinButton(target, { variant = 'primary', label = 'Beitreten', small = true, focusKey } = {}) {
  if (!target) return null;
  const cls = `btn btn--${variant}${small ? ' btn--sm' : ''} join-button`;
  if (target.href) {
    const link = h('a', { class: cls, href: target.href, title: `Öffnet HeldixClient: ${target.title}`, dataset: { join: target.kind, focusKey } }, shellIcon('join'), label);
    link.addEventListener('click', () => {
      // Ohne installierten Launcher passiert beim Klick nichts – Hinweis, wie es dann weitergeht.
      setTimeout(() => {
        if (document.visibilityState === 'visible') toast(target.kind === 'invite' ? 'Der Link öffnet HeldixClient. Noch nicht installiert? Unter „Download“ geht es los.' : `Der Link öffnet HeldixClient und tritt „${target.title}“ bei. Noch nicht installiert? Unter „Download“ geht es los.`);
      }, 1200);
    });
    return link;
  }
  return h('button', { type: 'button', class: cls, title: `Adresse kopieren: ${target.address}`, dataset: { join: 'server', focusKey }, onClick: () => copyServer(target.address) }, shellIcon('join'), label);
}

/** Beitreten-Karte im Chat (Server, Welt, Einladung). */
export function joinCard(card, { worldDomain = null } = {}) {
  const target = joinTarget({ card, worldDomain });
  if (!target) return null;
  const iconName = target.kind === 'server' ? 'server' : target.kind === 'world' ? 'world' : 'user-plus';
  const kindText = target.kind === 'server' ? 'Server' : target.kind === 'world' ? 'Welt' : 'Einladung';
  return h(
    'span',
    { class: 'join-card', dataset: { kind: target.kind } },
    shellIcon(iconName),
    h('span', { class: 'join-card__text' }, h('span', { class: 'join-card__kind', text: kindText }), h('span', { class: 'join-card__title', text: target.title })),
    joinButton(target, { variant: 'secondary', label: target.kind === 'invite' ? 'Ansehen' : 'Beitreten' }),
  );
}

/** „3 von 9 online · 2 im Launcher · 2 Anfragen“ */
export function friendsSummary(friends, incoming = 0) {
  const online = friends.filter((friend) => friend.online).length;
  const launcher = friends.filter((friend) => presenceOf(friend) === 'launcher').length;
  const parts = [friends.length ? `${online} von ${friends.length} online` : 'Noch keine Freunde'];
  if (launcher) parts.push(`${launcher} im Launcher`);
  if (incoming) parts.push(plural(incoming, 'Anfrage', 'Anfragen'));
  return parts.join(' · ');
}

/** Sortierung: Favoriten, dann im Spiel, im Launcher, offline, dann Name. */
export function sortFriends(list) {
  const collator = new Intl.Collator('de', { sensitivity: 'base' });
  return [...list].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || presenceRank(b) - presenceRank(a) || collator.compare(displayName(a), displayName(b)));
}
