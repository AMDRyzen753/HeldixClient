// Instanzen: Übersicht, Detailansicht („Mods & Addons“, Shader, Einstellungen), Hinzufügen (Addon-Store, Modrinth), neue Instanz
import type { ContentItem, GameState, InstanceInfo, InstanceLoader, ModrinthHit, ModrinthUpdate, QuickPlayTarget, ShaderpackList, StoreAddon, VersionInfo } from '../shared/api';
import {
  $,
  api,
  confirmDialog,
  emit,
  errorMessage,
  formatCount,
  formatDate,
  formatPlayTime,
  formatRelative,
  h,
  ICONS,
  instanceTile,
  LOADER_LABELS,
  on,
  reloadInstances,
  state,
  svgIcon,
  toast,
  uiIcon,
} from './core.js';
import { openStoreAddon } from './store.js';
import { openSetupsDialog, openShareDialog } from './setupshare.js';

const COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e'];
/** Reiter der Detailansicht; 'mods' und 'addons' (die früheren Reiter) öffnen „Mods & Addons“ */
export type DetailTab = 'content' | 'mods' | 'addons' | 'shaders' | 'settings';
type Tab = 'content' | 'shaders' | 'settings';
/** Wofür der Dialog gerade sucht: Addon-Store, Fabric-Mods von Modrinth oder Shaderpacks */
type BrowseMode = 'store' | 'mods' | 'shaders';
let browseMode: BrowseMode = 'mods';
/** zuletzt gewählte Quelle in „Hinzufügen“ (für das nächste Öffnen) */
let lastSource: 'store' | 'mods' | null = null;
let shaderList: ShaderpackList | null = null;

let detailId: string | null = null;
let detailTab: Tab = 'content';
let contentItems: ContentItem[] = [];
/** Instanz, zu der contentItems gehört */
let contentFor: string | null = null;

