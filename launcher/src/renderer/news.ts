// Minecraft-Neuigkeiten (offizielle Java-Patch-Notes von Mojang) im Bereich „Neuigkeiten“ der Startseite.
import type { NewsEntry } from '../shared/api';
import { $, api, errorMessage, formatDate, h, uiIcon } from './core.js';

/** Erlaubte HTML-Elemente aus Mojangs Patch Notes; alles andere wird zu reinem Text. */
const ALLOWED = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'STRONG', 'B', 'EM', 'I', 'CODE', 'BR', 'A']);

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

/** Zeigt die neuesten Meldungen im Bereich „Neuigkeiten“ der Startseite. */
export async function loadNews(): Promise<void> {
  const panel = $('#news-panel');
  const list = $('#news-list');
  let entries: NewsEntry[] = [];
  try {
    entries = await api.listNews();
  } catch {
    // offline: kein Bereich
  }
  panel.hidden = entries.length === 0;
  list.textContent = '';
  for (const entry of entries.slice(0, 4)) {
    const thumb = entry.type === 'heldix'
      ? h('img', { class: 'row-icon thumb heldix', src: 'logo.svg', alt: '' })
      : entry.image
      ? h('img', { class: 'row-icon thumb', src: entry.image, alt: '' })
      : h('span', { class: 'row-icon placeholder' });
    const kind = entry.type === 'heldix' ? 'HeldixClient' : entry.type === 'release' ? 'Vollversion' : 'Snapshot';
    list.append(h('button', { class: 'row-item', type: 'button', title: entry.summary, onclick: () => void openNews(entry) },
      thumb,
      h('span', { class: 'row-text' },
        h('span', { class: 'row-name', text: entry.title }),
        h('span', { class: 'row-meta' },
          h('span', { class: `row-kind${entry.type === 'snapshot' ? '' : ' release'}`, text: kind }),
          ` · ${formatDate(entry.date)}`))));
  }
}
