import type { AccountInfo, DiscordStatus, InstanceInfo, LogLine, QuickPlayList, QuickPlayTarget, Settings, SkinInfo } from '../shared/api';
import {
  $,
  api,
  emit,
  errorMessage,
  formatDate,
  formatPlayTime,
  h,
  ICONS,
  instanceTile,
  LOADER_LABELS,
  on,
  reloadInstances,
  selectedInstance,
  state,
  svgIcon,
  toast,
} from './core.js';
import { showFigure, setFigureActive } from './figure.js';
import { initInstances, launchInstance, openDetail, resetInstancesView, type DetailTab } from './instances.js';
import { loadNews } from './news.js';

// ---------- Navigation ----------
const VIEW_TITLES: Record<string, string> = { home: 'Spielen', instances: 'Instanzen', settings: 'Einstellungen', console: 'Konsole' };
function showView(view: string): void {
  document.body.dataset.view = view;
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  $('#view-title').textContent = VIEW_TITLES[view] ?? '';
  if (view === 'console') {
    $('#console-dot').hidden = true;
    scrollLogToEnd();
  }
  if (view === 'instances') resetInstancesView();
  setFigureActive(view === 'home');
}
document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.view!));
});

// ---------- Parallax: das Hintergrundbild folgt leicht der Maus ----------
document.body.dataset.view = 'home';
let parallaxFrame = 0;
document.addEventListener('mousemove', (event) => {
  if (parallaxFrame) return;
  parallaxFrame = requestAnimationFrame(() => {
    parallaxFrame = 0;
    const mx = (event.clientX / window.innerWidth - 0.5) * 2;
    const my = (event.clientY / window.innerHeight - 0.5) * 2;
    document.documentElement.style.setProperty('--mx', mx.toFixed(3));
    document.documentElement.style.setProperty('--my', my.toFixed(3));
  });
});

// ---------- Startseite ----------
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Hallo';
  return 'Guten Abend';
}

/** Kurze Zeitangabe für Listen: "vor 5 Min.", "gestern" … */
function shortRelative(time: number | null): string {
  if (!time) return 'noch nie';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'gestern';
  if (days < 30) return `vor ${days} Tagen`;
  return formatDate(time);
}

/** Die Instanz, um die es gerade geht: während eines Spiels die laufende, sonst die ausgewählte. */
function stageInstance(): InstanceInfo | undefined {
  const game = state.game;
  if (game.state === 'preparing' || game.state === 'running') {
    return state.instances.find((i) => i.id === game.instanceId) ?? selectedInstance();
  }
  return selectedInstance();
}

function openInstanceTab(id: string, tab: DetailTab): void {
  showView('instances');
  openDetail(id, tab);
}

function openNewInstanceDialog(): void {
  showView('instances');
  $('#new-instance').click();
}

function loaderText(instance: InstanceInfo): string {
  if (instance.loader === 'heldix') return state.info?.loaderVersion ? `Heldix Loader ${state.info.loaderVersion}` : 'Heldix Loader';
  return LOADER_LABELS[instance.loader];
}

function toolButton(icon: string, title: string, onclick: () => void): HTMLElement {
  const button = h('button', { class: 'tool', type: 'button', title, 'aria-label': title, onclick });
  button.append(svgIcon(icon, ''));
  return button;
}

function renderGreeting(): void {
  const active = state.accounts.find((a) => a.active);
  $('#home-greeting-text').textContent = `${greeting()},`;
  $('#home-name-text').textContent = active?.name ?? 'bitte anmelden';
  $('#home-name').title = active ? 'Konto wechseln' : 'Konto hinzufügen';
  const info = state.info;
  $('#home-eyebrow').textContent = info
    ? `HeldixClient ${info.version}${info.loaderVersion ? ` · Heldix Loader ${info.loaderVersion}` : ''}`
    : 'HeldixClient';
}

