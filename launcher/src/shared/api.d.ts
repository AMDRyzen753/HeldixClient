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
  /** Knöpfe „Mitspielen“ und „HeldixClient holen“ im Discord-Status (Einladungslinks des Heldix-Dienstes) */
  discordInviteButtons: boolean;
  /** Dimension und Spielmodus im Discord-Status („Im Nether · Überleben“) */
  discordShowDetails: boolean;
  /** Name der Einzelspielerwelt im Discord-Status (Standard aus) */
  discordShowWorldName: boolean;
  /** Spielerzahl auf dem Server bzw. in der geteilten Welt („(3 von 8)“), in einer Heldix-Party deren Größe */
  discordShowParty: boolean;
  /** Voice Chat im Discord-Status („Im Voice mit 3 anderen“) */
  discordShowVoice: boolean;
  /** eigener Minecraft-Kopf als kleines Bild (vom Heldix-Dienst gerendert), sonst das Loader-Symbol */
  discordShowHead: boolean;
  /** nur „Spielt HeldixClient“ ohne weitere Angaben */
  discordMinimal: boolean;
  /** Fenster schließen, während ein Spiel läuft: Launcher bleibt im Infobereich (Tray) */
  closeToTray: boolean;
  /** Grafik-API für Minecraft-Versionen mit Vulkan-Unterstützung */
  graphicsApi: GraphicsApi;
  /** abgestimmte JVM-Einstellungen (G1, kompakte Objekt-Header ab Java 25) */
  jvmTuning: boolean;
  /** beim Start nach Updates suchen und gleich installieren, im laufenden Launcher im Hintergrund laden; aus = nur Hinweis */
  autoUpdate: boolean;
  /** zuletzt gesehene Version für "Was ist neu" (null = noch nie) */
  lastSeenVersion: string | null;
  /** Freunde und Nachrichten im Launcher (Heldix-Dienst, nur mit Microsoft-Konto) */
  social: boolean;
  /** Windows-/macOS-Benachrichtigung bei neuen Nachrichten und Anfragen, wenn der Launcher nicht im Vordergrund ist */
  socialNotifications: boolean;
  /** Party: dem Leiter automatisch folgen (nur, wenn gerade kein Spiel läuft; Standard aus) */
  partyAutoFollow: boolean;
  /** Benachrichtigung, wenn es für installierte Addons Updates gibt (einmal je Version) */
  addonUpdateNotifications: boolean;
  /** Addon-Updates automatisch installieren, wenn kein Spiel läuft */
  addonAutoUpdate: boolean;
  /** Kontowechsel im Spiel (Heldix-Menü) erlauben; beim ersten Wechsel zu einem Konto fragt der Launcher nach */
  gameAccountSwitch: boolean;
  /** Einrichtungs-Assistent erledigt (fertig oder übersprungen); bestehende Installationen gelten als eingerichtet */
  setupDone: boolean;
}

/** Einrichtungs-Assistent beim ersten Start (main/core/setup.ts) */
export interface SetupInfo {
  /** Assistent zeigen */
  show: boolean;
  /** Einladung (Link oder Download), die nach dem Assistenten im Einladungsdialog kommt; null = keine */
  invite: string | null;
}

/** Ein offizielles Addon im Schritt „Addons“ */
export interface SetupAddon {
  id: string;
  name: string;
  version: string;
  summary: string;
  /** Name im Heldix-Icon-Set */
  icon: string;
  category: 'hud' | 'musik' | 'chat' | 'werkzeuge' | 'sonstiges';
  /** Größe der JAR in Bytes */
  size: number;
  /** minecraft = greift in Minecraft ein */
  access: AddonAccess;
  /** empfohlen: Voice Chat, Minimap, Uhrzeit & Spielzeit */
  recommended: boolean;
  /** in allen passenden Ziel-Instanzen schon installiert (gleiche oder neuere Version) */
  installed: boolean;
  /** vorausgewählt (empfohlen und noch nicht installiert) */
  preselected: boolean;
}

export interface SetupAddons {
  /** offline = Addon-Store nicht erreichbar (Schritt überspringbar), no-instance = keine Instanz mit HeldixClient */
  status: 'ok' | 'offline' | 'no-instance';
  error: string | null;
  addons: SetupAddon[];
  /** Standard-Instanzen mit HeldixClient, in die installiert wird */
  targets: { id: string; name: string }[];
}

