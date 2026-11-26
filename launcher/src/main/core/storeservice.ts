// Addon-Store als eigene Seite (siehe core/addonstore.ts): Übersicht mit eigenen Bewertungen, Versionsverlauf,
// Screenshots, Bewerten und Melden über den Heldix-Dienst, „Alle aktualisieren“ und die Prüfung auf Addon-Updates im
// Hintergrund (beim Start und alle 6 Stunden) mit Benachrichtigung einmal je Version.

import type { AddonDetails, AddonRating, AddonReportReason, StoreOverview } from '../../shared/api';
import {
  applyPendingRemovals,
  fetchAddonDetails,
  fetchAddonScreenshot,
  fetchStore,
  installStoreAddon,
  parseRating,
  pendingUpdates,
  storeOverview,
  type OverviewInstance,
  type PendingUpdate,
  type StoreEntry,
} from './addonstore';
import { listContent } from './content';
import { readJson, writeJson } from './fsutil';

export const ADDON_CHECK_INTERVAL_MS = 6 * 60 * 60_000;
const FIRST_CHECK_MS = 10_000;
const RATING_CACHE_MS = 5 * 60_000;
const REASONS: readonly AddonReportReason[] = ['malware', 'broken', 'inappropriate', 'copyright', 'other'];
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Teil von core/social.ts, den der Store braucht (angemeldete Anfragen) */
export interface StoreAuth {
  authed<T>(route: string, init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown }, options?: { offlineMessage?: string; quiet?: boolean }): Promise<T>;
  canAuthenticate(): Promise<boolean>;
  accountId(): Promise<string | null>;
}

export type StoreNotice = { kind: 'available' | 'updated'; items: { addonId: string; name: string; version: string }[] };

export interface StoreServiceOptions {
  serviceUrl: string;
  publicKey: string | null;
  /** alle Instanzen mit HeldixClient */
  instances(): Promise<OverviewInstance[]>;
  /** läuft das Spiel in dieser Instanz (oder wird vorbereitet)? */
  busy(instanceId: string): boolean;
  gameRunning(): boolean;
  auth: StoreAuth | null;
  settings(): Promise<{ addonUpdateNotifications: boolean; addonAutoUpdate: boolean }>;
  /** Datei mit den schon gemeldeten Versionen */
  stateFile: string;
  /** Zwischenspeicher der Screenshots */
  screenshotDir: string | null;
  /** neue Zahl der Addons mit Update (Abzeichen) */
  onCount?(count: number): void;
  onNotice?(notice: StoreNotice): void;
  log?(line: string): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** nicht mehr als limit Aufgaben gleichzeitig */
async function pool<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

export class AddonStoreService {
  private entries: StoreEntry[] | null = null;
  private count = 0;
  private sentCount: number | null = null;
  private readonly ratings = new Map<string, { value: number | null; at: number }>();
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;

  constructor(private readonly options: StoreServiceOptions) {}

  /** zuletzt gezählte Addons mit Update */
  get updates(): number {
    return this.count;
  }

  private async liveInstances(): Promise<OverviewInstance[]> {
    return (await this.options.instances()).filter((i) => !this.options.busy(i.id));
  }

  private remember(entries: StoreEntry[]): void {
    this.entries = entries;
  }

  /** Update-Zähler neu berechnen (ohne Netz, mit der zuletzt geladenen Liste) und bei Änderung melden. */
  async recount(): Promise<number> {
    if (!this.entries) return this.count;
    const updates = await pendingUpdates(await this.options.instances(), this.entries);
    this.setCount(new Set(updates.map((u) => u.addonId)).size);
    return this.count;
  }

  private setCount(count: number): void {
    this.count = count;
    if (count !== this.sentCount) {
      this.sentCount = count;
      this.options.onCount?.(count);
    }
  }

  // ---------- Übersicht ----------

  async overview(): Promise<StoreOverview> {
    const list = await this.options.instances();
    for (const instance of list) {
      if (!this.options.busy(instance.id)) await applyPendingRemovals(instance.dir).catch(() => undefined);
    }
    const overview = await storeOverview(list, this.options.serviceUrl, this.options.publicKey, {
      myRatings: (ids) => this.myRatings(ids),
      onEntries: (entries) => this.remember(entries),
    });
    if (!overview.error) {
      // Zähler aus der Übersicht selbst (Addons mit Update in irgendeiner Instanz)
      this.setCount(overview.addons.filter((a) => a.installs.some((i) => i.state === 'update')).length);
    }
    return overview;
  }

