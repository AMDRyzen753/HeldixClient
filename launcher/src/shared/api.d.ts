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
  /** neue Launcher-Versionen im Hintergrund laden und beim Beenden installieren */
  autoUpdate: boolean;
  /** zuletzt gesehene Version für "Was ist neu" (null = noch nie) */
  lastSeenVersion: string | null;
  /** Freunde und Nachrichten im Launcher (Heldix-Dienst, nur mit Microsoft-Konto) */
  social: boolean;
  /** Windows-/macOS-Benachrichtigung bei neuen Nachrichten und Anfragen, wenn der Launcher nicht im Vordergrund ist */
  socialNotifications: boolean;
  /** Benachrichtigung, wenn es für installierte Addons Updates gibt (einmal je Version) */
  addonUpdateNotifications: boolean;
  /** Addon-Updates automatisch installieren, wenn kein Spiel läuft */
  addonAutoUpdate: boolean;
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
  /** Ordner der Datei: mods/ oder heldix-addons/ */
  kind: ContentKind;
  /** Was in der JAR steckt (null = nicht lesbar) */
  format: ContentFormat | null;
  /** Addons: api = nur Heldix-API, minecraft = greift in Minecraft ein (clientEntrypoint/transformers, alte Heldix-Mods); null bei Fabric-Mods */
  access: AddonAccess | null;
  /** Minecraft-Versionen aus heldix.addon.json bzw. heldix.mod.json (leer = jede) */
  minecraft: string[];
}

export type ContentKind = 'mods' | 'addons';
/** fabric = Fabric-Mod (fabric.mod.json), addon = Heldix-Addon (heldix.addon.json), heldix-mod = ältere Heldix-Mod (heldix.mod.json) */
export type ContentFormat = 'fabric' | 'addon' | 'heldix-mod';
/** Zugriff eines Addons: nur über die Heldix-API oder direkt in Minecraft (Transformer, Start mit dem Heldix Loader) */
export type AddonAccess = 'api' | 'minecraft';

/** Ergebnis von „Datei hinzufügen“: JARs werden anhand ihrer Beschreibung einsortiert */
export interface ContentImportResult {
  added: { file: string; name: string; kind: ContentKind; format: ContentFormat }[];
  /** deutsche Meldung je abgelehnter Datei */
  errors: string[];
}

/** Neuere Version einer über Modrinth installierten Mod (für Minecraft-Version und Loader der Instanz) */
export interface ModrinthUpdate {
  /** Datei im mods-Ordner (auch .jar.disabled) */
  file: string;
  projectId: string;
  title: string;
  versionId: string;
  /** Versionsnummer laut Modrinth */
  version: string;
}

// ---------- Freunde & Nachrichten (Heldix-Dienst, siehe docs/dienst.md) ----------

/**
 * disabled = in den Einstellungen aus · no-service = kein Heldix-Dienst eingerichtet · no-account = nicht angemeldet ·
 * offline-account = aktives Konto ist ein Offline-Konto · connecting = meldet sich gerade an · online · error (siehe error)
 */
export type SocialStatus = 'disabled' | 'no-service' | 'no-account' | 'offline-account' | 'connecting' | 'online' | 'error';
/** Was ein Freund gerade macht (null = online im Menü bzw. unbekannt) */
export type FriendActivity = 'menu' | 'singleplayer' | 'multiplayer' | 'realms' | 'lan';

export interface Friend {
  /** UUID ohne Bindestriche, klein */
  uuid: string;
  name: string;
  online: boolean;
  activity: FriendActivity | null;
  /** Server (nur im Mehrspieler und wenn der Freund ihn zeigt), z. B. "hypixel.net" oder "mc.example.de:25570" */
  server: string | null;
  /** befreundet seit (ms) */
  since: number;
  /** ungelesene Nachrichten von ihm */
  unread: number;
}

export interface FriendRequest {
  uuid: string;
  name: string;
  /** gesendet am (ms) */
  at: number;
}

