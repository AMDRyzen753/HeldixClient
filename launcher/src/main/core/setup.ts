// Einrichtungs-Assistent beim ersten Start (ab 0.13.8, Oberfläche: renderer/setup.ts).
//
// - Ob er erscheint (setupStart): Einstellung setupDone. Fehlt sie, gilt eine Installation mit Einstellungsdatei,
//   Instanzen, Konten oder lastSeenVersion als eingerichtet (setupDone wird dann gleich gespeichert); eine ganz neue
//   bekommt setupDone = false, damit der Assistent nach einem Abbruch beim nächsten Start wiederkommt. Entschieden wird
//   vor ensureInstances – danach gibt es immer eine Instanz.
// - Reihenfolge (SetupGate): Solange der Assistent offen ist, bleibt eine Einladung (Link oder Download) im
//   Main-Prozess liegen (invites:take gibt nichts heraus, der Assistent zeigt sie nur als Karte), und „Neu in …“
//   wartet. Danach holt die Oberfläche die Einladung ab (Einladungsdialog mit „Annehmen“) und fragt „Neu in …“.
// - Addons (setupAddonList, loadSetupAddons): nur offizielle Addons (official im signierten Manifest, fetchStore prüft
//   die Signatur), die auf diesem PC laufen (API-Stufe, System) und in mindestens eine Ziel-Instanz passen
//   (Minecraft-Version, Loader). Empfohlen und vorausgewählt: RECOMMENDED_ADDONS, soweit im Store.
// - Installieren (installSetupAddon): über die geprüfte Installation des Stores (installStoreAddon) in die
//   Standard-Instanzen mit HeldixClient (setupTargets).

import type { SetupAddon, SetupAddons, SetupInstallResult } from '../../shared/api';
import { applyPendingRemovals, fetchStore, incompatibility, installStoreAddon, type OverviewInstance, type StoreEntry } from './addonstore';
import { compareVersions, listContent } from './content';

/** Vorausgewählt (Reihenfolge der Anzeige): Voice Chat, Minimap, Uhrzeit & Spielzeit – nur, wenn sie im Store sind */
export const RECOMMENDED_ADDONS: readonly string[] = ['voicechat', 'minimap', 'uhrzeit'];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---------- Erscheint der Assistent? ----------

export interface SetupProbe {
  /** Inhalt von launcher-settings.json ohne Standardwerte (null = keine Datei) */
  stored: Record<string, unknown> | null;
  /** Instanzen vor ensureInstances */
  instances: number;
  /** gespeicherte Konten (auch alte Offline-Konten) */
  accounts: number;
}

/** show = Assistent zeigen; save = setupDone jetzt so speichern (null = schon gespeichert) */
export function setupStart(probe: SetupProbe): { show: boolean; save: boolean | null } {
  const stored = probe.stored;
  if (stored && typeof stored.setupDone === 'boolean') return { show: !stored.setupDone, save: null };
  const lastSeen = stored && typeof stored.lastSeenVersion === 'string' && stored.lastSeenVersion.trim() !== '';
  const existing = stored !== null || probe.instances > 0 || probe.accounts > 0 || lastSeen;
  return existing ? { show: false, save: true } : { show: true, save: false };
}

// ---------- Reihenfolge mit Einladung und „Neu in …“ ----------

export class SetupGate {
  constructor(private open = false) {}

  /** Assistent offen? */
  get active(): boolean {
    return this.open;
  }

  /** Assistent öffnet (beim Start oder über „Einrichtung erneut starten“) */
  begin(): void {
    this.open = true;
  }

  /** Fertig oder übersprungen */
  end(): void {
    this.open = false;
  }

  /** invites:take: während des Assistenten nichts herausgeben, der Code bleibt liegen (keep) */
  takeInvite(pending: string | null): { code: string | null; keep: string | null } {
    return this.open ? { code: null, keep: pending } : { code: pending, keep: null };
  }

  /** Den Code nur ansehen (Karte im Schritt Willkommen) */
  peekInvite(pending: string | null): string | null {
    return this.open ? pending : null;
  }

  /** „Neu in …“ erst nach dem Assistenten (sonst würde es danebenstehen) */
  whatsNewAllowed(): boolean {
    return !this.open;
  }
}

// ---------- Addons ----------

/** Ziel der Installation: die Instanzen mit dem Heldix Loader (die Standard-Instanzen), sonst alle mit HeldixClient */
export function setupTargets<T extends Pick<OverviewInstance, 'loader'>>(heldixInstances: T[]): T[] {
  const own = heldixInstances.filter((i) => i.loader === 'heldix');
  return own.length > 0 ? own : heldixInstances;
}

/** Installierte Addons einer Instanz: ID → höchste Version */
export type InstalledAddons = Map<string, string | null>;

export async function installedAddonVersions(gameDir: string): Promise<InstalledAddons> {
  const result: InstalledAddons = new Map();
  for (const item of await listContent(gameDir, 'addons', 'heldix')) {
    if (!item.id) continue;
    const known = result.get(item.id);
    if (known === undefined || compareVersions(item.version, known) > 0) result.set(item.id, item.version);
  }
  return result;
}

