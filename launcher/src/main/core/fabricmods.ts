// Prüft die Fabric-Mods einer Instanz vor dem Start auf Konflikte – mit denselben Regeln wie Fabric Loader
// ("depends" und "breaks" in fabric.mod.json). Statt dass Fabric mit "Incompatible mods found!" abbricht,
// schaltet der Launcher verzichtbare Mods (z. B. aus dem Leistungs-Paket) ab und sagt, warum.

import AdmZip from 'adm-zip';
import { readdir, rename } from 'node:fs/promises';
import path from 'node:path';

export interface FabricModInfo {
  file: string;
  id: string;
  name: string;
  version: string;
  depends: Record<string, string | string[]>;
  breaks: Record<string, string | string[]>;
  provides: string[];
}

export interface FabricConflict {
  /** Mod, deren Regel verletzt ist */
  mod: FabricModInfo;
  /** die andere Mod */
  other: FabricModInfo;
  kind: 'breaks' | 'depends';
  rule: string;
}

// ---------- Versionen wie bei Fabric (SemVer, Vorabversionen, Platzhalter) ----------

interface ParsedVersion {
  core: number[];
  pre: string[] | null;
}

function parseVersion(text: string): ParsedVersion {
  const withoutBuild = text.trim().split('+')[0];
  const dash = withoutBuild.indexOf('-');
  const core = (dash >= 0 ? withoutBuild.slice(0, dash) : withoutBuild).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pre = dash >= 0 ? withoutBuild.slice(dash + 1).split('.') : null;
  return { core, pre };
}

