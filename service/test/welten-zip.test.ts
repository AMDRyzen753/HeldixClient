// Welten-Wächter: sicheres Entpacken (bösartige ZIPs), Export ins Einzelspieler-Format (world_nether/DIM-1 → DIM-1,
// world_the_end/DIM1 → DIM1), Sicherungen (anlegen, behalten, wiederherstellen mit geprüften Plugins, herunterladen),
// ZIP64 und symbolische Links im Datenordner.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import type { AgentError } from '../src/agent/errors';
import { ZipReader, ZipWriter } from '../src/agent/zipio';
import { readEntry, readZip } from '../src/zip';
import { agentFixture, modrinthPlugin, paperJar, rawZip, singleplayerWorld, waitFor, worldId, type AgentFixture, type RawEntry } from './welten-helpers';

async function prepared(f: AgentFixture): Promise<string> {
  const world = worldId();
  await f.client.prepare(world, { jar: paperJar(f), memoryMb: 3072, properties: {}, motd: 'Test' });
  return world;
}

function upload(f: AgentFixture, name: string, data: Buffer): string {
  const file = path.join(f.uploadsDir, name);
  fs.writeFileSync(file, data);
  return file;
}

/** Alle Dateien unter dir (relativ, mit /). */
function tree(dir: string): string[] {
  const result: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else result.push(rel);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return result.sort();
}

function zipContents(file: string): Map<string, Buffer> {
  const buf = fs.readFileSync(file);
  const result = new Map<string, Buffer>();
  for (const entry of readZip(buf)) if (!entry.directory) result.set(entry.name, readEntry(buf, entry, 64 * 1024 * 1024));
  return result;
}

