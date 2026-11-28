// Hilfen für die Tests des Welten-Wächters: Wächter mit Fake-Docker (test/fake-docker.ts) in einem Temp-Ordner, Socket
// bzw. Named Pipe, nachgebauter Download-Server (statt PaperMC und Modrinth) und ein ZIP-Bauer, der auch bösartige
// Archive (Links, falsche Größen, …) erzeugen kann.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import type { AgentConfig } from '../src/agent/config';
import { DockerRunner } from '../src/agent/docker-runner';
import { startAgentServer, type AgentServer } from '../src/agent/server';
import { AgentRunner } from '../src/hosting/agent-runner';

export const FAKE_DOCKER = path.join(__dirname, 'fake-docker.js');

export function socketPathFor(name: string): string {
  const id = randomBytes(6).toString('hex');
  return process.platform === 'win32' ? `\\\\.\\pipe\\heldix-welten-test-${name}-${id}` : path.join(os.tmpdir(), `hw-${name}-${id}.sock`);
}

export function worldId(): string {
  return randomBytes(16).toString('hex');
}

/** Nachgebauter Download-Server: liefert registrierte Dateien unter ihrem Pfad. */
export interface FakeDownloads {
  base: string;
  add(urlPath: string, data: Buffer): void;
  /** Pfade der Anfragen (zum Prüfen, dass nichts anderes abgefragt wurde) */
  requests: string[];
  close(): Promise<void>;
}

export async function fakeDownloads(): Promise<FakeDownloads> {
  const files = new Map<string, Buffer>();
  const requests: string[] = [];
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? '');
    const data = files.get(req.url ?? '');
    if (!data) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/java-archive', 'content-length': data.length }).end(data);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    add: (urlPath, data) => files.set(urlPath, data),
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export interface AgentFixture {
  root: string;
  dataDir: string;
  uploadsDir: string;
  dockerDir: string;
  socketPath: string;
  runner: DockerRunner;
  server: AgentServer;
  client: AgentRunner;
  downloads: FakeDownloads;
  logs: string[];
  /** Schalter des Fake-Docker setzen (z. B. FAKE_DOCKER_IGNORE_STOP: "1") */
  setFake(values: Record<string, string>): void;
  /** alle Aufrufe des Fake-Docker (Argumente) */
  calls(): string[][];
  dataOf(world: string): string;
  /** Server neu starten (gleicher Socket, gleicher Runner) */
  restartServer(): Promise<void>;
  close(): Promise<void>;
}

