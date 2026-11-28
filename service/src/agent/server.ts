// Socket-Server des Welten-Wächters (Protokoll: protocol.ts). Jede Anfrage wird streng geprüft: bekannte Operation,
// Welt-ID, nur die Felder, die die Operation kennt, und deren Typen; danach prüft DockerRunner die Werte selbst noch
// einmal. Unter Linux ein Unix-Socket mit Rechten 0660 (Gruppe des Dienst-Benutzers), unter Windows (nur Tests) eine
// Named Pipe.
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import type { PluginFile, PrepareOptions } from '../hosting/runner';
import { checkInt, checkKeys, checkWorld, isPlainObject } from './checks';
import type { DockerRunner } from './docker-runner';
import { AgentError, toAgentError } from './errors';
import { lstatOrNull } from './files';
import { GLOBAL_OPS, LineBuffer, MAX_REQUEST_LINE_BYTES, WORLD_OPS, type AgentOp, type AgentRequest } from './protocol';

const MAX_CONNECTIONS = 16;
const MAX_INFLIGHT = 64;
/** Log-Zeilen für einen Leser, der nicht hinterherkommt, fallen weg (statt den Speicher zu füllen). */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
/** Operationen, die etwas ändern: stehen im Protokoll des Wächters (ohne Inhalte) */
const LOGGED_OPS = new Set<AgentOp>([
  'prepare',
  'start',
  'stop',
  'setProperties',
  'installPlugin',
  'removePlugin',
  'writeFile',
  'importWorld',
  'exportWorld',
  'backup',
  'restoreBackup',
  'deleteBackup',
  'exportBackup',
  'remove',
]);

export interface AgentServerOptions {
  socketPath: string;
  socketGid: number | null;
  log?: (line: string) => void;
}

export interface AgentServer {
  readonly socketPath: string;
  close(): Promise<void>;
}

interface Connection {
  follows: Map<number, () => void>;
  send(message: unknown): void;
  sendLine(id: number, line: string): void;
}

function isPipePath(socketPath: string): boolean {
  return socketPath.startsWith('\\\\.\\pipe\\') || socketPath.startsWith('\\\\?\\pipe\\');
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new AgentError(`${label}: Text erwartet.`);
  return value;
}

/** Prüft die äußere Form einer Anfrage. */
export function parseRequest(message: unknown): AgentRequest {
  const v = checkKeys(message, ['id', 'op', 'world', 'args'], 'Anfrage');
  const id = checkInt(v.id, 0, Number.MAX_SAFE_INTEGER, 'Anfrage-ID');
  if (typeof v.op !== 'string' || !([...WORLD_OPS, ...GLOBAL_OPS] as string[]).includes(v.op)) throw new AgentError('Unbekannte Operation.');
  const op = v.op as AgentOp;
  if (v.args !== undefined && !isPlainObject(v.args)) throw new AgentError('Anfrage: args muss ein Objekt sein.');
  if ((GLOBAL_OPS as readonly string[]).includes(op)) {
    if (v.world !== undefined) throw new AgentError(`${op}: ohne Welt.`);
    return { id, op, args: (v.args as Record<string, unknown> | undefined) ?? {} };
  }
  return { id, op, world: checkWorld(v.world), args: (v.args as Record<string, unknown> | undefined) ?? {} };
}

function decodeIcon(value: unknown): Buffer | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 100 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new AgentError('Symbol: Base64 erwartet.');
  }
  return Buffer.from(value, 'base64');
}

async function dispatch(runner: DockerRunner, request: AgentRequest, connection: Connection): Promise<unknown> {
  const args = request.args ?? {};
  const world = request.world ?? '';
  const only = (...keys: string[]) => checkKeys(args, keys, request.op);
  switch (request.op) {
    case 'hello':
      only();
      return runner.hello();
    case 'list':
      only();
      return runner.list();
    case 'prepare': {
      const a = only('jar', 'memoryMb', 'properties', 'motd', 'iconPng');
      const icon = decodeIcon(a.iconPng);
      const options = { jar: a.jar, memoryMb: a.memoryMb, properties: a.properties, motd: a.motd, ...(icon ? { iconPng: icon } : {}) };
      await runner.prepare(world, options as PrepareOptions);
      return null;
    }
    case 'start':
      only();
      return runner.start(world);
    case 'stop': {
      const a = only('timeoutMs');
      await runner.stop(world, a.timeoutMs === undefined ? {} : { timeoutMs: checkInt(a.timeoutMs, 1000, 600_000, 'Zeitgrenze (ms)') });
      return null;
    }
    case 'state':
      only();
      return runner.state(world);
    case 'port':
      only();
      return runner.port(world);
    case 'command': {
      const a = only('line');
      await runner.command(world, string(a.line, 'Befehl'));
      return null;
    }
    case 'recentLogs': {
      const a = only('lines');
      return runner.recentLogs(world, checkInt(a.lines, 1, 2000, 'Zeilen'));
    }
    case 'follow': {
      only();
      const id = request.id;
      connection.follows.get(id)?.();
      connection.follows.set(
        id,
        runner.followLogs(world, (line) => connection.sendLine(id, line)),
      );
      return null;
    }
    case 'unfollow': {
      const a = only('follow');
      const followId = checkInt(a.follow, 0, Number.MAX_SAFE_INTEGER, 'follow');
      connection.follows.get(followId)?.();
      connection.follows.delete(followId);
      return null;
    }
    case 'stats':
      only();
      return runner.stats(world);
    case 'setProperties': {
      const a = only('properties', 'motd');
      await runner.setProperties(world, a.properties as Record<string, string>, a.motd === undefined ? undefined : string(a.motd, 'MOTD'));
      return null;
    }
    case 'listPlugins':
      only();
      return runner.listPlugins(world);
    case 'installPlugin': {
      const a = only('name', 'url', 'sha512');
      await runner.installPlugin(world, { name: a.name, url: a.url, sha512: a.sha512 } as PluginFile);
      return null;
    }
    case 'removePlugin': {
      const a = only('name');
      await runner.removePlugin(world, string(a.name, 'Plugin'));
      return null;
    }
    case 'readFile': {
      const a = only('path');
      return runner.readFile(world, string(a.path, 'Pfad'));
    }
    case 'writeFile': {
      const a = only('path', 'content');
      await runner.writeFile(world, string(a.path, 'Pfad'), string(a.content, 'Inhalt'));
      return null;
    }
    case 'listFiles':
      only();
      return runner.listFiles(world);
    case 'importWorld': {
      const a = only('zipPath');
      await runner.importWorld(world, string(a.zipPath, 'Pfad'));
      return null;
    }
    case 'exportWorld': {
      const a = only('zipPath');
      await runner.exportWorld(world, string(a.zipPath, 'Pfad'));
      return null;
    }
    case 'backup': {
      const a = only('name');
      return runner.backup(world, string(a.name, 'Name'));
    }
    case 'listBackups':
      only();
      return runner.listBackups(world);
    case 'restoreBackup': {
      const a = only('name');
      await runner.restoreBackup(world, string(a.name, 'Name'));
      return null;
    }
    case 'deleteBackup': {
      const a = only('name');
      await runner.deleteBackup(world, string(a.name, 'Name'));
      return null;
    }
    case 'exportBackup': {
      const a = only('name', 'zipPath');
      await runner.exportBackup(world, string(a.name, 'Name'), string(a.zipPath, 'Pfad'));
      return null;
    }
    case 'remove':
      only();
      await runner.remove(world);
      return null;
  }
}

