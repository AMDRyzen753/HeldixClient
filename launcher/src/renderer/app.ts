import type { AccountInfo, DiscordPreview, DiscordStatus, Friend, InstanceInfo, LauncherView, LogLine, NotificationTarget, PlayerBadge, QuickPlayList, QuickPlayTarget, ServerStatus, Settings, SkinInfo, SocialOverview, UpdateState } from '../shared/api';
import {
  $,
  api,
  confirmDialog,
  emit,
  errorMessage,
  formatCount,
  formatDate,
  formatPlayTime,
  h,
  applyLoaderLogos,
  hydrateIcons,
  ICONS,
  instanceTile,
  LOADER_LABELS,
  on,
  reloadInstances,
  selectedInstance,
  state,
  svgIcon,
  toast,
  uiIcon,
} from './core.js';
import { showFigure, setFigureActive } from './figure.js';
import { UI_ICONS } from './ui-icons.js';
import { initInstances, launchInstance, openDetail, resetInstancesView, type DetailTab } from './instances.js';
import { loadNews } from './news.js';
import { activateFriends, initFriends, openFriendChat, openInviteSection, openPartySection } from './friends.js';
import { badgeIcon, badgeLabel } from './badges.js';
import { activateProfile, initProfile, reloadCosmetics, showProfileCosmetic } from './profile.js';
import { initInvites, openPendingInvite } from './invite.js';
import { activateStore, initStore } from './store.js';
import { initCrash, showCrash } from './crash.js';
import { afterSetup, initSetup, restartSetup, setupOpen, startSetupIfNeeded } from './setup.js';
import { initNotifications } from './notifications.js';
import { initWorlds, joinWorldNow, openPendingWorld, openWorldDialog } from './world.js';
import { hostedWorld, initWorldState, isWorldAddress, onWorldsChange, refreshWorlds, worldsOverview } from './worldstate.js';

// Icons im HTML (<svg data-icon="…">) aus dem Heldix-Icon-Set füllen, Logos der Loader einsetzen
hydrateIcons();
applyLoaderLogos();

// ---------- Navigation ----------
const VIEW_TITLES: Record<string, string> = {
  home: 'Start',
  instances: 'Instanzen',
  store: 'Addon-Store',
  friends: 'Freunde',
  profile: 'Skins & Cosmetics',
  settings: 'Einstellungen',
  console: 'Konsole',
};
function showView(view: string): void {
  document.body.dataset.view = view;
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $('#view-title').textContent = VIEW_TITLES[view] ?? '';
  if (view === 'console') {
    $('#console-dot').hidden = true;
    scrollLogToEnd();
  }
  if (view === 'instances') resetInstancesView();
  if (view === 'store') activateStore();
  if (view === 'friends') activateFriends();
  if (view === 'profile') activateProfile();
  setFigureActive(view === 'home');
  // Discord-Status im Launcher: „Stöbert im Addon-Store“, „Richtet Cosmetics ein“ …
  if (!setupOpen()) api.setPresenceView(view as LauncherView);
}
initStore();
initFriends();
/** Freunde → Einladen (aus Skins & Cosmetics und Benachrichtigungen) */
function openInvites(): void {
  showView('friends');
  openInviteSection();
}
initProfile(openInvites);
initCrash(showView);
// Einladungslinks heldixclient://einladung/<code> und Neues bei den eigenen Einladungen
initInvites({
  showView,
  openInvites,
  openCosmetic: (id) => {
    showView('profile');
    void showProfileCosmetic(id);
  },
  reloadAccounts: () => loadAccounts(),
});
// Einrichtungs-Assistent beim ersten Start (setup.ts); danach Einladung und „Neu in …“
initSetup({
  reloadAccounts: () => loadAccounts(),
  reloadInstances: () => reloadInstances(),
  opened: () => {
    setFigureActive(false);
    api.setPresenceView('setup');
  },
  closed: () => {
    setFigureActive(document.body.dataset.view === 'home');
    api.setPresenceView((document.body.dataset.view ?? 'home') as LauncherView);
    void openPendingInvite();
    void openPendingWorld();
    void showWhatsNew();
  },
});
api.onInviteEvent((event) => {
  if (event.kind === 'unlock') reloadCosmetics();
});
// Geteilte Welten: Links heldixclient://welt/<code>, Dialog „Welt von …“, offene Welten der Freunde
initWorldState();
initWorlds({ showView });
// Glocke: Klick auf einen Eintrag führt dorthin
initNotifications({ open: openNotificationTarget });
function openNotificationTarget(target: NotificationTarget): void {
  switch (target.view) {
    case 'friends':
      showView('friends');
      if (target.uuid) openFriendChat(target.uuid);
      break;
    case 'invites':
      openInvites();
      break;
    case 'cosmetics':
      showView('profile');
      if (target.id) void showProfileCosmetic(target.id);
      break;
    case 'store':
      showView('store');
      break;
    case 'updates':
      showView('settings');
      document.querySelector<HTMLButtonElement>('#settings-nav [data-target="set-updates"]')?.click();
      break;
    case 'world':
      if (target.code) openWorldDialog(target.code);
      break;
    case 'party':
      showView('friends');
      openPartySection();
      break;
  }
}
// Klick auf eine Benachrichtigung zur Party (Einladung)
api.onPartyOpen(() => {
  showView('friends');
  openPartySection();
});
// Klick auf eine Benachrichtigung (neue Nachricht oder Anfrage)
api.onSocialOpen((uuid) => {
  showView('friends');
  if (uuid) openFriendChat(uuid);
});
// Klick auf die Benachrichtigung „Addon-Updates verfügbar“
api.onStoreOpen(() => showView('store'));
document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.view!));
});
// Strg+1 … Strg+7 (auf dem Mac ⌘): Seiten in der Reihenfolge der Seitenleiste (nicht hinter dem Einrichtungs-Assistenten)
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || setupOpen()) return;
  const index = Number(event.key) - 1;
  const items = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')];
  if (Number.isInteger(index) && index >= 0 && index < items.length) {
    event.preventDefault();
    showView(items[index].dataset.view!);
  }
});
document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button, index) => {
  button.title = `${button.dataset.label ?? ''} (${api.platform === 'darwin' ? '⌘' : 'Strg+'}${index + 1})`;
});

// ---------- Parallax: das Hintergrundbild folgt leicht der Maus ----------
document.body.dataset.view = 'home';
let parallaxFrame = 0;
document.addEventListener('mousemove', (event) => {
  if (parallaxFrame) return;
  parallaxFrame = requestAnimationFrame(() => {
    parallaxFrame = 0;
    const mx = (event.clientX / window.innerWidth - 0.5) * 2;
    const my = (event.clientY / window.innerHeight - 0.5) * 2;
    document.documentElement.style.setProperty('--mx', mx.toFixed(3));
    document.documentElement.style.setProperty('--my', my.toFixed(3));
  });
});

// ---------- Startseite ----------
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Hallo';
  return 'Guten Abend';
}

/** Kurze Zeitangabe für Listen: "vor 5 Min.", "gestern" … */
function shortRelative(time: number | null): string {
  if (!time) return 'noch nie';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'gestern';
  if (days < 30) return `vor ${days} Tagen`;
  return formatDate(time);
}

/** Die Instanz, um die es gerade geht: während eines Spiels die laufende, sonst die ausgewählte. */
function stageInstance(): InstanceInfo | undefined {
  const game = state.game;
  if (game.state === 'preparing' || game.state === 'running') {
    return state.instances.find((i) => i.id === game.instanceId) ?? selectedInstance();
  }
  return selectedInstance();
}

function openInstanceTab(id: string, tab: DetailTab): void {
  showView('instances');
  openDetail(id, tab);
}

function openNewInstanceDialog(): void {
  showView('instances');
  $('#new-instance').click();
}

function loaderText(instance: InstanceInfo): string {
  if (instance.loader === 'heldix') return state.info?.loaderVersion ? `Heldix Loader ${state.info.loaderVersion}` : 'Heldix Loader';
  if (instance.loader === 'fabric' && instance.heldixClient) return 'Fabric + HeldixClient';
  return LOADER_LABELS[instance.loader];
}

function toolButton(icon: string, label: string, title: string, onclick: () => void): HTMLElement {
  const button = h('button', { class: 'tool', type: 'button', title, onclick });
  button.append(svgIcon(icon, ''), label);
  return button;
}

function renderGreeting(): void {
  const active = state.accounts.find((a) => a.active);
  $('#home-greeting-text').textContent = `${greeting()},`;
  $('#home-name-text').textContent = active?.name ?? 'bitte anmelden';
  $('#home-name').title = active ? 'Konto wechseln' : 'Konto hinzufügen';
  const info = state.info;
  $('#home-eyebrow').textContent = info
    ? `HeldixClient ${info.version}${info.loaderVersion ? ` · Heldix Loader ${info.loaderVersion}` : ''}`
    : 'HeldixClient';
}

/** Instanz-Auswahl, Werkzeuge und Weiterspielen für die aktuelle Instanz. */
function renderStage(): void {
  const instance = stageInstance();
  $('#home').style.setProperty('--instance', instance?.color ?? '#3b82f6');

  const tile = $('#picker-tile');
  tile.textContent = '';
  if (instance) tile.append(instanceTile(instance, 'small'));
  $('#picker-name').textContent = instance?.name ?? 'Keine Instanz';
  $('#picker-meta').textContent = instance ? `${instance.minecraft} · ${loaderText(instance)}` : 'Lege deine erste Instanz an';
  $('#picker-button').title = instance ? `${instance.name} · Minecraft ${instance.minecraft} · ${loaderText(instance)}` : 'Instanz wählen';

  const tools = $('#picker-tools');
  tools.textContent = '';
  if (instance) {
    if (instance.loader !== 'vanilla') {
      tools.append(toolButton(ICONS.puzzle, 'Mods & Addons', instance.heldixClient ? 'Mods und Addons der Instanz' : 'Mods der Instanz', () => openInstanceTab(instance.id, 'content')));
    }
    tools.append(
      toolButton(ICONS.sparkle, 'Shader', 'Shaderpacks der Instanz', () => openInstanceTab(instance.id, 'shaders')),
      toolButton(ICONS.folder, 'Ordner', 'Instanz-Ordner öffnen', () => void api.openFolder('instance', instance.id)),
      toolButton(ICONS.sliders, 'Einstellungen', 'Einstellungen der Instanz', () => openInstanceTab(instance.id, 'settings')),
    );
  }
  void renderContinue(instance);
  renderHomeInstances();
  renderStatus();
}

