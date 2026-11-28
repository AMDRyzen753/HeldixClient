// ProcessRunner (nur Entwicklung, 1.13.0) ohne Java: verweigert ohne HELDIX_DIENST_DEV=1; Vorbereiten (EULA,
// server.properties mit maskierter MOTD, keine Verbindungsdrossel, Symbol), sicherer Import (auch bösartige ZIPs),
// Export zurück ins Einzelspieler-Format, Sicherungen, Plugins nur von cdn.modrinth.com, Pfade der Plugin-Konfiguration.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { ProcessRunner, DEV_ONLY } from '../src/hosting/process-runner';
import { inspectWorldZip, readZipEntries } from '../src/hosting/safe-zip';
import { buildZip, entry } from './zip-builder';

const ID = 'a'.repeat(32);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-process-runner-'));
const jarCache = path.join(dir, 'jars');
const JAR = Buffer.from('kein echtes jar');
const SHA = createHash('sha256').update(JAR).digest('hex');
let runner: ProcessRunner;
let previousDev: string | undefined;

function options() {
  return { root: path.join(dir, 'worlds'), java: 'java-gibt-es-hier-nicht', jarCache, userAgent: 'test', log: () => undefined };
}

before(() => {
  previousDev = process.env.HELDIX_DIENST_DEV;
  fs.mkdirSync(jarCache, { recursive: true });
  fs.writeFileSync(path.join(jarCache, `paper-${SHA}.jar`), JAR);
});
after(() => {
  if (previousDev === undefined) delete process.env.HELDIX_DIENST_DEV;
  else process.env.HELDIX_DIENST_DEV = previousDev;
  fs.rmSync(dir, { recursive: true, force: true });
});

function zipFile(name: string, zip: Buffer): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, zip);
  return file;
}

