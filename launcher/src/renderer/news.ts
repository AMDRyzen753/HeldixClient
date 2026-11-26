// Neuigkeiten auf der Startseite: Meldungen des HeldixClient-Teams (über den Heldix-Dienst) und die offiziellen
// Java-Patch-Notes von Mojang. Filter „Alle / HeldixClient / Minecraft“, wenn es beides gibt.
import type { NewsEntry } from '../shared/api';
import { $, api, errorMessage, formatDate, h, uiIcon } from './core.js';

/** Erlaubte HTML-Elemente aus Mojangs Patch Notes; alles andere wird zu reinem Text. */
const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'STRONG', 'B', 'EM', 'I', 'CODE', 'BR', 'A']);
/** so viele Einträge zeigt die Startseite */
const SHOWN = 5;
/** Meldungen des Teams gelten so lange als „neu“ und stehen in „Alle“ oben */
const FRESH_MS = 14 * 24 * 3600 * 1000;

type Filter = 'all' | 'heldix' | 'minecraft';
let entries: NewsEntry[] = [];
let filter: Filter = 'all';

/** Baut das HTML sicher nach: nur erlaubte Elemente, keine Attribute außer https-Links. */
function sanitize(html: string): DocumentFragment {
  const source = new DOMParser().parseFromString(html, 'text/html').body;
  const out = document.createDocumentFragment();
  const copy = (from: Node, to: Node): void => {
    for (const child of Array.from(from.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        to.appendChild(document.createTextNode(child.textContent ?? ''));
      } else if (child instanceof HTMLElement) {
        if (!ALLOWED.has(child.tagName)) {
          copy(child, to);
          continue;
        }
        const el = document.createElement(child.tagName.toLowerCase());
        if (child.tagName === 'A') {
          const href = child.getAttribute('href') ?? '';
          if (/^https:\/\//.test(href)) {
            el.setAttribute('href', href);
            el.setAttribute('target', '_blank');
            el.setAttribute('rel', 'noreferrer');
          }
        }
        copy(child, el);
        to.appendChild(el);
      }
    }
  };
  copy(source, out);
  return out;
}

/** Neuigkeit des Teams: reiner Text, Leerzeilen trennen Absätze */
function openHeldixNews(entry: NewsEntry): void {
  const body = h('div', { class: 'news-body' });
  for (const paragraph of (entry.text ?? '').split(/\n\s*\n/)) {
    if (paragraph.trim()) body.append(h('p', { text: paragraph.trim() }));
  }
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (event: Event) => event.target === backdrop && close() },
    h('div', { class: 'modal wide news-modal' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('h3', { class: 'modal-title', text: entry.title }),
          h('p', { class: 'modal-sub', text: `HeldixClient · ${formatDate(entry.date)}${entry.author ? ` · von ${entry.author}` : ''}` })),
        h('button', { class: 'icon-button', title: 'Schließen', onclick: close }, uiIcon('close'))),
      body));
  document.body.append(backdrop);
}

async function openNews(entry: NewsEntry): Promise<void> {
  if (entry.type === 'heldix') {
    openHeldixNews(entry);
    return;
  }
  const body = h('div', { class: 'news-body', text: 'Lade …' });
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (event: Event) => event.target === backdrop && close() },
    h('div', { class: 'modal wide news-modal' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('h3', { class: 'modal-title', text: entry.title }),
          h('p', { class: 'modal-sub', text: `${entry.type === 'release' ? 'Vollversion' : 'Snapshot'} · ${formatDate(entry.date)} · Patch Notes von Mojang (Englisch)` })),
        h('button', { class: 'icon-button', title: 'Schließen', onclick: close }, uiIcon('close'))),
      entry.image ? h('img', { class: 'news-modal-image', src: entry.image, alt: '' }) : null,
      body));
  document.body.append(backdrop);
  try {
    const html = await api.getNewsBody(entry.id);
    body.textContent = '';
    body.append(sanitize(html));
  } catch (error) {
    body.textContent = `Konnte die Patch Notes nicht laden: ${errorMessage(error)}`;
  }
}

const time = (entry: NewsEntry) => Date.parse(entry.date) || 0;
const fresh = (entry: NewsEntry) => entry.type === 'heldix' && Date.now() - time(entry) < FRESH_MS;

/** Einträge für den Filter: neueste zuerst, frische Meldungen des Teams in „Alle“ ganz oben */
function visibleEntries(): NewsEntry[] {
  const list = entries.filter((entry) => filter === 'all' || (filter === 'heldix') === (entry.type === 'heldix'));
  return list.sort((a, b) => (filter === 'all' ? Number(fresh(b)) - Number(fresh(a)) : 0) || time(b) - time(a)).slice(0, SHOWN);
}

function render(): void {
  const list = $('#news-list');
  list.textContent = '';
  const hasHeldix = entries.some((entry) => entry.type === 'heldix');
  const hasMinecraft = entries.some((entry) => entry.type !== 'heldix');
  $('#news-filter').hidden = !(hasHeldix && hasMinecraft);
  $('#news-sub').textContent = hasHeldix && hasMinecraft ? 'HeldixClient und Minecraft' : hasHeldix ? 'Vom HeldixClient-Team' : 'Minecraft Patch Notes';
  for (const button of document.querySelectorAll<HTMLButtonElement>('#news-filter button')) {
    button.classList.toggle('active', button.dataset.filter === filter);
    button.setAttribute('aria-pressed', String(button.dataset.filter === filter));
  }
  const shown = visibleEntries();
  if (shown.length === 0) {
    list.append(h('div', { class: 'row-empty', text: 'Hier gibt es gerade nichts Neues.' }));
    return;
  }
  for (const entry of shown) {
    const thumb = entry.type === 'heldix'
      ? h('img', { class: 'row-icon thumb heldix', src: 'logo.svg', alt: '' })
      : entry.image
      ? h('img', { class: 'row-icon thumb', src: entry.image, alt: '' })
      : h('span', { class: 'row-icon thumb placeholder' }, uiIcon('news', ''));
    const kind = entry.type === 'heldix' ? 'HeldixClient' : entry.type === 'release' ? 'Vollversion' : 'Snapshot';
    list.append(h('button', { class: 'row-item', type: 'button', title: entry.summary || entry.title, onclick: () => void openNews(entry) },
      thumb,
      h('span', { class: 'row-text' },
        h('span', { class: 'row-name', text: entry.title }),
        h('span', { class: 'row-meta' },
          h('span', { class: `row-kind${entry.type === 'snapshot' ? '' : entry.type === 'heldix' ? ' heldix' : ' release'}`, text: kind }),
          ` · ${formatDate(entry.date)}`)),
      fresh(entry) ? h('span', { class: 'row-new', text: 'Neu' }) : null));
  }
}

let wired = false;

/** Lädt die Neuigkeiten für die Startseite (Heldix-Dienst und Mojang). */
export async function loadNews(): Promise<void> {
  if (!wired) {
    wired = true;
    $('#news-filter').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-filter]');
      if (!button || button.dataset.filter === filter) return;
      filter = button.dataset.filter as Filter;
      render();
    });
  }
  try {
    entries = await api.listNews();
  } catch {
    // offline: kein Bereich
    entries = [];
  }
  $('#news-panel').hidden = entries.length === 0;
  render();
}