function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const diff = (a.core[i] ?? 0) - (b.core[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  // Vorabversion (1.0.0-beta) ist kleiner als die fertige Version (1.0.0)
  if (a.pre && !b.pre) return -1;
  if (!a.pre && b.pre) return 1;
  if (!a.pre || !b.pre) return 0;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null && nx !== ny) return Math.sign(nx - ny);
    if (nx === null || ny === null) {
      if (nx !== null) return -1;
      if (ny !== null) return 1;
      if (x !== y) return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** Eine einzelne Bedingung wie ">=1.2.3", "~1.2", "^2.0.0", "1.2.x" oder "*". */
function satisfiesSingle(version: string, condition: string): boolean {
  const c = condition.trim();
  if (c === '' || c === '*') return true;
  const match = /^(>=|<=|>|<|=|~|\^)?\s*(.+)$/.exec(c);
  if (!match) return true;
  const [, op = '=', target] = match;
  const v = parseVersion(version);
  // Platzhalter: 1.2.x / 1.x
  if (/(^|\.)[xX*]$/.test(target)) {
    const prefix = target.split('.').filter((part) => !/^[xX*]$/.test(part)).map((part) => Number.parseInt(part, 10) || 0);
    return prefix.every((part, i) => (v.core[i] ?? 0) === part);
  }
  const t = parseVersion(target);
  const cmp = compareVersions(v, t);
  switch (op) {
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    case '~': {
      // gleiche Haupt- und Nebenversion
      return cmp >= 0 && (v.core[0] ?? 0) === (t.core[0] ?? 0) && (v.core[1] ?? 0) === (t.core[1] ?? 0);
    }
    case '^':
      return cmp >= 0 && (v.core[0] ?? 0) === (t.core[0] ?? 0);
    default:
      return cmp === 0;
  }
}

/** Fabric-Versionsregel: Zeichenkette (Bedingungen mit Leerzeichen = UND) oder Liste (ODER). */
export function satisfies(version: string, rule: string | string[]): boolean {
  const alternatives = Array.isArray(rule) ? rule : [rule];
  return alternatives.some((alternative) => alternative.trim().split(/\s+/).every((condition) => satisfiesSingle(version, condition)));
}

// ---------- Mods lesen und prüfen ----------

export async function readFabricMods(modsDir: string): Promise<FabricModInfo[]> {
  const mods: FabricModInfo[] = [];
  for (const file of await readdir(modsDir).catch(() => [] as string[])) {
    if (!file.endsWith('.jar')) continue;
    try {
      const entry = new AdmZip(path.join(modsDir, file)).getEntry('fabric.mod.json');
      if (!entry) continue;
      const json = JSON.parse(entry.getData().toString('utf8').replace(/\r?\n/g, ' ')) as Record<string, unknown>;
      if (typeof json.id !== 'string' || typeof json.version !== 'string') continue;
      mods.push({
        file,
        id: json.id,
        name: typeof json.name === 'string' ? json.name : json.id,
        version: json.version,
        depends: (json.depends && typeof json.depends === 'object' ? json.depends : {}) as Record<string, string | string[]>,
        breaks: (json.breaks && typeof json.breaks === 'object' ? json.breaks : {}) as Record<string, string | string[]>,
        provides: Array.isArray(json.provides) ? json.provides.filter((p): p is string => typeof p === 'string') : [],
      });
    } catch {
      // kaputte JAR: meldet Fabric selbst
    }
  }
  return mods;
}

export function findConflicts(mods: FabricModInfo[]): FabricConflict[] {
  const byId = new Map<string, FabricModInfo>();
  for (const mod of mods) {
    byId.set(mod.id, mod);
    for (const alias of mod.provides) if (!byId.has(alias)) byId.set(alias, mod);
  }
  const conflicts: FabricConflict[] = [];
  for (const mod of mods) {
    for (const [id, rule] of Object.entries(mod.breaks)) {
      const other = byId.get(id);
      if (other && other !== mod && satisfies(other.version, rule)) conflicts.push({ mod, other, kind: 'breaks', rule: Array.isArray(rule) ? rule.join(' || ') : rule });
    }
    for (const [id, rule] of Object.entries(mod.depends)) {
      const other = byId.get(id);
      // fehlende Abhängigkeiten prüft Fabric selbst; hier nur "vorhanden, aber falsche Version"
      if (other && other !== mod && !satisfies(other.version, rule)) conflicts.push({ mod, other, kind: 'depends', rule: Array.isArray(rule) ? rule.join(' || ') : rule });
    }
  }
  return conflicts;
}

/**
 * Löst Konflikte, indem verzichtbare Mods ausgeschaltet werden (umbenannt in .jar.disabled, wie der Schalter
 * im Launcher). Gibt verständliche Hinweise zurück. Konflikte zwischen zwei unverzichtbaren Mods bleiben stehen.
 */
export async function resolveFabricConflicts(modsDir: string, optional: (mod: FabricModInfo) => boolean): Promise<string[]> {
  const notes: string[] = [];
  for (let round = 0; round < 10; round++) {
    const conflicts = findConflicts(await readFabricMods(modsDir));
    if (conflicts.length === 0) break;
    const conflict = conflicts[0];
    // verzichtbar ist die Mod, die man weglassen kann, ohne dass etwas Gewolltes fehlt
    const victim = optional(conflict.mod) ? conflict.mod : optional(conflict.other) ? conflict.other : null;
    if (!victim) {
      const reason = conflict.kind === 'breaks' ? 'verträgt sich nicht mit' : 'braucht eine andere Version von';
      notes.push(`Achtung: ${conflict.mod.name} ${conflict.mod.version} ${reason} ${conflict.other.name} ${conflict.other.version} (${conflict.rule}).`);
      break;
    }
    const keep = victim === conflict.mod ? conflict.other : conflict.mod;
    await rename(path.join(modsDir, victim.file), path.join(modsDir, `${victim.file}.disabled`));
    notes.push(`${victim.name} ausgeschaltet: passt nicht zu ${keep.name} ${keep.version}. Wieder einschalten geht in den Mods der Instanz, sobald es neue Versionen gibt.`);
  }
  return notes;
}
