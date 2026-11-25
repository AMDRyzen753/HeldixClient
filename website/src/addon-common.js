// HeldixClient – Webseite: gemeinsame Bausteine für den Addon-Store (/addons) und die Vorschau auf der Startseite.
//
// - Liste aus GET /api/v1/addons lesen und prüfen (unbrauchbare Einträge fallen weg)
// - Angezeigt wird, was im signierten Manifest steht: Ist `manifest` gültiges JSON zum selben Addon, gelten seine
//   Felder; Downloads und Veröffentlichungszeit kommen vom Dienst.
// - Texte vom Server landen nur als Text im Dokument (nie als HTML).
import { h, icon } from './app-common.js';
import { publicGet } from './public-cards.js';

export const ADDON_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Kategorien wie im Manifest, Anzeige wie in Launcher und Spiel. */
export const KATEGORIEN = {
  hud: 'HUD',
  musik: 'Musik & Medien',
  chat: 'Chat & Freunde',
  werkzeuge: 'Werkzeuge',
  sonstiges: 'Sonstiges',
};

const SYSTEM_NAMEN = { windows: 'Windows', mac: 'Mac', linux: 'Linux' };
const ALLE_SYSTEME = Object.keys(SYSTEM_NAMEN);

const NUMBER = new Intl.NumberFormat('de-DE');

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const list = (value, max, length) => (Array.isArray(value) ? value.map((entry) => text(entry, length)).filter(Boolean).slice(0, max) : []);
const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** Signierter Manifest-Text → Objekt, aber nur, wenn er zum Eintrag passt. */
function signedFields(entry) {
  if (typeof entry.manifest !== 'string') return {};
  try {
    const fields = JSON.parse(entry.manifest);
    return fields && typeof fields === 'object' && !Array.isArray(fields) && fields.type === 'heldix-addon' && fields.id === entry.id ? fields : {};
  } catch {
    return {};
  }
}

/** Eintrag aus der Liste (oder `addon` aus den Details) in eine sichere, vollständige Form bringen; sonst null. */
export function normalizeAddon(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !ADDON_ID_RE.test(entry.id)) return null;
  const source = { ...entry, ...signedFields(entry) };
  const name = text(source.name, 40);
  const version = text(source.version, 60);
  if (!name || !version) return null;
  const platforms = [...new Set(list(source.platforms, 3, 10).filter((system) => ALLE_SYSTEME.includes(system)))];
  const date = typeof source.date === 'string' && Number.isFinite(Date.parse(source.date)) ? Date.parse(source.date) : null;
  return {
    id: entry.id,
    name,
    version,
    summary: text(source.summary, 200),
    description: text(source.description, 4000),
    authors: list(source.authors, 5, 40),
    api: Number.isInteger(source.api) ? source.api : null,
    icon: typeof source.icon === 'string' && /^[a-z0-9-]{1,30}$/.test(source.icon) ? source.icon : 'addons',
    category: Object.hasOwn(KATEGORIEN, source.category) ? source.category : 'sonstiges',
    platforms: platforms.length === ALLE_SYSTEME.length ? [] : platforms,
    file: text(source.file, 120),
    size: number(source.size),
    sha256: typeof source.sha256 === 'string' && /^[0-9a-f]{64}$/.test(source.sha256) ? source.sha256 : '',
    date,
    notes: list(source.notes, 20, 300),
    downloads: number(entry.downloads) ?? 0,
    publishedAt: number(entry.publishedAt) ?? date,
  };
}

/** GET /v1/addons → geprüfte Einträge in der Reihenfolge des Dienstes (beliebteste zuerst). */
export async function loadAddons() {
  const data = await publicGet('/v1/addons');
  const seen = new Set();
  return (Array.isArray(data?.addons) ? data.addons : [])
    .map(normalizeAddon)
    .filter((addon) => addon && !seen.has(addon.id) && seen.add(addon.id));
}

/** Gibt es das Icon im Heldix-Icon-Set der Seite (template#icons)? */
export function hasIcon(name) {
  return Boolean(document.getElementById('icons')?.content.querySelector(`[data-icon="${CSS.escape(String(name))}"]`));
}

/** Icon aus dem Heldix-Icon-Set, unbekannte Namen als Puzzleteil. */
export function addonIcon(name, className = 'addon-icon') {
  const svg = hasIcon(name) ? icon(name) : icon('addons');
  return h('span', { class: className, 'aria-hidden': 'true' }, svg);
}

/** „Nur Windows“, „Windows und Mac“ – oder null, wenn das Addon überall läuft. */
export function platformLimit(platforms) {
  if (!platforms.length) return null;
  const names = platforms.map((system) => SYSTEM_NAMEN[system]);
  return names.length === 1 ? `Nur ${names[0]}` : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`;
}

/** Ausgeschrieben für die Details: „Alle Systeme“ oder „Windows“. */
export function platformText(platforms) {
  return platforms.length ? platforms.map((system) => SYSTEM_NAMEN[system]).join(', ') : 'Alle Systeme';
}

export const formatCount = (count) => (count === 1 ? '1 Download' : `${NUMBER.format(count)} Downloads`);
export const authorText = (authors) => (authors.length ? `von ${authors.join(', ')}` : '');