export interface SocialOverview {
  status: SocialStatus;
  /** deutsche Fehlermeldung bei status = error */
  error: string | null;
  /** beim Dienst angemeldeter Spieler */
  me: { uuid: string; name: string } | null;
  /** online zuerst, dann nach Name */
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  /** ungelesene Nachrichten insgesamt */
  unread: number;
}

export interface ChatMessage {
  /** steigt mit jeder Nachricht */
  id: number;
  from: string;
  to: string;
  /** reiner Text, nie als HTML ausgeben */
  text: string;
  at: number;
  read: boolean;
  /** vom angemeldeten Spieler gesendet */
  mine: boolean;
}

export interface Conversation {
  /** UUID und Name des Freundes */
  uuid: string;
  name: string;
  last: ChatMessage | null;
  unread: number;
}

export interface BlockedPlayer {
  uuid: string;
  name: string;
  /** blockiert seit (ms) */
  at: number;
}

export type ReportReason = 'spam' | 'harassment' | 'inappropriate' | 'other';

/** Privatsphäre beim Heldix-Dienst (dieselben Schalter wie im Spiel und auf heldixclient.com) */
export interface SocialPrivacy {
  /** Cape und Heldix-Symbol für andere sichtbar */
  visible: boolean;
  /** Freunde sehen, ob du online bist */
  presence: boolean;
  /** Freunde sehen den Server */
  showServer: boolean;
  /** Nachrichten von Freunden annehmen */
  messages: boolean;
}

// ---------- Skins & Capes ----------

export type SkinVariant = 'classic' | 'slim';

/** Skin in der eigenen Sammlung des Launchers (Datenordner/skins) */
export interface SavedSkin {
  id: string;
  name: string;
  variant: SkinVariant;
  /** PNG als data:-URL (64×64 oder altes 64×32) */
  dataUrl: string;
  addedAt: number;
  /** gleiches Bild wie der gerade bei Mojang aktive Skin */
  active: boolean;
}

/** Cape von Mojang/Minecraft, das das Konto besitzt */
export interface MojangCape {
  id: string;
  /** Name bei Mojang, z. B. "Migrator" */
  alias: string;
  /** Textur als data:-URL (64×32), null = nicht ladbar */
  dataUrl: string | null;
  active: boolean;
}

/** Heldix-Cape aus der Client-Mod; Bild liegt in der Oberfläche unter capes/<id>.png (alle Bilder der Animation untereinander, je 512×256) */
export interface HeldixCape {
  id: string;
  name: string;
  description: string;
  frames: number;
  fps: number;
  /** hat Leuchtteile (capes/<id>_glow.png) */
  glow: boolean;
}

export interface ProfileState {
  account: { uuid: string; name: string; type: 'microsoft' | 'offline'; via?: 'launcher' } | null;
  /** Skin und Mojang-Cape lassen sich ändern (Microsoft-Konto mit gültiger Anmeldung) */
  canEditSkin: boolean;
  /** aktueller Skin des Kontos (bzw. Standard-Skin) */
  skin: { dataUrl: string; variant: SkinVariant } | null;
  mojangCapes: MojangCape[];
  /** Heldix-Dienst erreichbar und angemeldet: Heldix-Cape lässt sich wählen */
  heldixAvailable: boolean;
  /** gewähltes Heldix-Cape (null = keins) */
  heldixCape: string | null;
  heldixCapes: HeldixCape[];
  library: SavedSkin[];
  /** deutsche Meldung, wenn etwas nicht geladen werden konnte (Rest der Daten bleibt nutzbar) */
  error: string | null;
}

// ---------- Cosmetics (Katalog des Heldix-Dienstes, siehe core/cosmeticcatalog.ts) ----------

/** head = Hüte & Kopf, back = Flügel & Rücken, aura = Partikel, companion = Begleiter, cape = zusätzliche Capes */
export type CosmeticSlotName = 'head' | 'back' | 'aura' | 'companion' | 'cape';
/** Slots, die an der Figur als Modell oder Partikel erscheinen (Capes laufen über die Cape-Auswahl) */
export type CosmeticModelSlot = 'head' | 'back' | 'aura' | 'companion';
export type CosmeticVec3 = [number, number, number];

