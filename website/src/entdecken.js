// HeldixClient – Webseite: Entdecken (/entdecken) – das öffentliche Weltenverzeichnis (Heldix-Dienst ab 1.13.0).
//
// GET /api/v1/public/discover?sort=popular|new|active&tag=&lang=&version=&q=&page= → { sort, page, pages, total,
// entries: [DiscoverEntry] } (24 je Seite, öffentlich, ohne Anmeldung) und /v1/public/discover/meta für die Tags.
// Filter, Sortierung, Suche und Seite stehen hinter dem # (#sortierung=neu&tag=bauen&seite=2) – teilbar, aber nicht in
// Server-Protokollen. Köpfe und Symbole kommen vom Heldix-Dienst (/api/v1/public/heads/…, …/icon.png), nie von Mojang.
// „Beitreten“ öffnet heldixclient://welt/<code>; „Kopieren“ legt die Adresse für die Serverliste in die Zwischenablage.
import { copyText, h, icon, toast } from './app-common.js';
import { publicGet } from './public-cards.js';

const SORTS = { popular: 'beliebt', active: 'aktiv', new: 'neu' };
const SORT_FROM_HASH = Object.fromEntries(Object.entries(SORTS).map(([id, word]) => [word, id]));
const FALLBACK_TAGS = [
  ['survival', 'Survival'],
  ['kreativ', 'Kreativ'],
  ['minispiele', 'Minispiele'],
  ['rollenspiel', 'Rollenspiel'],
  ['bauen', 'Bauen'],
  ['parkour', 'Parkour'],
  ['technik', 'Technik'],
  ['entspannt', 'Entspannt'],
  ['hardcore', 'Hardcore'],
].map(([id, label]) => ({ id, label }));
const CODE_RE = /^[a-hjkmnp-z2-9]{6}$/;
const HEAD_RE = /^\/v1\/public\/heads\/[0-9a-f]{32}\.png$/;
const ICON_RE = /^\/v1\/public\/discover\/[a-hjkmnp-z2-9]{6}\/icon\.png$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,32}$/;
const NUMBER = new Intl.NumberFormat('de-DE');

const $ = (id) => document.getElementById(id);
const state = { sort: 'popular', tag: '', lang: '', version: '', q: '', page: 1, pages: 1, tags: FALLBACK_TAGS, loading: 0 };

const tagLabel = (id) => state.tags.find((tag) => tag.id === id)?.label ?? id;

/** Zustand einer Welt im Verzeichnis als Text (geteilte Welten: geöffnet; dauerhafte: Zustand). */
function stateInfo(entry) {
  switch (entry.state) {
    case 'running':
      return { label: 'Läuft', tone: 'online', hint: null };
    case 'online':
      return { label: 'Geöffnet', tone: 'online', hint: null };
    case 'starting':
      return { label: 'Startet gerade', tone: 'soon', hint: 'In etwa 30 Sekunden kannst du beitreten.' };
    case 'stopping':
    case 'sleeping':
      return { label: 'Schläft', tone: '', hint: 'Beitreten weckt sie – das dauert etwa 30 Sekunden.' };
    default:
      return { label: String(entry.state ?? ''), tone: '', hint: null };
  }
}

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
// Karten
// ---------------------------------------------------------------------------------------------------------

function headImage(entry) {
  const head = typeof entry.host?.head === 'string' && HEAD_RE.test(entry.host.head) ? entry.host.head : null;
  const image = h('img', { class: 'kopf discover-card__head', src: '/assets/standard-kopf.svg', width: '28', height: '28', alt: '', loading: 'lazy', decoding: 'async' });
  if (head) {
    image.addEventListener('error', () => image.setAttribute('src', '/assets/standard-kopf.svg'), { once: true });
    image.src = `/api${head}?size=32`;
  }
  return image;
}