/** Zeile in den Listen der Startseite (Weiterspielen, Instanzen) */
function rowItem(icon: Node, name: string, meta: string, title: string, onclick: () => void,
  action?: { icon: string; title: string; run: () => void }, trailing?: Node | null): HTMLElement {
  const row = h('button', { class: 'row-item', type: 'button', title, onclick },
    icon,
    h('span', { class: 'row-text' }, h('span', { class: 'row-name', text: name }), h('span', { class: 'row-meta', text: meta })),
    trailing ?? null);
  if (action) {
    row.append(h('span', {
      class: 'row-action',
      title: action.title,
      onclick: (event: Event) => {
        event.stopPropagation();
        action.run();
      },
    }, svgIcon(action.icon, '')));
  }
  return row;
}

/** Startseite: die zuletzt gespielten Instanzen zum schnellen Wechseln und Starten */
function renderHomeInstances(): void {
  const list = $('#home-instances');
  list.textContent = '';
  const selectedId = selectedInstance()?.id;
  const sorted = [...state.instances].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.created - a.created);
  $('#home-instances-sub').textContent = state.instances.length === 1 ? '1 Instanz' : `${state.instances.length} Instanzen · zuletzt gespielt`;
  if (sorted.length === 0) {
    list.append(rowItem(h('span', { class: 'row-icon placeholder' }, uiIcon('plus', '')), 'Neue Instanz anlegen', 'Heldix Loader, Fabric oder Vanilla',
      'Neue Instanz anlegen', openNewInstanceDialog));
    return;
  }
  const busy = state.game.state === 'preparing' || state.game.state === 'running';
  for (const instance of sorted.slice(0, 4)) {
    const selected = instance.id === selectedId;
    const tile = instanceTile(instance, 'small');
    list.append(rowItem(tile, instance.name, `${instance.minecraft} · ${loaderText(instance)} · ${shortRelative(instance.lastPlayed)}`,
      selected ? 'Ausgewählt' : 'Auswählen', () => void selectFromHome(instance.id),
      busy ? undefined : { icon: ICONS.play, title: `${instance.name} spielen`, run: () => void playInstance(instance.id) },
      selected ? svgIcon(ICONS.check, 'row-check') : null));
  }
}

/** Instanz starten (Startseite, Liste der Instanzen) */
async function playInstance(id: string): Promise<void> {
  if (!state.accounts.some((a) => a.active)) {
    openAccounts($('#home-name'));
    toast('Bitte zuerst ein Konto hinzufügen.');
    return;
  }
  await launchInstance(id, showView);
}

// ---------- Startseite: Freunde online ----------
let social: SocialOverview | null = null;

/** Was ein Freund gerade macht */
function activityText(friend: Friend): string {
  if (!friend.online) return 'Offline';
  const world = hostedWorld(friend.uuid);
  if (world) return `Teilt „${world.name}“ · ${world.players}/${world.maxPlayers}`;
  if (isWorldAddress(friend.server)) return 'In einer geteilten Welt';
  switch (friend.activity) {
    case 'multiplayer': return friend.server ? `Auf ${friend.server}` : 'Mehrspieler';
    case 'singleplayer': return 'Einzelspieler';
    case 'realms': return 'Realms';
    case 'lan': return 'LAN-Welt';
    case 'menu': return 'Im Menü';
    default: return 'Online';
  }
}

/** Kopf aus dem Skin (Gesicht + Hut-Ebene), bis er geladen ist ein Farbfeld mit Anfangsbuchstaben */
const headCache = new Map<string, Promise<string | null>>();
function playerHead(uuid: string, name: string): HTMLElement {
  const canvas = h('canvas', { class: 'row-icon head', width: 8, height: 8 }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const hue = parseInt(uuid.slice(0, 6), 16) % 360;
  ctx.fillStyle = `hsl(${hue} 45% 38%)`;
  ctx.fillRect(0, 0, 8, 8);
  canvas.title = name;
  if (typeof api.getPlayerSkin !== 'function') return canvas;
  if (!headCache.has(uuid)) headCache.set(uuid, api.getPlayerSkin(uuid).catch(() => null));
  void headCache.get(uuid)!.then((url) => {
    if (!url) return;
    const image = new Image();
    image.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, 8, 8);
      ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
      ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
    };
    image.src = url;
  });
  return canvas;
}

function placeholderIcon(name: string): HTMLElement {
  return h('span', { class: 'row-icon placeholder' }, uiIcon(name, ''));
}

