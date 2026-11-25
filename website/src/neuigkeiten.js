// HeldixClient – Webseite: alle Neuigkeiten (/neuigkeiten) mit „Ältere laden“ und der Versionsverlauf des Launchers.
// Neuigkeiten: GET /api/v1/news?limit=10&before=<id>; Versionen: GET /api/v1/launcher/versions.
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
    const retry = h('button', { type: 'button', class: 'button small ghost', onClick: () => loadNews() }, 'Erneut versuchen');
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
  if (!list.length) return h('p', { class: 'muted small', text: 'Kleinere Verbesserungen und Fehlerbehebungen.' });
  return h('ul', { class: 'release-notes' }, list.map((note) => h('li', { text: note })));
}

async function loadVersions() {
  const status = document.getElementById('release-status');
  try {
    const data = await publicGet('/v1/launcher/versions?limit=20');
    const versions = (Array.isArray(data?.versions) ? data.versions : []).filter((entry) => entry && typeof entry.version === 'string');
    if (!versions.length) {
      status.textContent = 'Der Versionsverlauf beginnt mit der nächsten veröffentlichten Version.';
      status.hidden = false;
      return;
    }
    const [latest, ...older] = versions;
    document.getElementById('release-version').textContent = latest.version;
    const date = versionDate(latest);
    const notes = document.getElementById('release-latest-notes');
    notes.replaceChildren(date ? h('p', { class: 'release-date', text: `veröffentlicht am ${date}` }) : null, notesList(latest.notes));
    document.getElementById('release-liste').replaceChildren(
      ...older.map((entry) =>
        h(
          'li',
          { class: 'release-item' },
          h('div', { class: 'release-item-head' }, h('h3', { text: `Version ${entry.version}` }), h('span', { class: 'release-date', text: versionDate(entry) })),
          notesList(entry.notes),
        ),
      ),
    );
  } catch {
    status.textContent = 'Der Versionsverlauf ist gerade nicht erreichbar.';
    status.hidden = false;
  }
}

more.addEventListener('click', () => loadNews({ older: true }));
loadNews();
loadVersions();