describe('ProcessRunner (Entwicklung)', () => {
  test('ohne HELDIX_DIENST_DEV=1 verweigert', () => {
    delete process.env.HELDIX_DIENST_DEV;
    assert.throws(() => new ProcessRunner(options()), { message: DEV_ONLY });
    process.env.HELDIX_DIENST_DEV = '0';
    assert.throws(() => new ProcessRunner(options()), { message: DEV_ONLY });
    process.env.HELDIX_DIENST_DEV = '1';
    runner = new ProcessRunner(options());
  });

  test('prepare: Jar aus dem Cache (geprüft), EULA, server.properties, bukkit.yml, Symbol; fremde Jar-Adressen nie', async () => {
    await runner.prepare(ID, {
      jar: { software: 'paper', version: '26.3', url: `https://fill-data.papermc.io/v1/objects/${SHA}/paper.jar`, sha256: SHA, build: 263 },
      memoryMb: 3072,
      properties: { difficulty: 'hard', 'max-players': '8', 'enable-rcon': 'true' } as Record<string, string>,
      motd: '§7Insel\n§3Geteilt mit §bHeldixClient §8· §7heldix.example',
      iconPng: Buffer.from('png'),
    });
    const data = path.join(dir, 'worlds', ID, 'data');
    assert.equal(fs.readFileSync(path.join(data, 'eula.txt'), 'utf8').includes('eula=true'), true);
    const props = fs.readFileSync(path.join(data, 'server.properties'), 'latin1');
    assert.match(props, /^difficulty=hard$/m);
    assert.match(props, /^server-ip=127\.0\.0\.1$/m);
    assert.match(props, /^online-mode=true$/m);
    assert.match(props, /^enable-rcon=false$/m, 'nur erlaubte Schlüssel');
    assert.match(props, /^motd=\\u00a77Insel\\n\\u00a73Geteilt mit \\u00a7bHeldixClient \\u00a78\\u00b7 \\u00a77heldix\.example$/m);
    assert.equal(fs.readFileSync(path.join(data, 'bukkit.yml'), 'utf8'), 'settings:\n  connection-throttle: -1\n');
    assert.equal(fs.readFileSync(path.join(data, 'server-icon.png'), 'utf8'), 'png');
    assert.equal(await runner.state(ID), 'stopped');
    await assert.rejects(
      runner.prepare('b'.repeat(32), { jar: { software: 'paper', version: '26.3', url: 'https://evil.example/paper.jar', sha256: SHA, build: 1 }, memoryMb: 1, properties: {}, motd: '' }),
      /Ungültiges Paper-Jar/,
    );
    await assert.rejects(runner.prepare('../x', { jar: { software: 'paper', version: '1', url: '', build: 1 }, memoryMb: 1, properties: {}, motd: '' }), /Ungültige Welt-ID/);
    await assert.rejects(runner.command(ID, 'say hi'), /läuft nicht/);
  });

  test('importWorld: sicher entpackt nach world/ (Ordner in der ZIP entfernt), bösartige ZIP lässt die Welt unverändert', async () => {
    await runner.importWorld(ID, zipFile('w1.zip', buildZip([entry('Insel/level.dat', 'EINS'), entry('Insel/session.lock', 'x'), entry('Insel/DIM-1/region/r.0.0.mca', 'N')])));
    const world = path.join(dir, 'worlds', ID, 'data', 'world');
    assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'EINS');
    assert.equal(fs.existsSync(path.join(world, 'session.lock')), false);
    await assert.rejects(runner.importWorld(ID, zipFile('evil.zip', buildZip([entry('level.dat', 'BÖSE'), entry('../../../outside.txt', 'x')]))), /ungültigen Pfad/);
    assert.equal(fs.readFileSync(path.join(world, 'level.dat'), 'utf8'), 'EINS');
    assert.equal(fs.existsSync(path.join(dir, 'outside.txt')), false);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'worlds', ID, 'data')).filter((n) => n.startsWith('.import-')), []);
  });

  test('exportWorld: Nether und End von Paper zurück nach DIM-1 und DIM1', async () => {
    const data = path.join(dir, 'worlds', ID, 'data');
    fs.mkdirSync(path.join(data, 'world_nether', 'DIM-1', 'region'), { recursive: true });
    fs.writeFileSync(path.join(data, 'world_nether', 'DIM-1', 'region', 'r.0.0.mca'), 'NETHER-NEU');
    fs.writeFileSync(path.join(data, 'world_nether', 'level.dat'), 'nicht mitnehmen');
    fs.mkdirSync(path.join(data, 'world_the_end', 'DIM1'), { recursive: true });
    fs.writeFileSync(path.join(data, 'world_the_end', 'DIM1', 'raids.dat'), 'END');
    const out = path.join(dir, 'export.zip');
    await runner.exportWorld(ID, out);
    const info = await inspectWorldZip(out);
    assert.deepEqual(info.entries.map((e) => e.name).sort(), ['DIM-1/region/r.0.0.mca', 'DIM1/raids.dat', 'level.dat']);
  });

  test('Sicherungen: ohne Caches und Logs; Liste, Wiederherstellen, Export, Löschen; Name geprüft', async () => {
    const data = path.join(dir, 'worlds', ID, 'data');
    fs.mkdirSync(path.join(data, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(data, 'logs', 'latest.log'), 'log');
    fs.mkdirSync(path.join(data, 'libraries'), { recursive: true });
    fs.writeFileSync(path.join(data, 'libraries', 'x.jar'), 'lib');
    const info = await runner.backup(ID, 'hand-2026-11-28_10-00-00');
    assert.ok(info.sizeBytes > 0);
    const entries = (await readZipEntries(path.join(dir, 'worlds', ID, 'backups', 'hand-2026-11-28_10-00-00.zip'), { maxEntries: 100, maxTotalBytes: 1e9, maxEntryBytes: 1e9 })).map((e) => e.name);
    assert.ok(entries.includes('world/level.dat') && entries.includes('server.properties'));
    assert.ok(!entries.some((e) => e.startsWith('logs/') || e.startsWith('libraries/')));
    await assert.rejects(runner.backup(ID, '../x'), /Ungültiger Name/);
    assert.deepEqual((await runner.listBackups(ID)).map((b) => b.name), ['hand-2026-11-28_10-00-00']);
    fs.writeFileSync(path.join(data, 'world', 'level.dat'), 'ZWEI');
    await runner.restoreBackup(ID, 'hand-2026-11-28_10-00-00');
    assert.equal(fs.readFileSync(path.join(data, 'world', 'level.dat'), 'utf8'), 'EINS');
    assert.equal(fs.readFileSync(path.join(data, 'logs', 'latest.log'), 'utf8'), 'log', 'Logs bleiben');
    const copy = path.join(dir, 'backup-copy.zip');
    await runner.exportBackup(ID, 'hand-2026-11-28_10-00-00', copy);
    assert.ok(fs.statSync(copy).size > 0);
    await runner.deleteBackup(ID, 'hand-2026-11-28_10-00-00');
    assert.deepEqual(await runner.listBackups(ID), []);
  });

  test('Plugins nur von cdn.modrinth.com mit gültigem Namen; Plugin-Konfiguration nur unter plugins/', async () => {
    await assert.rejects(runner.installPlugin(ID, { name: 'x.jar', url: 'https://evil.example/x.jar', sha512: 'a'.repeat(128) }), /Ungültiges Plugin/);
    await assert.rejects(runner.installPlugin(ID, { name: '../x.jar', url: 'https://cdn.modrinth.com/x.jar', sha512: 'a'.repeat(128) }), /Ungültiges Plugin/);
    await assert.rejects(runner.removePlugin(ID, '../server.properties'), /Ungültiger Dateiname/);
    await runner.writeFile(ID, 'plugins/LuckPerms/config.yml', 'a: 1\n');
    assert.equal(await runner.readFile(ID, 'plugins/LuckPerms/config.yml'), 'a: 1\n');
    assert.deepEqual(await runner.listFiles(ID), ['plugins/LuckPerms/config.yml']);
    for (const bad of ['plugins/../server.properties', 'server.properties', 'plugins/x.jar', '/etc/passwd', 'plugins\\x.yml']) {
      await assert.rejects(runner.readFile(ID, bad), /Ungültiger Pfad/, bad);
      await assert.rejects(runner.writeFile(ID, bad, 'x'), /Ungültiger Pfad/, bad);
    }
    await assert.rejects(runner.writeFile(ID, 'plugins/big.yml', 'x'.repeat(256 * 1024 + 1)), /zu groß/);
    // Symlink unter plugins/ (wenn das System es erlaubt): nicht folgen
    const data = path.join(dir, 'worlds', ID, 'data');
    try {
      fs.symlinkSync(path.join(dir), path.join(data, 'plugins', 'raus'), 'junction');
    } catch {
      return;
    }
    await assert.rejects(runner.writeFile(ID, 'plugins/raus/x.yml', 'x'), /Ungültiger Pfad/);
    assert.equal(fs.existsSync(path.join(dir, 'x.yml')), false);
    assert.ok(!(await runner.listFiles(ID)).some((f) => f.includes('raus')));
  });

  test('remove und list', async () => {
    assert.deepEqual(await runner.list(), [ID]);
    await runner.remove(ID);
    assert.deepEqual(await runner.list(), []);
    assert.equal(await runner.state(ID), 'missing');
  });
});
