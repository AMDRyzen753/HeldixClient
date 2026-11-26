import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell } from 'electron';
import type {
  AccountInfo,
  AppInfo,
  CrashAnalysis,
  CrashReportPreview,
  ContentKind,
  FolderKind,
  GameState,
  HeldixCape,
  InstanceInfo,
  InstancePatch,
  LogLine,
  NewInstance,
  ProgressEvent,
  Settings,
  VersionListResult,
} from '../shared/api';
import { interactiveMicrosoftLogin } from './auth-window';
import {
  CLIENT_MOD_PREFIX,
  CLIENT_NAME,
  DATA_DIR_NAME,
  DISCORD_CLIENT_ID,
  HELDIX_SERVICE_URL,
  WEBSITE_URL,
  LAUNCHER_NAME,
  LAUNCHER_VERSION,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_REDIRECT_URI,
} from './config';
import { loginMinecraft, offlineUuid, refreshMicrosoft, sessionFromAccessToken } from './core/auth';
import { addContentFiles, countEnabled, importContentFiles, listAllContent, listContent, removeContent, setContentEnabled, type ContentContext } from './core/content';
import { applyPendingRemovals, installStoreAddon, storeForInstance, uninstallStoreAddon, type OverviewInstance } from './core/addonstore';
import { AddonStoreService, noticeList, type StoreNotice } from './core/storeservice';
import { DiscordRpc } from './core/discord';
import { getFabricGameVersions } from './core/fabric';
import { ADDON_DIR, InstanceStore, usesHeldixClient, type InstanceConfig } from './core/instances';
import { buildLaunchArguments, startGame, type GameAccount, type RunningGame } from './core/launch';
import { installModrinth, installPerformancePack, modrinthUpdates, searchModrinth, updateModrinthMod } from './core/modrinth';
import { findClientMods, findFabricLoaderJar, findLoaderJar } from './core/mods';
import { getVersionManifest, listInstalledVersions } from './core/mojang';
import { createPaths, defaultDataRoot } from './core/paths';
import { GraphicsWatch, graphicsArguments, tunedJvmArguments } from './core/performance';
import { prepareGame } from './core/prepare';
import { SHADERPACK_DIR, addShaderpackFiles, installShaderpack, listShaderpacks, removeShaderpack, searchShaderpacks, setActiveShaderpack } from './core/shaderpacks';
import { buildActivity, parseStatusLine, type GameStatus } from './core/presence';
import { listQuickPlay, validateQuickPlay } from './core/quickplay';
import { serverStatus } from './core/serverstatus';
import { loaderLogos } from './core/loaderlogos';
import { removeOfficialProfile } from './core/officialcleanup';
import { analyzeCrash, anonymize, collectCrashFiles, tail, type CrashFiles } from './core/crash';
import { listHeldixNews, listNews, newsBody } from './core/news';
import { webLoginUrl } from './core/weblogin';
import { isLoopback } from './core/heldixservice';
import { MOJANG_API, MojangApi, ProfileService, loadHeldixCapes } from './core/profile';
import { CosmeticCatalog } from './core/cosmeticcatalog';
import { SocialClient, joinableServer, pickJoinInstance, type SocialNotice } from './core/social';
import { allowTestTextureOrigin, skinFor } from './core/skins';
import { Updater, compareVersions } from './core/updater';
import { UPDATE_PUBLIC_KEY } from './update-public-key';
import { Store, type StoredAccount } from './store';

const paths = createPaths(process.env.HELDIX_DATA_DIR ?? defaultDataRoot(DATA_DIR_NAME));
const store = new Store(paths.root, { offline: !app.isPackaged });
const instances = new InstanceStore(paths);
const isDev = !app.isPackaged;
// Tests mit eigenem Datenordner: auch das Electron-Profil (Cache, Speicher der Oberfläche) dorthin, damit ein Testlauf
// nie das Profil des installierten Launchers (%APPDATA%\HeldixClient) mitbenutzt, auch wenn der gerade läuft
if (isDev && process.env.HELDIX_DATA_DIR) app.setPath('userData', path.join(process.env.HELDIX_DATA_DIR, 'electron-profil'));

/**
 * Nur für automatische Tests im Entwicklungsmodus: HELDIX_MOJANG_TEST_URL=<Loopback-Adresse> leitet alle Aufrufe an
 * Mojang (Profil, Skins, Capes, Texturen, session/minecraft/join) an einen Fake-Server um. Die fertige App ignoriert das.
 */
const MOJANG_TEST_URL = isDev && process.env.HELDIX_MOJANG_TEST_URL && isLoopback(process.env.HELDIX_MOJANG_TEST_URL)
  ? process.env.HELDIX_MOJANG_TEST_URL.replace(/\/+$/, '')
  : null;
if (MOJANG_TEST_URL) allowTestTextureOrigin(MOJANG_TEST_URL);
/**
 * Nur für Tests im Entwicklungsmodus gegen einen lokalen Dienst (HELDIX_SERVICE_URL auf Loopback):
 * HELDIX_STORE_TEST_KEY=<PEM-Datei> prüft die Addon-Manifeste mit diesem Test-Schlüssel statt mit dem Update-Schlüssel.
 */
const STORE_PUBLIC_KEY = isDev && process.env.HELDIX_STORE_TEST_KEY && isLoopback(HELDIX_SERVICE_URL)
  ? readFileSync(process.env.HELDIX_STORE_TEST_KEY, 'utf8')
  : UPDATE_PUBLIC_KEY;
/** Offline-Konten beim Heldix-Dienst über POST /v1/auth/dev (nur Tests gegen einen lokalen Dienst) */
const SERVICE_DEV_AUTH = process.env.HELDIX_WEB_LOGIN_DEV === '1';

let mainWindow: BrowserWindow | null = null;
let game: RunningGame | null = null;
let gameInstanceId: string | null = null;
let gameState: GameState = { state: 'idle' };
/** welche Grafik-API das laufende Spiel wirklich benutzt */
let graphicsWatch: GraphicsWatch | null = null;

function resourceDir(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, name) : path.join(app.getAppPath(), 'resources', name);
}
const clientModsDir = () => resourceDir('client-mods');
const loaderDir = () => resourceDir('heldix-loader');
const fabricLoaderDir = () => resourceDir('heldix-loader-fabric');

const LOADER_LABELS = { heldix: 'Heldix Loader', fabric: 'Fabric', vanilla: 'Vanilla' } as const;

// ---------- Ereignisse an die Oberfläche ----------

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/** An alle Fenster mit der Oberfläche des Launchers (nicht an das Fenster der Microsoft-Anmeldung) */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && window.webContents.getURL().startsWith('file:')) window.webContents.send(channel, payload);
  }
}

function setGameState(state: GameState): void {
  gameState = state;
  send('game:state', state);
}

/**
 * "Was ist neu": nach einem Update die Hinweise aller Versionen seit der zuletzt gesehenen (GET /v1/launcher/versions).
 * Bei der ersten Installation nichts zeigen, nur merken.
 */
async function whatsNew(): Promise<import('../shared/api').WhatsNew | null> {
  const current = app.getVersion();
  const settings = await store.getSettings();
  const last = settings.lastSeenVersion;
  if (!last) {
    await store.saveSettings({ lastSeenVersion: current });
    return null;
  }
  try {
    if (compareVersions(current, last) <= 0) return null;
  } catch {
    return null;
  }
  try {
    const response = await fetch(`${HELDIX_SERVICE_URL.replace(/\/+$/, '')}/v1/launcher/versions?limit=20`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { versions?: { version?: unknown; date?: unknown; notes?: unknown }[] };
    const entries = (data.versions ?? [])
      .filter((v): v is { version: string; date: unknown; notes: unknown } => typeof v.version === 'string')
      .filter((v) => {
        try {
          return compareVersions(v.version, last) > 0 && compareVersions(v.version, current) <= 0;
        } catch {
          return false;
        }
      })
      .map((v) => ({
        version: v.version,
        date: typeof v.date === 'string' ? v.date : '',
        notes: Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === 'string').slice(0, 30) : [],
      }));
    if (entries.length === 0 || entries.every((e) => e.notes.length === 0)) {
      await store.saveSettings({ lastSeenVersion: current });
      return null;
    }
    return { version: current, entries };
  } catch {
    // Dienst nicht erreichbar: beim nächsten Start noch einmal
    return null;
  }
}

function gameRunning(): boolean {
  return gameState.state === 'preparing' || gameState.state === 'running';
}

// ---------- Automatische Updates (über die Schnittstelle des Heldix-Dienstes) ----------

