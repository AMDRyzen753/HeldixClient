// HeldixClient – Webseite: gemeinsamer Rahmen („Shell“) für Konto (/konto) und Team-Bereich (/team), Design 2026-11.
//
// - Seitenleiste (.shell__side): eigener Spieler oben, darunter die Bereiche der Seite in Gruppen („Mein Konto“,
//   „Einstellungen“ bzw. „Arbeit“, „Inhalte“, „Verwaltung“, „Ich“) und ein Link zur anderen Seite (Team-Bereich bzw.
//   zurück zum Konto). Die Bereiche sind Reiter (<a role="tab" id="tab-<bereich>" aria-controls="panel-<bereich>">);
//   Wechseln lädt nichts neu, Zurück/Vor im Browser wechselt zwischen den Bereichen.
// - Team: welche Bereiche erscheinen, entscheiden die Rechte der Rolle (WebMe.permissions, rollen.js).
// - Seitenkopf (.page-head): Gruppe und Titel, Suche (setSearch, Strg+K), Glocke (setActivity) und – auf dem Handy –
//   das eigene Konto mit Abmelden.
// - Handy (bis 900 px): Konto mit unterer Leiste (Übersicht, Freunde, Chat, Einladen, „Mehr“-Blatt), Team mit
//   waagrecht scrollbaren Bereichs-Chips über dem Inhalt.
// - Zähler an jedem Eintrag (setBadge), Kacheln (mountOverview) für Seiten, die sie noch nutzen.
// - Adresse: #reiter=<bereich>[&weitere=werte]. Ältere Links (#<bereich>, #ziel=<bereich>) gehen weiter.
//
// Ohne innerHTML; Texte vom Server landen nur als Text im Dokument (siehe app-common.js).
import { avatar, h, icon, relativeTime, rerender, timeEl } from './app-common.js';
import { allows, permissionsOf, roleIcon, roleLabel } from './rollen.js';

/**
 * Alle Bereiche beider Seiten. group: Überschrift in der Seitenleiste. perm: Rechte (eins genügt), ohne = immer.
 * tab: Bezeichnung in der unteren Leiste (Handy, Konto). description: Text der Kachel.
 * Neue Bereiche hier eintragen und auf der Seite ein Panel <div class="panel" id="panel-<id>" role="tabpanel"
 * aria-labelledby="tab-<id>" hidden> anlegen.
 */