/**
 * Fläche eines Würfels mit Box-UV wie in Minecraft (aus core/cosmetics.ts → cosmeticCubeFaces). Modellkoordinaten in
 * Pixeln (1/16 Block), +Y oben, +Z vorn, +X = linke Seite des Trägers.
 */
export interface CosmeticFace {
  /** oben links, oben rechts, unten rechts, unten links (bezogen auf die Textur) */
  corners: [CosmeticVec3, CosmeticVec3, CosmeticVec3, CosmeticVec3];
  /** Texturpixel zu den Ecken */
  uvs: [[number, number], [number, number], [number, number], [number, number]];
  normal: CosmeticVec3;
}

export interface CosmeticBoneData {
  name: string;
  /** Eltern-Bone (steht immer vorher in der Liste) */
  parent: string | null;
  /** absolut in Modellkoordinaten (nicht relativ zum Eltern-Bone) */
  pivot: CosmeticVec3;
  /** Ruhelage in Grad; Matrix = Eltern · T(pivot + bob) · Rz · Ry · Rx · T(−pivot) */
  rotation: CosmeticVec3;
  faces: CosmeticFace[];
}

export interface CosmeticAnimationData {
  bone: string;
  type: 'flap' | 'sway' | 'spin' | 'bob';
  axis: 'x' | 'y' | 'z';
  amplitude: number;
  speed: number;
  phase: number;
}

export interface CosmeticParticlesData {
  frames: number;
  /** pro Sekunde */
  rate: number;
  /** Ticks (1/20 s) */
  lifetime: number;
  /** Kantenlänge in Blöcken */
  size: number;
  motion: 'rise' | 'fall' | 'orbit' | 'spark' | 'float';
  /** Blöcke */
  radius: number;
  /** #rrggbb, tönt multiplikativ */
  color: string;
  fullbright: boolean;
}

/** Cosmetic aus dem Katalog: Signatur und alle Regeln geprüft */
export interface CosmeticItem {
  id: string;
  slot: CosmeticSlotName;
  version: number;
  name: string;
  description: string;
  /** access: team – nur Team-Mitglieder dürfen es wählen (alle sehen es) */
  teamOnly: boolean;
  /** SHA-256 des Umschlags (neu mit jeder Version) */
  sha256: string;
  /** PNG als data:-URL (auch Palette-PNGs) */
  texture: string;
  /** Leuchtebene (ohne Licht gezeichnet), gleich groß wie texture */
  glow: string | null;
  /** Breite und Höhe der Textur in Pixeln */
  textureSize: [number, number];
  /** Modell (head, back, companion), sonst leer */
  bones: CosmeticBoneData[];
  animations: CosmeticAnimationData[];
  /** nur aura: Textur = frames quadratische Bilder nebeneinander */
  particles: CosmeticParticlesData | null;
  /** nur cape: Bilder (64, 128 oder 256 breit, je halb so hoch) untereinander */
  cape: { frames: number; fps: number } | null;
  /** nur companion: Platz in Blöcken (x rechts, y hoch, z vorn) und Größe */
  companion: { offset: CosmeticVec3; scale: number } | null;
}

/** Eigene Auswahl je Slot (null = nichts); cape auch eingebaute Heldix-Capes */
export interface CosmeticSelection {
  head: string | null;
  back: string | null;
  aura: string | null;
  companion: string | null;
  cape: string | null;
}

export interface CosmeticsState {
  /** Katalog in der Reihenfolge des Dienstes (nach Slot, dann Name) */
  items: CosmeticItem[];
  /** null = unbekannt (kein Konto, Offline-Konto, Dienst nicht erreichbar) */
  selection: CosmeticSelection | null;
  /** Auswahl lässt sich ändern (angemeldet beim Heldix-Dienst) */
  canChoose: boolean;
  /** im HeldixClient-Team (darf Cosmetics „nur fürs Team“ wählen); null = unbekannt */
  team: boolean | null;
  /** deutsche Meldung, wenn etwas nicht ging (Rest bleibt nutzbar) */
  error: string | null;
}

// ---------- Addon-Store als eigene Seite ----------

/** Einreicher eines Community-Addons (aus dem signierten Manifest) */
export interface AddonAuthor {
  uuid: string;
  name: string;
}