// In der Entwicklung nur mit HELDIX_UPDATE_URL (zum Testen); die fertige App fragt den Heldix-Dienst.
const updater = new Updater({
  baseUrl: process.env.HELDIX_UPDATE_URL ?? (app.isPackaged ? HELDIX_SERVICE_URL : ''),
  currentVersion: app.getVersion(),
  dir: path.join(paths.root, 'updates'),
  publicKey: UPDATE_PUBLIC_KEY,
  log: (line) => console.log(line),
  // Der Installer im Update ist für Windows; auf dem Mac nur melden, laden geht über die Webseite
  downloadInstaller: process.platform === 'win32',
});
updater.onState = (state) => send('update:state', state);
/** Einstellung "Updates automatisch" (für den Zeitgeber und das Installieren beim Beenden) */
let autoUpdate = true;
let quittingForUpdate = false;

// ---------- Discord-Status (Rich Presence) ----------

const discord = new DiscordRpc(DISCORD_CLIENT_ID, (message) => console.log(`[Discord] ${message}`));
discord.onStatus = (status) => send('discord:status', status);

interface PresenceState {
  phase: 'launcher' | 'preparing' | 'running';
  instance?: InstanceConfig;
  startedAt?: number;
  /** Was die HeldixClient-Mod meldet (Hauptmenü, Einzelspieler, Server …) */
  status: GameStatus | null;
}
let presence: PresenceState = { phase: 'launcher', status: null };
let presenceSettings = { enabled: false, showServer: true };

function updatePresence(next?: PresenceState): void {
  if (next) presence = next;
  if (!presenceSettings.enabled) {
    discord.stop();
    return;
  }
  discord.start();
  discord.setActivity(buildActivity({
    phase: presence.phase,
    minecraft: presence.instance?.minecraft,
    loader: presence.instance?.loader,
    startedAt: presence.startedAt,
    status: presence.status,
    showServer: presenceSettings.showServer,
    clientVersion: LAUNCHER_VERSION,
  }));
}

function applyPresenceSettings(settings: Settings): void {
  presenceSettings = { enabled: settings.discordPresence, showServer: settings.discordShowServer };
  updatePresence();
}

/** Statuszeilen der Mod aus dem Log fischen (sie erscheinen nicht in der Konsole). */
/** letzte Zeilen der Spielausgabe (für die Absturz-Hilfe) */
let gameLines: string[] = [];
/** Spieler hat „Spiel beenden“ gedrückt: kein Absturz */
let killedByUser = false;

interface CrashRecord {
  analysis: CrashAnalysis;
  files: CrashFiles;
  minecraft: string;
  loader: string;
  modCount: number;
  memoryMb: number;
  graphicsApi: string;
}
let lastCrash: CrashRecord | null = null;

function handleGameLog(lines: LogLine[]): void {
  const visible: LogLine[] = [];
  if (gameLines.length > 4000) gameLines = gameLines.slice(-3000);
  for (const line of lines) {
    gameLines.push(line.text);
    if (graphicsWatch && !graphicsWatch.backend) {
      graphicsWatch.push(line.text);
      if (graphicsWatch.backend) {
        launcherLog(`Grafik-API: ${graphicsWatch.backend}`);
        if (graphicsWatch.fellBack) launcherLog('Vulkan wird auf diesem PC nicht unterstützt – Minecraft nutzt stattdessen OpenGL.', 'WARN');
      }
    }
    const status = parseStatusLine(line.text);
    if (status) updatePresence({ ...presence, status });
    else visible.push(line);
  }
  if (visible.length) sendLog(visible);
}

let progressTimer: NodeJS.Timeout | null = null;
let pendingProgress: ProgressEvent | null = null;
function sendProgress(event: ProgressEvent): void {
  pendingProgress = event;
  if (event.done === event.total) {
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = null;
    send('progress', event);
    return;
  }
  progressTimer ??= setTimeout(() => {
    progressTimer = null;
    if (pendingProgress) send('progress', pendingProgress);
  }, 80);
}

let logBuffer: LogLine[] = [];
let logTimer: NodeJS.Timeout | null = null;
function sendLog(lines: LogLine[]): void {
  logBuffer.push(...lines);
  logTimer ??= setTimeout(() => {
    logTimer = null;
    send('log', logBuffer);
    logBuffer = [];
  }, 100);
}
const launcherLog = (text: string, level: LogLine['level'] = 'INFO') => sendLog([{ level, text: `[Launcher] ${text}` }]);

// ---------- Konten ----------

const OFFLINE_LOCKED = 'Offline-Konten gibt es nur in der Entwicklungsversion von HeldixClient.';

/**
 * Offline-Konten nur beim Entwickeln (npm start). Die fertige App kennt sie nicht: gespielt wird mit dem
 * Microsoft-Konto, mit dem Minecraft gekauft wurde (die Store-Klasse blendet alte Offline-Konten dort aus).
 */
function offlineAllowed(): boolean {
  return isDev;
}

/** Laufende Erneuerungen je Konto (Spielstart, Freunde und Skins teilen sich eine) */
const sessionRefreshes = new Map<string, Promise<GameAccount>>();

/**
 * Gültige Sitzung für ein Konto, bei Bedarf erneuert. interactive = false (Freunde, Skins & Capes im Hintergrund):
 * nie den Minecraft Launcher öffnen – über ihn angemeldete Konten melden dann nur, dass die Anmeldung abgelaufen ist.
 */
async function sessionFor(account: StoredAccount, interactive = true): Promise<GameAccount> {
  if (account.type === 'offline') {
    if (!offlineAllowed()) throw new Error(OFFLINE_LOCKED);
    return { name: account.name, uuid: account.uuid, accessToken: '0', userType: 'legacy' };
  }
  const secrets = store.secrets(account);
  if (secrets.accessToken && (account.expiresAt ?? 0) > Date.now() + 10 * 60 * 1000) {
    return { name: account.name, uuid: account.uuid, accessToken: secrets.accessToken, xuid: account.xuid, userType: 'msa' };
  }
  if (!secrets.refreshToken) {
    // früher über den offiziellen Minecraft Launcher angemeldet (ohne Refresh-Token) – diesen Weg gibt es nicht mehr
    throw new Error(`Die Anmeldung von ${account.name} ist abgelaufen. Bitte unten links mit Microsoft neu anmelden.`);
  }
  if (!MICROSOFT_CLIENT_ID) throw new Error('Microsoft-Client-ID fehlt (siehe README).');
  let refresh = sessionRefreshes.get(account.id);
  if (!refresh) {
    refresh = (async (): Promise<GameAccount> => {
      launcherLog('Erneuere Microsoft-Anmeldung …');
      const ms = await refreshMicrosoft(MICROSOFT_CLIENT_ID, secrets.refreshToken);
      const session = await loginMinecraft(ms);
      // das Konto bleibt dabei, wie es ist (nicht aktiv machen: im Hintergrund könnte inzwischen ein anderes gewählt sein)
      await store.upsertMicrosoft(session, false);
      return { name: session.name, uuid: session.uuid, accessToken: session.accessToken, xuid: session.xuid, userType: 'msa' };
    })().finally(() => sessionRefreshes.delete(account.id));
    sessionRefreshes.set(account.id, refresh);
  }
  return refresh;
}

function toAccountInfo(account: StoredAccount): AccountInfo {
  return { id: account.id, type: account.type, name: account.name, uuid: account.uuid, skinUrl: account.skinUrl, via: account.source, active: true };
}

function focusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Frühere Installation „HeldixClient“ im offiziellen Minecraft Launcher entfernen (Brücke gibt es nicht mehr) */
async function cleanupOfficialLauncher(): Promise<void> {
  if (process.env.HELDIX_DATA_DIR) return; // Tests mit eigenem Datenordner fassen den echten Minecraft Launcher nicht an
  try {
    if (await removeOfficialProfile()) launcherLog('Minecraft Launcher: alte Installation „HeldixClient“ entfernt (die Anmeldung läuft jetzt direkt über Microsoft).');
  } catch (error) {
    console.warn('[Launcher] Minecraft Launcher nicht aufgeräumt:', error);
  }
  await rm(path.join(paths.root, 'bridge.json'), { force: true }).catch(() => undefined);
}

// ---------- Freunde & Nachrichten (Heldix-Dienst, siehe core/social.ts) ----------

function anyWindowVisible(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isVisible() && !w.isMinimized());
}

const social = new SocialClient<StoredAccount>({
  serviceUrl: HELDIX_SERVICE_URL,
  devAuth: SERVICE_DEV_AUTH,
  sessionServer: MOJANG_TEST_URL ?? undefined,
  enabled: async () => (await store.getSettings()).social,
  account: () => store.getActiveAccount(),
  accessToken: async (account) => (await sessionFor(account, false)).accessToken,
  visible: anyWindowVisible,
  onUpdate: (overview) => broadcast('social:update', overview),
  wantNotices: async () => (await store.getSettings()).socialNotifications && BrowserWindow.getFocusedWindow() === null,
  onNotice: showSocialNotice,
  skinCacheDir: path.join(paths.cache, 'player-skins'),
  log: (line) => console.log(`[Launcher] ${line}`),
});

