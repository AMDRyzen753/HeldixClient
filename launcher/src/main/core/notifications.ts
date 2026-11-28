// Verlauf der Benachrichtigungen (Glocke in der Titelleiste): Freundschaftsanfragen, Nachrichten, angenommene und
// bestätigte Einladungen, Freischaltungen, geöffnete Welten von Freunden, Einladungen in Welten und Partys, „Folgen“
// (der Party-Leiter ist woanders), Launcher- und Addon-Updates; ab Dienst 1.13.0 dauerhafte Welten (freigeschaltet,
// Fehler bzw. Absturz der eigenen Welt, Anklopfen ohne laufendes Spiel).
//
// Lokal im Datenordner (notifications.json), nie beim Dienst. Höchstens 100 Einträge und 30 Tage; Einträge mit
// demselben Schlüssel (z. B. weitere Nachrichten desselben Freundes) werden zusammengefasst, solange sie ungelesen
// sind. Einträge zu Freunden gehören zum Konto, mit dem sie kamen, und erscheinen nur bei diesem Konto.

import { randomBytes } from 'node:crypto';
import type { LauncherNotification, NotificationKind, NotificationList, NotificationTarget } from '../../shared/api';
import { readJson, writeJson } from './fsutil';

export const NOTIFICATION_FILE = 'notifications.json';
export const NOTIFICATION_LIMIT = 100;
export const NOTIFICATION_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const KINDS: readonly NotificationKind[] = ['friend-request', 'message', 'invite-accepted', 'invite-confirmed', 'unlock', 'world-open', 'world-invite', 'party-invite', 'party-follow', 'update', 'addons',
  'hosting-granted', 'hosting-problem', 'hosting-knock'];
/** hosting = Webseite, Konto → Meine Welten (dauerhafte Welten) */
const VIEWS = ['friends', 'invites', 'cosmetics', 'store', 'updates', 'world', 'party', 'hosting'] as const;

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  body?: string;
  target?: NotificationTarget | null;
  /** Konto im Launcher (null = gilt für alle, z. B. Updates) */
  account?: string | null;
  /** gleicher Schlüssel + ungelesen = Eintrag wird aktualisiert statt neu angelegt */
  key?: string | null;
  /** nur einmal: gibt es den Schlüssel schon (auch gelesen), passiert nichts (z. B. Update je Version) */
  once?: boolean;
}

interface StoredNotification extends LauncherNotification {
  account: string | null;
  key: string | null;
}

interface NotificationFile {
  version: 1;
  items: StoredNotification[];
}

export interface NotificationStoreOptions {
  now?(): number;
  /** nach jeder Änderung (für die Oberfläche und das Tray-Menü) */
  onChange?(): void;
  /** Schreibpause, damit viele Meldungen auf einmal nur einmal schreiben */
  writeDelayMs?: number;
}

function text(value: unknown, max: number): string {
  const clean = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const chars = [...clean];
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : clean;
}

function target(raw: unknown): NotificationTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (!VIEWS.includes(t.view as (typeof VIEWS)[number])) return null;
  const out: NotificationTarget = { view: t.view as NotificationTarget['view'] };
  if (typeof t.uuid === 'string' && /^[0-9a-f]{32}$/.test(t.uuid)) out.uuid = t.uuid;
  if (typeof t.id === 'string' && /^[a-z0-9_-]{1,40}$/.test(t.id)) out.id = t.id;
  if (typeof t.code === 'string' && /^[a-hjkmnp-z2-9]{6}$/.test(t.code)) out.code = t.code;
  return out;
}

/** Eintrag aus der Datei prüfen (alte oder kaputte Einträge fallen weg) */
function sanitize(raw: unknown): StoredNotification | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[0-9a-f]{16}$/.test(r.id)) return null;
  if (!KINDS.includes(r.kind as NotificationKind)) return null;
  const title = text(r.title, 120);
  if (!title || typeof r.at !== 'number' || !Number.isFinite(r.at)) return null;
  return {
    id: r.id,
    kind: r.kind as NotificationKind,
    title,
    body: text(r.body, 240),
    at: r.at,
    read: r.read === true,
    count: typeof r.count === 'number' && Number.isInteger(r.count) && r.count > 1 ? Math.min(r.count, 999) : 1,
    target: target(r.target),
    account: typeof r.account === 'string' && r.account.length <= 64 ? r.account : null,
    key: typeof r.key === 'string' && r.key.length <= 120 ? r.key : null,
  };
}

export class NotificationStore {
  private items: StoredNotification[] | null = null;
  private loading: Promise<StoredNotification[]> | null = null;
  private writeTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(
    private readonly file: string,
    private readonly options: NotificationStoreOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
  }