export function initInstances(showView: (view: string) => void): void {
  $('#new-instance').addEventListener('click', openNewInstance);
  $('#detail-back').addEventListener('click', () => closeDetail());
  $('#detail-play').addEventListener('click', () => {
    if (detailId) void launchInstance(detailId, showView);
  });
  $('#detail-folder').addEventListener('click', () => detailId && api.openFolder('instance', detailId));
  // Setup teilen (setupshare.ts): diese Instanz als Link; „Setups“ = Link öffnen und eigene verwalten
  $('#detail-share').addEventListener('click', () => detailId && openShareDialog(detailId));
  $('#open-setups').addEventListener('click', () => openSetupsDialog());
  document.querySelectorAll<HTMLButtonElement>('#detail-tabs button').forEach((button) =>
    button.addEventListener('click', () => switchTab(button.dataset.tab as Tab)));
  $('#content-filter').addEventListener('input', renderContent);
  document.querySelectorAll<HTMLButtonElement>('#content-filters button').forEach((button) =>
    button.addEventListener('click', () => {
      contentFilter = button.dataset.filter as ContentFilter;
      renderContent();
    }));
  $('#content-update-all').addEventListener('click', () => void updateAll());
  $('#content-add-file').addEventListener('click', () => void importFiles());
  $('#content-browse').addEventListener('click', () => openBrowser(defaultSource()));
  $('#content-perf').addEventListener('click', () => void installPerformance());
  $('#shader-browse').addEventListener('click', () => openBrowser('shaders'));
  $('#shader-folder').addEventListener('click', () => detailId && api.openFolder('shaderpacks', detailId));
  $('#shader-add-file').addEventListener('click', async () => {
    if (!detailId) return;
    try {
      const added = await api.addShaderpackFiles(detailId);
      if (added) toast(added === 1 ? 'Shaderpack hinzugefügt.' : `${added} Shaderpacks hinzugefügt.`, 'success');
      await loadShaders();
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  });
  setupDropzone();
  setupNewInstanceModal();
  setupModrinthModal();
  setupSettingsTab();
  setupInstancesToolbar();
  on('instances', () => {
    renderGrid();
    if (detailId) renderDetailHead();
  });
  api.onGameState((game) => onGameChanged(game));
}

export async function launchInstance(
  id: string,
  showView: (view: string) => void,
  target?: Pick<QuickPlayTarget, 'kind' | 'id'>,
): Promise<void> {
  if (!state.accounts.some((a) => a.active)) {
    toast('Bitte zuerst unten links ein Konto hinzufügen.', 'error');
    return;
  }
  await api.selectInstance(id);
  await reloadInstances();
  showView('home');
  try {
    await api.launch(id, target);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

// ---------- Übersicht ----------

type InstanceFilter = 'all' | 'heldix' | 'fabric' | 'vanilla';
type InstanceSort = 'recent' | 'name' | 'version' | 'created';
let instanceFilter: InstanceFilter = 'all';
let instanceQuery = '';
let instanceSort: InstanceSort = (() => {
  try {
    const saved = localStorage.getItem('heldix.instanceSort');
    return saved === 'name' || saved === 'version' || saved === 'created' ? saved : 'recent';
  } catch {
    return 'recent';
  }
})();

/** Minecraft-Versionen wie 26.3 oder 1.21.11 zahlenweise vergleichen (neueste zuerst) */
function compareMinecraft(a: string, b: string): number {
  const x = a.split(/[.\-]/).map((p) => Number.parseInt(p, 10) || 0);
  const y = b.split(/[.\-]/).map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (y[i] ?? 0) - (x[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function filteredInstances(): InstanceInfo[] {
  const query = instanceQuery.toLowerCase();
  const list = state.instances.filter((instance) => {
    if (instanceFilter === 'heldix' && !instance.heldixClient) return false;
    if ((instanceFilter === 'fabric' || instanceFilter === 'vanilla') && instance.loader !== instanceFilter) return false;
    return !query || instance.name.toLowerCase().includes(query) || instance.minecraft.includes(query) || LOADER_LABELS[instance.loader].toLowerCase().includes(query);
  });
  return list.sort((a, b) => {
    switch (instanceSort) {
      case 'name': return a.name.localeCompare(b.name, 'de');
      case 'version': return compareMinecraft(a.minecraft, b.minecraft) || a.name.localeCompare(b.name, 'de');
      case 'created': return b.created - a.created;
      default: return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.created - a.created;
    }
  });
}

function setupInstancesToolbar(): void {
  const search = $<HTMLInputElement>('#instance-search');
  search.addEventListener('input', () => {
    instanceQuery = search.value.trim();
    renderGrid();
  });
  document.querySelectorAll<HTMLButtonElement>('#instance-filter button').forEach((button) => {
    button.addEventListener('click', () => {
      instanceFilter = button.dataset.filter as InstanceFilter;
      document.querySelectorAll('#instance-filter button').forEach((b) => b.classList.toggle('active', b === button));
      renderGrid();
    });
  });
  const sort = $<HTMLSelectElement>('#instance-sort');
  sort.value = instanceSort;
  sort.addEventListener('change', () => {
    instanceSort = sort.value as InstanceSort;
    try {
      localStorage.setItem('heldix.instanceSort', instanceSort);
    } catch {
      // nur Komfort
    }
    renderGrid();
  });
}

function renderGrid(): void {
  const grid = $('#instance-grid');
  grid.textContent = '';
  // Werkzeugleiste erst ab zwei Instanzen; Filter mit Anzahl, leere Filter ausblenden
  $('#instances-toolbar').hidden = state.instances.length < 2;
  const counts: Record<InstanceFilter, number> = {
    all: state.instances.length,
    heldix: state.instances.filter((i) => i.heldixClient).length,
    fabric: state.instances.filter((i) => i.loader === 'fabric').length,
    vanilla: state.instances.filter((i) => i.loader === 'vanilla').length,
  };
  document.querySelectorAll<HTMLButtonElement>('#instance-filter button').forEach((button) => {
    const key = button.dataset.filter as InstanceFilter;
    button.hidden = key !== 'all' && counts[key] === 0;
    button.textContent = `${{ all: 'Alle', heldix: 'HeldixClient', fabric: 'Fabric', vanilla: 'Vanilla' }[key]} ${counts[key]}`;
  });
  if (instanceFilter !== 'all' && counts[instanceFilter] === 0) {
    instanceFilter = 'all';
    document.querySelectorAll('#instance-filter button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.filter === 'all'));
  }
  const shown = filteredInstances();
  if (shown.length === 0 && state.instances.length > 0) {
    grid.append(h('div', { class: 'instance-empty', text: 'Keine Instanz passt zur Suche.' }));
  }
  for (const instance of shown) {
    const selected = instance.id === state.settings?.selectedInstanceId;
    const card = h('div', { class: `instance-card${selected ? ' selected' : ''}`, onclick: () => openDetail(instance.id) },
      h('div', { class: 'instance-card-top' },
        instanceTile(instance, 'big'),
        selected ? h('span', { class: 'chip-selected', text: 'Ausgewählt' }) : null),
      h('div', { class: 'instance-card-name', text: instance.name }),
      h('div', { class: 'instance-card-meta' },
        h('span', { class: `loader-badge ${instance.loader}`, text: LOADER_LABELS[instance.loader] }),
        h('span', { text: `Minecraft ${instance.minecraft}` })),
      h('div', { class: 'instance-card-stats' },
        h('span', { text: formatRelative(instance.lastPlayed) }),
        instance.loader !== 'vanilla'
          ? h('span', {
            text: `${instance.modCount} ${instance.modCount === 1 ? 'Mod' : 'Mods'}${instance.heldixClient ? ` · ${instance.addonCount} ${instance.addonCount === 1 ? 'Addon' : 'Addons'}` : ''}`,
          })
          : null),
      h('button', {
        class: 'card-play',
        title: 'Spielen',
        onclick: (e: Event) => {
          e.stopPropagation();
          void launchInstance(instance.id, (v) => document.querySelector<HTMLButtonElement>(`[data-view="${v}"]`)?.click());
        },
      }, svgIcon(ICONS.play)));
    card.style.setProperty('--card-color', instance.color);
    grid.append(card);
  }
  grid.append(h('button', { class: 'instance-card add', onclick: openNewInstance },
    h('div', { class: 'add-icon' }, svgIcon(ICONS.plus)),
    h('div', { class: 'instance-card-name', text: 'Neue Instanz' }),
    h('div', { class: 'instance-card-stats', text: 'Heldix Loader, Fabric oder Vanilla' })));
}

// ---------- Detailansicht ----------

function current(): InstanceInfo | undefined {
  return state.instances.find((i) => i.id === detailId);
}

export function openDetail(id: string, tab?: DetailTab): void {
  detailId = id;
  $('#instances-overview').hidden = true;
  $('#instance-detail').hidden = false;
  const instance = current();
  const fallback: Tab = instance?.loader === 'vanilla' ? 'settings' : 'content';
  // frühere Reiter „Mods“ und „Heldix-Addons“ sind jetzt „Mods & Addons“; Vanilla hat keinen
  const wanted: Tab | undefined = tab === 'mods' || tab === 'addons' ? 'content' : tab;
  const allowed = wanted && !(instance?.loader === 'vanilla' && wanted === 'content');
  switchTab(allowed ? wanted : fallback);
  renderDetailHead();
}

function closeDetail(): void {
  detailId = null;
  $('#instance-detail').hidden = true;
  $('#instances-overview').hidden = false;
}

export function resetInstancesView(): void {
  if (detailId && !current()) closeDetail();
}

function renderDetailHead(): void {
  const instance = current();
  if (!instance) {
    closeDetail();
    return;
  }
  const tileHost = $('#detail-tile');
  tileHost.textContent = '';
  tileHost.append(instanceTile(instance, 'big'));
  $('#detail-name').textContent = instance.name;
  const meta = $('#detail-meta');
  meta.textContent = '';
  meta.append(
    h('span', { class: `loader-badge ${instance.loader}`, text: LOADER_LABELS[instance.loader] }),
    h('span', { text: `Minecraft ${instance.minecraft}` }),
    h('span', { text: formatRelative(instance.lastPlayed) }),
    h('span', { text: `Spielzeit ${formatPlayTime(instance.playTimeMs)}` }),
  );
  $<HTMLButtonElement>('#detail-tabs [data-tab="content"]').hidden = instance.loader === 'vanilla';
  renderSettingsTab();
  // HeldixClient in den Einstellungen ein- oder ausgeschaltet: Prüfungen und Quellen passen sich an
  if (detailTab === 'content' && contentFor === instance.id && contentKey !== contentKeyOf(instance)) void loadContent();
}

function switchTab(tab: Tab): void {
  detailTab = tab;
  document.querySelectorAll<HTMLButtonElement>('#detail-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-content').hidden = tab !== 'content';
  $('#tab-settings').hidden = tab !== 'settings';
  $('#tab-shaders').hidden = tab !== 'shaders';
  if (tab === 'shaders') void loadShaders();
  if (tab === 'content') {
    $<HTMLInputElement>('#content-filter').value = '';
    contentFilter = 'all';
    $('#content-perf').hidden = current()?.loader !== 'fabric';
    void loadContent();
  }
}

// ---------- Mods & Addons ----------
// Eine Liste für mods/ (Fabric-Mods, ältere Heldix-Mods) und heldix-addons/ (Heldix-Addons). Die Liste selbst kommt ohne
// Netz; Updates (Addon-Store, Modrinth) lädt loadExtras() danach und ergänzt die Zeilen.

type ContentFilter = 'all' | 'mods' | 'addons' | 'updates' | 'disabled';
const FILTER_LABELS: Record<ContentFilter, string> = { all: 'Alle', mods: 'Mods', addons: 'Addons', updates: 'Updates', disabled: 'Ausgeschaltet' };
let contentFilter: ContentFilter = 'all';
/** Stand, mit dem die Liste geladen wurde (Instanz, Loader, HeldixClient) */
let contentKey = '';
/** Addon-Store für diese Instanz (Updates, Icons, „Im Addon-Store öffnen“); null = nicht geladen oder nicht erreichbar */
let storeAddons: StoreAddon[] | null = null;
/** Modrinth-Updates je Datei */
let modrinthUpdates = new Map<string, ModrinthUpdate>();
/** für welche Instanz storeAddons und modrinthUpdates gelten */
let extrasFor: string | null = null;
/** während des Spiels geschaltete Addons: "instanz/ordner/datei" (ohne .disabled) → Zustand beim Spielstart */
const pendingRestart = new Map<string, boolean>();
/** laufende Updates (Schlüssel wie pendingRestart) */
const updating = new Set<string>();
let updatingAll = false;

/** Icons installierter Addons (Name aus dem Heldix-Icon-Set); der Addon-Store ergänzt sie */
const ADDON_ICONS: Record<string, string> = { spotify: 'music', uhrzeit: 'clock' };
const CATEGORY_LABELS: Record<StoreAddon['category'], string> = { hud: 'HUD', musik: 'Musik & Medien', chat: 'Chat & Freunde', werkzeuge: 'Werkzeuge', sonstiges: 'Sonstiges' };
const MINECRAFT_HINT = 'Verändert Minecraft direkt, nicht nur über die Heldix-API. Vom HeldixClient-Team geprüft (Store); An und Aus wirkt erst nach dem Neustart.';

function contentKeyOf(instance: InstanceInfo): string {
  return `${instance.id}:${instance.loader}:${instance.heldixClient}`;
}

/** Instanz, in der gerade ein Spiel startet oder läuft */
function runningInstanceOf(game: GameState): string | null {
  return game.state === 'preparing' || game.state === 'running' ? game.instanceId : null;
}

function runningHere(): boolean {
  return detailId != null && runningInstanceOf(state.game) === detailId;
}

function onGameChanged(game: GameState): void {
  const running = runningInstanceOf(game);
  // Spiel beendet: „Wirkt nach dem Neustart“ ist erledigt
  for (const key of [...pendingRestart.keys()]) if (!running || !key.startsWith(`${running}/`)) pendingRestart.delete(key);
  if (detailId && detailTab === 'content') {
    // state.game setzt app.ts – hier mit dem neuen Zustand zeichnen
    state.game = game;
    renderContent();
  }
}

const itemKey = (item: ContentItem) => `${detailId}/${item.kind}/${item.file.replace(/\.disabled$/, '')}`;

/** Addon (Heldix-Addon oder ältere Heldix-Mod) oder Mod (Fabric-Mod, vom Launcher verwaltet)? */
function isAddon(item: ContentItem): boolean {
  return !item.managed && (item.format === 'addon' || item.format === 'heldix-mod');
}

function storeEntry(item: ContentItem): StoreAddon | undefined {
  return item.kind === 'addons' && item.id && extrasFor === detailId ? storeAddons?.find((a) => a.id === item.id) : undefined;
}

type ItemUpdate = { source: 'store' | 'modrinth'; version: string; from: string | null };

function updateOf(item: ContentItem): ItemUpdate | null {
  if (extrasFor !== detailId) return null;
  const store = storeEntry(item);
  if (store?.state === 'update') return { source: 'store', version: store.version, from: store.installedVersion ?? item.version };
  const modrinth = item.kind === 'mods' ? modrinthUpdates.get(item.file) : undefined;
  return modrinth ? { source: 'modrinth', version: modrinth.version, from: item.version } : null;
}

function matchesFilter(item: ContentItem, filter: ContentFilter): boolean {
  switch (filter) {
    case 'mods': return !isAddon(item);
    case 'addons': return isAddon(item);
    case 'updates': return updateOf(item) != null;
    case 'disabled': return !item.enabled;
    default: return true;
  }
}

async function loadContent(extras = true): Promise<void> {
  const id = detailId;
  const instance = current();
  if (!id || !instance) return;
  const list = $('#content-list');
  if (contentFor !== id) {
    contentItems = [];
    list.replaceChildren(h('div', { class: 'content-empty', text: 'Lade …' }));
  }
  let items: ContentItem[] = [];
  try {
    items = await api.listInstanceContent(id);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  if (detailId !== id) return;
  contentItems = items;
  contentFor = id;
  contentKey = contentKeyOf(instance);
  renderContent();
  if (extras) void loadExtras();
}

/** Addon-Store (Updates, Icons) und Modrinth-Updates für die offene Instanz – Fehler stören die Liste nicht */
async function loadExtras(): Promise<void> {
  const instance = current();
  if (!instance || instance.loader === 'vanilla') return;
  const id = instance.id;
  const [store, modrinth] = await Promise.all([
    instance.heldixClient ? api.listStoreAddons(id).catch(() => null) : Promise.resolve([] as StoreAddon[]),
    instance.loader === 'fabric' ? api.listModrinthUpdates(id).catch(() => [] as ModrinthUpdate[]) : Promise.resolve([] as ModrinthUpdate[]),
  ]);
  if (detailId !== id) return;
  storeAddons = store;
  for (const addon of store ?? []) ADDON_ICONS[addon.id] = addon.icon;
  modrinthUpdates = new Map(modrinth.map((u) => [u.file, u]));
  extrasFor = id;
  renderContent();
}

function contentChip(kind: string, text: string, title?: string, icon?: string): HTMLElement {
  return h('span', { class: `content-chip ${kind}`, title }, icon ? uiIcon(icon, '') : null, text);
}

/** Hinweis über der Liste: was hier läuft, und während des Spiels, was jetzt geht */
function renderContentHint(instance: InstanceInfo, running: boolean): void {
  const hint = $('#content-hint');
  hint.classList.toggle('running', running);
  if (running) {
    hint.textContent = 'Die Instanz läuft gerade. Addons kannst du trotzdem an- und ausschalten – das wirkt nach dem Neustart. Mods lassen sich erst nach dem Beenden ändern.';
    return;
  }
  hint.textContent = instance.loader === 'heldix'
    ? 'Addons aus dem Addon-Store – oder .jar-Dateien hierher ziehen, der Launcher sortiert sie selbst ein. Addons nutzen die Heldix-API oder greifen direkt in Minecraft ein. Fabric-Mods laufen nur in Fabric-Instanzen.'
    : instance.heldixClient
      ? 'Fabric-Mods von Modrinth und Addons aus dem Addon-Store – oder .jar-Dateien hierher ziehen, der Launcher sortiert sie selbst ein. HeldixClient läuft hier über den Heldix Loader als Fabric-Mod mit.'
      : 'Fabric-Mods von Modrinth – oder .jar-Dateien hierher ziehen. Das Leistungs-Paket bringt Sodium, Lithium & Co. Für Addons HeldixClient unter Einstellungen einschalten.';
}

function renderContent(): void {
  const instance = current();
  const list = $('#content-list');
  if (!instance || contentFor !== instance.id) return;
  list.textContent = '';
  const running = runningHere();
  renderContentHint(instance, running);
  for (const [id, title] of [
    ['#content-add-file', 'JAR-Dateien hinzufügen – der Launcher sortiert Fabric-Mods und Heldix-Addons selbst ein'],
    ['#content-perf', 'Sodium, Lithium, FerriteCore und weitere Mods für mehr FPS'],
  ]) {
    const button = $<HTMLButtonElement>(id);
    button.disabled = running;
    button.title = running ? 'Erst das Spiel beenden' : title;
  }

  // Filter mit Anzahl; leere ausblenden (außer „Alle“ und dem gewählten)
  const counts = Object.fromEntries((Object.keys(FILTER_LABELS) as ContentFilter[]).map((key) => [key, contentItems.filter((item) => matchesFilter(item, key)).length])) as Record<ContentFilter, number>;
  if (contentFilter !== 'all' && counts[contentFilter] === 0) contentFilter = 'all';
  document.querySelectorAll<HTMLButtonElement>('#content-filters button').forEach((button) => {
    const key = button.dataset.filter as ContentFilter;
    button.hidden = key !== 'all' && counts[key] === 0;
    button.classList.toggle('active', key === contentFilter);
    button.setAttribute('aria-pressed', String(key === contentFilter));
    button.replaceChildren(FILTER_LABELS[key], h('span', { class: 'content-filter-count', text: String(counts[key]) }));
  });
  $('#content-filters').hidden = contentItems.length === 0;
  $('#content-count').textContent = contentItems.length ? `${contentItems.filter((i) => i.enabled).length} von ${contentItems.length} aktiv` : '';
  const updateAll = $<HTMLButtonElement>('#content-update-all');
  updateAll.hidden = counts.updates < 2;
  updateAll.disabled = running || updatingAll;
  updateAll.textContent = updatingAll ? 'Wird aktualisiert …' : `Alle ${counts.updates} aktualisieren`;

  const query = $<HTMLInputElement>('#content-filter').value.trim().toLowerCase();
  const items = contentItems.filter((item) => matchesFilter(item, contentFilter)
    && (!query || `${item.name} ${item.id ?? ''} ${item.description} ${item.file}`.toLowerCase().includes(query)));

  if (items.length === 0) {
    list.append(emptyContent(instance, query));
    return;
  }
  for (const item of items) list.append(contentRow(item, running));
}

function emptyContent(instance: InstanceInfo, query: string): HTMLElement {
  const fabric = instance.loader === 'fabric';
  let title: string;
  let text: string;
  if (query) {
    title = 'Nichts gefunden';
    text = 'Andere Suche probieren.';
  } else if (contentItems.length === 0) {
    title = 'Noch keine Mods und Addons';
    text = instance.loader === 'heldix'
      ? 'HeldixClient ist schon dabei. Über „Hinzufügen“ findest du Addons im Addon-Store.'
      : instance.heldixClient
        ? 'Über „Hinzufügen“ findest du Addons im Addon-Store und tausende Fabric-Mods auf Modrinth.'
        : 'Über „Hinzufügen“ findest du tausende Fabric-Mods auf Modrinth.';
  } else {
    title = 'Nichts in dieser Ansicht';
    text = fabric ? 'Andere Ansicht wählen oder über „Hinzufügen“ etwas Neues holen.' : 'Andere Ansicht wählen oder über „Hinzufügen“ Addons holen.';
  }
  return h('div', { class: 'content-empty' },
    uiIcon(query ? 'search' : 'addons', 'empty-icon'),
    h('div', { class: 'content-empty-title', text: title }),
    h('div', { text }));
}

function contentRow(item: ContentItem, running: boolean): HTMLElement {
  const addon = isAddon(item);
  const store = storeEntry(item);
  const update = updateOf(item);
  const key = itemKey(item);
  // Loader sagt nur der Store (die JAR weiß nicht, ob ihre Transformer in Fabric greifen)
  const loader = current()?.loader;
  const problem = item.error ?? (store && loader && loader !== 'vanilla' && !store.loaders.includes(loader)
    ? (store.loaders.includes('heldix') ? 'Läuft nur in Heldix-Instanzen' : 'Läuft nur in Fabric-Instanzen')
    : null);
  const iconName = item.kind === 'addons' && item.id ? ADDON_ICONS[item.id] : undefined;
  const icon = item.icon
    ? h('img', { class: 'content-icon', src: item.icon, alt: '' })
    : addon || iconName
      ? h('div', { class: `content-icon placeholder${item.id ? ` bundled-${item.id}` : ''}` }, uiIcon(iconName ?? 'addons'))
      : h('div', { class: 'content-icon placeholder', text: item.name.charAt(0).toUpperCase() });

  // Typ-Chips: was es ist und ob es in Minecraft eingreift
  const chips: HTMLElement[] = [];
  if (item.managed) chips.push(contentChip('managed', 'Verwaltet', 'Wird vom Launcher verwaltet und aktuell gehalten', 'lock'));
  if (item.format === 'fabric') chips.push(contentChip('fabric', 'Fabric-Mod'));
  else if (addon) chips.push(contentChip('addon', 'Addon', item.format === 'heldix-mod' ? 'Ältere Heldix-Mod (heldix.mod.json) – läuft weiter wie ein Addon' : 'Heldix-Addon'));
  if (addon && item.access === 'minecraft') chips.push(contentChip('minecraft', 'Greift in Minecraft ein', MINECRAFT_HINT));
  if (item.projectId) chips.push(contentChip('modrinth', 'Modrinth', 'Über Modrinth installiert'));
  if (update) chips.push(contentChip('update', `Update ${update.version}`, `${update.from ? `${update.from} → ${update.version}` : update.version} · neue Version ${update.source === 'store' ? 'im Addon-Store' : 'auf Modrinth'}`, 'refresh'));
  if (pendingRestart.has(key)) chips.push(contentChip('restart', 'Wirkt nach dem Neustart', 'Während des Spiels geändert – gilt ab dem nächsten Start', 'clock'));

  const toggle = h('input', { type: 'checkbox', class: 'switch' }) as HTMLInputElement;
  toggle.checked = item.enabled;
  // Addons lassen sich während des Spiels schalten (wirkt nach dem Neustart), Mods nicht
  const modLocked = running && item.kind === 'mods';
  toggle.disabled = item.managed || modLocked;
  toggle.title = item.managed ? 'Wird vom Launcher verwaltet' : modLocked ? 'Erst das Spiel beenden' : item.enabled ? 'Ausschalten' : 'Einschalten';
  toggle.addEventListener('change', () => void toggleItem(item, toggle));

  const remove = item.managed
    ? h('span', { class: 'managed-lock', title: 'Wird vom Launcher verwaltet' }, svgIcon(ICONS.lock))
    : h('button', { class: 'icon-button danger-hover', title: running ? 'Erst das Spiel beenden' : 'Löschen', disabled: running, onclick: () => void removeItem(item) }, svgIcon(ICONS.trash));

  const busy = updating.has(key) || updatingAll;
  const updateButton = update
    ? h('button', {
      class: 'ghost small content-update',
      type: 'button',
      disabled: running || busy,
      title: running ? 'Erst das Spiel beenden' : `Auf ${update.version} aktualisieren`,
      onclick: () => void updateItem(item),
    }, uiIcon('refresh', 'btn-icon'), busy && updating.has(key) ? 'Wird aktualisiert …' : 'Aktualisieren')
    : null;

  const meta: (string | HTMLElement)[] = [];
  if (item.authors.length) meta.push(`von ${item.authors.slice(0, 3).join(', ')}`);
  if (store) {
    if (meta.length) meta.push(' · ');
    meta.push(h('button', { class: 'link-button', type: 'button', onclick: () => openInStore(item.id!) }, 'Im Addon-Store öffnen'));
  }
  return h('div', { class: `content-row${item.enabled ? '' : ' disabled'}${problem ? ' broken' : ''}`, 'data-file': item.file },
    icon,
    h('div', { class: 'content-main' },
      h('div', { class: 'content-title' },
        h('span', { class: 'content-name', text: item.name }),
        item.version ? h('span', { class: 'content-version', text: item.version }) : null,
        ...chips),
      h('div', { class: 'content-desc', text: problem ?? (item.description || item.file), title: problem ?? item.description }),
      meta.length ? h('div', { class: 'content-authors' }, ...meta) : null),
    updateButton,
    toggle,
    remove);
}

/** Store-Seite mit diesem Addon (Screenshots, Bewertungen, Versionen) */
function openInStore(id: string): void {
  $('#modrinth-modal').hidden = true;
  document.querySelector<HTMLButtonElement>('.nav-item[data-view="store"]')?.click();
  openStoreAddon(id);
}

async function toggleItem(item: ContentItem, toggle: HTMLInputElement): Promise<void> {
  const running = runningHere();
  const key = itemKey(item);
  try {
    await api.setContentEnabled(detailId!, item.kind, item.file, toggle.checked);
    if (running) {
      // Zustand beim Spielstart merken: zurückgeschaltet = kein Hinweis mehr
      const before = pendingRestart.has(key) ? pendingRestart.get(key)! : item.enabled;
      if (before === toggle.checked) pendingRestart.delete(key);
      else pendingRestart.set(key, before);
      toast(`${item.name} ist ${toggle.checked ? 'eingeschaltet' : 'ausgeschaltet'} – wirkt nach dem Neustart.`);
    }
    await loadContent(false);
    await reloadInstances();
  } catch (error) {
    toggle.checked = !toggle.checked;
    toast(errorMessage(error), 'error');
  }
}

async function removeItem(item: ContentItem): Promise<void> {
  const what = isAddon(item) ? 'Addon' : 'Mod';
  if (!(await confirmDialog(`${what} löschen?`, `„${item.name}“ wird aus dieser Instanz entfernt.`, 'Löschen'))) return;
  try {
    await api.removeContent(detailId!, item.kind, item.file);
    toast(`${item.name} wurde entfernt.`, 'success');
    await loadContent(item.kind === 'addons');
    await reloadInstances();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

/** Ein Update: Addon aus dem Addon-Store neu installieren oder Modrinth-Mod tauschen */
async function runUpdate(item: ContentItem, update: ItemUpdate): Promise<boolean> {
  try {
    if (update.source === 'store') {
      const name = await api.installStoreAddon(detailId!, item.id!);
      toast(`${name} ist auf ${update.version} aktualisiert – aktiv ab dem nächsten Spielstart.`, 'success');
    } else {
      const result = await api.updateModrinthMod(detailId!, item.file);
      toast(`${result.title} ist auf ${result.version} aktualisiert.`, 'success');
      for (const note of result.notes) toast(note, 'info');
    }
    return true;
  } catch (error) {
    toast(errorMessage(error), 'error');
    return false;
  }
}

async function updateItem(item: ContentItem): Promise<void> {
  const update = updateOf(item);
  if (!update || !detailId) return;
  const key = itemKey(item);
  updating.add(key);
  renderContent();
  await runUpdate(item, update);
  updating.delete(key);
  await loadContent();
  await reloadInstances();
}

async function updateAll(): Promise<void> {
  if (!detailId || updatingAll) return;
  const jobs = contentItems.flatMap((item) => {
    const update = updateOf(item);
    return update ? [{ item, update }] : [];
  });
  updatingAll = true;
  renderContent();
  for (const { item, update } of jobs) await runUpdate(item, update);
  updatingAll = false;
  await loadContent();
  await reloadInstances();
}

/** „Datei hinzufügen“ und Drag & Drop: der Hauptprozess sortiert jede JAR nach ihrer Beschreibung ein */
async function importFiles(paths?: string[]): Promise<void> {
  if (!detailId) return;
  try {
    const result = await api.importContentFiles(detailId, paths);
    for (const error of result.errors) toast(error, 'error');
    if (result.added.length === 0) return;
    const as = (format: ContentItem['format']) => (format === 'fabric' ? 'Fabric-Mod' : format === 'heldix-mod' ? 'Addon (ältere Heldix-Mod)' : 'Addon');
    if (result.added.length === 1) {
      toast(`${result.added[0].name} ist als ${as(result.added[0].format)} hinzugefügt.`, 'success');
    } else {
      const addons = result.added.filter((a) => a.kind === 'addons').length;
      const mods = result.added.length - addons;
      const parts = [addons ? (addons === 1 ? '1 Addon' : `${addons} Addons`) : '', mods ? (mods === 1 ? '1 Mod' : `${mods} Mods`) : ''].filter(Boolean);
      toast(`${parts.join(' und ')} hinzugefügt.`, 'success');
    }
    await loadContent();
    await reloadInstances();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

function setupDropzone(): void {
  const zone = $('#tab-content');
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('dragging');
  });
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget as Node)) zone.classList.remove('dragging');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('dragging');
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) => f.name.toLowerCase().endsWith('.jar'));
    if (files.length === 0) {
      toast('Bitte nur .jar-Dateien ablegen (Fabric-Mods oder Heldix-Addons).', 'error');
      return;
    }
    void importFiles(files.map((f) => api.pathForFile(f)));
  });
}

// ---------- Einstellungen einer Instanz ----------

function setupSettingsTab(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-instance-folder]').forEach((button) => {
    button.addEventListener('click', () => {
      if (detailId) void api.openFolder(button.dataset.instanceFolder as 'saves' | 'mods' | 'addons' | 'logs', detailId);
    });
  });
  $('#is-name').addEventListener('change', async (event) => {
    const name = (event.target as HTMLInputElement).value.trim();
    if (!detailId || !name) return;
    await api.updateInstance(detailId, { name });
    await reloadInstances();
    toast('Name gespeichert.', 'success');
  });
  const range = $<HTMLInputElement>('#is-memory');
  const toggle = $<HTMLInputElement>('#is-memory-toggle');
  const updateLabel = () => ($('#is-memory-value').textContent = `${(Number(range.value) / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`);
  range.addEventListener('input', updateLabel);
  range.addEventListener('change', async () => {
    if (detailId && toggle.checked) await api.updateInstance(detailId, { memoryMb: Number(range.value) });
    await reloadInstances();
  });
  toggle.addEventListener('change', async () => {
    if (!detailId) return;
    $('#is-memory-row').classList.toggle('disabled', !toggle.checked);
    await api.updateInstance(detailId, { memoryMb: toggle.checked ? Number(range.value) : null });
    await reloadInstances();
  });
  $('#is-heldix-toggle').addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    if (!detailId) return;
    try {
      await api.updateInstance(detailId, { heldixClient: input.checked });
      await reloadInstances();
      toast(input.checked ? 'HeldixClient startet ab jetzt mit.' : 'Die Instanz startet ab jetzt ohne HeldixClient.', 'success');
    } catch (error) {
      input.checked = !input.checked;
      toast(errorMessage(error), 'error');
    }
  });
  $('#is-delete').addEventListener('click', async () => {
    const instance = current();
    if (!instance) return;
    const ok = await confirmDialog('Instanz löschen?', `„${instance.name}“ wird mit allen Welten, Mods und Einstellungen in den Papierkorb verschoben.`, 'In den Papierkorb');
    if (!ok) return;
    try {
      await api.deleteInstance(instance.id);
      closeDetail();
      await reloadInstances();
      toast(`${instance.name} wurde gelöscht.`, 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  });
}

function renderSettingsTab(): void {
  const instance = current();
  if (!instance) return;
  const name = $<HTMLInputElement>('#is-name');
  if (document.activeElement !== name) name.value = instance.name;
  const swatches = $('#is-colors');
  swatches.textContent = '';
  for (const color of COLORS) {
    const swatch = h('button', {
      class: `swatch${color === instance.color ? ' active' : ''}`,
      title: color,
      onclick: async () => {
        await api.updateInstance(instance.id, { color });
        await reloadInstances();
      },
    });
    swatch.style.setProperty('--swatch', color);
    swatches.append(swatch);
  }
  const totalMb = state.info?.totalMemoryMb ?? 8192;
  const range = $<HTMLInputElement>('#is-memory');
  range.max = String(Math.max(2048, Math.floor((totalMb * 0.75) / 512) * 512));
  range.value = String(instance.memoryMb ?? state.settings?.memoryMb ?? 4096);
  $<HTMLInputElement>('#is-memory-toggle').checked = instance.memoryMb != null;
  $('#is-memory-row').classList.toggle('disabled', instance.memoryMb == null);
  $('#is-memory-value').textContent = `${(Number(range.value) / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
  $('#is-heldix-card').hidden = instance.loader !== 'fabric';
  $<HTMLInputElement>('#is-heldix-toggle').checked = instance.heldixClient;
  $('#is-path').textContent = instance.path;
  $('#is-created').textContent = `Angelegt am ${formatDate(instance.created)}`;
}

// ---------- Modrinth ----------

let modrinthOffset = 0;
let modrinthTotal = 0;
let modrinthTimer: number | undefined;
/** im Dialog etwas installiert: beim Schließen die Liste neu laden */
let browserChanged = false;

// ---------- Leistungs-Paket (Fabric) ----------

async function installPerformance(): Promise<void> {
  if (!detailId) return;
  const button = $<HTMLButtonElement>('#content-perf');
  button.disabled = true;
  const label = button.lastChild!;
  label.textContent = 'Installiere …';
  try {
    const result = await api.installPerformancePack(detailId);
    const parts: string[] = [];
    if (result.installed.length) parts.push(`Installiert: ${result.installed.join(', ')}`);
    if (result.alreadyInstalled.length) parts.push(`schon da: ${result.alreadyInstalled.join(', ')}`);
    if (result.unavailable.length) parts.push(`noch nicht für diese Version: ${result.unavailable.join(', ')}`);
    toast(parts.join(' · ') || 'Nichts zu tun.', 'success');
    for (const note of result.notes) toast(note, 'info');
    await loadContent();
    await reloadInstances();
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    button.disabled = false;
    label.textContent = 'Leistungs-Paket';
  }
}

// ---------- Shaderpacks (Iris, nur Fabric-Instanzen) ----------

async function loadShaders(): Promise<void> {
  const instance = current();
  if (!detailId || !instance) return;
  const fabric = instance.loader === 'fabric';
  $('#shader-toolbar').hidden = !fabric;
  const status = $('#shader-status');
  status.className = 'shader-status';
  status.textContent = '';
  if (!fabric) {
    $('#shader-list').textContent = '';
    status.append(h('span', { class: 'status-icon' }, svgIcon(ICONS.sparkle)), h('div', {},
      h('strong', { text: instance.loader === 'heldix' ? 'Diese Instanz nutzt die Heldix-Shader' : 'Shaderpacks brauchen eine Fabric-Instanz' }),
      h('div', {
        text: instance.loader === 'heldix'
          ? 'Im Spiel: Heldix-Menü → Shader – Farbstile und die Shader-Engine (Bloom, Tiefenunschärfe, Nebel, Umgebungsverdeckung), mit Vulkan und OpenGL. Shaderpacks wie BSL oder Complementary brauchen Iris und laufen in Fabric-Instanzen: Lege dafür eine Fabric-Instanz an, dort findest du hier die Shaderpacks.'
          : 'Shaderpacks wie BSL oder Complementary laufen über Iris. Lege dafür eine Fabric-Instanz an; dort installiert der Launcher Iris und Sodium automatisch.',
      })));
    return;
  }
  try {
    shaderList = await api.listShaderpacks(detailId);
  } catch (error) {
    toast(errorMessage(error), 'error');
    return;
  }
  const ready = shaderList.irisInstalled && shaderList.sodiumInstalled;
  status.classList.toggle('ok', ready);
  status.append(h('span', { class: 'status-icon' }, svgIcon(ready ? ICONS.check : ICONS.sparkle)), h('div', {},
    h('strong', { text: ready ? 'Iris und Sodium sind installiert' : 'Shader mit Iris' }),
    h('div', {
      text: ready
        ? 'Wähle unten ein Shaderpack. Im Spiel änderst du Einstellungen unter Optionen → Grafik → Shaderpacks.'
        : 'Beim ersten Shaderpack installiert der Launcher Iris und Sodium automatisch von Modrinth.',
    })));
  renderShaders();
}

function renderShaders(): void {
  const list = $('#shader-list');
  list.textContent = '';
  const packs = shaderList?.packs ?? [];
  $('#shader-count').textContent = packs.length ? `${packs.length} ${packs.length === 1 ? 'Shaderpack' : 'Shaderpacks'}${shaderList?.active ? ' · 1 aktiv' : ' · aus'}` : '';
  if (packs.length === 0) {
    list.append(h('div', { class: 'content-empty' },
      svgIcon(ICONS.sparkle, 'empty-icon'),
      h('div', { class: 'content-empty-title', text: 'Noch keine Shaderpacks' }),
      h('div', { text: 'Über „Shaderpacks entdecken“ findest du BSL, Complementary, Photon und viele mehr.' })));
    return;
  }
  for (const pack of packs) {
    const toggle = h('input', { type: 'checkbox', class: 'switch', title: pack.active ? 'Ausschalten' : 'Einschalten' }) as HTMLInputElement;
    toggle.checked = pack.active;
    toggle.addEventListener('change', async () => {
      try {
        await api.setActiveShaderpack(detailId!, toggle.checked ? pack.file : null);
        await loadShaders();
      } catch (error) {
        toggle.checked = !toggle.checked;
        toast(errorMessage(error), 'error');
      }
    });
    const remove = h('button', {
      class: 'icon-button danger-hover',
      title: 'Löschen',
      onclick: async () => {
        if (!(await confirmDialog(`${pack.name} löschen?`, 'Das Shaderpack wird aus dieser Instanz entfernt.', 'Löschen'))) return;
        try {
          await api.removeShaderpack(detailId!, pack.file);
          await loadShaders();
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      },
    }, svgIcon(ICONS.trash));
    const size = pack.sizeBytes == null ? 'Ordner' : `${(pack.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
    list.append(h('div', { class: `content-row${pack.active ? ' active-pack' : ''}` },
      h('div', { class: 'content-icon placeholder', text: pack.name.charAt(0).toUpperCase() }),
      h('div', { class: 'content-main' },
        h('div', { class: 'content-title' },
          h('span', { class: 'content-name', text: pack.name }),
          pack.active ? h('span', { class: 'tag tag-type', text: 'AKTIV' }) : null,
          pack.projectId ? h('span', { class: 'tag tag-modrinth', text: 'MODRINTH' }) : null),
        h('div', { class: 'content-desc', text: `${pack.file} · ${size}` })),
      toggle,
      remove));
  }
}

// ---------- Hinzufügen: Addon-Store und Modrinth (Modrinth nur in Fabric-Instanzen); derselbe Dialog sucht Shaderpacks ----------

/** Store-Liste im Dialog (null = noch nicht geladen) und ob nicht passende Addons zu sehen sind */
let browserStore: StoreAddon[] | null = null;
let browserStoreError: string | null = null;
let showUnfit = false;

function setupModrinthModal(): void {
  const modal = $('#modrinth-modal');
  const close = async () => {
    modal.hidden = true;
    window.clearTimeout(modrinthTimer);
    if (browserChanged) {
      browserChanged = false;
      if (browseMode === 'shaders') await loadShaders();
      else await loadContent();
      await reloadInstances();
    }
  };
  $('#mr-close').addEventListener('click', () => void close());
  modal.addEventListener('click', (event) => event.target === modal && void close());
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') void close();
  });
  $('#mr-query').addEventListener('input', () => {
    window.clearTimeout(modrinthTimer);
    if (browseMode === 'store') renderStoreBrowser();
    else modrinthTimer = window.setTimeout(() => void searchModrinth(true), 300);
  });
  $('#mr-more').addEventListener('click', () => void searchModrinth(false));
  document.querySelectorAll<HTMLButtonElement>('#mr-sources button').forEach((button) =>
    button.addEventListener('click', () => {
      const source = button.dataset.source as 'store' | 'mods';
      if (source !== browseMode) {
        $<HTMLInputElement>('#mr-query').value = '';
        showSource(source);
      }
    }));
}

