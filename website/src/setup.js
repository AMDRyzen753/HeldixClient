// HeldixClient – Webseite: geteiltes Setup (/setup#<code>) – Heldix-Dienst ab 1.14.0.
//
// GET /api/v1/public/setups/<code> (öffentlich, ohne Anmeldung) → { code, name, description, creator: { name, uuid },
// content, hash, created, expires, views, installs }; 404 unbekannt, 410 abgelaufen oder widerrufen. content (v 1):
// { minecraft, loader: heldix | fabric | vanilla, heldixClient, mods, resourcepacks, shaderpacks: [{ project, version,
// title }], addons: [{ id, version | null, name }], settings: { graphics: {…} | null, keys: {…} | null } }.
// Die Seite zeigt nur, was installiert würde – nachgebaut wird im Launcher: „In HeldixClient öffnen“
// (heldixclient://setup/<code>) zeigt dort die Vorschau, „Als neue Instanz anlegen“ lädt alles von Modrinth bzw. aus dem
// Addon-Store und meldet installed. Dazu Code und Link zum Kopieren und „Melden“ (angemeldet:
// POST /v1/setups/<code>/report { reason, note }). Der Code steht nur hinter dem # (nicht in Server-Protokollen).
// Texte vom Dienst landen nur als Text im Dokument.
import { api, copyText, formatDate, h, icon, toast } from './app-common.js';
import { reportDialog } from './melden.js';
import { setupLoginLink } from './rueckweg.js';

const CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;
const UUID_RE = /^[0-9a-f]{32}$/;
const MODRINTH_RE = /^[A-Za-z0-9]{8}$/;
const ADDON_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const NUMBER = new Intl.NumberFormat('de-DE');
/** So viele Einträge je Liste stehen sofort da; der Rest hinter „Alle zeigen“. */
const SHOW_FIRST = 20;