/** Instanz-Auswahl, Werkzeuge und Weiterspielen für die aktuelle Instanz. */
function renderStage(): void {
  const instance = stageInstance();
  $('#home').style.setProperty('--accent', instance?.color ?? '#3b82f6');

  const tile = $('#picker-tile');
  tile.textContent = '';
  if (instance) tile.append(instanceTile(instance, 'small'));
  $('#picker-name').textContent = instance?.name ?? 'Keine Instanz';
  $('#picker-meta').textContent = instance ? `Minecraft ${instance.minecraft} · ${loaderText(instance)}` : 'Lege deine erste Instanz an';

  const tools = $('#picker-tools');
  tools.textContent = '';
  if (instance) {
    if (instance.loader !== 'vanilla') tools.append(toolButton(ICONS.blocks, 'Mods verwalten', () => openInstanceTab(instance.id, 'mods')));
    tools.append(
      toolButton(ICONS.folder, 'Instanz-Ordner öffnen', () => void api.openFolder('instance', instance.id)),
      toolButton(ICONS.sliders, 'Einstellungen der Instanz', () => openInstanceTab(instance.id, 'settings')),
    );
  }
  void renderContinue(instance);
  renderStatus();
}

// ---------- 3D-Figur ----------
let figureFor = '';
let figureSkin: SkinInfo | null = null;

async function refreshFigure(force = false): Promise<void> {
  const active = state.accounts.find((a) => a.active);
  const key = active ? `${active.id}:${active.skinUrl ?? ''}` : '';
  if (force || key !== figureFor) {
    figureFor = key;
    figureSkin = active ? await api.getSkin().catch(() => null) : null;
  }
  await showFigure(figureSkin, active?.name ?? null);
}

// ---------- Weiterspielen: Welten und Server direkt betreten (Quick Play) ----------
let continueToken = 0;
const continueCache = new Map<string, QuickPlayList>();

/** Höchstens vier Einträge, Welten und Server gemischt. */
function pickTargets(targets: QuickPlayTarget[]): QuickPlayTarget[] {
  const worlds = targets.filter((t) => t.kind === 'world');
  const servers = targets.filter((t) => t.kind === 'server');
  const worldCount = Math.min(worlds.length, Math.max(2, 4 - servers.length));
  return [...worlds.slice(0, worldCount), ...servers.slice(0, 4 - worldCount)];
}

/**
 * Anzeigenamen: Server mit Minecrafts Standardnamen („Minecraft Server“) oder doppeltem Namen
 * zeigen ihre Adresse, doppelte Weltnamen den Ordnernamen.
 */
function displayNames(targets: QuickPlayTarget[]): Map<QuickPlayTarget, string> {
  const count = new Map<string, number>();
  for (const t of targets) count.set(`${t.kind}:${t.name}`, (count.get(`${t.kind}:${t.name}`) ?? 0) + 1);
  const names = new Map<QuickPlayTarget, string>();
  for (const t of targets) {
    const duplicate = (count.get(`${t.kind}:${t.name}`) ?? 0) > 1;
    if (t.kind === 'server' && (duplicate || /^minecraft[ -]?server$/i.test(t.name.trim()))) {
      names.set(t, (t.address ?? t.id).replace(/:25565$/, ''));
    } else if (t.kind === 'world' && duplicate && t.id !== t.name) {
      names.set(t, `${t.name} (${t.id})`);
    } else {
      names.set(t, t.name);
    }
  }
  return names;
}

function renderContinueList(instance: InstanceInfo, data: QuickPlayList): void {
  const section = $('#stage-continue');
  const list = $('#continue-list');
  list.textContent = '';
  section.hidden = !data.supported;
  if (!data.supported) return;
  list.classList.toggle('disabled', state.game.state === 'preparing' || state.game.state === 'running');
  const targets = pickTargets(data.targets);
  const label = displayNames(targets);
  if (targets.length === 0) {
    list.append(h('span', { class: 'quick-empty', text: 'Deine Welten und Server erscheinen hier.' }));
    return;
  }
  for (const target of targets) {
    const icon = target.icon
      ? h('img', { class: 'quick-icon', src: target.icon, alt: '' })
      : h('span', { class: 'quick-icon placeholder' }, svgIcon(target.kind === 'world' ? ICONS.world : ICONS.server, ''));
    list.append(h('button', {
      class: 'quick-item',
      type: 'button',
      title: target.kind === 'world'
        ? `Direkt in „${target.name}“ starten · Einzelspieler, ${shortRelative(target.lastPlayed)}`
        : `Direkt auf ${target.address ?? target.id} verbinden`,
      onclick: () => {
        if (state.game.state === 'preparing' || state.game.state === 'running') return;
        void launchInstance(instance.id, showView, { kind: target.kind, id: target.id });
      },
    }, icon, h('span', { class: 'quick-name', text: label.get(target) ?? target.name })));
  }
}

