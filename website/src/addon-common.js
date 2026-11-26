// HeldixClient – Webseite: gemeinsame Bausteine für den Addon-Store (/addons), die Vorschau auf der Startseite,
// „Meine Addons“ im Konto und die Prüfung im Team-Bereich.
//
// - Liste aus GET /api/v1/addons lesen und prüfen (unbrauchbare Einträge fallen weg)
// - Angezeigt wird, was im signierten Manifest steht: Ist `manifest` gültiges JSON zum selben Addon, gelten seine
//   Felder. „Offiziell“/„Community“ und der Einreicher kommen nur von dort; Downloads, Bewertungen, Screenshots
//   und Veröffentlichungszeit kommen vom Dienst (sie sind nicht signiert).
// - Texte vom Server landen nur als Text im Dokument (nie als HTML).
import { h, icon } from './app-common.js';
import { publicGet } from './public-cards.js';

export const ADDON_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** Höchste Heldix-API-Stufe, die der aktuelle HeldixClient lädt (HeldixApi.API_VERSION). */
export const API_STUFE = 4;
/** Ab welcher HeldixClient-Version es eine API-Stufe gibt (Stufen 1 und 2 laden alle Versionen mit Addons). */
export const API_STUFE_AB = { 3: '0.13.1', 4: '0.13.2' };
export const UUID_RE = /^[0-9a-f]{32}$/;
/** So zeigt der Dienst den Einreicher, wenn er seine Daten gelöscht hat. */
export const DELETED_PLAYER = 'Gelöschter Spieler';

/** Kategorien wie im Manifest, Anzeige wie in Launcher und Spiel. */
export const KATEGORIEN = {
  hud: 'HUD',
  musik: 'Musik & Medien',
  chat: 'Chat & Freunde',
  werkzeuge: 'Werkzeuge',
  sonstiges: 'Sonstiges',
};

export const SYSTEM_NAMEN = { windows: 'Windows', mac: 'Mac', linux: 'Linux' };
export const ALLE_SYSTEME = Object.keys(SYSTEM_NAMEN);

/**
 * Manifest v2: Zugriff (`access`), Minecraft-Versionen (`minecraft`) und Loader (`loaders`). Alte Manifeste ohne diese
 * Felder gelten als api, [] (jede Version) und heldix + fabric; ein Addon mit Minecraft-Zugriff läuft ohne Angabe nur
 * im Heldix Loader. Ein ungültiges Feld lässt das ganze Addon wegfallen (wie im Launcher). Texte wie im Launcher.
 */
export const ADDON_ACCESS = ['api', 'minecraft'];
export const ADDON_LOADERS = ['heldix', 'fabric'];
export const MINECRAFT_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._+*-]{0,31}$/;
export const MAX_MINECRAFT_VERSIONS = 50;
export const MINECRAFT_ACCESS = 'Greift in Minecraft ein';
export const MINECRAFT_ACCESS_HINT = 'Verändert Minecraft direkt, nicht nur über die Heldix-API – vom HeldixClient-Team geprüft. An und Aus wirkt erst nach dem Neustart.';

