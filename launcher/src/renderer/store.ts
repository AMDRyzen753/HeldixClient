// Addon-Store als eigene Seite (#view-store, Inhalt in #store-root). Daten: api.getStoreOverview(), api.installStoreAddon(),
// api.uninstallStoreAddon(), api.updateAllAddons(), Details über getAddonDetails/getAddonScreenshot, rateAddon, reportAddon.
// Abzeichen #store-badge = Zahl der Addons mit Update in irgendeiner Instanz.
//
// Karten mit Suche, Herkunft (Offiziell/Community), Kategorien, Autor-Filter und Sortierung. Ein Klick öffnet die Details als
// Leiste rechts (Esc, ✕ oder Klick daneben schließt sie): Bewertung, eine Zeile je Heldix-Instanz (Installieren,
// Aktualisieren, Entfernen), Screenshots mit Großansicht, Versionsverlauf, Melden. Texte aus dem Store sind Klartext
// (Absätze und „- “-Listen) und landen nur über textContent im DOM, nie als HTML.
// Eigene Klassen heißen store-…; store-message und link-button stehen in instances.css (Instanz-Reiter „Mods & Addons“).
import type { AddonReportReason, AddonRating, GameState, StoreListing, StoreOverview } from '../shared/api';
import { $, api, confirmDialog, errorMessage, formatCount, formatDate, h, instanceTile, on, reloadInstances, state, toast, uiIcon } from './core.js';
import { UI_ICONS } from './ui-icons.js';

type Category = StoreListing['category'];
type Platform = StoreListing['platforms'][number];
type InstallState = StoreListing['installs'][number]['state'];
type StoreInstance = StoreOverview['instances'][number];
type SortMode = 'beliebt' | 'bewertung' | 'neu' | 'name';
type Origin = 'alle' | 'offiziell' | 'community';
type Action = 'install' | 'update' | 'remove';

const CATEGORY_LABELS: Record<Category, string> = { hud: 'HUD', musik: 'Musik & Medien', chat: 'Chat & Freunde', werkzeuge: 'Werkzeuge', sonstiges: 'Sonstiges' };
const CATEGORY_ORDER: Category[] = ['hud', 'musik', 'chat', 'werkzeuge', 'sonstiges'];
const PLATFORM_LABELS: Record<Platform, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
const SORT_LABELS: Record<SortMode, string> = { beliebt: 'Beliebt', bewertung: 'Bewertung', neu: 'Neu', name: 'Name' };
const ORIGIN_LABELS: Record<Origin, string> = { alle: 'Alle', offiziell: 'Offiziell', community: 'Community' };
const BUSY_LABELS: Record<Action, string> = { install: 'Wird installiert …', update: 'Wird aktualisiert …', remove: 'Wird entfernt …' };
const REPORT_REASONS: [AddonReportReason, string][] = [
  ['malware', 'Schadcode oder gefährlich'],
  ['broken', 'Funktioniert nicht'],
  ['inappropriate', 'Unangemessen'],
  ['copyright', 'Urheberrecht verletzt'],
  ['other', 'Anderes'],
];
const TEAM = 'HeldixClient-Team';
const MAX_SCREENSHOTS = 4;
const FLASH_MS = 1800;
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

const view = {
  overview: null as StoreOverview | null,
  /** Meldung der letzten Abfrage (Ausnahme oder overview.error); bei alten Daten bleibt die Liste stehen */
  failure: null as string | null,
  loading: false,
  query: '',
  category: 'alle' as Category | 'alle',
  origin: 'alle' as Origin,
  /** „Alle Addons von …“: Schlüssel ist die UUID des Einreichers bzw. "team" für offizielle Addons */
  author: null as { key: string; name: string } | null,
  sort: 'beliebt' as SortMode,
  /** Addon in der Detail-Leiste */
  open: null as string | null,
  /** openStoreAddon(), bevor die Daten da sind */
  pendingOpen: null as string | null,
  /** laufende Aktionen je "instanceId/addonId" */
  busy: new Map<string, Action>(),
  /** „Alle aktualisieren“ läuft (Namen der Addons) */
  bulk: null as string[] | null,
  /** Bewertung wird gerade gespeichert (Addon-ID) */
  rating: null as string | null,
  /** Versionsverlauf in der Detail-Leiste aufgeklappt */
  historyOpen: false,
  /** Großansicht der Screenshots */
  lightbox: null as { id: string; index: number } | null,
  /** letzter Spielzustand aus onGameState (sonst state.game) */
  game: null as GameState | null,
  /** Zahl fürs Abzeichen: zuletzt aus onStoreChanged (Hintergrundprüfung) oder aus der eigenen Übersicht */
  updates: 0,
  /** nach Klick auf die Update-Benachrichtigung: Addons mit Update oben, bis Filter/Sortierung geändert werden */
  updatesFirst: false,
  /** Update-Hinweis bis zu diesem Zeitpunkt hervorheben (ms) */
  flashUntil: 0,
};
/** Zeitpunkt der letzten erfolgreichen eigenen Abfrage */
let lastLoad = 0;

/** Fehler beim Bewerten je Addon (als Hinweis unter den Sternen) */
const rateErrors = new Map<string, string>();
/** Screenshots je "id@version/n": data:-URL, null = nicht ladbar */
const shotUrls = new Map<string, string | null>();
const shotLoads = new Map<string, Promise<void>>();
/** Versionsverlauf je "id@version" */
type History = { state: 'loading' } | { state: 'ok'; versions: { version: string; date: string; notes: string[] }[] } | { state: 'error'; message: string };
const histories = new Map<string, History>();

// ---------------------------------------------------------------------------------------------------------
// Gerüst
// ---------------------------------------------------------------------------------------------------------

type Elements = ReturnType<typeof build>;
let ui: Elements | null = null;

function toggleGroup<T extends string>(cls: string, label: string, labels: Record<T, string>, onPick: (value: T) => void): HTMLElement {
  const group = h('div', { class: `chip-toggle ${cls}`, role: 'group', 'aria-label': label });
  for (const value of Object.keys(labels) as T[]) {
    const button = h('button', { type: 'button', 'data-value': value, text: labels[value] });
    button.addEventListener('click', () => onPick(value));
    group.append(button);
  }
  return group;
}

function build() {
  const root = $('#store-root');
  root.classList.add('store-page');

  const site = h('button', { class: 'ghost store-site', type: 'button', title: 'Alle Addons mit Beschreibung auf heldixclient.com' },
    uiIcon('external', 'btn-icon'), 'Auf heldixclient.com ansehen');
  site.addEventListener('click', () => openSite());
  const head = h('div', { class: 'page-head row store-head' },
    h('div', { class: 'store-head-text' },
      h('h2', { class: 'page-title', text: 'Addon-Store' }),
      h('p', { class: 'page-sub', text: 'Geprüft und signiert vom HeldixClient-Team. Änderungen gelten ab dem nächsten Spielstart.' })),
    site);

  const search = h('input', { type: 'text', placeholder: 'Addons durchsuchen …', spellcheck: 'false', 'aria-label': 'Addons durchsuchen' });
  search.addEventListener('input', () => {
    view.query = search.value;
    refilter();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value) {
      search.value = '';
      view.query = '';
      refilter();
    }
  });
  const origin = toggleGroup<Origin>('store-origins', 'Herkunft', ORIGIN_LABELS, (value) => {
    view.origin = value;
    refilter();
  });
  const sort = toggleGroup<SortMode>('store-sort', 'Sortierung', SORT_LABELS, (value) => {
    view.sort = value;
    refilter();
  });
  const cats = h('div', { class: 'chip-toggle store-cats', role: 'group', 'aria-label': 'Kategorie' });
  const authorChip = h('div', { class: 'store-author-chip' });
  const count = h('span', { class: 'store-count' });
  const toolbar = h('div', { class: 'store-toolbar' },
    h('div', { class: 'store-toolbar-row' }, h('label', { class: 'search-field store-search' }, uiIcon('search'), search), origin, sort),
    h('div', { class: 'store-toolbar-row wrap' }, cats, authorChip, count));

  const notices = h('div', { class: 'store-notices' });
  const body = h('div', { class: 'store-body' });
  root.replaceChildren(head, notices, toolbar, body);

  // Detail-Leiste neben der Seite (die Seite selbst scrollt, die Leiste bleibt stehen)
  const scrim = h('div', { class: 'store-scrim' });
  scrim.addEventListener('click', () => closeDrawer());
  const drawer = h('aside', { class: 'store-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Addon-Details' });
  (root.parentElement ?? document.body).append(scrim, drawer);

  return { root, notices, toolbar, search, origin, sort, cats, authorChip, count, body, scrim, drawer };
}

