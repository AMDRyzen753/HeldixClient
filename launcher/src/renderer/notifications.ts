// Glocke in der Titelleiste: Verlauf der Benachrichtigungen (main/core/notifications.ts) – Freundschaftsanfragen,
// Nachrichten, angenommene und bestätigte Einladungen, Freischaltungen, geöffnete Welten von Freunden, Einladungen in
// Welten und Partys, „Folgen“ (der Party-Leiter ist woanders), Updates. Zähler der ungelesenen, „Alle gelesen“, Klick
// führt zur passenden Stelle. Der Verlauf liegt nur lokal.
import type { LauncherNotification, NotificationKind, NotificationList, NotificationTarget } from '../shared/api';
import { $, api, errorMessage, formatDate, h, toast, uiIcon } from './core.js';
import { UI_ICONS } from './ui-icons.js';

const KIND_ICONS: Record<NotificationKind, string> = {
  'friend-request': 'user-plus',
  message: 'chat',
  'invite-accepted': 'friends',
  'invite-confirmed': 'check',
  unlock: 'sparkles',
  'world-open': 'world',
  'world-invite': 'world',
  'party-invite': 'friends',
  'party-follow': 'connect',
  update: 'download',
  addons: 'addons',
  'hosting-granted': 'server',
  'hosting-problem': 'warning',
  'hosting-knock': 'user-plus',
};

export interface NotificationLinks {
  /** dorthin springen, wohin der Eintrag gehört */
  open(target: NotificationTarget): void;
}

let links: NotificationLinks | null = null;
let list: NotificationList = { items: [], unread: 0 };

function setBellIcon(svg: SVGSVGElement): void {
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Glocke aus dem Heldix-Icon-Set (scripts/render-ui-assets.mjs)
  svg.innerHTML = UI_ICONS.bell;
}

/** „gerade eben“, „vor 5 Min.“, „gestern“ … */
function ago(time: number): string {
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

function panel(): HTMLElement {
  return $('#bell-panel');
}

function isOpen(): boolean {
  return !panel().hidden;
}

export function closeBell(): void {
  panel().hidden = true;
  $('#bell-button').setAttribute('aria-expanded', 'false');
  $('#bell-button').classList.remove('open');
}

export function openBell(): void {
  panel().hidden = false;
  $('#bell-button').setAttribute('aria-expanded', 'true');
  $('#bell-button').classList.add('open');
  renderPanel();
}

function renderBadge(): void {
  const badge = $('#bell-badge');
  badge.hidden = list.unread === 0;
  badge.textContent = list.unread > 99 ? '99+' : String(list.unread);
  $('#bell-button').title = list.unread ? `Benachrichtigungen (${list.unread} ungelesen)` : 'Benachrichtigungen';
}

async function activate(entry: LauncherNotification): Promise<void> {
  closeBell();
  if (!entry.read) {
    list = await api.markNotificationRead(entry.id).catch(() => list);
    renderBadge();
  }
  if (entry.target) links?.open(entry.target);
}

function item(entry: LauncherNotification): HTMLElement {
  return h('button', {
    class: `bell-item${entry.read ? '' : ' unread'}`,
    type: 'button',
    'data-id': entry.id,
    title: entry.target ? 'Öffnen' : '',
    onclick: () => void activate(entry),
  },
  h('span', { class: `bell-item-icon kind-${entry.kind}` }, uiIcon(KIND_ICONS[entry.kind] ?? 'info')),
  h('span', { class: 'bell-item-text' },
    h('span', { class: 'bell-item-title' },
      h('span', { text: entry.title }),
      entry.count > 1 ? h('span', { class: 'bell-item-count', text: `×${entry.count}` }) : null),
    entry.body ? h('span', { class: 'bell-item-body', text: entry.body }) : null,
    h('span', { class: 'bell-item-time', text: ago(entry.at), title: new Date(entry.at).toLocaleString('de-DE') })),
  entry.read ? null : h('span', { class: 'bell-item-dot', 'aria-label': 'ungelesen' }));
}

function renderPanel(): void {
  if (!isOpen()) return;
  const host = panel();
  const head = h('div', { class: 'bell-head' },
    h('div', { class: 'bell-title' }, h('strong', { text: 'Benachrichtigungen' }),
      h('span', { text: list.unread ? (list.unread === 1 ? '1 ungelesen' : `${list.unread} ungelesen`) : 'Alles gelesen' })),
    h('button', {
      class: 'ghost small', type: 'button', id: 'bell-read-all', disabled: list.unread === 0,
      onclick: () => void api.markAllNotificationsRead().then((next) => {
        list = next;
        renderBadge();
        renderPanel();
      }).catch((error) => toast(errorMessage(error), 'error')),
    }, uiIcon('check', 'btn-icon'), 'Alle gelesen'));
  const body = h('div', { class: 'bell-list', id: 'bell-list' });
  if (list.items.length === 0) {
    body.append(h('div', { class: 'bell-empty' },
      h('span', { class: 'bell-empty-icon' }, (() => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        setBellIcon(svg);
        return svg;
      })()),
      h('strong', { text: 'Alles ruhig hier' }),
      h('span', { text: 'Freundschaftsanfragen, Nachrichten, Party-Einladungen, geöffnete Welten deiner Freunde und Updates erscheinen hier.' })));
  } else {
    for (const entry of list.items) body.append(item(entry));
  }
  const foot = list.items.length
    ? h('div', { class: 'bell-foot' },
      h('span', { text: 'Gespeichert nur auf diesem PC, höchstens 30 Tage.' }),
      h('button', {
        class: 'link-button', type: 'button', id: 'bell-clear',
        onclick: () => void api.clearNotifications().then((next) => {
          list = next;
          renderBadge();
          renderPanel();
        }).catch((error) => toast(errorMessage(error), 'error')),
      }, 'Verlauf leeren'))
    : null;
  host.replaceChildren(head, body, ...(foot ? [foot] : []));
}

function apply(next: NotificationList): void {
  list = next;
  renderBadge();
  renderPanel();
}

/** einmal beim Start */
export function initNotifications(options: NotificationLinks): void {
  links = options;
  const button = $<HTMLButtonElement>('#bell-button');
  const icon = button.querySelector<SVGSVGElement>('.bell-icon');
  if (icon) setBellIcon(icon);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isOpen()) closeBell();
    else openBell();
  });
  panel().addEventListener('click', (event) => event.stopPropagation());
  document.addEventListener('click', () => {
    if (isOpen()) closeBell();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) closeBell();
  });
  api.onNotifications(apply);
  // Klick im Infobereich: Glocke öffnen bzw. gleich zum Eintrag
  api.onNotificationOpen((id) => {
    const entry = id ? list.items.find((n) => n.id === id) : null;
    if (entry) void activate(entry);
    else {
      void api.listNotifications().then(apply).catch(() => undefined);
      openBell();
    }
  });
  void api.listNotifications().then(apply).catch(() => undefined);
}
