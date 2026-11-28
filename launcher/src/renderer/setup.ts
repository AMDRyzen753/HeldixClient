// Einrichtungs-Assistent beim ersten Start (main/core/setup.ts): vollflächig über dem Launcher, vier Schritte mit
// Fortschrittspunkten, „Zurück“/„Weiter“ und jederzeit „Überspringen“.
//
//   #setup[data-step]                 Willkommen → Konto → Addons → Fertig (data-step: welcome|account|addons|done)
//   #setup-dots > li[data-step]       Fortschrittspunkte (aria-current="step" am aktuellen)
//   #setup-skip, #setup-back, #setup-next   Überspringen, Zurück, Weiter (auf „Fertig“: „Los geht's“)
//   Willkommen: #setup-invite (Karte, nur mit Einladung; data-state loading|ok|missing|error)
//   Konto:      #setup-signin (Microsoft-Anmeldung über den vorhandenen Ablauf), #setup-account (angemeldet),
//               #setup-signin-error; ohne Anmeldung heißt #setup-next „Später“
//   Addons:     .setup-addon[data-id] mit input.setup-addon-check, #setup-addons-all, #setup-addons-none,
//               #setup-addons-count, #setup-addons-offline (+ #setup-addons-retry), #setup-addons-empty
//   Fertig:     #setup-summary, #setup-install > .setup-install-row[data-id][data-state=wait|busy|done|error],
//               #setup-progress (role=progressbar)
//
// Solange der Assistent offen ist, hält der Main-Prozess Einladung und „Neu in …“ zurück. Nach dem Schließen
// (finishSetup) ruft app.ts hooks.closed(): Einladungsdialog, „Neu in …“, Hinweis „Update verfügbar“.
import type { AccountInfo, PublicInviteView, SetupAddon, SetupAddons, SetupInfo, SetupInstallResult } from '../shared/api';
import { api, errorMessage, h, state, toast, uiIcon } from './core.js';
import { playerHead } from './friends.js';
import { UI_ICONS } from './ui-icons.js';

export interface SetupHooks {
  /** Konten neu laden (nach der Anmeldung) */
  reloadAccounts(): Promise<void>;
  /** Instanzen neu laden (Addon-Zähler nach der Installation) */
  reloadInstances(): Promise<void>;
  /** Assistent ist offen (z. B. 3D-Figur anhalten) */
  opened(): void;
  /** Assistent ist zu: Einladungsdialog, „Neu in …“, Hinweise */
  closed(): void;
}

type Step = 'welcome' | 'account' | 'addons' | 'done';
const STEPS: { id: Step; label: string }[] = [
  { id: 'welcome', label: 'Willkommen' },
  { id: 'account', label: 'Konto' },
  { id: 'addons', label: 'Addons' },
  { id: 'done', label: 'Fertig' },
];

type InstallState = 'wait' | 'busy' | 'done' | 'error';

interface Run {
  root: HTMLElement;
  step: Step;
  invite: { code: string; view: PublicInviteView | null } | null;
  /** null = wird geladen */
  addons: SetupAddons | null;
  selected: Set<string>;
  /** Auswahl selbst geändert (dann nicht mehr auf die Vorauswahl zurücksetzen) */
  touched: boolean;
  signingIn: boolean;
  signInError: string | null;
  install: { started: boolean; finished: boolean; ids: string[]; states: Map<string, { state: InstallState; text: string }> };
  previousFocus: HTMLElement | null;
}

let run: Run | null = null;
let hooks: SetupHooks | null = null;
const afterClose: (() => void)[] = [];

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Assistent gerade offen? */
export function setupOpen(): boolean {
  return run !== null;
}

/** fn sofort ausführen oder, solange der Assistent offen ist, danach */
export function afterSetup(fn: () => void): void {
  if (run) afterClose.push(fn);
  else fn();
}

export function initSetup(options: SetupHooks): void {
  hooks = options;
  // neuer Link, während der Assistent offen ist: die Karte zeigt ihn (der Dialog kommt danach)
  api.onInviteOpen(() => {
    if (run) void refreshInvite();
  });
}

/** Beim Start (app.ts): zeigen, wenn der Main-Prozess es sagt (erster Start, setupDone = false) */
export async function startSetupIfNeeded(): Promise<boolean> {
  const info = await api.getSetup().catch(() => null);
  if (!info?.show) return false;
  open(info);
  return true;
}

