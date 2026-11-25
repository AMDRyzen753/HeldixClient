import { readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell } from 'electron';
import type {
  AccountInfo,
  AppInfo,
  BridgeState,
  ContentKind,
  DeveloperStatus,
  FolderKind,
  GameState,
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
import { BridgeServer, type BridgeFile, type BridgeReply, type BridgeSession } from './core/bridge';
import { addContentFiles, countEnabled, listContent, removeContent, setContentEnabled } from './core/content';
import { applyPendingRemovals, installStoreAddon, storeForInstance } from './core/addonstore';
import { DiscordRpc } from './core/discord';
import { getFabricGameVersions } from './core/fabric';
import { ADDON_DIR, InstanceStore, usesHeldixClient, type InstanceConfig } from './core/instances';
import { buildLaunchArguments, startGame, type GameAccount, type RunningGame } from './core/launch';
import { installModrinth, installPerformancePack, searchModrinth } from './core/modrinth';
import { findClientMods, findLoaderJar } from './core/mods';
import { getVersionManifest, listInstalledVersions } from './core/mojang';
import { createPaths, defaultDataRoot } from './core/paths';
import { GraphicsWatch, graphicsArguments, tunedJvmArguments } from './core/performance';
import { prepareGame } from './core/prepare';
import { SHADERPACK_DIR, addShaderpackFiles, installShaderpack, listShaderpacks, removeShaderpack, searchShaderpacks, setActiveShaderpack } from './core/shaderpacks';
import { DEV_KEY_FILE, SIGNING_KEY_PATH, checkDevKey, machineCode, matchingSigningKey, signDevKey } from './core/devkey';
import { DEV_PUBLIC_KEY } from './dev-public-key';
import { buildActivity, parseStatusLine, type GameStatus } from './core/presence';
import { listQuickPlay, validateQuickPlay } from './core/quickplay';
import { loaderLogos } from './core/loaderlogos';
import { installOfficialProfile, officialLauncherRunning, officialProfileInstalled, openOfficialLauncher } from './core/officiallauncher';
import { listHeldixNews, listNews, newsBody } from './core/news';
import { webLoginUrl } from './core/weblogin';
import { skinFor } from './core/skins';
import { Updater, compareVersions } from './core/updater';
import { UPDATE_PUBLIC_KEY } from './update-public-key';
import { Store, type StoredAccount } from './store';

const paths = createPaths(process.env.HELDIX_DATA_DIR ?? defaultDataRoot(DATA_DIR_NAME));
const store = new Store(paths.root);
const instances = new InstanceStore(paths);
const isDev = !app.isPackaged;

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
const bridgeDir = () => resourceDir('launcher-bridge');

const LOADER_LABELS = { heldix: 'Heldix Loader', fabric: 'Fabric', vanilla: 'Vanilla' } as const;

// ---------- Ereignisse an die Oberfläche ----------

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
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
function handleGameLog(lines: LogLine[]): void {
  const visible: LogLine[] = [];
  for (const line of lines) {
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

const OFFLINE_LOCKED = 'Offline-Konten gibt es, sobald ein Microsoft-Konto mit Minecraft im Launcher angemeldet ist.';

/**
 * Entwickleroptionen und ob für diesen PC ein gültiger Entwickler-Schlüssel hinterlegt ist.
 * Sind die Optionen an und liegt der passende Signaturschlüssel des Entwicklers auf diesem PC
 * (%USERPROFILE%\.heldixclient-dev\signing-key.pem), erstellt der Launcher den Schlüssel selbst.
 */
async function developerStatus(): Promise<DeveloperStatus> {
  const settings = await store.getSettings();
  const keyPath = path.join(paths.root, DEV_KEY_FILE);
  const pc = machineCode();
  let check = checkDevKey(await readFile(keyPath, 'utf8').catch(() => null), DEV_PUBLIC_KEY, pc);
  let autoCreated = false;
  if (settings.developerMode && !check.valid) {
    const signingKey = matchingSigningKey(await readFile(SIGNING_KEY_PATH, 'utf8').catch(() => ''), DEV_PUBLIC_KEY);
    if (signingKey) {
      const key = signDevKey(signingKey, 'Entwickler', pc);
      await writeFile(keyPath, `${JSON.stringify(key, null, 2)}\n`);
      check = checkDevKey(JSON.stringify(key), DEV_PUBLIC_KEY, pc);
      autoCreated = check.valid;
    }
  }
  return {
    enabled: settings.developerMode,
    machineCode: pc,
    keyValid: check.valid,
    keyName: check.valid ? check.name : null,
    reason: check.valid ? null : check.reason,
    keyPath,
    autoCreated,
  };
}

/** Schlüsseldatei auswählen: Signaturschlüssel des Entwicklers oder ein für diesen PC ausgestellter Entwickler-Schlüssel. */
async function importDeveloperKey(): Promise<DeveloperStatus | null> {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Entwickler-Schlüssel importieren',
    properties: ['openFile'],
    filters: [{ name: 'Entwickler-Schlüssel', extensions: ['pem', 'key'] }],
  });
  const file = result.filePaths[0];
  if (result.canceled || !file) return null;
  const text = await readFile(file, 'utf8');
  if (text.includes('PRIVATE KEY')) {
    if (!matchingSigningKey(text, DEV_PUBLIC_KEY)) throw new Error('Dieser Signaturschlüssel passt nicht zu diesem Build von HeldixClient.');
    await mkdir(path.dirname(SIGNING_KEY_PATH), { recursive: true });
    await writeFile(SIGNING_KEY_PATH, text, { mode: 0o600 });
  } else {
    const check = checkDevKey(text, DEV_PUBLIC_KEY, machineCode());
    if (!check.valid) throw new Error(check.reason);
    await writeFile(path.join(paths.root, DEV_KEY_FILE), text);
  }
  await store.saveSettings({ developerMode: true });
  return developerStatus();
}

/**
 * Offline-Konten: im Entwicklungsmodus immer. In der fertigen App erst, wenn ein Microsoft-Konto im Launcher ist –
 * das gibt es nur mit gekauftem Minecraft (loginMinecraft prüft das Profil). So machen es auch Prism Launcher und MultiMC.
 * Ausnahme: eingeschaltete Entwickleroptionen mit gültigem Entwickler-Schlüssel für diesen PC (npm run dev-key).
 */
async function offlineAllowed(): Promise<boolean> {
  if (isDev || (await store.listAccounts()).some((a) => a.type === 'microsoft')) return true;
  const developer = await developerStatus();
  return developer.enabled && developer.keyValid;
}

async function sessionFor(account: StoredAccount): Promise<GameAccount> {
  if (account.type === 'offline') {
    if (!(await offlineAllowed())) throw new Error(OFFLINE_LOCKED);
    return { name: account.name, uuid: account.uuid, accessToken: '0', userType: 'legacy' };
  }
  const secrets = store.secrets(account);
  if (secrets.accessToken && (account.expiresAt ?? 0) > Date.now() + 10 * 60 * 1000) {
    return { name: account.name, uuid: account.uuid, accessToken: secrets.accessToken, xuid: account.xuid, userType: 'msa' };
  }
  if (!secrets.refreshToken) {
    // über den offiziellen Minecraft Launcher angemeldet: die neue Sitzung kommt wieder von dort
    launcherLog('Sitzung abgelaufen – hole eine neue Anmeldung über den Minecraft Launcher …');
    const fresh = await requestBridgeSession('launch');
    return { name: fresh.name, uuid: fresh.uuid, accessToken: store.secrets(fresh).accessToken, xuid: fresh.xuid, userType: 'msa' };
  }
  if (!MICROSOFT_CLIENT_ID) throw new Error('Microsoft-Client-ID fehlt (siehe README).');
  launcherLog('Erneuere Microsoft-Anmeldung …');
  const ms = await refreshMicrosoft(MICROSOFT_CLIENT_ID, secrets.refreshToken);
  const session = await loginMinecraft(ms);
  await store.upsertMicrosoft(session);
  return { name: session.name, uuid: session.uuid, accessToken: session.accessToken, xuid: session.xuid, userType: 'msa' };
}

function toAccountInfo(account: StoredAccount): AccountInfo {
  return { id: account.id, type: account.type, name: account.name, uuid: account.uuid, skinUrl: account.skinUrl, via: account.source, active: true };
}

// ---------- Brücke zum offiziellen Minecraft Launcher ----------
// Der offizielle Launcher meldet an, HeldixClient startet das Spiel (siehe core/bridge.ts und mod/launcher-bridge).

const bridgeFile = path.join(paths.root, 'bridge.json');
let bridgeServer: BridgeServer | null = null;

interface BridgeWaiter {
  purpose: 'login' | 'launch';
  resolve: (account: StoredAccount) => void;
  reject: (error: Error) => void;
}
/** Anmeldung, auf die der Launcher gerade wartet */
let bridgeWaiter: BridgeWaiter | null = null;
/** Brücken, die offen bleiben, bis das Spiel endet (der Minecraft Launcher zeigt das Spiel so lange als laufend) */
let bridgeHolds: (() => void)[] = [];

function holdUntilGameEnds(): Promise<void> {
  return new Promise((resolve) => bridgeHolds.push(resolve));
}

function releaseBridgeHolds(): void {
  const holds = bridgeHolds;
  bridgeHolds = [];
  for (const release of holds) release();
}

async function bridgeJar(): Promise<string> {
  const jar = (await readdir(bridgeDir()).catch(() => [] as string[])).filter((f) => /^heldix-bridge-.+\.jar$/.test(f)).sort().pop();
  if (!jar) throw new Error('Die Brücke zum Minecraft Launcher fehlt in dieser Installation.');
  return path.join(bridgeDir(), jar);
}

function bridgeIcon(): string | null {
  const image = nativeImage.createFromPath(path.join(bridgeDir(), 'icon.png'));
  return image.isEmpty() ? null : image.resize({ width: 128, height: 128, quality: 'best' }).toDataURL();
}

/** Installation „HeldixClient“ im offiziellen Launcher anlegen bzw. aktuell halten */
async function setupOfficialLauncher(select: boolean): Promise<void> {
  const fallbackParent = await getVersionManifest(paths).then((r) => r.manifest.latest.release).catch(() => null);
  const result = await installOfficialProfile({ bridgeJar: await bridgeJar(), bridgeFile, icon: bridgeIcon(), select, fallbackParent });
  if (result.changed) launcherLog(`Minecraft Launcher: Installation „HeldixClient“ eingerichtet (auf Basis von Minecraft ${result.parent})`);
}

function sendBridgeState(state: BridgeState): void {
  send('bridge:state', state);
}

/**
 * Anmeldung über den offiziellen Minecraft Launcher: Installation einrichten, den Launcher öffnen und warten,
 * bis der Spieler dort auf „Spielen“ drückt. Die Sitzung kommt dann über die Brücke (onBridgeSession).
 */
async function requestBridgeSession(purpose: 'login' | 'launch'): Promise<StoredAccount> {
  if (!bridgeServer) throw new Error('Die Brücke zum Minecraft Launcher konnte nicht gestartet werden.');
  bridgeWaiter?.reject(new Error('Anmeldung über den Minecraft Launcher abgebrochen.'));
  const wasRunning = await officialLauncherRunning();
  await setupOfficialLauncher(true);
  await openOfficialLauncher();
  return new Promise<StoredAccount>((resolve, reject) => {
    const finish = (error: Error | null, account?: StoredAccount) => {
      clearTimeout(timer);
      if (bridgeWaiter !== waiter) return;
      bridgeWaiter = null;
      sendBridgeState({ waiting: false });
      if (error) reject(error);
      else resolve(account!);
    };
    const waiter: BridgeWaiter = { purpose, resolve: (account) => finish(null, account), reject: (error) => finish(error) };
    const timer = setTimeout(() => finish(new Error('Im Minecraft Launcher wurde nicht auf „Spielen“ gedrückt. Versuch es noch mal.')), 15 * 60 * 1000);
    bridgeWaiter = waiter;
    sendBridgeState({ waiting: true, purpose, launcherWasRunning: wasRunning });
  });
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

/** Die Brücke hat eine Anmeldung vom offiziellen Launcher übergeben. */
async function onBridgeSession(raw: BridgeSession): Promise<BridgeReply> {
  if (!raw.accessToken) throw new Error('Der Minecraft Launcher hat keine Anmeldung übergeben.');
  const session = await sessionFromAccessToken(raw.accessToken, raw.xuid);
  const account = await store.upsertMicrosoft(session);
  launcherLog(`Angemeldet als ${session.name} (über den Minecraft Launcher)`);
  send('accounts:changed', null);

  const waiter = bridgeWaiter;
  if (waiter) {
    waiter.resolve(account);
    if (waiter.purpose === 'login') focusWindow();
    // Ein Start wartete auf diese Anmeldung und läuft jetzt weiter
    return { name: session.name, hold: waiter.purpose === 'launch' ? holdUntilGameEnds() : undefined };
  }
  focusWindow();
  if (gameState.state === 'preparing' || gameState.state === 'running') return { name: session.name };
  // Im Minecraft Launcher auf „Spielen“ gedrückt: die ausgewählte Instanz starten
  const hold = holdUntilGameEnds();
  launch().catch(() => releaseBridgeHolds());
  return { name: session.name, hold };
}

/** So startet die Brücke HeldixClient, wenn es nicht läuft */
function bridgeCommand(): string[] {
  if (app.isPackaged) return [process.execPath];
  // Entwicklung: einen schon eingetragenen Befehl (der installierten App) behalten
  try {
    const existing = JSON.parse(readFileSync(bridgeFile, 'utf8')) as BridgeFile;
    if (Array.isArray(existing.command) && existing.command.length === 1) return existing.command;
  } catch {
    // keine Datei
  }
  return [process.execPath, app.getAppPath()];
}

async function startBridge(): Promise<void> {
  bridgeServer = new BridgeServer(bridgeFile, bridgeCommand(), onBridgeSession, (message) => console.log(`[Launcher] ${message}`));
  await bridgeServer.start();
  // Installation im offiziellen Launcher aktuell halten (neue Brücke, neue Minecraft-Version) – nur mit dem echten Datenordner
  if (!process.env.HELDIX_DATA_DIR && (await officialProfileInstalled())) await setupOfficialLauncher(false);
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
        setGameState({ state: 'exited', code, notice });
      })
      .catch((error: Error) => setGameState({ state: 'error', message: error.message }))
      .finally(() => {
        game = null;
        gameInstanceId = null;
        graphicsWatch = null;
        releaseBridgeHolds();
        updatePresence({ phase: 'launcher', status: null });
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    launcherLog(message, 'ERROR');
    setGameState({ state: 'error', message });
    updatePresence({ phase: 'launcher', status: null });
    releaseBridgeHolds();
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
    const next = await store.saveSettings(patch);
    applyPresenceSettings(next);
    autoUpdate = next.autoUpdate;
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
  ipcMain.handle('content:setEnabled', async (_e, id: string, kind: ContentKind, file: string, enabled: boolean) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden.');
    await setContentEnabled(instances.dir((await instances.require(id)).id), assertKind(kind), file, Boolean(enabled));
  });
  ipcMain.handle('content:remove', async (_e, id: string, kind: ContentKind, file: string) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden.');
    await removeContent(instances.dir((await instances.require(id)).id), assertKind(kind), file);
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
    return storeForInstance(instances.dir(instance.id), HELDIX_SERVICE_URL, UPDATE_PUBLIC_KEY);
  });
  ipcMain.handle('addons:installStore', async (_e, id: string, addonId: string) => {
    if (gameInstanceId === id) throw new Error('Bitte erst das Spiel beenden – oder im Spiel über Einstellungen → Addons → Store installieren.');
    const instance = await instances.require(id);
    if (!usesHeldixClient(instance)) throw new Error('Heldix-Addons laufen nur in Instanzen mit HeldixClient.');
    await applyPendingRemovals(instances.dir(instance.id));
    return installStoreAddon(instances.dir(instance.id), HELDIX_SERVICE_URL, UPDATE_PUBLIC_KEY, String(addonId));
  });

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
    if (!['neuigkeiten', 'das-team', 'status', 'download', 'hilfe', 'addons'].includes(String(page))) throw new Error('Unbekannte Seite');
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
    const url = await webLoginUrl(HELDIX_SERVICE_URL, session, devAuth, target);
    await shell.openExternal(url);
  });
  ipcMain.handle('loader:logos', () => loaderLogos(paths));
  ipcMain.handle('news:body', (_e, id: string) => newsBody(String(id)));
  ipcMain.handle('accounts:addMicrosoft', async () => {
    if (!MICROSOFT_CLIENT_ID) throw new Error('Microsoft-Login ist noch nicht eingerichtet: Client-ID in src/main/config.ts eintragen (siehe README).');
    const tokens = await interactiveMicrosoftLogin(mainWindow, MICROSOFT_CLIENT_ID, MICROSOFT_REDIRECT_URI);
    return toAccountInfo(await store.upsertMicrosoft(await loginMinecraft(tokens)));
  });
  ipcMain.handle('accounts:addOffline', async (_e, rawName: string) => {
    if (!(await offlineAllowed())) throw new Error(OFFLINE_LOCKED);
    const name = String(rawName).trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Name: 3–16 Zeichen, nur Buchstaben, Zahlen und _.');
    return toAccountInfo(await store.addOffline(name, offlineUuid(name)));
  });
  ipcMain.handle('accounts:addViaLauncher', async () => toAccountInfo(await requestBridgeSession('login')));
  ipcMain.handle('bridge:cancel', () => bridgeWaiter?.reject(new Error('Anmeldung über den Minecraft Launcher abgebrochen.')));
  ipcMain.handle('bridge:reopen', () => openOfficialLauncher());
  ipcMain.handle('developer:status', () => developerStatus());
  ipcMain.handle('developer:import', () => importDeveloperKey());
  ipcMain.handle('accounts:remove', (_e, id: string) => store.remove(id));
  ipcMain.handle('accounts:select', (_e, id: string) => store.select(id));

  ipcMain.handle('game:launch', (_e, instanceId?: string, target?: { kind?: unknown; id?: unknown }) =>
    launch(typeof instanceId === 'string' ? instanceId : undefined, target && typeof target === 'object' ? target : undefined));
  ipcMain.handle('instances:quickPlay', async (_e, id: string) => {
    const instance = await instances.require(id);
    return listQuickPlay(instances.dir(instance.id), paths.versions, instance.minecraft);
  });
  ipcMain.handle('game:kill', () => {
    game?.process.kill();
  });
  ipcMain.handle('game:state', () => gameState);
  ipcMain.handle('folder:open', (_e, kind: FolderKind, instanceId?: string) => openFolder(kind, instanceId));
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
      // HELDIX_SCREENSHOT_BRIDGE=1 zeigt den Dialog „Anmelden über den Minecraft Launcher“ (ohne den Launcher zu öffnen)
      if (process.env.HELDIX_SCREENSHOT_BRIDGE) sendBridgeState({ waiting: true, purpose: 'launch', launcherWasRunning: true });
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
    registerIpc();
    await ensureInstances().catch((error) => console.error('[Launcher] Instanzen konnten nicht vorbereitet werden', error));
    createWindow();
    const settings = await store.getSettings();
    applyPresenceSettings(settings);
    autoUpdate = settings.autoUpdate;
    updater.start(() => autoUpdate);
    await startBridge().catch((error) => console.error('[Launcher] Brücke zum Minecraft Launcher nicht verfügbar', error));
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
  // Discord-Status löschen, Port der Brücke austragen
  discord.stop();
  let current: BridgeFile | null = null;
  try {
    current = JSON.parse(readFileSync(bridgeFile, 'utf8')) as BridgeFile;
  } catch {
    // keine Datei
  }
  bridgeServer?.stopSync(current);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
