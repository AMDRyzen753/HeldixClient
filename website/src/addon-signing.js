// HeldixClient – Webseite (Team-Bereich): Addon-Freigaben im Browser signieren.
//
// Der private Update-Schlüssel (update-key.pem: Ed25519, PKCS#8, PEM) wird mit FileReader gelesen und mit WebCrypto
// als NICHT exportierbarer Schlüssel importiert. Er liegt nur in der Variable `current` dieses Moduls – nie in
// localStorage, sessionStorage, IndexedDB oder Cookies und nie in einer Anfrage. Zum Dienst geht nur die Signatur.
//
// Bevor der Schlüssel benutzt wird, prüft die Seite, ob er zum öffentlichen Schlüssel des Dienstes passt
// (`publicKey` aus GET /v1/team/addons): Testnachricht signieren und mit dem öffentlichen Schlüssel prüfen.
// Signiert wird genau wie bei `npm run addon`: die UTF-8-Bytes von "heldix-addon\n" + Manifest-Text.
//
// Vergessen wird der Schlüssel per Knopf, nach 30 Minuten ohne Freigabe, beim Abmelden und beim Verlassen der Seite.

const PREFIX = 'heldix-addon\n';
const IDLE_MS = 30 * 60 * 1000;
const ALGORITHM = { name: 'Ed25519' };

/** { privateKey, publicKey, publicPem, fileName, loadedAt } – nur hier, nie gespeichert oder gesendet. */
let current = null;
let idleTimer = null;
const listeners = new Set();

export class SigningError extends Error {}

function notify() {
  for (const listener of listeners) {
    try {
      listener(signingKeyInfo());
    } catch {
      // Anzeige-Fehler dürfen das Vergessen nicht aufhalten
    }
  }
}

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(forgetSigningKey, IDLE_MS);
}

/** Schlüssel sofort vergessen (Knopf, Abmelden, Seite verlassen, 30 Minuten ohne Freigabe). */
export function forgetSigningKey() {
  const had = current !== null;
  current = null;
  clearTimeout(idleTimer);
  idleTimer = null;
  if (had) notify();
}

/** Was die Seite anzeigen darf: Dateiname und Zeitpunkt – nie der Schlüssel selbst. */
export function signingKeyInfo() {
  return current ? { fileName: current.fileName, loadedAt: current.loadedAt, forgetsAt: current.loadedAt + IDLE_MS } : null;
}

export function onSigningKeyChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(new SigningError('Die Datei lässt sich nicht lesen.')));
    reader.readAsText(file);
  });
}

