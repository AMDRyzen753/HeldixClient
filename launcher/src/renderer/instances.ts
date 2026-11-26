// Instanzen: Übersicht, Detailansicht (Mods, Addons, Einstellungen), Modrinth-Suche, neue Instanz
import type { ContentItem, ContentKind, InstanceInfo, InstanceLoader, ModrinthHit, QuickPlayTarget, ShaderpackList, StoreAddon, VersionInfo } from '../shared/api';
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

const COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e'];
export type DetailTab = 'mods' | 'addons' | 'shaders' | 'settings';
/** Wofür der Modrinth-Dialog gerade sucht */
type BrowseMode = 'mods' | 'shaders';
let browseMode: BrowseMode = 'mods';
let shaderList: ShaderpackList | null = null;

let detailId: string | null = null;
let detailTab: DetailTab = 'mods';
let contentItems: ContentItem[] = [];

export function initInstances(showView: (view: string) => void): void {
  $('#new-instance').addEventListener('click', openNewInstance);
  $('#detail-back').addEventListener('click', () => closeDetail());
  $('#detail-play').addEventListener('click', () => {
    if (detailId) void launchInstance(detailId, showView);
  });
  $('#detail-folder').addEventListener('click', () => detailId && api.openFolder('instance', detailId));
  document.querySelectorAll<HTMLButtonElement>('#detail-tabs button').forEach((button) =>
    button.addEventListener('click', () => switchTab(button.dataset.tab as DetailTab)));
  $('#content-filter').addEventListener('input', renderContent);
  $('#content-add-file').addEventListener('click', () => addFiles());
  $('#content-browse').addEventListener('click', () => {
    if (detailTab === 'addons') showView('store');
    else openModrinth('mods');
  });
  $('#content-perf').addEventListener('click', () => void installPerformance());
  $('#shader-browse').addEventListener('click', () => openModrinth('shaders'));
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
  const fallback: DetailTab = instance?.loader === 'vanilla' ? 'settings' : 'mods';
  // Reiter, die es für diesen Loader nicht gibt, auf den Standard umbiegen
  const allowed = tab && !(instance?.loader === 'vanilla' && tab !== 'settings' && tab !== 'shaders') && !(tab === 'addons' && !instance?.heldixClient);
  switchTab(allowed ? tab : fallback);
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
  $<HTMLButtonElement>('#detail-tabs [data-tab="addons"]').hidden = !instance.heldixClient;
  $<HTMLButtonElement>('#detail-tabs [data-tab="mods"]').hidden = instance.loader === 'vanilla';
  renderSettingsTab();
}

function switchTab(tab: DetailTab): void {
  detailTab = tab;
  document.querySelectorAll<HTMLButtonElement>('#detail-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-content').hidden = tab === 'settings' || tab === 'shaders';
  $('#tab-settings').hidden = tab !== 'settings';
  $('#tab-shaders').hidden = tab !== 'shaders';
  $('#bundled-addons').hidden = true;
  if (tab === 'shaders') void loadShaders();
  if (tab === 'addons') void loadStore();
  if (tab === 'mods' || tab === 'addons') {
    const isMods = tab === 'mods';
    const heldix = current()?.loader === 'heldix';
    $<HTMLInputElement>('#content-filter').value = '';
    $<HTMLInputElement>('#content-filter').placeholder = isMods ? 'Installierte Mods durchsuchen …' : 'Installierte Addons durchsuchen …';
    // Modrinth liefert Fabric-Mods – die laufen nur in Fabric-Instanzen
    $('#content-browse').hidden = isMods && heldix;
    $('#content-browse').lastChild!.textContent = isMods ? 'Mods entdecken' : 'Addon-Store';
    $('#content-perf').hidden = !isMods || current()?.loader !== 'fabric';
    $('#content-add-file').lastChild!.textContent = isMods ? 'Mod-Datei hinzufügen' : 'Addon-Datei hinzufügen';
    $('#content-hint').textContent = !isMods
      ? 'Heldix-Addons als .jar hierher ziehen. Addons nutzen die Heldix-API und laufen versionsunabhängig.'
      : heldix
        ? 'Heldix-Mods (mit heldix.mod.json) als .jar hierher ziehen. Der Heldix Loader ist ein eigener Loader – Fabric-Mods laufen nur in Fabric-Instanzen.'
        : current()?.heldixClient
          ? 'Fabric-Mods als .jar hierher ziehen oder über „Mods entdecken“ installieren. HeldixClient läuft hier über den Heldix Loader als Fabric-Mod mit. Das Leistungs-Paket bringt Sodium, Lithium & Co.'
          : 'Fabric-Mods als .jar hierher ziehen oder über „Mods entdecken“ direkt von Modrinth installieren. Das Leistungs-Paket bringt Sodium, Lithium & Co.';
    void loadContent();
  }
}

