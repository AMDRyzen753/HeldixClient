// Tests der Absturz-Hilfe (core/crash.ts) mit nachgebauten Crash-Reports, JVM-Fehlern und Mod-JARs.
//   npm run test:crash
import AdmZip from 'adm-zip';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeCrash, anonymize, type CrashModInfo } from '../main/core/crash';

let failed = 0;
let passed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${label}${detail ? ` (${detail})` : ''}`);
}

async function scenario(name: string, setup: (dir: string) => Promise<void>, options: { exitCode?: number | null; log?: string[]; mods?: CrashModInfo[]; graphicsApi?: string; customJava?: boolean } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `heldix-crash-${name}-`));
  await mkdir(path.join(dir, 'crash-reports'), { recursive: true });
  await mkdir(path.join(dir, 'logs'), { recursive: true });
  await mkdir(path.join(dir, 'mods'), { recursive: true });
  const startedAt = Date.now() - 60_000;
  await setup(dir);
  const result = await analyzeCrash({
    instanceId: 'test',
    instanceName: 'Testinstanz',
    gameDir: dir,
    startedAt,
    exitCode: options.exitCode === undefined ? -1 : options.exitCode,
    logLines: options.log ?? [],
    mods: options.mods ?? [],
    memoryMb: 4096,
    graphicsApi: options.graphicsApi ?? 'vulkan',
    customJava: options.customJava ?? false,
  });
  await rm(dir, { recursive: true, force: true });
  return result.analysis;
}

async function modJar(dir: string, file: string, packagePath: string): Promise<void> {
  const zip = new AdmZip();
  zip.addFile(`${packagePath}/CoolMod.class`, Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  zip.addFile(`${packagePath}/mixin/WorldMixin.class`, Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  zip.addFile('fabric.mod.json', Buffer.from('{"id":"coolmod"}'));
  zip.writeZip(path.join(dir, 'mods', file));
}

const report = (body: string) => `---- Minecraft Crash Report ----\n// Who set us up the TNT?\n\nTime: 2026-11-26 12:00:00\nDescription: ${body}\n`;