const LOADERS = {
  heldix: { label: 'Heldix Loader', icon: 'loader-heldix' },
  fabric: { label: 'Fabric', icon: 'loader-fabric' },
  vanilla: { label: 'Vanilla', icon: 'loader-vanilla' },
};
const GROUPS = [
  { key: 'mods', title: 'Mods', icon: 'cube', source: 'modrinth', one: '1 Mod', many: (n) => `${n} Mods` },
  { key: 'resourcepacks', title: 'Ressourcenpakete', icon: 'image', source: 'modrinth', one: '1 Ressourcenpaket', many: (n) => `${n} Ressourcenpakete` },
  { key: 'shaderpacks', title: 'Shader', icon: 'shader', source: 'modrinth', one: '1 Shader', many: (n) => `${n} Shader` },
  { key: 'addons', title: 'Heldix-Addons', icon: 'addons', source: 'store', one: '1 Addon', many: (n) => `${n} Addons` },
];
/** Bekannte Grafik-Einstellungen (options.txt) mit Namen wie im Spiel; alles andere steht mit seinem Schlüssel da. */
const GRAPHICS = {
  renderDistance: ['Sichtweite', (v) => `${v} Chunks`],
  simulationDistance: ['Simulationsdistanz', (v) => `${v} Chunks`],
  graphicsMode: ['Grafikmodus', (v) => ({ 0: 'Schnell', 1: 'Schön', 2: 'Fabelhaft', fast: 'Schnell', fancy: 'Schön', fabulous: 'Fabelhaft' })[v] ?? String(v)],
  maxFps: ['Maximale Bildrate', (v) => (Number(v) >= 260 ? 'Unbegrenzt' : `${v} Bilder je Sekunde`)],
  enableVsync: ['VSync', null],
  entityShadows: ['Objektschatten', null],
  particles: ['Partikel', (v) => ({ 0: 'Alle', 1: 'Verringert', 2: 'Minimal', all: 'Alle', decreased: 'Verringert', minimal: 'Minimal' })[v] ?? String(v)],
  guiScale: ['GUI-Größe', (v) => (Number(v) === 0 ? 'Automatisch' : String(v))],
  fov: ['Sichtfeld', (v) => (typeof v === 'number' && v >= -1 && v <= 1 ? `${Math.round(70 + v * 40)}°` : `${v}°`)],
};
const KEY_NAMES = {
  'key.forward': 'Vorwärts',
  'key.back': 'Rückwärts',
  'key.left': 'Links',
  'key.right': 'Rechts',
  'key.jump': 'Springen',
  'key.sneak': 'Schleichen',
  'key.sprint': 'Sprinten',
  'key.inventory': 'Inventar',
  'key.drop': 'Gegenstand fallen lassen',
  'key.swapOffhand': 'Gegenstand mit Zweithand tauschen',
  'key.chat': 'Chat öffnen',
  'key.command': 'Befehl eingeben',
  'key.playerlist': 'Spielerliste',
  'key.screenshot': 'Screenshot',
  'key.togglePerspective': 'Perspektive wechseln',
  'key.attack': 'Angreifen/Abbauen',
  'key.use': 'Benutzen/Platzieren',
  'key.pickItem': 'Block auswählen',
  'key.fullscreen': 'Vollbild',
  'key.advancements': 'Fortschritte',
  'key.socialInteractions': 'Soziale Interaktionen',
};
const KEY_VALUES = {
  'key.keyboard.unknown': 'nicht belegt',
  'key.keyboard.space': 'Leertaste',
  'key.keyboard.tab': 'Tabulator',
  'key.keyboard.escape': 'Esc',
  'key.keyboard.enter': 'Eingabe',
  'key.keyboard.backspace': 'Rücktaste',
  'key.keyboard.caps.lock': 'Feststelltaste',
  'key.keyboard.left.shift': 'Linke Umschalttaste',
  'key.keyboard.right.shift': 'Rechte Umschalttaste',
  'key.keyboard.left.control': 'Linke Strg-Taste',
  'key.keyboard.right.control': 'Rechte Strg-Taste',
  'key.keyboard.left.alt': 'Linke Alt-Taste',
  'key.keyboard.right.alt': 'Alt Gr',
  'key.keyboard.up': 'Pfeil hoch',
  'key.keyboard.down': 'Pfeil runter',
  'key.keyboard.left': 'Pfeil links',
  'key.keyboard.right': 'Pfeil rechts',
  'key.mouse.left': 'Linke Maustaste',
  'key.mouse.right': 'Rechte Maustaste',
  'key.mouse.middle': 'Mittlere Maustaste',
};

const $ = (id) => document.getElementById(id);
const page = document.querySelector('.setup-page');
const state = { code: null, setup: null, me: undefined };

// ---------------------------------------------------------------------------------------------------------
// Ansichten
// ---------------------------------------------------------------------------------------------------------

function show(view) {
  page.dataset.zustand = view;
  page.setAttribute('aria-busy', String(view === 'laden'));
  $('setup-laden').hidden = view !== 'laden';
  $('setup-weg').hidden = view !== 'weg' && view !== 'fehler';
  $('setup').hidden = view !== 'setup';
}

function showGone(kind) {
  const texts = {
    'ohne-code': ['Hier fehlt der Setup-Code', 'Ein Setup-Link sieht so aus: heldixclient.com/setup#abc23def45. Prüf, ob der Link vollständig ist.', 'info'],
    unbekannt: ['Dieses Setup gibt es nicht', 'Prüf den Link – vielleicht hat er sich beim Kopieren verändert.', 'warning'],
    abgelaufen: ['Dieses Setup gilt nicht mehr', 'Der Link ist abgelaufen oder wurde zurückgezogen. Frag einfach nach einem neuen.', 'clock'],
    'abgelaufen-zeit': ['Dieses Setup ist abgelaufen', 'Der Link galt nur eine bestimmte Zeit. Frag einfach nach einem neuen.', 'clock'],
    zurueckgezogen: ['Dieses Setup wurde zurückgezogen', 'Wer es geteilt hat, hat den Link zurückgezogen – oder das Team. Frag einfach nach einem neuen.', 'close'],
    fehler: ['Das Setup lässt sich gerade nicht laden', 'Der Heldix-Dienst antwortet gerade nicht. Versuch es in ein paar Minuten noch einmal.', 'warning'],
    viele: ['Gerade kommen zu viele Anfragen', 'Warte eine Minute und versuch es dann noch einmal.', 'clock'],
  };
  const [title, text, symbol] = texts[kind] ?? texts.unbekannt;
  $('setup-weg-titel').textContent = title;
  $('setup-weg-text').textContent = text;
  $('setup-weg-symbol').replaceChildren(icon(symbol));
  $('setup-erneut').hidden = kind !== 'fehler' && kind !== 'viele';
  page.dataset.grund = kind;
  document.title = `${title} – HeldixClient`;
  show(kind === 'fehler' || kind === 'viele' ? 'fehler' : 'weg');
}