function els(): Elements {
  return (ui ??= build());
}

function openSite(): void {
  api.openWebsite('addons').catch((error) => toast(errorMessage(error), 'error'));
}

// ---------------------------------------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------------------------------------

let running: Promise<void> | null = null;
let rerun = false;
let refreshTimer = 0;
/** reloadInstances() aus dieser Seite: das Ereignis 'instances' löst dann kein weiteres Laden aus */
let selfReload = false;

/** Lädt die Übersicht; Aufrufe während einer laufenden Abfrage werden zu einer weiteren zusammengefasst. */
function refresh(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await loadOnce();
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
}

function scheduleRefresh(delay = 300): void {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void refresh(), delay);
}

async function loadOnce(): Promise<void> {
  view.loading = true;
  if (!view.overview) render();
  try {
    const result = await api.getStoreOverview();
    if (result.error && view.overview?.addons.length) {
      // Store gerade nicht erreichbar: die letzte Liste bleibt stehen, oben steht ein Hinweis
      view.failure = result.error;
    } else {
      view.overview = result;
      view.failure = result.error;
      if (!result.error) {
        view.updates = updateCount();
        lastLoad = Date.now();
      }
    }
  } catch (error) {
    view.failure = errorMessage(error);
  } finally {
    view.loading = false;
  }
  const addons = view.overview?.addons ?? [];
  if (view.category !== 'alle' && !addons.some((a) => a.category === view.category)) view.category = 'alle';
  if (view.author && !addons.some((a) => authorOf(a)?.key === view.author?.key)) view.author = null;
  render();
  const wanted = view.pendingOpen;
  if (wanted && view.overview) {
    view.pendingOpen = null;
    if (findAddon(wanted)) openDrawer(wanted);
    else if (!view.failure) toast('Dieses Addon gibt es im Addon-Store nicht (mehr).', 'error');
  }
}

/** Nach einer Änderung: Store und Instanzen (Addon-Zahl auf den Karten) neu laden */
async function afterChange(): Promise<void> {
  await refresh();
  selfReload = true;
  try {
    await reloadInstances();
  } catch {
    // die Instanzen lädt die Seite beim nächsten Mal; der Store selbst ist schon aktuell
  } finally {
    selfReload = false;
  }
}

// ---------------------------------------------------------------------------------------------------------
// Daten-Helfer
// ---------------------------------------------------------------------------------------------------------

function findAddon(id: string): StoreListing | undefined {
  return view.overview?.addons.find((a) => a.id === id);
}

function instances(): StoreInstance[] {
  return view.overview?.instances ?? [];
}

function installIn(addon: StoreListing, instanceId: string): StoreListing['installs'][number] | undefined {
  return addon.installs.find((entry) => entry.instanceId === instanceId);
}

function stateIn(addon: StoreListing, instanceId: string): InstallState {
  return installIn(addon, instanceId)?.state ?? (addon.problem ? 'unsupported-platform' : 'available');
}

const isInstalled = (s: InstallState) => s === 'installed' || s === 'update';
const isUnsupported = (s: InstallState) => s.startsWith('unsupported-');

/** Warum es in dieser Instanz nicht läuft (Minecraft-Version, Loader, System oder API) */
function reasonIn(addon: StoreListing, instanceId: string): string {
  return installIn(addon, instanceId)?.reason ?? addon.problem ?? 'Läuft hier nicht';
}

/** Instanz, in der gerade ein Spiel startet oder läuft (dort ändert der Launcher nichts) */
function gameInstance(): string | null {
  const game = view.game ?? state.game;
  return game.state === 'preparing' || game.state === 'running' ? game.instanceId : null;
}

function updatePairs(): { addon: StoreListing; instance: StoreInstance }[] {
  const pairs: { addon: StoreListing; instance: StoreInstance }[] = [];
  for (const addon of view.overview?.addons ?? []) {
    for (const instance of instances()) {
      if (installIn(addon, instance.id)?.state === 'update') pairs.push({ addon, instance });
    }
  }
  return pairs;
}

function updateCount(): number {
  return (view.overview?.addons ?? []).filter((addon) => addon.installs.some((entry) => entry.state === 'update')).length;
}

/** Wer hinter dem Addon steht: das Team (offiziell) oder der Spieler, der es eingereicht hat */
function authorOf(addon: StoreListing): { key: string; name: string } | null {
  if (addon.official) return { key: 'team', name: TEAM };
  if (addon.author) return { key: addon.author.uuid, name: addon.author.name };
  return null;
}

const plainUuid = (uuid: string) => uuid.replace(/-/g, '').toLowerCase();

/** Darf der angemeldete Spieler bewerten? null = ja, sonst der Grund */
function rateBlocker(addon: StoreListing): string | null {
  const account = state.accounts.find((a) => a.active);
  if (!account || account.type !== 'microsoft') return 'Bewerten geht nur mit einem Microsoft-Konto.';
  if (!addon.official && addon.author && plainUuid(addon.author.uuid) === plainUuid(account.uuid)) return 'Eigene Addons kannst du nicht bewerten.';
  return null;
}

const searchCache = new WeakMap<StoreListing, string>();
function searchText(addon: StoreListing): string {
  let text = searchCache.get(addon);
  if (text == null) {
    text = [addon.name, addon.id, addon.summary, addon.description, CATEGORY_LABELS[addon.category], addon.official ? 'offiziell' : 'community',
      authorOf(addon)?.name, ...addon.platforms.map((p) => PLATFORM_LABELS[p]), ...addon.authors,
      addon.access === 'minecraft' ? 'greift in minecraft ein' : '', ...(addon.minecraft ?? []).map((v) => `minecraft ${v}`)]
      .filter(Boolean).join(' ').toLowerCase();
    searchCache.set(addon, text);
  }
  return text;
}

function filtered(): StoreListing[] {
  const terms = view.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const list = (view.overview?.addons ?? []).filter((addon) =>
    (view.category === 'alle' || addon.category === view.category)
    && (view.origin === 'alle' || addon.official === (view.origin === 'offiziell'))
    && (!view.author || authorOf(addon)?.key === view.author.key)
    && terms.every((term) => searchText(addon).includes(term)));
  const byName = (a: StoreListing, b: StoreListing) => collator.compare(a.name, b.name);
  if (view.sort === 'name') list.sort(byName);
  else if (view.sort === 'neu') list.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0) || byName(a, b));
  else if (view.sort === 'bewertung') list.sort((a, b) => b.rating.average - a.rating.average || b.rating.count - a.rating.count || byName(a, b));
  else list.sort((a, b) => b.downloads - a.downloads || byName(a, b));
  // nach der Update-Benachrichtigung: Addons mit Update zuerst (sort ist stabil, die Reihenfolge darin bleibt)
  if (view.updatesFirst) list.sort((a, b) => Number(hasUpdate(b)) - Number(hasUpdate(a)));
  return list;
}

const hasUpdate = (addon: StoreListing) => addon.installs.some((entry) => entry.state === 'update');

// ---------------------------------------------------------------------------------------------------------
// Formatierung
// ---------------------------------------------------------------------------------------------------------

function addonIcon(addon: StoreListing, size: 'medium' | 'big' = 'medium'): HTMLElement {
  return h('div', { class: `store-icon ${size}` }, uiIcon(UI_ICONS[addon.icon] ? addon.icon : 'addons'));
}

function platformLimit(platforms: Platform[]): string | null {
  // keine Angabe oder alle drei Systeme: keine Einschränkung
  if (!platforms.length || (Object.keys(PLATFORM_LABELS) as Platform[]).every((p) => platforms.includes(p))) return null;
  return `Nur ${platforms.map((p) => PLATFORM_LABELS[p]).join(' & ')}`;
}

function currentPlatform(): Platform {
  return api.platform === 'darwin' ? 'mac' : api.platform === 'linux' ? 'linux' : 'windows';
}

function downloadsText(n: number): string {
  return n === 1 ? '1 Download' : `${formatCount(n)} Downloads`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '–';
  if (bytes < 1024) return `${bytes} Bytes`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('de-DE')} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

function dateText(date: string): string | null {
  const time = Date.parse(date);
  return Number.isFinite(time) ? formatDate(time) : null;
}

function loaderText(instance: StoreInstance): string {
  return instance.loader === 'heldix' ? 'Heldix Loader' : 'Fabric + HeldixClient';
}

/** „Minecraft 26.3“, „Minecraft 26.2, 26.3“, ab vier Versionen gekürzt */
function minecraftText(versions: string[]): string {
  return `Minecraft ${versions.length > 3 ? `${versions.slice(0, 2).join(', ')} +${versions.length - 2}` : versions.join(', ')}`;
}

