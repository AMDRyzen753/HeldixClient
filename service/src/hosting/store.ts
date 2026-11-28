// Dauerhafte Welten (1.13.0): Datenbankzugriffe für dauerhafte Welten, ihre Plugins und die Freischaltungen. Die Tabellen
// legt Stufe 12 in db.ts an; hier stehen nur die Abfragen (über Store.prepare auf derselben Datenbank).
import type { StatementSync } from 'node:sqlite';
import type { Store } from '../db';
import type { ServerJar } from './runner';

/** Zustand einer dauerhaften Welt (Lebenszyklus, siehe dauerhafte-welten-spec.md). */
export type HostedState = 'creating' | 'sleeping' | 'starting' | 'running' | 'stopping' | 'error';
export const HOSTED_STATES: readonly HostedState[] = ['creating', 'sleeping', 'starting', 'running', 'stopping', 'error'];

/** Woher eine Freischaltung kommt: Beta (vom Team); später Heldix+ (Abo). */
export type GrantSource = 'beta' | 'plus';
export const GRANT_SOURCES: readonly GrantSource[] = ['beta', 'plus'];

export interface HostedRow {
  world: string;
  state: HostedState;
  error: string | null;
  jar: ServerJar;
  memoryMb: number;
  diskMb: number;
  maxPlugins: number;
  /** Minuten ohne Spieler bis zum Schlafen; 0 = nie (nur vom Team gesetzt) */
  sleepAfterMin: number;
  properties: Record<string, string>;
  icon: Buffer | null;
  /** Datenordner angelegt und Server-Jar geladen */
  prepared: boolean;
  /** wartet auf die hochgeladene Welt (angelegt aus einer geteilten Welt) */
  awaitingUpload: boolean;
  /** Einstellungen oder Plugins geändert, wirkt erst nach einem Neustart */
  restartNeeded: boolean;
  createdAt: number;
  lastStartedAt: number | null;
  lastActiveAt: number | null;
  lastDailyBackupAt: number | null;
  /** zuletzt per Konsole gesetzte Rolle je Name (klein) */
  appliedRoles: Record<string, string>;
}

export interface HostedWithOwner extends HostedRow {
  owner: string;
}

export type HostedPatch = Partial<
  Pick<
    HostedRow,
    | 'jar'
    | 'memoryMb'
    | 'diskMb'
    | 'maxPlugins'
    | 'sleepAfterMin'
    | 'properties'
    | 'icon'
    | 'prepared'
    | 'awaitingUpload'
    | 'restartNeeded'
    | 'lastStartedAt'
    | 'lastActiveAt'
    | 'lastDailyBackupAt'
    | 'appliedRoles'
  >
>;

export interface HostedPluginRow {
  project: string;
  slug: string;
  title: string;
  icon: string | null;
  versionId: string;
  versionNumber: string;
  file: string;
  sha512: string;
  installedAt: number;
}

export interface GrantRow {
  uuid: string;
  /** Name des Spielers (aus users) */
  name: string;
  source: GrantSource;
  grantedAt: number;
  grantedBy: string | null;
  expiresAt: number | null;
  seenAt: number | null;
}

type Row = Record<string, unknown>;

const HOSTED_COLUMNS = `h.world, h.state, h.error, h.jar, h.memory_mb, h.disk_mb, h.max_plugins, h.sleep_after_min, h.properties, h.icon,
  h.prepared, h.awaiting_upload, h.restart_needed, h.created_at, h.last_started_at, h.last_active_at, h.last_daily_backup_at,
  h.applied_roles, w.owner`;
const PLUGIN_COLUMNS = 'project, slug, title, icon, version_id, version_number, file, sha512, installed_at';
const GRANT_COLUMNS = 'g.uuid, u.name, g.source, g.granted_at, g.granted_by, g.expires_at, g.seen_at';

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

function parseObject(value: unknown): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(String(value));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) if (typeof entry === 'string') out[key] = entry;
    return out;
  } catch {
    return {};
  }
}

