// Baut Heldix Loader, Client-Mod und Beispiel-Addon (../mod) und legt die JARs in resources/ ab:
//   resources/heldix-loader/heldix-loader-<version>.jar   (der eigene Loader, Java-Agent)
//   resources/client-mods/heldixclient-<version>+<mc>.jar (die HeldixClient-Mod)
//   resources/heldix-addons/*.jar                          (mitgelieferte Addons)
// Nutzt das portable JDK aus ../.tools/jdk-25, falls vorhanden, sonst JAVA_HOME.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const launcherDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const modDir = path.resolve(launcherDir, '..', 'mod');
const resources = path.join(launcherDir, 'resources');
const portableJdk = path.resolve(launcherDir, '..', '.tools', 'jdk-25');

const env = { ...process.env };
if (existsSync(portableJdk)) env.JAVA_HOME = portableJdk;
if (!env.JAVA_HOME) {
  console.error('Kein JDK gefunden. Bitte JDK 25 installieren oder JAVA_HOME setzen.');
  process.exit(1);
}

const gradlew = path.join(modDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
const result = spawnSync(`"${gradlew}" build`, { cwd: modDir, env, stdio: 'inherit', shell: true });
if (result.status !== 0) process.exit(result.status ?? 1);

const jarsIn = async (dir, filter) =>
  (await readdir(dir)).filter((f) => f.endsWith('.jar') && !f.includes('-sources') && filter(f));

/** Ersetzt den Inhalt eines Zielordners durch die angegebenen JARs. */
async function replaceAll(targetDir, sourceDir, jars, label) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  for (const jar of jars) {
    await copyFile(path.join(sourceDir, jar), path.join(targetDir, jar));
    console.log(`${label} bereit: resources/${path.basename(targetDir)}/${jar}`);
  }
}

// Heldix Loader
const loaderLibs = path.join(modDir, 'heldix-loader', 'build', 'libs');
const loaderJars = await jarsIn(loaderLibs, (f) => /^heldix-loader-.+\.jar$/.test(f));
if (loaderJars.length === 0) throw new Error('Heldix Loader wurde nicht gebaut');
const newestLoader = (await Promise.all(loaderJars.map(async (jar) => ({ jar, mtimeMs: (await stat(path.join(loaderLibs, jar))).mtimeMs }))))
  .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].jar;
await replaceAll(path.join(resources, 'heldix-loader'), loaderLibs, [newestLoader], 'Heldix Loader');

// Heldix Loader als Fabric-Mod (für HeldixClient in Fabric-Instanzen)
const fabricLibs = path.join(modDir, 'heldix-loader-fabric', 'build', 'libs');
const fabricJars = await jarsIn(fabricLibs, (f) => /^heldix-loader-fabric-.+\.jar$/.test(f));
if (fabricJars.length === 0) throw new Error('Heldix Loader (Fabric) wurde nicht gebaut');
const newestFabric = (await Promise.all(fabricJars.map(async (jar) => ({ jar, mtimeMs: (await stat(path.join(fabricLibs, jar))).mtimeMs }))))
  .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].jar;
await replaceAll(path.join(resources, 'heldix-loader-fabric'), fabricLibs, [newestFabric], 'Heldix Loader (Fabric)');

// Client-Mod: pro Minecraft-Version nur die zuletzt gebaute JAR (alte Builds liegen evtl. noch in build/libs)
const libs = path.join(modDir, 'build', 'libs');
const newest = new Map();
for (const jar of await jarsIn(libs, (f) => /^heldixclient-.+\+.+\.jar$/.test(f))) {
  const minecraft = jar.slice(jar.indexOf('+') + 1, -'.jar'.length);
  const { mtimeMs } = await stat(path.join(libs, jar));
  if (!newest.has(minecraft) || newest.get(minecraft).mtimeMs < mtimeMs) newest.set(minecraft, { jar, mtimeMs });
}
await replaceAll(path.join(resources, 'client-mods'), libs, [...newest.values()].map((v) => v.jar), 'Client-Mod');

// Mitgelieferte Heldix-Addons (werden in neue Heldix-Instanzen kopiert)
const addonLibs = path.join(modDir, 'example-addon', 'build', 'libs');
await replaceAll(path.join(resources, 'heldix-addons'), addonLibs, await jarsIn(addonLibs, () => true), 'Addon');