/** Quelle beim Öffnen: passend zum Filter, sonst die zuletzt gewählte, sonst der Addon-Store (mit HeldixClient) */
function defaultSource(): 'store' | 'mods' {
  const instance = current();
  if (instance?.loader !== 'fabric') return 'store';
  if (contentFilter === 'mods') return 'mods';
  if (contentFilter === 'addons') return 'store';
  return lastSource ?? (instance.heldixClient ? 'store' : 'mods');
}

function openBrowser(mode: BrowseMode): void {
  const instance = current();
  if (!instance) return;
  browserChanged = false;
  browserStore = null;
  browserStoreError = null;
  showUnfit = false;
  $<HTMLInputElement>('#mr-query').value = '';
  $('#modrinth-modal').hidden = false;
  showSource(mode);
}

function showSource(mode: BrowseMode): void {
  const instance = current();
  if (!instance) return;
  browseMode = mode;
  if (mode !== 'shaders') lastSource = mode;
  const shaders = mode === 'shaders';
  // Umschalter nur, wenn es beide Quellen gibt (Modrinth-Mods laufen nur in Fabric-Instanzen)
  $('#mr-sources').hidden = shaders || instance.loader !== 'fabric';
  document.querySelectorAll<HTMLButtonElement>('#mr-sources button').forEach((b) => {
    b.classList.toggle('active', b.dataset.source === mode);
    b.setAttribute('aria-pressed', String(b.dataset.source === mode));
  });
  $('#mr-title').textContent = shaders ? 'Shaderpacks entdecken' : 'Mods & Addons hinzufügen';
  $('#mr-sub').textContent = `für ${instance.name} · Minecraft ${instance.minecraft} · ${
    shaders ? 'Iris · von Modrinth' : mode === 'store' ? 'Addon-Store, geprüft und signiert vom HeldixClient-Team' : 'Fabric-Mods von Modrinth'}`;
  $<HTMLInputElement>('#mr-query').placeholder = shaders ? 'z. B. BSL, Complementary, Photon …' : mode === 'store' ? 'Addons durchsuchen …' : 'z. B. Sodium, Iris, Mod Menu …';
  $('#mr-list').textContent = '';
  $('#mr-more').hidden = true;
  $<HTMLInputElement>('#mr-query').focus();
  if (mode === 'store') void loadStoreBrowser();
  else void searchModrinth(true);
}