export interface SetupInstallResult {
  id: string;
  name: string;
  /** Instanzen, in die es installiert wurde */
  installed: string[];
  /** Instanzen, in denen es schon war */
  already: string[];
  /** Fehler (auch teilweise, z. B. eine Instanz läuft gerade) */
  error: string | null;
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

/**
 * Abzeichen (Heldix-Dienst ab 1.12.0, BADGE_LABELS in service/src/roles.ts): Team-Rolle (nur mit öffentlichem
 * Teamprofil), Community-Abzeichen oder Addon-Entwickler. null = normaler HeldixClient-Spieler (blaues „H“).
 * developer-team (Entwickler im Team) ist nicht developer (Addon-Entwickler).
 */
export type PlayerBadge = 'admin' | 'developer-team' | 'moderator' | 'supporter' | 'designer' | 'tester' | 'partner' | 'creator' | 'ambassador' | 'developer';

/** „Ist online“-Benachrichtigungen: für alle Freunde, nur Favoriten oder keine (wertet der Client aus) */
export type OnlineNotify = 'all' | 'favorites' | 'none';

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
  /** eigene Angaben, nur für dich: Favorit (Stern, oben in der Liste) */
  favorite: boolean;
  /** eigener Spitzname für ihn (höchstens 24 Zeichen), null = keiner */
  nickname: string | null;
  /** eigene Notiz (höchstens 200 Zeichen), null = keine */
  note: string | null;
  /** sein Statustext (höchstens 40 Zeichen), auch wenn er offline ist */
  statusText: string | null;
  /** „Nicht stören“ (nur, solange er online ist) */
  dnd: boolean;
  /** zuletzt online (ms, vom Dienst gerundet), nur offline und wenn er es zeigt */
  lastOnline: number | null;
  badge: PlayerBadge | null;
}

/** Eigenes Profil beim Dienst (GET /v1/me), soweit die Freunde-Seite es braucht */
export interface SocialMe {
  uuid: string;
  name: string;
  badge: PlayerBadge | null;
  statusText: string | null;
  dnd: boolean;
  onlineNotify: OnlineNotify;
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
  me: SocialMe | null;
  /** Favoriten zuerst, dann online, dann nach Name */
  friends: Friend[];
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
  /** ungelesene Nachrichten insgesamt */
  unread: number;
  /** Echtzeit-Begleiter (/v1/ws?client=launcher): live = verbunden, sonst fragt der Launcher regelmäßig ab */
  realtime: 'off' | 'connecting' | 'live';
}

/** Reaktionen auf Nachrichten (8 feste, REACTIONS in service/src/messages.ts); höchstens eine je Person */
export type ReactionId = 'like' | 'love' | 'laugh' | 'wow' | 'sad' | 'party' | 'fire' | 'eyes';

/** Beitreten-Karte in einer Nachricht: Server-Adresse, Welt-Code (6 Zeichen) oder Einladungs-Code (10 Zeichen) */
export interface MessageCard {
  kind: 'server' | 'world' | 'invite';
  target: string;
  /** höchstens 60 Zeichen, eine Zeile */
  title: string;
}

export interface ChatMessage {
  /** steigt mit jeder Nachricht */
  id: number;
  from: string;
  to: string;
  /** reiner Text, nie als HTML ausgeben (bei Karten der Rückfall für ältere Clients) */
  text: string;
  at: number;
  read: boolean;
  /** vom angemeldeten Spieler gesendet */
  mine: boolean;
  /** Antwort auf: text = erste 100 Zeichen; gelöschte Nachricht: from und text null */
  replyTo: { id: number; from: string | null; text: string | null } | null;
  card: MessageCard | null;
  /** Reaktion je Spieler (UUID) */
  reactions: Record<string, ReactionId>;
}

/** Echtzeit in einer Unterhaltung (uuid = Freund) */
export type ChatEvent =
  | { kind: 'message'; uuid: string; message: ChatMessage }
  | { kind: 'deleted'; uuid: string; id: number }
  | { kind: 'reaction'; uuid: string; id: number; reactions: Record<string, ReactionId> }
  /** „schreibt …“: 6 s nach dem letzten Ereignis bzw. bei einer neuen Nachricht ausblenden */
  | { kind: 'typing'; uuid: string }
  /** in einem anderen Client gelesen */
  | { kind: 'read'; uuid: string };

/** Profilkarte eines Freundes (GET /v1/friends/<uuid>/profile) */
export interface FriendProfile {
  friend: Friend;
  /** nur gemeinsame Freunde, nach Name */
  mutual: { uuid: string; name: string }[];
  /** Heldix-Cape ('' = keins oder nicht sichtbar) */
  cape: string;
  /** Cosmetics je Slot (null = nicht sichtbar) */
  cosmetics: Record<string, string | null> | null;
}

/** Freunde von Freunden (nur Spieler mit „In Vorschlägen erscheinen“) */
export interface FriendSuggestions {
  /** false = „Vorschläge zeigen“ ist aus (oder Dienst ohne Vorschläge) */
  enabled: boolean;
  suggestions: { uuid: string; name: string; mutual: number }[];
}

