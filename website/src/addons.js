// HeldixClient – Webseite: Addon-Store (/addons). Karten aus GET /api/v1/addons, Suche, Kategorie- und
// Herkunfts-Filter (Offiziell/Community) und Sortierung im Browser. Details als Dialog, verlinkbar als /addons#<id>
// (Versionsverlauf aus GET /api/v1/addons/<id>), mit Screenshots (Lightbox), Bewertungen und „Melden“.
// Entwicklerseite: /addons?autor=<uuid> (GET /api/v1/addon-authors/<uuid>).
// „Herunterladen“ zeigt auf https://<API>/v1/addons/<id>/download – der Dienst leitet auf die neueste Datei um.
// Beschreibungen sind Klartext: Absätze durch Leerzeilen, Zeilen mit „- “ als Liste, nie HTML.
// Bewerten und Melden gehen über die Cookie-Sitzung des Konto-Bereichs (angemeldet über Launcher oder Spiel).
import { api, busy, copyText, formatBytes, formatDate, h, icon, loadingState, openDialog, toast, uid } from './app-common.js';
import {
  ADDON_ID_RE,
  ADDON_REPORT_REASONS,
  API_STUFE,
  KATEGORIEN,
  UUID_RE,
  addonIcon,
  authorLink,
  authorText,
  formatCount,
  formatRating,
  loadAddons,
  loadAuthor,
  normalizeRating,
  originBadge,
  plainText,
  platformLimit,
  platformText,
  ratingCountText,
  ratingSummary,
  screenshotUrl,
  starRow,
} from './addon-common.js';
import { openLightbox } from './lightbox.js';
import { publicGet } from './public-cards.js';
import { detectSystem } from './system.js';

const SYSTEM_NAMEN = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
const MAX_REPORT_NOTE = 500;

const page = document.querySelector('.store-page');
const apiBase = page.dataset.apiBase;
const $ = (id) => document.getElementById(id);
const els = {
  tools: $('store-werkzeuge'),
  search: $('addon-suche'),
  categories: $('addon-kategorien'),
  origins: $('addon-herkunft'),
  sort: $('addon-sortierung'),
  result: $('addon-ergebnis'),
  unknown: $('addon-unbekannt'),
  grid: $('addon-liste'),
  noMatch: $('addon-keine-treffer'),
  empty: $('store-leer'),
  noAuthor: $('store-autor-fehlt'),
  error: $('store-fehler'),
  dialog: $('addon-detail'),
  detail: $('addon-detail-inhalt'),
};
const authorParam = new URLSearchParams(location.search).get('autor');
const state = {
  addons: [],
  category: 'alle',
  origin: 'alle',
  system: null,
  open: null,
  pushed: false,
  request: 0,
  loaded: false,
  /** undefined = wird geprüft, null = nicht angemeldet, sonst { uuid, name } */
  me: undefined,
  /** Entwicklerseite: { uuid, name } */
  author: authorParam !== null ? { uuid: String(authorParam).toLowerCase(), name: '' } : null,
  myRatings: new Map(), // id → 1–5 | null (in dieser Sitzung geladen)
};
const baseTitle = document.title;
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const downloadUrl = (id) => `${apiBase}/v1/addons/${encodeURIComponent(id)}/download`;
const fileUrl = (id, file) => `${apiBase}/v1/addons/${encodeURIComponent(id)}/files/${encodeURIComponent(file)}`;

// ---------------------------------------------------------------------------------------------------------
// Anmeldung (nur für Bewerten und Melden)
// ---------------------------------------------------------------------------------------------------------