/** Icons installierter Addons (Name aus dem Heldix-Icon-Set); der Addon-Store ergänzt sie */
const ADDON_ICONS: Record<string, string> = { spotify: 'music', uhrzeit: 'clock' };
const CATEGORY_LABELS: Record<StoreAddon['category'], string> = { hud: 'HUD', musik: 'Musik & Medien', chat: 'Chat & Freunde', werkzeuge: 'Werkzeuge', sonstiges: 'Sonstiges' };
const PLATFORM_LABELS: Record<StoreAddon['platforms'][number], string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };
/** Sichtbare Karten, bevor „Alle anzeigen“ nötig wird */
const STORE_PREVIEW = 4;
let storeExpanded = false;
let storeOpen: string | null = null;

/** Beschreibung aus dem Store als Klartext: Absätze und „- “-Listen, nie HTML */
function plainText(text: string): HTMLElement {
  const box = h('div', { class: 'store-text' });
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((line) => line.startsWith('- '))) {
      box.append(h('ul', {}, ...lines.map((line) => h('li', { text: line.slice(2) }))));
    } else {
      box.append(h('p', { text: lines.join(' ') }));
    }
  }
  return box;
}

/** Addon-Store: alle Addons vom Heldix-Dienst mit Zustand in dieser Instanz (über der Liste der installierten) */
async function loadStore(): Promise<void> {
  const box = $('#bundled-addons');
  const requested = detailId;
  if (!requested || kind() !== 'addons') return;
  let addons: StoreAddon[] = [];
  let failure: string | null = null;
  try {
    addons = await api.listStoreAddons(requested);
  } catch (error) {
    failure = errorMessage(error);
  }
  if (requested !== detailId || kind() !== 'addons') return;
  for (const addon of addons) ADDON_ICONS[addon.id] = addon.icon;
  box.textContent = '';
  box.hidden = false;
  const web = h('button', { class: 'link-button store-web', title: 'Alle Addons mit Beschreibung auf heldixclient.com' }, 'Auf heldixclient.com ansehen');
  web.addEventListener('click', () => void api.openWebsite('addons'));
  box.append(h('div', { class: 'bundled-head' },
    h('span', { class: 'bundled-title', text: 'Addon-Store' }),
    h('span', { class: 'bundled-sub', text: 'Geprüft und signiert vom HeldixClient-Team · aktiv ab dem nächsten Spielstart' }),
    web));
  if (failure) {
    const retry = h('button', { class: 'ghost' }, uiIcon('refresh', 'btn-icon'), 'Erneut versuchen');
    retry.addEventListener('click', () => void loadStore());
    box.append(h('div', { class: 'store-message' }, uiIcon('warning'), h('span', { text: failure }), retry));
    return;
  }
  if (addons.length === 0) {
    box.append(h('div', { class: 'store-message' }, uiIcon('addons'), h('span', { text: 'Im Addon-Store gibt es gerade keine Addons.' })));
    return;
  }
  // Updates zuerst, dann noch nicht installierte, dann installierte; nicht passende ans Ende
  const order: Record<StoreAddon['state'], number> = { update: 0, available: 1, installed: 2, 'unsupported-platform': 3, 'unsupported-api': 4 };
  const sorted = [...addons].sort((a, b) => order[a.state] - order[b.state] || b.downloads - a.downloads || a.name.localeCompare(b.name, 'de'));
  const visible = storeExpanded ? sorted : sorted.slice(0, STORE_PREVIEW);
  const grid = h('div', { class: 'bundled-grid' });
  for (const addon of visible) grid.append(storeCard(requested, addon));
  box.append(grid);
  if (sorted.length > STORE_PREVIEW) {
    const more = h('button', { class: 'link-button store-more' }, storeExpanded ? 'Weniger anzeigen' : `Alle ${sorted.length} Addons anzeigen`);
    more.addEventListener('click', () => {
      storeExpanded = !storeExpanded;
      void loadStore();
    });
    box.append(more);
  }
}