function worldIcon(entry) {
  const src = typeof entry.icon === 'string' && ICON_RE.test(entry.icon) ? `/api${entry.icon}` : null;
  if (!src) return h('span', { class: `icon-tile discover-card__icon${entry.persistent ? ' icon-tile--online' : ''}`, 'aria-hidden': 'true' }, icon(entry.persistent ? 'server' : 'world'));
  const image = h('img', { class: 'discover-card__symbol', src, width: '48', height: '48', alt: '', loading: 'lazy', decoding: 'async' });
  image.addEventListener('error', () => image.replaceWith(h('span', { class: 'icon-tile discover-card__icon', 'aria-hidden': 'true' }, icon('world'))), { once: true });
  return image;
}

function card(entry) {
  const info = stateInfo(entry);
  const code = CODE_RE.test(entry.code ?? '') ? entry.code : null;
  const address = typeof entry.address === 'string' ? entry.address : '';
  const players = Number(entry.players) || 0;
  const max = Number(entry.maxPlayers) || 0;
  const live = entry.state === 'running' || entry.state === 'online';
  const copy = h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon', 'aria-label': `Adresse von ${entry.name} kopieren`, title: 'Adresse kopieren', dataset: { aktion: 'kopieren' } }, icon('copy'));
  copy.addEventListener('click', async () => {
    const ok = await copyText(address);
    toast(ok ? `${address} kopiert – in Minecraft unter Mehrspieler → Server hinzufügen einfügen.` : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
  });
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  return h(
    'article',
    { class: `card discover-card${live ? ' is-live' : ''}`, dataset: { code: code ?? '', zustand: entry.state ?? '' } },
    h(
      'div',
      { class: 'discover-card__top' },
      worldIcon(entry),
      h(
        'div',
        { class: 'discover-card__title' },
        h('h3', { class: 'card__title' }, code ? h('a', { href: `/welt#${code}`, text: entry.name }) : entry.name),
        h('p', { class: 'discover-card__host' }, headImage(entry), h('span', null, 'von ', h('strong', { text: entry.host?.name ?? 'unbekannt' }))),
      ),
    ),
    h(
      'div',
      { class: 'discover-card__chips' },
      h('span', { class: `chip${info.tone ? ` chip--${info.tone}` : ''}` }, h('span', { class: `dot${live ? ' dot--online' : ''}`, 'aria-hidden': 'true' }), info.label),
      entry.persistent ? h('span', { class: 'chip chip--accent', title: 'Läuft auf dem Heldix-Server, auch wenn der Besitzer offline ist' }, icon('server'), 'Dauerhaft') : null,
      tags.map((tag) => h('span', { class: 'chip discover-tag', text: tagLabel(tag) })),
    ),
    entry.description ? h('p', { class: 'card__text discover-card__text', text: entry.description }) : h('p', { class: 'card__text discover-card__text text-3', text: 'Ohne Beschreibung.' }),
    info.hint ? h('p', { class: 'tiny text-3', text: info.hint }) : null,
    h(
      'dl',
      { class: 'discover-card__facts' },
      h('div', null, h('dt', { text: 'Spieler' }), h('dd', { text: live || entry.state === 'starting' ? `${players} von ${max}` : `bis zu ${max}` })),
      h('div', null, h('dt', { text: 'Minecraft' }), h('dd', { text: entry.version ?? '–' })),
      h('div', null, h('dt', { text: 'Sprache' }), h('dd', { text: entry.lang === 'en' ? 'Englisch' : 'Deutsch' })),
      h('div', null, h('dt', { text: 'Gefällt mir' }), h('dd', { class: 'discover-card__likes' }, icon('heart'), NUMBER.format(Number(entry.likes) || 0))),
    ),
    h(
      'div',
      { class: 'discover-card__actions' },
      code ? h('a', { class: 'btn btn--primary btn--sm', href: `heldixclient://welt/${code}`, dataset: { aktion: 'beitreten' } }, icon('play'), 'Beitreten') : null,
      address ? copy : null,
      code ? h('a', { class: 'btn btn--secondary btn--sm', href: `/welt#${code}`, dataset: { aktion: 'details' } }, 'Details', icon('chevron-right')) : null,
    ),
  );
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
  list.replaceChildren(...entries.map(card));
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

readHash();
loadMeta();
load();