async function checkLogin() {
  try {
    const me = await api('GET', '/v1/web/me');
    state.me = me && typeof me.uuid === 'string' ? { uuid: me.uuid, name: String(me.name ?? '') } : null;
  } catch {
    state.me = null;
  }
  page.dataset.angemeldet = state.me ? 'ja' : 'nein';
  if (state.open) {
    renderMine();
    loadMyRating(state.open);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------------------------------------

const searchText = (addon) =>
  (addon.searchText ??= [addon.name, addon.id, addon.summary, addon.description, KATEGORIEN[addon.category], platformLimit(addon.platforms), addon.official ? 'offiziell' : 'community', addon.author?.name, ...addon.authors]
    .filter(Boolean)
    .join(' ')
    .toLowerCase());

function sorted(list, mode) {
  const copy = [...list];
  if (mode === 'name') return copy.sort((a, b) => collator.compare(a.name, b.name));
  if (mode === 'neu') return copy.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || collator.compare(a.name, b.name));
  if (mode === 'bewertung') return copy.sort((a, b) => (b.rating.average ?? 0) - (a.rating.average ?? 0) || b.rating.count - a.rating.count || b.downloads - a.downloads || collator.compare(a.name, b.name));
  return copy.sort((a, b) => b.downloads - a.downloads || collator.compare(a.name, b.name));
}

function card(addon) {
  const limit = platformLimit(addon.platforms);
  return h(
    'article',
    { class: 'addon-card tile', dataset: { id: addon.id, kategorie: addon.category, herkunft: addon.official ? 'offiziell' : 'community' } },
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
    addon.author && !state.author ? h('p', { class: 'addon-card-dev' }, icon('user'), h('span', null, 'Entwickler: ', authorLink(addon.author))) : null,
    h(
      'div',
      { class: 'addon-card-foot' },
      h('span', { class: 'addon-chips' }, originBadge(addon), h('span', { class: 'chip accent', text: KATEGORIEN[addon.category] }), limit ? h('span', { class: 'chip warning', text: limit }) : null),
      h('span', { class: 'addon-card-stats' }, ratingSummary(addon.rating), h('span', { class: 'addon-downloads' }, icon('download'), formatCount(addon.downloads))),
    ),
  );
}

function filterButton(group, id, label, count, current) {
  return h('button', { type: 'button', dataset: { [group]: id }, 'aria-pressed': String(current === id) }, label, ' ', h('span', { class: 'count-soft', text: String(count) }));
}

function renderCategories() {
  const counts = new Map();
  for (const addon of state.addons) counts.set(addon.category, (counts.get(addon.category) ?? 0) + 1);
  if (state.category !== 'alle' && !counts.has(state.category)) state.category = 'alle';
  els.categories.replaceChildren(
    filterButton('kategorie', 'alle', 'Alle', state.addons.length, state.category),
    ...Object.keys(KATEGORIEN)
      .filter((id) => counts.has(id))
      .map((id) => filterButton('kategorie', id, KATEGORIEN[id], counts.get(id), state.category)),
  );
  // Offiziell/Community nur, wenn es beides gibt (auf der Entwicklerseite ist alles Community)
  const official = state.addons.filter((addon) => addon.official).length;
  const community = state.addons.length - official;
  els.origins.hidden = !official || !community || Boolean(state.author);
  if (els.origins.hidden) state.origin = 'alle';
  els.origins.replaceChildren(
    filterButton('herkunft', 'alle', 'Alle', state.addons.length, state.origin),
    filterButton('herkunft', 'offiziell', 'Offiziell', official, state.origin),
    filterButton('herkunft', 'community', 'Community', community, state.origin),
  );
}

function matchesOrigin(addon) {
  return state.origin === 'alle' || (state.origin === 'offiziell') === addon.official;
}

function apply() {
  const terms = els.search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const shown = sorted(state.addons, els.sort.value).filter((addon) => (state.category === 'alle' || addon.category === state.category) && matchesOrigin(addon) && terms.every((term) => searchText(addon).includes(term)));
  els.grid.replaceChildren(...shown.map(card));
  els.noMatch.hidden = shown.length > 0;
  const total = state.addons.length;
  const filtered = terms.length || state.category !== 'alle' || state.origin !== 'alle';
  if (state.author) els.result.textContent = filtered ? `${shown.length} von ${total} Addons von ${state.author.name}` : `${total === 1 ? '1 Addon' : `${total} Addons`} von ${state.author.name}`;
  else els.result.textContent = filtered ? `${shown.length} von ${total} Addons` : total === 1 ? '1 Addon im Store' : `${total} Addons im Store`;
}

function showState(zustand) {
  page.dataset.zustand = zustand;
  const list = zustand === 'ok';
  els.tools.hidden = !list;
  els.grid.hidden = zustand === 'leer' || zustand === 'fehler' || zustand === 'autor-fehlt';
  els.noMatch.hidden = true;
  els.empty.hidden = zustand !== 'leer';
  els.noAuthor.hidden = zustand !== 'autor-fehlt';
  els.error.hidden = zustand !== 'fehler';
  if (!list) els.result.textContent = '';
}

/** Kopf der Entwicklerseite: „Addons von <Name>“. */
function renderAuthorHead() {
  if (!state.author) return;
  $('store-zurueck').hidden = false;
  $('store-eyebrow').textContent = 'Entwickler';
  const name = state.author.name || 'diesem Entwickler';
  $('store-titel').replaceChildren('Addons von ', h('span', { class: 'gradient', text: name }));
  $('store-lead').textContent = state.author.name
    ? `Alle Community-Addons von ${state.author.name} im Store. Auch sie hat das Team geprüft und signiert.`
    : 'Hier stehen alle Community-Addons eines Entwicklers.';
  document.title = state.author.name ? `Addons von ${state.author.name} – Addon-Store – HeldixClient` : baseTitle;
}

async function load() {
  showState('laden');
  els.unknown.hidden = true;
  els.grid.setAttribute('aria-busy', 'true');
  els.grid.replaceChildren(loadingState('Addons werden geladen …'));
  try {
    if (state.author) {
      if (!UUID_RE.test(state.author.uuid)) throw Object.assign(new Error('ungültig'), { status: 404 });
      const data = await loadAuthor(state.author.uuid);
      state.author = data.author;
      state.addons = data.addons;
      renderAuthorHead();
    } else {
      state.addons = await loadAddons();
    }
  } catch (error) {
    state.addons = [];
    if (state.author && error.status === 404) {
      renderAuthorHead();
      showState('autor-fehlt');
      return;
    }
    $('store-fehler-text').textContent =
      error.status === 429 ? 'Gerade kommen zu viele Anfragen an. Warte kurz und versuch es dann noch einmal.' : 'Der Heldix-Dienst antwortet nicht. Installierte Addons laufen trotzdem weiter.';
    showState('fehler');
    return;
  } finally {
    els.grid.removeAttribute('aria-busy');
  }
  state.loaded = true;
  if (!state.addons.length) {
    showState(state.author ? 'autor-fehlt' : 'leer');
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
    els.unknown.textContent = state.author ? `Das Addon „${id}“ steht nicht (mehr) auf dieser Entwicklerseite.` : `Das Addon „${id}“ gibt es im Store nicht (mehr).`;
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
  if (api === 3) return 'Stufe 3 – ab HeldixClient 0.13.1';
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

/** Galerie im Detail: Vorschaubilder, ein Klick öffnet die Lightbox. */
function gallery(addon) {
  if (!addon.screenshots) return null;
  const images = Array.from({ length: addon.screenshots }, (_, index) => ({ src: screenshotUrl(addon.id, index + 1, addon.screenshotsVersion), alt: `${addon.name} – Screenshot ${index + 1}` }));
  return h(
    'div',
    { class: 'addon-block addon-gallery' },
    h('h3', { text: 'Screenshots' }),
    h(
      'div',
      { class: `shot-grid count-${images.length}` },
      images.map((image, index) =>
        h(
          'button',
          { type: 'button', class: 'shot-thumb', 'aria-label': `${image.alt} groß ansehen`, onClick: () => openLightbox(images, index, { label: `Screenshots von ${addon.name}` }) },
          h('img', { src: image.src, alt: '', loading: 'lazy', decoding: 'async', width: '320', height: '180' }),
        ),
      ),
    ),
  );
}

/** Bewertungen: Durchschnitt und (angemeldet) die eigene Bewertung. */
function ratingBlock(addon) {
  return h(
    'div',
    { class: 'addon-block addon-rating-block', id: 'addon-bewertung' },
    h('h3', { text: 'Bewertungen' }),
    h('div', { class: 'rating-big', 'data-durchschnitt': '' }),
    h('div', { class: 'my-rating', 'data-meine': '' }),
  );
}

function renderAverage(addon) {
  const box = els.detail.querySelector('[data-durchschnitt]');
  if (!box) return;
  const { rating } = addon;
  box.replaceChildren(
    rating.average === null
      ? h('p', { class: 'muted small', text: 'Noch keine Bewertungen – sei die oder der Erste.' })
      : h('div', { class: 'rating-big-row' }, h('span', { class: 'rating-number', text: formatRating(rating.average) }), h('span', { class: 'rating-stack' }, starRow(rating.average, 'big'), h('span', { class: 'rating-count', text: ratingCountText(rating.count) }))),
  );
  const head = els.detail.querySelector('.addon-detail-rating');
  if (head) head.replaceChildren(ratingSummary(rating, { long: true }));
}

function loginHint(what) {
  return h(
    'p',
    { class: 'addon-login-hint' },
    icon('lock'),
    h('span', null, `${what} geht, wenn du angemeldet bist – ohne Passwort über den Launcher oder im Spiel. `, h('a', { href: '/konto', text: 'So meldest du dich an' }), '.'),
  );
}

/** Eigene Bewertung (Sterne als Knöpfe), Hinweis zum Anmelden oder „eigenes Addon“. */
function renderMine() {
  const box = els.detail.querySelector('[data-meine]');
  const addon = state.addons.find((entry) => entry.id === state.open);
  if (!box || !addon) return;
  const report = els.detail.querySelector('[data-melden]');
  if (state.me === undefined) {
    box.replaceChildren(loadingState('Anmeldung wird geprüft …'));
    if (report) report.replaceChildren();
    return;
  }
  if (!state.me) {
    box.replaceChildren(loginHint('Bewerten und Melden'));
    if (report) report.replaceChildren();
    return;
  }
  if (report) report.replaceChildren(h('button', { type: 'button', class: 'button tiny ghost', id: 'addon-melden', onClick: () => reportAddon(addon) }, icon('flag'), 'Addon melden'));
  if (addon.author && addon.author.uuid === state.me.uuid) {
    box.replaceChildren(h('p', { class: 'muted small', text: 'Das ist dein Addon – eigene Addons kannst du nicht bewerten.' }));
    return;
  }
  if (!state.myRatings.has(addon.id)) {
    box.replaceChildren(loadingState('Deine Bewertung wird geladen …'));
    return;
  }
  const mine = state.myRatings.get(addon.id);
  const buttons = [1, 2, 3, 4, 5].map((stars) =>
    h(
      'button',
      {
        type: 'button',
        class: `star-button${mine && stars <= mine ? ' on' : ''}`,
        'aria-label': stars === 1 ? '1 Stern' : `${stars} Sterne`,
        'aria-pressed': String(mine === stars),
        dataset: { stars: String(stars) },
        onClick: (event) => rate(addon, stars, event.currentTarget),
      },
      icon('star'),
    ),
  );
  box.replaceChildren(
    ...[
      h('p', { class: 'my-rating-label', id: 'meine-bewertung-text', text: mine ? `Deine Bewertung: ${mine === 1 ? '1 Stern' : `${mine} Sterne`}` : 'Wie gefällt dir das Addon?' }),
      h('div', { class: 'star-input', role: 'group', 'aria-labelledby': 'meine-bewertung-text' }, buttons),
      mine ? h('button', { type: 'button', class: 'link-button small-link', id: 'bewertung-entfernen', onClick: (event) => unrate(addon, event.currentTarget) }, 'Bewertung entfernen') : null,
    ].filter(Boolean),
  );
}

function applyRating(addon, data) {
  if (!data || typeof data !== 'object') return;
  if ('myRating' in data) state.myRatings.set(addon.id, Number.isInteger(data.myRating) && data.myRating >= 1 && data.myRating <= 5 ? data.myRating : null);
  if ('count' in data) {
    addon.rating = normalizeRating(data);
    const cardRating = els.grid.querySelector(`.addon-card[data-id="${CSS.escape(addon.id)}"] .addon-rating`);
    if (cardRating) cardRating.replaceWith(ratingSummary(addon.rating));
  }
  if (state.open === addon.id) {
    renderAverage(addon);
    renderMine();
  }
}

async function loadMyRating(id) {
  const addon = state.addons.find((entry) => entry.id === id);
  if (!addon || !state.me || (addon.author && addon.author.uuid === state.me.uuid) || state.myRatings.has(id)) return;
  try {
    const data = await api('GET', `/v1/addons/${encodeURIComponent(id)}/rating`);
    applyRating(addon, data);
  } catch (error) {
    if (error.status === 401) {
      state.me = null;
      renderMine();
      return;
    }
    if (state.open === id) els.detail.querySelector('[data-meine]')?.replaceChildren(h('p', { class: 'muted small', text: 'Deine Bewertung lässt sich gerade nicht laden.' }));
  }
}

async function rate(addon, stars, button) {
  if (state.myRatings.get(addon.id) === stars) return;
  const group = [...(button.parentElement?.querySelectorAll('button') ?? [])];
  try {
    const data = await busy(group, () => api('PUT', `/v1/addons/${encodeURIComponent(addon.id)}/rating`, { stars }));
    applyRating(addon, { myRating: stars, ...data });
    toast(`Danke! Du hast ${addon.name} mit ${stars === 1 ? '1 Stern' : `${stars} Sternen`} bewertet.`, 'success');
    els.detail.querySelector(`.star-button[data-stars="${stars}"]`)?.focus();
  } catch (error) {
    if (error.status === 401) {
      state.me = null;
      renderMine();
    }
    toast(error.message, 'error');
  }
}

async function unrate(addon, button) {
  try {
    const data = await busy(button, () => api('DELETE', `/v1/addons/${encodeURIComponent(addon.id)}/rating`));
    applyRating(addon, { myRating: null, ...data });
    toast('Deine Bewertung ist entfernt.');
    els.detail.querySelector('.star-button')?.focus();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/** Melden: Grund + Hinweis (bis 500 Zeichen). */
async function reportAddon(addon) {
  const group = uid('grund');
  const noteId = uid('hinweis');
  const counter = h('span', { class: 'counter', text: `0/${MAX_REPORT_NOTE}` });
  const note = h('textarea', { class: 'input textarea small-textarea', id: noteId, maxlength: String(MAX_REPORT_NOTE), rows: '3', placeholder: 'Was ist dir aufgefallen?' });
  note.addEventListener('input', () => {
    counter.textContent = `${[...note.value].length}/${MAX_REPORT_NOTE}`;
  });
  const reasons = h(
    'fieldset',
    { class: 'choices single' },
    h('legend', { text: 'Grund' }),
    ADDON_REPORT_REASONS.map(([id, label]) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: group, value: id }), h('span', { text: label }))),
  );
  const ok = await openDialog({
    title: `${addon.name} melden`,
    body: [
      h('p', { text: 'Funktioniert das Addon nicht, enthält es fremde Inhalte oder verhält es sich verdächtig? Dann sag dem Team Bescheid.' }),
      reasons,
      h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { for: noteId, text: 'Hinweis (freiwillig)' }), counter), note),
      h('p', { class: 'info-box small' }, icon('info'), h('span', { text: 'Das Team sieht die Meldung mit deinem Spielernamen. Der Entwickler des Addons erfährt nicht, wer gemeldet hat. Meldungen werden nach 90 Tagen gelöscht.' })),
    ],
    confirmLabel: 'Meldung senden',
    canConfirm: () => Boolean(reasons.querySelector('input:checked')),
    focus: 'input[type="radio"]',
    onConfirm: async () => {
      const text = note.value.replace(/\r\n?/g, '\n').trim();
      await api('POST', `/v1/addons/${encodeURIComponent(addon.id)}/reports`, { reason: reasons.querySelector('input:checked').value, ...(text ? { note: text } : {}) });
    },
  });
  if (ok) toast(`Danke! Das Team sieht sich ${addon.name} an.`, 'success');
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
        h('p', { class: 'addon-detail-rating' }),
        h('div', { class: 'chips-row' }, originBadge(addon), limit ? h('span', { class: 'chip warning', text: limit }) : null),
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
        gallery(addon),
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
          fact('Herkunft', addon.official ? 'Offiziell – vom HeldixClient-Team' : 'Community – geprüft und signiert vom Team'),
          addon.author ? fact('Entwickler', authorLink(addon.author)) : null,
          addon.authors.length ? fact(addon.authors.length === 1 ? 'Autor' : 'Autoren', addon.authors.join(', ')) : null,
          fact('Downloads', formatCount(addon.downloads).replace(/ Downloads?$/, '')),
          addon.file ? fact('Datei', h('code', { class: 'mono', text: addon.file })) : null,
        ),
        ratingBlock(addon),
        addon.sha256 ? h('div', { class: 'addon-block' }, h('h3', { text: 'SHA-256-Prüfsumme' }), hashBox(addon.sha256, addon.file || addon.name)) : null,
        h('div', { class: 'addon-block' }, h('h3', { text: 'Versionsverlauf' }), h('div', { 'data-versionen': '' }, loadingState('Versionen werden geladen …'))),
        h('div', { class: 'addon-report-row', 'data-melden': '' }),
        h('p', { class: 'addon-help' }, 'Fragen zum Addon? Schreib dem Team über eine ', h('a', { href: '/konto#ziel=support', text: 'Support-Anfrage' }), '.'),
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
  renderAverage(addon);
  renderMine();
  if (!els.dialog.open) els.dialog.showModal();
  els.dialog.scrollTop = 0;
  $('addon-detail-schliessen').focus();
  document.title = `${addon.name} – Addon-Store – HeldixClient`;
  loadVersions(addon);
  loadMyRating(addon.id);
}

function closeDetail() {
  if (els.dialog.open) els.dialog.close();
}

els.dialog.addEventListener('close', () => {
  const id = state.open;
  state.open = null;
  state.request++;
  document.title = state.author?.name ? `Addons von ${state.author.name} – Addon-Store – HeldixClient` : baseTitle;
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
els.origins.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-herkunft]');
  if (!button) return;
  state.origin = button.dataset.herkunft;
  for (const other of els.origins.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
  apply();
});
els.search.addEventListener('input', apply);
els.sort.addEventListener('change', apply);
$('store-erneut').addEventListener('click', load);
window.addEventListener('hashchange', onHash);

checkLogin();
detectSystem()
  .then((system) => {
    state.system = system.os;
  })
  .catch(() => {})
  .finally(load);
