// HeldixClient – Webseite: Konto → „Übersicht“ und die Glocke (Aktivität) in der Kopfzeile.
//
// - Übersicht: Gruß, Schnellaktionen, Kacheln mit dem Stand jedes Bereichs (ungelesene Nachrichten, offene Anfragen,
//   Support-Anfragen, die auf dich warten, eigene Addons, Cape und Cosmetics, Sicherheit), letzte Aktivität und alle
//   Bereiche als kurze Liste.
// - Aktivität: neue Nachrichten, Freundschaftsanfragen, Antworten des Teams und Entscheidungen zu eigenen Addons.
//   Was du gesehen hast (Glocke geöffnet, Eintrag gewählt, Bereich besucht, „Alles gelesen“), merkt sich dieser Browser
//   in localStorage – je Spieler. Ohne localStorage (privates Fenster, gesperrt) gilt das nur bis zum Neuladen.
//
// Keine eigenen Anfragen: konto.js reicht nach jedem Nachfragen den aktuellen Stand herein (update(stand)).
// Texte vom Server landen nur als Text im Dokument.
import { avatar, capeName, CAPES, emptyState, formatDate, h, icon, relativeTime, rerender, timeEl } from './app-common.js';
import { sectionHref } from './app-shell.js';

const DAY = 24 * 60 * 60 * 1000;
const SEEN_PREFIX = 'heldix.konto.gesehen.';
const MAX_SEEN = 400;
const MAX_ITEMS = 12;
const OVERVIEW_ITEMS = 6;
/** Wie lange schon gelesene Einträge in der Aktivität bleiben. */
const KEEP_MESSAGES = 3 * DAY;
const KEEP_DECISIONS = 14 * DAY;
const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** „A“, „A und B“, „A, B und 2 weitere“ */
function nameList(names) {
  const list = [...new Set(names.filter(Boolean))];
  if (list.length <= 1) return list[0] ?? '';
  if (list.length === 2) return `${list[0]} und ${list[1]}`;
  return `${list[0]}, ${list[1]} und ${plural(list.length - 2, 'weitere', 'weitere')}`;
}

function clip(text, max = 90) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return [...value].length > max ? `${[...value].slice(0, max - 1).join('')}…` : value;
}

// ---------------------------------------------------------------------------------------------------------
// Gesehen-Merker (localStorage je Spieler, sonst nur im Speicher)
// ---------------------------------------------------------------------------------------------------------