async function renderContinue(instance: InstanceInfo | undefined): Promise<void> {
  const token = ++continueToken;
  if (!instance) {
    $('#stage-continue').hidden = true;
    return;
  }
  // Erst den letzten bekannten Stand zeigen, dann frisch laden (kein Flackern)
  const cached = continueCache.get(instance.id);
  if (cached) renderContinueList(instance, cached);
  else $('#stage-continue').hidden = true;
  try {
    const data = await api.listQuickPlay(instance.id);
    continueCache.set(instance.id, data);
    if (token === continueToken) renderContinueList(instance, data);
  } catch {
    if (token === continueToken) $('#stage-continue').hidden = true;
  }
}

// ---------- Instanz-Auswahl ----------
async function selectFromHome(id: string): Promise<void> {
  if (state.game.state === 'preparing') return;
  closePicker();
  await api.selectInstance(id);
  await reloadInstances();
}

function instanceRow(instance: InstanceInfo, selected: boolean): HTMLElement {
  const item = h('div', {
    class: `side-item${selected ? ' selected' : ''}`,
    title: selected ? 'Ausgewählt' : 'Auswählen',
    onclick: () => void selectFromHome(instance.id),
  },
  instanceTile(instance, 'small'),
  h('div', { class: 'side-item-text' },
    h('div', { class: 'side-item-name', text: instance.name }),
    h('div', { class: 'side-item-meta', text: `${instance.minecraft} · ${LOADER_LABELS[instance.loader]} · ${shortRelative(instance.lastPlayed)}` })),
  selected ? svgIcon(ICONS.check, 'side-item-check') : null);
  item.style.setProperty('--item', instance.color);
  return item;
}

const pickerPanel = $('#picker-panel');
function closePicker(): void {
  pickerPanel.hidden = true;
  $('#picker-button').classList.remove('open');
}
$('#picker-button').addEventListener('click', (event) => {
  event.stopPropagation();
  if (!pickerPanel.hidden) {
    closePicker();
    return;
  }
  if (state.instances.length === 0) {
    openNewInstanceDialog();
    return;
  }
  const list = $('#picker-list');
  list.textContent = '';
  const selectedId = selectedInstance()?.id;
  const sorted = [...state.instances].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.created - a.created);
  for (const instance of sorted) list.append(instanceRow(instance, instance.id === selectedId));
  pickerPanel.hidden = false;
  $('#picker-button').classList.add('open');
});
pickerPanel.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', closePicker);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePicker();
});
$('#picker-new').addEventListener('click', () => {
  closePicker();
  openNewInstanceDialog();
});
$('#picker-manage').addEventListener('click', () => {
  closePicker();
  showView('instances');
});
$('#home-name').addEventListener('click', (event) => {
  event.stopPropagation();
  if (popover.hidden) openAccounts($('#home-name'));
  else closeAccounts();
});

function renderHome(): void {
  renderGreeting();
  renderStage();
}

// ---------- Avatare ----------
function renderAvatar(el: HTMLElement, account: AccountInfo | undefined): void {
  el.textContent = '';
  el.style.background = '';
  el.style.color = '';
  if (!account) {
    el.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>';
    return;
  }
  if (account.skinUrl) {
    // Gesicht (8,8) und Hut-Ebene (40,8) aus der 64x64-Skin-Textur ausschneiden
    const size = el.getBoundingClientRect().width || (el.classList.contains('small') ? 32 : 38);
    const scale = size / 8;
    const url = account.skinUrl.replace(/^http:/, 'https:');
    el.style.backgroundImage = `url("${url}"), url("${url}")`;
    el.style.backgroundSize = `${64 * scale}px ${64 * scale}px`;
    el.style.backgroundPosition = `${-40 * scale}px ${-8 * scale}px, ${-8 * scale}px ${-8 * scale}px`;
    return;
  }
  const hue = parseInt(account.uuid.slice(0, 6), 16) % 360;
  el.style.background = `linear-gradient(135deg, hsl(${hue} 60% 50%), hsl(${(hue + 50) % 360} 65% 34%))`;
  el.style.color = '#fff';
  el.textContent = account.name.charAt(0).toUpperCase();
}

