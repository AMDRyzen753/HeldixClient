// HeldixClient – Webseite: Team-Bereich → Schnellsuche (Strg+K bzw. ⌘K, Knopf in der Kopfzeile).
//
// Ein Suchfeld für alles im Team-Bereich: Spieler (GET /v1/team/players?q=…), Support-Anfragen, Meldungen,
// Addon-Einreichungen, Addons und (Admins) Cosmetics, dazu Bereiche und häufige Aktionen. Pfeiltasten wählen, Enter
// öffnet den Treffer direkt im passenden Bereich (z. B. die Anfrage mit Verlauf), Escape schließt.
//
// Anfragen: die Listen (Anfragen, Meldungen, Einreichungen, Addons, Cosmetics) erst beim ersten Tippen und dann für
// eine Minute zwischengespeichert; Spieler mit kurzer Pause nach dem Tippen. Nichts davon läuft im Hintergrund.
import { avatar, h, icon, normalizeUuid, reasonLabel, relativeTime, uid } from './app-common.js';
import { addonIcon, normalizeAddons } from './addon-common.js';
import { publicGet } from './public-cards.js';
import { shellIcon } from './app-shell.js';

const CACHE_MS = 60_000;
const GROUP_MAX = 5;
const PLAYER_DELAY = 220;

const fold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss');

/** Wie gut passt text zur Suche? 0 = gar nicht. */
function score(query, ...texts) {
  let best = 0;
  for (const raw of texts) {
    const text = fold(raw);
    if (!text) continue;
    if (text === query) best = Math.max(best, 100);
    else if (text.startsWith(query)) best = Math.max(best, 80);
    else if (text.split(/[\s·,./_-]+/).some((word) => word.startsWith(query))) best = Math.max(best, 60);
    else if (query.length >= 2 && text.includes(query)) best = Math.max(best, 40);
  }
  return best;
}

const SUPPORT_STATUS = { open: 'wartet', answered: 'beantwortet', closed: 'geschlossen' };
const SUBMISSION_STATUS = { pending: 'zu prüfen', approved: 'freigegeben', rejected: 'abgelehnt', withdrawn: 'zurückgezogen' };

/**
 * shell: Rahmen. teamCall: Team-Anfrage. isAdmin(). sections(): sichtbare Bereiche [{ id, label, description, icon }].
 * open: { section(id), player(uuid), ticket(id), report(id), submission(id), addon(id), cosmetic(id) }.
 * actions(): zusätzliche Befehle [{ id, label, text, icon, keywords, run }]. getCosmetics(): bekannte Cosmetics oder null.
 */