/** Einstellungen → „Einrichtung erneut starten“ */
export async function restartSetup(): Promise<void> {
  if (run) return;
  try {
    open(await api.restartSetup());
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

// ---------- Hilfen ----------

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '–';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('de-DE')} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;
}

function addonIcon(icon: string, extra = ''): HTMLElement {
  return h('span', { class: `setup-addon-icon${extra ? ` ${extra}` : ''}`, 'aria-hidden': 'true' }, uiIcon(UI_ICONS[icon] ? icon : 'addons'));
}

function activeAccount(): AccountInfo | undefined {
  return state.accounts.find((a) => a.active);
}

function el<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return run?.root.querySelector<T>(selector) ?? null;
}

/** Auswahl in der Reihenfolge der Liste (nur, was noch nicht installiert ist) */
function chosen(current: Run): SetupAddon[] {
  return (current.addons?.addons ?? []).filter((a) => !a.installed && current.selected.has(a.id));
}

function announce(text: string): void {
  const live = el('#setup-live');
  if (!live) return;
  live.textContent = '';
  window.setTimeout(() => (live.textContent = text), 30);
}

// ---------- Öffnen und Schließen ----------

function open(info: SetupInfo): void {
  if (run) return;
  const root = h('div', { id: 'setup', class: 'setup', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'setup-title' },
    h('div', { class: 'setup-backdrop', 'aria-hidden': 'true' }, h('div', { class: 'setup-art' }), h('div', { class: 'setup-glow' })),
    h('header', { class: 'setup-top' },
      h('div', { class: 'setup-brand' }, h('img', { src: 'logo.svg', alt: '', class: 'setup-brand-logo' }), h('span', { class: 'setup-brand-name' }, 'Heldix ', h('span', { text: 'Client' }))),
      h('ol', { class: 'setup-dots', id: 'setup-dots', 'aria-label': 'Schritte der Einrichtung' },
        ...STEPS.map((step, index) => h('li', { class: 'setup-dot', 'data-step': step.id },
          h('span', { class: 'setup-dot-mark', 'aria-hidden': 'true' }, h('span', { class: 'setup-dot-number', text: String(index + 1) }), uiIcon('check', 'setup-dot-check')),
          h('span', { class: 'setup-dot-label', text: step.label })))),
      h('button', { class: 'setup-skip', id: 'setup-skip', type: 'button', title: 'Einrichtung überspringen – alles geht später auch in den Einstellungen und im Addon-Store', onclick: () => void close(true) }, 'Überspringen')),
    h('div', { class: 'setup-stage', id: 'setup-stage' }, h('section', { class: 'setup-step', id: 'setup-step' })),
    h('footer', { class: 'setup-foot' },
      h('div', { class: 'setup-foot-inner' },
        h('button', { class: 'ghost', id: 'setup-back', type: 'button', onclick: back }, uiIcon('chevron-left', 'btn-icon'), h('span', { text: 'Zurück' })),
        h('span', { class: 'setup-foot-hint', id: 'setup-foot-hint' }),
        h('button', { class: 'primary', id: 'setup-next', type: 'button', onclick: next }, h('span', { id: 'setup-next-label', text: 'Weiter' }), uiIcon('chevron-right', 'btn-icon')))),
    h('p', { class: 'setup-live', id: 'setup-live', 'aria-live': 'polite' }));
  root.addEventListener('keydown', trapFocus);
  run = {
    root,
    step: 'welcome',
    invite: info.invite ? { code: info.invite, view: null } : null,
    addons: null,
    selected: new Set(),
    touched: false,
    signingIn: false,
    signInError: null,
    install: { started: false, finished: false, ids: [], states: new Map() },
    previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
  };
  document.body.append(root);
  document.body.classList.add('setup-open');
  // alles dahinter ist für Maus, Tastatur und Screenreader weg, solange der Assistent offen ist
  const app = document.querySelector<HTMLElement>('.app');
  if (app) app.inert = true;
  hooks?.opened();
  render(true);
  // im Hintergrund vorbereiten: Einladung und Addons
  if (run.invite) void loadInvite(run);
  void loadAddons(run);
}

