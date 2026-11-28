// FakeRunner für die Tests der dauerhaften Welten: hält alles im Speicher, ohne Java. Ein gestarteter „Server“ lauscht
// wirklich auf 127.0.0.1:<Port> und beantwortet Status und Login wie ein Minecraft-Server (damit das Relay echt
// durchreicht). Log-Zeilen („joined the game“ …) erzeugen die Tests selbst.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { loginDisconnect, parseHandshake, parseLoginStart, pongResponse, readPacket, statusResponse } from '../src/minecraft-protocol';
import type { BackupInfo, HostingRunner, PluginFile, PrepareOptions, RunnerState, RunnerStats } from '../src/hosting/runner';
import { ZipWriter } from '../src/hosting/safe-zip';

export interface FakeWorld {
  prepared: PrepareOptions | null;
  prepareCount: number;
  properties: Record<string, string>;
  motd: string;
  state: RunnerState;
  server: net.Server | null;
  sockets: Set<net.Socket>;
  port: number | null;
  ready: boolean;
  plugins: Map<string, PluginFile>;
  files: Map<string, string>;
  backups: Map<string, BackupInfo>;
  /** SHA-256 der importierten ZIPs */
  imported: string[];
  logs: string[];
  listeners: Set<(line: string) => void>;
  commands: string[];
  online: number;
  /** Namen aus Login Start, die beim Fake-Server ankamen */
  logins: string[];
  /** Status-Abfragen, die beim Fake-Server ankamen */
  statusRequests: number;
  diskMb: number;
  readyTimer?: NodeJS.Timeout;
}