/** Konto gewechselt, hinzugefügt oder entfernt: Freunde sofort neu laden */
function accountsChanged(): void {
  social.refresh().catch(() => undefined);
}

/** Benachrichtigungen bis zum Klick festhalten (sonst räumt der Garbage Collector sie samt Klick-Handler weg) */
const notifications = new Set<Notification>();

function showSocialNotice(notice: SocialNotice): void {
  if (!Notification.isSupported()) return;
  const notification =
    notice.kind === 'request'
      ? new Notification({ title: `${notice.name} möchte mit dir befreundet sein`, body: 'Unter Freunde annehmen oder ablehnen.' })
      : new Notification({ title: `Neue Nachricht von ${notice.name}`, body: notice.text ?? '' });
  notifications.add(notification);
  notification.on('click', () => {
    notifications.delete(notification);
    openSocial(notice.kind === 'message' ? notice.uuid : null);
  });
  notification.on('close', () => notifications.delete(notification));
  notification.show();
}

/** Klick auf eine Benachrichtigung: Fenster nach vorn, Freunde öffnen (mit der Unterhaltung) */
function openSocial(uuid: string | null): void {
  sendWhenReady('social:open', uuid);
}

/** Läuft das Spiel (oder wird es gerade vorbereitet) in dieser Instanz? */
function instanceBusy(id: string): boolean {
  return gameInstanceId === id || (gameState.state === 'preparing' && gameState.instanceId === id);
}

/** Einem Freund auf seinen Server folgen: HeldixClient-Instanz mit Quick Play auf die Serveradresse starten. */
async function joinFriend(rawUuid: unknown, rawInstanceId?: unknown): Promise<void> {
  const friend = await social.friend(rawUuid);
  if (!friend) throw new Error('Dieser Spieler ist nicht in deiner Freundesliste.');
  const server = joinableServer(friend);
  if (!server) throw new Error(`${friend.name} spielt gerade auf keinem Server, dem du folgen kannst.`);
  if (gameRunning()) throw new Error('Es läuft schon ein Spiel – im Spiel über Freunde → Beitreten.');
  const wanted = typeof rawInstanceId === 'string' && rawInstanceId ? await instances.require(rawInstanceId) : await selectedInstance().catch(() => null);
  const instance = pickJoinInstance(await instances.list(), wanted, usesHeldixClient);
  if (!instance) throw new Error('Zum Beitreten brauchst du eine Instanz mit HeldixClient.');
  launcherLog(`${friend.name} beitreten: ${server}`);
  await launch(instance.id, { kind: 'server', id: server });
}

// ---------- Addon-Store (siehe core/storeservice.ts) ----------

async function heldixInstances(): Promise<OverviewInstance[]> {
  return (await instances.list())
    .filter((i) => usesHeldixClient(i))
    .map((i) => ({ id: i.id, name: i.name, minecraft: i.minecraft, loader: i.loader, dir: instances.dir(i.id) }));
}

const addonStore = new AddonStoreService({
  serviceUrl: HELDIX_SERVICE_URL,
  publicKey: STORE_PUBLIC_KEY,
  instances: heldixInstances,
  busy: instanceBusy,
  gameRunning,
  auth: HELDIX_SERVICE_URL ? social : null,
  settings: () => store.getSettings(),
  stateFile: path.join(paths.root, 'addon-updates.json'),
  screenshotDir: path.join(paths.cache, 'addon-screenshots'),
  onCount: (count) => broadcast('store:changed', count),
  onNotice: showStoreNotice,
  log: (line) => launcherLog(line),
});

/** Zähler fürs Abzeichen nach Installieren oder Entfernen neu berechnen (ohne Netz) */
function storeChanged(): void {
  addonStore.recount().catch(() => undefined);
}

function showStoreNotice(notice: StoreNotice): void {
  if (!Notification.isSupported() || notice.items.length === 0) return;
  const notification =
    notice.kind === 'available'
      ? new Notification({ title: notice.items.length === 1 ? 'Addon-Update verfügbar' : 'Addon-Updates verfügbar', body: `${noticeList(notice.items)} – im Addon-Store aktualisieren.` })
      : new Notification({ title: notice.items.length === 1 ? 'Addon aktualisiert' : 'Addons aktualisiert', body: noticeList(notice.items) });
  notifications.add(notification);
  notification.on('click', () => {
    notifications.delete(notification);
    sendWhenReady('store:open', null);
  });
  notification.on('close', () => notifications.delete(notification));
  notification.show();
}

/** Fenster nach vorn und dann eine Nachricht an die Oberfläche (auch wenn das Fenster erst entsteht) */
function sendWhenReady(channel: string, payload: unknown): void {
  const existed = mainWindow !== null && !mainWindow.isDestroyed();
  focusWindow();
  const window = mainWindow;
  if (!window) return;
  if (!existed || window.webContents.isLoading()) window.webContents.once('did-finish-load', () => window.webContents.send(channel, payload));
  else window.webContents.send(channel, payload);
}

// ---------- Skins & Capes (siehe core/profile.ts) ----------

/** Katalog der Heldix-Capes: capes.json aus der Client-Mod, liegt neben der Oberfläche (scripts/copy-static.mjs) */
let heldixCapes: Promise<HeldixCape[]> | null = null;
function loadCapes(): Promise<HeldixCape[]> {
  heldixCapes ??= loadHeldixCapes(path.join(__dirname, '..', 'renderer', 'capes', 'capes.json')).then((list) => {
    if (list.length === 0) heldixCapes = null;
    return list;
  });
  return heldixCapes;
}

const profiles = new ProfileService<StoredAccount>({
  paths,
  libraryDir: path.join(paths.root, 'skins'),
  mojang: new MojangApi(MOJANG_TEST_URL ?? MOJANG_API),
  account: () => store.getActiveAccount(),
  accessToken: async (account) => (await sessionFor(account, false)).accessToken,
  heldix: HELDIX_SERVICE_URL
    ? { getMe: () => social.getMe(), setCape: (cape) => social.updateMe({ cape }) }
    : null,
  heldixForOffline: SERVICE_DEV_AUTH,
  capes: loadCapes,
  fallbackSkin: (account) => skinFor(paths, account),
  onSkinChanged: async (account, url) => {
    // Figur auf der Startseite: getSkin() lädt den neuen Skin über die neue Adresse
    await store.setSkinUrl(account.id, url);
    broadcast('accounts:changed', null);
  },
});

async function importSkins(files?: unknown): Promise<import('../shared/api').SavedSkin[]> {
  let sources = Array.isArray(files) ? files : [];
  if (sources.length === 0) {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Skins hinzufügen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft-Skins', extensions: ['png'] }],
    });
    if (result.canceled) return [];
    sources = result.filePaths;
  }
  return profiles.importSkins(sources);
}

// ---------- Cosmetics (siehe core/cosmeticcatalog.ts) ----------

const cosmetics = new CosmeticCatalog({
  serviceUrl: HELDIX_SERVICE_URL,
  // derselbe Schlüssel wie beim Addon-Store (Update-Schlüssel; nur in Tests gegen einen lokalen Dienst ein Test-Schlüssel)
  publicKey: STORE_PUBLIC_KEY,
  cacheDir: path.join(paths.cache, 'cosmetics'),
  auth: HELDIX_SERVICE_URL ? social : null,
  builtinCapes: async () => (await loadCapes()).map((c) => c.id),
  log: (line) => launcherLog(line),
});

async function setCosmetic(slot: unknown, id: unknown): Promise<import('../shared/api').CosmeticsState> {
  const state = await cosmetics.choose(slot, id);
  broadcast('cosmetics:changed', null);
  return state;
}

// ---------- Instanzen ----------

async function toInstanceInfo(config: InstanceConfig): Promise<InstanceInfo> {
  const dir = instances.dir(config.id);
  const [modCount, addonCount] = await Promise.all([countEnabled(dir, 'mods'), countEnabled(dir, 'addons')]);
  return { ...config, heldixClient: usesHeldixClient(config), modCount, addonCount, path: dir };
}