export const AREAS = {
  konto: {
    label: 'Mein Konto',
    path: '/konto',
    icon: 'user',
    groups: { konto: 'Mein Konto', einstellungen: 'Einstellungen' },
    sections: [
      { id: 'uebersicht', label: 'Übersicht', icon: 'home', group: 'konto', tab: 'Übersicht', description: 'Alles Wichtige auf einen Blick' },
      { id: 'freunde', label: 'Freunde', icon: 'friends', group: 'konto', tab: 'Freunde', description: 'Freundesliste, Anfragen und Vorschläge' },
      { id: 'nachrichten', label: 'Nachrichten', icon: 'chat', group: 'konto', tab: 'Chat', description: 'Unterhaltungen mit Freunden' },
      { id: 'party', label: 'Party', icon: 'party', group: 'konto', description: 'Zusammen spielen mit bis zu 8 Freunden' },
      { id: 'einladen', label: 'Freunde einladen', icon: 'user-plus', group: 'konto', tab: 'Einladen', description: 'Link teilen und Belohnungen freischalten' },
      { id: 'profil', label: 'Profil & Cosmetics', icon: 'cape', group: 'konto', description: 'Status, Cape und Cosmetics' },
      { id: 'welten', label: 'Meine Welten', icon: 'world', group: 'konto', description: 'Geteilte Welten und ihre Mitglieder' },
      { id: 'addons', label: 'Meine Addons', icon: 'addons', group: 'konto', description: 'Addons einreichen und verwalten' },
      { id: 'support', label: 'Support', icon: 'help-circle', group: 'konto', description: 'Deine Anfragen an das Team' },
      { id: 'privatsphaere', label: 'Privatsphäre', icon: 'eye-off', group: 'einstellungen', description: 'Was andere sehen, Blockierte, Meldungen' },
      { id: 'benachrichtigungen', label: 'Benachrichtigungen', icon: 'bell', group: 'einstellungen', description: 'Hinweise, „Nicht stören“' },
      { id: 'sicherheit', label: 'Sicherheit & Sitzungen', icon: 'shield', group: 'einstellungen', description: 'Angemeldete Browser und Schutz deines Kontos' },
      { id: 'daten', label: 'Daten & Löschen', icon: 'file', group: 'einstellungen', description: 'Daten herunterladen oder löschen' },
    ],
  },
  team: {
    label: 'Team',
    path: '/team',
    icon: 'shield',
    groups: { start: '', arbeit: 'Arbeit', inhalte: 'Inhalte', verwaltung: 'Verwaltung', ich: 'Ich' },
    sections: [
      { id: 'uebersicht', label: 'Übersicht', icon: 'home', group: 'start', description: 'Was gerade ansteht' },
      { id: 'meldungen', label: 'Meldungen', icon: 'flag', group: 'arbeit', perm: ['moderation'], description: 'Gemeldete Spieler prüfen' },
      { id: 'support', label: 'Support', icon: 'help-circle', group: 'arbeit', perm: ['support'], description: 'Anfragen von Spielern beantworten' },
      { id: 'spieler', label: 'Spieler', icon: 'search', group: 'arbeit', perm: ['players'], description: 'Spieler suchen, Details und Zeitleiste' },
      { id: 'sperren', label: 'Sperren', icon: 'ban', group: 'arbeit', perm: ['moderation'], description: 'Spieler sperren und freigeben' },
      { id: 'neuigkeiten', label: 'Neuigkeiten', icon: 'news', group: 'inhalte', perm: ['news'], description: 'Neuigkeiten schreiben und veröffentlichen' },
      { id: 'updates', label: 'Updates', icon: 'download', group: 'inhalte', perm: ['updates'], description: 'Launcher-Versionen veröffentlichen' },
      { id: 'addons', label: 'Addons', icon: 'addons', group: 'inhalte', perm: ['addons', 'addon-reports'], description: 'Einreichungen prüfen, Addon-Meldungen' },
      { id: 'cosmetics', label: 'Cosmetics', icon: 'sparkles', group: 'inhalte', perm: ['cosmetics'], description: 'Cosmetics veröffentlichen und verwalten' },
      { id: 'team', label: 'Team & Rollen', icon: 'friends', group: 'verwaltung', perm: ['team.view'], description: 'Mitglieder, Rollen und Abzeichen' },
      { id: 'protokoll', label: 'Protokoll', icon: 'clock', group: 'verwaltung', perm: ['audit'], description: 'Jede Änderung durch das Team' },
      { id: 'profil', label: 'Mein Teamprofil', icon: 'user', group: 'ich', description: 'Dein Profil auf der Teamseite' },
    ],
  },
};

/** Bis zu dieser Breite: untere Leiste (Konto) bzw. Bereichs-Chips (Team) statt Seitenleiste – passend zu bereich.css. */
const PHONE_QUERY = '(max-width: 900px)';
/** Einträge der unteren Leiste (Konto); alles andere steht im „Mehr“-Blatt. */
const TABBAR = ['uebersicht', 'freunde', 'nachrichten', 'einladen'];

