// Protokoll zwischen Dienst (hosting/agent-runner.ts) und Welten-Wächter (agent/server.ts), über einen Unix-Socket
// (unter Windows für Tests eine Named Pipe, z. B. \\.\pipe\heldix-welten):
//
//   Anfrage:   eine JSON-Zeile  { "id": 7, "op": "start", "world": "<32 hex>", "args": { … } }
//   Antwort:   { "id": 7, "ok": true, "result": … }   oder   { "id": 7, "ok": false, "error": "<deutsch>", "code": "full" }
//   Log-Strom: { "id": 9, "op": "follow", "world": "…", "args": {} } → erst { "id": 9, "ok": true, "result": null },
//              dann { "id": 9, "line": "…" } je neue Zeile – auch über Neustarts der Welt hinweg – bis
//              { "id": 10, "op": "unfollow", "world": "…", "args": { "follow": 9 } } oder die Verbindung endet.
//
// Die Operationen heißen wie die Methoden von HostingRunner (hosting/runner.ts); Buffer (iconPng) gehen als Base64.
// `hello` und `list` brauchen keine Welt. Unbekannte Felder lehnt der Wächter ab.

export const PROTOCOL_VERSION = 1;

export const DEFAULT_SOCKET_PATH = '/run/heldix-dienst/welten.sock';

/** Größte Anfrage (writeFile bis 256 KB, als JSON maskiert schlimmstenfalls ~1,5 MB). */
export const MAX_REQUEST_LINE_BYTES = 4 * 1024 * 1024;
/** Größte Antwort (recentLogs bis 2000 Zeilen à 4 KB). */
export const MAX_RESPONSE_LINE_BYTES = 64 * 1024 * 1024;

export const WORLD_OPS = [
  'prepare',
  'start',
  'stop',
  'state',
  'port',
  'command',
  'recentLogs',
  'follow',
  'unfollow',
  'stats',
  'setProperties',
  'listPlugins',
  'installPlugin',
  'removePlugin',
  'readFile',
  'writeFile',
  'listFiles',
  'importWorld',
  'exportWorld',
  'backup',
  'listBackups',
  'restoreBackup',
  'deleteBackup',
  'exportBackup',
  'remove',
] as const;

export const GLOBAL_OPS = ['hello', 'list'] as const;

export type WorldOp = (typeof WORLD_OPS)[number];
export type GlobalOp = (typeof GLOBAL_OPS)[number];
export type AgentOp = WorldOp | GlobalOp;

export interface AgentRequest {
  id: number;
  op: AgentOp;
  world?: string;
  args?: Record<string, unknown>;
}

export interface HelloResult {
  protocol: number;
  version: string;
  maxRunning: number;
  eula: boolean;
  image: string;
}

/**
 * Zerlegt einen Byte-Strom in Zeilen (\n, ein \r davor fällt weg). Wirft, sobald eine Zeile länger als `maxBytes` wird,
 * damit ein Gegenüber den Speicher nicht volllaufen lassen kann.
 */
export class LineBuffer {
  private parts: Buffer[] = [];
  private size = 0;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let i = chunk.indexOf(10); i !== -1; i = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, i);
      if (this.size + piece.length > this.maxBytes) throw new Error('Zeile zu lang');
      this.parts.push(piece);
      let line = Buffer.concat(this.parts).toString('utf8');
      if (line.endsWith('\r')) line = line.slice(0, -1);
      lines.push(line);
      this.parts = [];
      this.size = 0;
      start = i + 1;
    }
    if (start < chunk.length) {
      const rest = chunk.subarray(start);
      if (this.size + rest.length > this.maxBytes) throw new Error('Zeile zu lang');
      this.parts.push(rest);
      this.size += rest.length;
    }
    return lines;
  }

  /** Was ohne Zeilenende übrig ist (z. B. wenn ein Prozess endet). */
  flush(): string | null {
    if (this.size === 0) return null;
    const line = Buffer.concat(this.parts).toString('utf8');
    this.parts = [];
    this.size = 0;
    return line;
  }
}