function storeCard(instanceId: string, addon: StoreAddon): HTMLElement {
  const update = addon.state === 'update';
  const installed = addon.state === 'installed';
  const unsupported = addon.state === 'unsupported-api' || addon.state === 'unsupported-platform';
  const label = h('span', { text: update ? 'Aktualisieren' : installed ? 'Installiert' : unsupported ? 'Nicht verfügbar' : 'Installieren' });
  const button = h('button', { class: update || installed || unsupported ? 'ghost' : 'primary' },
    uiIcon(update ? 'refresh' : installed ? 'check' : unsupported ? 'ban' : 'download', 'btn-icon'), label) as HTMLButtonElement;
  button.disabled = installed || unsupported;
  if (unsupported && addon.reason) button.title = addon.reason;
  button.addEventListener('click', async () => {
    button.disabled = true;
    label.textContent = update ? 'Wird aktualisiert …' : 'Wird installiert …';
    try {
      const name = await api.installStoreAddon(instanceId, addon.id);
      toast(`${name} ${addon.version} ist installiert und beim nächsten Spielstart dabei.`, 'success');
      await loadContent();
      await loadStore();
      await reloadInstances();
    } catch (error) {
      button.disabled = false;
      label.textContent = update ? 'Aktualisieren' : 'Installieren';
      toast(errorMessage(error), 'error');
    }
  });
  const version = update && addon.installedVersion ? `${addon.installedVersion} → ${addon.version}` : addon.version;
  const chips = h('div', { class: 'store-chips' },
    h('span', { class: 'store-chip', text: CATEGORY_LABELS[addon.category] ?? 'Sonstiges' }),
    addon.platforms.length && !(Object.keys(PLATFORM_LABELS) as StoreAddon['platforms']).every((p) => addon.platforms.includes(p))
      ? h('span', { class: 'store-chip', text: `Nur ${addon.platforms.map((p) => PLATFORM_LABELS[p]).join(' & ')}` })
      : null,
    h('span', { class: 'store-chip', text: addon.downloads === 1 ? '1 Download' : `${formatCount(addon.downloads)} Downloads` }),
    installed && addon.installedEnabled === false ? h('span', { class: 'store-chip warn', text: 'Ausgeschaltet' }) : null,
    unsupported && addon.reason ? h('span', { class: 'store-chip warn', text: addon.reason }) : null);
  const open = storeOpen === addon.id;
  const details = h('button', { class: 'link-button store-details-toggle', 'aria-expanded': String(open) }, open ? 'Weniger' : 'Details');
  details.addEventListener('click', () => {
    storeOpen = storeOpen === addon.id ? null : addon.id;
    void loadStore();
  });
  const date = Date.parse(addon.date);
  const extra = open
    ? h('div', { class: 'store-details' },
      addon.description ? plainText(addon.description) : null,
      addon.notes.length ? h('div', { class: 'store-notes' }, h('strong', { text: `Neu in ${addon.version}` }), h('ul', {}, ...addon.notes.map((note) => h('li', { text: note })))) : null,
      h('div', { class: 'store-meta', text: `von ${addon.authors.join(', ')} · Addon-API ${addon.api}${Number.isFinite(date) ? ` · ${formatDate(date)}` : ''}` }),
      h('button', {
        class: 'link-button',
        type: 'button',
        onclick: () => {
          document.querySelector<HTMLButtonElement>('.nav-item[data-view="store"]')?.click();
          openStoreAddon(addon.id);
        },
      }, 'Im Addon-Store öffnen (Screenshots, Bewertungen, Versionen)'))
    : null;
  return h('div', { class: `bundled-card store-card bundled-${addon.id}${open ? ' open' : ''}` },
    h('div', { class: 'store-row' },
      h('div', { class: 'bundled-icon' }, uiIcon(addon.icon)),
      h('div', { class: 'bundled-main' },
        h('div', { class: 'bundled-name' },
          h('span', { text: addon.name }),
          h('span', { class: 'content-version', text: version }),
          update ? h('span', { class: 'tag tag-type', text: 'UPDATE' }) : null),
        h('div', { class: 'bundled-desc', text: addon.summary }),
        chips,
        details),
      button),
    extra);
}

