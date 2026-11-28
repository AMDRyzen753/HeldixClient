// HeldixClient – Webseite: Entdecken (/entdecken) – das öffentliche Weltenverzeichnis (Heldix-Dienst ab 1.13.0).
//
// GET /api/v1/public/discover?sort=popular|new|active&tag=&lang=&version=&q=&page= → { sort, page, pages, total,
// entries: [DiscoverEntry] } (24 je Seite, öffentlich, ohne Anmeldung) und /v1/public/discover/meta für die Tags.
// Filter, Sortierung, Suche und Seite stehen hinter dem # (#sortierung=neu&tag=bauen&seite=2) – teilbar, aber nicht in
// Server-Protokollen. Köpfe und Symbole kommen vom Heldix-Dienst (/api/v1/public/heads/…, …/icon.png), nie von Mojang.
// „Beitreten“ öffnet heldixclient://welt/<code>; „Kopieren“ legt die Adresse für die Serverliste in die Zwischenablage.
// Die Karten baut entdecken-karten.js (dieselben auf den Spielerprofilen).
// Ab Dienst 1.14.0: Abschnitt „Partner-Server“ über dem Verzeichnis (GET /v1/public/partners, partner-common.js) –
// hervorgehobene zuerst, mit Abzeichen „Partner“ und Adresse zum Kopieren. Ohne Partner bleibt der Abschnitt weg.
import { h } from './app-common.js';
import { FALLBACK_TAGS, discoverCard } from './entdecken-karten.js';
import { loadPartners, partnerCard } from './partner-common.js';
import { publicGet } from './public-cards.js';

const SORTS = { popular: 'beliebt', active: 'aktiv', new: 'neu' };
const SORT_FROM_HASH = Object.fromEntries(Object.entries(SORTS).map(([id, word]) => [word, id]));
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const NUMBER = new Intl.NumberFormat('de-DE');

const $ = (id) => document.getElementById(id);
const state = { sort: 'popular', tag: '', lang: '', version: '', q: '', page: 1, pages: 1, tags: FALLBACK_TAGS, loading: 0 };

const tagLabel = (id) => state.tags.find((tag) => tag.id === id)?.label ?? id;

// ---------------------------------------------------------------------------------------------------------
// Adresse (#…) ⇄ Zustand
// ---------------------------------------------------------------------------------------------------------

function readHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  state.sort = SORT_FROM_HASH[params.get('sortierung')] ?? 'popular';
  const tag = params.get('tag') ?? '';
  state.tag = /^[a-z]{2,20}$/.test(tag) ? tag : '';
  const lang = params.get('sprache') ?? '';
  state.lang = lang === 'de' || lang === 'en' ? lang : '';
  const version = params.get('version') ?? '';
  state.version = VERSION_RE.test(version) ? version : '';
  state.q = (params.get('suche') ?? '').slice(0, 64);
  const page = Number.parseInt(params.get('seite') ?? '1', 10);
  state.page = Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1;
}

function writeHash() {
  const params = new URLSearchParams();
  if (state.sort !== 'popular') params.set('sortierung', SORTS[state.sort]);
  if (state.tag) params.set('tag', state.tag);
  if (state.lang) params.set('sprache', state.lang);
  if (state.version) params.set('version', state.version);
  if (state.q) params.set('suche', state.q);
  if (state.page > 1) params.set('seite', String(state.page));
  const hash = params.toString();
  const url = `${location.pathname}${location.search}${hash ? `#${hash}` : ''}`;
  if (`${location.pathname}${location.search}${location.hash}` !== url) history.replaceState(null, '', url);
}

function syncControls() {
  for (const button of $('entdecken-sortierung').querySelectorAll('button[data-sort]')) button.setAttribute('aria-pressed', String(button.dataset.sort === state.sort));
  $('entdecken-tag').value = state.tag;
  $('entdecken-sprache').value = state.lang;
  if (document.activeElement !== $('entdecken-version')) $('entdecken-version').value = state.version;
  if (document.activeElement !== $('entdecken-suche')) $('entdecken-suche').value = state.q;
  for (const chip of $('entdecken-tags').querySelectorAll('button[data-tag]')) chip.setAttribute('aria-pressed', String(chip.dataset.tag === state.tag));
}

// ---------------------------------------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------------------------------------

function showError(text) {
  $('entdecken-fehler').hidden = false;
  $('entdecken-fehler-text').textContent = text;
  $('entdecken-liste').replaceChildren();
  $('entdecken-leer').hidden = true;
  $('entdecken-seiten').hidden = true;
  $('entdecken-ergebnis').textContent = '';
}

