// HeldixClient – Webseite: gemeinsamer Rahmen („Shell“) für Konto (/konto) und Team-Bereich (/team).
//
// - Seitenleiste mit zwei Gruppen: „Mein Konto“ und – nur für Moderatoren und Admins – „Team“. Die Bereiche der
//   eigenen Seite sind Reiter (<a role="tab" id="tab-<bereich>" data-tab aria-controls="panel-<bereich>">), die der
//   anderen Seite normale Links (/team#reiter=<bereich> bzw. /konto#reiter=<bereich>). Wechseln innerhalb der Seite
//   lädt nichts neu; Zurück/Vor im Browser wechselt zwischen den Bereichen.
// - Kopfzeile: Gruppe und Titel des Bereichs, Platz für eine Suche (setSearch, Strg+K) und für Aktivität mit
//   Glocke (setActivity), dazu der eigene Spieler mit Rolle und Abmelden.
// - Zähler an jedem Eintrag (setBadge), Übersicht als Kacheln (mountOverview).
// - Adresse: #reiter=<bereich>[&weitere=werte]. Ältere Links (#<bereich>, #ziel=<bereich>) gehen weiter.
// - Bis 1100 px Breite ist die Seitenleiste eine Schublade (Knopf links in der Kopfzeile, Escape schließt).
//
// Ohne innerHTML; Texte vom Server landen nur als Text im Dokument (siehe app-common.js).
import { $$, avatar, h, icon, relativeTime, rerender, ROLE_LABELS, timeEl } from './app-common.js';

/**
 * Alle Bereiche beider Seiten. admin: nur für Admins sichtbar. description: Text der Kachel in der Übersicht.
 * Neue Bereiche hier eintragen und auf der Seite ein Panel <div class="panel" id="panel-<id>" role="tabpanel"
 * aria-labelledby="tab-<id>" hidden> anlegen.
 */
export const AREAS = {
  konto: {
    label: 'Mein Konto',
    path: '/konto',
    icon: 'user',
    sections: [
      { id: 'uebersicht', label: 'Übersicht', icon: 'home', description: 'Alles Wichtige auf einen Blick' },
      { id: 'profil', label: 'Profil & Cosmetics', icon: 'cape', description: 'Cape, Cosmetics und was andere sehen' },
      { id: 'freunde', label: 'Freunde', icon: 'friends', description: 'Freundesliste und Anfragen' },
      { id: 'nachrichten', label: 'Nachrichten', icon: 'chat', description: 'Unterhaltungen mit Freunden' },
      { id: 'support', label: 'Support', icon: 'info', description: 'Deine Anfragen an das Team' },
      { id: 'addons', label: 'Meine Addons', icon: 'addons', description: 'Addons einreichen und verwalten' },
      { id: 'privatsphaere', label: 'Privatsphäre', icon: 'eye-off', description: 'Blockierte Spieler und deine Meldungen' },
      { id: 'sicherheit', label: 'Sicherheit', icon: 'shield', description: 'Anmeldungen und Schutz deines Kontos' },
      { id: 'daten', label: 'Meine Daten', icon: 'file', description: 'Daten herunterladen oder löschen' },
    ],
  },
  team: {
    label: 'Team',
    path: '/team',
    icon: 'shield',
    sections: [
      { id: 'uebersicht', label: 'Übersicht', icon: 'home', description: 'Was gerade ansteht' },
      { id: 'meldungen', label: 'Meldungen', icon: 'flag', description: 'Gemeldete Spieler prüfen' },
      { id: 'support', label: 'Support', icon: 'info', description: 'Anfragen von Spielern beantworten' },
      { id: 'spieler', label: 'Spieler', icon: 'search', description: 'Spieler suchen und Details sehen' },
      { id: 'sperren', label: 'Sperren', icon: 'ban', description: 'Spieler sperren und freigeben' },
      { id: 'neuigkeiten', label: 'Neuigkeiten', icon: 'news', description: 'Neuigkeiten schreiben und veröffentlichen' },
      { id: 'updates', label: 'Updates', icon: 'download', description: 'Launcher-Versionen veröffentlichen', admin: true },
      { id: 'addons', label: 'Addons', icon: 'addons', description: 'Einreichungen prüfen, Addon-Meldungen' },
      { id: 'cosmetics', label: 'Cosmetics', icon: 'sparkles', description: 'Cosmetics veröffentlichen und verwalten', admin: true },
      { id: 'team', label: 'Team', icon: 'friends', description: 'Mitglieder und Rollen', admin: true },
      { id: 'protokoll', label: 'Protokoll', icon: 'clock', description: 'Jede Änderung durch das Team', admin: true },
      { id: 'profil', label: 'Mein Teamprofil', icon: 'user', description: 'Dein Profil auf der Teamseite' },
    ],
  },
};