// ---------- Status & Spielen ----------
let runningSince: number | null = null;

/** "seit 12 Min." bzw. null in der ersten Minute */
function runningFor(): string | null {
  const minutes = runningSince ? Math.floor((Date.now() - runningSince) / 60000) : 0;
  if (minutes < 1) return null;
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `seit ${hours} Std. ${minutes % 60} Min.` : `seit ${minutes} Min.`;
}

function setChip(text: string | null, busy = false): void {
  const chip = $('#titlebar-chip');
  chip.hidden = text == null;
  chip.classList.toggle('busy', busy);
  if (text) $('#titlebar-chip-text').textContent = text;
}

/** Zeile unter dem Spielen-Button: nur, wenn es etwas zu sagen gibt. */
function launchStatus(kind: 'ok' | 'busy' | 'error' | 'muted' | null, text = '', sub = ''): void {
  const box = $('#launch-status');
  box.style.visibility = kind ? 'visible' : 'hidden';
  $('#status-dot').className = `status-dot${kind && kind !== 'ok' ? ` ${kind}` : ''}`;
  $('#status-text').textContent = text;
  $('#status-sub').textContent = sub;
}

function renderStatus(): void {
  const home = $('#home');
  const homeSub = $('#home-sub');
  const play = $<HTMLButtonElement>('#play-button');
  const label = $('#play-label');
  const game = state.game;
  const instance = stageInstance();

  play.classList.remove('stop', 'busy');
  play.disabled = false;
  home.classList.toggle('busy', game.state === 'preparing');
  home.classList.toggle('running', game.state === 'running');
  $<HTMLButtonElement>('#picker-button').disabled = game.state === 'preparing';
  $<HTMLButtonElement>('#kill-game').disabled = game.state !== 'running';
  setChip(null);

  if (game.state === 'preparing') {
    const p = state.progress;
    const percent = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    play.classList.add('busy');
    play.disabled = true;
    play.style.setProperty('--p', `${percent}%`);
    $('#stage-progress').style.setProperty('--p', `${percent}%`);
    label.textContent = p && p.total > 0 ? `Lädt … ${percent} %` : 'Lädt …';
    launchStatus('busy', p ? p.stage : 'Vorbereiten', p && p.total > 0 ? `${p.done.toLocaleString('de-DE')} von ${p.total.toLocaleString('de-DE')} Dateien` : 'Prüfe Dateien …');
    homeSub.textContent = `${instance?.name ?? 'Minecraft'} wird vorbereitet …`;
    setChip('Lädt …', true);
    return;
  }
  if (game.state === 'running') {
    const since = runningFor();
    play.classList.add('stop');
    label.textContent = 'Beenden';
    launchStatus('ok', since ? `Läuft ${since}` : 'Läuft', instance?.loader === 'heldix' ? 'Rechts ⇧ öffnet im Spiel das Heldix-Menü.' : 'Viel Spaß!');
    homeSub.textContent = `${game.label} ist gestartet – viel Spaß!`;
    setChip(`Läuft · ${game.label}`);
    return;
  }

  const active = state.accounts.find((a) => a.active);
  if (!instance) {
    label.textContent = 'Instanz anlegen';
    launchStatus(null);
    homeSub.textContent = 'Leg deine erste Instanz an und los geht’s.';
    return;
  }
  label.textContent = 'Spielen';
  if (!active) {
    launchStatus('muted', 'Nicht angemeldet', 'Klicke oben auf „bitte anmelden“.');
    homeSub.textContent = 'Melde dich an, dann kann es losgehen.';
    return;
  }
  if (active.type === 'offline' && !offlineAllowed()) {
    play.disabled = true;
    launchStatus('muted', 'Offline-Konto', 'Offline-Konten gehen, sobald ein Microsoft-Konto mit Minecraft angemeldet ist.');
    homeSub.textContent = 'Bitte einmal mit einem Microsoft-Konto anmelden.';
    return;
  }
  if (game.state === 'error') {
    launchStatus('error', 'Start fehlgeschlagen', game.message);
    homeSub.textContent = 'Der letzte Start hat nicht geklappt – Details stehen in der Konsole.';
    return;
  }
  launchStatus(null);
  homeSub.textContent = instance.lastPlayed ? `Bereit für die nächste Runde in ${instance.name}?` : `${instance.name} ist startklar.`;
}