describe('Import: sicheres Entpacken', () => {
  test('Einzelspielerwelt (oben oder in einem Ordner) landet in data/world, ohne session.lock', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      const data = f.dataOf(world);
      fs.mkdirSync(path.join(data, 'world_nether', 'DIM-1'), { recursive: true });
      fs.mkdirSync(path.join(data, 'world'));
      fs.writeFileSync(path.join(data, 'world', 'alt.txt'), 'alt');
      await f.client.importWorld(world, upload(f, 'welt.zip', singleplayerWorld()));
      assert.deepEqual(tree(path.join(data, 'world')), ['DIM-1/region/r.0.0.mca', 'level.dat', 'region/r.0.0.mca']);
      assert.ok(!fs.existsSync(path.join(data, 'world_nether')), 'alte Paper-Ordner weg (Paper teilt beim Start neu auf)');
      assert.deepEqual(fs.readFileSync(path.join(data, 'world', 'region', 'r.0.0.mca')), Buffer.alloc(8192, 7));

      await f.client.importWorld(world, upload(f, 'ordner.zip', singleplayerWorld('Meine Welt/')));
      assert.deepEqual(tree(path.join(data, 'world')), ['DIM-1/region/r.0.0.mca', 'level.dat', 'region/r.0.0.mca']);
      // genau ein Ordner mit level.dat, daneben andere Dateien (z. B. eine Beschreibung): der Ordner ist die Welt
      const withExtras = rawZip([
        { name: 'LIESMICH.txt', data: 'Hallo' },
        { name: '__MACOSX/Welt/level.dat', data: 'x' },
        { name: 'Welt/level.dat', data: 'echt', method: 0 },
        { name: 'Welt/region/r.1.1.mca', data: Buffer.alloc(100, 1) },
      ]);
      await f.client.importWorld(world, upload(f, 'extras.zip', withExtras));
      assert.deepEqual(tree(path.join(data, 'world')), ['level.dat', 'region/r.1.1.mca']);
      assert.equal(fs.readFileSync(path.join(data, 'world', 'level.dat'), 'utf8'), 'echt');
      // Upload-Datei bleibt (der Dienst räumt selbst auf)
      assert.ok(fs.existsSync(path.join(f.uploadsDir, 'welt.zip')));
    } finally {
      await f.close();
    }
  });

  test('bösartige ZIPs werden abgelehnt, nichts landet außerhalb', async () => {
    const f = await agentFixture({ importLimits: { maxEntries: 50, maxTotalBytes: 1024 * 1024, maxEntryBytes: 512 * 1024 } });
    try {
      const world = await prepared(f);
      const data = f.dataOf(world);
      const level: RawEntry = { name: 'level.dat', data: 'x', method: 0 };
      const cases: [string, Buffer, RegExp][] = [
        ['zurück', rawZip([level, { name: '../boese.txt', data: 'x' }]), /ungültiger Pfad/],
        ['tief zurück', rawZip([level, { name: 'region/../../../boese.txt', data: 'x' }]), /ungültiger Pfad/],
        ['absolut', rawZip([level, { name: '/etc/boese.txt', data: 'x' }]), /absoluter Pfad/],
        ['Laufwerk', rawZip([level, { name: 'C:/boese.txt', data: 'x' }]), /ungültiges Zeichen/],
        ['Backslash', rawZip([level, { name: '..\\boese.txt', data: 'x' }]), /ungültiges Zeichen/],
        ['NUL', rawZip([level, { name: 'a\u0000b', data: 'x' }]), /ungültiges Zeichen/],
        ['Link', rawZip([level, { name: 'region', data: '/etc', method: 0, unixMode: 0o120777 }]), /symbolischer Link/],
        ['FIFO', rawZip([level, { name: 'fifo', data: '', unixMode: 0o010644 }]), /Sondertyp/],
        ['zu viele', rawZip([level, ...Array.from({ length: 60 }, (_, i) => ({ name: `f${i}`, data: 'x' }))]), /zu viele Einträge/],
        ['zu groß angegeben', rawZip([level, { name: 'gross', data: 'x', size: 900 * 1024, method: 8 }]), /zu groß/],
        ['Bombe (mehr als angegeben)', rawZip([level, { name: 'bombe', data: Buffer.alloc(400 * 1024), size: 1000, method: 8 }]), /größer als angegeben/],
        ['zusammen zu groß', rawZip([level, ...Array.from({ length: 3 }, (_, i) => ({ name: `g${i}`, data: Buffer.alloc(400 * 1024) }))]), /entpackt zu groß/],
        ['CRC falsch', rawZip([level, { name: 'crc', data: 'hallo', crc: 12345 }]), /CRC-32/],
        ['verschlüsselt', rawZip([level, { name: 'geheim', data: 'x', flags: 0x0801 }]), /verschlüsselt/],
        ['doppelt', rawZip([level, { name: 'a', data: '1' }, { name: 'a', data: '2' }]), /doppelter Eintrag/],
        ['Datei und Ordner', rawZip([level, { name: 'a', data: '1' }, { name: 'a/b', data: '2' }]), /unter einer Datei/],
        ['anderer Name im Kopf', rawZip([level, { name: 'harmlos.txt', localName: '../boese.txt', data: 'x' }]), /Name im Kopf/],
        ['überlappend', rawZip([level, { name: 'eins', data: 'x' }, { name: 'zwei', data: 'x', sameLocalAs: 1 }]), /Name im Kopf|überlappt/],
        ['Packverfahren', rawZip([level, { name: 'bzip', data: 'x', method: 12 }]), /Packverfahren/],
        ['keine Welt', rawZip([{ name: 'readme.txt', data: 'x' }]), /fehlt level\.dat/],
        ['zu tief', rawZip([{ name: 'a/b/level.dat', data: 'x' }]), /fehlt level\.dat/],
        ['zwei Ordner', rawZip([{ name: 'a/level.dat', data: 'x' }, { name: 'b/level.dat', data: 'x' }]), /mehrere Welten/],
        ['kein ZIP', Buffer.from('das ist kein zip, nur text '.repeat(10)), /kein Inhaltsverzeichnis/],
        ['abgeschnitten', singleplayerWorld().subarray(0, 300), /kein Inhaltsverzeichnis|endet zu früh/],
      ];
      fs.mkdirSync(path.join(data, 'world'));
      fs.writeFileSync(path.join(data, 'world', 'bleibt.txt'), 'ja');
      for (const [label, zip, pattern] of cases) {
        await assert.rejects(f.client.importWorld(world, upload(f, `boese-${cases.findIndex((c) => c[0] === label)}.zip`, zip)), (err: AgentError) => {
          assert.match(err.message, pattern, label);
          return true;
        });
      }
      // Welt unverändert, keine Reste, nichts außerhalb angelegt
      assert.deepEqual(tree(path.join(data, 'world')), ['bleibt.txt']);
      const worldDir = path.dirname(data);
      assert.deepEqual(fs.readdirSync(worldDir).filter((n) => n.startsWith('.import-')), []);
      for (const dir of [f.root, path.dirname(f.root), worldDir, path.join(data, '..', '..'), os.tmpdir()]) {
        assert.ok(!fs.existsSync(path.join(dir, 'boese.txt')), dir);
      }
    } finally {
      await f.close();
    }
  });

  test('Upload-Ordner als Link wird abgelehnt', async (t) => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      const real = path.join(f.root, 'echt');
      fs.mkdirSync(real);
      fs.writeFileSync(path.join(real, 'welt.zip'), singleplayerWorld());
      fs.rmSync(f.uploadsDir, { recursive: true });
      try {
        fs.symlinkSync(real, f.uploadsDir, 'junction');
      } catch {
        t.skip('Links lassen sich hier nicht anlegen');
        return;
      }
      await assert.rejects(f.client.importWorld(world, path.join(f.uploadsDir, 'welt.zip')), /Link/);
    } finally {
      await f.close();
    }
  });
});

