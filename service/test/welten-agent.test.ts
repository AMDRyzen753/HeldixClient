// Welten-Wächter mit Fake-Docker: feste Container-Grenzen, nichts Freies kommt durch (Pfade, Images, Befehle,
// Shell-Zeichen), Socket-Protokoll (Anfragen, Fehler, follow/unfollow), Lebenszyklus über den echten AgentRunner,
// Plugins mit SHA-512 (nachgebauter Download-Server, nie das echte Modrinth/PaperMC), EULA, Plätze, Wiederverbinden.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { describe, test } from 'node:test';
import { cleanLogLine, parseDockerSize } from '../src/agent/docker-runner';
import { CONTAINER_LIMITS, JAVA_BIN, runArgs } from '../src/agent/docker';
import { AgentError } from '../src/agent/errors';
import { WORLD_IMAGE, WORLD_IMAGE_DIGEST } from '../src/agent/image';
import { disableConnectionThrottle, formatProperties, mergeProperties, parseProperties } from '../src/agent/properties';
import { AgentRunner } from '../src/hosting/agent-runner';
import { agentFixture, modrinthPlugin, paperJar, socketPathFor, vanillaJar, waitFor, worldId, type AgentFixture } from './welten-helpers';
import { png } from './zip-builder';

const MOTD = '§6Heldix§r Welt\n§7über HeldixClient';

/** Paare „--flag wert“ aus den Argumenten von docker run (bis zum Image). */
function flagPairs(args: string[]): [string, string | null][] {
  const pairs: [string, string | null][] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === WORLD_IMAGE) break;
    if (['--detach', '--interactive', '--read-only'].includes(arg)) pairs.push([arg, null]);
    else pairs.push([arg, args[++i]!]);
  }
  return pairs;
}

async function prepared(fixture: AgentFixture, world = worldId()): Promise<string> {
  await fixture.client.prepare(world, { jar: paperJar(fixture), memoryMb: 3072, properties: { difficulty: 'hard', 'max-players': '10' }, motd: MOTD });
  return world;
}

