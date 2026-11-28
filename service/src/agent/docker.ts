// Docker-CLI für den Welten-Wächter: immer execFile/spawn mit festen Argumenten, nie eine Shell. Jedes Argument muss
// druckbares ASCII ohne Leerzeichen sein (assertArgs) – freier Text (Konsolenbefehle, Dateiinhalte) kommt so nie in
// eine Befehlszeile; er geht über stdin bzw. Dateien. Die Argumente für `docker run` baut nur runArgs() aus geprüften
// Werten: feste Grenzen, festes Image, fester Befehl.
import { execFile, spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { HOSTED_WORLD_ID_RE } from '../hosting/runner';
import { AgentError } from './errors';
import { WORLD_IMAGE } from './image';

export const CONTAINER_PREFIX = 'heldix-welt-';
export const NETWORK_NAME = 'heldix-welten';
export const LABEL_WORLD = 'heldix.world';
export const LABEL_PORT = 'heldix.port';
export const CONTAINER_USER = '1000:1000';
/** Java im Image (eclipse-temurin: JAVA_HOME=/opt/java/openjdk); direkt als Entrypoint, ohne Shell-Skript davor */
export const JAVA_BIN = '/opt/java/openjdk/bin/java';
/** Port des Minecraft-Servers im Container (server-port in server.properties) */
export const CONTAINER_PORT = 25565;

/** Feste Grenzen jedes Welt-Containers (siehe dauerhafte-welten-spec.md, „Sicherheit“). */
export const CONTAINER_LIMITS = {
  cpus: '2',
  pidsLimit: '512',
  // exec: Netty und sqlite-jdbc (z. B. CoreProtect) entpacken native Bibliotheken nach /tmp; ohne exec liefen
  // solche Plugins nicht. Code ausführen kann ein Plugin im Container ohnehin.
  tmpfs: '/tmp:rw,exec,nosuid,nodev,size=256m',
  logMaxSize: '10m',
  logMaxFile: '3',
} as const;

const JAR_FILE_RE = /^(paper|vanilla)-[0-9a-f]{40,64}\.jar$/;
const ARG_RE = /^[\x21-\x7e]{1,4096}$/;

export function containerName(world: string): string {
  if (!HOSTED_WORLD_ID_RE.test(world)) throw new AgentError('Ungültige Welt-ID.');
  return `${CONTAINER_PREFIX}${world}`;
}

/** Heap der JVM: 5/6 des Container-RAMs (3072 MB → 2560 MB), der Rest für Metaspace, Threads, Netty und /tmp. */
export function heapMb(memoryMb: number): number {
  return Math.floor((memoryMb * 5) / 6);
}

export function javaArgs(memoryMb: number, jarFile: string): string[] {
  if (!JAR_FILE_RE.test(jarFile)) throw new AgentError('Interner Fehler: unzulässige Server-Jar.', 'internal');
  const heap = heapMb(memoryMb);
  return [
    `-Xms${heap}m`,
    `-Xmx${heap}m`,
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:MaxGCPauseMillis=200',
    '-XX:+DisableExplicitGC',
    '-XX:+ExitOnOutOfMemoryError',
    '-Djava.io.tmpdir=/tmp',
    '-Duser.home=/tmp',
    '-Dfile.encoding=UTF-8',
    '-Dterminal.jline=false',
    '-Dterminal.ansi=false',
    '-Dlog4j2.formatMsgNoLookups=true',
    '-jar',
    `/jars/${jarFile}`,
    '--nogui',
  ];
}

export interface RunSpec {
  world: string;
  port: number;
  memoryMb: number;
  jarFile: string;
  /** Datenordner der Welt am Host (→ /data, schreibbar) */
  dataDir: string;
  /** gemeinsamer Ordner der Server-Jars am Host (→ /jars, nur lesbar) */
  jarsDir: string;
}

/** Argumente für `docker run` einer Welt. Alles fest außer den geprüften Werten aus RunSpec. */
export function runArgs(spec: RunSpec): string[] {
  const name = containerName(spec.world);
  if (!Number.isInteger(spec.port) || spec.port < 1024 || spec.port > 65535) throw new AgentError('Interner Fehler: Port.', 'internal');
  if (!Number.isInteger(spec.memoryMb) || spec.memoryMb < 1024 || spec.memoryMb > 16384) throw new AgentError('Interner Fehler: RAM.', 'internal');
  for (const dir of [spec.dataDir, spec.jarsDir]) {
    if (!ARG_RE.test(dir) || /[,"']/.test(dir)) throw new AgentError('Interner Fehler: Pfad.', 'internal');
  }
  return [
    'run',
    '--detach',
    // stdin offen lassen: die Konsole läuft über `docker attach` (siehe DockerRunner)
    '--interactive',
    '--name',
    name,
    '--label',
    `${LABEL_WORLD}=${spec.world}`,
    '--label',
    `${LABEL_PORT}=${spec.port}`,
    '--user',
    CONTAINER_USER,
    '--memory',
    `${spec.memoryMb}m`,
    '--memory-swap',
    `${spec.memoryMb}m`,
    '--cpus',
    CONTAINER_LIMITS.cpus,
    '--pids-limit',
    CONTAINER_LIMITS.pidsLimit,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--read-only',
    '--tmpfs',
    CONTAINER_LIMITS.tmpfs,
    '--network',
    NETWORK_NAME,
    '--publish',
    `127.0.0.1:${spec.port}:${CONTAINER_PORT}/tcp`,
    '--restart',
    'no',
    '--log-driver',
    'json-file',
    '--log-opt',
    `max-size=${CONTAINER_LIMITS.logMaxSize}`,
    '--log-opt',
    `max-file=${CONTAINER_LIMITS.logMaxFile}`,
    '--mount',
    `type=bind,source=${spec.dataDir},target=/data`,
    '--mount',
    `type=bind,source=${spec.jarsDir},target=/jars,readonly`,
    '--workdir',
    '/data',
    '--env',
    'HOME=/tmp',
    '--entrypoint',
    JAVA_BIN,
    WORLD_IMAGE,
    ...javaArgs(spec.memoryMb, spec.jarFile),
  ];
}

/** Netz der Welten: eigene Brücke mit festem Schnittstellennamen (für die Firewall-Regeln), Container untereinander getrennt. */
export function networkCreateArgs(): string[] {
  return [
    'network',
    'create',
    '--driver',
    'bridge',
    '--opt',
    `com.docker.network.bridge.name=${NETWORK_NAME}`,
    '--opt',
    'com.docker.network.bridge.enable_icc=false',
    NETWORK_NAME,
  ];
}

export function assertArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (typeof arg !== 'string' || !ARG_RE.test(arg)) throw new AgentError('Interner Fehler: unzulässiges Docker-Argument.', 'internal');
  }
}

export class DockerFailure extends AgentError {
  constructor(
    message: string,
    readonly stderr: string,
    readonly notFound: boolean,
  ) {
    super(message, notFound ? 'not-found' : 'docker');
  }
}

function firstLine(text: string): string {
  return (text.split('\n').find((line) => line.trim() !== '') ?? '').trim().slice(0, 300);
}

function dockerError(err: NodeJS.ErrnoException & { killed?: boolean }, stderr: string, sub: string): DockerFailure {
  const text = String(stderr ?? '').trim();
  if (err.code === 'ENOENT') return new DockerFailure('Docker ist nicht installiert (Programm fehlt).', '', false);
  if (/Cannot connect to the Docker daemon|Is the docker daemon running|permission denied while trying to connect/i.test(text)) {
    return new DockerFailure('Docker läuft nicht oder ist nicht erreichbar.', text, false);
  }
  if (err.killed) return new DockerFailure(`Docker antwortet nicht (${sub}, Zeitüberschreitung).`, text, false);
  const notFound = /No such (container|object|network|image)|network \S+ not found/i.test(text);
  return new DockerFailure(`Docker-Fehler bei „${sub}“: ${firstLine(text) || 'unbekannt'}`, text, notFound);
}

/** Docker-CLI. `binary` mit Endung .js/.cjs/.mjs (nur Tests) läuft über dieses Node. */
export class Docker {
  constructor(readonly binary: string) {}

  private command(args: readonly string[]): [string, string[]] {
    if (/\.(c|m)?js$/i.test(this.binary)) return [process.execPath, [this.binary, ...args]];
    return [this.binary, [...args]];
  }

  run(args: readonly string[], timeoutMs = 60_000, maxBuffer = 16 * 1024 * 1024): Promise<{ stdout: string; stderr: string }> {
    assertArgs(args);
    const [file, argv] = this.command(args);
    return new Promise((resolve, reject) => {
      execFile(
        file,
        argv,
        { timeout: timeoutMs, maxBuffer, windowsHide: true, encoding: 'utf8', killSignal: 'SIGKILL', shell: false },
        (err, stdout, stderr) => {
          if (err) reject(dockerError(err as NodeJS.ErrnoException & { killed?: boolean }, String(stderr), args[0] ?? 'docker'));
          else resolve({ stdout: String(stdout), stderr: String(stderr) });
        },
      );
    });
  }

  spawn(args: readonly string[], stdio: StdioOptions): ChildProcess {
    assertArgs(args);
    const [file, argv] = this.command(args);
    return spawn(file, argv, { stdio, windowsHide: true, shell: false });
  }
}