function parseJar(value: unknown): ServerJar {
  try {
    const parsed = JSON.parse(String(value)) as Partial<ServerJar>;
    return {
      software: parsed.software === 'vanilla' ? 'vanilla' : 'paper',
      version: typeof parsed.version === 'string' ? parsed.version : '',
      url: typeof parsed.url === 'string' ? parsed.url : '',
      ...(typeof parsed.sha256 === 'string' ? { sha256: parsed.sha256 } : {}),
      ...(typeof parsed.sha1 === 'string' ? { sha1: parsed.sha1 } : {}),
      build: typeof parsed.build === 'number' ? parsed.build : null,
    };
  } catch {
    return { software: 'paper', version: '', url: '', build: null };
  }
}

function toState(value: unknown): HostedState {
  return (HOSTED_STATES as readonly unknown[]).includes(value) ? (value as HostedState) : 'error';
}

function toHosted(row: Row): HostedWithOwner {
  return {
    world: String(row.world),
    owner: String(row.owner),
    state: toState(row.state),
    error: row.error === null || row.error === undefined ? null : String(row.error),
    jar: parseJar(row.jar),
    memoryMb: Number(row.memory_mb),
    diskMb: Number(row.disk_mb),
    maxPlugins: Number(row.max_plugins),
    sleepAfterMin: Number(row.sleep_after_min),
    properties: parseObject(row.properties),
    icon: row.icon instanceof Uint8Array ? Buffer.from(row.icon) : null,
    prepared: Number(row.prepared) === 1,
    awaitingUpload: Number(row.awaiting_upload) === 1,
    restartNeeded: Number(row.restart_needed) === 1,
    createdAt: Number(row.created_at),
    lastStartedAt: num(row.last_started_at),
    lastActiveAt: num(row.last_active_at),
    lastDailyBackupAt: num(row.last_daily_backup_at),
    appliedRoles: parseObject(row.applied_roles),
  };
}

function toPlugin(row: Row): HostedPluginRow {
  return {
    project: String(row.project),
    slug: String(row.slug),
    title: String(row.title),
    icon: row.icon === null || row.icon === undefined ? null : String(row.icon),
    versionId: String(row.version_id),
    versionNumber: String(row.version_number),
    file: String(row.file),
    sha512: String(row.sha512),
    installedAt: Number(row.installed_at),
  };
}

function toGrant(row: Row): GrantRow {
  return {
    uuid: String(row.uuid),
    name: String(row.name ?? ''),
    source: row.source === 'plus' ? 'plus' : 'beta',
    grantedAt: Number(row.granted_at),
    grantedBy: row.granted_by === null || row.granted_by === undefined ? null : String(row.granted_by),
    expiresAt: num(row.expires_at),
    seenAt: num(row.seen_at),
  };
}

/** Spalten, die HostedPatch ändern darf, mit ihrer Umwandlung für SQLite. */
const PATCH_COLUMNS: Record<keyof HostedPatch, [string, (value: never) => unknown]> = {
  jar: ['jar', (v: ServerJar) => JSON.stringify(v)],
  memoryMb: ['memory_mb', (v: number) => v],
  diskMb: ['disk_mb', (v: number) => v],
  maxPlugins: ['max_plugins', (v: number) => v],
  sleepAfterMin: ['sleep_after_min', (v: number) => v],
  properties: ['properties', (v: Record<string, string>) => JSON.stringify(v)],
  icon: ['icon', (v: Buffer | null) => v],
  prepared: ['prepared', (v: boolean) => (v ? 1 : 0)],
  awaitingUpload: ['awaiting_upload', (v: boolean) => (v ? 1 : 0)],
  restartNeeded: ['restart_needed', (v: boolean) => (v ? 1 : 0)],
  lastStartedAt: ['last_started_at', (v: number | null) => v],
  lastActiveAt: ['last_active_at', (v: number | null) => v],
  lastDailyBackupAt: ['last_daily_backup_at', (v: number | null) => v],
  appliedRoles: ['applied_roles', (v: Record<string, string>) => JSON.stringify(v)],
};

export class HostingStore {
  private readonly sql: Record<string, StatementSync>;
  private readonly patchStatements = new Map<string, StatementSync>();

