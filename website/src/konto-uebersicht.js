// HeldixClient – Webseite: Konto → „Übersicht“ (Dashboard) und die Glocke (Aktivität) im Seitenkopf.
//
// - Dashboard: Figur mit Skin, Cape und Cosmetics (3D aus konto-cosmetics.js), Gruß und was neu ist, Statustext,
//   Einladungs-Fortschritt mit Belohnungen, Freunde online (Beitreten, Nachricht), ungelesene Nachrichten (mit
//   Beitreten-Karten), Party, eigene Welten, Support und Sicherheit.
// - Aktivität: neue Nachrichten, Freundschaftsanfragen, Party-Einladungen, Antworten des Teams und Entscheidungen zu
//   eigenen Addons. Was du gesehen hast (Glocke geöffnet, Eintrag gewählt, Bereich besucht), merkt sich dieser Browser
//   in localStorage – je Spieler. Ohne localStorage (privates Fenster, gesperrt) gilt das nur bis zum Neuladen.
//
// Keine eigenen Anfragen: konto.js reicht nach jeder Änderung den aktuellen Stand herein (update(stand)).
// Texte vom Server landen nur als Text im Dokument.
import { avatar, emptyState, h, icon, presenceClass, presenceDot, presenceOf, relativeTime, rerender, shortWhen, timeEl } from './app-common.js';
import { sectionHref, shellIcon } from './app-shell.js';
import { displayName, friendLine, friendsSummary, joinButton, joinCard, joinTarget, sortFriends } from './konto-sozial.js';

const DAY = 24 * 60 * 60 * 1000;
const SEEN_PREFIX = 'heldix.konto.gesehen.';
const MAX_SEEN = 400;
const MAX_ITEMS = 12;
/** Wie lange schon gelesene Einträge in der Aktivität bleiben. */
const KEEP_MESSAGES = 3 * DAY;
const KEEP_DECISIONS = 14 * DAY;
const WEEKDAY = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const ACCESS = { invited: 'nur eingeladen', friends: 'Freunde dürfen rein', open: 'offen für alle' };

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function clip(text, max = 90) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return [...value].length > max ? `${[...value].slice(0, max - 1).join('')}…` : value;
}