/** Beim Start: alte Spielordner übernehmen, Standard-Instanz anlegen, Auswahl prüfen. */
async function ensureInstances(): Promise<void> {
  const migrated = await instances.migrateLegacy();
  if (migrated > 0) console.log(`[Launcher] ${migrated} bestehende Spielordner als Instanzen übernommen`);

  let list = await instances.list();
  if (list.length === 0) {
    const mods = await findClientMods(clientModsDir(), CLIENT_MOD_PREFIX);
    const newest = mods.map((m) => m.minecraft).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
    let data: NewInstance | null = newest ? { name: `HeldixClient ${newest}`, minecraft: newest, loader: 'heldix', color: '#8b5cf6' } : null;
    if (!data) {
      const release = await getVersionManifest(paths).then((r) => r.manifest.latest.release).catch(() => null);
      if (release) data = { name: `Minecraft ${release}`, minecraft: release, loader: 'vanilla', color: '#10b981' };
    }
    if (data) await instances.create(data);
    list = await instances.list();
  }

  const settings = await store.getSettings();
  if (!list.some((i) => i.id === settings.selectedInstanceId) && list[0]) {
    await store.saveSettings({ selectedInstanceId: list[0].id });
  }
}

async function selectedInstance(id?: string): Promise<InstanceConfig> {
  const targetId = id ?? (await store.getSettings()).selectedInstanceId;
  if (!targetId) throw new Error('Bitte zuerst eine Instanz anlegen.');
  return instances.require(targetId);
}

// ---------- Spielstart ----------

async function launch(instanceId?: string, target?: { kind?: unknown; id?: unknown }): Promise<void> {
  if (gameState.state === 'preparing' || gameState.state === 'running') throw new Error('Das Spiel läuft bereits.');
  const settings = await store.getSettings();
  const account = await store.getActiveAccount();
  if (!account) throw new Error('Bitte zuerst ein Konto hinzufügen.');
  const instance = await selectedInstance(instanceId);
  const quickPlay = target ? await validateQuickPlay(instances.dir(instance.id), target.kind, target.id) : undefined;

  setGameState({ state: 'preparing', instanceId: instance.id });
  updatePresence({ phase: 'preparing', instance, status: null });
  try {
    if (instance.loader === 'fabric' && !(await getFabricGameVersions(paths)).has(instance.minecraft)) {
      throw new Error(`Fabric unterstützt Minecraft ${instance.minecraft} nicht. Lege für diese Version eine Vanilla-Instanz an.`);
    }
    const session = await sessionFor(account);
    launcherLog(`Instanz "${instance.name}" (Minecraft ${instance.minecraft}, ${LOADER_LABELS[instance.loader]})`);
    const prepared = await prepareGame({
      paths,
      versionId: instance.minecraft,
      loader: instance.loader,
      gameDir: instances.dir(instance.id),
      clientModsDir: clientModsDir(),
      clientModPrefix: CLIENT_MOD_PREFIX,
      loaderDir: loaderDir(),
      fabricLoaderDir: fabricLoaderDir(),
      heldixClient: usesHeldixClient(instance),
      javaOverride: settings.javaPath,
      onProgress: sendProgress,
      onInfo: (message) => launcherLog(message),
    });

    const userJvmArgs = settings.jvmArgs.split(/\s+/).filter(Boolean);
    const tuning = settings.jvmTuning ? tunedJvmArguments(prepared.javaMajor, userJvmArgs) : [];
    // Vulkan-Vorgabe nur für Heldix-Instanzen; Fabric und Vanilla nutzen die Einstellung im Spiel (Fabric-Mods brauchen oft OpenGL)
    const graphics = instance.loader === 'heldix' ? graphicsArguments(settings.graphicsApi, prepared.clientJar) : [];
    const args = buildLaunchArguments({
      paths,
      version: prepared.version,
      javaPath: prepared.javaPath,
      classpath: prepared.classpath,
      gameDir: prepared.gameDir,
      nativesDir: prepared.nativesDir,
      legacyAssetsDir: prepared.legacyAssetsDir,
      loggingConfig: prepared.loggingConfig,
      account: session,
      memoryMb: instance.memoryMb ?? settings.memoryMb,
      resolution: settings.resolution,
      // Heldix-Dienst (Freunde, Capes für alle): Adresse für die Client-Mod
      extraJvmArgs: [...prepared.loaderJvmArgs, ...(HELDIX_SERVICE_URL && usesHeldixClient(instance) ? [`-Dheldixclient.service=${HELDIX_SERVICE_URL}`] : []), ...tuning, ...userJvmArgs],
      extraGameArgs: graphics,
      quickPlay,
      launcherName: LAUNCHER_NAME.replace(/\s+/g, ''),
      launcherVersion: LAUNCHER_VERSION,
    });

    launcherLog(`Starte ${prepared.version.id} als ${session.name}${prepared.clientModLoaded ? ` mit ${CLIENT_NAME} (Heldix Loader ${prepared.loaderVersion})` : ''}`);
    launcherLog(`Java: ${prepared.javaPath}`);
    if (graphics.length) launcherLog(`Grafik-API angefordert: ${settings.graphicsApi === 'vulkan' ? 'Vulkan' : 'OpenGL'}`);
    if (tuning.length) launcherLog(`Optimierte JVM-Einstellungen: ${tuning.filter((a) => a !== '-XX:+UnlockExperimentalVMOptions').join(' ')}`);
    graphicsWatch = new GraphicsWatch(graphics.length ? settings.graphicsApi : 'default');
    if (quickPlay?.singleplayer) launcherLog(`Direktstart in die Welt „${quickPlay.singleplayer}“`);
    if (quickPlay?.multiplayer) launcherLog(`Direktstart auf den Server ${quickPlay.multiplayer}`);
    gameLines = [];
    killedByUser = false;
    const launchedAt = Date.now();
    const running = startGame(prepared.javaPath, args, prepared.gameDir, handleGameLog);
    await new Promise<void>((resolve, reject) => {
      running.process.once('spawn', () => resolve());
      running.process.once('error', reject);
    });
    game = running;
    gameInstanceId = instance.id;
    const startedAt = Date.now();
    await instances.save({ ...instance, lastPlayed: startedAt });
    setGameState({ state: 'running', pid: running.process.pid ?? 0, instanceId: instance.id, label: instance.name });
    updatePresence({ ...presence, phase: 'running', startedAt });
    if (settings.hideLauncherOnLaunch) mainWindow?.hide();

    running.exited
      .then(async (code) => {
        launcherLog(`Spiel beendet (Code ${code ?? '?'})`, code === 0 ? 'INFO' : 'ERROR');
        const current = await instances.get(instance.id);
        if (current) await instances.save({ ...current, playTimeMs: current.playTimeMs + (Date.now() - startedAt) });
        let notice: string | undefined;
        if (graphicsWatch?.crashedDuringGraphicsStart(code)) {
          // Vulkan-Treiber stürzt ab, bevor Minecraft auf OpenGL ausweichen kann: beim nächsten Mal Minecraft entscheiden lassen
          await store.saveSettings({ graphicsApi: 'default' });
          notice = 'Minecraft ist beim Start mit Vulkan abgestürzt. Die Grafik-API steht jetzt auf „Automatisch“ – in den Einstellungen kannst du Vulkan wieder einschalten.';
          launcherLog(notice, 'ERROR');
        }
        // Absturz-Hilfe: Crash-Report, JVM-Fehler oder Fehlercode → Ursache suchen (nicht nach „Spiel beenden“)
        let crash: { id: string; title: string } | undefined;
        if (!killedByUser) {
          try {
            const files = await collectCrashFiles({ gameDir: prepared.gameDir, startedAt: launchedAt, logLines: gameLines });
            if ((code !== 0 && code !== null) || files.crashReportPath || files.jvmErrorPath) {
              const mods = instance.loader === 'vanilla' ? [] : (await listContent(prepared.gameDir, 'mods', instance.loader))
                .filter((item) => item.enabled && !item.managed)
                .map((item) => ({ file: item.file, id: item.id, name: item.name }));
              const memoryMb = instance.memoryMb ?? settings.memoryMb;
              const { analysis } = await analyzeCrash({
                instanceId: instance.id,
                instanceName: instance.name,
                gameDir: prepared.gameDir,
                startedAt: launchedAt,
                exitCode: code,
                logLines: gameLines,
                mods,
                memoryMb,
                graphicsApi: graphics.length ? settings.graphicsApi : 'default',
                customJava: settings.javaPath.trim() !== '',
              }, files);
              lastCrash = { analysis, files, minecraft: instance.minecraft, loader: LOADER_LABELS[instance.loader], modCount: mods.length, memoryMb, graphicsApi: settings.graphicsApi };
              launcherLog(`Absturz-Hilfe: ${analysis.title}${analysis.suspects.length ? ` (verdächtig: ${analysis.suspects.map((m) => m.name).join(', ')})` : ''}`, 'WARN');
              if (!notice) crash = { id: analysis.id, title: analysis.title };
            }
          } catch (error) {
            console.warn('[Launcher] Absturz-Analyse fehlgeschlagen:', error);
          }
        }
        setGameState({ state: 'exited', code, notice, crash });
      })
      .catch((error: Error) => setGameState({ state: 'error', message: error.message }))
      .finally(() => {
        game = null;
        gameInstanceId = null;
        graphicsWatch = null;
        updatePresence({ phase: 'launcher', status: null });
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
        // Addon-Updates, die während des Spiels warten mussten, jetzt automatisch installieren
        void store.getSettings().then((s) => (s.addonAutoUpdate ? addonStore.check() : undefined)).catch(() => undefined);
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    launcherLog(message, 'ERROR');
    setGameState({ state: 'error', message });
    updatePresence({ phase: 'launcher', status: null });
    throw error;
  }
}

async function listVersions(): Promise<VersionListResult> {
  const [fabric, clientMods] = await Promise.all([getFabricGameVersions(paths), findClientMods(clientModsDir(), CLIENT_MOD_PREFIX)]);
  const withMod = new Set(clientMods.map((m) => m.minecraft));
  try {
    const { manifest, offline } = await getVersionManifest(paths);
    return {
      versions: manifest.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime, fabric: fabric.has(v.id), clientMod: withMod.has(v.id) })),
      latestRelease: manifest.latest.release,
      offline,
    };
  } catch {
    const installed = (await listInstalledVersions(paths)).filter((id) => !id.startsWith('fabric-loader-'));
    return {
      versions: installed.map((id) => ({ id, type: 'release', releaseTime: '', fabric: fabric.has(id), clientMod: withMod.has(id) })),
      latestRelease: installed[0] ?? '',
      offline: true,
    };
  }
}