async function close(skipped: boolean): Promise<void> {
  const current = run;
  if (!current) return;
  run = null;
  // zuerst dem Main-Prozess Bescheid sagen: dann gibt er Einladung und „Neu in …“ wieder heraus
  await api.finishSetup(skipped).catch(() => undefined);
  current.root.classList.add('closing');
  window.setTimeout(() => current.root.remove(), 220);
  document.body.classList.remove('setup-open');
  const app = document.querySelector<HTMLElement>('.app');
  if (app) app.inert = false;
  const focus = current.previousFocus?.isConnected ? current.previousFocus : document.querySelector<HTMLElement>('#play-button');
  focus?.focus();
  if (current.install.started && !current.install.finished) toast('Die Addons werden im Hintergrund weiter installiert.');
  hooks?.closed();
  for (const fn of afterClose.splice(0)) fn();
}

/** Tab und Umschalt+Tab bleiben im Assistenten */
function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab' || !run) return;
  const items = [...run.root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.offsetParent !== null || item === document.activeElement);
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const inside = run.root.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || !inside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
    event.preventDefault();
    first.focus();
  }
}

// ---------- Navigation ----------

const order = (step: Step) => STEPS.findIndex((s) => s.id === step);

function go(step: Step): void {
  if (!run) return;
  run.step = step;
  render(true);
  if (step === 'done') void startInstall(run);
}

function next(): void {
  if (!run) return;
  if (run.step === 'done') {
    void close(false);
    return;
  }
  go(STEPS[order(run.step) + 1].id);
}

function back(): void {
  if (!run || run.step === 'welcome' || run.step === 'done') return;
  go(STEPS[order(run.step) - 1].id);
}

// ---------- Darstellung ----------

/** Schritt neu zeichnen; withFocus = Fokus auf das Wichtigste im Schritt (beim Wechsel) */
function render(withFocus = false): void {
  const current = run;
  if (!current) return;
  current.root.dataset.step = current.step;
  const index = order(current.step);
  current.root.querySelectorAll<HTMLElement>('.setup-dot').forEach((dot, i) => {
    dot.classList.toggle('done', i < index);
    dot.classList.toggle('current', i === index);
    if (i === index) dot.setAttribute('aria-current', 'step');
    else dot.removeAttribute('aria-current');
  });
  const body = el('#setup-step')!;
  const content = current.step === 'welcome' ? welcomeStep(current)
    : current.step === 'account' ? accountStep(current)
      : current.step === 'addons' ? addonsStep(current)
        : doneStep(current);
  body.replaceChildren(...content);
  body.dataset.step = current.step;
  renderFoot(current);
  if (current.step === 'addons') updateSelection(current);
  if (withFocus) {
    // Animation nur beim Wechsel
    body.classList.remove('enter');
    void body.offsetWidth;
    body.classList.add('enter');
    el('#setup-stage')?.scrollTo({ top: 0 });
    announce(`Schritt ${index + 1} von ${STEPS.length}: ${STEPS[index].label}`);
    focusMain(current);
  }
}

function renderFoot(current: Run): void {
  const backButton = el<HTMLButtonElement>('#setup-back')!;
  const nextButton = el<HTMLButtonElement>('#setup-next')!;
  const label = el('#setup-next-label')!;
  const hint = el('#setup-foot-hint')!;
  backButton.hidden = current.step === 'welcome' || current.step === 'done';
  el('#setup-skip')!.hidden = current.step === 'done';
  nextButton.className = 'primary';
  nextButton.disabled = false;
  hint.textContent = '';
  switch (current.step) {
    case 'welcome':
      label.textContent = 'Einrichten';
      hint.textContent = 'Dauert keine Minute – alles lässt sich später ändern.';
      break;
    case 'account': {
      const signedIn = !!activeAccount();
      label.textContent = signedIn ? 'Weiter' : 'Später';
      if (!signedIn) nextButton.className = 'ghost';
      nextButton.disabled = current.signingIn;
      if (!signedIn) hint.textContent = 'Ohne Anmeldung kannst du noch nicht spielen.';
      break;
    }
    case 'addons': {
      const picked = chosen(current);
      label.textContent = 'Weiter';
      if (current.addons?.status === 'ok' && current.addons.addons.length > 0) {
        hint.textContent = picked.length === 0 ? 'Keine Addons ausgewählt' : `${picked.length === 1 ? '1 Addon' : `${picked.length} Addons`} · ${formatBytes(picked.reduce((sum, a) => sum + a.size, 0))}`;
      } else if (current.addons && current.addons.status !== 'ok') hint.textContent = 'Addons gibt es auch später im Addon-Store.';
      break;
    }
    case 'done':
      label.textContent = 'Los geht\'s';
      if (current.install.started && !current.install.finished) hint.textContent = 'Die Installation läuft auch im Hintergrund weiter.';
      else if (current.invite) hint.textContent = 'Gleich danach zeigen wir dir deine Einladung.';
      break;
  }
}