describe('Export ins Einzelspieler-Format', () => {
  test('Paper-Ordner werden zusammengeführt; Ziel nur neu im Upload-Ordner', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      const data = f.dataOf(world);
      const files: Record<string, Buffer> = {
        'world/level.dat': randomBytes(300),
        'world/region/r.0.0.mca': randomBytes(5000),
        'world/session.lock': Buffer.from('lock'),
        'world/uid.dat': randomBytes(16),
        'world/DIM-1/region/alt.mca': randomBytes(100),
        'world/datapacks/pack.zip': randomBytes(50),
        'world_nether/level.dat': randomBytes(50),
        'world_nether/DIM-1/region/r.-1.0.mca': randomBytes(4000),
        'world_the_end/DIM1/region/r.0.0.mca': randomBytes(3000),
        'world_nether/dimensions/heldix/kammer/region/r.0.0.mca': randomBytes(700),
        'plugins/Essentials/config.yml': Buffer.from('a: 1'),
      };
      for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(data, rel)), { recursive: true });
        fs.writeFileSync(path.join(data, rel), content);
      }
      const target = path.join(f.uploadsDir, 'downloads', 'export.zip');
      await assert.rejects(f.client.exportWorld(world, target), /Ordner gibt es nicht/);
      fs.mkdirSync(path.dirname(target));
      await f.client.exportWorld(world, target);
      const zip = zipContents(target);
      const expected = ['DIM-1/region/r.-1.0.mca', 'DIM1/region/r.0.0.mca', 'datapacks/pack.zip', 'dimensions/heldix/kammer/region/r.0.0.mca', 'level.dat', 'region/r.0.0.mca'];
      assert.deepEqual([...zip.keys()].sort(), expected);
      assert.deepEqual(zip.get('level.dat'), files['world/level.dat']);
      assert.deepEqual(zip.get('DIM-1/region/r.-1.0.mca'), files['world_nether/DIM-1/region/r.-1.0.mca']);
      assert.deepEqual(zip.get('DIM1/region/r.0.0.mca'), files['world_the_end/DIM1/region/r.0.0.mca']);
      assert.deepEqual(zip.get('dimensions/heldix/kammer/region/r.0.0.mca'), files['world_nether/dimensions/heldix/kammer/region/r.0.0.mca']);
      // die exportierte Welt lässt sich wieder importieren
      const other = await prepared(f);
      await f.client.importWorld(other, target);
      assert.deepEqual(tree(path.join(f.dataOf(other), 'world')), expected);
      // vorhandene Datei wird nie überschrieben
      await assert.rejects(f.client.exportWorld(world, target), (err: AgentError) => err.code === 'exists');
      await assert.rejects(f.client.exportWorld(world, path.join(f.root, 'export.zip')), /Upload-Ordner/);
    } finally {
      await f.close();
    }
  });

  test('Vanilla-Aufbau (DIM-1 in der Welt) bleibt, wie er ist; laufende Welt speichert vorher', async () => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      await f.client.importWorld(world, upload(f, 'welt.zip', singleplayerWorld()));
      await f.client.start(world);
      await waitFor(async () => (await f.client.state(world)) === 'running', 8000, 'Welt läuft');
      const target = path.join(f.uploadsDir, 'laufend.zip');
      await f.client.exportWorld(world, target);
      assert.deepEqual([...zipContents(target).keys()].sort(), ['DIM-1/region/r.0.0.mca', 'level.dat', 'region/r.0.0.mca']);
      const saves = () =>
        fs
          .readFileSync(path.join(f.dockerDir, 'containers', `heldix-welt-${world}.stdin`), 'utf8')
          .split('\n')
          .filter((l) => l.startsWith('save-'));
      await waitFor(() => saves().length === 3, 5000, 'save-on');
      assert.deepEqual(saves(), ['save-off', 'save-all flush', 'save-on']);
      await f.client.stop(world);
    } finally {
      await f.close();
    }
  });
});

