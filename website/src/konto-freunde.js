// HeldixClient – Webseite: Konto → „Freunde“ (Freunde 2.0, Heldix-Dienst 1.12.0).
//
// - Liste mit Favoriten (oben), Spitznamen, Abzeichen, Statustext, „Nicht stören“, „zuletzt online“; Filter (Alle,
//   Online, Favoriten) und Suche (Name oder Spitzname). Aktionen: Beitreten, Nachricht, Profilkarte.
// - Profilkarte (GET /v1/friends/<uuid>/profile): gemeinsame Freunde, Cape und Cosmetics, eigene Angaben (Favorit,
//   Spitzname, Notiz – nur für dich, PATCH /v1/friends/<uuid>), Nachricht, Party, Beitreten, Entfernen, Blockieren, Melden.
// - Anfragen (annehmen, ablehnen, zurückziehen), Freund hinzufügen, Vorschläge (Freunde von Freunden, freiwillig).
// - Echtzeit: friends (ganzer Stand), friend (ein Freund), request, accepted.
// Ältere Dienste (bis 1.11) kennen Favoriten, Profilkarte und Vorschläge nicht: dann bleiben diese Teile weg.
import {
  avatar,
  busy,
  capeName,
  confirmAction,
  emptyState,
  formatDate,
  h,
  icon,
  isPlayerName,
  openDialog,
  reasonLabel,
  relativeTime,
  REPORT_REASONS,
  rerender,
  showError,
  toast,
  uid,
} from './app-common.js';
import { shellIcon } from './app-shell.js';
import { badgeMark, displayName, friendLine, friendsSummary, joinButton, joinTarget, sortFriends } from './konto-sozial.js';
import { badgeLabel } from './rollen.js';

const MAX_NICKNAME = 24;
const MAX_NOTE = 200;
const MAX_REPORT_NOTE = 300;

