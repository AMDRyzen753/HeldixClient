// Prüft „Mods & Addons“ (core/content.ts): heldix.addon.json Version 2 (Zugriff, Minecraft-Versionen, Loader), die
// Prüfung gegen die Instanz mit deutschen Gründen, das Einsortieren von JARs nach ihrer Beschreibung („Datei hinzufügen“)
// und die gemeinsame Liste aus mods/ und heldix-addons/. Ohne Netz, alles in einem temporären Ordner.
//
// Aufruf: npm run test:content

import AdmZip from 'adm-zip';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  fitsMinecraft,
  importContentFiles,
  listAllContent,
  loaderReason,
  minecraftMatches,
  minecraftReason,
  parseAddonDescriptor,
  routeJar,
  applyPendingDisable,
  setContentEnabled,
  type ContentContext,
} from '../main/core/content';
import { check, finish } from './testkit';

function jar(entries: Record<string, unknown>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content)));
  }
  zip.addFile('test/Main.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  return zip.toBuffer();
}

const addon = (id: string, version: string, extra: Record<string, unknown> = {}) =>
  jar({ 'heldix.addon.json': { id, name: id.charAt(0).toUpperCase() + id.slice(1), version, api: 1, entrypoint: 'test.Main', ...extra } });
const fabricMod = (id: string, version: string) => jar({ 'fabric.mod.json': { schemaVersion: 1, id, name: id, version } });
const heldixMod = (id: string, extra: Record<string, unknown> = {}, withFabric = false) =>
  jar({ 'heldix.mod.json': { id, name: id, version: '1.0.0', entrypoints: { client: ['test.Main'] }, ...extra }, ...(withFabric ? { 'fabric.mod.json': { schemaVersion: 1, id, version: '1.0.0' } } : {}) });