function storeMessage(icon: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'store-message' }, uiIcon(icon), h('span', { text }), action ?? null);
}

async function loadStoreBrowser(): Promise<void> {
  const instance = current();
  if (!instance) return;
  const id = instance.id;
  const list = $('#mr-list');
  if (!instance.heldixClient) {
    const settings = h('button', { class: 'ghost small', type: 'button' }, uiIcon('options', 'btn-icon'), 'Zu den Einstellungen');
    settings.addEventListener('click', () => {
      $('#modrinth-modal').hidden = true;
      switchTab('settings');
    });
    list.replaceChildren(storeMessage('info', 'Addons laufen mit HeldixClient. Schalte HeldixClient unter Einstellungen dieser Instanz ein – dann findest du hier die Addons aus dem Addon-Store.', settings));
    return;
  }
  if (!browserStore) {
    list.replaceChildren(h('div', { class: 'content-empty', text: 'Lade den Addon-Store …' }));
    try {
      browserStore = await api.listStoreAddons(id);
      browserStoreError = null;
      for (const addon of browserStore) ADDON_ICONS[addon.id] = addon.icon;
    } catch (error) {
      browserStoreError = errorMessage(error);
    }
  }
  if (browseMode !== 'store' || detailId !== id) return;
  renderStoreBrowser();
}