export interface AddonRating {
  /** Durchschnitt mit einer Nachkommastelle, 0 ohne Bewertungen */
  average: number;
  count: number;
}

export type AddonReportReason = 'malware' | 'broken' | 'inappropriate' | 'copyright' | 'other';

export interface AddonDetails {
  /** neueste zuerst */
  versions: { version: string; date: string; notes: string[] }[];
}

/** Addon im Store mit Zustand in jeder Heldix-Instanz */
export interface StoreListing {
  id: string;
  name: string;
  version: string;
  summary: string;
  description: string;
  authors: string[];
  icon: string;
  category: 'hud' | 'musik' | 'chat' | 'werkzeuge' | 'sonstiges';
  platforms: ('windows' | 'mac' | 'linux')[];
  api: number;
  size: number;
  sha256: string;
  date: string;
  notes: string[];
  downloads: number;
  /** vom HeldixClient-Team (signiert im Manifest); false = Community-Addon eines Spielers */
  official: boolean;
  /** Einreicher bei Community-Addons, null bei offiziellen */
  author: AddonAuthor | null;
  rating: AddonRating;
  /** eigene Bewertung 1–5 (nur mit Microsoft-Konto und Heldix-Dienst), sonst null */
  myRating: number | null;
  /** Anzahl Screenshots (Bilder über getAddonScreenshot) */
  screenshots: number;
  /** warum es auf diesem PC nicht läuft (System oder API), sonst null */
  problem: string | null;
  /** api = nur Heldix-API, minecraft = greift in Minecraft ein (aus dem signierten Manifest) */
  access: AddonAccess;
  /** Minecraft-Versionen (leer = jede) */
  minecraft: string[];
  /** Instanzen, in denen es läuft: Heldix Loader und/oder Fabric mit HeldixClient */
  loaders: ('heldix' | 'fabric')[];
  /** reason: warum es in dieser Instanz nicht läuft (bei unsupported-*), sonst null */
  installs: { instanceId: string; state: StoreAddon['state']; installedVersion: string | null; reason: string | null }[];
}

export interface StoreOverview {
  addons: StoreListing[];
  /** Instanzen, in denen Heldix-Addons laufen (Heldix Loader oder Fabric mit HeldixClient) */
  instances: { id: string; name: string; minecraft: string; loader: InstanceLoader }[];
  /** deutsche Meldung, wenn der Store nicht erreichbar war (addons ist dann leer) */
  error: string | null;
}