function focusMain(current: Run): void {
  window.setTimeout(() => {
    if (run !== current) return;
    const target = current.step === 'account' && !activeAccount() ? el<HTMLButtonElement>('#setup-signin') : null;
    (target && !target.disabled ? target : el<HTMLButtonElement>('#setup-next'))?.focus();
  }, 40);
}

function stepHead(title: string, sub: string, icon?: string): HTMLElement {
  return h('div', { class: 'setup-head' },
    icon ? h('span', { class: 'setup-head-icon', 'aria-hidden': 'true' }, uiIcon(icon)) : null,
    h('h2', { class: 'setup-title', id: 'setup-title', tabindex: '-1', text: title }),
    h('p', { class: 'setup-sub', text: sub }));
}

// ---------- Schritt 1: Willkommen ----------

function welcomeStep(current: Run): Node[] {
  const feature = (icon: string, title: string, text: string) => h('div', { class: 'setup-feature' },
    h('span', { class: 'setup-feature-icon', 'aria-hidden': 'true' }, uiIcon(icon)),
    h('h3', { text: title }),
    h('p', { text }));
  return [
    h('div', { class: 'setup-hero' },
      h('img', { src: 'logo.svg', alt: '', class: 'setup-logo' }),
      h('h2', { class: 'setup-title big', id: 'setup-title', tabindex: '-1', text: 'Willkommen bei HeldixClient' }),
      h('p', { class: 'setup-sub', text: 'In drei kurzen Schritten ist alles bereit: Konto verbinden, Addons aussuchen, losspielen.' })),
    current.invite ? inviteCard(current) : null,
    h('div', { class: 'setup-features' },
      feature('performance', 'Schneller Client', 'Eigenes HUD, Heldix-Menü, Shader und Vulkan – startklar ohne Bastelei.'),
      feature('addons', 'Addons mit einem Klick', 'Voice Chat, Minimap und mehr – geprüft und signiert vom HeldixClient-Team.'),
      feature('friends', 'Zusammen spielen', 'Freunde, Nachrichten und Einladungen direkt im Launcher und im Spiel.')),
  ].filter((n): n is HTMLElement => n !== null);
}

function inviteCard(current: Run): HTMLElement {
  const invite = current.invite!;
  const view = invite.view;
  if (!view) {
    return h('div', { class: 'setup-invite', id: 'setup-invite', 'data-state': 'loading' },
      h('div', { class: 'friends-spinner', 'aria-hidden': 'true' }),
      h('div', { class: 'setup-invite-text' }, h('strong', { text: 'Du hast eine Einladung bekommen' }), h('span', { text: 'Wird geladen …' })));
  }
  if (view.status !== 'ok' || !view.inviter) {
    const missing = view.status === 'missing';
    return h('div', { class: 'setup-invite muted', id: 'setup-invite', 'data-state': missing ? 'missing' : 'error' },
      h('span', { class: 'setup-invite-icon', 'aria-hidden': 'true' }, uiIcon(missing ? 'warning' : 'user-plus')),
      h('div', { class: 'setup-invite-text' },
        h('strong', { text: missing ? 'Diese Einladung gibt es nicht mehr' : 'Du hast eine Einladung bekommen' }),
        h('span', { text: missing ? 'Vielleicht ist sie abgelaufen – bitte deinen Freund um einen neuen Link.' : 'Sie lässt sich gerade nicht laden. Nach der Einrichtung versuchen wir es noch einmal.' })));
  }
  const details = [
    view.server ? `Komm auf ${view.server}` : 'Ihr seid nach dem Annehmen gleich befreundet',
    view.welcome ? `Willkommens-Belohnung: ${view.welcome.name}` : '',
  ].filter(Boolean).join(' · ');
  return h('div', { class: 'setup-invite', id: 'setup-invite', 'data-state': 'ok' },
    playerHead(view.inviter.uuid, view.inviter.name, 'md'),
    h('div', { class: 'setup-invite-text' },
      h('strong', { text: `${view.inviter.name} hat dich eingeladen` }),
      h('span', { text: details }),
      h('small', { text: 'Annehmen kannst du nach der Anmeldung – gleich nach der Einrichtung.' })));
}