  constructor(private readonly store: Store) {
    const p = (sql: string) => store.prepare(sql);
    this.sql = {
      insert: p(`
        INSERT INTO hosted_worlds (world, state, error, jar, memory_mb, disk_mb, max_plugins, sleep_after_min, properties, icon,
          prepared, awaiting_upload, restart_needed, created_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`),
      get: p(`SELECT ${HOSTED_COLUMNS} FROM hosted_worlds h JOIN worlds w ON w.id = h.world WHERE h.world = ?`),
      all: p(`SELECT ${HOSTED_COLUMNS} FROM hosted_worlds h JOIN worlds w ON w.id = h.world ORDER BY h.created_at, h.world`),
      ofOwner: p(`SELECT ${HOSTED_COLUMNS} FROM hosted_worlds h JOIN worlds w ON w.id = h.world WHERE w.owner = ? ORDER BY h.created_at, h.world`),
      countOf: p('SELECT count(*) AS n FROM hosted_worlds h JOIN worlds w ON w.id = h.world WHERE w.owner = ?'),
      ownedBy: p('SELECT h.world, w.owner FROM hosted_worlds h JOIN worlds w ON w.id = h.world WHERE w.owner IN (SELECT value FROM json_each(?)) ORDER BY h.created_at, h.world'),
      ids: p('SELECT world FROM hosted_worlds'),
      tombstones: p('SELECT world FROM hosted_tombstones'),
      clearTombstone: p('DELETE FROM hosted_tombstones WHERE world = ?'),
      setState: p('UPDATE hosted_worlds SET state = ?, error = ? WHERE world = ?'),
      delete: p('DELETE FROM hosted_worlds WHERE world = ?'),
      plugins: p(`SELECT ${PLUGIN_COLUMNS} FROM hosted_plugins WHERE world = ? ORDER BY title COLLATE NOCASE, project`),
      plugin: p(`SELECT ${PLUGIN_COLUMNS} FROM hosted_plugins WHERE world = ? AND project = ?`),
      countPlugins: p('SELECT count(*) AS n FROM hosted_plugins WHERE world = ?'),
      putPlugin: p(`
        INSERT INTO hosted_plugins (world, ${PLUGIN_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (world, project) DO UPDATE SET slug = excluded.slug, title = excluded.title, icon = excluded.icon,
          version_id = excluded.version_id, version_number = excluded.version_number, file = excluded.file,
          sha512 = excluded.sha512, installed_at = excluded.installed_at`),
      deletePlugin: p('DELETE FROM hosted_plugins WHERE world = ? AND project = ?'),
      deletePlugins: p('DELETE FROM hosted_plugins WHERE world = ?'),
      putSnapshot: p('INSERT INTO hosted_backup_plugins (world, name, plugins) VALUES (?, ?, ?) ON CONFLICT (world, name) DO UPDATE SET plugins = excluded.plugins'),
      snapshot: p('SELECT plugins FROM hosted_backup_plugins WHERE world = ? AND name = ?'),
      deleteSnapshot: p('DELETE FROM hosted_backup_plugins WHERE world = ? AND name = ?'),
      putGrant: p(`
        INSERT INTO hosting_grants (uuid, source, granted_at, granted_by, expires_at, seen_at) VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT (uuid, source) DO UPDATE SET expires_at = excluded.expires_at`),
      deleteGrant: p('DELETE FROM hosting_grants WHERE uuid = ? AND source = ?'),
      grantsOf: p(`SELECT ${GRANT_COLUMNS} FROM hosting_grants g JOIN users u ON u.uuid = g.uuid WHERE g.uuid = ? ORDER BY g.granted_at, g.source`),
      allGrants: p(`SELECT ${GRANT_COLUMNS} FROM hosting_grants g JOIN users u ON u.uuid = g.uuid ORDER BY g.granted_at DESC, g.uuid`),
      activeGrant: p('SELECT 1 AS x FROM hosting_grants WHERE uuid = ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1'),
      grantedIn: p('SELECT DISTINCT uuid FROM hosting_grants WHERE uuid IN (SELECT value FROM json_each(?)) AND (expires_at IS NULL OR expires_at > ?)'),
      markSeen: p('UPDATE hosting_grants SET seen_at = ? WHERE uuid = ? AND seen_at IS NULL'),
      unseen: p(`SELECT ${GRANT_COLUMNS} FROM hosting_grants g JOIN users u ON u.uuid = g.uuid WHERE g.uuid = ? AND g.seen_at IS NULL
        AND (g.expires_at IS NULL OR g.expires_at > ?) ORDER BY g.granted_at DESC LIMIT 1`),
    };
  }

