// Profilkarte eines Freundes (Dialog #friend-profile, GET /v1/friends/<uuid>/profile über main/core/social.ts): Skin in
// 3D mit seinen Cosmetics (skinview3d wie auf der Startseite, sonst der Kopf), Abzeichen mit Bezeichnung, Spitzname,
// Statustext, online bzw. „zuletzt online“, befreundet seit, gemeinsame Freunde (nur gemeinsame), Notiz und Aktionen:
// Nachricht, Party, Beitreten, Favorit, Spitzname & Notiz, Entfernen, Blockieren, Melden.
import type { CosmeticItem, CosmeticModelSlot, Friend, FriendProfile } from '../shared/api';
import { api, errorMessage, formatDate, h, uiIcon } from './core.js';
import { badgeIcon, badgeLabel } from './badges.js';
import { CosmeticRig, type RigViewer } from './cosmetic-scene.js';

export interface ProfileActions {
  head(uuid: string, name: string, size?: 'sm' | 'md'): HTMLElement;
  /** „Auf hypixel.net“, „Zuletzt online vor 3 Std.“ … */
  presence(friend: Friend): string;
  canJoin(friend: Friend): boolean;
  canInvite(friend: Friend): boolean;
  message(friend: Friend): void;
  invite(friend: Friend): void;
  join(friend: Friend): void;
  toggleFavorite(friend: Friend): Promise<void>;
  editNames(friend: Friend): void;
  remove(friend: Friend): void;
  block(friend: Friend): void;
  report(friend: Friend): void;
}

interface MiniViewer {
  animation: unknown;
  autoRotate: boolean;
  autoRotateSpeed: number;
  zoom: number;
  playerWrapper: { rotation: { y: number } };
  controls: { enableZoom: boolean; enablePan: boolean };
  loadSkin(source: string | null, options?: { model?: 'auto-detect' }): Promise<void> | void;
  dispose?(): void;
}
interface MiniLib {
  SkinViewer: new (options: { canvas: HTMLCanvasElement; width: number; height: number; fov?: number; zoom?: number }) => MiniViewer;
  IdleAnimation: new () => unknown;
}

let open: { uuid: string; backdrop: HTMLElement; viewer: MiniViewer | null } | null = null;

// Escape (app.ts entfernt Dialoge ohne ID): die 3D-Figur dabei freigeben
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.setTimeout(() => {
    if (open && !open.backdrop.isConnected) close();
  }, 0);
});

function close(): void {
  if (!open) return;
  try {
    open.viewer?.dispose?.();
  } catch {
    // egal
  }
  open.backdrop.remove();
  open = null;
}

/** offen und für diesen Freund? (zum Neuzeichnen nach Änderungen) */
export function profileOpenFor(): string | null {
  return open && open.backdrop.isConnected ? open.uuid : null;
}

export function closeProfileCard(): void {
  close();
}

function fact(icon: string, label: string, value: Node | string, id?: string): HTMLElement {
  return h('div', { class: 'invite-fact' },
    h('span', { class: 'invite-fact-icon' }, uiIcon(icon)),
    h('span', { class: 'invite-fact-label', text: label }),
    typeof value === 'string' ? h('span', { class: 'invite-fact-value', text: value, id }) : h('span', { class: 'invite-fact-value', id }, value));
}

