// Dauerhafte Welten (Heldix-Dienst 1.13.0): Schnittstelle zwischen dem Dienst und dem, was die Minecraft-Server einer
// Welt wirklich betreibt. Verbindlich für beide Seiten (siehe dauerhafte-welten-spec.md):
//
//   - AgentRunner (hosting/agent-runner.ts): Produktion. Spricht über einen Unix-Socket mit dem Welten-Wächter
//     (src/agent/, eigener Prozess mit Docker-Zugriff). Der Dienst selbst hat keinen Docker-Zugriff.
//   - ProcessRunner (hosting/process-runner.ts): nur Entwicklung und Tests (HELDIX_DIENST_DEV=1): startet den Server
//     als normalen Java-Prozess ohne Container.
//   - FakeRunner (test/): Unit-Tests ohne Java.
//
// Alle Welt-IDs sind 32 Hex-Zeichen (dieselbe ID wie die geteilte Welt). Pfade innerhalb einer Welt sind immer relativ
// zu ihrem Datenordner und werden von der Implementierung geprüft (kein `..`, keine absoluten Pfade, keine Symlinks).

export const HOSTED_WORLD_ID_RE = /^[0-9a-f]{32}$/;

/** Was der Server einer Welt gerade tut (aus Sicht des Runners). */
export type RunnerState = 'missing' | 'stopped' | 'starting' | 'running' | 'stopping';

/** Server-Software: Paper (mit Plugins) oder – wenn es für die Version keinen stabilen Paper-Build gibt – Vanilla. */
export interface ServerJar {
  software: 'paper' | 'vanilla';
  /** Minecraft-Version, z. B. „26.3“ */
  version: string;
  /** nur https://fill-data.papermc.io/… (Paper) bzw. https://piston-data.mojang.com/… (Vanilla) */
  url: string;
  /** Prüfsumme aus der Fill-API (Paper, SHA-256) bzw. aus dem Versions-Manifest von Mojang (Vanilla, SHA-1) */
  sha256?: string;
  sha1?: string;
  /** Paper-Build (Anzeige), bei Vanilla null */
  build: number | null;
}

export interface PrepareOptions {
  jar: ServerJar;
  /** RAM des Containers in MB; die JVM bekommt davon ~85 % als -Xmx */
  memoryMb: number;
  /** server.properties (nur erlaubte Schlüssel, siehe ALLOWED_PROPERTIES); motd und Ports setzt der Runner selbst */
  properties: Record<string, string>;
  /** Beschreibung für die Serverliste (mit Minecraft-Farbcodes, zwei Zeilen) */
  motd: string;
  /** Symbol 64×64 als PNG (Werbung wie bei Welt teilen), optional */
  iconPng?: Buffer;
}

/** Schlüssel aus server.properties, die Besitzer ändern dürfen (Werte prüft der Dienst vorher). */
export const ALLOWED_PROPERTIES = [
  'difficulty',
  'gamemode',
  'pvp',
  'max-players',
  'view-distance',
  'simulation-distance',
  'spawn-protection',
  'allow-flight',
  'level-seed',
  'level-type',
  'generate-structures',
  'hardcore',
  'force-gamemode',
  'spawn-monsters',
  'allow-nether',
] as const;

export interface RunnerStats {
  /** RAM des Containers bzw. Prozesses in MB */
  memoryMb: number;
  /** CPU in Prozent eines Kerns (0–100 × Kerne) */
  cpuPercent: number;
  /** belegter Speicher der Welt (Welt, Plugins, Konfiguration, Sicherungen) in MB */
  diskMb: number;
}

export interface BackupInfo {
  /** Name, z. B. „2026-11-28_03-00-00“ oder „vor-plugin-2026-11-28_03-00-00“ */
  name: string;
  sizeBytes: number;
  createdAt: number;
}

export interface PluginFile {
  /** Dateiname in /data/plugins, ^[A-Za-z0-9._+-]{1,96}\.jar$ */
  name: string;
  /** nur https://cdn.modrinth.com/… */
  url: string;
  sha512: string;
}

/**
 * Betreibt die Server der dauerhaften Welten. Alle Methoden sind idempotent, wo es sinnvoll ist (start auf einer laufenden
 * Welt liefert den Port; stop auf einer gestoppten tut nichts). Fehler sind `Error` mit verständlicher deutscher Meldung.
 */
export interface HostingRunner {
  /** Datenordner anlegen bzw. aktualisieren, Server-Jar laden und prüfen, server.properties, eula.txt, Symbol schreiben. */
  prepare(world: string, options: PrepareOptions): Promise<void>;
  /** Server starten; liefert den lokalen Port (127.0.0.1), auf dem das Relay ihn erreicht. */
  start(world: string): Promise<{ port: number }>;
  /** Sauber anhalten (`stop` an die Konsole, nach timeoutMs hart beenden). */
  stop(world: string, options?: { timeoutMs?: number }): Promise<void>;
  state(world: string): Promise<RunnerState>;
  /** Port einer laufenden Welt (sonst null). */
  port(world: string): Promise<number | null>;
  /** Eine Zeile an die Server-Konsole (ohne Zeilenumbrüche, ≤ 256 Zeichen; der Dienst prüft vorher). */
  command(world: string, line: string): Promise<void>;
  /** Letzte Zeilen des Server-Logs (ohne IPs: der Server sieht nur die lokale Brücke). */
  recentLogs(world: string, lines: number): Promise<string[]>;
  /** Neue Log-Zeilen live; Rückgabe meldet ab. */
  followLogs(world: string, onLine: (line: string) => void): () => void;
  stats(world: string): Promise<RunnerStats>;
  setProperties(world: string, properties: Record<string, string>, motd?: string): Promise<void>;

  listPlugins(world: string): Promise<string[]>;
  installPlugin(world: string, file: PluginFile): Promise<void>;
  removePlugin(world: string, name: string): Promise<void>;
  /** Textdatei unter plugins/ lesen bzw. schreiben (yml, yaml, json, properties, txt, toml; ≤ 256 KB). */
  readFile(world: string, relativePath: string): Promise<string>;
  writeFile(world: string, relativePath: string, content: string): Promise<void>;
  /** Dateien unter plugins/ (nur die erlaubten Textdateien), relativ. */
  listFiles(world: string): Promise<string[]>;

  /** ZIP einer Einzelspielerwelt (Pfad im Upload-Ordner des Dienstes) sicher entpacken; nur bei gestoppter Welt. */
  importWorld(world: string, zipPath: string): Promise<void>;
  /** Welt als ZIP im Einzelspieler-Format (Nether/End zurück nach DIM-1/DIM1) nach zipPath schreiben. */
  exportWorld(world: string, zipPath: string): Promise<void>;

  backup(world: string, name: string): Promise<BackupInfo>;
  listBackups(world: string): Promise<BackupInfo[]>;
  /** nur bei gestoppter Welt */
  restoreBackup(world: string, name: string): Promise<void>;
  deleteBackup(world: string, name: string): Promise<void>;
  /** Sicherung als ZIP nach zipPath kopieren (zum Herunterladen). */
  exportBackup(world: string, name: string, zipPath: string): Promise<void>;

  /** Server anhalten und alles der Welt löschen (Daten, Sicherungen, Container). */
  remove(world: string): Promise<void>;
  /** Welten, die der Runner kennt (für den Abgleich beim Start des Dienstes). */
  list(): Promise<string[]>;
}