// ---------- Party (Heldix-Dienst ab 1.12.0, main/core/party.ts) ----------

/** Ort eines Party-Mitglieds: gleiche address = gleicher Ort */
export interface PartyLocation {
  kind: 'server' | 'world';
  /** Server-Adresse bzw. Welt-Code */
  target: string;
  /** zum Beitreten (Welt: <code>.<Welt-Domain>) */
  address: string;
  /** Server-Adresse bzw. Name der Welt */
  title: string;
}

export interface PartyMember {
  uuid: string;
  name: string;
  leader: boolean;
  /** im Spiel verbunden */
  online: boolean;
  /** gar keine Verbindung (fliegt nach awayUntil raus) */
  away: boolean;
  awayUntil: number | null;
  state: FriendActivity | null;
  location: PartyLocation | null;
  joined: number;
}

export interface PartyChatMessage {
  id: number;
  from: string;
  name: string;
  text: string;
  at: number;
  mine: boolean;
}

export interface Party {
  id: string;
  leader: string;
  created: number;
  /** höchstens so viele Mitglieder (8) */
  max: number;
  /** in Beitrittsreihenfolge */
  members: PartyMember[];
  /** offene Einladungen dieser Party */
  invites: { uuid: string; name: string; by: string; at: number; expires: number }[];
  /** Ort des Leiters */
  target: PartyLocation | null;
  /** gemeinsame Voice-Gruppe aktiv (du und mindestens ein anderes Mitglied am selben Ort) */
  voice: boolean;
  /** Party-Chat (nur im Speicher des Dienstes, die letzten 50) */
  chat: PartyChatMessage[];
}

/** Einladung in eine Party an dich */
export interface PartyInvite {
  party: string;
  from: { uuid: string; name: string };
  leader: { uuid: string; name: string };
  members: number;
  at: number;
  expires: number;
  /** „Nicht stören“: ohne Hinweis */
  quiet: boolean;
}

export interface PartyState {
  /** off = Freunde aus/kein Microsoft-Konto · unsupported = Dienst ohne Party (vor 1.12.0) · error = siehe error */
  status: 'ok' | 'off' | 'unsupported' | 'error';
  error: string | null;
  party: Party | null;
  invites: PartyInvite[];
  /** eigene UUID (wer ist „du“) */
  me: string | null;
  /** warum die letzte Party endete (nur bis zur nächsten): verlassen, entfernt, aufgelöst */
  ended: 'left' | 'removed' | 'dissolved' | null;
}

/** Der Leiter ist woanders: „<Leiter> ist auf <Ziel> – Beitreten“ */
export interface PartyFollow {
  party: string;
  leader: { uuid: string; name: string };
  target: PartyLocation;
  /** automatisch gefolgt (Einstellung „Automatisch folgen“, kein Spiel lief) */
  joined: boolean;
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
  /** Freunde sehen „zuletzt online vor …“ (nur mit Online-Status) */
  showLastOnline: boolean;
  /** in den Vorschlägen der Freunde deiner Freunde erscheinen (Standard aus) */
  suggestable: boolean;
  /** dir selbst Vorschläge zeigen */
  showSuggestions: boolean;
  /** „Ist online“-Benachrichtigungen */
  onlineNotify: OnlineNotify;
}

// ---------- Einladungen (Heldix-Dienst ab 1.11.0, siehe core/invites.ts) ----------

/** Ergebnis der Freundschaft beim Annehmen */
export type InviteFriendResult = 'new' | 'already' | 'blocked' | 'limit' | 'self';
/** warum es keine Willkommens-Belohnung gab */
export type InviteRewardReason = 'not-new' | 'already-invited' | 'self';

/** Ein eigener Einladungslink */
export interface InviteLink {
  /** 10 Zeichen (Zugangsdaten zur Einladung, nicht loggen) */
  code: string;
  /** Link zur Webseite (…/einladung#<code>), null, wenn der Dienst keine Webseite kennt */
  url: string | null;
  /** heldixclient://einladung/<code> */
  appUrl: string;
  created: number;
  expires: number;
  /** „Komm auf meinen Server“, sonst null (allgemeiner Link) */
  server: string | null;
  /** mit Voice-Gruppe (Browser-Link aus dem Spiel, 24 Stunden) */
  voice: boolean;
  /** so oft angenommen */
  accepted: number;
}

export interface InviteReward {
  cosmetic: string;
  /** Name aus dem Katalog bzw. der bekannten Belohnung */
  name: string;
  /** ab so vielen bestätigten Freunden */
  friends: number;
  unlocked: boolean;
}