/** PEM-Block → DER-Bytes (oder null). */
function pemToDer(text, label) {
  const match = new RegExp(`-----BEGIN ${label}-----([A-Za-z0-9+/=\\s]+)-----END ${label}-----`).exec(text);
  if (!match) return null;
  try {
    const binary = atob(match[1].replace(/\s+/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importPublic(publicPem) {
  const der = typeof publicPem === 'string' ? pemToDer(publicPem, 'PUBLIC KEY') : null;
  if (!der) throw new SigningError('Der Dienst hat keinen gültigen öffentlichen Update-Schlüssel geschickt. Ohne ihn lässt sich die Datei nicht prüfen.');
  try {
    return await crypto.subtle.importKey('spki', der, ALGORITHM, false, ['verify']);
  } catch (error) {
    if (error?.name === 'NotSupportedError') throw new SigningError('Dein Browser kann Ed25519 nicht. Nimm einen aktuellen Chrome, Edge, Firefox oder Safari.');
    throw new SigningError('Der öffentliche Update-Schlüssel des Dienstes ist kein Ed25519-Schlüssel.');
  }
}

/**
 * Schlüsseldatei laden und gegen den öffentlichen Schlüssel des Dienstes prüfen. Wirft SigningError mit deutschem
 * Hinweis; bei Erfolg liegt der Schlüssel im Arbeitsspeicher dieser Seite.
 */
export async function loadSigningKey(file, publicPem) {
  forgetSigningKey();
  if (!globalThis.crypto?.subtle) throw new SigningError('Dein Browser kann hier nicht signieren (WebCrypto fehlt – die Seite muss über HTTPS laufen).');
  if (!file) throw new SigningError('Keine Datei gewählt.');
  if (file.size > 16 * 1024) throw new SigningError('Die Datei ist zu groß für einen Schlüssel. Gewählt werden muss update-key.pem.');
  if (!publicPem) throw new SigningError('Im Dienst ist kein öffentlicher Update-Schlüssel eingerichtet (HELDIX_DIENST_UPDATE_KEY) – dagegen lässt sich die Datei nicht prüfen, und der Dienst nähme die Freigabe nicht an.');
  const text = await readText(file);
  if (/-----BEGIN ENCRYPTED PRIVATE KEY-----/.test(text)) throw new SigningError('Verschlüsselte Schlüsseldateien gehen hier nicht. Nimm die unverschlüsselte update-key.pem (PKCS#8).');
  if (/-----BEGIN (OPENSSH|RSA|EC|DSA) PRIVATE KEY-----/.test(text)) throw new SigningError('Diese Schlüsseldatei hat ein anderes Format. Gebraucht wird update-key.pem: Ed25519 im PKCS#8-Format („-----BEGIN PRIVATE KEY-----“).');
  if (/-----BEGIN PUBLIC KEY-----/.test(text) && !/-----BEGIN PRIVATE KEY-----/.test(text)) throw new SigningError('Das ist der öffentliche Schlüssel. Zum Signieren braucht es den privaten – update-key.pem.');
  const der = pemToDer(text, 'PRIVATE KEY');
  if (!der) throw new SigningError('Das ist keine Schlüsseldatei mit „-----BEGIN PRIVATE KEY-----“. Gewählt werden muss update-key.pem.');
  let privateKey;
  try {
    privateKey = await crypto.subtle.importKey('pkcs8', der, ALGORITHM, false, ['sign']);
  } catch (error) {
    if (error?.name === 'NotSupportedError') throw new SigningError('Dein Browser kann Ed25519 nicht. Nimm einen aktuellen Chrome, Edge, Firefox oder Safari.');
    throw new SigningError('Die Datei enthält keinen Ed25519-Schlüssel im PKCS#8-Format.');
  } finally {
    der.fill(0);
  }
  const publicKey = await importPublic(publicPem);
  // Passt der Schlüssel zum Dienst? Zufällige Testnachricht (nie eine Addon- oder Update-Nachricht) signieren und prüfen.
  const probe = new Uint8Array([...new TextEncoder().encode('heldix-schluesseltest\n'), ...crypto.getRandomValues(new Uint8Array(32))]);
  const signature = await crypto.subtle.sign(ALGORITHM, privateKey, probe);
  if (!(await crypto.subtle.verify(ALGORITHM, publicKey, signature, probe))) {
    throw new SigningError('Diese Schlüsseldatei gehört nicht zum Update-Schlüssel des Dienstes. Nichts wurde gesendet – nimm die update-key.pem, mit der auch die Launcher-Updates signiert werden.');
  }
  current = { privateKey, publicKey, publicPem, fileName: String(file.name || 'update-key.pem').slice(0, 80), loadedAt: Date.now() };
  touch();
  notify();
  return signingKeyInfo();
}

/**
 * Manifest-Text signieren ("heldix-addon\n" + manifest, UTF-8) und die Signatur gleich mit dem öffentlichen
 * Schlüssel gegenprüfen. Gibt die Signatur als Base64 zurück.
 */
export async function signAddonManifest(manifest, publicPem) {
  if (!current) throw new SigningError('Kein Schlüssel geladen. Wähle zuerst die Schlüsseldatei.');
  if (typeof manifest !== 'string' || !manifest) throw new SigningError('Es gibt kein Manifest zum Signieren.');
  if (publicPem && publicPem !== current.publicPem) {
    forgetSigningKey();
    throw new SigningError('Der öffentliche Schlüssel des Dienstes hat sich geändert. Bitte die Schlüsseldatei neu wählen.');
  }
  const data = new TextEncoder().encode(PREFIX + manifest);
  const signature = new Uint8Array(await crypto.subtle.sign(ALGORITHM, current.privateKey, data));
  if (!(await crypto.subtle.verify(ALGORITHM, current.publicKey, signature, data))) throw new SigningError('Die Signatur ließ sich mit dem öffentlichen Schlüssel nicht bestätigen. Nichts wurde gesendet.');
  touch();
  return toBase64(signature);
}

// Seite verlassen (auch Neuladen, Wechsel in den Zurück-Cache): Schlüssel weg.
window.addEventListener('pagehide', forgetSigningKey);
