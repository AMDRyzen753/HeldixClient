// HeldixClient – Webseite: Addon-Store (/addons). Karten aus GET /api/v1/addons, Suche, Kategorie-Filter und
// Sortierung im Browser. Details als Dialog, verlinkbar als /addons#<id> (Versionen aus GET /api/v1/addons/<id>).
// „Herunterladen“ zeigt auf https://<API>/v1/addons/<id>/download – der Dienst leitet auf die neueste Datei um.
// Beschreibungen sind Klartext: Absätze durch Leerzeilen, Zeilen mit „- “ als Liste, nie HTML.
import { copyText, formatBytes, formatDate, h, icon, loadingState, toast } from './app-common.js';
import { ADDON_ID_RE, KATEGORIEN, addonIcon, authorText, formatCount, loadAddons, platformLimit, platformText } from './addon-common.js';
import { publicGet } from './public-cards.js';
import { detectSystem } from './system.js';

/** Höchste Heldix-API-Stufe, die HeldixClient derzeit lädt. */
const API_STUFE = 2;
const SYSTEM_NAMEN = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

const page = document.querySelector('.store-page');
const apiBase = page.dataset.apiBase;
const $ = (id) => document.getElementById(id);
const els = {
  tools: $('store-werkzeuge'),
  search: $('addon-suche'),
  categories: $('addon-kategorien'),
  sort: $('addon-sortierung'),
  result: $('addon-ergebnis'),
  unknown: $('addon-unbekannt'),
  grid: $('addon-liste'),
  noMatch: $('addon-keine-treffer'),
  empty: $('store-leer'),
  error: $('store-fehler'),
  dialog: $('addon-detail'),
  detail: $('addon-detail-inhalt'),
};
const state = { addons: [], category: 'alle', system: null, open: null, pushed: false, request: 0, loaded: false };
const baseTitle = document.title;
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const downloadUrl = (id) => `${apiBase}/v1/addons/${encodeURIComponent(id)}/download`;
const fileUrl = (id, file) => `${apiBase}/v1/addons/${encodeURIComponent(id)}/files/${encodeURIComponent(file)}`;

// ---------------------------------------------------------------------------------------------------------
// Klartext: Absätze und Listen, sonst nichts
// ---------------------------------------------------------------------------------------------------------