/** Das Addon passt zum PC und zu dieser Instanz */
function fits(manifest: StoreEntry['manifest'], target: OverviewInstance): boolean {
  return incompatibility(manifest, target) === null;
}

/** Schon da (gleiche oder neuere Version)? */
function present(installed: InstalledAddons | undefined, manifest: StoreEntry['manifest']): boolean {
  if (!installed?.has(manifest.id)) return false;
  return compareVersions(installed.get(manifest.id) ?? null, manifest.version) >= 0;
}

/**
 * Auswahl für den Assistenten: offiziell, läuft auf diesem PC und in mindestens einer Ziel-Instanz. Empfohlene zuerst
 * (in der Reihenfolge von RECOMMENDED_ADDONS), dann nach Namen. installed[i] gehört zu targets[i].
 */
export function setupAddonList(entries: StoreEntry[], targets: OverviewInstance[], installed: InstalledAddons[] = []): SetupAddon[] {
  const list: SetupAddon[] = [];
  for (const { manifest } of entries) {
    if (!manifest.official || incompatibility(manifest) !== null) continue;
    const fitting = targets.map((target, i) => ({ target, i })).filter(({ target }) => fits(manifest, target));
    if (fitting.length === 0) continue;
    if (list.some((a) => a.id === manifest.id)) continue;
    const recommended = RECOMMENDED_ADDONS.includes(manifest.id);
    const everywhere = fitting.every(({ i }) => present(installed[i], manifest));
    list.push({
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      summary: manifest.summary,
      icon: manifest.icon,
      category: manifest.category,
      size: manifest.size,
      access: manifest.access,
      recommended,
      installed: everywhere,
      // Vorauswahl: empfohlen und noch nicht überall installiert
      preselected: recommended && !everywhere,
    });
  }
  const rank = (a: SetupAddon) => (a.recommended ? RECOMMENDED_ADDONS.indexOf(a.id) : RECOMMENDED_ADDONS.length);
  return list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'de'));
}

/**
 * Store laden (Signatur geprüft) und die Auswahl bauen. Ohne Verbindung status = offline mit Meldung (der Schritt
 * lässt sich überspringen), ohne Ziel-Instanz no-instance. entries = geprüfte Liste für installSetupAddon.
 */
export async function loadSetupAddons(serviceUrl: string, publicKey: string | null, targets: OverviewInstance[]): Promise<{ view: SetupAddons; entries: StoreEntry[] | null }> {
  const shown = targets.map((t) => ({ id: t.id, name: t.name }));
  if (targets.length === 0) return { view: { status: 'no-instance', error: null, addons: [], targets: [] }, entries: null };
  let entries: StoreEntry[];
  try {
    entries = await fetchStore(serviceUrl, publicKey);
  } catch (error) {
    return { view: { status: 'offline', error: message(error), addons: [], targets: shown }, entries: null };
  }
  const installed = await Promise.all(targets.map((t) => installedAddonVersions(t.dir).catch(() => new Map() as InstalledAddons)));
  return { view: { status: 'ok', error: null, addons: setupAddonList(entries, targets, installed), targets: shown }, entries };
}

export interface SetupInstallContext {
  serviceUrl: string;
  publicKey: string | null;
  /** geprüfte Liste aus loadSetupAddons */
  entries: StoreEntry[];
  targets: OverviewInstance[];
  /** läuft gerade ein Spiel in dieser Instanz? */
  busy(instanceId: string): boolean;
  log?(line: string): void;
}

/** Ein Addon aus der Auswahl in alle passenden Ziel-Instanzen installieren (schon vorhandene Versionen bleiben). */
export async function installSetupAddon(rawId: unknown, ctx: SetupInstallContext): Promise<SetupInstallResult> {
  const id = typeof rawId === 'string' ? rawId : '';
  // nur, was der Assistent auch anbietet: offiziell und passend
  if (!setupAddonList(ctx.entries, ctx.targets).some((a) => a.id === id)) throw new Error('Dieses Addon gibt es im Einrichtungs-Assistenten nicht.');
  const { manifest } = ctx.entries.find((e) => e.manifest.id === id)!;
  const result: SetupInstallResult = { id, name: manifest.name, installed: [], already: [], error: null };
  const errors: string[] = [];
  for (const target of ctx.targets.filter((t) => fits(manifest, t))) {
    if (ctx.busy(target.id)) {
      errors.push(`„${target.name}“ läuft gerade – bitte später im Addon-Store installieren.`);
      continue;
    }
    try {
      await applyPendingRemovals(target.dir);
      if (present(await installedAddonVersions(target.dir), manifest)) {
        result.already.push(target.name);
        continue;
      }
      await installStoreAddon(target.dir, ctx.serviceUrl, ctx.publicKey, id, ctx.entries, target);
      result.installed.push(target.name);
      ctx.log?.(`Einrichtung: ${manifest.name} ${manifest.version} in „${target.name}“ installiert`);
    } catch (error) {
      errors.push(ctx.targets.length > 1 ? `${target.name}: ${message(error)}` : message(error));
    }
  }
  if (errors.length > 0) result.error = errors.join(' ');
  return result;
}