/** Rohe Verbindung zum Wächter: Zeile senden, Antworten lesen. */
async function rawClient(socketPath: string): Promise<{ send(obj: unknown): void; sendRaw(text: string): void; next(predicate?: (m: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>; close(): void }> {
  const socket = net.createConnection(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const queue: Record<string, unknown>[] = [];
  const waiters: (() => void)[] = [];
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (let i = buffer.indexOf('\n'); i !== -1; i = buffer.indexOf('\n')) {
      queue.push(JSON.parse(buffer.slice(0, i)) as Record<string, unknown>);
      buffer = buffer.slice(i + 1);
      for (const w of waiters.splice(0)) w();
    }
  });
  return {
    send: (obj) => socket.write(`${JSON.stringify(obj)}\n`),
    sendRaw: (text) => socket.write(text),
    async next(predicate = () => true) {
      const until = Date.now() + 8000;
      for (;;) {
        const index = queue.findIndex(predicate);
        if (index !== -1) return queue.splice(index, 1)[0]!;
        if (Date.now() > until) assert.fail('keine passende Antwort vom Wächter');
        await new Promise<void>((resolve) => {
          waiters.push(resolve);
          setTimeout(resolve, 100);
        });
      }
    },
    close: () => socket.destroy(),
  };
}

describe('docker run: feste Grenzen', () => {
  test('genau die vorgeschriebenen Grenzen, festes Image mit Digest, fester Befehl', () => {
    const world = 'a'.repeat(32);
    const args = runArgs({ world, port: 31234, memoryMb: 3072, jarFile: `paper-${'b'.repeat(64)}.jar`, dataDir: '/var/lib/heldix-welten/worlds/x/data', jarsDir: '/var/lib/heldix-welten/jars' });
    assert.equal(args[0], 'run');
    const pairs = flagPairs(args);
    const expected: [string, string | null][] = [
      ['--detach', null],
      ['--interactive', null],
      ['--name', `heldix-welt-${world}`],
      ['--label', `heldix.world=${world}`],
      ['--label', 'heldix.port=31234'],
      ['--user', '1000:1000'],
      ['--memory', '3072m'],
      ['--memory-swap', '3072m'],
      ['--cpus', '2'],
      ['--pids-limit', '512'],
      ['--cap-drop', 'ALL'],
      ['--security-opt', 'no-new-privileges'],
      ['--read-only', null],
      ['--tmpfs', CONTAINER_LIMITS.tmpfs],
      ['--network', 'heldix-welten'],
      ['--publish', '127.0.0.1:31234:25565/tcp'],
      ['--restart', 'no'],
      ['--log-driver', 'json-file'],
      ['--log-opt', 'max-size=10m'],
      ['--log-opt', 'max-file=3'],
      ['--mount', 'type=bind,source=/var/lib/heldix-welten/worlds/x/data,target=/data'],
      ['--mount', 'type=bind,source=/var/lib/heldix-welten/jars,target=/jars,readonly'],
      ['--workdir', '/data'],
      ['--env', 'HOME=/tmp'],
      ['--entrypoint', JAVA_BIN],
    ];
    assert.deepEqual(pairs, expected);
    assert.match(WORLD_IMAGE, /^eclipse-temurin:25-jre@sha256:[0-9a-f]{64}$/);
    assert.equal(WORLD_IMAGE_DIGEST, WORLD_IMAGE.split('@')[1]);
    const command = args.slice(args.indexOf(WORLD_IMAGE) + 1);
    assert.deepEqual(command.slice(0, 2), ['-Xms2560m', '-Xmx2560m']);
    assert.deepEqual(command.slice(-3), ['-jar', `/jars/paper-${'b'.repeat(64)}.jar`, '--nogui']);
    // kein Argument mit Leerzeichen oder Steuerzeichen, nichts außer 127.0.0.1 veröffentlicht
    for (const arg of args) assert.match(arg, /^[\x21-\x7e]+$/);
    assert.equal(args.filter((a) => a === '--publish').length, 1);
    assert.ok(!args.includes('--privileged') && !args.includes('--cap-add'));
  });

  test('lehnt ungültige Werte ab (Welt-ID, Jar, Pfad mit Komma)', () => {
    const base = { world: 'a'.repeat(32), port: 31000, memoryMb: 3072, jarFile: `paper-${'b'.repeat(64)}.jar`, dataDir: '/d', jarsDir: '/j' };
    assert.throws(() => runArgs({ ...base, world: '../../etc' }), AgentError);
    assert.throws(() => runArgs({ ...base, jarFile: 'evil.jar' }), AgentError);
    assert.throws(() => runArgs({ ...base, dataDir: '/d,target=/etc' }), AgentError);
    assert.throws(() => runArgs({ ...base, port: 80 }), AgentError);
    assert.throws(() => runArgs({ ...base, memoryMb: 999_999 }), AgentError);
  });
});

describe('Hilfen', () => {
  test('server.properties: feste Schlüssel, Escapes, Fortsetzungszeilen', () => {
    const existing = parseProperties('#x\nenable-rcon=true\nrcon.password=geheim\nonline-mode=false\nfoo=bar\\\n  baz\nmotd=alt\nweird\\=key=1\n');
    assert.equal(existing.get('foo'), 'barbaz');
    const merged = mergeProperties(existing, { difficulty: 'hard', 'level-seed': 'Hallo = Welt! #1' }, MOTD);
    const text = formatProperties(merged);
    const back = parseProperties(text);
    assert.equal(back.get('online-mode'), 'true');
    assert.equal(back.get('enable-rcon'), 'false');
    assert.equal(back.get('rcon.password'), '');
    assert.equal(back.get('server-port'), '25565');
    assert.equal(back.get('log-ips'), 'false');
    assert.equal(back.get('motd'), MOTD);
    assert.equal(back.get('level-seed'), 'Hallo = Welt! #1');
    assert.match(text, /^motd=\\u00a76Heldix\\u00a7r Welt\\n\\u00a77\\u00fcber HeldixClient$/m);
    assert.ok(!text.includes('geheim'));
  });

  test('bukkit.yml: nur connection-throttle wird -1, der Rest bleibt', () => {
    assert.equal(disableConnectionThrottle(null), 'settings:\n  connection-throttle: -1\n');
    const bukkit = [
      '# Bukkit',
      'settings:',
      '  allow-end: true',
      '  # Drossel',
      '  connection-throttle: 4000',
      '  query-plugins: true',
      'spawn-limits:',
      '  monsters: 70',
      '  connection-throttle: 99',
      '',
    ].join('\n');
    const changed = disableConnectionThrottle(bukkit);
    assert.equal(changed, bukkit.replace('  connection-throttle: 4000', '  connection-throttle: -1'));
    assert.equal(disableConnectionThrottle(changed), changed);
    // ohne den Schlüssel: unter settings einfügen (mit dessen Einrückung)
    assert.equal(disableConnectionThrottle('settings:\n    allow-end: false\nticks-per:\n  animal-spawns: 400\n'), 'settings:\n    connection-throttle: -1\n    allow-end: false\nticks-per:\n  animal-spawns: 400\n');
    // ohne settings: anhängen
    assert.equal(disableConnectionThrottle('aliases: now-in-commands.yml'), 'aliases: now-in-commands.yml\nsettings:\n  connection-throttle: -1\n');
  });

  test('docker stats und Log-Zeilen', () => {
    assert.equal(parseDockerSize('812.5MiB'), 812.5 * 1024 * 1024);
    assert.equal(parseDockerSize('3GiB'), 3 * 1024 ** 3);
    assert.equal(parseDockerSize('12kB'), 12_000);
    assert.equal(parseDockerSize('--'), 0);
    assert.equal(cleanLogLine('\u001b[32mgrün\u001b[0m\u0007 ok\ttab'), 'grün ok\ttab');
  });
});

describe('Socket-Protokoll', () => {
  test('nichts Freies kommt durch: Welt-IDs, Felder, Pfade, Images, Befehle, Adressen', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      const raw = await rawClient(f.socketPath);
      let n = 100;
      const expectError = async (request: Record<string, unknown>, pattern: RegExp) => {
        const id = n++;
        raw.send({ id, ...request });
        const answer = await raw.next((m) => m.id === id);
        assert.equal(answer.ok, false, JSON.stringify(request));
        assert.match(String(answer.error), pattern, JSON.stringify(request));
      };
      raw.sendRaw('das ist kein json\n');
      assert.match(String((await raw.next((m) => m.id === null)).error), /kein JSON/);
      await expectError({ op: 'exec', world, args: {} }, /Unbekannte Operation/);
      for (const bad of ['A'.repeat(32), 'a'.repeat(31), '../../etc/passwd', `${'a'.repeat(31)};`, `${world}\n`]) {
        await expectError({ op: 'state', world: bad, args: {} }, /Ungültige Welt-ID/);
      }
      await expectError({ op: 'state', args: {} }, /Ungültige Welt-ID/);
      await expectError({ op: 'start', world, args: { image: 'alpine:latest' } }, /unbekanntes Feld „image“/);
      await expectError({ op: 'start', world, args: { cmd: ['sh', '-c', 'id'] } }, /unbekanntes Feld/);
      await expectError({ op: 'state', world, args: {}, shell: '/bin/sh' }, /unbekanntes Feld „shell“/);
      await expectError({ op: 'list', world, args: {} }, /ohne Welt/);
      await expectError({ op: 'command', world, args: { line: 'say a\nop jemand' } }, /Steuerzeichen/);
      await expectError({ op: 'command', world, args: { line: 'say \u0007' } }, /Steuerzeichen/);
      await expectError({ op: 'command', world, args: { line: 'x'.repeat(257) } }, /1 bis 256/);
      await expectError({ op: 'command', world, args: { line: 42 } }, /Text erwartet/);
      await expectError({ op: 'command', world, args: { line: 'say hallo' } }, /läuft gerade nicht/);
      for (const url of [
        'https://evil.example/data/AbCd1234/versions/Ef12/x.jar',
        'http://cdn.modrinth.com/data/AbCd1234/versions/Ef12/x.jar',
        'https://cdn.modrinth.com:8443/data/AbCd1234/versions/Ef12/x.jar',
        'https://user:pw@cdn.modrinth.com/data/AbCd1234/versions/Ef12/x.jar',
        'https://cdn.modrinth.com/data/AbCd1234/versions/Ef12/x.jar?x=1',
        'https://cdn.modrinth.com/../../etc/passwd',
        'https://cdn.modrinth.com.evil.example/data/AbCd1234/versions/Ef12/x.jar',
      ]) {
        await expectError({ op: 'installPlugin', world, args: { name: 'x.jar', url, sha512: 'a'.repeat(128) } }, /Plugin|modrinth/i);
      }
      for (const name of ['../x.jar', '.hidden.jar', 'x.sh', 'x.jar/../../y.jar', 'a b.jar']) {
        await expectError({ op: 'installPlugin', world, args: { name, url: 'https://cdn.modrinth.com/data/AbCd1234/versions/Ef12/x.jar', sha512: 'a'.repeat(128) } }, /Plugin-Dateiname/);
      }
      await expectError({ op: 'installPlugin', world, args: { name: 'x.jar', url: 'https://cdn.modrinth.com/data/AbCd1234/versions/Ef12/x.jar', sha512: 'zz' } }, /SHA-512/);
      for (const p of ['../server.properties', '/etc/passwd', 'plugins/../../x.yml', 'plugins/x.jar', 'plugins/.paper-remapped/a.yml', 'C:/x.yml', 'plugins\\x.yml', 'plugins/a/./b.yml']) {
        await expectError({ op: 'readFile', world, args: { path: p } }, /Dateipfad|Textdateien|Pfad/);
      }
      const outside = path.join(f.root, 'anderswo', 'x.zip');
      for (const zipPath of [outside, 'x.zip', path.join(f.uploadsDir, '..', 'x.zip'), `${f.uploadsDir}${path.sep}a${path.sep}..${path.sep}x.zip`, path.join(f.uploadsDir, '.versteckt.zip'), f.uploadsDir]) {
        await expectError({ op: 'importWorld', world, args: { zipPath } }, /Upload|Pfad|Name/);
      }
      await expectError({ op: 'exportBackup', world, args: { name: '../../x', zipPath: path.join(f.uploadsDir, 'x.zip') } }, /Name der Sicherung/);
      const jar = paperJar(f);
      await expectError({ op: 'prepare', world, args: { jar: { ...jar, url: 'https://github.com/x/paper.jar' }, memoryMb: 3072, properties: {}, motd: 'x' } }, /Paper nur von/);
      await expectError({ op: 'prepare', world, args: { jar: { ...jar, url: 'https://fill-data.papermc.io.evil.example/v1/objects/x/p.jar' }, memoryMb: 3072, properties: {}, motd: 'x' } }, /Paper nur von/);
      await expectError({ op: 'prepare', world, args: { jar, memoryMb: 3072, properties: { motd: 'x' }, motd: 'x' } }, /unbekanntes Feld „motd“/);
      await expectError({ op: 'prepare', world, args: { jar, memoryMb: 3072, properties: { 'enable-rcon': 'true' }, motd: 'x' } }, /unbekanntes Feld „enable-rcon“/);
      await expectError({ op: 'prepare', world, args: { jar, memoryMb: 3072, properties: { difficulty: 'hard\nonline-mode=false' }, motd: 'x' } }, /ungültiger Wert/);
      await expectError({ op: 'prepare', world, args: { jar, memoryMb: 999_999, properties: {}, motd: 'x' } }, /Arbeitsspeicher/);
      await expectError({ op: 'prepare', world, args: { jar, memoryMb: 3072, properties: {}, motd: 'a\nb\nc' } }, /MOTD/);
      await expectError({ op: 'prepare', world, args: { jar, memoryMb: 3072, properties: {}, motd: 'x', image: 'evil' } }, /unbekanntes Feld/);
      raw.close();
      // Nichts davon hat einen Container gestartet, und kein freier Text steht in einem Docker-Aufruf
      const calls = f.calls();
      assert.equal(calls.filter((c) => c[0] === 'run').length, 0);
      const flat = calls.flat().join(' ');
      for (const needle of ['alpine', 'evil', 'passwd', 'op jemand', 'sh -c', '/bin/sh', 'github']) assert.ok(!flat.includes(needle), needle);
    } finally {
      await f.close();
    }
  });

  test('follow/unfollow über die rohe Verbindung; Abo endet mit der Verbindung', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      await f.client.start(world);
      await waitFor(async () => (await f.client.state(world)) === 'running', 8000, 'Welt läuft');
      const raw = await rawClient(f.socketPath);
      raw.send({ id: 1, op: 'follow', world, args: {} });
      assert.deepEqual(await raw.next((m) => m.id === 1 && 'ok' in m), { id: 1, ok: true, result: null });
      await f.client.command(world, 'say eins');
      assert.match(String((await raw.next((m) => m.id === 1 && typeof m.line === 'string' && String(m.line).includes('eins'))).line), /\[Server\] eins/);
      raw.send({ id: 2, op: 'unfollow', world, args: { follow: 1 } });
      assert.equal((await raw.next((m) => m.id === 2)).ok, true);
      await f.client.command(world, 'say zwei');
      raw.send({ id: 3, op: 'hello', args: {} });
      const hello = await raw.next((m) => m.id === 3);
      assert.deepEqual(hello.result, { protocol: 1, version: '1.13.0-test', maxRunning: 4, eula: true, image: WORLD_IMAGE });
      await new Promise((resolve) => setTimeout(resolve, 300));
      raw.send({ id: 4, op: 'state', world, args: {} });
      await raw.next((m) => m.id === 4);
      // nach unfollow keine Zeile mehr mit „zwei“
      await assert.rejects(
        Promise.race([raw.next((m) => typeof m.line === 'string' && String(m.line).includes('zwei')), new Promise((_, reject) => setTimeout(() => reject(new Error('keine')), 400))]),
        /keine/,
      );
      raw.close();
      await f.client.stop(world);
    } finally {
      await f.close();
    }
  });

  test('zu lange Anfrage beendet die Verbindung', async () => {
    const f = await agentFixture();
    try {
      const raw = await rawClient(f.socketPath);
      raw.sendRaw('x'.repeat(5 * 1024 * 1024));
      const answer = await raw.next((m) => m.id === null);
      assert.equal(answer.code, 'too-large');
      raw.close();
    } finally {
      await f.close();
    }
  });
});

