// Geteilte Welten beitreten (Welt teilen, main/core/worlds.ts): Dialog #world-dialog „Welt von <Name>“ mit der
// öffentlichen Welt-Info (online, Spieler, Minecraft-Version, Zugang, Adresse) und „Beitreten“ (#world-join) – startet
// die passende Instanz mit Quick Play auf <code>.welt.<Domain>. Geöffnet von Links heldixclient://welt/<code>
// (Main-Prozess merkt sich den Link bis takeWorldLink, wie bei Einladungen), aus „Offene Welten deiner Freunde“,
// der Glocke und Benachrichtigungen. Ohne Klick passiert nichts.
import type { WorldJoinView } from '../shared/api';
import { api, errorMessage, h, reloadInstances, toast, uiIcon } from './core.js';
import { playerHead } from './friends.js';

export interface WorldLinks {
  showView(view: string): void;
}

let links: WorldLinks | null = null;

interface Dialog {
  code: string;
  backdrop: HTMLElement;
  modal: HTMLElement;
  view: WorldJoinView | null;
  busy: boolean;
}
let dialog: Dialog | null = null;

function close(): void {
  dialog?.backdrop.remove();
  dialog = null;
}

function button(id: string, label: string, kind: 'primary' | 'ghost', onclick: () => void, icon?: string, disabled = false): HTMLButtonElement {
  return h('button', { id, class: kind, type: 'button', disabled, onclick }, icon ? uiIcon(icon, 'btn-icon') : null, h('span', { text: label }));
}

function fact(icon: string, label: string, value: Node | string, extra: Record<string, string> = {}): HTMLElement {
  return h('div', { class: 'invite-fact' },
    h('span', { class: 'invite-fact-icon' }, uiIcon(icon)),
    h('span', { class: 'invite-fact-label', text: label }),
    typeof value === 'string' ? h('span', { class: 'invite-fact-value', text: value, ...extra }) : h('span', { class: 'invite-fact-value', ...extra }, value));
}

function frame(content: { head: Node; body: Node[]; actions: Node[] }): void {
  if (!dialog) return;
  dialog.modal.replaceChildren(
    h('div', { class: 'modal-head' }, content.head,
      h('button', { class: 'icon-button', type: 'button', title: 'Schließen', 'aria-label': 'Schließen', onclick: close }, uiIcon('close'))),
    h('div', { class: 'invite-body' }, ...content.body),
    h('div', { class: 'modal-actions' }, ...content.actions));
}

function simpleHead(title: string, sub: string, icon = 'world', tone = ''): HTMLElement {
  return h('div', { class: 'invite-head' },
    h('div', { class: `friends-state-icon invite-head-icon${tone ? ` ${tone}` : ''}` }, uiIcon(icon)),
    h('div', {}, h('h3', { class: 'modal-title', id: 'world-title', text: title }), h('p', { class: 'modal-sub', text: sub })));
}

async function copyAddress(address: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(address);
    toast('Adresse kopiert – in Minecraft unter Mehrspieler → Server hinzufügen einfügen.', 'success');
  } catch {
    toast('Kopieren ging nicht.', 'error');
  }
}

// ---------- Ansichten ----------

function renderLoading(): void {
  if (!dialog) return;
  dialog.modal.dataset.state = 'loading';
  frame({
    head: simpleHead('Geteilte Welt', 'Wird geladen …'),
    body: [h('div', { class: 'invite-loading' }, h('div', { class: 'friends-spinner', 'aria-hidden': 'true' }), h('span', { text: 'Welt wird geladen …' }))],
    actions: [button('world-cancel', 'Schließen', 'ghost', close)],
  });
}

