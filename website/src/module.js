// HeldixClient – Webseite: Module (/module). Die Karten erzeugt der Build aus den Quellen der Mod; hier nur
// Filtern nach Art und Suchen (ohne Skript sind einfach alle Karten zu sehen).
const search = document.getElementById('modul-suche');
const filterGroup = document.getElementById('modul-filter');
const cards = [...document.querySelectorAll('.module-card')];
const result = document.getElementById('modul-ergebnis');
const empty = document.getElementById('modul-leer');
let filter = 'alle';

function apply() {
  const terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const card of cards) {
    const matchesKind = filter === 'alle' || card.dataset.kategorie === filter;
    const text = card.dataset.suche || '';
    const visible = matchesKind && terms.every((term) => text.includes(term));
    card.hidden = !visible;
    if (visible) shown++;
  }
  empty.hidden = shown > 0;
  result.textContent = terms.length || filter !== 'alle' ? `${shown} von ${cards.length} Modulen` : '';
}

filterGroup.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-filter]');
  if (!button) return;
  filter = button.dataset.filter;
  for (const other of filterGroup.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
  apply();
});
search.addEventListener('input', apply);
// Direktlink wie /module#modul-zoom: Karte hervorheben
if (location.hash.startsWith('#modul-')) document.getElementById(location.hash.slice(1))?.classList.add('highlight');
apply();
