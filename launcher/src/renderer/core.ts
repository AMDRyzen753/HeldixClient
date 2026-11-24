// Gemeinsamer Zustand und Hilfsfunktionen der Oberfläche
import type { AccountInfo, AppInfo, GameState, HeldixApi, InstanceInfo, InstanceLoader, LoaderLogos, Settings, VersionListResult } from '../shared/api';
import { UI_ICONS } from './ui-icons.js';

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
  logos: null as LoaderLogos | null,
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
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = path;
  return svg;
}

/** Icons aus dem Heldix-Icon-Set (dieselben wie im Spiel), unter den bisherigen Namen */
export const ICONS = {
  play: UI_ICONS.play,
  trash: UI_ICONS.trash,
  folder: UI_ICONS.folder,
  plus: UI_ICONS.plus,
  download: UI_ICONS.download,
  check: UI_ICONS.check,
  lock: UI_ICONS.lock,
  back: UI_ICONS['chevron-left'],
  close: UI_ICONS.close,
  search: UI_ICONS.search,
  file: UI_ICONS.file,
  compass: UI_ICONS.compass,
  blocks: UI_ICONS.cube,
  puzzle: UI_ICONS.addons,
  world: UI_ICONS.world,
  server: UI_ICONS.server,
  sparkle: UI_ICONS.sparkles,
  sliders: UI_ICONS.options,
};

/** SVG aus dem Heldix-Icon-Set */
export function uiIcon(name: string, className = 'icon'): SVGSVGElement {
  return svgIcon(UI_ICONS[name] ?? UI_ICONS.cube, className);
}

/** Füllt alle <svg data-icon="name"> im HTML mit dem passenden Icon. */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<SVGSVGElement>('svg[data-icon]').forEach((svg) => {
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML = UI_ICONS[svg.dataset.icon ?? ''] ?? '';
  });
}

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

/**
 * Logo eines Loaders: HeldixClient (eigenes Logo), Fabric (aus der Fabric-Loader-JAR) und Minecraft (aus der Client-JAR).
 * null, solange es nicht geladen ist – dann zeigt die Kachel ein Icon aus dem Heldix-Icon-Set.
 */
export function loaderLogo(loader: InstanceLoader): string | null {
  if (loader === 'heldix') return 'logo.svg';
  return state.logos?.[loader] ?? null;
}

/** Kachel einer Instanz mit dem Logo ihres Loaders; die Farbe der Instanz zeigt der Rahmen. */
export function instanceTile(instance: Pick<InstanceInfo, 'color' | 'loader' | 'name'>, size: 'small' | 'medium' | 'big' = 'medium'): HTMLElement {
  const logo = loaderLogo(instance.loader);
  const tile = h('div', { class: `instance-tile ${size}${logo ? ` logo ${instance.loader}` : ''}`, title: LOADER_LABELS[instance.loader] },
    logo ? h('img', { class: 'tile-logo', src: logo, alt: '' }) : uiIcon(`loader-${instance.loader}`, 'tile-icon'));
  tile.style.setProperty('--tile', instance.color);
  return tile;
}

/** Logos in der Loader-Auswahl des Dialogs „Neue Instanz“ */
export function applyLoaderLogos(): void {
  document.querySelectorAll<HTMLElement>('.ni-loader').forEach((button) => {
    const loader = button.dataset.loader as InstanceLoader;
    const logo = loaderLogo(loader);
    const icon = button.querySelector<HTMLElement>('.ni-loader-icon');
    if (!logo || !icon) return;
    icon.textContent = '';
    icon.classList.add('logo');
    icon.append(h('img', { src: logo, alt: '' }));
  });
}
