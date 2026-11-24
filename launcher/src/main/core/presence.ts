// Was im Discord-Status steht – abhängig von Launcher und Spiel.
import type { InstanceLoader } from '../../shared/api';
import type { DiscordActivity } from './discord';

/** Spielzustand, den die HeldixClient-Mod als "HELDIX-STATUS {…}" ins Log schreibt. */
export interface GameStatus {
  mode: 'menu' | 'singleplayer' | 'multiplayer' | 'realms' | 'lan';
  /** Serveradresse, nur bei mode = multiplayer */
  server?: string;
}

export interface PresenceInput {
  phase: 'launcher' | 'preparing' | 'running';
  minecraft?: string;
  loader?: InstanceLoader;
  /** Startzeit des Spiels in ms (für "seit 12:34") */
  startedAt?: number;
  status?: GameStatus | null;
  showServer: boolean;
  clientVersion: string;
}

const STATUS_LINE = /HELDIX-STATUS (\{.*\})\s*$/;

/** Liest eine Statuszeile aus dem Spiel-Log, sonst null. */
export function parseStatusLine(text: string): GameStatus | null {
  const match = STATUS_LINE.exec(text);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]) as Partial<GameStatus>;
    const modes: GameStatus['mode'][] = ['menu', 'singleplayer', 'multiplayer', 'realms', 'lan'];
    if (!value.mode || !modes.includes(value.mode)) return null;
    return { mode: value.mode, server: typeof value.server === 'string' ? value.server : undefined };
  } catch {
    return null;
  }
}

/**
 * Servername für Discord: nur echte Domains (z. B. "hypixel.net"). IP-Adressen, localhost und
 * Heimnetz-Namen werden nicht gezeigt, damit keine privaten Adressen öffentlich sichtbar werden.
 */
export function publicServerName(address: string | undefined): string | null {
  if (!address) return null;
  let host = address.trim().toLowerCase();
  if (host.startsWith('[')) return null; // IPv6 mit Port
  host = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!host || host.includes(':')) return null; // IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null; // IPv4
  if (host === 'localhost' || !host.includes('.')) return null;
  if (/\.(local|lan|home|internal|localdomain)$/.test(host)) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return host.length > 60 ? `${host.slice(0, 57)}…` : host;
}

function describeStatus(status: GameStatus | null | undefined, showServer: boolean): string {
  switch (status?.mode) {
    case 'menu':
      return 'Im Hauptmenü';
    case 'singleplayer':
      return 'Spielt Einzelspieler';
    case 'realms':
      return 'Spielt auf Realms';
    case 'lan':
      return 'Spielt im LAN';
    case 'multiplayer': {
      const server = showServer ? publicServerName(status.server) : null;
      return server ? `Spielt auf ${server}` : 'Spielt Mehrspieler';
    }
    default:
      return 'Im Spiel';
  }
}

const LOADER_TEXT: Record<InstanceLoader, string> = { heldix: 'HeldixClient', fabric: 'Fabric', vanilla: 'Vanilla' };

export function buildActivity(input: PresenceInput): DiscordActivity {
  const assets = { large_image: 'discord-logo', large_text: `HeldixClient ${input.clientVersion}` };
  if (input.phase === 'launcher' || !input.minecraft || !input.loader) {
    return { details: 'Im Launcher', state: 'Sucht sich eine Instanz aus', assets };
  }
  const details = `Minecraft ${input.minecraft} · ${LOADER_TEXT[input.loader]}`;
  if (input.phase === 'preparing') return { details, state: 'Startet das Spiel …', assets };
  return {
    details,
    state: describeStatus(input.status, input.showServer),
    timestamps: input.startedAt ? { start: input.startedAt } : undefined,
    assets,
  };
}