/** Nur in Heldix-Instanzen (bzw. nur in Fabric-Instanzen)? null = in beiden */
function loaderLimit(addon: StoreListing): string | null {
  const loaders = addon.loaders ?? ['heldix', 'fabric'];
  if (loaders.includes('heldix') && loaders.includes('fabric')) return null;
  return loaders.includes('heldix') ? 'Nur Heldix-Instanzen' : 'Nur Fabric-Instanzen';
}

const MINECRAFT_ACCESS = 'Greift in Minecraft ein';
const MINECRAFT_ACCESS_HINT = 'Verändert Minecraft direkt, nicht nur über die Heldix-API – vom HeldixClient-Team geprüft. An und Aus wirkt erst nach dem Neustart.';

const averageText = (rating: AddonRating) => rating.average.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const ratingsText = (count: number) => (count === 1 ? '1 Bewertung' : `${count.toLocaleString('de-DE')} Bewertungen`);

/** Fünf Sterne, gefüllt bis zum Durchschnitt */
function stars(average: number, size: 'small' | 'big'): HTMLElement {
  const row = () => Array.from({ length: 5 }, () => uiIcon('star', 'store-star'));
  const fill = h('span', { class: 'store-stars-fill' }, ...row());
  fill.style.width = `${Math.max(0, Math.min(5, average)) * 20}%`;
  return h('span', { class: `store-stars ${size}`, role: 'img', 'aria-label': `${average.toLocaleString('de-DE')} von 5 Sternen` },
    h('span', { class: 'store-stars-base' }, ...row()), fill);
}

/** „Offiziell“ (Team) oder „Community“ (von einem Spieler eingereicht) */
function originBadge(addon: StoreListing): HTMLElement {
  return addon.official
    ? h('span', { class: 'tag tag-heldix store-origin', title: 'Vom HeldixClient-Team' }, 'Offiziell')
    : h('span', { class: 'tag tag-type store-origin', title: 'Von einem Spieler eingereicht, vom HeldixClient-Team geprüft und signiert' }, 'Community');
}

/** „von <Name>“ – Klick zeigt alle Addons dieses Autors */
function authorButton(addon: StoreListing): HTMLElement | null {
  const author = authorOf(addon);
  if (!author) return addon.authors.length ? h('span', { class: 'store-author-text', text: `von ${addon.authors.join(', ')}` }) : null;
  const button = h('button', { class: 'store-author', type: 'button', title: `Alle Addons von ${author.name}`, 'data-focus': 'author' }, `von ${author.name}`);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    filterAuthor(author);
  });
  return button;
}

function filterAuthor(author: { key: string; name: string }): void {
  view.author = author;
  view.category = 'alle';
  view.origin = 'alle';
  view.query = '';
  const { search, root } = els();
  search.value = '';
  closeDrawer(false);
  refilter();
  root.scrollTop = 0;
}

/** Klartext aus dem Store: Absätze durch Leerzeilen, Zeilen mit „- “ als Liste – nie HTML. */
function plainText(source: string): HTMLElement {
  const box = h('div', { class: 'store-prose' });
  for (const block of source.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    let paragraph: HTMLElement | null = null;
    let list: HTMLElement | null = null;
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^- \S/.test(line)) {
        paragraph = null;
        if (!list) box.append((list = h('ul')));
        list.append(h('li', { text: line.slice(2).trim() }));
      } else {
        list = null;
        if (paragraph) paragraph.append(` ${line}`);
        else box.append((paragraph = h('p', { text: line })));
      }
    }
  }
  return box;
}

// ---------------------------------------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------------------------------------

function render(): void {
  if (!ui) return;
  renderBadge();
  renderNotices();
  renderToolbar();
  renderBody();
  renderDrawer();
  renderLightbox();
}

/** Suche, Filter oder Sortierung geändert: „Updates zuerst“ (nach Klick auf die Benachrichtigung) endet */
function refilter(): void {
  view.updatesFirst = false;
  renderToolbar();
  renderBody();
}

/** Klick auf die Benachrichtigung „Addon-Updates verfügbar“: Filter zurück, Updates oben, Hinweis kurz hervorheben */
function showUpdatesFirst(): void {
  view.query = '';
  view.category = 'alle';
  view.origin = 'alle';
  view.author = null;
  const { search, root } = els();
  search.value = '';
  closeReport();
  closeDrawer(false);
  refilter();
  view.updatesFirst = true;
  view.flashUntil = Date.now() + FLASH_MS;
  root.scrollTop = 0;
}

function renderBadge(): void {
  const badge = document.querySelector<HTMLElement>('#store-badge');
  if (!badge) return;
  const n = view.updates;
  badge.hidden = n === 0;
  badge.textContent = n ? String(n) : '';
  badge.title = n === 1 ? '1 Addon-Update' : `${n} Addon-Updates`;
  // Startseite zeigt daraus den Hinweis „Addon-Updates verfügbar“
  document.dispatchEvent(new CustomEvent('heldix:store-updates', { detail: n }));
}

function notice(kind: 'accent' | 'warn' | 'info', icon: string, title: string, sub: (string | Node)[], ...actions: HTMLElement[]): HTMLElement {
  return h('div', { class: `store-notice ${kind}` },
    h('div', { class: 'store-notice-icon' }, uiIcon(icon)),
    h('div', { class: 'store-notice-text' },
      h('div', { class: 'store-notice-title', text: title }),
      ...sub.map((line) => (typeof line === 'string' ? h('div', { class: 'store-notice-sub', text: line }) : line))),
    actions.length ? h('div', { class: 'store-notice-actions' }, ...actions) : null);
}

function renderNotices(): void {
  const { notices } = els();
  const list: HTMLElement[] = [];
  const overview = view.overview;
  if (overview?.addons.length) {
    if (view.failure) {
      const retry = h('button', { class: 'ghost small', type: 'button' }, uiIcon('refresh', 'btn-icon'), 'Erneut versuchen');
      retry.addEventListener('click', () => void refresh());
      list.push(notice('warn', 'warning', 'Addon-Store konnte nicht aktualisiert werden', [`${view.failure} Angezeigt wird der letzte Stand.`], retry));
    }
    if (view.bulk) {
      const bar = h('div', { class: 'store-progress busy' }, h('span'));
      list.push(notice('accent', 'refresh', 'Updates werden installiert …', [view.bulk.join(', '), bar]));
    } else {
      const pairs = updatePairs();
      if (pairs.length) {
        const blocked = gameInstance();
        const doable = pairs.filter((pair) => pair.instance.id !== blocked);
        const lines = [[...new Set(pairs.map((pair) => pair.addon.name))].join(', ')];
        const skipped = pairs.find((pair) => pair.instance.id === blocked);
        if (skipped) lines.push(`„${skipped.instance.name}“ läuft gerade und wird übersprungen.`);
        const all = h('button', { class: 'primary', type: 'button' }, uiIcon('refresh', 'btn-icon'), 'Alle aktualisieren');
        all.disabled = !doable.length || view.busy.size > 0;
        if (!doable.length) all.title = 'Die Instanz läuft gerade – nach dem Beenden aktualisieren.';
        all.addEventListener('click', () => void updateAll());
        const box = notice('accent', 'refresh', pairs.length === 1 ? '1 Update verfügbar' : `${pairs.length} Updates verfügbar`, lines, all);
        const flashLeft = view.flashUntil - Date.now();
        if (flashLeft > 0) {
          // beim Neuzeichnen an derselben Stelle der Animation weitermachen
          box.classList.add('flash');
          box.style.animationDelay = `${flashLeft - FLASH_MS}ms`;
        }
        list.push(box);
      }
    }
    if (!overview.instances.length) list.push(noInstanceNotice());
  }
  notices.replaceChildren(...list);
  notices.hidden = list.length === 0;
}

function noInstanceNotice(): HTMLElement {
  const create = h('button', { class: 'primary', type: 'button' }, uiIcon('plus', 'btn-icon'), 'Instanz erstellen');
  create.addEventListener('click', createInstance);
  const fabricOff = state.instances.some((i) => i.loader === 'fabric' && !i.heldixClient);
  const lines = ['Addons laufen in Instanzen mit Heldix Loader oder mit Fabric + HeldixClient.'];
  if (fabricOff) lines.push('In einer Fabric-Instanz lässt sich HeldixClient unter Einstellungen der Instanz einschalten.');
  return notice('info', 'info', 'Noch keine Instanz mit HeldixClient', lines, create);
}