// Laufzeit-Anzeige aktuell halten
window.setInterval(() => {
  if (state.game.state === 'running') renderStatus();
}, 20000);

$('#play-button').addEventListener('click', async () => {
  if (state.game.state === 'running') {
    await api.killGame();
    return;
  }
  const instance = selectedInstance();
  if (!instance) {
    openNewInstanceDialog();
    return;
  }
  if (!state.accounts.some((a) => a.active)) {
    openAccounts($('#home-name'));
    toast('Bitte zuerst ein Konto hinzufügen.');
    return;
  }
  await launchInstance(instance.id, showView);
});

api.onProgress((progress) => {
  state.progress = progress;
  if (state.game.state === 'preparing') renderStatus();
});

api.onGameState(async (game) => {
  state.game = game;
  if (game.state === 'preparing') state.progress = null;
  if (game.state === 'running') runningSince ??= Date.now();
  else runningSince = null;
  if (game.state === 'exited' && game.notice) {
    // z. B. Vulkan-Absturz: der Launcher hat die Einstellungen angepasst
    toast(game.notice, 'error');
    $('#console-dot').hidden = false;
    state.settings = await api.getSettings();
    renderSettings();
  } else if (game.state === 'exited' && game.code !== 0 && game.code !== null) {
    toast(`Minecraft wurde mit Fehlercode ${game.code} beendet. Details in der Konsole.`, 'error');
    $('#console-dot').hidden = false;
  }
  renderStage();
  if (game.state === 'running' || game.state === 'exited') await reloadInstances();
});

on('instances', renderHome);
on('settings', renderStage);

// ---------- Discord-Hinweis in der Titelleiste ----------
function renderDiscordChip(status: DiscordStatus): void {
  const chip = $('#home-discord');
  const configured = state.info?.discordConfigured ?? false;
  chip.hidden = status.state === 'unconfigured' || (status.state === 'disabled' && !configured);
  chip.dataset.state = status.state;
  const texts: Record<DiscordStatus['state'], string> = {
    disabled: 'Discord aus',
    unconfigured: 'Discord',
    connecting: 'Discord …',
    connected: 'Discord',
    unavailable: 'Discord geschlossen',
    error: 'Discord: Problem',
  };
  $('#home-discord-text').textContent = texts[status.state];
  chip.title = status.state === 'connected' ? 'Discord-Status ist aktiv – klicken zum Einstellen' : 'Discord-Status einstellen';
}
$('#home-discord').addEventListener('click', () => {
  showView('settings');
  $('#discord-toggle').closest('.card')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
});

// ---------- Konten ----------
const popover = $('#account-popover');

function openAccounts(anchor?: HTMLElement): void {
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    popover.style.left = `${Math.round(rect.left)}px`;
    popover.style.top = `${Math.round(rect.bottom + 10)}px`;
    popover.style.bottom = 'auto';
  } else {
    popover.style.left = '';
    popover.style.top = '';
    popover.style.bottom = '';
  }
  popover.hidden = false;
  renderAccounts();
}

function closeAccounts(): void {
  popover.hidden = true;
}

$('#account-button').addEventListener('click', (event) => {
  event.stopPropagation();
  if (popover.hidden) openAccounts();
  else closeAccounts();
});
popover.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', closeAccounts);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  closeAccounts();
  document.querySelectorAll<HTMLElement>('.modal-backdrop').forEach((m) => {
    if (m.id) m.hidden = true;
    else m.remove();
  });
});