async function joinFriend(friend: Friend): Promise<void> {
  if (!state.accounts.some((a) => a.active)) {
    openAccounts($('#home-name'));
    return;
  }
  try {
    await api.joinFriend(friend.uuid);
    showView('home');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

function renderHomeFriends(): void {
  const panel = $('#home-friends-panel');
  const list = $('#home-friends');
  const sub = $('#home-friends-sub');
  list.textContent = '';
  if (!social || social.status === 'no-service') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  switch (social.status) {
    case 'disabled':
      sub.textContent = 'Im Launcher ausgeschaltet';
      list.append(rowItem(placeholderIcon('friends'), 'Freunde einschalten', 'Einstellungen → Freunde & Discord', 'Einstellungen öffnen', () => {
        showView('settings');
        document.querySelector<HTMLButtonElement>('#settings-nav [data-target="set-freunde"]')?.click();
      }));
      return;
    case 'no-account':
    case 'offline-account':
      sub.textContent = 'Nur mit Microsoft-Konto';
      list.append(rowItem(placeholderIcon('microsoft'), 'Mit Microsoft anmelden', 'Dann siehst du, wer online ist', 'Konto hinzufügen',
        () => openAccounts($('#home-name'))));
      return;
    case 'connecting':
      sub.textContent = 'Verbinde …';
      list.append(h('div', { class: 'row-empty', text: 'Verbinde mit dem Heldix-Dienst …' }));
      return;
    case 'error':
      sub.textContent = 'Nicht erreichbar';
      list.append(rowItem(placeholderIcon('warning'), 'Heldix-Dienst nicht erreichbar', social.error && !/nicht erreichbar/i.test(social.error) ? social.error : 'Klicken, um es erneut zu versuchen', 'Erneut versuchen',
        () => void api.refreshSocial().then((overview) => {
          social = overview;
          renderHomeFriends();
        }).catch(() => undefined)));
      return;
    default:
      break;
  }
  const online = social.friends.filter((friend) => friend.online);
  sub.textContent = social.friends.length === 0 ? 'Noch keine Freunde' : `${online.length} von ${social.friends.length} online`;
  if (social.incoming.length > 0) {
    const names = social.incoming.slice(0, 2).map((r) => r.name).join(', ');
    list.append(rowItem(placeholderIcon('user-plus'),
      social.incoming.length === 1 ? '1 Freundschaftsanfrage' : `${social.incoming.length} Freundschaftsanfragen`,
      social.incoming.length > 2 ? `${names} und weitere` : names, 'Anfragen ansehen', () => showView('friends'),
      undefined, h('span', { class: 'row-badge', text: String(social.incoming.length) })));
  }
  if (social.friends.length === 0) {
    list.append(rowItem(placeholderIcon('plus'), 'Freunde hinzufügen', 'Über ihren Spielernamen', 'Freunde öffnen', () => showView('friends')));
    return;
  }
  const busy = state.game.state === 'preparing' || state.game.state === 'running';
  if (online.length === 0) list.append(h('div', { class: 'row-note', text: 'Gerade ist niemand online.' }));
  for (const friend of online.slice(0, 5)) {
    const open = () => {
      showView('friends');
      openFriendChat(friend.uuid);
    };
    const world = hostedWorld(friend.uuid);
    const inWorld = !world && isWorldAddress(friend.server);
    const canJoin = !busy && (!!world || (friend.activity === 'multiplayer' && !!friend.server));
    const name = friend.nickname || friend.name;
    const joinTitle = world ? `In die Welt von ${name}` : inWorld ? `Zu ${name} in die geteilte Welt` : `Auf ${friend.server} mitspielen`;
    const row = rowItem(playerHead(friend.uuid, friend.name), name, activityText(friend), `Nachricht an ${name}`, open,
      canJoin ? { icon: ICONS.play, title: joinTitle, run: () => void (world ? joinWorldNow(world.code, friend.name) : joinFriend(friend)) } : { icon: UI_ICONS.chat, title: 'Nachricht schreiben', run: open },
      friend.unread > 0 ? h('span', { class: 'row-badge', title: 'Ungelesene Nachrichten', text: String(friend.unread) }) : null);
    row.querySelector('.row-meta')?.classList.add('online');
    list.append(row);
  }
  if (online.length > 5) {
    list.append(h('div', { class: 'row-empty', text: `und ${online.length - 5} weitere online` }));
    return;
  }
  // bis zu drei Einträge: offline Freunde (ungelesene Nachrichten zuerst), damit der Bereich nicht leer bleibt
  const offline = social.friends.filter((friend) => !friend.online)
    .sort((a, b) => b.unread - a.unread || a.name.localeCompare(b.name, 'de'))
    .slice(0, Math.max(0, 3 - online.length));
  if (offline.length > 0 && online.length > 0) list.append(h('div', { class: 'row-divider', text: 'Offline' }));
  for (const friend of offline) {
    const open = () => {
      showView('friends');
      openFriendChat(friend.uuid);
    };
    const row = rowItem(playerHead(friend.uuid, friend.name), friend.nickname || friend.name, 'Offline', `Nachricht an ${friend.nickname || friend.name}`, open,
      { icon: UI_ICONS.chat, title: 'Nachricht schreiben', run: open },
      friend.unread > 0 ? h('span', { class: 'row-badge', title: 'Ungelesene Nachrichten', text: String(friend.unread) }) : null);
    row.classList.add('offline');
    list.append(row);
  }
}
$('#home-friends-all').addEventListener('click', () => showView('friends'));

// ---------- Startseite: offene Welten der Freunde (Welt teilen) ----------
function renderHomeWorlds(): void {
  const panel = $('#home-worlds-panel');
  const list = $('#home-worlds');
  const sub = $('#home-worlds-sub');
  const overview = worldsOverview();
  list.textContent = '';
  // nur mit verbundenen Freunden und einem Dienst, der Welt teilen kann
  if (!overview || overview.status === 'off' || overview.status === 'unsupported' || social?.status !== 'online') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const busy = state.game.state === 'preparing' || state.game.state === 'running';
  if (overview.friends.length === 0) {
    if (overview.status === 'error') {
      sub.textContent = 'Nicht erreichbar';
      list.append(rowItem(placeholderIcon('warning'), 'Welten nicht geladen', 'Klicken, um es erneut zu versuchen', 'Erneut versuchen', () => void refreshWorlds()));
      return;
    }
    sub.textContent = 'Gerade keine geöffnet';
    list.append(h('div', { class: 'row-empty world-empty', id: 'home-worlds-empty' },
      h('strong', { text: 'Noch hat niemand eine Welt geöffnet.' }),
      h('span', { text: 'Teilt ein Freund seine Einzelspielerwelt, kannst du hier mit einem Klick beitreten – ganz ohne Server.' })));
    return;
  }
  sub.textContent = overview.friends.length === 1 ? '1 Welt geöffnet' : `${overview.friends.length} Welten geöffnet`;
  for (const world of overview.friends.slice(0, 4)) {
    const meta = [world.host.name, `${world.players}/${world.maxPlayers} Spieler`, world.version ? `Minecraft ${world.version}` : null].filter(Boolean).join(' · ');
    const row = rowItem(playerHead(world.host.uuid, world.host.name), world.name, meta, `Welt von ${world.host.name} ansehen`, () => openWorldDialog(world.code),
      busy ? undefined : { icon: ICONS.play, title: 'Beitreten', run: () => void joinWorldNow(world.code, world.host.name) },
      h('span', { class: 'row-badge world-live', title: 'Gerade geöffnet', text: 'Live' }));
    row.querySelector('.row-meta')?.classList.add('online');
    list.append(row);
  }
  if (overview.friends.length > 4) list.append(h('div', { class: 'row-empty', text: `und ${overview.friends.length - 4} weitere – unter Freunde` }));
}
onWorldsChange(() => {
  renderHomeWorlds();
  renderHomeFriends();
});
void api.getSocial().then((overview) => {
  social = overview;
  renderHomeFriends();
}).catch(() => undefined);
api.onSocial((overview) => {
  social = overview;
  renderHomeFriends();
  renderHomeWorlds();
  // eigenes Abzeichen in der Kontokarte
  if (String(ownBadge(state.accounts.find((a) => a.active))) !== shownBadge) renderAccounts();
});

// ---------- 3D-Figur ----------
let figureFor = '';
let figureSkin: SkinInfo | null = null;

async function refreshFigure(force = false): Promise<void> {
  const active = state.accounts.find((a) => a.active);
  const key = active ? `${active.id}:${active.skinUrl ?? ''}` : '';
  if (force || key !== figureFor) {
    figureFor = key;
    figureSkin = active ? await api.getSkin().catch(() => null) : null;
  }
  await showFigure(figureSkin, active?.name ?? null);
}

// ---------- Weiterspielen: Welten und Server direkt betreten (Quick Play) ----------
let continueToken = 0;
const continueCache = new Map<string, QuickPlayList>();

/** Höchstens vier Einträge, Welten und Server gemischt. */
function pickTargets(targets: QuickPlayTarget[]): QuickPlayTarget[] {
  const worlds = targets.filter((t) => t.kind === 'world');
  const servers = targets.filter((t) => t.kind === 'server');
  const worldCount = Math.min(worlds.length, Math.max(2, 4 - servers.length));
  return [...worlds.slice(0, worldCount), ...servers.slice(0, 4 - worldCount)];
}

/**
 * Anzeigenamen: Server mit Minecrafts Standardnamen („Minecraft Server“) oder doppeltem Namen
 * zeigen ihre Adresse, doppelte Weltnamen den Ordnernamen.
 */
function displayNames(targets: QuickPlayTarget[]): Map<QuickPlayTarget, string> {
  const count = new Map<string, number>();
  for (const t of targets) count.set(`${t.kind}:${t.name}`, (count.get(`${t.kind}:${t.name}`) ?? 0) + 1);
  const names = new Map<QuickPlayTarget, string>();
  for (const t of targets) {
    const duplicate = (count.get(`${t.kind}:${t.name}`) ?? 0) > 1;
    if (t.kind === 'server' && (duplicate || /^minecraft[ -]?server$/i.test(t.name.trim()))) {
      names.set(t, (t.address ?? t.id).replace(/:25565$/, ''));
    } else if (t.kind === 'world' && duplicate && t.id !== t.name) {
      names.set(t, `${t.name} (${t.id})`);
    } else {
      names.set(t, t.name);
    }
  }
  return names;
}

/** „1.234 / 5.000 online · 23 ms“ bzw. „Nicht erreichbar“ unter einem Server */
function showServerStatus(meta: HTMLElement, row: HTMLElement, address: string, status: ServerStatus): void {
  meta.classList.remove('loading');
  meta.classList.toggle('online', status.online);
  meta.classList.toggle('offline', !status.online);
  meta.textContent = '';
  if (!status.online) {
    meta.append(h('span', { class: 'server-dot' }), `Nicht erreichbar · ${address}`);
    row.title = `${address} antwortet gerade nicht – trotzdem verbinden`;
    return;
  }
  const players = status.players ? `${status.players.online.toLocaleString('de-DE')} / ${status.players.max.toLocaleString('de-DE')} online` : 'Online';
  meta.append(h('span', { class: 'server-dot' }), players, status.latencyMs !== null ? h('span', { class: 'server-ping', text: ` · ${status.latencyMs} ms` }) : '');
  row.title = [`Direkt auf ${address} verbinden`, status.motd, status.version ? `Version: ${status.version}` : null].filter(Boolean).join('\n');
}

function renderContinueList(instance: InstanceInfo, data: QuickPlayList): void {
  const section = $('#stage-continue');
  const list = $('#continue-list');
  list.textContent = '';
  section.hidden = !data.supported;
  if (!data.supported) return;
  list.classList.toggle('disabled', state.game.state === 'preparing' || state.game.state === 'running');
  const targets = pickTargets(data.targets);
  const label = displayNames(targets);
  if (targets.length === 0) {
    list.append(h('div', { class: 'row-empty', text: 'Deine Welten und Server erscheinen hier, sobald du gespielt hast.' }));
    return;
  }
  for (const target of targets) {
    const icon = target.icon
      ? h('img', { class: 'row-icon', src: target.icon, alt: '' })
      : h('span', { class: 'row-icon placeholder' }, svgIcon(target.kind === 'world' ? ICONS.world : ICONS.server, ''));
    const start = () => {
      if (state.game.state === 'preparing' || state.game.state === 'running') return;
      void launchInstance(instance.id, showView, { kind: target.kind, id: target.id });
    };
    const meta = target.kind === 'world'
      ? `Einzelspieler · ${shortRelative(target.lastPlayed)}`
      : `Server · ${(target.address ?? target.id).replace(/:25565$/, '')}`;
    const row = rowItem(icon, label.get(target) ?? target.name, meta,
      target.kind === 'world' ? `Direkt in „${target.name}“ starten` : `Direkt auf ${target.address ?? target.id} verbinden`,
      start, { icon: ICONS.play, title: 'Starten', run: start });
    list.append(row);
    if (target.kind === 'server' && typeof api.getServerStatus === 'function') {
      // Status wie in Minecrafts Serverliste (eine Minute zwischengespeichert)
      const address = target.address ?? target.id;
      const metaEl = row.querySelector<HTMLElement>('.row-meta');
      if (metaEl) {
        metaEl.classList.add('loading');
        const token = continueToken;
        void api.getServerStatus(instance.id, address).then((status) => {
          if (token === continueToken && metaEl.isConnected) showServerStatus(metaEl, row, address.replace(/:25565$/, ''), status);
        }).catch(() => metaEl.classList.remove('loading'));
      }
    }
  }
  const worlds = targets.filter((t) => t.kind === 'world').length;
  const servers = targets.length - worlds;
  $('#continue-sub').textContent = [worlds ? (worlds === 1 ? '1 Welt' : `${worlds} Welten`) : '', servers ? `${servers} Server` : ''].filter(Boolean).join(' · ') + ' · direkt starten';
}

async function renderContinue(instance: InstanceInfo | undefined): Promise<void> {
  const token = ++continueToken;
  if (!instance) {
    $('#stage-continue').hidden = true;
    return;
  }
  // Erst den letzten bekannten Stand zeigen, dann frisch laden (kein Flackern)
  const cached = continueCache.get(instance.id);
  if (cached) renderContinueList(instance, cached);
  else $('#stage-continue').hidden = true;
  try {
    const data = await api.listQuickPlay(instance.id);
    continueCache.set(instance.id, data);
    if (token === continueToken) renderContinueList(instance, data);
  } catch {
    if (token === continueToken) $('#stage-continue').hidden = true;
  }
}

// ---------- Instanz-Auswahl ----------
async function selectFromHome(id: string): Promise<void> {
  if (state.game.state === 'preparing') return;
  closePicker();
  await api.selectInstance(id);
  await reloadInstances();
}

function instanceRow(instance: InstanceInfo, selected: boolean): HTMLElement {
  const item = h('div', {
    class: `side-item${selected ? ' selected' : ''}`,
    title: selected ? 'Ausgewählt' : 'Auswählen',
    onclick: () => void selectFromHome(instance.id),
  },
  instanceTile(instance, 'small'),
  h('div', { class: 'side-item-text' },
    h('div', { class: 'side-item-name', text: instance.name }),
    h('div', { class: 'side-item-meta', text: `${instance.minecraft} · ${LOADER_LABELS[instance.loader]} · ${shortRelative(instance.lastPlayed)}` })),
  selected ? svgIcon(ICONS.check, 'side-item-check') : null);
  item.style.setProperty('--item', instance.color);
  return item;
}

const pickerPanel = $('#picker-panel');
function closePicker(): void {
  pickerPanel.hidden = true;
  $('#picker-button').classList.remove('open');
}
$('#picker-button').addEventListener('click', (event) => {
  event.stopPropagation();
  if (!pickerPanel.hidden) {
    closePicker();
    return;
  }
  if (state.instances.length === 0) {
    openNewInstanceDialog();
    return;
  }
  const list = $('#picker-list');
  list.textContent = '';
  const selectedId = selectedInstance()?.id;
  const sorted = [...state.instances].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.created - a.created);
  for (const instance of sorted) list.append(instanceRow(instance, instance.id === selectedId));
  pickerPanel.hidden = false;
  $('#picker-button').classList.add('open');
});
pickerPanel.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', closePicker);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePicker();
});
$('#picker-new').addEventListener('click', () => {
  closePicker();
  openNewInstanceDialog();
});
$('#home-instances-all').addEventListener('click', () => showView('instances'));
$('#picker-manage').addEventListener('click', () => {
  closePicker();
  showView('instances');
});
$('#home-name').addEventListener('click', (event) => {
  event.stopPropagation();
  if (popover.hidden) openAccounts($('#home-name'));
  else closeAccounts();
});