export function initFriends(ctx) {
  const { call, store } = ctx;
  const $ = (id) => document.getElementById(id);
  const local = { filter: 'alle', query: '', suggestions: null, features: { patch: true, profile: true } };

  // -------------------------------------------------------------------------------------------------------
  // Stand
  // -------------------------------------------------------------------------------------------------------

  function apply(data, { silent = false } = {}) {
    if (!data) return;
    store.friends = {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incoming: Array.isArray(data.incoming) ? data.incoming : [],
      outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
      unread: data.unread && typeof data.unread === 'object' ? data.unread : store.friends?.unread ?? {},
    };
    if (!silent) ctx.emit('friends');
  }

  async function refresh() {
    apply(await call('GET', '/v1/friends'));
  }

  /** Ein Freund hat sich geändert (Echtzeit `friend` oder PATCH): ersetzen, Online-Hinweis prüfen. */
  function replaceFriend(friend) {
    if (!friend?.uuid || !store.friends) return;
    const list = store.friends.friends;
    const index = list.findIndex((entry) => entry.uuid === friend.uuid);
    const before = index >= 0 ? list[index] : null;
    if (index >= 0) list[index] = { ...list[index], ...friend };
    else list.push(friend);
    if (before && !before.online && friend.online) ctx.hint('online', `${displayName(friend)} ist jetzt online`, { friend: { ...before, ...friend } });
    ctx.emit('friends');
  }

  const friendByUuid = (uuid) => store.friends?.friends.find((friend) => friend.uuid === uuid) ?? null;

  // -------------------------------------------------------------------------------------------------------
  // Liste
  // -------------------------------------------------------------------------------------------------------

  function visibleFriends() {
    const query = local.query.trim().toLowerCase();
    let list = store.friends?.friends ?? [];
    if (local.filter === 'online') list = list.filter((friend) => friend.online);
    if (local.filter === 'favoriten') list = list.filter((friend) => friend.favorite);
    if (query) list = list.filter((friend) => friend.name.toLowerCase().includes(query) || (friend.nickname ?? '').toLowerCase().includes(query));
    return sortFriends(list);
  }

  function friendRow(friend) {
    const target = friend.online && friend.server ? joinTarget({ server: friend.server, worldDomain: ctx.worldDomain() }) : null;
    const worldName = target?.kind === 'world' ? ctx.worldName(target.address) : null;
    return h(
      'li',
      { class: `row friend-row${friend.favorite ? ' is-favorite' : ''}`, dataset: { uuid: friend.uuid } },
      avatar(friend.name, friend.uuid, { online: Boolean(friend.online) }),
      h(
        'div',
        { class: 'row-main' },
        h(
          'div',
          { class: 'row-title' },
          h('span', { class: 'row-name', text: displayName(friend) }),
          friend.nickname ? h('span', { class: 'row-realname', text: friend.name }) : null,
          badgeMark(friend.badge),
          friend.favorite ? h('span', { class: 'fav-mark', title: 'Favorit', 'aria-label': 'Favorit' }, shellIcon('star')) : null,
          friend.dnd && friend.online ? h('span', { class: 'chip chip--danger chip--xs', text: 'Nicht stören' }) : null,
        ),
        h('div', { class: `row-sub${friend.online ? ' online' : ''}`, text: friendLine(friend, { worldName }) }),
        friend.statusText ? h('div', { class: 'row-status', text: `„${friend.statusText}“` }) : null,
      ),
      h(
        'div',
        { class: 'row-actions' },
        target ? joinButton(target, { focusKey: `${friend.uuid}:join` }) : null,
        h('button', { type: 'button', class: 'btn btn--secondary btn--sm btn--icon', 'aria-label': `Nachricht an ${displayName(friend)}`, title: 'Nachricht', dataset: { focusKey: `${friend.uuid}:chat`, aktion: 'chat' }, onClick: () => ctx.openChat(friend.uuid) }, icon('chat')),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon', 'aria-label': `Profil von ${displayName(friend)}`, title: 'Profil und mehr', dataset: { focusKey: `${friend.uuid}:profil`, aktion: 'profil' }, onClick: () => openProfile(friend.uuid) }, icon('more')),
      ),
    );
  }

  function renderList() {
    const friends = store.friends?.friends ?? [];
    $('freunde-anzahl').textContent = friends.length ? `(${friends.length})` : '';
    $('freunde-stand').textContent = store.friends ? friendsSummary(friends, store.friends.incoming.length) : 'Wird geladen …';
    const list = visibleFriends();
    rerender($('freunde'), JSON.stringify([list, local.filter, local.query, ctx.worldDomain()]), () => {
      if (!store.friends) return null;
      if (!friends.length) return emptyState('Noch keine Freunde. Schick rechts eine Anfrage mit dem Spielernamen – oder lade Freunde ein.', 'friends');
      if (!list.length) return emptyState(local.filter === 'favoriten' ? 'Noch keine Favoriten. Markiere Freunde in ihrer Profilkarte mit einem Stern.' : local.filter === 'online' ? 'Gerade ist keiner deiner Freunde im Spiel.' : 'Kein Freund passt zur Suche.', local.filter === 'favoriten' ? 'star' : 'search');
      return h('ul', { class: 'rows friend-list' }, list.map(friendRow));
    });
  }

  function requestRow(request, incoming) {
    return h(
      'li',
      { class: 'row' },
      avatar(request.name, request.uuid),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: request.name }), h('div', { class: 'row-sub', text: incoming ? `möchte mit dir befreundet sein · ${relativeTime(request.at)}` : `Anfrage gesendet ${relativeTime(request.at)}` })),
      h(
        'div',
        { class: 'row-actions' },
        incoming ? h('button', { type: 'button', class: 'btn btn--primary btn--sm', dataset: { focusKey: `${request.uuid}:accept` }, onClick: (event) => acceptRequest(event.currentTarget, request) }, icon('check'), 'Annehmen') : null,
        incoming
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { focusKey: `${request.uuid}:decline` }, onClick: (event) => removeRequest(event.currentTarget, request, 'abgelehnt') }, 'Ablehnen')
          : h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { focusKey: `${request.uuid}:withdraw` }, onClick: (event) => removeRequest(event.currentTarget, request, 'zurückgezogen') }, 'Zurückziehen'),
      ),
    );
  }

  function renderRequests() {
    const incoming = store.friends?.incoming ?? [];
    const outgoing = store.friends?.outgoing ?? [];
    $('anfragen-karte').hidden = !incoming.length && !outgoing.length;
    rerender($('anfragen'), JSON.stringify([incoming, outgoing]), () => [
      incoming.length ? h('h3', { class: 'list-title', text: `An dich (${incoming.length})` }) : null,
      incoming.length ? h('ul', { class: 'rows' }, incoming.map((request) => requestRow(request, true))) : null,
      outgoing.length ? h('h3', { class: 'list-title', text: `Von dir (${outgoing.length})` }) : null,
      outgoing.length ? h('ul', { class: 'rows' }, outgoing.map((request) => requestRow(request, false))) : null,
    ]);
  }

  function renderSuggestions() {
    const data = local.suggestions;
    const list = data?.enabled ? data.suggestions : [];
    $('vorschlaege-karte').hidden = !list.length;
    rerender($('vorschlaege'), JSON.stringify(list), () =>
      h(
        'ul',
        { class: 'rows' },
        list.map((entry) =>
          h(
            'li',
            { class: 'row' },
            avatar(entry.name, entry.uuid, { skin: null }),
            h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: entry.name }), h('div', { class: 'row-sub', text: entry.mutual === 1 ? '1 gemeinsamer Freund' : `${entry.mutual} gemeinsame Freunde` })),
            h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { focusKey: `vorschlag:${entry.uuid}` }, onClick: (event) => requestSuggestion(event.currentTarget, entry) }, icon('user-plus'), 'Anfrage')),
          ),
        ),
      ),
    );
  }

  function render() {
    if (!store.friends) return;
    renderList();
    renderRequests();
    renderSuggestions();
  }

  async function loadSuggestions() {
    try {
      local.suggestions = await call('GET', '/v1/friends/suggestions');
    } catch (error) {
      if (error.status !== 404) throw error;
      local.suggestions = { enabled: false, suggestions: [] };
    }
    renderSuggestions();
  }

  // -------------------------------------------------------------------------------------------------------
  // Aktionen
  // -------------------------------------------------------------------------------------------------------

  async function onSubmit(event) {
    event.preventDefault();
    const input = $('freund-name');
    const error = $('freund-fehler');
    const name = input.value.trim();
    error.hidden = true;
    if (!isPlayerName(name)) {
      error.textContent = 'Ein Spielername hat 1 bis 16 Zeichen: Buchstaben, Ziffern und _.';
      error.hidden = false;
      input.focus();
      return;
    }
    const button = event.currentTarget.querySelector('button[type="submit"]');
    try {
      const data = await busy(button, () => call('POST', '/v1/friends/requests', { name }));
      apply(data);
      input.value = '';
      const friend = store.friends.friends.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
      toast(friend ? `Ihr seid jetzt Freunde: ${friend.name} hatte dir schon eine Anfrage geschickt.` : `Anfrage an ${name} gesendet.`, 'success');
    } catch (problem) {
      if (problem.status === 401) return;
      error.textContent = problem.message;
      error.hidden = false;
      input.focus();
    }
  }

  async function acceptRequest(button, request) {
    try {
      apply(await busy(button, () => call('POST', `/v1/friends/requests/${request.uuid}/accept`)));
      toast(`Du bist jetzt mit ${request.name} befreundet.`, 'success');
    } catch (error) {
      showError(error);
    }
  }

  async function removeRequest(button, request, verb) {
    try {
      apply(await busy(button, () => call('DELETE', `/v1/friends/requests/${request.uuid}`)));
      toast(`Anfrage ${verb === 'abgelehnt' ? 'von' : 'an'} ${request.name} ${verb}.`);
    } catch (error) {
      showError(error);
    }
  }

  async function requestSuggestion(button, entry) {
    try {
      apply(await busy(button, () => call('POST', `/v1/friends/suggestions/${entry.uuid}/request`)));
      local.suggestions = { ...local.suggestions, suggestions: local.suggestions.suggestions.filter((item) => item.uuid !== entry.uuid) };
      renderSuggestions();
      toast(`Anfrage an ${entry.name} gesendet.`, 'success');
    } catch (error) {
      if (error.status === 404) loadSuggestions().catch(() => {});
      showError(error);
    }
  }

  async function removeFriend(friend) {
    const ok = await confirmAction({
      title: `${friend.name} entfernen?`,
      text: `Ihr seht euch nicht mehr in der Freundesliste, und eure Nachrichten werden gelöscht – auch Favorit, Spitzname und Notiz. ${friend.name} erfährt es nicht ausdrücklich, sieht dich aber nicht mehr als Freund.`,
      confirmLabel: 'Entfernen',
      danger: true,
      onConfirm: async () => apply(await call('DELETE', `/v1/friends/${friend.uuid}`)),
    });
    if (!ok) return false;
    ctx.emit('friend-removed', friend.uuid);
    toast(`${friend.name} ist nicht mehr in deiner Freundesliste.`);
    return true;
  }

  async function blockPlayer(target) {
    const friend = friendByUuid(target.uuid);
    const ok = await confirmAction({
      title: `${target.name} blockieren?`,
      text: [
        friend ? `Eure Freundschaft endet, eure Nachrichten werden gelöscht, und ${target.name} kann dir keine Anfragen mehr schicken.` : `${target.name} kann dir keine Anfragen mehr schicken.`,
        `${target.name} erfährt nicht, dass du blockiert hast. Freigeben kannst du später unter Privatsphäre.`,
      ],
      confirmLabel: 'Blockieren',
      danger: true,
      onConfirm: () => call('POST', '/v1/blocks', target.uuid ? { uuid: target.uuid } : { name: target.name }),
    });
    if (!ok) return false;
    if (target.uuid) ctx.emit('friend-removed', target.uuid);
    toast(`${target.name} ist blockiert.`, 'success');
    refresh().catch(() => {});
    return true;
  }

  async function reportPlayer(target) {
    const { name, uuid } = target;
    const groupName = uid('grund');
    const noteId = uid('notiz');
    const counter = h('span', { class: 'counter', text: `0/${MAX_REPORT_NOTE}` });
    const note = h('input', { class: 'input', id: noteId, maxlength: String(MAX_REPORT_NOTE), autocomplete: 'off', placeholder: 'Was ist passiert?' });
    note.addEventListener('input', () => {
      counter.textContent = `${[...note.value].length}/${MAX_REPORT_NOTE}`;
    });
    const reasons = h(
      'fieldset',
      { class: 'choices' },
      h('legend', { text: 'Grund' }),
      REPORT_REASONS.map(([id, label]) => h('label', { class: 'choice' }, h('input', { type: 'radio', name: groupName, value: id }), h('span', { text: label }))),
    );
    const ok = await openDialog({
      title: `${name} melden`,
      body: [
        h('p', { text: `Melde ${name}, wenn er dich belästigt, spammt oder gegen die Regeln verstößt.` }),
        reasons,
        h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { for: noteId, text: 'Hinweis (freiwillig)' }), counter), note),
        h('p', { class: 'info-box small' }, icon('info'), h('span', { text: `Mit der Meldung gehen die letzten 20 Nachrichten eures Chats an den Betreiber des Heldix-Dienstes und sein Team, damit sie den Fall prüfen können. ${name} erfährt nicht, wer ihn gemeldet hat.` })),
      ],
      confirmLabel: 'Meldung senden',
      canConfirm: () => Boolean(reasons.querySelector('input:checked')),
      focus: 'input[type="radio"]',
      onConfirm: async () => {
        const reason = reasons.querySelector('input:checked')?.value;
        const text = note.value.replace(/[\r\n]+/g, ' ').trim();
        await call('POST', '/v1/reports', { uuid, reason, ...(text ? { note: text } : {}) });
      },
    });
    if (ok) toast(`Danke! Deine Meldung zu ${name} ist beim Team. Du kannst ${name} zusätzlich blockieren.`, 'success');
    return Boolean(ok);
  }

  /** Eigene Angaben zu einem Freund speichern (PATCH). */
  async function patchFriend(uuid, patch) {
    const data = await call('PATCH', `/v1/friends/${uuid}`, patch);
    if (data?.friend) replaceFriend(data.friend);
    return data?.friend ?? null;
  }

  // -------------------------------------------------------------------------------------------------------
  // Profilkarte
  // -------------------------------------------------------------------------------------------------------

  let profileDialog = null;

  function closeProfile() {
    if (!profileDialog) return;
    const { dialog, opener } = profileDialog;
    profileDialog = null;
    dialog.close();
    dialog.remove();
    if (opener?.isConnected) opener.focus();
  }

  async function openProfile(uuid) {
    const friend = friendByUuid(uuid);
    if (!friend) return;
    closeProfile();
    const titleId = uid('profil-titel');
    const body = h('div', { class: 'profile-card__body' }, h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Profil wird geladen …' })));
    const closeButton = h('button', { type: 'button', class: 'btn btn--ghost btn--icon btn--sm', 'aria-label': 'Schließen', onClick: closeProfile }, icon('close'));
    const dialog = h('dialog', { class: 'modal profile-card', 'aria-labelledby': titleId, id: 'profilkarte' }, h('div', { class: 'profile-card__top' }, h('h2', { class: 'sr-only', id: titleId, text: `Profil von ${friend.name}` }), closeButton), body);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeProfile();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeProfile();
    });
    document.body.append(dialog);
    profileDialog = { dialog, opener: document.activeElement, uuid };
    dialog.showModal();
    closeButton.focus();
    let profile = null;
    try {
      profile = await call('GET', `/v1/friends/${uuid}/profile`);
    } catch (error) {
      if (error.status === 404 && !friendByUuid(uuid)) {
        closeProfile();
        return showError(error);
      }
      // Älterer Dienst ohne Profilkarte: nur, was die Liste weiß
      profile = { friend, mutual: null, cape: null, cosmetics: null };
    }
    if (!profileDialog || profileDialog.uuid !== uuid) return;
    renderProfile(body, profile);
  }

  function renderProfile(body, profile) {
    const friend = { ...friendByUuid(profile.friend?.uuid ?? ''), ...(profile.friend ?? {}) };
    const target = friend.online && friend.server ? joinTarget({ server: friend.server, worldDomain: ctx.worldDomain() }) : null;
    const favorite = h('button', { type: 'button', class: `btn btn--secondary btn--sm fav-toggle${friend.favorite ? ' is-on' : ''}`, 'aria-pressed': String(Boolean(friend.favorite)), id: 'profil-favorit' }, shellIcon('star'), friend.favorite ? 'Favorit' : 'Als Favorit');
    favorite.addEventListener('click', async () => {
      const next = !(favorite.getAttribute('aria-pressed') === 'true');
      try {
        await busy(favorite, () => patchFriend(friend.uuid, { favorite: next }));
        favorite.setAttribute('aria-pressed', String(next));
        favorite.classList.toggle('is-on', next);
        favorite.lastChild.textContent = next ? 'Favorit' : 'Als Favorit';
      } catch (error) {
        showError(error);
      }
    });
    const nickId = uid('spitzname');
    const noteId = uid('notiz');
    const nick = h('input', { class: 'input', id: nickId, maxlength: String(MAX_NICKNAME), autocomplete: 'off', placeholder: friend.name, value: friend.nickname ?? '' });
    const note = h('textarea', { class: 'textarea input', id: noteId, maxlength: String(MAX_NOTE), rows: '2', placeholder: 'z. B. kennt sich mit Redstone aus', value: friend.note ?? '' });
    const saved = h('span', { class: 'saved', 'aria-live': 'polite' });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const save = h('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, icon('check'), 'Speichern');
    const form = h(
      'form',
      { class: 'profile-card__own', novalidate: true },
      h('p', { class: 'eyebrow', text: 'Nur für dich' }),
      h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Spitzname' }), nick),
      h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Notiz' }), note),
      error,
      h('div', { class: 'btn-group' }, save, saved),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      const nickname = nick.value.replace(/[\r\n]+/g, ' ').trim();
      const text = note.value.replace(/[\r\n]+/g, ' ').trim();
      try {
        await busy(save, () => patchFriend(friend.uuid, { nickname: nickname || null, note: text || null }));
        saved.textContent = 'Gespeichert';
        setTimeout(() => (saved.textContent = ''), 2200);
      } catch (problem) {
        error.textContent = problem.message;
        error.hidden = false;
      }
    });
    const look = [];
    if (profile.cape) look.push(h('li', { class: 'chip' }, icon('cape'), `Cape: ${capeName(profile.cape)}`));
    for (const [slot, label] of [['head', 'Kopf'], ['back', 'Rücken'], ['aura', 'Aura'], ['companion', 'Begleiter']]) {
      const id = profile.cosmetics?.[slot];
      if (id) look.push(h('li', { class: 'chip' }, icon('sparkles'), `${label}: ${ctx.cosmeticName(id) ?? id}`));
    }
    const mutual = Array.isArray(profile.mutual) ? profile.mutual : null;
    const actions = h(
      'div',
      { class: 'profile-card__actions' },
      target ? joinButton(target, { label: 'Beitreten' }) : null,
      h('button', { type: 'button', class: 'btn btn--secondary btn--sm', id: 'profil-nachricht', onClick: () => (closeProfile(), ctx.openChat(friend.uuid)) }, icon('chat'), 'Nachricht'),
      ctx.canInviteToParty(friend.uuid) ? h('button', { type: 'button', class: 'btn btn--social btn--sm', id: 'profil-party', onClick: async (event) => (await ctx.inviteToParty(friend, event.currentTarget)) && closeProfile() }, shellIcon('party'), 'In Party einladen') : null,
    );
    const danger = h(
      'div',
      { class: 'profile-card__danger' },
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm quiet-danger', id: 'profil-entfernen', onClick: async () => (await removeFriend(friend)) && closeProfile() }, icon('trash'), 'Entfernen'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'profil-blockieren', onClick: async () => (await blockPlayer({ uuid: friend.uuid, name: friend.name })) && closeProfile() }, icon('ban'), 'Blockieren'),
      h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'profil-melden', onClick: () => reportPlayer({ uuid: friend.uuid, name: friend.name }) }, icon('flag'), 'Melden'),
    );
    body.replaceChildren(
      h(
        'div',
        { class: 'profile-card__head' },
        avatar(friend.name, friend.uuid, { size: 'xl', online: Boolean(friend.online) }),
        h(
          'div',
          { class: 'profile-card__who' },
          h('p', { class: 'profile-card__name' }, h('strong', { text: displayName(friend) }), badgeMark(friend.badge, 18)),
          friend.nickname ? h('p', { class: 'tiny text-3', text: `Spielername: ${friend.name}` }) : null,
          friend.badge ? h('p', { class: 'tiny text-3', text: badgeLabel(friend.badge) }) : null,
          h('p', { class: `small ${friend.online ? 'text-online' : 'text-2'}`, text: friendLine(friend) }),
          friend.statusText ? h('p', { class: 'profile-card__status', text: `„${friend.statusText}“` }) : null,
        ),
        favorite,
      ),
      actions,
      h(
        'dl',
        { class: 'profile-card__facts' },
        friend.since ? h('div', null, h('dt', { text: 'Freunde seit' }), h('dd', { text: formatDate(friend.since) })) : null,
        mutual ? h('div', null, h('dt', { text: 'Gemeinsame Freunde' }), h('dd', { text: mutual.length ? mutual.map((entry) => entry.name).join(', ') : 'keine' })) : null,
      ),
      look.length ? h('ul', { class: 'look-chips', 'aria-label': 'Trägt gerade' }, look) : profile.cape === '' ? h('p', { class: 'tiny text-3', text: `${friend.name} zeigt Cape und Cosmetics gerade niemandem.` }) : null,
      local.features.patch ? form : null,
      danger,
    );
  }

  // -------------------------------------------------------------------------------------------------------
  // Echtzeit
  // -------------------------------------------------------------------------------------------------------

  function handleEvent(message) {
    switch (message.type) {
      case 'friends':
        apply(message);
        return true;
      case 'friend':
        replaceFriend(message.friend);
        return true;
      case 'request':
        if (message.from?.name) ctx.hint('request', `${message.from.name} möchte mit dir befreundet sein`, { section: 'freunde' });
        return true;
      case 'accepted':
        if (message.friend?.name) ctx.hint('request', `${message.friend.name} hat deine Anfrage angenommen`, { section: 'freunde' });
        return true;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------------------------------------

  $('freund-form').addEventListener('submit', onSubmit);
  $('freunde-filter').addEventListener('change', (event) => {
    local.filter = event.target.value;
    renderList();
  });
  $('freunde-suche').addEventListener('input', (event) => {
    local.query = event.target.value;
    renderList();
  });
  ctx.on('friends', render);
  ctx.on('worlds', renderList);

  return {
    apply,
    refresh,
    render,
    friendByUuid,
    openProfile,
    blockPlayer,
    reportPlayer,
    removeFriend,
    handleEvent,
    reasonLabel,
    onTab(name) {
      if (name !== 'freunde') return;
      refresh().catch(showError);
      loadSuggestions().catch(() => {});
    },
    reset() {
      local.suggestions = null;
      closeProfile();
    },
  };
}