async function loadInvite(current: Run): Promise<void> {
  const invite = current.invite;
  if (!invite) return;
  let view: PublicInviteView;
  try {
    view = await api.getPublicInvite(invite.code);
  } catch (error) {
    view = { code: invite.code, status: 'error', error: errorMessage(error), inviter: null, server: null, voice: null, expires: 0, welcome: null, account: null, acceptProblem: null, join: null, joinProblem: null };
  }
  if (run !== current || current.invite?.code !== invite.code) return;
  current.invite.view = view;
  if (current.step === 'welcome') {
    el('#setup-invite')?.replaceWith(inviteCard(current));
  }
}

/** Link geöffnet, während der Assistent läuft */
async function refreshInvite(): Promise<void> {
  const current = run;
  if (!current) return;
  const info = await api.getSetup().catch(() => null);
  if (run !== current || !info?.invite || info.invite === current.invite?.code) return;
  current.invite = { code: info.invite, view: null };
  if (current.step === 'welcome') render();
  void loadInvite(current);
}

// ---------- Schritt 2: Konto ----------

function accountStep(current: Run): Node[] {
  const account = activeAccount();
  const nodes: Node[] = [stepHead(account ? 'Du bist angemeldet' : 'Mit Microsoft anmelden',
    account ? 'Mit diesem Konto spielst du. Weitere Konten fügst du später über dein Konto unten links hinzu.'
      : 'Melde dich mit dem Microsoft-Konto an, mit dem du Minecraft: Java Edition gekauft hast. Dein Passwort gibst du nur im Fenster von Microsoft ein.',
    account ? 'check' : 'user')];
  const card = h('div', { class: 'setup-card setup-account-card' });
  if (account) {
    card.append(h('div', { class: 'setup-account', id: 'setup-account' },
      playerHead(account.uuid, account.name, 'md'),
      h('div', { class: 'setup-account-text' },
        h('strong', { text: account.name }),
        h('span', { text: account.type === 'microsoft' ? (account.via === 'launcher' ? 'Microsoft-Konto · bitte neu anmelden' : 'Microsoft-Konto · angemeldet') : 'Offline-Konto (Entwicklung)' })),
      h('span', { class: 'setup-account-ok', 'aria-hidden': 'true' }, uiIcon('check'))));
  } else {
    const configured = !!state.info?.microsoftConfigured;
    card.append(h('button', { class: 'primary big setup-signin', id: 'setup-signin', type: 'button', disabled: current.signingIn || !configured, onclick: () => void signIn() },
      uiIcon('microsoft', 'btn-icon'), h('span', { text: current.signingIn ? 'Anmeldung läuft …' : 'Mit Microsoft anmelden' })));
    if (current.signingIn) card.append(h('p', { class: 'setup-note', text: 'Melde dich im Fenster von Microsoft an. Danach geht es hier weiter.' }));
    if (!configured) card.append(h('p', { class: 'setup-note warn', text: 'Für die Microsoft-Anmeldung fehlt in dieser Version die Client-ID.' }));
    if (current.signInError) {
      card.append(h('p', { class: 'setup-error', id: 'setup-signin-error', role: 'alert' }, uiIcon('warning', 'setup-error-icon'), h('span', { text: current.signInError })));
    }
  }
  nodes.push(card);
  const notes: string[] = [];
  if (current.invite && !account) notes.push('Zum Annehmen deiner Einladung brauchst du die Anmeldung.');
  if (!account) notes.push('Du kannst das auch später machen: auf der Startseite oben auf „bitte anmelden“.');
  if (notes.length) nodes.push(h('ul', { class: 'setup-notes' }, ...notes.map((n) => h('li', {}, uiIcon('info', 'setup-note-icon'), h('span', { text: n })))));
  return nodes;
}

async function signIn(): Promise<void> {
  const current = run;
  if (!current || current.signingIn) return;
  current.signingIn = true;
  current.signInError = null;
  if (current.step === 'account') render();
  try {
    const account = await api.addMicrosoftAccount();
    await hooks?.reloadAccounts().catch(() => undefined);
    toast(`Angemeldet als ${account.name}`, 'success');
  } catch (error) {
    current.signInError = errorMessage(error);
  }
  current.signingIn = false;
  if (run === current && current.step === 'account') {
    render();
    focusMain(current);
  }
}