/** Code aus der Adresse (#<code> oder #code=<code>), sonst null. */
function readCode() {
  let raw = String(location.hash || '').replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // ungültige Kodierung: so lassen
  }
  const code = raw.trim().toLowerCase().replace(/^code=/, '');
  return CODE_RE.test(code) ? code : null;
}

// ---------------------------------------------------------------------------------------------------------
// Daten prüfen
// ---------------------------------------------------------------------------------------------------------

const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

function normalizeItems(list, kind) {
  if (!Array.isArray(list)) return [];
  const items = [];
  for (const entry of list.slice(0, 300)) {
    if (!entry || typeof entry !== 'object') continue;
    if (kind === 'store') {
      if (typeof entry.id !== 'string' || !ADDON_ID_RE.test(entry.id)) continue;
      items.push({ id: entry.id, version: typeof entry.version === 'string' && VERSION_RE.test(entry.version) ? entry.version : null, title: text(entry.name, 80) || entry.id });
    } else {
      if (typeof entry.project !== 'string' || !MODRINTH_RE.test(entry.project)) continue;
      items.push({ project: entry.project, version: typeof entry.version === 'string' && MODRINTH_RE.test(entry.version) ? entry.version : null, title: text(entry.title, 80) || entry.project });
    }
  }
  return items;
}

function normalizeSettings(settings) {
  const graphics = settings?.graphics && typeof settings.graphics === 'object' && !Array.isArray(settings.graphics) ? settings.graphics : null;
  const keys = settings?.keys && typeof settings.keys === 'object' && !Array.isArray(settings.keys) ? settings.keys : null;
  const graphicsList = graphics
    ? Object.entries(graphics)
        .filter(([key, value]) => /^[A-Za-z0-9_.:]{1,64}$/.test(key) && ['number', 'boolean', 'string'].includes(typeof value))
        .slice(0, 60)
        .map(([key, value]) => [key, typeof value === 'string' ? text(value, 64) : value])
    : null;
  const keyList = keys
    ? Object.entries(keys)
        .filter(([key, value]) => /^key\.[A-Za-z0-9_.]{1,80}$/.test(key) && typeof value === 'string' && /^key\.[a-z0-9_.]{1,40}$/.test(value))
        .slice(0, 200)
    : null;
  return { graphics: graphicsList, keys: keyList };
}