function throwsMessage(task: () => unknown): string {
  try {
    task();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function main(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-content-'));
  try {
    // ---------- heldix.addon.json Version 2 ----------
    const old = parseAddonDescriptor({ id: 'uhr', entrypoint: 'a.B' });
    check('v2: altes Addon (nur entrypoint) = Zugriff api, jede Version', old.access === 'api' && old.minecraft.length === 0 && old.transformers.length === 0 && old.loader === null, old);
    const client = parseAddonDescriptor({ clientEntrypoint: 'a.Start', minecraft: ['26.3'], loader: '>=2.4.0' });
    check('v2: clientEntrypoint = Zugriff minecraft, entrypoint optional', client.access === 'minecraft' && client.entrypoint === null && client.minecraft.join() === '26.3' && client.loader === '>=2.4.0', client);
    const transformer = parseAddonDescriptor({ entrypoint: 'a.B', transformers: ['a.T1', 'a.T2'], minecraft: ['26.2', '26.3'] });
    check('v2: transformers = Zugriff minecraft', transformer.access === 'minecraft' && transformer.transformers.length === 2, transformer);
    check('v2: minecraft als einzelner Text', parseAddonDescriptor({ entrypoint: 'a.B', minecraft: '26.3' }).minecraft.join() === '26.3');
    check('v2: Zugriff minecraft ohne „minecraft“ abgelehnt', /minecraft/.test(throwsMessage(() => parseAddonDescriptor({ clientEntrypoint: 'a.Start' }))));
    check('v2: ohne Einstiegspunkt abgelehnt', /Einstiegspunkt/.test(throwsMessage(() => parseAddonDescriptor({ id: 'x' }))));
    check('v2: transformers ungültig abgelehnt', /transformers/.test(throwsMessage(() => parseAddonDescriptor({ transformers: [1], minecraft: ['26.3'] }))));
    check('v2: leerer clientEntrypoint abgelehnt', /clientEntrypoint/.test(throwsMessage(() => parseAddonDescriptor({ entrypoint: 'a.B', clientEntrypoint: ' ' }))));

    // ---------- Minecraft- und Loader-Versionen ----------
    check('Minecraft: genaue Version', minecraftMatches('26.3', '26.3') && !minecraftMatches('26.3.1', '26.3') && !minecraftMatches('26.2', '26.3'));
    check('Minecraft: Regeln wie im Heldix Loader', minecraftMatches('26.3', '26.x') && minecraftMatches('26.3', '26.2 || 26.3') && minecraftMatches('26.3', '>=26.2') && !minecraftMatches('26.1', '>=26.2') && minecraftMatches('1.21.11', '*'));
    check('Minecraft: Snapshots nur genau', minecraftMatches('25w45a', '25w45a') && !minecraftMatches('25w45a', '25w46a'));
    check('Minecraft: leere Liste = jede Version', fitsMinecraft('1.21.11', []) && fitsMinecraft('26.3', ['26.2', '26.3']) && !fitsMinecraft('26.4', ['26.2', '26.3']));
    check('Grund: „Nur für Minecraft 26.3“', minecraftReason(['26.3']) === 'Nur für Minecraft 26.3' && minecraftReason(['26.2', '26.3']) === 'Nur für Minecraft 26.2 und 26.3', minecraftReason(['26.2', '26.3']));
    check('Grund: lange Liste gekürzt', minecraftReason(['26.0', '26.1', '26.2', '26.3', '26.4']) === 'Nur für Minecraft 26.0, 26.1, 26.2 und 2 weitere');
    check('Loader: zu alt', loaderReason('>=2.4.0', '2.3.0') === 'Braucht Heldix Loader 2.4.0 oder neuer', loaderReason('>=2.4.0', '2.3.0'));
    check('Loader: passt / keine Angabe / unbekannte Version', loaderReason('>=2.4.0', '2.4.0') === null && loaderReason(null, '2.3.0') === null && loaderReason('>=9.0.0', null) === null);

    // ---------- JARs einsortieren ----------
    const src = path.join(tmp, 'quelle');
    await mkdir(src, { recursive: true });
    const file = async (name: string, data: Buffer) => {
      const target = path.join(src, name);
      await writeFile(target, data);
      return target;
    };
    const files = {
      addon: await file('uhr-1.1.0.jar', addon('uhr', '1.1.0')),
      mcAddon: await file('zeitlupe.jar', addon('zeitlupe', '1.0.0', { entrypoint: undefined, clientEntrypoint: 'z.Start', transformers: ['z.T'], minecraft: ['26.3'] })),
      newLoader: await file('neu.jar', addon('neu', '1.0.0', { loader: '>=9.0.0' })),
      broken: await file('kaputt-addon.jar', addon('kaputt', '1.0.0', { entrypoint: undefined, transformers: ['k.T'] })),
      bothFiles: await file('beides.jar', jar({ 'heldix.addon.json': { id: 'beides', name: 'Beides', version: '1.0.0', entrypoint: 'b.Main' }, 'fabric.mod.json': { schemaVersion: 1, id: 'beides', version: '1.0.0' } })),
      fabric: await file('sodium.jar', fabricMod('sodium', '0.6.0')),
      heldixMod: await file('altmod.jar', heldixMod('altmod', { minecraft: '26.3' })),
      heldixModFabric: await file('altmod-fabric.jar', heldixMod('altmodfabric', {}, true)),
      unknown: await file('raetsel.jar', jar({ 'README.txt': 'nichts' })),
      forge: await file('forge.jar', jar({ 'META-INF/mods.toml': 'modLoader="javafml"' })),
      quilt: await file('quilt.jar', jar({ 'quilt.mod.json': { quilt_loader: { id: 'q' } } })),
      garbage: await file('muell.jar', Buffer.from('kein zip')),
      zip: await file('pack.zip', Buffer.from('PK')),
      upper: await file('GROSS.JAR', fabricMod('gross', '1.0.0')),
    };
    const heldix: ContentContext = { loader: 'heldix', minecraft: '26.3', heldixClient: true, loaderVersion: '2.3.0' };
    const fabric: ContentContext = { loader: 'fabric', minecraft: '26.3', heldixClient: true, loaderVersion: '2.3.0' };
    const fabricOff: ContentContext = { ...fabric, heldixClient: false };
    const old262: ContentContext = { ...heldix, minecraft: '26.2' };
    const route = (f: string, ctx: ContentContext) => routeJar(f, ctx);
    const err = (f: string, ctx: ContentContext) => {
      const r = route(f, ctx);
      return 'error' in r ? r.error : '';
    };
    const kind = (f: string, ctx: ContentContext) => {
      const r = route(f, ctx);
      return 'error' in r ? `Fehler: ${r.error}` : `${r.kind}/${r.format}`;
    };
    check('einsortieren: heldix.addon.json → heldix-addons/', kind(files.addon, heldix) === 'addons/addon' && kind(files.addon, fabric) === 'addons/addon', kind(files.addon, heldix));
    check('einsortieren: Addon mit Minecraft-Zugriff → heldix-addons/', kind(files.mcAddon, heldix) === 'addons/addon');
    check('einsortieren: heldix.addon.json gewinnt vor fabric.mod.json', kind(files.bothFiles, fabric) === 'addons/addon');
    check('einsortieren: fabric.mod.json → mods/ (Fabric)', kind(files.fabric, fabric) === 'mods/fabric');
    check('einsortieren: heldix.mod.json → mods/ (Heldix)', kind(files.heldixMod, heldix) === 'mods/heldix-mod');
    check('einsortieren: Heldix-Mod mit fabric.mod.json läuft auch in Fabric', kind(files.heldixModFabric, fabric) === 'mods/heldix-mod');
    check('einsortieren: großgeschriebene Endung', kind(files.upper, fabric) === 'mods/fabric');
    check('Fehler: Fabric-Mod in Heldix-Instanz', /läuft nur in Fabric-Instanzen/.test(err(files.fabric, heldix)), err(files.fabric, heldix));
    check('Fehler: ältere Heldix-Mod in Fabric-Instanz', /läuft nur in Heldix-Instanzen/.test(err(files.heldixMod, fabric)), err(files.heldixMod, fabric));
    check('Fehler: Addon ohne HeldixClient', /braucht HeldixClient/.test(err(files.addon, fabricOff)), err(files.addon, fabricOff));
    check('Fehler: falsche Minecraft-Version', err(files.mcAddon, old262) === '„Zeitlupe“ passt nicht zu dieser Instanz: Nur für Minecraft 26.3.', err(files.mcAddon, old262));
    check('Fehler: ältere Heldix-Mod für andere Minecraft-Version', /Nur für Minecraft 26\.3/.test(err(files.heldixMod, old262)));
    check('Fehler: Loader zu alt', /Braucht Heldix Loader 9\.0\.0 oder neuer/.test(err(files.newLoader, heldix)), err(files.newLoader, heldix));
    check('Fehler: ungültige heldix.addon.json', /Ungültiges Addon: .*minecraft/.test(err(files.broken, heldix)), err(files.broken, heldix));
    check('Fehler: unbekannte JAR', /weder Fabric-Mod noch Heldix-Addon/.test(err(files.unknown, fabric)), err(files.unknown, fabric));
    check('Fehler: Forge-Mod', /Forge/.test(err(files.forge, fabric)) && /Quilt/.test(err(files.quilt, fabric)));
    check('Fehler: keine gültige JAR / keine JAR', /keine gültige JAR/.test(err(files.garbage, fabric)) && /keine JAR-Datei/.test(err(files.zip, fabric)), [err(files.garbage, fabric), err(files.zip, fabric)]);
    check('Fehler: Vanilla', /Vanilla/.test(err(files.fabric, { loader: 'vanilla', minecraft: '26.3' })));

    // ---------- Datei hinzufügen ----------
    const game = path.join(tmp, 'instanz');
    await mkdir(path.join(game, 'mods'), { recursive: true });
    await mkdir(path.join(game, 'heldix-addons'), { recursive: true });
    // ältere Uhr (ausgeschaltet) und eine verwaltete Fabric API
    await writeFile(path.join(game, 'heldix-addons', 'uhr-1.0.0.jar.disabled'), addon('uhr', '1.0.0'));
    await writeFile(path.join(game, 'mods', 'fabric-api-1.0.jar'), fabricMod('fabric-api', '1.0'));
    await writeFile(path.join(game, 'mods', '.heldix-managed.json'), JSON.stringify(['fabric-api-1.0.jar']));
    await writeFile(path.join(game, 'mods', 'sodium-0.5.jar'), fabricMod('sodium', '0.5.0'));
    await writeFile(path.join(game, 'mods', '.heldix-modrinth.json'), JSON.stringify({ 'sodium-0.5.jar': { projectId: 'AANobbMI', versionId: 'abc', title: 'Sodium' } }));
    const fakeApi = await file('fabric-api-2.0.jar', fabricMod('fabric-api', '2.0'));
    const result = await importContentFiles(game, fabric, [files.addon, files.mcAddon, files.fabric, files.unknown, fakeApi, files.upper]);
    const addonsDir = await readdir(path.join(game, 'heldix-addons'));
    const modsDir = await readdir(path.join(game, 'mods'));
    check('hinzufügen: Addons und Mods im richtigen Ordner', result.added.map((a) => `${a.kind}:${a.file}`).join() === 'addons:uhr-1.1.0.jar,addons:zeitlupe.jar,mods:sodium.jar,mods:GROSS.jar'
      && addonsDir.includes('zeitlupe.jar') && modsDir.includes('sodium.jar') && modsDir.includes('GROSS.jar'), result);
    check('hinzufügen: unbekannte JAR und verwaltete Mod abgelehnt', result.errors.length === 2 && /weder Fabric-Mod/.test(result.errors[0]) && /bringt der Launcher schon selbst mit/.test(result.errors[1]), result.errors);
    check('hinzufügen: ältere Version derselben ID ersetzt (auch ausgeschaltete)', addonsDir.includes('uhr-1.1.0.jar') && !addonsDir.includes('uhr-1.0.0.jar.disabled') && !modsDir.includes('sodium-0.5.jar') && modsDir.includes('fabric-api-1.0.jar'), { addonsDir, modsDir });
    const index = JSON.parse(await readFile(path.join(game, 'mods', '.heldix-modrinth.json'), 'utf8')) as Record<string, unknown>;
    check('hinzufügen: ersetzte Modrinth-Mod aus dem Index', !('sodium-0.5.jar' in index), index);
    const again = await importContentFiles(game, fabric, [path.join(game, 'mods', 'sodium.jar')]);
    check('hinzufügen: Datei aus dem eigenen Ordner bleibt', again.added.length === 1 && (await readdir(path.join(game, 'mods'))).includes('sodium.jar'), again);

    // ---------- eine Liste für mods/ und heldix-addons/ ----------
    await writeFile(path.join(game, 'mods', 'altmod.jar'), heldixMod('altmod', { minecraft: '26.2' }));
    await writeFile(path.join(game, 'mods', 'falsch-addon.jar'), addon('falsch', '1.0.0'));
    await writeFile(path.join(game, 'heldix-addons', 'neu.jar'), addon('neu', '1.0.0', { loader: '>=9.0.0' }));
    const items = await listAllContent(game, { ...heldix, loader: 'fabric' });
    const by = (file: string) => items.find((i) => i.file === file);
    check('Liste: beide Ordner, verwaltete zuerst', items.length === 8 && items[0].file === 'fabric-api-1.0.jar' && items[0].managed, items.map((i) => i.file));
    check('Liste: Ordner und Format', by('sodium.jar')?.kind === 'mods' && by('sodium.jar')?.format === 'fabric' && by('sodium.jar')?.access === null
      && by('uhr-1.1.0.jar')?.kind === 'addons' && by('uhr-1.1.0.jar')?.format === 'addon');
    const zeitlupe = by('zeitlupe.jar');
    check('Liste: Addon mit Minecraft-Zugriff', zeitlupe?.access === 'minecraft' && zeitlupe.minecraft.join() === '26.3' && zeitlupe.error === null && by('uhr-1.1.0.jar')?.access === 'api', zeitlupe);
    check('Liste: ältere Heldix-Mod = greift in Minecraft ein', by('altmod.jar')?.format === 'heldix-mod' && by('altmod.jar')?.access === 'minecraft', by('altmod.jar'));
    check('Liste: Heldix-Mod ohne fabric.mod.json in Fabric', /läuft nur in Heldix-Instanzen/.test(by('altmod.jar')?.error ?? ''), by('altmod.jar')?.error);
    check('Liste: Addon im Ordner mods', /Heldix-Addon im Ordner mods/.test(by('falsch-addon.jar')?.error ?? ''), by('falsch-addon.jar')?.error);
    check('Liste: Loader zu alt', by('neu.jar')?.error === 'Braucht Heldix Loader 9.0.0 oder neuer', by('neu.jar')?.error);
    const other = await listAllContent(game, { ...heldix, minecraft: '26.2' });
    check('Liste: andere Minecraft-Version', other.find((i) => i.file === 'zeitlupe.jar')?.error === 'Nur für Minecraft 26.3' && other.find((i) => i.file === 'uhr-1.1.0.jar')?.error === null);
    const off = await listAllContent(game, fabricOff);
    check('Liste: Addons ohne HeldixClient', /HeldixClient ist in dieser Instanz aus/.test(off.find((i) => i.file === 'uhr-1.1.0.jar')?.error ?? ''));
    check('Liste: Vanilla hat keine', (await listAllContent(game, { loader: 'vanilla', minecraft: '26.3' })).length === 0);
    await setContentEnabled(game, 'addons', 'zeitlupe.jar', false);
    // im Spiel ausgeschaltet, Datei gesperrt: heldix-addons/.ausschalten
    await writeFile(path.join(game, 'heldix-addons', '.ausschalten'), 'uhr-1.1.0.jar\n');
    check('im Spiel ausgeschaltet (.ausschalten): gilt schon als aus', (await listAllContent(game, fabric)).find((i) => i.file === 'uhr-1.1.0.jar')?.enabled === false);
    await setContentEnabled(game, 'addons', 'uhr-1.1.0.jar', true);
    check('wieder an im Launcher: Vormerkung gestrichen', (await listAllContent(game, fabric)).find((i) => i.file === 'uhr-1.1.0.jar')?.enabled === true && !(await readdir(path.join(game, 'heldix-addons'))).includes('.ausschalten'));
    await writeFile(path.join(game, 'heldix-addons', '.ausschalten'), 'uhr-1.1.0.jar\n../boese.jar\n');
    await applyPendingDisable(game);
    const afterOff = await readdir(path.join(game, 'heldix-addons'));
    check('Vormerkung ausgeführt: .jar.disabled, Liste weg', afterOff.includes('uhr-1.1.0.jar.disabled') && !afterOff.includes('uhr-1.1.0.jar') && !afterOff.includes('.ausschalten'), afterOff.join(', '));
    check('ausschalten: Addon wird .jar.disabled', (await readdir(path.join(game, 'heldix-addons'))).includes('zeitlupe.jar.disabled') && (await listAllContent(game, fabric)).find((i) => i.id === 'zeitlupe')?.enabled === false);
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  finish('Mods & Addons');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
