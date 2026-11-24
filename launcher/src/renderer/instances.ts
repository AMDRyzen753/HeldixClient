// Instanzen: Übersicht, Detailansicht (Mods, Addons, Einstellungen), Modrinth-Suche, neue Instanz
import type { ContentItem, ContentKind, InstanceInfo, InstanceLoader, ModrinthHit, VersionInfo } from '../shared/api';
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
} from './core.js';

const COLORS = ['#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#f43f5e'];
type DetailTab = 'mods' | 'addons' | 'settings';

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
  $('#content-browse').addEventListener('click', openModrinth);
  setupDropzone();
  setupNewInstanceModal();
  setupModrinthModal();
  setupSettingsTab();
  on('instances', () => {
    renderGrid();
    if (detailId) renderDetailHead();
  });
}

export async function launchInstance(id: string, showView: (view: string) => void): Promise<void> {
  if (!state.accounts.some((a) => a.active)) {
    toast('Bitte zuerst unten links ein Konto hinzufügen.', 'error');
    return;
  }
  await api.selectInstance(id);
  await reloadInstances();
  showView('home');
  try {
    await api.launch(id);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

// ---------- Übersicht ----------

function renderGrid(): void {
  const grid = $('#instance-grid');
  grid.textContent = '';
  for (const instance of state.instances) {
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
          ? h('span', { text: `${instance.modCount} Mods${instance.loader === 'heldix' ? ` · ${instance.addonCount} Addons` : ''}` })
          : null),
      h('button', {
        class: 'card-play',
        title: 'Spielen',
        onclick: (e: Event) => {
          e.stopPropagation();
          void launchInstance(instance.id, (v) => document.querySelector<HTMLButtonElement>(`[data-view="${v}"]`)?.click());
        },
      }, svgIcon(ICONS.play)));
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

export function openDetail(id: string): void {
  detailId = id;
  $('#instances-overview').hidden = true;
  $('#instance-detail').hidden = false;
  const instance = current();
  switchTab(instance?.loader === 'vanilla' ? 'settings' : 'mods');
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
  $<HTMLButtonElement>('#detail-tabs [data-tab="addons"]').hidden = instance.loader !== 'heldix';
  $<HTMLButtonElement>('#detail-tabs [data-tab="mods"]').hidden = instance.loader === 'vanilla';
  renderSettingsTab();
}

function switchTab(tab: DetailTab): void {
  detailTab = tab;
  document.querySelectorAll<HTMLButtonElement>('#detail-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#tab-content').hidden = tab === 'settings';
  $('#tab-settings').hidden = tab !== 'settings';
  if (tab !== 'settings') {
    const isMods = tab === 'mods';
    const heldix = current()?.loader === 'heldix';
    $<HTMLInputElement>('#content-filter').value = '';
    $<HTMLInputElement>('#content-filter').placeholder = isMods ? 'Installierte Mods durchsuchen …' : 'Installierte Addons durchsuchen …';
    // Modrinth liefert Fabric-Mods – die laufen nur in Fabric-Instanzen
    $('#content-browse').hidden = !isMods || heldix;
    $('#content-add-file').lastChild!.textContent = isMods ? 'Mod-Datei hinzufügen' : 'Addon-Datei hinzufügen';
    $('#content-hint').textContent = !isMods
      ? 'Heldix-Addons als .jar hierher ziehen. Addons nutzen die Heldix-API und laufen versionsunabhängig.'
      : heldix
        ? 'Heldix-Mods (mit heldix.mod.json) als .jar hierher ziehen. Der Heldix Loader ist ein eigener Loader – Fabric-Mods laufen nur in Fabric-Instanzen.'
        : 'Fabric-Mods als .jar hierher ziehen oder über „Mods entdecken“ direkt von Modrinth installieren.';
    void loadContent();
  }
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
    const icon = item.icon
      ? h('img', { class: 'content-icon', src: item.icon, alt: '' })
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
  $('#is-path').textContent = instance.path;
  $('#is-created').textContent = `Angelegt am ${formatDate(instance.created)}`;
}

// ---------- Modrinth ----------

let modrinthOffset = 0;
let modrinthTotal = 0;
let modrinthTimer: number | undefined;
let modrinthChanged = false;

function setupModrinthModal(): void {
  const modal = $('#modrinth-modal');
  const close = async () => {
    modal.hidden = true;
    if (modrinthChanged) {
      await loadContent();
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

function openModrinth(): void {
  const instance = current();
  if (!instance) return;
  modrinthChanged = false;
  $('#mr-sub').textContent = `für ${instance.name} · Minecraft ${instance.minecraft} · Fabric · von Modrinth`;
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
    const result = await api.searchModrinth(detailId, query, modrinthOffset);
    if (reset) list.textContent = '';
    modrinthTotal = result.total;
    modrinthOffset = result.offset + 20;
    if (result.hits.length === 0 && reset) list.append(h('div', { class: 'content-empty', text: 'Keine passenden Mods gefunden.' }));
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

type VersionTab = 'release' | 'snapshot' | 'old';
let niVersion: string | null = null;
let niLoader: InstanceLoader = 'heldix';
let niColor = COLORS[0];
let niTab: VersionTab = 'release';
let niNameTouched = false;

const NI_LOADER_TEXT: Record<InstanceLoader, string> = {
  heldix: 'HeldixClient mit Heldix-Mods und Addons',
  fabric: 'Fabric-Mods von Modrinth, ohne HeldixClient',
  vanilla: 'Minecraft ganz ohne Mods',
};

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
      niLoader = card.dataset.loader as InstanceLoader;
      renderNiLoaders();
      autoName();
      renderNiSummary();
    }));
  $('#ni-create').addEventListener('click', createInstance);
}

function openNewInstance(): void {
  const versions = state.versions?.versions ?? [];
  const heldixVersion = versions.find((v) => v.clientMod);
  niVersion = heldixVersion?.id ?? state.versions?.latestRelease ?? versions[0]?.id ?? null;
  niLoader = heldixVersion ? 'heldix' : 'fabric';
  niColor = COLORS[state.instances.length % COLORS.length];
  niTab = 'release';
  niNameTouched = false;
  $<HTMLInputElement>('#ni-filter').value = '';
  $<HTMLInputElement>('#ni-name').value = '';
  renderNiVersions();
  renderNiLoaders();
  renderNiColors();
  autoName();
  renderNiSummary();
  $('#new-instance-modal').hidden = false;
  $<HTMLInputElement>('#ni-filter').focus();
}

function niSelected(): VersionInfo | undefined {
  return state.versions?.versions.find((v) => v.id === niVersion);
}

function renderNiVersions(): void {
  const list = $('#ni-versions');
  list.textContent = '';
  document.querySelectorAll<HTMLButtonElement>('#ni-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === niTab));
  const query = $<HTMLInputElement>('#ni-filter').value.trim().toLowerCase();
  const versions = (state.versions?.versions ?? []).filter((v) => {
    const tabOk = niTab === 'release' ? v.type === 'release' : niTab === 'snapshot' ? v.type === 'snapshot' : v.type === 'old_beta' || v.type === 'old_alpha';
    return tabOk && (!query || v.id.toLowerCase().includes(query));
  });
  $('#ni-version-count').textContent = versions.length === 1 ? '1 Version' : `${versions.length} Versionen`;
  const latest = state.versions?.latestRelease;
  for (const v of versions.slice(0, 150)) {
    list.append(h('div', {
      class: `version-item${v.id === niVersion ? ' selected' : ''}`,
      onclick: () => {
        niVersion = v.id;
        renderNiVersions();
        renderNiLoaders();
        autoName();
        renderNiSummary();
      },
    },
    h('span', { class: 'version-item-id', text: v.id }),
    v.id === latest ? h('span', { class: 'tag tag-type', text: 'NEUESTE' }) : null,
    v.clientMod ? h('span', { class: 'tag tag-heldix', text: 'HELDIX' }) : v.fabric ? h('span', { class: 'tag tag-fabric', text: 'FABRIC' }) : null,
    h('span', { class: 'version-item-date', text: formatDate(v.releaseTime) })));
  }
  if (versions.length === 0) list.append(h('div', { class: 'version-empty', text: 'Keine passende Version.' }));
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function renderNiLoaders(): void {
  const version = niSelected();
  const available: Record<InstanceLoader, boolean> = {
    heldix: Boolean(version?.clientMod),
    fabric: Boolean(version?.fabric),
    vanilla: true,
  };
  if (!available[niLoader]) niLoader = available.heldix ? 'heldix' : available.fabric ? 'fabric' : 'vanilla';
  document.querySelectorAll<HTMLElement>('#ni-loaders .ni-loader').forEach((card) => {
    const loader = card.dataset.loader as InstanceLoader;
    card.classList.toggle('active', loader === niLoader);
    card.classList.toggle('unavailable', !available[loader]);
    card.setAttribute('aria-pressed', String(loader === niLoader));
    // Statt nur im Tooltip steht der Grund direkt in der Karte
    const text = available[loader]
      ? NI_LOADER_TEXT[loader]
      : loader === 'heldix'
        ? `Für ${niVersion} gibt es noch keine HeldixClient-Mod`
        : `Fabric gibt es für ${niVersion} nicht`;
    card.querySelector('.ni-loader-text')!.textContent = text;
    card.title = available[loader] ? '' : text;
  });
}

function renderNiColors(): void {
  const host = $('#ni-colors');
  host.textContent = '';
  for (const color of COLORS) {
    const swatch = h('button', {
      class: `swatch${color === niColor ? ' active' : ''}`,
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

/** Eingegebener Name oder – wenn leer – der automatische Vorschlag. */
function niName(): string {
  const input = $<HTMLInputElement>('#ni-name');
  return input.value.trim() || input.placeholder;
}

/** Vorschau-Kachel neben dem Namen und Zusammenfassung unten links. */
function renderNiSummary(): void {
  const name = niName();
  const preview = $('#ni-preview');
  preview.textContent = '';
  preview.append(instanceTile({ color: niColor, loader: niLoader, name }, 'medium'));

  const summary = $('#ni-summary');
  summary.textContent = '';
  summary.append(
    instanceTile({ color: niColor, loader: niLoader, name }, 'small'),
    h('div', { class: 'ni-summary-text' },
      h('span', { class: 'ni-summary-name', text: name }),
      h('span', { class: 'ni-summary-meta', text: niVersion ? `Minecraft ${niVersion} · ${LOADER_LABELS[niLoader]}` : 'Bitte eine Version auswählen' })));
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
  try {
    const instance = await api.createInstance({
      name: niName(),
      minecraft: niVersion,
      loader: niLoader,
      color: niColor,
    });
    $('#new-instance-modal').hidden = true;
    await reloadInstances();
    emit('settings');
    toast(`Instanz „${instance.name}“ angelegt.`, 'success');
    openDetail(instance.id);
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    button.disabled = false;
  }
}
