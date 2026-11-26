// Test: installiert eine Version und startet sie mit einem Offline-Konto.
// Aufruf: npm run test:launch -- [version] [heldix|fabric|vanilla] [timeoutSekunden] [--autotest] [--world=<Ordner>]
//          [--graphics=vulkan|default|opengl] [--no-tuning] [--benchmark[=Sekunden]] [--shader=<stil>] [--engine=dezent|kraeftig] [--boost] [--size=BxH]
//          nur fabric: [--no-heldix] (ohne HeldixClient) [--perf] (Leistungs-Paket installieren) [--shaderpack=an|aus] (Iris-Pack ein/aus)
//
// Grafik wie im Launcher: Standard ist Vulkan mit abgestimmten JVM-Einstellungen.
// --benchmark (nur heldix): misst die FPS an einer festen Stelle einer festen Welt (siehe mod/autotest Benchmark).
//
// --gui-scale=N setzt die GUI-Skalierung (0 = automatisch), z. B. um große Menüs zu prüfen.
// Ohne --autotest: Spiel bis zum Hauptmenü starten, Log prüfen, nach 15 s beenden.
// Mit --autotest (nur heldix): zusätzlich den Heldix-Autotest (mod/autotest) installieren. Er klickt
// sich durch Hauptmenü, Heldix-Menü, eine Testwelt, HUD-Editor und Zoom, prüft alles und macht
// Screenshots (Ordner wird am Ende angezeigt).
// Nutzt einen eigenen Testordner (<Datenordner>/test-instances).

