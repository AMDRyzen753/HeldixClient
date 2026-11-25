// Typen, die Main-Prozess, Preload und Oberfläche gemeinsam nutzen.
// Absichtlich eine .d.ts-Datei: sie erzeugt keinen JavaScript-Code.

/** heldix = Fabric + HeldixClient-Mod + Heldix-Addons; fabric = nur Fabric; vanilla = ohne Mods */
export type InstanceLoader = 'heldix' | 'fabric' | 'vanilla';

export interface VersionInfo {
  id: string;
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
  releaseTime: string;
  /** Fabric unterstützt diese Version */
  fabric: boolean;
  /** Für diese Version liegt eine gebaute HeldixClient-Mod im Launcher */
  clientMod: boolean;
}

export interface VersionListResult {
  versions: VersionInfo[];
  latestRelease: string;
  /** true, wenn die Liste aus dem Cache kommt (keine Internetverbindung) */
  offline: boolean;
}

/** Grafik-API von Minecraft (ab 26.x wählbar): Vulkan, Minecraft entscheiden lassen oder OpenGL */
export type GraphicsApi = 'vulkan' | 'default' | 'opengl';

export interface Settings {
  selectedInstanceId: string | null;
  memoryMb: number;
  hideLauncherOnLaunch: boolean;
  resolution: { width: number; height: number } | null;
  jvmArgs: string;
  javaPath: string;
  /** Discord-Status (Rich Presence) anzeigen */
  discordPresence: boolean;
  /** Serveradresse im Discord-Status zeigen (nur öffentliche Domains) */
  discordShowServer: boolean;
  /** Grafik-API für Minecraft-Versionen mit Vulkan-Unterstützung */
  graphicsApi: GraphicsApi;
  /** abgestimmte JVM-Einstellungen (G1, kompakte Objekt-Header ab Java 25) */
  jvmTuning: boolean;
  /** Entwickleroptionen (Offline-Konten ohne Microsoft-Konto, nur mit Entwickler-Schlüssel) */
  developerMode: boolean;
  /** neue Launcher-Versionen im Hintergrund laden und beim Beenden installieren */
  autoUpdate: boolean;
  /** zuletzt gesehene Version für "Was ist neu" (null = noch nie) */
  lastSeenVersion: string | null;
}

/** "Was ist neu" nach einem Update: alle Versionen seit der zuletzt gesehenen */
export interface WhatsNew {
  version: string;
  entries: { version: string; date: string; notes: string[] }[];
}

/** Bereich auf heldixclient.com nach der Anmeldung */
export type WebTarget = 'profil' | 'freunde' | 'nachrichten' | 'privatsphaere' | 'daten' | 'support' | 'team';

/** Stand der automatischen Updates (siehe main/core/updater.ts) */
export interface UpdateState {
  /** available = neue Version, nur zum Herunterladen von der Webseite (macOS) */
  phase: 'disabled' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  version?: string;
  notes?: string[];
  date?: string;
  progress?: number;
  error?: string;
  checkedAt?: number;
}

export interface DeveloperStatus {
  /** Entwickleroptionen eingeschaltet */
  enabled: boolean;
  /** Kennung dieses PCs für Entwickler-Schlüssel, z. B. "3F2A-91C0-7B44-E0D1" */
  machineCode: string;
  keyValid: boolean;
  /** für wen der Schlüssel ausgestellt ist */
  keyName: string | null;
  /** warum der Schlüssel nicht gilt */
  reason: string | null;
  /** wo der Launcher den Schlüssel sucht */
  keyPath: string;
  /** Schlüssel wurde gerade automatisch erstellt (Signaturschlüssel des Entwicklers liegt auf diesem PC) */
  autoCreated: boolean;
}

// ---------- Instanzen ----------

export interface InstanceInfo {
  id: string;
  name: string;
  minecraft: string;
  loader: InstanceLoader;
  /** Akzentfarbe der Kachel, z. B. "#8b5cf6" */
  color: string;
  created: number;
  lastPlayed: number | null;
  playTimeMs: number;
  /** eigener RAM-Wert für diese Instanz (null = globale Einstellung) */
  memoryMb: number | null;
  /** HeldixClient läuft in dieser Instanz (Heldix immer, Fabric abschaltbar, Vanilla nie) */
  heldixClient: boolean;
  modCount: number;
  addonCount: number;
  path: string;
}

export interface NewInstance {
  name: string;
  minecraft: string;
  loader: InstanceLoader;
  color: string;
}

export type InstancePatch = Partial<Pick<InstanceInfo, 'name' | 'color' | 'memoryMb' | 'heldixClient'>>;

/** Ergebnis von "Leistungs-Paket installieren" */
export interface PerformancePackResult {
  installed: string[];
  alreadyInstalled: string[];
  /** gibt es für diese Minecraft-Version (noch) nicht */
  unavailable: string[];
  /** Hinweise, z. B. wegen eines Konflikts ausgeschaltete Mods */
  notes: string[];
}