function renderView(view: WorldJoinView): void {
  if (!dialog) return;
  dialog.view = view;
  dialog.modal.dataset.state = view.status;
  if (view.status === 'missing') {
    frame({
      head: simpleHead('Welt nicht gefunden', 'Der Link funktioniert nicht.', 'warning', 'error'),
      body: [h('p', { class: 'modal-text', id: 'world-missing', text: 'Diese Welt gibt es nicht (mehr) – vielleicht wurde sie gelöscht. Frag nach einem neuen Link.' })],
      actions: [button('world-cancel', 'Schließen', 'primary', close)],
    });
    return;
  }
  if (view.status === 'error' || !view.world) {
    frame({
      head: simpleHead('Welt lässt sich nicht laden', 'Heldix-Dienst', 'warning', 'error'),
      body: [h('p', { class: 'modal-text', id: 'world-error', text: view.error ?? 'Unbekannter Fehler beim Heldix-Dienst.' })],
      actions: [
        button('world-cancel', 'Schließen', 'ghost', close),
        button('world-retry', 'Erneut versuchen', 'primary', () => void load(view.code), 'refresh'),
      ],
    });
    return;
  }
  const world = view.world;
  const busy = dialog.busy;
  const head = h('div', { class: 'invite-head' },
    playerHead(world.host.uuid, world.host.name, 'md'),
    h('div', {},
      h('h3', { class: 'modal-title', id: 'world-title', text: `Welt von ${world.host.name}` }),
      h('p', { class: 'modal-sub', text: `„${world.name}“` })));

  const status = h('span', { class: `world-online${world.online ? ' on' : ''}` },
    h('span', { class: 'world-online-dot' }),
    world.online ? `Geöffnet · ${world.players} von ${world.maxPlayers} Spielern` : 'Gerade nicht geöffnet');
  const facts = h('div', { class: 'invite-facts' },
    fact('signal', 'Status', status, { id: 'world-status' }),
    fact('cube', 'Minecraft', world.version ? `Version ${world.version}` : 'Version unbekannt', { id: 'world-version' }),
    fact('lock', 'Zugang', world.access === 'open' ? 'Offen für alle mit der Adresse' : 'Nur Eingeladene und Freunde'));
  if (world.address) {
    facts.append(fact('server', 'Adresse', h('span', { class: 'world-address' },
      h('code', { text: world.address, id: 'world-address' }),
      h('button', { class: 'icon-button small', type: 'button', title: 'Adresse kopieren (für Minecraft ohne HeldixClient)', onclick: () => void copyAddress(world.address!) }, uiIcon('copy')))));
  }
  const body: Node[] = [facts];
  if (world.access === 'closed' && !view.friend && world.online) {
    body.push(h('p', { class: 'invite-note info', id: 'world-knock' }, uiIcon('info', 'invite-note-icon'),
      h('span', { text: `Nur für Eingeladene und Freunde. Wenn du beitrittst, wird ${world.host.name} gefragt – nach dem Erlauben einfach noch einmal beitreten.` })));
  }
  if (view.joinProblem) {
    body.push(h('div', { class: 'invite-problem', id: 'world-join-problem' },
      uiIcon('info', 'invite-note-icon'),
      h('span', { text: view.joinProblem }),
      !view.join && world.online ? button('world-instances', 'Zu den Instanzen', 'ghost', () => {
        close();
        links?.showView('instances');
      }, 'grid') : null));
  } else if (view.join) {
    body.push(h('p', { class: 'invite-join-target', id: 'world-join-target' },
      uiIcon('connect', 'invite-note-icon'),
      h('span', {}, '„Beitreten“ startet ', h('strong', { text: view.join.instanceName }), ` (Minecraft ${view.join.minecraft}) und verbindet direkt mit der Welt.`)));
  }

  const actions: Node[] = [button('world-cancel', 'Später', 'ghost', close)];
  if (world.address) actions.push(button('world-copy', 'Adresse kopieren', 'ghost', () => void copyAddress(world.address!), 'copy'));
  actions.push(button('world-join', busy ? 'Startet …' : 'Beitreten', 'primary', () => void join(), 'connect', busy || !!view.joinProblem || !view.join));
  frame({ head, body, actions });
}

// ---------- Ablauf ----------

async function load(code: string): Promise<void> {
  if (!dialog || dialog.code !== code) return;
  dialog.busy = false;
  renderLoading();
  let view: WorldJoinView;
  try {
    view = await api.getWorldJoin(code);
  } catch (error) {
    view = { code, status: 'error', error: errorMessage(error), world: null, join: null, joinProblem: null, friend: false };
  }
  if (dialog?.code === code) renderView(view);
}

async function join(): Promise<void> {
  const current = dialog;
  if (!current?.view?.world || current.busy) return;
  current.busy = true;
  renderView(current.view);
  try {
    const result = await joinWorldNow(current.code, current.view.world.host.name);
    if (result && dialog === current) close();
  } finally {
    if (dialog === current) {
      current.busy = false;
      void load(current.code);
    }
  }
}

/**
 * Sofort beitreten (Startseite, Freunde): Instanz starten und verbinden. Fehler (keine passende Instanz, Welt zu,
 * Spiel läuft) kommen als Hinweis. true = gestartet.
 */
export async function joinWorldNow(code: string, hostName?: string): Promise<boolean> {
  try {
    const result = await api.joinWorld(code);
    toast(`Minecraft startet mit „${result.instanceName}“ und verbindet mit der Welt${hostName ? ` von ${hostName}` : ''}.`, 'success');
    await reloadInstances().catch(() => undefined);
    links?.showView('home');
    return true;
  } catch (error) {
    toast(errorMessage(error), 'error');
    return false;
  }
}

/** Dialog zu einer Welt öffnen (ersetzt einen offenen) */
export function openWorldDialog(code: string): void {
  close();
  const modal = h('div', { class: 'modal invite-modal world-modal', id: 'world-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'world-title' });
  const backdrop = h('div', { class: 'modal-backdrop invite-backdrop', onclick: (event: Event) => event.target === backdrop && !dialog?.busy && close() }, modal);
  document.body.append(backdrop);
  dialog = { code, backdrop, modal, view: null, busy: false };
  void load(code);
}

async function takeLink(): Promise<void> {
  const code = await api.takeWorldLink().catch(() => null);
  if (code) openWorldDialog(code);
}

/** Nach dem Einrichtungs-Assistenten: einen zurückgehaltenen Welt-Link abholen */
export function openPendingWorld(): Promise<void> {
  return takeLink();
}

/** einmal beim Start: geöffnete Links abholen */
export function initWorlds(options: WorldLinks): void {
  links = options;
  api.onWorldOpen(() => void takeLink());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.setTimeout(() => {
      if (dialog && !dialog.backdrop.isConnected) dialog = null;
    }, 0);
  });
  void takeLink();
}