async function openFolder(kind: FolderKind, instanceId?: string): Promise<void> {
  let target = paths.root;
  if (kind !== 'data') {
    const dir = instances.dir((await selectedInstance(instanceId)).id);
    const sub = { instance: '', mods: 'mods', addons: ADDON_DIR, logs: 'logs', saves: 'saves', shaderpacks: SHADERPACK_DIR }[kind];
    target = path.join(dir, sub);
  }
  await mkdir(target, { recursive: true });
  await shell.openPath(target);
}

function assertKind(kind: ContentKind): ContentKind {
  if (kind !== 'mods' && kind !== 'addons') throw new Error('Ungültige Art');
  return kind;
}

/** Minecraft-Version, Loader, HeldixClient und die mitgelieferte Heldix-Loader-Version einer Instanz (für „Mods & Addons“) */
async function contentContext(instance: InstanceConfig): Promise<ContentContext> {
  const loaderVersion = instance.loader === 'heldix'
    ? ((await findLoaderJar(loaderDir()))?.version ?? null)
    : instance.loader === 'fabric' ? ((await findFabricLoaderJar(fabricLoaderDir()))?.version ?? null) : null;
  return { loader: instance.loader, minecraft: instance.minecraft, heldixClient: usesHeldixClient(instance), loaderVersion };
}

