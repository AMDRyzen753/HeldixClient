import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import type {
  AccountInfo,
  AppInfo,
  ContentKind,
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
  LAUNCHER_NAME,
  LAUNCHER_VERSION,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_REDIRECT_URI,
} from './config';
import { loginMinecraft, offlineUuid, refreshMicrosoft } from './core/auth';
import { addContentFiles, countEnabled, listContent, removeContent, setContentEnabled } from './core/content';
import { DiscordRpc } from './core/discord';
import { getFabricGameVersions } from './core/fabric';
import { ADDON_DIR, InstanceStore, type InstanceConfig } from './core/instances';
import { buildLaunchArguments, startGame, type GameAccount, type RunningGame } from './core/launch';
import { installModrinth, searchModrinth } from './core/modrinth';
import { findClientMods, findLoaderJar } from './core/mods';
import { getVersionManifest, listInstalledVersions } from './core/mojang';
import { createPaths, defaultDataRoot } from './core/paths';
import { GraphicsWatch, graphicsArguments, tunedJvmArguments } from './core/performance';
import { prepareGame } from './core/prepare';
import { buildActivity, parseStatusLine, type GameStatus } from './core/presence';
import { listQuickPlay, validateQuickPlay } from './core/quickplay';
import { listNews, newsBody } from './core/news';
import { skinFor } from './core/skins';
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
const bundledAddonsDir = () => resourceDir(ADDON_DIR);
const loaderDir = () => resourceDir('heldix-loader');

const LOADER_LABELS = { heldix: 'Heldix Loader', fabric: 'Fabric', vanilla: 'Vanilla' } as const;

// ---------- Ereignisse an die Oberfläche ----------

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function setGameState(state: GameState): void {
  gameState = state;
  send('game:state', state);
}

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
 * Offline-Konten: im Entwicklungsmodus immer. In der fertigen App erst, wenn ein Microsoft-Konto im Launcher ist –
 * das gibt es nur mit gekauftem Minecraft (loginMinecraft prüft das Profil). So machen es auch Prism Launcher und MultiMC.
 */
async function offlineAllowed(): Promise<boolean> {
  return isDev || (await store.listAccounts()).some((a) => a.type === 'microsoft');
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
  if (!MICROSOFT_CLIENT_ID) throw new Error('Microsoft-Client-ID fehlt (siehe README).');
  launcherLog('Erneuere Microsoft-Anmeldung …');
  const ms = await refreshMicrosoft(MICROSOFT_CLIENT_ID, secrets.refreshToken);
  const session = await loginMinecraft(ms);
  await store.upsertMicrosoft(session);
  return { name: session.name, uuid: session.uuid, accessToken: session.accessToken, xuid: session.xuid, userType: 'msa' };
}

function toAccountInfo(account: StoredAccount): AccountInfo {
  return { id: account.id, type: account.type, name: account.name, uuid: account.uuid, skinUrl: account.skinUrl, active: true };
}

// ---------- Instanzen ----------

async function toInstanceInfo(config: InstanceConfig): Promise<InstanceInfo> {
  const dir = instances.dir(config.id);
  const [modCount, addonCount] = await Promise.all([countEnabled(dir, 'mods'), countEnabled(dir, 'addons')]);
  return { ...config, modCount, addonCount, path: dir };
}

/** Beim Start: alte Spielordner übernehmen, Standard-Instanz anlegen, Auswahl prüfen. */
async function ensureInstances(): Promise<void> {
  const migrated = await instances.migrateLegacy(bundledAddonsDir());
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
    if (data) await instances.create(data, bundledAddonsDir());
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
      extraJvmArgs: [...prepared.loaderJvmArgs, ...tuning, ...userJvmArgs],
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
        updatePresence({ phase: 'launcher', status: null });
        if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
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
    const sub = { instance: '', mods: 'mods', addons: ADDON_DIR, logs: 'logs', saves: 'saves' }[kind];
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
    return next;
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
    const config = await instances.create(data, bundledAddonsDir());
    await store.saveSettings({ selectedInstanceId: config.id });
    return toInstanceInfo(config);
  });
  ipcMain.handle('instances:update', async (_e, id: string, patch: InstancePatch) => toInstanceInfo(await instances.update(id, patch)));
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

  ipcMain.handle('modrinth:search', async (_e, id: string, query: string, offset: number) => {
    const instance = await instances.require(id);
    return searchModrinth(instances.dir(instance.id), instance.minecraft, String(query ?? ''), Number(offset) || 0);
  });
  ipcMain.handle('modrinth:install', async (_e, id: string, projectId: string) => {
    const instance = await instances.require(id);
    if (instance.loader !== 'fabric') {
      throw new Error('Mods von Modrinth sind Fabric-Mods und laufen nur in Fabric-Instanzen, nicht mit dem Heldix Loader.');
    }
    return installModrinth(instances.dir(instance.id), instance.minecraft, String(projectId));
  });

  ipcMain.handle('accounts:list', () => store.listAccounts());
  ipcMain.handle('accounts:skin', async () => {
    const account = await store.getActiveAccount();
    return account ? skinFor(paths, account) : null;
  });
  ipcMain.handle('news:list', () => listNews(paths));
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: LAUNCHER_NAME,
    backgroundColor: '#050b18',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#dbeafe', height: 46 },
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  registerIpc();
  await ensureInstances().catch((error) => console.error('[Launcher] Instanzen konnten nicht vorbereitet werden', error));
  createWindow();
  applyPresenceSettings(await store.getSettings());
});

// Discord-Status beim Beenden löschen
app.on('before-quit', () => discord.stop());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
