// Einladungslinks (heldixclient://einladung/<code>, siehe main/core/invites.ts): Dialog #invite-dialog „<Name> lädt
// dich ein“ mit „Annehmen“ (#invite-accept) und – bei Einladungen mit Server – „Annehmen und beitreten“
// (#invite-accept-join), danach das Ergebnis (Freundschaft, Belohnung, Spielstart). Dazu Hinweise zu Neuem bei den
// eigenen Einladungen, solange der Launcher im Vordergrund ist (sonst kommt eine Benachrichtigung vom Main-Prozess).
//
// Der Main-Prozess merkt sich einen geöffneten Link, bis die Oberfläche ihn mit takeInviteLink() abholt: beim Laden
// und auf invite:open. Ohne Klick passiert nichts – der Link öffnet nur diesen Dialog.
import type { InviteAcceptView, InviteEvent, InviteNote, PublicInviteView } from '../shared/api';
import { api, errorMessage, h, reloadInstances, toast, uiIcon } from './core.js';
import { playerHead } from './friends.js';

export interface InviteLinks {
  showView(view: string): void;
  /** Freunde → Einladen */
  openInvites(): void;
  /** Skins & Cosmetics mit diesem Cosmetic */
  openCosmetic(id: string): void;
  /** Konten neu laden (nach der Anmeldung im Dialog) */
  reloadAccounts(): Promise<void>;
}

let links: InviteLinks | null = null;

interface Dialog {
  code: string;
  backdrop: HTMLElement;
  modal: HTMLElement;
  view: PublicInviteView | null;
  busy: 'accept' | 'join' | 'signin' | null;
}
let dialog: Dialog | null = null;

const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit' });

function close(): void {
  dialog?.backdrop.remove();
  dialog = null;
}

function spinner(): HTMLElement {
  return h('div', { class: 'friends-spinner', 'aria-hidden': 'true' });
}

function button(id: string, label: string, kind: 'primary' | 'ghost', onclick: () => void, icon?: string, disabled = false): HTMLButtonElement {
  return h('button', { id, class: kind, type: 'button', disabled, onclick }, icon ? uiIcon(icon, 'btn-icon') : null, h('span', { text: label }));
}

/** Zeile mit Symbol, Beschriftung und Wert (Server, Voice, Belohnung, Ablauf) */
function fact(icon: string, label: string, value: string, extra: Record<string, string> = {}): HTMLElement {
  return h('div', { class: 'invite-fact' },
    h('span', { class: 'invite-fact-icon' }, uiIcon(icon)),
    h('span', { class: 'invite-fact-label', text: label }),
    h('span', { class: 'invite-fact-value', text: value, ...extra }));
}

function note(n: InviteNote): HTMLElement {
  const icon = n.tone === 'success' ? 'check' : n.tone === 'warn' ? 'warning' : 'info';
  return h('p', { class: `invite-note ${n.tone}` }, uiIcon(icon, 'invite-note-icon'), h('span', { text: n.text }));
}

function frame(content: { head: Node; body: Node[]; actions: Node[] }): void {
  if (!dialog) return;
  dialog.modal.replaceChildren(
    h('div', { class: 'modal-head' }, content.head,
      h('button', { class: 'icon-button', type: 'button', title: 'Schließen', 'aria-label': 'Schließen', onclick: close }, uiIcon('close'))),
    h('div', { class: 'invite-body' }, ...content.body),
    h('div', { class: 'modal-actions' }, ...content.actions));
}

function simpleHead(title: string, sub: string, icon = 'user-plus', tone = ''): HTMLElement {
  return h('div', { class: 'invite-head' },
    h('div', { class: `friends-state-icon invite-head-icon${tone ? ` ${tone}` : ''}` }, uiIcon(icon)),
    h('div', {}, h('h3', { class: 'modal-title', id: 'invite-title', text: title }), h('p', { class: 'modal-sub', text: sub })));
}

// ---------- Ansichten ----------

function renderLoading(): void {
  if (!dialog) return;
  dialog.modal.dataset.state = 'loading';
  frame({
    head: simpleHead('Einladung', 'Wird geladen …'),
    body: [h('div', { class: 'invite-loading' }, spinner(), h('span', { text: 'Einladung wird geladen …' }))],
    actions: [button('invite-cancel', 'Schließen', 'ghost', close)],
  });
}