function renderHome(): void {
  renderGreeting();
  renderStage();
  renderHomeFriends();
  renderHomeWorlds();
}

// ---------- Avatare ----------
function renderAvatar(el: HTMLElement, account: AccountInfo | undefined): void {
  el.textContent = '';
  el.style.background = '';
  el.style.color = '';
  if (!account) {
    el.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
    return;
  }
  if (account.skinUrl) {
    // Gesicht (8,8) und Hut-Ebene (40,8) aus der 64x64-Skin-Textur ausschneiden
    const size = el.getBoundingClientRect().width || (el.classList.contains('large') ? 44 : el.classList.contains('small') ? 32 : 38);
    const scale = size / 8;
    const url = account.skinUrl.replace(/^http:/, 'https:');
    el.style.backgroundImage = `url("${url}"), url("${url}")`;
    el.style.backgroundSize = `${64 * scale}px ${64 * scale}px`;
    el.style.backgroundPosition = `${-40 * scale}px ${-8 * scale}px, ${-8 * scale}px ${-8 * scale}px`;
    return;
  }
  const hue = parseInt(account.uuid.slice(0, 6), 16) % 360;
  el.style.background = `linear-gradient(135deg, hsl(${hue} 60% 50%), hsl(${(hue + 50) % 360} 65% 34%))`;
  el.style.color = '#fff';
  el.textContent = account.name.charAt(0).toUpperCase();
}

// ---------- Status & Spielen ----------
let runningSince: number | null = null;

/** "seit 12 Min." bzw. null in der ersten Minute */
function runningFor(): string | null {
  const minutes = runningSince ? Math.floor((Date.now() - runningSince) / 60000) : 0;
  if (minutes < 1) return null;
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `seit ${hours} Std. ${minutes % 60} Min.` : `seit ${minutes} Min.`;
}

function setChip(text: string | null, busy = false): void {
  const chip = $('#titlebar-chip');
  chip.hidden = text == null;
  chip.classList.toggle('busy', busy);
  if (text) $('#titlebar-chip-text').textContent = text;
}

/** Ruhige Zeile unter dem Spielen-Knopf: zuletzt gespielt, Spielzeit, Mods und Addons der Instanz */
function renderFacts(instance: InstanceInfo | undefined): void {
  const box = $('#home-facts');
  box.textContent = '';
  if (!instance) return;
  const fact = (icon: string, text: string, title = '') => h('span', { class: 'home-fact', title }, uiIcon(icon, ''), text);
  box.append(fact('clock', instance.lastPlayed ? `Zuletzt ${shortRelative(instance.lastPlayed)}` : 'Noch nie gespielt', instance.lastPlayed ? formatDate(instance.lastPlayed) : ''));
  if (instance.playTimeMs > 0) box.append(fact('hourglass', `${formatPlayTime(instance.playTimeMs)} gespielt`, 'Spielzeit in dieser Instanz'));
  if (instance.loader !== 'vanilla') box.append(fact('cube', instance.modCount === 0 ? 'Keine Mods' : instance.modCount === 1 ? '1 Mod' : `${instance.modCount} Mods`));
  if (instance.heldixClient) box.append(fact('addons', instance.addonCount === 0 ? 'Keine Addons' : instance.addonCount === 1 ? '1 Addon' : `${instance.addonCount} Addons`));
}

/** Zeile unter dem Spielen-Button: nur, wenn es etwas zu sagen gibt – sonst die Fakten zur Instanz. */
function launchStatus(kind: 'ok' | 'busy' | 'error' | 'muted' | null, text = '', sub = ''): void {
  const box = $('#launch-status');
  box.hidden = !kind;
  $('#home-facts').hidden = !!kind;
  $('#status-dot').className = `status-dot${kind && kind !== 'ok' ? ` ${kind}` : ''}`;
  $('#status-text').textContent = text;
  $('#status-sub').textContent = sub;
}

function renderStatus(): void {
  const home = $('#home');
  const homeSub = $('#home-sub');
  const play = $<HTMLButtonElement>('#play-button');
  const label = $('#play-label');
  const game = state.game;
  const instance = stageInstance();

  play.classList.remove('stop', 'busy');
  play.disabled = false;
  home.classList.toggle('busy', game.state === 'preparing');
  home.classList.toggle('running', game.state === 'running');
  $<HTMLButtonElement>('#picker-button').disabled = game.state === 'preparing';
  $<HTMLButtonElement>('#kill-game').disabled = game.state !== 'running';
  setChip(null);

  if (game.state === 'preparing') {
    const p = state.progress;
    const percent = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    play.classList.add('busy');
    play.disabled = true;
    play.style.setProperty('--p', `${percent}%`);
    $('#stage-progress').style.setProperty('--p', `${percent}%`);
    label.textContent = p && p.total > 0 ? `Lädt … ${percent} %` : 'Lädt …';
    launchStatus('busy', p ? p.stage : 'Vorbereiten', p && p.total > 0 ? `${p.done.toLocaleString('de-DE')} von ${p.total.toLocaleString('de-DE')} Dateien` : 'Prüfe Dateien …');
    homeSub.textContent = `${instance?.name ?? 'Minecraft'} wird vorbereitet …`;
    setChip('Lädt …', true);
    return;
  }
  if (game.state === 'running') {
    const since = runningFor();
    play.classList.add('stop');
    label.textContent = 'Beenden';
    launchStatus('ok', since ? `Läuft ${since}` : 'Läuft', instance?.heldixClient ? 'Rechts ⇧ öffnet im Spiel das Heldix-Menü.' : 'Viel Spaß!');
    homeSub.textContent = `${game.label} ist gestartet – viel Spaß!`;
    setChip(`Läuft · ${game.label}`);
    return;
  }

  const active = state.accounts.find((a) => a.active);
  if (!instance) {
    label.textContent = 'Instanz anlegen';
    launchStatus(null);
    homeSub.textContent = 'Leg deine erste Instanz an und los geht’s.';
    return;
  }
  label.textContent = 'Spielen';
  if (!active) {
    launchStatus('muted', 'Nicht angemeldet', 'Klicke oben auf „bitte anmelden“.');
    homeSub.textContent = 'Melde dich an, dann kann es losgehen.';
    return;
  }
  if (game.state === 'error') {
    launchStatus('error', 'Start fehlgeschlagen', game.message);
    homeSub.textContent = 'Der letzte Start hat nicht geklappt – Details stehen in der Konsole.';
    return;
  }
  launchStatus(null);
  renderFacts(instance);
  homeSub.textContent = instance.lastPlayed ? `Bereit für die nächste Runde in ${instance.name}?` : `${instance.name} ist startklar.`;
}

// Laufzeit-Anzeige aktuell halten
window.setInterval(() => {
  if (state.game.state === 'running') renderStatus();
}, 20000);

$('#play-button').addEventListener('click', async () => {
  if (state.game.state === 'running') {
    await api.killGame();
    return;
  }
  const instance = selectedInstance();
  if (!instance) {
    openNewInstanceDialog();
    return;
  }
  if (!state.accounts.some((a) => a.active)) {
    openAccounts($('#home-name'));
    toast('Bitte zuerst ein Konto hinzufügen.');
    return;
  }
  await launchInstance(instance.id, showView);
});

api.onProgress((progress) => {
  state.progress = progress;
  if (state.game.state === 'preparing') renderStatus();
});

// ---------- Hinweise auf der Startseite: letzter Absturz, Addon-Updates ----------
let crashNotice: { id: string; title: string } | null = null;
let addonUpdates = 0;
let updatingAddons = false;
const dismissedNotices = new Set<string>();

function homeNotice(key: string, kind: 'warn' | 'accent', icon: string, title: string, sub: string, ...actions: HTMLElement[]): HTMLElement {
  return h('div', { class: `home-notice ${kind}` },
    h('span', { class: 'home-notice-icon' }, uiIcon(icon, '')),
    h('span', { class: 'home-notice-text' }, h('strong', { text: title }), h('span', { text: sub })),
    h('span', { class: 'home-notice-actions' }, ...actions),
    h('button', { class: 'icon-button small', type: 'button', title: 'Ausblenden', onclick: () => {
      dismissedNotices.add(key);
      renderNotices();
    } }, uiIcon('close', '')));
}

function renderNotices(): void {
  const box = $('#home-notices');
  box.textContent = '';
  if (crashNotice && !dismissedNotices.has(`crash:${crashNotice.id}`)) {
    const id = crashNotice.id;
    box.append(homeNotice(`crash:${id}`, 'warn', 'warning', 'Minecraft ist beim letzten Mal abgestürzt', crashNotice.title,
      h('button', { class: 'ghost small', type: 'button', onclick: () => void showCrash(id) }, 'Absturz-Hilfe')));
  }
  if (addonUpdates > 0 && !dismissedNotices.has(`addons:${addonUpdates}`)) {
    const busy = updatingAddons || state.game.state === 'preparing';
    box.append(homeNotice(`addons:${addonUpdates}`, 'accent', 'refresh',
      addonUpdates === 1 ? '1 Addon-Update verfügbar' : `${addonUpdates} Addon-Updates verfügbar`,
      state.game.state === 'running' ? 'Laufende Instanzen werden nach dem Beenden aktualisiert.' : 'Neue Versionen aus dem Addon-Store, geprüft und signiert.',
      h('button', { class: 'ghost small', type: 'button', onclick: () => showView('store') }, 'Ansehen'),
      h('button', { class: 'primary small', type: 'button', disabled: busy, onclick: () => void updateAddonsFromHome() }, updatingAddons ? 'Aktualisiert …' : 'Alle aktualisieren')));
  }
  box.hidden = box.childElementCount === 0;
}