export async function agentFixture(overrides: Partial<AgentConfig> = {}): Promise<AgentFixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-welten-test-'));
  const dataDir = path.join(root, 'welten');
  const uploadsDir = path.join(root, 'uploads');
  const dockerDir = path.join(root, 'docker');
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(dockerDir, { recursive: true });
  // je Fixture ein eigenes Startskript: der Zustandsordner steht darin, nicht in der Umgebung des Testprozesses
  const docker = path.join(root, 'docker.js');
  fs.writeFileSync(docker, `process.env.FAKE_DOCKER_DIR = ${JSON.stringify(dockerDir)};\nrequire(${JSON.stringify(FAKE_DOCKER)});\n`);
  const downloads = await fakeDownloads();
  const logs: string[] = [];
  const socketPath = socketPathFor('agent');
  const runner = new DockerRunner(
    {
      dataDir,
      uploadsDir,
      socketPath,
      socketGid: null,
      docker,
      acceptEula: true,
      maxRunning: 4,
      maxBackups: 5,
      diskLimitBytes: 64 * 1024 * 1024,
      owner: null,
      portMin: 31000,
      portMax: 31999,
      // nur Tests: echte Adressen auf den nachgebauten Server umleiten
      fetchUrl: (url) => {
        const parsed = new URL(url);
        return `${downloads.base}/${parsed.hostname}${parsed.pathname}`;
      },
      log: (line) => logs.push(line),
      ...overrides,
    },
    '1.13.0-test',
  );
  await runner.init();
  let server = await startAgentServer(runner, { socketPath, socketGid: null, log: (line) => logs.push(line) });
  const client = new AgentRunner(socketPath, { reconnectDelayMs: 100, maxReconnectDelayMs: 200 });
  return {
    root,
    dataDir,
    uploadsDir,
    dockerDir,
    socketPath,
    runner,
    get server() {
      return server;
    },
    client,
    downloads,
    logs,
    setFake: (values) => fs.writeFileSync(path.join(dockerDir, 'env.json'), JSON.stringify(values)),
    calls: () =>
      fs
        .readFileSync(path.join(dockerDir, 'calls.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
    dataOf: (world) => path.join(fs.realpathSync(dataDir), 'worlds', world, 'data'),
    restartServer: async () => {
      await server.close();
      server = await startAgentServer(runner, { socketPath, socketGid: null, log: (line) => logs.push(line) });
    },
    close: async () => {
      client.close();
      await server.close();
      await runner.close();
      await downloads.close();
      // Die Fake-Konsolen beenden sich, sobald ihr Zustand weg ist
      for (let i = 0; i < 20; i++) {
        try {
          fs.rmSync(root, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    },
  };
}

/** Server-Jar (Paper) für prepare: Datei beim Download-Server ablegen und die Angaben dazu liefern. */
export function paperJar(fixture: AgentFixture, content = randomBytes(2048)): { software: 'paper'; version: string; url: string; sha256: string; build: number } {
  const sha256 = createHash('sha256').update(content).digest('hex');
  const file = `/v1/objects/${sha256}/paper-26.3-42.jar`;
  fixture.downloads.add(`/fill-data.papermc.io${file}`, content);
  return { software: 'paper', version: '26.3', url: `https://fill-data.papermc.io${file}`, sha256, build: 42 };
}

export function vanillaJar(fixture: AgentFixture, content = randomBytes(1024)): { software: 'vanilla'; version: string; url: string; sha1: string; build: null } {
  const sha1 = createHash('sha1').update(content).digest('hex');
  const file = `/v1/objects/${sha1}/server.jar`;
  fixture.downloads.add(`/piston-data.mojang.com${file}`, content);
  return { software: 'vanilla', version: '26.3', url: `https://piston-data.mojang.com${file}`, sha1, build: null };
}

/** Plugin bei „Modrinth“ ablegen; liefert PluginFile. */
export function modrinthPlugin(fixture: AgentFixture, name: string, content = randomBytes(1500)): { name: string; url: string; sha512: string } {
  const sha512 = createHash('sha512').update(content).digest('hex');
  const file = `/data/AbCd1234/versions/Ef${randomBytes(3).toString('hex')}/${name}`;
  fixture.downloads.add(`/cdn.modrinth.com${file}`, content);
  return { name, url: `https://cdn.modrinth.com${file}`, sha512 };
}

export async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs = 8000, what = 'Bedingung'): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`Zeitüberschreitung: ${what}`);
}

// ---------------------------------------------------------------------------------------------
// ZIP-Bauer (auch für bösartige Archive)
// ---------------------------------------------------------------------------------------------

export interface RawEntry {
  name: string;
  data?: Buffer | string;
  /** 0 = stored, 8 = deflate */
  method?: number;
  /** Unix-Modus (z. B. 0o120777 für einen Link); setzt „made by Unix“ */
  unixMode?: number;
  /** angegebene Größe statt der echten */
  size?: number;
  crc?: number;
  flags?: number;
  /** anderer Name im lokalen Kopf */
  localName?: string;
  /** Inhaltsverzeichnis zeigt auf den lokalen Kopf dieses früheren Eintrags (Überlappung) */
  sameLocalAs?: number;
}

export function rawZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const offsets: number[] = [];
  let offset = 0;
  entries.forEach((e, index) => {
    const data = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : (e.data ?? Buffer.alloc(0));
    const method = e.method ?? (data.length > 0 ? 8 : 0);
    const stored = method === 8 ? deflateRawSync(data) : data;
    const crc = e.crc ?? crc32(data);
    const size = e.size ?? data.length;
    const flags = e.flags ?? 0x0800;
    const name = Buffer.from(e.name, 'utf8');
    const localName = Buffer.from(e.localName ?? e.name, 'utf8');
    let localOffset = offset;
    if (e.sameLocalAs !== undefined) {
      localOffset = offsets[e.sameLocalAs]!;
    } else {
      const head = Buffer.alloc(30);
      head.writeUInt32LE(0x04034b50, 0);
      head.writeUInt16LE(20, 4);
      head.writeUInt16LE(flags, 6);
      head.writeUInt16LE(method, 8);
      head.writeUInt32LE(crc >>> 0, 14);
      head.writeUInt32LE(stored.length, 18);
      head.writeUInt32LE(size, 22);
      head.writeUInt16LE(localName.length, 26);
      const local = Buffer.concat([head, localName, stored]);
      locals.push(local);
      offset += local.length;
    }
    offsets[index] = localOffset;
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(e.unixMode === undefined ? 20 : (3 << 8) | 20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(flags, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(stored.length, 20);
    c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(e.unixMode === undefined ? 0 : (e.unixMode << 16) >>> 0, 38);
    c.writeUInt32LE(localOffset, 42);
    centrals.push(Buffer.concat([c, name]));
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Eine kleine Einzelspielerwelt als ZIP (wie die Sicherungen des Clients: Einträge relativ zur Welt). */
export function singleplayerWorld(prefix = ''): Buffer {
  return rawZip([
    { name: `${prefix}level.dat`, data: randomBytes(200), method: 0 },
    { name: `${prefix}region/`, method: 0 },
    { name: `${prefix}region/r.0.0.mca`, data: Buffer.alloc(8192, 7) },
    { name: `${prefix}DIM-1/region/r.0.0.mca`, data: Buffer.alloc(4096, 3) },
    { name: `${prefix}session.lock`, data: Buffer.from([0xe2, 0x98, 0x83]), method: 0 },
  ]);
}