/** Zur Instanzen-Seite wechseln und den Dialog „Neue Instanz“ öffnen (wie die Startseite) */
function createInstance(): void {
  closeDrawer(false);
  document.querySelector<HTMLElement>('.nav-item[data-view="instances"]')?.click();
  document.querySelector<HTMLElement>('#new-instance')?.click();
}

function markActive(group: HTMLElement, value: string): void {
  group.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    const active = b.dataset.value === value;
    b.classList.toggle('active', active);
    b.setAttribute('aria-pressed', String(active));
  });
}

function renderToolbar(): void {
  const { toolbar, cats, sort, origin, authorChip } = els();
  const addons = view.overview?.addons ?? [];
  toolbar.hidden = addons.length === 0;
  if (!addons.length) return;
  const counts = new Map<Category, number>();
  for (const addon of addons) counts.set(addon.category, (counts.get(addon.category) ?? 0) + 1);
  const button = (id: Category | 'alle', label: string, count: number) => {
    const el = h('button', { type: 'button', 'data-value': id }, label, h('span', { class: 'store-cat-count', text: String(count) }));
    el.addEventListener('click', () => {
      view.category = id;
      refilter();
    });
    return el;
  };
  cats.replaceChildren(
    button('alle', 'Alle', addons.length),
    ...CATEGORY_ORDER.filter((id) => counts.has(id)).map((id) => button(id, CATEGORY_LABELS[id], counts.get(id)!)));
  markActive(cats, view.category);
  markActive(sort, view.sort);
  markActive(origin, view.origin);

  authorChip.hidden = !view.author;
  if (view.author) {
    const clear = h('button', { class: 'store-author-clear', type: 'button', title: 'Autor-Filter entfernen', 'aria-label': 'Autor-Filter entfernen' }, uiIcon('close'));
    clear.addEventListener('click', () => {
      view.author = null;
      refilter();
    });
    authorChip.replaceChildren(uiIcon('user', 'store-author-chip-icon'), h('span', { text: `Alle Addons von ${view.author.name}` }), clear);
  }
}

function renderBody(): void {
  const { body, count } = els();
  const overview = view.overview;
  if (!overview) {
    body.replaceChildren(view.failure ? errorState(view.failure) : skeleton());
    return;
  }
  if (!overview.addons.length) {
    body.replaceChildren(view.failure
      ? errorState(view.failure)
      : emptyState('addons', 'Noch keine Addons im Store', 'Sobald das HeldixClient-Team Addons veröffentlicht oder freigibt, findest du sie hier.', submitButton()));
    return;
  }
  const shown = filtered();
  const total = overview.addons.length;
  const narrowed = view.category !== 'alle' || view.origin !== 'alle' || view.author != null || view.query.trim() !== '';
  count.textContent = narrowed ? `${shown.length} von ${total} Addons` : total === 1 ? '1 Addon' : `${total} Addons`;
  if (!shown.length) {
    const reset = h('button', { class: 'ghost', type: 'button' }, uiIcon('reset', 'btn-icon'), 'Filter zurücksetzen');
    reset.addEventListener('click', () => {
      view.query = '';
      view.category = 'alle';
      view.origin = 'alle';
      view.author = null;
      els().search.value = '';
      refilter();
    });
    const query = view.query.trim();
    body.replaceChildren(emptyState('search', 'Keine Addons gefunden', query ? `Nichts passt zu „${query}“ mit den gewählten Filtern.` : 'Mit diesen Filtern gibt es keine Addons.', reset));
    return;
  }
  body.replaceChildren(h('div', { class: 'store-grid' }, ...shown.map(addonCard)), submitHint());
}

function submitButton(): HTMLElement {
  const button = h('button', { class: 'ghost', type: 'button', title: 'Öffnet den Addon-Store auf heldixclient.com' }, uiIcon('code', 'btn-icon'), 'Eigenes Addon einreichen');
  button.addEventListener('click', () => openSite());
  return button;
}

/** Hinweis unter den Karten: eigene Addons auf heldixclient.com einreichen */
function submitHint(): HTMLElement {
  const link = h('button', { class: 'link-button store-submit-link', type: 'button' }, 'Eigenes Addon einreichen');
  link.addEventListener('click', () => openSite());
  return h('div', { class: 'store-submit' },
    uiIcon('code', 'store-submit-icon'),
    h('span', { text: 'Selbst ein Addon gebaut? Reiche es auf heldixclient.com ein – das Team prüft und signiert es, dann steht es hier als Community-Addon.' }),
    link);
}

function emptyState(icon: string, title: string, text: string, ...actions: HTMLElement[]): HTMLElement {
  return h('div', { class: 'store-empty' },
    uiIcon(icon, 'empty-icon'),
    h('div', { class: 'store-empty-title', text: title }),
    h('div', { class: 'store-empty-text', text }),
    actions.length ? h('div', { class: 'store-empty-actions' }, ...actions) : null);
}

function errorState(message: string): HTMLElement {
  const retry = h('button', { class: 'ghost', type: 'button' }, uiIcon('refresh', 'btn-icon'), 'Erneut versuchen');
  retry.addEventListener('click', () => {
    // wieder mit Platzhaltern laden, damit man sieht, dass etwas passiert
    view.failure = null;
    if (!view.overview?.addons.length) view.overview = null;
    render();
    void refresh();
  });
  const box = emptyState('warning', 'Addon-Store nicht erreichbar', message, retry);
  box.classList.add('error');
  box.insertBefore(h('div', { class: 'store-empty-text faint', text: 'Installierte Addons laufen trotzdem weiter.' }), box.lastChild);
  return box;
}

function skeleton(): HTMLElement {
  const card = () => h('div', { class: 'store-item store-skeleton', 'aria-hidden': 'true' },
    h('div', { class: 'store-item-head' }, h('div', { class: 'store-icon medium store-bone' }),
      h('div', { class: 'store-item-title' }, h('div', { class: 'store-bone line w60' }), h('div', { class: 'store-bone line w40' }))),
    h('div', { class: 'store-bone line' }), h('div', { class: 'store-bone line w80' }),
    h('div', { class: 'store-bone line w50' }));
  return h('div', { class: 'store-grid', 'aria-busy': 'true', 'aria-label': 'Addon-Store wird geladen' }, card(), card(), card(), card(), card(), card());
}

/** „In 2 von 3 Instanzen“, „Update verfügbar“, „Nicht installiert“ … */
function installSummary(addon: StoreListing): { kind: string; icon: string; text: string } {
  const list = instances();
  const states = list.map((instance) => stateIn(addon, instance.id));
  const installed = states.filter(isInstalled).length;
  const updates = states.filter((s) => s === 'update').length;
  if (updates) return { kind: 'update', icon: 'refresh', text: list.length === 1 ? 'Update verfügbar' : `Update verfügbar · ${updates === 1 ? '1 Instanz' : `${updates} Instanzen`}` };
  if (installed && installed === list.length) return { kind: 'installed', icon: 'check', text: list.length === 1 ? 'Installiert' : `In allen ${list.length} Instanzen` };
  if (installed) return { kind: 'installed', icon: 'check', text: `In ${installed} von ${list.length} Instanzen` };
  if (addon.problem) return { kind: 'problem', icon: 'ban', text: addon.problem };
  if (!list.length) return { kind: 'none', icon: 'info', text: 'Keine Heldix-Instanz' };
  // Minecraft-Version oder Loader passen nicht zu jeder Instanz
  const fitting = states.filter((s) => !isUnsupported(s)).length;
  if (fitting === 0) return { kind: 'problem', icon: 'ban', text: list.length === 1 ? reasonIn(addon, list[0].id) : `Passt zu keiner Instanz · ${reasonIn(addon, list[0].id)}` };
  if (fitting < list.length) return { kind: 'none', icon: 'download', text: `Nicht installiert · passt zu ${fitting} von ${list.length} Instanzen` };
  return { kind: 'none', icon: 'download', text: 'Nicht installiert' };
}

function cardRating(addon: StoreListing): HTMLElement {
  const { average, count } = addon.rating;
  if (!count) return h('span', { class: 'store-rating none', text: 'Noch nicht bewertet' });
  return h('span', { class: 'store-rating', title: `${averageText(addon.rating)} von 5 · ${ratingsText(count)}` },
    stars(average, 'small'), h('span', { class: 'store-rating-value', text: averageText(addon.rating) }), h('span', { class: 'store-rating-count', text: `(${formatCount(count)})` }));
}

