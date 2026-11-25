// HeldixClient – Webseite: Suche im Hilfe-Center (/hilfe). Der Build legt /hilfe/suche.json an (Titel, Beschreibung,
// Stichworte, Text). Ohne Skript bleiben einfach die Kategorien sichtbar.
import { emptyState, h } from './app-common.js';

const input = document.getElementById('hilfe-suche');
const results = document.getElementById('hilfe-ergebnisse');
const categories = document.getElementById('hilfe-kategorien');
let index = null;

const normalize = (text) =>
  String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/-/g, ' ');

async function loadIndex() {
  if (index) return index;
  const response = await fetch('/hilfe/suche.json', { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(String(response.status));
  index = (await response.json()).map((entry) => ({
    ...entry,
    n: { titel: normalize(entry.titel), stichworte: normalize(entry.stichworte), beschreibung: normalize(entry.beschreibung), text: normalize(entry.text) },
  }));
  return index;
}

function score(entry, terms) {
  let total = 0;
  for (const term of terms) {
    let best = 0;
    if (entry.n.titel.includes(term)) best = 10;
    else if (entry.n.stichworte.includes(term)) best = 7;
    else if (entry.n.beschreibung.includes(term)) best = 5;
    else if (entry.n.text.includes(term)) best = 2;
    if (!best) return 0;
    total += best;
  }
  return total;
}

function snippet(entry, terms) {
  const text = entry.text;
  const lower = normalize(text);
  const position = Math.max(0, ...terms.map((term) => lower.indexOf(term)).filter((value) => value >= 0).concat([-1]));
  if (position <= 0) return entry.beschreibung;
  const start = Math.max(0, position - 60);
  return `${start ? '…' : ''}${text.slice(start, start + 170).trim()}…`;
}

async function search() {
  const terms = normalize(input.value).split(/[\s,]+/).filter((term) => term.length > 1);
  if (!terms.length) {
    results.hidden = true;
    categories.hidden = false;
    return;
  }
  let list;
  try {
    list = await loadIndex();
  } catch {
    results.replaceChildren(emptyState('Die Suche ist gerade nicht verfügbar. Die Themen unten helfen trotzdem weiter.', 'warning'));
    results.hidden = false;
    return;
  }
  const found = list
    .map((entry) => ({ entry, score: score(entry, terms) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  categories.hidden = true;
  results.hidden = false;
  if (!found.length) {
    results.replaceChildren(
      h('div', { class: 'empty' }, h('p', { text: `Keine Anleitung passt zu „${input.value.trim()}“.` }), h('a', { class: 'button small', href: '/konto#ziel=support' }, 'Support-Anfrage stellen')),
    );
    return;
  }
  results.replaceChildren(
    h('p', { class: 'result-line', text: found.length === 1 ? '1 Anleitung gefunden' : `${found.length} Anleitungen gefunden` }),
    h(
      'div',
      { class: 'article-list results' },
      found.map(({ entry }) => h('a', { class: 'article-card', href: `/hilfe/${entry.slug}` }, h('small', { text: entry.kategorie }), h('strong', { text: entry.titel }), h('span', { text: snippet(entry, terms) }))),
    ),
  );
}

let timer = 0;
input.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(search, 120);
});
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search();
});
const query = new URLSearchParams(location.search).get('q');
if (query) {
  input.value = query;
  search();
}
