// Gemeinsamer Zustand und Hilfsfunktionen der Oberfläche
import type { AccountInfo, AppInfo, GameState, HeldixApi, InstanceInfo, InstanceLoader, Settings, VersionListResult } from '../shared/api';

declare global {
  interface Window {
    heldix: HeldixApi;
  }
}

export const api = window.heldix;

export const state = {
  info: null as AppInfo | null,
  settings: null as Settings | null,
  versions: null as VersionListResult | null,
  instances: [] as InstanceInfo[],
  accounts: [] as AccountInfo[],
  game: { state: 'idle' } as GameState,
  progress: null as { stage: string; done: number; total: number } | null,
};

export function selectedInstance(): InstanceInfo | undefined {
  return state.instances.find((i) => i.id === state.settings?.selectedInstanceId) ?? state.instances[0];
}

// ---------- kleines Ereignis-System zwischen den Ansichten ----------
type Topic = 'instances' | 'settings' | 'game';
const listeners = new Map<Topic, Set<() => void>>();
export function on(topic: Topic, listener: () => void): void {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic)!.add(listener);
}
export function emit(topic: Topic): void {
  listeners.get(topic)?.forEach((listener) => listener());
}

export async function reloadInstances(): Promise<void> {
  [state.instances, state.settings] = await Promise.all([api.listInstances(), api.getSettings()]);
  emit('instances');
}

// ---------- DOM ----------
export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Element fehlt: ${selector}`);
  return element;
}

type Child = Node | string | null | undefined | false;
type Props = { [key: string]: unknown; class?: string; text?: string };

/** Kleiner Element-Baukasten: h('div', { class: 'x', onclick: fn }, kind1, 'Text') */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'text') element.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'style' && typeof value === 'object') Object.assign(element.style, value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child == null || child === false) continue;
    element.append(child);
  }
  return element;
}

export function svgIcon(path: string, className = 'icon'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', className);
  svg.innerHTML = path;
  return svg;
}

export const ICONS = {
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
};

// ---------- Toasts ----------
export function toast(message: string, kind: 'info' | 'error' | 'success' = 'info'): void {
  const el = h('div', { class: `toast ${kind}` },
    h('span', { class: 'toast-icon', text: kind === 'error' ? '!' : kind === 'success' ? '✓' : 'i' }),
    h('span', { text: message }));
  $('#toasts').append(el);
  const close = () => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 260);
  };
  el.addEventListener('click', close);
  window.setTimeout(close, kind === 'error' ? 8000 : 4200);
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
}

// ---------- Bestätigungsdialog ----------
export function confirmDialog(title: string, text: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (result: boolean) => {
      backdrop.remove();
      resolve(result);
    };
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e: Event) => e.target === backdrop && finish(false) },
      h('div', { class: 'modal small' },
        h('h3', { class: 'modal-title', text: title }),
        h('p', { class: 'modal-text', text }),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'ghost', text: 'Abbrechen', onclick: () => finish(false) }),
          h('button', { class: 'danger solid', text: confirmLabel, onclick: () => finish(true) }))));
    document.body.append(backdrop);
  });
}

// ---------- Formatierung ----------
export const LOADER_LABELS: Record<InstanceLoader, string> = { heldix: 'Heldix Loader', fabric: 'Fabric', vanilla: 'Vanilla' };

export function formatDate(iso: string | number): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatRelative(time: number | null): string {
  if (!time) return 'Noch nie gespielt';
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 1) return 'Gerade eben gespielt';
  if (minutes < 60) return `Vor ${minutes} Min. gespielt`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Vor ${hours} Std. gespielt`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Gestern gespielt';
  if (days < 14) return `Vor ${days} Tagen gespielt`;
  return `Zuletzt am ${formatDate(time)}`;
}

export function formatPlayTime(ms: number): string {
  if (!ms) return 'noch keine';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'unter 1 Min.';
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} Std. ${minutes % 60} Min.` : `${minutes} Min.`;
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tsd.`;
  return n.toLocaleString('de-DE');
}

/** Farbige Kachel einer Instanz mit Loader-Kennbuchstaben. */
export function instanceTile(instance: Pick<InstanceInfo, 'color' | 'loader' | 'name'>, size: 'small' | 'medium' | 'big' = 'medium'): HTMLElement {
  const letter = instance.loader === 'heldix' ? 'H' : instance.loader === 'fabric' ? 'F' : 'V';
  const tile = h('div', { class: `instance-tile ${size}`, text: letter });
  tile.style.setProperty('--tile', instance.color);
  return tile;
}
