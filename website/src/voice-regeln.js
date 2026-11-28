// HeldixClient – Webseite: Voice-Regeln laden und darstellen – für die Seite /voice-regeln (voice-regeln-seite.js)
// und den Dialog vor dem Beitreten im Browser (voice-panel.js).
//
// GET /api/v1/public/voice/rules (ohne Anmeldung, ab Dienst 1.13.0):
//   { published, version, publishedAt, text, clips, limits: { clipMs, clipBytes, deleteAfterDoneDays, deleteAfterDays,
//     kickMinutes } }
// Ohne Veröffentlichung: published false, version null, text = Standardtext, clips false.
// Textformat: Zeile mit „# “ = Überschrift, „- “ = Listenpunkt, Leerzeile = neuer Absatz, sonst Absatztext (höchstens
// 12 000 Zeichen). Der Text landet nur als Text im Dokument (kein HTML).
import { h } from './app-common.js';

const MAX_TEXT = 12_000;
export const RULES_LIMITS = Object.freeze({ clipMs: 600_000, clipBytes: 3_145_728, deleteAfterDoneDays: 30, deleteAfterDays: 90, kickMinutes: 10 });

const positive = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback);

/** Antwort des Dienstes prüfen → { published, version, publishedAt, text, clips, limits } oder null. */
export function normalizeRules(data) {
  if (!data || typeof data !== 'object' || typeof data.text !== 'string') return null;
  const version = Number.isInteger(data.version) && data.version > 0 ? data.version : null;
  const limits = data.limits && typeof data.limits === 'object' ? data.limits : {};
  return {
    published: data.published === true && version !== null,
    version,
    publishedAt: positive(data.publishedAt, null),
    text: data.text.slice(0, MAX_TEXT),
    clips: data.clips === true,
    limits: {
      clipMs: positive(limits.clipMs, RULES_LIMITS.clipMs),
      clipBytes: positive(limits.clipBytes, RULES_LIMITS.clipBytes),
      deleteAfterDoneDays: positive(limits.deleteAfterDoneDays, RULES_LIMITS.deleteAfterDoneDays),
      deleteAfterDays: positive(limits.deleteAfterDays, RULES_LIMITS.deleteAfterDays),
      kickMinutes: positive(limits.kickMinutes, RULES_LIMITS.kickMinutes),
    },
  };
}

/** Aktuelle Voice-Regeln vom Dienst; null, wenn er nicht antwortet oder sie noch nicht kennt (vor 1.13.0). */
export async function loadVoiceRules() {
  try {
    const response = await fetch('/api/v1/public/voice/rules', { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) return null;
    return normalizeRules(await response.json());
  } catch {
    return null;
  }
}

/** Minuten der Aufnahme beim Melden (für Texte). */
export const clipMinutes = (limits = RULES_LIMITS) => Math.max(1, Math.round(limits.clipMs / 60_000));

/**
 * Text in Bausteine zerlegen → { title, blocks: [{ type: 'heading', text } | { type: 'paragraph', text } |
 * { type: 'list', items: [...] }] }. Eine Überschrift ganz am Anfang wird zum Titel.
 */
export function parseRules(source) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
    if (list) blocks.push({ type: 'list', items: list });
    list = null;
  };
  for (const raw of String(source ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (/^#\s+/.test(line)) {
      flush();
      blocks.push({ type: 'heading', text: line.replace(/^#\s+/, '') });
    } else if (/^-\s+/.test(line)) {
      if (paragraph.length) {
        blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
        paragraph = [];
      }
      list ??= [];
      list.push(line.replace(/^-\s+/, ''));
    } else {
      if (list) {
        blocks.push({ type: 'list', items: list });
        list = null;
      }
      paragraph.push(line);
    }
  }
  flush();
  const title = blocks[0]?.type === 'heading' ? blocks.shift().text : null;
  return { title, blocks };
}

/** Wie die Anker im Hilfe-Center (build.mjs): „Aufnahme beim Melden“ → aufnahme-beim-melden. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Bausteine als Elemente. level: Ebene der Überschriften (2 auf der Seite, 3 im Dialog); ids: Überschriften mit
 * Ankern (für das Inhaltsverzeichnis). → { nodes, toc: [{ id, text }] }
 */
export function renderRules(parsed, { level = 2, ids = false } = {}) {
  const nodes = [];
  const toc = [];
  const used = new Set();
  for (const block of parsed.blocks) {
    if (block.type === 'heading') {
      let id = null;
      if (ids) {
        id = slugify(block.text) || 'abschnitt';
        while (used.has(id)) id += '-2';
        used.add(id);
        toc.push({ id, text: block.text });
      }
      nodes.push(h(`h${level}`, { id, text: block.text }));
    } else if (block.type === 'list') {
      nodes.push(h('ul', null, block.items.map((item) => h('li', { text: item }))));
    } else {
      nodes.push(h('p', { text: block.text }));
    }
  }
  return { nodes, toc };
}