/** Ein Addon aus dem Addon-Store (Signatur geprüft) mit Status in einer Instanz */
export interface StoreAddon {
  id: string;
  name: string;
  version: string;
  summary: string;
  /** Klartext: Absätze durch Leerzeile, Zeilen mit „- “ sind Listenpunkte */
  description: string;
  authors: string[];
  /** Name aus dem Heldix-Icon-Set */
  icon: string;
  category: 'hud' | 'musik' | 'chat' | 'werkzeuge' | 'sonstiges';
  /** leer = alle Systeme */
  platforms: ('windows' | 'mac' | 'linux')[];
  api: number;
  size: number;
  date: string;
  notes: string[];
  downloads: number;
  /** api = nur Heldix-API, minecraft = greift in Minecraft ein */
  access: AddonAccess;
  /** Minecraft-Versionen (leer = jede) */
  minecraft: string[];
  /** Instanzen, in denen es läuft */
  loaders: ('heldix' | 'fabric')[];
  /**
   * available = nicht installiert, update = ältere Version installiert, unsupported-* = läuft hier nicht
   * (API-Stufe, System, Minecraft-Version der Instanz, Loader der Instanz)
   */
  state: 'available' | 'installed' | 'update' | 'unsupported-api' | 'unsupported-platform' | 'unsupported-minecraft' | 'unsupported-loader';
  /** Warum es hier nicht läuft (bei unsupported-*), z. B. „Nur für Minecraft 26.3“ */
  reason: string | null;
  installedVersion: string | null;
  installedEnabled: boolean | null;
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
  /** früher über den offiziellen Minecraft Launcher angemeldet (gibt es nicht mehr): nach Ablauf neu mit Microsoft anmelden */
  via?: 'launcher';
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
  | { state: 'exited'; code: number | null; /** Hinweis des Launchers, z. B. nach einem Vulkan-Absturz */ notice?: string; /** Absturz erkannt: Analyse über getLastCrash() */ crash?: { id: string; title: string } }
  | { state: 'error'; message: string };

// ---------- Absturz-Hilfe ----------

export type CrashKind =
  | 'memory' | 'memory-too-high' | 'java-version' | 'disk-full' | 'graphics-driver' | 'opengl'
  | 'mod-dependency' | 'mod-conflict' | 'shaderpack' | 'mod-incompatible' | 'world' | 'heldixclient' | 'unknown';

/** Vorschlag mit Knopf im Absturz-Dialog */
export interface CrashAction {
  kind: 'raise-memory' | 'lower-memory' | 'reset-java' | 'use-opengl' | 'help' | 'shaders' | 'disable-mod' | 'open-report' | 'open-logs';
  label: string;
  /** Mod-Datei bei disable-mod */
  file?: string;
  /** Hilfe-Artikel auf heldixclient.com (/hilfe/<slug>) bei help */
  help?: string;
}

/** Was der Launcher nach einem Absturz herausgefunden hat (bleibt auf dem PC, bis der Spieler sie sendet) */
export interface CrashAnalysis {
  id: string;
  instanceId: string;
  instanceName: string;
  at: number;
  exitCode: number | null;
  kind: CrashKind;
  /** kurze Ursache, z. B. „Zu wenig Arbeitsspeicher“ */
  title: string;
  /** 1–3 Sätze für Spieler */
  explanation: string;
  /** vermutlich beteiligte Mods (Datei im mods-Ordner) */
  suspects: { name: string; id: string | null; file: string | null }[];
  actions: CrashAction[];
  /** „Description:“ aus dem Crash-Report */
  description: string | null;
  /** erste Fehlerzeile, technisch */
  detail: string;
  hasCrashReport: boolean;
  hasJvmError: boolean;
}

/** Genau das, was an den Support ginge (Benutzerordner durch ~ ersetzt, Zugangsdaten entfernt) */
export interface CrashReportPreview {
  subject: string;
  message: string;
  attachments: { name: string; size: number; text: string }[];
  /** Senden möglich (Microsoft-Konto und Heldix-Dienst)? */
  canSend: boolean;
  reason: string | null;
}

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

/** Status eines Servers aus der Serverliste (wie in Minecrafts Mehrspieler-Liste) */
export interface ServerStatus {
  online: boolean;
  players: { online: number; max: number } | null;
  /** Antwortzeit in ms */
  latencyMs: number | null;
  /** Versionsname des Servers, z. B. "Paper 1.21.4" */
  version: string | null;
  /** Nachricht des Servers als Klartext (Zeilen mit „ · “ verbunden) */
  motd: string | null;
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
  /** „Mods & Addons“: Fabric-Mods, Heldix-Addons und ältere Heldix-Mods der Instanz in einer Liste (ohne Netz) */
  listInstanceContent(instanceId: string): Promise<ContentItem[]>;
  /**
   * Addons (heldix-addons/) lassen sich auch schalten, während die Instanz läuft – das wirkt nach dem Neustart;
   * Mods (mods/) erst nach dem Beenden.
   */
  setContentEnabled(instanceId: string, kind: ContentKind, file: string, enabled: boolean): Promise<void>;
  removeContent(instanceId: string, kind: ContentKind, file: string): Promise<void>;
  /**
   * „Datei hinzufügen“ und Drag & Drop: JARs anhand ihrer Beschreibung einsortieren – heldix.addon.json → heldix-addons/,
   * heldix.mod.json und fabric.mod.json → mods/. Ohne paths öffnet sich die Dateiauswahl.
   */
  importContentFiles(instanceId: string, paths?: string[]): Promise<ContentImportResult>;
  /** Ohne Pfade öffnet sich ein Dateidialog */
  addContentFiles(instanceId: string, kind: ContentKind, paths?: string[]): Promise<number>;
  /** Addons aus dem Addon-Store mit Status in der Instanz */
  listStoreAddons(instanceId: string): Promise<StoreAddon[]>;
  /** Lädt ein Addon aus dem Store (Signatur und Prüfsumme geprüft) in die Instanz; gibt den Namen zurück */
  installStoreAddon(instanceId: string, addonId: string): Promise<string>;
  /** Addon-Store als eigene Seite: alle Addons mit Zustand je Instanz */
  getStoreOverview(): Promise<StoreOverview>;
  /** Entfernt alle Dateien dieses Addons aus der Instanz (nicht, während sie läuft) */
  uninstallStoreAddon(instanceId: string, addonId: string): Promise<void>;
  /** Versionsverlauf eines Addons */
  getAddonDetails(addonId: string): Promise<AddonDetails>;
  /** Screenshot 1–4 als data:-URL (zwischengespeichert), null = nicht ladbar */
  getAddonScreenshot(addonId: string, index: number): Promise<string | null>;
  /** eigene Bewertung setzen (1–5) oder entfernen (null); braucht Microsoft-Konto und Heldix-Dienst */
  rateAddon(addonId: string, stars: number | null): Promise<AddonRating & { myRating: number | null }>;
  reportAddon(addonId: string, reason: AddonReportReason, note?: string): Promise<void>;
  /** alle Addon-Updates in allen Instanzen installieren, die gerade nicht laufen */
  updateAllAddons(): Promise<{ updated: number; failed: string[] }>;
  /** Klick auf die Benachrichtigung „Addon-Updates verfügbar“: Addon-Store zeigen */
  onStoreOpen(callback: () => void): () => void;
  /**
   * Zahl der Addons mit Update (in irgendeiner Instanz) für das Abzeichen am Addon-Store: nach der Prüfung im Hintergrund
   * (Start, alle 6 h), nach getStoreOverview, Installieren, Entfernen und updateAllAddons; beim Laden der Oberfläche einmal
   */
  onStoreChanged(callback: (updates: number) => void): () => void;
  pathForFile(file: File): string;