/** Bereich „Freunde einladen“ */
export interface InviteState {
  /** false = Dienst ohne Einladungen (vor 1.11.0): Bereich ausblenden */
  available: boolean;
  /** deutsche Meldung, wenn nichts geladen werden konnte */
  error: string | null;
  /** allgemeiner Link (ohne Server) */
  link: InviteLink | null;
  /** offene Links */
  invites: InviteLink[];
  /** über eigene Links dazugekommen */
  invited: number;
  /** davon bestätigt (30 Minuten gespielt) */
  confirmed: number;
  pending: number;
  /** Belohnungen nach bestätigten Freunden, aufsteigend */
  rewards: InviteReward[];
  /** freigeschaltete Cosmetics (access „unlock“) */
  unlocked: string[];
}

/** Hinweis im Ergebnis des Einladungsdialogs */
export interface InviteNote {
  tone: 'success' | 'info' | 'warn';
  text: string;
}

/** Einladung aus einem Link (heldixclient://einladung/<code>), für den Dialog */
export interface PublicInviteView {
  code: string;
  /** missing = abgelaufen, zurückgenommen, unbekannt oder Dienst ohne Einladungen · error = siehe error */
  status: 'ok' | 'missing' | 'error';
  error: string | null;
  inviter: { uuid: string; name: string } | null;
  /** normalisierte Serveradresse („Komm auf meinen Server“) */
  server: string | null;
  voice: { members: number; guests: number; maxGuests: number } | null;
  expires: number;
  /** Willkommens-Belohnung für neue Spieler */
  welcome: { id: string; name: string } | null;
  /** aktives Konto im Launcher */
  account: { name: string; type: 'microsoft' | 'offline' } | null;
  /** warum „Annehmen“ gerade nicht geht (z. B. kein Microsoft-Konto), sonst null */
  acceptProblem: string | null;
  /** Instanz für „Annehmen und beitreten“ (zuletzt gespielte mit HeldixClient) */
  join: { instanceId: string; instanceName: string } | null;
  /** warum „Annehmen und beitreten“ nicht geht (keine Instanz mit HeldixClient, Spiel läuft), sonst null */
  joinProblem: string | null;
}

export interface InviteAcceptView {
  inviter: { uuid: string; name: string };
  server: string | null;
  friend: InviteFriendResult;
  /** freigeschaltete Willkommens-Belohnung */
  reward: { id: string; name: string } | null;
  rewardReason: InviteRewardReason | null;
  notes: InviteNote[];
  /** Spiel wird gestartet und verbindet mit dem Server */
  joined: { instanceId: string; instanceName: string; server: string } | null;
  /** Beitreten ging nicht (angenommen ist die Einladung trotzdem) */
  joinError: string | null;
}

/** Neues bei den Einladungen (der Launcher vergleicht GET /v1/invites mit dem letzten Stand) */
export type InviteEvent =
  | { kind: 'unlock'; cosmetic: string; name: string }
  | { kind: 'accepted'; /** nur, wenn eindeutig */ name: string | null; count: number }
  | { kind: 'confirmed'; count: number };

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
  /** nur für das HeldixClient-Team (capes.json „team“: true; der Heldix-Dienst prüft das) */
  team: boolean;
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

/**
 * Format 2: Keyframes einer Spur, base64 genau wie im signierten Manifest (keys Uint16LE; values je nach Spur, siehe
 * renderer/cosmetic-mesh.ts). Entpackt wird erst in der Oberfläche.
 */
export interface CosmeticKeyframesData {
  keys: string;
  values: string;
}

export interface CosmeticMeshTrackData {
  /** Index in CosmeticMeshData.skeleton */
  bone: number;
  rot: CosmeticKeyframesData | null;
  move: CosmeticKeyframesData | null;
  scale: CosmeticKeyframesData | null;
}

export interface CosmeticMeshAnimationData {
  /** Name aus dem Manifest ([A-Za-z0-9_], z. B. „Idle“, „Emote“) */
  name: string;
  fps: number;
  frames: number;
  loop: boolean;
  tracks: CosmeticMeshTrackData[];
}

export interface CosmeticMeshBoneData {
  name: string;
  /** Index eines Knochens weiter vorn oder −1 */
  parent: number;
  /** Pixel im Body-Modellraum (Ursprung Hals, +X links, +Y unten, +Z hinten) */
  pivot: CosmeticVec3;
  tail: CosmeticVec3;
}

/** Leucht-Streifen (glow = frames Bilder untereinander) und Puls */
export interface CosmeticMeshEmissive {
  frames: number;
  frametimeTicks: number;
  pulse: { period: number; min: number; max: number } | null;
}

export interface CosmeticMeshParticleData {
  bone: number;
  at: 'pivot' | 'tail';
  particle: string;
  perSecond: number;
  color: string | null;
  /** nur in diesen Animationen (null = immer) */
  states: string[] | null;
}