const STATE_ORDER: Record<StoreAddon['state'], number> = {
  update: 0, available: 1, installed: 2, 'unsupported-minecraft': 3, 'unsupported-loader': 4, 'unsupported-platform': 5, 'unsupported-api': 6,
};
const unfit = (addon: StoreAddon) => addon.state.startsWith('unsupported-');

/** Store-Addons für diese Instanz: passende zuerst (Updates, neue, installierte), nicht passende auf Wunsch */
function renderStoreBrowser(): void {
  const list = $('#mr-list');
  list.textContent = '';
  $('#mr-more').hidden = true;
  if (browserStoreError) {
    const retry = h('button', { class: 'ghost small', type: 'button' }, uiIcon('refresh', 'btn-icon'), 'Erneut versuchen');
    retry.addEventListener('click', () => {
      browserStoreError = null;
      void loadStoreBrowser();
    });
    list.append(storeMessage('warning', browserStoreError, retry));
    return;
  }
  const all = browserStore ?? [];
  if (all.length === 0) {
    list.append(storeMessage('addons', 'Im Addon-Store gibt es gerade keine Addons.'));
    return;
  }
  const terms = $<HTMLInputElement>('#mr-query').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = (a: StoreAddon) => [a.name, a.id, a.summary, CATEGORY_LABELS[a.category], ...a.authors, a.access === 'minecraft' ? 'greift in minecraft ein' : ''].join(' ').toLowerCase();
  const matching = all
    .filter((addon) => terms.every((term) => text(addon).includes(term)))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.downloads - a.downloads || a.name.localeCompare(b.name, 'de'));
  const hidden = matching.filter(unfit);
  const shown = showUnfit ? matching : matching.filter((addon) => !unfit(addon));
  for (const addon of shown) list.append(storeRow(addon));
  if (shown.length === 0) {
    list.append(h('div', { class: 'content-empty', text: terms.length ? 'Keine passenden Addons gefunden.' : 'Für diese Instanz gibt es gerade keine passenden Addons.' }));
  }
  if (hidden.length) {
    const toggle = h('button', { class: 'link-button mr-unfit', type: 'button' },
      showUnfit
        ? 'Nicht passende ausblenden'
        : `${hidden.length === 1 ? '1 weiteres Addon passt' : `${hidden.length} weitere Addons passen`} nicht zu dieser Instanz – anzeigen`);
    toggle.addEventListener('click', () => {
      showUnfit = !showUnfit;
      renderStoreBrowser();
    });
    list.append(toggle);
  }
}

