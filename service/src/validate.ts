// Prüfungen für alles, was von außen kommt (Clients und Mojang).
import { domainToASCII } from 'node:url';

/** UUID wie in der Schnittstelle: 32 kleine Hex-Zeichen, ohne Bindestriche. */
const UUID_RE = /^[0-9a-f]{32}$/;
/** Minecraft-Spielername: 1–16 Zeichen aus A–Z, a–z, 0–9 und _. */
const NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
/** Cape-IDs aus HELDIX_DIENST_CAPES. */
const CAPE_ID_RE = /^[a-z0-9_-]{1,32}$/;

export const STATES = ['menu', 'singleplayer', 'multiplayer', 'realms', 'lan'] as const;
export type State = (typeof STATES)[number];

/** Eingebaute Capes (siehe docs/dienst.md). */
export const DEFAULT_CAPES: readonly string[] = [
  'heldix',
  'mitternacht',
  'aurora',
  'glut',
  'kristall',
  'neon',
  'sakura',
  'gewitter',
  'galaxie',
];

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Macht aus einer UUID von Mojang (mit oder ohne Bindestriche) die Form der Schnittstelle. */
export function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const plain = value.replace(/-/g, '').toLowerCase();
  if (!UUID_RE.test(plain)) return null;
  // Bindestriche nur an den üblichen Stellen (8-4-4-4-12) oder gar nicht.
  if (value.includes('-') && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)) {
    return null;
  }
  return plain;
}

export function isName(value: unknown): value is string {
  return typeof value === 'string' && NAME_RE.test(value);
}

export function isState(value: unknown): value is State {
  return typeof value === 'string' && (STATES as readonly string[]).includes(value);
}

export function isCapeId(value: string): boolean {
  return CAPE_ID_RE.test(value);
}

/**
 * Liest HELDIX_DIENST_CAPES (durch Kommas getrennt). Leer oder nicht gesetzt: eingebaute Liste.
 * Wirft bei ungültigen IDs, damit ein Tippfehler beim Start auffällt.
 */
export function parseCapeList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_CAPES];
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  for (const id of ids) {
    if (!isCapeId(id)) {
      throw new Error(`Ungültige Cape-ID in HELDIX_DIENST_CAPES: "${id}" (erlaubt: a–z, 0–9, _ und -, höchstens 32 Zeichen)`);
    }
  }
  return [...new Set(ids)];
}

/** Endungen, die nur im eigenen Netz gelten (Heimnetz, Firmennetz, reservierte Namen). */
const PRIVATE_TLDS = new Set([
  'localhost',
  'local',
  'localdomain',
  'lan',
  'home',
  'internal',
  'intranet',
  'corp',
  'private',
  'priv',
  'test',
  'invalid',
  'example',
  'arpa',
  'onion',
  'ip',
]);
/** Bekannte Router-Namen im Heimnetz. */
const PRIVATE_SUFFIXES = ['fritz.box'];
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Die Endung muss aus Buchstaben bestehen (oder Punycode sein). So fallen IP-Adressen heraus. */
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * Prüft eine Server-Adresse für den Online-Status. Erlaubt sind nur öffentliche Domains
 * wie `hypixel.net`: keine IP-Adressen, kein `localhost`, keine Namen ohne Punkt, keine
 * Heimnetz-Namen, höchstens 253 Zeichen. Ein angehängter Port wird abgeschnitten.
 * Ungültig: `null`.
 */
export function normalizeServer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let host = value.trim();
  if (host === '' || host.length > 300) return null;
  const withPort = /^([^:]*):(\d{1,5})$/.exec(host);
  if (withPort) host = withPort[1]!;
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host === '' || /[^\p{L}\p{N}.-]/u.test(host)) return null;
  const ascii = domainToASCII(host);
  if (ascii === '' || ascii.length > 253) return null;
  const labels = ascii.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((label) => LABEL_RE.test(label))) return null;
  const tld = labels[labels.length - 1]!;
  if (!TLD_RE.test(tld) || PRIVATE_TLDS.has(tld)) return null;
  if (PRIVATE_SUFFIXES.some((suffix) => ascii === suffix || ascii.endsWith(`.${suffix}`))) return null;
  return ascii;
}
