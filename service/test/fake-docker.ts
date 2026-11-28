// Nachgebautes Docker-Programm für die Tests des Welten-Wächters – nie echtes Docker. Aufruf wie docker:
//   node fake-docker.js <befehl> …
// Zustand im Ordner FAKE_DOCKER_DIR: calls.jsonl (jede Befehlszeile als JSON-Liste), containers/<name>.json, .log
// (Ausgaben des „Servers“) und .stdin (an die Konsole geschickte Zeilen).
//   run      legt einen laufenden Container an (Port belegt? FAKE_DOCKER_BUSY_PORTS=31000,31001)
//   attach   liest Zeilen von stdin: „stop“ beendet den Container (außer FAKE_DOCKER_IGNORE_STOP=1), „save-all flush“
//            antwortet „Saved the game“, „say x“ → „[Server] x“; beim ersten Anhängen „Starting …“ und „Done (…)!“
//   wait, logs, ps, inspect, stats, stop, kill, rm, network, image, pull: passende Antworten
// FAKE_DOCKER_DOWN=1: tut so, als liefe der Docker-Daemon nicht.
// Schalter stehen auch in FAKE_DOCKER_DIR/env.json (die Tests ändern sie dort, ohne die Umgebung des Testprozesses).
import fs from 'node:fs';
import path from 'node:path';

interface Container {
  name: string;
  status: 'running' | 'exited' | 'created';
  labels: Record<string, string>;
  args: string[];
  fresh: boolean;
}

const dir = process.env.FAKE_DOCKER_DIR ?? '';
const containersDir = path.join(dir, 'containers');
const args = process.argv.slice(2);

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function file(name: string, ext = 'json'): string {
  return path.join(containersDir, `${name}.${ext}`);
}

function load(name: string): Container | null {
  for (let i = 0; i < 50; i++) {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8')) as Container;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      sleep(10);
    }
  }
  return null;
}

function save(container: Container): void {
  for (let i = 0; i < 50; i++) {
    try {
      fs.writeFileSync(file(container.name), JSON.stringify(container));
      return;
    } catch {
      sleep(10);
    }
  }
}

function all(): Container[] {
  return fs
    .readdirSync(containersDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => load(name.slice(0, -5)))
    .filter((c): c is Container => c !== null);
}

/** Schalter frisch aus env.json (die Konsole läuft lange; Tests ändern Schalter zwischendurch). */
function currentFlag(name: string): string | undefined {
  try {
    return (JSON.parse(fs.readFileSync(path.join(dir, 'env.json'), 'utf8')) as Record<string, string>)[name];
  } catch {
    return process.env[name];
  }
}

function logLine(name: string, line: string): void {
  fs.appendFileSync(file(name, 'log'), `${line}\n`);
}

if (!dir) fail('FAKE_DOCKER_DIR fehlt', 2);
fs.mkdirSync(containersDir, { recursive: true });
try {
  Object.assign(process.env, JSON.parse(fs.readFileSync(path.join(dir, 'env.json'), 'utf8')) as Record<string, string>);
} catch {
  // keine Schalter
}
fs.appendFileSync(path.join(dir, 'calls.jsonl'), `${JSON.stringify(args)}\n`);
if (process.env.FAKE_DOCKER_DOWN === '1') {
  fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?');
}

const VALUE_FLAGS = new Set([
  '--name',
  '--label',
  '--user',
  '--memory',
  '--memory-swap',
  '--cpus',
  '--pids-limit',
  '--cap-drop',
  '--security-opt',
  '--tmpfs',
  '--network',
  '--publish',
  '--restart',
  '--log-driver',
  '--log-opt',
  '--mount',
  '--workdir',
  '--env',
  '--entrypoint',
]);
const BOOL_FLAGS = new Set(['--detach', '--interactive', '--read-only']);

