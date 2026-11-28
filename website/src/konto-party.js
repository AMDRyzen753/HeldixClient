// HeldixClient – Webseite: Konto → „Party“ (Heldix-Dienst ab 1.12.0; die Party lebt nur im Arbeitsspeicher des Dienstes).
//
// - Einladungen an dich: annehmen (alte Party verlässt du dabei) oder ablehnen.
// - Deine Party: bis zu 8 Freunde, Leitung, wo jeder gerade spielt (Party-Mitglieder sehen das immer), Party-Voice,
//   offene Einladungen. Der Leiter lädt ein, zieht Einladungen zurück, entfernt Mitglieder und übergibt die Leitung.
//   Alle können die Party verlassen. Ohne Party entsteht beim ersten Einladen eine (du leitest).
// - Party-Chat (nur im Speicher, die letzten 50).
// - „Folgen“: Wechselt der Leiter den Ort, zeigt die Seite „<Leiter> ist auf <Ziel> – Beitreten“.
// - Echtzeit: party, party-invite, party-chat, party-follow (konto-live.js). Mit der Seite offen bist du für die Party
//   verbunden (keine Gnadenfrist).
import { avatar, bindCounter, busy, confirmAction, emptyState, h, icon, presenceClass, presenceDot, presenceOf, presenceRank, relativeTime, rerender, showError, timeEl, formatTime, toast } from './app-common.js';
import { shellIcon } from './app-shell.js';
import { displayName, joinButton, joinTarget } from './konto-sozial.js';

