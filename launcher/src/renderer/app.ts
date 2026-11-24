import type { AccountInfo, DiscordStatus, LogLine, Settings } from '../shared/api';
import {
  $,
  api,
  emit,
  errorMessage,
  formatRelative,
  h,
  instanceTile,
  LOADER_LABELS,
  on,
  reloadInstances,
  selectedInstance,
  state,
  toast,
} from './core.js';
import { initInstances, launchInstance, resetInstancesView } from './instances.js';

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

// ---------- Startseite: Begrüßung und zuletzt gespielte Instanzen ----------
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Gute Nacht';
  if (hour < 11) return 'Guten Morgen';
  if (hour < 18) return 'Hallo';
  return 'Guten Abend';
}

function renderHero(): void {
  const active = state.accounts.find((a) => a.active);
  $('#hero-greeting').textContent = active ? `${greeting()}, ${active.name}` : `${greeting()}!`;
  $('#hero-version').textContent = state.info ? `Version ${state.info.version}${state.info.loaderVersion ? ` · Heldix Loader ${state.info.loaderVersion}` : ''}` : '';
  const list = $('#hero-recent');
  list.textContent = '';
  const recent = [...state.instances].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || b.created - a.created).slice(0, 3);
  if (recent.length === 0) {
    list.append(h('div', { class: 'recent-empty', text: 'Noch keine Instanzen. Lege unter „Instanzen“ eine an.' }));
    return;
  }
  const selectedId = selectedInstance()?.id;
  for (const instance of recent) {
    list.append(h('div', {
      class: `recent-card${instance.id === selectedId ? ' selected' : ''}`,
      title: 'Auswählen',
      onclick: async () => {
        await api.selectInstance(instance.id);
        await reloadInstances();
      },
    },
    instanceTile(instance, 'small'),
    h('div', { class: 'recent-text' },
      h('div', { class: 'recent-name', text: instance.name }),
      h('div', { class: 'recent-meta', text: `${instance.minecraft} · ${LOADER_LABELS[instance.loader]}` }))));
  }
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
    const size = el.classList.contains('small') ? 32 : 38;
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

// ---------- Instanz-Auswahl auf der Startseite ----------
const instanceButton = $('#instance-button');
const instancePanel = $('#instance-panel');

function instanceMeta(instance = selectedInstance()): string {
  if (!instance) return '';
  return `Minecraft ${instance.minecraft} · ${LOADER_LABELS[instance.loader]}`;
}

function renderInstanceButton(): void {
  const instance = selectedInstance();
  const tileHost = $('#instance-button-tile');
  tileHost.textContent = '';
  if (instance) tileHost.append(instanceTile(instance, 'small'));
  $('#instance-button-name').textContent = instance?.name ?? 'Keine Instanz';
  $('#instance-button-meta').textContent = instance ? instanceMeta(instance) : 'Lege eine Instanz an';
}

function renderInstancePanel(): void {
  const list = $('#instance-panel-list');
  list.textContent = '';
  for (const instance of state.instances) {
    const selected = instance.id === selectedInstance()?.id;
    list.append(h('div', {
      class: `instance-option${selected ? ' selected' : ''}`,
      onclick: async () => {
        closeInstancePanel();
        await api.selectInstance(instance.id);
        await reloadInstances();
      },
    },
    instanceTile(instance, 'small'),
    h('div', { class: 'instance-option-text' },
      h('div', { class: 'instance-option-name', text: instance.name }),
      h('div', { class: 'instance-option-meta', text: `${instanceMeta(instance)} · ${formatRelative(instance.lastPlayed)}` }))));
  }
}

function closeInstancePanel(): void {
  instancePanel.hidden = true;
  instanceButton.classList.remove('open');
}

instanceButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (instancePanel.hidden) {
    renderInstancePanel();
    instancePanel.hidden = false;
    instanceButton.classList.add('open');
  } else {
    closeInstancePanel();
  }
});
instancePanel.addEventListener('click', (event) => event.stopPropagation());
$('#panel-manage').addEventListener('click', () => {
  closeInstancePanel();
  showView('instances');
});
$('#panel-new-instance').addEventListener('click', () => {
  closeInstancePanel();
  showView('instances');
  $('#new-instance').click();
});

// ---------- Status & Spielen ----------
function describeSelection(): string {
  const instance = selectedInstance();
  if (!instance) return 'Lege unter „Instanzen“ eine Instanz an.';
  if (instance.loader === 'vanilla') return `Minecraft ${instance.minecraft} ohne Mods`;
  const mods = `${instance.modCount} ${instance.modCount === 1 ? 'Mod' : 'Mods'}`;
  if (instance.loader === 'fabric') return `Minecraft ${instance.minecraft} mit Fabric · ${mods}`;
  return `Minecraft ${instance.minecraft} mit Heldix Loader · ${mods} · ${instance.addonCount} ${instance.addonCount === 1 ? 'Addon' : 'Addons'}`;
}

function setChip(text: string | null, busy = false): void {
  const chip = $('#titlebar-chip');
  chip.hidden = text == null;
  chip.classList.toggle('busy', busy);
  if (text) $('#titlebar-chip-text').textContent = text;
}