function run(rest: string[]): void {
  let name = '';
  const labels: Record<string, string> = {};
  let publish = '';
  let i = 0;
  for (; i < rest.length; i++) {
    const arg = rest[i]!;
    if (BOOL_FLAGS.has(arg)) continue;
    if (!VALUE_FLAGS.has(arg)) break;
    const value = rest[++i] ?? '';
    if (arg === '--name') name = value;
    if (arg === '--label') {
      const [key, ...v] = value.split('=');
      labels[key!] = v.join('=');
    }
    if (arg === '--publish') publish = value;
  }
  if (!name) fail('fake-docker: --name fehlt', 2);
  if (load(name)) fail(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use.`, 125);
  const port = publish.split(':')[1] ?? '';
  const busy = (process.env.FAKE_DOCKER_BUSY_PORTS ?? '').split(',');
  if (busy.includes(port)) {
    save({ name, status: 'created', labels, args: rest, fresh: true });
    fail(`docker: Error response from daemon: driver failed programming external connectivity: Bind for 127.0.0.1:${port} failed: port is already allocated.`, 125);
  }
  save({ name, status: 'running', labels, args: rest, fresh: true });
  process.stdout.write(`${'f'.repeat(64)}\n`);
}

function labelsMap(c: Container): string {
  return `map[${Object.keys(c.labels)
    .sort()
    .map((k) => `${k}:${c.labels[k]}`)
    .join(' ')}]`;
}

function attach(name: string): void {
  const c = load(name);
  if (!c) fail(`Error: No such container: ${name}`);
  if (c.status !== 'running') fail('You cannot attach to a stopped container, start it first');
  const emit = (line: string) => {
    process.stdout.write(`${line}\n`);
    logLine(name, line);
  };
  if (c.fresh) {
    c.fresh = false;
    save(c);
    emit('[12:00:00 INFO]: Starting minecraft server version 26.3');
    setTimeout(() => emit('[12:00:01 INFO]: Done (1.234s)! For help, type "help"'), Number(process.env.FAKE_DOCKER_READY_MS ?? 50));
  }
  let buffer = '';
  const handle = (line: string) => {
    fs.appendFileSync(file(name, 'stdin'), `${line}\n`);
    if (line === 'stop') {
      if (currentFlag('FAKE_DOCKER_IGNORE_STOP') === '1') {
        emit('[12:00:02 INFO]: (stop wird ignoriert)');
        return;
      }
      emit('[12:00:02 INFO]: Stopping the server');
      const current = load(name);
      if (current) save({ ...current, status: 'exited' });
      setTimeout(() => process.exit(0), 20);
      return;
    }
    if (line === 'save-all flush') {
      emit('[12:00:02 INFO]: Saving the game (this may take a moment!)');
      emit('[12:00:02 INFO]: Saved the game');
      return;
    }
    if (line.startsWith('say ')) {
      emit(`[12:00:02 INFO]: [Server] ${line.slice(4)}`);
      return;
    }
    emit(`[12:00:02 INFO]: > ${line}`);
  };
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      handle(line);
    }
  });
  setInterval(() => {
    const current = load(name);
    if (!current || current.status !== 'running') process.exit(0);
  }, 100);
}

function waitFor(name: string): void {
  const tick = () => {
    const c = load(name);
    if (!c) fail(`Error response from daemon: No such container: ${name}`);
    if (c.status !== 'running') {
      process.stdout.write('0\n');
      process.exit(0);
    }
    setTimeout(tick, 50);
  };
  tick();
}

const [command, ...rest] = args;
const last = rest[rest.length - 1] ?? '';
switch (command) {
  case 'version':
    process.stdout.write('27.5.1\n');
    break;
  case 'network': {
    const marker = path.join(dir, 'network.json');
    if (rest[0] === 'inspect') {
      if (!fs.existsSync(marker)) fail(`Error response from daemon: network ${last} not found`);
      process.stdout.write(`${last}\n`);
    } else if (rest[0] === 'create') {
      if (fs.existsSync(marker)) fail(`Error response from daemon: network with name ${last} already exists`);
      fs.writeFileSync(marker, JSON.stringify(rest));
      process.stdout.write(`${'a'.repeat(64)}\n`);
    } else fail('fake-docker: network?', 2);
    break;
  }
  case 'image':
    process.stdout.write('sha256:fake\n');
    break;
  case 'pull':
    process.stdout.write('ok\n');
    break;
  case 'run':
    run(rest);
    break;
  case 'inspect': {
    const c = load(last);
    if (!c) fail(`Error: No such object: ${last}`);
    process.stdout.write(`${c.status}|${labelsMap(c)}\n`);
    break;
  }
  case 'ps': {
    const showAll = rest.includes('--all');
    for (const c of all()) {
      if (!showAll && c.status !== 'running') continue;
      const labels = Object.keys(c.labels)
        .sort()
        .map((k) => `${k}=${c.labels[k]}`)
        .join(',');
      process.stdout.write(`${c.name}|${labels}\n`);
    }
    break;
  }
  case 'attach':
    attach(last);
    break;
  case 'logs': {
    if (!load(last)) fail(`Error response from daemon: No such container: ${last}`);
    const tail = Number(rest[rest.indexOf('--tail') + 1] ?? 100);
    const lines = fs.existsSync(file(last, 'log')) ? fs.readFileSync(file(last, 'log'), 'utf8').split('\n').filter(Boolean) : [];
    for (const line of lines.slice(-tail)) process.stdout.write(`${line}\n`);
    break;
  }
  case 'wait':
    waitFor(last);
    break;
  case 'stop':
  case 'kill': {
    const c = load(last);
    if (!c) fail(`Error response from daemon: No such container: ${last}`);
    save({ ...c, status: 'exited' });
    process.stdout.write(`${last}\n`);
    break;
  }
  case 'rm': {
    if (!load(last)) fail(`Error response from daemon: No such container: ${last}`);
    for (const ext of ['json', 'log', 'stdin']) fs.rmSync(file(last, ext), { force: true });
    process.stdout.write(`${last}\n`);
    break;
  }
  case 'stats':
    process.stdout.write('812.5MiB / 3GiB|37.52%\n');
    break;
  default:
    fail(`fake-docker: unbekannter Befehl ${command}`, 2);
}