function renderView(view: PublicInviteView): void {
  if (!dialog) return;
  dialog.view = view;
  dialog.modal.dataset.state = view.status;
  if (view.status === 'missing') {
    frame({
      head: simpleHead('Einladung nicht gefunden', 'Der Link funktioniert nicht mehr.', 'warning', 'error'),
      body: [h('p', { class: 'modal-text', id: 'invite-missing', text: 'Diese Einladung gibt es nicht (mehr). Vielleicht ist sie abgelaufen oder wurde zurückgenommen – bitte deinen Freund um einen neuen Link.' })],
      actions: [button('invite-cancel', 'Schließen', 'primary', close)],
    });
    return;
  }
  if (view.status === 'error' || !view.inviter) {
    frame({
      head: simpleHead('Einladung lässt sich nicht laden', 'Heldix-Dienst', 'warning', 'error'),
      body: [h('p', { class: 'modal-text', id: 'invite-error', text: view.error ?? 'Unbekannter Fehler beim Heldix-Dienst.' })],
      actions: [
        button('invite-cancel', 'Schließen', 'ghost', close),
        button('invite-retry', 'Erneut versuchen', 'primary', () => void load(view.code), 'refresh'),
      ],
    });
    return;
  }

  const busy = dialog.busy;
  const inviter = view.inviter;
  const head = h('div', { class: 'invite-head' },
    playerHead(inviter.uuid, inviter.name, 'md'),
    h('div', {},
      h('h3', { class: 'modal-title', id: 'invite-title', text: `${inviter.name} lädt dich ein` }),
      h('p', { class: 'modal-sub', text: view.server ? 'Komm auf meinen Server!' : 'Spiel mit HeldixClient – ihr seid dann gleich befreundet.' })));

  const body: Node[] = [];
  const facts = h('div', { class: 'invite-facts' });
  if (view.server) facts.append(fact('server', 'Server', view.server, { id: 'invite-server' }));
  if (view.voice) {
    const people = view.voice.members + view.voice.guests;
    facts.append(fact('mic', 'Voice-Gruppe', people === 1 ? '1 Person im Gespräch' : `${people} Personen im Gespräch`));
  }
  if (view.welcome) facts.append(fact('sparkles', 'Willkommens-Belohnung', `${view.welcome.name} – für neue Spieler`, { id: 'invite-welcome' }));
  if (view.expires) facts.append(fact('clock', 'Gültig bis', dateFormat.format(view.expires)));
  if (facts.childElementCount) body.push(facts);

  if (view.acceptProblem) {
    const needsAccount = !view.account || view.account.type === 'offline';
    body.push(h('div', { class: 'invite-problem', id: 'invite-accept-problem' },
      uiIcon('lock', 'invite-note-icon'),
      h('span', { text: view.acceptProblem }),
      needsAccount
        ? button('invite-signin', busy === 'signin' ? 'Anmelden …' : 'Mit Microsoft anmelden', 'primary', () => void signIn(), 'microsoft', !!busy)
        : null));
  } else if (view.account) {
    body.push(h('p', { class: 'hint invite-account', text: `Du nimmst die Einladung als ${view.account.name} an.` }));
  }

  if (view.server) {
    if (view.joinProblem) {
      body.push(h('div', { class: 'invite-problem', id: 'invite-join-problem' },
        uiIcon('info', 'invite-note-icon'),
        h('span', { text: view.joinProblem }),
        !view.join ? button('invite-instances', 'Zu den Instanzen', 'ghost', () => {
          close();
          links?.showView('instances');
        }, 'grid') : null));
    } else if (view.join) {
      body.push(h('p', { class: 'invite-join-target', id: 'invite-join-target' },
        uiIcon('connect', 'invite-note-icon'),
        h('span', {}, '„Annehmen und beitreten“ startet ', h('strong', { text: view.join.instanceName }), ' und verbindet direkt mit ', h('strong', { text: view.server }), '.')));
    }
  }

  const blocked = !!view.acceptProblem || !!busy;
  const actions: Node[] = [button('invite-cancel', 'Später', 'ghost', close)];
  actions.push(button('invite-accept', busy === 'accept' ? 'Nimmt an …' : 'Annehmen', view.server ? 'ghost' : 'primary', () => void accept(false), 'check', blocked));
  if (view.server) {
    actions.push(button('invite-accept-join', busy === 'join' ? 'Nimmt an …' : 'Annehmen und beitreten', 'primary', () => void accept(true), 'connect', blocked || !!view.joinProblem || !view.join));
  }
  frame({ head, body, actions });
}

function renderResult(result: InviteAcceptView): void {
  if (!dialog) return;
  dialog.modal.dataset.state = 'done';
  const notes = [...result.notes];
  if (result.joined) notes.push({ tone: 'success', text: `Minecraft startet mit „${result.joined.instanceName}“ und verbindet mit ${result.joined.server}.` });
  if (result.joinError) notes.push({ tone: 'warn', text: result.joinError });
  const friends = result.friend === 'new' || result.friend === 'already';
  frame({
    head: simpleHead(result.friend === 'self' ? 'Deine eigene Einladung' : 'Einladung angenommen', `von ${result.inviter.name}`, result.friend === 'new' ? 'user-plus' : 'check'),
    body: [h('div', { class: 'invite-notes', id: 'invite-result' }, ...notes.map(note))],
    actions: [
      result.reward ? button('invite-to-cosmetics', 'Zu den Cosmetics', 'ghost', () => {
        const id = result.reward!.id;
        close();
        links?.openCosmetic(id);
      }, 'sparkles') : null,
      friends && !result.joined ? button('invite-to-friends', 'Zu den Freunden', 'ghost', () => {
        close();
        links?.showView('friends');
      }, 'friends') : null,
      button('invite-done', 'Fertig', 'primary', close),
    ].filter((b): b is HTMLButtonElement => b !== null),
  });
}