async function load() {
  const ticket = ++state.loading;
  syncControls();
  writeHash();
  const list = $('entdecken-liste');
  list.setAttribute('aria-busy', 'true');
  if (!list.firstChild) list.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'card discover-card is-placeholder', 'aria-hidden': 'true' })));
  const query = new URLSearchParams({ sort: state.sort, page: String(state.page) });
  if (state.tag) query.set('tag', state.tag);
  if (state.lang) query.set('lang', state.lang);
  if (state.version) query.set('version', state.version);
  if (state.q) query.set('q', state.q);
  let data;
  try {
    data = await publicGet(`/v1/public/discover?${query}`);
  } catch (error) {
    if (ticket !== state.loading) return;
    list.setAttribute('aria-busy', 'false');
    if (error.status === 503) return showError('Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet – deshalb gibt es auch kein Verzeichnis.');
    if (error.status === 404) return showError('Das Weltenverzeichnis gibt es mit dem Heldix-Dienst ab Version 1.13.0.');
    if (error.status === 429) return showError('Gerade kommen zu viele Anfragen. Versuch es in einer Minute noch einmal.');
    if (error.status === 400 && state.page > 1) {
      state.page = 1;
      return load();
    }
    return showError('Die Welten konnten nicht geladen werden. Prüf deine Verbindung und versuch es gleich noch einmal.');
  }
  if (ticket !== state.loading) return;
  list.setAttribute('aria-busy', 'false');
  $('entdecken-fehler').hidden = true;
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  state.pages = Math.max(1, Number(data?.pages) || 1);
  if (state.page > state.pages && state.page > 1) {
    state.page = state.pages;
    return load();
  }
  const total = Number(data?.total) || 0;
  list.replaceChildren(...entries.map((entry) => discoverCard(entry, { tagLabel })));
  const filtered = Boolean(state.tag || state.lang || state.version || state.q);
  $('entdecken-leer').hidden = entries.length > 0;
  $('entdecken-leer-text').textContent = filtered ? 'Gerade passt keine Welt zu deiner Auswahl. Probier einen anderen Filter.' : 'Gerade steht keine Welt im Verzeichnis. Trag deine eigene ein!';
  $('entdecken-ergebnis').textContent = total ? `${NUMBER.format(total)} ${total === 1 ? 'Welt' : 'Welten'}${filtered ? ' passen' : ' im Verzeichnis'}` : '';
  const pager = $('entdecken-seiten');
  pager.hidden = state.pages <= 1;
  $('entdecken-seite').textContent = `Seite ${state.page} von ${state.pages}`;
  $('entdecken-zurueck').disabled = state.page <= 1;
  $('entdecken-weiter').disabled = state.page >= state.pages;
}

async function loadMeta() {
  try {
    const meta = await publicGet('/v1/public/discover/meta');
    if (Array.isArray(meta?.tags) && meta.tags.every((tag) => typeof tag?.id === 'string' && typeof tag?.label === 'string')) state.tags = meta.tags;
  } catch {
    // Rückfall: feste Liste
  }
  const select = $('entdecken-tag');
  select.replaceChildren(h('option', { value: '' }, 'Alle Tags'), ...state.tags.map((tag) => h('option', { value: tag.id }, tag.label)));
  $('entdecken-tags').replaceChildren(...state.tags.map((tag) => h('button', { type: 'button', class: 'chip chip--lg discover-tag-chip', 'aria-pressed': 'false', dataset: { tag: tag.id } }, tag.label)));
  syncControls();
}

// ---------------------------------------------------------------------------------------------------------
// Bedienung
// ---------------------------------------------------------------------------------------------------------

const typing = new Map(); // Feld → Zeitgeber (Suche und Version getrennt)
function onType(key, value) {
  clearTimeout(typing.get(key));
  typing.set(key, setTimeout(() => {
    const next = key === 'version' ? (VERSION_RE.test(value.trim()) ? value.trim() : '') : value.trim().slice(0, 64);
    if (state[key] === next) return;
    state[key] = next;
    state.page = 1;
    load();
  }, 350));
}

$('entdecken-filter').addEventListener('submit', (event) => event.preventDefault());
$('entdecken-sortierung').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-sort]');
  if (!button || button.dataset.sort === state.sort) return;
  state.sort = button.dataset.sort;
  state.page = 1;
  load();
});
$('entdecken-tag').addEventListener('change', (event) => {
  state.tag = event.currentTarget.value;
  state.page = 1;
  load();
});
$('entdecken-tags').addEventListener('click', (event) => {
  const chip = event.target.closest('button[data-tag]');
  if (!chip) return;
  state.tag = state.tag === chip.dataset.tag ? '' : chip.dataset.tag;
  state.page = 1;
  load();
});
$('entdecken-sprache').addEventListener('change', (event) => {
  state.lang = event.currentTarget.value;
  state.page = 1;
  load();
});
$('entdecken-suche').addEventListener('input', (event) => onType('q', event.currentTarget.value));
$('entdecken-version').addEventListener('input', (event) => onType('version', event.currentTarget.value));
$('entdecken-zurueck').addEventListener('click', () => {
  if (state.page <= 1) return;
  state.page--;
  load().then(() => $('entdecken-titel').scrollIntoView({ block: 'start' }));
});
$('entdecken-weiter').addEventListener('click', () => {
  if (state.page >= state.pages) return;
  state.page++;
  load().then(() => $('entdecken-titel').scrollIntoView({ block: 'start' }));
});
$('entdecken-erneut').addEventListener('click', () => load());
window.addEventListener('hashchange', () => {
  readHash();
  load();
});

// ---------------------------------------------------------------------------------------------------------
// Partner-Server
// ---------------------------------------------------------------------------------------------------------

async function loadPartnerSection() {
  const section = $('entdecken-partner');
  if (!section) return;
  const partners = await loadPartners();
  section.hidden = !partners.length;
  if (!partners.length) return;
  $('entdecken-partner-liste').replaceChildren(...partners.map(partnerCard));
  $('entdecken-partner-zahl').textContent = partners.length === 1 ? '1 Partner-Server' : `${partners.length} Partner-Server`;
}

readHash();
loadMeta();
load();
loadPartnerSection();