function renderStatus(): void {
  const dot = $('#status-dot');
  const text = $('#status-text');
  const sub = $('#status-sub');
  const play = $<HTMLButtonElement>('#play-button');
  const playLabel = $('#play-label');
  const pill = $('#hero-pill');
  const game = state.game;
  const instance = selectedInstance();

  play.classList.remove('stop', 'busy');
  play.disabled = false;
  $<HTMLButtonElement>('#kill-game').disabled = game.state !== 'running';
  setChip(null);

  if (game.state === 'preparing') {
    const p = state.progress;
    const percent = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    dot.className = 'status-dot busy';
    play.classList.add('busy');
    play.disabled = true;
    play.style.setProperty('--p', `${percent}%`);
    playLabel.textContent = p && p.total > 0 ? `${percent} %` : 'LÄDT …';
    text.textContent = p ? p.stage : 'Vorbereiten …';
    sub.textContent = p && p.total > 0 ? `${p.done.toLocaleString('de-DE')} von ${p.total.toLocaleString('de-DE')} Dateien` : 'Prüfe Dateien …';
    pill.textContent = 'Minecraft wird vorbereitet';
    setChip('Lädt …', true);
    return;
  }
  if (game.state === 'running') {
    dot.className = 'status-dot';
    text.textContent = `Läuft · ${game.label}`;
    const running = state.instances.find((i) => i.id === game.instanceId);
    sub.textContent = running?.loader === 'heldix' ? 'Viel Spaß! Mit Rechts ⇧ öffnest du im Spiel das Heldix-Menü.' : 'Viel Spaß!';
    play.classList.add('stop');
    playLabel.textContent = 'BEENDEN';
    pill.textContent = 'Minecraft läuft';
    setChip(`Läuft · ${game.label}`);
    return;
  }

  playLabel.textContent = 'SPIELEN';
  pill.textContent = instance ? `${instance.name} · ${instanceMeta(instance)}` : 'Bereit für Minecraft';
  const active = state.accounts.find((a) => a.active);
  if (!instance) {
    dot.className = 'status-dot muted';
    text.textContent = 'Keine Instanz';
    sub.textContent = describeSelection();
    play.disabled = true;
    return;
  }
  if (!active) {
    dot.className = 'status-dot muted';
    text.textContent = 'Nicht angemeldet';
    sub.textContent = 'Klicke unten links auf das Profil, um ein Konto hinzuzufügen.';
    return;
  }
  if (active.type === 'offline' && !state.info?.isDev) {
    dot.className = 'status-dot muted';
    text.textContent = `${active.name} ist ein Offline-Konto`;
    sub.textContent = 'Offline-Konten gehen nur im Entwicklungsmodus. Bitte mit Microsoft anmelden.';
    play.disabled = true;
    return;
  }
  dot.className = game.state === 'error' ? 'status-dot error' : 'status-dot';
  text.textContent = game.state === 'error' ? 'Start fehlgeschlagen' : `Bereit · ${active.name}`;
  sub.textContent = game.state === 'error' ? game.message : describeSelection();
}

$('#play-button').addEventListener('click', async () => {
  if (state.game.state === 'running') {
    await api.killGame();
    return;
  }
  if (!state.accounts.some((a) => a.active)) {
    openAccounts();
    toast('Bitte zuerst ein Konto hinzufügen.');
    return;
  }
  const instance = selectedInstance();
  if (instance) await launchInstance(instance.id, showView);
});

api.onProgress((progress) => {
  state.progress = progress;
  if (state.game.state === 'preparing') renderStatus();
});

api.onGameState(async (game) => {
  state.game = game;
  if (game.state === 'preparing') state.progress = null;
  if (game.state === 'exited' && game.code !== 0 && game.code !== null) {
    toast(`Minecraft wurde mit Fehlercode ${game.code} beendet. Details in der Konsole.`, 'error');
    $('#console-dot').hidden = false;
  }
  renderStatus();
  if (game.state === 'running' || game.state === 'exited') await reloadInstances();
});

on('instances', () => {
  renderInstanceButton();
  renderStatus();
  renderHero();
});

// ---------- Konten ----------
const popover = $('#account-popover');

function openAccounts(): void {
  popover.hidden = false;
  renderAccounts();
}

$('#account-button').addEventListener('click', (event) => {
  event.stopPropagation();
  if (popover.hidden) openAccounts();
  else popover.hidden = true;
});
popover.addEventListener('click', (event) => event.stopPropagation());
document.addEventListener('click', () => {
  popover.hidden = true;
  closeInstancePanel();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  popover.hidden = true;
  closeInstancePanel();
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
      h('div', { class: 'account-type', text: account.type === 'microsoft' ? 'Microsoft' : 'Offline (Dev)' })),
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
  $('#offline-form').hidden = !info?.isDev;
}

async function loadAccounts(): Promise<void> {
  state.accounts = await api.listAccounts();
  renderAccounts();
  renderStatus();
  renderHero();
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
}

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