  private ratingKey(account: string, id: string): string {
    return `${account}\n${id}`;
  }

  /** eigene Bewertungen (zwischengespeichert je Konto); ohne Anmeldung oder bei Fehlern leer */
  private async myRatings(ids: string[]): Promise<Map<string, number | null>> {
    const result = new Map<string, number | null>();
    const auth = this.options.auth;
    if (!auth || ids.length === 0 || !(await auth.canAuthenticate())) return result;
    const account = await auth.accountId();
    if (!account) return result;
    const missing = ids.filter((id) => {
      const hit = this.ratings.get(this.ratingKey(account, id));
      if (hit && Date.now() - hit.at < RATING_CACHE_MS) {
        result.set(id, hit.value);
        return false;
      }
      return true;
    });
    let failed = false;
    await pool(missing, 4, async (id) => {
      if (failed) return;
      try {
        const data = await auth.authed<{ myRating?: unknown }>(`/v1/addons/${encodeURIComponent(id)}/rating`, {}, { quiet: true });
        const value = Number.isInteger(data.myRating) && (data.myRating as number) >= 1 && (data.myRating as number) <= 5 ? (data.myRating as number) : null;
        this.ratings.set(this.ratingKey(account, id), { value, at: Date.now() });
        result.set(id, value);
      } catch {
        // nicht angemeldet oder Dienst weg: die übrigen gar nicht erst fragen
        failed = true;
      }
    });
    return result;
  }

  async details(id: unknown): Promise<AddonDetails> {
    return fetchAddonDetails(this.options.serviceUrl, String(id));
  }

  async screenshot(id: unknown, index: unknown): Promise<string | null> {
    if (typeof id !== 'string' || typeof index !== 'number') return null;
    const entry = this.entries?.find((e) => e.manifest.id === id);
    if (entry && index > entry.screenshots) return null;
    return fetchAddonScreenshot(this.options.serviceUrl, id, index, entry?.screenshotsVersion ?? '', this.options.screenshotDir).catch(() => null);
  }

  private requireAuth(): StoreAuth {
    if (!this.options.auth) throw new Error('Kein Heldix-Dienst eingerichtet.');
    return this.options.auth;
  }

  async rate(id: unknown, stars: unknown): Promise<AddonRating & { myRating: number | null }> {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Ungültige Addon-ID');
    if (stars !== null && (!Number.isInteger(stars) || (stars as number) < 1 || (stars as number) > 5)) throw new Error('Bitte 1 bis 5 Sterne vergeben.');
    const auth = this.requireAuth();
    const route = `/v1/addons/${encodeURIComponent(id)}/rating`;
    const offlineMessage = 'Bewerten geht nur mit einem Microsoft-Konto.';
    let data = await auth.authed<{ myRating?: unknown; average?: unknown; count?: unknown }>(
      route,
      stars === null ? { method: 'DELETE' } : { method: 'PUT', body: { stars } },
      { offlineMessage },
    );
    if (data === null || typeof data !== 'object' || !('count' in data)) data = await auth.authed(route, {}, { offlineMessage });
    const myRating = Number.isInteger(data.myRating) ? (data.myRating as number) : stars === null ? null : (stars as number);
    const rating = parseRating(data);
    const account = await auth.accountId();
    if (account) this.ratings.set(this.ratingKey(account, id), { value: myRating, at: Date.now() });
    const entry = this.entries?.find((e) => e.manifest.id === id);
    if (entry) entry.rating = rating;
    return { ...rating, myRating };
  }

  async report(id: unknown, reason: unknown, note?: unknown): Promise<void> {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error('Ungültige Addon-ID');
    if (!REASONS.includes(reason as AddonReportReason)) throw new Error('Bitte einen Grund für die Meldung wählen.');
    const text = typeof note === 'string' ? note.trim() : '';
    if ([...text].length > 500) throw new Error('Die Notiz hat höchstens 500 Zeichen.');
    await this.requireAuth().authed(`/v1/addons/${encodeURIComponent(id)}/reports`, { method: 'POST', body: { reason, ...(text ? { note: text } : {}) } }, {
      offlineMessage: 'Melden geht nur mit einem Microsoft-Konto.',
    });
  }

  // ---------- Aktualisieren ----------