const MAX_TEXT = 500;
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export function initParty(ctx) {
  const { call, store } = ctx;
  const $ = (id) => document.getElementById(id);
  const local = { available: null, follow: null, timer: null };

  const party = () => store.party?.party ?? null;
  const invites = () => store.party?.invites ?? [];
  const meUuid = () => store.me?.uuid;
  const isLeader = () => party()?.leader === meUuid();
  const friendByUuid = (uuid) => store.friends?.friends.find((friend) => friend.uuid === uuid) ?? null;

  function apply(data) {
    const current = store.party ?? { party: null, invites: [], chat: [] };
    const next = { ...current };
    if ('party' in data) {
      next.party = data.party ?? null;
      if (data.party && Array.isArray(data.party.chat)) next.chat = data.party.chat;
      else if (!data.party) next.chat = [];
      else if (current.party?.id !== data.party.id) next.chat = [];
    }
    if (Array.isArray(data.invites)) next.invites = data.invites;
    store.party = next;
    ctx.emit('party');
  }

  async function refresh() {
    try {
      const data = await call('GET', '/v1/party');
      local.available = true;
      apply({ party: data?.party ?? null, invites: data?.invites ?? [] });
    } catch (error) {
      // GET /v1/party gibt es erst ab Dienst 1.12.0 (älter: 404)
      if (error.status === 404) {
        local.available = false;
        store.party = null;
        ctx.emit('party');
        return;
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Aktionen
  // -------------------------------------------------------------------------------------------------------

  function canInvite(uuid) {
    if (local.available === false || !friendByUuid(uuid)) return false;
    const current = party();
    if (!current) return true;
    if (current.leader !== meUuid()) return false;
    return !current.members.some((member) => member.uuid === uuid) && !current.invites.some((invite) => invite.uuid === uuid) && current.members.length < (current.max ?? 8);
  }

  async function invite(friend, button = null) {
    try {
      const data = await busy(button, () => call('POST', '/v1/party/invite', { uuid: friend.uuid }));
      apply({ party: data?.party ?? null });
      toast(`${displayName(friend)} ist in die Party eingeladen.`, 'success');
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  }

  async function accept(entry, button) {
    try {
      const data = await busy(button, () => call('POST', `/v1/party/${entry.party}/accept`));
      apply({ party: data?.party ?? null, invites: invites().filter((item) => item.party !== entry.party) });
      toast(`Du bist jetzt in der Party von ${entry.leader?.name ?? entry.from?.name}.`, 'success');
      ctx.shell.select('party', { history: 'push' });
    } catch (error) {
      if (error.status === 404) refresh().catch(() => {});
      showError(error);
    }
  }

  async function decline(entry, button) {
    try {
      const data = await busy(button, () => call('POST', `/v1/party/${entry.party}/decline`));
      apply({ invites: Array.isArray(data?.invites) ? data.invites : invites().filter((item) => item.party !== entry.party) });
    } catch (error) {
      showError(error);
    }
  }

  async function leave() {
    const current = party();
    if (!current) return;
    const others = current.members.filter((member) => member.uuid !== meUuid());
    const ok = await confirmAction({
      title: 'Party verlassen?',
      text: isLeader() && others.length ? `Die Leitung geht an ${others[0].name}. Du kannst später wieder eingeladen werden.` : 'Du kannst später wieder eingeladen werden.',
      confirmLabel: 'Verlassen',
      danger: true,
      onConfirm: async () => apply(await call('POST', '/v1/party/leave')),
    });
    if (ok) toast('Du hast die Party verlassen.');
  }

  async function removeMember(member) {
    const ok = await confirmAction({
      title: `${member.name} entfernen?`,
      text: `${member.name} ist danach nicht mehr in der Party und hört im Party-Voice nicht mehr mit.`,
      confirmLabel: 'Entfernen',
      danger: true,
      onConfirm: async () => apply(await call('DELETE', `/v1/party/members/${member.uuid}`)),
    });
    if (ok) toast(`${member.name} ist nicht mehr in der Party.`);
  }

  async function makeLeader(member) {
    const ok = await confirmAction({
      title: `${member.name} die Leitung geben?`,
      text: `${member.name} lädt dann ein, entfernt Mitglieder und bestimmt, wohin die Party geht. Du bleibst Mitglied.`,
      confirmLabel: 'Leitung übergeben',
      onConfirm: async () => apply(await call('POST', '/v1/party/leader', { uuid: member.uuid })),
    });
    if (ok) toast(`${member.name} leitet jetzt die Party.`);
  }

  async function withdraw(entry, button) {
    try {
      apply(await busy(button, () => call('DELETE', `/v1/party/invites/${entry.uuid}`)));
    } catch (error) {
      showError(error);
    }
  }

  async function sendChat(event) {
    event.preventDefault();
    const input = $('party-chat-text');
    const error = $('party-chat-fehler');
    const text = input.value.replace(/[\r\n]+/g, ' ').trim();
    error.hidden = true;
    if (!text) return;
    try {
      const data = await busy($('party-chat-senden'), () => call('POST', '/v1/party/chat', { text }));
      if (data?.message) addChat(data.message);
      input.value = '';
      input.dispatchEvent(new Event('input'));
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    }
    input.focus();
  }

  function addChat(message) {
    if (!store.party) return;
    const chat = store.party.chat ?? [];
    if (chat.some((entry) => entry.id === message.id)) return;
    store.party.chat = [...chat, message].slice(-50);
    renderChat('bottom');
    ctx.emit('party-chat');
  }

  // -------------------------------------------------------------------------------------------------------
  // Anzeige
  // -------------------------------------------------------------------------------------------------------

  function memberLine(member) {
    if (member.away) return member.awayUntil ? `Gerade nicht verbunden · bleibt bis ${formatTime(member.awayUntil)} Uhr` : 'Gerade nicht verbunden';
    // Ab Dienst 1.14.0 sagt launcher, ob das Mitglied den Launcher offen hat (älterer Dienst: Feld fehlt)
    if (!member.online && member.launcher === true) return 'Im Launcher – bekommt Nachrichten sofort';
    if (!member.online && member.launcher === false) return 'Nicht im Spiel · über die Webseite dabei';
    if (!member.online) return 'Nicht im Spiel · mit Launcher oder Webseite dabei';
    if (member.location) return `${member.location.kind === 'world' ? 'In der Welt' : 'Auf'} ${member.location.title}`;
    switch (member.state) {
      case 'menu':
        return 'Im Hauptmenü';
      case 'singleplayer':
        return 'Spielt Einzelspieler';
      case 'multiplayer':
        return 'Spielt auf einem Server';
      default:
        return 'Im Spiel';
    }
  }

  function inviteCard(entry) {
    const expires = entry.expires ? Math.max(0, Math.round((entry.expires - Date.now()) / 60_000)) : null;
    return h(
      'li',
      { class: 'card card--voice party-invite', dataset: { party: entry.party } },
      avatar(entry.from?.name, entry.from?.uuid),
      h(
        'div',
        { class: 'row-main' },
        h('p', { class: 'row-title', text: entry.leader && entry.leader.uuid !== entry.from?.uuid ? `${entry.from?.name} lädt dich in die Party von ${entry.leader.name} ein` : `${entry.from?.name} lädt dich in die Party ein` }),
        h('p', { class: 'row-sub', text: [plural(entry.members ?? 1, 'Mitglied', 'Mitglieder'), expires !== null ? `läuft in ${expires} Min. ab` : null, entry.quiet ? 'still (Nicht stören)' : null].filter(Boolean).join(' · ') }),
      ),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'btn btn--social btn--sm', dataset: { aktion: 'annehmen' }, onClick: (event) => accept(entry, event.currentTarget) }, icon('check'), 'Annehmen'),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'ablehnen' }, onClick: (event) => decline(entry, event.currentTarget) }, 'Ablehnen'),
      ),
    );
  }

  function renderInvites() {
    const list = invites();
    rerender($('party-einladungen'), JSON.stringify(list), () => (list.length ? h('ul', { class: 'party-invites' }, list.map(inviteCard)) : null));
  }

  function followBanner() {
    const follow = local.follow;
    const current = party();
    if (!follow || !current || follow.party !== current.id) return null;
    const target = joinTarget({ location: follow.target });
    return h(
      'div',
      { class: 'notice party-follow', role: 'status', id: 'party-folgen' },
      shellIcon('arrow'),
      h('span', { text: `${follow.leader?.name ?? 'Der Leiter'} ist auf ${follow.target?.title ?? 'einem neuen Ort'}` }),
      joinButton(target, { label: 'Folgen' }),
      h('button', { type: 'button', class: 'btn btn--ghost btn--icon btn--sm', 'aria-label': 'Ausblenden', onClick: () => ((local.follow = null), render()) }, icon('close')),
    );
  }

  function memberRow(member) {
    const me = member.uuid === meUuid();
    const leaderView = isLeader() && !me;
    const target = !me && member.location ? joinTarget({ location: member.location }) : null;
    return h(
      'li',
      { class: `row party-member${member.away ? ' is-away' : ''}`, dataset: { uuid: member.uuid } },
      avatar(member.name, member.uuid, { online: member.away ? null : presenceDot(member) }),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: me ? `${member.name} (du)` : displayName(friendByUuid(member.uuid)) || member.name }), member.leader ? h('span', { class: 'chip chip--reward chip--xs' }, shellIcon('crown'), 'Leitung') : null),
        h('div', { class: `row-sub${member.away ? '' : presenceClass(member)}`, text: memberLine(member) }),
      ),
      h(
        'div',
        { class: 'row-actions' },
        target ? joinButton(target, { variant: 'secondary' }) : null,
        leaderView ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'leitung' }, onClick: () => makeLeader(member) }, shellIcon('crown'), h('span', { class: 'label', text: 'Leitung' })) : null,
        leaderView ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon quiet-danger', 'aria-label': `${member.name} entfernen`, title: 'Entfernen', dataset: { aktion: 'entfernen' }, onClick: () => removeMember(member) }, icon('close')) : null,
      ),
    );
  }

  function inviteList() {
    const current = party();
    if (current && !isLeader()) return null;
    const friends = (store.friends?.friends ?? []).filter((friend) => canInvite(friend.uuid));
    if (!friends.length) return null;
    friends.sort((a, b) => presenceRank(b) - presenceRank(a) || displayName(a).localeCompare(displayName(b), 'de'));
    return h(
      'section',
      { class: 'card', 'aria-labelledby': 'party-einladen-titel' },
      h('div', { class: 'card__head' }, h('span', { class: 'icon-tile icon-tile--voice' }, icon('user-plus')), h('div', null, h('h2', { class: 'card__title', id: 'party-einladen-titel', text: current ? 'Freunde einladen' : 'Party starten' }), h('p', { class: 'tiny text-3', text: current ? 'Einladungen gelten 10 Minuten.' : 'Lade einen Freund ein – damit entsteht deine Party, und du leitest sie.' }))),
      h(
        'ul',
        { class: 'rows', id: 'party-freunde' },
        friends.slice(0, 30).map((friend) =>
          h(
            'li',
            { class: 'row', dataset: { uuid: friend.uuid } },
            avatar(friend.name, friend.uuid, { online: presenceDot(friend) }),
            h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: displayName(friend) }), h('div', { class: `row-sub${presenceClass(friend)}`, text: { game: 'Online', launcher: 'Im Launcher – sieht die Einladung sofort', offline: 'Offline – sieht die Einladung im Launcher oder hier' }[presenceOf(friend)] })),
            h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn--social btn--sm', dataset: { aktion: 'einladen' }, onClick: (event) => invite(friend, event.currentTarget) }, shellIcon('party'), 'Einladen')),
          ),
        ),
      ),
    );
  }

  function renderChat(scroll = 'auto') {
    const box = $('party-chat-verlauf');
    if (!box) return;
    const chat = store.party?.chat ?? [];
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    box.replaceChildren(
      ...(chat.length
        ? chat.map((message) =>
            h(
              'div',
              { class: `msg ${message.from === meUuid() ? 'mine' : 'theirs'}`, dataset: { id: String(message.id) } },
              message.from === meUuid() ? null : h('span', { class: 'msg__author', text: message.name }),
              h('div', { class: 'msg__body' }, h('div', { class: 'bubble', text: message.text })),
              timeEl(message.at, formatTime(message.at)),
            ),
          )
        : [h('p', { class: 'chat-start', text: 'Noch nichts geschrieben. Der Party-Chat ist nur für diese Party und wird nicht gespeichert.' })]),
    );
    if (scroll === 'bottom' || nearBottom) box.scrollTop = box.scrollHeight;
  }

  function render() {
    renderInvites();
    const box = $('party-inhalt');
    if (local.available === false) {
      box.replaceChildren(h('section', { class: 'card' }, emptyState('Die Party gibt es mit dem Heldix-Dienst ab Version 1.12.0. Dieser Dienst kennt sie noch nicht.', 'friends')));
      return;
    }
    if (!store.party) {
      if (!box.firstChild) box.replaceChildren(h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Party wird geladen …' })));
      return;
    }
    const current = party();
    const signature = JSON.stringify([current && { ...current, chat: undefined }, store.friends?.friends.map((friend) => [friend.uuid, presenceOf(friend), friend.nickname]), local.follow]);
    if (box.dataset.signature === signature && box.firstChild) return;
    const keepChat = $('party-chat-text')?.value ?? '';
    const focusChat = document.activeElement?.id === 'party-chat-text';
    box.dataset.signature = signature;
    if (!current) {
      box.replaceChildren(
        h(
          'section',
          { class: 'card party-empty' },
          h('div', { class: 'card__head' }, h('span', { class: 'icon-tile icon-tile--voice' }, shellIcon('party')), h('div', null, h('h2', { class: 'card__title', text: 'Gerade keine Party' }), h('p', { class: 'tiny text-3', text: 'Bis zu 8 Freunde, ein Leiter. Wechselt der Leiter den Server oder die Welt, könnt ihr mit einem Klick folgen – und wer am selben Ort ist, landet automatisch in einer gemeinsamen Voice-Gruppe.' }))),
        ),
        inviteList() ?? h('section', { class: 'card' }, emptyState('Du brauchst Freunde, um eine Party zu starten.', 'friends')),
      );
      return;
    }
    const leader = current.members.find((member) => member.leader);
    const target = !current.members.find((member) => member.uuid === meUuid())?.location || current.target?.address !== current.members.find((member) => member.uuid === meUuid())?.location?.address ? joinTarget({ location: current.target }) : null;
    const counter = h('span', { class: 'counter', id: 'party-chat-zaehler' });
    const input = h('input', { class: 'input', id: 'party-chat-text', maxlength: String(MAX_TEXT), autocomplete: 'off', placeholder: 'An alle in der Party …', value: keepChat });
    const form = h('form', { class: 'chat-form', id: 'party-chat-form', novalidate: true }, h('label', { class: 'sr-only', for: 'party-chat-text', text: 'Nachricht an die Party' }), input, h('button', { type: 'submit', class: 'btn btn--primary', id: 'party-chat-senden', 'aria-label': 'Senden' }, icon('send'), h('span', { class: 'label', text: 'Senden' })));
    form.addEventListener('submit', sendChat);
    box.replaceChildren(
      followBanner() ?? '',
      h(
        'section',
        { class: 'card card--voice party-main', id: 'party-karte', 'aria-labelledby': 'party-titel' },
        h(
          'div',
          { class: 'card__head' },
          h('span', { class: 'icon-tile icon-tile--voice' }, shellIcon('party')),
          h('div', null, h('h2', { class: 'card__title', id: 'party-titel', text: `Party von ${leader?.uuid === meUuid() ? 'dir' : leader?.name ?? '?'}` }), h('p', { class: 'tiny text-3', id: 'party-stand', text: `${current.members.length} von ${current.max ?? 8} · seit ${relativeTime(current.created).replace(/^vor /, '')}` })),
          h('button', { type: 'button', class: 'btn btn--ghost btn--sm card__head-end', id: 'party-verlassen', onClick: leave }, shellIcon('logout'), 'Verlassen'),
        ),
        current.target ? h('div', { class: 'party-target' }, shellIcon(current.target.kind === 'world' ? 'world' : 'server'), h('span', null, h('span', { class: 'tiny text-3', text: 'Die Party ist gerade ' }), h('strong', { text: `${current.target.kind === 'world' ? 'in der Welt' : 'auf'} ${current.target.title}` })), target ? joinButton(target) : h('span', { class: 'chip chip--online', text: 'Du bist dort' })) : null,
        current.voice ? h('p', { class: 'chip chip--voice party-voice' }, shellIcon('headset'), 'Party-Voice aktiv – ihr seid am selben Ort') : null,
        h('ul', { class: 'rows', id: 'party-mitglieder' }, current.members.map(memberRow)),
        current.invites.length
          ? h(
              'div',
              { class: 'party-pending' },
              h('h3', { class: 'list-title', text: `Eingeladen (${current.invites.length})` }),
              h(
                'ul',
                { class: 'rows' },
                current.invites.map((entry) =>
                  h(
                    'li',
                    { class: 'row', dataset: { uuid: entry.uuid } },
                    avatar(entry.name, entry.uuid),
                    h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: entry.name }), h('div', { class: 'row-sub', text: `eingeladen ${relativeTime(entry.at)}` })),
                    isLeader() ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'zurueckziehen' }, onClick: (event) => withdraw(entry, event.currentTarget) }, 'Zurückziehen')) : null,
                  ),
                ),
              ),
            )
          : null,
      ),
      h(
        'section',
        { class: 'card party-chat', 'aria-labelledby': 'party-chat-titel' },
        h('div', { class: 'card__head' }, h('span', { class: 'icon-tile' }, icon('chat')), h('div', null, h('h2', { class: 'card__title', id: 'party-chat-titel', text: 'Party-Chat' }), h('p', { class: 'tiny text-3', text: 'Nur für diese Party, nicht gespeichert' }))),
        h('div', { class: 'chat-scroll party-chat__log', id: 'party-chat-verlauf', role: 'log', 'aria-live': 'polite', 'aria-labelledby': 'party-chat-titel', tabindex: '0' }),
        form,
        h('p', { class: 'form-error', id: 'party-chat-fehler', role: 'alert', hidden: true }),
        h('div', { class: 'chat-note' }, h('span', { text: 'Gleiche Regeln wie bei Nachrichten.' }), counter),
      ),
      inviteList() ?? '',
    );
    bindCounter(input, counter, MAX_TEXT);
    renderChat('bottom');
    if (focusChat) input.focus();
  }

  // -------------------------------------------------------------------------------------------------------
  // Echtzeit
  // -------------------------------------------------------------------------------------------------------

  function handleEvent(message) {
    switch (message.type) {
      case 'party': {
        const before = party();
        apply({ party: message.party ?? null });
        if (!message.party && before) {
          local.follow = null;
          toast(message.reason === 'removed' ? 'Du bist nicht mehr in der Party.' : message.reason === 'dissolved' ? 'Die Party hat sich aufgelöst.' : 'Du hast die Party verlassen.');
        }
        return true;
      }
      case 'party-invite':
        apply({ invites: Array.isArray(message.invites) ? message.invites : invites() });
        if (message.invite) ctx.hint('party', `${message.invite.from?.name ?? 'Ein Freund'} lädt dich in die Party ein`, { section: 'party', quiet: Boolean(message.invite.quiet) });
        return true;
      case 'party-chat':
        if (party()?.id === message.party && message.message) {
          addChat(message.message);
          if (message.message.from !== meUuid() && ctx.shell.current() !== 'party') ctx.hint('party-chat', `Party · ${message.message.name}: ${message.message.text}`, { section: 'party' });
        }
        return true;
      case 'party-follow':
        local.follow = message;
        render();
        ctx.hint('party', `${message.leader?.name ?? 'Der Leiter'} ist auf ${message.target?.title ?? 'einem neuen Ort'} – Beitreten`, { section: 'party' });
        return true;
      default:
        return false;
    }
  }

  ctx.on('party', render);
  ctx.on('friends', () => {
    if (ctx.shell.current() === 'party') render();
  });
  // Ablaufzeiten der Einladungen ab und zu neu zeigen
  local.timer = setInterval(() => {
    if (invites().length) renderInvites();
  }, 30_000);

  return {
    refresh,
    render,
    handleEvent,
    canInvite,
    invite,
    available: () => local.available,
    onTab(name) {
      if (name !== 'party') return;
      render();
      refresh().catch(showError);
    },
    reset() {
      local.follow = null;
      local.available = null;
    },
  };
}