  // ---------- Dauerhafte Welten ----------

  insert(row: {
    world: string;
    state: HostedState;
    jar: ServerJar;
    memoryMb: number;
    diskMb: number;
    maxPlugins: number;
    sleepAfterMin: number;
    properties: Record<string, string>;
    icon: Buffer | null;
    awaitingUpload: boolean;
    createdAt: number;
  }): void {
    // Wieder dauerhaft (gleiche ID): kein Grabstein mehr, der die neuen Daten löschen würde
    this.clearTombstone(row.world);
    this.sql.insert!.run(
      row.world,
      row.state,
      JSON.stringify(row.jar),
      row.memoryMb,
      row.diskMb,
      row.maxPlugins,
      row.sleepAfterMin,
      JSON.stringify(row.properties),
      row.icon,
      row.awaitingUpload ? 1 : 0,
      row.createdAt,
    );
  }

  get(world: string): HostedWithOwner | undefined {
    const row = this.sql.get!.get(world) as Row | undefined;
    return row ? toHosted(row) : undefined;
  }

  all(): HostedWithOwner[] {
    return (this.sql.all!.all() as Row[]).map(toHosted);
  }

  ofOwner(owner: string): HostedWithOwner[] {
    return (this.sql.ofOwner!.all(owner) as Row[]).map(toHosted);
  }

  countOf(owner: string): number {
    return Number((this.sql.countOf!.get(owner) as Row).n);
  }

  /** IDs (mit Besitzer) der dauerhaften Welten dieser Besitzer, ohne die übrigen Spalten. */
  ownedBy(owners: readonly string[]): { world: string; owner: string }[] {
    if (owners.length === 0) return [];
    return (this.sql.ownedBy!.all(JSON.stringify(owners)) as Row[]).map((row) => ({ world: String(row.world), owner: String(row.owner) }));
  }

  /** Gelöschte dauerhafte Welten, deren Daten beim Runner noch zu löschen sind. */
  tombstones(): Set<string> {
    return new Set((this.sql.tombstones!.all() as Row[]).map((row) => String(row.world)));
  }

  clearTombstone(world: string): void {
    this.sql.clearTombstone!.run(world);
  }

  /** IDs aller dauerhaften Welten (für den Abgleich mit dem Runner). */
  ids(): Set<string> {
    return new Set((this.sql.ids!.all() as Row[]).map((row) => String(row.world)));
  }

  setState(world: string, state: HostedState, error: string | null): void {
    this.sql.setState!.run(state, error, world);
  }

  update(world: string, patch: HostedPatch): void {
    const keys = (Object.keys(patch) as (keyof HostedPatch)[]).filter((key) => patch[key] !== undefined);
    if (keys.length === 0) return;
    const signature = keys.join(',');
    let statement = this.patchStatements.get(signature);
    if (!statement) {
      statement = this.store.prepare(`UPDATE hosted_worlds SET ${keys.map((key) => `${PATCH_COLUMNS[key][0]} = ?`).join(', ')} WHERE world = ?`);
      this.patchStatements.set(signature, statement);
    }
    const values = keys.map((key) => (PATCH_COLUMNS[key][1] as (value: unknown) => unknown)(patch[key]));
    statement.run(...(values as (string | number | null | Buffer)[]), world);
  }

  delete(world: string): boolean {
    return Number(this.sql.delete!.run(world).changes) > 0;
  }

  // ---------- Plugins ----------

  plugins(world: string): HostedPluginRow[] {
    return (this.sql.plugins!.all(world) as Row[]).map(toPlugin);
  }