/** 3D-Figur mit Skin und Cosmetics; ohne skinview3d oder Skin: der Kopf */
async function figure(container: HTMLElement, profile: FriendProfile, actions: ProfileActions): Promise<MiniViewer | null> {
  const lib = (window as unknown as { skinview3d?: MiniLib }).skinview3d;
  const skin = await api.getPlayerSkin(profile.friend.uuid).catch(() => null);
  if (!container.isConnected) return null;
  if (!lib || !skin) {
    container.replaceChildren(h('div', { class: 'friends-profile-head' }, actions.head(profile.friend.uuid, profile.friend.name, 'md')));
    return null;
  }
  const canvas = h('canvas', { class: 'friends-profile-canvas' });
  container.replaceChildren(canvas);
  let viewer: MiniViewer;
  try {
    viewer = new lib.SkinViewer({ canvas, width: 170, height: 230, fov: 34, zoom: 0.78 });
  } catch {
    container.replaceChildren(h('div', { class: 'friends-profile-head' }, actions.head(profile.friend.uuid, profile.friend.name, 'md')));
    return null;
  }
  viewer.controls.enableZoom = false;
  viewer.controls.enablePan = false;
  viewer.playerWrapper.rotation.y = 0.45;
  viewer.autoRotate = true;
  viewer.autoRotateSpeed = 0.5;
  await viewer.loadSkin(skin, { model: 'auto-detect' });
  viewer.animation = new lib.IdleAnimation();
  // seine Cosmetics (nur, wenn er sie zeigt), aus dem eigenen Katalog
  if (profile.cosmetics && Object.values(profile.cosmetics).some(Boolean)) {
    try {
      const rig = CosmeticRig.attach(viewer as unknown as RigViewer);
      if (rig) {
        rig.autoZoom(0.78);
        const catalog = await api.getCosmetics();
        const worn = (slot: CosmeticModelSlot): CosmeticItem | null => {
          const id = profile.cosmetics?.[slot];
          return (id && catalog.items.find((i) => i.id === id && i.slot === slot)) || null;
        };
        await rig.showAll({ head: worn('head'), back: worn('back'), aura: worn('aura'), companion: worn('companion') });
      }
    } catch {
      // Figur bleibt ohne Cosmetics
    }
  }
  return viewer;
}

async function cosmeticNames(profile: FriendProfile): Promise<string | null> {
  const ids = Object.values(profile.cosmetics ?? {}).filter((id): id is string => !!id);
  if (profile.cape) ids.push(profile.cape);
  if (!ids.length) return null;
  try {
    const catalog = await api.getCosmetics();
    return ids.map((id) => catalog.items.find((i) => i.id === id)?.name ?? id).join(', ');
  } catch {
    return ids.join(', ');
  }
}