describe('Lebenszyklus über AgentRunner', () => {
  test('prepare, start, Konsole, Log, stats, Datei bei laufender Welt, stop', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      const data = f.dataOf(world);
      const properties = parseProperties(fs.readFileSync(path.join(data, 'server.properties'), 'utf8'));
      assert.equal(properties.get('online-mode'), 'true');
      assert.equal(properties.get('server-port'), '25565');
      assert.equal(properties.get('enable-rcon'), 'false');
      assert.equal(properties.get('difficulty'), 'hard');
      assert.equal(properties.get('max-players'), '10');
      assert.equal(properties.get('motd'), MOTD);
      assert.match(fs.readFileSync(path.join(data, 'eula.txt'), 'utf8'), /^eula=true$/m);
      // Verbindungsdrossel aus (alle Spieler kommen über das Relay von derselben Adresse)
      assert.equal(fs.readFileSync(path.join(data, 'bukkit.yml'), 'utf8'), 'settings:\n  connection-throttle: -1\n');
      assert.equal(fs.readdirSync(path.join(fs.realpathSync(f.dataDir), 'jars')).filter((n) => n.startsWith('paper-')).length, 1);
      assert.equal(await f.client.state(world), 'stopped');
      assert.equal(await f.client.port(world), null);
      // Bukkit hat beim ersten Start seine Vorgaben geschrieben (Drossel 4000): vor dem nächsten Start wieder -1, Rest bleibt
      fs.writeFileSync(path.join(data, 'bukkit.yml'), 'settings:\n  allow-end: false\n  connection-throttle: 4000\naliases: now-in-commands.yml\n');

      const lines: string[] = [];
      const unfollow = f.client.followLogs(world, (line) => lines.push(line));
      const { port } = await f.client.start(world);
      assert.ok(port >= 31000 && port <= 31999);
      await waitFor(async () => (await f.client.state(world)) === 'running', 8000, 'Welt läuft');
      assert.deepEqual(await f.client.start(world), { port });
      assert.equal(await f.client.port(world), port);
      assert.equal(fs.readFileSync(path.join(data, 'bukkit.yml'), 'utf8'), 'settings:\n  allow-end: false\n  connection-throttle: -1\naliases: now-in-commands.yml\n');
      const runs = f.calls().filter((c) => c[0] === 'run');
      assert.equal(runs.length, 1);
      const pairs = flagPairs(runs[0]!);
      for (const pair of [
        ['--memory', '3072m'],
        ['--memory-swap', '3072m'],
        ['--cpus', '2'],
        ['--pids-limit', '512'],
        ['--cap-drop', 'ALL'],
        ['--security-opt', 'no-new-privileges'],
        ['--user', '1000:1000'],
        ['--network', 'heldix-welten'],
        ['--publish', `127.0.0.1:${port}:25565/tcp`],
        ['--restart', 'no'],
        ['--mount', `type=bind,source=${data},target=/data`],
      ]) {
        assert.ok(pairs.some(([k, v]) => k === pair[0] && v === pair[1]), pair.join(' '));
      }
      assert.ok(runs[0]!.includes(WORLD_IMAGE));
      // Netz angelegt (getrennte Container)
      const network = JSON.parse(fs.readFileSync(path.join(f.dockerDir, 'network.json'), 'utf8')) as string[];
      assert.ok(network.includes('com.docker.network.bridge.enable_icc=false'));

      // Konsole: Shell-Zeichen gehen als eine Zeile an den Server, nie in eine Befehlszeile
      const sneaky = 'say Hallo; rm -rf / && echo $(id) `whoami` | tee x';
      await f.client.command(world, sneaky);
      await waitFor(() => lines.some((l) => l.includes('[Server] Hallo; rm -rf /')), 5000, 'Zeile im Log');
      const stdin = fs.readFileSync(path.join(f.dockerDir, 'containers', `heldix-welt-${world}.stdin`), 'utf8');
      assert.ok(stdin.split('\n').includes(sneaky));
      assert.ok(!f.calls().flat().some((arg) => arg.includes('Hallo') || arg.includes('whoami')));
      assert.ok(lines.some((l) => /Done \(/.test(l)));
      const recent = await f.client.recentLogs(world, 50);
      assert.ok(recent.some((l) => /Done \(/.test(l)));
      assert.ok(recent.length <= 50);

      const stats = await f.client.stats(world);
      assert.equal(stats.memoryMb, 813);
      assert.equal(stats.cpuPercent, 37.5);
      assert.ok(stats.diskMb >= 0);

      // Plugin-Datei bei laufender Welt: erst gemerkt, nach dem Anhalten im Datenordner
      fs.mkdirSync(path.join(data, 'plugins', 'Essentials'), { recursive: true });
      fs.writeFileSync(path.join(data, 'plugins', 'Essentials', 'config.yml'), 'alt: 1\n');
      await f.client.writeFile(world, 'plugins/Essentials/config.yml', 'neu: 2\n');
      assert.equal(await f.client.readFile(world, 'plugins/Essentials/config.yml'), 'neu: 2\n');
      assert.equal(await f.client.readFile(world, 'Essentials/config.yml'), 'neu: 2\n');
      assert.equal(fs.readFileSync(path.join(data, 'plugins', 'Essentials', 'config.yml'), 'utf8'), 'alt: 1\n');
      assert.deepEqual(await f.client.listFiles(world), ['plugins/Essentials/config.yml']);
      await assert.rejects(f.client.writeFile(world, 'plugins/Gibtsnicht/config.yml', 'x'), /Ordner/);
      await assert.rejects(f.client.importWorld(world, path.join(f.uploadsDir, 'welt.zip')), (err: AgentError) => err.code === 'running');

      unfollow();
      await f.client.stop(world);
      assert.equal(await f.client.state(world), 'stopped');
      assert.ok(fs.readFileSync(path.join(f.dockerDir, 'containers', `heldix-welt-${world}.stdin`), 'utf8').split('\n').includes('stop'));
      assert.equal(fs.readFileSync(path.join(data, 'plugins', 'Essentials', 'config.yml'), 'utf8'), 'neu: 2\n');
      assert.equal(await f.client.port(world), null);
      // nach dem Anhalten: Log noch abrufbar, stop noch einmal tut nichts
      assert.ok((await f.client.recentLogs(world, 5)).length > 0);
      await f.client.stop(world);
      assert.deepEqual(await f.client.list(), [world]);
      await f.client.remove(world);
      assert.equal(await f.client.state(world), 'missing');
      assert.ok(!fs.existsSync(path.join(fs.realpathSync(f.dataDir), 'worlds', world)));
      assert.ok(f.calls().some((c) => c[0] === 'rm' && c[1] === '--force'));
    } finally {
      await f.close();
    }
  });

  test('hält eine Welt hart an, wenn sie „stop“ ignoriert', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      await f.client.start(world);
      await waitFor(async () => (await f.client.state(world)) === 'running', 8000, 'Welt läuft');
      f.setFake({ FAKE_DOCKER_IGNORE_STOP: '1' });
      await f.client.stop(world, { timeoutMs: 1000 });
      assert.equal(await f.client.state(world), 'stopped');
      assert.ok(f.calls().some((c) => c[0] === 'stop' && c[1] === '-t' && c[2] === '10'));
    } finally {
      await f.close();
    }
  });

  test('belegter Port: nimmt einen anderen', async () => {
    const f = await agentFixture({ portMin: 31500, portMax: 31501 });
    try {
      const world = await prepared(f);
      f.setFake({ FAKE_DOCKER_BUSY_PORTS: '31500' });
      const { port } = await f.client.start(world);
      assert.equal(port, 31501);
      await f.client.stop(world);
    } finally {
      await f.close();
    }
  });

  test('Symbol für die Serverliste: nur PNG mit 64×64, landet als server-icon.png', async () => {
    const f = await agentFixture();
    try {
      const world = worldId();
      const icon = png(64, 64, 100);
      await f.client.prepare(world, { jar: paperJar(f), memoryMb: 3072, properties: {}, motd: 'x', iconPng: icon });
      assert.deepEqual(fs.readFileSync(path.join(f.dataOf(world), 'server-icon.png')), icon);
      await assert.rejects(f.client.prepare(world, { jar: paperJar(f), memoryMb: 3072, properties: {}, motd: 'x', iconPng: png(32, 32) }), /64×64/);
      await assert.rejects(f.client.prepare(world, { jar: paperJar(f), memoryMb: 3072, properties: {}, motd: 'x', iconPng: Buffer.from('kein png, nur text, aber lang genug für den kopf') }), /kein PNG/);
    } finally {
      await f.close();
    }
  });

  test('ohne EULA des Betreibers keine Welt', async () => {
    const f = await agentFixture({ acceptEula: false });
    try {
      await assert.rejects(
        f.client.prepare(worldId(), { jar: paperJar(f), memoryMb: 3072, properties: {}, motd: 'x' }),
        (err: AgentError) => err.code === 'eula' && /aka\.ms\/MinecraftEULA/.test(err.message),
      );
      assert.equal(f.calls().filter((c) => c[0] === 'run').length, 0);
    } finally {
      await f.close();
    }
  });

  test('alle Plätze belegt', async () => {
    const f = await agentFixture({ maxRunning: 1 });
    try {
      const a = await prepared(f);
      const b = await prepared(f);
      await f.client.start(a);
      await assert.rejects(f.client.start(b), (err: AgentError) => err.code === 'full' && err.message === 'Gerade sind alle Plätze belegt – versuch es in ein paar Minuten noch einmal.');
      await f.client.stop(a);
      await f.client.start(b);
      await f.client.stop(b);
    } finally {
      await f.close();
    }
  });

  test('Docker läuft nicht: verständlicher Fehler', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      f.setFake({ FAKE_DOCKER_DOWN: '1' });
      await assert.rejects(f.client.state(world), (err: AgentError) => err.code === 'docker' && /Docker läuft nicht/.test(err.message));
    } finally {
      await f.close();
    }
  });
});