/** Ab dieser Breite (und darunter) ist die Seitenleiste eine Schublade – passend zu app.css. */
const DRAWER_QUERY = '(max-width: 1100px)';

// Icons, die das Heldix-Icon-Set (noch) nicht hat: Pfade im selben Stil (24er-Raster, Strich 2).
const EXTRA_ICONS = {
  sidebar: ['M5.5 4.5 H18.5 A2 2 0 0 1 20.5 6.5 V17.5 A2 2 0 0 1 18.5 19.5 H5.5 A2 2 0 0 1 3.5 17.5 V6.5 A2 2 0 0 1 5.5 4.5 Z', 'M9.5 4.5 V19.5', 'M6 8.5 H7', 'M6 11.5 H7'],
  bell: ['M6.5 16.5 V11 A5.5 5.5 0 0 1 17.5 11 V16.5 L19 18.5 H5 Z', 'M10 21 A2.2 2.2 0 0 0 14 21'],
  logout: ['M14 4.5 H17.5 A2 2 0 0 1 19.5 6.5 V17.5 A2 2 0 0 1 17.5 19.5 H14', 'M10 8 L6 12 L10 16', 'M6 12 H15.5'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icon aus dem Heldix-Set oder aus EXTRA_ICONS. */
export function shellIcon(name) {
  const paths = EXTRA_ICONS[name];
  if (!paths) return icon(name);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * Bereich aus der Adresse lesen: #reiter=freunde&…, #ziel=freunde oder (alt) #freunde.
 * Ergebnis: { section: 'freunde' | null, params: URLSearchParams, extra: { weitere Werte } | null }
 * (extra: alles außer reiter/ziel/code, z. B. { anfrage: '12' } aus #reiter=support&anfrage=12).
 */
export function parseShellHash(hash = location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return { section: null, params: new URLSearchParams() };
  if (!raw.includes('=')) {
    let section = raw;
    try {
      section = decodeURIComponent(raw);
    } catch {
      // ungültige Kodierung: so lassen
    }
    return { section: /^[a-z0-9-]{1,40}$/.test(section) ? section : null, params: new URLSearchParams(), extra: null };
  }
  const params = new URLSearchParams(raw);
  const extra = Object.fromEntries([...params].filter(([key]) => !['reiter', 'ziel', 'code'].includes(key)));
  return { section: params.get('reiter') ?? params.get('ziel') ?? null, params, extra: Object.keys(extra).length ? extra : null };
}

/** Link zu einem Bereich, z. B. sectionHref('team', 'meldungen') → /team#reiter=meldungen. */
export function sectionHref(page, section, params = null) {
  const query = new URLSearchParams({ reiter: section });
  if (params) for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(key, String(value));
  return `${AREAS[page].path}#${query}`;
}

let currentShell = null;

/** Die Shell dieser Seite (für spätere Module, die sich einklinken wollen), sonst null. */
export const getShell = () => currentShell;

/**
 * Shell aufbauen. root: das Element mit class="shell" (enthält .shell-main > .shell-content mit den Panels).
 * page: 'konto' | 'team'. defaultSection: Bereich, wenn die Adresse keinen nennt. onSelect(id, { params, source }):
 * nach jedem Wechsel (auch beim ersten). onSignOut(): Knopf „Abmelden“.
 */
export function createShell({ root, page, defaultSection, onSelect, onSignOut }) {
  const area = AREAS[page];
  const otherPage = page === 'konto' ? 'team' : 'konto';
  const selectListeners = new Set(onSelect ? [onSelect] : []);
  const activityListeners = new Set();
  const badges = new Map(); // `${seite}:${bereich}` → { count, label }
  const overviews = new Set();
  const state = { current: null, hash: null, me: null, teamLocked: false, drawer: false, search: null, activity: [] };
  const drawerQuery = window.matchMedia(DRAWER_QUERY);

  // -------------------------------------------------------------------------------------------------------
  // Seitenleiste
  // -------------------------------------------------------------------------------------------------------

  const localItems = [];
  const remoteItems = [];
  const groups = {};

  function badgeEl(id) {
    return h('span', { class: 'count', id, hidden: true });
  }

  function buildGroup(groupPage) {
    const groupArea = AREAS[groupPage];
    const local = groupPage === page;
    const titleId = `gruppe-${groupPage}-titel`;
    const lock = h('span', { class: 'side-lock', hidden: true, title: 'Zwei-Faktor-Anmeldung nötig' }, shellIcon('lock'), h('span', { text: '2FA' }));
    const title = h('div', { class: 'side-group-title', id: titleId }, h('span', { text: groupArea.label }), lock);
    let list;
    if (local) {
      list = h('div', { class: 'side-list', role: 'tablist', 'aria-orientation': 'vertical', 'aria-labelledby': titleId, id: `${page}-tabs` });
      for (const section of groupArea.sections) {
        const item = h(
          'a',
          {
            class: 'side-item',
            href: `#reiter=${section.id}`,
            role: 'tab',
            id: `tab-${section.id}`,
            'aria-controls': `panel-${section.id}`,
            'aria-selected': 'false',
            tabindex: '-1',
            hidden: section.admin ? true : undefined,
            dataset: { tab: section.id },
          },
          shellIcon(section.icon),
          h('span', { class: 'side-label', text: section.label }),
          badgeEl(`count-${section.id}`),
        );
        item.section = section;
        localItems.push(item);
        list.append(item);
      }
    } else {
      list = h('ul', { class: 'side-list', 'aria-labelledby': titleId });
      for (const section of groupArea.sections) {
        const link = h(
          'a',
          { class: 'side-item', href: sectionHref(groupPage, section.id), id: `ziel-${groupPage}-${section.id}`, dataset: { ziel: section.id, seite: groupPage } },
          shellIcon(section.icon),
          h('span', { class: 'side-label', text: section.label }),
          badgeEl(`count-${groupPage}-${section.id}`),
        );
        const item = h('li', { hidden: section.admin ? true : undefined }, link);
        item.section = section;
        remoteItems.push(item);
        list.append(item);
      }
    }
    const group = h('div', { class: `side-group${local ? ' current' : ''}`, id: `gruppe-${groupPage}`, dataset: { group: groupPage } }, title, list);
    groups[groupPage] = { element: group, lock, list };
    return group;
  }

  const closeButton = h('button', { type: 'button', class: 'icon-button small side-close', 'aria-label': 'Bereiche schließen' }, icon('close'));
  const side = h(
    'nav',
    { class: 'shell-side', id: 'shell-seite', 'aria-label': 'Konto und Team' },
    h('div', { class: 'side-top' }, h('span', { class: 'side-top-title', text: 'Bereiche' }), closeButton),
    buildGroup('konto'),
    buildGroup('team'),
  );
  // Ohne Rolle gibt es die Team-Gruppe nicht (setUser blendet sie ein).
  groups.team.element.hidden = true;
  const scrim = h('div', { class: 'shell-scrim', hidden: true, 'aria-hidden': 'true' });

  // -------------------------------------------------------------------------------------------------------
  // Kopfzeile
  // -------------------------------------------------------------------------------------------------------

  const menuDot = h('span', { class: 'shell-menu-dot', hidden: true });
  const menuButton = h('button', { type: 'button', class: 'icon-button shell-menu', id: 'shell-menue', 'aria-controls': 'shell-seite', 'aria-expanded': 'false', 'aria-label': 'Bereiche öffnen' }, shellIcon('sidebar'), menuDot);
  const crumb = h('p', { class: 'shell-crumb', id: 'shell-gruppe', text: area.label });
  const title = h('h1', { class: 'shell-title', id: 'shell-titel', tabindex: '-1', text: area.label });

  const searchSlot = h('div', { class: 'shell-search', id: 'shell-suche', hidden: true });

  const bellDot = h('span', { class: 'shell-bell-dot', hidden: true });
  const bellButton = h('button', { type: 'button', class: 'icon-button shell-bell-button', id: 'shell-glocke-knopf', 'aria-expanded': 'false', 'aria-controls': 'shell-aktivitaet', 'aria-label': 'Aktivität' }, shellIcon('bell'), bellDot);
  const bellPanel = h('div', { class: 'shell-popover shell-activity', id: 'shell-aktivitaet', role: 'region', 'aria-label': 'Aktivität', hidden: true });
  const bellSlot = h('div', { class: 'shell-bell', id: 'shell-glocke', hidden: true }, bellButton, bellPanel);

  let avatarEl = h('span', { class: 'avatar avatar-sm', id: `${page}-avatar`, 'aria-hidden': 'true' });
  const nameEl = h('span', { class: 'shell-user-name', id: `${page}-name` });
  const roleEl = h('span', { class: 'chip accent shell-role', hidden: true });
  const userButton = h(
    'button',
    { type: 'button', class: 'shell-user-button', id: 'shell-nutzer-knopf', 'aria-expanded': 'false', 'aria-controls': 'shell-nutzer', 'aria-label': 'Dein Konto' },
    avatarEl,
    h('span', { class: 'shell-user-text' }, nameEl, roleEl),
    icon('chevron-down'),
  );
  const panelName = h('strong', { class: 'shell-user-panel-name' });
  const panelRole = h('span', { class: 'chip accent', hidden: true });
  const metaList = h('ul', { class: 'shell-user-meta' });
  const signOut = h('button', { type: 'button', class: 'button small ghost shell-signout', id: `${page}-abmelden` }, shellIcon('logout'), 'Abmelden');
  const userPanel = h(
    'div',
    { class: 'shell-popover shell-user-panel', id: 'shell-nutzer', role: 'region', 'aria-label': 'Dein Konto', hidden: true },
    h('div', { class: 'shell-user-panel-head' }, panelName, panelRole),
    metaList,
    signOut,
  );
  const userSlot = h('div', { class: 'shell-user' }, userButton, userPanel);

  const header = h(
    'header',
    { class: 'shell-head' },
    menuButton,
    h('div', { class: 'shell-heading' }, crumb, title),
    h('div', { class: 'shell-tools' }, searchSlot, bellSlot, userSlot),
  );

  const main = root.querySelector('.shell-main');
  root.prepend(side, scrim);
  main.prepend(header);

  // -------------------------------------------------------------------------------------------------------
  // Aufklapp-Flächen (Aktivität, eigenes Konto): eine zur Zeit, Escape und Klick daneben schließen
  // -------------------------------------------------------------------------------------------------------

  const popovers = [
    { button: bellButton, panel: bellPanel, onOpen: () => emitActivity({ type: 'open' }) },
    { button: userButton, panel: userPanel },
  ];

  function setPopover(entry, open) {
    entry.panel.hidden = !open;
    entry.button.setAttribute('aria-expanded', String(open));
    if (open && entry.onOpen) entry.onOpen();
  }

  function closePopovers(except = null) {
    for (const entry of popovers) if (entry !== except && !entry.panel.hidden) setPopover(entry, false);
  }

  for (const entry of popovers) {
    entry.button.addEventListener('click', () => {
      const open = entry.panel.hidden;
      closePopovers(entry);
      setPopover(entry, open);
    });
  }
  document.addEventListener('click', (event) => {
    for (const entry of popovers) {
      if (!entry.panel.hidden && !entry.panel.contains(event.target) && !entry.button.contains(event.target)) setPopover(entry, false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = popovers.find((entry) => !entry.panel.hidden);
    if (open) {
      setPopover(open, false);
      open.button.focus();
      return;
    }
    if (state.drawer) closeDrawer();
  });
  signOut.addEventListener('click', () => {
    if (onSignOut) onSignOut();
  });

  // -------------------------------------------------------------------------------------------------------
  // Schublade (schmale Fenster)
  // -------------------------------------------------------------------------------------------------------

  function inertTargets() {
    return [document.querySelector('body > header.nav'), document.querySelector('body > footer'), document.querySelector('body > .skip'), main].filter(Boolean);
  }

  function openDrawer() {
    if (!drawerQuery.matches || state.drawer) return;
    closePopovers();
    state.drawer = true;
    root.classList.add('drawer-open');
    scrim.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    for (const element of inertTargets()) element.inert = true;
    const target = localItems.find((item) => item.getAttribute('aria-selected') === 'true' && isShown(item)) ?? side.querySelector('a:not([hidden])');
    (target ?? closeButton).focus();
  }

  function closeDrawer({ restoreFocus = true } = {}) {
    if (!state.drawer) return;
    state.drawer = false;
    root.classList.remove('drawer-open');
    scrim.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    for (const element of inertTargets()) element.inert = false;
    if (restoreFocus) menuButton.focus();
  }

  menuButton.addEventListener('click', () => (state.drawer ? closeDrawer() : openDrawer()));
  closeButton.addEventListener('click', () => closeDrawer());
  scrim.addEventListener('click', () => closeDrawer());
  drawerQuery.addEventListener('change', () => {
    if (!drawerQuery.matches) closeDrawer({ restoreFocus: false });
  });

  // -------------------------------------------------------------------------------------------------------
  // Bereiche wählen
  // -------------------------------------------------------------------------------------------------------

  const isShown = (item) => !item.hidden && !item.closest('.side-group')?.hidden;
  const visibleLocal = () => localItems.filter(isShown);
  const findLocal = (id) => visibleLocal().find((item) => item.dataset.tab === id) ?? null;

  function writeHash(id, params, mode) {
    if (mode === 'none') return;
    const query = new URLSearchParams({ reiter: id });
    if (params) for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(key, String(value));
    const hash = `#${query}`;
    state.hash = hash;
    if (location.hash === hash) return;
    const url = `${location.pathname}${location.search}${hash}`;
    if (mode === 'push') history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  function scrollToShell() {
    const nav = document.querySelector('body > header.nav');
    const top = root.getBoundingClientRect().top + window.scrollY - (nav ? nav.offsetHeight : 0) - 12;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }

  /**
   * Bereich wählen. history: 'replace' (Standard), 'push' (neuer Eintrag für Zurück) oder 'none'.
   * silent: ohne onSelect. focus: Fokus auf den Eintrag. scroll: Seite bis zum Rahmen hochrollen.
   * Unbekannte oder ausgeblendete Bereiche führen zu defaultSection.
   */
  function select(id, { focus = false, silent = false, history: mode = 'replace', params = null, scroll = false, source = 'code' } = {}) {
    const item = findLocal(id) ?? findLocal(defaultSection) ?? visibleLocal()[0];
    if (!item) return;
    const section = item.section;
    state.current = section.id;
    for (const other of localItems) {
      const active = other === item;
      other.setAttribute('aria-selected', String(active));
      other.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    }
    crumb.textContent = area.label;
    title.textContent = section.label;
    writeHash(section.id, section.id === id ? params : null, mode);
    if (focus) item.focus();
    if (scroll) scrollToShell();
    if (!silent) for (const listener of selectListeners) listener(section.id, { params: section.id === id ? params : null, source });
  }

  const sideList = groups[page].list;
  sideList.addEventListener('click', (event) => {
    const item = event.target.closest('[role="tab"]');
    if (!item || !sideList.contains(item)) return;
    // Mit Strg/Umschalt/Mittelklick: neuer Tab mit dem Link – das macht der Browser selbst.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const fromDrawer = state.drawer;
    select(item.dataset.tab, { history: 'push', scroll: true, source: 'user' });
    if (fromDrawer) {
      closeDrawer({ restoreFocus: false });
      title.focus();
    }
  });
  sideList.addEventListener('keydown', (event) => {
    const list = visibleLocal();
    const index = list.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    let next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = list[(index + 1) % list.length];
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = list[(index - 1 + list.length) % list.length];
    else if (event.key === 'Home') next = list[0];
    else if (event.key === 'End') next = list[list.length - 1];
    else if (event.key === ' ') {
      event.preventDefault();
      event.target.click();
      return;
    }
    if (!next) return;
    event.preventDefault();
    select(next.dataset.tab, { focus: true, source: 'user' });
  });

  // Links innerhalb der Seite zu einem Bereich (Kacheln, Hinweise): <a href="#reiter=x" data-goto="x">
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-goto]');
    if (!link || !root.contains(link) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (!findLocal(link.dataset.goto)) return;
    event.preventDefault();
    select(link.dataset.goto, { history: 'push', scroll: true, source: 'user' });
    title.focus({ preventScroll: true });
  });

  // Adresse geändert (Zurück/Vor, Link mit #reiter=…, von Hand): passenden Bereich zeigen
  // (#code=… und #ziel=… wertet konto.js selbst aus: Anmeldung bzw. Ziel aus dem Launcher.)
  const onAddress = () => {
    if (root.hidden || location.hash === state.hash) return;
    const { section, params, extra } = parseShellHash();
    if (!section || params.has('code') || params.has('ziel') || !findLocal(section)) return;
    state.hash = location.hash;
    // Alte Form (#daten) gleich in die neue umschreiben, ohne neuen Eintrag im Verlauf
    select(section, { history: location.hash.includes('=') ? 'none' : 'replace', params: extra, source: 'address' });
  };
  window.addEventListener('hashchange', onAddress);
  window.addEventListener('popstate', onAddress);

  // -------------------------------------------------------------------------------------------------------
  // Zähler
  // -------------------------------------------------------------------------------------------------------

  function updateMenuDot() {
    let any = false;
    for (const [key, badge] of badges) {
      const [badgePage, id] = key.split(':');
      const item = badgePage === page ? localItems.find((entry) => entry.dataset.tab === id) : remoteItems.find((entry) => entry.section.id === id && badgePage === otherPage);
      if (badge.count > 0 && item && isShown(item)) any = true;
    }
    menuDot.hidden = !any;
  }

  /**
   * Zähler an einem Eintrag. count 0 blendet ihn aus. label: Text für Screenreader (z. B. „3 ungelesen“).
   * page: Seite des Eintrags (Standard: diese Seite; 'team' auf /konto setzt den Zähler am Team-Link).
   */
  function setBadge(id, count, { label = null, page: badgePage = page } = {}) {
    const value = Math.max(0, Number(count) || 0);
    badges.set(`${badgePage}:${id}`, { count: value, label });
    const element = document.getElementById(badgePage === page ? `count-${id}` : `count-${badgePage}-${id}`);
    if (element) {
      element.hidden = !value;
      element.textContent = value > 99 ? '99+' : String(value);
      if (label) element.setAttribute('aria-label', label);
      else element.removeAttribute('aria-label');
    }
    updateMenuDot();
    renderOverviews();
  }

  const getBadge = (id, badgePage = page) => badges.get(`${badgePage}:${id}`)?.count ?? 0;

  // -------------------------------------------------------------------------------------------------------
  // Übersicht: Kacheln für alle sichtbaren Bereiche dieser Seite
  // -------------------------------------------------------------------------------------------------------

  function renderOverviews() {
    for (const container of overviews) {
      const sections = visibleLocal()
        .map((item) => item.section)
        .filter((section) => section.id !== 'uebersicht');
      const signature = JSON.stringify(sections.map((section) => [section.id, badges.get(`${page}:${section.id}`) ?? null]));
      rerender(container, signature, () =>
        sections.map((section) => {
          const badge = badges.get(`${page}:${section.id}`);
          const count = badge?.count ?? 0;
          return h(
            'a',
            { class: `shell-tile${count ? ' has-news' : ''}`, href: `#reiter=${section.id}`, dataset: { goto: section.id, focusKey: `kachel:${section.id}` } },
            h('span', { class: 'shell-tile-icon', 'aria-hidden': 'true' }, shellIcon(section.icon)),
            h(
              'span',
              { class: 'shell-tile-body' },
              h('span', { class: 'shell-tile-title' }, section.label, count ? h('span', { class: 'count', 'aria-hidden': badge.label ? 'true' : undefined, text: count > 99 ? '99+' : String(count) }) : null),
              h('span', { class: 'shell-tile-text', text: section.description }),
              count && badge.label ? h('span', { class: 'shell-tile-news', text: badge.label }) : null,
            ),
            h('span', { class: 'shell-tile-go', 'aria-hidden': 'true' }, icon('chevron-right')),
          );
        }),
      );
    }
  }

  /** Kacheln in container zeichnen (und bei jeder Änderung an Zählern oder Rollen neu). */
  function mountOverview(container) {
    container.classList.add('shell-tiles');
    overviews.add(container);
    renderOverviews();
  }

  // -------------------------------------------------------------------------------------------------------
  // Spieler, Rolle, Team-Gruppe
  // -------------------------------------------------------------------------------------------------------

  function setTeamLocked(locked) {
    state.teamLocked = Boolean(locked);
    groups.team.lock.hidden = !state.teamLocked;
    groups.team.element.classList.toggle('locked', state.teamLocked);
  }

  /** Angemeldeten Spieler zeigen (GET /v1/web/me): Name, Kopf, Rolle; Team-Gruppe nur mit Rolle, Admin-Bereiche nur für Admins. */
  function setUser(me) {
    state.me = me;
    const name = me?.name ?? '';
    const fresh = Object.assign(avatar(name, me?.uuid, { size: 'sm' }), { id: `${page}-avatar` });
    avatarEl.replaceWith(fresh);
    avatarEl = fresh;
    nameEl.textContent = name;
    panelName.textContent = name;
    const roleLabel = me?.role ? (ROLE_LABELS[me.role] ?? me.role) : '';
    for (const element of [roleEl, panelRole]) {
      element.hidden = !roleLabel;
      element.textContent = roleLabel;
    }
    userButton.setAttribute('aria-label', roleLabel ? `Dein Konto: ${name} (${roleLabel})` : `Dein Konto: ${name}`);
    const admin = me?.role === 'admin';
    groups.team.element.hidden = !me?.role;
    for (const item of [...localItems, ...remoteItems]) if (item.section.admin) item.hidden = !admin;
    setTeamLocked(Boolean(me?.role && me.twoFactor && !me.twoFactor.verified));
    updateMenuDot();
    renderOverviews();
    // Der gewählte Bereich ist jetzt ausgeblendet (z. B. Rolle geändert): zurück zum Standard
    if (state.current && !findLocal(state.current) && visibleLocal().length) select(defaultSection);
  }

  /** Zeilen unter dem Namen im Konto-Menü (Text oder Knoten), z. B. Ablauf der Sitzung. */
  function setMeta(lines) {
    metaList.replaceChildren(...lines.filter(Boolean).map((line) => h('li', null, line)));
  }

  /** Titel der Kopfzeile ohne Bereich (z. B. „Kein Zugang“); der nächste Wechsel setzt ihn wieder. */
  function setTitle(text, crumbText = area.label) {
    title.textContent = text;
    crumb.textContent = crumbText;
  }

  // -------------------------------------------------------------------------------------------------------
  // Suche (Platz in der Kopfzeile, Strg+K)
  // -------------------------------------------------------------------------------------------------------

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /**
   * Suchknopf einblenden: setSearch({ label: 'Suchen …', onOpen }). onOpen() kommt bei Klick und bei Strg+K (Mac: ⌘K).
   * setSearch(null) blendet ihn wieder aus. Die eigentliche Suche (Dialog, Ergebnisse) baut die Seite selbst.
   */
  function setSearch(options) {
    state.search = options ?? null;
    if (!options) {
      searchSlot.hidden = true;
      searchSlot.replaceChildren();
      return;
    }
    const button = h(
      'button',
      { type: 'button', class: 'shell-search-button', id: 'shell-suche-knopf', 'aria-keyshortcuts': isMac ? 'Meta+K' : 'Control+K' },
      icon('search'),
      h('span', { class: 'shell-search-label', text: options.label || 'Suchen …' }),
      h('kbd', { class: 'shell-search-key', text: isMac ? '⌘ K' : 'Strg K' }),
    );
    button.addEventListener('click', () => state.search?.onOpen?.());
    searchSlot.replaceChildren(button);
    searchSlot.hidden = false;
  }

  document.addEventListener('keydown', (event) => {
    if (!state.search || root.hidden || event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    event.preventDefault();
    closePopovers();
    state.search.onOpen?.();
  });

  // -------------------------------------------------------------------------------------------------------
  // Aktivität (Glocke)
  // -------------------------------------------------------------------------------------------------------

  function emitActivity(event) {
    for (const listener of activityListeners) listener(event);
  }

  function activityTarget(item) {
    if (typeof item.target === 'string') return { href: item.target, local: false };
    if (item.target && item.target.section) {
      const targetPage = item.target.page ?? page;
      return { href: sectionHref(targetPage, item.target.section, item.target.params), local: targetPage === page, section: item.target.section, params: item.target.params ?? null };
    }
    return null;
  }

  function renderActivity() {
    const items = state.activity;
    const unread = items.filter((item) => item.unread).length;
    bellDot.hidden = !unread;
    bellButton.setAttribute('aria-label', unread ? `Aktivität, ${unread} neu` : 'Aktivität');
    const head = h('div', { class: 'shell-popover-head' }, h('strong', { text: 'Aktivität' }), unread ? h('span', { class: 'chip accent', text: `${unread} neu` }) : null);
    if (!items.length) {
      bellPanel.replaceChildren(head, h('p', { class: 'shell-activity-empty', text: 'Gerade gibt es nichts Neues.' }));
      return;
    }
    const list = h(
      'ul',
      { class: 'shell-activity-list' },
      items.map((item) => {
        const target = activityTarget(item);
        const body = [
          h('span', { class: 'shell-activity-icon', 'aria-hidden': 'true' }, shellIcon(item.icon || 'info')),
          h(
            'span',
            { class: 'shell-activity-body' },
            h('span', { class: 'shell-activity-title', text: item.title }),
            item.text ? h('span', { class: 'shell-activity-text', text: item.text }) : null,
            item.at ? timeEl(item.at, relativeTime(item.at)) : null,
          ),
          item.unread ? h('span', { class: 'unread-dot', role: 'img', 'aria-label': 'neu' }) : null,
        ];
        const className = `shell-activity-item${item.unread ? ' unread' : ''}`;
        if (!target) return h('li', null, h('div', { class: className }, body));
        const link = h('a', { class: className, href: target.href, dataset: { activity: item.id ?? '' } }, body);
        link.addEventListener('click', (event) => {
          emitActivity({ type: 'select', item });
          if (!target.local || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
          event.preventDefault();
          setPopover(popovers[0], false);
          select(target.section, { history: 'push', params: target.params, scroll: true, source: 'activity' });
          title.focus({ preventScroll: true });
        });
        return h('li', null, link);
      }),
    );
    bellPanel.replaceChildren(head, list);
  }

  /**
   * Einträge der Glocke setzen (blendet die Glocke ein). items: [{ id, title, text?, at? (ms), icon?, unread?,
   * target?: { page?: 'konto'|'team', section, params? } | '<href>' }], neueste zuerst. null blendet die Glocke aus.
   */
  function setActivity(items) {
    if (items === null) {
      bellSlot.hidden = true;
      state.activity = [];
      setPopover(popovers[0], false);
      return;
    }
    state.activity = Array.isArray(items) ? items : [];
    bellSlot.hidden = false;
    renderActivity();
  }

  // -------------------------------------------------------------------------------------------------------

  const shell = {
    page,
    root,
    select,
    current: () => state.current,
    has: (id) => Boolean(findLocal(id)),
    sections: () => visibleLocal().map((item) => item.section.id),
    onSelect(listener) {
      selectListeners.add(listener);
      return () => selectListeners.delete(listener);
    },
    setBadge,
    getBadge,
    setUser,
    setMeta,
    setTitle,
    setTeamLocked,
    mountOverview,
    setSearch,
    searchSlot,
    setActivity,
    onActivity(listener) {
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },
    bellSlot,
    openDrawer,
    closeDrawer,
    /** Schublade und Aufklapp-Flächen schließen (z. B. wenn die Seite den Rahmen ausblendet). */
    closeAll() {
      closePopovers();
      closeDrawer({ restoreFocus: false });
    },
  };
  // Für Prüfungen und spätere Module: alle Einträge der Seitenleiste
  shell.items = () => $$('.side-item', side);
  currentShell = shell;
  return shell;
}