/** Datei im laufenden Spiel gesperrt (Windows)? Dann verständlich melden. */
function lockedFileError(error: unknown): Error {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return new Error('Die Datei ist gerade vom laufenden Spiel geöffnet – bitte erst das Spiel beenden.');
  return error instanceof Error ? error : new Error(String(error));
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle('app:info', async (): Promise<AppInfo> => ({
    name: LAUNCHER_NAME,
    clientName: CLIENT_NAME,
    version: LAUNCHER_VERSION,
    isDev,
    microsoftConfigured: MICROSOFT_CLIENT_ID.length > 0,
    discordConfigured: DISCORD_CLIENT_ID.length > 0,
    loaderVersion: (await findLoaderJar(loaderDir()))?.version ?? null,
    dataDir: paths.root,
    totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
  }));
  ipcMain.handle('versions:list', () => listVersions());
  ipcMain.handle('settings:get', () => store.getSettings());
  ipcMain.handle('settings:save', async (_e, patch: Partial<Settings>) => {
    const before = await store.getSettings();
    const next = await store.saveSettings(patch);
    applyPresenceSettings(next);
    autoUpdate = next.autoUpdate;
    if (next.social !== before.social) social.refresh().catch(() => undefined);
    return next;
  });
  ipcMain.handle('update:state', () => updater.state);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download-page', async () => {
    await shell.openExternal(`${WEBSITE_URL.replace(/\/+$/, '')}/download`);
  });
  ipcMain.handle('update:install', async () => {
    if (gameRunning()) throw new Error('Erst das Spiel beenden, dann aktualisieren.');
    if (!(await updater.install(true))) throw new Error(updater.state.error ?? 'Kein Update bereit.');
    quittingForUpdate = true;
    app.quit();
  });
  ipcMain.handle('discord:status', () => discord.connection);

  ipcMain.handle('instances:list', async () => Promise.all((await instances.list()).map(toInstanceInfo)));
  ipcMain.handle('instances:create', async (_e, data: NewInstance) => {
    if (!data || typeof data.minecraft !== 'string' || !['heldix', 'fabric', 'vanilla'].includes(data.loader)) {
      throw new Error('Ungültige Angaben für die Instanz.');
    }
    if (data.loader === 'heldix') {
      const mods = await findClientMods(clientModsDir(), CLIENT_MOD_PREFIX);
      if (!mods.some((m) => m.minecraft === data.minecraft)) throw new Error(`Für Minecraft ${data.minecraft} gibt es noch keine HeldixClient-Mod.`);
    }
    const config = await instances.create(data);
    await store.saveSettings({ selectedInstanceId: config.id });
    return toInstanceInfo(config);
  });
  ipcMain.handle('instances:update', async (_e, id: string, patch: InstancePatch) => {
    if (gameInstanceId === id && patch && 'heldixClient' in patch) throw new Error('Bitte erst das Spiel beenden.');
    const updated = await instances.update(id, patch);
    // HeldixClient in einer Fabric-Instanz eingeschaltet: Addon-Ordner anlegen (Addons kommen aus dem Addon-Store)
    if (patch?.heldixClient === true && usesHeldixClient(updated)) await mkdir(path.join(instances.dir(updated.id), ADDON_DIR), { recursive: true });
    return toInstanceInfo(updated);
  });
  ipcMain.handle('instances:delete', async (_e, id: string) => {
    if (gameInstanceId === id) throw new Error('Diese Instanz läuft gerade.');
    await instances.require(id);
    await shell.trashItem(instances.dir(id));
    const settings = await store.getSettings();
    if (settings.selectedInstanceId === id) {
      await store.saveSettings({ selectedInstanceId: (await instances.list())[0]?.id ?? null });
    }
  });
  ipcMain.handle('instances:select', async (_e, id: string) => {
    await instances.require(id);
    await store.saveSettings({ selectedInstanceId: id });
  });

  ipcMain.handle('content:list', async (_e, id: string, kind: ContentKind) => {
    const instance = await instances.require(id);
    // im Spiel entfernte Addons (unter Windows bis zum Spielende gesperrt) jetzt löschen
    if (assertKind(kind) === 'addons' && gameInstanceId !== id) await applyPendingRemovals(instances.dir(instance.id));
    return listContent(instances.dir(instance.id), assertKind(kind), instance.loader);
  });
  // „Mods & Addons“: mods/ und heldix-addons/ in einer Liste, geprüft gegen Minecraft-Version, Loader und HeldixClient
  ipcMain.handle('content:listAll', async (_e, id: string) => {
    const instance = await instances.require(id);
    if (!instanceBusy(instance.id)) await applyPendingRemovals(instances.dir(instance.id));
    return listAllContent(instances.dir(instance.id), await contentContext(instance));
  });
  ipcMain.handle('content:setEnabled', async (_e, id: string, kind: ContentKind, file: string, enabled: boolean) => {
    const instance = await instances.require(id);
    // Addons lassen sich auch während des Spiels schalten (wirkt nach dem Neustart), Mods erst nach dem Beenden
    const busy = instanceBusy(instance.id);
    if (busy && assertKind(kind) === 'mods') throw new Error('Bitte erst das Spiel beenden.');
    try {
      await setContentEnabled(instances.dir(instance.id), assertKind(kind), file, Boolean(enabled));
    } catch (error) {
      throw busy ? lockedFileError(error) : error;
    }
  });
  ipcMain.handle('content:import', async (_e, id: string, files?: string[]) => {
    const instance = await instances.require(id);
    if (instance.loader === 'vanilla') throw new Error('Vanilla-Instanzen haben keine Mods und Addons.');
    // ältere Versionen werden dabei ersetzt – das geht nicht, solange das Spiel die Dateien geöffnet hat
    if (instanceBusy(instance.id)) throw new Error('Bitte erst das Spiel beenden, dann Dateien hinzufügen.');
    let sources = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : [];
    if (sources.length === 0) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Mods & Addons hinzufügen',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: usesHeldixClient(instance) ? (instance.loader === 'fabric' ? 'Fabric-Mods und Heldix-Addons' : 'Heldix-Addons') : 'Fabric-Mods', extensions: ['jar'] }],
      });
      if (result.canceled) return { added: [], errors: [] };
      sources = result.filePaths;
    }
    const result = await importContentFiles(instances.dir(instance.id), await contentContext(instance), sources);
    if (result.added.some((a) => a.kind === 'addons')) storeChanged();
    return result;
  });
  ipcMain.handle('content:remove', async (_e, id: string, kind: ContentKind, file: string) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden.');
    await removeContent(instances.dir((await instances.require(id)).id), assertKind(kind), file);
    if (kind === 'addons') storeChanged();
  });
  ipcMain.handle('content:add', async (_e, id: string, kind: ContentKind, files?: string[]) => {
    const instance = await instances.require(id);
    let sources = Array.isArray(files) ? files : [];
    if (sources.length === 0) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: kind === 'mods' ? 'Mods hinzufügen' : 'Heldix-Addons hinzufügen',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: kind === 'addons' ? 'Heldix-Addons' : instance.loader === 'heldix' ? 'Heldix-Mods' : 'Fabric-Mods', extensions: ['jar'] }],
      });
      if (result.canceled) return 0;
      sources = result.filePaths;
    }
    return addContentFiles(instances.dir(instance.id), assertKind(kind), sources);
  });

  ipcMain.handle('addons:store', async (_e, id: string) => {
    const instance = await instances.require(id);
    if (!usesHeldixClient(instance)) return [];
    if (gameInstanceId !== id) await applyPendingRemovals(instances.dir(instance.id));
    return storeForInstance(instances.dir(instance.id), HELDIX_SERVICE_URL, STORE_PUBLIC_KEY, instance);
  });
  ipcMain.handle('addons:installStore', async (_e, id: string, addonId: string) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden – oder im Spiel über das Heldix-Menü → Mods & Addons → Store installieren.');
    const instance = await instances.require(id);
    if (!usesHeldixClient(instance)) throw new Error('Heldix-Addons laufen nur in Instanzen mit HeldixClient.');
    await applyPendingRemovals(instances.dir(instance.id));
    const name = await installStoreAddon(instances.dir(instance.id), HELDIX_SERVICE_URL, STORE_PUBLIC_KEY, String(addonId), undefined, instance);
    storeChanged();
    return name;
  });
  // Addon-Store als eigene Seite: eine Abfrage für alle Instanzen mit HeldixClient
  ipcMain.handle('store:overview', () => addonStore.overview());
  ipcMain.handle('store:uninstall', async (_e, id: string, addonId: string) => {
    const instance = await instances.require(String(id));
    if (instanceBusy(instance.id)) throw new Error('Bitte erst das Spiel beenden – oder im Spiel über das Heldix-Menü → Mods & Addons entfernen.');
    await uninstallStoreAddon(instances.dir(instance.id), String(addonId));
    storeChanged();
  });
  ipcMain.handle('store:details', (_e, addonId: unknown) => addonStore.details(addonId));
  ipcMain.handle('store:screenshot', (_e, addonId: unknown, index: unknown) => addonStore.screenshot(addonId, index));
  ipcMain.handle('store:rate', (_e, addonId: unknown, stars: unknown) => addonStore.rate(addonId, stars ?? null));
  ipcMain.handle('store:report', (_e, addonId: unknown, reason: unknown, note?: unknown) => addonStore.report(addonId, reason, note));
  ipcMain.handle('store:updateAll', () => addonStore.updateAll());

  // Freunde & Nachrichten
  ipcMain.handle('social:get', () => social.getOverview());
  ipcMain.handle('social:refresh', () => social.refresh());
  ipcMain.handle('social:request', (_e, name: unknown) => social.sendFriendRequest(name));
  ipcMain.handle('social:accept', (_e, uuid: unknown) => social.acceptFriendRequest(uuid));
  ipcMain.handle('social:removeRequest', (_e, uuid: unknown) => social.removeFriendRequest(uuid));
  ipcMain.handle('social:removeFriend', (_e, uuid: unknown) => social.removeFriend(uuid));
  ipcMain.handle('social:conversations', () => social.listConversations());
  ipcMain.handle('social:messages', (_e, uuid: unknown, before?: unknown) => social.getMessages(uuid, before));
  ipcMain.handle('social:send', (_e, uuid: unknown, text: unknown) => social.sendMessage(uuid, text));
  ipcMain.handle('social:read', (_e, uuid: unknown) => social.markRead(uuid));
  ipcMain.handle('social:blocked', () => social.listBlocked());
  ipcMain.handle('social:block', (_e, uuid: unknown) => social.blockPlayer(uuid));
  ipcMain.handle('social:unblock', (_e, uuid: unknown) => social.unblockPlayer(uuid));
  ipcMain.handle('social:report', (_e, uuid: unknown, reason: unknown, note?: unknown) => social.reportPlayer(uuid, reason, note));
  ipcMain.handle('social:privacy', () => social.getPrivacy());
  ipcMain.handle('social:setPrivacy', (_e, patch: unknown) => social.setPrivacy(patch));
  ipcMain.handle('social:join', (_e, uuid: unknown, instanceId?: unknown) => joinFriend(uuid, instanceId));
  ipcMain.handle('social:skin', (_e, uuid: unknown) => social.playerSkin(uuid));

  // Skins & Cosmetics
  ipcMain.handle('profile:get', (_e, refresh?: unknown) => profiles.state(refresh === true));
  ipcMain.handle('profile:import', (_e, files?: unknown) => importSkins(files));
  ipcMain.handle('profile:updateSkin', (_e, id: unknown, patch: unknown) => profiles.updateSavedSkin(id, patch));
  ipcMain.handle('profile:deleteSkin', (_e, id: unknown) => profiles.deleteSavedSkin(id));
  ipcMain.handle('profile:applySkin', (_e, id: unknown) => profiles.applySkin(id));
  ipcMain.handle('profile:resetSkin', () => profiles.resetSkin());
  ipcMain.handle('profile:mojangCape', (_e, id: unknown) => profiles.setMojangCape(id));
  ipcMain.handle('profile:heldixCape', (_e, id: unknown) => profiles.setHeldixCape(id));
  ipcMain.handle('cosmetics:get', (_e, refresh?: unknown) => cosmetics.state(refresh === true));
  ipcMain.handle('cosmetics:set', (_e, slot: unknown, id: unknown) => setCosmetic(slot, id));

  ipcMain.handle('modrinth:search', async (_e, id: string, query: string, offset: number) => {
    const instance = await instances.require(id);
    return searchModrinth(instances.dir(instance.id), instance.minecraft, String(query ?? ''), Number(offset) || 0);
  });
  ipcMain.handle('modrinth:performance', async (_e, id: string) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden.');
    const instance = await instances.require(id);
    if (instance.loader !== 'fabric') throw new Error('Das Leistungs-Paket besteht aus Fabric-Mods und gibt es nur für Fabric-Instanzen.');
    return installPerformancePack(instances.dir(instance.id), instance.minecraft, sendProgress);
  });
  ipcMain.handle('modrinth:install', async (_e, id: string, projectId: string) => {
    const instance = await instances.require(id);
    if (instance.loader !== 'fabric') {
      throw new Error('Mods von Modrinth sind Fabric-Mods und laufen nur in Fabric-Instanzen, nicht mit dem Heldix Loader.');
    }
    return installModrinth(instances.dir(instance.id), instance.minecraft, String(projectId));
  });
  ipcMain.handle('modrinth:updates', async (_e, id: string) => {
    const instance = await instances.require(id);
    if (instance.loader !== 'fabric') return [];
    return modrinthUpdates(instances.dir(instance.id), instance.minecraft);
  });
  ipcMain.handle('modrinth:update', async (_e, id: string, file: string) => {
    if (instanceBusy(id)) throw new Error('Bitte erst das Spiel beenden.');
    const instance = await instances.require(id);
    if (instance.loader !== 'fabric') throw new Error('Modrinth-Mods gibt es nur in Fabric-Instanzen.');
    return updateModrinthMod(instances.dir(instance.id), instance.minecraft, String(file), sendProgress);
  });

  // Shaderpacks laufen über Iris und damit nur in Fabric-Instanzen
  const fabricInstance = async (id: string) => {
    const instance = await instances.require(id);
    if (instance.loader !== 'fabric') {
      throw new Error('Shaderpacks wie BSL brauchen Iris und laufen nur in Fabric-Instanzen. Heldix-Instanzen haben die Heldix-Shader (im Spiel: Heldix-Menü → Shader).');
    }
    return instance;
  };
  ipcMain.handle('shaders:list', async (_e, id: string) => listShaderpacks(instances.dir((await instances.require(id)).id)));
  ipcMain.handle('shaders:search', async (_e, id: string, query: string, offset: number) => {
    const instance = await instances.require(id);
    return searchShaderpacks(instances.dir(instance.id), instance.minecraft, String(query ?? ''), Number(offset) || 0);
  });
  ipcMain.handle('shaders:install', async (_e, id: string, projectId: string) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden.');
    const instance = await fabricInstance(id);
    return installShaderpack(instances.dir(instance.id), instance.minecraft, String(projectId), sendProgress);
  });
  ipcMain.handle('shaders:setActive', async (_e, id: string, file: string | null) => {
    const instance = await fabricInstance(id);
    await setActiveShaderpack(instances.dir(instance.id), typeof file === 'string' ? file : null);
  });
  ipcMain.handle('shaders:remove', async (_e, id: string, file: string) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden.');
    const instance = await fabricInstance(id);
    await removeShaderpack(instances.dir(instance.id), String(file));
  });
  ipcMain.handle('shaders:add', async (_e, id: string, files?: string[]) => {
    const instance = await fabricInstance(id);
    let sources = Array.isArray(files) ? files : [];
    if (sources.length === 0) {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: 'Shaderpacks hinzufügen',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Shaderpacks', extensions: ['zip'] }],
      });
      if (result.canceled) return 0;
      sources = result.filePaths;
    }
    return addShaderpackFiles(instances.dir(instance.id), sources);
  });

  ipcMain.handle('accounts:list', () => store.listAccounts());
  ipcMain.handle('accounts:skin', async () => {
    const account = await store.getActiveAccount();
    return account ? skinFor(paths, account) : null;
  });
  // zuerst die Neuigkeiten des HeldixClient-Teams, dann Mojangs Patch Notes
  ipcMain.handle('news:list', async () => [...(await listHeldixNews(HELDIX_SERVICE_URL)), ...(await listNews(paths))]);
  ipcMain.handle('web:open', async (_e, page: unknown) => {
    const known = ['neuigkeiten', 'das-team', 'status', 'download', 'hilfe', 'addons'].includes(String(page));
    // Hilfe-Artikel, z. B. „hilfe/grafikprobleme“ aus der Absturz-Hilfe
    if (!known && !/^hilfe\/[a-z0-9-]{1,60}$/.test(String(page))) throw new Error('Unbekannte Seite');
    await shell.openExternal(`${WEBSITE_URL.replace(/\/+$/, '')}/${page}`);
  });
  ipcMain.handle('whatsnew:get', () => whatsNew());
  ipcMain.handle('whatsnew:seen', async () => {
    await store.saveSettings({ lastSeenVersion: app.getVersion() });
  });
  ipcMain.handle('web:account', async (_e, rawTarget?: unknown) => {
    const targets = ['profil', 'freunde', 'nachrichten', 'privatsphaere', 'daten', 'support', 'team'];
    const target = typeof rawTarget === 'string' && targets.includes(rawTarget) ? rawTarget : undefined;
    const account = await store.getActiveAccount();
    if (!account) throw new Error('Bitte zuerst ein Konto hinzufügen.');
    // Offline-Konten haben keine Mojang-Anmeldung; nur zum Testen gegen einen lokalen Dienst (HELDIX_WEB_LOGIN_DEV=1)
    const devAuth = process.env.HELDIX_WEB_LOGIN_DEV === '1';
    if (account.type === 'offline' && !devAuth) throw new Error('Für die Webseite brauchst du ein Microsoft-Konto.');
    const session = await sessionFor(account);
    const url = await webLoginUrl(HELDIX_SERVICE_URL, session, devAuth, target, { sessionServer: MOJANG_TEST_URL ?? undefined });
    await shell.openExternal(url);
  });
  ipcMain.handle('loader:logos', () => loaderLogos(paths));
  ipcMain.handle('news:body', (_e, id: string) => newsBody(String(id)));
  ipcMain.handle('accounts:addMicrosoft', async () => {
    if (!MICROSOFT_CLIENT_ID) throw new Error('Microsoft-Login ist noch nicht eingerichtet: Client-ID in src/main/config.ts eintragen (siehe README).');
    const tokens = await interactiveMicrosoftLogin(mainWindow, MICROSOFT_CLIENT_ID, MICROSOFT_REDIRECT_URI);
    const account = await store.upsertMicrosoft(await loginMinecraft(tokens));
    accountsChanged();
    return toAccountInfo(account);
  });
  ipcMain.handle('accounts:addOffline', async (_e, rawName: string) => {
    if (!offlineAllowed()) throw new Error(OFFLINE_LOCKED);
    const name = String(rawName).trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Name: 3–16 Zeichen, nur Buchstaben, Zahlen und _.');
    const account = await store.addOffline(name, offlineUuid(name));
    accountsChanged();
    return toAccountInfo(account);
  });
  ipcMain.handle('accounts:remove', async (_e, id: string) => {
    await store.remove(id);
    accountsChanged();
  });
  ipcMain.handle('accounts:select', async (_e, id: string) => {
    await store.select(id);
    accountsChanged();
  });

  ipcMain.handle('game:launch', (_e, instanceId?: string, target?: { kind?: unknown; id?: unknown }) =>
    launch(typeof instanceId === 'string' ? instanceId : undefined, target && typeof target === 'object' ? target : undefined));
  ipcMain.handle('instances:quickPlay', async (_e, id: string) => {
    const instance = await instances.require(id);
    return listQuickPlay(instances.dir(instance.id), paths.versions, instance.minecraft);
  });
  // nur Server, die in der Serverliste dieser Instanz stehen
  ipcMain.handle('instances:serverStatus', async (_e, id: string, address: string) => {
    const instance = await instances.require(id);
    const list = await listQuickPlay(instances.dir(instance.id), paths.versions, instance.minecraft);
    const wanted = String(address ?? '').trim().toLowerCase();
    if (!list.targets.some((t) => t.kind === 'server' && (t.address ?? t.id).trim().toLowerCase() === wanted)) throw new Error('Diesen Server gibt es in der Serverliste nicht.');
    return serverStatus(wanted);
  });
  ipcMain.handle('game:kill', () => {
    if (game) killedByUser = true;
    game?.process.kill();
  });

  // ---------- Absturz-Hilfe ----------
  ipcMain.handle('crash:last', () => lastCrash?.analysis ?? null);
  ipcMain.handle('crash:preview', async (_e, id: string, note: string, includeFiles: boolean) => crashPreview(String(id), String(note ?? ''), includeFiles !== false));
  ipcMain.handle('crash:send', async (_e, id: string, note: string, includeFiles: boolean) => sendCrashReport(String(id), String(note ?? ''), includeFiles !== false));
  ipcMain.handle('crash:open', async (_e, id: string) => {
    if (!lastCrash || lastCrash.analysis.id !== id || !lastCrash.files.crashReportPath) throw new Error('Kein Crash-Report vorhanden.');
    const problem = await shell.openPath(lastCrash.files.crashReportPath);
    if (problem) throw new Error(problem);
  });
  ipcMain.handle('game:state', () => gameState);
  ipcMain.handle('folder:open', (_e, kind: FolderKind, instanceId?: string) => openFolder(kind, instanceId));
}

