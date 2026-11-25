// Veröffentlicht ein Heldix-Addon im Addon-Store (siehe core/addonstore.ts und docs/addons.md).
//
//   npm run addon -- <id>               baut mod/addons/<id>, signiert die Version und legt zwei Dateien in release/addons/ ab
//   npm run addon -- <id> --ohne-build  nimmt die zuletzt gebaute JAR
//
// Vorher: Version in mod/addons/<id>/build.gradle erhöhen und in mod/addons/<id>/store.json die „hinweise“ (Was ist neu)
// eintragen. Signiert wird mit dem privaten Update-Schlüssel (%USERPROFILE%\.heldixclient-dev\update-key.pem), über
// die Bytes von "heldix-addon\n" + Manifest. Danach im Team-Bereich der Webseite unter „Addons“ beide Dateien hochladen.

import AdmZip from 'adm-zip';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ADDON_SIGNATURE_PREFIX, HELDIX_ADDON_API, parseAddonManifest, verifyAddonManifest } from '../main/core/addonstore';
import { UPDATE_PUBLIC_KEY } from '../main/update-public-key';

const UPDATE_KEY_PATH = path.join(os.homedir(), '.heldixclient-dev', 'update-key.pem');
const ROOT = path.join(__dirname, '..', '..');
const MOD = path.resolve(ROOT, '..', 'mod');

interface StoreInfo {
  icon?: string;
  kategorie?: string;
  plattformen?: string[];
  beschreibung?: string;
  hinweise?: string[];
}

function gradle(task: string): void {
  const env = { ...process.env };
  const portableJdk = path.resolve(ROOT, '..', '.tools', 'jdk-25');
  if (existsSync(portableJdk)) env.JAVA_HOME = portableJdk;
  const gradlew = path.join(MOD, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  const command = process.platform === 'win32' ? `"${gradlew}" ${task}` : `sh "${gradlew}" ${task}`;
  const result = spawnSync(command, { cwd: MOD, env, stdio: 'inherit', shell: true });
  if (result.status !== 0) throw new Error(`Gradle-Aufgabe ${task} ist fehlgeschlagen.`);
}

async function main(): Promise<void> {
  const id = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  if (!id || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id)) throw new Error('Aufruf: npm run addon -- <id>   (z. B. npm run addon -- spotify)');
  const addonDir = path.join(MOD, 'addons', id);
  if (!existsSync(path.join(addonDir, 'build.gradle'))) {
    const known = (await readdir(path.join(MOD, 'addons'))).join(', ');
    throw new Error(`Kein Addon „${id}“ unter mod/addons (vorhanden: ${known}).`);
  }
  if (!process.argv.includes('--ohne-build')) gradle(`:addons:${id}:build`);

  // neueste gebaute JAR (alte Versionen liegen evtl. noch im Build-Ordner)
  const libs = path.join(addonDir, 'build', 'libs');
  const jars = await Promise.all((await readdir(libs)).filter((f) => f.endsWith('.jar') && !f.includes('-sources'))
    .map(async (f) => ({ f, mtimeMs: (await stat(path.join(libs, f))).mtimeMs })));
  const jar = jars.sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.f;
  if (!jar) throw new Error(`Keine JAR in ${libs}`);
  const jarPath = path.join(libs, jar);

  const entry = new AdmZip(jarPath).getEntry('heldix.addon.json');
  if (!entry) throw new Error(`${jar}: heldix.addon.json fehlt`);
  const meta = JSON.parse(entry.getData().toString('utf8')) as { id?: string; name?: string; version?: string; description?: string; authors?: string[]; api?: number };
  if (meta.id !== id) throw new Error(`${jar}: ID in heldix.addon.json ist „${meta.id}“, erwartet „${id}“`);
  if (typeof meta.api !== 'number' || meta.api > HELDIX_ADDON_API) throw new Error(`${jar}: braucht Addon-API ${meta.api}, HeldixClient kann bis ${HELDIX_ADDON_API}`);
  const store = JSON.parse(await readFile(path.join(addonDir, 'store.json'), 'utf8').catch(() => '{}')) as StoreInfo;

  const data = await readFile(jarPath);
  const version = String(meta.version);
  const manifest = parseAddonManifest({
    type: 'heldix-addon',
    id,
    name: meta.name ?? id,
    version,
    summary: meta.description ?? '',
    description: store.beschreibung ?? '',
    authors: meta.authors ?? [],
    api: meta.api,
    icon: store.icon ?? 'addons',
    category: store.kategorie ?? 'sonstiges',
    platforms: store.plattformen ?? [],
    file: `heldix-addon-${id}-${version}.jar`,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    date: new Date().toISOString(),
    notes: store.hinweise ?? [],
  });

  if (!existsSync(UPDATE_KEY_PATH)) throw new Error(`Kein Update-Schlüssel unter ${UPDATE_KEY_PATH}. Einmalig "npm run update-key" ausführen.`);
  const privateKey = createPrivateKey(await readFile(UPDATE_KEY_PATH, 'utf8'));
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (UPDATE_PUBLIC_KEY !== publicPem) {
    throw new Error('Der öffentliche Schlüssel im Launcher passt nicht zum Update-Schlüssel. "npm run update-key" und danach neu bauen.');
  }
  const text = JSON.stringify(manifest);
  const signature = sign(null, Buffer.from(ADDON_SIGNATURE_PREFIX + text, 'utf8'), privateKey).toString('base64');
  verifyAddonManifest(text, signature, publicPem); // Selbsttest wie im Launcher

  const outDir = path.join(ROOT, 'release', 'addons');
  await mkdir(outDir, { recursive: true });
  const outJar = path.join(outDir, manifest.file);
  const outManifest = path.join(outDir, `heldix-addon-${id}-${version}.addon.json`);
  await copyFile(jarPath, outJar);
  await writeFile(outManifest, `${JSON.stringify({ manifest: text, signature }, null, 2)}\n`);

  console.log(`${manifest.name} ${version} signiert:`);
  console.log(`  ${outJar} (${(manifest.size / 1024).toFixed(1)} KB)`);
  console.log(`  ${outManifest}`);
  if (manifest.notes.length) console.log(`  Neu: ${manifest.notes.join(' · ')}`);
  console.log('');
  console.log('Veröffentlichen: heldixclient.com/team → Addons → beide Dateien wählen → Veröffentlichen.');
}

main().catch((error: Error) => {
  console.error(`Fehler: ${error.message}`);
  process.exit(1);
});
