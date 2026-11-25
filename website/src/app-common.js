// HeldixClient – Webseite: gemeinsame Bausteine für Konto (/konto) und Team-Bereich (/team).
//
// - Anfragen an den Heldix-Dienst unter /api/... (gleiche Herkunft, Cookie-Sitzung, CSRF-Header)
// - DOM ohne innerHTML: Texte vom Server landen immer nur als Text im Dokument
// - Dialoge, Hinweise (Toasts), Reiter, regelmäßiges Nachfragen, Formate
//
// Kein Framework, kein Build-Schritt (ES-Module, die der Browser direkt lädt). Die CSP der Webseite erlaubt
// keine Inline-Skripte und keine style-Attribute; Stile kommen nur aus styles.css (oder element.style aus JS).

const API = '/api';

// ---------------------------------------------------------------------------------------------------------
// Anfragen
// ---------------------------------------------------------------------------------------------------------

export class ApiError extends Error {
  /**
   * @param {number} status HTTP-Status (0 = keine Verbindung, -1 = abgebrochen)
   * @param {string} message deutscher Text für Menschen
   * @param {string|null} code maschinenlesbarer Code (Team-Routen: forbidden, 2fa_setup_required, 2fa_required)
   */
  constructor(status, message, code = null, retryAfter = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const FALLBACK_MESSAGES = {
  0: 'Der Heldix-Dienst ist gerade nicht erreichbar. Prüfe deine Internetverbindung und versuche es noch einmal.',
  400: 'Die Eingabe passt nicht.',
  401: 'Du bist nicht (mehr) angemeldet.',
  403: 'Dafür fehlen dir die Rechte.',
  404: 'Nicht gefunden.',
  409: 'Das geht gerade nicht.',
  413: 'Die Datei ist zu groß.',
  429: 'Zu viele Anfragen. Bitte warte kurz und versuche es dann noch einmal.',
  503: 'Der Heldix-Dienst ist gerade nicht erreichbar. Bitte versuche es später noch einmal.',
};

export function fallbackMessage(status) {
  if (status in FALLBACK_MESSAGES) return FALLBACK_MESSAGES[status];
  if (status >= 500) return 'Beim Heldix-Dienst ist ein Fehler aufgetreten. Bitte versuche es später noch einmal.';
  return 'Das hat leider nicht geklappt.';
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorFrom(status, data, retryAfter) {
  const message = data && typeof data.error === 'string' && data.error.trim() ? data.error : fallbackMessage(status);
  const code = data && typeof data.code === 'string' ? data.code : null;
  const seconds = Number.parseInt(retryAfter ?? '', 10);
  return new ApiError(status, message, code, Number.isFinite(seconds) ? seconds : null);
}

/**
 * Anfrage an den Heldix-Dienst. Pfade ohne /api, z. B. api('GET', '/v1/web/me').
 * Alles außer GET/HEAD schickt den CSRF-Header X-Heldix-Web: 1 und (außer DELETE ohne Inhalt) einen JSON-Körper.
 * Wirft ApiError mit dem deutschen Fehlertext des Dienstes.
 */
export async function api(method, path, body, { signal, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  const init = { method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' };
  if (signal) init.signal = signal;
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-Heldix-Web'] = '1';
    if (body !== undefined || method !== 'DELETE') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body ?? {});
    }
  }
  let response;
  try {
    response = await fetch(API + path, init);
  } catch (error) {
    if (error && error.name === 'AbortError') throw error;
    throw new ApiError(0, fallbackMessage(0));
  }
  if (raw && response.ok) return response;
  const data = parseJson(await response.text().catch(() => ''));
  if (!response.ok) throw errorFrom(response.status, data, response.headers.get('Retry-After'));
  return data;
}

/**
 * Datei roh hochladen (PUT, application/octet-stream) mit Fortschritt. fetch() kennt keinen Upload-Fortschritt,
 * deshalb XMLHttpRequest. Gibt { promise, abort } zurück.
 */
export function upload(path, file, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('PUT', API + path);
    xhr.setRequestHeader('X-Heldix-Web', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded, event.total);
    });
    xhr.addEventListener('load', () => {
      const data = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(errorFrom(xhr.status, data, xhr.getResponseHeader('Retry-After')));
    });
    xhr.addEventListener('error', () => reject(new ApiError(0, fallbackMessage(0))));
    xhr.addEventListener('abort', () => reject(new ApiError(-1, 'Hochladen abgebrochen.')));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

// ---------------------------------------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------------------------------------

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function appendChildren(element, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(element, child);
    else if (child instanceof Node) element.append(child);
    else element.append(document.createTextNode(String(child)));
  }
}