function render(profile: FriendProfile, actions: ProfileActions, modal: HTMLElement): void {
  const friend = profile.friend;
  const name = friend.nickname || friend.name;
  const figureBox = h('div', { class: 'friends-profile-figure', id: 'friend-profile-figure' }, h('div', { class: 'friends-spinner' }));
  const badge = h('span', { class: 'friends-profile-badge', id: 'friend-profile-badge' }, badgeIcon(friend.badge, 22), h('span', { text: badgeLabel(friend.badge) }));
  const presence = h('div', { class: `friends-profile-presence${friend.online ? ' online' : friend.launcher ? ' launcher' : ''}${friend.dnd ? ' dnd' : ''}`, id: 'friend-profile-presence' },
    h('span', { class: 'friends-profile-dot' }), actions.presence(friend));
  const mutual = profile.mutual.length
    ? h('span', { class: 'friends-profile-mutual' }, ...profile.mutual.slice(0, 8).map((m) => h('span', { class: 'friends-profile-mate', title: m.name }, actions.head(m.uuid, m.name, 'sm'))),
      h('span', { text: profile.mutual.length === 1 ? profile.mutual[0].name : `${profile.mutual.slice(0, 3).map((m) => m.name).join(', ')}${profile.mutual.length > 3 ? ` und ${profile.mutual.length - 3} weitere` : ''}` }))
    : 'Keine';
  const facts = h('div', { class: 'invite-facts friends-profile-facts' },
    fact('friends', 'Befreundet seit', formatDate(friend.since), 'friend-profile-since'),
    fact('clock', 'Zuletzt online', friend.online ? 'Gerade online' : friend.launcher ? 'Gerade im Launcher' : friend.lastOnline ? actions.presence({ ...friend, statusText: null }) : 'Nicht sichtbar', 'friend-profile-last'),
    fact('user-plus', 'Gemeinsame Freunde', mutual, 'friend-profile-mutual'));
  const looks = h('span', { text: '…' });
  void cosmeticNames(profile).then((names) => {
    looks.textContent = names ?? (profile.cosmetics === null ? 'Nicht sichtbar' : 'Keine');
  });
  facts.append(fact('sparkles', 'Cape & Cosmetics', looks));

  const button = (id: string, icon: string, label: string, onclick: () => void, kind = 'ghost', disabled = false) =>
    h('button', { class: `${kind} small`, id, type: 'button', disabled, onclick }, uiIcon(icon, 'btn-icon'), h('span', { text: label }));
  const run = (action: (f: Friend) => void) => () => {
    close();
    action(friend);
  };
  const actionsRow = h('div', { class: 'friends-profile-actions' },
    button('friend-profile-message', 'chat', 'Nachricht', run(actions.message), 'primary'),
    actions.canJoin(friend) ? button('friend-profile-join', 'connect', 'Beitreten', run(actions.join), 'primary') : null,
    actions.canInvite(friend) ? button('friend-profile-party', 'user-plus', 'In Party einladen', run(actions.invite)) : null,
    button('friend-profile-favorite', 'star', friend.favorite ? 'Favorit entfernen' : 'Als Favorit', () => void actions.toggleFavorite(friend).then(() => void openProfileCard(friend.uuid, actions))),
    button('friend-profile-names', 'edit', 'Spitzname & Notiz', run(actions.editNames)));
  const danger = h('div', { class: 'friends-profile-danger' },
    h('button', { class: 'link-button', type: 'button', onclick: run(actions.report) }, uiIcon('flag', 'btn-icon'), h('span', { text: 'Melden' })),
    h('button', { class: 'link-button', type: 'button', onclick: run(actions.block) }, uiIcon('ban', 'btn-icon'), h('span', { text: 'Blockieren' })),
    h('button', { class: 'link-button danger', type: 'button', onclick: run(actions.remove) }, uiIcon('trash', 'btn-icon'), h('span', { text: 'Entfernen' })));

  modal.replaceChildren(
    h('button', { class: 'icon-button friends-profile-close', type: 'button', title: 'Schließen', 'aria-label': 'Schließen', onclick: close }, uiIcon('close')),
    h('div', { class: 'friends-profile-top' },
      figureBox,
      h('div', { class: 'friends-profile-info' },
        h('h3', { class: 'modal-title friends-profile-name', id: 'friend-profile-title' },
          friend.favorite ? h('span', { class: 'friends-star on', title: 'Favorit' }, uiIcon('star', '')) : null,
          h('span', { text: name })),
        friend.nickname ? h('div', { class: 'friends-profile-realname', text: `Spielername: ${friend.name}` }) : null,
        badge,
        presence,
        friend.statusText ? h('div', { class: 'friends-profile-status', id: 'friend-profile-status', text: `„${friend.statusText}“` }) : null,
        friend.note ? h('div', { class: 'friends-profile-note', id: 'friend-profile-note' }, uiIcon('edit', 'btn-icon'), h('span', { text: friend.note })) : null)),
    facts,
    actionsRow,
    danger);
  void figure(figureBox, profile, actions).then((viewer) => {
    if (open && open.uuid === friend.uuid) open.viewer = viewer;
    else viewer?.dispose?.();
  });
}

/** Profilkarte öffnen (ersetzt eine offene) */
export async function openProfileCard(uuid: string, actions: ProfileActions): Promise<void> {
  close();
  const modal = h('div', { class: 'modal friends-profile', id: 'friend-profile', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'friend-profile-title' },
    h('div', { class: 'invite-loading' }, h('div', { class: 'friends-spinner', 'aria-hidden': 'true' }), h('span', { text: 'Profil wird geladen …' })));
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (event: Event) => event.target === backdrop && close() }, modal);
  document.body.append(backdrop);
  const current = { uuid, backdrop, viewer: null as MiniViewer | null };
  open = current;
  let profile: FriendProfile;
  try {
    profile = await api.getFriendProfile(uuid);
  } catch (error) {
    if (open !== current) return;
    modal.replaceChildren(
      h('div', { class: 'modal-head' }, h('h3', { class: 'modal-title', id: 'friend-profile-title', text: 'Profil lässt sich nicht laden' }),
        h('button', { class: 'icon-button', type: 'button', title: 'Schließen', onclick: close }, uiIcon('close'))),
      h('p', { class: 'modal-text', text: errorMessage(error) }));
    return;
  }
  if (open !== current) return;
  render(profile, actions, modal);
}