/** Format 2 (animiertes Mesh, alle Slots außer cape): Daten für die 3D-Vorschau */
export interface CosmeticMeshData {
  vertexCount: number;
  triangleCount: number;
  /** base64 wie im Manifest: Int16LE ×3 (1/32 Pixel), Int8 ×3, Uint16LE ×2, Uint8, Uint16LE ×3 */
  positions: string;
  normals: string;
  uvs: string;
  bones: string;
  triangles: string;
  /** weiche Haut (freiwillig, beide oder keins): Uint8 ×4 Knochen und Uint8 ×4 Gewichte (Summe 255) je Ecke */
  joints: string | null;
  weights: string | null;
  /** Knochen, Eltern zuerst */
  skeleton: CosmeticMeshBoneData[];
  /** Reihenfolge wie im Manifest */
  animations: CosmeticMeshAnimationData[];
  /** Spielerzustand → Animation (idle immer da; z. B. emote, start_flying, elytra) */
  states: Record<string, string>;
  blendSeconds: number;
  emissive: CosmeticMeshEmissive | null;
  /**
   * origin: Ursprung des Begleiters im Body-Raum (Pixel; Ecken, pivot und tail zählen relativ dazu), sonst null;
   * side: Modell ist links gebaut, rechts = an X gespiegelt
   */
  attach: { origin: CosmeticVec3 | null; side: 'left' | 'right' };
  particles: CosmeticMeshParticleData[];
}