function createSeenStore() {
  let key = null;
  let list = [];
  let set = new Set();

  function read(storageKey) {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string' && entry.length <= 120).slice(-MAX_SEEN) : [];
    } catch {
      return [];
    }
  }

  function write() {
    if (!key) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(list));
    } catch {
      // Kein localStorage (privates Fenster, voll, gesperrt): dann nur bis zum Neuladen.
    }
  }

  return {
    viewer(uuid) {
      const next = uuid ? `${SEEN_PREFIX}${uuid}` : null;
      if (next === key) return;
      key = next;
      list = next ? read(next) : [];
      set = new Set(list);
    },
    has: (id) => set.has(id),
    add(ids) {
      let changed = false;
      for (const id of ids) {
        if (!id || set.has(id)) continue;
        set.add(id);
        list.push(id);
        changed = true;
      }
      if (!changed) return false;
      if (list.length > MAX_SEEN) {
        list = list.slice(-MAX_SEEN);
        set = new Set(list);
      }
      write();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Aktivität aus dem Stand bauen
// ---------------------------------------------------------------------------------------------------------

/**
 * Einträge (neueste zuerst). fresh: etwas Neues, das du (laut Dienst) noch nicht angesehen hast; ob es „neu“ in
 * der Glocke ist, entscheidet zusätzlich der Gesehen-Merker.
 */
function buildItems(stand) {
  const items = [];
  const now = Date.now();
  const me = stand.me?.uuid;
  for (const conversation of stand.conversations ?? []) {
    const last = conversation.last;
    if (!last || last.from === me) continue;
    const unread = Number(conversation.unread) || 0;
    if (!unread && now - (last.at ?? 0) > KEEP_MESSAGES) continue;
    items.push({
      id: `nachricht:${conversation.uuid}:${last.id}`,
      kind: 'nachricht',
      section: 'nachrichten',
      title: unread > 1 ? `${unread} neue Nachrichten von ${conversation.name}` : unread ? `Neue Nachricht von ${conversation.name}` : `Nachricht von ${conversation.name}`,
      text: clip(last.text),
      at: last.at,
      icon: 'chat',
      fresh: unread > 0,
      target: { section: 'nachrichten', params: { mit: conversation.uuid } },
      player: { name: conversation.name, uuid: conversation.uuid },
    });
  }
  for (const request of stand.friends?.incoming ?? []) {
    items.push({
      id: `anfrage:${request.uuid}:${request.at}`,
      kind: 'anfrage',
      section: 'freunde',
      title: 'Freundschaftsanfrage',
      text: `${request.name} möchte mit dir befreundet sein`,
      at: request.at,
      icon: 'user-plus',
      fresh: true,
      target: { section: 'freunde' },
      player: { name: request.name, uuid: request.uuid },
    });
  }
  for (const ticket of stand.tickets ?? []) {
    const at = ticket.updatedAt ?? ticket.at;
    if (ticket.unread) {
      items.push({ id: `support:${ticket.id}:${at}`, kind: 'support', section: 'support', title: 'Antwort vom Team', text: clip(ticket.subject), at, icon: 'info', fresh: true, target: { section: 'support', params: { anfrage: ticket.id } } });
    } else if (ticket.status === 'answered' && now - (at ?? 0) <= KEEP_DECISIONS) {
      items.push({ id: `support:${ticket.id}:${at}`, kind: 'support', section: 'support', title: 'Anfrage beantwortet', text: clip(ticket.subject), at, icon: 'info', fresh: false, target: { section: 'support', params: { anfrage: ticket.id } } });
    }
  }
  for (const sub of stand.submissions ?? []) {
    if (sub.status !== 'approved' && sub.status !== 'rejected') continue;
    const at = sub.reviewedAt ?? sub.submittedAt ?? sub.createdAt;
    if (!at || now - at > KEEP_DECISIONS) continue;
    const label = `„${sub.name || sub.addonId || 'Addon'}“${sub.version ? ` ${sub.version}` : ''}`;
    items.push(
      sub.status === 'approved'
        ? { id: `addon:${sub.id}:approved:${at}`, kind: 'addon', section: 'addons', title: 'Addon freigegeben', text: `${label} steht jetzt im Addon-Store`, at, icon: 'check', fresh: true, target: { section: 'addons' } }
        : { id: `addon:${sub.id}:rejected:${at}`, kind: 'addon', section: 'addons', title: 'Addon abgelehnt', text: `${label} – die Begründung des Teams steht unter Meine Addons`, at, icon: 'warning', fresh: true, target: { section: 'addons' } },
    );
  }
  items.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return items.slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------------------------------------------------

/**
 * shell: Rahmen der Seite. actions: { [aktion]: () => void } für die Schnellaktionen (freund, nachricht, cosmetics,
 * support, addon). onBadges(): nach jeder Änderung am Gesehen-Stand (für den Zähler an „Meine Addons“).
 */
export function initOverview({ shell, actions = {} }) {
  const seen = createSeenStore();
  let stand = {};
  let items = [];
  let bellSignature = null;
  let scheduled = false;

  const $ = (id) => document.getElementById(id);
  const isUnread = (item) => item.fresh && !seen.has(item.id);

  // --- Glocke -------------------------------------------------------------------------------------------

  function pushActivity({ force = false } = {}) {
    const list = items.map((item) => ({ id: item.id, title: item.title, text: item.text, at: item.at, icon: item.icon, unread: isUnread(item), target: item.target }));
    const signature = JSON.stringify(list);
    if (!force && signature === bellSignature) return;
    bellSignature = signature;
    shell.setActivity(list);
  }

  const bellPanel = $('shell-aktivitaet');
  let bellOpen = false;
  shell.onActivity((event) => {
    if (event.type === 'open') {
      bellOpen = true;
      // Geöffnet = gesehen. Die Markierungen bleiben stehen, bis die Liste wieder zu ist.
      if (seen.add(items.map((item) => item.id))) scheduleBadges();
    } else if (event.type === 'select' && event.item?.id) {
      if (seen.add([event.item.id])) scheduleBadges();
    }
  });
  // Liste geschlossen (Klick daneben, Escape, Eintrag gewählt): jetzt ohne „neu“ zeichnen.
  if (bellPanel) {
    new MutationObserver(() => {
      if (bellPanel.hidden && bellOpen) {
        bellOpen = false;
        render();
      }
    }).observe(bellPanel, { attributes: true, attributeFilter: ['hidden'] });
  }

  // --- Zähler ---------------------------------------------------------------------------------------------

  function scheduleBadges() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      refreshViews();
    });
  }

  function updateBadges() {
    const decisions = items.filter((item) => item.kind === 'addon' && isUnread(item)).length;
    shell.setBadge('addons', decisions, { label: decisions === 1 ? '1 neue Entscheidung des Teams' : `${decisions} neue Entscheidungen des Teams` });
    const me = stand.me;
    const missing2fa = Boolean(me?.role && me.twoFactor && !me.twoFactor.enabled);
    shell.setBadge('sicherheit', missing2fa ? 1 : 0, { label: 'Zwei-Faktor-Anmeldung fehlt' });
  }

  // --- Übersicht ------------------------------------------------------------------------------------------

  function greeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 'Guten Morgen';
    if (hour >= 11 && hour < 18) return 'Guten Tag';
    if (hour >= 18 && hour < 23) return 'Guten Abend';
    return 'Noch wach?';
  }

  function summaryLine(counts) {
    const parts = [];
    if (counts.unread) parts.push(plural(counts.unread, 'ungelesene Nachricht', 'ungelesene Nachrichten'));
    if (counts.requests) parts.push(plural(counts.requests, 'Freundschaftsanfrage', 'Freundschaftsanfragen'));
    if (counts.support) parts.push(plural(counts.support, 'neue Antwort vom Team', 'neue Antworten vom Team'));
    if (counts.decisions) parts.push(plural(counts.decisions, 'Entscheidung zu deinen Addons', 'Entscheidungen zu deinen Addons'));
    if (!parts.length) return 'Alles erledigt – gerade wartet nichts auf dich.';
    const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
    return `Neu für dich: ${text}.`;
  }

  function tile({ section, iconName, label, value, sub, tone = '', count = 0, countLabel = '', art = null }) {
    return h(
      'div',
      { class: 'ov-tile-item', role: 'listitem' },
      h(
        'a',
        { class: `ov-tile${tone ? ` ${tone}` : ''}`, href: `#reiter=${section}`, dataset: { goto: section, kachel: section, focusKey: `ov:${section}` } },
        h('span', { class: 'ov-tile-top' }, h('span', { class: 'ov-tile-icon', 'aria-hidden': 'true' }, art ?? icon(iconName)), h('span', { class: 'ov-tile-label', text: label }), count ? h('span', { class: 'count', 'aria-label': countLabel || undefined, text: count > 99 ? '99+' : String(count) }) : null),
        h('span', { class: 'ov-tile-value', text: value }),
        sub ? h('span', { class: 'ov-tile-sub', text: sub }) : null,
        h('span', { class: 'ov-tile-go', 'aria-hidden': 'true' }, icon('chevron-right')),
      ),
    );
  }

  function tiles(counts) {
    const out = [];
    const conversations = stand.conversations;
    const friends = stand.friends;
    // Nachrichten
    if (!conversations) out.push(tile({ section: 'nachrichten', iconName: 'chat', label: 'Nachrichten', value: '…', sub: 'Wird geladen' }));
    else {
      const senders = conversations.filter((conversation) => conversation.unread).map((conversation) => conversation.name);
      out.push(
        tile({
          section: 'nachrichten',
          iconName: 'chat',
          label: 'Nachrichten',
          value: counts.unread ? plural(counts.unread, 'ungelesen', 'ungelesen') : 'Alles gelesen',
          sub: counts.unread ? `von ${nameList(senders)}` : conversations.length ? plural(conversations.length, 'Unterhaltung', 'Unterhaltungen') : 'Schreib deinen Freunden',
          tone: counts.unread ? 'news' : '',
          count: counts.unread,
          countLabel: `${counts.unread} ungelesen`,
        }),
      );
    }
    // Freunde
    if (!friends) out.push(tile({ section: 'freunde', iconName: 'friends', label: 'Freunde', value: '…', sub: 'Wird geladen' }));
    else {
      const online = friends.friends.filter((friend) => friend.online).length;
      out.push(
        tile({
          section: 'freunde',
          iconName: 'friends',
          label: 'Freunde',
          value: counts.requests ? plural(counts.requests, 'offene Anfrage', 'offene Anfragen') : plural(friends.friends.length, 'Freund', 'Freunde'),
          sub: [counts.requests ? plural(friends.friends.length, 'Freund', 'Freunde') : null, `${online} online`, friends.outgoing.length ? `${friends.outgoing.length} gesendet` : null].filter(Boolean).join(' · '),
          tone: counts.requests ? 'news' : '',
          count: counts.requests,
          countLabel: counts.requests === 1 ? '1 offene Anfrage' : `${counts.requests} offene Anfragen`,
        }),
      );
    }
    // Support
    const tickets = stand.tickets;
    if (!tickets) out.push(tile({ section: 'support', iconName: 'info', label: 'Support', value: '…', sub: 'Wird geladen' }));
    else {
      const open = tickets.filter((ticket) => ticket.status !== 'closed').length;
      const waiting = tickets.filter((ticket) => ticket.unread || ticket.status === 'answered').length;
      out.push(
        tile({
          section: 'support',
          iconName: 'info',
          label: 'Support',
          value: counts.support ? plural(counts.support, 'neue Antwort', 'neue Antworten') : waiting ? `${plural(waiting, 'Anfrage wartet', 'Anfragen warten')} auf dich` : open ? plural(open, 'offene Anfrage', 'offene Anfragen') : 'Nichts offen',
          sub: open ? (waiting ? 'Das Team hat geantwortet' : 'Das Team meldet sich hier und im Spiel') : 'Fragen? Schreib dem Team.',
          tone: counts.support ? 'news' : waiting ? 'warn' : '',
          count: counts.support,
          countLabel: counts.support === 1 ? '1 neue Antwort' : `${counts.support} neue Antworten`,
        }),
      );
    }
    // Meine Addons
    const submissions = stand.submissions;
    if (!submissions) out.push(tile({ section: 'addons', iconName: 'addons', label: 'Meine Addons', value: '…', sub: 'Wird geladen' }));
    else {
      const by = (status) => submissions.filter((sub) => sub.status === status).length;
      const pending = by('pending');
      const rejected = by('rejected');
      const drafts = by('draft');
      const inStore = (stand.addons ?? []).length;
      const value = rejected ? plural(rejected, 'abgelehnt', 'abgelehnt') : pending ? plural(pending, 'in Prüfung', 'in Prüfung') : inStore ? plural(inStore, 'Addon im Store', 'Addons im Store') : drafts ? plural(drafts, 'Entwurf', 'Entwürfe') : 'Noch keine Addons';
      const sub = [pending && rejected ? `${pending} in Prüfung` : null, inStore && (pending || rejected) ? `${inStore} im Store` : null, drafts && (pending || rejected || inStore) ? plural(drafts, 'Entwurf', 'Entwürfe') : null].filter(Boolean).join(' · ');
      out.push(
        tile({
          section: 'addons',
          iconName: 'addons',
          label: 'Meine Addons',
          value,
          sub: sub || (submissions.length ? 'Einreichungen und Store' : 'Eigenes Addon einreichen'),
          tone: counts.decisions ? 'news' : rejected ? 'warn' : '',
          count: counts.decisions,
          countLabel: counts.decisions === 1 ? '1 neue Entscheidung' : `${counts.decisions} neue Entscheidungen`,
        }),
      );
    }
    // Profil & Cosmetics
    const me = stand.me;
    if (me) {
      const look = stand.look ?? null;
      const capeId = me.cape || '';
      const builtIn = CAPES.some(([id]) => id === capeId);
      const art = capeId && builtIn ? h('span', { class: 'cape-art ov-cape-art', dataset: { cape: capeId } }) : look?.capeThumb ? h('img', { class: 'ov-thumb', src: look.capeThumb, alt: '', width: 40, height: 40 }) : null;
      const worn = look?.worn ?? [];
      out.push(
        tile({
          section: 'profil',
          iconName: 'cape',
          label: 'Cape & Cosmetics',
          value: capeId ? `Cape: ${look?.capeName ?? capeName(capeId)}` : 'Kein Cape',
          sub: me.visible === false ? 'Für andere unsichtbar' : worn.length ? worn.join(' · ') : look ? 'Noch keine Cosmetics gewählt' : 'Hut, Flügel, Aura und Begleiter',
          tone: me.visible === false ? 'warn' : '',
          art,
        }),
      );
    }
    // Sicherheit
    if (me) {
      const sessions = stand.sessions;
      const team = Boolean(me.role);
      const twoFactor = me.twoFactor ?? { enabled: false, verified: false };
      out.push(
        tile({
          section: 'sicherheit',
          iconName: 'shield',
          label: 'Sicherheit',
          value: sessions ? plural(sessions.length, 'angemeldeter Browser', 'angemeldete Browser') : 'Anmeldungen',
          sub: team ? (twoFactor.enabled ? (twoFactor.verified ? 'Zwei-Faktor: eingerichtet, bestätigt' : 'Zwei-Faktor: eingerichtet') : 'Zwei-Faktor-Anmeldung fehlt') : me.expiresAt ? `Dieser Browser bis ${formatDate(me.expiresAt)}` : 'Kein Passwort nötig',
          tone: team && !twoFactor.enabled ? 'warn' : '',
          count: team && !twoFactor.enabled ? 1 : 0,
          countLabel: 'Zwei-Faktor-Anmeldung fehlt',
        }),
      );
    }
    return out;
  }

  function activityRow(item) {
    const unread = isUnread(item);
    const link = h(
      'a',
      { class: `ov-act${unread ? ' unread' : ''}`, href: sectionHref('konto', item.target.section, item.target.params), dataset: { activity: item.id, focusKey: `act:${item.id}` } },
      item.player ? avatar(item.player.name, item.player.uuid, { size: 'sm' }) : h('span', { class: `ov-act-icon ${item.kind}`, 'aria-hidden': 'true' }, icon(item.icon)),
      h('span', { class: 'ov-act-body' }, h('span', { class: 'ov-act-title', text: item.title }), item.text ? h('span', { class: 'ov-act-text', text: item.text }) : null),
      h('span', { class: 'ov-act-side' }, item.at ? timeEl(item.at, relativeTime(item.at)) : null, unread ? h('span', { class: 'unread-dot', role: 'img', 'aria-label': 'neu' }) : null),
    );
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      seen.add([item.id]);
      shell.select(item.target.section, { history: 'push', params: item.target.params ?? null, scroll: true, source: 'activity' });
      document.getElementById('shell-titel')?.focus({ preventScroll: true });
      render();
    });
    return h('li', null, link);
  }

  function renderOverview() {
    const me = stand.me;
    if (!me) return;
    const counts = {
      unread: (stand.conversations ?? []).reduce((sum, conversation) => sum + (Number(conversation.unread) || 0), 0),
      requests: stand.friends?.incoming.length ?? 0,
      support: (stand.tickets ?? []).filter((ticket) => ticket.unread).length,
      decisions: items.filter((item) => item.kind === 'addon' && isUnread(item)).length,
    };
    $('uebersicht-tageszeit').textContent = `${greeting()} · ${WEEKDAY.format(Date.now())}`;
    $('uebersicht-zeile').textContent = summaryLine(counts);
    const statusSignature = JSON.stringify([counts, stand.conversations?.map((c) => [c.name, c.unread]), stand.friends && [stand.friends.friends.map((f) => f.online), stand.friends.outgoing.length], stand.tickets?.map((t) => [t.status, t.unread]), stand.submissions?.map((s) => s.status), stand.addons?.length, me.cape, me.visible, me.role, me.twoFactor, me.expiresAt, stand.sessions?.length, stand.look]);
    rerender($('uebersicht-status'), statusSignature, () => tiles(counts));
    const shown = items.slice(0, OVERVIEW_ITEMS);
    const anyUnread = items.some(isUnread);
    $('aktivitaet-gelesen').hidden = !anyUnread;
    rerender($('uebersicht-aktivitaet'), JSON.stringify(shown.map((item) => [item.id, item.title, item.text, isUnread(item), Math.floor((Date.now() - (item.at ?? 0)) / 60000)])), () => {
      if (!stand.conversations || !stand.friends) return h('p', { class: 'muted small', text: 'Wird geladen …' });
      if (!shown.length) return emptyState('Gerade gibt es nichts Neues. Nachrichten, Anfragen und Antworten des Teams erscheinen hier.', 'check');
      return h('ul', { class: 'ov-act-list' }, shown.map(activityRow));
    });
  }

  /** Zähler, Übersicht und (wenn zu) die Glocke mit den aktuellen Einträgen zeichnen. */
  function refreshViews() {
    updateBadges();
    renderOverview();
    if (!bellOpen) pushActivity();
  }

  function render() {
    items = buildItems(stand);
    refreshViews();
  }

  // --- Schnellaktionen und „Alles gelesen“ -----------------------------------------------------------------

  $('uebersicht-aktionen').addEventListener('click', (event) => {
    const link = event.target.closest('a[data-aktion]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    const action = actions[link.dataset.aktion];
    if (!action) return;
    event.preventDefault();
    action();
  });
  $('aktivitaet-gelesen').addEventListener('click', () => {
    seen.add(items.map((item) => item.id));
    render();
    $('uebersicht-aktivitaet').focus?.();
  });
  // Bereich besucht: was dort steht, gilt als gesehen (die Zahlen am Bereich bleiben, bis du es wirklich liest).
  shell.onSelect((section) => {
    if (!stand.me) return;
    if (seen.add(items.filter((item) => item.section === section).map((item) => item.id))) render();
  });

  return {
    /** Angemeldeter Spieler (Gruß, Kopf, Gesehen-Merker je Spieler). */
    setUser(me) {
      seen.viewer(me?.uuid ?? null);
      stand = { ...stand, me };
      $('uebersicht-gruss').textContent = `Hallo, ${me.name}!`;
      $('uebersicht-avatar').replaceChildren(avatar(me.name, me.uuid, { size: 'lg' }));
      bellSignature = null;
      render();
    },
    /** Neuer Stand (Teilmenge reicht): { friends, conversations, tickets, submissions, addons, sessions, look, me }. */
    update(patch) {
      stand = { ...stand, ...patch };
      render();
    },
    /** Abgemeldet: Glocke weg, nichts mehr anzeigen. */
    reset() {
      stand = {};
      items = [];
      bellSignature = null;
      shell.setActivity(null);
    },
  };
}