import AdmZip from 'adm-zip';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { GraphicsApi, InstanceLoader } from '../shared/api';
import { CLIENT_MOD_PREFIX, DATA_DIR_NAME } from '../main/config';
import { offlineUuid } from '../main/core/auth';
import { buildLaunchArguments, startGame } from '../main/core/launch';
import { AccountBridge, IPC_JVM_FLAG } from '../main/core/accountipc';
import { GraphicsWatch, graphicsArguments, tunedJvmArguments } from '../main/core/performance';
import { getVersionManifest } from '../main/core/mojang';
import { createPaths, defaultDataRoot } from '../main/core/paths';
import { installPerformancePack } from '../main/core/modrinth';
import { prepareGame } from '../main/core/prepare';
import { listShaderpacks, setActiveShaderpack } from '../main/core/shaderpacks';
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
  // HeldixClient läuft in Heldix-Instanzen und (über den Heldix Loader als Fabric-Mod) in Fabric-Instanzen
  const withClient = loader === 'heldix' || (loader === 'fabric' && !flags.includes('--no-heldix'));
  if (autotest && !withClient) throw new Error('--autotest braucht HeldixClient (heldix oder fabric ohne --no-heldix)');

  if (loader === 'fabric' && flags.includes('--perf')) {
    const result = await installPerformancePack(gameDir, versionId);
    console.log(`Leistungs-Paket: neu ${result.installed.join(', ') || '-'}; schon da ${result.alreadyInstalled.join(', ') || '-'}; nicht verfügbar ${result.unavailable.join(', ') || '-'}`);
  }
  const shaderpack = flag('shaderpack');
  if (loader === 'fabric' && shaderpack) {
    const packs = await listShaderpacks(gameDir);
    const pack = shaderpack === 'aus' ? null : packs.packs[0]?.file ?? null;
    await setActiveShaderpack(gameDir, pack);
    console.log(`Iris-Shaderpack: ${pack ?? 'aus'}`);
  }

  if (withClient && !flags.includes('--ohne-addons')) {
    // Die Addons kommen sonst aus dem Addon-Store; Testläufe nehmen den frischen Gradle-Build (mod/addons/<id>),
    // auch wenn sich die Versionsnummer nicht geändert hat. Ältere Versionen desselben Addons fliegen raus.
    const addonsDir = path.join(gameDir, 'heldix-addons');
    await mkdir(addonsDir, { recursive: true });
    // Reste aus dem Addon-Store-Test (vorgemerkte Löschungen, Ersatz-JARs) würden den frischen Build überschreiben
    for (const leftover of (await readdir(addonsDir)).filter((f) => f === '.entfernen' || f === '.ausschalten' || f.endsWith('.neu') || f.endsWith('.part'))) {
      await rm(path.join(addonsDir, leftover), { force: true });
    }
    for (const id of ['uhrzeit', 'spotify', 'itemphysics', 'voicechat']) {
      const libs = path.join(modRepo, 'addons', id, 'build', 'libs');
      const built = await Promise.all((await readdir(libs).catch(() => [] as string[]))
        .filter((f) => f.startsWith(`heldix-addon-${id}-`) && f.endsWith('.jar'))
        .map(async (f) => ({ f, mtimeMs: (await stat(path.join(libs, f))).mtimeMs })));
      const newest = built.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.f;
      if (!newest) throw new Error(`Addon ${id} ist nicht gebaut (im Ordner mod: gradlew build)`);
      for (const old of (await readdir(addonsDir)).filter((f) => f.startsWith(`heldix-addon-${id}-`) && f !== newest)) await rm(path.join(addonsDir, old), { force: true });
      await copyFile(path.join(libs, newest), path.join(addonsDir, newest));
      if (id === 'uhrzeit' && flags.includes('--alte-addons')) {
        // ältere Version vortäuschen: der Spieltest aktualisiert sie dann über den Addon-Store (Download, Prüfsumme)
        const zip = new AdmZip(path.join(addonsDir, newest));
        const meta = JSON.parse(zip.getEntry('heldix.addon.json')!.getData().toString('utf8')) as { version: string };
        meta.version = '1.0.0';
        zip.updateFile('heldix.addon.json', Buffer.from(JSON.stringify(meta)));
        zip.writeZip(path.join(addonsDir, 'heldix-addon-uhrzeit-1.0.0.jar'));
        await rm(path.join(addonsDir, newest), { force: true });
      }
    }
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
    // Test-Addons aus mod/build/test-addons: kaputt (falsche API) und die mit Zugriff auf Minecraft (mod/test-addons/minecraft,
    // darunter eine abgeschaltete .jar.disabled); an/aus aus einem früheren Lauf zählt nicht
    await rm(path.join(addonsDir, '.ausschalten'), { force: true });
    const fixtures = path.join(modRepo, 'build', 'test-addons');
    for (const file of (await readdir(fixtures)).filter((f) => /^heldix-addon-.+\.jar(\.disabled)?$/.test(f))) {
      const base = file.replace(/\.disabled$/, '');
      await rm(path.join(addonsDir, base), { force: true });
      await rm(path.join(addonsDir, `${base}.disabled`), { force: true });
      await copyFile(path.join(fixtures, file), path.join(addonsDir, file));
    }
    if (loader === 'heldix') {
      const dummy = new AdmZip();
      dummy.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ schemaVersion: 1, id: 'fabric-attrappe', version: '1.0.0' })));
      dummy.writeZip(path.join(modsDir, 'fabric-attrappe.jar'));
    } else {
      await rm(path.join(modsDir, 'fabric-attrappe.jar'), { force: true });
    }
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
    fabricLoaderDir: path.join(resources, 'heldix-loader-fabric'),
    heldixClient: withClient,
    onProgress: (p) => {
      if (p.stage !== lastStage || p.done === p.total) {
        if (p.total > 0) console.log(`  ${p.stage}: ${p.done}/${p.total}`);
        lastStage = p.stage;
      }
    },
    onInfo: (m) => console.log(`  ${m}`),
  });
  console.log(`Vorbereitet in ${((Date.now() - started) / 1000).toFixed(1)} s, Client-Mod: ${prepared.clientModLoaded}, Loader: ${prepared.loaderVersion ?? '-'}`);

  // GUI-Skalierung (z. B. --gui-scale=2 bei --size=1920x1080 für große Menüs); ohne Angabe automatisch
  await setGuiScale(gameDir, Number(flag('gui-scale') ?? 0));

  const name = 'HeldixTester';
  // wie im Launcher: Vulkan-Vorgabe nur für Heldix-Instanzen, sonst nur mit ausdrücklichem --graphics
  const graphicsArgs = loader === 'heldix' || flag('graphics') ? graphicsArguments(graphicsApi, prepared.clientJar) : [];
  const tuningArgs = tuning ? tunedJvmArguments(prepared.javaMajor, []) : [];
  const testArgs: string[] = [];
  if (autotest) testArgs.push('-Dheldix.autotest=true');
  // Voice Chat im Autotest: nie das echte Mikrofon und keine Lautsprecher, Raum für die eigene Welt
  if (autotest) testArgs.push('-Dheldixclient.voicechat.testAudio=true', '-Dheldixclient.voice.testServer=autotest.heldixclient.com');
  // --service=<url>: Heldix-Dienst im Entwicklungsmodus (Anmeldung ohne Mojang, nur für Tests)
  if (flag('service')) testArgs.push(`-Dheldixclient.service=${flag('service')}`, '-Dheldixclient.service.dev=true');
  if (autotest && graphicsArgs.length) testArgs.push(`-Dheldix.autotest.backend=${graphicsApi === 'vulkan' ? 'Vulkan' : 'OpenGL'}`);
  if (benchmark) {
    testArgs.push('-Dheldix.benchmark=true', `-Dheldix.benchmark.seconds=${benchmarkSeconds}`);
    if (flag('shader')) testArgs.push(`-Dheldix.benchmark.shader=${flag('shader')}`);
    if (flag('engine')) testArgs.push(`-Dheldix.benchmark.engine=${{ aus: 0, dezent: 1, kraeftig: 2 }[flag('engine') ?? ''] ?? Number(flag('engine'))}`);
    if (flags.includes('--boost')) testArgs.push('-Dheldix.benchmark.boost=true');
  }
  // Kontowechsel im Spiel (docs/konto-wechsel.md): test:launch beantwortet die Anfragen wie der Launcher in der
  // Entwicklung (npm start), mit zwei Offline-Konten; Bestätigungen gibt es automatisch, Anmeldungen werden abgebrochen.
  // Der Autotest schaltet über Log-Zeilen „HELDIX-AUTOTEST-KONTO: …“ den Wechsel aus/an und beendet die Verbindung.
  // --no-ipc: ohne (wie ein Start über einen anderen Launcher)
  const ipc = withClient && !benchmark && !flags.includes('--no-ipc');
  let bridge: AccountBridge | null = null;
  let writeToGame: (line: string) => boolean = () => false;
  let switchAllowed = true;
  if (ipc) {
    testArgs.push(IPC_JVM_FLAG);
    const accounts = [name, `${name}2`].map((n, i) => ({ id: randomUUID(), type: 'offline' as const, name: n, uuid: offlineUuid(n), active: i === 0 }));
    bridge = new AccountBridge({
      listAccounts: async () => accounts.map((a) => ({ ...a })),
      session: async (id) => {
        const account = accounts.find((a) => a.id === id);
        if (!account) throw new Error('Dieses Konto gibt es im Launcher nicht (mehr).');
        return { name: account.name, uuid: account.uuid, accessToken: '0', userType: 'legacy' };
      },
      signIn: async () => {
        throw new Error('Anmeldung abgebrochen.');
      },
      setActive: async (id) => {
        for (const account of accounts) account.active = account.id === id;
      },
      allowed: async () => switchAllowed,
      confirmSwitch: async (account) => {
        console.log(`  [konto] Bestätigung im Launcher (Test: automatisch „Wechseln“): ${account.name}`);
        return true;
      },
      launchedAccountId: accounts[0].id,
      offlineAllowed: () => true,
      launcherVersion: 'test',
      log: (text, level) => console.log(`  [konto] ${level === 'WARN' ? 'WARNUNG ' : ''}${text}`),
    }, (line) => writeToGame(line));
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
      if (!failure && FAILURE_PATTERNS.some((p) => p.test(line.text))) {
        failure = line.text;
        // Fabric zeigt bei Mod-Konflikten ein Fenster und wartet – sofort beenden statt bis zur Zeitüberschreitung
        if (/Incompatible mods found/i.test(line.text)) game.process.kill();
      }
      // Kontowechsel: der Autotest steuert hier den „Launcher“ (Einstellung aus/an, Verbindung beenden)
      const konto = /HELDIX-AUTOTEST-KONTO: (\S+)/.exec(line.text);
      if (konto && bridge) {
        if (konto[1] === 'erlaubt=aus' || konto[1] === 'erlaubt=an') {
          switchAllowed = konto[1] === 'erlaubt=an';
          console.log(`  [konto] Einstellung „Kontowechsel im Spiel erlauben“: ${switchAllowed ? 'an' : 'aus'}`);
          bridge.notifyChanged();
        } else if (konto[1] === 'launcher-weg') {
          console.log('  [konto] Launcher beendet die Verbindung (stdin zu)');
          bridge.dispose();
          game.process.stdin?.end();
        }
      }
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
  }, bridge ? { message: (json) => bridge.handle(json), rejected: (reason) => bridge.rejected(reason) } : undefined);
  writeToGame = (line) => game.send(line);

  const timeout = setTimeout(() => {
    failure ??= `Zeitüberschreitung nach ${timeoutSeconds} s`;
    game.process.kill();
  }, timeoutSeconds * 1000);

  const code = await game.exited;
  clearTimeout(timeout);
  console.log(`Prozess beendet (Code ${code})`);
  if (withClient) {
    if (loaderLines.length === 0) failure ??= 'Heldix Loader ist nicht gestartet';
    if (clientLines.length === 0) failure ??= 'HeldixClient wurde nicht geladen';
    if (addonLines.length === 0) failure ??= 'Kein Heldix-Addon geladen';
  }
  if (!withClient && (loaderLines.length > 0 || clientLines.length > 0)) failure ??= `${loader}-Instanz ohne HeldixClient darf den Heldix Loader nicht laden`;
  if (autotest && autotestResult === null) failure ??= 'Autotest hat kein Ergebnis gemeldet';
  if (withClient && !world && !statusModes.includes('menu')) failure ??= 'HeldixClient hat keinen Status (Hauptmenü) für Discord gemeldet';
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

/**
 * Setzt guiScale in der options.txt der Testinstanz und blendet die Tutorial-Hinweise aus (andere Optionen bleiben).
 * Außerdem pausiert das Spiel nicht, wenn das Fenster den Fokus verliert – sonst stört jedes Klicken in ein anderes
 * Fenster den Test (Pausemenü statt der erwarteten Seite).
 */
async function setGuiScale(gameDir: string, scale: number): Promise<void> {
  const file = path.join(gameDir, 'options.txt');
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch {
    // noch keine options.txt: Minecraft legt sie beim Start an
  }
  const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith('guiScale:') && !line.startsWith('tutorialStep:') && !line.startsWith('pauseOnLostFocus:'));
  lines.push(`guiScale:${Number.isFinite(scale) ? scale : 0}`, 'tutorialStep:none', 'pauseOnLostFocus:false');
  await writeFile(file, lines.join('\n') + '\n');
}