/** Cosmetic aus dem Katalog: Signatur und alle Regeln geprüft */
export interface CosmeticItem {
  id: string;
  slot: CosmeticSlotName;
  /** 1 = Würfel-Modell/Partikel/Cape, 2 = animiertes Mesh (siehe mesh) */
  format: number;
  version: number;
  name: string;
  description: string;
  /** access: team – nur Team-Mitglieder dürfen es wählen (alle sehen es) */
  teamOnly: boolean;
  /** access: unlock – Belohnung (z. B. für Einladungen), nur wählbar, wenn freigeschaltet (siehe CosmeticsState.unlocked) */
  unlockOnly: boolean;
  /** SHA-256 des Umschlags (neu mit jeder Version) */
  sha256: string;
  /** PNG als data:-URL (auch Palette-PNGs) */
  texture: string;
  /** Leuchtebene (ohne Licht gezeichnet), gleich groß wie texture */
  glow: string | null;
  /** Breite und Höhe der Textur in Texeln: bei Modellen model.textureSize (UV-Raum; das Bild darf 2- oder 4-mal so groß sein), sonst die Bildgröße */
  textureSize: [number, number];
  /** Modell (head, back, companion), sonst leer */
  bones: CosmeticBoneData[];
  /** model.scale: Größe des ganzen Modells um den Anker, über den Bone-Matrizen (1 = wie gebaut, auch ohne Modell) */
  modelScale: number;
  animations: CosmeticAnimationData[];
  /** nur aura: Textur = frames quadratische Bilder nebeneinander */
  particles: CosmeticParticlesData | null;
  /** nur cape: Bilder (64, 128 oder 256 breit, je halb so hoch) untereinander */
  cape: { frames: number; fps: number } | null;
  /** nur companion: Platz in Blöcken (x rechts, y hoch, z vorn) und Größe */
  companion: { offset: CosmeticVec3; scale: number } | null;
  /** Format 2: Mesh mit Knochen und Keyframe-Animationen (dann bones/animations/particles leer) */
  mesh: CosmeticMeshData | null;
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
  /** freigeschaltete Belohnungen (access „unlock“) aus GET /v1/me/cosmetics; null = unbekannt (ohne Dienst) */
  unlocked: string[] | null;
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

/** Schalter für den Discord-Status (Einstellungen → Discord, siehe main/core/presence.ts) */
export interface DiscordPresenceOptions {
  showServer: boolean;
  showDetails: boolean;
  showWorldName: boolean;
  showParty: boolean;
  showVoice: boolean;
  showHead: boolean;
  buttons: boolean;
  minimal: boolean;
}

/** Seite im Launcher (für den Discord-Status „Stöbert im Addon-Store“ …) */
export type LauncherView = 'home' | 'instances' | 'store' | 'friends' | 'profile' | 'settings' | 'console' | 'setup';

/** Vorschau des Discord-Status in den Einstellungen: genau das, was der Launcher an Discord schickt (bzw. schicken würde) */
export interface DiscordPreview {
  /** Einstellung „Discord-Status anzeigen“ */
  enabled: boolean;
  details: string | null;
  state: string | null;
  /** Bild je Lage: Name unter discord/<name>.png (in der Oberfläche mitgeliefert); null = Logo */
  largeImage: string | null;
  largeText: string | null;
  /** head = eigener Kopf, sonst Name des Loader-Symbols, null = keins */
  smallImage: string | null;
  smallText: string | null;
  /** „seit“ in ms */
  since: number | null;
  party: [number, number] | null;
  buttons: string[];
  /** eigener Spieler (für den Kopf in der Vorschau) */
  player: { uuid: string; name: string } | null;
}

// ---------- Welt teilen (Heldix-Dienst ab 1.12.0, main/core/worlds.ts) ----------

/** Gerade geöffnete Welt eines Freundes (GET /v1/worlds → friends) */
export interface FriendWorld {
  id: string;
  /** 6 Zeichen; Adresse <code>.welt.<Domain> */
  code: string;
  name: string;
  address: string;
  host: { uuid: string; name: string };
  players: number;
  maxPlayers: number;
  /** Minecraft-Version des Gastgebers (null = unbekannt) */
  version: string | null;
}

export interface WorldsOverview {
  /** off = Freunde aus/kein Microsoft-Konto/kein Dienst · unsupported = Dienst ohne Welt teilen · error = siehe error */
  status: 'ok' | 'off' | 'unsupported' | 'error';
  error: string | null;
  friends: FriendWorld[];
}

/** Öffentliche Welt-Info (GET /v1/public/worlds/<code>) */
export interface PublicWorldView {
  code: string;
  name: string;
  address: string | null;
  host: { uuid: string; name: string };
  online: boolean;
  players: number;
  maxPlayers: number;
  version: string | null;
  /** open = jeder mit der Adresse, closed = nur Eingeladene/Freunde (andere klopfen an) */
  access: 'open' | 'closed';
}

/** Welt aus einem Link (heldixclient://welt/<code>) für den Dialog „Welt von <Name>“ */
export interface WorldJoinView {
  code: string;
  /** missing = gibt es nicht (mehr) bzw. Dienst ohne Welt teilen · error = siehe error */
  status: 'ok' | 'missing' | 'error';
  error: string | null;
  world: PublicWorldView | null;
  /** Instanz, mit der „Beitreten“ startet */
  join: { instanceId: string; instanceName: string; minecraft: string } | null;
  /** warum Beitreten gerade nicht geht (keine passende Instanz, Welt zu, Spiel läuft), sonst null */
  joinProblem: string | null;
  /** Freund des Spielers (sonst klopft man ggf. an) */
  friend: boolean;
}

// ---------- Benachrichtigungen (Glocke, main/core/notifications.ts) ----------

export type NotificationKind = 'friend-request' | 'message' | 'invite-accepted' | 'invite-confirmed' | 'unlock' | 'world-open' | 'world-invite' | 'party-invite' | 'party-follow' | 'update' | 'addons';

/** Wohin ein Klick führt */
export interface NotificationTarget {
  view: 'friends' | 'invites' | 'cosmetics' | 'store' | 'updates' | 'world' | 'party';
  /** Freund (Unterhaltung) */
  uuid?: string;
  /** Cosmetic */
  id?: string;
  /** Welt-Code */
  code?: string;
}

export interface LauncherNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  at: number;
  read: boolean;
  /** zusammengefasste Meldungen (z. B. 3 Nachrichten) */
  count: number;
  target: NotificationTarget | null;
}