// ---------- Schritt 3: Addons ----------

async function loadAddons(current: Run): Promise<void> {
  current.addons = null;
  if (current.step === 'addons') render();
  let result: SetupAddons;
  try {
    result = await api.getSetupAddons();
  } catch (error) {
    result = { status: 'offline', error: errorMessage(error), addons: [], targets: [] };
  }
  if (run !== current) return;
  current.addons = result;
  if (!current.touched) current.selected = new Set(result.addons.filter((a) => a.preselected).map((a) => a.id));
  if (current.step === 'addons') render();
}

function addonsStep(current: Run): Node[] {
  const head = stepHead('Addons aussuchen', 'Offizielle Addons vom HeldixClient-Team – geprüft und signiert. Später kannst du sie jederzeit im Addon-Store ändern.', 'addons');
  const data = current.addons;
  if (!data) {
    return [head, h('div', { class: 'setup-loading' }, h('div', { class: 'friends-spinner', 'aria-hidden': 'true' }), h('span', { text: 'Addons werden geladen …' }))];
  }
  if (data.status === 'offline') {
    return [head, h('div', { class: 'setup-card setup-offline', id: 'setup-addons-offline' },
      h('span', { class: 'setup-offline-icon', 'aria-hidden': 'true' }, uiIcon('signal')),
      h('div', {},
        h('strong', { text: 'Der Addon-Store ist gerade nicht erreichbar' }),
        h('p', { text: 'Kein Problem: Überspring diesen Schritt und installiere Addons später im Addon-Store.' })),
      h('button', { class: 'ghost', id: 'setup-addons-retry', type: 'button', onclick: () => void loadAddons(current) }, uiIcon('refresh', 'btn-icon'), 'Erneut versuchen'))];
  }
  if (data.status === 'no-instance') {
    return [head, h('div', { class: 'setup-card setup-offline', id: 'setup-addons-offline' },
      h('span', { class: 'setup-offline-icon', 'aria-hidden': 'true' }, uiIcon('modules')),
      h('div', {},
        h('strong', { text: 'Noch keine Instanz mit HeldixClient' }),
        h('p', { text: 'Addons laufen in Instanzen mit HeldixClient. Leg unter „Instanzen“ eine an und installiere Addons dann im Addon-Store.' })))];
  }
  if (data.addons.length === 0) {
    return [head, h('div', { class: 'setup-card setup-offline', id: 'setup-addons-empty' },
      h('span', { class: 'setup-offline-icon', 'aria-hidden': 'true' }, uiIcon('addons')),
      h('div', {}, h('strong', { text: 'Gerade gibt es keine passenden Addons' }), h('p', { text: 'Schau später im Addon-Store vorbei – dort kommen laufend neue dazu.' })))];
  }
  const selectable = data.addons.filter((a) => !a.installed);
  const setAll = (on: boolean) => {
    current.touched = true;
    current.selected = new Set(on ? selectable.map((a) => a.id) : []);
    current.root.querySelectorAll<HTMLInputElement>('.setup-addon-check').forEach((box) => {
      if (!box.disabled) box.checked = on;
    });
    updateSelection(current);
  };
  const target = data.targets.length === 1 ? `in „${data.targets[0].name}“` : `in ${data.targets.length} Instanzen`;
  return [
    head,
    h('div', { class: 'setup-toolbar' },
      h('span', { class: 'setup-toolbar-text', id: 'setup-addons-count' }),
      h('span', { class: 'setup-toolbar-target', text: `Wird installiert ${target}` }),
      h('div', { class: 'chip-toggle setup-toolbar-buttons', role: 'group', 'aria-label': 'Auswahl' },
        h('button', { type: 'button', id: 'setup-addons-all', onclick: () => setAll(true) }, 'Alle'),
        h('button', { type: 'button', id: 'setup-addons-none', onclick: () => setAll(false) }, 'Keine'))),
    h('div', { class: 'setup-addons', id: 'setup-addons', role: 'group', 'aria-label': 'Addons' }, ...data.addons.map((addon) => addonCard(current, addon))),
  ];
}

