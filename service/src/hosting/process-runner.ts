// Dauerhafte Welten (1.13.0): ProcessRunner – NUR für Entwicklung und Tests (HELDIX_DIENST_DEV=1). Startet den Server
// einer Welt als normalen Java-Prozess ohne Container: Datenordner unter dem Datenordner des Dienstes, freier Port auf
// 127.0.0.1, stdin = Konsole, stdout = Log. Keine Grenzen für RAM/CPU außer -Xmx, kein Netzwerk-Schutz – deshalb nie in
// Produktion (dort der Welten-Wächter mit Docker, agent-runner.ts).
//
// Aufbau je Welt:  <root>/<id>/data/      Server (server.properties, eula.txt, world/, plugins/, logs/ …)
//                  <root>/<id>/backups/   Sicherungen als ZIP
//                  <root>/<id>/meta.json  Server-Jar und RAM
// Server-Jars liegen einmal im Cache (`<jarCache>/<Prüfsumme>.jar`) und werden vor dem Start geprüft.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MODRINTH_CDN_PREFIX, PLUGIN_FILE_RE } from './modrinth';
import { isPluginTextPath, PLUGIN_TEXT_MAX_BYTES } from './paths';
import {
  ALLOWED_PROPERTIES,
  HOSTED_WORLD_ID_RE,
  type BackupInfo,
  type HostingRunner,
  type PluginFile,
  type PrepareOptions,
  type RunnerState,
  type RunnerStats,
  type ServerJar,
} from './runner';
import { extractZip, inspectWorldZip, readZipEntries, ZipWriter } from './safe-zip';
import { PAPER_DOWNLOAD_PREFIX, VANILLA_DOWNLOAD_PREFIX } from './server-jars';

export const DEV_ONLY = 'Der ProcessRunner ist nur für die Entwicklung (HELDIX_DIENST_DEV=1).';

export interface ProcessRunnerOptions {
  /** Ordner für die Welten (unter dem Datenordner des Dienstes) */
  root: string;
  /** Java (25 für Paper 26.x) */
  java: string;
  /** Cache für Server-Jars */
  jarCache: string;
  userAgent: string;
  log: (line: string) => void;
  /** Log-Dateien des Servers so lange behalten (Standard 7 Tage) */
  logRetentionMs?: number;
}

interface Meta {
  jar: ServerJar;
  memoryMb: number;
  jarPath: string;
}

interface Proc {
  child: ChildProcessWithoutNullStreams;
  port: number;
  ready: boolean;
  stopping: boolean;
  exited: Promise<void>;
}

const RING = 1000;
const BACKUP_FILE_RE = /^[A-Za-z0-9._-]{1,100}$/;
/** Ordner im Datenordner, die nicht in Sicherungen gehören (lädt Paper neu bzw. sind Logs) */
const NOT_BACKED_UP = new Set(['cache', 'libraries', 'versions', 'logs', '.paper-remapped']);
const MIB = 1024 * 1024;

/** Wert für server.properties (Java-Properties: Sonderzeichen und Nicht-ASCII maskiert). */
function escapeProperty(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (char === '\\') out += '\\\\';
    else if (char === '\n') out += '\\n';
    else if (char === '\r') out += '\\r';
    else if (char === '\t') out += '\\t';
    else if (char === '=' || char === ':' || char === '#' || char === '!') out += `\\${char}`;
    else if (code < 0x20 || code > 0x7e) {
      const units = code > 0xffff ? String.fromCodePoint(code).split('') : [char];
      for (const unit of units) out += `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`;
    } else out += char;
  }
  return out.startsWith(' ') ? `\\${out}` : out;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await fs.stat(full)).size;
  }
  return total;
}