  private async install(updates: PendingUpdate[], instances: OverviewInstance[], entries: StoreEntry[]): Promise<{ done: PendingUpdate[]; failed: string[] }> {
    const done: PendingUpdate[] = [];
    const failed: string[] = [];
    for (const update of updates) {
      const instance = instances.find((i) => i.id === update.instanceId);
      if (!instance || this.options.busy(instance.id)) continue;
      try {
        await applyPendingRemovals(instance.dir);
        await installStoreAddon(instance.dir, this.options.serviceUrl, this.options.publicKey, update.addonId, entries, instance);
        done.push(update);
        this.options.log?.(`Addon aktualisiert: ${update.name} ${update.version} in „${instance.name}“`);
      } catch (error) {
        failed.push(`${update.name} in „${instance.name}“: ${message(error)}`);
      }
    }
    return { done, failed };
  }

  /** Alle Addon-Updates in allen Instanzen installieren, die gerade nicht laufen. */
  async updateAll(): Promise<{ updated: number; failed: string[] }> {
    const entries = await fetchStore(this.options.serviceUrl, this.options.publicKey);
    this.remember(entries);
    const instances = await this.liveInstances();
    const { done, failed } = await this.install(await pendingUpdates(instances, entries), instances, entries);
    await this.recount();
    return { updated: done.length, failed };
  }

  // ---------- Prüfung im Hintergrund ----------

  start(): void {
    this.schedule(FIRST_CHECK_MS);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.check().finally(() => this.schedule(ADDON_CHECK_INTERVAL_MS));
    }, ms);
    this.timer.unref?.();
  }

  /** Store fragen, Zähler melden, bei Bedarf automatisch aktualisieren und benachrichtigen. */
  check(): Promise<void> {
    this.checking ??= this.runCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  private async runCheck(): Promise<void> {
    const instances = await this.options.instances();
    // Ohne installierte Addons fragt der Launcher den Store gar nicht erst
    if (!(await Promise.all(instances.map((i) => hasAddons(i.dir)))).some(Boolean)) {
      this.setCount(0);
      return;
    }
    let entries: StoreEntry[];
    try {
      entries = await fetchStore(this.options.serviceUrl, this.options.publicKey);
    } catch (error) {
      this.options.log?.(`Addon-Updates: ${message(error)}`);
      return;
    }
    this.remember(entries);
    let updates = await pendingUpdates(instances, entries);
    const settings = await this.options.settings();
    let updated: PendingUpdate[] = [];
    if (settings.addonAutoUpdate && updates.length > 0 && !this.options.gameRunning()) {
      updated = (await this.install(updates, instances, entries)).done;
      updates = await pendingUpdates(instances, entries);
    }
    this.setCount(new Set(updates.map((u) => u.addonId)).size);
    if (!settings.addonUpdateNotifications) return;

    const distinct = (list: PendingUpdate[]) => [...new Map(list.map((u) => [`${u.addonId}@${u.version}`, { addonId: u.addonId, name: u.name, version: u.version }])).values()];
    if (updated.length > 0) this.options.onNotice?.({ kind: 'updated', items: distinct(updated) });
    const state = (await readJson<{ notified?: unknown }>(this.options.stateFile)) ?? {};
    const notified = new Set(Array.isArray(state.notified) ? state.notified.filter((n): n is string => typeof n === 'string') : []);
    const fresh = distinct(updates).filter((u) => !notified.has(`${u.addonId}@${u.version}`));
    if (fresh.length === 0) return;
    this.options.onNotice?.({ kind: 'available', items: fresh });
    for (const item of fresh) notified.add(`${item.addonId}@${item.version}`);
    await writeJson(this.options.stateFile, { notified: [...notified].slice(-300) }).catch(() => undefined);
  }
}

async function hasAddons(dir: string): Promise<boolean> {
  return (await listContent(dir, 'addons', 'heldix')).some((item) => item.id);
}

/** Text der Benachrichtigung, z. B. „Spotify 1.2.0, Discord 2.0.1 und 2 weitere“ */
export function noticeList(items: StoreNotice['items']): string {
  const shown = items.slice(0, 2).map((i) => `${i.name} ${i.version}`).join(', ');
  const rest = items.length - 2;
  return rest > 0 ? `${shown} und ${rest} ${rest === 1 ? 'weiteres' : 'weitere'}` : shown;
}