export interface NotificationList {
  /** neueste zuerst, höchstens 100, höchstens 30 Tage */
  items: LauncherNotification[];
  unread: number;
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
  /** extra: Antwort auf eine Nachricht dieser Unterhaltung und/oder Beitreten-Karte (text bleibt Pflicht, als Rückfall) */
  sendMessage(uuid: string, text: string, extra?: { replyTo?: number | null; card?: MessageCard | null }): Promise<ChatMessage>;
  /** eigene Nachricht löschen (für beide) */
  deleteMessage(uuid: string, id: number): Promise<void>;
  /** eigene Reaktion setzen (ersetzt eine vorhandene) bzw. entfernen (null) */
  reactMessage(uuid: string, id: number, reaction: ReactionId | null): Promise<ChatMessage>;
  /** „schreibt …“ an den Freund (gedrosselt: höchstens alle 3 s) */
  sendTyping(uuid: string): Promise<void>;
  /** Echtzeit in Unterhaltungen (neue, gelöschte Nachrichten, Reaktionen, „schreibt …“) */
  onChatEvent(callback: (event: ChatEvent) => void): () => void;
  markRead(uuid: string): Promise<void>;
  listBlocked(): Promise<BlockedPlayer[]>;
  blockPlayer(uuid: string): Promise<BlockedPlayer[]>;
  unblockPlayer(uuid: string): Promise<BlockedPlayer[]>;
  reportPlayer(uuid: string, reason: ReportReason, note?: string): Promise<void>;
  getSocialPrivacy(): Promise<SocialPrivacy>;
  setSocialPrivacy(patch: Partial<SocialPrivacy>): Promise<SocialPrivacy>;
  /** eigener Statustext (höchstens 40 Zeichen, null = löschen) und „Nicht stören“ */
  setSocialStatus(patch: { statusText?: string | null; dnd?: boolean }): Promise<SocialOverview>;
  /** eigene Angaben zu einem Freund: Favorit, Spitzname (≤ 24), Notiz (≤ 200); '' bzw. null löscht */
  updateFriend(uuid: string, patch: { favorite?: boolean; nickname?: string | null; note?: string | null }): Promise<SocialOverview>;
  getFriendProfile(uuid: string): Promise<FriendProfile>;
  getFriendSuggestions(): Promise<FriendSuggestions>;
  /** Anfrage an einen Vorschlag */
  requestSuggestion(uuid: string): Promise<SocialOverview>;
  /** startet eine HeldixClient-Instanz (Standard: die ausgewählte) und verbindet direkt mit dem Server des Freundes */
  joinFriend(uuid: string, instanceId?: string): Promise<void>;
  /** „Beitreten“ auf einer Server-Karte: öffentliche Domain, zuletzt gespielte Instanz mit HeldixClient, Quick Play */
  joinServer(address: string): Promise<{ instanceId: string; instanceName: string; server: string }>;
  /** Skin eines Spielers (Freund, Anfrage, Blockierter) als PNG-data:-URL über den Heldix-Dienst, zwischengespeichert; null = Standard-Skin zeigen */
  getPlayerSkin(uuid: string): Promise<string | null>;

  // ---------- Party ----------
  getParty(refresh?: boolean): Promise<PartyState>;
  onParty(callback: (state: PartyState) => void): () => void;
  /** Der Leiter ist woanders (Knopf „Beitreten“ in der Oberfläche) */
  onPartyFollow(callback: (follow: PartyFollow) => void): () => void;
  /** Klick auf eine Benachrichtigung zur Party: Freunde → Party öffnen */
  onPartyOpen(callback: () => void): () => void;
  /** Freund einladen (ohne Party entsteht eine mit dir als Leiter) */
  partyInvite(uuid: string): Promise<PartyState>;
  /** eigene Einladung zurückziehen (Leiter) */
  partyCancelInvite(uuid: string): Promise<PartyState>;
  partyAccept(partyId: string): Promise<PartyState>;
  partyDecline(partyId: string): Promise<PartyState>;
  partyLeave(): Promise<PartyState>;
  /** Mitglied entfernen (Leiter) */
  partyKick(uuid: string): Promise<PartyState>;
  /** Leitung übergeben (Leiter) */
  partyTransfer(uuid: string): Promise<PartyState>;
  partyChat(text: string): Promise<PartyState>;
  /** dem Leiter folgen: Server bzw. geteilte Welt mit passender Instanz */
  partyJoin(): Promise<{ instanceName: string; title: string }>;
  /** eigene geteilte Welten (für „Welt teilen“ im Chat) */
  listOwnWorlds(): Promise<{ code: string; name: string; address: string | null; online: boolean }[]>;

  // ---------- Einladungen ----------
  /** Code aus einem geöffneten Link heldixclient://einladung/<code> bzw. aus dem Download abholen (einmal; null = keiner) */
  takeInviteLink(): Promise<string | null>;
  /** Ein Link wurde geöffnet (Launcher lief schon): takeInviteLink() aufrufen */
  onInviteOpen(callback: () => void): () => void;
  /** eingefügter Link (Web-Link, heldixclient://-Link oder Code): öffnet den Einladungsdialog (über onInviteOpen); wirft bei allem anderen */
  pasteInviteLink(text: string): Promise<string>;
  /** Einladung für den Dialog (öffentlich, dazu Konto und Instanz für „Annehmen und beitreten“) */
  getPublicInvite(code: string): Promise<PublicInviteView>;
  /** annehmen (Microsoft-Konto); join = danach die Instanz starten und direkt mit dem Server verbinden */
  acceptInvite(code: string, join: boolean): Promise<InviteAcceptView>;
  /** Bereich „Freunde einladen“ (available = false ohne Einladungen beim Dienst) */
  getInvites(): Promise<InviteState>;
  /** Link anlegen (server null = allgemein); eine offene gleiche Einladung wird wiederverwendet */
  createInvite(server: string | null): Promise<InviteLink>;
  revokeInvite(code: string): Promise<InviteState>;
  /** Neues bei den Einladungen, während der Launcher im Vordergrund ist (sonst Benachrichtigung) */
  onInviteEvent(callback: (event: InviteEvent) => void): () => void;
  /** Klick auf eine Benachrichtigung zu Einladungen: Freunde → Einladen öffnen */
  onInvitesOpen(callback: () => void): () => void;
  /** Klick auf „Neues Cosmetic freigeschaltet“: Skins & Cosmetics mit diesem Cosmetic öffnen */
  onCosmeticOpen(callback: (id: string) => void): () => void;

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
  /** Vorschau des Discord-Status (auch, wenn er aus ist) */
  getDiscordPreview(): Promise<DiscordPreview>;
  onDiscordPreview(callback: (preview: DiscordPreview) => void): () => void;
  /** aktuelle Seite für den Discord-Status („Stöbert im Addon-Store“) */
  setPresenceView(view: LauncherView): void;

