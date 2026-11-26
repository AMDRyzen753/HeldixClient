// ZIP-Leser und Prüfung von Addon-JARs (ohne Dienst): saubere Archive, kaputte Archive, Zip-Bomben, Pfade, Hinweise
// aus den Klassendateien; dazu das Lesen der Bildgröße aus PNG- und JPEG-Köpfen.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { imageInfo } from '../src/images';
import { inspectAddonJar, MAX_ZIP_ENTRIES, readEntry, readZip, ZipProblem } from '../src/zip';
import { addonJar, buildZip, centralRecord, classFile, endRecord, entry, jpeg, localRecord, png } from './zip-builder';

/** Erwartet eine ZipProblem-Meldung, die zu `pattern` passt. */
function rejects(buf: Buffer, pattern: RegExp): void {
  assert.throws(
    () => {
      for (const e of readZip(buf)) readEntry(buf, e, 1024 * 1024);
    },
    (err: unknown) => err instanceof ZipProblem && pattern.test(err.message),
  );
}

async function inspectRejects(buf: Buffer, pattern: RegExp): Promise<void> {
  await assert.rejects(inspectAddonJar(buf), (err: unknown) => err instanceof ZipProblem && pattern.test((err as Error).message));
}

describe('ZIP-Leser', () => {
  test('liest gespeicherte und komprimierte Einträge, Ordner und einen Kommentar', () => {
    const text = 'Hallo Welt! '.repeat(500);
    const binary = randomBytes(3000);
    const zip = buildZip([entry('ordner/', '', 0), entry('ordner/a.txt', text, 8), entry('b.bin', binary, 0), entry('ümlaut.txt', 'ä', 8)], 'Kommentar');
    const entries = readZip(zip);
    assert.deepEqual(
      entries.map((e) => [e.name, e.method, e.size, e.directory]),
      [
        ['ordner/', 0, 0, true],
        ['ordner/a.txt', 8, Buffer.byteLength(text), false],
        ['b.bin', 0, 3000, false],
        ['ümlaut.txt', 8, 2, false],
      ],
    );
    assert.equal(readEntry(zip, entries[1]!, 1 << 20).toString('utf8'), text);
    assert.deepEqual(readEntry(zip, entries[2]!, 1 << 20), binary);
    assert.ok(entries[1]!.compressedSize < entries[1]!.size, 'komprimiert');
    // Größer als erlaubt: nicht entpackt
    assert.throws(() => readEntry(zip, entries[1]!, 100), /entpackt zu groß/);
  });

  test('keine oder kaputte Archive', () => {
    for (const buf of [Buffer.alloc(0), Buffer.from('PK'), randomBytes(5000), Buffer.from('kein zip, nur Text '.repeat(20))]) {
      rejects(buf, /keine gültige JAR/);
    }
    const zip = buildZip([entry('a.txt', 'Inhalt '.repeat(100))]);
    // Abgeschnitten, Müll am Ende, Inhaltsverzeichnis verschoben
    rejects(zip.subarray(0, zip.length - 5), /keine gültige JAR/);
    rejects(Buffer.concat([zip, Buffer.from('Müll')]), /keine gültige JAR/);
    rejects(Buffer.concat([Buffer.from('Vorspann'), zip]), /beschädigt/);
    // Falsche Prüfsumme, falsche (zu kleine) Größe, kaputte Deflate-Daten
    rejects(buildZip([entry('a.txt', 'Inhalt', 8, { crc: 12345 })]), /Prüfsumme/);
    rejects(buildZip([entry('a.txt', 'Inhalt '.repeat(100), 8, { size: 10 })]), /beschädigt/);
    rejects(buildZip([entry('a.txt', 'abc', 8, { stored: Buffer.from([0xff, 0xff, 0xff]) })]), /lässt sich nicht entpacken|beschädigt/);
    rejects(buildZip([entry('a.txt', 'abc', 0, { size: 5 })]), /Größen/);
    // Lokaler Kopf passt nicht zum Inhaltsverzeichnis (Name oder Kompression)
    rejects(buildZip([entry('heldix.addon.json', '{}', 8, { localName: 'harmlos.json' })]), /passt nicht zum Inhaltsverzeichnis/);
    rejects(buildZip([entry('a.txt', 'abc', 8, { localMethod: 0 })]), /lokaler Kopf/);
  });

  test('abgelehnt: Verschlüsselung, fremde Kompression, ZIP64, mehrere Teile', () => {
    rejects(buildZip([entry('a.txt', 'geheim', 8, { flags: 0x0801 })]), /verschlüsselte Einträge/);
    rejects(buildZip([entry('a.txt', 'geheim', 8, { flags: 0x0840 })]), /verschlüsselte Einträge/);
    rejects(buildZip([entry('a.txt', 'abc', 12)]), /nicht unterstützte Kompression/);
    rejects(buildZip([entry('a.txt', 'abc', 14)]), /nicht unterstützte Kompression/);
    rejects(buildZip([entry('a.txt', 'abc', 8, { size: 0xffffffff })]), /ZIP64/);
    // Ende mit 0xFFFF Einträgen (ZIP64-Kennzeichen) und Ende mit ZIP64-Locator davor
    const e = entry('a.txt', 'abc');
    const local = localRecord(e);
    const cd = centralRecord(e, 0);
    rejects(Buffer.concat([local, cd, endRecord(0xffff, cd.length, local.length)]), /ZIP64/);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    rejects(Buffer.concat([local, cd, locator, endRecord(1, cd.length, local.length)]), /ZIP64|beschädigt/);
    // Mehrere Teile: Einträge auf diesem Teil ≠ insgesamt
    rejects(Buffer.concat([local, cd, endRecord(1, cd.length, local.length, '', 2)]), /mehrere Teile/);
  });

  test('Pfade: kein „..“, nichts Absolutes, keine Laufwerke, keine Backslashes, keine Doppelten', () => {
    for (const name of ['../boese.class', 'a/../../boese.class', 'a/..', '/etc/passwd', 'C:/Windows/boese.dll', 'c:boese', 'a\\b.class', 'nul\u0000.class', '']) {
      rejects(buildZip([entry(name, 'x')]), /ungültigen Pfad/);
    }
    // Erlaubt: Punkte im Namen, die keine Pfadteile „..“ sind
    assert.equal(readZip(buildZip([entry('a/..b/c..d/.x', 'x')]))[0]!.name, 'a/..b/c..d/.x');
    rejects(buildZip([entry('a.txt', 'eins'), entry('a.txt', 'zwei')]), /doppelt/);
  });

  test('Zip-Bomben: zu viel entpackt, überlappende Einträge, zu viele Einträge', () => {
    // Angegeben über 200 MiB (zwei Einträge à 101 MiB): abgelehnt, bevor etwas entpackt wird.
    const big = 101 * 1024 * 1024;
    rejects(buildZip([entry('a.bin', 'x', 8, { size: big }), entry('b.bin', 'y', 8, { size: big })]), /entpackt zu groß.*Zip-Bombe/);
    // Lügt die Größe (klein angegeben, groß entpackt), bricht zlib ab, statt alles zu entpacken.
    const zeros = Buffer.alloc(20 * 1024 * 1024);
    rejects(buildZip([entry('null.bin', zeros, 8, { size: 1000 })]), /beschädigt/);
    // Überlappend: Der zweite Eintrag liegt in den Daten des ersten (eine Datei vielfach entpacken).
    const inner = entry('b.txt', 'innen');
    const innerLocal = localRecord(inner);
    const outer = entry('a.txt', innerLocal, 0);
    const outerLocal = localRecord(outer);
    const cd = Buffer.concat([centralRecord(outer, 0), centralRecord(inner, 30 + 'a.txt'.length)]);
    rejects(Buffer.concat([outerLocal, cd, endRecord(2, cd.length, outerLocal.length)]), /überlappende Einträge/);
    // Zu viele Einträge laut Ende: abgelehnt, ohne das Inhaltsverzeichnis zu lesen.
    rejects(Buffer.concat([outerLocal, endRecord(MAX_ZIP_ENTRIES + 1, 0, outerLocal.length)]), /zu viele Einträge/);
    // Ein Inhaltsverzeichnis, das weniger Einträge hat als angegeben
    const one = entry('a.txt', 'x');
    const oneLocal = localRecord(one);
    const oneCd = centralRecord(one, 0);
    rejects(Buffer.concat([oneLocal, oneCd, endRecord(2, oneCd.length, oneLocal.length)]), /beschädigt/);
  });
});