describe('Plugins', () => {
  test('nur mit passender SHA-512; Sync vor dem Start entfernt fremde Jars', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      const good = modrinthPlugin(f, 'LuckPerms-5.4.jar');
      await f.client.installPlugin(world, good);
      assert.deepEqual(await f.client.listPlugins(world), ['LuckPerms-5.4.jar']);
      const data = f.dataOf(world);
      assert.ok(fs.existsSync(path.join(data, 'plugins', 'LuckPerms-5.4.jar')));

      const bad = modrinthPlugin(f, 'Boese.jar');
      await assert.rejects(f.client.installPlugin(world, { ...bad, sha512: 'f'.repeat(128) }), (err: AgentError) => err.code === 'download' && /Prüfsumme/.test(err.message));
      assert.deepEqual(await f.client.listPlugins(world), ['LuckPerms-5.4.jar']);
      assert.ok(!fs.existsSync(path.join(data, 'plugins', 'Boese.jar')));
      assert.deepEqual(fs.readdirSync(path.join(fs.realpathSync(f.dataDir), 'tmp')), []);
      // nie eine andere Adresse als die geprüfte gefragt
      assert.ok(f.downloads.requests.every((r) => r.startsWith('/cdn.modrinth.com/data/') || r.startsWith('/fill-data.papermc.io/v1/objects/')));

      // Ein Plugin im Container legt eine fremde Jar ab und verändert eine geprüfte: vor dem Start wieder sauber
      fs.writeFileSync(path.join(data, 'plugins', 'Fremd.jar'), 'x');
      fs.writeFileSync(path.join(data, 'plugins', 'LuckPerms-5.4.jar'), 'verändert');
      fs.mkdirSync(path.join(data, 'plugins', 'update'), { recursive: true });
      fs.writeFileSync(path.join(data, 'plugins', 'update', 'LuckPerms-5.4.jar'), 'x');
      await f.client.start(world);
      assert.ok(!fs.existsSync(path.join(data, 'plugins', 'Fremd.jar')));
      assert.ok(!fs.existsSync(path.join(data, 'plugins', 'update')));
      assert.notEqual(fs.readFileSync(path.join(data, 'plugins', 'LuckPerms-5.4.jar'), 'utf8'), 'verändert');

      // bei laufender Welt: nur im Speicher des Wächters, beim nächsten Start im Datenordner
      const second = modrinthPlugin(f, 'WorldEdit.jar');
      await f.client.installPlugin(world, second);
      assert.deepEqual(await f.client.listPlugins(world), ['LuckPerms-5.4.jar', 'WorldEdit.jar']);
      assert.ok(!fs.existsSync(path.join(data, 'plugins', 'WorldEdit.jar')));
      await f.client.removePlugin(world, 'LuckPerms-5.4.jar');
      await f.client.stop(world);
      await f.client.start(world);
      assert.deepEqual(fs.readdirSync(path.join(data, 'plugins')).filter((n) => n.endsWith('.jar')), ['WorldEdit.jar']);
      await f.client.stop(world);
      await f.client.removePlugin(world, 'gibtsnicht.jar');
    } finally {
      await f.close();
    }
  });

  test('Vanilla hat keine Plugins', async () => {
    const f = await agentFixture();
    try {
      const world = worldId();
      await f.client.prepare(world, { jar: vanillaJar(f), memoryMb: 2048, properties: {}, motd: 'x' });
      assert.ok(!fs.existsSync(path.join(f.dataOf(world), 'bukkit.yml')), 'Vanilla braucht keine bukkit.yml');
      await assert.rejects(f.client.installPlugin(world, modrinthPlugin(f, 'x.jar')), /Vanilla/);
      await assert.rejects(f.client.prepare(world, { jar: { ...vanillaJar(f), sha1: 'a'.repeat(40) }, memoryMb: 2048, properties: {}, motd: 'x' }), /Prüfsumme/);
    } finally {
      await f.close();
    }
  });
});