// ---------- Absturz-Hilfe: an den Support senden ----------

const CRASH_NOTE_MAX = 800;
const CRASH_ATTACHMENT_MAX = 480 * 1024;

function crashRecord(id: string): CrashRecord {
  if (!lastCrash || lastCrash.analysis.id !== id) throw new Error('Diese Absturz-Analyse gibt es nicht mehr.');
  return lastCrash;
}

/** Text der Support-Anfrage und Anhänge – genau das wird gesendet */
function buildCrashReport(record: CrashRecord, rawNote: string, includeFiles: boolean): Pick<CrashReportPreview, 'subject' | 'message' | 'attachments'> {
  const { analysis, files } = record;
  const note = rawNote.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, CRASH_NOTE_MAX);
  const attachments: CrashReportPreview['attachments'] = [];
  if (includeFiles) {
    const add = (name: string, text: string | null) => {
      if (!text?.trim()) return;
      const clean = tail(anonymize(text), CRASH_ATTACHMENT_MAX);
      attachments.push({ name, size: Buffer.byteLength(clean, 'utf8'), text: clean });
    };
    add('crash-report.txt', files.crashReport);
    add('jvm-fehler.log', files.jvmError);
    add('log.txt', files.log);
  }
  const lines = [
    'Absturz-Bericht aus dem HeldixClient-Launcher',
    `Erkannte Ursache: ${analysis.title}`,
    `Instanz: ${analysis.instanceName} · Minecraft ${record.minecraft} · ${record.loader} · ${record.modCount} ${record.modCount === 1 ? 'Mod' : 'Mods'}`,
    `Arbeitsspeicher: ${(record.memoryMb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB · Grafik-API: ${record.graphicsApi}`,
    `Launcher ${LAUNCHER_VERSION} · ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} ${os.release()} (${process.arch})`,
    `Fehlercode: ${analysis.exitCode ?? '–'}`,
    analysis.description ? `Minecraft meldet: ${analysis.description}` : '',
    analysis.detail ? `Fehler: ${anonymize(analysis.detail)}` : '',
    analysis.suspects.length ? `Verdächtige Mods: ${analysis.suspects.map((m) => m.name).join(', ')}` : '',
    attachments.length ? `Anhänge: ${attachments.map((a) => a.name).join(', ')}` : 'Ohne Anhänge',
  ].filter(Boolean);
  let message = lines.join('\n');
  if (note) message += `\n\nNotiz:\n${note}`;
  if (message.length > 2000) message = `${message.slice(0, 1997)}…`;
  const subject = `Absturz: ${analysis.title}`.replace(/\s+/g, ' ').slice(0, 100);
  return { subject, message, attachments };
}