describe('Sicherungen', () => {
  test('anlegen, Obergrenze, wiederherstellen mit geprüften Plugins, herunterladen, löschen', async () => {
    const f = await agentFixture({ maxBackups: 2 });
    try {
      const world = await prepared(f);
      const data = f.dataOf(world);
      await f.client.importWorld(world, upload(f, 'welt.zip', singleplayerWorld()));
      const plugin = modrinthPlugin(f, 'Chunky.jar');
      await f.client.installPlugin(world, plugin);
      fs.mkdirSync(path.join(data, 'plugins', 'Chunky'), { recursive: true });
      fs.writeFileSync(path.join(data, 'plugins', 'Chunky', 'config.yml'), 'radius: 100\n');
      fs.mkdirSync(path.join(data, 'logs'), { recursive: true });
      fs.writeFileSync(path.join(data, 'logs', 'latest.log'), 'Log mit Chat');
      fs.mkdirSync(path.join(data, 'libraries'), { recursive: true });
      fs.writeFileSync(path.join(data, 'libraries', 'gross.jar'), randomBytes(1000));
      fs.mkdirSync(path.join(data, 'plugins', '.paper-remapped'), { recursive: true });
      fs.writeFileSync(path.join(data, 'plugins', '.paper-remapped', 'Chunky.jar'), 'umgeschrieben');

      const info = await f.client.backup(world, '2026-11-28_03-00-00');
      assert.equal(info.name, '2026-11-28_03-00-00');
      assert.ok(info.sizeBytes > 0);
      await assert.rejects(f.client.backup(world, '2026-11-28_03-00-00'), (err: AgentError) => err.code === 'exists');
      await assert.rejects(f.client.backup(world, '../../boese'), /Name der Sicherung/);

      // Inhalt: Welt, Plugins, Konfiguration und Liste der Plugins – ohne Logs, Bibliotheken, Paper-Cache und session.lock
      const exported = path.join(f.uploadsDir, 'sicherung.zip');
      await f.client.exportBackup(world, '2026-11-28_03-00-00', exported);
      const names = [...zipContents(exported).keys()];
      assert.ok(names.includes('world/level.dat') && names.includes('plugins/Chunky.jar') && names.includes('plugins/Chunky/config.yml'));
      assert.ok(names.includes('.heldix/plugins.json') && names.includes('server.properties'));
      assert.ok(!names.some((n) => n.startsWith('logs/') || n.startsWith('libraries/') || n.startsWith('plugins/.paper-remapped/') || n.endsWith('session.lock')));

      // Welt ändern, Plugin manipulieren, dann zurück
      fs.writeFileSync(path.join(data, 'plugins', 'Chunky', 'config.yml'), 'radius: 9999\n');
      fs.rmSync(path.join(data, 'world', 'region'), { recursive: true });
      await f.client.removePlugin(world, 'Chunky.jar');
      await f.client.restoreBackup(world, '2026-11-28_03-00-00');
      assert.equal(fs.readFileSync(path.join(data, 'plugins', 'Chunky', 'config.yml'), 'utf8'), 'radius: 100\n');
      assert.ok(fs.existsSync(path.join(data, 'world', 'region', 'r.0.0.mca')));
      assert.deepEqual(await f.client.listPlugins(world), ['Chunky.jar']);
      assert.equal(fs.readFileSync(path.join(data, 'logs', 'latest.log'), 'utf8'), 'Log mit Chat', 'Logs bleiben');
      assert.ok(fs.existsSync(path.join(data, 'libraries', 'gross.jar')), 'Server-Dateien bleiben');

      // Eine Sicherung mit manipulierter Plugin-Jar: Jar fällt beim Wiederherstellen weg
      const backups = path.join(path.dirname(data), 'backups');
      const evil = rawZip([
        { name: 'world/level.dat', data: 'x', method: 0 },
        { name: 'plugins/Chunky.jar', data: 'manipuliert' },
        { name: '.heldix/plugins.json', data: JSON.stringify([{ name: plugin.name, url: plugin.url, sha512: plugin.sha512 }]) },
      ]);
      fs.writeFileSync(path.join(backups, 'manipuliert.zip'), evil);
      await f.client.restoreBackup(world, 'manipuliert');
      assert.deepEqual(await f.client.listPlugins(world), []);

      // Obergrenze (hier 2): neue Sicherungen werden abgelehnt, nie still alte gelöscht – aufräumen macht der Dienst
      await assert.rejects(f.client.backup(world, 'zweite'), (err: AgentError) => err.code === 'too-large' && /Höchstens 2 Sicherungen/.test(err.message));
      assert.deepEqual((await f.client.listBackups(world)).map((b) => b.name).sort(), ['2026-11-28_03-00-00', 'manipuliert']);
      await f.client.deleteBackup(world, 'manipuliert');
      await f.client.backup(world, 'zweite');
      await f.client.deleteBackup(world, '2026-11-28_03-00-00');
      await f.client.backup(world, 'dritte');
      assert.deepEqual((await f.client.listBackups(world)).map((b) => b.name).sort(), ['dritte', 'zweite']);
      await f.client.deleteBackup(world, 'zweite');
      await assert.rejects(f.client.deleteBackup(world, 'zweite'), (err: AgentError) => err.code === 'not-found');
      await assert.rejects(f.client.restoreBackup(world, 'gibtsnicht'), (err: AgentError) => err.code === 'not-found');

      // Wiederherstellen nur bei gestoppter Welt; Sicherung bei laufender Welt speichert vorher
      await f.client.start(world);
      await assert.rejects(f.client.restoreBackup(world, 'dritte'), (err: AgentError) => err.code === 'running');
      await f.client.backup(world, 'laufend');
      await f.client.stop(world);
      const stats = await f.client.stats(world);
      assert.equal(stats.memoryMb, 0);
    } finally {
      await f.close();
    }
  });
});