// ---------- Ablauf ----------

async function load(code: string): Promise<void> {
  if (!dialog || dialog.code !== code) return;
  dialog.busy = null;
  renderLoading();
  let view: PublicInviteView;
  try {
    view = await api.getPublicInvite(code);
  } catch (error) {
    view = { code, status: 'error', error: errorMessage(error), inviter: null, server: null, voice: null, expires: 0, welcome: null, account: null, acceptProblem: null, join: null, joinProblem: null };
  }
  if (dialog?.code === code) renderView(view);
}

async function accept(join: boolean): Promise<void> {
  const current = dialog;
  if (!current?.view || current.busy) return;
  current.busy = join ? 'join' : 'accept';
  renderView(current.view);
  try {
    const result = await api.acceptInvite(current.code, join);
    if (dialog !== current) {
      toast(result.notes[0]?.text ?? 'Einladung angenommen.', 'success');
      return;
    }
    current.busy = null;
    renderResult(result);
    if (result.joined) {
      // Fortschritt des Spielstarts auf der Startseite (hinter dem Dialog)
      await reloadInstances().catch(() => undefined);
      links?.showView('home');
    }
  } catch (error) {
    toast(errorMessage(error), 'error');
    if (dialog !== current) return;
    current.busy = null;
    // Stand neu laden: z. B. inzwischen abgelaufen oder Spiel gestartet
    void load(current.code);
  }
}

async function signIn(): Promise<void> {
  const current = dialog;
  if (!current?.view || current.busy) return;
  current.busy = 'signin';
  renderView(current.view);
  try {
    const account = await api.addMicrosoftAccount();
    toast(`Angemeldet als ${account.name}`, 'success');
    await links?.reloadAccounts().catch(() => undefined);
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
  if (dialog !== current) return;
  current.busy = null;
  void load(current.code);
}

/** Dialog zu einer Einladung öffnen (ersetzt einen offenen) */
export function openInviteDialog(code: string): void {
  close();
  const modal = h('div', { class: 'modal invite-modal', id: 'invite-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'invite-title' });
  const backdrop = h('div', { class: 'modal-backdrop invite-backdrop', onclick: (event: Event) => event.target === backdrop && !dialog?.busy && close() }, modal);
  document.body.append(backdrop);
  dialog = { code, backdrop, modal, view: null, busy: null };
  void load(code);
}

async function takeLink(): Promise<void> {
  const code = await api.takeInviteLink().catch(() => null);
  if (code) openInviteDialog(code);
}

/**
 * Nach dem Einrichtungs-Assistenten (renderer/setup.ts): solange er offen war, hat der Main-Prozess den Link
 * zurückgehalten – jetzt abholen und den Dialog öffnen.
 */
export function openPendingInvite(): Promise<void> {
  return takeLink();
}

// ---------- Neues bei den eigenen Einladungen ----------

function showEvent(event: InviteEvent): void {
  if (event.kind === 'unlock') toast(`Neues Cosmetic freigeschaltet: ${event.name}`, 'success');
  else if (event.kind === 'accepted') {
    toast(event.name ? `${event.name} hat deine Einladung angenommen – ihr seid jetzt Freunde.` : event.count > 1 ? `${event.count} Freunde haben deine Einladung angenommen.` : 'Deine Einladung wurde angenommen.', 'success');
  } else toast(event.count > 1 ? `${event.count} Einladungen bestätigt – deine Freunde haben 30 Minuten gespielt.` : 'Einladung bestätigt – dein Freund hat 30 Minuten gespielt.', 'success');
}

/** einmal beim Start: geöffnete Links abholen, Hinweise und Klicks auf Benachrichtigungen */
export function initInvites(options: InviteLinks): void {
  links = options;
  api.onInviteOpen(() => void takeLink());
  api.onInviteEvent(showEvent);
  api.onInvitesOpen(() => options.openInvites());
  api.onCosmeticOpen((id) => options.openCosmetic(id));
  // Escape entfernt Dialoge (app.ts): danach den Zustand aufräumen
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') window.setTimeout(() => {
      if (dialog && !dialog.backdrop.isConnected) dialog = null;
    }, 0);
  });
  void takeLink();
}