async function crashPreview(id: string, note: string, includeFiles: boolean): Promise<CrashReportPreview> {
  const record = crashRecord(id);
  const built = buildCrashReport(record, note, includeFiles);
  let canSend = true;
  let reason: string | null = null;
  if (!HELDIX_SERVICE_URL) {
    canSend = false;
    reason = 'In dieser Installation ist kein Heldix-Dienst eingerichtet.';
  } else if (!(await social.canAuthenticate())) {
    canSend = false;
    reason = 'Zum Senden brauchst du ein Microsoft-Konto im Launcher.';
  }
  return { ...built, canSend, reason };
}

async function sendCrashReport(id: string, note: string, includeFiles: boolean): Promise<{ ticketId: number; attached: number; attachmentError: string | null }> {
  const record = crashRecord(id);
  const built = buildCrashReport(record, note, includeFiles);
  const offlineMessage = 'Zum Senden an den Support brauchst du ein Microsoft-Konto.';
  const created = await social.authed<{ ticket: { id: number } }>('/v1/support', {
    method: 'POST',
    body: { category: 'fehler', subject: built.subject, text: built.message },
  }, { offlineMessage });
  const ticketId = created.ticket.id;
  let attached = 0;
  let attachmentError: string | null = null;
  for (const attachment of built.attachments) {
    try {
      await social.authed(`/v1/support/${ticketId}/attachments?name=${encodeURIComponent(attachment.name)}`, {
        method: 'POST',
        rawBody: attachment.text,
        contentType: 'text/plain; charset=utf-8',
      }, { offlineMessage });
      attached++;
    } catch (error) {
      attachmentError = error instanceof Error ? error.message : String(error);
      break;
    }
  }
  launcherLog(`Absturz an den Support gesendet (Anfrage #${ticketId}, ${attached} Anhänge)`);
  return { ticketId, attached, attachmentError };
}

// ---------- Fenster ----------

/** App-Menü für macOS: HeldixClient (Über, Ausblenden, Beenden), Bearbeiten, Fenster */
function macMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: LAUNCHER_NAME,
      submenu: [
        { role: 'about', label: `Über ${LAUNCHER_NAME}` },
        { type: 'separator' },
        { role: 'hide', label: `${LAUNCHER_NAME} ausblenden` },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: `${LAUNCHER_NAME} beenden` },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einsetzen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Fenster',
      submenu: [
        { role: 'minimize', label: 'Im Dock ablegen' },
        { role: 'zoom', label: 'Zoomen' },
        { type: 'separator' },
        { role: 'front', label: 'Alle nach vorne bringen' },
      ],
    },
  ]);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: LAUNCHER_NAME,
    backgroundColor: '#080b12',
    // Windows: eigene Titelleiste mit den Fensterknöpfen rechts; macOS: Ampel-Knöpfe oben links über der Seitenleiste
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 18 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#00000000', symbolColor: '#9ba6b8', height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));
  // Freunde: wieder sichtbar = gleich im 20-s-Takt weiter (verborgen: alle 60 s)
  // Abzeichen am Addon-Store: Stand der letzten Prüfung gleich nach dem Laden der Oberfläche
  mainWindow.webContents.on('did-finish-load', () => {
    if (addonStore.updates > 0) mainWindow?.webContents.send('store:changed', addonStore.updates);
  });
  mainWindow.on('show', () => social.wake());
  mainWindow.on('restore', () => social.wake());
  mainWindow.on('focus', () => social.wake());
  void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Nur für automatische Tests im Entwicklungsmodus:
  // HELDIX_SCREENSHOT=<datei.png> speichert nach HELDIX_SCREENSHOT_DELAY ms einen Screenshot und beendet den Launcher.
  // HELDIX_SCREENSHOT_SCRIPT=<js> wird vorher in der Oberfläche ausgeführt (z. B. Klicks).
  const screenshot = process.env.HELDIX_SCREENSHOT;
  if (screenshot && isDev) {
    // HELDIX_SCREENSHOT_SIZE=<Breite>x<Höhe>, z. B. um die kleinste Fenstergröße zu prüfen
    const size = /^(\d+)x(\d+)$/.exec(process.env.HELDIX_SCREENSHOT_SIZE ?? '');
    if (size) mainWindow.setSize(Number(size[1]), Number(size[2]));
    mainWindow.webContents.once('did-finish-load', async () => {
      // HELDIX_SCREENSHOT_CRASH=<Spielordner mit crash-reports/ usw.>: Absturz-Hilfe ohne echtes Spiel zeigen
      const crashDir = process.env.HELDIX_SCREENSHOT_CRASH;
      if (crashDir) {
        const instance = await selectedInstance().catch(() => null);
        if (instance) {
          const files = await collectCrashFiles({ gameDir: crashDir, startedAt: 0, logLines: [] });
          const mods = (await listContent(crashDir, 'mods', 'fabric')).map((item) => ({ file: item.file, id: item.id, name: item.name }));
          const { analysis } = await analyzeCrash({ instanceId: instance.id, instanceName: instance.name, gameDir: crashDir, startedAt: 0, exitCode: -1, logLines: [], mods, memoryMb: 4096, graphicsApi: 'vulkan', customJava: false }, files);
          lastCrash = { analysis, files, minecraft: instance.minecraft, loader: LOADER_LABELS[instance.loader], modCount: mods.length, memoryMb: 4096, graphicsApi: 'vulkan' };
          setGameState({ state: 'exited', code: -1, crash: { id: analysis.id, title: analysis.title } });
        }
      }
      const script = process.env.HELDIX_SCREENSHOT_SCRIPT;
      if (script) await mainWindow!.webContents.executeJavaScript(script).catch((e: Error) => console.error(e));
      setTimeout(async () => {
        const image = await mainWindow!.webContents.capturePage();
        await writeFile(screenshot, image.toPNG());
        game?.process.kill();
        app.quit();
      }, Number(process.env.HELDIX_SCREENSHOT_DELAY ?? 2500));
    });
  }
}

// Nur ein Launcher gleichzeitig (in der Entwicklung egal): ein zweiter Start holt das offene Fenster nach vorn
const singleInstance = !app.isPackaged || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', () => focusWindow());

if (singleInstance) {
  app.whenReady().then(async () => {
    // macOS braucht ein App-Menü, sonst gehen Kopieren, Einfügen und Beenden (⌘C, ⌘V, ⌘Q) nicht
    Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null);
    // Windows-Benachrichtigungen brauchen die App-ID (wie appId in package.json, die der Installer der Verknüpfung gibt)
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'dev.heldixclient.launcher' : process.execPath);
    registerIpc();
    await ensureInstances().catch((error) => console.error('[Launcher] Instanzen konnten nicht vorbereitet werden', error));
    createWindow();
    social.start();
    addonStore.start();
    const settings = await store.getSettings();
    applyPresenceSettings(settings);
    autoUpdate = settings.autoUpdate;
    updater.start(() => autoUpdate);
    void cleanupOfficialLauncher();
  });
}

app.on('before-quit', (event) => {
  // geladenes Update still installieren (nicht, solange das Spiel läuft – es nutzt Dateien des Launchers)
  if (!quittingForUpdate && autoUpdate && updater.installerPath() && !gameRunning()) {
    event.preventDefault();
    quittingForUpdate = true;
    updater.install(false).finally(() => app.quit());
    return;
  }
  // Discord-Status löschen, Hintergrund-Abfragen beenden
  discord.stop();
  social.stop();
  addonStore.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