describe('Addon-JAR prüfen', () => {
  test('saubere JAR: Angaben aus heldix.addon.json, Klassen gezählt, keine Hinweise', async () => {
    const jar = addonJar('wetter', '1.2.3-beta.1', {
      meta: { name: '  Wetter  ', description: 'Zeigt das Wetter.', authors: ['Anna', 'Ben'] },
      extra: [entry('dev/beispiel/wetter/Hilfe.class', classFile('dev/heldixclient/api/Hud')), entry('assets/icon.png', png(16, 16))],
    });
    const info = await inspectAddonJar(jar);
    assert.deepEqual(info, {
      id: 'wetter',
      version: '1.2.3-beta.1',
      api: 2,
      entrypoint: 'dev.beispiel.wetter.Haupt',
      clientEntrypoint: null,
      transformers: [],
      minecraft: [],
      loader: null,
      access: 'api',
      loaders: ['heldix', 'fabric'],
      name: 'Wetter',
      description: 'Zeigt das Wetter.',
      authors: ['Anna', 'Ben'],
      inspection: { classes: 2, uses: [], expected: [] },
    });
    // Ohne description und authors; mit BOM am Anfang
    const bare = addonJar('leer', '1.0.0', { rawMeta: `${String.fromCharCode(0xfeff)}{"id":"leer","name":"Leer","version":"1.0.0","entrypoint":"dev.beispiel.leer.Haupt","api":1}` });
    const leer = await inspectAddonJar(bare);
    assert.deepEqual([leer.description, leer.authors, leer.api], ['', [], 1]);
  });

  test('Hinweise aus den Konstanten der Klassen (nicht ausgeführt), in fester Reihenfolge', async () => {
    const cases: [string[], string[]][] = [
      [['java/net/URL'], ['netzwerk']],
      [['java/net/http/HttpClient'], ['netzwerk']],
      [['java/io/FileOutputStream'], ['dateien']],
      [['java/nio/file/Files'], ['dateien']],
      [['java/lang/ProcessBuilder'], ['prozesse']],
      [['java/lang/Runtime', 'exec'], ['prozesse']],
      [['java/lang/reflect/Method'], ['reflection']],
      [['java/lang/System', 'loadLibrary'], ['nativ']],
      [['java/lang/foreign/Linker'], ['nativ']],
      [['net/minecraft/client/MinecraftClient'], ['minecraft']],
      [['net/minecraft/x', 'java/lang/reflect/Field', 'java/net/Socket', 'java/io/File'], ['netzwerk', 'dateien', 'reflection', 'minecraft']],
      [['java/io/InputStream', 'java/lang/String', 'dev/heldixclient/api/HeldixApi'], []],
    ];
    for (const [constants, uses] of cases) {
      const jar = addonJar('hinweis', '1.0.0', { extra: [entry('dev/beispiel/hinweis/Teil.class', classFile(...constants))] });
      assert.deepEqual((await inspectAddonJar(jar)).inspection, { classes: 2, uses, expected: [] }, constants.join(', '));
    }
    // Gespeichert (nicht komprimiert) zählt genauso; nur .class-Dateien werden durchsucht, native Bibliotheken zählen als „nativ“.
    const stored = addonJar('hinweis', '1.0.0', {
      extra: [entry('dev/beispiel/hinweis/Netz.class', classFile('java/net/URI'), 0), entry('text.txt', 'java/lang/ProcessBuilder')],
    });
    assert.deepEqual((await inspectAddonJar(stored)).inspection, { classes: 2, uses: ['netzwerk'], expected: [] });
    const native = addonJar('hinweis', '1.0.0', { extra: [entry('natives/win/hilfe.DLL', randomBytes(100)), entry('lib/libx.so', randomBytes(10))] });
    assert.deepEqual((await inspectAddonJar(native)).inspection, { classes: 1, uses: ['nativ'], expected: [] });
  });

  test('heldix.addon.json Format 2: Eingriff in Minecraft (clientEntrypoint, transformers), minecraft, loader, loaders', async () => {
    const cls = (name: string, ...constants: string[]) => entry(`${name.replace(/\./g, '/')}.class`, classFile(...constants));
    // Nur clientEntrypoint: Zugriff minecraft, läuft (ohne Angabe) nur im Heldix Loader; Minecraft-Klassen sind erwartet
    const start = await inspectAddonJar(
      addonJar('sicht', '1.0.0', {
        meta: { entrypoint: undefined, clientEntrypoint: 'dev.x.Start', minecraft: ['26.3'], loader: '>=2.4.0' },
        extra: [cls('dev.x.Start', 'net/minecraft/client/Camera', 'java/lang/ProcessBuilder')],
      }),
    );
    assert.deepEqual(
      [start.entrypoint, start.clientEntrypoint, start.transformers, start.minecraft, start.loader, start.access, start.loaders],
      [null, 'dev.x.Start', [], ['26.3'], '>=2.4.0', 'minecraft', ['heldix']],
    );
    assert.deepEqual(start.inspection, { classes: 1, uses: ['prozesse', 'minecraft'], expected: ['minecraft'] });
    // entrypoint und Transformer (als einzelner Text, wie im Launcher erlaubt), minecraft als Text; Doppelte fallen weg
    const both = await inspectAddonJar(
      addonJar('beides', '2.0.0', {
        meta: { transformers: ['dev.x.Trafo', 'dev.x.Trafo'], minecraft: '26.3', loaders: ['heldix', 'fabric'] },
        extra: [cls('dev.x.Trafo', 'net/minecraft/client/Camera')],
      }),
    );
    assert.deepEqual(
      [both.entrypoint, both.transformers, both.minecraft, both.access, both.loaders],
      ['dev.beispiel.beides.Haupt', ['dev.x.Trafo'], ['26.3'], 'minecraft', ['heldix', 'fabric']],
    );
    assert.deepEqual(both.inspection.expected, ['minecraft']);
    const single = await inspectAddonJar(addonJar('einzeln', '1.0.0', { meta: { entrypoint: undefined, transformers: 'dev.x.T', minecraft: ['26.2', '26.3', '26.x'] }, extra: [cls('dev.x.T')] }));
    assert.deepEqual([single.transformers, single.minecraft, single.access], [['dev.x.T'], ['26.2', '26.3', '26.x'], 'minecraft']);
    // Nur Heldix-API, aber mit Minecraft-Versionen und eigenen Loadern; Minecraft-Klassen bleiben dann ein Hinweis
    const api = await inspectAddonJar(
      addonJar('nurapi', '1.0.0', { meta: { minecraft: ['26.2', '26.3', '26.2'], loaders: ['heldix'] }, extra: [cls('dev.x.Teil', 'net/minecraft/x', 'java/net/URL')] }),
    );
    assert.deepEqual([api.access, api.minecraft, api.loaders, api.clientEntrypoint, api.transformers], ['api', ['26.2', '26.3'], ['heldix'], null, []]);
    assert.deepEqual(api.inspection, { classes: 2, uses: ['netzwerk', 'minecraft'], expected: [] });

    // Fehler
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ entrypoint: undefined }, /fehlt ein Einstiegspunkt: „entrypoint“ \(Heldix-API\), „clientEntrypoint“ oder „transformers“/],
      [{ entrypoint: null, transformers: [] }, /fehlt ein Einstiegspunkt/],
      [{ entrypoint: undefined, clientEntrypoint: 'dev.x.Start' }, /greift in Minecraft ein .*nennt aber keine Minecraft-Version/],
      [{ transformers: ['dev.x.T'], minecraft: [] }, /nennt aber keine Minecraft-Version/],
      [{ clientEntrypoint: 'nicht gültig', minecraft: ['26.3'] }, /„clientEntrypoint“ in heldix\.addon\.json ist kein Klassenname/],
      [{ clientEntrypoint: 5, minecraft: ['26.3'] }, /„clientEntrypoint“/],
      [{ transformers: [5], minecraft: ['26.3'] }, /„transformers“ in heldix\.addon\.json muss eine Liste mit höchstens 50 Klassennamen sein/],
      [{ transformers: {}, minecraft: ['26.3'] }, /„transformers“/],
      [{ transformers: Array.from({ length: 51 }, (_, i) => `dev.x.T${i}`), minecraft: ['26.3'] }, /„transformers“/],
      [{ minecraft: '>=26.2' }, /„minecraft“ in heldix\.addon\.json muss eine Liste mit höchstens 50 Minecraft-Versionen sein/],
      [{ minecraft: ['26.2 || 26.3'] }, /„minecraft“/],
      [{ minecraft: ['*'] }, /„minecraft“/],
      [{ minecraft: [26.3] }, /„minecraft“/],
      [{ minecraft: Array.from({ length: 51 }, (_, i) => `26.${i}`) }, /„minecraft“/],
      [{ loaders: [] }, /„loaders“ in heldix\.addon\.json muss eine nicht leere Liste aus "heldix" und "fabric" sein/],
      [{ loaders: ['forge'] }, /„loaders“/],
      [{ loaders: ['heldix', 'heldix'] }, /„loaders“/],
      [{ loaders: 'heldix' }, /„loaders“/],
      [{ loader: '' }, /„loader“ in heldix\.addon\.json darf nicht leer sein/],
      [{ loader: 7 }, /„loader“/],
    ];
    for (const [meta, pattern] of bad) await inspectRejects(addonJar('v2', '1.0.0', { meta, extra: [cls('dev.x.T'), cls('dev.x.Start')] }), pattern);
    // Jede genannte Klasse muss in der JAR liegen
    await inspectRejects(
      addonJar('fehlt', '1.0.0', { meta: { entrypoint: undefined, clientEntrypoint: 'dev.x.Start', minecraft: ['26.3'] } }),
      /Die Klasse dev\.x\.Start \(aus „clientEntrypoint“ in heldix\.addon\.json\) fehlt in der JAR/,
    );
    await inspectRejects(
      addonJar('fehlt', '1.0.0', { meta: { transformers: ['dev.x.T', 'dev.x.Weg'], minecraft: ['26.3'] }, extra: [cls('dev.x.T')] }),
      /Die Klasse dev\.x\.Weg \(aus „transformers“ in heldix\.addon\.json\) fehlt in der JAR/,
    );
    // 50 Versionen gehen noch
    const many = await inspectAddonJar(addonJar('viele', '1.0.0', { meta: { minecraft: Array.from({ length: 50 }, (_, i) => `26.${i}`) } }));
    assert.equal(many.minecraft.length, 50);

    // Eine mitgebrachte heldix.mod.json (ältere Heldix-Mod) heißt: greift in Minecraft ein, auch ohne clientEntrypoint
    const modJson = entry('heldix.mod.json', JSON.stringify({ id: 'altmod', name: 'Alt', version: '1.0.0', minecraft: '26.3', entrypoint: 'dev.x.Start' }));
    const legacy = await inspectAddonJar(addonJar('altmod', '1.0.0', { meta: { minecraft: ['26.3'] }, extra: [modJson] }));
    assert.deepEqual([legacy.access, legacy.minecraft, legacy.loaders, legacy.clientEntrypoint], ['minecraft', ['26.3'], ['heldix'], null]);
    await inspectRejects(
      addonJar('altmod', '1.0.0', { extra: [modJson] }),
      /enthält heldix\.mod\.json \(Heldix-Mod\) und greift damit in Minecraft ein, heldix\.addon\.json nennt aber keine Minecraft-Version/,
    );
    // Nur heldix.mod.json: Für den Store fehlt heldix.addon.json
    await inspectRejects(buildZip([modJson, entry('dev/x/Start.class', classFile())]), /fehlt heldix\.addon\.json\. Heldix-Mods \(heldix\.mod\.json\) brauchen für den Store/);

    // Ein Ordner mit dem Namen der Klasse zählt nicht
    await inspectRejects(
      addonJar('ordner', '1.0.0', { meta: { entrypoint: undefined, transformers: ['dev.x.T'], minecraft: ['26.3'] }, extra: [entry('dev/x/T.class/', '', 0)] }),
      /Die Klasse dev\.x\.T/,
    );
  });

  test('heldix.addon.json: fehlt, kaputt, falsche Felder, Einstiegsklasse fehlt', async () => {
    await inspectRejects(buildZip([entry('a.class', classFile())]), /fehlt heldix\.addon\.json/);
    await inspectRejects(buildZip([entry('heldix.addon.json/', '', 0)]), /fehlt heldix\.addon\.json/);
    await inspectRejects(addonJar('x', '1.0.0', { rawMeta: '{kaputt' }), /kein gültiges JSON/);
    await inspectRejects(addonJar('x', '1.0.0', { rawMeta: '[1]' }), /kein JSON-Objekt/);
    const bad: [Record<string, unknown>, RegExp][] = [
      [{ id: 'Gross' }, /„id“/],
      [{ id: undefined }, /„id“/],
      [{ version: '1.0' }, /„version“/],
      [{ version: '${version}' }, /„version“/],
      [{ api: 0 }, /„api“/],
      [{ api: 100 }, /„api“/],
      [{ api: '2' }, /„api“/],
      [{ entrypoint: undefined }, /„entrypoint“/],
      [{ entrypoint: 'nicht gültig' }, /„entrypoint“/],
      [{ entrypoint: '../Boese' }, /„entrypoint“/],
      [{ name: undefined }, /„name“/],
      [{ name: '   ' }, /„name“ in heldix\.addon\.json darf nicht leer sein/],
      [{ name: 'x'.repeat(41) }, /„name“ in heldix\.addon\.json ist zu lang/],
      [{ name: 'a\nb' }, /„name“ in heldix\.addon\.json enthält Zeichen/],
      [{ description: 'x'.repeat(201) }, /„description“ in heldix\.addon\.json ist zu lang \(höchstens 200/],
      [{ description: 5 }, /„description“/],
      [{ authors: 'Anna' }, /„authors“/],
      [{ authors: ['a', 'b', 'c', 'd', 'e', 'f'] }, /„authors“/],
      [{ authors: [''] }, /„authors \(Eintrag 1\)“/],
    ];
    for (const [meta, pattern] of bad) {
      // Die Einstiegsklasse legt addonJar nur bei einem gültigen Klassennamen an.
      const jar = addonJar('feld', '1.0.0', { meta });
      await inspectRejects(jar, pattern);
    }
    // Einstiegsklasse fehlt in der JAR
    const missing = buildZip([entry('heldix.addon.json', JSON.stringify({ id: 'a', name: 'A', version: '1.0.0', entrypoint: 'dev.a.Haupt', api: 1 }))]);
    await inspectRejects(missing, /Einstiegsklasse dev\.a\.Haupt .* fehlt in der JAR/);
  });

  test('heldix.addon.json als Zip-Bombe oder zu groß; kaputte Klassen; Pfade mit „..“', async () => {
    // 60 KB Leerzeichen komprimieren auf wenige Byte: über 100:1
    const padded = `{"id":"bombe","name":"B","version":"1.0.0","entrypoint":"dev.b.Haupt","api":1${' '.repeat(60_000)}}`;
    assert.ok(padded.length / deflateRawSync(Buffer.from(padded)).length > 100);
    await inspectRejects(addonJar('bombe', '1.0.0', { rawMeta: padded }), /stark komprimiert \(über 100:1\).*Zip-Bombe/);
    // Gespeichert (ohne Kompression), aber über 64 KB
    const large = buildZip([entry('heldix.addon.json', `{"x":"${'a'.repeat(70_000)}"}`, 0)]);
    await inspectRejects(large, /heldix\.addon\.json ist zu groß/);
    // Klassendatei mit falscher Prüfsumme
    await inspectRejects(addonJar('crc', '1.0.0', { extra: [entry('dev/x/Kaputt.class', classFile('java/net/URL'), 8, { crc: 1 })] }), /Prüfsumme/);
    // Traversal und verschlüsselte Einträge auch in einer sonst gültigen JAR
    await inspectRejects(addonJar('pfad', '1.0.0', { extra: [entry('../../.minecraft/mods/boese.jar', 'x')] }), /ungültigen Pfad/);
    await inspectRejects(addonJar('geheim', '1.0.0', { extra: [entry('dev/x/Geheim.class', classFile(), 8, { flags: 0x0001 })] }), /verschlüsselte/);
  });
});