/** Alle Dateien unter dir (ohne Symlinks), relativ mit „/“. */
async function walk(dir: string, prefix = '', skipTop: ReadonlySet<string> = new Set()): Promise<{ rel: string; full: string }[]> {
  const out: { rel: string; full: string }[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (prefix === '' && skipTop.has(entry.name)) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(full, rel)));
    else if (entry.isFile()) out.push({ rel, full });
  }
  return out;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export class ProcessRunner implements HostingRunner {
  private readonly procs = new Map<string, Proc>();
  private readonly logs = new Map<string, string[]>();
  private readonly listeners = new Map<string, Set<(line: string) => void>>();

  constructor(private readonly options: ProcessRunnerOptions) {
    if (process.env.HELDIX_DIENST_DEV !== '1') throw new Error(DEV_ONLY);
  }

  private check(world: string): void {
    if (!HOSTED_WORLD_ID_RE.test(world)) throw new Error('Ungültige Welt-ID.');
  }

  private base(world: string): string {
    this.check(world);
    return path.join(this.options.root, world);
  }

  private dataDir(world: string): string {
    return path.join(this.base(world), 'data');
  }

  private backupsDir(world: string): string {
    return path.join(this.base(world), 'backups');
  }

  private async meta(world: string): Promise<Meta> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.base(world), 'meta.json'), 'utf8')) as Meta;
    } catch {
      throw new Error('Die Welt ist nicht vorbereitet.');
    }
  }

  private requireStopped(world: string): void {
    if (this.procs.has(world)) throw new Error('Das geht nur, wenn der Server aus ist.');
  }

  // ---------- Herunterladen mit Prüfsumme ----------

  private async download(url: string, dest: string, algorithm: 'sha256' | 'sha1' | 'sha512', expected: string, maxBytes: number): Promise<void> {
    const res = await fetch(url, { headers: { 'User-Agent': this.options.userAgent }, signal: AbortSignal.timeout(10 * 60_000) });
    if (res.status !== 200 || !res.body) throw new Error(`Download fehlgeschlagen (HTTP ${res.status}).`);
    const tmp = `${dest}.${randomBytes(6).toString('hex')}.tmp`;
    const hash = createHash(algorithm);
    let size = 0;
    const source = Readable.fromWeb(res.body as never);
    source.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) source.destroy(new Error('Die Datei ist zu groß.'));
      hash.update(chunk);
    });
    try {
      await pipeline(source, createWriteStream(tmp, { flags: 'wx' }));
      if (hash.digest('hex') !== expected.toLowerCase()) throw new Error('Die Prüfsumme der heruntergeladenen Datei stimmt nicht.');
      await fs.rename(tmp, dest);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  /** Server-Jar aus dem Cache (oder einmal laden und prüfen). */
  private async jar(jar: ServerJar): Promise<string> {
    let algorithm: 'sha256' | 'sha1';
    let sum: string;
    if (jar.software === 'paper') {
      if (!jar.url.startsWith(PAPER_DOWNLOAD_PREFIX) || !jar.sha256 || !/^[0-9a-f]{64}$/.test(jar.sha256)) throw new Error('Ungültiges Paper-Jar.');
      algorithm = 'sha256';
      sum = jar.sha256;
    } else {
      if (!jar.url.startsWith(VANILLA_DOWNLOAD_PREFIX) || !jar.sha1 || !/^[0-9a-f]{40}$/.test(jar.sha1)) throw new Error('Ungültiges Vanilla-Jar.');
      algorithm = 'sha1';
      sum = jar.sha1;
    }
    await fs.mkdir(this.options.jarCache, { recursive: true });
    const file = path.join(this.options.jarCache, `${jar.software}-${sum}.jar`);
    if (await exists(file)) {
      const hash = createHash(algorithm);
      for await (const chunk of (await fs.open(file, 'r')).createReadStream()) hash.update(chunk as Buffer);
      if (hash.digest('hex') === sum) return file;
      await fs.rm(file, { force: true });
    }
    this.options.log(`ProcessRunner: lade ${jar.software} ${jar.version} …`);
    await this.download(jar.url, file, algorithm, sum, 300 * MIB);
    return file;
  }

  // ---------- server.properties ----------

  private async writeProperties(world: string, update: Record<string, string>): Promise<void> {
    const file = path.join(this.dataDir(world), 'server.properties');
    const lines = new Map<string, string>();
    try {
      for (const line of (await fs.readFile(file, 'latin1')).split(/\r?\n/)) {
        if (line.startsWith('#') || line.startsWith('!') || !line.includes('=')) continue;
        const at = line.indexOf('=');
        lines.set(line.slice(0, at).trim(), line.slice(at + 1));
      }
    } catch {
      // neu
    }
    for (const [key, value] of Object.entries(update)) lines.set(key, escapeProperty(value));
    const text = `# Von Heldix-Dienst (ProcessRunner) geschrieben\n${[...lines].map(([k, v]) => `${k}=${v}`).join('\n')}\n`;
    await fs.writeFile(file, text, 'latin1');
  }

  private fixedProperties(): Record<string, string> {
    return {
      'server-ip': '127.0.0.1',
      'online-mode': 'true',
      'enable-status': 'true',
      'enable-query': 'false',
      'enable-rcon': 'false',
      'level-name': 'world',
      'white-list': 'false',
      'prevent-proxy-connections': 'false',
    };
  }

  // ---------- HostingRunner ----------

  async prepare(world: string, options: PrepareOptions): Promise<void> {
    const data = this.dataDir(world);
    // Erst das Jar (geprüft), dann die Ordner: Ein ungültiges Jar hinterlässt nichts.
    const jarPath = await this.jar(options.jar);
    await fs.mkdir(data, { recursive: true });
    await fs.mkdir(this.backupsDir(world), { recursive: true });
    const meta: Meta = { jar: options.jar, memoryMb: options.memoryMb, jarPath };
    await fs.writeFile(path.join(this.base(world), 'meta.json'), JSON.stringify(meta, null, 2));
    // Der Betreiber hat der Minecraft-EULA beim Einrichten zugestimmt (Installer --accept-minecraft-eula); hier: Entwicklung.
    await fs.writeFile(path.join(data, 'eula.txt'), '# https://aka.ms/MinecraftEULA\neula=true\n');
    const properties: Record<string, string> = {};
    for (const key of ALLOWED_PROPERTIES) if (options.properties[key] !== undefined) properties[key] = options.properties[key]!;
    await this.writeProperties(world, { ...properties, ...this.fixedProperties(), motd: options.motd });
    if (options.iconPng) await fs.writeFile(path.join(data, 'server-icon.png'), options.iconPng);
    // Alle Spieler kommen über das Relay von 127.0.0.1: ohne Verbindungsdrossel je IP.
    const bukkit = path.join(data, 'bukkit.yml');
    if (!(await exists(bukkit))) await fs.writeFile(bukkit, 'settings:\n  connection-throttle: -1\n');
    await this.pruneLogs(world);
  }

  /** Log-Dateien des Servers nach der Aufbewahrungszeit löschen (Standard 7 Tage). */
  private async pruneLogs(world: string): Promise<void> {
    const dir = path.join(this.dataDir(world), 'logs');
    const cutoff = Date.now() - (this.options.logRetentionMs ?? 7 * 24 * 60 * 60_000);
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const stat = await fs.lstat(file);
        if (stat.isFile() && stat.mtimeMs < cutoff) await fs.rm(file, { force: true });
      } catch {
        // weiter
      }
    }
  }

  private emit(world: string, line: string): void {
    let ring = this.logs.get(world);
    if (!ring) {
      ring = [];
      this.logs.set(world, ring);
    }
    ring.push(line);
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    const proc = this.procs.get(world);
    if (proc && !proc.ready && /\bDone \(\d+(?:[.,]\d+)?s\)!/.test(line)) proc.ready = true;
    for (const listener of this.listeners.get(world) ?? []) {
      try {
        listener(line);
      } catch {
        // Hörer-Fehler betreffen den Server nicht
      }
    }
  }

  async start(world: string): Promise<{ port: number }> {
    const running = this.procs.get(world);
    if (running) return { port: running.port };
    const meta = await this.meta(world);
    const data = this.dataDir(world);
    await this.pruneLogs(world);
    const port = await freePort();
    await this.writeProperties(world, { 'server-port': String(port), ...this.fixedProperties() });
    const xmx = Math.max(512, Math.floor(meta.memoryMb * 0.85));
    const env = { ...process.env };
    delete env.HELDIX_DIENST_DEV;
    const child = spawn(this.options.java, [`-Xms256M`, `-Xmx${xmx}M`, '-Dterminal.jline=false', '-Dterminal.ansi=false', '-jar', meta.jarPath, '--nogui'], {
      cwd: data,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env,
    });
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const proc: Proc = { child, port, ready: false, stopping: false, exited };
    this.procs.set(world, proc);
    this.logs.set(world, []);
    for (const stream of [child.stdout, child.stderr]) {
      let rest = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        rest += chunk;
        const lines = rest.split(/\r?\n/);
        rest = lines.pop() ?? '';
        if (rest.length > 8192) rest = rest.slice(-8192);
        for (const line of lines) this.emit(world, line);
      });
    }
    child.on('error', (err) => this.emit(world, `[ProcessRunner] Java ließ sich nicht starten: ${err.message}`));
    void exited.then(() => {
      if (this.procs.get(world) === proc) this.procs.delete(world);
    });
    child.stdin.on('error', () => undefined);
    return { port };
  }

  async stop(world: string, options: { timeoutMs?: number } = {}): Promise<void> {
    const proc = this.procs.get(world);
    if (!proc) return;
    proc.stopping = true;
    try {
      proc.child.stdin.write('stop\n');
    } catch {
      // schon zu
    }
    const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), options.timeoutMs ?? 60_000).unref());
    if ((await Promise.race([proc.exited.then(() => 'exited' as const), timeout])) === 'timeout') {
      proc.child.kill('SIGKILL');
      await proc.exited;
    }
    this.procs.delete(world);
  }

  async state(world: string): Promise<RunnerState> {
    const proc = this.procs.get(world);
    if (proc) return proc.stopping ? 'stopping' : proc.ready ? 'running' : 'starting';
    return (await exists(path.join(this.base(world), 'meta.json'))) ? 'stopped' : 'missing';
  }

  async port(world: string): Promise<number | null> {
    return this.procs.get(world)?.port ?? null;
  }

  async command(world: string, line: string): Promise<void> {
    const proc = this.procs.get(world);
    if (!proc) throw new Error('Der Server läuft nicht.');
    if (line.length > 256 || /[\r\n\u0000]/.test(line)) throw new Error('Ungültiger Befehl.');
    proc.child.stdin.write(`${line}\n`);
  }

  async recentLogs(world: string, lines: number): Promise<string[]> {
    const ring = this.logs.get(world);
    if (ring && ring.length > 0) return ring.slice(-lines);
    try {
      const text = await fs.readFile(path.join(this.dataDir(world), 'logs', 'latest.log'), 'utf8');
      return text.split(/\r?\n/).filter((l) => l !== '').slice(-lines);
    } catch {
      return [];
    }
  }

  followLogs(world: string, onLine: (line: string) => void): () => void {
    this.check(world);
    let set = this.listeners.get(world);
    if (!set) {
      set = new Set();
      this.listeners.set(world, set);
    }
    set.add(onLine);
    return () => {
      set.delete(onLine);
    };
  }

  async stats(world: string): Promise<RunnerStats> {
    const proc = this.procs.get(world);
    let memoryMb = 0;
    if (proc?.child.pid !== undefined && process.platform === 'linux') {
      try {
        const status = await fs.readFile(`/proc/${proc.child.pid}/status`, 'utf8');
        const match = /VmRSS:\s+(\d+) kB/.exec(status);
        if (match) memoryMb = Number(match[1]) / 1024;
      } catch {
        memoryMb = 0;
      }
    }
    return { memoryMb, cpuPercent: 0, diskMb: (await dirSize(this.base(world))) / MIB };
  }

  async setProperties(world: string, properties: Record<string, string>, motd?: string): Promise<void> {
    const update: Record<string, string> = {};
    for (const key of ALLOWED_PROPERTIES) if (properties[key] !== undefined) update[key] = properties[key]!;
    if (motd !== undefined) update.motd = motd;
    await this.writeProperties(world, { ...update, ...this.fixedProperties() });
  }

  private pluginsDir(world: string): string {
    return path.join(this.dataDir(world), 'plugins');
  }

  async listPlugins(world: string): Promise<string[]> {
    try {
      return (await fs.readdir(this.pluginsDir(world), { withFileTypes: true }))
        .filter((e) => e.isFile() && PLUGIN_FILE_RE.test(e.name))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  async installPlugin(world: string, file: PluginFile): Promise<void> {
    if (!PLUGIN_FILE_RE.test(file.name) || !file.url.startsWith(MODRINTH_CDN_PREFIX) || !/^[0-9a-f]{128}$/.test(file.sha512)) {
      throw new Error('Ungültiges Plugin.');
    }
    const dir = this.pluginsDir(world);
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, file.name);
    await fs.rm(dest, { force: true });
    await this.download(file.url, dest, 'sha512', file.sha512, 100 * MIB);
  }

  async removePlugin(world: string, name: string): Promise<void> {
    if (!PLUGIN_FILE_RE.test(name)) throw new Error('Ungültiger Dateiname.');
    await fs.rm(path.join(this.pluginsDir(world), name), { force: true });
  }

  /** Pfad unter plugins/ prüfen und auflösen (kein Teil darf ein Symlink sein). */
  private async textPath(world: string, relativePath: string): Promise<string> {
    if (!isPluginTextPath(relativePath)) throw new Error('Ungültiger Pfad.');
    const data = path.resolve(this.dataDir(world));
    const full = path.resolve(data, ...relativePath.split('/'));
    if (!full.startsWith(data + path.sep)) throw new Error('Ungültiger Pfad.');
    let dir = path.dirname(full);
    while (dir.startsWith(data + path.sep)) {
      if (await exists(dir)) {
        if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error('Ungültiger Pfad.');
      }
      dir = path.dirname(dir);
    }
    return full;
  }

  async readFile(world: string, relativePath: string): Promise<string> {
    const full = await this.textPath(world, relativePath);
    const stat = await fs.lstat(full);
    if (!stat.isFile() || stat.size > PLUGIN_TEXT_MAX_BYTES) throw new Error('Die Datei gibt es nicht oder sie ist zu groß.');
    return fs.readFile(full, 'utf8');
  }

  async writeFile(world: string, relativePath: string, content: string): Promise<void> {
    if (Buffer.byteLength(content) > PLUGIN_TEXT_MAX_BYTES) throw new Error('Die Datei ist zu groß.');
    const full = await this.textPath(world, relativePath);
    if ((await exists(full)) && !(await fs.lstat(full)).isFile()) throw new Error('Ungültiger Pfad.');
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, content, { flag: 'wx' });
    await fs.rename(tmp, full);
  }

  async listFiles(world: string): Promise<string[]> {
    const files = await walk(this.pluginsDir(world), 'plugins');
    const out: string[] = [];
    for (const file of files) {
      if (!isPluginTextPath(file.rel)) continue;
      if ((await fs.stat(file.full)).size > PLUGIN_TEXT_MAX_BYTES) continue;
      out.push(file.rel);
      if (out.length >= 500) break;
    }
    return out.sort();
  }

  async importWorld(world: string, zipPath: string): Promise<void> {
    this.requireStopped(world);
    const info = await inspectWorldZip(zipPath);
    const data = this.dataDir(world);
    await fs.mkdir(data, { recursive: true });
    const staging = path.join(data, `.import-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(staging);
    try {
      await extractZip(zipPath, info.entries, staging, (name) => {
        if (!name.startsWith(info.root)) return null;
        const rest = name.slice(info.root.length);
        return rest === 'session.lock' ? null : rest;
      });
      for (const old of ['world', 'world_nether', 'world_the_end']) await fs.rm(path.join(data, old), { recursive: true, force: true });
      await fs.rename(staging, path.join(data, 'world'));
    } catch (err) {
      await fs.rm(staging, { recursive: true, force: true });
      throw err;
    }
  }

  async exportWorld(world: string, zipPath: string): Promise<void> {
    const data = this.dataDir(world);
    const files = new Map<string, string>();
    for (const file of await walk(path.join(data, 'world'))) if (file.rel !== 'session.lock') files.set(file.rel, file.full);
    // Paper/Bukkit hält Nether und End in eigenen Ordnern: zurück ins Einzelspieler-Format (DIM-1, DIM1, dimensions/).
    for (const extra of ['world_nether', 'world_the_end']) {
      for (const sub of ['DIM-1', 'DIM1', 'dimensions']) {
        for (const file of await walk(path.join(data, extra, sub), sub)) files.set(file.rel, file.full);
      }
    }
    const writer = await ZipWriter.create(zipPath);
    try {
      for (const [rel, full] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) await writer.addFile(rel, full);
      await writer.close();
    } catch (err) {
      await writer.abort();
      await fs.rm(zipPath, { force: true });
      throw err;
    }
  }

  async backup(world: string, name: string): Promise<BackupInfo> {
    if (!BACKUP_FILE_RE.test(name)) throw new Error('Ungültiger Name der Sicherung.');
    const dir = this.backupsDir(world);
    await fs.mkdir(dir, { recursive: true });
    const dest = path.join(dir, `${name}.zip`);
    if (await exists(dest)) throw new Error('Diese Sicherung gibt es schon.');
    const tmp = `${dest}.tmp`;
    await fs.rm(tmp, { force: true });
    const writer = await ZipWriter.create(tmp);
    try {
      const files = await walk(this.dataDir(world), '', NOT_BACKED_UP);
      for (const file of files) {
        if (file.rel.startsWith('.import-') || file.rel.endsWith('.tmp') || file.rel.endsWith('session.lock') || file.rel.startsWith('plugins/.paper-remapped/')) continue;
        await writer.addFile(file.rel, file.full);
      }
      await writer.close();
    } catch (err) {
      await writer.abort();
      await fs.rm(tmp, { force: true });
      throw err;
    }
    await fs.rename(tmp, dest);
    const stat = await fs.stat(dest);
    return { name, sizeBytes: stat.size, createdAt: Date.now() };
  }

  async listBackups(world: string): Promise<BackupInfo[]> {
    let entries;
    try {
      entries = await fs.readdir(this.backupsDir(world), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: BackupInfo[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.zip')) continue;
      const name = entry.name.slice(0, -4);
      if (!BACKUP_FILE_RE.test(name)) continue;
      const stat = await fs.stat(path.join(this.backupsDir(world), entry.name));
      out.push({ name, sizeBytes: stat.size, createdAt: Math.round(stat.mtimeMs) });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  private backupFile(world: string, name: string): string {
    if (!BACKUP_FILE_RE.test(name)) throw new Error('Ungültiger Name der Sicherung.');
    return path.join(this.backupsDir(world), `${name}.zip`);
  }

  async restoreBackup(world: string, name: string): Promise<void> {
    this.requireStopped(world);
    const file = this.backupFile(world, name);
    const entries = await readZipEntries(file, { maxEntries: 500_000, maxTotalBytes: 64 * 1024 ** 3, maxEntryBytes: 4 * 1024 ** 3 });
    const data = this.dataDir(world);
    const staging = path.join(this.base(world), `restore-${randomBytes(6).toString('hex')}`);
    await fs.mkdir(staging);
    try {
      await extractZip(file, entries, staging);
      for (const entry of await fs.readdir(data)) if (!NOT_BACKED_UP.has(entry)) await fs.rm(path.join(data, entry), { recursive: true, force: true });
      for (const entry of await fs.readdir(staging)) await fs.rename(path.join(staging, entry), path.join(data, entry));
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async deleteBackup(world: string, name: string): Promise<void> {
    await fs.rm(this.backupFile(world, name), { force: true });
  }

  async exportBackup(world: string, name: string, zipPath: string): Promise<void> {
    await fs.copyFile(this.backupFile(world, name), zipPath, fs.constants.COPYFILE_EXCL);
  }

  async remove(world: string): Promise<void> {
    await this.stop(world, { timeoutMs: 20_000 });
    this.logs.delete(world);
    this.listeners.delete(world);
    await fs.rm(this.base(world), { recursive: true, force: true });
  }

  async list(): Promise<string[]> {
    try {
      return (await fs.readdir(this.options.root)).filter((name) => HOSTED_WORLD_ID_RE.test(name));
    } catch {
      return [];
    }
  }

  /** Beim Beenden des Dienstes: alle Server sauber anhalten (Prozesse dürfen nicht übrig bleiben). */
  async shutdown(): Promise<void> {
    await Promise.all([...this.procs.keys()].map((world) => this.stop(world, { timeoutMs: 30_000 }).catch(() => undefined)));
  }
}
