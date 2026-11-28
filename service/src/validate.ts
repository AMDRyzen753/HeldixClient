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
  'matrix',
  'matrix_rot',
  'matrix_tuerkis',
  'sakura_orange',
];

/**
 * Eingebaute Capes nur fürs Team (wie Katalog-Cosmetics mit `access: team`): wählen nur Spieler in der Tabelle team
 * (Rolle egal), und ausgeliefert werden sie nur, solange der Träger im Team ist. Gilt auch, wenn HELDIX_DIENST_CAPES die
 * Liste ersetzt; steht ein Team-Cape dort nicht, ist es wie bisher unbekannt.
 */
export const TEAM_CAPES: ReadonlySet<string> = new Set(['matrix_rot', 'matrix_tuerkis', 'sakura_orange']);

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

/** Code einer Einladung: 10 Zeichen aus a–z und 2–9 ohne i, l, o, 0 und 1 (nichts zum Verwechseln). */
export const INVITE_CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;

export function isInviteCode(value: unknown): value is string {
  return typeof value === 'string' && INVITE_CODE_RE.test(value);
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

/** Standard-Port von Minecraft: wird nicht mit angegeben. */
const DEFAULT_MINECRAFT_PORT = 25565;

/**
 * Prüft eine Server-Adresse für den Online-Status. Erlaubt sind nur öffentliche Domains
 * wie `hypixel.net`: keine IP-Adressen, kein `localhost`, keine Namen ohne Punkt, keine
 * Heimnetz-Namen, höchstens 253 Zeichen. Ein Port (1–65535) bleibt erhalten, außer dem
 * Standard-Port 25565 (dann nur der Name); Freunde brauchen ihn zum Beitreten.
 * Ergebnis: `<domain>` oder `<domain>:<port>`. Ungültig: `null`.
 */
export function normalizeServer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let host = value.trim();
  if (host === '' || host.length > 300) return null;
  let port: number | null = null;
  const withPort = /^([^:]*):(\d{1,5})$/.exec(host);
  if (withPort) {
    host = withPort[1]!;
    port = Number(withPort[2]);
    if (port < 1 || port > 65535) return null;
  }
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
  return port === null || port === DEFAULT_MINECRAFT_PORT ? ascii : `${ascii}:${port}`;
}

/**
 * Zeichen, die in Nachrichten und Notizen nicht erlaubt sind: Steuerzeichen (auch Zeilenumbrüche und Tabs),
 * Zeilen- und Absatztrenner, Steuerzeichen für die Schreibrichtung (damit lässt sich Text verfälscht anzeigen)
 * und einzelne Ersatzzeichen (kein gültiges UTF-16).
 */
const FORBIDDEN_TEXT_RE = /[\p{Cc}\p{Cs}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

/** Länge in Unicode-Zeichen (Codepunkten), nicht in UTF-16-Einheiten. */
export function codePointLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // Hohes Ersatzzeichen mit folgendem tiefen: zusammen ein Zeichen
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    length++;
  }
  return length;
}

export type TextProblem = 'type' | 'empty' | 'long' | 'chars';

/**
 * Prüft einen Text von Spielern (Nachricht oder Notiz). Leerzeichen am Anfang und Ende fallen weg.
 * Liefert den bereinigten Text oder, was nicht stimmt.
 */
export function checkText(value: unknown, maxLength: number, allowEmpty: boolean): { text: string } | { problem: TextProblem } {
  if (typeof value !== 'string') return { problem: 'type' };
  const text = value.trim();
  if (FORBIDDEN_TEXT_RE.test(text)) return { problem: 'chars' };
  if (text === '' && !allowEmpty) return { problem: 'empty' };
  if (codePointLength(text) > maxLength) return { problem: 'long' };
  return { text };
}

/** Wie bei Nachrichten, aber Zeilenumbrüche (`\n`) sind erlaubt (Neuigkeiten). */
const FORBIDDEN_MULTILINE_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\p{Cs}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

/**
 * Enthält der Text Zeichen, die nicht erlaubt sind (wie bei Nachrichten; mit `multiline` sind Zeilenumbrüche als `\n`
 * erlaubt)? Für Texte, die unverändert bleiben müssen (signierte Addon-Manifeste): ohne Trimmen.
 */
export function hasForbiddenChars(text: string, multiline: boolean): boolean {
  return (multiline ? FORBIDDEN_MULTILINE_RE : FORBIDDEN_TEXT_RE).test(text);
}

/**
 * Prüft einen mehrzeiligen Text: Zeilenumbrüche werden zu `\n` vereinheitlicht, Leerzeichen am Anfang und Ende fallen
 * weg, danach 1 bis `maxLength` Zeichen ohne sonstige Steuerzeichen.
 */
export function checkMultilineText(value: unknown, maxLength: number): { text: string } | { problem: TextProblem } {
  if (typeof value !== 'string') return { problem: 'type' };
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (FORBIDDEN_MULTILINE_RE.test(text)) return { problem: 'chars' };
  if (text === '') return { problem: 'empty' };
  if (codePointLength(text) > maxLength) return { problem: 'long' };
  return { text };
}
