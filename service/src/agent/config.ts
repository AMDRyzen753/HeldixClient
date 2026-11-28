// Einstellungen des Welten-Wächters. In Produktion aus Umgebungsvariablen (systemd-Unit heldix-welten-agent,
// EnvironmentFile /etc/heldix-dienst/welten.env, geschrieben vom Installer); Tests bauen die Einstellungen direkt.
//
//   HELDIX_WELTEN_SOCKET          Socket, auf dem der Wächter lauscht (Standard /run/heldix-dienst/welten.sock;
//                                 unter Windows nur für Tests eine Named Pipe wie \\.\pipe\heldix-welten)
//   HELDIX_WELTEN_SOCKET_GID      Gruppe (Zahl) des Sockets, die des Dienst-Benutzers; Rechte 0660
//   HELDIX_WELTEN_DATA            Ordner der Welten (Standard /var/lib/heldix-welten)
//   HELDIX_WELTEN_UPLOADS         Upload-Ordner des Dienstes (Standard /var/lib/heldix-dienst/hosting-uploads);
//                                 Import- und Exportpfade nur darin
//   HELDIX_WELTEN_DOCKER          Docker-Programm (Standard /usr/bin/docker; Tests: ein .js-Skript als Fake)
//   HELDIX_WELTEN_ACCEPT_MINECRAFT_EULA=1   der Betreiber hat der Minecraft-EULA zugestimmt (sonst startet keine Welt)
//   HELDIX_WELTEN_MAX             höchstens so viele Welten gleichzeitig (Standard aus dem RAM: (RAM − 6 GB) / 3 GB)
//   HELDIX_WELTEN_BACKUPS_MAX     höchstens so viele Sicherungen je Welt (Standard 50); darüber lehnt der Wächter neue ab –
//                                 aufräumen (letzte N) macht der Dienst mit deleteBackup
//   HELDIX_WELTEN_DISK_MB         größte Welt beim Import, entpackt, in MB (Standard 65536 = größte Grenze, die das Team
//                                 setzen kann; die Grenze je Welt prüft der Dienst vorher selbst)
import os from 'node:os';
import path from 'node:path';
import type { ZipLimits } from './zipio';
import { DEFAULT_SOCKET_PATH } from './protocol';

export const DEFAULT_DATA_DIR = '/var/lib/heldix-welten';
export const DEFAULT_UPLOADS_DIR = '/var/lib/heldix-dienst/hosting-uploads';
export const DEFAULT_DOCKER = '/usr/bin/docker';
/** Ports am Host (nur 127.0.0.1), auf denen das Relay die Welten erreicht */
export const PORT_MIN = 31000;
export const PORT_MAX = 31999;
/** Benutzer im Container; ihm gehören die Weltdaten (data/ je Welt) */
export const WORLD_UID = 1000;
export const WORLD_GID = 1000;

export interface Owner {
  uid: number;
  gid: number;
}

export interface AgentConfig {
  dataDir: string;
  uploadsDir: string;
  socketPath: string;
  socketGid: number | null;
  docker: string;
  acceptEula: boolean;
  maxRunning: number;
  maxBackups: number;
  /** größte Welt (Import, entpackt) in Bytes; Sicherungen dürfen doppelt so groß sein */
  diskLimitBytes: number;
  /** Besitzer der Weltdaten; null = nicht ändern (Tests ohne root) */
  owner: Owner | null;
  portMin: number;
  portMax: number;
  /** Grenzen beim Entpacken (Tests setzen kleinere) */
  importLimits?: Partial<ZipLimits>;
  /** nur Tests: Download-Adresse umschreiben (geprüft wird immer die echte Adresse, nie diese) */
  fetchUrl?: (url: string) => string;
  /** Protokoll (Standard: console.log mit Zeitstempel durch journald) */
  log?: (line: string) => void;
}

/** Plätze aus dem RAM: 6 GB fürs System, je Welt 3 GB (bei 32 GB → 8). */
export function defaultMaxRunning(totalBytes = os.totalmem()): number {
  return Math.max(0, Math.floor((totalBytes / 1048576 - 6144) / 3072));
}

/**
 * Pfade, die als Docker-Argument (--mount source=…) vorkommen: nur druckbares ASCII ohne Leerzeichen, Komma und
 * Anführungszeichen (--mount wird als CSV gelesen).
 */
export const SAFE_DIR_RE = /^[\x21-\x7e]{1,400}$/;

export function checkConfig(config: AgentConfig): void {
  for (const [name, dir] of [
    ['Datenordner', config.dataDir],
    ['Upload-Ordner', config.uploadsDir],
  ] as const) {
    if (!path.isAbsolute(dir) || !SAFE_DIR_RE.test(dir) || /[,"']/.test(dir)) {
      throw new Error(`${name} muss ein absoluter Pfad ohne Leerzeichen, Komma und Anführungszeichen sein: ${dir}`);
    }
  }
  if (!Number.isInteger(config.maxRunning) || config.maxRunning < 0) throw new Error('maxRunning ungültig');
  if (config.portMin < 1024 || config.portMax > 65535 || config.portMin > config.portMax) throw new Error('Portbereich ungültig');
}

function intFromEnv(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name}: ganze Zahl erwartet, nicht „${raw}“`);
  const value = Number(raw.trim());
  if (value < min || value > max) throw new Error(`${name}: ${min} bis ${max} erwartet, nicht ${value}`);
  return value;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const eula = (env.HELDIX_WELTEN_ACCEPT_MINECRAFT_EULA ?? '').trim();
  if (eula !== '' && eula !== '0' && eula !== '1') throw new Error('HELDIX_WELTEN_ACCEPT_MINECRAFT_EULA: 0 oder 1 erwartet');
  const gidRaw = (env.HELDIX_WELTEN_SOCKET_GID ?? '').trim();
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const config: AgentConfig = {
    dataDir: env.HELDIX_WELTEN_DATA?.trim() || DEFAULT_DATA_DIR,
    uploadsDir: env.HELDIX_WELTEN_UPLOADS?.trim() || DEFAULT_UPLOADS_DIR,
    socketPath: env.HELDIX_WELTEN_SOCKET?.trim() || DEFAULT_SOCKET_PATH,
    socketGid: gidRaw === '' ? null : intFromEnv(env, 'HELDIX_WELTEN_SOCKET_GID', 0, 0, 2 ** 31 - 1),
    docker: env.HELDIX_WELTEN_DOCKER?.trim() || DEFAULT_DOCKER,
    acceptEula: eula === '1',
    maxRunning: intFromEnv(env, 'HELDIX_WELTEN_MAX', defaultMaxRunning(), 0, 500),
    maxBackups: intFromEnv(env, 'HELDIX_WELTEN_BACKUPS_MAX', 50, 1, 500),
    diskLimitBytes: intFromEnv(env, 'HELDIX_WELTEN_DISK_MB', 65536, 64, 1024 * 1024) * 1048576,
    // Ohne root lassen sich die Weltdaten nicht 1000:1000 geben (dann muss der Wächter selbst als 1000 laufen)
    owner: isRoot ? { uid: WORLD_UID, gid: WORLD_GID } : null,
    portMin: PORT_MIN,
    portMax: PORT_MAX,
  };
  checkConfig(config);
  return config;
}