function storeRow(addon: StoreAddon): HTMLElement {
  const running = runningHere();
  const update = addon.state === 'update';
  const installed = addon.state === 'installed';
  const blocked = unfit(addon);
  const label = h('span', { text: update ? 'Aktualisieren' : installed ? 'Installiert' : blocked ? 'Nicht verfügbar' : 'Installieren' });
  const button = h('button', { class: installed ? 'ghost installed' : blocked ? 'ghost' : 'primary', type: 'button' },
    uiIcon(update ? 'refresh' : installed ? 'check' : blocked ? 'ban' : 'download', 'btn-icon'), label) as HTMLButtonElement;
  button.disabled = installed || blocked || running;
  if (blocked && addon.reason) button.title = addon.reason;
  else if (running && !installed) button.title = 'Die Instanz läuft gerade – nach dem Beenden installieren oder im Spiel über das Heldix-Menü → Mods & Addons.';
  button.addEventListener('click', async () => {
    button.disabled = true;
    label.textContent = update ? 'Wird aktualisiert …' : 'Wird installiert …';
    try {
      const name = await api.installStoreAddon(detailId!, addon.id);
      browserChanged = true;
      toast(update ? `${name} ist auf ${addon.version} aktualisiert – aktiv ab dem nächsten Spielstart.` : `${name} ${addon.version} ist installiert und beim nächsten Spielstart dabei.`, 'success');
      browserStore = null;
      await loadStoreBrowser();
    } catch (error) {
      button.disabled = false;
      label.textContent = update ? 'Aktualisieren' : 'Installieren';
      toast(errorMessage(error), 'error');
    }
  });
  const version = update && addon.installedVersion ? `${addon.installedVersion} → ${addon.version}` : addon.version;
  const details = h('button', { class: 'link-button', type: 'button', onclick: () => openInStore(addon.id) }, 'Details im Addon-Store');
  return h('div', { class: `content-row${blocked ? ' unfit' : ''}` },
    h('div', { class: `content-icon placeholder bundled-${addon.id}` }, uiIcon(addon.icon)),
    h('div', { class: 'content-main' },
      h('div', { class: 'content-title' },
        h('span', { class: 'content-name', text: addon.name }),
        h('span', { class: 'content-version', text: version }),
        addon.access === 'minecraft' ? contentChip('minecraft', 'Greift in Minecraft ein', MINECRAFT_HINT) : null,
        addon.minecraft.length ? contentChip('neutral', `Minecraft ${addon.minecraft.length > 3 ? `${addon.minecraft.slice(0, 2).join(', ')} +${addon.minecraft.length - 2}` : addon.minecraft.join(', ')}`, `Läuft mit Minecraft ${addon.minecraft.join(', ')}`) : null,
        installed && addon.installedEnabled === false ? contentChip('neutral', 'Ausgeschaltet') : null,
        // installiert, passt aber nicht (mehr) zur Instanz
        installed && addon.reason ? contentChip('restart', addon.reason, 'Läuft in dieser Instanz nicht', 'warning') : null),
      h('div', { class: 'content-desc', text: addon.summary }),
      h('div', { class: 'content-authors' },
        blocked && addon.reason ? h('span', { class: 'mr-reason' }, uiIcon('ban', 'inline-icon'), addon.reason) : null,
        blocked && addon.reason ? ' · ' : null,
        `${CATEGORY_LABELS[addon.category] ?? 'Sonstiges'} · von ${addon.authors.join(', ')} · ${addon.downloads === 1 ? '1 Download' : `${formatCount(addon.downloads)} Downloads`} · `,
        details)),
    button);
}

