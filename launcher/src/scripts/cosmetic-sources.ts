// Quellen der Heldix-Cosmetics (Repo-Wurzel cosmetics/<id>/) einlesen und zu einem vollständigen Manifest bauen.
// Gemeinsam genutzt von "npm run cosmetic" (cosmetic-release.ts), der Vorschau und den Tests.
//
//   cosmetics/<id>/cosmetic.json  Manifest ohne type, date, texture und glow
//   cosmetics/<id>/texture.png    Pflicht
//   cosmetics/<id>/glow.png       optional (Leuchtebene, gleiche Größe)

import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseCosmeticManifestText, pngDataUrl } from '../main/core/cosmetics';
import { COSMETIC_FORMAT, COSMETIC_ID_RE, COSMETIC_TYPE, type CosmeticManifest } from '../main/core/cosmetics-format';

/** cosmetics/ im Repo-Wurzelordner (dist/scripts → launcher → Repo) */
export const COSMETICS_DIR = path.resolve(__dirname, '..', '..', '..', 'cosmetics');

/** Felder, die das Bauen setzt und die deshalb nicht in cosmetic.json stehen dürfen */
const GENERATED = ['type', 'date', 'texture', 'glow'];
/** Reihenfolge der Felder im fertigen Manifest */
const ORDER = ['type', 'format', 'id', 'version', 'slot', 'name', 'description', 'access', 'date', 'texture', 'glow', 'model', 'animations', 'particles', 'cape', 'companion'];

export interface BuiltCosmetic {
  id: string;
  manifest: CosmeticManifest;
  /** Manifest-Text, genau so wird er signiert */
  text: string;
  texture: Buffer;
  glow: Buffer | null;
}

/** IDs aller Quellordner mit cosmetic.json, sortiert */
export async function listCosmeticSources(dir = COSMETICS_DIR): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && existsSync(path.join(dir, e.name, 'cosmetic.json')))
    .map((e) => e.name)
    .sort();
}

/** Baut das Manifest aus den Quellen und prüft es vollständig (wirft mit deutscher Meldung). */
export async function buildCosmetic(id: string, date: string, dir = COSMETICS_DIR): Promise<BuiltCosmetic> {
  if (!COSMETIC_ID_RE.test(id)) throw new Error(`„${id}“ ist keine gültige Cosmetic-ID (a–z, 0–9, -; höchstens 32 Zeichen)`);
  const folder = path.join(dir, id);
  const sourcePath = path.join(folder, 'cosmetic.json');
  if (!existsSync(sourcePath)) throw new Error(`Keine Quelle ${sourcePath}`);
  let source: unknown;
  try {
    source = JSON.parse(await readFile(sourcePath, 'utf8'));
  } catch (error) {
    throw new Error(`${id}/cosmetic.json ist kein gültiges JSON (${(error as Error).message})`);
  }
  if (typeof source !== 'object' || source === null || Array.isArray(source)) throw new Error(`${id}/cosmetic.json muss ein Objekt sein`);
  const fields = source as Record<string, unknown>;
  for (const key of GENERATED) {
    if (key in fields) throw new Error(`${id}/cosmetic.json: „${key}“ wird beim Bauen gesetzt und gehört nicht in die Quelle`);
  }
  if (fields.id !== id) throw new Error(`${id}/cosmetic.json: id ist „${String(fields.id)}“, der Ordner heißt „${id}“`);
  const texturePath = path.join(folder, 'texture.png');
  if (!existsSync(texturePath)) throw new Error(`${id}: texture.png fehlt`);
  const texture = await readFile(texturePath);
  const glowPath = path.join(folder, 'glow.png');
  const glow = existsSync(glowPath) ? await readFile(glowPath) : null;

  const full: Record<string, unknown> = { ...fields, type: COSMETIC_TYPE, format: fields.format ?? COSMETIC_FORMAT, date, texture: pngDataUrl(texture) };
  if (glow) full.glow = pngDataUrl(glow);
  const ordered: Record<string, unknown> = {};
  for (const key of ORDER) if (full[key] !== undefined) ordered[key] = full[key];
  for (const key of Object.keys(full)) if (!(key in ordered)) ordered[key] = full[key]; // unbekannte Felder meldet die Prüfung
  const text = JSON.stringify(ordered);
  let manifest: CosmeticManifest;
  try {
    manifest = parseCosmeticManifestText(text);
  } catch (error) {
    throw new Error(`${id}: ${(error as Error).message}`);
  }
  return { id, manifest, text, texture, glow };
}