describe('Bildgröße aus dem Dateikopf', () => {
  test('PNG und JPEG (Standard, progressiv, mit Füllbytes); alles andere: null', () => {
    assert.deepEqual(imageInfo(png(1280, 720)), { type: 'png', width: 1280, height: 720 });
    assert.deepEqual(imageInfo(png(3840, 2160)), { type: 'png', width: 3840, height: 2160 });
    assert.deepEqual(imageInfo(jpeg(1920, 1080)), { type: 'jpeg', width: 1920, height: 1080 });
    assert.deepEqual(imageInfo(jpeg(800, 600, 0xc2)), { type: 'jpeg', width: 800, height: 600 });
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.from([0x80, 0x02, 0xe0, 0x01]), Buffer.alloc(30)]);
    const bmp = Buffer.concat([Buffer.from('BM', 'latin1'), Buffer.alloc(60)]);
    const webp = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1'), Buffer.alloc(30)]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"></svg>');
    const truncatedPng = png(1280, 720).subarray(0, 20);
    const pngWithoutIhdr = Buffer.concat([png(1, 1).subarray(0, 8), Buffer.from([0, 0, 0, 13]), Buffer.from('IDAT', 'latin1'), Buffer.alloc(21)]);
    const zeroPng = png(0, 720);
    // JPEG: Bilddaten (SOS) vor der Größe, abgeschnitten, kein Marker
    const jpegNoSof = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0xff, 0xd9]);
    const jpegCut = jpeg(1920, 1080).subarray(0, 24);
    const jpegGarbage = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56]);
    const jpegZero = jpeg(0, 100);
    for (const buf of [gif, bmp, webp, svg, truncatedPng, pngWithoutIhdr, zeroPng, jpegNoSof, jpegCut, jpegGarbage, jpegZero, Buffer.alloc(0), randomBytes(500)]) {
      assert.equal(imageInfo(buf), null);
    }
  });
});
