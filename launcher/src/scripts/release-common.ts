// Gemeinsames für die Release-Skripte (release.ts für Windows, release-mac.ts für den Mac) – ohne Seiteneffekte beim
// Import, damit scripts/test-update.ts das Mac-Manifest mit einem Test-Schlüssel prüfen kann.

import { createHash, createPublicKey, sign, type KeyObject } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { MAC_ARCHES, MAC_ARTIFACT_RE, macArchLabel, macFileName, verifyMacManifest, type MacArch, type MacUpdateManifest } from '../main/core/mac-update';

/** SHA-512 einer Datei (Base64) */
export async function sha512File(file: string): Promise<string> {
  const hash = createHash('sha512');
  await pipeline(createReadStream(file), hash);
  return hash.digest('base64');
}

/**
 * Hinweise zur Version: --note="…" (direkter Aufruf) oder die Zeilen „- …“ aus release-notes.md (auskommentierte
 * Zeilen mit # zählen nicht). npm reicht Argumente mit Leerzeichen unter Windows nicht sauber durch.
 */
export async function readReleaseNotes(root: string, argv: readonly string[]): Promise<string[]> {
  const direct = argv.filter((a) => a.startsWith('--note=')).map((a) => a.slice('--note='.length).trim()).filter(Boolean);
  if (direct.length) return direct.slice(0, 30);
  const file = await readFile(path.join(root, 'release-notes.md'), 'utf8').catch(() => '');
  return file
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*] /.test(line))
    .map((line) => line.replace(/^\s*[-*] /, '').trim())
    .filter(Boolean)
    .slice(0, 30);
}

export interface MacArtifact {
  arch: MacArch;
  ext: 'zip' | 'dmg';
  path: string;
  size: number;
}

export interface MacArtifacts {
  zips: MacArtifact[];
  dmgs: MacArtifact[];
  /** Fehler, die die Veröffentlichung verhindern */
  errors: string[];
  /** Hinweise (z. B. DMG fehlt) */
  warnings: string[];
}

/**
 * Sucht im entpackten Actions-Artefakt (auch in Unterordnern, eine Ebene tief) die Mac-Dateien und prüft Namen und
 * Version gegen package.json. Beide ZIPs (Apple Silicon und Intel) sind Pflicht, die DMGs nur ein Hinweis.
 */
export async function findMacArtifacts(dir: string, version: string): Promise<MacArtifacts> {
  const result: MacArtifacts = { zips: [], dmgs: [], errors: [], warnings: [] };
  const candidates: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) {
    result.errors.push(`Ordner ${dir} nicht lesbar.`);
    return result;
  }
  for (const entry of entries) {
    if (entry.isFile()) candidates.push(path.join(dir, entry.name));
    else if (entry.isDirectory()) {
      for (const inner of await readdir(path.join(dir, entry.name), { withFileTypes: true }).catch(() => [])) {
        if (inner.isFile()) candidates.push(path.join(dir, entry.name, inner.name));
      }
    }
  }
  for (const file of candidates) {
    const name = path.basename(file);
    if (!/\.(zip|dmg)$/i.test(name)) continue;
    const match = MAC_ARTIFACT_RE.exec(name);
    if (!match) {
      if (/mac/i.test(name)) result.warnings.push(`${name}: unbekannter Name, wird ignoriert.`);
      continue;
    }
    if (match[1] !== version) {
      result.errors.push(`${name} gehört zu Version ${match[1]}, package.json sagt ${version}.`);
      continue;
    }
    const artifact: MacArtifact = { arch: match[2] as MacArch, ext: match[3] as 'zip' | 'dmg', path: file, size: (await stat(file)).size };
    const list = artifact.ext === 'zip' ? result.zips : result.dmgs;
    if (list.some((a) => a.arch === artifact.arch)) {
      result.errors.push(`${name} liegt doppelt im Ordner.`);
      continue;
    }
    list.push(artifact);
  }
  for (const arch of MAC_ARCHES) {
    if (!result.zips.some((a) => a.arch === arch)) result.errors.push(`${macFileName(version, arch)} fehlt (${macArchLabel(arch)}).`);
    if (!result.dmgs.some((a) => a.arch === arch)) result.warnings.push(`${macFileName(version, arch, 'dmg')} fehlt – die Download-Seite braucht sie für Neuinstallationen.`);
  }
  for (const zip of result.zips) if (zip.size <= 0) result.errors.push(`${path.basename(zip.path)} ist leer.`);
  result.zips.sort((a, b) => MAC_ARCHES.indexOf(a.arch) - MAC_ARCHES.indexOf(b.arch));
  result.dmgs.sort((a, b) => MAC_ARCHES.indexOf(a.arch) - MAC_ARCHES.indexOf(b.arch));
  return result;
}

export interface SignedMacManifest {
  manifest: MacUpdateManifest;
  /** genau dieser Text ist signiert */
  text: string;
  signature: string;
}

/** Mac-Manifest (Version 2) bauen, signieren und wie im Launcher gegenprüfen */
export async function signMacManifest(input: { version: string; date: string; notes: string[]; zips: MacArtifact[]; privateKey: KeyObject }): Promise<SignedMacManifest> {
  const files: MacUpdateManifest['files'] = {};
  for (const zip of input.zips) files[zip.arch] = { file: path.basename(zip.path), size: zip.size, sha512: await sha512File(zip.path) };
  const manifest: MacUpdateManifest = { v: 2, platform: 'mac', version: input.version, date: input.date, notes: input.notes, files };
  const text = JSON.stringify(manifest);
  const signature = sign(null, Buffer.from(text, 'utf8'), input.privateKey).toString('base64');
  const publicPem = createPublicKey(input.privateKey).export({ type: 'spki', format: 'pem' }).toString();
  verifyMacManifest(text, signature, publicPem); // Selbsttest wie im Launcher
  return { manifest, text, signature };
}

/** update-mac.json und die Kopie update-mac-<version>.json schreiben; gibt beide Pfade zurück */
export async function writeMacUpdate(outDir: string, signed: SignedMacManifest): Promise<{ latest: string; copy: string }> {
  await mkdir(outDir, { recursive: true });
  const body = `${JSON.stringify({ manifest: signed.text, signature: signed.signature }, null, 2)}\n`;
  const latest = path.join(outDir, 'update-mac.json');
  const copy = path.join(outDir, `update-mac-${signed.manifest.version}.json`);
  await writeFile(latest, body);
  await writeFile(copy, body);
  return { latest, copy };
}
