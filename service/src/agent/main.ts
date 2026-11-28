// Welten-Wächter (heldix-welten-agent): eigener Prozess mit Docker-Zugriff für die dauerhaften Welten. Der Dienst
// selbst hat keinen Docker-Zugriff und spricht nur über den Socket mit ihm (siehe protocol.ts).
//
//   node dist/agent/main.js          Wächter starten (systemd-Unit heldix-welten-agent, Einstellungen: config.ts)
//   node dist/agent/main.js pull     Image der Welt-Container laden (Installer)
//   node dist/agent/main.js image    Image mit Digest ausgeben
//   node dist/agent/main.js plaetze  Plätze aus dem RAM ausgeben ((RAM − 6 GB) / 3 GB)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { configFromEnv, DEFAULT_DOCKER, defaultMaxRunning } from './config';
import { assertArgs } from './docker';
import { DockerRunner } from './docker-runner';
import { WORLD_IMAGE } from './image';
import { startAgentServer } from './server';

function version(): string {
  try {
    return (JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string }).version ?? 'unbekannt';
  } catch {
    return 'unbekannt';
  }
}

function log(line: string): void {
  console.log(`[welten] ${line}`);
}

async function main(argv: string[]): Promise<number | null> {
  const command = argv[0] ?? 'run';
  if (command === 'image') {
    console.log(WORLD_IMAGE);
    return 0;
  }
  if (command === 'plaetze') {
    console.log(String(defaultMaxRunning()));
    return 0;
  }
  if (command === 'pull') {
    const docker = process.env.HELDIX_WELTEN_DOCKER?.trim() || DEFAULT_DOCKER;
    const args = ['pull', WORLD_IMAGE];
    assertArgs(args);
    return new Promise((resolve) => {
      const child = spawn(docker, args, { stdio: 'inherit', shell: false });
      child.on('error', (err) => {
        console.error(`Docker lässt sich nicht starten: ${err.message}`);
        resolve(1);
      });
      child.on('close', (code) => resolve(code ?? 1));
    });
  }
  if (command !== 'run') {
    console.error('Aufruf: node dist/agent/main.js [run|pull|image|plaetze]');
    return 2;
  }
  const config = configFromEnv(process.env);
  if (process.platform === 'linux' && config.owner === null) {
    log('Achtung: Der Wächter läuft nicht als root – die Weltdaten gehören dann ihm statt 1000:1000 (der Container läuft als 1000).');
  }
  const runner = new DockerRunner({ ...config, log }, version());
  await runner.init();
  const server = await startAgentServer(runner, { socketPath: config.socketPath, socketGid: config.socketGid, log });
  log(
    `Welten-Wächter ${runner.version} lauscht auf ${config.socketPath} – höchstens ${config.maxRunning} Welten gleichzeitig, ` +
      `EULA ${config.acceptEula ? 'zugestimmt' : 'NICHT zugestimmt (keine Welt startet)'}, Image ${WORLD_IMAGE}`,
  );
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    // Die Welten laufen weiter; nur die Verbindungen und die Konsolen-Prozesse enden
    void server
      .close()
      .then(() => runner.close())
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return null;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (code !== null) process.exitCode = code;
    },
    (err: unknown) => {
      console.error(`Welten-Wächter: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
