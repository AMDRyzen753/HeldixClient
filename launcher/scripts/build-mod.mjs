// Baut Heldix Loader und Client-Mod (../mod) und legt die JARs in resources/ ab:
//   resources/heldix-loader/heldix-loader-<version>.jar   (der eigene Loader, Java-Agent)
//   resources/client-mods/heldixclient-<version>+<mc>.jar (die HeldixClient-Mod)
//   resources/launcher-bridge/heldix-bridge-<version>.jar  (Brücke zum offiziellen Minecraft Launcher, plus icon.png)
// Addons kommen nicht mehr mit dem Launcher, sondern aus dem Addon-Store (npm run addon -- <id>, siehe docs/addons.md).
// Nutzt das portable JDK aus ../.tools/jdk-25, falls vorhanden, sonst JAVA_HOME.
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
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
// macOS/Linux: über sh starten (gradlew ist im Repository nicht als ausführbar markiert)
const command = process.platform === 'win32' ? `"${gradlew}" build` : `sh "${gradlew}" build`;
const result = spawnSync(command, { cwd: modDir, env, stdio: 'inherit', shell: true });
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

// Brücke zum offiziellen Minecraft Launcher (und das Bild der Installation dort)
const bridgeLibs = path.join(modDir, 'launcher-bridge', 'build', 'libs');
const bridgeJars = await jarsIn(bridgeLibs, (f) => /^heldix-bridge-.+\.jar$/.test(f));
if (bridgeJars.length === 0) throw new Error('Brücke zum Minecraft Launcher wurde nicht gebaut');
const newestBridge = (await Promise.all(bridgeJars.map(async (jar) => ({ jar, mtimeMs: (await stat(path.join(bridgeLibs, jar))).mtimeMs }))))
  .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].jar;
await replaceAll(path.join(resources, 'launcher-bridge'), bridgeLibs, [newestBridge], 'Brücke');
await copyFile(path.join(launcherDir, 'build', 'icon.png'), path.join(resources, 'launcher-bridge', 'icon.png'));

// Früher mitgelieferte Addons aus alten Builds entfernen (sie kommen jetzt aus dem Addon-Store)
await rm(path.join(resources, 'heldix-addons'), { recursive: true, force: true });

// Der Addon-Store im Launcher muss wissen, bis zu welcher API-Stufe die Mod Addons laden kann
const apiSource = await readFile(path.join(modDir, 'heldix-api', 'src', 'main', 'java', 'dev', 'heldixclient', 'api', 'HeldixApi.java'), 'utf8');
const storeSource = await readFile(path.join(launcherDir, 'src', 'main', 'core', 'addonstore.ts'), 'utf8');
const modApi = /int API_VERSION = (\d+);/.exec(apiSource)?.[1];
const storeApi = /export const HELDIX_ADDON_API = (\d+);/.exec(storeSource)?.[1];
if (!modApi || modApi !== storeApi) {
  throw new Error(`Addon-API passt nicht: HeldixApi.API_VERSION = ${modApi}, HELDIX_ADDON_API in src/main/core/addonstore.ts = ${storeApi}`);
}
// Launcher und Spiel prüfen Store-Addons mit demselben öffentlichen Schlüssel (npm run update-key schreibt beide)
const keySource = await readFile(path.join(launcherDir, 'src', 'main', 'update-public-key.ts'), 'utf8');
const launcherKey = /UPDATE_PUBLIC_KEY: string \| null = (".*");/.exec(keySource)?.[1];
const modKey = await readFile(path.join(modDir, 'src', 'main', 'resources', 'heldix-store-key.pem'), 'utf8').catch(() => null);
if (launcherKey && JSON.parse(launcherKey) !== modKey) {
  throw new Error('mod/src/main/resources/heldix-store-key.pem passt nicht zu src/main/update-public-key.ts – "npm run update-key" ausführen und neu bauen.');
}
