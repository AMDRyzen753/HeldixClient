// HeldixClient – Webseite: gemeinsame Bausteine für Einladungen (/einladung, Konto → Freunde → „Freunde einladen“,
// Rückweg nach der Anmeldung in konto.js).
//
// - Einladungs-Code: 10 Zeichen aus a–z und 2–9 ohne i, l, o, 0, 1. Web-Link /einladung#<code> (Hash: steht nicht in
//   Server-Protokollen), Launcher-Link heldixclient://einladung/<code>.
// - Rückweg nach der Anmeldung mit dem Minecraft-Konto: Der Dienst schickt den Browser immer nach /konto#code=… zurück –
//   der Hash mit dem Einladungs-Code geht dabei verloren. Deshalb merkt sich /einladung den Code vor dem Umweg in
//   sessionStorage (nur dieser Tab, höchstens 30 Minuten), und konto.js leitet danach zurück.
// - Belohnungen: Namen und Vorschaubilder aus dem Cosmetics-Katalog (geprüft wie überall, cosmetics-common.js).
import { drawCosmeticPreview, loadCosmetic, loadCosmeticCatalog, prepareCosmetic } from './cosmetics-common.js';

export const INVITE_CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;
const PENDING_KEY = 'heldix-einladung';
const PENDING_MAX_MS = 30 * 60 * 1000;

/** Code aus der Adresse (#<code>), sonst null. */
export function codeFromHash(hash = location.hash) {
  const value = decodeURIComponent(String(hash || '').replace(/^#/, '')).trim().toLowerCase();
  return INVITE_CODE_RE.test(value) ? value : null;
}

export const inviteWebLink = (code) => `${location.origin}/einladung#${code}`;
export const inviteAppLink = (code) => `heldixclient://einladung/${code}`;

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Vor der Anmeldung: Code (und ob danach gleich angenommen werden soll) für diesen Tab merken. */
export function rememberInvite(code, { accept = false } = {}) {
  if (!INVITE_CODE_RE.test(code)) return;
  try {
    storage()?.setItem(PENDING_KEY, JSON.stringify({ code, accept, at: Date.now() }));
  } catch {
    // ohne sessionStorage: nach der Anmeldung den Link einfach noch einmal öffnen
  }
}

/** Gemerkte Einladung ({ code, accept, fehler }) oder null; abgelaufene fallen weg. */
export function pendingInvite() {
  let entry = null;
  try {
    entry = JSON.parse(storage()?.getItem(PENDING_KEY) ?? 'null');
  } catch {
    entry = null;
  }
  if (!entry || typeof entry.code !== 'string' || !INVITE_CODE_RE.test(entry.code) || !(Date.now() - entry.at < PENDING_MAX_MS)) {
    forgetInvite();
    return null;
  }
  return { code: entry.code, accept: entry.accept === true, fehler: typeof entry.fehler === 'string' ? entry.fehler : null };
}

/** Anmeldung hat nicht geklappt: Fehlercode für die Einladungsseite dazulegen. */
export function markInviteLoginError(fehler) {
  const entry = pendingInvite();
  if (!entry) return;
  try {
    storage()?.setItem(PENDING_KEY, JSON.stringify({ code: entry.code, accept: false, at: Date.now(), fehler: String(fehler).slice(0, 40) }));
  } catch {
    // egal
  }
}

export function forgetInvite() {
  try {
    storage()?.removeItem(PENDING_KEY);
  } catch {
    // egal
  }
}

// ---------------------------------------------------------------------------------------------------------
// Belohnungen
// ---------------------------------------------------------------------------------------------------------

/** Bekannte Belohnungen (falls der Katalog sie noch nicht hat oder nicht erreichbar ist). */
export const REWARDS = Object.freeze({
  freundesfunken: { name: 'Freundesfunken', slot: 'aura' },
  freundesband: { name: 'Freundesband', slot: 'cape' },
});
export const SLOT_LABELS = Object.freeze({ head: 'Kopf', back: 'Rücken', aura: 'Aura', companion: 'Begleiter', cape: 'Cape' });
const SLOT_HASH = Object.freeze({ head: 'kopf', back: 'ruecken', aura: 'aura', companion: 'begleiter', cape: 'capes' });
const COSMETIC_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Name und Slot einer Belohnung ohne Katalog. */
export function rewardInfo(id) {
  return REWARDS[id] ?? { name: id, slot: null };
}

/** Wo man das Cosmetic im Konto wählt. */
export const wearHref = (slot) => `/konto#reiter=profil${slot ? `&platz=${SLOT_HASH[slot] ?? slot}` : ''}`;

let catalog = null;
const previews = new Map();

/**
 * Belohnung aus dem Katalog: { id, name, description, slot, image (PNG als data:-URL) | null }. Ohne Katalog oder
 * ohne gültige Signatur: die bekannten Angaben ohne Bild.
 */
export function rewardPreview(id, size = 128) {
  if (typeof id !== 'string' || !COSMETIC_ID_RE.test(id)) return Promise.resolve(null);
  const key = `${id}:${size}`;
  if (!previews.has(key)) {
    const fallback = { id, ...rewardInfo(id), description: '', image: null };
    const promise = (async () => {
      catalog ??= loadCosmeticCatalog().catch((error) => {
        catalog = null;
        throw error;
      });
      const entries = await catalog;
      const entry = entries.find((item) => item.id === id);
      if (!entry) return fallback;
      const manifest = await loadCosmetic(entry);
      let image = null;
      try {
        const prepared = await prepareCosmetic(manifest);
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        drawCosmeticPreview(canvas, prepared, { t: 0.35 });
        image = canvas.toDataURL('image/png');
      } catch {
        image = null;
      }
      return { id, name: manifest.name, description: manifest.description, slot: manifest.slot, image };
    })().catch(() => fallback);
    previews.set(key, promise);
  }
  return previews.get(key);
}