/** „A, B und C“ */
function joinWords(parts) {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
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
    });
  }
  for (const request of stand.friends?.incoming ?? []) {
    items.push({ id: `anfrage:${request.uuid}:${request.at}`, kind: 'anfrage', section: 'freunde', title: 'Freundschaftsanfrage', text: `${request.name} möchte mit dir befreundet sein`, at: request.at, icon: 'user-plus', fresh: true, target: { section: 'freunde' } });
  }
  for (const invite of stand.party?.invites ?? []) {
    items.push({ id: `party:${invite.party}:${invite.at}`, kind: 'party', section: 'party', title: 'Party-Einladung', text: `${invite.from?.name ?? 'Ein Freund'} lädt dich in die Party ein`, at: invite.at, icon: 'friends', fresh: true, target: { section: 'party' } });
  }
  for (const ticket of stand.tickets ?? []) {
    const at = ticket.updatedAt ?? ticket.at;
    if (ticket.unread) items.push({ id: `support:${ticket.id}:${at}`, kind: 'support', section: 'support', title: 'Antwort vom Team', text: clip(ticket.subject), at, icon: 'info', fresh: true, target: { section: 'support', params: { anfrage: ticket.id } } });
    else if (ticket.status === 'answered' && now - (at ?? 0) <= KEEP_DECISIONS) items.push({ id: `support:${ticket.id}:${at}`, kind: 'support', section: 'support', title: 'Anfrage beantwortet', text: clip(ticket.subject), at, icon: 'info', fresh: false, target: { section: 'support', params: { anfrage: ticket.id } } });
  }
  // Dauerhafte Welten (ab Dienst 1.13.0): Anklopfen und die Freischaltung für die Beta
  for (const knock of stand.hosting?.knocks ?? []) {
    items.push({ id: `anklopfen:${knock.world}:${knock.name}:${knock.at}`, kind: 'welt', section: 'welten', title: `${knock.name} klopft an`, text: `möchte in „${clip(knock.worldName)}“`, at: knock.at, icon: 'world', fresh: true, target: { section: 'welten' } });
  }
  if (stand.hosting?.granted) {
    const granted = stand.hosting.granted;
    items.push({ id: `freigeschaltet:${granted.at}`, kind: 'welt', section: 'welten', title: 'Beta freigeschaltet', text: clip(granted.text), at: granted.at, icon: 'check', fresh: true, target: { section: 'welten' } });
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

/** shell: Rahmen der Seite. onStatus(): Knopf „Status setzen“. worldDomain(): Domain der Welten (für Beitreten). */
export function initOverview({ shell, onStatus, worldDomain = () => null, openChat = () => {} }) {
  const seen = createSeenStore();
  let stand = {};
  let items = [];
  let bellSignature = null;
  let scheduled = false;
  let bellOpen = false;

  const $ = (id) => document.getElementById(id);
  const isUnread = (item) => item.fresh && !seen.has(item.id);
  const friendByUuid = (uuid) => stand.friends?.friends.find((friend) => friend.uuid === uuid) ?? null;

  // --- Glocke -------------------------------------------------------------------------------------------

  function pushActivity({ force = false } = {}) {
    const list = items.map((item) => ({ id: item.id, title: item.title, text: item.text, at: item.at, icon: item.icon, unread: isUnread(item), target: item.target }));
    const signature = JSON.stringify(list);
    if (!force && signature === bellSignature) return;
    bellSignature = signature;
    shell.setActivity(list);
  }

  const bellPanel = $('shell-aktivitaet');
  shell.onActivity((event) => {
    if (event.type === 'open') {
      bellOpen = true;
      // Geöffnet = gesehen. Die Markierungen bleiben stehen, bis die Liste wieder zu ist.
      if (seen.add(items.map((item) => item.id))) scheduleBadges();
    } else if (event.type === 'select' && event.item?.id) {
      if (seen.add([event.item.id])) scheduleBadges();
    }
  });
  if (bellPanel) {
    new MutationObserver(() => {
      if (bellPanel.hidden && bellOpen) {
        bellOpen = false;
        render();
      }
    }).observe(bellPanel, { attributes: true, attributeFilter: ['hidden'] });
  }

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
    const support = (stand.tickets ?? []).filter((ticket) => ticket.unread).length;
    shell.setBadge('support', support, { label: support === 1 ? '1 neue Antwort' : `${support} neue Antworten` });
    const partyInvites = stand.party?.invites?.length ?? 0;
    shell.setBadge('party', partyInvites, { label: partyInvites === 1 ? '1 Einladung' : `${partyInvites} Einladungen` });
  }

  // --- Karten ---------------------------------------------------------------------------------------------

  function greeting() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 11) return 'Guten Morgen';
    if (hour >= 11 && hour < 18) return 'Guten Tag';
    if (hour >= 18 && hour < 23) return 'Guten Abend';
    return 'Noch wach?';
  }

  function counts() {
    return {
      unread: (stand.conversations ?? []).reduce((sum, conversation) => sum + (Number(conversation.unread) || 0), 0),
      requests: stand.friends?.incoming.length ?? 0,
      support: (stand.tickets ?? []).filter((ticket) => ticket.unread).length,
      party: stand.party?.invites?.length ?? 0,
      decisions: items.filter((item) => item.kind === 'addon' && isUnread(item)).length,
    };
  }

  function summaryLine(c) {
    const parts = [];
    if (c.unread) parts.push(plural(c.unread, 'ungelesene Nachricht', 'ungelesene Nachrichten'));
    if (c.requests) parts.push(plural(c.requests, 'Freundschaftsanfrage', 'Freundschaftsanfragen'));
    if (c.party) parts.push(plural(c.party, 'Party-Einladung', 'Party-Einladungen'));
    if (c.support) parts.push(c.support === 1 ? '1 Antwort vom Team' : `${c.support} Antworten vom Team`);
    if (c.decisions) parts.push(plural(c.decisions, 'Entscheidung zu deinen Addons', 'Entscheidungen zu deinen Addons'));
    if (!parts.length) {
      const online = stand.friends?.friends.filter((friend) => friend.online).length ?? 0;
      return online ? `Alles gelesen. ${online === 1 ? '1 Freund ist' : `${online} Freunde sind`} gerade im Spiel.` : 'Alles gelesen – gerade gibt es nichts Neues.';
    }
    return `Neu für dich: ${joinWords(parts)}.`;
  }

  function cardHead({ iconNode, tone = '', title, titleId, sub, link = null }) {
    return h(
      'div',
      { class: 'card__head' },
      h('span', { class: `icon-tile${tone ? ` icon-tile--${tone}` : ''}` }, iconNode),
      h('div', null, h('h2', { class: 'card__title', id: titleId, text: title }), sub ? h('p', { class: 'tiny text-3', text: sub }) : null),
      link ? h('a', { class: 'btn btn--ghost btn--sm card__head-end', href: `#reiter=${link.section}`, dataset: { goto: link.section }, text: link.label ?? 'Alle' }) : null,
    );
  }

  function renderHero() {
    const me = stand.me;
    const c = counts();
    $('uebersicht-tageszeit').textContent = `${greeting()} · ${WEEKDAY.format(Date.now())}`;
    $('uebersicht-zeile').textContent = summaryLine(c);
    const status = $('uebersicht-status-zeile');
    const statusParts = [me.dnd ? 'Nicht stören' : null, me.statusText ? `„${me.statusText}“` : null].filter(Boolean);
    status.hidden = !statusParts.length;
    status.textContent = statusParts.length ? `Dein Status: ${statusParts.join(' · ')}` : '';
    const look = stand.look;
    rerender($('uebersicht-look'), JSON.stringify(look ?? null), () => {
      const chips = [];
      if (look?.items) for (const item of look.items) chips.push(h('li', { class: `chip${item.reward ? ' chip--reward' : ''}` }, icon(item.slot === 'cape' ? 'cape' : 'sparkles'), `${item.label}: ${item.name}`));
      else if (look?.capeName) chips.push(h('li', { class: 'chip' }, icon('cape'), `Cape: ${look.capeName}`));
      if (!chips.length) chips.push(h('li', { class: 'chip', text: look ? 'Noch nichts angezogen' : 'Cosmetics werden geprüft …' }));
      return chips;
    });
  }

  function renderInvite() {
    const box = $('uebersicht-einladen');
    const data = stand.invites;
    box.hidden = !data;
    if (!data) return;
    rerender(box, JSON.stringify(data), () => {
      const rewards = Array.isArray(data.rewards) ? data.rewards : [];
      const confirmed = Number(data.confirmed) || 0;
      return [
        cardHead({ iconNode: shellIcon('gift'), tone: 'reward', title: 'Freunde einladen', titleId: 'uebersicht-einladen-titel', sub: data.link?.expires ? `Link gültig bis ${new Date(data.link.expires).toLocaleDateString('de-DE')}` : 'Dein Einladungslink' }),
        data.link
          ? h(
              'div',
              { class: 'input-group' },
              h('input', { class: 'input input--mono', readonly: true, value: (data.link.url ?? `${location.origin}/einladung#${data.link.code}`).replace(/^https?:\/\//, ''), 'aria-label': 'Dein Einladungslink' }),
              h('a', { class: 'btn btn--social btn--icon', href: '#reiter=einladen', dataset: { goto: 'einladen' }, 'aria-label': 'Freunde einladen öffnen' }, shellIcon('link')),
            )
          : null,
        h('dl', { class: 'mini-stats' }, h('div', null, h('dt', { text: 'Eingeladen' }), h('dd', { text: String(data.invited ?? 0) })), h('div', null, h('dt', { text: 'Bestätigt' }), h('dd', { text: String(confirmed) })), h('div', null, h('dt', { text: 'Ausstehend' }), h('dd', { text: String(data.pending ?? 0) }))),
        ...rewards.map((reward) => {
          const done = Boolean(reward.unlocked);
          const progress = Math.min(1, confirmed / Math.max(1, reward.friends));
          const bar = h('div', { class: 'progress progress--reward', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(reward.friends), 'aria-valuenow': String(Math.min(confirmed, reward.friends)), 'aria-label': `Fortschritt ${reward.name ?? reward.cosmetic}` }, h('div', { class: 'progress__bar' }));
          bar.firstChild.style.width = `${Math.round(progress * 100)}%`;
          return h(
            'div',
            { class: `reward-row${done ? ' is-done' : ''}` },
            h('span', { class: 'reward-row__icon' }, shellIcon(done ? 'check' : 'gift')),
            h('div', null, h('strong', { text: reward.name ?? reward.cosmetic }), done ? h('span', { text: 'freigeschaltet' }) : bar),
            h('span', { class: `chip ${done ? 'chip--online' : 'chip--reward'}`, text: `${Math.min(confirmed, reward.friends)} / ${reward.friends}` }),
          );
        }),
      ];
    });
  }

  function renderFriends() {
    const box = $('uebersicht-freunde');
    const friends = stand.friends?.friends ?? [];
    // Im Spiel zuerst, dann im Launcher (Dienst ab 1.14.0) – beide sind gerade erreichbar
    const online = sortFriends(friends.filter((friend) => presenceOf(friend) !== 'offline')).slice(0, 5);
    rerender(box, JSON.stringify([online, friends.length, stand.friends?.incoming.length, worldDomain()]), () => [
      cardHead({ iconNode: icon('friends'), tone: 'online', title: 'Freunde online', titleId: 'uebersicht-freunde-titel', sub: stand.friends ? friendsSummary(friends, stand.friends.incoming.length) : 'Wird geladen …', link: { section: 'freunde' } }),
      !stand.friends
        ? null
        : online.length
          ? h(
              'ul',
              { class: 'rows' },
              online.map((friend) => {
                const target = friend.online && friend.server ? joinTarget({ server: friend.server, worldDomain: worldDomain() }) : null;
                return h(
                  'li',
                  { class: 'row', dataset: { uuid: friend.uuid } },
                  avatar(friend.name, friend.uuid, { online: presenceDot(friend) }),
                  h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: displayName(friend) }), h('div', { class: `row-sub${presenceClass(friend)}`, text: friendLine(friend) })),
                  h('div', { class: 'row-actions' }, target ? joinButton(target) : null, h('button', { type: 'button', class: 'btn btn--secondary btn--sm btn--icon', 'aria-label': `Nachricht an ${displayName(friend)}`, onClick: () => openChat(friend.uuid) }, icon('chat'))),
                );
              }),
            )
          : emptyState(friends.length ? 'Gerade ist keiner deiner Freunde im Spiel oder im Launcher.' : 'Noch keine Freunde – lade welche ein!', 'friends'),
    ]);
  }

  function renderMessages() {
    const box = $('uebersicht-nachrichten');
    const conversations = (stand.conversations ?? []).slice(0, 4);
    const unread = counts().unread;
    rerender(box, JSON.stringify([conversations, worldDomain(), stand.friends?.friends.map((f) => [f.uuid, f.nickname])]), () => [
      cardHead({ iconNode: icon('chat'), title: 'Nachrichten', titleId: 'uebersicht-nachrichten-titel', sub: unread ? `${unread} ungelesen` : 'Alles gelesen', link: { section: 'nachrichten' } }),
      !stand.conversations
        ? null
        : conversations.length
          ? h(
              'ul',
              { class: 'rows' },
              conversations.map((conversation) => {
                const friend = friendByUuid(conversation.uuid);
                const last = conversation.last;
                const mine = last?.from === stand.me?.uuid;
                const link = h(
                  'a',
                  { class: 'row-link', href: sectionHref('konto', 'nachrichten', { mit: conversation.uuid }), dataset: { goto: 'nachrichten', params: JSON.stringify({ mit: conversation.uuid }) } },
                  avatar(conversation.name, conversation.uuid),
                  h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: friend ? displayName(friend) : conversation.name }), last?.card ? null : h('span', { class: 'row-sub', text: `${mine ? 'Du: ' : ''}${clip(last?.text, 80)}` })),
                  h('span', { class: 'row__time', text: shortWhen(last?.at) }),
                );
                return h('li', { class: `row${conversation.unread ? ' row--unread' : ''}` }, link, last?.card ? joinCard(last.card, { worldDomain: worldDomain() }) : null);
              }),
            )
          : emptyState('Noch keine Nachrichten.', 'chat'),
    ]);
  }

  function renderParty() {
    const box = $('uebersicht-party');
    const data = stand.party;
    rerender(box, JSON.stringify(data ? { party: data.party && { ...data.party, chat: undefined }, invites: data.invites } : data), () => {
      if (data === null && stand.partyAvailable === false) return [cardHead({ iconNode: shellIcon('party'), tone: 'voice', title: 'Party', titleId: 'uebersicht-party-titel', sub: 'ab Heldix-Dienst 1.12.0' })];
      const party = data?.party;
      const head = cardHead({ iconNode: shellIcon('party'), tone: 'voice', title: 'Party', titleId: 'uebersicht-party-titel', sub: party ? `${party.members.length} von ${party.max ?? 8}${party.leader === stand.me?.uuid ? ' · du leitest' : ''}` : data?.invites?.length ? plural(data.invites.length, 'Einladung', 'Einladungen') : 'Gerade keine Party', link: { section: 'party', label: 'Öffnen' } });
      if (!party) {
        return [head, data?.invites?.length ? h('p', { class: 'small text-2', text: `${data.invites[0].from?.name} lädt dich ein.` }) : h('p', { class: 'small text-2', text: 'Zusammen spielen mit bis zu 8 Freunden: gemeinsam folgen, gemeinsam im Voice.' })];
      }
      const target = party.target ? joinTarget({ location: party.target }) : null;
      return [
        head,
        h('div', { class: 'party-mini' }, h('span', { class: 'avatar-stack' }, party.members.slice(0, 5).map((member) => avatar(member.name, member.uuid, { size: 'sm' }))), h('div', null, h('strong', { text: party.target ? party.target.title : 'Noch kein gemeinsamer Ort' }), h('p', { class: 'tiny text-3', text: party.voice ? 'Party-Voice aktiv' : 'Folgen und Voice im Spiel' }))),
        target ? joinButton(target, { variant: 'secondary' }) : null,
      ];
    });
  }

  function renderWorlds() {
    const box = $('uebersicht-welten');
    const data = stand.worlds;
    rerender(box, JSON.stringify(data ?? null), () => {
      const mine = data?.mine ?? [];
      const head = cardHead({ iconNode: icon('world'), tone: mine.some((world) => world.online) ? 'online' : '', title: 'Meine Welten', titleId: 'uebersicht-welten-titel', sub: !data ? 'Wird geladen …' : !data.available ? 'Welt teilen ist hier nicht eingerichtet' : mine.length ? plural(mine.length, 'Welt', 'Welten') : 'Noch keine Welt geteilt', link: data?.available ? { section: 'welten', label: 'Verwalten' } : null });
      if (!data?.available) return [head];
      if (!mine.length) return [head, h('p', { class: 'small text-2', text: 'Im Spiel unter Heldix-Menü → Welt teilen öffnest du eine Einzelspieler-Welt für Freunde.' })];
      return [
        head,
        h(
          'ul',
          { class: 'rows' },
          mine.slice(0, 3).map((world) => h('li', { class: 'row' }, h('span', { class: `icon-tile${world.online ? ' icon-tile--online' : ''}` }, icon('world')), h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: world.name }), h('div', { class: `row-sub${world.online ? ' online' : ''}`, text: `${world.hosted ? `dauerhaft · ${world.online ? `läuft · ${world.players ?? 0} von ${world.maxPlayers}` : 'schläft'}` : world.online ? `geöffnet · ${world.players ?? 1} von ${world.maxPlayers}` : 'zu'} · ${ACCESS[world.access] ?? world.access}` })))),
        ),
      ];
    });
  }

  function renderSupport() {
    const box = $('uebersicht-support');
    const tickets = stand.tickets ?? [];
    const open = tickets.filter((ticket) => ticket.status !== 'closed');
    const ticket = tickets.find((entry) => entry.unread) ?? open[0] ?? null;
    rerender(box, JSON.stringify([ticket, open.length, tickets.length]), () => [
      cardHead({ iconNode: shellIcon('help-circle'), title: 'Support', titleId: 'uebersicht-support-titel', sub: !stand.tickets ? 'Wird geladen …' : tickets.some((entry) => entry.unread) ? plural(tickets.filter((entry) => entry.unread).length, 'neue Antwort', 'neue Antworten') : open.length ? plural(open.length, 'offene Anfrage', 'offene Anfragen') : 'Keine offenen Anfragen', link: { section: 'support', label: 'Öffnen' } }),
      ticket
        ? h(
            'a',
            { class: 'ticket-mini', href: sectionHref('konto', 'support', { anfrage: ticket.id }), dataset: { goto: 'support', params: JSON.stringify({ anfrage: ticket.id }) } },
            h('span', { class: `chip ${ticket.status === 'answered' ? 'chip--online' : ticket.status === 'closed' ? '' : 'chip--accent'}`, text: ticket.status === 'answered' ? 'Beantwortet' : ticket.status === 'closed' ? 'Geschlossen' : 'Offen' }),
            h('strong', { text: ticket.subject }),
            h('span', { class: 'tiny text-3', text: `#${ticket.id} · ${relativeTime(ticket.updatedAt ?? ticket.at)}` }),
          )
        : h('p', { class: 'small text-2', text: 'Fragen oder Probleme? Das Team antwortet hier und im Spiel.' }),
    ]);
  }

  function renderSecurity() {
    const box = $('uebersicht-sicherheit');
    const me = stand.me;
    const sessions = stand.sessions?.length ?? null;
    const missing2fa = Boolean(me?.role && me.twoFactor && !me.twoFactor.enabled);
    rerender(box, JSON.stringify([sessions, missing2fa, me?.presence, me?.showServer, me?.visible]), () => [
      cardHead({ iconNode: icon('shield'), tone: missing2fa ? '' : 'online', title: 'Sicherheit', titleId: 'uebersicht-sicherheit-titel', sub: missing2fa ? 'Zwei-Faktor-Anmeldung fehlt' : 'Alles in Ordnung' }),
      h(
        'ul',
        { class: 'check-list small' },
        sessions !== null ? h('li', null, icon('check'), h('span', { text: sessions === 1 ? 'Nur dieser Browser ist angemeldet' : `${sessions} angemeldete Browser` })) : null,
        h('li', null, icon(me?.presence === false ? 'eye-off' : 'check'), h('span', { text: me?.presence === false ? 'Online-Status verborgen' : me?.showServer === false ? 'Online-Status sichtbar, Server verborgen' : 'Online-Status und Server für Freunde sichtbar' })),
        missing2fa ? h('li', { class: 'is-warn' }, icon('warning'), h('span', { text: 'Für den Team-Bereich fehlt die Zwei-Faktor-Anmeldung.' })) : null,
      ),
      h('a', { class: 'link-arrow small', href: '#reiter=sicherheit', dataset: { goto: 'sicherheit' } }, 'Sitzungen verwalten', icon('chevron-right')),
    ]);
  }

  function renderOverview() {
    if (!stand.me) return;
    renderHero();
    renderInvite();
    renderFriends();
    renderMessages();
    renderParty();
    renderWorlds();
    renderSupport();
    renderSecurity();
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

  $('uebersicht-status-knopf').addEventListener('click', () => onStatus?.());
  // Bereich besucht: was dort steht, gilt als gesehen (die Zahlen am Bereich bleiben, bis du es wirklich liest).
  shell.onSelect((section) => {
    if (!stand.me) return;
    if (seen.add(items.filter((item) => item.section === section).map((item) => item.id))) render();
  });
  // Zeiten („vor 5 Min.“) ab und zu neu
  setInterval(() => {
    if (stand.me && shell.current() === 'uebersicht' && document.visibilityState === 'visible') {
      for (const id of ['uebersicht-nachrichten', 'uebersicht-support']) delete $(id).dataset.signature;
      renderMessages();
      renderSupport();
    }
  }, 60_000);

  return {
    /** Angemeldeter Spieler (Gruß, Gesehen-Merker je Spieler). */
    setUser(me) {
      seen.viewer(me?.uuid ?? null);
      stand = { ...stand, me };
      $('uebersicht-gruss').textContent = `Hallo, ${me.name}!`;
      bellSignature = null;
      render();
    },
    /** Neuer Stand (Teilmenge reicht): { friends, conversations, tickets, submissions, addons, sessions, look, me, party, worlds, invites }. */
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

