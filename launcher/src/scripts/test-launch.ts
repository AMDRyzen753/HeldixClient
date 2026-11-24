// Test: installiert eine Version und startet sie mit einem Offline-Konto.
// Aufruf: npm run test:launch -- [version] [heldix|fabric|vanilla] [timeoutSekunden] [--autotest]
//
// Ohne --autotest: Spiel bis zum Hauptmenü starten, Log prüfen, nach 15 s beenden.
// Mit --autotest (nur heldix): zusätzlich den Heldix-Autotest (mod/autotest) installieren. Er klickt
// sich durch Hauptmenü, Heldix-Menü, eine Testwelt, HUD-Editor und Zoom, prüft alles und macht
// Screenshots (Ordner wird am Ende angezeigt).
// Nutzt einen eigenen Testordner (<Datenordner>/test-instances).

import AdmZip from 'adm-zip';
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { InstanceLoader } from '../shared/api';
import { CLIENT_MOD_PREFIX, DATA_DIR_NAME } from '../main/config';
import { offlineUuid } from '../main/core/auth';
import { InstanceStore } from '../main/core/instances';
import { buildLaunchArguments, startGame } from '../main/core/launch';
import { getVersionManifest } from '../main/core/mojang';
import { createPaths, defaultDataRoot } from '../main/core/paths';
import { prepareGame } from '../main/core/prepare';
import { buildActivity, parseStatusLine } from '../main/core/presence';

const READY_PATTERNS = [/Sound engine started/i, /Created: \d+x\d+x\d+ minecraft:textures\/atlas\/blocks/i];
const FAILURE_PATTERNS = [
  /---- Minecraft Crash Report ----/,
  /Patch ".*" fehlgeschlagen/,
  /konnte nicht verändert werden/,
  /Transformer .* konnte nicht geladen werden/,
  /Incompatible mods found/i,
  /Mixin apply failed/i,
];

