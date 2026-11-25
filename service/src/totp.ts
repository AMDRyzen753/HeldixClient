// Zwei-Faktor-Anmeldung für das Team: TOTP nach RFC 6238 (HOTP nach RFC 4226), nur mit node:crypto.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Zeitschritt in Sekunden, Ziffern und Toleranz (Schritte davor und danach), wie in docs/dienst.md. */
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 nach RFC 4648, ohne Auffüllzeichen (so erwarten es Authenticator-Apps). */
export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Liest Base32 (Groß-/Kleinschreibung egal, Leerzeichen und `=` werden ignoriert). Ungültig: `null`. */
export function base32Decode(text: string): Buffer | null {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Neues Geheimnis: 20 Zufallsbytes (160 Bit, wie RFC 4226 empfiehlt), als Base32 genau 32 Zeichen. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP (RFC 4226) mit HMAC-SHA-1 für den Zähler `counter`. */
export function hotp(key: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(binary).padStart(digits, '0');
}

/** Zeitschritt für einen Zeitpunkt in Millisekunden. */
export function totpStep(timeMs: number, period = TOTP_PERIOD): number {
  return Math.floor(timeMs / 1000 / period);
}

/** TOTP (RFC 6238) für einen Zeitpunkt in Millisekunden. */
export function totp(key: Buffer, timeMs: number, digits = TOTP_DIGITS, period = TOTP_PERIOD): string {
  return hotp(key, totpStep(timeMs, period), digits);
}

/**
 * Prüft einen Code gegen das Geheimnis (Base32) mit ±TOTP_WINDOW Schritten Toleranz. Ein Schritt bis einschließlich
 * `lastStep` ist schon benutzt und zählt nicht mehr (jeder Code gilt nur einmal). Liefert den passenden Schritt oder `null`.
 */
export function verifyTotp(secret: string, code: string, timeMs: number, lastStep: number): number | null {
  const key = base32Decode(secret);
  if (!key || key.length === 0 || !/^\d{6}$/.test(code)) return null;
  const now = totpStep(timeMs);
  for (let step = now - TOTP_WINDOW; step <= now + TOTP_WINDOW; step++) {
    if (step > lastStep && step >= 0 && timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** Adresse für den QR-Code der Authenticator-App. */
export function totpUri(name: string, secret: string): string {
  const label = encodeURIComponent(`HeldixClient:${name}`).replace('%3A', ':');
  return `otpauth://totp/${label}?secret=${secret}&issuer=HeldixClient&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}
