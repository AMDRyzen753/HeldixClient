import { randomBytes } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { InstanceLoader, InstancePatch, NewInstance } from '../../shared/api';
import { ADDON_DIR, installBundledAddon, listBundledAddons } from './content';
import { exists, readJson, writeJson } from './fsutil';
import type { LauncherPaths } from './paths';

export const INSTANCE_FILE = 'heldix-instance.json';
export { ADDON_DIR };
export const INSTANCE_COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e'];

export interface InstanceConfig {
  id: string;
  name: string;
  minecraft: string;
  loader: InstanceLoader;
  color: string;
  created: number;
  lastPlayed: number | null;
  playTimeMs: number;
  memoryMb: number | null;
  /** nur Fabric: HeldixClient mitstarten (fehlt = ja) */
  heldixClient?: boolean;
}

/** Läuft HeldixClient in dieser Instanz? */
export function usesHeldixClient(config: Pick<InstanceConfig, 'loader' | 'heldixClient'>): boolean {
  return config.loader === 'heldix' || (config.loader === 'fabric' && config.heldixClient !== false);
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Prüft IDs aus der Oberfläche, damit niemand über "../" aus dem Instanz-Ordner ausbrechen kann. */
export function assertInstanceId(id: string): string {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error(`Ungültige Instanz-ID: ${id}`);
  return id;
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return `${base || 'instanz'}-${randomBytes(2).toString('hex')}`;
}

export class InstanceStore {
  constructor(private readonly paths: LauncherPaths) {}

  dir(id: string): string {
    return path.join(this.paths.instances, assertInstanceId(id));
  }

  async list(): Promise<InstanceConfig[]> {
    let dirs: string[] = [];
    try {
      dirs = (await readdir(this.paths.instances, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return [];
    }
    const configs: InstanceConfig[] = [];
    for (const dir of dirs) {
      const config = await readJson<InstanceConfig>(path.join(this.paths.instances, dir, INSTANCE_FILE));
      if (config && config.id === dir) configs.push(config);
    }
    return configs.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.created - a.created);
  }

  async get(id: string): Promise<InstanceConfig | null> {
    return readJson<InstanceConfig>(path.join(this.dir(id), INSTANCE_FILE));
  }

  async require(id: string): Promise<InstanceConfig> {
    const config = await this.get(id);
    if (!config) throw new Error('Diese Instanz gibt es nicht mehr.');
    return config;
  }

  async save(config: InstanceConfig): Promise<void> {
    await writeJson(path.join(this.dir(config.id), INSTANCE_FILE), config);
  }

  async create(data: NewInstance, bundledAddonsDir: string | null): Promise<InstanceConfig> {
    const name = data.name.trim().slice(0, 40) || `Minecraft ${data.minecraft}`;
    const config: InstanceConfig = {
      id: slug(name),
      name,
      minecraft: data.minecraft,
      loader: data.loader,
      color: INSTANCE_COLORS.includes(data.color) ? data.color : INSTANCE_COLORS[0],
      created: Date.now(),
      lastPlayed: null,
      playTimeMs: 0,
      memoryMb: null,
    };
    const dir = this.dir(config.id);
    await mkdir(path.join(dir, 'mods'), { recursive: true });
    if (usesHeldixClient(config)) await this.installBundledAddons(dir, bundledAddonsDir);
    await this.save(config);
    return config;
  }

  async update(id: string, patch: InstancePatch): Promise<InstanceConfig> {
    const config = await this.require(id);
    if (typeof patch.name === 'string' && patch.name.trim()) config.name = patch.name.trim().slice(0, 40);
    if (typeof patch.color === 'string' && INSTANCE_COLORS.includes(patch.color)) config.color = patch.color;
    if (patch.memoryMb === null || (typeof patch.memoryMb === 'number' && patch.memoryMb >= 512)) config.memoryMb = patch.memoryMb;
    if (typeof patch.heldixClient === 'boolean' && config.loader === 'fabric') config.heldixClient = patch.heldixClient;
    await this.save(config);
    return config;
  }

  /**
   * Mitgelieferte Heldix-Addons in eine Instanz legen (beim Anlegen). Fehlende kommen dazu, ältere Versionen
   * werden ersetzt; was schon in gleicher oder neuerer Version da ist, bleibt unverändert.
   */
  async installBundledAddons(instanceDir: string, bundledAddonsDir: string | null): Promise<void> {
    await mkdir(path.join(instanceDir, ADDON_DIR), { recursive: true });
    if (!bundledAddonsDir) return;
    try {
      for (const addon of await listBundledAddons(instanceDir, bundledAddonsDir)) {
        if (addon.state !== 'installed') await installBundledAddon(instanceDir, bundledAddonsDir, addon.file);
      }
    } catch {
      // keine mitgelieferten Addons vorhanden
    }
  }

  /**
   * Übernimmt Spielordner aus Launcher-Versionen vor dem Instanz-System
   * (z. B. "26.3-fabric") als Instanzen, damit Welten und Einstellungen erhalten bleiben.
   */
  async migrateLegacy(bundledAddonsDir: string | null): Promise<number> {
    let migrated = 0;
    let dirs: string[] = [];
    try {
      dirs = (await readdir(this.paths.instances, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return 0;
    }
    for (const dir of dirs) {
      const match = /^(\d[\w.-]*)-(fabric|vanilla)$/.exec(dir);
      if (!match || (await exists(path.join(this.paths.instances, dir, INSTANCE_FILE)))) continue;
      const [, minecraft, oldLoader] = match;
      const loader: InstanceLoader = oldLoader === 'fabric' ? 'heldix' : 'vanilla';
      const config: InstanceConfig = {
        id: dir,
        name: loader === 'heldix' ? `HeldixClient ${minecraft}` : `Minecraft ${minecraft}`,
        minecraft,
        loader,
        color: loader === 'heldix' ? INSTANCE_COLORS[0] : INSTANCE_COLORS[2],
        created: Date.now(),
        lastPlayed: null,
        playTimeMs: 0,
        memoryMb: null,
      };
      if (loader === 'heldix') await this.installBundledAddons(path.join(this.paths.instances, dir), bundledAddonsDir);
      await this.save(config);
      migrated++;
    }
    return migrated;
  }
}