function pills(addon: StoreListing): HTMLElement {
  const limit = platformLimit(addon.platforms);
  const wrongSystem = addon.platforms.length > 0 && !addon.platforms.includes(currentPlatform());
  const minecraft = addon.minecraft ?? [];
  const loaders = loaderLimit(addon);
  return h('div', { class: 'store-pills' },
    addon.access === 'minecraft' ? h('span', { class: 'store-pill minecraft', title: MINECRAFT_ACCESS_HINT, text: MINECRAFT_ACCESS }) : null,
    h('span', { class: 'store-pill', text: CATEGORY_LABELS[addon.category] ?? 'Sonstiges' }),
    minecraft.length ? h('span', { class: 'store-pill', title: `Läuft mit Minecraft ${minecraft.join(', ')}`, text: minecraftText(minecraft) }) : null,
    loaders ? h('span', { class: 'store-pill', text: loaders }) : null,
    limit ? h('span', { class: `store-pill${wrongSystem ? ' warn' : ''}`, text: limit }) : null,
    h('span', { class: 'store-pill', text: downloadsText(addon.downloads) }));
}

function addonCard(addon: StoreListing): HTMLElement {
  const summary = installSummary(addon);
  const card = h('div', {
    class: `store-item${addon.id === 'spotify' && addon.official ? ' store-spotify' : ''}${view.open === addon.id ? ' selected' : ''}`,
    role: 'button',
    tabindex: '0',
    'data-addon': addon.id,
    'aria-label': `${addon.name} ${addon.version} – Details öffnen`,
  },
  h('div', { class: 'store-item-head' },
    addonIcon(addon),
    h('div', { class: 'store-item-title' },
      h('div', { class: 'store-item-name' }, h('span', { text: addon.name }), h('span', { class: 'content-version', text: addon.version })),
      h('div', { class: 'store-item-by' }, originBadge(addon), authorButton(addon)))),
  h('p', { class: 'store-item-summary', text: addon.summary }),
  h('div', { class: 'store-item-meta' }, cardRating(addon), pills(addon)),
  h('div', { class: `store-item-status ${summary.kind}` },
    uiIcon(summary.icon, 'store-status-icon'),
    h('span', { text: summary.text }),
    uiIcon('chevron-right', 'store-item-more')));
  card.addEventListener('click', () => openDrawer(addon.id));
  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDrawer(addon.id);
    }
  });
  return card;
}

// ---------------------------------------------------------------------------------------------------------
// Detail-Leiste
// ---------------------------------------------------------------------------------------------------------

function storeVisible(): boolean {
  return document.querySelector('#view-store')?.classList.contains('active') ?? true;
}

function openDrawer(id: string): void {
  const { drawer, scrim, root } = els();
  if (!findAddon(id)) return;
  const switching = view.open !== id;
  view.open = id;
  if (switching) view.historyOpen = false;
  renderDrawer();
  if (switching) drawer.scrollTop = 0;
  drawer.classList.add('open');
  scrim.classList.add('open');
  root.inert = true;
  root.querySelectorAll('.store-item.selected').forEach((el) => el.classList.remove('selected'));
  root.querySelector(`.store-item[data-addon="${CSS.escape(id)}"]`)?.classList.add('selected');
  drawer.querySelector<HTMLElement>('[data-focus="close"]')?.focus({ preventScroll: true });
}

function closeDrawer(restoreFocus = true): void {
  if (!ui || !view.open) return;
  const id = view.open;
  view.open = null;
  closeLightbox();
  ui.drawer.classList.remove('open');
  ui.scrim.classList.remove('open');
  ui.root.inert = false;
  const card = ui.root.querySelector<HTMLElement>(`.store-item[data-addon="${CSS.escape(id)}"]`);
  card?.classList.remove('selected');
  if (restoreFocus) card?.focus({ preventScroll: true });
}