async function updateAddonsFromHome(): Promise<void> {
  if (updatingAddons) return;
  updatingAddons = true;
  renderNotices();
  try {
    const result = await api.updateAllAddons();
    if (result.updated > 0) toast(result.updated === 1 ? '1 Addon aktualisiert.' : `${result.updated} Addons aktualisiert.`, 'success');
    if (result.failed.length > 0) toast(`Nicht aktualisiert: ${result.failed.join(', ')}`, 'error');
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    updatingAddons = false;
    renderNotices();
  }
}

// Zahl der Addon-Updates kommt vom Addon-Store (Abzeichen in der Navigation)
document.addEventListener('heldix:store-updates', (event) => {
  addonUpdates = Math.max(0, Number((event as CustomEvent<number>).detail) || 0);
  renderNotices();
});

api.onGameState(async (game) => {
  state.game = game;
  // „Update bereit – Jetzt neu starten“ erst, wenn kein Spiel läuft
  renderUpdate();
  if (game.state === 'preparing') crashNotice = null;
  if (game.state === 'exited' && game.crash) crashNotice = game.crash;
  renderNotices();
  if (game.state === 'preparing') state.progress = null;
  if (game.state === 'running') runningSince ??= Date.now();
  else runningSince = null;
  if (game.state === 'exited' && game.notice) {
    // z. B. Vulkan-Absturz: der Launcher hat die Einstellungen angepasst
    toast(game.notice, 'error');
    $('#console-dot').hidden = false;
    state.settings = await api.getSettings();
    renderSettings();
  } else if (game.state === 'exited' && game.crash) {
    // Absturz-Hilfe: Ursache und passende Schritte
    $('#crash-last').hidden = false;
    $('#console-dot').hidden = false;
    void showCrash(game.crash.id);
  } else if (game.state === 'exited' && game.code !== 0 && game.code !== null) {
    toast(`Minecraft wurde mit Fehlercode ${game.code} beendet. Details in der Konsole.`, 'error');
    $('#console-dot').hidden = false;
  }
  renderStage();
  if (game.state === 'running' || game.state === 'exited') await reloadInstances();
});

on('instances', renderHome);
on('settings', renderStage);

// ---------- Discord-Hinweis in der Titelleiste ----------
function renderDiscordChip(status: DiscordStatus): void {
  const chip = $('#home-discord');
  const configured = state.info?.discordConfigured ?? false;
  chip.hidden = status.state === 'unconfigured' || (status.state === 'disabled' && !configured);
  chip.dataset.state = status.state;
  const texts: Record<DiscordStatus['state'], string> = {
    disabled: 'Discord aus',
    unconfigured: 'Discord',
    connecting: 'Discord …',
    connected: 'Discord',
    unavailable: 'Discord geschlossen',
    error: 'Discord: Problem',
  };
  $('#home-discord-text').textContent = texts[status.state];
  chip.title = status.state === 'connected' ? 'Discord-Status ist aktiv – klicken zum Einstellen' : 'Discord-Status einstellen';
}
$('#home-discord').addEventListener('click', () => {
  showView('settings');
  document.querySelector<HTMLButtonElement>('#settings-nav [data-target="set-discord"]')?.click();
});

// ---------- Konten ----------
const popover = $('#account-popover');

function openAccounts(anchor?: HTMLElement): void {
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    popover.style.left = `${Math.round(rect.left)}px`;
    popover.style.top = `${Math.round(rect.bottom + 10)}px`;
    popover.style.bottom = 'auto';
  } else {
    popover.style.left = '';
    popover.style.top = '';
    popover.style.bottom = '';
  }
  popover.hidden = false;
  renderAccounts();
}

function closeAccounts(): void {
  popover.hidden = true;
}

$('#account-button').addEventListener('click', (event) => {
  event.stopPropagation();
  if (popover.hidden) openAccounts();
  else closeAccounts();
});
popover.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', closeAccounts);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeAccounts();
  document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach((m) => {
    if (m.id) m.hidden = true;
    else m.remove();
  });
});

/** Art des Kontos für Listen */
function accountKind(account: AccountInfo): string {
  if (account.type === 'offline') return 'Offline-Konto';
  return account.via === 'launcher' ? 'Microsoft · bitte neu anmelden' : 'Microsoft-Konto';
}

async function removeAccountAsk(account: AccountInfo): Promise<void> {
  const ok = await confirmDialog(`${account.name} abmelden?`,
    'Das Konto wird aus dem Launcher entfernt. Deine Welten, Instanzen und dein Minecraft-Konto bleiben erhalten – anmelden kannst du dich jederzeit wieder.',
    'Abmelden');
  if (!ok) return;
  await api.removeAccount(account.id);
  await loadAccounts();
}

/** eigenes Abzeichen beim Heldix-Dienst für das aktive Konto (undefined = nicht verbunden; null = normaler Spieler) */
function ownBadge(active: AccountInfo | undefined): PlayerBadge | null | undefined {
  if (!active || social?.status !== 'online' || !social.me) return undefined;
  return social.me.uuid === active.uuid.replace(/-/g, '').toLowerCase() ? social.me.badge : undefined;
}
let shownBadge = '';

function renderAccounts(): void {
  const active = state.accounts.find((a) => a.active);
  const badge = ownBadge(active);
  shownBadge = String(badge);
  renderAvatar($('#account-avatar'), active);
  $('#avatar-status').hidden = !active;
  $('#account-label').textContent = active?.name ?? 'Nicht angemeldet';
  // Kontokarte in der Seitenleiste: eigenes Abzeichen (Team-Rolle, Community-Abzeichen) neben dem Namen
  if (badge) $('#account-label').append(badgeIcon(badge, 14));
  $('#account-sub').textContent = active ? (active.via === 'launcher' ? 'Bitte neu anmelden' : active.type === 'microsoft' ? 'Microsoft-Konto' : 'Offline-Konto') : 'Konto hinzufügen';

  // Aktives Konto oben, groß
  const current = $('#account-current');
  current.textContent = '';
  current.className = 'account-current';
  if (active) {
    const avatar = h('span', { class: 'avatar large' });
    const legacy = active.via === 'launcher';
    current.classList.toggle('legacy', legacy);
    current.append(avatar,
      h('div', { class: 'account-current-text' },
        h('div', { class: 'account-current-name', text: active.name }),
        h('div', { class: 'account-current-sub' }, h('span', { class: 'dot' }),
          h('span', { text: legacy ? 'Anmeldung läuft ab – bitte mit Microsoft neu anmelden' : active.type === 'microsoft' ? 'Microsoft-Konto · angemeldet' : 'Offline-Konto (Entwicklung)' })),
        badge !== undefined ? h('div', { class: 'account-current-badge', id: 'account-badge', title: 'Dein Abzeichen beim Heldix-Dienst – so sehen dich andere im Spiel' },
          badgeIcon(badge, 18), h('span', { text: badgeLabel(badge) })) : null),
      h('button', { class: 'ghost small', type: 'button', title: 'Dieses Konto aus dem Launcher entfernen', onclick: () => void removeAccountAsk(active) }, 'Abmelden'));
    renderAvatar(avatar, active);
  } else {
    current.classList.add('empty');
    current.append(h('div', { class: 'account-current-title', text: 'Nicht angemeldet' }),
      h('p', { text: 'Melde dich mit dem Microsoft-Konto an, mit dem du Minecraft: Java Edition gekauft hast. Dein Passwort siehst nur du im Fenster von Microsoft.' }));
  }
  $('#account-links').hidden = !active || active.type !== 'microsoft';

  // Weitere Konten zum Wechseln
  const others = state.accounts.filter((a) => !a.active);
  $('#account-others-title').hidden = others.length === 0;
  const list = $('#account-list');
  list.textContent = '';
  for (const account of others) {
    const avatar = h('span', { class: 'avatar small' });
    list.append(h('div', {
      class: 'account-item',
      title: `Zu ${account.name} wechseln`,
      onclick: async () => {
        await api.selectAccount(account.id);
        await loadAccounts();
      },
    },
    avatar,
    h('div', { class: 'account-meta' },
      h('div', { class: 'account-name', text: account.name }),
      h('div', { class: 'account-type', text: accountKind(account) })),
    h('button', {
      class: 'remove-account',
      title: 'Abmelden',
      text: '×',
      onclick: (event: Event) => {
        event.stopPropagation();
        void removeAccountAsk(account);
      },
    })));
    renderAvatar(avatar, account);
  }

  const info = state.info;
  const add = $<HTMLButtonElement>('#add-microsoft');
  add.disabled = !info?.microsoftConfigured;
  add.className = active ? 'ghost full' : 'primary full';
  $('#add-microsoft-label').textContent = active ? 'Weiteres Microsoft-Konto' : 'Mit Microsoft anmelden';
  $('#ms-hint').hidden = !!info?.microsoftConfigured;
  // Offline-Konten nur in der Entwicklungsversion (npm start)
  const dev = !!info?.isDev;
  $('#offline-form').hidden = !dev;
  $('#offline-hint').hidden = !dev;
}

async function loadAccounts(): Promise<void> {
  state.accounts = await api.listAccounts();
  renderAccounts();
  renderHome();
  void refreshFigure();
}

$('#account-skins').addEventListener('click', () => {
  closeAccounts();
  showView('profile');
});
$('#account-friends').addEventListener('click', () => {
  closeAccounts();
  showView('friends');
});

$('#add-microsoft').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('#add-microsoft');
  button.disabled = true;
  try {
    const account = await api.addMicrosoftAccount();
    toast(`Angemeldet als ${account.name}`, 'success');
    await loadAccounts();
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    button.disabled = !state.info?.microsoftConfigured;
  }
});

api.onAccountsChanged(() => void loadAccounts());

$('#offline-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#offline-name');
  try {
    await api.addOfflineAccount(input.value);
    input.value = '';
    await loadAccounts();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});

// ---------- Einstellungen ----------
const memoryRange = $<HTMLInputElement>('#memory-range');