function renderAccounts(): void {
  const active = state.accounts.find((a) => a.active);
  renderAvatar($('#account-avatar'), active);
  $('#avatar-status').hidden = !active;

  const list = $('#account-list');
  list.textContent = '';
  if (state.accounts.length === 0) list.append(h('div', { class: 'account-empty', text: 'Noch kein Konto hinzugefügt.' }));
  for (const account of state.accounts) {
    const avatar = h('span', { class: 'avatar small' });
    list.append(h('div', {
      class: `account-item${account.active ? ' active' : ''}`,
      onclick: async () => {
        await api.selectAccount(account.id);
        await loadAccounts();
      },
    },
    avatar,
    h('div', { class: 'account-meta' },
      h('div', { class: 'account-name', text: account.name }),
      h('div', { class: 'account-type', text: account.type === 'microsoft' ? 'Microsoft' : 'Offline' })),
    h('button', {
      class: 'remove-account',
      title: 'Entfernen',
      text: '×',
      onclick: async (event: Event) => {
        event.stopPropagation();
        await api.removeAccount(account.id);
        await loadAccounts();
      },
    })));
    renderAvatar(avatar, account);
  }

  const info = state.info;
  $<HTMLButtonElement>('#add-microsoft').disabled = !info?.microsoftConfigured;
  $('#ms-hint').hidden = !!info?.microsoftConfigured;
  const allowed = offlineAllowed();
  $('#offline-form').classList.toggle('locked', !allowed);
  $<HTMLInputElement>('#offline-name').disabled = !allowed;
  $<HTMLButtonElement>('#offline-form button').disabled = !allowed;
  $('#offline-hint').textContent = allowed
    ? 'Offline: für Einzelspieler, LAN und Server ohne Online-Modus.'
    : 'Offline-Konten gibt es, sobald ein Microsoft-Konto mit Minecraft angemeldet ist.';
}

/** Wie im Hauptprozess: im Entwicklungsmodus immer, sonst nur mit einem Microsoft-Konto im Launcher. */
function offlineAllowed(): boolean {
  return !!state.info?.isDev || state.accounts.some((a) => a.type === 'microsoft');
}

async function loadAccounts(): Promise<void> {
  state.accounts = await api.listAccounts();
  renderAccounts();
  renderHome();
  void refreshFigure();
}

$('#add-microsoft').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('#add-microsoft');
  button.disabled = true;
  try {
    const account = await api.addMicrosoftAccount();
    toast(`Angemeldet als ${account.name}`, 'success');
    await loadAccounts();
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    button.disabled = !state.info?.microsoftConfigured;
  }
});

$('#offline-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = $<HTMLInputElement>('#offline-name');
  try {
    await api.addOfflineAccount(input.value);
    input.value = '';
    await loadAccounts();
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
});

// ---------- Einstellungen ----------
const memoryRange = $<HTMLInputElement>('#memory-range');