function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export class FakeRunner implements HostingRunner {
  readonly worlds = new Map<string, FakeWorld>();
  readonly calls: { op: string; world: string; args?: unknown }[] = [];
  /** So lange bis „Done“ (Infinity: erst mit ready()) */
  readyDelayMs = 30;
  /** Nächster Start scheitert mit diesem Text */
  failStart: string | null = null;
  /** Ein Aufruf von stop() bleibt so lange hängen (für Tests mit „stopping“) */
  stopDelayMs = 0;

  private world(id: string): FakeWorld {
    let world = this.worlds.get(id);
    if (!world) {
      world = {
        prepared: null,
        prepareCount: 0,
        properties: {},
        motd: '',
        state: 'missing',
        server: null,
        sockets: new Set(),
        port: null,
        ready: false,
        plugins: new Map(),
        files: new Map(),
        backups: new Map(),
        imported: [],
        logs: [],
        listeners: new Set(),
        commands: [],
        online: 0,
        logins: [],
        statusRequests: 0,
        diskMb: 100,
      };
      this.worlds.set(id, world);
    }
    return world;
  }

  get(id: string): FakeWorld {
    const world = this.worlds.get(id);
    if (!world) throw new Error(`FakeRunner kennt die Welt ${id} nicht`);
    return world;
  }

  /** Log-Zeile wie vom Server. */
  emit(id: string, text: string): void {
    const world = this.world(id);
    const line = `[${stamp()} INFO]: ${text}`;
    world.logs.push(line);
    for (const listener of world.listeners) listener(line);
  }

  join(id: string, name: string): void {
    this.world(id).online++;
    this.emit(id, `${name} joined the game`);
  }

  leave(id: string, name: string): void {
    const world = this.world(id);
    world.online = Math.max(0, world.online - 1);
    this.emit(id, `${name} left the game`);
  }

  /** Server bereit („Done“). */
  ready(id: string): void {
    const world = this.world(id);
    if (world.state !== 'starting') return;
    world.ready = true;
    world.state = 'running';
    this.emit(id, 'Done (1.234s)! For help, type "help"');
  }

  /** Absturz: Prozess weg, ohne „Stopping server“. */
  crash(id: string): void {
    const world = this.world(id);
    this.closeServer(world);
    world.state = 'stopped';
  }

  private closeServer(world: FakeWorld): void {
    if (world.readyTimer) clearTimeout(world.readyTimer);
    world.server?.close();
    for (const socket of world.sockets) socket.destroy();
    world.sockets.clear();
    world.server = null;
    world.port = null;
    world.ready = false;
    world.online = 0;
  }

  private handle(world: FakeWorld, socket: net.Socket): void {
    world.sockets.add(socket);
    socket.on('close', () => world.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
    if (!world.ready) {
      socket.destroy();
      return;
    }
    let buffer = Buffer.alloc(0);
    let offset = 0;
    let next: number | null = null;
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        for (;;) {
          const packet = readPacket(buffer, offset, 4096);
          if (packet === null) return;
          offset = packet.end;
          if (next === null) {
            next = parseHandshake(packet).next;
            continue;
          }
          if (next === 1 && packet.id === 0x00) {
            world.statusRequests++;
            const max = Number(world.properties['max-players'] ?? '8');
            socket.write(
              statusResponse({
                versionName: 'Paper 26.3 (Fake)',
                protocol: 775,
                online: world.online,
                max,
                description: { text: world.motd, extra: [{ text: 'fake-paper' }] },
              }),
            );
            continue;
          }
          if (next === 1 && packet.id === 0x01) {
            socket.end(pongResponse(packet.data));
            return;
          }
          world.logins.push(parseLoginStart(packet));
          socket.end(loginDisconnect('Hallo vom Fake-Server'));
          return;
        }
      } catch {
        socket.destroy();
      }
    });
  }

  // ---------- HostingRunner ----------

  async prepare(id: string, options: PrepareOptions): Promise<void> {
    this.calls.push({ op: 'prepare', world: id, args: options });
    const world = this.world(id);
    world.prepared = options;
    world.prepareCount++;
    world.properties = { ...world.properties, ...options.properties };
    world.motd = options.motd;
    if (world.state === 'missing') world.state = 'stopped';
  }

  async start(id: string): Promise<{ port: number }> {
    this.calls.push({ op: 'start', world: id });
    const world = this.world(id);
    if (world.server && world.port !== null) return { port: world.port };
    if (this.failStart !== null) {
      const text = this.failStart;
      this.failStart = null;
      throw new Error(text);
    }
    const server = net.createServer((socket) => this.handle(world, socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    world.server = server;
    world.port = (server.address() as net.AddressInfo).port;
    world.state = 'starting';
    world.ready = false;
    world.online = 0;
    this.emit(id, 'Starting minecraft server version 26.3');
    if (Number.isFinite(this.readyDelayMs)) {
      world.readyTimer = setTimeout(() => this.ready(id), this.readyDelayMs);
      world.readyTimer.unref();
    }
    return { port: world.port };
  }

  async stop(id: string): Promise<void> {
    this.calls.push({ op: 'stop', world: id });
    const world = this.world(id);
    if (!world.server) return;
    world.state = 'stopping';
    this.emit(id, 'Stopping the server');
    if (this.stopDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.stopDelayMs));
    this.closeServer(world);
    world.state = 'stopped';
  }

  async state(id: string): Promise<RunnerState> {
    return this.worlds.get(id)?.state ?? 'missing';
  }

  async port(id: string): Promise<number | null> {
    return this.worlds.get(id)?.port ?? null;
  }

  async command(id: string, line: string): Promise<void> {
    const world = this.get(id);
    if (!world.server) throw new Error('Der Server läuft nicht.');
    if (line.includes('\n') || line.length > 256) throw new Error('Ungültiger Befehl.');
    world.commands.push(line);
    if (line === 'save-all flush') this.emit(id, 'Saved the game');
    if (line === 'stop') {
      this.emit(id, 'Stopping server');
      this.closeServer(world);
      world.state = 'stopped';
    }
  }

  async recentLogs(id: string, lines: number): Promise<string[]> {
    return (this.worlds.get(id)?.logs ?? []).slice(-lines);
  }

  followLogs(id: string, onLine: (line: string) => void): () => void {
    const world = this.world(id);
    world.listeners.add(onLine);
    return () => world.listeners.delete(onLine);
  }

  async stats(id: string): Promise<RunnerStats> {
    const world = this.world(id);
    return { memoryMb: world.server ? 1500 : 0, cpuPercent: world.server ? 12 : 0, diskMb: world.diskMb };
  }

  async setProperties(id: string, properties: Record<string, string>, motd?: string): Promise<void> {
    this.calls.push({ op: 'setProperties', world: id, args: { properties, motd } });
    const world = this.world(id);
    world.properties = { ...world.properties, ...properties };
    if (motd !== undefined) world.motd = motd;
  }

  async listPlugins(id: string): Promise<string[]> {
    return [...this.world(id).plugins.keys()].sort();
  }

  async installPlugin(id: string, file: PluginFile): Promise<void> {
    this.calls.push({ op: 'installPlugin', world: id, args: file });
    if (!file.url.startsWith('https://cdn.modrinth.com/')) throw new Error('nur cdn.modrinth.com');
    this.world(id).plugins.set(file.name, file);
  }

  async removePlugin(id: string, name: string): Promise<void> {
    this.calls.push({ op: 'removePlugin', world: id, args: name });
    this.world(id).plugins.delete(name);
  }

  async readFile(id: string, relativePath: string): Promise<string> {
    const content = this.world(id).files.get(relativePath);
    if (content === undefined) throw new Error('nicht gefunden');
    return content;
  }

  async writeFile(id: string, relativePath: string, content: string): Promise<void> {
    this.calls.push({ op: 'writeFile', world: id, args: relativePath });
    this.world(id).files.set(relativePath, content);
  }

  async listFiles(id: string): Promise<string[]> {
    return [...this.world(id).files.keys()].sort();
  }

  async importWorld(id: string, zipPath: string): Promise<void> {
    const world = this.world(id);
    if (world.server) throw new Error('Das geht nur, wenn der Server aus ist.');
    const hash = createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
    this.calls.push({ op: 'importWorld', world: id, args: zipPath });
    world.imported.push(hash);
  }

  private async writeZip(zipPath: string, name: string): Promise<void> {
    const tmp = `${zipPath}.inhalt`;
    fs.writeFileSync(tmp, `fake ${name}`);
    const writer = await ZipWriter.create(zipPath);
    await writer.addFile('level.dat', tmp);
    await writer.close();
    fs.rmSync(tmp, { force: true });
  }

  async exportWorld(id: string, zipPath: string): Promise<void> {
    this.calls.push({ op: 'exportWorld', world: id });
    await this.writeZip(zipPath, `welt ${id}`);
  }

  async backup(id: string, name: string): Promise<BackupInfo> {
    this.calls.push({ op: 'backup', world: id, args: name });
    const world = this.world(id);
    if (world.backups.has(name)) throw new Error('gibt es schon');
    const info = { name, sizeBytes: 50 * 1024 * 1024, createdAt: Date.now() + world.backups.size };
    world.backups.set(name, info);
    return info;
  }

  async listBackups(id: string): Promise<BackupInfo[]> {
    return [...(this.worlds.get(id)?.backups.values() ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  }

  async restoreBackup(id: string, name: string): Promise<void> {
    const world = this.world(id);
    if (world.server) throw new Error('Das geht nur, wenn der Server aus ist.');
    if (!world.backups.has(name)) throw new Error('unbekannt');
    this.calls.push({ op: 'restoreBackup', world: id, args: name });
  }

  async deleteBackup(id: string, name: string): Promise<void> {
    this.calls.push({ op: 'deleteBackup', world: id, args: name });
    this.world(id).backups.delete(name);
  }

  async exportBackup(id: string, name: string, zipPath: string): Promise<void> {
    if (!this.world(id).backups.has(name)) throw new Error('unbekannt');
    await this.writeZip(zipPath, `sicherung ${name}`);
  }

  async remove(id: string): Promise<void> {
    this.calls.push({ op: 'remove', world: id });
    const world = this.worlds.get(id);
    if (world) this.closeServer(world);
    this.worlds.delete(id);
  }

  async list(): Promise<string[]> {
    return [...this.worlds.keys()];
  }

  /** Wie der ProcessRunner beim Beenden: alle „Server“ zu. */
  async shutdown(): Promise<void> {
    for (const world of this.worlds.values()) {
      this.closeServer(world);
      if (world.state !== 'missing') world.state = 'stopped';
    }
  }

  ops(op: string, world?: string): unknown[] {
    return this.calls.filter((c) => c.op === op && (world === undefined || c.world === world)).map((c) => c.args);
  }
}