/**
 * Element bauen: h('button', { class: 'button', type: 'button', onClick: fn }, 'Text', icon('check')).
 * Strings werden immer zu Textknoten. `text` setzt textContent, `dataset` die data-Attribute,
 * `value` die Eigenschaft (auch für textarea). Kein style, kein innerHTML.
 */
export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') element.className = value;
      else if (key === 'text') element.textContent = String(value);
      else if (key === 'dataset') Object.assign(element.dataset, value);
      else if (key === 'value') element.value = value;
      else if (/^on[A-Z]/.test(key) && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
      else element.setAttribute(key, value === true ? '' : String(value));
    }
  }
  appendChildren(element, children);
  return element;
}

/** Icon aus dem Heldix-Icon-Set (template#icons, vom Build aus den Launcher-Icons erzeugt). */
export function icon(name) {
  const template = document.getElementById('icons');
  const source = template?.content.querySelector(`[data-icon="${name}"] svg`);
  if (!source) return document.createTextNode('');
  return source.cloneNode(true);
}

let idCounter = 0;
export const uid = (prefix = 'id') => `${prefix}-${++idCounter}`;

/**
 * Liste neu zeichnen, ohne dass der Fokus verloren geht: Elemente mit data-focus-key bekommen ihn danach zurück.
 * Gibt false zurück (und zeichnet nicht), wenn sich am Schlüssel `signature` nichts geändert hat.
 */
export function rerender(container, signature, build) {
  if (signature !== undefined && container.dataset.signature === signature) return false;
  const active = document.activeElement;
  const key = active && container.contains(active) ? active.dataset.focusKey : undefined;
  container.replaceChildren(...[build()].flat().filter(Boolean));
  if (signature !== undefined) container.dataset.signature = signature;
  if (key) {
    const again = $$('[data-focus-key]', container).find((element) => element.dataset.focusKey === key);
    if (again) again.focus();
  }
  return true;
}

/** Text mit Zeilenumbrüchen als Absätze: Leerzeilen trennen Absätze, einzelne Umbrüche werden zu <br>. */
export function textBlocks(text) {
  const fragment = document.createDocumentFragment();
  const blocks = String(text ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/);
  for (const block of blocks) {
    const lines = block.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) continue;
    const paragraph = document.createElement('p');
    lines.forEach((line, index) => {
      if (index) paragraph.append(document.createElement('br'));
      paragraph.append(document.createTextNode(line));
    });
    fragment.append(paragraph);
  }
  return fragment;
}

// ---------------------------------------------------------------------------------------------------------
// Spieler
// ---------------------------------------------------------------------------------------------------------

function hueOf(seed) {
  const hex = /^[0-9a-f]{6}/i.exec(seed || '');
  if (hex) return Number.parseInt(hex[0], 16) % 360;
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}