  plugin(world: string, project: string): HostedPluginRow | undefined {
    const row = this.sql.plugin!.get(world, project) as Row | undefined;
    return row ? toPlugin(row) : undefined;
  }

  countPlugins(world: string): number {
    return Number((this.sql.countPlugins!.get(world) as Row).n);
  }

  putPlugin(world: string, plugin: HostedPluginRow): void {
    this.sql.putPlugin!.run(
      world,
      plugin.project,
      plugin.slug,
      plugin.title,
      plugin.icon,
      plugin.versionId,
      plugin.versionNumber,
      plugin.file,
      plugin.sha512,
      plugin.installedAt,
    );
  }

  deletePlugin(world: string, project: string): boolean {
    return Number(this.sql.deletePlugin!.run(world, project).changes) > 0;
  }

  /** Plugins zum Zeitpunkt einer Sicherung merken. */
  saveSnapshot(world: string, backup: string): void {
    this.sql.putSnapshot!.run(world, backup, JSON.stringify(this.plugins(world)));
  }

  deleteSnapshot(world: string, backup: string): void {
    this.sql.deleteSnapshot!.run(world, backup);
  }

  /** Liste der Plugins auf den Stand einer Sicherung setzen; false, wenn es keinen gemerkten Stand gibt. */
  restoreSnapshot(world: string, backup: string): boolean {
    const row = this.sql.snapshot!.get(world, backup) as Row | undefined;
    if (!row) return false;
    let plugins: Row[] = [];
    try {
      const parsed: unknown = JSON.parse(String(row.plugins));
      if (Array.isArray(parsed)) plugins = parsed.filter((p): p is Row => typeof p === 'object' && p !== null);
    } catch {
      return false;
    }
    this.store.transaction(() => {
      this.sql.deletePlugins!.run(world);
      for (const plugin of plugins) {
        this.putPlugin(world, {
          project: String(plugin.project),
          slug: String(plugin.slug),
          title: String(plugin.title),
          icon: typeof plugin.icon === 'string' ? plugin.icon : null,
          versionId: String(plugin.versionId),
          versionNumber: String(plugin.versionNumber),
          file: String(plugin.file),
          sha512: String(plugin.sha512),
          installedAt: Number(plugin.installedAt),
        });
      }
    });
    return true;
  }

  // ---------- Freischaltungen ----------

  /** Freischalten (eine vorhandene Freischaltung derselben Quelle behält Zeitpunkt und „gesehen“); true, wenn neu. */
  grant(uuid: string, source: GrantSource, now: number, by: string | null, expiresAt: number | null = null): boolean {
    const before = this.grantsOf(uuid).some((g) => g.source === source);
    this.sql.putGrant!.run(uuid, source, now, by, expiresAt);
    return !before;
  }

  revoke(uuid: string, source: GrantSource): boolean {
    return Number(this.sql.deleteGrant!.run(uuid, source).changes) > 0;
  }

  grantsOf(uuid: string): GrantRow[] {
    return (this.sql.grantsOf!.all(uuid) as Row[]).map(toGrant);
  }

  allGrants(): GrantRow[] {
    return (this.sql.allGrants!.all() as Row[]).map(toGrant);
  }

  hasActiveGrant(uuid: string, now: number): boolean {
    return this.sql.activeGrant!.get(uuid, now) !== undefined;
  }

  /** Wer von diesen Spielern eine gültige Freischaltung hat. */
  grantedAmong(uuids: readonly string[], now: number): Set<string> {
    if (uuids.length === 0) return new Set();
    return new Set((this.sql.grantedIn!.all(JSON.stringify(uuids), now) as Row[]).map((row) => String(row.uuid)));
  }

  /** Neueste noch nicht gesehene, gültige Freischaltung (für den Hinweis bei der nächsten Verbindung). */
  unseenGrant(uuid: string, now: number): GrantRow | undefined {
    const row = this.sql.unseen!.get(uuid, now) as Row | undefined;
    return row ? toGrant(row) : undefined;
  }

  markGrantsSeen(uuid: string, now: number): void {
    this.sql.markSeen!.run(now, uuid);
  }
}