export async function startAgentServer(runner: DockerRunner, options: AgentServerOptions): Promise<AgentServer> {
  const log = options.log ?? ((line: string) => console.log(`[welten] ${line}`));
  const pipe = isPipePath(options.socketPath);
  if (!pipe) {
    await fsp.mkdir(path.dirname(options.socketPath), { recursive: true, mode: 0o755 });
    const st = await lstatOrNull(options.socketPath);
    if (st) {
      if (!st.isSocket()) throw new Error(`${options.socketPath} ist keine Socket-Datei – bitte prüfen.`);
      await fsp.unlink(options.socketPath);
    }
  }
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    if (sockets.size >= MAX_CONNECTIONS) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    handleConnection(runner, socket, log, () => sockets.delete(socket));
  });
  // Rechte erst 0600, dann (nach chown auf die Gruppe des Dienstes) 0660: niemand sonst verbindet sich je
  const previousMask = pipe ? null : process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } finally {
    if (previousMask !== null) process.umask(previousMask);
  }
  if (!pipe) {
    if (options.socketGid !== null) await fsp.chown(options.socketPath, process.getuid?.() ?? 0, options.socketGid);
    await fsp.chmod(options.socketPath, options.socketGid !== null ? 0o660 : 0o600);
  }
  return {
    socketPath: options.socketPath,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!pipe) await fsp.rm(options.socketPath, { force: true }).catch(() => {});
    },
  };
}

function handleConnection(runner: DockerRunner, socket: net.Socket, log: (line: string) => void, onClose: () => void): void {
  const buffer = new LineBuffer(MAX_REQUEST_LINE_BYTES);
  let inflight = 0;
  const connection: Connection = {
    follows: new Map(),
    send(message: unknown) {
      if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(message)}\n`);
    },
    sendLine(id: number, line: string) {
      if (socket.writableLength > MAX_BUFFERED_BYTES) return;
      this.send({ id, line });
    },
  };

  const handle = async (line: string): Promise<void> => {
    let id: number | null = null;
    try {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        throw new AgentError('Ungültige Anfrage: kein JSON.');
      }
      if (isPlainObject(message) && typeof message.id === 'number' && Number.isSafeInteger(message.id) && message.id >= 0) id = message.id;
      const request = parseRequest(message);
      if (inflight >= MAX_INFLIGHT) throw new AgentError('Zu viele gleichzeitige Anfragen.', 'busy');
      inflight += 1;
      const started = Date.now();
      try {
        const result = await dispatch(runner, request, connection);
        connection.send({ id: request.id, ok: true, result: result ?? null });
        if (LOGGED_OPS.has(request.op)) log(`${request.op} ${request.world ?? ''} ok (${Date.now() - started} ms)`);
      } catch (err) {
        if (LOGGED_OPS.has(request.op)) log(`${request.op} ${request.world ?? ''}: ${toAgentError(err).message}`);
        throw err;
      } finally {
        inflight -= 1;
      }
    } catch (err) {
      const error = toAgentError(err);
      if (error.code === 'internal' && !(err instanceof AgentError)) log(`Interner Fehler: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      connection.send({ id, ok: false, error: error.message, code: error.code });
    }
  };

  socket.on('data', (chunk: Buffer) => {
    let lines: string[];
    try {
      lines = buffer.push(chunk);
    } catch {
      connection.send({ id: null, ok: false, error: 'Anfrage zu groß.', code: 'too-large' });
      socket.destroy();
      return;
    }
    for (const line of lines) if (line.trim() !== '') void handle(line);
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    for (const off of connection.follows.values()) off();
    connection.follows.clear();
    onClose();
  });
}