/** Ein oder zwei Buchstaben aus dem Spielernamen: „NebelWanderer“ → NW, „Moosbart“ → M. */
export function initials(name) {
  const parts = String(name || '?')
    .split(/_+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter((part) => /^[A-Za-z]/.test(part));
  if (!parts.length) return String(name || '?').slice(0, 1).toUpperCase();
  return parts.slice(0, 2).map((part) => part[0].toUpperCase()).join('');
}

/**
 * Farbiges Bild mit Initialen (Bilder von fremden Servern wie Minecraft-Köpfe erlaubt die CSP nicht).
 * online: true/false zeigt einen Status-Punkt, null keinen.
 */
export function avatar(name, uuid, { size = '', online = null } = {}) {
  const element = h('span', { class: `avatar${size ? ` avatar-${size}` : ''}`, 'aria-hidden': 'true' }, initials(name));
  element.style.setProperty('--hue', String(hueOf(uuid || name)));
  if (online !== null) element.append(h('span', { class: `presence${online ? ' on' : ''}` }));
  return element;
}

/** Eingebaute Heldix-Capes: dieselben IDs wie im Dienst, Namen wie im Spiel (capes.json der Mod). */
export const CAPES = [
  ['heldix', 'Heldix'],
  ['mitternacht', 'Mitternacht'],
  ['aurora', 'Aurora'],
  ['glut', 'Glut'],
  ['kristall', 'Kristall'],
  ['neon', 'Neon'],
  ['sakura', 'Sakura'],
  ['gewitter', 'Gewitter'],
  ['galaxie', 'Galaxie'],
];
export const capeName = (id) => (id ? (CAPES.find(([capeId]) => capeId === id)?.[1] ?? id) : 'Kein Cape');

export const ROLE_LABELS ={ moderator: 'Moderator', admin: 'Admin' };
export const REPORT_REASONS = [
  ['spam', 'Spam'],
  ['harassment', 'Belästigung'],
  ['inappropriate', 'Unangemessen'],
  ['other', 'Sonstiges'],
];
export const reasonLabel = (reason) => REPORT_REASONS.find(([id]) => id === reason)?.[1] ?? String(reason);

/** Was ein Freund gerade macht – dieselben Texte wie im Spiel (Social.Friend#activity). */
export function activity(friend) {
  if (!friend || !friend.online) return 'Offline';
  switch (friend.state) {
    case 'menu':
      return 'Im Hauptmenü';
    case 'singleplayer':
      return 'Spielt Einzelspieler';
    case 'multiplayer':
      return friend.server ? `Spielt auf ${friend.server}` : 'Spielt auf einem Server';
    case 'realms':
      return 'Spielt auf Realms';
    case 'lan':
      return 'Spielt im LAN';
    default:
      return 'Online';
  }
}

/** Eingabe für Spieler: UUID mit oder ohne Bindestriche → Form der Schnittstelle, sonst null. */
export function normalizeUuid(value) {
  const plain = String(value || '').trim().replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(plain) ? plain : null;
}

export const isPlayerName = (value) => /^[A-Za-z0-9_]{1,16}$/.test(value);

// ---------------------------------------------------------------------------------------------------------
// Formate
// ---------------------------------------------------------------------------------------------------------

const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const DATE_SHORT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const WEEKDAY_YEAR = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

const valid = (ms) => typeof ms === 'number' && Number.isFinite(ms) && ms > 0;
export const formatDate = (ms) => (valid(ms) ? DATE.format(ms) : '–');
export const formatTime = (ms) => (valid(ms) ? TIME.format(ms) : '–');
export const formatDateTime = (ms) => (valid(ms) ? `${DATE_SHORT.format(ms)}, ${TIME.format(ms)} Uhr` : '–');

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Trenner im Chat: Heute, Gestern, Montag, 23. November (Jahr nur, wenn nicht dieses). */
export function dayLabel(ms) {
  const today = startOfDay(Date.now());
  const day = startOfDay(ms);
  if (day === today) return 'Heute';
  if (today - day <= 26 * 3600 * 1000 && today > day) return 'Gestern';
  return new Date(ms).getFullYear() === new Date().getFullYear() ? WEEKDAY.format(ms) : WEEKDAY_YEAR.format(ms);
}

/** „gerade eben“, „vor 5 Minuten“, „vor 3 Stunden“, „gestern“, „vor 4 Tagen“, sonst das Datum. */
export function relativeTime(ms) {
  if (!valid(ms)) return '–';
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60000);
  if (diff < 0 || minutes < 1) return 'gerade eben';
  if (minutes < 60) return minutes === 1 ? 'vor 1 Minute' : `vor ${minutes} Minuten`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'vor 1 Stunde' : `vor ${hours} Stunden`;
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86400000);
  if (days <= 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return `am ${formatDate(ms)}`;
}

/** Kurze Zeitangabe für Listen: heute nur die Uhrzeit, sonst das Datum. */
export function shortWhen(ms) {
  if (!valid(ms)) return '';
  if (startOfDay(ms) === startOfDay(Date.now())) return TIME.format(ms);
  if (startOfDay(Date.now()) - startOfDay(ms) <= 26 * 3600 * 1000) return 'Gestern';
  return DATE_SHORT.format(ms);
}

