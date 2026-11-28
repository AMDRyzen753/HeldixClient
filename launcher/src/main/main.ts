import { accessSync, constants as fsConstants, readFileSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray, type MenuItemConstructorOptions } from 'electron';
import type {
  AccountInfo,
  AppInfo,
  CrashAnalysis,
  CrashReportPreview,
  ContentKind,
  DiscordPresenceOptions,
  DiscordPreview,
  FolderKind,
  GameState,
  HeldixCape,
  InstanceInfo,
  InviteAcceptView,
  InviteEvent,
  LauncherView,
  MessageCard,
  NotificationList,
  PartyFollow,
  PartyLocation,
  PublicInviteView,
  WorldJoinView,
  InstancePatch,
  LogLine,
  NewInstance,
  ProgressEvent,
  Settings,
  SetupAddons,
  SetupInstallResult,
  SocialOverview,
  VersionListResult,
} from '../shared/api';
import { interactiveMicrosoftLogin } from './auth-window';
import { confirmOnTop } from './confirm-window';
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
import { loginMinecraft, offlineUuid, refreshMicrosoft, sessionFromAccessToken, type MicrosoftTokens } from './core/auth';
import { AccountBridge, IPC_JVM_FLAG } from './core/accountipc';
import { OFFLINE_LOCKED, SessionManager } from './core/sessions';
import { addContentFiles, countEnabled, importContentFiles, listAllContent, listContent, removeContent, setContentEnabled, type ContentContext } from './core/content';
import { applyPendingRemovals, installStoreAddon, storeForInstance, uninstallStoreAddon, type OverviewInstance, type StoreEntry } from './core/addonstore';
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
import { DEFAULT_PRESENCE_OPTIONS, PresenceTracker, buildActivity, parseStatusLine, presenceButtons, presenceJoinServer, presenceJoinWorld, previewOf, sharedWorldAddress, type DiscordButton, type GameStatus, type PresenceInput } from './core/presence';
import { PublicHeads } from './core/discordheads';
import { WorldClient, findWorldLink, isWorldMissing, mapWorldInvite, normalizeWorldAddress, parsePastedWorld, parseWorldLink, planWorldJoin, worldCode, worldCodeOf, worldWebUrl, WORLD_MISSING, type WorldEvent } from './core/worlds';
import { NOTIFICATION_FILE, NotificationStore, type NewNotification } from './core/notifications';
import { HostingClient, hostedAsFriendWorld, type HostingEvent } from './core/hosting';
import { DiscoverClient, discoverAsFriendWorld } from './core/discover';
import { DOWNLOAD_INVITE_FILE, INVITE_POLL_MS, INVITE_PROTOCOL, InviteService, acceptNotes, findInviteLink, inviteCode, inviteServer, isMissing, parseInviteLink, parsePastedInvite, pickInviteInstance, readDownloadInvite, finishDownloadInvite, rewardName, type PublicInvite } from './core/invites';
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
import { SocialClient, cardFallbackText, checkCard, joinableServer, pickJoinInstance, type SocialNotice } from './core/social';
import { PartyClient, followAction, locationText, type PartyEvent } from './core/party';
import { allowTestTextureOrigin, skinFor } from './core/skins';
import { Updater, compareVersions, type UpdateState } from './core/updater';
import { installMacUpdate, macAppBundle, macBlockText, macSelfUpdateBlock, parseMacInstallResult, type MacSelfUpdateBlock } from './core/mac-update';
import {
  afterGameAction,
  attentionCount,
  badgeDescription,
  badgePng,
  badgeText,
  closeAction,
  dockBadgeText,
  loginItemSettings,
  recentInstances,
  shouldFlash,
  startedHidden,
  trayHint,
} from './core/background';
import {
  GAME_MARKER_FILE,
  STARTUP_CHECK_TIMEOUT_MS,
  STARTUP_STALL_MS,
  UPDATE_MEMO_FILE,
  decideStartupUpdate,
  pickWhatsNew,
  previousGameRunning,
  readGameMarker,
  readUpdateMemo,
  settleUpdateMemo,
  splashText,
  startupPlan,
  writeUpdateMemo,
  type GameMarker,
  type ReleaseNotes,
  type StartupDecision,
} from './core/startup-update';
import { SetupGate, installSetupAddon, loadSetupAddons, setupStart, setupTargets } from './core/setup';
import { SplashWindow } from './splash-window';
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
/** Konto-Wechsel im laufenden Spiel (nur HeldixClient-Instanzen, siehe core/accountipc.ts) */
let gameBridge: AccountBridge | null = null;

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
  void updateTray();
  refreshDockMenu();
}

