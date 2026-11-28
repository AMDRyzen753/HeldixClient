// HeldixClient – Webseite: alle Neuigkeiten (/neuigkeiten) mit „Ältere laden“ und der Versionsverlauf des Launchers.
// Neuigkeiten: GET /api/v1/news?limit=10&before=<id>; Versionen stehen schon im HTML (aus launcher/release-notes.md),
// GET /api/v1/launcher/versions ergänzt Daten und ältere Versionen.
// Den Download-Knopf der neuesten Version steuert site.js (wie auf der Startseite).
import { emptyState, formatDate, h } from './app-common.js';
import { newsCard, publicGet } from './public-cards.js';

const PAGE = 10;
const archive = document.getElementById('archiv');
const more = document.getElementById('archiv-mehr');
let oldestId = null;
let loading = false;

function validNews(item) {
  return item && typeof item.title === 'string' && typeof item.text === 'string';
}

async function loadNews({ older = false } = {}) {
  if (loading) return;
  loading = true;
  archive.setAttribute('aria-busy', 'true');
  more.disabled = true;
  if (older) more.textContent = 'Wird geladen …';
  try {
    const query = older && oldestId !== null ? `?limit=${PAGE}&before=${encodeURIComponent(oldestId)}` : `?limit=${PAGE}`;
    const data = await publicGet(`/v1/news${query}`);
    const items = (Array.isArray(data?.news) ? data.news : []).filter(validNews);
    if (!older) archive.replaceChildren();
    if (!older && !items.length) {
      archive.replaceChildren(emptyState('Noch keine Neuigkeiten.', 'news'));
      more.hidden = true;
      return;
    }
    const cards = items.map((item) => newsCard(item, { anchor: true }));
    archive.append(...cards);
    if (items.length) oldestId = items[items.length - 1].id;
    // Ältere Dienste kennen „more“ noch nicht: dann zählt, ob die Seite voll war.
    more.hidden = typeof data?.more === 'boolean' ? !data.more : items.length < PAGE;
    if (older && cards[0]) {
      cards[0].setAttribute('tabindex', '-1');
      cards[0].focus({ preventScroll: false });
    }
    if (!older && location.hash.startsWith('#neuigkeit-')) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch {
    if (older) {
      more.textContent = 'Laden fehlgeschlagen – erneut versuchen';
      return;
    }
    const retry = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', onClick: () => loadNews() }, 'Erneut versuchen');
    archive.replaceChildren(h('div', { class: 'empty' }, h('p', { text: 'Die Neuigkeiten sind gerade nicht erreichbar. Bitte versuch es später noch einmal.' }), retry));
    more.hidden = true;
  } finally {
    loading = false;
    archive.setAttribute('aria-busy', 'false');
    more.disabled = false;
    if (more.textContent === 'Wird geladen …') more.textContent = 'Ältere Neuigkeiten laden';
  }
}

/** „2026-11-23“ → „23. November 2026“, sonst der Veröffentlichungszeitpunkt. */
function versionDate(version) {
  const parsed = typeof version.date === 'string' ? Date.parse(version.date) : NaN;
  if (Number.isFinite(parsed)) return formatDate(parsed);
  if (typeof version.publishedAt === 'number') return formatDate(version.publishedAt);
  return '';
}

function notesList(notes) {
  const list = (Array.isArray(notes) ? notes : []).filter((note) => typeof note === 'string' && note.trim());
  if (!list.length) return h('p', { class: 'text-2 small', text: 'Kleinere Verbesserungen und Fehlerbehebungen.' });
  return h('ul', { class: 'release-notes' }, list.map((note) => h('li', { text: note })));
}

/**
 * Versionsverlauf: Die Einträge setzt der Bau aus launcher/release-notes.md ein. Der Dienst ergänzt das Datum jeder
 * veröffentlichten Version und ältere Versionen, die nicht mehr in release-notes.md stehen.
 */
async function loadVersions() {
  const list = document.getElementById('release-liste');
  try {
    const data = await publicGet('/v1/launcher/versions?limit=30');
    const versions = (Array.isArray(data?.versions) ? data.versions : []).filter((entry) => entry && typeof entry.version === 'string');
    const known = new Set([...document.querySelectorAll('[data-version]')].map((element) => element.dataset.version));
    for (const entry of versions) {
      const date = versionDate(entry);
      const target = document.querySelector(`[data-version="${CSS.escape(entry.version)}"] [data-datum]`);
      if (target && date) target.textContent = `veröffentlicht am ${date}`;
      if (known.has(entry.version)) continue;
      known.add(entry.version);
      list.append(
        h(
          'li',
          { class: 'release-item', 'data-version': entry.version },
          h('div', { class: 'release-item__head' }, h('h3', { class: 'h4', text: `Version ${entry.version}` }), h('span', { class: 'release-date', text: date })),
          notesList(entry.notes),
        ),
      );
    }
  } catch {
    // Ohne Dienst bleibt der Verlauf aus dem Bau stehen – nur ohne Datum.
  }
}

more.addEventListener('click', () => loadNews({ older: true }));
loadNews();
loadVersions();