function kind(): ContentKind {
  return detailTab === 'addons' ? 'addons' : 'mods';
}

async function loadContent(): Promise<void> {
  if (!detailId) return;
  const list = $('#content-list');
  list.textContent = '';
  list.append(h('div', { class: 'content-empty', text: 'Lade …' }));
  try {
    contentItems = await api.listContent(detailId, kind());
  } catch (error) {
    contentItems = [];
    toast(errorMessage(error), 'error');
  }
  renderContent();
}

function renderContent(): void {
  const list = $('#content-list');
  list.textContent = '';
  const query = $<HTMLInputElement>('#content-filter').value.trim().toLowerCase();
  const items = contentItems.filter((item) => !query || `${item.name} ${item.id ?? ''} ${item.description}`.toLowerCase().includes(query));
  const isMods = kind() === 'mods';
  $('#content-count').textContent = `${contentItems.filter((i) => i.enabled).length} von ${contentItems.length} aktiv`;

  if (items.length === 0) {
    list.append(h('div', { class: 'content-empty' },
      svgIcon(isMods ? ICONS.compass : ICONS.file, 'empty-icon'),
      h('div', { class: 'content-empty-title', text: query ? 'Nichts gefunden' : isMods ? 'Noch keine eigenen Mods' : 'Noch keine Addons' }),
      h('div', {
        text: query
          ? 'Andere Suche probieren.'
          : !isMods
            ? 'Lege .jar-Dateien von Heldix-Addons hier ab.'
            : current()?.loader === 'heldix'
              ? 'HeldixClient ist schon dabei. Weitere Heldix-Mods als .jar hier ablegen.'
              : 'Über „Mods entdecken“ findest du tausende Fabric-Mods.',
      })));
    return;
  }

  for (const item of items) {
    const bundledIcon = !isMods && item.id ? ADDON_ICONS[item.id] : undefined;
    const icon = item.icon
      ? h('img', { class: 'content-icon', src: item.icon, alt: '' })
      : bundledIcon
        ? h('div', { class: `content-icon placeholder bundled-${item.id}` }, uiIcon(bundledIcon))
        : h('div', { class: 'content-icon placeholder', text: item.name.charAt(0).toUpperCase() });
    const toggle = h('input', { type: 'checkbox', class: 'switch', title: item.enabled ? 'Ausschalten' : 'Einschalten' }) as HTMLInputElement;
    toggle.checked = item.enabled;
    toggle.disabled = item.managed;
    toggle.addEventListener('change', async () => {
      try {
        await api.setContentEnabled(detailId!, kind(), item.file, toggle.checked);
        await loadContent();
        await reloadInstances();
      } catch (error) {
        toggle.checked = !toggle.checked;
        toast(errorMessage(error), 'error');
      }
    });
    const remove = item.managed
      ? h('span', { class: 'managed-lock', title: 'Wird vom Launcher verwaltet' }, svgIcon(ICONS.lock))
      : h('button', { class: 'icon-button danger-hover', title: 'Löschen', onclick: () => void removeItem(item) }, svgIcon(ICONS.trash));

    list.append(h('div', { class: `content-row${item.enabled ? '' : ' disabled'}${item.error ? ' broken' : ''}` },
      icon,
      h('div', { class: 'content-main' },
        h('div', { class: 'content-title' },
          h('span', { class: 'content-name', text: item.name }),
          item.version ? h('span', { class: 'content-version', text: item.version }) : null,
          item.managed ? h('span', { class: 'tag tag-type', text: 'VERWALTET' }) : null,
          item.projectId ? h('span', { class: 'tag tag-modrinth', text: 'MODRINTH' }) : null),
        h('div', { class: 'content-desc', text: item.error ?? (item.description || item.file) }),
        item.authors.length ? h('div', { class: 'content-authors', text: `von ${item.authors.slice(0, 3).join(', ')}` }) : null),
      toggle,
      remove));
  }
}

