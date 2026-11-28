// HeldixClient – Webseite: Team-Bereich – einheitliche Listen und Tabellen (Meldungen, Sperren, Protokoll, Team,
// Abzeichen): Suche, Filter, Sortierung, Seiten und Sammelaktionen. Die Einträge zeichnet der Bereich selbst
// (render), diese Werkzeugleiste kümmert sich um Auswahl, Reihenfolge und Seiten.
//
// createListTools({ id, toolbar, list, items, key, text, filters, sorts, pageSizes, selectable, bulk, render, empty })
//   toolbar: Element für die Werkzeugleiste (Suche, Filter, Sortierung) · list: Element für die Einträge
//   items(): alle Einträge · key(item): eindeutige ID · text(item): Suchtext
//   filters: [{ id, label, options: [[wert, text]], test(item, wert) }] (erste Option = alle)
//   sorts: [{ id, label, compare(a, b) }] · pageSizes: [10, 25, 50] · selectable(item): auswählbar?
//   bulk: [{ id, label, icon, danger, run: async (ausgewählte Einträge) }]
//   render(einträge der Seite, { checkbox(item) }) → Knoten · empty(): Knoten, wenn nichts passt
// Rückgabe: { refresh(), reset(), selected(), state }
import { busy, h, icon, showError, uid } from './app-common.js';