function addonCard(current: Run, addon: SetupAddon): HTMLElement {
  const box = h('input', {
    type: 'checkbox',
    class: 'setup-addon-check',
    id: `setup-addon-${addon.id}`,
    value: addon.id,
    disabled: addon.installed,
    'aria-describedby': `setup-addon-${addon.id}-text`,
  }) as HTMLInputElement;
  box.checked = !addon.installed && current.selected.has(addon.id);
  box.addEventListener('change', () => {
    current.touched = true;
    if (box.checked) current.selected.add(addon.id);
    else current.selected.delete(addon.id);
    updateSelection(current);
  });
  const pills = [
    addon.installed ? h('span', { class: 'setup-pill ok', text: 'Installiert' }) : addon.recommended ? h('span', { class: 'setup-pill accent', text: 'Empfohlen' }) : null,
    addon.access === 'minecraft' ? h('span', { class: 'setup-pill warn', title: 'Verändert Minecraft direkt, nicht nur über die Heldix-API – vom HeldixClient-Team geprüft.', text: 'Greift in Minecraft ein' }) : null,
  ];
  return h('label', { class: `setup-addon${addon.installed ? ' installed' : ''}`, 'data-id': addon.id, for: `setup-addon-${addon.id}` },
    box,
    addonIcon(addon.icon),
    h('span', { class: 'setup-addon-body' },
      h('span', { class: 'setup-addon-name' }, h('strong', { text: addon.name }), ...pills),
      h('span', { class: 'setup-addon-summary', id: `setup-addon-${addon.id}-text`, text: addon.summary }),
      h('span', { class: 'setup-addon-meta', text: `${formatBytes(addon.size)} · Version ${addon.version}` })),
    h('span', { class: 'setup-tick', 'aria-hidden': 'true' }, uiIcon('check')));
}

function updateSelection(current: Run): void {
  const count = el('#setup-addons-count');
  const list = current.addons?.addons ?? [];
  const selectable = list.filter((a) => !a.installed).length;
  const picked = chosen(current).length;
  if (count) count.textContent = `${picked} von ${selectable} ausgewählt`;
  const all = el<HTMLButtonElement>('#setup-addons-all');
  const none = el<HTMLButtonElement>('#setup-addons-none');
  all?.classList.toggle('active', selectable > 0 && picked === selectable);
  none?.classList.toggle('active', picked === 0);
  renderFoot(current);
}

// ---------- Schritt 4: Fertig ----------

function doneStep(current: Run): Node[] {
  const account = activeAccount();
  const install = current.install;
  const total = install.ids.length;
  const finished = [...install.states.values()].filter((s) => s.state === 'done' || s.state === 'error').length;
  const busy = install.started && !install.finished;
  const failed = [...install.states.values()].some((s) => s.state === 'error');
  const row = (icon: string, tone: string, title: string, sub: string, id: string) => h('div', { class: `setup-summary-row ${tone}`, id },
    h('span', { class: 'setup-summary-icon', 'aria-hidden': 'true' }, uiIcon(icon)),
    h('span', { class: 'setup-summary-text' }, h('strong', { text: title }), h('span', { text: sub })));
  const addonsRow = (() => {
    const data = current.addons;
    if (total > 0) {
      const names = install.ids.map((id) => data?.addons.find((a) => a.id === id)?.name ?? id);
      return row('addons', busy ? 'accent' : failed ? 'warn' : 'ok', total === 1 ? '1 Addon' : `${total} Addons`, names.join(', '), 'setup-summary-addons');
    }
    if (!data || data.status !== 'ok') return row('addons', 'muted', 'Addons später', 'Im Addon-Store, sobald er erreichbar ist', 'setup-summary-addons');
    return row('addons', 'muted', 'Keine Addons ausgewählt', 'Später im Addon-Store – mit einem Klick', 'setup-summary-addons');
  })();
  const inviter = current.invite?.view?.inviter?.name;
  const summary = h('div', { class: 'setup-summary', id: 'setup-summary' },
    account
      ? row('user', 'ok', `Angemeldet als ${account.name}`, account.type === 'microsoft' ? 'Microsoft-Konto' : 'Offline-Konto (Entwicklung)', 'setup-summary-account')
      : row('user', 'muted', 'Noch nicht angemeldet', 'Auf der Startseite oben auf „bitte anmelden“', 'setup-summary-account'),
    addonsRow,
    current.invite ? row('user-plus', 'accent', inviter ? `Einladung von ${inviter}` : 'Deine Einladung', 'Kommt gleich im nächsten Fenster – dort nimmst du sie an', 'setup-summary-invite') : null);

  const nodes: Node[] = [
    h('div', { class: 'setup-hero small' },
      h('span', { class: `setup-done-icon${busy ? ' busy' : failed ? ' warn' : ''}`, 'aria-hidden': 'true' }, busy ? h('span', { class: 'friends-spinner' }) : uiIcon(failed ? 'warning' : 'check')),
      h('h2', { class: 'setup-title', id: 'setup-title', tabindex: '-1', text: busy ? 'Fast fertig …' : 'Alles bereit!' }),
      h('p', { class: 'setup-sub', text: busy ? 'Deine Addons werden installiert – das dauert nur einen Moment.' : failed ? 'Fast alles hat geklappt. Was fehlt, installierst du später im Addon-Store.' : 'HeldixClient ist eingerichtet. Viel Spaß beim Spielen!' })),
    summary,
  ];
  if (total > 0) {
    const percent = total ? Math.round((finished / total) * 100) : 100;
    const bar = h('div', { class: 'setup-progress', id: 'setup-progress', role: 'progressbar', 'aria-label': 'Installation der Addons', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(finished) },
      h('span', { class: 'setup-progress-fill' }));
    (bar.firstChild as HTMLElement).style.width = `${percent}%`;
    const list = h('div', { class: 'setup-install', id: 'setup-install' },
      h('div', { class: 'setup-install-head' }, h('span', { text: busy ? `Installiert ${finished} von ${total} …` : `${finished} von ${total} erledigt` }), bar),
      ...install.ids.map((id) => installRow(current, id)));
    nodes.push(list);
  }
  return nodes;
}