async function removeItem(item: ContentItem): Promise<void> {
  const what = kind() === 'mods' ? 'Mod' : 'Addon';
  if (!(await confirmDialog(`${what} löschen?`, `„${item.name}“ wird aus dieser Instanz entfernt.`, 'Löschen'))) return;
  try {
    await api.removeContent(detailId!, kind(), item.file);
    toast(`${item.name} wurde entfernt.`, 'success');
    await loadContent();
    if (kind() === 'addons') await loadStore();
    await reloadInstances();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

async function addFiles(paths?: string[]): Promise<void> {
  if (!detailId) return;
  try {
    const count = await api.addContentFiles(detailId, kind(), paths);
    if (count > 0) {
      toast(`${count} ${kind() === 'mods' ? (count === 1 ? 'Mod' : 'Mods') : count === 1 ? 'Addon' : 'Addons'} hinzugefügt.`, 'success');
      await loadContent();
      await reloadInstances();
    }
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
      toast('Bitte nur .jar-Dateien ablegen.', 'error');
      return;
    }
    void addFiles(files.map((f) => api.pathForFile(f)));
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
let modrinthChanged = false;

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

function setupModrinthModal(): void {
  const modal = $('#modrinth-modal');
  const close = async () => {
    modal.hidden = true;
    if (modrinthChanged) {
      if (browseMode === 'shaders') await loadShaders();
      else await loadContent();
      await reloadInstances();
    }
  };
  $('#mr-close').addEventListener('click', () => void close());
  modal.addEventListener('click', (event) => event.target === modal && void close());
  $('#mr-query').addEventListener('input', () => {
    window.clearTimeout(modrinthTimer);
    modrinthTimer = window.setTimeout(() => void searchModrinth(true), 300);
  });
  $('#mr-more').addEventListener('click', () => void searchModrinth(false));
}

function openModrinth(mode: BrowseMode): void {
  const instance = current();
  if (!instance) return;
  browseMode = mode;
  modrinthChanged = false;
  const shaders = mode === 'shaders';
  $('#mr-title').textContent = shaders ? 'Shaderpacks entdecken' : 'Mods entdecken';
  $('#mr-sub').textContent = `für ${instance.name} · Minecraft ${instance.minecraft} · ${shaders ? 'Iris' : 'Fabric'} · von Modrinth`;
  $<HTMLInputElement>('#mr-query').placeholder = shaders ? 'z. B. BSL, Complementary, Photon …' : 'z. B. Sodium, Iris, Mod Menu …';
  $<HTMLInputElement>('#mr-query').value = '';
  $('#modrinth-modal').hidden = false;
  $<HTMLInputElement>('#mr-query').focus();
  void searchModrinth(true);
}

async function searchModrinth(reset: boolean): Promise<void> {
  if (!detailId) return;
  const list = $('#mr-list');
  if (reset) {
    modrinthOffset = 0;
    list.textContent = '';
    list.append(h('div', { class: 'content-empty', text: 'Suche …' }));
  }
  try {
    const query = $<HTMLInputElement>('#mr-query').value;
    const result = browseMode === 'shaders'
      ? await api.searchShaderpacks(detailId, query, modrinthOffset)
      : await api.searchModrinth(detailId, query, modrinthOffset);
    if (reset) list.textContent = '';
    modrinthTotal = result.total;
    modrinthOffset = result.offset + 20;
    if (result.hits.length === 0 && reset) list.append(h('div', { class: 'content-empty', text: browseMode === 'shaders' ? 'Keine passenden Shaderpacks gefunden.' : 'Keine passenden Mods gefunden.' }));
    for (const hit of result.hits) list.append(modrinthRow(hit));
  } catch (error) {
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
        modrinthChanged = true;
        button.className = 'ghost installed';
        button.replaceChildren(svgIcon(ICONS.check), 'Aktiv');
        const extra = result.mods.length ? ` Dazu installiert: ${result.mods.join(', ')}.` : '';
        toast(`${result.title} ist installiert und eingeschaltet.${extra}`, 'success');
        for (const note of result.notes) toast(note, 'info');
        return;
      }
      const installed = await api.installModrinth(detailId!, hit.projectId);
      modrinthChanged = true;
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