  searchModrinth(instanceId: string, query: string, offset: number): Promise<ModrinthSearchResult>;
  installModrinth(instanceId: string, projectId: string): Promise<string[]>;
  /** neuere Versionen der über Modrinth installierten Mods (nur Fabric-Instanzen; 15 Minuten zwischengespeichert) */
  listModrinthUpdates(instanceId: string): Promise<ModrinthUpdate[]>;
  /** eine Modrinth-Mod aktualisieren; passt die neue Version nicht zu den übrigen Mods, bleibt die alte */
  updateModrinthMod(instanceId: string, file: string): Promise<{ title: string; version: string; notes: string[] }>;
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

  // ---------- Freunde & Nachrichten ----------
  getSocial(): Promise<SocialOverview>;
  /** sofort neu laden (sonst lädt der Launcher alle 20 s im Vordergrund nach) */
  refreshSocial(): Promise<SocialOverview>;
  onSocial(callback: (overview: SocialOverview) => void): () => void;
  /** Klick auf eine Benachrichtigung: Freunde öffnen, mit dieser Unterhaltung (null = nur die Liste) */
  onSocialOpen(callback: (uuid: string | null) => void): () => void;
  sendFriendRequest(name: string): Promise<SocialOverview>;
  acceptFriendRequest(uuid: string): Promise<SocialOverview>;
  /** Anfrage ablehnen bzw. eigene zurückziehen */
  removeFriendRequest(uuid: string): Promise<SocialOverview>;
  removeFriend(uuid: string): Promise<SocialOverview>;
  listConversations(): Promise<Conversation[]>;
  /** älteste zuerst; before = id der ältesten geladenen Nachricht für die vorige Seite */
  getMessages(uuid: string, before?: number): Promise<{ messages: ChatMessage[]; more: boolean }>;
  sendMessage(uuid: string, text: string): Promise<ChatMessage>;
  markRead(uuid: string): Promise<void>;
  listBlocked(): Promise<BlockedPlayer[]>;
  blockPlayer(uuid: string): Promise<BlockedPlayer[]>;
  unblockPlayer(uuid: string): Promise<BlockedPlayer[]>;
  reportPlayer(uuid: string, reason: ReportReason, note?: string): Promise<void>;
  getSocialPrivacy(): Promise<SocialPrivacy>;
  setSocialPrivacy(patch: Partial<SocialPrivacy>): Promise<SocialPrivacy>;
  /** startet eine HeldixClient-Instanz (Standard: die ausgewählte) und verbindet direkt mit dem Server des Freundes */
  joinFriend(uuid: string, instanceId?: string): Promise<void>;
  /** Skin eines Spielers (Freund, Anfrage, Blockierter) als PNG-data:-URL über den Heldix-Dienst, zwischengespeichert; null = Standard-Skin zeigen */
  getPlayerSkin(uuid: string): Promise<string | null>;