function installRow(current: Run, id: string): HTMLElement {
  const addon = current.addons?.addons.find((a) => a.id === id);
  const status = current.install.states.get(id) ?? { state: 'wait' as InstallState, text: 'Wartet' };
  const icon = status.state === 'busy' ? h('span', { class: 'friends-spinner small' })
    : uiIcon(status.state === 'done' ? 'check' : status.state === 'error' ? 'warning' : 'clock', 'setup-install-state-icon');
  return h('div', { class: 'setup-install-row', 'data-id': id, 'data-state': status.state },
    addonIcon(addon?.icon ?? 'addons', 'small'),
    h('span', { class: 'setup-install-name', text: addon?.name ?? id }),
    h('span', { class: 'setup-install-status', text: status.text }),
    h('span', { class: 'setup-install-state', 'aria-hidden': 'true' }, icon));
}

function installText(result: SetupInstallResult): { state: InstallState; text: string } {
  if (result.installed.length === 0 && result.already.length === 0) return { state: 'error', text: result.error ?? 'Nicht installiert' };
  if (result.error) return { state: 'error', text: result.error };
  if (result.installed.length === 0) return { state: 'done', text: 'War schon installiert' };
  return { state: 'done', text: 'Installiert' };
}

async function startInstall(current: Run): Promise<void> {
  const install = current.install;
  if (install.started) return;
  const ids = chosen(current).map((a) => a.id);
  install.started = ids.length > 0;
  install.ids = ids;
  install.finished = ids.length === 0;
  if (ids.length === 0) return;
  for (const id of ids) install.states.set(id, { state: 'wait', text: 'Wartet' });
  render();
  let ok = 0;
  for (const id of ids) {
    install.states.set(id, { state: 'busy', text: 'Wird geladen und geprüft …' });
    if (run === current) render();
    try {
      const status = installText(await api.installSetupAddon(id));
      install.states.set(id, status);
      if (status.state === 'done') ok++;
    } catch (error) {
      install.states.set(id, { state: 'error', text: errorMessage(error) });
    }
    if (run === current) render();
  }
  install.finished = true;
  await hooks?.reloadInstances().catch(() => undefined);
  if (run === current) {
    render();
    el<HTMLButtonElement>('#setup-next')?.focus();
    announce(ok === ids.length ? 'Alle Addons sind installiert.' : `${ok} von ${ids.length} Addons installiert.`);
  } else if (ok > 0) {
    toast(ok === 1 ? '1 Addon aus der Einrichtung installiert.' : `${ok} Addons aus der Einrichtung installiert.`, 'success');
  }
  if (ok < ids.length && run !== current) toast('Nicht alle Addons ließen sich installieren – versuch es im Addon-Store noch einmal.', 'error');
}
