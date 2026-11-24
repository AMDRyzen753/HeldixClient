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

export type InstancePatch = Partial<Pick<InstanceInfo, 'name' | 'color' | 'memoryMb'>>;

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
  active: boolean;
}

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
  | { state: 'exited'; code: number | null }
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

export type FolderKind = 'data' | 'instance' | 'mods' | 'addons' | 'logs' | 'saves';

export type DiscordStatus =
  | { state: 'disabled' }
  | { state: 'unconfigured' }
  | { state: 'connecting' }
  | { state: 'connected'; user: string | null }
  | { state: 'unavailable' }
  | { state: 'error'; message: string };

export interface HeldixApi {
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
  pathForFile(file: File): string;

  searchModrinth(instanceId: string, query: string, offset: number): Promise<ModrinthSearchResult>;
  installModrinth(instanceId: string, projectId: string): Promise<string[]>;

  listAccounts(): Promise<AccountInfo[]>;
  addMicrosoftAccount(): Promise<AccountInfo>;
  addOfflineAccount(name: string): Promise<AccountInfo>;
  removeAccount(id: string): Promise<void>;
  selectAccount(id: string): Promise<void>;

  launch(instanceId?: string): Promise<void>;
  killGame(): Promise<void>;
  getGameState(): Promise<GameState>;
  openFolder(kind: FolderKind, instanceId?: string): Promise<void>;

  onProgress(callback: (event: ProgressEvent) => void): () => void;
  onLog(callback: (lines: LogLine[]) => void): () => void;
  onGameState(callback: (state: GameState) => void): () => void;
  getDiscordStatus(): Promise<DiscordStatus>;
  onDiscordStatus(callback: (status: DiscordStatus) => void): () => void;
}