  private async load(): Promise<StoredNotification[]> {
    if (this.items) return this.items;
    this.loading ??= (async () => {
      const data = await readJson<NotificationFile>(this.file);
      const items = (Array.isArray(data?.items) ? data.items : []).map(sanitize).filter((n): n is StoredNotification => n !== null);
      this.items = this.prune(items);
      return this.items;
    })().finally(() => (this.loading = null));
    return this.loading;
  }

  /** zu alt oder zu viele: weg (neueste zuerst) */
  private prune(items: StoredNotification[]): StoredNotification[] {
    const oldest = this.now() - NOTIFICATION_MAX_AGE_MS;
    return items.filter((n) => n.at >= oldest).sort((a, b) => b.at - a.at).slice(0, NOTIFICATION_LIMIT);
  }

  private changed(): void {
    this.options.onChange?.();
    if (this.writeTimer) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.flush();
    }, this.options.writeDelayMs ?? 300);
    this.writeTimer.unref?.();
  }

  /** Jetzt schreiben (z. B. beim Beenden und in Tests) */
  flush(): Promise<void> {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = null;
    const items = this.items;
    if (!items) return this.writing;
    this.writing = this.writing
      .then(() => writeJson(this.file, { version: 1, items } satisfies NotificationFile))
      .catch((error) => console.warn('[Launcher] Benachrichtigungen nicht gespeichert:', error instanceof Error ? error.message : error));
    return this.writing;
  }

  private visible(n: StoredNotification, account: string | null): boolean {
    return n.account === null || n.account === account;
  }

  /** Einträge für dieses Konto (neueste zuerst) und Zahl der ungelesenen */
  async list(account: string | null): Promise<NotificationList> {
    const items = this.prune(await this.load());
    this.items = items;
    const mine = items.filter((n) => this.visible(n, account));
    return {
      items: mine.map(({ account: _account, key: _key, ...rest }) => rest),
      unread: mine.filter((n) => !n.read).length,
    };
  }

  /** Neuer Eintrag (oder zusammengefasst mit einem ungelesenen gleichen Schlüssels); once + vorhanden: null */
  async add(input: NewNotification): Promise<LauncherNotification | null> {
    const items = await this.load();
    const account = input.account ?? null;
    const key = input.key ? input.key.slice(0, 120) : null;
    const now = this.now();
    if (input.once && key && items.some((n) => n.key === key && n.account === account)) return null;
    const existing = key ? items.find((n) => n.key === key && n.account === account && !n.read) : undefined;
    let entry: StoredNotification;
    if (existing) {
      existing.title = text(input.title, 120) || existing.title;
      existing.body = text(input.body, 240);
      existing.at = now;
      existing.count = Math.min(999, existing.count + 1);
      existing.target = target(input.target) ?? existing.target;
      entry = existing;
    } else {
      entry = {
        id: randomBytes(8).toString('hex'),
        kind: input.kind,
        title: text(input.title, 120) || 'Benachrichtigung',
        body: text(input.body, 240),
        at: now,
        read: false,
        count: 1,
        target: target(input.target),
        account,
        key,
      };
      items.push(entry);
    }
    this.items = this.prune(items);
    this.changed();
    const { account: _account, key: _key, ...view } = entry;
    return view;
  }

  /** Ein Eintrag gelesen (Klick); unbekannte ID: nichts */
  async markRead(id: unknown): Promise<void> {
    if (typeof id !== 'string') return;
    const items = await this.load();
    const entry = items.find((n) => n.id === id);
    if (!entry || entry.read) return;
    entry.read = true;
    this.changed();
  }

  /** Einträge mit diesem Schlüssel gelesen (z. B. Unterhaltung geöffnet → „Neue Nachricht von …“) */
  async markKeyRead(key: string, account: string | null): Promise<void> {
    const items = await this.load();
    let changed = false;
    for (const n of items) {
      if (!n.read && n.key === key && n.account === account) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** „Alle gelesen“ für dieses Konto */
  async markAllRead(account: string | null): Promise<void> {
    const items = await this.load();
    let changed = false;
    for (const n of items) {
      if (!n.read && this.visible(n, account)) {
        n.read = true;
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  /** Alle Einträge löschen (Datenschutz: „Verlauf leeren“) */
  async clear(account: string | null): Promise<void> {
    const items = await this.load();
    const rest = items.filter((n) => !this.visible(n, account));
    if (rest.length === items.length) return;
    this.items = rest;
    this.changed();
  }

  async get(id: unknown): Promise<LauncherNotification | null> {
    if (typeof id !== 'string') return null;
    const entry = (await this.load()).find((n) => n.id === id);
    if (!entry) return null;
    const { account: _account, key: _key, ...view } = entry;
    return view;
  }
}
