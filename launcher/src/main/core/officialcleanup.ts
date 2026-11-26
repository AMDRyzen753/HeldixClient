// Aufräumen nach der früheren Anmeldung über den offiziellen Minecraft Launcher („Brücke“, bis Launcher 0.13).
// Seit Mojang die Microsoft-Anmeldung von HeldixClient freigegeben hat, gibt es die Brücke nicht mehr. Ältere Versionen
// haben im offiziellen Launcher die Installation „HeldixClient“ angelegt (Profil, Version versions/heldixclient und die
// Brücken-JAR unter libraries/dev/heldixclient). Ohne Brücke würde sie nur noch einen Fehler zeigen – deshalb weg damit.

import { readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exists, readJson, writeJson } from './fsutil';

const PROFILE_ID = 'heldixclient';
const VERSION_ID = 'heldixclient';

/** Datenordner des offiziellen Launchers (.minecraft) */
export function officialMinecraftDir(): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), '.minecraft');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft');
  return path.join(os.homedir(), '.minecraft');
}

type ProfilesFile = { profiles?: Record<string, unknown>; selectedProfile?: string };

/**
 * Entfernt die Installation „HeldixClient“ aus dem offiziellen Launcher, falls eine frühere Version sie angelegt hat.
 * Gibt true zurück, wenn etwas entfernt wurde. Andere Profile, Welten und Einstellungen bleiben unberührt.
 */
export async function removeOfficialProfile(minecraftDir = officialMinecraftDir()): Promise<boolean> {
  let removed = false;
  for (const name of ['launcher_profiles.json', 'launcher_profiles_microsoft_store.json']) {
    const file = path.join(minecraftDir, name);
    const data = await readJson<ProfilesFile>(file);
    if (!data?.profiles || !(PROFILE_ID in data.profiles)) continue;
    delete data.profiles[PROFILE_ID];
    // war HeldixClient ausgewählt: der offizielle Launcher wählt dann selbst wieder ein Profil
    if (data.selectedProfile === PROFILE_ID) delete data.selectedProfile;
    await writeJson(file, data);
    removed = true;
  }
  const versionDir = path.join(minecraftDir, 'versions', VERSION_ID);
  if (await exists(versionDir)) {
    // nur die eigene Version löschen (enthält heldixclient.json und eine leere JAR)
    const files = await readdir(versionDir).catch(() => [] as string[]);
    if (files.every((f) => f.startsWith(VERSION_ID) || f === 'natives')) {
      await rm(versionDir, { recursive: true, force: true });
      removed = true;
    }
  }
  const bridgeLibrary = path.join(minecraftDir, 'libraries', 'dev', 'heldixclient', 'heldix-bridge');
  if (await exists(bridgeLibrary)) {
    await rm(bridgeLibrary, { recursive: true, force: true });
    const parent = path.dirname(bridgeLibrary);
    if ((await readdir(parent).catch(() => ['x'])).length === 0) await rm(parent, { recursive: true, force: true });
    removed = true;
  }
  return removed;
}