/** „26.3“, „26.2 und 26.3“, ab fünf: „26.0, 26.1, 26.2 und 3 weitere“ (wie im Launcher). */
export function minecraftVersionList(list) {
  if (list.length > 4) return `${list.slice(0, 3).join(', ')} und ${list.length - 3} weitere`;
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} und ${list.at(-1)}` : (list[0] ?? '');
}

/** „Minecraft 26.3“ bzw. „Minecraft 26.2 und 26.3“ – oder null, wenn das Addon in jeder Version läuft. */
export const minecraftLimit = (addon) => (addon.minecraft?.length ? `Minecraft ${minecraftVersionList(addon.minecraft)}` : null);

/** „Nur für Minecraft 26.3“ (Grund, wenn eine Instanz nicht passt). */
export const minecraftReason = (list) => `Nur für Minecraft ${minecraftVersionList(list)}`;

/** „Nur Heldix-Instanzen“ / „Nur Fabric-Instanzen“ – oder null, wenn das Addon in beiden läuft. */
export function loaderLimit(addon) {
  const loaders = addon.loaders?.length ? addon.loaders : ADDON_LOADERS;
  if (loaders.includes('heldix') && loaders.includes('fabric')) return null;
  return loaders.includes('heldix') ? 'Nur Heldix-Instanzen' : 'Nur Fabric-Instanzen';
}

/** Ausgeschrieben für die Details: „Heldix Loader und Fabric mit HeldixClient“, „Nur mit Heldix Loader“ … */
export function loaderText(addon) {
  const limit = loaderLimit(addon);
  if (!limit) return 'Heldix Loader und Fabric mit HeldixClient';
  return limit === 'Nur Heldix-Instanzen' ? 'Nur mit Heldix Loader' : 'Nur Fabric mit HeldixClient';
}

/** Felder aus Manifest v2 prüfen → { access, minecraft, loaders } (fehlende mit Standardwerten) oder null (ungültig). */
export function addonAccessFields(source) {
  if (source.access !== undefined && source.access !== null && !ADDON_ACCESS.includes(source.access)) return null;
  const access = source.access === 'minecraft' ? 'minecraft' : 'api';
  const minecraft = source.minecraft === undefined || source.minecraft === null ? [] : source.minecraft;
  if (!Array.isArray(minecraft) || minecraft.length > MAX_MINECRAFT_VERSIONS || minecraft.some((v) => typeof v !== 'string' || !MINECRAFT_VERSION_RE.test(v)) || new Set(minecraft).size !== minecraft.length) return null;
  if (access === 'minecraft' && minecraft.length === 0) return null;
  const loaders = source.loaders === undefined || source.loaders === null ? (access === 'api' ? [...ADDON_LOADERS] : ['heldix']) : source.loaders;
  if (!Array.isArray(loaders) || loaders.length === 0 || loaders.some((l) => !ADDON_LOADERS.includes(l)) || new Set(loaders).size !== loaders.length) return null;
  return { access, minecraft: [...minecraft], loaders: ADDON_LOADERS.filter((l) => loaders.includes(l)) };
}

/**
 * Chips für Karten und Details: „Greift in Minecraft ein“, „Minecraft 26.3“, „Nur Heldix-Instanzen“ (nur, was zutrifft).
 * compact: nur der Zugriff-Chip.
 */
export function accessChips(addon, { compact = false } = {}) {
  const chips = [];
  if (addon.access === 'minecraft') chips.push(h('span', { class: 'chip minecraft-access', title: MINECRAFT_ACCESS_HINT }, icon('code'), MINECRAFT_ACCESS));
  if (compact) return chips;
  const versions = minecraftLimit(addon);
  if (versions) chips.push(h('span', { class: 'chip minecraft-versions', title: 'Läuft nur in diesen Minecraft-Versionen' }, versions));
  const loader = loaderLimit(addon);
  if (loader) chips.push(h('span', { class: 'chip loader-limit', title: loader === 'Nur Heldix-Instanzen' ? 'Läuft nur in Instanzen mit dem Heldix Loader' : 'Läuft nur in Fabric-Instanzen mit HeldixClient' }, loader));
  return chips;
}

/** Gründe für eine Addon-Meldung (wie im Dienst). */
export const ADDON_REPORT_REASONS = [
  ['malware', 'Schadsoftware oder Datenklau'],
  ['broken', 'Funktioniert nicht'],
  ['inappropriate', 'Unangemessene Inhalte'],
  ['copyright', 'Verletzt Urheberrechte'],
  ['other', 'Sonstiges'],
];
export const addonReasonLabel = (reason) => ADDON_REPORT_REASONS.find(([id]) => id === reason)?.[1] ?? String(reason ?? '');

/**
 * Prüf-Hinweise aus der JAR (grobe Suche nach Konstanten in den Klassendateien, nichts wird ausgeführt).
 * danger = rot (darf ein Addon praktisch nie), warn = gelb (gibt es, muss aber erklärbar sein).
 */
export const INSPECTION = {
  prozesse: { level: 'danger', label: 'Startet Programme', detail: 'ProcessBuilder oder Runtime – kann Programme auf dem PC ausführen.' },
  nativ: { level: 'danger', label: 'Nativer Code', detail: 'System.loadLibrary oder java.lang.foreign – lädt Code außerhalb von Java.' },
  minecraft: { level: 'danger', label: 'Minecraft-Klassen', detail: 'Greift direkt auf net.minecraft zu, gibt es aber nicht an. Eingriffe in Minecraft sind nur mit „Greift in Minecraft ein“ erlaubt (clientEntrypoint oder transformers in heldix.addon.json).' },
  netzwerk: { level: 'warn', label: 'Netzwerk', detail: 'java.net – kann Verbindungen ins Internet aufbauen.' },
  dateien: { level: 'warn', label: 'Dateien', detail: 'java.io.File oder java.nio.file – kann Dateien lesen und schreiben.' },
  reflection: { level: 'warn', label: 'Reflection', detail: 'java.lang.reflect – kann an der Heldix-API vorbei auf fremden Code zugreifen.' },
};
const INSPECTION_ORDER = ['prozesse', 'nativ', 'minecraft', 'netzwerk', 'dateien', 'reflection'];

/** inspection aus dem Dienst → { classes, uses } (bekannte Hinweise, rot zuerst) oder null. */
export function normalizeInspection(value) {
  if (!value || typeof value !== 'object') return null;
  const uses = Array.isArray(value.uses) ? INSPECTION_ORDER.filter((use) => value.uses.includes(use)) : [];
  return { classes: Number.isInteger(value.classes) && value.classes >= 0 ? value.classes : null, uses };
}

const NUMBER = new Intl.NumberFormat('de-DE');
const RATING = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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

/** Bewertung vom Dienst → { average (1–5) | null, count }. */
export function normalizeRating(value) {
  const count = Number.isInteger(value?.count) && value.count > 0 ? value.count : 0;
  const average = count && typeof value.average === 'number' && Number.isFinite(value.average) ? Math.min(5, Math.max(1, value.average)) : null;
  return { average, count: average === null ? 0 : count };
}

/**
 * Einreicher eines Community-Addons: die UUID aus dem signierten Manifest; den aktuellen Namen liefert der Dienst
 * (Spieler können sich umbenennen). Hat der Spieler seine Daten gelöscht, gibt es keine Entwicklerseite mehr.
 */
function authorOf(entry, signed) {
  const fromManifest = signed.author;
  if (!fromManifest || typeof fromManifest !== 'object' || typeof fromManifest.uuid !== 'string' || !UUID_RE.test(fromManifest.uuid)) return null;
  const current = entry.author;
  if (current === null || current?.deleted === true) return { uuid: fromManifest.uuid, name: DELETED_PLAYER, deleted: true };
  let name = text(fromManifest.name, 40) || 'Unbekannt';
  if (current && typeof current === 'object' && current.uuid === fromManifest.uuid && text(current.name, 40)) name = text(current.name, 40);
  return { uuid: fromManifest.uuid, name, deleted: name === DELETED_PLAYER };
}

/** Eintrag aus der Liste (oder `addon` aus den Details) in eine sichere, vollständige Form bringen; sonst null. */
export function normalizeAddon(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !ADDON_ID_RE.test(entry.id)) return null;
  const signed = signedFields(entry);
  const source = { ...entry, ...signed };
  const name = text(source.name, 40);
  const version = text(source.version, 60);
  if (!name || !version) return null;
  const platforms = [...new Set(list(source.platforms, 3, 10).filter((system) => ALLE_SYSTEME.includes(system)))];
  const date = typeof source.date === 'string' && Number.isFinite(Date.parse(source.date)) ? Date.parse(source.date) : null;
  const official = signed.official === true;
  const access = addonAccessFields(source);
  if (!access) return null;
  const shots = Number.isInteger(entry.screenshots) ? Math.min(4, Math.max(0, entry.screenshots)) : 0;
  return {
    id: entry.id,
    name,
    version,
    summary: text(source.summary, 200),
    description: text(source.description, 4000),
    authors: list(source.authors, 5, 40),
    api: Number.isInteger(source.api) ? source.api : null,
    access: access.access,
    minecraft: access.minecraft,
    loaders: access.loaders,
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
    official,
    author: official ? null : authorOf(entry, signed),
    rating: normalizeRating(entry.rating),
    screenshots: shots,
    screenshotsVersion: typeof entry.screenshotsVersion === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(entry.screenshotsVersion) ? entry.screenshotsVersion : '',
    hidden: entry.hidden === true,
  };
}

function uniqueAddons(entries) {
  const seen = new Set();
  return (Array.isArray(entries) ? entries : []).map(normalizeAddon).filter((addon) => addon && !seen.has(addon.id) && seen.add(addon.id));
}

/** GET /v1/addons → geprüfte Einträge in der Reihenfolge des Dienstes (beliebteste zuerst). */
export async function loadAddons() {
  const data = await publicGet('/v1/addons');
  return uniqueAddons(data?.addons);
}

/** GET /v1/addon-authors/<uuid> → { author: { uuid, name }, addons } (wirft mit .status, z. B. 404). */
export async function loadAuthor(uuid) {
  const data = await publicGet(`/v1/addon-authors/${encodeURIComponent(uuid)}`);
  const name = text(data?.author?.name, 40) || 'Unbekannt';
  return { author: { uuid, name }, addons: uniqueAddons(data?.addons).filter((addon) => !addon.official && addon.author?.uuid === uuid) };
}

export { uniqueAddons as normalizeAddons };

/** Gibt es das Icon im Heldix-Icon-Set der Seite (template#icons)? */
export function hasIcon(name) {
  return Boolean(document.getElementById('icons')?.content.querySelector(`[data-icon="${CSS.escape(String(name))}"]`));
}

/** Alle Namen im Heldix-Icon-Set der Seite (für die Icon-Auswahl). */
export function iconNames() {
  return [...(document.getElementById('icons')?.content.querySelectorAll('[data-icon]') ?? [])].map((element) => element.dataset.icon).filter(Boolean);
}

/** Icon aus dem Heldix-Icon-Set, unbekannte Namen als Puzzleteil. */
export function addonIcon(name, className = 'addon-icon') {
  const svg = hasIcon(name) ? icon(name) : icon('addons');
  return h('span', { class: className, 'aria-hidden': 'true' }, svg);
}

/** Abzeichen „Offiziell“ (vom Team) oder „Community“ (von Spielern) – nur aus dem signierten Manifest. */
export function originBadge(addon) {
  return addon.official
    ? h('span', { class: 'chip official', title: 'Vom HeldixClient-Team' }, icon('shield'), 'Offiziell')
    : h('span', { class: 'chip community', title: 'Von einem Spieler, geprüft und signiert vom Team' }, icon('friends'), 'Community');
}

/** Link auf die Entwicklerseite (/addons?autor=<uuid>), bei gelöschten Spielern nur der Name. */
export function authorLink(author, className = 'addon-author-link') {
  if (!author) return null;
  if (author.deleted) return h('span', { class: `${className} deleted`, text: author.name });
  return h('a', { class: className, href: `/addons?autor=${encodeURIComponent(author.uuid)}` }, author.name);
}

/** Fünf Sterne, gefüllt bis zum Durchschnitt (rein dekorativ – die Zahl steht daneben als Text). */
export function starRow(average, className = '') {
  const row = () => h('span', { class: 'stars-row' }, [1, 2, 3, 4, 5].map(() => icon('star')));
  const element = h('span', { class: `stars${className ? ` ${className}` : ''}`, 'aria-hidden': 'true' }, row(), h('span', { class: 'stars-fill' }, row()));
  element.style.setProperty('--fill', `${Math.round(((average ?? 0) / 5) * 1000) / 10}%`);
  return element;
}

export const formatRating = (average) => RATING.format(average);
export const ratingCountText = (count) => (count === 1 ? '1 Bewertung' : `${NUMBER.format(count)} Bewertungen`);
/** „4,6 von 5 Sternen, 18 Bewertungen“ bzw. „Noch keine Bewertungen“. */
export const ratingText = (rating) => (rating.average === null ? 'Noch keine Bewertungen' : `${formatRating(rating.average)} von 5 Sternen, ${ratingCountText(rating.count)}`);

/** Sterne + „4,6 (18)“ für Karten und Listen. */
export function ratingSummary(rating, { long = false } = {}) {
  if (rating.average === null) return h('span', { class: 'addon-rating none', title: 'Noch keine Bewertungen' }, starRow(0), h('span', { class: 'rating-text', text: long ? 'Noch keine Bewertungen' : 'neu' }));
  return h(
    'span',
    { class: 'addon-rating', title: ratingText(rating) },
    starRow(rating.average),
    h('span', { class: 'rating-text', 'aria-hidden': 'true', text: long ? `${formatRating(rating.average)} · ${ratingCountText(rating.count)}` : `${formatRating(rating.average)} (${NUMBER.format(rating.count)})` }),
    h('span', { class: 'visually-hidden', text: ratingText(rating) }),
  );
}

/** Adresse eines Screenshots (1–4); die Version im Namen umgeht alte Bilder im Zwischenspeicher. */
export const screenshotUrl = (id, n, version = '') => `/api/v1/addons/${encodeURIComponent(id)}/screenshots/${n}${version ? `?v=${encodeURIComponent(version)}` : ''}`;

/** „Nur Windows“, „Windows und Mac“ – oder null, wenn das Addon überall läuft. */
export function platformLimit(platforms) {
  if (!platforms.length || Object.keys(SYSTEM_NAMEN).every((system) => platforms.includes(system))) return null;
  const names = platforms.map((system) => SYSTEM_NAMEN[system]);
  return names.length === 1 ? `Nur ${names[0]}` : `${names.slice(0, -1).join(', ')} und ${names.at(-1)}`;
}

/** Ausgeschrieben für die Details: „Alle Systeme“ oder „Windows“. */
export function platformText(platforms) {
  return platforms.length ? platforms.map((system) => SYSTEM_NAMEN[system]).join(', ') : 'Alle Systeme';
}

export const formatCount = (count) => (count === 1 ? '1 Download' : `${NUMBER.format(count)} Downloads`);
export const authorText = (authors) => (authors.length ? `von ${authors.join(', ')}` : '');

/** Klartext wie im Manifest: Absätze durch Leerzeilen, Zeilen mit „- “ als Liste, sonst nichts (nie HTML). */
export function plainText(source) {
  const out = [];
  for (const block of String(source ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let paragraph = null;
    let items = null;
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^- \S/.test(line)) {
        paragraph = null;
        if (!items) out.push((items = h('ul')));
        items.append(h('li', { text: line.slice(2).trim() }));
      } else {
        items = null;
        if (paragraph) paragraph.append(h('br'));
        else out.push((paragraph = h('p')));
        paragraph.append(document.createTextNode(line));
      }
    }
  }
  return out;
}

/** Prüf-Hinweise als Liste: rot/gelb mit Erklärung, sonst grün „nichts Auffälliges“. */
export function inspectionList(inspection, { compact = false } = {}) {
  const data = normalizeInspection(inspection);
  if (!data) return h('p', { class: 'muted small', text: 'Noch keine Prüf-Hinweise – die kommen mit der JAR.' });
  const items = data.uses.map((use) => {
    const info = INSPECTION[use];
    return h('li', { class: `inspect-item ${info.level}`, dataset: { use } }, icon(info.level === 'danger' ? 'warning' : 'info'), h('span', null, h('strong', { text: info.label }), compact ? null : h('span', { class: 'inspect-detail', text: ` – ${info.detail}` })));
  });
  if (!items.length) items.push(h('li', { class: 'inspect-item ok' }, icon('check'), h('span', null, h('strong', { text: 'Nichts Auffälliges' }), compact ? null : h('span', { class: 'inspect-detail', text: ' – keine Zugriffe auf Netzwerk, Dateien, Prozesse, Reflection, nativen Code oder Minecraft gefunden.' }))));
  return h('ul', { class: `inspect-list${compact ? ' compact' : ''}` }, items);
}

/** Kurzfassung für Listen: „2 rot · 1 gelb“ als Chips. */
export function inspectionChips(inspection) {
  const data = normalizeInspection(inspection);
  if (!data) return [];
  const red = data.uses.filter((use) => INSPECTION[use].level === 'danger').length;
  const amber = data.uses.length - red;
  const chips = [];
  if (red) chips.push(h('span', { class: 'chip danger', title: data.uses.filter((use) => INSPECTION[use].level === 'danger').map((use) => INSPECTION[use].label).join(', ') }, icon('warning'), red === 1 ? '1 roter Hinweis' : `${red} rote Hinweise`));
  if (amber) chips.push(h('span', { class: 'chip warning', title: data.uses.filter((use) => INSPECTION[use].level === 'warn').map((use) => INSPECTION[use].label).join(', ') }, amber === 1 ? '1 gelber Hinweis' : `${amber} gelbe Hinweise`));
  if (!red && !amber) chips.push(h('span', { class: 'chip success' }, icon('check'), 'unauffällig'));
  return chips;
}