function formatGb(mb: number): string {
  return `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
}

function updateMemoryLabel(): void {
  const value = Number(memoryRange.value);
  $('#memory-value').textContent = formatGb(value);
  const fill = ((value - Number(memoryRange.min)) / (Number(memoryRange.max) - Number(memoryRange.min))) * 100;
  memoryRange.style.setProperty('--fill', `${fill}%`);
  const badge = $('#memory-badge');
  badge.classList.toggle('warn', value < 2048 || value > 8192);
  badge.textContent = value < 2048 ? 'Sehr wenig' : value > 8192 ? 'Mehr als nötig' : 'Empfohlen';
}

function renderSettings(): void {
  const s = state.settings;
  const info = state.info;
  if (!s || !info) return;
  const maxMb = Math.max(2048, Math.floor((info.totalMemoryMb * 0.75) / 512) * 512);
  memoryRange.max = String(maxMb);
  memoryRange.value = String(Math.min(s.memoryMb, maxMb));
  $('#memory-max-label').textContent = formatGb(maxMb);
  updateMemoryLabel();

  $<HTMLInputElement>('#resolution-toggle').checked = s.resolution != null;
  $('#resolution-inputs').classList.toggle('disabled', s.resolution == null);
  $<HTMLInputElement>('#res-width').value = String(s.resolution?.width ?? 1280);
  $<HTMLInputElement>('#res-height').value = String(s.resolution?.height ?? 720);
  $<HTMLInputElement>('#hide-toggle').checked = s.hideLauncherOnLaunch;
  $<HTMLInputElement>('#tray-toggle').checked = s.closeToTray;
  $<HTMLInputElement>('#account-switch-toggle').checked = s.gameAccountSwitch;
  $<HTMLInputElement>('#java-path').value = s.javaPath;
  $<HTMLInputElement>('#jvm-args').value = s.jvmArgs;
  $('#data-dir').textContent = info.dataDir;
  $('#about-version').textContent = `v${info.version}`;
  const loader = info.loaderVersion ? `Heldix Loader ${info.loaderVersion}` : 'Heldix Loader';
  $('#about-text').textContent = info.isDev
    ? `Entwicklungsmodus · Offline-Konten aktiv · ${loader}`
    : `${loader} · Minecraft-Dateien kommen direkt von Mojang.`;
  $<HTMLInputElement>('#discord-toggle').checked = s.discordPresence;
  $<HTMLInputElement>('#update-toggle').checked = s.autoUpdate;
  renderDiscordSettings(s);
  $<HTMLInputElement>('#addon-notify-toggle').checked = s.addonUpdateNotifications;
  $<HTMLInputElement>('#addon-auto-toggle').checked = s.addonAutoUpdate;
  $<HTMLInputElement>('#social-toggle').checked = s.social;
  $<HTMLInputElement>('#social-notify-toggle').checked = s.socialNotifications;
  $('#social-notify-row').classList.toggle('disabled', !s.social);
  renderPerformance(s);
}

// Bereiche der Einstellungen: Navigation links springt hin, beim Scrollen wandert die Markierung mit
const settingsPage = $('#settings-page');
const settingsButtons = [...document.querySelectorAll<HTMLButtonElement>('#settings-nav button')];
function markSettingsSection(id: string): void {
  settingsButtons.forEach((button) => button.classList.toggle('active', button.dataset.target === id));
}
settingsButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.target!);
    if (!target) return;
    settingsPage.scrollTo({ top: target.offsetTop - settingsPage.offsetTop - 12, behavior: 'smooth' });
    markSettingsSection(target.id);
  });
});
let settingsScrollFrame = 0;
settingsPage.addEventListener('scroll', () => {
  if (settingsScrollFrame) return;
  settingsScrollFrame = requestAnimationFrame(() => {
    settingsScrollFrame = 0;
    const top = settingsPage.scrollTop + settingsPage.offsetTop + 60;
    let current = settingsButtons[0]?.dataset.target ?? '';
    for (const button of settingsButtons) {
      const group = document.getElementById(button.dataset.target!);
      if (group && group.offsetTop <= top) current = group.id;
    }
    markSettingsSection(current);
  });
});
$('#social-toggle').addEventListener('change', async (e) => {
  await save({ social: (e.target as HTMLInputElement).checked });
  renderSettings();
});
$('#social-notify-toggle').addEventListener('change', (e) => save({ socialNotifications: (e.target as HTMLInputElement).checked }));
$('#addon-notify-toggle').addEventListener('change', (e) => save({ addonUpdateNotifications: (e.target as HTMLInputElement).checked }));
$('#addon-auto-toggle').addEventListener('change', (e) => save({ addonAutoUpdate: (e.target as HTMLInputElement).checked }));
$('#addon-store-open').addEventListener('click', () => showView('store'));
$('#social-open').addEventListener('click', () => showView('friends'));

// ---------- Leistung ----------
const GRAPHICS_HINTS: Record<Settings['graphicsApi'], string> = {
  vulkan: 'Standard bei HeldixClient. Minecraft startet mit Vulkan und nimmt OpenGL, wenn dein PC kein Vulkan kann. In Minecraft 26.3 ist Vulkan noch als experimentell markiert.',
  default: 'Minecraft entscheidet selbst (zurzeit OpenGL) und schaltet nach einem Absturz beim Start automatisch um.',
  opengl: 'Die bewährte Grafik-API von Minecraft. Gut, falls Vulkan auf deinem PC Probleme macht.',
};

function renderPerformance(s: Settings): void {
  document.querySelectorAll<HTMLButtonElement>('#graphics-api button').forEach((button) => {
    button.classList.toggle('active', button.dataset.api === s.graphicsApi);
  });
  $('#graphics-hint').textContent = api.platform === 'darwin'
    ? 'Auf dem Mac gibt es kein Vulkan: Minecraft wählt die Grafik-API selbst. Die Auswahl gilt nur unter Windows.'
    : `${GRAPHICS_HINTS[s.graphicsApi]} Gilt für Heldix-Instanzen ab Minecraft 26.x; Fabric und Vanilla nutzen die Einstellung im Spiel.`;
  document.querySelectorAll<HTMLButtonElement>('#graphics-api button').forEach((button) => {
    button.disabled = api.platform === 'darwin';
  });
  $<HTMLInputElement>('#jvm-tuning-toggle').checked = s.jvmTuning;
}

document.querySelectorAll<HTMLButtonElement>('#graphics-api button').forEach((button) => {
  button.addEventListener('click', async () => {
    await save({ graphicsApi: button.dataset.api as Settings['graphicsApi'] });
    renderSettings();
  });
});
$('#jvm-tuning-toggle').addEventListener('change', (e) => save({ jvmTuning: (e.target as HTMLInputElement).checked }));

// ---------- Discord ----------
function renderDiscordStatus(status: DiscordStatus): void {
  const configured = state.info?.discordConfigured ?? false;
  const texts: Record<DiscordStatus['state'], string> = {
    disabled: 'Aus',
    unconfigured: 'Noch nicht eingerichtet: Die Discord-Application-ID fehlt (siehe README).',
    connecting: 'Verbinde mit Discord …',
    connected: 'Mit Discord verbunden',
    unavailable: 'Discord ist nicht geöffnet. Der Status erscheint, sobald Discord läuft.',
    error: 'Discord lehnt die Verbindung ab',
  };
  let text = texts[status.state];
  if (status.state === 'connected' && status.user) text = `Verbunden als ${status.user}`;
  if (status.state === 'error') {
    text = /client id/i.test(status.message) ? 'Die Discord-Application-ID ist ungültig (siehe README).' : `Discord meldet: ${status.message}`;
  }
  if (status.state === 'disabled' && !configured) text = texts.unconfigured;
  const host = $('#discord-status');
  host.dataset.state = status.state;
  $('#discord-status-text').textContent = text;
  renderDiscordChip(status);
}
/** Schalter der Discord-Seite: welcher Schalter welche Einstellung */
const DISCORD_SWITCHES: [string, keyof Settings][] = [
  ['#discord-server-toggle', 'discordShowServer'],
  ['#discord-details-toggle', 'discordShowDetails'],
  ['#discord-worldname-toggle', 'discordShowWorldName'],
  ['#discord-party-toggle', 'discordShowParty'],
  ['#discord-voice-toggle', 'discordShowVoice'],
  ['#discord-head-toggle', 'discordShowHead'],
  ['#discord-invite-toggle', 'discordInviteButtons'],
];

function renderDiscordSettings(s: Settings): void {
  $<HTMLInputElement>('#discord-toggle').checked = s.discordPresence;
  for (const [selector, key] of DISCORD_SWITCHES) $<HTMLInputElement>(selector).checked = s[key] === true;
  // „Nur Spielt HeldixClient“ zeigt keine Einzelheiten: Schalter dann ausgegraut
  document.querySelectorAll<HTMLElement>('#discord-fields .toggle-row').forEach((row) => row.classList.toggle('disabled', s.discordMinimal));
  document.querySelectorAll<HTMLButtonElement>('#discord-mode button').forEach((button) => {
    button.classList.toggle('active', (button.dataset.mode === 'minimal') === s.discordMinimal);
  });
}

$('#discord-toggle').addEventListener('change', (e) => save({ discordPresence: (e.target as HTMLInputElement).checked }));
for (const [selector, key] of DISCORD_SWITCHES) {
  $(selector).addEventListener('change', (e) => save({ [key]: (e.target as HTMLInputElement).checked } as Partial<Settings>));
}
document.querySelectorAll<HTMLButtonElement>('#discord-mode button').forEach((button) => {
  button.addEventListener('click', async () => {
    await save({ discordMinimal: button.dataset.mode === 'minimal' });
    renderSettings();
  });
});
api.onDiscordStatus(renderDiscordStatus);
void api.getDiscordStatus().then(renderDiscordStatus);

// ---------- Discord: Vorschau des Status ----------
let discordPreview: DiscordPreview | null = null;

/** „00:42 vergangen“ wie in Discord */
function elapsed(since: number): string {
  const total = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${hours ? `${hours}:${two(minutes)}` : two(minutes)}:${two(seconds)} vergangen`;
}

function previewImage(name: string | null, className: string, title: string | null): HTMLElement {
  const img = h('img', { class: className, src: name ? `discord/${name}.png` : 'logo.svg', alt: '', draggable: 'false' });
  if (title) img.title = title;
  return img;
}