  // ---------- Welt teilen ----------
  /** offene Welten der Freunde (letzter Stand; frisch = sofort neu fragen) */
  getWorlds(refresh?: boolean): Promise<WorldsOverview>;
  onWorlds(callback: (overview: WorldsOverview) => void): () => void;
  /** Code aus einem geöffneten Link heldixclient://welt/<code> abholen (einmal; null = keiner) */
  takeWorldLink(): Promise<string | null>;
  /** Ein Welt-Link wurde geöffnet (Launcher lief schon): takeWorldLink() aufrufen */
  onWorldOpen(callback: () => void): () => void;
  /** Welt für den Dialog (öffentlich, dazu die Instanz fürs Beitreten) */
  getWorldJoin(code: string): Promise<WorldJoinView>;
  /** passende Instanz starten und per Quick Play auf <code>.welt.<Domain> verbinden */
  joinWorld(code: string): Promise<{ instanceId: string; instanceName: string; address: string }>;
  /** Dialog zu einer Welt öffnen (z. B. aus „Offene Welten“ oder der Glocke) */
  openWorldDialog(code: string): Promise<void>;

  // ---------- Benachrichtigungen ----------
  listNotifications(): Promise<NotificationList>;
  markNotificationRead(id: string): Promise<NotificationList>;
  markAllNotificationsRead(): Promise<NotificationList>;
  clearNotifications(): Promise<NotificationList>;
  onNotifications(callback: (list: NotificationList) => void): () => void;
  /** Klick im Infobereich auf eine Benachrichtigung: Glocke öffnen und dorthin springen */
  onNotificationOpen(callback: (id: string | null) => void): () => void;

  getUpdateState(): Promise<UpdateState>;
  checkForUpdate(): Promise<UpdateState>;
  /** lädt das Update (falls nur gemeldet), startet den Installer und beendet den Launcher (er öffnet sich danach neu) */
  installUpdate(): Promise<void>;
  onUpdateState(callback: (state: UpdateState) => void): () => void;
  /** Hinweis „Update verfügbar“ vom Start abholen (einmal; null = keiner): Einstellung „Updates automatisch“ aus bzw. macOS */
  takeUpdateNotice(): Promise<UpdateState | null>;
  /** Hinweis vom Start ist da (die Prüfung lief im Hintergrund): takeUpdateNotice() aufrufen */
  onUpdateNotice(callback: () => void): () => void;

  /** öffnet heldixclient.com im Browser, schon angemeldet (Profil, Freunde, Nachrichten, Support, Team-Bereich) */
  openWebAccount(target?: WebTarget): Promise<void>;
  /** öffnet eine öffentliche Seite von heldixclient.com, z. B. "neuigkeiten" */
  openWebsite(page: 'neuigkeiten' | 'das-team' | 'status' | 'download' | 'hilfe' | 'addons' | `hilfe/${string}`): Promise<void>;
  /** null = nichts Neues zu zeigen (auch, solange der Einrichtungs-Assistent offen ist) */
  getWhatsNew(): Promise<WhatsNew | null>;
  markWhatsNewSeen(): Promise<void>;

  // ---------- Einrichtungs-Assistent ----------
  /** Assistent beim Start zeigen? Dazu die liegende Einladung (bleibt bis finishSetup liegen) */
  getSetup(): Promise<SetupInfo>;
  /** „Einrichtung erneut starten“ (Einstellungen) */
  restartSetup(): Promise<SetupInfo>;
  /** offizielle, passende Addons aus dem Store (Signatur geprüft) für die Standard-Instanzen */
  getSetupAddons(): Promise<SetupAddons>;
  /** ein Addon aus der Auswahl in die Standard-Instanzen installieren */
  installSetupAddon(addonId: string): Promise<SetupInstallResult>;
  /** fertig bzw. übersprungen: setupDone speichern; danach geben takeInviteLink und getWhatsNew wieder etwas heraus */
  finishSetup(skipped: boolean): Promise<void>;
}
