// Sicheres Lesen und Entpacken von ZIP-Dateien für dauerhafte Welten (hosting/safe-zip.ts): gültige Welten (oben oder
// in einem Ordner), bösartige Archive (Pfade, Symlinks, Sonderdateien, Zip-Bomben, doppelte und überlappende Einträge,
// Verschlüsselung, falsche Prüfsummen, kaputte Dateien, Grenzen) und der kleine ZIP-Schreiber.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { checkEntryName, extractZip, inspectWorldZip, readZipEntries, readZipEntry, ZipRejected, ZipWriter, type ZipLimits } from '../src/hosting/safe-zip';
import { decodePng, encodePng } from '../src/heads';
import { worldIcon } from '../src/hosting/icon';
import { buildZip, entry, png } from './zip-builder';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-safe-zip-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const LIMITS: ZipLimits = { maxEntries: 1000, maxTotalBytes: 10 * 1024 * 1024, maxEntryBytes: 5 * 1024 * 1024 };

function file(zip: Buffer): string {
  const target = path.join(dir, `z${++counter}.zip`);
  fs.writeFileSync(target, zip);
  return target;
}

/** Einträge im Inhaltsverzeichnis nachträglich ändern (Unix-Rechte, Offset …). */
function patchCentral(zip: Buffer, index: number, patch: (central: Buffer, at: number) => void): Buffer {
  const out = Buffer.from(zip);
  const end = out.length - 22;
  let at = out.readUInt32LE(end + 16);
  for (let i = 0; i < index; i++) at += 46 + out.readUInt16LE(at + 28) + out.readUInt16LE(at + 30) + out.readUInt16LE(at + 32);
  patch(out, at);
  return out;
}

function unixMode(zip: Buffer, index: number, mode: number): Buffer {
  return patchCentral(zip, index, (b, at) => {
    b.writeUInt16LE((3 << 8) | 20, at + 4);
    b.writeUInt32LE((mode << 16) >>> 0, at + 38);
  });
}

async function rejects(zip: Buffer, pattern: RegExp, limits = LIMITS): Promise<void> {
  const target = file(zip);
  await assert.rejects(
    async () => {
      const entries = await readZipEntries(target, limits);
      const out = fs.mkdtempSync(path.join(dir, 'x-'));
      await extractZip(target, entries, out);
    },
    (err: unknown) => {
      assert.ok(err instanceof ZipRejected, `kein ZipRejected: ${String(err)}`);
      assert.match((err as Error).message, pattern);
      return true;
    },
  );
}

