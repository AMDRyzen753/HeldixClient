// Entwickler-Schlüssel: schaltet in der fertigen App Offline-Konten ohne Microsoft-Konto frei.
//
// Der Schlüssel ist eine kleine JSON-Datei, signiert mit einem privaten Ed25519-Schlüssel, den nur der
// Entwickler hat (npm run dev-key). Die App enthält nur den öffentlichen Schlüssel und prüft die Signatur.
// Jeder Schlüssel gilt nur für einen PC. So bleibt die verteilte .exe ein normaler Launcher, in dem
// man ohne gekauftes Minecraft nicht spielen kann.

import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Dateiname im Datenordner des Launchers */
export const DEV_KEY_FILE = 'developer.key';

/**
 * Privater Signaturschlüssel des Entwicklers (npm run dev-key). Liegt er auf einem PC und passt er zum Build,
 * erstellt der Launcher den Entwickler-Schlüssel für diesen PC selbst.
 */
export const SIGNING_KEY_PATH = path.join(os.homedir(), '.heldixclient-dev', 'signing-key.pem');

export interface DevKeyFile {
  v: 1;
  /** für wen der Schlüssel ausgestellt wurde */
  name: string;
  /** PC-Kennung, siehe machineCode() */
  pc: string;
  /** Datum der Ausstellung, z. B. 2026-11-24 */
  issued: string;
  /** Ed25519-Signatur (Base64) über devKeyPayload() */
  sig: string;
}

export type DevKeyCheck = { valid: true; name: string } | { valid: false; reason: string };

let cachedCode: string | null = null;

/**
 * Kennung dieses PCs, z. B. "3F2A-91C0-7B44-E0D1": ein Hash der Windows-MachineGuid
 * (unter Linux /etc/machine-id). Die ID selbst wird nirgends gespeichert oder verschickt.
 */
export function machineCode(): string {
  if (cachedCode) return cachedCode;
  let raw = '';
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      raw = /MachineGuid\s+REG_SZ\s+(\S+)/i.exec(out)?.[1] ?? '';
    } else if (process.platform === 'linux') {
      raw = readFileSync('/etc/machine-id', 'utf8').trim();
    }
  } catch {
    // dann der Rechnername
  }
  if (!raw) raw = `${os.hostname()}|${process.platform}`;
  const hash = createHash('sha256').update(`heldix-dev:${raw.toLowerCase()}`).digest('hex').slice(0, 16).toUpperCase();
  cachedCode = hash.match(/.{4}/g)!.join('-');
  return cachedCode;
}

/** Die signierten Daten eines Schlüssels. */
export function devKeyPayload(key: Pick<DevKeyFile, 'name' | 'pc' | 'issued'>): Buffer {
  return Buffer.from(`heldix-dev-key|1|${key.pc}|${key.name}|${key.issued}`, 'utf8');
}

/** Stellt einen Entwickler-Schlüssel für einen PC aus. */
export function signDevKey(privateKey: KeyObject, name: string, pc: string): DevKeyFile {
  const issued = new Date().toISOString().slice(0, 10);
  return { v: 1, name, pc, issued, sig: sign(null, devKeyPayload({ name, pc, issued }), privateKey).toString('base64') };
}

/** Liest einen privaten Signaturschlüssel; null, wenn er nicht zum öffentlichen Schlüssel des Builds passt. */
export function matchingSigningKey(privatePem: string, publicKeyPem: string | null): KeyObject | null {
  if (!publicKeyPem) return null;
  try {
    const privateKey = createPrivateKey(privatePem);
    const derived = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const expected = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
    return derived.equals(expected) ? privateKey : null;
  } catch {
    return null;
  }
}

/** Prüft den Inhalt einer Schlüsseldatei für diesen PC. */
export function checkDevKey(text: string | null, publicKeyPem: string | null, pc: string): DevKeyCheck {
  if (!publicKeyPem) return { valid: false, reason: 'Dieser Build hat keinen Entwickler-Schlüssel eingebaut (npm run dev-key, dann neu bauen).' };
  if (text == null) return { valid: false, reason: 'Für diesen PC ist kein Entwickler-Schlüssel hinterlegt.' };
  let key: Partial<DevKeyFile>;
  try {
    key = JSON.parse(text) as Partial<DevKeyFile>;
  } catch {
    return { valid: false, reason: 'Die Schlüsseldatei ist beschädigt.' };
  }
  if (key.v !== 1 || typeof key.name !== 'string' || typeof key.pc !== 'string' || typeof key.issued !== 'string' || typeof key.sig !== 'string') {
    return { valid: false, reason: 'Die Schlüsseldatei ist beschädigt.' };
  }
  if (key.pc !== pc) return { valid: false, reason: 'Der Entwickler-Schlüssel gehört zu einem anderen PC.' };
  try {
    const ok = verify(null, devKeyPayload({ name: key.name, pc: key.pc, issued: key.issued }), createPublicKey(publicKeyPem), Buffer.from(key.sig, 'base64'));
    return ok ? { valid: true, name: key.name } : { valid: false, reason: 'Der Entwickler-Schlüssel ist nicht von diesem Build signiert.' };
  } catch {
    return { valid: false, reason: 'Der Entwickler-Schlüssel ist nicht von diesem Build signiert.' };
  }
}