async function main(): Promise<void> {
  const cool: CrashModInfo = { file: 'coolmod-1.0.jar', id: 'coolmod', name: 'Cool Mod' };

  let a = await scenario('oom', async (dir) => {
    await writeFile(path.join(dir, 'logs', 'latest.log'), '[12:00:00] [Render thread/ERROR]: java.lang.OutOfMemoryError: Java heap space\n');
  });
  check('Zu wenig RAM erkannt', a.kind === 'memory' && a.actions.some((x) => x.kind === 'raise-memory'), a.kind);

  a = await scenario('heap', async () => undefined, { exitCode: 1, log: ['Error occurred during initialization of VM', 'Could not reserve enough space for 16777216KB object heap'] });
  check('RAM zu hoch erkannt (ohne Crash-Report, aus der Ausgabe)', a.kind === 'memory-too-high' && a.actions.some((x) => x.kind === 'lower-memory'), a.kind);

  a = await scenario('nvidia', async (dir) => {
    await writeFile(path.join(dir, 'hs_err_pid1234.log'), '#\n# A fatal error has been detected by the Java Runtime Environment:\n#\n#  EXCEPTION_ACCESS_VIOLATION (0xc0000005) at pc=0x00007ff8, pid=1234\n# Problematic frame:\n# C  [nvoglv64.dll+0xa1b2c3]\n');
  }, { exitCode: 1 });
  check('Grafiktreiber (NVIDIA) erkannt, OpenGL vorgeschlagen', a.kind === 'graphics-driver' && a.title.includes('NVIDIA') && a.actions.some((x) => x.kind === 'use-opengl') && a.hasJvmError, a.title);

  a = await scenario('opengl', async (dir) => {
    await writeFile(path.join(dir, 'logs', 'latest.log'), '[12:00:00] [Render thread/ERROR]: GLFW error 65542: WGL: The driver does not appear to support OpenGL\n');
  });
  check('Kein OpenGL erkannt', a.kind === 'opengl', a.kind);

  a = await scenario('mixin', async (dir) => {
    await modJar(dir, cool.file, 'com/example/coolmod');
    await writeFile(path.join(dir, 'crash-reports', 'crash-2026-11-26_12.00.00-client.txt'), `${report('Initializing game')}\norg.spongepowered.asm.mixin.transformer.throwables.MixinTransformerError: An unexpected critical error was encountered\nCaused by: org.spongepowered.asm.mixin.injection.throwables.InjectionError: Critical injection failure: Mixin [coolmod.mixins.json:WorldMixin] from mod coolmod failed injection check\n\tat org.spongepowered.asm.mixin.Foo.bar(Foo.java:1)\n`);
  }, { mods: [cool] });
  check('Mod-Konflikt (Mixin) mit Mod erkannt', a.kind === 'mod-conflict' && a.suspects[0]?.file === cool.file && a.actions.some((x) => x.kind === 'disable-mod' && x.file === cool.file), `${a.kind} ${a.suspects.map((m) => m.name)}`);

  a = await scenario('stack', async (dir) => {
    await modJar(dir, cool.file, 'com/example/coolmod');
    await writeFile(path.join(dir, 'crash-reports', 'crash-2026-11-26_12.00.01-client.txt'), `${report('Rendering overlay')}\njava.lang.NullPointerException: Cannot invoke "Object.toString()" because "x" is null\n\tat com.example.coolmod.CoolMod.render(CoolMod.java:42)\n\tat net.minecraft.client.gui.Gui.render(Gui.java:100)\n`);
  }, { mods: [cool] });
  check('Mod aus dem Stacktrace gefunden', a.suspects[0]?.name === 'Cool Mod' && a.title.includes('Cool Mod') && a.detail.includes('NullPointerException'), `${a.title} | ${a.detail}`);
  check('Beschreibung aus dem Crash-Report', a.description === 'Rendering overlay', String(a.description));

  a = await scenario('suspected', async (dir) => {
    await writeFile(path.join(dir, 'crash-reports', 'crash-2026-11-26_12.00.02-client.txt'), `${report('Ticking entity')}\nA detailed walkthrough of the error...\nSuspected Mod:\n\tCool Mod (coolmod), Version: 1.0\n\t\tat com.example.coolmod.X.y(X.java:1)\n\nStacktrace:\n`);
  }, { mods: [cool] });
  check('Fabric „Suspected Mod“ übernommen', a.suspects.some((m) => m.file === cool.file), a.suspects.map((m) => m.name).join(','));

  a = await scenario('nosuchmethod', async (dir) => {
    await writeFile(path.join(dir, 'crash-reports', 'crash-2026-11-26_12.00.03-client.txt'), `${report('Initializing game')}\njava.lang.NoSuchMethodError: 'void net.minecraft.class_123.method_456()'\n\tat net.minecraft.Foo.bar(Foo.java:1)\n`);
  });
  check('Mod passt nicht zur Version (NoSuchMethodError)', a.kind === 'mod-incompatible', a.kind);

  a = await scenario('heldix', async (dir) => {
    await writeFile(path.join(dir, 'crash-reports', 'crash-2026-11-26_12.00.04-client.txt'), `${report('Rendering screen')}\njava.lang.IllegalStateException: kaputt\n\tat dev.heldixclient.screen.HeldixMenuScreen.render(HeldixMenuScreen.java:10)\n`);
  });
  check('Fehler in HeldixClient erkannt', a.kind === 'heldixclient', a.kind);

  a = await scenario('world', async (dir) => {
    await writeFile(path.join(dir, 'crash-reports', 'crash-2026-11-26_12.00.05-server.txt'), `${report('Exception in server tick loop')}\njava.lang.IllegalArgumentException\n\tat net.minecraft.server.Foo.bar(Foo.java:1)\n`);
  });
  check('Fehler in der Welt erkannt', a.kind === 'world', a.kind);

  a = await scenario('unknown', async () => undefined, { exitCode: 1, log: ['[12:00:00] [main/INFO]: Hallo'] });
  check('Unbekannt: Fehlercode in der Erklärung', a.kind === 'unknown' && a.explanation.includes('Fehlercode 1'), a.explanation);

  a = await scenario('old', async (dir) => {
    const old = path.join(dir, 'crash-reports', 'crash-2020-01-01_00.00.00-client.txt');
    await writeFile(old, `${report('Alter Absturz')}\njava.lang.OutOfMemoryError\n`);
    const past = new Date(Date.now() - 24 * 3600 * 1000);
    await utimes(old, past, past);
  }, { exitCode: 1 });
  check('Alter Crash-Report wird ignoriert', !a.hasCrashReport && a.kind !== 'memory', a.kind);

  a = await scenario('java', async () => undefined, { exitCode: 1, log: ['Exception in thread "main" java.lang.UnsupportedClassVersionError: Foo has been compiled by a more recent version of the Java Runtime'], customJava: true });
  check('Falsches Java mit eigenem Pfad → automatisches Java vorgeschlagen', a.kind === 'java-version' && a.actions.some((x) => x.kind === 'reset-java'), a.kind);

  // Anonymisieren
  const home = os.homedir();
  const sample = `Pfad ${home}\\AppData\\Roaming\\.heldixclient und ${home.replace(/\\/g, '/')}/x\nC:\\Users\\Fremd\\Java\\bin --accessToken eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlc2lnbmF0dXJl\n`;
  const clean = anonymize(sample);
  check('Benutzerordner durch ~ ersetzt', !clean.includes(home) && !clean.includes(home.replace(/\\/g, '/')) && clean.includes('~\\AppData') && clean.includes('C:\\Users\\~'), clean.split('\n')[0]);
  check('Token entfernt', !clean.includes('eyJhbGci') && clean.includes('<entfernt>'), clean.split('\n')[1]);

  console.log(failed === 0 ? `Absturz-Hilfe: alle ${passed} Prüfungen bestanden` : `Absturz-Hilfe: ${failed} von ${passed + failed} fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