/** Eine Mod- oder Addon-Datei in einer Instanz */
export interface ContentItem {
  file: string;
  enabled: boolean;
  /** vom Launcher verwaltet (Fabric API, HeldixClient-Mod) – nicht löschbar */
  managed: boolean;
  id: string | null;
  name: string;
  version: string | null;
  description: string;
  authors: string[];
  icon: string | null;
  /** Modrinth-Projekt, falls über den Launcher installiert */
  projectId: string | null;
  error: string | null;
}

export type ContentKind = 'mods' | 'addons';

/** Ein Addon, das der Launcher mitbringt (z. B. Spotify), mit Status in einer Instanz */
export interface BundledAddon {
  file: string;
  id: string;
  name: string;
  version: string | null;
  description: string;
  /** available = noch nicht installiert, update = ältere Version installiert */
  state: 'available' | 'installed' | 'update';
  installedVersion: string | null;
}

/** Ein Shaderpack im Ordner shaderpacks einer Fabric-Instanz */
export interface ShaderpackInfo {
  /** Datei- oder Ordnername */
  file: string;
  name: string;
  /** null bei entpackten Ordnern */
  sizeBytes: number | null;
  /** von Modrinth installiert */
  projectId: string | null;
  /** in Iris eingeschaltet */
  active: boolean;
}

export interface ShaderpackList {
  packs: ShaderpackInfo[];
  /** aktives Pack (null = Shader aus) */
  active: string | null;
  irisInstalled: boolean;
  sodiumInstalled: boolean;
}

export interface ModrinthHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  iconUrl: string | null;
  installed: boolean;
}

export interface ModrinthSearchResult {
  hits: ModrinthHit[];
  total: number;
  offset: number;
}

// ---------- Konten, Status, Logs ----------

export interface AccountInfo {
  id: string;
  type: 'microsoft' | 'offline';
  name: string;
  uuid: string;
  skinUrl?: string;
  /** angemeldet über den offiziellen Minecraft Launcher */
  via?: 'launcher';
  active: boolean;
}

/** Warten auf die Anmeldung über den offiziellen Minecraft Launcher */
export type BridgeState =
  | { waiting: false }
  | { waiting: true; /** nur anmelden oder danach das Spiel starten */ purpose: 'login' | 'launch'; /** war der Minecraft Launcher schon offen? */ launcherWasRunning: boolean };

export interface ProgressEvent {
  stage: string;
  done: number;
  total: number;
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogLine {
  level: LogLevel;
  text: string;
}

export type GameState =
  | { state: 'idle' }
  | { state: 'preparing'; instanceId: string }
  | { state: 'running'; pid: number; instanceId: string; label: string }
  | { state: 'exited'; code: number | null; /** Hinweis des Launchers, z. B. nach einem Vulkan-Absturz */ notice?: string }
  | { state: 'error'; message: string };

export interface AppInfo {
  name: string;
  clientName: string;
  version: string;
  isDev: boolean;
  microsoftConfigured: boolean;
  discordConfigured: boolean;
  /** Version des mitgelieferten Heldix Loaders, z. B. "2.0.0" */
  loaderVersion: string | null;
  dataDir: string;
  totalMemoryMb: number;
}

export type FolderKind = 'data' | 'instance' | 'mods' | 'addons' | 'logs' | 'saves' | 'shaderpacks';

export interface SkinInfo {
  /** Skin-Textur als data:-URL */
  dataUrl: string;
  /** schmales Modell (Alex), breites (Steve) oder null = am Bild erkennen */
  slim: boolean | null;
  source: 'account' | 'default';
}

/** Echte Logos für die Instanz-Kacheln (Daten-URLs, null = nicht verfügbar) */
export interface LoaderLogos {
  fabric: string | null;
  vanilla: string | null;
}

export interface NewsEntry {
  id: string;
  title: string;
  version: string;
  /** heldix = Neuigkeit vom HeldixClient-Team (über den Heldix-Dienst) */
  type: 'release' | 'snapshot' | 'heldix';
  /** ISO-Datum */
  date: string;
  summary: string;
  image: string | null;
  /** nur bei heldix: ganzer Text (reiner Text, Absätze durch Leerzeilen) und Autor */
  text?: string;
  author?: string;
}

export interface QuickPlayTarget {
  kind: 'world' | 'server';
  /** Ordnername der Welt bzw. Serveradresse */
  id: string;
  name: string;
  address: string | null;
  lastPlayed: number | null;
  /** Bild als data:-URL */
  icon: string | null;
}

export interface QuickPlayList {
  /** Kann diese Minecraft-Version direkt in Welten/Server starten? */
  supported: boolean;
  targets: QuickPlayTarget[];
}

export type DiscordStatus =
  | { state: 'disabled' }
  | { state: 'unconfigured' }
  | { state: 'connecting' }
  | { state: 'connected'; user: string | null }
  | { state: 'unavailable' }
  | { state: 'error'; message: string };

export interface HeldixApi {
  /** Betriebssystem: win32, darwin oder linux */
  platform: string;
  /** Download-Seite der Webseite öffnen (macOS: neue Version von Hand laden) */
  openUpdateDownload(): Promise<void>;
  appInfo(): Promise<AppInfo>;
  listVersions(): Promise<VersionListResult>;
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;

