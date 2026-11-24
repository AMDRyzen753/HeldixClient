// Minecraft-Neuigkeiten (offizielle Java-Patch-Notes von Mojang) in der rechten Spalte der Startseite.
import type { NewsEntry } from '../shared/api';
import { $, api, errorMessage, formatDate, h } from './core.js';

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

async function openNews(entry: NewsEntry): Promise<void> {
  const body = h('div', { class: 'news-body', text: 'Lade …' });
  const close = () => backdrop.remove();
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (event: Event) => event.target === backdrop && close() },
    h('div', { class: 'modal wide news-modal' },
      h('div', { class: 'modal-head' },
        h('div', {},
          h('h3', { class: 'modal-title', text: entry.title }),
          h('p', { class: 'modal-sub', text: `${entry.type === 'release' ? 'Vollversion' : 'Snapshot'} · ${formatDate(entry.date)} · Patch Notes von Mojang (Englisch)` })),
        h('button', { class: 'icon-button', title: 'Schließen', text: '×', onclick: close })),
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

/** Zeigt die neueste Meldung als dezente Pille unten auf der Startseite. */
export async function loadNews(): Promise<void> {
  const pill = $('#news-pill');
  let entries: NewsEntry[] = [];
  try {
    entries = await api.listNews();
  } catch {
    // offline: keine Pille
  }
  const latest = entries[0];
  pill.hidden = !latest;
  if (!latest) return;
  $('#news-pill-badge').textContent = latest.type === 'release' ? 'Neu' : 'Snapshot';
  $('#news-pill-text').textContent = `${latest.title} · ${formatDate(latest.date)}`;
  pill.title = latest.summary;
  pill.onclick = () => void openNews(latest);
}