describe('AgentRunner: Verbindung', () => {
  test('Wächter nicht erreichbar → verständlicher Fehler; danach verbindet er neu, Log-Abos auch', async () => {
    const lonely = new AgentRunner(socketPathFor('fehlt'), { connectTimeoutMs: 1000 });
    await assert.rejects(lonely.state('a'.repeat(32)), (err: AgentError) => err.code === 'unavailable' && /Welten-Wächter nicht erreichbar/.test(err.message));
    assert.throws(() => lonely.followLogs('nicht-hex', () => {}), /Ungültige Welt-ID/);
    lonely.close();

    const f = await agentFixture();
    try {
      const world = await prepared(f);
      await f.client.start(world);
      await waitFor(async () => (await f.client.state(world)) === 'running', 8000, 'Welt läuft');
      const lines: string[] = [];
      f.client.followLogs(world, (line) => lines.push(line));
      await new Promise((resolve) => setTimeout(resolve, 200));
      await f.restartServer();
      // offene Verbindung ist weg: die nächste Anfrage verbindet neu
      await waitFor(async () => {
        try {
          return (await f.client.state(world)) === 'running';
        } catch {
          return false;
        }
      }, 8000, 'neu verbunden');
      await waitFor(async () => {
        await f.client.command(world, 'say nach dem Neustart');
        await new Promise((resolve) => setTimeout(resolve, 150));
        return lines.some((l) => l.includes('nach dem Neustart'));
      }, 8000, 'Log-Abo wieder da');
      await f.client.stop(world);
    } finally {
      await f.close();
    }
  });

  test('Zeitgrenze einer Anfrage', async () => {
    const socketPath = socketPathFor('stumm');
    const sockets = new Set<net.Socket>();
    // ein „Wächter“, der nie antwortet
    const server = net.createServer((socket) => {
      sockets.add(socket);
      socket.on('error', () => {});
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const client = new AgentRunner(socketPath, { requestTimeoutMs: 300 });
    try {
      await assert.rejects(client.state('a'.repeat(32)), (err: AgentError) => err.code === 'timeout' && /antwortet nicht/.test(err.message));
    } finally {
      client.close();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
