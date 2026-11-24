// Test: installiert eine Version und startet sie mit einem Offline-Konto.
// Aufruf: npm run test:launch -- [version] [heldix|fabric|vanilla] [timeoutSekunden] [--autotest] [--world=<Ordner>]
//          [--graphics=vulkan|default|opengl] [--no-tuning] [--benchmark[=Sekunden]] [--shader=<stil>] [--boost] [--size=BxH]
//
// Grafik wie im Launcher: Standard ist Vulkan mit abgestimmten JVM-Einstellungen.
// --benchmark (nur heldix): misst die FPS an einer festen Stelle einer festen Welt (siehe mod/autotest Benchmark).
//
// Ohne --autotest: Spiel bis zum Hauptmenü starten, Log prüfen, nach 15 s beenden.
// Mit --autotest (nur heldix): zusätzlich den Heldix-Autotest (mod/autotest) installieren. Er klickt
// sich durch Hauptmenü, Heldix-Menü, eine Testwelt, HUD-Editor und Zoom, prüft alles und macht
// Screenshots (Ordner wird am Ende angezeigt).
// Nutzt einen eigenen Testordner (<Datenordner>/test-instances).

import AdmZip from 'adm-zip';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { GraphicsApi, InstanceLoader } from '../shared/api';
import { CLIENT_MOD_PREFIX, DATA_DIR_NAME } from '../main/config';
import { offlineUuid } from '../main/core/auth';
import { InstanceStore } from '../main/core/instances';
import { buildLaunchArguments, startGame } from '../main/core/launch';
import { GraphicsWatch, graphicsArguments, tunedJvmArguments } from '../main/core/performance';
import { getVersionManifest } from '../main/core/mojang';
import { createPaths, defaultDataRoot } from '../main/core/paths';
import { prepareGame } from '../main/core/prepare';
import { buildActivity, parseStatusLine } from '../main/core/presence';
import { validateQuickPlay } from '../main/core/quickplay';

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
  const flag = (name: string) => flags.find((f) => f === `--${name}` || f.startsWith(`--${name}=`))?.split('=')[1];
  const benchmarkFlag = flags.find((f) => f === '--benchmark' || f.startsWith('--benchmark='));
  const benchmark = benchmarkFlag != null;
  const benchmarkSeconds = Number(flag('benchmark') ?? 20);
  const autotest = flags.includes('--autotest') || benchmark;
  const graphicsApi = (flag('graphics') ?? 'vulkan') as GraphicsApi;
  if (!['vulkan', 'default', 'opengl'].includes(graphicsApi)) throw new Error(`Unbekannte Grafik-API "${graphicsApi}"`);
  const tuning = !flags.includes('--no-tuning');
  const size = /^(\d+)x(\d+)$/.exec(flag('size') ?? (benchmark ? '1600x900' : '854x480'));
  if (!size) throw new Error('--size erwartet z. B. 1600x900');
  // Direktstart (Quick Play) in eine Welt aus saves/ der Testinstanz
  const world = flags.find((f) => f.startsWith('--world='))?.slice('--world='.length);
  const paths = createPaths(process.env.HELDIX_DATA_DIR ?? defaultDataRoot(DATA_DIR_NAME));
  const versionId = versionArg || (await getVersionManifest(paths)).manifest.latest.release;
  const loader = loaderArg as InstanceLoader;
  const timeoutSeconds = Number(timeoutArg ?? (benchmark ? 900 : autotest ? 600 : 240));
  const resources = path.join(__dirname, '..', '..', 'resources');
  const modRepo = path.join(__dirname, '..', '..', '..', 'mod');
  const gameDir = path.join(paths.root, 'test-instances', `${versionId}-${loader}${benchmark ? '-benchmark' : autotest ? '-autotest' : ''}`);
  console.log(`Datenordner: ${paths.root}`);
  console.log(`Teste ${versionId} (${loader}${benchmark ? ', Benchmark' : autotest ? ', Autotest' : ''}, Grafik ${graphicsApi}${tuning ? ', JVM abgestimmt' : ''}) in ${gameDir}`);
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
    // neueste JAR nehmen: nach einem Versionswechsel liegt die alte noch im Build-Ordner
    const candidates = (await readdir(autotestLibs)).filter((f) => /^heldix-autotest-.+\.jar$/.test(f));
    const built = await Promise.all(candidates.map(async (f) => ({ f, time: (await stat(path.join(autotestLibs, f))).mtimeMs })));
    const autotestJar = built.sort((a, b) => b.time - a.time)[0]?.f;
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
  const graphicsArgs = graphicsArguments(graphicsApi, prepared.clientJar);
  const tuningArgs = tuning ? tunedJvmArguments(prepared.javaMajor, []) : [];
  const testArgs: string[] = [];
  if (autotest) testArgs.push('-Dheldix.autotest=true');
  if (autotest && graphicsArgs.length) testArgs.push(`-Dheldix.autotest.backend=${graphicsApi === 'vulkan' ? 'Vulkan' : 'OpenGL'}`);
  if (benchmark) {
    testArgs.push('-Dheldix.benchmark=true', `-Dheldix.benchmark.seconds=${benchmarkSeconds}`);
    if (flag('shader')) testArgs.push(`-Dheldix.benchmark.shader=${flag('shader')}`);
    if (flags.includes('--boost')) testArgs.push('-Dheldix.benchmark.boost=true');
  }
  console.log(`Grafik-Argumente: ${graphicsArgs.join(' ') || '(keine)'}; JVM: ${tuningArgs.join(' ') || '(Standard)'}`);
  const graphicsWatch = new GraphicsWatch(graphicsArgs.length ? graphicsApi : 'default');
  const benchmarkLines: string[] = [];
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
    resolution: { width: Number(size[1]), height: Number(size[2]) },
    extraJvmArgs: [...prepared.loaderJvmArgs, ...tuningArgs, ...testArgs],
    extraGameArgs: graphicsArgs,
    quickPlay: world ? await validateQuickPlay(gameDir, 'world', world) : undefined,
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
      if (!graphicsWatch.backend) {
        graphicsWatch.push(line.text);
        if (graphicsWatch.backend) console.log(`  Grafik-API laut Minecraft: ${graphicsWatch.backend}${graphicsWatch.fellBack ? ' (Vulkan nicht verfügbar, OpenGL als Ersatz)' : ''}`);
      }
      const bench = /HELDIX-BENCHMARK: (.*)/.exec(line.text);
      if (bench) benchmarkLines.push(bench[1]);
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
  if (loader === 'heldix' && !world && !statusModes.includes('menu')) failure ??= 'HeldixClient hat keinen Status (Hauptmenü) für Discord gemeldet';
  if (autotest && !statusModes.includes('singleplayer')) failure ??= 'HeldixClient hat den Einzelspieler-Status nicht gemeldet';
  if (world && !statusModes.includes('singleplayer')) failure ??= `Direktstart: Welt „${world}“ wurde nicht betreten`;
  if (world && statusModes[0] !== 'singleplayer') failure ??= `Direktstart: zuerst kam ${statusModes[0] ?? 'nichts'} statt der Welt`;
  if (!ready) failure ??= 'Spiel hat den Ladebildschirm nicht erreicht';
  if (graphicsWatch.crashedDuringGraphicsStart(code)) failure ??= 'Absturz beim Start der Grafik (Vulkan)';
  if (benchmark && benchmarkLines.length === 0) failure ??= 'Benchmark hat kein Ergebnis gemeldet';
  for (const result of benchmarkLines) console.log(`BENCHMARK ${result}`);
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