async function searchModrinth(reset: boolean): Promise<void> {
  if (!detailId || browseMode === 'store') return;
  const mode = browseMode;
  const list = $('#mr-list');
  if (reset) {
    modrinthOffset = 0;
    list.textContent = '';
    list.append(h('div', { class: 'content-empty', text: 'Suche …' }));
  }
  try {
    const query = $<HTMLInputElement>('#mr-query').value;
    const result = mode === 'shaders'
      ? await api.searchShaderpacks(detailId, query, modrinthOffset)
      : await api.searchModrinth(detailId, query, modrinthOffset);
    if (browseMode !== mode) return;
    if (reset) list.textContent = '';
    modrinthTotal = result.total;
    modrinthOffset = result.offset + 20;
    if (result.hits.length === 0 && reset) list.append(h('div', { class: 'content-empty', text: mode === 'shaders' ? 'Keine passenden Shaderpacks gefunden.' : 'Keine passenden Mods gefunden.' }));
    for (const hit of result.hits) list.append(modrinthRow(hit));
  } catch (error) {
    if (browseMode !== mode) return;
    if (reset) list.textContent = '';
    list.append(h('div', { class: 'content-empty', text: `Modrinth nicht erreichbar: ${errorMessage(error)}` }));
  }
  $('#mr-more').hidden = modrinthOffset >= modrinthTotal;
}

function modrinthRow(hit: ModrinthHit): HTMLElement {
  const button = h('button', { class: hit.installed ? 'ghost installed' : 'primary' },
    svgIcon(hit.installed ? ICONS.check : ICONS.download),
    hit.installed ? 'Installiert' : 'Installieren') as HTMLButtonElement;
  button.disabled = hit.installed;
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.lastChild!.textContent = 'Installiere …';
    try {
      if (browseMode === 'shaders') {
        const result = await api.installShaderpack(detailId!, hit.projectId);
        browserChanged = true;
        button.className = 'ghost installed';
        button.replaceChildren(svgIcon(ICONS.check), 'Aktiv');
        const extra = result.mods.length ? ` Dazu installiert: ${result.mods.join(', ')}.` : '';
        toast(`${result.title} ist installiert und eingeschaltet.${extra}`, 'success');
        for (const note of result.notes) toast(note, 'info');
        return;
      }
      const installed = await api.installModrinth(detailId!, hit.projectId);
      browserChanged = true;
      button.className = 'ghost installed';
      button.replaceChildren(svgIcon(ICONS.check), 'Installiert');
      const extra = installed.length > 1 ? ` (inkl. ${installed.slice(1).join(', ')})` : '';
      toast(installed.length ? `${hit.title} installiert${extra}.` : `${hit.title} ist schon installiert.`, 'success');
    } catch (error) {
      button.disabled = false;
      button.lastChild!.textContent = 'Installieren';
      toast(errorMessage(error), 'error');
    }
  });
  const icon = hit.iconUrl
    ? h('img', { class: 'content-icon', src: hit.iconUrl, alt: '', loading: 'lazy' })
    : h('div', { class: 'content-icon placeholder', text: hit.title.charAt(0).toUpperCase() });
  return h('div', { class: 'content-row' },
    icon,
    h('div', { class: 'content-main' },
      h('div', { class: 'content-title' },
        h('span', { class: 'content-name', text: hit.title }),
        h('span', { class: 'content-version', text: `von ${hit.author}` })),
      h('div', { class: 'content-desc', text: hit.description }),
      h('div', { class: 'content-authors' }, svgIcon(ICONS.download, 'inline-icon'), `${formatCount(hit.downloads)} Downloads`)),
    button);
}

// ---------- Neue Instanz ----------
// Ablauf: 1. Loader (große Karten), 2. Version (nur passende), 3. Name, Farbe und Optionen des Loaders.

type VersionTab = 'release' | 'snapshot' | 'old';
let niVersion: string | null = null;
let niLoader: InstanceLoader = 'heldix';
let niColor = COLORS[0];
let niTab: VersionTab = 'release';
let niNameTouched = false;
/** Fabric: HeldixClient mitinstallieren / Leistungs-Paket gleich mit anlegen */
let niWithHeldix = true;
let niWithPerformance = true;

const PERFORMANCE_PACK = 'Sodium, Lithium, FerriteCore, ImmediatelyFast, Entity Culling, More Culling';

function setupNewInstanceModal(): void {
  const modal = $('#new-instance-modal');
  const close = () => (modal.hidden = true);
  $('#ni-cancel').addEventListener('click', close);
  $('#ni-close').addEventListener('click', close);
  modal.addEventListener('click', (event) => event.target === modal && close());
  $('#ni-name').addEventListener('input', () => {
    // Leeres Feld = wieder automatisch benennen
    niNameTouched = $<HTMLInputElement>('#ni-name').value.trim() !== '';
    renderNiSummary();
  });
  $('#ni-name').addEventListener('blur', () => {
    if (!niNameTouched) autoName();
  });
  $('#ni-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') void createInstance();
  });
  $('#ni-filter').addEventListener('input', renderNiVersions);
  document.querySelectorAll<HTMLButtonElement>('#ni-tabs button').forEach((button) =>
    button.addEventListener('click', () => {
      niTab = button.dataset.tab as VersionTab;
      renderNiVersions();
    }));
  document.querySelectorAll<HTMLButtonElement>('#ni-loaders .ni-loader').forEach((card) =>
    card.addEventListener('click', () => {
      if (card.classList.contains('unavailable')) return;
      selectNiLoader(card.dataset.loader as InstanceLoader);
    }));
  $('#ni-create').addEventListener('click', createInstance);
}

/** Versionen, die ein Loader unterstützt */
function supports(loader: InstanceLoader, v: VersionInfo): boolean {
  return loader === 'heldix' ? v.clientMod : loader === 'fabric' ? v.fabric : true;
}

function tabOf(v: VersionInfo): VersionTab {
  return v.type === 'release' ? 'release' : v.type === 'snapshot' ? 'snapshot' : 'old';
}

/** Loader wählen: Version behalten, wenn sie passt, sonst die neueste passende Vollversion nehmen */
function selectNiLoader(loader: InstanceLoader): void {
  niLoader = loader;
  const versions = state.versions?.versions ?? [];
  const current = niSelected();
  if (!current || !supports(loader, current)) {
    const next = versions.find((v) => supports(loader, v) && v.type === 'release') ?? versions.find((v) => supports(loader, v));
    niVersion = next?.id ?? null;
    if (next) niTab = tabOf(next);
  }
  renderNiLoaders();
  renderNiVersions();
  autoName();
  renderNiOptions();
  renderNiSummary();
}

function openNewInstance(): void {
  const versions = state.versions?.versions ?? [];
  niVersion = null;
  niColor = COLORS[state.instances.length % COLORS.length];
  niTab = 'release';
  niNameTouched = false;
  niWithHeldix = true;
  niWithPerformance = true;
  $<HTMLInputElement>('#ni-filter').value = '';
  $<HTMLInputElement>('#ni-name').value = '';
  renderNiColors();
  selectNiLoader(versions.some((v) => v.clientMod) ? 'heldix' : 'fabric');
  $('#new-instance-modal').hidden = false;
  $<HTMLInputElement>('#ni-filter').focus();
}

function niSelected(): VersionInfo | undefined {
  return state.versions?.versions.find((v) => v.id === niVersion);
}

/** „Minecraft 1.14 bis 26.3“ – welche Vollversionen ein Loader abdeckt */
function versionRange(loader: InstanceLoader): string {
  const releases = (state.versions?.versions ?? []).filter((v) => v.type === 'release' && supports(loader, v));
  if (releases.length === 0) return 'zurzeit keine Version';
  const newest = releases[0].id;
  const oldest = releases[releases.length - 1].id;
  if (newest === oldest) return `Minecraft ${newest}`;
  return `${releases.length} Versionen · ${oldest} bis ${newest}`;
}

function renderNiLoaders(): void {
  const versions = state.versions?.versions ?? [];
  document.querySelectorAll<HTMLElement>('#ni-loaders .ni-loader').forEach((card) => {
    const loader = card.dataset.loader as InstanceLoader;
    const available = versions.some((v) => supports(loader, v));
    card.classList.toggle('active', loader === niLoader);
    card.classList.toggle('unavailable', !available);
    card.setAttribute('aria-pressed', String(loader === niLoader));
    card.querySelector('.ni-loader-range')!.textContent = versionRange(loader);
  });
}