  // ---------- Skins & Capes ----------
  getProfile(refresh?: boolean): Promise<ProfileState>;
  /** ohne Pfade: Dateidialog. Prüft PNG (64×64 oder 64×32) und rät das Modell; Ergebnis landet in der Sammlung */
  importSkins(paths?: string[]): Promise<SavedSkin[]>;
  updateSavedSkin(id: string, patch: { name?: string; variant?: SkinVariant }): Promise<SavedSkin>;
  deleteSavedSkin(id: string): Promise<void>;
  /** lädt den gespeicherten Skin zu Mojang hoch (wirkt in allen Launchern und auf Servern) */
  applySkin(id: string): Promise<ProfileState>;
  /** Standard-Skin wiederherstellen */
  resetSkin(): Promise<ProfileState>;
  setMojangCape(id: string | null): Promise<ProfileState>;
  setHeldixCape(id: string | null): Promise<ProfileState>;
  /** Cosmetics-Katalog (geprüft, zwischengespeichert) und eigene Auswahl */
  getCosmetics(refresh?: boolean): Promise<CosmeticsState>;
  /** Cosmetic anlegen (id) oder ablegen (null); cape nimmt auch eingebaute Heldix-Capes */
  setCosmetic(slot: CosmeticSlotName, id: string | null): Promise<CosmeticsState>;
  /** eigene Auswahl hat sich geändert (Figur auf der Startseite neu laden) */
  onCosmeticsChanged(callback: () => void): () => void;
  listNews(): Promise<NewsEntry[]>;
  loaderLogos(): Promise<LoaderLogos>;
  getNewsBody(id: string): Promise<string>;
  addMicrosoftAccount(): Promise<AccountInfo>;
  addOfflineAccount(name: string): Promise<AccountInfo>;
  /** Konten haben sich geändert (Anmeldung, Kontowechsel, neuer Skin) */
  onAccountsChanged(callback: () => void): () => void;
  removeAccount(id: string): Promise<void>;
  selectAccount(id: string): Promise<void>;

  launch(instanceId?: string, target?: Pick<QuickPlayTarget, 'kind' | 'id'>): Promise<void>;
  /** letzte Absturz-Analyse dieser Sitzung (null = keine) */
  getLastCrash(): Promise<CrashAnalysis | null>;
  getCrashPreview(id: string, note: string, includeFiles: boolean): Promise<CrashReportPreview>;
  /** legt eine Support-Anfrage an (Kategorie „Fehler“) und hängt Crash-Report und Log an */
  sendCrashReport(id: string, note: string, includeFiles: boolean): Promise<{ ticketId: number; attached: number; attachmentError: string | null }>;
  openCrashReport(id: string): Promise<void>;
  listQuickPlay(instanceId: string): Promise<QuickPlayList>;
  /** Status eines Servers aus der Serverliste dieser Instanz (eine Minute zwischengespeichert) */
  getServerStatus(instanceId: string, address: string): Promise<ServerStatus>;
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
  openWebsite(page: 'neuigkeiten' | 'das-team' | 'status' | 'download' | 'hilfe' | 'addons' | `hilfe/${string}`): Promise<void>;
  /** null = nichts Neues zu zeigen */
  getWhatsNew(): Promise<WhatsNew | null>;
  markWhatsNewSeen(): Promise<void>;
}