export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return '–';
  if (bytes < 1024) return `${bytes} Byte`;
  if (bytes < 1024 * 1024) return `${NUMBER.format(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${NUMBER.format(bytes / 1024 / 1024)} MB`;
  return `${NUMBER.format(bytes / 1024 ** 3)} GB`;
}

/** <time datetime="…">Text</time> */
export function timeEl(ms, text) {
  return h('time', { datetime: valid(ms) ? new Date(ms).toISOString() : undefined, title: valid(ms) ? formatDateTime(ms) : undefined }, text);
}

// ---------------------------------------------------------------------------------------------------------
// Hinweise, Dialoge, Knöpfe
// ---------------------------------------------------------------------------------------------------------

/** Kurzer Hinweis unten auf der Seite (aria-live), verschwindet nach ein paar Sekunden. */
export function toast(message, kind = 'info') {
  let box = document.getElementById('toasts');
  if (!box) {
    box = h('div', { id: 'toasts', class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const iconName = kind === 'error' ? 'warning' : kind === 'success' ? 'check' : 'info';
  const item = h('div', { class: `toast ${kind}` }, icon(iconName), h('span', { class: 'toast-text', text: message }));
  const close = h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Hinweis schließen', onClick: () => item.remove() }, icon('close'));
  item.append(close);
  box.append(item);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => item.remove(), kind === 'error' ? 9000 : 5000);
}

/** Fehler als Hinweis zeigen. Abgelaufene Sitzungen (401) zeigt die Seite selbst an. */
export function showError(error) {
  if (error && error.name === 'AbortError') return;
  if (error instanceof ApiError && (error.status === 401 || error.handled)) return;
  toast(error?.message || fallbackMessage(-2), 'error');
  if (!(error instanceof ApiError)) console.error(error);
}

/** Knopf während einer Aktion sperren (aria-busy) und danach wieder freigeben. */
export async function busy(button, task) {
  const buttons = [button].flat().filter(Boolean);
  for (const element of buttons) {
    element.disabled = true;
    element.setAttribute('aria-busy', 'true');
  }
  try {
    return await task();
  } finally {
    for (const element of buttons) {
      element.disabled = false;
      element.removeAttribute('aria-busy');
    }
  }
}

/**
 * Modaler Dialog (<dialog>). body: Knoten mit Text oder Feldern. onConfirm darf async sein und werfen:
 * dann bleibt der Dialog offen und zeigt den Fehler. Ergebnis: Rückgabe von onConfirm (oder true), bei
 * Abbrechen null. canConfirm() steuert, ob der Bestätigen-Knopf aktiv ist (wird bei jeder Eingabe geprüft).
 */
export function openDialog({ title, body = [], confirmLabel = 'OK', cancelLabel = 'Abbrechen', danger = false, onConfirm, canConfirm, focus }) {
  return new Promise((resolve) => {
    const titleId = uid('dialog-title');
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const confirm = h('button', { type: 'submit', class: `button small${danger ? ' danger' : ''}` }, confirmLabel);
    const cancel = h('button', { type: 'button', class: 'button small ghost' }, cancelLabel);
    const form = h('form', { class: 'dialog-form', novalidate: true }, h('h2', { id: titleId, text: title }), body, error, h('div', { class: 'dialog-actions' }, cancel, confirm));
    const dialog = h('dialog', { class: 'modal', 'aria-labelledby': titleId }, form);
    const opener = document.activeElement;
    let working = false;
    let finished = false;

    const update = () => {
      if (canConfirm) confirm.disabled = working || !canConfirm();
    };
    const finish = (value) => {
      if (finished) return;
      finished = true;
      dialog.close();
      dialog.remove();
      if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };

    cancel.addEventListener('click', () => {
      if (!working) finish(null);
    });
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      if (!working) finish(null);
    });
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (working || (canConfirm && !canConfirm())) return;
      error.hidden = true;
      working = true;
      confirm.disabled = true;
      confirm.setAttribute('aria-busy', 'true');
      try {
        const result = onConfirm ? await onConfirm() : true;
        finish(result === undefined ? true : result);
      } catch (problem) {
        error.textContent = problem?.message || fallbackMessage(-2);
        error.hidden = false;
      } finally {
        working = false;
        confirm.removeAttribute('aria-busy');
        if (!finished) {
          confirm.disabled = false;
          update();
        }
      }
    });

    document.body.append(dialog);
    update();
    dialog.showModal();
    const target = (focus && form.querySelector(focus)) || form.querySelector('input:not([type="radio"]), textarea, select') || (danger ? cancel : confirm);
    target.focus();
  });
}