export function createListTools({ id, toolbar, list, items, key, text = () => '', filters = [], sorts = [], pageSizes = [10, 25, 50], selectable = null, bulk = [], render, empty }) {
  const state = { query: '', filters: Object.fromEntries(filters.map((filter) => [filter.id, filter.options[0][0]])), sort: sorts[0]?.id ?? null, page: 0, size: pageSizes[0], selected: new Set() };
  const searchId = uid(`${id}-suche`);

  // --- Werkzeugleiste
  const search = h('input', { class: 'input', type: 'search', id: searchId, autocomplete: 'off', spellcheck: 'false', placeholder: 'Filtern …', dataset: { tabelle: 'suche' } });
  const searchBox = h('label', { class: 'search search--inline table-tools__search', for: searchId }, icon('search'), h('span', { class: 'sr-only', text: 'Liste filtern' }), search);
  const filterSelects = filters.map((filter) => {
    const select = h('select', { class: 'select input table-tools__select', 'aria-label': filter.label, dataset: { tabelle: `filter-${filter.id}` } }, filter.options.map(([value, label]) => h('option', { value, text: label })));
    select.addEventListener('change', () => {
      state.filters[filter.id] = select.value;
      state.page = 0;
      refresh();
    });
    return select;
  });
  const sortSelect = sorts.length > 1 ? h('select', { class: 'select input table-tools__select', 'aria-label': 'Sortieren', dataset: { tabelle: 'sortierung' } }, sorts.map((sort) => h('option', { value: sort.id, text: sort.label }))) : null;
  sortSelect?.addEventListener('change', () => {
    state.sort = sortSelect.value;
    state.page = 0;
    refresh();
  });
  search.addEventListener('input', () => {
    state.query = search.value.trim().toLowerCase();
    state.page = 0;
    refresh();
  });
  toolbar.classList.add('table-tools');
  toolbar.replaceChildren(searchBox, ...filterSelects, sortSelect ?? '');

  // --- Sammelaktionen und Seiten (unter der Liste)
  const bulkBar = h('div', { class: 'table-bulk', hidden: true, role: 'region', 'aria-label': 'Ausgewählte Einträge' });
  const pager = h('nav', { class: 'table-pager', 'aria-label': 'Seiten' });
  list.after(bulkBar, pager);

  function visible() {
    let result = items().filter((item) => filters.every((filter) => state.filters[filter.id] === filter.options[0][0] || filter.test(item, state.filters[filter.id])));
    if (state.query) result = result.filter((item) => String(text(item)).toLowerCase().includes(state.query));
    const sort = sorts.find((entry) => entry.id === state.sort);
    if (sort) result = [...result].sort(sort.compare);
    return result;
  }

  function checkbox(item) {
    if (!selectable || !selectable(item)) return null;
    const itemKey = String(key(item));
    const box = h('input', { type: 'checkbox', class: 'table-check', 'aria-label': 'Auswählen', dataset: { auswahl: itemKey } });
    box.checked = state.selected.has(itemKey);
    box.addEventListener('change', () => {
      if (box.checked) state.selected.add(itemKey);
      else state.selected.delete(itemKey);
      renderBulk(visible());
    });
    return box;
  }

  function renderBulk(all) {
    const keys = new Set(all.map((item) => String(key(item))));
    for (const itemKey of [...state.selected]) if (!keys.has(itemKey)) state.selected.delete(itemKey);
    const candidates = selectable ? all.filter(selectable) : [];
    bulkBar.hidden = !selectable || !candidates.length || !bulk.length;
    if (bulkBar.hidden) return;
    const count = state.selected.size;
    const allBox = h('input', { type: 'checkbox', id: uid(`${id}-alle`), dataset: { tabelle: 'alle' } });
    allBox.checked = count > 0 && count === candidates.length;
    allBox.indeterminate = count > 0 && count < candidates.length;
    allBox.addEventListener('change', () => {
      if (allBox.checked) for (const item of candidates) state.selected.add(String(key(item)));
      else state.selected.clear();
      refresh();
    });
    bulkBar.replaceChildren(
      h('label', { class: 'check small', for: allBox.id }, allBox, h('span', { text: count ? `${count} ausgewählt` : `Alle ${candidates.length} auswählen` })),
      h(
        'div',
        { class: 'btn-group' },
        bulk.map((action) =>
          h(
            'button',
            {
              type: 'button',
              class: `btn btn--sm ${action.danger ? 'btn--danger' : 'btn--secondary'}`,
              disabled: count === 0 || undefined,
              dataset: { sammel: action.id },
              onClick: async (event) => {
                const chosen = candidates.filter((item) => state.selected.has(String(key(item))));
                if (!chosen.length) return;
                try {
                  const done = await busy(event.currentTarget, () => action.run(chosen));
                  if (done !== false) state.selected.clear();
                } catch (error) {
                  showError(error);
                }
                refresh();
              },
            },
            action.icon ? icon(action.icon) : null,
            action.label,
          ),
        ),
      ),
    );
  }

  function renderPager(total) {
    const pages = Math.max(1, Math.ceil(total / state.size));
    state.page = Math.min(state.page, pages - 1);
    const sizeSelect = pageSizes.length > 1 ? h('select', { class: 'select input table-tools__select', 'aria-label': 'Einträge je Seite', dataset: { tabelle: 'seitengroesse' } }, pageSizes.map((size) => h('option', { value: String(size), text: `${size} je Seite` }))) : null;
    if (sizeSelect) {
      sizeSelect.value = String(state.size);
      sizeSelect.addEventListener('change', () => {
        state.size = Number(sizeSelect.value);
        state.page = 0;
        refresh();
      });
    }
    pager.hidden = total <= pageSizes[0];
    const go = (delta) => {
      state.page = Math.max(0, Math.min(pages - 1, state.page + delta));
      refresh();
      list.scrollIntoView({ block: 'nearest' });
    };
    pager.replaceChildren(
      h('span', { class: 'table-pager__info', text: `${total === 0 ? 0 : state.page * state.size + 1}–${Math.min(total, (state.page + 1) * state.size)} von ${total}` }),
      sizeSelect ?? '',
      h('div', { class: 'btn-group' }, h('button', { type: 'button', class: 'btn btn--secondary btn--sm', disabled: state.page === 0 || undefined, dataset: { seite: 'zurueck' }, onClick: () => go(-1) }, icon('chevron-left'), 'Zurück'), h('button', { type: 'button', class: 'btn btn--secondary btn--sm', disabled: state.page >= pages - 1 || undefined, dataset: { seite: 'weiter' }, onClick: () => go(1) }, 'Weiter', icon('chevron-right'))),
    );
  }

  function refresh() {
    const all = visible();
    renderPager(all.length);
    const page = all.slice(state.page * state.size, state.page * state.size + state.size);
    const active = document.activeElement;
    const focusKey = active && list.contains(active) ? active.dataset.focusKey : null;
    list.replaceChildren(...[page.length ? render(page, { checkbox }) : empty?.(items().length > 0)].flat().filter(Boolean));
    if (focusKey) [...list.querySelectorAll('[data-focus-key]')].find((element) => element.dataset.focusKey === focusKey)?.focus();
    renderBulk(all);
  }

  return {
    refresh,
    reset() {
      state.selected.clear();
      state.page = 0;
    },
    selected: () => [...state.selected],
    state,
  };
}