describe('Sicheres Entpacken (dauerhafte Welten)', () => {
  test('Namen: relativ, nur „/“, kein „..“ oder „.“, keine Laufwerke, keine Steuerzeichen', () => {
    assert.deepEqual(checkEntryName('Insel/region/'), { name: 'Insel/region', directory: true });
    assert.deepEqual(checkEntryName('level.dat'), { name: 'level.dat', directory: false });
    for (const bad of ['../x', 'a/../b', '/etc/passwd', 'C:/x', 'c:x', 'a\\b', 'a//b', './a', 'a/./b', '', 'a\u0000b', 'a\nb', `${'x/'.repeat(40)}y`, `${'n'.repeat(256)}`]) {
      assert.throws(() => checkEntryName(bad), ZipRejected, JSON.stringify(bad));
    }
  });

  test('gültige Welt in einem Ordner: Wurzel, Größe, Symbol; Entpacken mit Abbildung (ohne session.lock)', async () => {
    const icon = png(64, 64);
    const zip = buildZip([
      entry('Insel/', '', 0),
      entry('Insel/level.dat', 'LEVEL'),
      entry('Insel/session.lock', 'x', 0),
      entry('Insel/region/r.0.0.mca', Buffer.alloc(10_000, 3)),
      entry('Insel/icon.png', icon, 0),
      entry('__MACOSX/._level.dat', 'mac'),
    ]);
    const target = file(zip);
    const info = await inspectWorldZip(target, LIMITS);
    assert.equal(info.root, 'Insel/');
    assert.equal(info.bytes, 5 + 1 + 10_000 + icon.length);
    assert.deepEqual(info.icon, icon);
    const out = fs.mkdtempSync(path.join(dir, 'world-'));
    const result = await extractZip(target, info.entries, out, (name) => {
      if (!name.startsWith(info.root)) return null;
      const rest = name.slice(info.root.length);
      return rest === 'session.lock' ? null : rest;
    });
    assert.deepEqual(result, { files: 3, bytes: 5 + 10_000 + icon.length });
    assert.equal(fs.readFileSync(path.join(out, 'level.dat'), 'utf8'), 'LEVEL');
    assert.equal(fs.readFileSync(path.join(out, 'region', 'r.0.0.mca')).length, 10_000);
    assert.equal(fs.existsSync(path.join(out, 'session.lock')), false);
    assert.equal(fs.existsSync(path.join(out, '__MACOSX')), false);
    // Welt ganz oben
    const top = await inspectWorldZip(file(buildZip([entry('level.dat', 'L'), entry('DIM-1/region/r.0.0.mca', 'n')])), LIMITS);
    assert.deepEqual([top.root, top.icon], ['', null]);
  });

  test('bösartige Pfade und alte Zeichenkodierungen werden abgelehnt', async () => {
    await rejects(buildZip([entry('level.dat', 'L'), entry('../../etc/cron.d/x', 'boom')]), /ungültigen Pfad/);
    await rejects(buildZip([entry('level.dat', 'L'), entry('/etc/passwd', 'x')]), /ungültigen Pfad/);
    await rejects(buildZip([entry('level.dat', 'L'), entry('C:/Windows/x', 'x')]), /ungültigen Pfad/);
    await rejects(buildZip([entry('level.dat', 'L'), entry('region\\..\\..\\x', 'x')]), /ungültigen Pfad/);
    // Ohne UTF-8-Kennzeichen und mit Bytes über 127: alte Codepage, abgelehnt
    await rejects(buildZip([entry('level.dat', 'L'), entry('Grüße.txt', 'x', 8, { flags: 0 })]), /alten Zeichenkodierung/);
  });

  test('Symlinks und Sonderdateien (Unix-Rechte im Inhaltsverzeichnis) werden abgelehnt', async () => {
    const base = buildZip([entry('level.dat', 'L'), entry('link', '/etc/passwd', 0)]);
    await rejects(unixMode(base, 1, 0o120777), /Verknüpfung \(Symlink\)/);
    await rejects(unixMode(base, 1, 0o020644), /Sonderdatei/);
    // normale Datei mit Unix-Rechten ist in Ordnung
    const ok = file(unixMode(base, 1, 0o100644));
    assert.equal((await readZipEntries(ok, LIMITS)).length, 2);
  });

  test('Zip-Bomben: zu viel entpackt, zu große Einträge, mehr als angegeben, zu viele Einträge, überlappend', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0);
    await rejects(buildZip([entry('level.dat', 'L'), entry('big.bin', big)]), /zu groß/);
    const many = Array.from({ length: 30 }, (_, i) => entry(`r/${i}.mca`, `${i}`));
    await rejects(buildZip([entry('level.dat', 'L'), ...many]), /zu viele Einträge/, { ...LIMITS, maxEntries: 20 });
    await rejects(buildZip([entry('level.dat', 'L'), ...many]), /zu groß/, { ...LIMITS, maxTotalBytes: 20 });
    // Angabe 10 Byte, entpackt aber 1 MB
    const bomb = entry('bomb.bin', Buffer.alloc(1024 * 1024, 0));
    await rejects(buildZip([entry('level.dat', 'L'), { ...bomb, size: 10 }]), /größer als angegeben/);
    // Zwei Einträge im Inhaltsverzeichnis zeigen auf dieselben Daten
    const twice = patchCentral(buildZip([entry('level.dat', 'L'), entry('b.dat', 'B')]), 1, (b, at) => b.writeUInt32LE(0, at + 42));
    await rejects(twice, /überlappende Einträge/);
  });

  test('doppelte Einträge (auch nur Groß/klein), Verschlüsselung, unbekannte Kompression, falsche CRC, kaputte Daten', async () => {
    await rejects(buildZip([entry('level.dat', 'L'), entry('LEVEL.DAT', 'L')]), /doppelt/);
    await rejects(buildZip([entry('level.dat', 'L', 8, { flags: 0x0801 })]), /Verschlüsselte/);
    await rejects(buildZip([entry('level.dat', 'L', 12)]), /unbekannte Kompression/);
    await rejects(buildZip([entry('level.dat', 'LEVEL', 8, { crc: 1234 })]), /Prüfsumme/);
    await rejects(buildZip([entry('level.dat', 'LEVEL', 8, { stored: Buffer.from([0xff, 0xff, 0xff]) })]), /beschädigt/);
    await rejects(Buffer.from('nur Text, keine ZIP-Datei, aber lang genug für einen Kopf'), /keine ZIP-Datei/);
    await rejects(buildZip([entry('level.dat', 'L')]).subarray(0, 40), /keine ZIP-Datei|beschädigt/);
    await rejects(buildZip([entry('level.dat', 'L')], 'x'.repeat(10)).subarray(5), /beschädigt|keine ZIP-Datei/);
  });

  test('keine Welt bzw. mehrere Welten', async () => {
    await assert.rejects(inspectWorldZip(file(buildZip([entry('readme.txt', 'x')])), LIMITS), /level\.dat fehlt/);
    await assert.rejects(inspectWorldZip(file(buildZip([entry('A/level.dat', 'x'), entry('B/level.dat', 'x')])), LIMITS), /mehrere Welten/);
    // tiefer als ein Ordner zählt nicht
    await assert.rejects(inspectWorldZip(file(buildZip([entry('A/B/level.dat', 'x')])), LIMITS), /level\.dat fehlt/);
  });

  test('ZipWriter: Daten mit Deskriptor, gespeichert und komprimiert, wieder lesbar; vorhandene Datei wird nicht überschrieben', async () => {
    const src = fs.mkdtempSync(path.join(dir, 'src-'));
    fs.writeFileSync(path.join(src, 'a.txt'), 'Hallo '.repeat(1000));
    fs.writeFileSync(path.join(src, 'r.mca'), Buffer.alloc(3000, 9));
    const target = path.join(dir, 'written.zip');
    const writer = await ZipWriter.create(target);
    await writer.addDirectory('region');
    await writer.addFile('level.dat', path.join(src, 'a.txt'));
    await writer.addFile('region/r.0.0.mca', path.join(src, 'r.mca'));
    await writer.close();
    const entries = await readZipEntries(target, LIMITS);
    assert.deepEqual(entries.map((e) => [e.name, e.directory, e.method]), [['region', true, 0], ['level.dat', false, 8], ['region/r.0.0.mca', false, 0]]);
    assert.equal((await readZipEntry(target, entries[1]!, 100_000)).toString(), 'Hallo '.repeat(1000));
    const out = fs.mkdtempSync(path.join(dir, 'out-'));
    await extractZip(target, entries, out);
    assert.deepEqual(fs.readFileSync(path.join(out, 'region', 'r.0.0.mca')), Buffer.alloc(3000, 9));
    await assert.rejects(ZipWriter.create(target), /EEXIST/);
  });

  test('Welt-Symbol: 64×64 mit Plakette, auch ohne oder mit kaputtem Bild; das Bild der Welt bleibt erhalten', () => {
    const red = encodePng({ width: 64, height: 64, data: Buffer.alloc(64 * 64 * 4, 0).fill(Buffer.from([200, 0, 0, 255])) });
    for (const input of [null, Buffer.from('kaputt'), png(64, 64), red]) {
      const out = decodePng(worldIcon(input))!;
      assert.deepEqual([out.width, out.height], [64, 64]);
      // Plakette unten rechts (türkis), Mitte der Plakette weiß („H“)
      assert.deepEqual([...out.data.subarray((50 * 64 + 50) * 4, (50 * 64 + 50) * 4 + 3)], [36, 200, 210]);
    }
    const kept = decodePng(worldIcon(red))!;
    assert.deepEqual([...kept.data.subarray(0, 4)], [200, 0, 0, 255]);
  });
});