async function main(): Promise<void> {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'));
  const [versionArg, loaderArg = 'heldix', timeoutArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const autotest = flags.includes('--autotest');
  const paths = createPaths(process.env.HELDIX_DATA_DIR ?? defaultDataRoot(DATA_DIR_NAME));
  const versionId = versionArg || (await getVersionManifest(paths)).manifest.latest.release;
  const loader = loaderArg as InstanceLoader;
  const timeoutSeconds = Number(timeoutArg ?? (autotest ? 600 : 240));
  const resources = path.join(__dirname, '..', '..', 'resources');
  const modRepo = path.join(__dirname, '..', '..', '..', 'mod');
  const gameDir = path.join(paths.root, 'test-instances', `${versionId}-${loader}${autotest ? '-autotest' : ''}`);
  console.log(`Datenordner: ${paths.root}`);
  console.log(`Teste ${versionId} (${loader}${autotest ? ', Autotest' : ''}) in ${gameDir}`);
  if (autotest && loader !== 'heldix') throw new Error('--autotest gibt es nur für heldix');

  if (loader === 'heldix') {
    await new InstanceStore(createPaths(path.join(paths.root, 'test-instances'))).installBundledAddons(gameDir, path.join(resources, 'heldix-addons'));
  }
  const screenshots = path.join(gameDir, 'screenshots');
  if (autotest) {
    // Autotest-Mod, kaputtes Addon und eine Fabric-Attrappe (muss vom Loader erkannt und übersprungen werden)
    const modsDir = path.join(gameDir, 'mods');
    const addonsDir = path.join(gameDir, 'heldix-addons');
    await mkdir(modsDir, { recursive: true });
    await mkdir(addonsDir, { recursive: true });
    const autotestLibs = path.join(modRepo, 'autotest', 'build', 'libs');
    const autotestJar = (await readdir(autotestLibs)).find((f) => /^heldix-autotest-.+\.jar$/.test(f));
    if (!autotestJar) throw new Error('mod/autotest ist nicht gebaut – erst "npm run mod" ausführen');
    for (const old of (await readdir(modsDir)).filter((f) => f.startsWith('heldix-autotest-'))) await rm(path.join(modsDir, old));
    await copyFile(path.join(autotestLibs, autotestJar), path.join(modsDir, autotestJar));
    await copyFile(path.join(modRepo, 'build', 'test-addons', 'heldix-addon-kaputt.jar'), path.join(addonsDir, 'heldix-addon-kaputt.jar'));
    const dummy = new AdmZip();
    dummy.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'fabric-attrappe', version: '1.0.0' })));
    dummy.writeZip(path.join(modsDir, 'fabric-attrappe.jar'));
    // Sauberer Ausgangszustand: keine alten Bilder, Welten oder verschobenen HUD-Elemente
    await rm(screenshots, { recursive: true, force: true });
    await rm(path.join(gameDir, 'saves'), { recursive: true, force: true });
    await rm(path.join(gameDir, 'config', 'heldixclient.json'), { force: true });
  }

  let lastStage = '';
  const started = Date.now();
  const prepared = await prepareGame({
    paths,
    versionId,
    loader,
    gameDir,
    clientModsDir: path.join(resources, 'client-mods'),
    clientModPrefix: CLIENT_MOD_PREFIX,
    loaderDir: path.join(resources, 'heldix-loader'),
    onProgress: (p) => {
      if (p.stage !== lastStage || p.done === p.total) {
        if (p.total > 0) console.log(`  ${p.stage}: ${p.done}/${p.total}`);
        lastStage = p.stage;
      }
    },
    onInfo: (m) => console.log(`  ${m}`),
  });
  console.log(`Vorbereitet in ${((Date.now() - started) / 1000).toFixed(1)} s, Client-Mod: ${prepared.clientModLoaded}, Loader: ${prepared.loaderVersion ?? '-'}`);

  const name = 'HeldixTester';
  const args = buildLaunchArguments({
    paths,
    version: prepared.version,
    javaPath: prepared.javaPath,
    classpath: prepared.classpath,
    gameDir: prepared.gameDir,
    nativesDir: prepared.nativesDir,
    legacyAssetsDir: prepared.legacyAssetsDir,
    loggingConfig: prepared.loggingConfig,
    account: { name, uuid: offlineUuid(name), accessToken: '0', userType: 'legacy' },
    memoryMb: 2048,
    resolution: { width: 854, height: 480 },
    extraJvmArgs: [...prepared.loaderJvmArgs, ...(autotest ? ['-Dheldix.autotest=true'] : [])],
    launcherName: 'HeldixClient',
    launcherVersion: 'test',
  });
  if (args.some((a) => a.includes('fabric-loader') || a.includes('KnotClient')) && loader !== 'fabric') {
    throw new Error('Heldix-Instanz würde mit Fabric starten');
  }

  let ready = false;
  let failure: string | null = null;
  let autotestResult: 'ok' | 'failed' | null = null;
  const loaderLines: string[] = [];
  const clientLines: string[] = [];
  const addonLines: string[] = [];
  const statusModes: string[] = [];
  const game = startGame(prepared.javaPath, args, prepared.gameDir, (lines) => {
    for (const line of lines) {
      if (/HeldixClient|Heldix|AUTOTEST|Fabric Loader|Loading Minecraft|ERROR|FATAL|Exception/i.test(line.text) || line.level === 'ERROR') {
        console.log(`  [game] ${line.text}`);
      }
      if (/Heldix Loader .* startet/.test(line.text)) loaderLines.push(line.text);
      if (/HeldixClient .* geladen/.test(line.text)) clientLines.push(line.text);
      if (/Heldix-Addon .* geladen/.test(line.text)) addonLines.push(line.text);
      const status = parseStatusLine(line.text);
      if (status) {
        statusModes.push(status.mode);
        const activity = buildActivity({ phase: 'running', minecraft: versionId, loader, startedAt: started, status, showServer: true, clientVersion: 'test' });
        console.log(`  [discord] ${activity.details} – ${activity.state}`);
      }
      if (!failure && FAILURE_PATTERNS.some((p) => p.test(line.text))) failure = line.text;
      if (/HELDIX-AUTOTEST: ERFOLGREICH/.test(line.text)) autotestResult = 'ok';
      if (/HELDIX-AUTOTEST: FEHLGESCHLAGEN/.test(line.text)) {
        autotestResult = 'failed';
        failure ??= line.text;
      }
      if (!ready && READY_PATTERNS.some((p) => p.test(line.text))) {
        ready = true;
        console.log(`  Spiel ist geladen nach ${((Date.now() - started) / 1000).toFixed(1)} s${autotest ? ', Autotest läuft …' : ', beende in 15 s …'}`);
        if (!autotest) setTimeout(() => game.process.kill(), 15000);
      }
    }
  });

  const timeout = setTimeout(() => {
    failure ??= `Zeitüberschreitung nach ${timeoutSeconds} s`;
    game.process.kill();
  }, timeoutSeconds * 1000);

  const code = await game.exited;
  clearTimeout(timeout);
  console.log(`Prozess beendet (Code ${code})`);
  if (loader === 'heldix') {
    if (loaderLines.length === 0) failure ??= 'Heldix Loader ist nicht gestartet';
    if (clientLines.length === 0) failure ??= 'HeldixClient wurde nicht geladen';
    if (addonLines.length === 0) failure ??= 'Kein Heldix-Addon geladen';
  }
  if (loader !== 'heldix' && (loaderLines.length > 0 || clientLines.length > 0)) failure ??= `${loader}-Instanz darf den Heldix Loader nicht laden`;
  if (autotest && autotestResult === null) failure ??= 'Autotest hat kein Ergebnis gemeldet';
  if (loader === 'heldix' && !statusModes.includes('menu')) failure ??= 'HeldixClient hat keinen Status (Hauptmenü) für Discord gemeldet';
  if (autotest && !statusModes.includes('singleplayer')) failure ??= 'HeldixClient hat den Einzelspieler-Status nicht gemeldet';
  if (!ready) failure ??= 'Spiel hat den Ladebildschirm nicht erreicht';
  if (autotest) console.log(`Screenshots: ${screenshots}`);
  if (failure) {
    console.error(`FEHLGESCHLAGEN: ${failure}`);
    process.exit(1);
  }
  console.log('ERFOLGREICH');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
