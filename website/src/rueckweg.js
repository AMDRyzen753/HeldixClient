// HeldixClient – Webseite: Rückweg nach der Anmeldung für öffentliche Seiten (/setup#<code>, /spieler/<name>, /partner).
//
// Angemeldet wird im Konto (Einmal-Link aus Launcher oder Spiel) oder mit dem Minecraft-Konto über den Dienst – zurück
// kommt der Browser immer nach /konto#code=…. Damit man danach wieder auf der Seite landet, von der man kam, merkt
// sich die Seite vor dem Umweg ihren Pfad in sessionStorage (nur dieser Tab, höchstens 30 Minuten); konto.js leitet
// nach einer erfolgreichen Anmeldung dorthin zurück (takeReturn). Nur bekannte, eigene Pfade – nie fremde Adressen.
import { minecraftLoginAvailable, minecraftLoginHref } from './anmelden.js';

const KEY = 'heldix-rueckweg';
const MAX_MS = 30 * 60 * 1000;
const PATH_RE = /^\/(?:setup#[a-hjkmnp-z2-9]{10}|partner(?:#[a-z0-9=&-]{0,40})?|spieler\/[A-Za-z0-9_]{1,16})$/;

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Ist das ein Pfad, zu dem die Anmeldung zurückführen darf? */
export const isReturnPath = (path) => typeof path === 'string' && PATH_RE.test(path);

/** Vor dem Umweg über die Anmeldung: Pfad dieser Seite merken (Standard: Pfad und # der aktuellen Adresse). */
export function rememberReturn(path = `${location.pathname}${location.hash}`) {
  if (!isReturnPath(path)) return;
  try {
    storage()?.setItem(KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // ohne sessionStorage: nach der Anmeldung die Seite einfach noch einmal öffnen
  }
}

/** Gemerkten Pfad holen und vergessen; abgelaufene oder fremde fallen weg. */
export function takeReturn() {
  let entry = null;
  try {
    entry = JSON.parse(storage()?.getItem(KEY) ?? 'null');
    storage()?.removeItem(KEY);
  } catch {
    entry = null;
  }
  if (!entry || !isReturnPath(entry.path) || !(Date.now() - Number(entry.at) < MAX_MS)) return null;
  return entry.path;
}

/** Gemerkten Pfad verwerfen (z. B. wenn die Anmeldung nicht geklappt hat). */
export function forgetReturn() {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // egal
  }
}

/**
 * Anmelde-Link einrichten: mit dem Minecraft-Konto direkt beim Dienst (wenn angeboten), sonst zum Konto (dort stehen
 * die Wege über Launcher und Spiel). Beim Klick merkt sich die Seite den Rückweg.
 */
export function setupLoginLink(link, path) {
  if (!link) return;
  link.href = '/konto';
  minecraftLoginAvailable().then((ok) => {
    if (ok) link.href = minecraftLoginHref();
  });
  if (!link.dataset.rueckweg) {
    link.dataset.rueckweg = '1';
    link.addEventListener('click', () => rememberReturn(path ?? `${location.pathname}${location.hash}`));
  }
}
