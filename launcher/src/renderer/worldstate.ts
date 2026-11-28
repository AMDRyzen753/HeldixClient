// Offene Welten der Freunde (Welt teilen) als gemeinsamer Stand für Startseite, Freunde-Seite und Welt-Dialog.
// Der Main-Prozess fragt GET /v1/worlds regelmäßig ab (main/core/worlds.ts) und schickt jede Änderung (worlds:update).
import type { FriendWorld, WorldsOverview } from '../shared/api';
import { api } from './core.js';

let overview: WorldsOverview | null = null;
const listeners = new Set<() => void>();

/** Adresse einer geteilten Welt (<code>.welt.<Domain>), wie die Mod sie meldet */
const WORLD_ADDRESS_RE = /^[a-hjkmnp-z2-9]{6}\.welt\.[a-z0-9.-]+(:\d{1,5})?$/i;

export function isWorldAddress(address: string | null | undefined): boolean {
  return typeof address === 'string' && WORLD_ADDRESS_RE.test(address.trim());
}

export function worldsOverview(): WorldsOverview | null {
  return overview;
}

/** Welt, die ein Freund gerade geöffnet hat (Gastgeber-UUID ohne Bindestriche) */
export function hostedWorld(uuid: string): FriendWorld | null {
  return overview?.friends.find((w) => w.host.uuid === uuid) ?? null;
}

export function onWorldsChange(listener: () => void): void {
  listeners.add(listener);
}

function apply(next: WorldsOverview): void {
  overview = next;
  listeners.forEach((listener) => listener());
}

/** einmal beim Start */
export function initWorldState(): void {
  api.onWorlds(apply);
  void api.getWorlds().then(apply).catch(() => undefined);
}

/** sofort neu fragen (z. B. „Erneut versuchen“) */
export function refreshWorlds(): Promise<void> {
  return api.getWorlds(true).then(apply).catch(() => undefined);
}