function formatGb(mb: number): string {
  return `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
}

function updateMemoryLabel(): void {
  const value = Number(memoryRange.value);
  $('#memory-value').textContent = formatGb(value);
  const fill = ((value - Number(memoryRange.min)) / (Number(memoryRange.max) - Number(memoryRange.min))) * 100;
  memoryRange.style.setProperty('--fill', `${fill}%`);
  const badge = $('#memory-badge');
  badge.classList.toggle('warn', value < 2048 || value > 8192);
  badge.textContent = value < 2048 ? 'Sehr wenig' : value > 8192 ? 'Mehr als nötig' : 'Empfohlen';
}

function renderSettings(): void {
  const s = state.settings;
  const info = state.info;
  if (!s || !info) return;
  const maxMb = Math.max(2048, Math.floor((info.totalMemoryMb * 0.75) / 512) * 512);
  memoryRange.max = String(maxMb);
  memoryRange.value = String(Math.min(s.memoryMb, maxMb));
  $('#memory-max-label').textContent = formatGb(maxMb);
  updateMemoryLabel();

  $<HTMLInputElement>('#resolution-toggle').checked = s.resolution != null;
  $('#resolution-inputs').classList.toggle('disabled', s.resolution == null);
  $<HTMLInputElement>('#res-width').value = String(s.resolution?.width ?? 1280);
  $<HTMLInputElement>('#res-height').value = String(s.resolution?.height ?? 720);
  $<HTMLInputElement>('#hide-toggle').checked = s.hideLauncherOnLaunch;
  $<HTMLInputElement>('#java-path').value = s.javaPath;
  $<HTMLInputElement>('#jvm-args').value = s.jvmArgs;
  $('#data-dir').textContent = info.dataDir;
  $('#about-version').textContent = `v${info.version}`;
  const loader = info.loaderVersion ? `Heldix Loader ${info.loaderVersion}` : 'Heldix Loader';
  $('#about-text').textContent = info.isDev
    ? `Entwicklungsmodus · Offline-Konten aktiv · ${loader}`
    : `${loader} · Minecraft-Dateien kommen direkt von Mojang.`;
  $<HTMLInputElement>('#discord-toggle').checked = s.discordPresence;
  $<HTMLInputElement>('#discord-server-toggle').checked = s.discordShowServer;
  $('#discord-server-row').classList.toggle('disabled', !s.discordPresence);
  renderPerformance(s);
}

// ---------- Leistung ----------
const GRAPHICS_HINTS: Record<Settings['graphicsApi'], string> = {
  vulkan: 'Standard bei HeldixClient. Minecraft startet mit Vulkan und nimmt OpenGL, wenn dein PC kein Vulkan kann. In Minecraft 26.3 ist Vulkan noch als experimentell markiert.',
  default: 'Minecraft entscheidet selbst (zurzeit OpenGL) und schaltet nach einem Absturz beim Start automatisch um.',
  opengl: 'Die bewährte Grafik-API von Minecraft. Gut, falls Vulkan auf deinem PC Probleme macht.',
};

function renderPerformance(s: Settings): void {
  document.querySelectorAll<HTMLButtonElement>('#graphics-api button').forEach((button) => {
    button.classList.toggle('active', button.dataset.api === s.graphicsApi);
  });
  $('#graphics-hint').textContent = `${GRAPHICS_HINTS[s.graphicsApi]} Gilt für Heldix-Instanzen ab Minecraft 26.x; Fabric und Vanilla nutzen die Einstellung im Spiel.`;
  $<HTMLInputElement>('#jvm-tuning-toggle').checked = s.jvmTuning;
}

document.querySelectorAll<HTMLButtonElement>('#graphics-api button').forEach((button) => {
  button.addEventListener('click', async () => {
    await save({ graphicsApi: button.dataset.api as Settings['graphicsApi'] });
    renderSettings();
  });
});
$('#jvm-tuning-toggle').addEventListener('change', (e) => save({ jvmTuning: (e.target as HTMLInputElement).checked }));

// ---------- Discord ----------
function renderDiscordStatus(status: DiscordStatus): void {
  const configured = state.info?.discordConfigured ?? false;
  const texts: Record<DiscordStatus['state'], string> = {
    disabled: 'Aus',
    unconfigured: 'Noch nicht eingerichtet: Die Discord-Application-ID fehlt (siehe README).',
    connecting: 'Verbinde mit Discord …',
    connected: 'Mit Discord verbunden',
    unavailable: 'Discord ist nicht geöffnet. Der Status erscheint, sobald Discord läuft.',
    error: 'Discord lehnt die Verbindung ab',
  };
  let text = texts[status.state];
  if (status.state === 'connected' && status.user) text = `Verbunden als ${status.user}`;
  if (status.state === 'error') {
    text = /client id/i.test(status.message) ? 'Die Discord-Application-ID ist ungültig (siehe README).' : `Discord meldet: ${status.message}`;
  }
  if (status.state === 'disabled' && !configured) text = texts.unconfigured;
  const host = $('#discord-status');
  host.dataset.state = status.state;
  $('#discord-status-text').textContent = text;
  renderDiscordChip(status);
}
$('#discord-toggle').addEventListener('change', (e) => save({ discordPresence: (e.target as HTMLInputElement).checked }));
$('#discord-server-toggle').addEventListener('change', (e) => save({ discordShowServer: (e.target as HTMLInputElement).checked }));
api.onDiscordStatus(renderDiscordStatus);
void api.getDiscordStatus().then(renderDiscordStatus);

async function save(patch: Partial<Settings>): Promise<void> {
  state.settings = await api.saveSettings(patch);
  emit('settings');
}

memoryRange.addEventListener('input', updateMemoryLabel);
memoryRange.addEventListener('change', () => save({ memoryMb: Number(memoryRange.value) }));

function readResolution(): Settings['resolution'] {
  if (!$<HTMLInputElement>('#resolution-toggle').checked) return null;
  const width = Math.max(320, Number($<HTMLInputElement>('#res-width').value) || 1280);
  const height = Math.max(240, Number($<HTMLInputElement>('#res-height').value) || 720);
  return { width, height };
}
$('#resolution-toggle').addEventListener('change', async () => {
  await save({ resolution: readResolution() });
  $('#resolution-inputs').classList.toggle('disabled', state.settings?.resolution == null);
});
for (const id of ['#res-width', '#res-height']) $(id).addEventListener('change', () => save({ resolution: readResolution() }));

$('#hide-toggle').addEventListener('change', (e) => save({ hideLauncherOnLaunch: (e.target as HTMLInputElement).checked }));
$('#java-path').addEventListener('change', (e) => save({ javaPath: (e.target as HTMLInputElement).value.trim() }));
$('#jvm-args').addEventListener('change', (e) => save({ jvmArgs: (e.target as HTMLInputElement).value.trim() }));

document.querySelectorAll<HTMLButtonElement>('[data-folder]').forEach((button) => {
  button.addEventListener('click', () => api.openFolder('data'));
});

// ---------- Konsole ----------
const MAX_LOG_LINES = 5000;
const logEl = $('#log');
let logLines: LogLine[] = [];

function isNearBottom(): boolean {
  return logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
}
function scrollLogToEnd(): void {
  logEl.scrollTop = logEl.scrollHeight;
}

api.onLog((lines) => {
  const stick = isNearBottom();
  logEl.querySelector('.log-empty')?.remove();
  const fragment = document.createDocumentFragment();
  for (const line of lines) {
    fragment.append(h('div', { class: `log-line ${line.level}${line.text.startsWith('[Launcher]') ? ' launcher' : ''}`, text: line.text }));
  }
  logEl.append(fragment);
  logLines.push(...lines);
  const overflow = logLines.length - MAX_LOG_LINES;
  if (overflow > 0) {
    logLines = logLines.slice(overflow);
    for (let i = 0; i < overflow; i++) logEl.firstElementChild?.remove();
  }
  if (lines.some((l) => l.level === 'ERROR' || l.level === 'FATAL') && !$('#view-console').classList.contains('active')) {
    $('#console-dot').hidden = false;
  }
  if (stick) scrollLogToEnd();
});

document.querySelectorAll<HTMLButtonElement>('#log-filter button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('#log-filter button').forEach((b) => b.classList.toggle('active', b === button));
    logEl.classList.toggle('problems-only', button.dataset.filter === 'problems');
  });
});
$('#copy-log').addEventListener('click', async () => {
  await navigator.clipboard.writeText(logLines.map((l) => l.text).join('\n'));
  toast('Log in die Zwischenablage kopiert.', 'success');
});
$('#clear-log').addEventListener('click', () => {
  logLines = [];
  logEl.textContent = '';
});
$('#kill-game').addEventListener('click', () => api.killGame());

// ---------- Start ----------
async function init(): Promise<void> {
  const started = performance.now();
  [state.info, state.settings, state.game] = await Promise.all([api.appInfo(), api.getSettings(), api.getGameState()]);
  initInstances(showView);
  renderSettings();
  await loadAccounts();
  await reloadInstances();
  void loadNews();
  try {
    state.versions = await api.listVersions();
    if (state.versions.offline) toast('Offline: Die Versionsliste kommt aus dem Cache.');
  } catch (error) {
    toast(`Versionsliste nicht verfügbar: ${errorMessage(error)}`, 'error');
  }
  // Splash mindestens kurz zeigen, damit er nicht nur aufblitzt
  const wait = Math.max(0, 900 - (performance.now() - started));
  window.setTimeout(() => $('#splash').classList.add('hide'), wait);
}

init().catch((error) => {
  $('#splash').classList.add('hide');
  toast(errorMessage(error), 'error');
});