/** Versionsverlauf des Dienstes (GET /v1/launcher/versions); null = nicht erreichbar */
async function releaseHistory(): Promise<ReleaseNotes[] | null> {
  try {
    const response = await fetch(`${HELDIX_SERVICE_URL.replace(/\/+$/, '')}/v1/launcher/versions?limit=20`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(String(response.status));
    const data = (await response.json()) as { versions?: { version?: unknown; date?: unknown; notes?: unknown }[] };
    return (data.versions ?? [])
      .filter((v): v is { version: string; date: unknown; notes: unknown } => typeof v.version === 'string')
      .map((v) => ({
        version: v.version,
        date: typeof v.date === 'string' ? v.date : '',
        notes: Array.isArray(v.notes) ? v.notes.filter((n): n is string => typeof n === 'string').slice(0, 30) : [],
      }));
  } catch {
    return null;
  }
}

/**
 * „Neu in <Version>“: beim ersten Start nach einem Update einmal die Hinweise aller Versionen seit der zuletzt gesehenen
 * (Versionsverlauf des Dienstes, sonst die beim Installieren gemerkten Hinweise aus dem Manifest, siehe pickWhatsNew).
 * Bei der ersten Installation nichts zeigen, nur merken.
 */
async function whatsNew(): Promise<import('../shared/api').WhatsNew | null> {
  const current = app.getVersion();
  const last = (await store.getSettings()).lastSeenVersion;
  let newer = false;
  try {
    newer = !!last && compareVersions(current, last) > 0;
  } catch {
    newer = false;
  }
  const memo = await readUpdateMemo(updateMemoFile);
  const result = pickWhatsNew(current, last, newer ? await releaseHistory() : [], memo.notes);
  if (result.markSeen) {
    await store.saveSettings({ lastSeenVersion: current });
    if (memo.notes) await writeUpdateMemo(updateMemoFile, { ...memo, notes: null }).catch(() => undefined);
  }
  return result.show;
}

function gameRunning(): boolean {
  return gameState.state === 'preparing' || gameState.state === 'running';
}

// ---------- Automatische Updates (über die Schnittstelle des Heldix-Dienstes) ----------

/**
 * macOS (ab 0.14.0): ersetzt sich die App selbst? Nicht aus dem DMG, nicht aus einem von macOS verlegten Ordner, nicht
 * ohne Schreibrechte, nicht in der Entwicklung und nicht, wenn macOS das letzte Ersetzen abgelehnt hat (core/mac-update.ts).
 */
const macAppPath = process.platform === 'darwin' ? macAppBundle(process.execPath) : null;
const macResultFile = path.join(paths.root, 'update-mac-result.txt');
const macUpdateBlock: MacSelfUpdateBlock | null = process.platform === 'darwin' ? macSelfUpdateBlock({
  packaged: app.isPackaged,
  appPath: macAppPath,
  writable: macAppPath !== null && macWritableSync(macAppPath),
  lastFailed: lastMacInstallFailed(),
}) : null;

function macWritableSync(appPath: string): boolean {
  try {
    accessSync(appPath, fsConstants.W_OK);
    accessSync(path.dirname(appPath), fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Hat das Skript zuletzt eine neuere Version nicht einsetzen dürfen? Dann bis zur Installation von Hand nur der Hinweis. */
function lastMacInstallFailed(): boolean {
  try {
    const result = parseMacInstallResult(readFileSync(macResultFile, 'utf8'));
    if (!result) return false;
    if (result.ok || compareVersions(app.getVersion(), result.version) >= 0) {
      rmSync(macResultFile, { force: true });
      return false;
    }
    console.log(`[Update] Das letzte Update auf ${result.version} ließ sich nicht einsetzen (${result.reason ?? 'unbekannt'}) – nur noch Hinweis mit Download`);
    return result.reason !== 'wartet';
  } catch {
    return false;
  }
}

/** Ersetzt sich die App selbst (Windows immer, Mac ohne Hindernis)? Sonst nur Hinweis mit der Download-Seite. */
const selfUpdate = process.platform === 'win32' || (process.platform === 'darwin' && macUpdateBlock === null);

// In der Entwicklung nur mit HELDIX_UPDATE_URL (zum Testen); die fertige App fragt den Heldix-Dienst.
const updater = new Updater({
  baseUrl: process.env.HELDIX_UPDATE_URL ?? (app.isPackaged ? HELDIX_SERVICE_URL : ''),
  currentVersion: app.getVersion(),
  dir: path.join(paths.root, 'updates'),
  publicKey: UPDATE_PUBLIC_KEY,
  log: (line) => console.log(line),
  // Mac: eigenes Manifest mit einer ZIP je Prozessor; Linux: nur melden, laden über die Webseite
  platform: process.platform === 'darwin' ? 'mac' : 'win',
  manualReason: selfUpdate ? null : process.platform === 'darwin' ? macBlockText(macUpdateBlock ?? 'not-bundle') : 'Auf diesem System lädst du neue Versionen über heldixclient.com.',
  macInstall: (zip, release, restart) => installMacUpdate({
    zip,
    release,
    appPath: macAppPath!,
    restart,
    pid: process.pid,
    logFile: path.join(paths.root, 'update-mac.log'),
    resultFile: macResultFile,
    log: (line) => console.log(`[Update] ${line}`),
  }),
});
/** Einstellung "Updates automatisch" (Start, Zeitgeber, Installieren beim Beenden) */
let autoUpdate = true;
let quittingForUpdate = false;
/** letzter Installationsversuch und Hinweise für „Neu in …“ (core/startup-update.ts) */
const updateMemoFile = path.join(paths.root, UPDATE_MEMO_FILE);
/** PID des laufenden Spiels, damit ein Start nach einem Absturz des Launchers nicht darunter installiert */
const gameMarkerFile = path.join(paths.root, GAME_MARKER_FILE);
/** Spiel aus einer früheren Sitzung (beim Start gelesen) */
let previousGame: GameMarker | null = null;
/** Startfenster (nur beim Update vor dem Start), bis das Hauptfenster sichtbar ist */
let splash: SplashWindow | null = null;
/** Startfenster zeigt den Fortschritt des Downloads */
let splashFollowsUpdate = false;
/** Hinweis „Update verfügbar“ vom Start (Einstellung aus bzw. macOS), bis die Oberfläche ihn abholt (update:notice) */
let startupNotice: UpdateState | null = null;
/** erst nach der Prüfung beim Start darf das Hauptfenster entstehen (z. B. durch einen zweiten Start mit Link) */
let windowAllowed = false;

updater.onState = (state) => {
  send('update:state', state);
  if ((state.phase === 'ready' || state.phase === 'available') && state.version) {
    void remember({
      kind: 'update',
      title: state.phase === 'ready' ? `Update ${state.version} ist bereit` : `Update ${state.version} ist verfügbar`,
      body: state.notes?.[0] ?? (state.phase === 'ready' ? 'Wird beim Beenden installiert – oder jetzt neu starten.' : 'Unter Einstellungen → Updates installieren.'),
      target: { view: 'updates' },
      key: `update:${state.version}`,
      once: true,
    }, false);
  }
  if (splash?.open && splashFollowsUpdate) splash.update({ ...splashText(state), skip: true });
};

/** Läuft ein Spiel – in dieser Sitzung oder noch aus einer früheren (dann nicht installieren)? */
function anyGameRunning(): boolean {
  if (gameRunning()) return true;
  if (previousGame && !previousGameRunning(previousGame, Date.now())) previousGame = null;
  return previousGame !== null;
}

/** Hinweise und Versuch merken (für „Neu in …“ und gegen eine Schleife beim Start), dann den Installer starten */
async function launchInstaller(restart: boolean): Promise<boolean> {
  const manifest = updater.found();
  if (manifest) {
    await writeUpdateMemo(updateMemoFile, {
      attempt: { version: manifest.version, at: Date.now() },
      notes: { version: manifest.version, date: manifest.date, notes: manifest.notes },
    }).catch(() => undefined);
  }
  return updater.install(restart);
}

function logStartupDecision(decision: StartupDecision, state: UpdateState): void {
  const texts: Record<string, string> = {
    'start:current': 'Beim Start: Launcher ist aktuell',
    'start:error': `Beim Start: keine Prüfung möglich (${state.error ?? 'unbekannt'}) – normal starten`,
    'start:game': `Beim Start: Version ${state.version} gefunden, aber es läuft noch ein Spiel – später installieren`,
    'start:retry-later': `Beim Start: Version ${state.version} – der letzte Installationsversuch ist eben erst gelaufen, später erneut`,
    'notify:install': `Beim Start: Version ${state.version} verfügbar (automatische Updates sind aus) – nur Hinweis`,
    'notify:download': `Beim Start: Version ${state.version} verfügbar – Hinweis mit Download über die Webseite`,
    install: `Beim Start: Version ${state.version} wird installiert`,
  };
  console.log(`[Update] ${texts[decision.action === 'install' ? 'install' : `${decision.action}:${decision.reason}`]}`);
}

/** Download im Startfenster: fertig, „Später“, kein Fortschritt mehr oder Fehler (Laden läuft dann ggf. weiter) */
function downloadWithSplash(): Promise<'ready' | 'skipped' | 'stalled' | 'failed'> {
  return new Promise((resolve) => {
    let settled = false;
    let lastProgress = -1;
    let lastChange = Date.now();
    const finish = (result: 'ready' | 'skipped' | 'stalled' | 'failed') => {
      if (settled) return;
      settled = true;
      splashFollowsUpdate = false;
      clearInterval(watch);
      resolve(result);
    };
    const watch = setInterval(() => {
      const progress = updater.state.progress ?? 0;
      if (progress !== lastProgress) {
        lastProgress = progress;
        lastChange = Date.now();
      } else if (Date.now() - lastChange > STARTUP_STALL_MS) finish('stalled');
    }, 1000);
    splashFollowsUpdate = true;
    splash?.onceSkipped(() => finish('skipped'));
    updater.download().then((state) => finish(state.phase === 'ready' ? 'ready' : 'failed'), () => finish('failed'));
  });
}

/**
 * Update vor dem Start (Windows, „Updates automatisch“ an; siehe core/startup-update.ts): Startfenster, kurz prüfen,
 * ggf. laden, still installieren und neu starten. Gibt false zurück, wenn der Installer läuft und der Launcher sich
 * gerade beendet; sonst startet er normal (retrySoon = Prüfung ging nicht, in einer Minute noch einmal).
 */
async function updateBeforeStart(): Promise<{ proceed: boolean; retrySoon: boolean }> {
  splash = new SplashWindow(LAUNCHER_NAME);
  splash.update({ title: 'Suche nach Updates …', progress: null, skip: false });
  const starting = () => splash?.update({ title: 'HeldixClient wird gestartet …', progress: null, skip: false });
  const state = await updater.check({ timeoutMs: STARTUP_CHECK_TIMEOUT_MS, download: false });
  const decision = decideStartupUpdate({
    platform: process.platform,
    selfUpdate,
    autoUpdate,
    state,
    gameRunning: anyGameRunning(),
    attempt: (await readUpdateMemo(updateMemoFile)).attempt,
    now: Date.now(),
  });
  logStartupDecision(decision, state);
  if (decision.action !== 'install') {
    // gefunden, aber jetzt nicht installieren: im Hintergrund laden, dann „Jetzt neu starten“ bzw. beim Beenden
    if (decision.action === 'start' && decision.reason !== 'current' && decision.reason !== 'error') void updater.download();
    starting();
    return { proceed: true, retrySoon: decision.action === 'start' && decision.reason === 'error' };
  }
  splash.update({ ...splashText(updater.state), skip: true });
  const outcome = await downloadWithSplash();
  if (outcome !== 'ready' || anyGameRunning()) {
    console.log(`[Update] Beim Start nicht installiert (${outcome === 'ready' ? 'Spiel läuft' : outcome === 'skipped' ? '„Später“ gewählt' : outcome === 'stalled' ? 'Download kommt nicht voran' : 'Download fehlgeschlagen'}) – normal starten`);
    starting();
    return { proceed: true, retrySoon: false };
  }
  splash.update({ ...splashText(updater.state, true), skip: false });
  if (await launchInstaller(true)) {
    // sofort beenden: der Installer wartet auf das Ende des Launchers, installiert still und startet ihn neu
    quittingForUpdate = true;
    closeSplash();
    app.quit();
    return { proceed: false, retrySoon: false };
  }
  console.log('[Update] Installer ließ sich nicht starten – normal starten');
  starting();
  return { proceed: true, retrySoon: false };
}

/**
 * Ohne Startfenster (Einstellung aus, kein Selbst-Update, unsichtbarer Start): gleich im Hintergrund prüfen. Eine neue
 * Version nur melden – unsichtbar gestartet mit „Updates automatisch“ im Hintergrund laden (installiert wird dann mit
 * „Jetzt neu starten“ oder beim Beenden).
 */
async function updateNoticeAtStart(): Promise<void> {
  const state = await updater.check({ download: false });
  const decision = decideStartupUpdate({ platform: process.platform, selfUpdate, autoUpdate, state, gameRunning: anyGameRunning(), attempt: null, now: Date.now() });
  logStartupDecision(decision, state);
  if (decision.action === 'install' || (decision.action === 'start' && (decision.reason === 'game' || decision.reason === 'retry-later'))) {
    void updater.download();
    return;
  }
  if (decision.action !== 'notify') return;
  startupNotice = state;
  send('update:notice', null);
}

function closeSplash(): void {
  splash?.close();
  splash = null;
}

// ---------- Discord-Status (Rich Presence, siehe core/presence.ts und core/discord.ts) ----------

const discord = new DiscordRpc(DISCORD_CLIENT_ID, (message) => console.log(`[Discord] ${message}`));
discord.onStatus = (status) => send('discord:status', status);

interface PresenceState {
  phase: 'launcher' | 'preparing' | 'running';
  instance?: InstanceConfig;
  startedAt?: number;
  /** Was die HeldixClient-Mod meldet (Hauptmenü, Einzelspieler, Server, geteilte Welt …) */
  status: GameStatus | null;
}
let presence: PresenceState = { phase: 'launcher', status: null };
let presenceSettings: DiscordPresenceOptions & { enabled: boolean } = { enabled: false, ...DEFAULT_PRESENCE_OPTIONS };
/** Seite im Launcher („Stöbert im Addon-Store“), von der Oberfläche gemeldet */
let presenceView: LauncherView = 'home';
const PRESENCE_VIEWS: readonly LauncherView[] = ['home', 'instances', 'store', 'friends', 'profile', 'settings', 'console', 'setup'];
/** Zeit „seit“ ab Betreten des aktuellen Servers bzw. der Welt, zufällige Party-ID je Ziel */
const presenceTracker = new PresenceTracker();
/** eigener Spieler (aktives Konto) für das kleine Bild und Name/Cape im Hover-Text */
let presencePlayer: { uuid: string; name: string } | null = null;
let presenceCape: string | null = null;
/** Bilder kommen von der Webseite (Discord lädt https-Links), sonst Asset-Schlüssel discord-logo */
const DISCORD_IMAGE_BASE = /^https:\/\//i.test(WEBSITE_URL) ? WEBSITE_URL : null;
const heads = new PublicHeads(HELDIX_SERVICE_URL, () => updatePresence());
let discordPreview: DiscordPreview | null = null;
/** nur der neueste Stand kommt nach Discord (die Links für die Knöpfe kommen asynchron) */
let presenceSeq = 0;

function presenceInput(): PresenceInput {
  const status = presence.status;
  const { since, partyId } = presenceTracker.next(presence.phase, status);
  const worldAddress = presence.phase === 'running' ? sharedWorldAddress(status) : null;
  const code = worldCodeOf(worldAddress);
  // öffentliche Welt-Info (Name des Gastgebers, Zugang) aus dem Speicher; fehlt sie, kommt sie gleich nach
  const info = code ? worlds.cachedPublicWorld(code, () => updatePresence()) : null;
  const instance = presence.instance;
  return {
    phase: presence.phase,
    view: anyWindowVisible() ? presenceView : null,
    minecraft: instance?.minecraft,
    loader: instance?.loader,
    heldixClient: instance ? usesHeldixClient(instance) : undefined,
    startedAt: presence.startedAt,
    since,
    status,
    showServer: presenceSettings.showServer,
    options: presenceSettings,
    clientVersion: LAUNCHER_VERSION,
    imageBase: DISCORD_IMAGE_BASE,
    // Kopf nur prüfen, wenn der Status an ist (sonst fragt der Launcher den Dienst gar nicht erst)
    player: presencePlayer ? { name: presencePlayer.name, head: presenceSettings.enabled && presenceSettings.showHead ? heads.url(presencePlayer.uuid) : null, cape: presenceCape } : null,
    world: info && code ? { code, hostName: info.host.name, online: info.online, players: info.players, maxPlayers: info.maxPlayers, access: info.access } : null,
    partyId,
  };
}

function updatePresence(next?: PresenceState): void {
  if (next) presence = next;
  if (presenceSettings.enabled) discord.start();
  else void discord.stop();
  const input = presenceInput();
  const seq = ++presenceSeq;
  const publish = (buttons: DiscordButton[]) => {
    if (seq !== presenceSeq) return;
    const activity = buildActivity({ ...input, buttons });
    if (presenceSettings.enabled) discord.setActivity(activity);
    // Vorschau in den Einstellungen – auch, wenn der Status aus ist („so sähe er aus“)
    discordPreview = previewOf(activity, presenceSettings.enabled, presencePlayer);
    broadcast('discord:preview', discordPreview);
  };
  if (!presenceSettings.buttons || presenceSettings.minimal) {
    publish([]);
    return;
  }
  // Knöpfe „Mitspielen“ / „HeldixClient holen“: Einladungen aus dem Speicher (fehlende kommen im Hintergrund nach,
  // dann ruft invites.onLinks diese Funktion noch einmal); ohne Anmeldung beim Dienst keine Einladungsknöpfe.
  // Geteilte Welten mit Zugang „offen“ bekommen „Mitspielen“ mit dem Link zur Welt-Seite der Webseite.
  const worldJoin = presenceJoinWorld(input);
  void invites.presenceLinks(worldJoin ? null : presenceJoinServer(input))
    .catch(() => ({ general: null, server: null }))
    .then((links) => publish(presenceButtons(input, { ...links, world: worldJoin ? worldWebUrl(WEBSITE_URL, worldJoin) : null })));
}

function applyPresenceSettings(settings: Settings): void {
  presenceSettings = {
    enabled: settings.discordPresence,
    showServer: settings.discordShowServer,
    showDetails: settings.discordShowDetails,
    showWorldName: settings.discordShowWorldName,
    showParty: settings.discordShowParty,
    showVoice: settings.discordShowVoice,
    showHead: settings.discordShowHead,
    buttons: settings.discordInviteButtons,
    minimal: settings.discordMinimal,
  };
  updatePresence();
}

/** Spieler für das kleine Bild neu bestimmen (Kontowechsel); Cape-Name für den Hover-Text kommt im Hintergrund */
let presenceCapeLoad = 0;
async function refreshPresencePlayer(loadCape = true): Promise<void> {
  const account = await store.getActiveAccount().catch(() => null);
  const uuid = account?.uuid.replace(/-/g, '').toLowerCase() ?? '';
  const changed = presencePlayer?.uuid !== uuid;
  presencePlayer = account && /^[0-9a-f]{32}$/.test(uuid) ? { uuid, name: account.name } : null;
  if (changed) presenceCape = null;
  updatePresence();
  const token = ++presenceCapeLoad;
  if (!loadCape || !presencePlayer || !presenceSettings.enabled || !presenceSettings.showHead || !(await social.canAuthenticate().catch(() => false))) return;
  try {
    const state = await cosmetics.state();
    const cape = state.selection?.cape ?? null;
    const name = cape ? (state.items.find((i) => i.id === cape)?.name ?? (await loadCapes()).find((c) => c.id === cape)?.name ?? null) : null;
    if (token !== presenceCapeLoad || name === presenceCape) return;
    presenceCape = name;
    updatePresence();
  } catch {
    // ohne Cape im Hover-Text
  }
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

/**
 * Offline-Konten nur beim Entwickeln (npm start). Die fertige App kennt sie nicht: gespielt wird mit dem
 * Microsoft-Konto, mit dem Minecraft gekauft wurde (die Store-Klasse blendet alte Offline-Konten dort aus).
 */
function offlineAllowed(): boolean {
  return isDev;
}

/** Sitzungen je Konto; laufende Erneuerungen teilen sich Spielstart, Freunde, Skins und der Konto-Wechsel im Spiel */
const sessions = new SessionManager<StoredAccount>({
  secrets: (account) => store.secrets(account),
  save: (session) => store.upsertMicrosoft(session, false),
  clientId: MICROSOFT_CLIENT_ID,
  refreshMicrosoft,
  loginMinecraft,
  offlineAllowed,
  log: (text) => launcherLog(text),
});

/**
 * Gültige Sitzung für ein Konto, bei Bedarf erneuert. interactive = false (Freunde, Skins & Capes im Hintergrund):
 * nie den Minecraft Launcher öffnen – über ihn angemeldete Konten melden dann nur, dass die Anmeldung abgelaufen ist.
 */
async function sessionFor(account: StoredAccount, _interactive = true): Promise<GameAccount> {
  return sessions.sessionFor(account);
}

/** Eine Microsoft-Anmeldung zur Zeit (Launcher und Spiel teilen sich das Fenster) */
let signInFlight: Promise<MicrosoftTokens> | null = null;

/** fromGame: aus dem laufenden Spiel – eigenes Fenster über allem statt eines Dialogs am (oft versteckten) Launcher */
function microsoftSignIn(fromGame: boolean): Promise<MicrosoftTokens> {
  if (!MICROSOFT_CLIENT_ID) {
    return Promise.reject(new Error('Microsoft-Login ist noch nicht eingerichtet: Client-ID in src/main/config.ts eintragen (siehe README).'));
  }
  signInFlight ??= interactiveMicrosoftLogin(fromGame ? null : mainWindow, MICROSOFT_CLIENT_ID, MICROSOFT_REDIRECT_URI, { onTop: fromGame })
    .finally(() => (signInFlight = null));
  return signInFlight;
}

/**
 * Konto-Wechsel aus dem Spiel (Protokoll: docs/konto-wechsel.md). write schreibt eine Zeile auf stdin des Spiels.
 * game: Startkonto (braucht keine Bestätigung) und Name der Instanz (steht im Bestätigungsfenster).
 */
function createGameBridge(write: (line: string) => boolean, game: { accountId: string; instanceName: string }): AccountBridge {
  return new AccountBridge({
    allowed: async () => (await store.getSettings()).gameAccountSwitch,
    launchedAccountId: game.accountId,
    confirmSwitch: (account) => confirmOnTop({
      title: `Im Spiel zu ${account.name} wechseln?`,
      message: 'Das laufende Spiel möchte zu diesem Konto wechseln. Wenn du das nicht selbst im Spiel ausgelöst hast, wähle „Abbrechen“.',
      detail: `Instanz: ${game.instanceName}`,
      confirm: 'Wechseln',
      cancel: 'Abbrechen',
    }),
    listAccounts: () => store.listAccounts(),
    session: async (id) => {
      const account = await store.getAccount(id);
      if (!account) throw new Error('Dieses Konto gibt es im Launcher nicht (mehr).');
      return sessionFor(account);
    },
    signIn: async () => {
      const tokens = await microsoftSignIn(true);
      // nicht aktiv machen: ob gewechselt wird, entscheidet das Spiel (accounts.setActive)
      const account = await store.upsertMicrosoft(await loginMinecraft(tokens), false);
      accountsChanged();
      broadcast('accounts:changed', null);
      return (await store.listAccounts()).find((a) => a.id === account.id) ?? { ...toAccountInfo(account), active: false };
    },
    setActive: async (id) => {
      await store.select(id);
      accountsChanged();
      broadcast('accounts:changed', null);
    },
    offlineAllowed,
    launcherVersion: LAUNCHER_VERSION,
    log: (text, level) => launcherLog(`Spiel: ${text}`, level),
  }, write);
}

function toAccountInfo(account: StoredAccount): AccountInfo {
  return { id: account.id, type: account.type, name: account.name, uuid: account.uuid, skinUrl: account.skinUrl, via: account.source, active: true };
}

function focusWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // während der Prüfung beim Start noch kein Hauptfenster (es kommt danach; Links holt es beim Laden ab). Unsichtbar
    // gestartet bzw. auf dem Mac geschlossen: jetzt entsteht es (es zeigt sich, sobald es geladen ist).
    if (!windowAllowed) return;
    createWindow();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  closedToTray = false;
  // das Symbol im Infobereich bleibt nur, solange ein Spiel läuft
  if (!gameRunning()) destroyTray();
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
  onUpdate: (overview) => {
    broadcast('social:update', overview);
    watchFriends(overview);
    watchParty(overview);
    // bei Freunden tut sich etwas (online, Welt geöffnet …): offene Welten gleich nachsehen
    worldsSoon();
    void updateTray();
    // Zähler in Taskleiste bzw. Dock: ungelesene Nachrichten + offene Anfragen
    updateAttention();
  },
  wantNotices: async () => (await store.getSettings()).socialNotifications && BrowserWindow.getFocusedWindow() === null && !heldixGameRunning(),
  onNotice: showSocialNotice,
  onHistory: (notice) => {
    void rememberSocialNotice(notice);
    // neue Nachricht, Fenster sichtbar, aber nicht im Vordergrund: Taskleiste blinkt kurz
    flashForNotice(notice);
  },
  // Echtzeit-Begleiter (/v1/ws?client=launcher): zählt beim Dienst nicht als „online im Spiel“
  onChatEvent: (event) => {
    broadcast('social:chat', event);
    if (event.kind === 'read') void markConversationRead(event.uuid);
  },
  onRealtime: handleRealtime,
  onRealtimeOpen: () => {
    void party.refresh().catch(() => undefined);
    worldsSoon();
    invites.pollNow();
    // dauerhafte Welten (Dienst 1.13.0): Stand der eigenen und betreuten Welten
    void hosting.refresh().catch(() => undefined);
  },
  skinCacheDir: path.join(paths.cache, 'player-skins'),
  log: (line) => console.log(`[Launcher] ${line}`),
});

/** Echtzeit-Nachrichten, die nicht die Freundesliste oder Unterhaltungen betreffen */
function handleRealtime(message: Record<string, unknown>): void {
  if (party.handle(message)) return;
  if (worlds.handleRealtime(message)) return;
  if (hosting.handleRealtime(message)) return;
  switch (message.type) {
    case 'world-invite':
      showWorldInvite(message.world);
      return;
    case 'unlock':
    case 'invite':
      // Freischaltung bzw. angenommene/bestätigte Einladung: gleich vergleichen (Meldung genau einmal, siehe core/invites.ts)
      invites.pollNow();
      return;
    default:
      // support, addon-review, … zeigt der Launcher (noch) nicht
      return;
  }
}

/** Konto gewechselt, hinzugefügt oder entfernt: Freunde sofort neu laden, dem laufenden Spiel Bescheid sagen */
function accountsChanged(): void {
  social.refresh().catch(() => undefined);
  gameBridge?.notifyChanged();
  // Discord-Knöpfe und Kopf gehören zum Konto, die Benachrichtigungen auch
  void refreshPresencePlayer();
  worldsSoon();
  void hosting.refresh().catch(() => undefined);
  void pushNotifications();
}

/** Benachrichtigungen bis zum Klick festhalten (sonst räumt der Garbage Collector sie samt Klick-Handler weg) */
const notifications = new Set<Notification>();

/** Systembenachrichtigung mit Klick; im laufenden HeldixClient-Spiel und bei „Nicht stören“ nicht (die Glocke sammelt weiter) */
async function systemNotice(title: string, body: string, onClick: () => void): Promise<void> {
  const settings = await store.getSettings().catch(() => null);
  if (!settings?.socialNotifications || !Notification.isSupported() || heldixGameRunning() || social.doNotDisturb) return;
  const notification = new Notification({ title, body });
  notifications.add(notification);
  notification.on('click', () => {
    notifications.delete(notification);
    onClick();
  });
  notification.on('close', () => notifications.delete(notification));
  notification.show();
}

function showSocialNotice(notice: SocialNotice): void {
  if (!Notification.isSupported()) return;
  const notification =
    notice.kind === 'request'
      ? new Notification({ title: `${notice.name} möchte mit dir befreundet sein`, body: 'Unter Freunde annehmen oder ablehnen.' })
      : notice.kind === 'online'
        ? new Notification({ title: `${notice.name} ist online`, body: 'Schreib ihm oder lade ihn in deine Party ein.' })
        : new Notification({ title: `Neue Nachricht von ${notice.name}`, body: notice.text ?? '' });
  notifications.add(notification);
  notification.on('click', () => {
    notifications.delete(notification);
    openSocial(notice.kind === 'request' ? null : notice.uuid);
  });
  notification.on('close', () => notifications.delete(notification));
  notification.show();
}

/** Unterhaltung gelesen (hier oder in einem anderen Client): „Neue Nachricht von …“ in der Glocke gelesen */
async function markConversationRead(uuid: string): Promise<void> {
  try {
    await notificationStore.markKeyRead(`message:${uuid}`, await activeAccountId());
  } catch {
    // egal
  }
}

/** Nachricht senden; mit Karte ohne Text: Rückfall-Text für ältere Clients (z. B. „Komm auf mc.example.de“) */
async function sendChatMessage(uuid: unknown, rawText: unknown, rawExtra: unknown) {
  const extra = rawExtra && typeof rawExtra === 'object' ? (rawExtra as Record<string, unknown>) : {};
  const card: MessageCard | null = extra.card ? checkCard(extra.card, inviteServer) : null;
  let text = typeof rawText === 'string' ? rawText : '';
  if (card && !text.trim()) {
    const address = card.kind === 'world' ? worlds.ownWorlds().find((w) => w.code === card.target)?.address ?? null : null;
    text = cardFallbackText(card, address);
  }
  return social.sendMessage(uuid, text, { replyTo: extra.replyTo, card });
}

/** Einladung in eine geteilte Welt (Echtzeit world-invite): Glocke und – im Hintergrund – Benachrichtigung */
function showWorldInvite(raw: unknown): void {
  const invite = mapWorldInvite(raw);
  if (!invite) return;
  const title = `${invite.host.name} lädt dich in eine Welt ein`;
  const body = `„${invite.name}“ – beitreten kannst du, sobald sie geöffnet ist.`;
  void remember({ kind: 'world-invite', title, body, target: { view: 'world', code: invite.code }, key: `world-invite:${invite.id}` }, true);
  worldsSoon();
  if (BrowserWindow.getFocusedWindow()) return;
  void systemNotice(title, `${body} Klicken zum Ansehen.`, () => receiveWorld(invite.code));
}

// ---------- Party (Heldix-Dienst ab 1.12.0, siehe core/party.ts) ----------

const party = new PartyClient({
  auth: HELDIX_SERVICE_URL ? social : null,
  enabled: async () => (await store.getSettings()).social,
  onUpdate: (state) => {
    broadcast('party:update', state);
    void updateTray();
  },
  onEvent: (event) => void showPartyEvent(event),
  log: (line) => console.log(`[Launcher] ${line}`),
});

/** angemeldeter Spieler, für den die Party zuletzt geladen wurde */
let partyFor: string | null = null;

/** Freunde verbunden, getrennt oder Kontowechsel: Party passend laden bzw. verwerfen */
function watchParty(overview: SocialOverview): void {
  const me = overview.status === 'online' ? overview.me?.uuid ?? null : null;
  if (overview.status === 'connecting' || overview.status === 'error') return;
  if (me === partyFor) return;
  partyFor = me;
  party.reset();
  if (me) void party.refresh().catch(() => undefined);
}

// Rückfall ohne Echtzeit-Verbindung: Party alle 30 s, solange ein Fenster sichtbar ist
setInterval(() => {
  if (partyFor && social.realtime !== 'live' && anyWindowVisible()) void party.refresh().catch(() => undefined);
}, 30_000).unref();

async function showPartyEvent(event: PartyEvent): Promise<void> {
  if (event.kind === 'invite') {
    const { invite } = event;
    const title = `${invite.from.name} lädt dich in die Party ein`;
    const body = invite.members > 1 ? `${invite.members} sind schon dabei – annehmen unter Freunde.` : 'Annehmen unter Freunde.';
    void remember({ kind: 'party-invite', title, body, target: { view: 'party' }, key: `party-invite:${invite.party}` }, true);
    if (invite.quiet || BrowserWindow.getFocusedWindow()) return;
    void systemNotice(title, body, () => sendWhenReady('party:open', null));
    return;
  }
  if (event.kind !== 'follow') return;
  const settings = await store.getSettings();
  const action = followAction({ autoFollow: settings.partyAutoFollow, gameRunning: gameRunning(), here: party.myLocation()?.address ?? null, target: event.target });
  if (action === 'none') return;
  const follow: PartyFollow = { party: event.party, leader: event.leader, target: event.target, joined: false };
  if (action === 'join') {
    try {
      const result = await joinPartyTarget(event.target);
      follow.joined = true;
      launcherLog(`Party: folge ${event.leader.name} (${result.instanceName})`);
      void remember({ kind: 'party-follow', title: `Du folgst ${event.leader.name}`, body: `${locationText(event.target)} – ${result.instanceName} startet.`, target: { view: 'party' }, key: `party-follow:${event.party}` }, true);
      broadcast('party:follow', follow);
      return;
    } catch (error) {
      launcherLog(`Party: automatisch folgen ging nicht – ${error instanceof Error ? error.message : String(error)}`, 'WARN');
    }
  }
  const title = `${event.leader.name} ist ${event.target.kind === 'world' ? 'in' : 'auf'} ${event.target.kind === 'world' ? `„${event.target.title}“` : event.target.title}`;
  void remember({ kind: 'party-follow', title, body: 'Beitreten mit einem Klick unter Freunde → Party.', target: { view: 'party' }, key: `party-follow:${event.party}` }, true);
  if (BrowserWindow.getFocusedWindow()) {
    if (!social.doNotDisturb) broadcast('party:follow', follow);
    return;
  }
  void systemNotice(title, 'Klicken zum Beitreten.', () => sendWhenReady('party:follow', follow));
}

/** Dem Leiter folgen (bzw. dem angegebenen Ort): geteilte Welt mit passender Instanz, Server per Quick Play */
async function joinPartyTarget(target?: PartyLocation | null): Promise<{ instanceName: string; title: string }> {
  const location = target ?? party.current.party?.target ?? null;
  if (!location) throw new Error('Der Leiter der Party ist gerade auf keinem Server und in keiner geteilten Welt.');
  if (location.kind === 'world') {
    const result = await joinWorld(location.target);
    return { instanceName: result.instanceName, title: location.title };
  }
  const result = await joinServerAddress(location.address);
  return { instanceName: result.instanceName, title: location.title };
}

/**
 * Einem Server beitreten (Server-Karte im Chat, Party): öffentliche Domain (inviteServer), zuletzt gespielte Instanz mit
 * HeldixClient, Quick Play – auch wenn der Server nicht in der Serverliste steht (wie „Annehmen und beitreten“).
 */
async function joinServerAddress(raw: unknown): Promise<{ instanceId: string; instanceName: string; server: string }> {
  const server = inviteServer(raw);
  if (!server) throw new Error('Diesen Server kann der Launcher nicht direkt öffnen – nur öffentliche Adressen wie play.example.de.');
  const checked = await inviteJoinTarget();
  if (checked.problem || !checked.instance) throw new Error(checked.problem ?? 'Zum Beitreten brauchst du eine Instanz mit HeldixClient.');
  launcherLog(`Beitreten: ${checked.instance.name} startet und verbindet mit ${server}`);
  // Fortschritt und Fehler zeigt die Startseite (game:state)
  void launch(checked.instance.id, { kind: 'server', id: server }).catch(() => undefined);
  return { instanceId: checked.instance.id, instanceName: checked.instance.name, server };
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
  // in einer geteilten Welt (als Gastgeber oder Mitspieler): Welt mit passender Minecraft-Version betreten
  const hosted = worlds.worldOf(friend.uuid);
  const guestIn = worldCodeOf(friend.server);
  if (hosted || guestIn) {
    await joinWorld(hosted?.code ?? guestIn);
    return;
  }
  const server = joinableServer(friend);
  if (!server) throw new Error(`${friend.name} spielt gerade auf keinem Server, dem du folgen kannst.`);
  if (gameRunning()) throw new Error('Es läuft schon ein Spiel – im Spiel über Freunde → Beitreten.');
  const wanted = typeof rawInstanceId === 'string' && rawInstanceId ? await instances.require(rawInstanceId) : await selectedInstance().catch(() => null);
  const instance = pickJoinInstance(await instances.list(), wanted, usesHeldixClient);
  if (!instance) throw new Error('Zum Beitreten brauchst du eine Instanz mit HeldixClient.');
  launcherLog(`${friend.name} beitreten: ${server}`);
  await launch(instance.id, { kind: 'server', id: server });
}

// ---------- Einladungen und Beitreten-Links (siehe core/invites.ts) ----------

const invites = new InviteService({
  serviceUrl: HELDIX_SERVICE_URL,
  auth: HELDIX_SERVICE_URL ? social : null,
  enabled: async () => (await store.getSettings()).social,
  cosmeticNames: async () => Object.fromEntries((await cosmetics.catalog()).items.map((item) => [item.id, item.name])),
  onEvent: showInviteEvent,
  onLinks: () => updatePresence(),
  log: (line) => console.log(`[Launcher] ${line}`),
});

/** Freunde beim letzten Stand: kommt einer dazu, war es vielleicht eine angenommene Einladung */
let knownFriends: { me: string; uuids: Set<string> } | null = null;

function watchFriends(overview: SocialOverview): void {
  if (overview.status !== 'online' || !overview.me) return;
  const before = knownFriends;
  knownFriends = { me: overview.me.uuid, uuids: new Set(overview.friends.map((f) => f.uuid)) };
  if (!before || before.me !== overview.me.uuid) return;
  invites.friendsAdded(overview.friends.filter((f) => !before.uuids.has(f.uuid)).map((f) => f.name));
}

/** Läuft gerade ein Spiel mit HeldixClient? Dann zeigt das Spiel Freischaltungen selbst (Realtime). */
function heldixGameRunning(): boolean {
  return gameRunning() && !!presence.instance && usesHeldixClient(presence.instance);
}

/** Neues bei den Einladungen: im Vordergrund als Hinweis in der Oberfläche, sonst als Benachrichtigung */
function showInviteEvent(event: InviteEvent): void {
  void rememberInviteEvent(event);
  if (event.kind === 'unlock') broadcast('cosmetics:changed', null);
  if (BrowserWindow.getFocusedWindow()) {
    broadcast('invites:event', event);
    return;
  }
  void store.getSettings().then((settings) => {
    if (!settings.socialNotifications || !Notification.isSupported() || heldixGameRunning() || social.doNotDisturb) return;
    let notification: Notification;
    if (event.kind === 'unlock') {
      notification = new Notification({ title: `Neues Cosmetic freigeschaltet: ${event.name}`, body: 'Belohnung für deine Einladungen – leg es unter Skins & Cosmetics an.' });
    } else if (event.kind === 'accepted') {
      const title = event.name ? `${event.name} hat deine Einladung angenommen` : event.count > 1 ? `${event.count} Freunde haben deine Einladung angenommen` : 'Deine Einladung wurde angenommen';
      notification = new Notification({ title, body: 'Ihr seid jetzt Freunde. Nach 30 Minuten Spielzeit zählt die Einladung als bestätigt.' });
    } else {
      notification = new Notification({ title: event.count > 1 ? `${event.count} Einladungen bestätigt` : 'Einladung bestätigt', body: 'Ein eingeladener Freund hat 30 Minuten mit HeldixClient gespielt.' });
    }
    notifications.add(notification);
    notification.on('click', () => {
      notifications.delete(notification);
      if (event.kind === 'unlock') sendWhenReady('cosmetics:open', event.cosmetic);
      else sendWhenReady('invites:open', null);
    });
    notification.on('close', () => notifications.delete(notification));
    notification.show();
  }).catch(() => undefined);
}

/** Geöffneter Link heldixclient://einladung/<code>, bis die Oberfläche ihn abholt (invites:take) */
let pendingInvite: string | null = findInviteLink(process.argv);

/**
 * Einladung aus dem Download, deren Datei noch liegt: Sie wird erst gelöscht, wenn die Oberfläche die Einladung abholt
 * (Dialog) oder ein neuerer Link sie ersetzt – schließt man den Launcher mitten im Einrichtungs-Assistenten, kommt sie
 * beim nächsten Start wieder.
 */
let downloadInviteFile: string | null = null;

function dropDownloadInvite(): void {
  if (!downloadInviteFile) return;
  void finishDownloadInvite(downloadInviteFile).catch(() => undefined);
  downloadInviteFile = null;
}

/** Link aus second-instance oder open-url: merken und die Oberfläche bitten, ihn abzuholen */
function receiveInvite(code: string | null): void {
  if (!code) return;
  if (code !== pendingInvite) dropDownloadInvite();
  pendingInvite = code;
  launcherLog('Einladungslink geöffnet');
  if (app.isReady()) sendWhenReady('invite:open', null);
}

/** zuletzt im Dialog gezeigte Einladungen, damit „beitreten“ genau zum gezeigten Server geht */
const shownInvites = new Map<string, { server: string | null; inviter: { uuid: string; name: string } }>();

async function inviteJoinTarget(): Promise<{ instance: InstanceConfig | null; problem: string | null }> {
  const instance = pickInviteInstance(await instances.list(), await selectedInstance().catch(() => null), usesHeldixClient);
  if (!instance) return { instance: null, problem: 'Zum Beitreten brauchst du eine Instanz mit HeldixClient. Leg unter „Instanzen“ eine an – danach klappt der Link.' };
  if (gameRunning()) return { instance, problem: 'Es läuft schon ein Spiel. Beende es oder tritt im Spiel über Freunde bei.' };
  return { instance, problem: null };
}

async function publicInviteView(rawCode: unknown): Promise<PublicInviteView> {
  const code = inviteCode(rawCode);
  const account = await store.getActiveAccount();
  const view: PublicInviteView = {
    code,
    status: 'ok',
    error: null,
    inviter: null,
    server: null,
    voice: null,
    expires: 0,
    welcome: null,
    account: account ? { name: account.name, type: account.type } : null,
    acceptProblem: null,
    join: null,
    joinProblem: null,
  };
  let invite: PublicInvite;
  try {
    invite = await invites.publicInvite(code);
  } catch (error) {
    if (isMissing(error)) return { ...view, status: 'missing' };
    return { ...view, status: 'error', error: error instanceof Error ? error.message : String(error) };
  }
  shownInvites.set(code, { server: invite.server, inviter: invite.inviter });
  const names = await cosmetics.catalog().then((c) => c.items, () => []);
  view.inviter = invite.inviter;
  view.server = invite.server;
  view.voice = invite.voice;
  view.expires = invite.expires;
  view.welcome = invite.welcome ? { id: invite.welcome, name: rewardName(invite.welcome, names.find((i) => i.id === invite.welcome)?.name) } : null;
  if (!account) view.acceptProblem = 'Zum Annehmen brauchst du ein Microsoft-Konto im Launcher.';
  else if (account.type === 'offline' && !SERVICE_DEV_AUTH) view.acceptProblem = 'Einladungen annehmen geht nur mit einem Microsoft-Konto.';
  else if (account.uuid.replace(/-/g, '').toLowerCase() === invite.inviter.uuid) view.acceptProblem = 'Das ist deine eigene Einladung – schick den Link an deine Freunde.';
  if (invite.server) {
    const target = await inviteJoinTarget();
    view.join = target.instance ? { instanceId: target.instance.id, instanceName: target.instance.name } : null;
    view.joinProblem = target.problem;
  }
  return view;
}

/**
 * Annehmen und auf Wunsch beitreten. Beitreten geht eigene Wege neben validateQuickPlay: der Server muss nicht in der
 * Serverliste der Instanz stehen, aber eine öffentliche Domain sein (inviteServer) und zu dem passen, was der Dialog
 * gezeigt hat. Erst wird geprüft, ob Beitreten geht, dann angenommen, dann gestartet.
 */
async function acceptInvite(rawCode: unknown, rawJoin: unknown): Promise<InviteAcceptView> {
  const code = inviteCode(rawCode);
  const join = rawJoin === true;
  const before = shownInvites.get(code);
  let shown = before?.server ?? null;
  let inviter = before?.inviter;
  if (!before || join) {
    const invite = await invites.publicInvite(code).catch((error: unknown) => {
      if (isMissing(error)) throw new Error('Diese Einladung gibt es nicht (mehr). Vielleicht ist sie abgelaufen oder wurde zurückgenommen.');
      throw error;
    });
    if (join && before && before.server !== invite.server) throw new Error('Die Einladung hat sich geändert – bitte den Link noch einmal öffnen.');
    shown = invite.server;
    inviter = invite.inviter;
    shownInvites.set(code, { server: invite.server, inviter: invite.inviter });
  }
  const account = await store.getActiveAccount();
  if (account && inviter && account.uuid.replace(/-/g, '').toLowerCase() === inviter.uuid) throw new Error('Das ist deine eigene Einladung – schick den Link an deine Freunde.');
  let target: InstanceConfig | null = null;
  if (join) {
    if (!shown) throw new Error('Diese Einladung hat keinen Server zum Beitreten.');
    const checked = await inviteJoinTarget();
    if (checked.problem) throw new Error(checked.problem);
    target = checked.instance;
  }
  const result = await invites.accept(code, inviter);
  launcherLog(`Einladung von ${result.inviter.name} angenommen`);
  void social.refresh().catch(() => undefined);
  let reward: InviteAcceptView['reward'] = null;
  if (result.reward) {
    reward = { id: result.reward, name: rewardName(result.reward, (await cosmetics.catalog().catch(() => ({ items: [] }))).items.find((i) => i.id === result.reward)?.name) };
    broadcast('cosmetics:changed', null);
  }
  const view: InviteAcceptView = { ...result, reward, notes: acceptNotes(result, reward?.name ?? null), joined: null, joinError: null };
  if (join && target) {
    const server = inviteServer(result.server ?? shown);
    if (!server || server !== inviteServer(shown)) {
      view.joinError = 'Die Serveradresse der Einladung ist ungültig – beitreten geht nicht.';
    } else if (gameRunning()) {
      view.joinError = 'Es läuft schon ein Spiel. Beende es oder tritt im Spiel über Freunde bei.';
    } else {
      launcherLog(`Einladung: ${target.name} startet und verbindet mit ${server}`);
      view.joined = { instanceId: target.id, instanceName: target.name, server };
      // Fortschritt und Fehler zeigt die Startseite (game:state)
      void launch(target.id, { kind: 'server', id: server }).catch(() => undefined);
    }
  }
  return view;
}

// ---------- Welt teilen: offene Welten der Freunde und Beitreten (siehe core/worlds.ts) ----------

const worlds = new WorldClient({
  serviceUrl: HELDIX_SERVICE_URL,
  auth: HELDIX_SERVICE_URL ? social : null,
  enabled: async () => (await store.getSettings()).social,
  visible: anyWindowVisible,
  onUpdate: (overview) => {
    broadcast('worlds:update', overview);
    void updateTray();
  },
  onEvent: showWorldEvent,
  // dauerhafte Welten (Dienst 1.13.0): als Operator betreute und die von Freunden aus Entdecken, mit Zustand
  extraWorlds: () => {
    const friends = new Set(social.current.status === 'online' ? social.current.friends.map((f) => f.uuid) : []);
    return [...hosting.operatedWorlds().map(hostedAsFriendWorld), ...discover.persistentOf(friends).map(discoverAsFriendWorld)];
  },
  log: (line) => console.log(`[Launcher] ${line}`),
});

// ---------- Dauerhafte Welten und Entdecken (Heldix-Dienst ab 1.13.0, siehe core/hosting.ts, core/discover.ts) ----------

const hosting = new HostingClient({
  auth: HELDIX_SERVICE_URL ? social : null,
  enabled: async () => (await store.getSettings()).social,
  onChange: () => worlds.extrasChanged(),
  onEvent: (event) => void showHostingEvent(event),
  log: (line) => console.log(`[Launcher] ${line}`),
});

const discover = new DiscoverClient({
  serviceUrl: HELDIX_SERVICE_URL,
  onUpdate: (popular) => {
    broadcast('discover:update', popular);
    worlds.extrasChanged();
  },
  log: (line) => console.log(`[Launcher] ${line}`),
});

/**
 * Webseite angemeldet öffnen (Einmal-Link), auf Wunsch mit einem Bereich der Konto-Seite. „welten“ (Meine Welten) kennt
 * der Dienst beim Einmal-Link nicht; die Konto-Seite liest das Ziel aber aus dem Fragment – deshalb hängt der Launcher es
 * selbst an (#code=…&ziel=welten).
 */
async function openWebAccount(rawTarget?: unknown): Promise<void> {
  const targets = ['profil', 'freunde', 'nachrichten', 'privatsphaere', 'daten', 'support', 'team'];
  const fragmentTargets = ['welten'];
  const target = typeof rawTarget === 'string' && targets.includes(rawTarget) ? rawTarget : undefined;
  const fragment = typeof rawTarget === 'string' && fragmentTargets.includes(rawTarget) ? rawTarget : undefined;
  const account = await store.getActiveAccount();
  if (!account) throw new Error('Bitte zuerst ein Konto hinzufügen.');
  // Offline-Konten haben keine Mojang-Anmeldung; nur zum Testen gegen einen lokalen Dienst (HELDIX_WEB_LOGIN_DEV=1)
  const devAuth = process.env.HELDIX_WEB_LOGIN_DEV === '1';
  if (account.type === 'offline' && !devAuth) throw new Error('Für die Webseite brauchst du ein Microsoft-Konto.');
  const session = await sessionFor(account);
  let url = await webLoginUrl(HELDIX_SERVICE_URL, session, devAuth, target, { sessionServer: MOJANG_TEST_URL ?? undefined });
  if (fragment && url.includes('#code=') && !url.includes('ziel=')) url = `${url}&ziel=${fragment}`;
  await shell.openExternal(url);
}

/** Glocke (und im Hintergrund eine Benachrichtigung): freigeschaltet, Fehler der eigenen Welt, Anklopfen ohne Spiel */
async function showHostingEvent(event: HostingEvent): Promise<void> {
  const openWeb = () => void openWebAccount('welten').catch((error) => launcherLog(`Webseite nicht geöffnet: ${error instanceof Error ? error.message : String(error)}`, 'WARN'));
  if (event.kind === 'granted') {
    const title = 'Du kannst jetzt dauerhafte Welten anlegen';
    const body = 'Deine Welt läuft dann auf dem Heldix-Server, auch wenn du offline bist – im Spiel unter Heldix-Welten → „Dauerhaft online stellen“.';
    await remember({ kind: 'hosting-granted', title, body, target: { view: 'hosting' }, key: 'hosting-granted', once: true }, true);
    // gesehen: der Dienst schickt den Hinweis dann nicht bei jeder Verbindung erneut
    void social.authed('/v1/plus/seen', { method: 'POST' }, { quiet: true }).catch(() => undefined);
    if (!BrowserWindow.getFocusedWindow()) void systemNotice(title, body, openWeb);
    return;
  }
  if (event.kind === 'problem') {
    const title = `„${event.world.name}“ hat ein Problem`;
    await remember({ kind: 'hosting-problem', title, body: `${event.error} Klicken: auf der Webseite ansehen.`, target: { view: 'hosting' }, key: `hosting-problem:${event.world.id}` }, true);
    if (!BrowserWindow.getFocusedWindow()) void systemNotice(title, event.error, openWeb);
    return;
  }
  // Anklopfen: im laufenden Spiel zeigt die Mod die Einblendung mit den Tasten
  if (heldixGameRunning()) return;
  const title = `${event.name} möchte in „${event.world.name}“`;
  const body = 'Klicken: auf der Webseite erlauben oder ablehnen (Konto → Meine Welten).';
  await remember({ kind: 'hosting-knock', title, body, target: { view: 'hosting' }, key: `hosting-knock:${event.world.id}:${event.name.toLowerCase()}` }, true);
  if (!BrowserWindow.getFocusedWindow()) void systemNotice(title, body, openWeb);
}

/** Offene Welten bald neu laden (mehrere Anlässe kurz hintereinander = eine Abfrage) */
let worldsTimer: NodeJS.Timeout | null = null;
function worldsSoon(): void {
  if (worldsTimer) return;
  worldsTimer = setTimeout(() => {
    worldsTimer = null;
    void worlds.refresh().catch(() => undefined);
  }, 1500);
  worldsTimer.unref();
}

/** Ein Freund hat eine Welt geöffnet (bzw. dich eingeladen): Verlauf und – im Hintergrund – Benachrichtigung */
function showWorldEvent(event: WorldEvent): void {
  const world = event.world;
  const title = `${world.host.name} hat eine Welt geöffnet`;
  const body = `„${world.name}“ · ${world.players} von ${world.maxPlayers} Spielern${world.version ? ` · Minecraft ${world.version}` : ''}`;
  void remember({ kind: 'world-open', title, body, target: { view: 'world', code: world.code }, key: `world:${world.id}` }, true);
  if (BrowserWindow.getFocusedWindow()) return;
  void store.getSettings().then((settings) => {
    // im laufenden HeldixClient-Spiel meldet die Mod Welten selbst (Heldix-Welten, Freunde-Leiste); „Nicht stören“: nur Glocke
    if (!settings.socialNotifications || !Notification.isSupported() || heldixGameRunning() || social.doNotDisturb) return;
    const notification = new Notification({ title, body: `${body} – klicken zum Beitreten.` });
    notifications.add(notification);
    notification.on('click', () => {
      notifications.delete(notification);
      receiveWorld(world.code);
    });
    notification.on('close', () => notifications.delete(notification));
    notification.show();
  }).catch(() => undefined);
}

/** Geöffneter Link heldixclient://welt/<code>, bis die Oberfläche ihn abholt (worlds:take) */
let pendingWorld: string | null = findWorldLink(process.argv);

function receiveWorld(code: string | null): void {
  if (!code) return;
  pendingWorld = code;
  launcherLog('Welt-Link geöffnet');
  if (app.isReady()) sendWhenReady('world:open', null);
}

async function worldJoinView(rawCode: unknown): Promise<WorldJoinView> {
  const code = worldCode(rawCode);
  const view: WorldJoinView = { code, status: 'ok', error: null, world: null, join: null, joinProblem: null, friend: false };
  let world;
  try {
    world = await worlds.publicWorld(code, true);
  } catch (error) {
    if (isWorldMissing(error)) return { ...view, status: 'missing' };
    return { ...view, status: 'error', error: error instanceof Error ? error.message : String(error) };
  }
  const account = await store.getActiveAccount().catch(() => null);
  const plan = planWorldJoin({
    world,
    instances: await instances.list(),
    preferred: await selectedInstance().catch(() => null),
    hasClient: usesHeldixClient,
    gameRunning: gameRunning(),
    self: account?.uuid.replace(/-/g, '').toLowerCase() ?? null,
  });
  view.world = world;
  view.join = plan.instance ? { instanceId: plan.instance.id, instanceName: plan.instance.name, minecraft: plan.instance.minecraft } : null;
  view.joinProblem = plan.problem;
  view.friend = social.current.status === 'online' && social.current.friends.some((f) => f.uuid === world.host.uuid);
  return view;
}

/**
 * Einer geteilten Welt beitreten: frische Welt-Info, passende Instanz (Minecraft-Version der Welt, HeldixClient),
 * dann Quick Play auf <code>.welt.<Domain>. Die Adresse kommt nur vom Dienst und muss zum Code passen.
 */
async function joinWorld(rawCode: unknown): Promise<{ instanceId: string; instanceName: string; address: string }> {
  const code = worldCode(rawCode);
  const world = await worlds.publicWorld(code, true).catch((error: unknown) => {
    if (isWorldMissing(error)) throw new Error(WORLD_MISSING);
    throw error;
  });
  const account = await store.getActiveAccount();
  if (!account) throw new Error('Bitte zuerst ein Konto hinzufügen.');
  const plan = planWorldJoin({
    world,
    instances: await instances.list(),
    preferred: await selectedInstance().catch(() => null),
    hasClient: usesHeldixClient,
    gameRunning: gameRunning(),
    self: account.uuid.replace(/-/g, '').toLowerCase(),
  });
  if (plan.problem || !plan.instance) throw new Error(plan.problem ?? 'Zum Beitreten brauchst du eine Instanz mit HeldixClient.');
  const address = normalizeWorldAddress(world.address);
  if (!address || worldCodeOf(address) !== code) throw new Error('Die Adresse dieser Welt ist ungültig – beitreten geht nicht.');
  launcherLog(`Welt von ${world.host.name} beitreten: ${plan.instance.name} startet`);
  // Fortschritt und Fehler zeigt die Startseite (game:state)
  void launch(plan.instance.id, { kind: 'server', id: address }).catch(() => undefined);
  return { instanceId: plan.instance.id, instanceName: plan.instance.name, address };
}

// ---------- Benachrichtigungen: Verlauf hinter der Glocke (siehe core/notifications.ts) ----------

const notificationStore = new NotificationStore(path.join(paths.root, NOTIFICATION_FILE), {
  onChange: () => pushNotifications(),
});

async function activeAccountId(): Promise<string | null> {
  return (await store.getActiveAccount().catch(() => null))?.id ?? null;
}

function notificationList(): Promise<NotificationList> {
  return activeAccountId().then((account) => notificationStore.list(account));
}

let notificationPush: NodeJS.Timeout | null = null;
/** Stand an die Oberfläche und ins Menü im Infobereich (gebündelt) */
function pushNotifications(): void {
  if (notificationPush) return;
  notificationPush = setTimeout(() => {
    notificationPush = null;
    void notificationList().then((list) => {
      broadcast('notifications:update', list);
      void updateTray(list);
    }).catch(() => undefined);
  }, 50);
  notificationPush.unref();
}

/** In den Verlauf; forAccount = gehört zum aktiven Konto (Freunde, Einladungen), sonst für alle (Updates) */
async function remember(input: NewNotification, forAccount: boolean): Promise<void> {
  try {
    await notificationStore.add({ ...input, account: forAccount ? await activeAccountId() : null });
  } catch (error) {
    console.warn('[Launcher] Benachrichtigung nicht gemerkt:', error instanceof Error ? error.message : error);
  }
}

function rememberSocialNotice(notice: SocialNotice): Promise<void> {
  if (notice.kind === 'request') {
    return remember({ kind: 'friend-request', title: `${notice.name} möchte mit dir befreundet sein`, body: 'Unter Freunde annehmen oder ablehnen.', target: { view: 'friends' }, key: `request:${notice.uuid}` }, true);
  }
  // „ist online“ nur als Hinweis, nicht im Verlauf
  if (notice.kind === 'online') return Promise.resolve();
  return remember({
    kind: 'message',
    title: `Neue Nachricht von ${notice.name}`,
    body: notice.text ?? (notice.count > 1 ? `${notice.count} neue Nachrichten` : ''),
    target: { view: 'friends', uuid: notice.uuid },
    key: `message:${notice.uuid}`,
  }, true);
}

function rememberInviteEvent(event: InviteEvent): Promise<void> {
  if (event.kind === 'unlock') {
    return remember({ kind: 'unlock', title: `Neues Cosmetic freigeschaltet: ${event.name}`, body: 'Belohnung für deine Einladungen – leg es unter Skins & Cosmetics an.', target: { view: 'cosmetics', id: event.cosmetic }, key: `unlock:${event.cosmetic}`, once: true }, true);
  }
  if (event.kind === 'accepted') {
    const title = event.name ? `${event.name} hat deine Einladung angenommen` : event.count > 1 ? `${event.count} Freunde haben deine Einladung angenommen` : 'Deine Einladung wurde angenommen';
    return remember({ kind: 'invite-accepted', title, body: 'Ihr seid jetzt Freunde. Nach 30 Minuten Spielzeit zählt die Einladung als bestätigt.', target: { view: 'invites' } }, true);
  }
  return remember({ kind: 'invite-confirmed', title: event.count > 1 ? `${event.count} Einladungen bestätigt` : 'Einladung bestätigt', body: 'Ein eingeladener Freund hat 30 Minuten mit HeldixClient gespielt.', target: { view: 'invites' } }, true);
}

// ---------- Im Hintergrund: Infobereich (Tray), Taskleiste und Dock (Entscheidungen in core/background.ts) ----------
//
// Einstellung „Im Hintergrund bereit für Nachrichten“ (closeToTray, Standard an): Schließen blendet das Fenster aus, der
// Launcher läuft im Infobereich weiter – auch ohne Spiel –, damit Nachrichten, Anfragen, Party- und Welt-Einladungen als
// Windows-Benachrichtigung ankommen. Unsichtbar gestartet (Autostart mit --hidden) wartet er genauso dort. macOS: ohne
// Spiel bleibt HeldixClient wie jede Mac-App im Dock; während eines Spiels gibt es zusätzlich das Symbol in der Menüleiste.

let tray: Tray | null = null;
/** Fenster ist ausgeblendet und wartet im Infobereich (geschlossen oder unsichtbar gestartet) */
let closedToTray = false;
/** Einstellung „Im Hintergrund bereit für Nachrichten“ */
let closeToTraySetting = true;
let appQuitting = false;
/** Hinweis „läuft weiter“ schon gezeigt (Windows: dauerhaft in den Einstellungen, Mac: in dieser Sitzung) */
let trayHintShown = false;
/** unsichtbar gestartet (Windows-Autostart mit --hidden, Mac „Bei der Anmeldung öffnen“): kein Fenster bis zum Klick */
let launchedHidden = false;

function trayImage(): Electron.NativeImage {
  // tray.png (16 px) und tray@2x.png (32 px) liegen neben der Oberfläche (scripts/render-discord-art.mjs)
  return nativeImage.createFromPath(path.join(__dirname, '..', 'renderer', 'tray.png'));
}

/** Symbol im Infobereich: solange ein Spiel läuft und solange das Fenster im Hintergrund wartet */
function ensureTray(): void {
  if (tray) return;
  try {
    tray = new Tray(trayImage());
  } catch (error) {
    console.warn('[Launcher] Symbol im Infobereich nicht möglich:', error);
    return;
  }
  tray.on('click', () => focusWindow());
  tray.on('double-click', () => focusWindow());
  void updateTray();
}

function destroyTray(): void {
  tray?.destroy();
  tray = null;
}

function friendActivity(friend: { activity: string | null; server: string | null }): string {
  if (worldCodeOf(friend.server)) return 'In einer geteilten Welt';
  switch (friend.activity) {
    case 'multiplayer': return friend.server ? `Auf ${friend.server}` : 'Mehrspieler';
    case 'singleplayer': return 'Einzelspieler';
    case 'realms': return 'Realms';
    case 'lan': return 'LAN-Welt';
    case 'menu': return 'Im Menü';
    default: return 'Online';
  }
}

/** „Nicht stören“ aus dem Infobereich umschalten (gilt beim Dienst, also auch im Spiel und auf der Webseite) */
async function toggleDoNotDisturb(): Promise<void> {
  try {
    await social.setStatus({ dnd: !social.doNotDisturb });
  } catch (error) {
    console.warn('[Launcher] „Nicht stören“ ließ sich nicht umschalten:', error instanceof Error ? error.message : error);
  }
  void updateTray();
}

/** Menü im Infobereich: Öffnen, Freunde (online), Benachrichtigungen, Nicht stören, Beenden */
async function updateTray(list?: NotificationList): Promise<void> {
  if (!tray) return;
  const current = list ?? (await notificationList().catch((): NotificationList => ({ items: [], unread: 0 })));
  if (!tray) return;
  const overview = social.current;
  const online = overview.status === 'online' ? overview.friends.filter((f) => f.online) : [];
  const hosting = new Map(worlds.current.friends.map((w) => [w.host.uuid, w]));
  const label = (text: string) => text.replace(/&/g, '&&');
  const friendItems: MenuItemConstructorOptions[] = online.slice(0, 12).map((friend) => {
    const world = hosting.get(friend.uuid);
    return { label: label(`${friend.favorite ? '★ ' : ''}${friend.nickname || friend.name} – ${world ? `Teilt „${world.name}“` : friendActivity(friend)}`), click: () => sendWhenReady('social:open', friend.uuid) };
  });
  if (online.length > 12) friendItems.push({ label: `und ${online.length - 12} weitere`, enabled: false });
  if (friendItems.length === 0) friendItems.push({ label: overview.status === 'online' ? 'Gerade ist niemand online' : 'Freunde nicht verbunden', enabled: false });
  friendItems.push({ type: 'separator' }, { label: 'Alle Freunde', click: () => sendWhenReady('social:open', null) });
  const noteItems: MenuItemConstructorOptions[] = current.items.slice(0, 6).map((n) => ({
    label: label(`${n.read ? '' : '● '}${n.title}`),
    click: () => sendWhenReady('notifications:open', n.id),
  }));
  if (noteItems.length === 0) noteItems.push({ label: 'Keine Benachrichtigungen', enabled: false });
  noteItems.push({ type: 'separator' }, {
    label: 'Alle als gelesen markieren',
    enabled: current.unread > 0,
    click: () => void activeAccountId().then((account) => notificationStore.markAllRead(account)),
  }, { label: 'Alle anzeigen', click: () => sendWhenReady('notifications:open', null) });
  const playing = gameState.state === 'running' ? gameState.label : gameState.state === 'preparing' ? 'Minecraft wird vorbereitet' : null;
  const waiting = attentionCount(overview);
  const template: MenuItemConstructorOptions[] = [
    { label: label(playing ? `${playing} läuft` : LAUNCHER_NAME), enabled: false },
    { type: 'separator' },
    { label: `${LAUNCHER_NAME} öffnen`, click: () => focusWindow() },
    { label: online.length ? `Freunde (${online.length} online)` : 'Freunde', submenu: friendItems },
    { label: current.unread ? `Benachrichtigungen (${current.unread} neu)` : 'Benachrichtigungen', submenu: noteItems },
    { type: 'checkbox', label: 'Nicht stören', checked: social.doNotDisturb, enabled: overview.status === 'online', click: () => void toggleDoNotDisturb() },
    { type: 'separator' },
    { label: 'Beenden', click: () => void quitFromTray() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  const extra = playing ? ` – ${playing} läuft` : waiting ? ` – ${badgeDescription(overview)}` : '';
  tray.setToolTip(`${LAUNCHER_NAME}${extra}`.slice(0, 127));
}

async function quitFromTray(): Promise<void> {
  if (gameRunning()) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: LAUNCHER_NAME,
      message: 'Minecraft läuft noch. Launcher trotzdem beenden?',
      detail: 'Das Spiel läuft weiter, aber Discord-Status, Benachrichtigungen und der Kontowechsel im Spiel enden.',
      buttons: ['Beenden', 'Abbrechen'],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return;
  }
  app.quit();
}

/** Einmaliger Hinweis beim ersten Schließen in den Infobereich (Windows: einmal überhaupt, Mac: einmal je Sitzung) */
async function showTrayHint(): Promise<void> {
  if (trayHintShown) return;
  trayHintShown = true;
  if (process.platform !== 'darwin') {
    const settings = await store.getSettings().catch(() => null);
    if (!settings || settings.trayHintSeen) return;
    await store.saveSettings({ trayHintSeen: true }).catch(() => undefined);
  }
  if (!Notification.isSupported()) return;
  const text = trayHint(process.platform, LAUNCHER_NAME);
  const hint = new Notification({ title: text.title, body: text.body, silent: true });
  notifications.add(hint);
  hint.on('click', () => {
    notifications.delete(hint);
    focusWindow();
  });
  hint.on('close', () => notifications.delete(hint));
  hint.show();
}

/** Fenster ausblenden, Launcher wartet im Infobereich (Schließen mit der Einstellung an, unsichtbarer Start) */
function hideToTray(hint: boolean): void {
  mainWindow?.hide();
  closedToTray = true;
  ensureTray();
  if (hint) void showTrayHint();
}

/** Fenster schließen: mit „Im Hintergrund bereit für Nachrichten“ in den Infobereich statt beenden */
function closeIntoTray(event: Electron.Event): void {
  if (!mainWindow) return;
  const action = closeAction({ platform: process.platform, background: closeToTraySetting, gameRunning: gameRunning(), quitting: appQuitting || quittingForUpdate });
  if (action !== 'tray') return;
  event.preventDefault();
  hideToTray(true);
}

/**
 * Spiel zu Ende: Wartete der Launcher im Infobereich, bleibt er dort (Windows) bzw. im Dock (Mac) – nach einem Absturz
 * oder Fehler kommt stattdessen das Fenster mit der Absturz-Hilfe. Sonst verschwindet das Symbol im Infobereich.
 * true = nichts weiter tun (Fenster bleibt verborgen bzw. wurde schon gezeigt).
 */
function afterGameTray(): boolean {
  const problem = gameState.state === 'error' || (gameState.state === 'exited' && (!!gameState.crash || !!gameState.notice || (gameState.code !== 0 && gameState.code !== null)));
  const action = afterGameAction({ platform: process.platform, closedToTray, problem, quitting: appQuitting });
  if (appQuitting) return true;
  if (action === 'stay') {
    console.log('[Launcher] Spiel beendet – der Launcher bleibt im Infobereich.');
    void updateTray();
    return true;
  }
  if (action === 'dock') {
    // Mac: Menüleisten-Symbol weg, HeldixClient bleibt im Dock; das verborgene Fenster schließen wie bei jeder Mac-App
    closedToTray = false;
    destroyTray();
    if (mainWindow && !mainWindow.isVisible()) mainWindow.destroy();
    return true;
  }
  closedToTray = false;
  destroyTray();
  if (action === 'show') {
    focusWindow();
    return true;
  }
  return false;
}

// ---------- Zähler in Taskleiste und Dock, Blinken, Dock-Menü ----------

/** zuletzt gesetzter Zähler (nur bei Änderungen neu zeichnen) */
let shownAttention = -1;
const overlayImages = new Map<string, Electron.NativeImage>();

/** rundes Abzeichen mit Zahl (16 px für 100 %, 32 px für 200 % Anzeige) */
function overlayImage(text: string): Electron.NativeImage {
  let image = overlayImages.get(text);
  if (!image) {
    image = nativeImage.createFromBuffer(badgePng(text, 16), { scaleFactor: 1 });
    image.addRepresentation({ scaleFactor: 2, buffer: badgePng(text, 32) });
    overlayImages.set(text, image);
  }
  return image;
}

/**
 * Ungelesene Nachrichten + offene Anfragen (derselbe Zähler wie die Freunde in der Seitenleiste, ohne Party-
 * Einladungen): Windows als Overlay am Symbol in der Taskleiste, macOS als Abzeichen im Dock.
 */
function updateAttention(force = false): void {
  const overview = social.current;
  const count = attentionCount(overview);
  if (count === shownAttention && !force) return;
  shownAttention = count;
  if (process.platform === 'darwin') {
    app.dock?.setBadge(dockBadgeText(count));
    return;
  }
  if (process.platform !== 'win32' || !mainWindow || mainWindow.isDestroyed()) return;
  const text = badgeText(count);
  mainWindow.setOverlayIcon(text ? overlayImage(text) : null, text ? badgeDescription(overview) : '');
}

/** Neue Nachricht, Fenster sichtbar, aber nicht im Vordergrund: Taskleiste blinkt kurz (Mac: Dock-Symbol hüpft einmal) */
function flashForNotice(notice: SocialNotice): void {
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const flash = shouldFlash({
    kind: notice.kind,
    focused: BrowserWindow.getFocusedWindow() !== null,
    visible: process.platform === 'darwin' ? true : !!window && window.isVisible(),
    doNotDisturb: social.doNotDisturb,
    heldixGame: heldixGameRunning(),
  });
  if (!flash) return;
  if (process.platform === 'darwin') {
    app.dock?.bounce('informational');
    return;
  }
  if (!window || flashingWindows.has(window)) return;
  flashingWindows.add(window);
  window.flashFrame(true);
  window.once('focus', () => {
    flashingWindows.delete(window);
    if (!window.isDestroyed()) window.flashFrame(false);
  });
}
/** Fenster, deren Taskleisten-Symbol gerade blinkt (bis sie den Fokus bekommen) */
const flashingWindows = new WeakSet<BrowserWindow>();

let dockMenuTimer: NodeJS.Timeout | null = null;
/** Dock-Menü (macOS): Spielen (gewählte Instanz), bis zu 5 zuletzt gespielte Instanzen, Freunde – gebündelt neu bauen */
function refreshDockMenu(): void {
  if (process.platform !== 'darwin' || dockMenuTimer) return;
  dockMenuTimer = setTimeout(() => {
    dockMenuTimer = null;
    void buildDockMenu().catch((error) => console.warn('[Launcher] Dock-Menü:', error));
  }, 300);
  dockMenuTimer.unref();
}

async function buildDockMenu(): Promise<void> {
  if (!app.dock) return;
  const list = await instances.list();
  const selected = await selectedInstance().catch(() => null);
  const busy = gameRunning();
  const label = (text: string) => text.replace(/&/g, '&&');
  const play = (id: string) => {
    focusWindow();
    void launch(id).catch((error: unknown) => console.warn('[Launcher] Start aus dem Dock:', error instanceof Error ? error.message : error));
  };
  const template: MenuItemConstructorOptions[] = [];
  if (busy) {
    template.push({ label: label(gameState.state === 'running' ? `${gameState.label} läuft` : 'Minecraft wird vorbereitet'), enabled: false });
  } else if (selected) {
    template.push({ label: label(`Spielen – ${selected.name}`), click: () => play(selected.id) });
  }
  const recent = recentInstances(list.map((i) => ({ id: i.id, name: i.name, lastPlayed: i.lastPlayed ?? null })), 5);
  if (recent.length) {
    template.push({ type: 'separator' });
    for (const item of recent) template.push({ label: label(item.name), enabled: !busy, click: () => play(item.id) });
  }
  template.push({ type: 'separator' }, { label: 'Freunde', click: () => sendWhenReady('social:open', null) });
  app.dock.setMenu(Menu.buildFromTemplate(template));
}

// ---------- Mit dem System starten (Windows: unsichtbar im Infobereich, Mac: bei der Anmeldung) ----------

/** Autostart setzen bzw. entfernen; in der Entwicklung nicht (das wäre electron.exe ohne App) */
function applyLoginItem(enabled: boolean): void {
  const settings = loginItemSettings(enabled, process.platform, process.execPath);
  if (!settings) return;
  if (!app.isPackaged) {
    console.log(`[Launcher] Mit dem System starten: ${enabled ? 'an' : 'aus'} (in der Entwicklung nicht eingetragen)`);
    return;
  }
  try {
    app.setLoginItemSettings(settings);
  } catch (error) {
    console.warn('[Launcher] Autostart ließ sich nicht setzen:', error instanceof Error ? error.message : error);
  }
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

// ---------- Einrichtungs-Assistent (siehe core/setup.ts) ----------

/** offen beim ersten Start (entschieden vor ensureInstances) oder nach „Einrichtung erneut starten“ */
const setupGate = new SetupGate(false);
/** geprüfte Store-Liste aus dem Schritt „Addons“ (für setup:install) */
let setupEntries: StoreEntry[] | null = null;

/** Beim Start: Assistent zeigen? Bestehende Installationen bekommen setupDone = true, ganz neue false. */
async function decideSetup(): Promise<void> {
  const probe = await store.setupProbe();
  const decision = setupStart({ stored: probe.stored, instances: (await instances.list()).length, accounts: probe.accounts });
  if (decision.save !== null) await store.saveSettings({ setupDone: decision.save });
  if (decision.show) {
    setupGate.begin();
    console.log('[Launcher] Erster Start: Einrichtungs-Assistent');
  }
}

async function setupInstances(): Promise<OverviewInstance[]> {
  return setupTargets(await heldixInstances());
}

async function setupAddons(): Promise<SetupAddons> {
  const { view, entries } = await loadSetupAddons(HELDIX_SERVICE_URL, STORE_PUBLIC_KEY, await setupInstances());
  setupEntries = entries;
  return view;
}

async function setupInstall(addonId: unknown): Promise<SetupInstallResult> {
  if (!setupEntries) await setupAddons();
  if (!setupEntries) throw new Error('Der Addon-Store ist gerade nicht erreichbar. Addons kannst du später im Addon-Store installieren.');
  const result = await installSetupAddon(addonId, {
    serviceUrl: HELDIX_SERVICE_URL,
    publicKey: STORE_PUBLIC_KEY,
    entries: setupEntries,
    targets: await setupInstances(),
    busy: instanceBusy,
    log: (line) => launcherLog(line),
  });
  if (result.installed.length > 0) storeChanged();
  return result;
}

async function finishSetup(skipped: unknown): Promise<void> {
  await store.saveSettings({ setupDone: true });
  if (setupGate.active) launcherLog(skipped === true ? 'Einrichtung übersprungen' : 'Einrichtung abgeschlossen');
  setupGate.end();
  setupEntries = null;
}

function showStoreNotice(notice: StoreNotice): void {
  if (notice.items.length === 0) return;
  void remember({
    kind: 'addons',
    title: notice.kind === 'available' ? (notice.items.length === 1 ? 'Addon-Update verfügbar' : 'Addon-Updates verfügbar') : (notice.items.length === 1 ? 'Addon aktualisiert' : 'Addons aktualisiert'),
    body: noticeList(notice.items),
    target: { view: 'store' },
    key: `addons:${notice.kind}:${noticeList(notice.items)}`,
    once: true,
  }, false);
  if (!Notification.isSupported()) return;
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
  if (!existed && !windowAllowed) return;
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
    gameBridge?.notifyChanged();
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
      // Heldix-Dienst (Freunde, Capes für alle): Adresse für die Client-Mod; Konto-Wechsel im Spiel über stdin/stdout
      extraJvmArgs: [
        ...prepared.loaderJvmArgs,
        ...(HELDIX_SERVICE_URL && usesHeldixClient(instance) ? [`-Dheldixclient.service=${HELDIX_SERVICE_URL}`] : []),
        ...(usesHeldixClient(instance) ? [IPC_JVM_FLAG] : []),
        ...tuning,
        ...userJvmArgs,
      ],
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
    // Antworten gehen über stdin genau an diesen Spielprozess; Marker-Zeilen schneidet startGame immer aus der Ausgabe
    let writeToGame: (line: string) => boolean = () => false;
    const bridge = usesHeldixClient(instance)
      ? createGameBridge((line) => writeToGame(line), { accountId: account.id, instanceName: instance.name })
      : null;
    const running = startGame(prepared.javaPath, args, prepared.gameDir, handleGameLog, bridge
      ? { message: (json) => bridge.handle(json), rejected: (reason) => bridge.rejected(reason) }
      : undefined);
    writeToGame = (line) => running.send(line);
    try {
      await new Promise<void>((resolve, reject) => {
        running.process.once('spawn', () => resolve());
        running.process.once('error', reject);
      });
    } catch (error) {
      bridge?.dispose();
      throw error;
    }
    gameBridge = bridge;
    game = running;
    gameInstanceId = instance.id;
    const startedAt = Date.now();
    // für den nächsten Start, falls der Launcher vor dem Spiel endet: dann nicht unter dem laufenden Spiel installieren
    if (running.process.pid) void writeFile(gameMarkerFile, JSON.stringify({ pid: running.process.pid, startedAt })).catch(() => undefined);
    await instances.save({ ...instance, lastPlayed: startedAt });
    setGameState({ state: 'running', pid: running.process.pid ?? 0, instanceId: instance.id, label: instance.name });
    updatePresence({ ...presence, phase: 'running', startedAt });
    ensureTray();
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
        void rm(gameMarkerFile, { force: true }).catch(() => undefined);
        bridge?.dispose();
        if (gameBridge === bridge) gameBridge = null;
        game = null;
        gameInstanceId = null;
        graphicsWatch = null;
        // Discord: Spielstatus weg (auch nach einem Absturz), zurück zu „Im Launcher“
        updatePresence({ phase: 'launcher', status: null });
        if (!afterGameTray() && mainWindow && !mainWindow.isVisible()) mainWindow.show();
        // Addon-Updates, die während des Spiels warten mussten, jetzt automatisch installieren
        void store.getSettings().then((s) => (s.addonAutoUpdate ? addonStore.check() : undefined)).catch(() => undefined);
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    launcherLog(message, 'ERROR');
    setGameState({ state: 'error', message });
    updatePresence({ phase: 'launcher', status: null });
    // Start fehlgeschlagen, während das Fenster im Infobereich wartete: Fenster mit der Meldung zurückholen
    if (!afterGameTray() && mainWindow && !mainWindow.isVisible()) mainWindow.show();
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
    closeToTraySetting = next.closeToTray;
    if (next.startWithSystem !== before.startWithSystem) applyLoginItem(next.startWithSystem);
    if (next.selectedInstanceId !== before.selectedInstanceId) refreshDockMenu();
    if (next.social !== before.social) {
      social.refresh().catch(() => undefined);
      worldsSoon();
    }
    // Kopf eingeschaltet: Cape-Name für den Hover-Text nachladen
    if ((next.discordShowHead && !before.discordShowHead) || (next.discordPresence && !before.discordPresence)) void refreshPresencePlayer();
    // das laufende Spiel lädt die Liste neu und sieht dabei „allowed“
    if (next.gameAccountSwitch !== before.gameAccountSwitch) gameBridge?.notifyChanged();
    return next;
  });
  ipcMain.handle('update:state', () => updater.state);
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download-page', async () => {
    await shell.openExternal(`${WEBSITE_URL.replace(/\/+$/, '')}/download`);
  });
  ipcMain.handle('update:install', async () => {
    if (anyGameRunning()) throw new Error('Erst das Spiel beenden, dann aktualisieren.');
    // nur gemeldet (Einstellung „Updates automatisch“ aus): jetzt laden und prüfen
    if (updater.state.phase === 'available' && updater.selfInstall()) {
      const state = await updater.download();
      if (state.phase !== 'ready') throw new Error(state.error ?? 'Das Update ließ sich nicht laden.');
      if (anyGameRunning()) throw new Error('Erst das Spiel beenden, dann aktualisieren.');
    }
    if (!(await launchInstaller(true))) throw new Error(updater.state.error ?? 'Kein Update bereit.');
    quittingForUpdate = true;
    app.quit();
  });
  // Hinweis „Update verfügbar“ vom Start (einmal)
  ipcMain.handle('update:notice', () => {
    const notice = startupNotice;
    startupNotice = null;
    return notice;
  });
  ipcMain.handle('discord:status', () => discord.connection);
  ipcMain.handle('discord:preview', () => {
    if (!discordPreview) updatePresence();
    return discordPreview;
  });
  // Seite im Launcher für den Discord-Status (nur bekannte Namen)
  ipcMain.on('presence:view', (_e, view: unknown) => {
    if (typeof view !== 'string' || !PRESENCE_VIEWS.includes(view as LauncherView) || presenceView === view) return;
    presenceView = view as LauncherView;
    if (presence.phase === 'launcher') updatePresence();
  });

  // Welt teilen: offene Welten der Freunde, Links heldixclient://welt/<code>, Beitreten
  ipcMain.handle('worlds:get', (_e, refresh?: unknown) => (refresh === true || worlds.current.status === 'off' ? worlds.refresh() : worlds.current));
  ipcMain.handle('worlds:take', () => {
    // während des Einrichtungs-Assistenten bleibt der Link liegen (danach holt die Oberfläche ihn ab)
    if (setupGate.active) return null;
    const code = pendingWorld;
    pendingWorld = null;
    return code;
  });
  ipcMain.handle('worlds:open', (_e, code: unknown) => {
    pendingWorld = worldCode(code);
    send('world:open', null);
  });
  ipcMain.handle('worlds:public', (_e, code: unknown) => worldJoinView(code));
  ipcMain.handle('worlds:join', (_e, code: unknown) => joinWorld(code));
  // Startseite „Beliebte Welten“ (Entdecken, Dienst 1.13.0)
  ipcMain.handle('discover:popular', (_e, refresh?: unknown) => discover.popular(refresh === true));

  // Benachrichtigungen (Glocke)
  ipcMain.handle('notifications:list', () => notificationList());
  ipcMain.handle('notifications:read', async (_e, id: unknown) => {
    await notificationStore.markRead(id);
    return notificationList();
  });
  ipcMain.handle('notifications:readAll', async () => {
    await notificationStore.markAllRead(await activeAccountId());
    return notificationList();
  });
  ipcMain.handle('notifications:clear', async () => {
    await notificationStore.clear(await activeAccountId());
    return notificationList();
  });

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
    refreshDockMenu();
    return toInstanceInfo(config);
  });
  ipcMain.handle('instances:update', async (_e, id: string, patch: InstancePatch) => {
    if (gameInstanceId === id && patch && 'heldixClient' in patch) throw new Error('Bitte erst das Spiel beenden.');
    const updated = await instances.update(id, patch);
    // HeldixClient in einer Fabric-Instanz eingeschaltet: Addon-Ordner anlegen (Addons kommen aus dem Addon-Store)
    if (patch?.heldixClient === true && usesHeldixClient(updated)) await mkdir(path.join(instances.dir(updated.id), ADDON_DIR), { recursive: true });
    refreshDockMenu();
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
    refreshDockMenu();
  });
  ipcMain.handle('instances:select', async (_e, id: string) => {
    await instances.require(id);
    await store.saveSettings({ selectedInstanceId: id });
    refreshDockMenu();
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
  ipcMain.handle('social:send', (_e, uuid: unknown, text: unknown, extra?: unknown) => sendChatMessage(uuid, text, extra));
  ipcMain.handle('social:delete', (_e, uuid: unknown, id: unknown) => social.deleteMessage(uuid, id));
  ipcMain.handle('social:react', (_e, uuid: unknown, id: unknown, reaction: unknown) => social.react(uuid, id, reaction));
  ipcMain.handle('social:typing', (_e, uuid: unknown) => social.typing(uuid).catch(() => undefined));
  ipcMain.handle('social:read', async (_e, uuid: unknown) => {
    await social.markRead(uuid);
    if (typeof uuid === 'string') void markConversationRead(uuid.replace(/-/g, '').toLowerCase());
  });
  ipcMain.handle('social:status', (_e, patch: unknown) => social.setStatus(patch));
  ipcMain.handle('social:updateFriend', (_e, uuid: unknown, patch: unknown) => social.updateFriend(uuid, patch));
  ipcMain.handle('social:profile', (_e, uuid: unknown) => social.friendProfile(uuid));
  ipcMain.handle('social:suggestions', () => social.suggestions());
  ipcMain.handle('social:suggest', (_e, uuid: unknown) => social.requestSuggestion(uuid));
  ipcMain.handle('social:joinServer', (_e, address: unknown) => joinServerAddress(address));
  ipcMain.handle('party:get', (_e, refresh?: unknown) => (refresh === true || party.current.status === 'off' ? party.refresh() : party.current));
  ipcMain.handle('party:invite', (_e, uuid: unknown) => party.invite(uuid as string));
  ipcMain.handle('party:cancelInvite', (_e, uuid: unknown) => party.cancelInvite(uuid as string));
  ipcMain.handle('party:accept', (_e, id: unknown) => party.accept(id as string));
  ipcMain.handle('party:decline', (_e, id: unknown) => party.decline(id as string));
  ipcMain.handle('party:leave', () => party.leave());
  ipcMain.handle('party:kick', (_e, uuid: unknown) => party.kick(uuid as string));
  ipcMain.handle('party:transfer', (_e, uuid: unknown) => party.transfer(uuid as string));
  ipcMain.handle('party:chat', (_e, text: unknown) => party.chat(text));
  ipcMain.handle('party:join', () => joinPartyTarget());
  ipcMain.handle('worlds:mine', async () => {
    await worlds.refresh().catch(() => undefined);
    return worlds.ownWorlds();
  });
  ipcMain.handle('social:blocked', () => social.listBlocked());
  ipcMain.handle('social:block', (_e, uuid: unknown) => social.blockPlayer(uuid));
  ipcMain.handle('social:unblock', (_e, uuid: unknown) => social.unblockPlayer(uuid));
  ipcMain.handle('social:report', (_e, uuid: unknown, reason: unknown, note?: unknown) => social.reportPlayer(uuid, reason, note));
  ipcMain.handle('social:privacy', () => social.getPrivacy());
  ipcMain.handle('social:setPrivacy', (_e, patch: unknown) => social.setPrivacy(patch));
  ipcMain.handle('social:join', (_e, uuid: unknown, instanceId?: unknown) => joinFriend(uuid, instanceId));
  ipcMain.handle('social:skin', (_e, uuid: unknown) => social.playerSkin(uuid));

  // Einladungen und Beitreten-Links
  ipcMain.handle('invites:take', () => {
    // während des Einrichtungs-Assistenten bleibt der Code liegen (der Assistent zeigt ihn nur als Karte, setup:get)
    const { code, keep } = setupGate.takeInvite(pendingInvite);
    pendingInvite = keep;
    // erst jetzt ist die Einladung aus dem Download gezeigt
    if (code) dropDownloadInvite();
    return code;
  });
  // Freunde → Einladen: „Link von einem Freund? Hier einfügen“ (Web-Link, heldixclient://-Link oder Code) öffnet
  // denselben Dialog wie ein geöffneter Link (invite:open → invites:take)
  ipcMain.handle('invites:paste', (_e, text: unknown) => {
    const code = parsePastedInvite(text);
    const world = code ? null : parsePastedWorld(text);
    if (world) {
      pendingWorld = world;
      send('world:open', null);
      return world;
    }
    if (!code) throw new Error('Das ist kein Einladungs- oder Welt-Link. Er sieht so aus: heldixclient.com/einladung#abc23def45 bzw. heldixclient.com/welt#k7m2xq');
    if (code !== pendingInvite) dropDownloadInvite();
    pendingInvite = code;
    send('invite:open', null);
    return code;
  });
  ipcMain.handle('invites:public', (_e, code: unknown) => publicInviteView(code));
  ipcMain.handle('invites:accept', (_e, code: unknown, join: unknown) => acceptInvite(code, join));
  ipcMain.handle('invites:get', () => invites.state());
  ipcMain.handle('invites:create', (_e, server: unknown) => invites.create(server));
  ipcMain.handle('invites:revoke', (_e, code: unknown) => invites.revoke(code));

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
  // „Neu in …“ erst nach dem Einrichtungs-Assistenten (die Oberfläche fragt danach noch einmal)
  ipcMain.handle('whatsnew:get', () => (setupGate.whatsNewAllowed() ? whatsNew() : null));
  // Einrichtungs-Assistent (core/setup.ts, renderer/setup.ts)
  ipcMain.handle('setup:get', () => ({ show: setupGate.active, invite: setupGate.peekInvite(pendingInvite) }));
  ipcMain.handle('setup:restart', () => {
    setupGate.begin();
    setupEntries = null;
    return { show: true, invite: setupGate.peekInvite(pendingInvite) };
  });
  ipcMain.handle('setup:addons', () => setupAddons());
  ipcMain.handle('setup:install', (_e, addonId: unknown) => setupInstall(addonId));
  ipcMain.handle('setup:finish', (_e, skipped: unknown) => finishSetup(skipped));
  ipcMain.handle('whatsnew:seen', async () => {
    await store.saveSettings({ lastSeenVersion: app.getVersion() });
  });
  ipcMain.handle('web:account', (_e, rawTarget?: unknown) => openWebAccount(rawTarget));
  ipcMain.handle('loader:logos', () => loaderLogos(paths));
  ipcMain.handle('news:body', (_e, id: string) => newsBody(String(id)));
  ipcMain.handle('accounts:addMicrosoft', async () => {
    const tokens = await microsoftSignIn(false);
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

/** App-Menü für macOS: HeldixClient (Über, Einstellungen mit ⌘,, Ausblenden, Beenden), Bearbeiten, Fenster */
function macMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: LAUNCHER_NAME,
      submenu: [
        { role: 'about', label: `Über ${LAUNCHER_NAME}` },
        { type: 'separator' },
        { label: 'Einstellungen …', accelerator: 'Command+,', click: () => sendWhenReady('view:open', 'settings') },
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
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    closeSplash();
  });
  mainWindow.once('show', closeSplash);
  mainWindow.on('closed', () => (mainWindow = null));
  // Overlay in der Taskleiste gibt es nur mit sichtbarem Fenster: beim Zeigen den Zähler neu setzen
  mainWindow.on('show', () => updateAttention(true));
  // Freunde: wieder sichtbar = gleich im 20-s-Takt weiter (verborgen: alle 60 s)
  // Abzeichen am Addon-Store: Stand der letzten Prüfung gleich nach dem Laden der Oberfläche
  mainWindow.webContents.on('did-finish-load', () => {
    if (addonStore.updates > 0) mainWindow?.webContents.send('store:changed', addonStore.updates);
  });
  mainWindow.on('show', () => social.wake());
  mainWindow.on('restore', () => social.wake());
  mainWindow.on('focus', () => social.wake());
  // Schließen: mit „Im Hintergrund bereit für Nachrichten“ in den Infobereich (core/background.ts, closeAction)
  mainWindow.on('close', closeIntoTray);
  // Windows fährt herunter oder meldet ab: nichts mehr ausblenden, sonst hielte der Launcher das Herunterfahren auf
  mainWindow.on('query-session-end', () => (appQuitting = true));
  mainWindow.on('session-end', () => (appQuitting = true));
  // Discord: im Launcher „Stöbert im Addon-Store“ nur bei sichtbarem Fenster
  for (const event of ['show', 'hide', 'minimize', 'restore'] as const) {
    mainWindow.on(event as 'show', () => {
      if (presence.phase === 'launcher') updatePresence();
    });
  }
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
      // HELDIX_SCREENSHOT_STATUS=<JSON wie HELDIX-STATUS>: Discord-Vorschau wie im laufenden Spiel (ohne Spiel, ohne Discord)
      const statusLine = process.env.HELDIX_SCREENSHOT_STATUS;
      if (statusLine) {
        const instance = await selectedInstance().catch(() => null);
        const status = parseStatusLine(`HELDIX-STATUS ${statusLine}`);
        if (instance && status) updatePresence({ phase: 'running', instance, startedAt: Date.now() - 42 * 60_000, status });
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

// Nur ein Launcher gleichzeitig (in der Entwicklung egal): ein zweiter Start holt das offene Fenster nach vorn und
// reicht einen Einladungslink aus seiner Befehlszeile weiter (Windows/Linux)
const singleInstance = !app.isPackaged || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on('second-instance', (_event, argv) => {
  focusWindow();
  receiveInvite(findInviteLink(argv));
  receiveWorld(findWorldLink(argv));
});
// macOS: Links kommen als Ereignis (auch vor dem Start; dann holt die Oberfläche den Code beim Laden ab)
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveInvite(parseInviteLink(url));
  receiveWorld(parseWorldLink(url));
});

if (singleInstance) {
  app.whenReady().then(async () => {
    // macOS braucht ein App-Menü, sonst gehen Kopieren, Einfügen und Beenden (⌘C, ⌘V, ⌘Q) nicht
    Menu.setApplicationMenu(process.platform === 'darwin' ? macMenu() : null);
    // Windows-Benachrichtigungen brauchen die App-ID (wie appId in package.json, die der Installer der Verknüpfung gibt)
    if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? 'dev.heldixclient.launcher' : process.execPath);
    // Einladungslinks heldixclient://… öffnen den Launcher (der Installer trägt das Protokoll auch ein). Beim Entwickeln
    // nicht systemweit registrieren – dort kommen Links nur über die Befehlszeile (npm start -- heldixclient://…).
    if (app.isPackaged && !app.isDefaultProtocolClient(INVITE_PROTOCOL)) app.setAsDefaultProtocolClient(INVITE_PROTOCOL);
    // Einladung aus dem Download: der Windows-Installer hat den Code aus seinem Dateinamen abgelegt. Die Datei bleibt, bis
    // die Einladung gezeigt wurde (invites:take); ein mitgegebener Link hat Vorrang und ersetzt sie.
    const inviteFile = path.join(paths.root, DOWNLOAD_INVITE_FILE);
    const downloadInvite = await readDownloadInvite(inviteFile).catch(() => null);
    if (downloadInvite && !pendingInvite) {
      pendingInvite = downloadInvite;
      downloadInviteFile = inviteFile;
      launcherLog('Einladung aus dem Download geöffnet');
    } else {
      if (downloadInvite) void finishDownloadInvite(inviteFile).catch(() => undefined);
      if (pendingInvite) launcherLog('Einladungslink geöffnet');
    }
    if (pendingWorld) launcherLog('Welt-Link geöffnet');
    registerIpc();
    const settings = await store.getSettings();
    autoUpdate = settings.autoUpdate;
    closeToTraySetting = settings.closeToTray;
    // unsichtbar gestartet (Windows-Autostart mit --hidden, Mac „Bei der Anmeldung öffnen“): kein Startfenster, kein
    // Hauptfenster – der Launcher wartet im Infobereich bzw. Dock auf Nachrichten
    launchedHidden = startedHidden(process.argv, process.platform, process.platform === 'darwin' && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin);
    if (launchedHidden) console.log('[Launcher] Unsichtbar gestartet (Autostart)');
    // Autostart mit dem aktuellen Pfad eintragen (nach einem Umzug der App stimmt er sonst nicht mehr); auf dem Mac nur,
    // wenn er fehlt – macOS meldet jedes neue Anmeldeobjekt mit einer Mitteilung
    if (settings.startWithSystem && (process.platform !== 'darwin' || !app.getLoginItemSettings().openAtLogin)) applyLoginItem(true);

    // Update beim Start (siehe core/startup-update.ts)
    const memo = await readUpdateMemo(updateMemoFile);
    const settled = settleUpdateMemo(memo, app.getVersion());
    if (settled !== memo) {
      console.log(`[Update] Version ${app.getVersion()} ist installiert${process.argv.includes('--updated') ? ' (vom Installer neu gestartet)' : ''}`);
      await writeUpdateMemo(updateMemoFile, settled).catch(() => undefined);
    }
    previousGame = await readGameMarker(gameMarkerFile);
    if (previousGame && !anyGameRunning()) await rm(gameMarkerFile, { force: true }).catch(() => undefined);
    const plan = startupPlan({ enabled: updater.enabled(), platform: process.platform, selfUpdate, autoUpdate, hidden: launchedHidden });
    let retrySoon = false;
    if (plan === 'splash') {
      const result = await updateBeforeStart().catch((error: unknown) => {
        console.error('[Update] Prüfung beim Start fehlgeschlagen', error);
        return { proceed: true, retrySoon: true };
      });
      if (!result.proceed) return;
      retrySoon = result.retrySoon;
    }

    // erst nach der Prüfung: beendet sich der Launcher für ein Update, soll nichts halb geschrieben sein
    // Einrichtungs-Assistent vor ensureInstances entscheiden (danach gibt es immer eine Instanz)
    await decideSetup().catch((error) => console.error('[Launcher] Einrichtung: Zustand nicht lesbar', error));
    await ensureInstances().catch((error) => console.error('[Launcher] Instanzen konnten nicht vorbereitet werden', error));
    windowAllowed = true;
    // Windows: unsichtbar gestartet nur das Symbol im Infobereich (ohne Hinweis); Mac: nur das Dock
    if (!launchedHidden) createWindow();
    else if (process.platform !== 'darwin') {
      closedToTray = true;
      ensureTray();
    }
    refreshDockMenu();
    social.start();
    addonStore.start();
    // Einladungen: erster Stand bald nach dem Start (ohne Meldung), dann alle 5 Minuten vergleichen
    setTimeout(() => void invites.poll(), 15_000).unref();
    setInterval(() => void invites.poll(), INVITE_POLL_MS).unref();
    applyPresenceSettings(settings);
    // Kopf und Cape für den Discord-Status (Cape nach dem Start, damit die Anmeldung beim Dienst nicht doppelt läuft)
    void refreshPresencePlayer(false);
    setTimeout(() => void refreshPresencePlayer(), 20_000).unref();
    worlds.start();
    // dauerhafte Welten: Stand alle 5 Minuten (dazwischen Echtzeit); Entdecken für „Beliebte Welten“, solange ein Fenster sichtbar ist
    hosting.start();
    setTimeout(() => void discover.popular().catch(() => undefined), 4000).unref();
    setInterval(() => {
      if (anyWindowVisible()) void discover.popular(true).catch(() => undefined);
    }, 5 * 60_000).unref();
    // ohne Startfenster gleich prüfen (nur Hinweis); danach alle 30 Minuten, nach einer gescheiterten Prüfung schon in einer Minute
    if (plan === 'background') void updateNoticeAtStart().catch(() => undefined);
    updater.start(() => autoUpdate, retrySoon ? 60_000 : undefined);
    void cleanupOfficialLauncher();
  });
}

/** Discord-Status beim Beenden gelöscht und Verlauf gespeichert */
let quitPrepared = false;
app.on('before-quit', (event) => {
  // geladenes Update still installieren (Rückfall, wenn nicht schon beim Start oder mit „Jetzt neu starten“; nicht,
  // solange ein Spiel läuft – es nutzt Dateien des Launchers)
  if (!quittingForUpdate && autoUpdate && updater.installerPath() && !anyGameRunning()) {
    event.preventDefault();
    quittingForUpdate = true;
    launchInstaller(false).finally(() => app.quit());
    return;
  }
  appQuitting = true;
  // einmal: Discord-Status löschen (warten, bis die Nachricht raus ist – sonst bleibt er stehen, bis Discord das Ende
  // bemerkt) und den Verlauf der Glocke speichern; höchstens 1,5 Sekunden
  if (!quitPrepared) {
    event.preventDefault();
    quitPrepared = true;
    void Promise.race([Promise.all([discord.stop(), notificationStore.flush()]), new Promise((resolve) => setTimeout(resolve, 1500))]).finally(() => app.quit());
    return;
  }
  social.stop();
  addonStore.stop();
  worlds.stop();
  destroyTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS: Klick auf das Dock-Symbol holt das Fenster zurück (auch das während eines Spiels ausgeblendete)
app.on('activate', () => {
  if (windowAllowed) focusWindow();
});