function renderDrawer(): void {
  const { drawer } = els();
  if (!view.open) return;
  const addon = findAddon(view.open);
  if (!addon) {
    closeDrawer(false);
    return;
  }
  // Fokus und Scrollstand über das Neuzeichnen retten (z. B. nach „Installieren“)
  const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.store-drawer [data-focus]')?.dataset.focus;
  const scroll = drawer.scrollTop;

  const close = h('button', { class: 'icon-button store-close', type: 'button', title: 'Schließen (Esc)', 'aria-label': 'Details schließen', 'data-focus': 'close' }, uiIcon('close'));
  close.addEventListener('click', () => closeDrawer());
  const head = h('div', { class: 'store-drawer-head' },
    addonIcon(addon, 'big'),
    h('div', { class: 'store-drawer-heading' },
      h('div', { class: 'store-drawer-eyebrow' }, originBadge(addon), h('span', { class: 'store-eyebrow', text: CATEGORY_LABELS[addon.category] ?? 'Sonstiges' })),
      h('h3', { class: 'store-drawer-title' }, h('span', { text: addon.name }), h('span', { class: 'content-version', text: addon.version })),
      h('div', { class: 'store-drawer-meta' }, authorButton(addon), h('span', { text: downloadsText(addon.downloads) }))),
    close);

  const date = dateText(addon.date);
  const facts: [string, string][] = [
    ['Version', addon.version],
    ['Veröffentlicht', date ?? '–'],
    ['Herkunft', addon.official ? `Offiziell – vom ${TEAM}` : `Community – eingereicht von ${addon.author?.name ?? 'einem Spieler'}`],
    ['Größe', formatBytes(addon.size)],
    ['Systeme', platformLimit(addon.platforms) ? addon.platforms.map((p) => PLATFORM_LABELS[p]).join(', ') : 'Alle Systeme'],
    ['Zugriff', addon.access === 'minecraft' ? MINECRAFT_ACCESS : 'Nur über die Heldix-API'],
    ['Minecraft', addon.minecraft?.length ? addon.minecraft.join(', ') : 'Jede Version'],
    ['Instanzen', loaderLimit(addon) === 'Nur Heldix-Instanzen' ? 'Nur mit Heldix Loader' : loaderLimit(addon) ? 'Nur Fabric mit HeldixClient' : 'Heldix Loader und Fabric mit HeldixClient'],
    ['Addon-API', `Stufe ${addon.api}`],
    [addon.authors.length === 1 ? 'Autor' : 'Autoren', addon.authors.join(', ') || '–'],
    ['Downloads', addon.downloads.toLocaleString('de-DE')],
  ];
  const copy = h('button', { class: 'icon-button store-copy', type: 'button', title: 'Prüfsumme kopieren', 'aria-label': 'SHA-256-Prüfsumme kopieren', 'data-focus': 'copy' }, uiIcon('copy'));
  copy.addEventListener('click', () => void copyHash(addon.sha256));
  const report = h('button', { class: 'ghost small', type: 'button', 'data-focus': 'report' }, uiIcon('flag', 'btn-icon'), 'Melden');
  report.addEventListener('click', () => openReport(addon));
  const site = h('button', { class: 'ghost small', type: 'button', 'data-focus': 'site' }, uiIcon('external', 'btn-icon'), 'Auf heldixclient.com');
  site.addEventListener('click', () => openSite());

  drawer.dataset.addon = addon.id;
  drawer.dataset.official = String(addon.official);
  drawer.replaceChildren(
    head,
    h('div', { class: 'store-drawer-body' },
      addon.summary ? h('p', { class: 'store-lead', text: addon.summary }) : null,
      ratingBox(addon),
      addon.problem ? h('div', { class: 'store-warn' }, uiIcon('warning'), h('span', { text: problemText(addon) })) : null,
      addon.access === 'minecraft'
        ? h('div', { class: 'store-access' }, uiIcon('code'), h('div', {},
          h('strong', { text: MINECRAFT_ACCESS }),
          h('span', { text: ` – verändert Minecraft direkt, nicht nur über die Heldix-API. Das HeldixClient-Team hat die Eingriffe geprüft. Läuft mit ${minecraftText(addon.minecraft ?? [])}${loaderLimit(addon) === 'Nur Heldix-Instanzen' ? ', nur in Heldix-Instanzen' : ''}; An und Aus wirkt erst nach dem Neustart.` })))
        : null,
      instanceSection(addon),
      gallery(addon),
      addon.description ? h('section', { class: 'store-section' }, h('h4', { class: 'store-section-title', text: 'Beschreibung' }), plainText(addon.description)) : null,
      addon.notes.length
        ? h('section', { class: 'store-section' },
          h('h4', { class: 'store-section-title', text: `Neu in ${addon.version}` }),
          h('ul', { class: 'store-changes' }, ...addon.notes.map((note) => h('li', { text: note }))))
        : null,
      historySection(addon),
      h('section', { class: 'store-section' },
        h('h4', { class: 'store-section-title', text: 'Details' }),
        h('dl', { class: 'store-facts' }, ...facts.flatMap(([label, value]) => [h('dt', { text: label }), h('dd', { text: value })]))),
      addon.sha256
        ? h('section', { class: 'store-section' },
          h('h4', { class: 'store-section-title', text: 'SHA-256-Prüfsumme' }),
          h('div', { class: 'store-hash' }, h('code', { text: addon.sha256 }), copy))
        : null,
      h('div', { class: 'store-drawer-actions' }, report, site),
      h('p', { class: 'hint store-foot', text: addon.official
        ? 'Offizielles Addon, signiert vom HeldixClient-Team. Der Launcher prüft Signatur und Prüfsumme vor jeder Installation. Änderungen gelten ab dem nächsten Spielstart der Instanz.'
        : 'Community-Addon: von einem Spieler eingereicht, vom HeldixClient-Team geprüft und signiert. Der Launcher prüft Signatur und Prüfsumme vor jeder Installation. Änderungen gelten ab dem nächsten Spielstart der Instanz.' })));

  drawer.scrollTop = scroll;
  if (focusKey) drawer.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function problemText(addon: StoreListing): string {
  const installedSomewhere = instances().some((instance) => isInstalled(stateIn(addon, instance.id)));
  const text = addon.problem ?? '';
  return installedSomewhere
    ? `${text} – auf diesem PC lässt es sich nicht installieren. Vorhandene Kopien kannst du entfernen.`
    : `${text} – auf diesem PC lässt es sich nicht installieren.`;
}

// ---------- Bewertung ----------

function ratingBox(addon: StoreListing): HTMLElement {
  const { average, count } = addon.rating;
  const blocker = rateBlocker(addon);
  const busy = view.rating === addon.id;
  const mine = addon.myRating ?? 0;
  const picker = h('div', { class: 'store-rate', role: 'group', 'aria-label': 'Deine Bewertung' });
  const buttons: HTMLButtonElement[] = [];
  const paint = (upTo: number) => buttons.forEach((b, i) => b.classList.toggle('on', i < upTo));
  for (let n = 1; n <= 5; n++) {
    const label = n === mine ? `Bewertung (${n} ${n === 1 ? 'Stern' : 'Sterne'}) entfernen` : `${n} ${n === 1 ? 'Stern' : 'Sterne'} vergeben`;
    const button = h('button', { type: 'button', class: 'store-rate-star', title: blocker ?? label, 'aria-label': label, 'aria-pressed': String(n === mine), 'data-focus': `rate:${n}` }, uiIcon('star'));
    button.disabled = blocker != null || busy;
    button.addEventListener('mouseenter', () => paint(n));
    button.addEventListener('focus', () => paint(n));
    button.addEventListener('click', () => void rate(addon.id, n));
    buttons.push(button);
    picker.append(button);
  }
  picker.addEventListener('mouseleave', () => paint(mine));
  picker.addEventListener('focusout', () => paint(mine));
  paint(mine);
  const hint = blocker
    ?? (busy ? 'Wird gespeichert …' : rateErrors.get(addon.id) ?? (mine ? 'Klick auf deine Bewertung entfernt sie.' : 'Noch nicht bewertet – klick auf einen Stern.'));
  return h('section', { class: 'store-rating-box' },
    h('div', { class: 'store-rating-total' },
      stars(average, 'big'),
      count
        ? h('span', { class: 'store-rating-big' }, h('strong', { text: averageText(addon.rating) }), h('span', { text: ` · ${ratingsText(count)}` }))
        : h('span', { class: 'store-rating-big none', text: 'Noch keine Bewertungen' })),
    h('div', { class: 'store-rating-mine' },
      h('span', { class: 'store-rating-label', text: 'Deine Bewertung' }),
      picker,
      h('span', { class: `store-rating-hint${blocker || rateErrors.has(addon.id) ? ' warn' : ''}`, text: hint })));
}

async function rate(id: string, stars: number): Promise<void> {
  const addon = findAddon(id);
  if (!addon || view.rating) return;
  const next = addon.myRating === stars ? null : stars;
  view.rating = id;
  rateErrors.delete(id);
  renderDrawer();
  try {
    const result = await api.rateAddon(id, next);
    const current = findAddon(id);
    if (current) {
      current.rating = { average: result.average, count: result.count };
      current.myRating = result.myRating;
    }
    toast(next ? `Danke! Du hast ${current?.name ?? 'das Addon'} mit ${next} ${next === 1 ? 'Stern' : 'Sternen'} bewertet.` : 'Deine Bewertung ist entfernt.', 'success');
  } catch (error) {
    const message = errorMessage(error);
    rateErrors.set(id, message);
    toast(message, 'error');
  } finally {
    view.rating = null;
  }
  render();
}

// ---------- Instanzen ----------

function instanceSection(addon: StoreListing): HTMLElement {
  const list = instances();
  const title = h('div', { class: 'store-section-head' }, h('h4', { class: 'store-section-title', text: 'In deinen Instanzen' }));
  if (!list.length) {
    const create = h('button', { class: 'primary', type: 'button', 'data-focus': 'create' }, uiIcon('plus', 'btn-icon'), 'Instanz erstellen');
    create.addEventListener('click', createInstance);
    return h('section', { class: 'store-section' }, title,
      h('div', { class: 'store-inst-empty' },
        h('div', { class: 'store-inst-empty-text' },
          h('strong', { text: 'Noch keine Instanz mit HeldixClient' }),
          h('span', { text: 'Addons laufen in Instanzen mit Heldix Loader oder mit Fabric + HeldixClient.' })),
        create));
  }
  const installed = list.filter((instance) => isInstalled(stateIn(addon, instance.id))).length;
  title.append(h('span', { class: 'store-section-note', text: `${installed} von ${list.length}` }));
  const blocked = list.find((instance) => instance.id === gameInstance());
  return h('section', { class: 'store-section' }, title,
    h('div', { class: 'store-insts' }, ...list.map((instance) => instanceRow(addon, instance))),
    blocked ? h('p', { class: 'hint store-inst-hint', text: `„${blocked.name}“ läuft gerade. Dort lassen sich Addons erst nach dem Beenden ändern.` }) : null);
}

function gameState(): GameState['state'] {
  return (view.game ?? state.game).state;
}

function instanceRow(addon: StoreListing, instance: StoreInstance): HTMLElement {
  const s = stateIn(addon, instance.id);
  const install = installIn(addon, instance.id);
  const busy = view.busy.get(`${instance.id}/${addon.id}`);
  const playing = gameInstance() === instance.id;
  const locked = playing || busy != null || view.bulk != null;
  const lockTitle = playing ? 'Die Instanz läuft gerade – nach dem Beenden änderbar.' : undefined;

  let status: [string, string, string];
  if (busy) status = ['busy', 'hourglass', BUSY_LABELS[busy]];
  else if (s === 'update') status = ['update', 'refresh', `Update: ${install?.installedVersion ?? 'ältere Version'} → ${addon.version}`];
  else if (s === 'installed') status = ['ok', 'check', install?.installedVersion ? `Installiert · ${install.installedVersion}` : 'Installiert'];
  else if (s === 'available') status = ['muted', 'download', 'Nicht installiert'];
  else status = ['warn', 'ban', reasonIn(addon, instance.id)];

  const actions = h('div', { class: 'store-inst-actions' });
  const button = (cls: string, icon: string, label: string, action: Action | null) => {
    const el = h('button', { class: cls, type: 'button', 'data-focus': `main:${instance.id}` }, uiIcon(icon, 'btn-icon'), label);
    el.disabled = locked || action == null;
    if (lockTitle) el.title = lockTitle;
    if (action) el.addEventListener('click', () => void runAction(addon, instance, action));
    return el;
  };
  if (s === 'available') actions.append(button('primary', 'download', 'Installieren', 'install'));
  else if (s === 'update') {
    actions.append(button('primary', 'refresh', 'Aktualisieren', 'update'));
    const remove = h('button', { class: 'icon-button danger-hover', type: 'button', title: lockTitle ?? 'Entfernen', 'aria-label': `${addon.name} aus ${instance.name} entfernen`, 'data-focus': `remove:${instance.id}` }, uiIcon('trash'));
    remove.disabled = locked;
    remove.addEventListener('click', () => void runAction(addon, instance, 'remove'));
    actions.append(remove);
  } else if (s === 'installed') actions.append(button('ghost', 'trash', 'Entfernen', 'remove'));
  else {
    const unavailable = button('ghost', 'ban', 'Nicht verfügbar', null);
    unavailable.title = reasonIn(addon, instance.id);
    actions.append(unavailable);
  }

  const color = state.instances.find((i) => i.id === instance.id)?.color ?? '';
  return h('div', { class: `store-inst${playing ? ' playing' : ''}`, 'data-instance': instance.id },
    instanceTile({ color, loader: instance.loader, name: instance.name }, 'small'),
    h('div', { class: 'store-inst-main' },
      h('div', { class: 'store-inst-name' },
        h('span', { text: instance.name }),
        playing ? h('span', { class: 'store-live', text: gameState() === 'preparing' ? 'Startet' : 'Läuft' }) : null),
      h('div', { class: 'store-inst-meta', text: `Minecraft ${instance.minecraft} · ${loaderText(instance)}` }),
      h('div', { class: `store-inst-state ${status[0]}` }, uiIcon(status[1], 'store-status-icon'), h('span', { text: status[2] }))),
    actions);
}

// ---------- Screenshots ----------

const shotCount = (addon: StoreListing) => Math.max(0, Math.min(MAX_SCREENSHOTS, Math.floor(addon.screenshots || 0)));
const shotKey = (addon: StoreListing, index: number) => `${addon.id}@${addon.version}/${index}`;

/** Lädt einen Screenshot einmal (data:-URL); danach Leiste und Großansicht neu zeichnen */
function loadShot(addon: StoreListing, index: number): void {
  const key = shotKey(addon, index);
  if (shotUrls.has(key) || shotLoads.has(key)) return;
  const id = addon.id;
  // über Promise.resolve: auch ein synchroner Fehler (z. B. ältere Vorschaltung ohne die Methode) wird zu „nicht ladbar“
  const load = Promise.resolve().then(() => api.getAddonScreenshot(id, index))
    .then((url) => {
      shotUrls.set(key, typeof url === 'string' && url.startsWith('data:image/') ? url : null);
    }, () => {
      shotUrls.set(key, null);
    })
    .then(() => {
      shotLoads.delete(key);
      if (view.open === id) renderDrawer();
      if (view.lightbox?.id === id) renderLightbox();
    });
  shotLoads.set(key, load);
}

function shotContent(addon: StoreListing, index: number, cls: string): HTMLElement {
  const url = shotUrls.get(shotKey(addon, index));
  if (url) return h('img', { class: cls, src: url, alt: `Screenshot ${index} von ${addon.name}`, draggable: 'false' });
  if (url === null) return h('span', { class: `${cls} store-shot-missing` }, uiIcon('image'), h('span', { text: 'Bild lässt sich nicht laden' }));
  loadShot(addon, index);
  return h('span', { class: `${cls} store-bone`, 'aria-label': 'Screenshot wird geladen' });
}

function gallery(addon: StoreListing): HTMLElement | null {
  const count = shotCount(addon);
  if (!count) return null;
  const items: HTMLElement[] = [];
  for (let i = 1; i <= count; i++) {
    const thumb = h('button', { class: 'store-shot', type: 'button', 'aria-label': `Screenshot ${i} von ${count} groß zeigen`, 'data-focus': `shot:${i}` },
      shotContent(addon, i, 'store-shot-img'));
    thumb.disabled = shotUrls.get(shotKey(addon, i)) === null;
    thumb.addEventListener('click', () => openLightbox(addon.id, i));
    items.push(thumb);
  }
  return h('section', { class: 'store-section' },
    h('div', { class: 'store-section-head' }, h('h4', { class: 'store-section-title', text: 'Screenshots' }), h('span', { class: 'store-section-note', text: String(count) })),
    h('div', { class: `store-shots${count === 1 ? ' single' : ''}` }, ...items));
}

let lightboxEl: HTMLElement | null = null;
let lightboxReturn: HTMLElement | null = null;

function openLightbox(id: string, index: number): void {
  lightboxReturn = document.activeElement as HTMLElement | null;
  view.lightbox = { id, index };
  renderLightbox();
  lightboxEl?.querySelector<HTMLElement>('.store-lightbox-close')?.focus({ preventScroll: true });
}

function closeLightbox(): void {
  if (!view.lightbox) return;
  view.lightbox = null;
  lightboxEl?.remove();
  lightboxEl = null;
  lightboxReturn?.focus({ preventScroll: true });
  lightboxReturn = null;
}

function stepLightbox(delta: number): void {
  const lb = view.lightbox;
  const addon = lb && findAddon(lb.id);
  if (!lb || !addon) return;
  const count = shotCount(addon);
  if (count < 2) return;
  lb.index = ((lb.index - 1 + delta + count) % count) + 1;
  renderLightbox();
}

function renderLightbox(): void {
  const lb = view.lightbox;
  if (!lb) return;
  const addon = findAddon(lb.id);
  const count = addon ? shotCount(addon) : 0;
  if (!addon || !count) {
    closeLightbox();
    return;
  }
  lb.index = Math.min(Math.max(1, lb.index), count);
  if (!lightboxEl) {
    lightboxEl = h('div', { class: 'store-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Screenshot groß' });
    lightboxEl.addEventListener('click', (event) => {
      if (event.target === lightboxEl || (event.target as HTMLElement).classList.contains('store-lightbox-stage')) closeLightbox();
    });
    document.body.append(lightboxEl);
  }
  const focused = (document.activeElement as HTMLElement | null)?.dataset.lb;
  const arrow = (dir: 'prev' | 'next') => {
    const b = h('button', { class: `store-lightbox-arrow ${dir}`, type: 'button', 'data-lb': dir, 'aria-label': dir === 'prev' ? 'Voriges Bild' : 'Nächstes Bild' },
      uiIcon(dir === 'prev' ? 'chevron-left' : 'chevron-right'));
    b.addEventListener('click', () => stepLightbox(dir === 'prev' ? -1 : 1));
    b.hidden = count < 2;
    return b;
  };
  const close = h('button', { class: 'store-lightbox-close', type: 'button', 'data-lb': 'close', title: 'Schließen (Esc)', 'aria-label': 'Großansicht schließen' }, uiIcon('close'));
  close.addEventListener('click', () => closeLightbox());
  lightboxEl.replaceChildren(
    close,
    arrow('prev'),
    h('figure', { class: 'store-lightbox-stage' },
      shotContent(addon, lb.index, 'store-lightbox-img'),
      h('figcaption', { class: 'store-lightbox-caption', text: `${addon.name} · Bild ${lb.index} von ${count}` })),
    arrow('next'));
  if (focused) lightboxEl.querySelector<HTMLElement>(`[data-lb="${focused}"]`)?.focus({ preventScroll: true });
  // die Nachbarn schon vorladen
  if (count > 1) {
    loadShot(addon, (lb.index % count) + 1);
    loadShot(addon, ((lb.index - 2 + count) % count) + 1);
  }
}

// ---------- Versionsverlauf ----------

function historySection(addon: StoreListing): HTMLElement {
  const key = `${addon.id}@${addon.version}`;
  let entry = histories.get(key);
  if (!entry) {
    entry = { state: 'loading' };
    histories.set(key, entry);
    Promise.resolve().then(() => api.getAddonDetails(addon.id))
      .then((details) => histories.set(key, { state: 'ok', versions: Array.isArray(details?.versions) ? details.versions : [] }),
        (error) => histories.set(key, { state: 'error', message: errorMessage(error) }))
      .then(() => {
        if (view.open === addon.id) renderDrawer();
      });
  }
  const open = view.historyOpen;
  const toggle = h('button', { class: 'store-history-toggle', type: 'button', 'aria-expanded': String(open), 'data-focus': 'history' },
    h('span', { class: 'store-section-title', text: 'Versionsverlauf' }),
    h('span', { class: 'store-section-note', text: entry.state === 'ok' ? (entry.versions.length === 1 ? '1 Version' : `${entry.versions.length} Versionen`) : '' }),
    uiIcon('chevron-down', `store-history-chevron${open ? ' open' : ''}`));
  toggle.addEventListener('click', () => {
    view.historyOpen = !view.historyOpen;
    renderDrawer();
  });
  let content: HTMLElement | null = null;
  if (open) {
    if (entry.state === 'loading') {
      content = h('div', { class: 'store-history-loading', 'aria-label': 'Wird geladen' }, h('div', { class: 'store-bone line w60' }), h('div', { class: 'store-bone line w80' }));
    } else if (entry.state === 'error') {
      const retry = h('button', { class: 'link-button', type: 'button' }, 'Erneut versuchen');
      retry.addEventListener('click', () => {
        histories.delete(key);
        renderDrawer();
      });
      content = h('div', { class: 'store-history-error' }, h('span', { text: `Versionsverlauf nicht ladbar: ${entry.message}` }), retry);
    } else if (!entry.versions.length) {
      content = h('p', { class: 'hint', text: 'Keine Versionen gefunden.' });
    } else {
      content = h('ol', { class: 'store-history' }, ...entry.versions.map((version, index) => {
        const date = dateText(version.date);
        return h('li', {},
          h('div', { class: 'store-history-head' },
            h('strong', { text: version.version }),
            index === 0 ? h('span', { class: 'tag tag-type', text: 'Aktuell' }) : null,
            date ? h('span', { class: 'store-history-date', text: date }) : null),
          version.notes?.length ? h('ul', { class: 'store-changes' }, ...version.notes.map((note) => h('li', { text: note }))) : null);
      }));
    }
  }
  return h('section', { class: 'store-section store-history-section' }, toggle, content);
}

// ---------- Melden ----------

let reportEl: HTMLElement | null = null;

function closeReport(): void {
  reportEl?.remove();
  reportEl = null;
}

function openReport(addon: StoreListing): void {
  closeReport();
  let reason: AddonReportReason | null = null;
  const send = h('button', { class: 'danger solid', type: 'button' }, uiIcon('flag', 'btn-icon'), 'Melden');
  send.disabled = true;
  const options = h('div', { class: 'store-reasons', role: 'radiogroup', 'aria-label': 'Grund' },
    ...REPORT_REASONS.map(([value, label]) => {
      const input = h('input', { type: 'radio', name: 'store-report-reason', value });
      input.addEventListener('change', () => {
        reason = value;
        send.disabled = false;
      });
      return h('label', { class: 'store-reason' }, input, h('span', { text: label }));
    }));
  const note = h('textarea', { class: 'store-report-note', rows: '3', maxlength: '500', placeholder: 'Was ist dir aufgefallen? (optional)', spellcheck: 'true' });
  const counter = h('span', { class: 'store-report-count', text: '0 / 500' });
  note.addEventListener('input', () => {
    counter.textContent = `${note.value.length} / 500`;
  });
  const cancel = h('button', { class: 'ghost', type: 'button', text: 'Abbrechen' });
  cancel.addEventListener('click', closeReport);
  send.addEventListener('click', async () => {
    if (!reason) return;
    send.disabled = true;
    cancel.disabled = true;
    try {
      const text = note.value.trim();
      await api.reportAddon(addon.id, reason, text || undefined);
      closeReport();
      toast(`Danke! Das Team schaut sich ${addon.name} an.`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
      send.disabled = false;
      cancel.disabled = false;
    }
  });
  const backdrop = h('div', { class: 'modal-backdrop store-report-backdrop' },
    h('div', { class: 'modal small store-report', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${addon.name} melden` },
      h('div', {},
        h('h3', { class: 'modal-title', text: `${addon.name} melden` }),
        h('p', { class: 'modal-sub', text: 'Das HeldixClient-Team prüft jede Meldung und kann das Addon ausblenden.' })),
      options,
      h('label', { class: 'store-report-field' }, h('span', { text: 'Notiz' }), note, counter),
      h('div', { class: 'modal-actions' }, cancel, send)));
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeReport();
  });
  reportEl = backdrop;
  document.body.append(backdrop);
  backdrop.querySelector<HTMLInputElement>('input')?.focus();
}

async function copyHash(hash: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(hash);
    toast('Prüfsumme kopiert.', 'success');
  } catch {
    toast('Kopieren ging nicht – bitte von Hand markieren.', 'error');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------------------------------------

async function runAction(addon: StoreListing, instance: StoreInstance, action: Action): Promise<void> {
  const key = `${instance.id}/${addon.id}`;
  if (view.busy.has(key) || view.bulk) return;
  if (action === 'remove') {
    const ok = await confirmDialog(`${addon.name} entfernen?`,
      `Das Addon wird aus „${instance.name}“ gelöscht. Du kannst es jederzeit wieder aus dem Store installieren.`, 'Entfernen');
    if (!ok) return;
  }
  if (gameInstance() === instance.id) {
    toast(`„${instance.name}“ läuft gerade – Addons lassen sich erst nach dem Beenden ändern.`, 'error');
    return;
  }
  view.busy.set(key, action);
  render();
  try {
    if (action === 'remove') {
      await api.uninstallStoreAddon(instance.id, addon.id);
      toast(`${addon.name} ist aus „${instance.name}“ entfernt.`, 'success');
    } else {
      const name = await api.installStoreAddon(instance.id, addon.id);
      toast(action === 'update'
        ? `${name} ist in „${instance.name}“ auf ${addon.version} aktualisiert – aktiv ab dem nächsten Spielstart.`
        : `${name} ${addon.version} ist in „${instance.name}“ installiert – aktiv ab dem nächsten Spielstart.`, 'success');
    }
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    view.busy.delete(key);
  }
  await afterChange();
}

/** Alle Updates installieren (der Hauptprozess überspringt Instanzen, die gerade laufen) */
async function updateAll(): Promise<void> {
  if (view.bulk || view.busy.size) return;
  const blocked = gameInstance();
  const pairs = updatePairs();
  const jobs = pairs.filter((pair) => pair.instance.id !== blocked);
  if (!jobs.length) return;
  view.bulk = [...new Set(jobs.map((job) => job.addon.name))];
  render();
  try {
    const result = await api.updateAllAddons();
    const failed = Array.isArray(result?.failed) ? result.failed : [];
    const updated = Number(result?.updated) || 0;
    if (updated) toast(updated === 1 ? '1 Update installiert – aktiv ab dem nächsten Spielstart.' : `${updated} Updates installiert – aktiv ab dem nächsten Spielstart.`, 'success');
    if (failed.length) toast(`Nicht aktualisiert: ${failed.join(', ')}.`, 'error');
    if (!updated && !failed.length) toast('Es gab nichts zu aktualisieren.');
    const skipped = pairs.find((pair) => pair.instance.id === blocked);
    if (skipped) toast(`„${skipped.instance.name}“ läuft gerade – dort nach dem Beenden aktualisieren.`);
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    view.bulk = null;
  }
  render();
  await afterChange();
}

// ---------------------------------------------------------------------------------------------------------
// Einstieg (app.ts)
// ---------------------------------------------------------------------------------------------------------

let started = false;

function onKey(event: KeyboardEvent): void {
  if (reportEl && event.key === 'Escape') {
    closeReport();
    return;
  }
  if (view.lightbox) {
    if (event.key === 'Escape') closeLightbox();
    else if (event.key === 'ArrowLeft') stepLightbox(-1);
    else if (event.key === 'ArrowRight') stepLightbox(1);
    else return;
    event.preventDefault();
    return;
  }
  if (event.key !== 'Escape' || !view.open || !storeVisible()) return;
  // offene Dialoge (z. B. „Entfernen?“) zuerst
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  closeDrawer();
}

/** einmal beim Start */
export function initStore(): void {
  if (started) return;
  started = true;
  els();
  render();
  void refresh();
  on('instances', () => {
    if (!selfReload) scheduleRefresh();
  });
  on('game', () => render());
  api.onGameState((game) => {
    view.game = game;
    render();
  });
  // Hauptprozess: Zahl der Addons mit Update (Hintergrundprüfung beim Start und alle 6 h, nach Installieren usw.)
  if (typeof api.onStoreChanged === 'function') {
    api.onStoreChanged((updates) => {
      const n = Math.max(0, Math.floor(Number(updates) || 0));
      const differs = n !== updateCount();
      view.updates = n;
      renderBadge();
      // Neues aus der Hintergrundprüfung: Liste nachladen – nicht direkt nach der eigenen Abfrage (keine Schleife)
      if (differs && !running && Date.now() - lastLoad > 5000) scheduleRefresh();
    });
  }
  // Klick auf die Benachrichtigung „Addon-Updates verfügbar“ (app.ts zeigt danach die Seite, activateStore lädt neu)
  if (typeof api.onStoreOpen === 'function') api.onStoreOpen(() => showUpdatesFirst());
  document.addEventListener('keydown', onKey);
  // „Zurück“-Taste der Maus schließt Großansicht bzw. Details
  document.addEventListener('mouseup', (event) => {
    if (event.button !== 3 || !storeVisible()) return;
    if (view.lightbox) closeLightbox();
    else if (view.open && !document.querySelector('.modal-backdrop:not([hidden])')) closeDrawer();
  });
}

/** jedes Mal, wenn die Seite gezeigt wird */
export function activateStore(): void {
  initStore();
  render();
  void refresh();
}

/** Seite mit diesem Addon geöffnet zeigen (z. B. aus dem Instanz-Reiter „Mods & Addons“) */
export function openStoreAddon(id: string): void {
  initStore();
  if (findAddon(id)) {
    openDrawer(id);
    return;
  }
  view.pendingOpen = id;
  void refresh();
}