describe('Symbolische Links im Datenordner', () => {
  test('werden beim Lesen, Auflisten und Sichern nicht verfolgt', async (t) => {
    const f = await agentFixture();
    try {
      const world = await prepared(f);
      const data = f.dataOf(world);
      const secret = path.join(f.root, 'geheim.yml');
      fs.writeFileSync(secret, 'passwort: 1234\n');
      fs.mkdirSync(path.join(data, 'plugins', 'X'), { recursive: true });
      try {
        fs.symlinkSync(secret, path.join(data, 'plugins', 'X', 'link.yml'));
        fs.symlinkSync(path.dirname(secret), path.join(data, 'plugins', 'Y'), 'dir');
      } catch {
        t.skip('Links lassen sich hier nicht anlegen (Windows ohne Entwicklermodus)');
        return;
      }
      await assert.rejects(f.client.readFile(world, 'plugins/X/link.yml'), /Link/);
      await assert.rejects(f.client.readFile(world, 'plugins/Y/geheim.yml'), /Link/);
      assert.deepEqual(await f.client.listFiles(world), []);
      await f.client.writeFile(world, 'plugins/X/link.yml', 'ersetzt: ja\n');
      assert.equal(fs.readFileSync(secret, 'utf8'), 'passwort: 1234\n', 'Ziel des Links unverändert');
      assert.ok(!fs.lstatSync(path.join(data, 'plugins', 'X', 'link.yml')).isSymbolicLink());
      await assert.rejects(f.client.writeFile(world, 'plugins/Y/neu.yml', 'x'), /Link|Ordner/);
      await f.client.backup(world, 'mit-links');
      const zip = path.join(f.uploadsDir, 'links.zip');
      await f.client.exportBackup(world, 'mit-links', zip);
      assert.ok(![...zipContents(zip).values()].some((v) => v.toString('utf8').includes('passwort')));
    } finally {
      await f.close();
    }
  });
});

describe('ZIP64', () => {
  test('mehr als 65 535 Einträge werden geschrieben und gelesen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-zip64-'));
    try {
      const file = path.join(dir, 'gross.zip');
      const out = await fsp.open(file, 'wx');
      const writer = new ZipWriter(out);
      for (let i = 0; i < 66_000; i++) await writer.addBuffer(`d/${i}.txt`, Buffer.from(String(i)));
      await writer.finish();
      await out.close();
      const input = await fsp.open(file, 'r');
      try {
        const reader = await ZipReader.open(input, { maxEntries: 100_000, maxTotalBytes: 1 << 30, maxEntryBytes: 1 << 20 });
        assert.equal(reader.entries.length, 66_000);
        const lastEntry = reader.entries[65_999]!;
        assert.equal((await reader.readSmall(lastEntry, 100)).toString(), '65999');
        await assert.rejects(ZipReader.open(input, { maxEntries: 1000, maxTotalBytes: 1 << 30, maxEntryBytes: 1 << 20 }), /zu viele Einträge/);
      } finally {
        await input.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