function renderDiscordPreview(preview: DiscordPreview | null = discordPreview): void {
  discordPreview = preview;
  const host = $('#discord-preview');
  host.textContent = '';
  if (!preview) {
    host.append(h('div', { class: 'row-empty', text: 'Vorschau wird geladen …' }));
    return;
  }
  const images = h('div', { class: 'dp-images' }, previewImage(preview.largeImage, 'dp-large', preview.largeText));
  if (preview.smallImage === 'head') {
    const active = state.accounts.find((a) => a.active);
    const avatar = h('span', { class: 'avatar dp-small dp-head' });
    if (preview.smallText) avatar.title = preview.smallText;
    images.append(avatar);
    renderAvatar(avatar, active);
  } else if (preview.smallImage) images.append(previewImage(preview.smallImage, 'dp-small', preview.smallText));
  const party = preview.party ? ` (${preview.party[0].toLocaleString('de-DE')} von ${preview.party[1].toLocaleString('de-DE')})` : '';
  const text = h('div', { class: 'dp-text' },
    h('strong', { text: 'HeldixClient' }),
    preview.details ? h('span', { class: 'dp-line', id: 'discord-preview-details', text: preview.details }) : null,
    preview.state || party ? h('span', { class: 'dp-line', id: 'discord-preview-state', text: `${preview.state ?? ''}${party}` }) : null,
    preview.since ? h('span', { class: 'dp-time', 'data-since': String(preview.since), text: elapsed(preview.since) }) : null);
  host.append(
    h('div', { class: `dp-card${preview.enabled ? '' : ' off'}` },
      h('div', { class: 'dp-label', text: 'Spielt' }),
      h('div', { class: 'dp-body' }, images, text),
      preview.buttons.length ? h('div', { class: 'dp-buttons' }, ...preview.buttons.map((label) => h('span', { class: 'dp-button', text: label }))) : null));
  $('#discord-preview-hint').textContent = preview.enabled
    ? 'So sieht dein Status gerade aus – er ändert sich mit dem, was du spielst.'
    : 'Der Discord-Status ist aus. So würde er gerade aussehen.';
}
api.onDiscordPreview((preview) => renderDiscordPreview(preview));
void api.getDiscordPreview().then((preview) => renderDiscordPreview(preview)).catch(() => undefined);
window.setInterval(() => {
  if (document.body.dataset.view !== 'settings') return;
  document.querySelectorAll<HTMLElement>('#discord-preview .dp-time').forEach((el) => {
    el.textContent = elapsed(Number(el.dataset.since));
  });
}, 1000);

// ---------- Updates ----------
// Windows: beim Start installiert der Launcher neue Versionen selbst (Startfenster, main/core/startup-update.ts). Im
// laufenden Launcher lädt er sie im Hintergrund; ist eine bereit und läuft kein Spiel, zeigt die Seitenleiste
// „Update bereit – Jetzt neu starten“ (sonst erst nach dem Spiel), beim Beenden wird sie ohnehin installiert.
// Einstellung aus: nur „Update verfügbar – Jetzt installieren“. macOS: Download über heldixclient.com.
let updateState: UpdateState | null = null;
/** Version, zu der „Update bereit“ schon als Meldung kam (einmal je Version) */
let updateToastFor: string | null = null;

function renderUpdate(u: UpdateState = updateState!): void {
  if (!u) return;
  updateState = u;
  const mac = api.platform === 'darwin';
  const playing = state.game?.state === 'preparing' || state.game?.state === 'running';
  const percent = Math.round((u.progress ?? 0) * 100);
  const texts: Record<UpdateState['phase'], string> = {
    disabled: 'In diesem Build nicht verfügbar (Entwicklungsversion).',
    idle: `Version ${u.current} installiert.`,
    checking: 'Suche nach Updates …',
    current: `Version ${u.current} ist aktuell.`,
    available: mac ? `Version ${u.version} ist da. Auf dem Mac lädst du sie über heldixclient.com.` : `Version ${u.version} ist da. „Jetzt installieren“ lädt sie und startet den Launcher neu.`,
    downloading: `Lade Version ${u.version} … ${percent} %`,
    ready: playing
      ? `Version ${u.version} ist bereit. Nach dem Spiel kannst du neu starten – beim Beenden wird sie ohnehin installiert.`
      : `Version ${u.version} ist bereit. „Jetzt neu starten“ installiert sie sofort, sonst beim Beenden.`,
    error: u.error ?? 'Update fehlgeschlagen.',
  };
  const status = $('#update-status');
  status.dataset.state = u.phase;
  $('#update-status-text').textContent = texts[u.phase];
  $<HTMLButtonElement>('#update-check').disabled = u.phase === 'disabled' || u.phase === 'checking' || u.phase === 'downloading' || u.phase === 'ready' || u.phase === 'available';
  $('#update-install').hidden = (u.phase !== 'ready' && u.phase !== 'available') || (playing && !mac);
  $('#update-install').lastChild!.textContent = mac ? 'Herunterladen' : u.phase === 'available' ? 'Jetzt installieren' : 'Jetzt neu starten';
  const notes = $('#update-notes');
  const lines = u.phase === 'downloading' || u.phase === 'ready' || u.phase === 'available' ? u.notes ?? [] : [];
  notes.replaceChildren(...lines.map((note) => {
    const li = document.createElement('li');
    li.textContent = note;
    return li;
  }));
  notes.hidden = lines.length === 0;

  // Hinweis in der Seitenleiste: neue Version da, wird geladen oder bereit (bereit erst, wenn kein Spiel läuft)
  const card = $('#update-card');
  card.hidden = (u.phase !== 'downloading' && u.phase !== 'ready' && u.phase !== 'available') || (u.phase === 'ready' && playing);
  $('#update-card-title').textContent = u.phase === 'ready' ? 'Update bereit' : u.phase === 'available' ? 'Update verfügbar' : `Update ${u.version ?? ''}`;
  $('#update-card-sub').textContent = u.phase === 'ready' ? `Version ${u.version}` : u.phase === 'available' ? (mac ? `${u.version} auf heldixclient.com` : `Version ${u.version}`) : `wird geladen … ${percent} %`;
  $('#update-bar').hidden = u.phase !== 'downloading';
  $('#update-bar-fill').style.width = `${percent}%`;
  $('#update-card-install').hidden = (u.phase !== 'ready' && u.phase !== 'available') || (playing && !mac);
  $('#update-card-install').textContent = mac ? 'Herunterladen' : u.phase === 'available' ? 'Jetzt installieren' : 'Jetzt neu starten';
  card.dataset.label = u.phase === 'ready' ? `Update ${u.version} bereit: Jetzt neu starten` : u.phase === 'available' ? `Update ${u.version} verfügbar` : `Update wird geladen (${percent} %)`;

  // einmal je Version melden, sobald sie bereit ist und kein Spiel läuft (sonst nach dem Spiel)
  if (u.phase === 'ready' && !playing && u.version && updateToastFor !== u.version) {
    updateToastFor = u.version;
    toast(`Update auf ${u.version} ist bereit – „Jetzt neu starten“ in der Seitenleiste installiert es.`, 'success');
  }
}

async function installUpdate(): Promise<void> {
  if (api.platform === 'darwin') {
    await api.openUpdateDownload();
    return;
  }
  try {
    await api.installUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
  }
}

/** Hinweis „Update verfügbar“ beim Start (Einstellung „Updates automatisch“ aus bzw. macOS), einmal je Start */
async function showUpdateNotice(): Promise<void> {
  // nicht neben dem Einrichtungs-Assistenten, sondern danach
  if (setupOpen()) {
    afterSetup(() => void showUpdateNotice());
    return;
  }
  const notice = await api.takeUpdateNotice().catch(() => null);
  if (!notice?.version || document.getElementById('update-notice')) return;
  const mac = api.platform === 'darwin';
  const close = () => backdrop.remove();
  const notes = notice.notes ?? [];
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (event: Event) => event.target === backdrop && close() },
    h('div', { class: 'modal news-modal', id: 'update-notice', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'update-notice-title' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('h3', { class: 'modal-title', id: 'update-notice-title', text: 'Update verfügbar' }),
          h('p', { class: 'modal-sub', text: `HeldixClient ${notice.version}${notice.date ? ` · ${formatDate(notice.date)}` : ''} – du hast ${notice.current}.` })),
        h('button', { class: 'icon-button', type: 'button', title: 'Schließen', 'aria-label': 'Schließen', onclick: close }, uiIcon('close'))),
      notes.length ? h('div', { class: 'news-body whatsnew' }, h('ul', {}, ...notes.map((note) => h('li', { text: note })))) : null,
      h('p', { class: 'hint', text: mac ? 'Auf dem Mac lädst du die neue Version über heldixclient.com.' : 'Der Launcher lädt die neue Version, installiert sie und startet neu.' }),
      h('div', { class: 'button-row' },
        h('button', { class: 'ghost', type: 'button', onclick: close }, 'Später'),
        h('button', { class: 'primary', type: 'button', id: 'update-notice-install', onclick: (event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          button.disabled = true;
          button.textContent = mac ? 'Wird geöffnet …' : 'Wird geladen …';
          void installUpdate().finally(() => {
            if (mac) close();
            else {
              button.disabled = false;
              button.textContent = 'Jetzt installieren';
            }
          });
        } }, mac ? 'Herunterladen' : 'Jetzt installieren'))));
  document.body.append(backdrop);
}

async function openWeb(button: HTMLButtonElement, target?: 'support'): Promise<void> {
  button.disabled = true;
  try {
    await api.openWebAccount(target);
    toast(target === 'support' ? 'Support ist im Browser geöffnet.' : 'heldixclient.com ist im Browser geöffnet.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
  } finally {
    button.disabled = false;
  }
}
$('#open-support').addEventListener('click', (event) => void openWeb(event.currentTarget as HTMLButtonElement, 'support'));
$('#open-versions').addEventListener('click', () => void api.openWebsite('neuigkeiten'));
// Einstellungen → Über HeldixClient: den Einrichtungs-Assistenten noch einmal zeigen
$('#setup-restart').addEventListener('click', () => void restartSetup());

/** "Was ist neu" einmal nach einem Update */
async function showWhatsNew(): Promise<void> {
  const info = await api.getWhatsNew().catch(() => null);
  if (!info) return;
  const body = h('div', { class: 'news-body whatsnew' });
  for (const entry of info.entries) {
    body.append(h('h4', { text: `Version ${entry.version}${entry.date ? ` · ${formatDate(entry.date)}` : ''}` }));
    body.append(h('ul', {}, ...entry.notes.map((note) => h('li', { text: note }))));
  }
  const close = () => {
    backdrop.remove();
    void api.markWhatsNewSeen();
  };
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (event: Event) => event.target === backdrop && close() },
    h('div', { class: 'modal wide news-modal' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('h3', { class: 'modal-title', text: `Neu in HeldixClient ${info.version}` }),
          h('p', { class: 'modal-sub', text: 'Der Launcher hat sich gerade aktualisiert.' })),
        h('button', { class: 'icon-button', title: 'Schließen', onclick: close }, uiIcon('close'))),
      body,
      h('div', { class: 'button-row' },
        h('button', { class: 'ghost', type: 'button', onclick: () => void api.openWebsite('neuigkeiten') }, 'Alle Versionen'),
        h('button', { class: 'primary', type: 'button', onclick: close }, 'Los geht\'s'))));
  document.body.append(backdrop);
}