  listInstances(): Promise<InstanceInfo[]>;
  createInstance(data: NewInstance): Promise<InstanceInfo>;
  updateInstance(id: string, patch: InstancePatch): Promise<InstanceInfo>;
  deleteInstance(id: string): Promise<void>;
  selectInstance(id: string): Promise<void>;

  listContent(instanceId: string, kind: ContentKind): Promise<ContentItem[]>;
  setContentEnabled(instanceId: string, kind: ContentKind, file: string, enabled: boolean): Promise<void>;
  removeContent(instanceId: string, kind: ContentKind, file: string): Promise<void>;
  /** Ohne Pfade öffnet sich ein Dateidialog */
  addContentFiles(instanceId: string, kind: ContentKind, paths?: string[]): Promise<number>;
  /** Mitgelieferte Heldix-Addons und ob sie in der Instanz installiert sind */
  listBundledAddons(instanceId: string): Promise<BundledAddon[]>;
  /** Installiert bzw. aktualisiert ein mitgeliefertes Addon; gibt den Namen zurück */
  installBundledAddon(instanceId: string, file: string): Promise<string>;
  pathForFile(file: File): string;

  searchModrinth(instanceId: string, query: string, offset: number): Promise<ModrinthSearchResult>;
  installModrinth(instanceId: string, projectId: string): Promise<string[]>;
  /** Sodium, Lithium, FerriteCore & Co. in eine Fabric-Instanz installieren */
  installPerformancePack(instanceId: string): Promise<PerformancePackResult>;

  listShaderpacks(instanceId: string): Promise<ShaderpackList>;
  searchShaderpacks(instanceId: string, query: string, offset: number): Promise<ModrinthSearchResult>;
  /** lädt das Pack, installiert bei Bedarf Iris + Sodium und schaltet es ein */
  installShaderpack(instanceId: string, projectId: string): Promise<{ title: string; mods: string[]; notes: string[] }>;
  setActiveShaderpack(instanceId: string, file: string | null): Promise<void>;
  removeShaderpack(instanceId: string, file: string): Promise<void>;
  addShaderpackFiles(instanceId: string, paths?: string[]): Promise<number>;

  listAccounts(): Promise<AccountInfo[]>;
  /** Skin des aktiven Kontos für die 3D-Figur */
  getSkin(): Promise<SkinInfo | null>;
  listNews(): Promise<NewsEntry[]>;
  loaderLogos(): Promise<LoaderLogos>;
  getNewsBody(id: string): Promise<string>;
  addMicrosoftAccount(): Promise<AccountInfo>;
  addOfflineAccount(name: string): Promise<AccountInfo>;
  /** Anmeldung über den offiziellen Minecraft Launcher (Installation „HeldixClient“ dort starten) */
  addAccountViaLauncher(): Promise<AccountInfo>;
  cancelBridge(): Promise<void>;
  reopenOfficialLauncher(): Promise<void>;
  onBridgeState(callback: (state: BridgeState) => void): () => void;
  /** Konten haben sich geändert (z. B. Anmeldung über den Minecraft Launcher) */
  onAccountsChanged(callback: () => void): () => void;
  getDeveloperStatus(): Promise<DeveloperStatus>;
  /** Signaturschlüssel (signing-key.pem) oder Entwickler-Schlüssel (developer.key) auswählen; null = abgebrochen */
  importDeveloperKey(): Promise<DeveloperStatus | null>;
  removeAccount(id: string): Promise<void>;
  selectAccount(id: string): Promise<void>;

  launch(instanceId?: string, target?: Pick<QuickPlayTarget, 'kind' | 'id'>): Promise<void>;
  listQuickPlay(instanceId: string): Promise<QuickPlayList>;
  killGame(): Promise<void>;
  getGameState(): Promise<GameState>;
  openFolder(kind: FolderKind, instanceId?: string): Promise<void>;

  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onLog(callback: (lines: LogLine[]) => void): () => void;
  onGameState(callback: (state: GameState) => void): () => void;
  getDiscordStatus(): Promise<DiscordStatus>;
  onDiscordStatus(callback: (status: DiscordStatus) => void): () => void;

  getUpdateState(): Promise<UpdateState>;
  checkForUpdate(): Promise<UpdateState>;
  /** startet den Installer und beendet den Launcher (er öffnet sich danach neu) */
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;

  /** öffnet heldixclient.com im Browser, schon angemeldet (Profil, Freunde, Nachrichten, Support, Team-Bereich) */
  openWebAccount(target?: WebTarget): Promise<void>;
  /** öffnet eine öffentliche Seite von heldixclient.com, z. B. "neuigkeiten" */
  openWebsite(page: 'neuigkeiten' | 'das-team' | 'status' | 'download' | 'hilfe'): Promise<void>;
  /** null = nichts Neues zu zeigen */
  getWhatsNew(): Promise<WhatsNew | null>;
  markWhatsNewSeen(): Promise<void>;
}