function normalizeSetup(data) {
  if (!data || typeof data !== 'object' || !data.content || typeof data.content !== 'object') return null;
  const content = data.content;
  return {
    code: state.code,
    name: text(data.name, 40) || 'Geteiltes Setup',
    description: text(data.description, 300),
    creator: { name: text(data.creator?.name, 16) || 'unbekannt', uuid: UUID_RE.test(data.creator?.uuid ?? '') ? data.creator.uuid : null },
    minecraft: typeof content.minecraft === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(content.minecraft) ? content.minecraft : null,
    loader: LOADERS[content.loader] ? content.loader : 'vanilla',
    heldixClient: content.heldixClient === true,
    mods: normalizeItems(content.mods, 'modrinth'),
    resourcepacks: normalizeItems(content.resourcepacks, 'modrinth'),
    shaderpacks: normalizeItems(content.shaderpacks, 'modrinth'),
    addons: normalizeItems(content.addons, 'store'),
    settings: normalizeSettings(content.settings),
    created: Number.isFinite(data.created) ? data.created : null,
    expires: Number.isFinite(data.expires) ? data.expires : null,
    views: Number.isFinite(data.views) ? data.views : null,
    installs: Number.isFinite(data.installs) ? data.installs : null,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Anzeigen
// ---------------------------------------------------------------------------------------------------------

function chip(content, kind = '') {
  return h('li', null, h('span', { class: `chip${kind ? ` ${kind}` : ''}` }, content));
}

function itemRow(item, group) {
  const store = group.source === 'store';
  const href = store ? `/addons#${item.id}` : `https://modrinth.com/project/${item.project}${item.version ? `/version/${item.version}` : ''}`;
  const version = store ? (item.version ? `Version ${item.version}` : 'Neueste Version') : null;
  return h(
    'li',
    { class: 'setup-item', dataset: { quelle: group.source } },
    h('span', { class: 'setup-item__icon', 'aria-hidden': 'true' }, icon(group.icon)),
    h(
      'span',
      { class: 'setup-item__main' },
      h('a', { class: 'setup-item__title', href, rel: store ? undefined : 'noopener', text: item.title }),
      h('span', { class: 'setup-item__meta', text: store ? `Addon-Store${version ? ` · ${version}` : ''}` : 'Modrinth' }),
    ),
    store ? null : h('span', { class: 'setup-item__go', 'aria-hidden': 'true' }, icon('external')),
  );
}

function groupBlock(group, items) {
  const list = h('ul', { class: 'setup-items', id: `setup-liste-${group.key}` }, items.slice(0, SHOW_FIRST).map((item) => itemRow(item, group)));
  const block = h('div', { class: 'setup-group', dataset: { gruppe: group.key } }, h('h3', { class: 'setup-group__title' }, icon(group.icon), h('span', { text: group.title }), h('span', { class: 'count count--muted', text: String(items.length) })), list);
  if (items.length > SHOW_FIRST) {
    const more = h('button', { type: 'button', class: 'btn btn--ghost btn--sm setup-more', 'aria-controls': list.id }, icon('chevron-down'), `Alle ${items.length} zeigen`);
    more.addEventListener('click', () => {
      list.replaceChildren(...items.map((item) => itemRow(item, group)));
      more.remove();
      list.querySelector(`li:nth-child(${SHOW_FIRST + 1}) a`)?.focus();
    });
    block.append(more);
  }
  return block;
}

function graphicsValue(key, value) {
  const known = GRAPHICS[key];
  if (typeof value === 'boolean') return value ? 'An' : 'Aus';
  if (value === 'true' || value === 'false') return value === 'true' ? 'An' : 'Aus';
  return known?.[1] ? known[1](value) : String(value);
}

function keyValue(value) {
  if (KEY_VALUES[value]) return KEY_VALUES[value];
  const mouse = /^key\.mouse\.(\d+)$/.exec(value);
  if (mouse) return `Maustaste ${mouse[1]}`;
  const keyboard = /^key\.keyboard\.(.+)$/.exec(value);
  if (!keyboard) return value;
  const rest = keyboard[1];
  if (/^[a-z0-9]$/.test(rest)) return rest.toUpperCase();
  if (/^f\d{1,2}$/.test(rest)) return rest.toUpperCase();
  if (/^keypad\.(.+)$/.test(rest)) return `Ziffernblock ${rest.slice(7)}`;
  return rest.replace(/\./g, ' ');
}

const keyName = (key) => KEY_NAMES[key] ?? (/^key\.hotbar\.(\d)$/.test(key) ? `Schnellzugriff ${key.slice(-1)}` : key.replace(/^key\./, ''));

function renderSettings(setup) {
  const { graphics, keys } = setup.settings;
  const parts = [];
  if (graphics?.length) {
    parts.push(
      h(
        'details',
        { class: 'setup-details', id: 'setup-grafik', open: graphics.length <= 12 ? true : undefined },
        h('summary', null, icon('monitor'), graphics.length === 1 ? 'Grafik: 1 Einstellung' : `Grafik: ${graphics.length} Einstellungen`),
        h('dl', { class: 'setup-dl' }, graphics.map(([key, value]) => h('div', null, h('dt', { text: GRAPHICS[key]?.[0] ?? key }), h('dd', { text: graphicsValue(key, value) })))),
      ),
    );
  }
  if (keys?.length) {
    parts.push(
      h(
        'details',
        { class: 'setup-details', id: 'setup-tasten' },
        h('summary', null, icon('keyboard'), keys.length === 1 ? 'Tasten: 1 Belegung' : `Tasten: ${keys.length} Belegungen`),
        h('dl', { class: 'setup-dl' }, keys.map(([key, value]) => h('div', null, h('dt', { text: keyName(key) }), h('dd', null, h('kbd', { text: keyValue(value) }))))),
      ),
    );
  }
  if (!parts.length) parts.push(h('p', { class: 'small text-2', id: 'setup-ohne-einstellungen', text: 'Mit diesem Setup werden keine Einstellungen geteilt – deine bleiben, wie sie sind.' }));
  $('setup-einstellungen').replaceChildren(...parts);
}

function render() {
  const setup = state.setup;
  document.title = `${setup.name} – Setup – HeldixClient`;
  $('setup-name').textContent = setup.name;
  $('setup-ersteller').textContent = setup.creator.name;
  const head = $('setup-kopf');
  head.alt = '';
  if (setup.creator.uuid) {
    head.addEventListener('error', () => head.setAttribute('src', '/assets/standard-kopf.svg'), { once: true });
    head.src = `/api/v1/public/heads/${setup.creator.uuid}.png?size=32`;
  }
  $('setup-beschreibung').textContent = setup.description;
  $('setup-beschreibung').hidden = !setup.description;
  const loader = LOADERS[setup.loader];
  $('setup-loader-symbol').replaceChildren(icon(loader.icon));
  $('setup-chips').replaceChildren(
    ...[
      setup.minecraft ? chip(['Minecraft ', h('strong', { text: setup.minecraft })], 'chip--accent') : null,
      chip([icon(loader.icon), loader.label]),
      setup.heldixClient ? chip([icon('loader-heldix'), 'mit HeldixClient'], 'chip--online') : null,
      setup.created ? chip([icon('clock'), `geteilt am ${formatDate(setup.created)}`]) : null,
      chip(setup.expires ? `gültig bis ${formatDate(setup.expires)}` : 'läuft nicht ab', setup.expires && setup.expires - Date.now() < 3 * 86_400_000 ? 'chip--reward' : ''),
    ].filter(Boolean),
  );
  $('setup-oeffnen').href = `heldixclient://setup/${setup.code}`;
  $('setup-code').textContent = setup.code;
  $('setup-aufrufe').textContent = setup.views === null ? '–' : NUMBER.format(setup.views);
  $('setup-installiert').textContent = setup.installs === null ? '–' : NUMBER.format(setup.installs);

  // Inhalte
  const blocks = GROUPS.filter((group) => setup[group.key].length).map((group) => groupBlock(group, setup[group.key]));
  const counts = GROUPS.filter((group) => setup[group.key].length).map((group) => (setup[group.key].length === 1 ? group.one : group.many(setup[group.key].length)));
  $('setup-inhalt-zahl').textContent = counts.length ? counts.join(' · ') : '';
  $('setup-inhalt').replaceChildren(
    ...(blocks.length
      ? blocks
      : [h('p', { class: 'small text-2', id: 'setup-leer', text: setup.loader === 'vanilla' ? 'Ein Setup ohne Mods und Addons: Minecraft, wie es ist – mit den Einstellungen unten.' : 'Dieses Setup bringt keine Mods oder Addons mit, nur den Loader und die Einstellungen unten.' })]),
  );
  renderSettings(setup);
  renderOwn();
}

/** Eigenes Setup: Hinweis aufs Konto statt „Melden“. */
function renderOwn() {
  const own = Boolean(state.me && state.setup?.creator.uuid && state.me.uuid === state.setup.creator.uuid);
  $('setup-eigenes').hidden = !own;
  $('setup-melden').hidden = own;
  page.dataset.eigenes = own ? 'ja' : 'nein';
}

function reportHint(textValue, withLogin = false) {
  const hint = $('setup-melden-hinweis');
  const parts = [textValue];
  if (withLogin) {
    const link = h('a', { href: '/konto', id: 'setup-anmelden', text: 'Jetzt anmelden' });
    setupLoginLink(link, `/setup#${state.code}`);
    parts.push(' ', link);
  }
  hint.replaceChildren(...parts);
  hint.hidden = !textValue;
}

// ---------------------------------------------------------------------------------------------------------
// Laden und Bedienung
// ---------------------------------------------------------------------------------------------------------

async function loadMe() {
  try {
    return await api('GET', '/v1/web/me');
  } catch {
    return null;
  }
}

/** GET /api/v1/public/setups/<code> ohne Anmeldung; Fehler mit .status und .code (SETUP_EXPIRED, SETUP_REVOKED …). */
async function loadSetup(code) {
  let response;
  try {
    response = await fetch(`/api/v1/public/setups/${code}`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
  } catch {
    throw Object.assign(new Error('nicht erreichbar'), { status: 0 });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status, code: typeof data?.code === 'string' ? data.code : null });
  return data;
}

async function start() {
  state.code = readCode();
  state.setup = null;
  reportHint('');
  if (!state.code) return showGone('ohne-code');
  show('laden');
  const mePromise = loadMe();
  let data;
  try {
    data = await loadSetup(state.code);
  } catch (error) {
    if (error.status === 404) return showGone('unbekannt');
    if (error.status === 410) return showGone(error.code === 'SETUP_REVOKED' ? 'zurueckgezogen' : error.code === 'SETUP_EXPIRED' ? 'abgelaufen-zeit' : 'abgelaufen');
    if (error.status === 429) return showGone('viele');
    return showGone('fehler');
  }
  const setup = normalizeSetup(data);
  if (!setup) return showGone('unbekannt');
  state.setup = setup;
  render();
  show('setup');
  state.me = await mePromise;
  renderOwn();
}

async function copy(value, okText) {
  const ok = await copyText(value);
  toast(ok ? okText : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
}

async function report() {
  if (!state.setup) return;
  if (state.me === undefined) state.me = await loadMe();
  if (!state.me) return reportHint('Zum Melden meldest du dich mit deinem Minecraft-Konto an – so kann das Team Missbrauch der Meldungen erkennen.', true);
  const result = await reportDialog({
    title: `„${state.setup.name}“ melden`,
    intro: 'Das Team sieht sich das Setup an und zieht es bei einem Verstoß zurück. Wer es geteilt hat, erfährt nicht, wer gemeldet hat.',
    send: (body) => api('POST', `/v1/setups/${state.code}/report`, body),
  });
  if (result === true) toast('Danke! Die Meldung ist beim Team.', 'success');
  else if (result === 'abgemeldet') {
    state.me = null;
    reportHint('Deine Anmeldung ist abgelaufen. Melde dich noch einmal an, um das Setup zu melden.', true);
  }
}

$('setup-code-kopieren').addEventListener('click', () => copy(state.code ?? '', 'Code kopiert – im Launcher einfügen.'));
$('setup-link-kopieren').addEventListener('click', () => copy(`${location.origin}/setup#${state.code ?? ''}`, 'Link kopiert.'));
$('setup-melden').addEventListener('click', report);
$('setup-erneut').addEventListener('click', start);
window.addEventListener('hashchange', () => {
  if (readCode() !== state.code) start();
});
start();
