// HeldixClient – Webseite: Konto → „Nachrichten“ (Heldix-Dienst ab 1.12.0 mit Antworten, Reaktionen, Karten,
// „schreibt …“ und Löschen; ältere Dienste ohne diese Extras).
//
// - Links die Unterhaltungen (neueste zuerst) und weitere Freunde, rechts der Chat. Auf dem Handy nacheinander.
// - Nachricht: Antworten (Zitat), Reaktion (acht feste Emojis, eine je Person), eigene löschen (für beide).
// - Beitreten-Karten (Server, Welt, Einladung) mit „Beitreten“; Knopf „+“ teilt Server, eigene Welt oder Einladung.
// - Echtzeit: message, read, message-deleted, reaction, typing (über konto-live.js), sonst Abfrage.
import { avatar, bindCounter, busy, confirmAction, dayLabel, emptyState, formatTime, h, icon, loadingState, openDialog, rerender, shortWhen, showError, timeEl, toast, uid } from './app-common.js';
import { shellIcon } from './app-shell.js';
import { badgeMark, displayName, friendLine, joinCard, REACTIONS, reactionEmoji, reactionLabel, WORLD_CODE_RE } from './konto-sozial.js';

const PAGE_SIZE = 50;
const MAX_MESSAGE = 500;
const TYPING_SHOW_MS = 6_000;
const SERVER_RE = /^(?=.{3,253}$)(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/i;

export function initChat(ctx) {
  const { call, store, shell } = ctx;
  const $ = (id) => document.getElementById(id);
  const local = { chat: null, reply: null, typing: new Map(), readPending: new Set(), picker: null };

  const friendByUuid = (uuid) => store.friends?.friends.find((friend) => friend.uuid === uuid) ?? null;
  const meUuid = () => store.me?.uuid;

  // -------------------------------------------------------------------------------------------------------
  // Unterhaltungen
  // -------------------------------------------------------------------------------------------------------

  async function refreshConversations() {
    const data = await call('GET', '/v1/messages');
    store.conversations = Array.isArray(data?.conversations) ? data.conversations : [];
    // Offener Chat: neue Nachrichten gelten als gelesen, sobald man hinsieht.
    if (local.chat && shell.current() === 'nachrichten' && document.visibilityState === 'visible') {
      const open = store.conversations.find((conversation) => conversation.uuid === local.chat.uuid);
      if (open?.unread) markRead(open.uuid);
    }
    ctx.emit('conversations');
  }

  function previewOf(message) {
    if (!message) return '';
    const mine = message.from === meUuid();
    let text = message.text;
    if (message.card?.kind === 'world') text = `Welt: ${message.card.title || message.card.target}`;
    else if (message.card?.kind === 'server') text = `Server: ${message.card.target}`;
    else if (message.card?.kind === 'invite') text = 'Einladung zu HeldixClient';
    return `${mine ? 'Du: ' : ''}${text}`;
  }

  function renderConversations() {
    const list = $('unterhaltungen');
    if (!store.conversations || !store.friends) {
      if (!list.firstChild) list.replaceChildren(loadingState());
      return;
    }
    const conversations = store.conversations;
    const withChat = new Set(conversations.map((conversation) => conversation.uuid));
    const collator = new Intl.Collator('de', { sensitivity: 'base' });
    const others = store.friends.friends.filter((friend) => !withChat.has(friend.uuid)).sort((a, b) => collator.compare(displayName(a), displayName(b)));
    const openUuid = local.chat?.uuid ?? '';
    const typing = [...local.typing.keys()];
    const signature = JSON.stringify([conversations, others.map((friend) => [friend.uuid, friend.name, friend.nickname, friend.online]), openUuid, typing, conversations.map((c) => friendByUuid(c.uuid)?.online)]);
    rerender(list, signature, () => {
      if (!conversations.length && !others.length) return emptyState('Noch keine Freunde – Nachrichten gehen nur an Freunde.', 'chat');
      const parts = [];
      if (conversations.length) {
        parts.push(
          h(
            'ul',
            { class: 'conv-items', 'aria-label': 'Unterhaltungen' },
            conversations.map((conversation) => {
              const friend = friendByUuid(conversation.uuid);
              const name = friend ? displayName(friend) : conversation.name;
              const isTyping = local.typing.has(conversation.uuid);
              return h(
                'li',
                null,
                h(
                  'button',
                  {
                    type: 'button',
                    class: `conv${conversation.unread ? ' unread' : ''}`,
                    'aria-current': conversation.uuid === openUuid ? 'true' : undefined,
                    dataset: { focusKey: `conv:${conversation.uuid}`, uuid: conversation.uuid },
                    onClick: () => openChat(conversation.uuid),
                  },
                  avatar(conversation.name, conversation.uuid, { online: friend ? Boolean(friend.online) : null }),
                  h(
                    'span',
                    { class: 'conv-main' },
                    h('span', { class: 'conv-top' }, h('span', { class: 'conv-name', text: name }), h('span', { class: 'conv-time', text: shortWhen(conversation.last?.at) })),
                    h(
                      'span',
                      { class: 'conv-bottom' },
                      h('span', { class: `conv-preview${isTyping ? ' is-typing' : ''}`, text: isTyping ? 'schreibt …' : previewOf(conversation.last) }),
                      conversation.unread ? h('span', { class: 'unread-badge count', text: String(conversation.unread), 'aria-label': `${conversation.unread} ungelesen` }) : null,
                    ),
                  ),
                ),
              );
            }),
          ),
        );
      }
      if (others.length) {
        parts.push(h('p', { class: 'conv-section', text: conversations.length ? 'Weitere Freunde' : 'Freunde' }));
        parts.push(
          h(
            'ul',
            { class: 'conv-items', 'aria-label': 'Weitere Freunde' },
            others.map((friend) =>
              h(
                'li',
                null,
                h(
                  'button',
                  { type: 'button', class: 'conv', 'aria-current': friend.uuid === openUuid ? 'true' : undefined, dataset: { focusKey: `conv:${friend.uuid}`, uuid: friend.uuid }, onClick: () => openChat(friend.uuid) },
                  avatar(friend.name, friend.uuid, { online: Boolean(friend.online) }),
                  h('span', { class: 'conv-main' }, h('span', { class: 'conv-top' }, h('span', { class: 'conv-name', text: displayName(friend) })), h('span', { class: 'conv-bottom' }, h('span', { class: 'conv-preview muted', text: 'Unterhaltung beginnen' }))),
                ),
              ),
            ),
          ),
        );
      }
      return parts;
    });
    if (local.chat) renderChatHead();
  }

  // -------------------------------------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------------------------------------

  function openFromElsewhere(uuid) {
    shell.select('nachrichten', { history: 'push', params: { mit: uuid } });
    if (local.chat?.uuid !== uuid) openChat(uuid);
  }

  async function openChat(uuid) {
    const friend = friendByUuid(uuid);
    const conversation = store.conversations?.find((entry) => entry.uuid === uuid);
    const name = friend?.name ?? conversation?.name ?? 'Freund';
    local.chat = { uuid, name, messages: [], more: false, loadingOlder: false, loaded: false };
    setReply(null);
    $('chat').classList.add('chat-open');
    $('chat-leer').hidden = true;
    $('chat-aktiv').hidden = false;
    $('chat-fehler').hidden = true;
    renderChatHead();
    renderTyping();
    renderConversations();
    $('chat-verlauf').replaceChildren(loadingState('Nachrichten werden geladen …'));
    // Auf dem Handy nicht gleich die Tastatur öffnen (sie würde den Verlauf verdecken).
    if (window.matchMedia('(min-width: 761px)').matches) $('chat-text').focus();
    else {
      $('chat-verlauf').focus({ preventScroll: true });
      $('chat').scrollIntoView({ block: 'start' });
    }
    try {
      const data = await call('GET', `/v1/messages/${uuid}?limit=${PAGE_SIZE}`);
      if (local.chat?.uuid !== uuid) return;
      local.chat.messages = Array.isArray(data?.messages) ? data.messages : [];
      local.chat.more = Boolean(data?.more);
      local.chat.loaded = true;
      renderMessages('bottom');
      markRead(uuid);
    } catch (error) {
      if (local.chat?.uuid !== uuid) return;
      if (error.status === 404) {
        closeChat();
        toast(error.message, 'error');
        ctx.refreshFriends();
        return;
      }
      $('chat-verlauf').replaceChildren(emptyState(error.message, 'warning'));
    }
  }

  function closeChat() {
    local.chat = null;
    setReply(null);
    closePicker();
    $('chat').classList.remove('chat-open');
    $('chat-leer').hidden = false;
    $('chat-aktiv').hidden = true;
    renderConversations();
  }

  function renderChatHead() {
    const { chat } = local;
    if (!chat) return;
    const friend = friendByUuid(chat.uuid);
    $('chat-avatar').replaceChildren(avatar(chat.name, chat.uuid, { online: friend ? Boolean(friend.online) : null }));
    const name = $('chat-name');
    name.replaceChildren(document.createTextNode(friend ? displayName(friend) : chat.name), badgeMark(friend?.badge) ?? '');
    const status = $('chat-status');
    status.textContent = friend ? friendLine(friend) : '';
    status.classList.toggle('online', Boolean(friend?.online));
    $('chat-profil').disabled = !friend;
    $('chat-party').hidden = !(friend && ctx.canInviteToParty(friend.uuid));
  }

  function quoteNode(message) {
    const reply = message.replyTo;
    if (!reply) return null;
    const original = local.chat.messages.find((entry) => entry.id === reply.id);
    const who = reply.from === null ? null : reply.from === meUuid() ? 'Du' : displayName(friendByUuid(reply.from)) || local.chat.name;
    const text = reply.text === null || reply.from === null ? 'Gelöschte Nachricht' : reply.text;
    const quote = h('button', { type: 'button', class: `msg__quote${reply.from === null ? ' is-deleted' : ''}`, title: original ? 'Zur Nachricht springen' : undefined }, who ? h('strong', { text: who }) : null, h('span', { text }));
    quote.addEventListener('click', () => {
      const target = $('chat-verlauf').querySelector(`.msg[data-id="${reply.id}"]`);
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1400);
    });
    return quote;
  }

  function reactionsNode(message) {
    const entries = Object.entries(message.reactions ?? {});
    if (!entries.length) return null;
    const counts = new Map();
    for (const [uuid, reaction] of entries) {
      const entry = counts.get(reaction) ?? { count: 0, mine: false, names: [] };
      entry.count++;
      if (uuid === meUuid()) entry.mine = true;
      entry.names.push(uuid === meUuid() ? 'Du' : displayName(friendByUuid(uuid)) || local.chat.name);
      counts.set(reaction, entry);
    }
    return h(
      'div',
      { class: 'msg__reactions' },
      REACTIONS.filter(([id]) => counts.has(id)).map(([id]) => {
        const entry = counts.get(id);
        return h(
          'button',
          { type: 'button', class: `reaction-chip${entry.mine ? ' is-mine' : ''}`, 'aria-pressed': String(entry.mine), title: `${entry.names.join(', ')}: ${reactionLabel(id)}`, 'aria-label': `${reactionLabel(id)} von ${entry.names.join(', ')}`, dataset: { reaction: id }, onClick: () => react(message, entry.mine ? null : id) },
          h('span', { class: 'reaction-chip__emoji', text: reactionEmoji(id) }),
          entry.count > 1 ? h('span', { text: String(entry.count) }) : null,
        );
      }),
    );
  }

  function messageNode(message, showTime) {
    const mine = message.from === meUuid();
    const features = ctx.features();
    const tools = features.extras
      ? h(
          'div',
          { class: 'msg__tools' },
          h('button', { type: 'button', class: 'msg__tool', 'aria-label': 'Antworten', title: 'Antworten', dataset: { tool: 'antworten' }, onClick: () => setReply(message) }, shellIcon('reply')),
          h('button', { type: 'button', class: 'msg__tool', 'aria-label': 'Reagieren', title: 'Reagieren', 'aria-haspopup': 'true', dataset: { tool: 'reagieren' }, onClick: (event) => openPicker(message, event.currentTarget) }, shellIcon('smile')),
          mine ? h('button', { type: 'button', class: 'msg__tool msg__tool--danger', 'aria-label': 'Löschen', title: 'Für beide löschen', dataset: { tool: 'loeschen' }, onClick: () => deleteMessage(message) }, icon('trash')) : null,
        )
      : null;
    return h(
      'div',
      { class: `msg ${mine ? 'mine' : 'theirs'}${showTime ? '' : ' grouped'}`, dataset: { id: String(message.id) } },
      h('span', { class: 'visually-hidden', text: mine ? 'Du: ' : `${local.chat.name}: ` }),
      h('div', { class: 'msg__body' }, quoteNode(message), h('div', { class: 'bubble', text: message.text }), message.card ? joinCard(message.card, { worldDomain: ctx.worldDomain() }) : null, reactionsNode(message)),
      tools,
      showTime ? timeEl(message.at, formatTime(message.at)) : null,
    );
  }

  function renderMessages(scroll) {
    const box = $('chat-verlauf');
    const { chat } = local;
    if (!chat) return;
    const previousHeight = box.scrollHeight;
    const previousTop = box.scrollTop;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const nodes = [];
    if (chat.more) {
      nodes.push(h('div', { class: 'older' }, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'chat-aeltere', disabled: chat.loadingOlder || undefined, onClick: loadOlder }, chat.loadingOlder ? 'Wird geladen …' : 'Ältere Nachrichten laden')));
    }
    if (!chat.messages.length) nodes.push(h('div', { class: 'chat-start' }, h('p', { text: `Noch keine Nachrichten mit ${chat.name}. Schreib die erste!` })));
    let lastDay = null;
    chat.messages.forEach((message, index) => {
      const day = dayLabel(message.at);
      if (day !== lastDay) {
        nodes.push(h('div', { class: 'day-sep', role: 'separator', text: day }));
        lastDay = day;
      }
      const next = chat.messages[index + 1];
      const showTime = !next || next.from !== message.from || next.at - message.at > 5 * 60 * 1000 || dayLabel(next.at) !== day;
      nodes.push(messageNode(message, showTime));
    });
    box.replaceChildren(...nodes);
    if (scroll === 'bottom' || (scroll === 'auto' && nearBottom)) box.scrollTop = box.scrollHeight;
    else if (scroll === 'keep-older') box.scrollTop = box.scrollHeight - previousHeight + previousTop;
    else box.scrollTop = previousTop;
  }

  async function loadOlder() {
    const { chat } = local;
    if (!chat || chat.loadingOlder || !chat.messages.length) return;
    const uuid = chat.uuid;
    chat.loadingOlder = true;
    renderMessages('keep');
    try {
      const data = await call('GET', `/v1/messages/${uuid}?before=${chat.messages[0].id}&limit=${PAGE_SIZE}`);
      if (local.chat?.uuid !== uuid) return;
      const known = new Set(chat.messages.map((message) => message.id));
      chat.messages = [...(data.messages ?? []).filter((message) => !known.has(message.id)), ...chat.messages];
      chat.more = Boolean(data.more);
    } catch (error) {
      showError(error);
    } finally {
      if (local.chat?.uuid === uuid) {
        chat.loadingOlder = false;
        renderMessages('keep-older');
        const older = $('chat-aeltere');
        if (older) older.focus();
        else $('chat-verlauf').focus();
      }
    }
  }

  /** Abgleich (Abfrage oder nach dem Verbinden): neueste Seite holen, neue anhängen, Geändertes übernehmen. */
  async function refreshChat() {
    const { chat } = local;
    if (!chat || !chat.loaded) return;
    const uuid = chat.uuid;
    let data;
    try {
      data = await call('GET', `/v1/messages/${uuid}?limit=${PAGE_SIZE}`);
    } catch (error) {
      if (error.status === 404 && local.chat?.uuid === uuid) {
        closeChat();
        toast(error.message, 'error');
      }
      return;
    }
    if (local.chat?.uuid !== uuid) return;
    const latest = Array.isArray(data?.messages) ? data.messages : [];
    const byId = new Map(latest.map((message) => [message.id, message]));
    const oldestLatest = latest.length ? latest[0].id : Infinity;
    const before = JSON.stringify(chat.messages);
    // Gelöschte (oder abgelaufene) weg, geänderte (Reaktionen) übernehmen, neue anhängen
    const kept = chat.messages.filter((message) => message.id < oldestLatest || byId.has(message.id)).map((message) => byId.get(message.id) ?? message);
    const lastId = kept.length ? kept[kept.length - 1].id : 0;
    const fresh = latest.filter((message) => message.id > lastId);
    chat.messages = [...kept, ...fresh];
    if (JSON.stringify(chat.messages) === before) return;
    if (fresh.length) clearTyping(uuid);
    renderMessages('auto');
  }

  async function markRead(uuid) {
    const conversation = store.conversations?.find((entry) => entry.uuid === uuid);
    if (!conversation || !conversation.unread || local.readPending.has(uuid)) return;
    local.readPending.add(uuid);
    try {
      await call('POST', `/v1/messages/${uuid}/read`);
      for (const entry of store.conversations ?? []) if (entry.uuid === uuid) entry.unread = 0;
      if (store.friends?.unread) delete store.friends.unread[uuid];
      ctx.emit('conversations');
    } catch {
      // Beim nächsten Abgleich erneut.
    } finally {
      local.readPending.delete(uuid);
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Senden, antworten, reagieren, löschen, teilen
  // -------------------------------------------------------------------------------------------------------

  function setReply(message) {
    local.reply = message ?? null;
    const bar = $('chat-antwort');
    bar.hidden = !message;
    if (!message) return;
    const mine = message.from === meUuid();
    $('chat-antwort-wer').textContent = mine ? 'Du' : displayName(friendByUuid(message.from)) || local.chat?.name || '';
    $('chat-antwort-text').textContent = [...message.text].length > 100 ? `${[...message.text].slice(0, 100).join('')}…` : message.text;
    $('chat-text').focus();
  }

  async function send({ text, card = null }) {
    const { chat } = local;
    if (!chat) return false;
    const uuid = chat.uuid;
    const body = { text };
    if (local.reply && ctx.features().extras) body.replyTo = local.reply.id;
    if (card) body.card = card;
    const data = await call('POST', `/v1/messages/${uuid}`, body);
    if (local.chat?.uuid === uuid && data?.message && !chat.messages.some((message) => message.id === data.message.id)) {
      chat.messages.push(data.message);
      renderMessages('bottom');
    }
    setReply(null);
    ctx.live?.resetTyping(uuid);
    refreshConversations().catch(() => {});
    return true;
  }

  async function onSend(event) {
    event.preventDefault();
    if (!local.chat) return;
    const input = $('chat-text');
    const error = $('chat-fehler');
    const text = input.value.replace(/[\r\n]+/g, ' ').trim();
    error.hidden = true;
    if (!text) return;
    if ([...text].length > MAX_MESSAGE) {
      error.textContent = `Die Nachricht ist zu lang (höchstens ${MAX_MESSAGE} Zeichen).`;
      error.hidden = false;
      return;
    }
    input.readOnly = true;
    try {
      await busy($('chat-senden'), () => send({ text }));
      input.value = '';
      input.dispatchEvent(new Event('input'));
    } catch (problem) {
      if (problem.status !== 401) {
        error.textContent = problem.message;
        error.hidden = false;
      }
    } finally {
      input.readOnly = false;
      input.focus();
    }
  }

  function closePicker() {
    if (!local.picker) return;
    local.picker.element.remove();
    const opener = local.picker.opener;
    local.picker = null;
    if (opener?.isConnected) opener.focus();
  }

  function openPicker(message, opener) {
    closePicker();
    const mine = message.reactions?.[meUuid()] ?? null;
    const element = h(
      'div',
      { class: 'reaction-picker', role: 'menu', 'aria-label': 'Reaktion wählen' },
      REACTIONS.map(([id, emoji, label]) =>
        h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(mine === id), class: `reaction-picker__item${mine === id ? ' is-mine' : ''}`, title: label, 'aria-label': label, dataset: { reaction: id }, onClick: () => (closePicker(), react(message, mine === id ? null : id)) }, emoji),
      ),
    );
    element.addEventListener('keydown', (event) => {
      const items = [...element.querySelectorAll('button')];
      const index = items.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePicker();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        items[(index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length].focus();
      }
    });
    opener.closest('.msg').append(element);
    local.picker = { element, opener, id: message.id };
    element.querySelector('button').focus();
  }

  async function react(message, reaction) {
    const { chat } = local;
    if (!chat) return;
    try {
      const data = reaction ? await call('PUT', `/v1/messages/${chat.uuid}/${message.id}/reaction`, { reaction }) : await call('DELETE', `/v1/messages/${chat.uuid}/${message.id}/reaction`);
      if (data?.message) updateMessage(chat.uuid, data.message.id, { reactions: data.message.reactions ?? {} });
    } catch (error) {
      if (error.status === 404) refreshChat().catch(() => {});
      showError(error);
    }
  }

  async function deleteMessage(message) {
    const { chat } = local;
    if (!chat) return;
    const uuid = chat.uuid;
    const ok = await confirmAction({
      title: 'Nachricht löschen?',
      text: `Die Nachricht verschwindet für dich und ${chat.name}, mit allen Reaktionen. Ältere Versionen von HeldixClient zeigen sie bis zum nächsten Laden noch an.`,
      confirmLabel: 'Löschen',
      danger: true,
      onConfirm: () => call('DELETE', `/v1/messages/${uuid}/${message.id}`),
    });
    if (!ok) return;
    removeMessage(uuid, message.id);
    refreshConversations().catch(() => {});
  }

  function updateMessage(uuid, id, patch) {
    if (local.chat?.uuid !== uuid) return;
    const message = local.chat.messages.find((entry) => entry.id === id);
    if (!message) return;
    Object.assign(message, patch);
    renderMessages('keep');
  }

  function removeMessage(uuid, id) {
    if (local.chat?.uuid !== uuid) return;
    const before = local.chat.messages.length;
    local.chat.messages = local.chat.messages.filter((entry) => entry.id !== id);
    // Antworten darauf behalten nur die ID
    for (const message of local.chat.messages) if (message.replyTo?.id === id) message.replyTo = { id, from: null, text: null };
    if (local.reply?.id === id) setReply(null);
    if (before !== local.chat.messages.length) renderMessages('keep');
  }

  /** „+“: Server, eigene Welt oder Einladung als Karte teilen. */
  async function share() {
    const { chat } = local;
    if (!chat) return;
    const worlds = (store.worlds?.mine ?? []).filter((world) => WORLD_CODE_RE.test(world.code ?? ''));
    const link = store.invites?.link ?? null;
    const group = uid('teilen');
    const serverId = uid('server');
    const option = (value, title, text, checked = false, disabled = false) =>
      h('label', { class: `choice-card${disabled ? ' is-disabled' : ''}` }, h('input', { type: 'radio', name: group, value, checked: checked || undefined, disabled: disabled || undefined }), h('span', null, h('strong', { text: title }), h('small', { text })));
    const server = h('input', { class: 'input', id: serverId, autocomplete: 'off', spellcheck: 'false', maxlength: '253', placeholder: 'z. B. mc.example.de' });
    const worldSelect = worlds.length ? h('select', { class: 'select input', 'aria-label': 'Welt wählen' }, worlds.map((world) => h('option', { value: world.code, text: world.name }))) : null;
    const choices = h(
      'fieldset',
      { class: 'choice-cards' },
      h('legend', { class: 'sr-only', text: 'Was möchtest du teilen?' }),
      option('server', 'Server', 'Öffentlicher Minecraft-Server – dein Freund kopiert die Adresse oder tritt im Spiel bei', true),
      option('world', 'Meine Welt', worlds.length ? 'Eine deiner geteilten Welten – öffnet sich im Launcher' : 'Du hast noch keine geteilte Welt', false, !worlds.length),
      option('invite', 'Einladung', link ? 'Dein Einladungslink zu HeldixClient' : 'Gerade kein Einladungslink da', false, !link),
    );
    const which = () => choices.querySelector('input:checked')?.value;
    const ok = await openDialog({
      title: `Mit ${chat.name} teilen`,
      body: [choices, h('label', { class: 'field', for: serverId }, h('span', { class: 'field__label', text: 'Server-Adresse' }), server), worldSelect ? h('label', { class: 'field' }, h('span', { class: 'field__label', text: 'Welt' }), worldSelect) : null],
      confirmLabel: 'Teilen',
      canConfirm: () => (which() === 'server' ? SERVER_RE.test(server.value.trim()) : which() === 'world' ? Boolean(worldSelect?.value) : which() === 'invite' && Boolean(link)),
      onConfirm: async () => {
        const kind = which();
        if (kind === 'server') {
          const address = server.value.trim().toLowerCase();
          await send({ text: `Komm auf ${address}`, card: { kind: 'server', target: address, title: address } });
        } else if (kind === 'world') {
          const world = worlds.find((entry) => entry.code === worldSelect.value);
          await send({ text: `Komm in meine Welt „${world.name}“: ${location.origin}/welt#${world.code}`, card: { kind: 'world', target: world.code, title: world.name.slice(0, 60) } });
        } else {
          await send({ text: `Ich lade dich zu HeldixClient ein: ${link.url ?? `${location.origin}/einladung#${link.code}`}`, card: { kind: 'invite', target: link.code, title: 'Einladung zu HeldixClient' } });
        }
      },
    });
    if (ok) $('chat-text').focus();
  }

  // -------------------------------------------------------------------------------------------------------
  // „schreibt …“
  // -------------------------------------------------------------------------------------------------------

  function clearTyping(uuid) {
    const timer = local.typing.get(uuid);
    if (timer === undefined) return;
    clearTimeout(timer);
    local.typing.delete(uuid);
    renderTyping();
    renderConversations();
  }

  function showTyping(uuid) {
    clearTimeout(local.typing.get(uuid));
    local.typing.set(uuid, setTimeout(() => clearTyping(uuid), TYPING_SHOW_MS));
    renderTyping();
    renderConversations();
  }

  function renderTyping() {
    const box = $('chat-tippt');
    const uuid = local.chat?.uuid;
    const typing = uuid && local.typing.has(uuid);
    box.hidden = !typing;
    if (typing) box.replaceChildren(h('span', { class: 'typing-dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')), document.createTextNode(`${displayName(friendByUuid(uuid)) || local.chat.name} schreibt …`));
  }

  // -------------------------------------------------------------------------------------------------------
  // Echtzeit
  // -------------------------------------------------------------------------------------------------------

  function handleEvent(message) {
    switch (message.type) {
      case 'message': {
        const item = message.message;
        if (!item?.id) return true;
        const other = item.from === meUuid() ? item.to : item.from;
        clearTyping(other);
        const open = local.chat?.uuid === other && local.chat.loaded;
        if (open && !local.chat.messages.some((entry) => entry.id === item.id)) {
          local.chat.messages.push(item);
          renderMessages(item.from === meUuid() ? 'bottom' : 'auto');
        }
        // Unterhaltungen selbst weiterzählen (der Dienst schickt danach keine friends-Nachricht)
        store.conversations ??= [];
        let conversation = store.conversations.find((entry) => entry.uuid === other);
        if (!conversation) {
          conversation = { uuid: other, name: message.name ?? friendByUuid(other)?.name ?? 'Freund', last: item, unread: 0 };
          store.conversations.unshift(conversation);
        }
        conversation.last = item;
        store.conversations = [conversation, ...store.conversations.filter((entry) => entry !== conversation)];
        const visible = open && shell.current() === 'nachrichten' && document.visibilityState === 'visible';
        if (item.from !== meUuid()) {
          if (visible) {
            conversation.unread = (conversation.unread || 0) + 1;
            markRead(other);
          } else {
            conversation.unread = (conversation.unread || 0) + 1;
            ctx.hint('message', `${displayName(friendByUuid(other)) || message.name}: ${item.text}`, { section: 'nachrichten', params: { mit: other } });
          }
        }
        ctx.emit('conversations');
        return true;
      }
      case 'read':
        for (const entry of store.conversations ?? []) if (entry.uuid === message.uuid) entry.unread = 0;
        ctx.emit('conversations');
        return true;
      case 'message-deleted':
        removeMessage(message.uuid, message.id);
        refreshConversations().catch(() => {});
        return true;
      case 'reaction':
        updateMessage(message.uuid, message.id, { reactions: message.reactions ?? {} });
        return true;
      case 'typing':
        if (message.from) showTyping(message.from);
        return true;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------------------------------------

  $('chat-form').addEventListener('submit', onSend);
  $('chat-text').addEventListener('input', () => {
    if (local.chat && $('chat-text').value.trim()) ctx.live?.typing(local.chat.uuid);
  });
  $('chat-text').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && local.reply) {
      event.preventDefault();
      setReply(null);
    }
  });
  $('chat-zurueck').addEventListener('click', () => {
    const uuid = local.chat?.uuid;
    closeChat();
    const item = uuid && [...document.querySelectorAll('#unterhaltungen [data-focus-key]')].find((element) => element.dataset.focusKey === `conv:${uuid}`);
    if (item) item.focus();
  });
  $('chat-antwort-weg').addEventListener('click', () => setReply(null));
  $('chat-teilen').addEventListener('click', share);
  $('chat-profil').addEventListener('click', () => local.chat && ctx.openProfile(local.chat.uuid));
  $('chat-party').addEventListener('click', (event) => {
    const friend = local.chat && friendByUuid(local.chat.uuid);
    if (friend) ctx.inviteToParty(friend, event.currentTarget);
  });
  $('chat-melden').addEventListener('click', () => local.chat && ctx.reportPlayer({ uuid: local.chat.uuid, name: local.chat.name }));
  $('chat-blockieren').addEventListener('click', () => local.chat && ctx.blockPlayer({ uuid: local.chat.uuid, name: local.chat.name }));
  document.addEventListener('click', (event) => {
    if (local.picker && !local.picker.element.contains(event.target) && !local.picker.opener.contains(event.target)) closePicker();
  });
  bindCounter($('chat-text'), $('chat-zaehler'), MAX_MESSAGE);
  ctx.on('friends', renderConversations);
  ctx.on('conversations', renderConversations);
  ctx.on('party', () => renderChatHead());
  ctx.on('friend-removed', (uuid) => {
    if (local.chat?.uuid === uuid) closeChat();
    refreshConversations().catch(() => {});
  });

  return {
    refreshConversations,
    refreshChat,
    openChat: openFromElsewhere,
    handleEvent,
    current: () => local.chat?.uuid ?? null,
    onTab(name, params) {
      if (name !== 'nachrichten') return;
      const uuid = typeof params?.mit === 'string' && /^[0-9a-f]{32}$/.test(params.mit) ? params.mit : null;
      if (uuid && local.chat?.uuid !== uuid) openChat(uuid);
      else if (local.chat) markRead(local.chat.uuid);
      refreshConversations().catch(showError);
    },
    reset() {
      for (const timer of local.typing.values()) clearTimeout(timer);
      local.typing.clear();
      if (local.chat) closeChat();
    },
  };
}