function renderNiVersions(): void {
  const list = $('#ni-versions');
  list.textContent = '';
  const query = $<HTMLInputElement>('#ni-filter').value.trim().toLowerCase();
  const all = (state.versions?.versions ?? []).filter((v) => supports(niLoader, v));
  // Reiter ohne passende Versionen ausblenden (z. B. „Alt“ bei Fabric)
  document.querySelectorAll<HTMLButtonElement>('#ni-tabs button').forEach((b) => {
    const tab = b.dataset.tab as VersionTab;
    const count = all.filter((v) => tabOf(v) === tab).length;
    b.hidden = count === 0;
    b.classList.toggle('active', tab === niTab);
  });
  if (!all.some((v) => tabOf(v) === niTab) && all.length) niTab = tabOf(all[0]);
  document.querySelectorAll<HTMLButtonElement>('#ni-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === niTab));

  const versions = all.filter((v) => tabOf(v) === niTab && (!query || v.id.toLowerCase().includes(query)));
  $('#ni-version-count').textContent = versions.length === 1 ? '1 Version' : `${versions.length} Versionen`;
  const latest = state.versions?.latestRelease;
  for (const v of versions.slice(0, 200)) {
    list.append(h('div', {
      class: `version-item${v.id === niVersion ? ' selected' : ''}`,
      onclick: () => {
        niVersion = v.id;
        renderNiVersions();
        autoName();
        renderNiOptions();
        renderNiSummary();
      },
    },
    h('span', { class: 'version-item-id', text: v.id }),
    v.id === latest ? h('span', { class: 'tag tag-type', text: 'Neueste' }) : null,
    niLoader === 'fabric' && v.clientMod ? h('span', { class: 'tag tag-heldix', text: 'HeldixClient' }) : null,
    h('span', { class: 'version-item-date', text: formatDate(v.releaseTime) }),
    v.id === niVersion ? svgIcon(ICONS.check, 'version-item-check') : null));
  }
  if (versions.length === 0) {
    list.append(h('div', { class: 'version-empty', text: query ? `Keine Version passt zu „${query}“.` : 'Für diesen Loader gibt es hier keine Version.' }));
  }
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function renderNiColors(): void {
  const host = $('#ni-colors');
  host.textContent = '';
  for (const color of COLORS) {
    const swatch = h('button', {
      class: `swatch${color === niColor ? ' active' : ''}`,
      type: 'button',
      title: 'Farbe wählen',
      onclick: () => {
        niColor = color;
        renderNiColors();
        renderNiSummary();
      },
    });
    swatch.style.setProperty('--swatch', color);
    host.append(swatch);
  }
}

/** Schalter-Zeile für die Optionen */
function optionRow(label: string, sub: string, checked: boolean, disabled: boolean, onchange: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', class: 'switch' }) as HTMLInputElement;
  input.checked = checked;
  input.disabled = disabled;
  input.addEventListener('change', () => onchange(input.checked));
  return h('label', { class: `toggle-row ni-option${disabled ? ' disabled' : ''}`, title: sub },
    h('span', {}, label, h('small', { class: 'toggle-sub', text: sub })),
    input);
}

/** Optionen je nach Loader: Fabric mit HeldixClient und Leistungs-Paket, Heldix mit Überblick, Vanilla mit Hinweis */
function renderNiOptions(): void {
  const host = $('#ni-options');
  host.textContent = '';
  const version = niSelected();
  if (niLoader === 'fabric') {
    const clientAvailable = Boolean(version?.clientMod);
    host.append(
      optionRow('HeldixClient mitinstallieren',
        clientAvailable ? 'HUD, Heldix-Menü, Zoom und Addons zu deinen Fabric-Mods' : `Für Minecraft ${niVersion ?? ''} gibt es noch keine HeldixClient-Mod`,
        clientAvailable && niWithHeldix, !clientAvailable, (value) => {
          niWithHeldix = value;
          renderNiSummary();
        }),
      optionRow('Leistungs-Paket installieren', 'Sodium, Lithium, FerriteCore und weitere Mods für mehr FPS', niWithPerformance, false, (value) => {
        niWithPerformance = value;
        renderNiSummary();
      }));
    return;
  }
  const features = niLoader === 'heldix'
    ? ['HUD-Module, Zoom und Heldix-Menü', 'Heldix-Shader mit Bloom und SSAO', 'Heldix-Addons und eigenes Design im Spiel']
    : ['Unverändertes Minecraft', 'Ideal für Vergleiche und ältere Versionen', 'Mods lassen sich nicht hinzufügen'];
  host.append(h('div', { class: 'ni-features' },
    ...features.map((text) => h('div', { class: 'ni-feature' }, svgIcon(ICONS.check, 'ni-feature-icon'), h('span', { text })))));
}

/** Eingegebener Name oder – wenn leer – der automatische Vorschlag. */
function niName(): string {
  const input = $<HTMLInputElement>('#ni-name');
  return input.value.trim() || input.placeholder;
}

/** Vorschau-Karte (wie in der Übersicht) und Zusammenfassung unten. */
function renderNiSummary(): void {
  const name = niName();
  const preview = $('#ni-preview');
  preview.textContent = '';
  preview.append(instanceTile({ color: niColor, loader: niLoader, name }, 'medium'));
  $('#ni-identity').style.setProperty('--card-color', niColor);
  const meta = $('#ni-identity-meta');
  meta.textContent = '';
  meta.append(
    h('span', { class: `loader-badge ${niLoader}`, text: LOADER_LABELS[niLoader] }),
    h('span', { text: niVersion ? `Minecraft ${niVersion}` : 'keine Version' }));

  const extras: string[] = [];
  if (niLoader === 'fabric' && niWithHeldix && niSelected()?.clientMod) extras.push('mit HeldixClient');
  if (niLoader === 'fabric' && niWithPerformance) extras.push('Leistungs-Paket');
  const summary = $('#ni-summary');
  summary.textContent = '';
  summary.append(
    h('span', { class: 'ni-summary-icon' }, svgIcon(ICONS.check, '')),
    h('div', { class: 'ni-summary-text' },
      h('span', { class: 'ni-summary-name', text: niVersion ? `${LOADER_LABELS[niLoader]} · Minecraft ${niVersion}` : 'Bitte eine Version auswählen' }),
      h('span', { class: 'ni-summary-meta', text: extras.length ? extras.join(' · ') : 'Welten, Mods und Einstellungen getrennt von anderen Instanzen' })));
  $<HTMLButtonElement>('#ni-create').disabled = !niVersion;
}

/** Schlägt einen Namen vor (z. B. „HeldixClient 26.3“), solange niemand selbst einen eingegeben hat. */
function autoName(): void {
  const input = $<HTMLInputElement>('#ni-name');
  const prefix = niLoader === 'heldix' ? 'HeldixClient' : niLoader === 'fabric' ? 'Fabric' : 'Minecraft';
  input.placeholder = niVersion ? `${prefix} ${niVersion}` : 'Name der Instanz';
  if (!niNameTouched) input.value = input.placeholder;
}

async function createInstance(): Promise<void> {
  if (!niVersion) {
    toast('Bitte eine Minecraft-Version auswählen.', 'error');
    return;
  }
  const button = $<HTMLButtonElement>('#ni-create');
  button.disabled = true;
  const withPerformance = niLoader === 'fabric' && niWithPerformance;
  try {
    const instance = await api.createInstance({
      name: niName(),
      minecraft: niVersion,
      loader: niLoader,
      color: niColor,
    });
    // Fabric ohne HeldixClient (abgewählt oder für diese Version nicht vorhanden)
    if (instance.loader === 'fabric' && (!niWithHeldix || !niSelected()?.clientMod)) {
      await api.updateInstance(instance.id, { heldixClient: false });
    }
    $('#new-instance-modal').hidden = true;
    await reloadInstances();
    emit('settings');
    toast(`Instanz „${instance.name}“ angelegt.`, 'success');
    openDetail(instance.id);
    if (withPerformance) void installPerformanceFor(instance.id);
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    button.disabled = false;
  }
}

/** Leistungs-Paket nach dem Anlegen im Hintergrund installieren */
async function installPerformanceFor(id: string): Promise<void> {
  toast(`Leistungs-Paket wird installiert: ${PERFORMANCE_PACK} …`);
  try {
    const result = await api.installPerformancePack(id);
    const parts: string[] = [];
    if (result.installed.length) parts.push(`Installiert: ${result.installed.join(', ')}`);
    if (result.unavailable.length) parts.push(`noch nicht für diese Version: ${result.unavailable.join(', ')}`);
    toast(parts.join(' · ') || 'Leistungs-Paket ist schon installiert.', 'success');
    for (const note of result.notes) toast(note, 'info');
    if (detailId === id) await loadContent();
    await reloadInstances();
  } catch (error) {
    toast(`Leistungs-Paket: ${errorMessage(error)}`, 'error');
  }
}