// Icons, die das Heldix-Icon-Set (noch) nicht hat: Pfade im selben Stil (24er-Raster, Strich 2).
const EXTRA_ICONS = {
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z', 'M10 20.5a2.2 2.2 0 0 0 4 0'],
  logout: ['M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14', 'M10 16.5 5.5 12 10 7.5', 'M5.5 12H15'],
  party: ['M8 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M16 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M2.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5', 'M13.8 15.2c.7-.5 1.4-.7 2.2-.7 2.5 0 4.7 1.5 5.5 4.5'],
  globe: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M3.5 12H20.5', 'M12 3.5C8.3 7.5 8.3 16.5 12 20.5', 'M12 3.5C15.7 7.5 15.7 16.5 12 20.5'],
  'help-circle': ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2-2.4 3.5', 'M12 17h.01'],
  more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
  gift: ['M5.5 9h13a1.5 1.5 0 0 1 1.5 1.5V20H4v-9.5A1.5 1.5 0 0 1 5.5 9z', 'M3.5 9h17', 'M12 9v11', 'M12 9c-1.5-3.5-5.5-4-5.5-1.5S10 9 12 9z', 'M12 9c1.5-3.5 5.5-4 5.5-1.5S14 9 12 9z'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  crown: ['M4 18h16', 'M4.5 15 3.5 7l5 4 3.5-6 3.5 6 5-4-1 8z'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  join: ['M14 4H18A2 2 0 0 1 20 6V18A2 2 0 0 1 18 20H14', 'M10 16L14 12L10 8M14 12H4'],
  star: ['M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z'],
  reply: ['M10 8 5 12.5l5 4.5', 'M5.5 12.5H14a5 5 0 0 1 5 5V19'],
  smile: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z', 'M8.5 14.5a4.2 4.2 0 0 0 7 0', 'M9 9.8h.01', 'M15 9.8h.01'],
  moon: ['M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z'],
  pencil: ['M4.5 19.5 5.5 15 15.5 5a2.1 2.1 0 0 1 3.5 3.5L9 18.5z', 'M13.5 7 17 10.5'],
  ticket: ['M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5V14a2 2 0 0 0 0-4z', 'M14 6v12'],
  upload: ['M12 15V4', 'M7 9l5-5 5 5', 'M5 20h14'],
  server: ['M6 4h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M6 13h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2z', 'M7.5 7.5h.01', 'M7.5 16.5h.01'],
  headset: ['M4 15.5V12a8 8 0 0 1 16 0v3.5', 'M5.5 14H8v7H5.5A2 2 0 0 1 3.5 19v-3a2 2 0 0 1 2-2z', 'M16 14h2.5a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H16z'],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icon aus dem Heldix-Set, sonst aus EXTRA_ICONS. */
export function shellIcon(name) {
  const fromSet = icon(name);
  if (fromSet.nodeType === Node.ELEMENT_NODE) return fromSet;
  const paths = EXTRA_ICONS[name];
  if (!paths) return fromSet;
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

/** Die Shell dieser Seite (für Module, die sich einklinken wollen), sonst null. */
export const getShell = () => currentShell;

const countText = (value) => (value > 99 ? '99+' : String(value));

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
  const state = { current: null, hash: null, me: null, teamLocked: false, search: null, activity: [], permissions: [] };
  const phoneQuery = window.matchMedia(PHONE_QUERY);

  // -------------------------------------------------------------------------------------------------------
  // Seitenleiste
  // -------------------------------------------------------------------------------------------------------

  const localItems = [];
  const groupHeads = [];

  let sideAvatar = h('span', { class: 'avatar avatar--lg', id: `${page}-avatar`, 'aria-hidden': 'true' });
  const sideName = h('span', { class: 'person__name', id: `${page}-name` });
  const sideMeta = h('span', { class: 'person__meta', id: 'shell-status' });
  const sideMe = h('div', { class: 'side-me' }, sideAvatar, h('span', { class: 'person__text' }, sideName, sideMeta));

  const tablist = h('div', { class: 'side-list', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': area.label, id: `${page}-tabs` });
  let lastGroup = null;
  for (const section of area.sections) {
    if (section.group !== lastGroup) {
      lastGroup = section.group;
      const title = area.groups[section.group];
      if (title) {
        const head = h('p', { class: 'side-nav__group', 'aria-hidden': 'true', text: title, dataset: { group: section.group } });
        groupHeads.push(head);
        tablist.append(head);
      }
    }
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
        hidden: section.perm ? true : undefined,
        dataset: { tab: section.id },
      },
      shellIcon(section.icon),
      h('span', { class: 'side-label', text: section.label }),
      h('span', { class: 'count', id: `count-${section.id}`, hidden: true }),
    );
    item.section = section;
    localItems.push(item);
    tablist.append(item);
  }
  const localGroup = h('div', { class: 'side-group current', id: `gruppe-${page}`, dataset: { group: page } }, tablist);

  // Link zur anderen Seite: Konto → Team-Bereich (nur mit Rolle), Team → zurück zum Konto
  const lock = h('span', { class: 'side-lock', hidden: true, title: 'Zwei-Faktor-Anmeldung nötig' }, shellIcon('lock'), h('span', { text: '2FA' }));
  const otherIcon = h('span', { class: 'side-other-icon' }, page === 'konto' ? roleIcon('admin') : shellIcon('arrow'));
  const otherCount = h('span', { class: 'count', id: `count-${otherPage}`, hidden: true });
  const otherLink = h(
    'a',
    { class: 'side-item side-item--other', href: sectionHref(otherPage, 'uebersicht'), id: `ziel-${otherPage}-uebersicht`, dataset: { ziel: 'uebersicht', seite: otherPage } },
    otherIcon,
    h('span', { class: 'side-label', text: page === 'konto' ? 'Team-Bereich' : 'Zurück zum Konto' }),
    lock,
    otherCount,
  );
  const otherGroup = h(
    'div',
    { class: 'side-group', id: `gruppe-${otherPage}`, dataset: { group: otherPage } },
    h('p', { class: 'side-nav__group', id: `gruppe-${otherPage}-titel`, text: page === 'konto' ? 'Team' : 'Konto' }),
    h('ul', { class: 'side-list', 'aria-labelledby': `gruppe-${otherPage}-titel` }, h('li', null, otherLink)),
  );
  // Ohne Rolle gibt es keinen Team-Bereich (setUser blendet ihn ein).
  if (page === 'konto') otherGroup.hidden = true;

  const sideLogout = h('button', { type: 'button', class: 'btn btn--ghost btn--sm side-logout', id: `${page}-abmelden` }, shellIcon('logout'), 'Abmelden');
  const side = h(
    'aside',
    { class: 'shell__side', id: 'shell-seite', 'aria-label': page === 'konto' ? 'Mein Konto' : 'Team-Bereich' },
    sideMe,
    h('nav', { class: 'side-nav', 'aria-label': page === 'konto' ? 'Bereiche im Konto' : 'Bereiche im Team' }, localGroup, otherGroup),
    sideLogout,
  );

  // -------------------------------------------------------------------------------------------------------
  // Seitenkopf
  // -------------------------------------------------------------------------------------------------------

  const crumb = h('span', { class: 'eyebrow', id: 'shell-gruppe', text: area.label });
  const title = h('h1', { class: 'h2 shell-title', id: 'shell-titel', tabindex: '-1', text: area.label });

  const searchSlot = h('div', { class: 'shell-search', id: 'shell-suche', hidden: true });

  const bellDot = h('span', { class: 'bell__dot shell-bell-dot', hidden: true });
  const bellButton = h('button', { type: 'button', class: 'btn btn--secondary btn--icon bell', id: 'shell-glocke-knopf', 'aria-expanded': 'false', 'aria-controls': 'shell-aktivitaet', 'aria-label': 'Aktivität' }, shellIcon('bell'), bellDot);
  const bellPanel = h('div', { class: 'shell-popover shell-activity', id: 'shell-aktivitaet', role: 'region', 'aria-label': 'Aktivität', hidden: true });
  const bellSlot = h('div', { class: 'shell-bell', id: 'shell-glocke', hidden: true }, bellButton, bellPanel);

  let userAvatar = h('span', { class: 'avatar avatar--sm', 'aria-hidden': 'true' });
  const userButton = h('button', { type: 'button', class: 'btn btn--secondary btn--icon shell-user-button', id: 'shell-nutzer-knopf', 'aria-expanded': 'false', 'aria-controls': 'shell-nutzer', 'aria-label': 'Dein Konto' }, userAvatar);
  const panelName = h('strong', { class: 'shell-user-panel-name' });
  const panelRole = h('span', { class: 'chip chip--accent shell-role', hidden: true });
  const metaList = h('ul', { class: 'shell-user-meta' });
  const panelSignOut = h('button', { type: 'button', class: 'btn btn--secondary btn--sm shell-signout', id: 'shell-abmelden' }, shellIcon('logout'), 'Abmelden');
  const userPanel = h(
    'div',
    { class: 'shell-popover shell-user-panel', id: 'shell-nutzer', role: 'region', 'aria-label': 'Dein Konto', hidden: true },
    h('div', { class: 'shell-user-panel-head' }, panelName, panelRole),
    metaList,
    panelSignOut,
  );
  const userSlot = h('div', { class: 'shell-user' }, userButton, userPanel);

  const header = h('header', { class: 'page-head' }, h('div', { class: 'page-head__title' }, crumb, title), h('div', { class: 'page-head__tools' }, searchSlot, bellSlot, userSlot));

  // Team auf dem Handy: Bereiche als waagrecht scrollbare Chips
  const chips = page === 'team' ? h('nav', { class: 'mobile-sections', 'aria-label': 'Bereiche im Team', id: 'shell-chips' }) : null;

  // Konto auf dem Handy: untere Leiste mit „Mehr“-Blatt
  let tabbar = null;
  let sheet = null;
  let more = null;
  if (page === 'konto') {
    sheet = h('div', { class: 'tabbar__sheet', id: 'shell-mehr-blatt' });
    more = h('details', { class: 'tabbar__more', id: 'shell-mehr' }, h('summary', { 'aria-label': 'Mehr Bereiche' }, shellIcon('more'), h('span', { text: 'Mehr' }), h('span', { class: 'count', dataset: { countFor: '__mehr' }, hidden: true })), sheet);
    tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Konto', id: 'shell-leiste' });
  }

  const main = root.querySelector('.shell-main');
  main.classList.add('shell__main');
  root.prepend(side);
  main.prepend(...[header, chips].filter(Boolean));
  if (tabbar) root.append(tabbar);

  // -------------------------------------------------------------------------------------------------------
  // Aufklapp-Flächen (Aktivität, eigenes Konto, „Mehr“): eine zur Zeit, Escape und Klick daneben schließen
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
    if (more && more.open && except !== 'more') more.open = false;
  }

  for (const entry of popovers) {
    entry.button.addEventListener('click', () => {
      const open = entry.panel.hidden;
      closePopovers(entry);
      setPopover(entry, open);
    });
  }
  more?.addEventListener('toggle', () => {
    if (more.open) closePopovers('more');
  });
  document.addEventListener('click', (event) => {
    for (const entry of popovers) {
      if (!entry.panel.hidden && !entry.panel.contains(event.target) && !entry.button.contains(event.target)) setPopover(entry, false);
    }
    if (more?.open && !more.contains(event.target)) more.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = popovers.find((entry) => !entry.panel.hidden);
    if (open) {
      setPopover(open, false);
      open.button.focus();
      return;
    }
    if (more?.open) {
      more.open = false;
      more.querySelector('summary').focus();
    }
  });
  for (const button of [sideLogout, panelSignOut]) {
    button.addEventListener('click', () => {
      closePopovers();
      if (onSignOut) onSignOut(button);
    });
  }

  // -------------------------------------------------------------------------------------------------------
  // Bereiche wählen
  // -------------------------------------------------------------------------------------------------------

  const isShown = (item) => !item.hidden && !item.closest('.side-group')?.hidden;
  const visibleLocal = () => localItems.filter(isShown);
  const findLocal = (id) => visibleLocal().find((item) => item.dataset.tab === id) ?? null;
  const groupLabel = (section) => area.groups[section.group] || area.label;

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
    const header = document.querySelector('[data-header], body > header');
    const top = root.getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 0) - 12;
    if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }

  /** Mobile Navigation (untere Leiste, Chips): aktueller Bereich markiert. */
  function markMobile() {
    for (const link of root.querySelectorAll('.tabbar a[data-goto], .tabbar__sheet a[data-goto], .mobile-sections a[data-goto]')) {
      if (link.dataset.goto === state.current) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    if (more) more.classList.toggle('is-current', Boolean(sheet.querySelector('a[aria-current="page"]')));
    const chip = chips?.querySelector('a[aria-current="page"]');
    if (chip && phoneQuery.matches) chip.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
      if (active) other.setAttribute('aria-current', 'page');
      else other.removeAttribute('aria-current');
      other.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(other.getAttribute('aria-controls'));
      if (panel) panel.hidden = !active;
    }
    crumb.textContent = groupLabel(section);
    title.textContent = section.label;
    closePopovers();
    markMobile();
    writeHash(section.id, section.id === id ? params : null, mode);
    if (focus) item.focus();
    if (scroll) scrollToShell();
    if (!silent) for (const listener of selectListeners) listener(section.id, { params: section.id === id ? params : null, source });
  }

  tablist.addEventListener('click', (event) => {
    const item = event.target.closest('[role="tab"]');
    if (!item || !tablist.contains(item)) return;
    // Mit Strg/Umschalt/Mittelklick: neuer Tab mit dem Link – das macht der Browser selbst.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    select(item.dataset.tab, { history: 'push', scroll: true, source: 'user' });
  });
  tablist.addEventListener('keydown', (event) => {
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

  // Links innerhalb der Seite zu einem Bereich (Karten, Hinweise, untere Leiste): <a href="#reiter=x" data-goto="x">
  root.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-goto]');
    if (!link || !root.contains(link) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (!findLocal(link.dataset.goto)) return;
    event.preventDefault();
    let params = null;
    if (link.dataset.params) {
      try {
        params = JSON.parse(link.dataset.params);
      } catch {
        params = null;
      }
    }
    select(link.dataset.goto, { history: 'push', scroll: true, source: 'user', params });
    title.focus({ preventScroll: true });
  });

  // Adresse geändert (Zurück/Vor, Link mit #reiter=…, von Hand): passenden Bereich zeigen
  // (#code=… und #ziel=… wertet die Seite selbst aus: Anmeldung bzw. Ziel aus dem Launcher.)
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
  // Mobile Navigation aufbauen (nach jeder Änderung an Rechten)
  // -------------------------------------------------------------------------------------------------------

  function mobileLink(section, { withIcon = true, cls = '' } = {}) {
    return h(
      'a',
      { href: `#reiter=${section.id}`, class: cls || undefined, dataset: { goto: section.id } },
      withIcon ? shellIcon(section.icon) : null,
      h('span', { text: section.tab && cls === 'tabbar__item' ? section.tab : section.label }),
      h('span', { class: 'count', dataset: { countFor: section.id }, hidden: true }),
    );
  }

  function buildMobile() {
    const sections = visibleLocal().map((item) => item.section);
    if (chips) chips.replaceChildren(...sections.map((section) => mobileLink(section, { withIcon: false })));
    if (tabbar) {
      const main = sections.filter((section) => TABBAR.includes(section.id));
      const rest = sections.filter((section) => !TABBAR.includes(section.id));
      const team = !otherGroup.hidden
        ? h('a', { href: otherLink.getAttribute('href'), id: 'shell-mehr-team' }, page === 'konto' ? roleIcon(state.me?.role || 'admin') : shellIcon('arrow'), h('span', { text: page === 'konto' ? 'Team-Bereich' : 'Zurück zum Konto' }))
        : null;
      const logout = h('button', { type: 'button', class: 'tabbar__logout', id: 'shell-mehr-abmelden' }, shellIcon('logout'), h('span', { text: 'Abmelden' }));
      logout.addEventListener('click', () => {
        closePopovers();
        if (onSignOut) onSignOut(logout);
      });
      sheet.replaceChildren(...rest.map((section) => mobileLink(section)), team, logout);
      tabbar.replaceChildren(...main.map((section) => mobileLink(section, { cls: 'tabbar__item' })), more);
    }
    markMobile();
    paintCounts();
  }

  // -------------------------------------------------------------------------------------------------------
  // Zähler
  // -------------------------------------------------------------------------------------------------------

  function paintCounts() {
    // Mobile Kopien und das „Mehr“-Blatt
    let moreSum = 0;
    for (const element of root.querySelectorAll('[data-count-for]')) {
      const id = element.dataset.countFor;
      if (id === '__mehr') continue;
      const badge = badges.get(`${page}:${id}`);
      const value = badge?.count ?? 0;
      element.hidden = !value;
      element.textContent = countText(value);
      if (badge?.label) element.setAttribute('aria-label', badge.label);
      if (value && element.closest('.tabbar__sheet')) moreSum += value;
    }
    const moreCount = root.querySelector('[data-count-for="__mehr"]');
    if (moreCount) {
      moreCount.hidden = !moreSum;
      moreCount.textContent = countText(moreSum);
    }
    // Link zur anderen Seite: Summe ihrer Zähler
    let otherSum = 0;
    for (const [key, badge] of badges) if (key.startsWith(`${otherPage}:`)) otherSum += badge.count;
    otherCount.hidden = !otherSum;
    otherCount.textContent = countText(otherSum);
  }

  /**
   * Zähler an einem Eintrag. count 0 blendet ihn aus. label: Text für Screenreader (z. B. „3 ungelesen“).
   * page: Seite des Eintrags (Standard: diese Seite; 'team' auf /konto zählt am Link zum Team-Bereich mit).
   */
  function setBadge(id, count, { label = null, page: badgePage = page } = {}) {
    const value = Math.max(0, Number(count) || 0);
    badges.set(`${badgePage}:${id}`, { count: value, label });
    if (badgePage === page) {
      const element = document.getElementById(`count-${id}`);
      if (element) {
        element.hidden = !value;
        element.textContent = countText(value);
        if (label) element.setAttribute('aria-label', label);
        else element.removeAttribute('aria-label');
      }
    }
    paintCounts();
    renderOverviews();
  }

  const getBadge = (id, badgePage = page) => badges.get(`${badgePage}:${id}`)?.count ?? 0;

  // -------------------------------------------------------------------------------------------------------
  // Kacheln (für alle sichtbaren Bereiche dieser Seite)
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
            h('span', { class: 'icon-tile shell-tile-icon', 'aria-hidden': 'true' }, shellIcon(section.icon)),
            h(
              'span',
              { class: 'shell-tile-body' },
              h('span', { class: 'shell-tile-title' }, section.label, count ? h('span', { class: 'count', 'aria-hidden': badge.label ? 'true' : undefined, text: countText(count) }) : null),
              h('span', { class: 'shell-tile-text', text: section.description }),
              count && badge.label ? h('span', { class: 'shell-tile-news', text: badge.label }) : null,
            ),
            h('span', { class: 'shell-tile-go', 'aria-hidden': 'true' }, icon('chevron-right')),
          );
        }),
      );
    }
  }

  /** Kacheln in container zeichnen (und bei jeder Änderung an Zählern oder Rechten neu). */
  function mountOverview(container) {
    container.classList.add('shell-tiles');
    overviews.add(container);
    renderOverviews();
  }

  // -------------------------------------------------------------------------------------------------------
  // Spieler, Rolle, Rechte
  // -------------------------------------------------------------------------------------------------------

  function setTeamLocked(locked) {
    state.teamLocked = Boolean(locked);
    lock.hidden = !(page === 'konto' && state.teamLocked);
    otherGroup.classList.toggle('locked', state.teamLocked);
    if (page === 'team') localGroup.classList.toggle('locked', state.teamLocked);
    teamLockMark.hidden = !(page === 'team' && state.teamLocked);
  }
  // Auf /team: Schloss neben „Team“ (2FA-Abfrage), damit klar ist, warum die Bereiche fehlen
  const teamLockMark = h('span', { class: 'side-lock', hidden: true, title: 'Zwei-Faktor-Anmeldung nötig' }, shellIcon('lock'), h('span', { text: '2FA' }));
  if (page === 'team') localGroup.prepend(h('p', { class: 'side-nav__group side-nav__group--lock' }, teamLockMark));

  /** Zeile unter dem Namen in der Seitenleiste: Rolle (Team) bzw. Status (Konto). tone: '' | 'online' | 'dnd'. */
  function setStatus(content, tone = '') {
    sideMeta.className = `person__meta${tone ? ` person__meta--${tone}` : ''}`;
    sideMeta.replaceChildren(...[content].flat().filter((part) => part !== null && part !== undefined && part !== ''));
  }

  /** Angemeldeten Spieler zeigen (GET /v1/web/me): Name, Kopf, Rolle; Team nur mit Rolle, Bereiche nach Rechten. */
  function setUser(me) {
    state.me = me;
    state.permissions = permissionsOf(me);
    const name = me?.name ?? '';
    const fresh = Object.assign(avatar(name, me?.uuid, { size: 'lg' }), { id: `${page}-avatar` });
    sideAvatar.replaceWith(fresh);
    sideAvatar = fresh;
    const small = avatar(name, me?.uuid, { size: 'sm' });
    userAvatar.replaceWith(small);
    userAvatar = small;
    sideName.textContent = name;
    panelName.textContent = name;
    const label = me?.role ? roleLabel(me.role) : '';
    panelRole.hidden = !label;
    panelRole.textContent = label;
    userButton.setAttribute('aria-label', label ? `Dein Konto: ${name} (${label})` : `Dein Konto: ${name}`);
    if (page === 'team' || !sideMeta.childNodes.length) {
      if (label) setStatus([roleIcon(me.role), label], 'role');
      else setStatus('Angemeldet');
    }
    otherGroup.hidden = page === 'konto' && !me?.role;
    if (page === 'konto' && me?.role) otherIcon.replaceChildren(roleIcon(me.role));
    for (const item of localItems) if (item.section.perm) item.hidden = !(me?.role && allows(state.permissions, item.section.perm));
    // Gruppen-Überschriften ohne sichtbare Einträge ausblenden
    for (const head of groupHeads) head.hidden = !localItems.some((item) => item.section.group === head.dataset.group && !item.hidden);
    setTeamLocked(Boolean(me?.role && me.twoFactor && !me.twoFactor.verified));
    buildMobile();
    renderOverviews();
    // Der gewählte Bereich ist jetzt ausgeblendet (z. B. Rolle geändert): zurück zum Standard
    if (state.current && !findLocal(state.current) && visibleLocal().length) select(defaultSection);
  }

  /** Zeilen unter dem Namen im Konto-Menü (Text oder Knoten), z. B. Ablauf der Sitzung. */
  function setMeta(lines) {
    metaList.replaceChildren(...lines.filter(Boolean).map((line) => h('li', null, line)));
  }

  /** Titel des Seitenkopfs ohne Bereich (z. B. „Kein Zugang“); der nächste Wechsel setzt ihn wieder. */
  function setTitle(text, crumbText = area.label) {
    title.textContent = text;
    crumb.textContent = crumbText;
  }

  // -------------------------------------------------------------------------------------------------------
  // Suche (Seitenkopf, Strg+K)
  // -------------------------------------------------------------------------------------------------------

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  /**
   * Suchfeld einblenden: setSearch({ label: 'Suchen …', onOpen }). onOpen() kommt bei Klick und bei Strg+K (Mac: ⌘K).
   * setSearch(null) blendet es wieder aus. Die eigentliche Suche (Dialog, Ergebnisse) baut die Seite selbst.
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
      { type: 'button', class: 'search shell-search-button', id: 'shell-suche-knopf', 'aria-keyshortcuts': isMac ? 'Meta+K' : 'Control+K', 'aria-label': `${options.label || 'Suchen'} (${isMac ? '⌘ K' : 'Strg K'})` },
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
    const head = h('div', { class: 'shell-popover-head' }, h('strong', { text: 'Aktivität' }), unread ? h('span', { class: 'chip chip--accent', text: `${unread} neu` }) : null);
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

  phoneQuery.addEventListener('change', () => {
    closePopovers();
    markMobile();
  });
  buildMobile();

  // -------------------------------------------------------------------------------------------------------

  const shell = {
    page,
    root,
    select,
    current: () => state.current,
    has: (id) => Boolean(findLocal(id)),
    sections: () => visibleLocal().map((item) => item.section.id),
    permissions: () => [...state.permissions],
    can: (needed) => allows(state.permissions, needed),
    onSelect(listener) {
      selectListeners.add(listener);
      return () => selectListeners.delete(listener);
    },
    setBadge,
    getBadge,
    setUser,
    setStatus,
    setMeta,
    setTitle,
    setTeamLocked,
    mountOverview,
    setSearch,
    setActivity,
    onActivity(listener) {
      activityListeners.add(listener);
      return () => activityListeners.delete(listener);
    },
    /** Alle Aufklapp-Flächen schließen (z. B. beim Wechsel in eine Sperre). */
    closeAll() {
      closePopovers();
    },
    isPhone: () => phoneQuery.matches,
    searchSlot,
    bellSlot,
    /** Für Prüfungen und spätere Module: alle Einträge der Seitenleiste. */
    items: () => [...side.querySelectorAll('.side-item')],
  };
  currentShell = shell;
  return shell;
}