/** Ja/Nein-Frage. Ergebnis true/false; mit onConfirm wie openDialog. */
export async function confirmAction({ title, text, confirmLabel = 'Bestätigen', danger = false, onConfirm }) {
  const body = [text].flat().filter(Boolean).map((part) => (typeof part === 'string' ? h('p', { text: part }) : part));
  const result = await openDialog({ title, body, confirmLabel, danger, onConfirm });
  return result !== null;
}

/**
 * Reiter (ARIA tabs) mit Pfeiltasten, Pos1 und Ende. Reiter sind <button role="tab" data-tab="name"
 * aria-controls="panel-id">. Versteckte Reiter (hidden) werden übersprungen.
 */
export function setupTabs(tablist, onSelect) {
  const tabs = $$('[role="tab"]', tablist);
  const visible = () => tabs.filter((tab) => !tab.hidden);
  let current = null;

  function activate(tab, { focus = false, silent = false } = {}) {
    if (!tab) return;
    current = tab.dataset.tab;
    for (const other of tabs) {
      const active = other === tab;
      other.setAttribute('aria-selected', String(active));
      other.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    }
    if (focus) tab.focus();
    if (!silent && onSelect) onSelect(tab.dataset.tab);
  }

  tablist.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab && tablist.contains(tab)) activate(tab);
  });
  tablist.addEventListener('keydown', (event) => {
    const list = visible();
    const index = list.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = list[(index + 1) % list.length];
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = list[(index - 1 + list.length) % list.length];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list[list.length - 1];
    if (!next) return;
    event.preventDefault();
    activate(next, { focus: true });
  });

  return {
    select(name, options) {
      const tab = visible().find((candidate) => candidate.dataset.tab === name) ?? visible()[0];
      activate(tab, options);
    },
    current: () => current,
    has: (name) => visible().some((tab) => tab.dataset.tab === name),
  };
}

/**
 * Regelmäßig nachfragen, aber nur solange die Seite sichtbar ist. Wird sie wieder sichtbar, sofort einmal.
 */
export function poller(task, intervalMs) {
  let timer = null;
  let running = false;
  let active = false;
  const run = async () => {
    if (!active || running || document.visibilityState !== 'visible') return;
    running = true;
    try {
      await task();
    } catch {
      // Fehler beim Nachfragen nicht anzeigen; der nächste Versuch kommt von selbst.
    } finally {
      running = false;
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') run();
  };
  return {
    start() {
      if (active) return;
      active = true;
      timer = setInterval(run, intervalMs);
      document.addEventListener('visibilitychange', onVisibility);
    },
    stop() {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    },
    now: run,
  };
}

/** In die Zwischenablage kopieren (mit Rückfall für Browser ohne Clipboard-API). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { class: 'visually-hidden', readonly: true, value: text });
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/** Leerer Zustand einer Liste. */
export function emptyState(text, iconName = 'info') {
  return h('div', { class: 'empty' }, icon(iconName), h('p', { text }));
}

/** Ladeanzeige in einem Bereich. */
export function loadingState(text = 'Wird geladen …') {
  return h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text }));
}

/** Zähler „12/500“ für ein Eingabefeld. */
export function bindCounter(input, output, max) {
  const update = () => {
    const length = [...input.value].length;
    output.textContent = `${length}/${max}`;
    output.classList.toggle('near', length > max * 0.9);
  };
  input.addEventListener('input', update);
  update();
  return update;
}

/** Anzeige „Gespeichert“ neben einer Überschrift, die nach kurzer Zeit verschwindet. */
export function flashSaved(element, text = 'Gespeichert') {
  if (!element) return;
  element.replaceChildren(icon('check'), document.createTextNode(text));
  element.classList.add('visible');
  clearTimeout(element.flashTimer);
  element.flashTimer = setTimeout(() => element.classList.remove('visible'), 2200);
}