$('#open-web-account').addEventListener('click', async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  try {
    await api.openWebAccount();
    toast('heldixclient.com ist im Browser geöffnet.', 'success');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
  } finally {
    button.disabled = false;
  }
});

$('#update-toggle').addEventListener('change', (e) => save({ autoUpdate: (e.target as HTMLInputElement).checked }));
$('#update-check').addEventListener('click', () => void api.checkForUpdate().then((u) => renderUpdate(u)));
$('#update-install').addEventListener('click', () => void installUpdate());
$('#update-card-install').addEventListener('click', () => void installUpdate());
api.onUpdateState((u) => renderUpdate(u));
api.onUpdateNotice(() => void showUpdateNotice());
void api.getUpdateState().then((u) => renderUpdate(u));

async function save(patch: Partial<Settings>): Promise<void> {
  state.settings = await api.saveSettings(patch);
  emit('settings');
}

memoryRange.addEventListener('input', updateMemoryLabel);
memoryRange.addEventListener('change', () => save({ memoryMb: Number(memoryRange.value) }));

function readResolution(): Settings['resolution'] {
  if (!$<HTMLInputElement>('#resolution-toggle').checked) return null;
  const width = Math.max(320, Number($<HTMLInputElement>('#res-width').value) || 1280);
  const height = Math.max(240, Number($<HTMLInputElement>('#res-height').value) || 720);
  return { width, height };
}
$('#resolution-toggle').addEventListener('change', async () => {
  await save({ resolution: readResolution() });
  $('#resolution-inputs').classList.toggle('disabled', state.settings?.resolution == null);
});
for (const id of ['#res-width', '#res-height']) $(id).addEventListener('change', () => save({ resolution: readResolution() }));

$('#hide-toggle').addEventListener('change', (e) => save({ hideLauncherOnLaunch: (e.target as HTMLInputElement).checked }));
$('#tray-toggle').addEventListener('change', (e) => save({ closeToTray: (e.target as HTMLInputElement).checked }));
$('#account-switch-toggle').addEventListener('change', (e) => save({ gameAccountSwitch: (e.target as HTMLInputElement).checked }));
$('#java-path').addEventListener('change', (e) => save({ javaPath: (e.target as HTMLInputElement).value.trim() }));
$('#jvm-args').addEventListener('change', (e) => save({ jvmArgs: (e.target as HTMLInputElement).value.trim() }));

document.querySelectorAll<HTMLButtonElement>('[data-folder]').forEach((button) => {
  button.addEventListener('click', () => api.openFolder('data'));
});

// ---------- Konsole ----------
const MAX_LOG_LINES = 5000;
const logEl = $('#log');
let logLines: LogLine[] = [];

const logFollow = $<HTMLInputElement>('#log-follow');
const logSearch = $<HTMLInputElement>('#log-search');
let logQuery = '';
let logFilter: 'all' | 'problems' | 'launcher' = 'all';

function isNearBottom(): boolean {
  return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
}
function scrollLogToEnd(): void {
  logEl.scrollTop = logEl.scrollHeight;
}

/** Zeile passt zu Filter und Suche? (für Kopieren und den Zähler) */
function logLineVisible(line: LogLine): boolean {
  if (logFilter === 'problems' && line.level !== 'WARN' && line.level !== 'ERROR' && line.level !== 'FATAL') return false;
  if (logFilter === 'launcher' && !line.text.startsWith('[Launcher]')) return false;
  return !logQuery || line.text.toLowerCase().includes(logQuery);
}

function renderLogLine(line: LogLine): HTMLElement {
  const el = h('div', { class: `log-line ${line.level}${line.text.startsWith('[Launcher]') ? ' launcher' : ''}` });
  fillLogLine(el, line.text);
  return el;
}

/** Text der Zeile, Suchtreffer markiert (nur Textknoten, nie HTML) */
function fillLogLine(el: HTMLElement, text: string): void {
  el.textContent = '';
  el.classList.toggle('search-miss', logQuery !== '' && !text.toLowerCase().includes(logQuery));
  if (!logQuery) {
    el.textContent = text;
    return;
  }
  const lower = text.toLowerCase();
  let at = 0;
  for (let hit = lower.indexOf(logQuery); hit >= 0; hit = lower.indexOf(logQuery, at)) {
    if (hit > at) el.append(text.slice(at, hit));
    el.append(h('mark', { text: text.slice(hit, hit + logQuery.length) }));
    at = hit + logQuery.length;
  }
  if (at < text.length) el.append(text.slice(at));
}

function updateLogCount(): void {
  const visible = logLines.filter(logLineVisible).length;
  $('#log-count').textContent = logLines.length === 0
    ? ''
    : visible === logLines.length
      ? `${formatCount(logLines.length)} Zeilen`
      : `${formatCount(visible)} von ${formatCount(logLines.length)} Zeilen`;
}

function refilterLog(): void {
  const rows = logEl.querySelectorAll<HTMLElement>('.log-line');
  rows.forEach((row, index) => {
    const line = logLines[index];
    if (line) fillLogLine(row, line.text);
  });
  updateLogCount();
  if (logFollow.checked) scrollLogToEnd();
}

api.onLog((lines) => {
  logEl.querySelector('.log-empty')?.remove();
  const fragment = document.createDocumentFragment();
  for (const line of lines) fragment.append(renderLogLine(line));
  logEl.append(fragment);
  logLines.push(...lines);
  const overflow = logLines.length - MAX_LOG_LINES;
  if (overflow > 0) {
    logLines = logLines.slice(overflow);
    for (let i = 0; i < overflow; i++) logEl.firstElementChild?.remove();
  }
  if (lines.some((l) => l.level === 'ERROR' || l.level === 'FATAL') && !$('#view-console').classList.contains('active')) {
    $('#console-dot').hidden = false;
  }
  updateLogCount();
  if (logFollow.checked) scrollLogToEnd();
});

// Mitlaufen: wer nach oben scrollt, hält die Ausgabe an; ganz unten läuft sie wieder mit
logEl.addEventListener('scroll', () => {
  const near = isNearBottom();
  if (logFollow.checked !== near && logLines.length > 0) logFollow.checked = near;
});
logFollow.addEventListener('change', () => {
  if (logFollow.checked) scrollLogToEnd();
});
let logSearchTimer = 0;
logSearch.addEventListener('input', () => {
  clearTimeout(logSearchTimer);
  logSearchTimer = window.setTimeout(() => {
    logQuery = logSearch.value.trim().toLowerCase();
    refilterLog();
  }, 150);
});
logSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && logSearch.value) {
    event.stopPropagation();
    logSearch.value = '';
    logQuery = '';
    refilterLog();
  }
});

document.querySelectorAll<HTMLButtonElement>('#log-filter button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('#log-filter button').forEach((b) => b.classList.toggle('active', b === button));
    logFilter = (button.dataset.filter as typeof logFilter) ?? 'all';
    logEl.classList.toggle('problems-only', logFilter === 'problems');
    logEl.classList.toggle('launcher-only', logFilter === 'launcher');
    updateLogCount();
    if (logFollow.checked) scrollLogToEnd();
  });
});
$('#copy-log').addEventListener('click', async () => {
  const visible = logLines.filter(logLineVisible);
  await navigator.clipboard.writeText(visible.map((l) => l.text).join('\n'));
  toast(visible.length === logLines.length ? 'Log in die Zwischenablage kopiert.' : `${formatCount(visible.length)} Zeilen kopiert.`, 'success');
});
$('#clear-log').addEventListener('click', () => {
  logLines = [];
  logEl.textContent = '';
  updateLogCount();
});
$('#crash-last').addEventListener('click', () => void showCrash());
$('#log-folder').addEventListener('click', () => {
  const instance = stageInstance();
  if (!instance) {
    toast('Noch keine Instanz – Logs gibt es nach dem ersten Start.');
    return;
  }
  void api.openFolder('logs', instance.id);
});
$('#kill-game').addEventListener('click', () => api.killGame());

// ---------- Start ----------
async function init(): Promise<void> {
  const started = performance.now();
  document.body.classList.add(`platform-${api.platform}`);
  [state.info, state.settings, state.game] = await Promise.all([api.appInfo(), api.getSettings(), api.getGameState()]);
  initInstances(showView);
  renderSettings();
  // Discord-Status erst jetzt richtig (vorher fehlte appInfo: „eingerichtet“ oder nicht)
  void api.getDiscordStatus().then(renderDiscordStatus).catch(() => undefined);
  await loadAccounts();
  await reloadInstances();
  void loadNews();
  // erster Start: Einrichtungs-Assistent; „Neu in …“ und die Einladung kommen dann erst danach (hooks.closed)
  if (!(await startSetupIfNeeded())) void showWhatsNew();
  void showUpdateNotice();
  renderUpdate();
  // echte Logos von Fabric und Minecraft (aus den Dateien im Datenordner); danach Kacheln neu zeichnen
  void api.loaderLogos().then((logos) => {
    state.logos = logos;
    applyLoaderLogos();
    emit('instances');
  }).catch(() => undefined);
  try {
    state.versions = await api.listVersions();
    if (state.versions.offline) toast('Offline: Die Versionsliste kommt aus dem Cache.');
  } catch (error) {
    toast(`Versionsliste nicht verfügbar: ${errorMessage(error)}`, 'error');
  }
  // Splash mindestens kurz zeigen, damit er nicht nur aufblitzt
  const wait = Math.max(0, 900 - (performance.now() - started));
  window.setTimeout(() => $('#splash').classList.add('hide'), wait);
}

init().catch((error) => {
  $('#splash').classList.add('hide');
  toast(errorMessage(error), 'error');
});