function plainText(source) {
  const out = [];
  for (const block of String(source ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let paragraph = null;
    let list = null;
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^- \S/.test(line)) {
        paragraph = null;
        if (!list) out.push((list = h('ul')));
        list.append(h('li', { text: line.slice(2).trim() }));
      } else {
        list = null;
        if (paragraph) paragraph.append(h('br'));
        else out.push((paragraph = h('p')));
        paragraph.append(document.createTextNode(line));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------------------------------------

const searchText = (addon) =>
  (addon.searchText ??= [addon.name, addon.id, addon.summary, addon.description, KATEGORIEN[addon.category], platformLimit(addon.platforms), ...addon.authors].filter(Boolean).join(' ').toLowerCase());

function sorted(list, mode) {
  const copy = [...list];
  if (mode === 'name') return copy.sort((a, b) => collator.compare(a.name, b.name));
  if (mode === 'neu') return copy.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || collator.compare(a.name, b.name));
  return copy.sort((a, b) => b.downloads - a.downloads || collator.compare(a.name, b.name));
}

function card(addon) {
  const limit = platformLimit(addon.platforms);
  return h(
    'article',
    { class: 'addon-card tile', dataset: { id: addon.id, kategorie: addon.category } },
    h(
      'div',
      { class: 'addon-card-head' },
      addonIcon(addon.icon),
      h(
        'div',
        { class: 'addon-card-title' },
        h('h3', null, h('a', { class: 'addon-open', href: `#${addon.id}`, dataset: { id: addon.id } }, addon.name)),
        h('p', { class: 'addon-card-meta', text: [`Version ${addon.version}`, authorText(addon.authors)].filter(Boolean).join(' · ') }),
      ),
    ),
    addon.summary ? h('p', { class: 'addon-summary', text: addon.summary }) : null,
    h(
      'div',
      { class: 'addon-card-foot' },
      h('span', { class: 'addon-chips' }, h('span', { class: 'chip accent', text: KATEGORIEN[addon.category] }), limit ? h('span', { class: 'chip warning', text: limit }) : null),
      h('span', { class: 'addon-downloads' }, icon('download'), formatCount(addon.downloads)),
    ),
  );
}

function renderCategories() {
  const counts = new Map();
  for (const addon of state.addons) counts.set(addon.category, (counts.get(addon.category) ?? 0) + 1);
  if (state.category !== 'alle' && !counts.has(state.category)) state.category = 'alle';
  const button = (id, label, count) =>
    h('button', { type: 'button', dataset: { kategorie: id }, 'aria-pressed': String(state.category === id) }, label, ' ', h('span', { class: 'count-soft', text: String(count) }));
  els.categories.replaceChildren(
    button('alle', 'Alle', state.addons.length),
    ...Object.keys(KATEGORIEN)
      .filter((id) => counts.has(id))
      .map((id) => button(id, KATEGORIEN[id], counts.get(id))),
  );
}

function apply() {
  const terms = els.search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const shown = sorted(state.addons, els.sort.value).filter((addon) => (state.category === 'alle' || addon.category === state.category) && terms.every((term) => searchText(addon).includes(term)));
  els.grid.replaceChildren(...shown.map(card));
  els.noMatch.hidden = shown.length > 0;
  const total = state.addons.length;
  els.result.textContent = terms.length || state.category !== 'alle' ? `${shown.length} von ${total} Addons` : total === 1 ? '1 Addon im Store' : `${total} Addons im Store`;
}

function showState(zustand) {
  page.dataset.zustand = zustand;
  const list = zustand === 'ok';
  els.tools.hidden = !list;
  els.grid.hidden = zustand === 'leer' || zustand === 'fehler';
  els.noMatch.hidden = true;
  els.empty.hidden = zustand !== 'leer';
  els.error.hidden = zustand !== 'fehler';
  if (!list) els.result.textContent = '';
}

async function load() {
  showState('laden');
  els.unknown.hidden = true;
  els.grid.setAttribute('aria-busy', 'true');
  els.grid.replaceChildren(loadingState('Addons werden geladen …'));
  try {
    state.addons = await loadAddons();
  } catch (error) {
    state.addons = [];
    $('store-fehler-text').textContent =
      error.status === 429 ? 'Gerade kommen zu viele Anfragen an. Warte kurz und versuch es dann noch einmal.' : 'Der Heldix-Dienst antwortet nicht. Installierte Addons laufen trotzdem weiter.';
    showState('fehler');
    return;
  } finally {
    els.grid.removeAttribute('aria-busy');
  }
  state.loaded = true;
  if (!state.addons.length) {
    showState('leer');
  } else {
    showState('ok');
    renderCategories();
    apply();
  }
  onHash();
}

// ---------------------------------------------------------------------------------------------------------
// Details (Dialog, /addons#<id>)
// ---------------------------------------------------------------------------------------------------------

function hashId() {
  const raw = location.hash.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function onHash() {
  const id = hashId();
  els.unknown.hidden = true;
  if (!id) {
    closeDetail();
    return;
  }
  const addon = state.addons.find((entry) => entry.id === id);
  if (addon) {
    openDetail(addon);
    return;
  }
  // Normale Sprungmarken (#installieren, #inhalt …) bleiben normale Sprungmarken.
  if (document.getElementById(id)) return;
  closeDetail();
  if (state.loaded && ADDON_ID_RE.test(id)) {
    els.unknown.textContent = `Das Addon „${id}“ gibt es im Store nicht (mehr).`;
    els.unknown.hidden = false;
  }
}

function fact(label, ...value) {
  return [h('dt', { text: label }), h('dd', null, ...value)];
}

function apiText(api) {
  if (api === null) return '–';
  if (api <= 1) return 'Stufe 1 – läuft mit jedem HeldixClient';
  if (api === 2) return 'Stufe 2 – ab HeldixClient 0.11.0';
  return `Stufe ${api} – braucht einen neueren HeldixClient`;
}

function hashBox(hash, label) {
  const copy = h('button', { type: 'button', class: 'icon-button small', 'aria-label': `SHA-256 von ${label} kopieren`, title: 'Prüfsumme kopieren' }, icon('copy'));
  copy.addEventListener('click', async () => {
    const ok = await copyText(hash);
    toast(ok ? 'Prüfsumme kopiert.' : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
  });
  return h('div', { class: 'addon-hash' }, h('code', { class: 'hash-full', 'data-sha256': hash, text: hash }), copy);
}

function installWays() {
  const ways = document.querySelector('#installieren .install-ways')?.cloneNode(true);
  if (!ways) return null;
  ways.classList.add('compact');
  for (const heading of ways.querySelectorAll('h3')) heading.replaceWith(h('h4', { text: heading.textContent }));
  return ways;
}

function detailView(addon) {
  const limit = platformLimit(addon.platforms);
  const notHere = limit && (state.system === 'windows' || state.system === 'mac') && !addon.platforms.includes(state.system);
  const date = addon.publishedAt ?? addon.date;
  const notes = addon.notes;
  return [
    h(
      'header',
      { class: 'addon-detail-head' },
      addonIcon(addon.icon, 'addon-icon big'),
      h(
        'div',
        { class: 'addon-detail-title' },
        h('span', { class: 'eyebrow', text: KATEGORIEN[addon.category] }),
        h('h2', { id: 'addon-detail-titel', text: addon.name }),
        h('p', { class: 'addon-detail-meta', text: [`Version ${addon.version}`, authorText(addon.authors), formatCount(addon.downloads)].filter(Boolean).join(' · ') }),
        limit ? h('div', { class: 'chips-row' }, h('span', { class: 'chip warning', text: limit })) : null,
      ),
    ),
    addon.summary ? h('p', { class: 'addon-detail-summary', text: addon.summary }) : null,
    h(
      'div',
      { class: 'addon-detail-actions' },
      h('a', { class: 'button', id: 'addon-download', href: downloadUrl(addon.id) }, icon('download'), 'Herunterladen (.jar)'),
      h('span', { class: 'addon-download-meta', text: [addon.size !== null ? formatBytes(addon.size) : null, `Version ${addon.version}`].filter(Boolean).join(' · ') }),
    ),
    notHere
      ? h('p', { class: 'addon-warning' }, icon('warning'), h('span', { text: `Dieses Addon läuft nur unter ${addon.platforms.map((system) => SYSTEM_NAMEN[system]).join(' und ')}. Unter ${SYSTEM_NAMEN[state.system]} funktioniert es nicht.` }))
      : null,
    addon.api !== null && addon.api > API_STUFE
      ? h('p', { class: 'addon-warning' }, icon('warning'), h('span', { text: `Braucht die Heldix-API-Stufe ${addon.api}. HeldixClient kann derzeit Stufe ${API_STUFE} – aktualisiere zuerst den Launcher.` }))
      : null,
    h(
      'div',
      { class: 'addon-detail-grid' },
      h(
        'div',
        { class: 'addon-detail-main' },
        addon.description ? h('div', { class: 'addon-block addon-text' }, plainText(addon.description)) : null,
        notes.length
          ? h('div', { class: 'addon-block' }, h('h3', { text: `Neu in Version ${addon.version}` }), h('ul', { class: 'release-notes' }, notes.map((note) => h('li', { text: note }))))
          : null,
        h('div', { class: 'addon-block' }, h('h3', { text: 'So installierst du es' }), installWays()),
      ),
      h(
        'aside',
        { class: 'addon-detail-side' },
        h(
          'dl',
          { class: 'facts-list addon-facts' },
          fact('Version', addon.version),
          fact('Veröffentlicht', date ? formatDate(date) : '–'),
          fact('Größe', addon.size !== null ? formatBytes(addon.size) : '–'),
          fact('Systeme', platformText(addon.platforms)),
          fact('Heldix-API', apiText(addon.api)),
          addon.authors.length ? fact(addon.authors.length === 1 ? 'Autor' : 'Autoren', addon.authors.join(', ')) : null,
          fact('Downloads', formatCount(addon.downloads).replace(/ Downloads?$/, '')),
          addon.file ? fact('Datei', h('code', { class: 'mono', text: addon.file })) : null,
        ),
        addon.sha256 ? h('div', { class: 'addon-block' }, h('h3', { text: 'SHA-256-Prüfsumme' }), hashBox(addon.sha256, addon.file || addon.name)) : null,
        h('div', { class: 'addon-block' }, h('h3', { text: 'Versionen' }), h('div', { 'data-versionen': '' }, loadingState('Versionen werden geladen …'))),
        h('p', { class: 'addon-help' }, 'Probleme mit dem Addon? Schreib dem Team über eine ', h('a', { href: '/konto#ziel=support', text: 'Support-Anfrage' }), '.'),
      ),
    ),
  ];
}

function normalizeVersion(entry) {
  if (!entry || typeof entry.version !== 'string' || !entry.version.trim()) return null;
  const notes = Array.isArray(entry.notes) ? entry.notes.filter((note) => typeof note === 'string' && note.trim()).slice(0, 20) : [];
  const date = typeof entry.date === 'string' && Number.isFinite(Date.parse(entry.date)) ? Date.parse(entry.date) : null;
  const publishedAt = typeof entry.publishedAt === 'number' && Number.isFinite(entry.publishedAt) ? entry.publishedAt : date;
  return {
    version: entry.version.trim().slice(0, 60),
    notes,
    size: typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : null,
    file: typeof entry.file === 'string' && /^heldix-addon-[A-Za-z0-9._-]+\.jar$/.test(entry.file) ? entry.file : null,
    publishedAt,
  };
}

function versionList(id, versions) {
  if (!versions.length) return h('p', { class: 'muted small', text: 'Keine Versionen gefunden.' });
  return h(
    'ol',
    { class: 'addon-versions' },
    versions.map((version, index) =>
      h(
        'li',
        null,
        h(
          'div',
          { class: 'addon-version-head' },
          h('strong', { text: version.version }),
          index === 0 ? h('span', { class: 'chip success', text: 'aktuell' }) : null,
          version.file ? h('a', { class: 'addon-version-file', href: fileUrl(id, version.file), 'aria-label': `Version ${version.version} herunterladen` }, icon('download'), 'JAR') : null,
        ),
        h('p', { class: 'addon-version-meta', text: [version.publishedAt ? formatDate(version.publishedAt) : null, version.size !== null ? formatBytes(version.size) : null].filter(Boolean).join(' · ') }),
        version.notes.length ? h('ul', { class: 'addon-version-notes' }, version.notes.map((note) => h('li', { text: note }))) : null,
      ),
    ),
  );
}

async function loadVersions(addon) {
  const request = ++state.request;
  const box = els.detail.querySelector('[data-versionen]');
  try {
    const data = await publicGet(`/v1/addons/${encodeURIComponent(addon.id)}`);
    if (request !== state.request || state.open !== addon.id) return;
    const versions = (Array.isArray(data?.versions) ? data.versions : []).map(normalizeVersion).filter(Boolean);
    box.replaceChildren(versionList(addon.id, versions));
    els.dialog.dataset.versionen = String(versions.length);
  } catch (error) {
    if (request !== state.request || state.open !== addon.id) return;
    box.replaceChildren(h('p', { class: 'muted small', text: error.status === 404 ? 'Dieses Addon gibt es nicht mehr im Store.' : 'Die Versionen lassen sich gerade nicht laden.' }));
    els.dialog.dataset.versionen = 'fehler';
  }
}

function openDetail(addon) {
  if (state.open === addon.id && els.dialog.open) return;
  state.open = addon.id;
  delete els.dialog.dataset.versionen;
  els.dialog.dataset.addon = addon.id;
  els.detail.replaceChildren(...detailView(addon).filter(Boolean));
  if (!els.dialog.open) els.dialog.showModal();
  els.dialog.scrollTop = 0;
  $('addon-detail-schliessen').focus();
  document.title = `${addon.name} – Addon-Store – HeldixClient`;
  loadVersions(addon);
}

function closeDetail() {
  if (els.dialog.open) els.dialog.close();
}

els.dialog.addEventListener('close', () => {
  const id = state.open;
  state.open = null;
  state.request++;
  document.title = baseTitle;
  if (id && hashId() === id) {
    // Über eine Karte geöffnet: zurück im Verlauf (dann führt „Zurück“ nicht wieder in den Dialog), sonst nur die
    // Adresse aufräumen.
    if (state.pushed) history.back();
    else history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
  state.pushed = false;
  els.grid.querySelector(`.addon-open[data-id="${CSS.escape(id ?? '')}"]`)?.focus({ preventScroll: true });
});
els.dialog.addEventListener('click', (event) => {
  if (event.target === els.dialog) closeDetail(); // Klick auf den abgedunkelten Hintergrund
});
$('addon-detail-schliessen').addEventListener('click', closeDetail);

// ---------------------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------------------

els.grid.addEventListener('click', (event) => {
  const link = event.target.closest('.addon-open');
  if (!link) return;
  const addon = state.addons.find((entry) => entry.id === link.dataset.id);
  if (!addon) return;
  if (hashId() === addon.id) {
    event.preventDefault();
    openDetail(addon);
  } else {
    state.pushed = true;
  }
});
els.categories.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-kategorie]');
  if (!button) return;
  state.category = button.dataset.kategorie;
  for (const other of els.categories.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
  apply();
});
els.search.addEventListener('input', apply);
els.sort.addEventListener('change', apply);
$('store-erneut').addEventListener('click', load);
window.addEventListener('hashchange', onHash);

detectSystem()
  .then((system) => {
    state.system = system.os;
  })
  .catch(() => {})
  .finally(load);