export function initTeamSearch({ shell, teamCall, isAdmin, sections, open, actions, getTeamAddons, getCosmetics }) {
  const cache = new Map(); // name → { at, data }
  const loading = new Map(); // name → Promise
  const state = { query: '', results: [], active: 0, moved: false, players: { query: '', list: [], loading: false }, playerTimer: null, playerAbort: null, enabled: false };
  let dialog = null;
  let input = null;
  let listbox = null;
  let status = null;

  // -------------------------------------------------------------------------------------------------------
  // Daten
  // -------------------------------------------------------------------------------------------------------

  const LOADERS = {
    tickets: async () => (await teamCall('GET', '/v1/team/support?status=all'))?.tickets ?? [],
    reports: async () => (await teamCall('GET', '/v1/team/reports?status=all'))?.reports ?? [],
    submissions: async () => (await teamCall('GET', '/v1/team/addon-submissions?status=all'))?.submissions ?? [],
    addons: async () => {
      if (isAdmin()) {
        const known = getTeamAddons();
        if (known?.addons) return known.addons.map((addon) => ({ id: addon.id, name: addon.name ?? addon.id, version: addon.versions?.[0]?.version ?? addon.latest ?? '', hidden: Boolean(addon.hidden), official: addon.official !== false && !addon.owner }));
        const data = await teamCall('GET', '/v1/team/addons');
        return (data?.addons ?? []).map((addon) => ({ id: addon.id, name: addon.name ?? addon.id, version: addon.latest ?? '', hidden: Boolean(addon.hidden), official: addon.official !== false && !addon.owner }));
      }
      return normalizeAddons((await publicGet('/v1/addons'))?.addons).map((addon) => ({ id: addon.id, name: addon.name, version: addon.version, hidden: false, official: addon.official }));
    },
    cosmetics: async () => {
      const known = getCosmetics?.();
      if (known) return known;
      return (await teamCall('GET', '/v1/team/cosmetics'))?.cosmetics ?? [];
    },
  };

  function listNames() {
    return ['tickets', 'reports', 'submissions', 'addons', ...(isAdmin() ? ['cosmetics'] : [])];
  }

  function ensureLists() {
    for (const name of listNames()) {
      const cached = cache.get(name);
      if ((cached && Date.now() - cached.at < CACHE_MS) || loading.has(name)) continue;
      const job = LOADERS[name]()
        .then((data) => cache.set(name, { at: Date.now(), data: Array.isArray(data) ? data : [] }))
        .catch(() => cache.set(name, { at: Date.now(), data: cache.get(name)?.data ?? [], failed: true }))
        .finally(() => {
          loading.delete(name);
          if (dialog?.open) update();
        });
      loading.set(name, job);
    }
  }

  const list = (name) => cache.get(name)?.data ?? [];

  function searchPlayers(query) {
    clearTimeout(state.playerTimer);
    state.playerAbort?.abort();
    const uuid = normalizeUuid(query);
    if (!uuid && (query.length < 2 || !/^[A-Za-z0-9_]{1,16}$/.test(query))) {
      state.players = { query: '', list: [], loading: false };
      return;
    }
    if (state.players.query === query && !state.players.loading) return;
    state.players = { query, list: state.players.query && query.startsWith(state.players.query) ? state.players.list : [], loading: true };
    state.playerTimer = setTimeout(async () => {
      const abort = new AbortController();
      state.playerAbort = abort;
      try {
        const data = await teamCall('GET', `/v1/team/players?q=${encodeURIComponent(uuid ?? query)}`, undefined, { signal: abort.signal });
        if (fold(state.query.trim()) !== fold(query)) return;
        state.players = { query, list: Array.isArray(data?.players) ? data.players.slice(0, GROUP_MAX) : [], loading: false };
      } catch (error) {
        if (error?.name === 'AbortError') return;
        state.players = { query, list: [], loading: false };
      }
      if (dialog?.open) update();
    }, PLAYER_DELAY);
  }

  // -------------------------------------------------------------------------------------------------------
  // Treffer
  // -------------------------------------------------------------------------------------------------------

  function sectionResults(query) {
    const all = sections().map((section) => ({
      key: `bereich:${section.id}`,
      group: 'Bereiche',
      title: section.label,
      sub: section.description,
      lead: () => h('span', { class: 'palette-icon' }, shellIcon(section.icon)),
      score: query ? score(query, section.label, section.id, section.description) : 1,
      run: () => open.section(section.id),
    }));
    const extra = (actions?.() ?? []).map((action) => ({
      key: `aktion:${action.id}`,
      group: 'Aktionen',
      title: action.label,
      sub: action.text,
      lead: () => h('span', { class: 'palette-icon action' }, icon(action.icon)),
      score: query ? score(query, action.label, ...(action.keywords ?? [])) : 1,
      run: action.run,
    }));
    return [...all, ...extra].filter((result) => result.score > 0);
  }

  function dataResults(query) {
    const results = [];
    const idMatch = /^#?(\d{1,9})$/.exec(query);
    const number = idMatch ? Number(idMatch[1]) : null;
    const idScore = (id) => (number !== null && Number(id) === number ? 100 : 0);

    for (const player of state.players.list) {
      results.push({
        key: `spieler:${player.uuid}`,
        group: 'Spieler',
        title: player.name,
        sub: [player.online ? 'online' : `zuletzt online ${relativeTime(player.lastSeen)}`, player.banned ? 'gesperrt' : null, player.role ? (player.role === 'admin' ? 'Admin' : 'Moderator') : null].filter(Boolean).join(' · '),
        lead: () => avatar(player.name, player.uuid, { size: 'sm' }),
        score: player.uuid === normalizeUuid(query) ? 100 : score(query, player.name) || 50,
        run: () => open.player(player.uuid),
      });
    }
    for (const ticket of list('tickets')) {
      const s = Math.max(idScore(ticket.id), score(query, ticket.subject, ticket.player?.name));
      if (!s) continue;
      results.push({
        key: `anfrage:${ticket.id}`,
        group: 'Support-Anfragen',
        title: ticket.subject,
        sub: `#${ticket.id} · ${ticket.player?.name ?? '?'} · ${ticket.unread && ticket.status !== 'closed' ? 'wartet' : (SUPPORT_STATUS[ticket.status] ?? ticket.status)}`,
        lead: () => h('span', { class: 'palette-icon' }, icon('chat')),
        score: s,
        run: () => open.ticket(ticket.id),
      });
    }
    for (const report of list('reports')) {
      const s = Math.max(idScore(report.id), score(query, report.reported?.name, report.reporter?.name, reasonLabel(report.reason)));
      if (!s) continue;
      results.push({
        key: `meldung:${report.id}`,
        group: 'Meldungen',
        title: `Meldung #${report.id}: ${report.reported?.name ?? '?'}`,
        sub: `${reasonLabel(report.reason)} · von ${report.reporter?.name ?? '?'} · ${report.status === 'done' ? 'erledigt' : 'offen'}`,
        lead: () => h('span', { class: 'palette-icon' }, icon('flag')),
        score: s,
        run: () => open.report(report.id),
      });
    }
    for (const sub of list('submissions')) {
      const s = score(query, sub.name, sub.addonId, sub.submitter?.name);
      if (!s) continue;
      results.push({
        key: `einreichung:${sub.id}`,
        group: 'Einreichungen',
        title: `${sub.name || sub.addonId} ${sub.version ?? ''}`.trim(),
        sub: `${sub.addonId ?? ''} · von ${sub.submitter?.name ?? '?'} · ${SUBMISSION_STATUS[sub.status] ?? sub.status ?? ''}`,
        lead: () => addonIcon(typeof sub.icon === 'string' ? sub.icon : 'addons', 'addon-icon tiny'),
        score: s,
        run: () => open.submission(String(sub.id)),
      });
    }
    for (const addon of list('addons')) {
      const s = score(query, addon.name, addon.id);
      if (!s) continue;
      results.push({
        key: `addon:${addon.id}`,
        group: 'Addons',
        title: addon.name,
        sub: [addon.id, addon.version ? `Version ${addon.version}` : null, addon.official ? 'offiziell' : 'Community', addon.hidden ? 'ausgeblendet' : null, isAdmin() ? null : 'öffnet den Store'].filter(Boolean).join(' · '),
        lead: () => h('span', { class: 'palette-icon' }, icon('addons')),
        score: s,
        run: () => open.addon(addon.id),
      });
    }
    if (isAdmin()) {
      for (const cosmetic of list('cosmetics')) {
        const s = score(query, cosmetic.name, cosmetic.id);
        if (!s) continue;
        results.push({
          key: `cosmetic:${cosmetic.id}`,
          group: 'Cosmetics',
          title: cosmetic.name ?? cosmetic.id,
          sub: [cosmetic.id, `Version ${cosmetic.version}`, cosmetic.hidden ? 'ausgeblendet' : null].filter(Boolean).join(' · '),
          lead: () => h('span', { class: 'palette-icon' }, icon('sparkles')),
          score: s,
          run: () => open.cosmetic(cosmetic.id),
        });
      }
    }
    return results;
  }

  /** Gruppen nach bestem Treffer ordnen, je Gruppe höchstens GROUP_MAX. */
  function collect() {
    const query = fold(state.query.trim());
    const pool = query ? [...dataResults(query), ...sectionResults(query)] : sectionResults('');
    const groups = new Map();
    for (const result of pool) {
      if (!groups.has(result.group)) groups.set(result.group, []);
      groups.get(result.group).push(result);
    }
    const ordered = [...groups.entries()]
      .map(([name, items]) => [name, items.sort((a, b) => b.score - a.score).slice(0, query ? GROUP_MAX : 20)])
      .sort((a, b) => (query ? b[1][0].score - a[1][0].score : 0));
    return ordered;
  }

  // -------------------------------------------------------------------------------------------------------
  // Anzeige
  // -------------------------------------------------------------------------------------------------------

  function setActive(index, { scroll = true } = {}) {
    if (!state.results.length) {
      state.active = -1;
      input.removeAttribute('aria-activedescendant');
      return;
    }
    state.active = (index + state.results.length) % state.results.length;
    for (const [position, result] of state.results.entries()) {
      const element = document.getElementById(result.elementId);
      if (!element) continue;
      const selected = position === state.active;
      element.setAttribute('aria-selected', String(selected));
      element.classList.toggle('active', selected);
      if (selected) {
        input.setAttribute('aria-activedescendant', result.elementId);
        if (scroll) element.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  function update() {
    const groups = collect();
    const activeKey = state.results[state.active]?.key ?? null;
    state.results = [];
    const blocks = groups.map(([name, items]) => {
      const titleId = uid('suche-gruppe');
      return h(
        'div',
        { class: 'palette-group', role: 'group', 'aria-labelledby': titleId },
        h('div', { class: 'palette-group-title', id: titleId, role: 'presentation', text: name }),
        items.map((result) => {
          result.elementId = uid('suche-treffer');
          const position = state.results.push(result) - 1;
          const option = h(
            'div',
            { class: 'palette-option', role: 'option', id: result.elementId, 'aria-selected': 'false', dataset: { key: result.key } },
            result.lead(),
            h('span', { class: 'palette-text' }, h('span', { class: 'palette-title', text: result.title }), result.sub ? h('span', { class: 'palette-sub', text: result.sub }) : null),
            h('span', { class: 'palette-go', 'aria-hidden': 'true' }, icon('chevron-right')),
          );
          option.addEventListener('mousemove', () => {
            if (state.active === position) return;
            state.moved = true;
            setActive(position, { scroll: false });
          });
          option.addEventListener('click', () => run(position));
          return option;
        }),
      );
    });
    listbox.replaceChildren(...blocks);
    const query = state.query.trim();
    const waiting = query && (loading.size > 0 || state.players.loading);
    if (!state.results.length) {
      listbox.append(h('p', { class: 'palette-empty' }, waiting ? 'Wird gesucht …' : `Nichts gefunden für „${query}“.`));
    }
    const count = state.results.length;
    status.textContent = !query ? 'Bereiche und Aktionen. Tippe, um Spieler, Anfragen, Meldungen und Addons zu finden.' : waiting ? `${count === 1 ? '1 Treffer' : `${count} Treffer`}, es wird noch gesucht …` : count === 1 ? '1 Treffer' : `${count} Treffer`;
    // Nur wenn mit Pfeiltasten oder Maus gewählt wurde, bleibt die Auswahl beim Nachladen stehen
    const keep = activeKey && state.moved ? state.results.findIndex((result) => result.key === activeKey) : -1;
    setActive(keep >= 0 ? keep : 0, { scroll: false });
  }

  function run(position) {
    const result = state.results[position];
    if (!result) return;
    close();
    result.run();
  }

  function onInput() {
    state.query = input.value;
    const query = input.value.trim();
    if (query) ensureLists();
    searchPlayers(query);
    state.active = 0;
    state.moved = false;
    update();
  }

  function onKeydown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      state.moved = true;
      setActive(state.active + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      state.moved = true;
      setActive(event.key === 'PageDown' ? state.results.length - 1 : 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!event.isComposing) run(state.active);
    }
  }

  function build() {
    const titleId = 'team-suche-titel';
    input = h('input', {
      class: 'palette-input',
      id: 'team-suche-eingabe',
      type: 'text',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'team-suche-liste',
      'aria-autocomplete': 'list',
      'aria-describedby': 'team-suche-status',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      maxlength: '60',
      placeholder: 'Spieler, Anfrage, Meldung, Addon oder Bereich …',
    });
    listbox = h('div', { class: 'palette-list', id: 'team-suche-liste', role: 'listbox', 'aria-label': 'Treffer' });
    status = h('p', { class: 'palette-status', id: 'team-suche-status', role: 'status' });
    const closeButton = h('button', { type: 'button', class: 'palette-close', 'aria-label': 'Suche schließen' }, h('kbd', { text: 'Esc' }));
    closeButton.addEventListener('click', () => close());
    dialog = h(
      'dialog',
      { class: 'palette', id: 'team-suche', 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'palette-box' },
        h('h2', { class: 'visually-hidden', id: titleId, text: 'Schnellsuche im Team-Bereich' }),
        h('div', { class: 'palette-field' }, h('label', { class: 'palette-label', for: 'team-suche-eingabe' }, icon('search'), h('span', { class: 'visually-hidden', text: 'Suchen' })), input, closeButton),
        listbox,
        h('div', { class: 'palette-foot' }, status, h('span', { class: 'palette-keys', 'aria-hidden': 'true' }, h('kbd', { text: '↑' }), h('kbd', { text: '↓' }), ' wählen · ', h('kbd', { text: 'Enter' }), ' öffnen')),
      ),
    );
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    // Klick auf den Hintergrund (außerhalb der Box) schließt
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close();
    });
    dialog.addEventListener('close', () => {
      clearTimeout(state.playerTimer);
      state.playerAbort?.abort();
    });
    document.body.append(dialog);
  }

  function openPalette() {
    if (!state.enabled) return;
    if (!dialog) build();
    if (dialog.open) {
      input.focus();
      input.select();
      return;
    }
    state.query = '';
    state.players = { query: '', list: [], loading: false };
    input.value = '';
    state.active = 0;
    state.moved = false;
    update();
    dialog.showModal();
    input.focus();
  }

  function close() {
    if (dialog?.open) dialog.close();
  }

  return {
    open: openPalette,
    close,
    /** Im Team-Bereich (nach der Zwei-Faktor-Abfrage): Knopf und Strg+K an. */
    enable() {
      state.enabled = true;
      shell.setSearch({ label: 'Suchen …', onOpen: openPalette });
    },
    disable() {
      state.enabled = false;
      close();
      cache.clear();
      shell.setSearch(null);
    },
    /** Nach Änderungen (z. B. neue Anfrage beantwortet): Listen beim nächsten Tippen neu laden. */
    invalidate() {
      cache.clear();
    },
  };
}
