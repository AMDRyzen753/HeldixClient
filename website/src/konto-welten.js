// HeldixClient – Webseite: Konto → „Meine Welten“ (Welt teilen, Heldix-Dienst ab 1.12.0).
//
// - Eigene Welten (GET /v1/worlds → mine): Name, Adresse (kopieren), Zugang, Plätze, ob gerade geöffnet, öffentliche
//   Seite /welt#<code>. Mitglieder ansehen und entfernen (GET/DELETE /v1/worlds/<id>/members[/<name>]), Freunde
//   einladen (POST /v1/worlds/<id>/invite { uuids }). Welten anlegen und öffnen geht im Spiel (Heldix-Menü → Welt teilen).
// - Offene Welten deiner Freunde (friends) mit „Beitreten“ (heldixclient://welt/<code> öffnet den Launcher).
// - Echtzeit: world-invite (Hinweis), world-open, world-closed.
// Ohne Welt-Domain antwortet der Dienst mit 503 – dann erklärt die Seite, dass Welt teilen dort nicht eingerichtet ist.
import { avatar, busy, confirmAction, copyText, emptyState, formatDate, h, icon, openDialog, relativeTime, rerender, showError, toast } from './app-common.js';
import { shellIcon } from './app-shell.js';
import { displayName, joinButton, WORLD_CODE_RE } from './konto-sozial.js';

const ACCESS = { invited: 'Nur eingeladen', friends: 'Freunde dürfen rein', open: 'Offen für alle' };
const ROLES = { visitor: 'Besucher', player: 'Spieler', operator: 'Operator' };

export function initWorlds(ctx) {
  const { call, store } = ctx;
  const $ = (id) => document.getElementById(id);
  const local = { open: new Set(), members: new Map(), loading: false };

  function apply(data) {
    const mine = Array.isArray(data?.mine) ? data.mine : [];
    const friends = Array.isArray(data?.friends) ? data.friends : [];
    const any = [...mine, ...friends].find((world) => /^[a-hjkmnp-z2-9]{6}\./.test(world.address ?? ''));
    const domain = any ? any.address.slice(any.address.indexOf('.') + 1) : store.worlds?.domain ?? null;
    store.worlds = { available: true, mine, friends, domain };
    ctx.emit('worlds');
  }

  async function refresh() {
    try {
      apply(await call('GET', '/v1/worlds'));
    } catch (error) {
      if (error.status === 503 || error.status === 404) {
        store.worlds = { available: false, reason: error.status === 503 ? 'aus' : 'alt', message: error.message, mine: [], friends: [], domain: null };
        ctx.emit('worlds');
        return;
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Aktionen
  // -------------------------------------------------------------------------------------------------------

  async function loadMembers(world) {
    const list = await call('GET', `/v1/worlds/${world.id}/members`);
    local.members.set(world.id, Array.isArray(list) ? list : Array.isArray(list?.members) ? list.members : []);
    render();
  }

  async function toggleMembers(world) {
    if (local.open.has(world.id)) local.open.delete(world.id);
    else {
      local.open.add(world.id);
      loadMembers(world).catch(showError);
    }
    render();
  }

  async function removeMember(world, member) {
    const ok = await confirmAction({
      title: `${member.name} entfernen?`,
      text: `${member.name} darf danach nur noch in „${world.name}“, wenn der Zugang es erlaubt oder du ${member.name} wieder einlädst.`,
      confirmLabel: 'Entfernen',
      danger: true,
      onConfirm: async () => {
        const list = await call('DELETE', `/v1/worlds/${world.id}/members/${encodeURIComponent(member.name)}`);
        local.members.set(world.id, Array.isArray(list) ? list : []);
      },
    });
    if (ok) {
      render();
      toast(`${member.name} ist kein Mitglied von „${world.name}“ mehr.`);
    }
  }

  async function inviteFriends(world) {
    const friends = [...(store.friends?.friends ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b), 'de'));
    if (!friends.length) return toast('Du hast noch keine Freunde, die du einladen kannst.');
    const members = new Set((local.members.get(world.id) ?? []).map((member) => member.uuid).filter(Boolean));
    const list = h(
      'fieldset',
      { class: 'pick-list' },
      h('legend', { class: 'sr-only', text: 'Freunde wählen' }),
      friends.map((friend) =>
        h('label', { class: 'pick-row' }, h('input', { type: 'checkbox', value: friend.uuid, checked: members.has(friend.uuid) || undefined, disabled: members.has(friend.uuid) || undefined }), avatar(friend.name, friend.uuid, { size: 'sm' }), h('span', { text: displayName(friend) }), members.has(friend.uuid) ? h('span', { class: 'chip chip--xs', text: 'schon Mitglied' }) : null),
      ),
    );
    const chosen = () => [...list.querySelectorAll('input:checked:not(:disabled)')].map((input) => input.value);
    let result = null;
    const ok = await openDialog({
      title: `Freunde in „${world.name}“ einladen`,
      body: [h('p', { class: 'small text-2', text: `Eingeladene werden Mitglied als ${ROLES[world.defaultRole] ?? 'Spieler'} und bekommen einen Hinweis mit „Beitreten“.` }), list],
      confirmLabel: 'Einladen',
      canConfirm: () => chosen().length > 0,
      onConfirm: async () => {
        result = await call('POST', `/v1/worlds/${world.id}/invite`, { uuids: chosen().slice(0, 50) });
        if (Array.isArray(result?.members)) local.members.set(world.id, result.members);
      },
    });
    if (!ok) return;
    local.open.add(world.id);
    render();
    const names = (result?.invited ?? []).map((entry) => entry.name);
    toast(names.length ? `Eingeladen: ${names.join(', ')}` : 'Niemand Neues eingeladen.', 'success');
  }

  async function copyAddress(world) {
    const ok = await copyText(world.address);
    toast(ok ? `${world.address} kopiert.` : world.address, ok ? 'success' : 'info');
  }

  // -------------------------------------------------------------------------------------------------------
  // Anzeige
  // -------------------------------------------------------------------------------------------------------

  function worldCard(world) {
    const open = local.open.has(world.id);
    const members = local.members.get(world.id);
    const status = world.online ? `Geöffnet · ${world.players ?? 1} von ${world.maxPlayers} Spielern` : world.lastOnline ? `Zu · zuletzt geöffnet ${relativeTime(world.lastOnline)}` : 'Noch nie geöffnet';
    return h(
      'li',
      { class: `card world-card${world.online ? ' is-online' : ''}`, dataset: { world: world.id, code: world.code } },
      h(
        'div',
        { class: 'world-card__head' },
        h('span', { class: `icon-tile${world.online ? ' icon-tile--online' : ''}` }, icon('world')),
        h('div', { class: 'world-card__title' }, h('h3', { class: 'card__title', text: world.name }), h('p', { class: `small ${world.online ? 'text-online' : 'text-3'}`, text: status })),
        h('span', { class: 'chip world-card__access', text: ACCESS[world.access] ?? world.access }),
      ),
      h(
        'div',
        { class: 'input-group world-card__address' },
        h('input', { class: 'input input--mono', readonly: true, value: world.address, 'aria-label': `Adresse von ${world.name}` }),
        h('button', { type: 'button', class: 'btn btn--secondary btn--icon', 'aria-label': 'Adresse kopieren', title: 'Adresse kopieren', dataset: { aktion: 'kopieren' }, onClick: () => copyAddress(world) }, icon('copy')),
      ),
      h(
        'dl',
        { class: 'world-card__facts' },
        h('div', null, h('dt', { text: 'Plätze' }), h('dd', { text: String(world.maxPlayers) })),
        h('div', null, h('dt', { text: 'Neue Mitglieder' }), h('dd', { text: ROLES[world.defaultRole] ?? world.defaultRole })),
        world.version ? h('div', null, h('dt', { text: 'Version' }), h('dd', { text: world.version })) : null,
        h('div', null, h('dt', { text: 'Angelegt' }), h('dd', { text: formatDate(world.created) })),
      ),
      h(
        'div',
        { class: 'btn-group world-card__actions' },
        h('button', { type: 'button', class: 'btn btn--social btn--sm', dataset: { aktion: 'einladen' }, onClick: () => inviteFriends(world) }, icon('user-plus'), 'Freunde einladen'),
        h('button', { type: 'button', class: 'btn btn--secondary btn--sm', 'aria-expanded': String(open), dataset: { aktion: 'mitglieder' }, onClick: () => toggleMembers(world) }, icon('friends'), open ? 'Mitglieder ausblenden' : 'Mitglieder'),
        WORLD_CODE_RE.test(world.code ?? '') ? h('a', { class: 'btn btn--ghost btn--sm', href: `/welt#${world.code}`, target: '_blank', rel: 'noopener', dataset: { aktion: 'seite' } }, icon('external'), 'Öffentliche Seite') : null,
      ),
      open
        ? h(
            'div',
            { class: 'world-card__members' },
            !members
              ? h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Mitglieder werden geladen …' }))
              : members.length
                ? h(
                    'ul',
                    { class: 'rows' },
                    members.map((member) =>
                      h(
                        'li',
                        { class: 'row', dataset: { name: member.name } },
                        avatar(member.name, member.uuid ?? null, { size: 'sm', skin: member.uuid ? undefined : null }),
                        h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: member.name }), h('div', { class: 'row-sub', text: `${ROLES[member.role] ?? member.role} · seit ${formatDate(member.added)}${member.uuid ? '' : ' · kein Heldix-Konto bekannt'}` })),
                        h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon quiet-danger', 'aria-label': `${member.name} entfernen`, title: 'Entfernen', dataset: { aktion: 'entfernen' }, onClick: () => removeMember(world, member) }, icon('close'))),
                      ),
                    ),
                  )
                : emptyState('Noch keine Mitglieder. Lade Freunde ein – oder lass im Spiel anklopfen.', 'friends'),
          )
        : null,
    );
  }

  function friendWorldRow(world) {
    const target = WORLD_CODE_RE.test(world.address?.split('.')[0] ?? '') ? { kind: 'world', code: world.address.split('.')[0], address: world.address, title: world.name, href: `heldixclient://welt/${world.address.split('.')[0]}` } : null;
    return h(
      'li',
      { class: 'row', dataset: { world: world.id } },
      avatar(world.host?.name, world.host?.uuid, { online: true }),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: world.name }), h('div', { class: 'row-sub online', text: `von ${world.host?.name ?? '?'} · ${world.players ?? 1} von ${world.maxPlayers ?? '?'}${world.version ? ` · ${world.version}` : ''}` })),
      h('div', { class: 'row-actions' }, target ? joinButton(target) : null),
    );
  }

  function render() {
    const box = $('welten-inhalt');
    const data = store.worlds;
    if (!data) {
      if (!box.firstChild) box.replaceChildren(h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Welten werden geladen …' })));
      return;
    }
    const signature = JSON.stringify([data, [...local.open], [...local.members]]);
    rerender(box, signature, () => {
      if (!data.available) {
        return h('section', { class: 'card' }, emptyState(data.reason === 'aus' ? 'Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet.' : 'Welt teilen gibt es mit dem Heldix-Dienst ab Version 1.12.0.', 'world'));
      }
      return [
        h(
          'section',
          { class: 'card', 'aria-labelledby': 'welten-eigene-titel' },
          h('div', { class: 'card__head' }, h('span', { class: 'icon-tile' }, icon('world')), h('div', null, h('h2', { class: 'card__title', id: 'welten-eigene-titel', text: 'Deine Welten' }), h('p', { class: 'tiny text-3', text: 'Öffnen und neue Welten anlegen geht im Spiel: Heldix-Menü → Welt teilen.' }))),
          data.mine.length ? h('ul', { class: 'world-list', id: 'welten-liste' }, data.mine.map(worldCard)) : emptyState('Du hast noch keine Welt geteilt. Öffne im Spiel eine Einzelspieler-Welt und wähle im Heldix-Menü „Welt teilen“.', 'world'),
        ),
        h(
          'section',
          { class: 'card', 'aria-labelledby': 'welten-freunde-titel' },
          h('div', { class: 'card__head' }, h('span', { class: 'icon-tile icon-tile--online' }, shellIcon('join')), h('div', null, h('h2', { class: 'card__title', id: 'welten-freunde-titel', text: 'Offen bei Freunden' }), h('p', { class: 'tiny text-3', text: '„Beitreten“ öffnet HeldixClient und verbindet dich mit der Welt.' }))),
          data.friends.length ? h('ul', { class: 'rows', id: 'welten-freunde' }, data.friends.map(friendWorldRow)) : emptyState('Gerade hat keiner deiner Freunde eine Welt geöffnet.', 'world'),
        ),
      ];
    });
  }

  function handleEvent(message) {
    switch (message.type) {
      case 'world-invite':
        if (message.world) ctx.hint('world', `${message.world.host?.name ?? 'Ein Freund'} lädt dich in „${message.world.name}“ ein`, { section: 'welten' });
        refresh().catch(() => {});
        return true;
      case 'world-open':
        if (store.worlds?.available && message.world?.id) {
          store.worlds.friends = [...store.worlds.friends.filter((world) => world.id !== message.world.id), message.world];
          ctx.emit('worlds');
        }
        return true;
      case 'world-closed':
        if (store.worlds?.available && message.world?.id) {
          store.worlds.friends = store.worlds.friends.filter((world) => world.id !== message.world.id);
          ctx.emit('worlds');
        }
        return true;
      default:
        return false;
    }
  }

  ctx.on('worlds', () => {
    if (ctx.shell.current() === 'welten') render();
  });

  return {
    refresh,
    render,
    handleEvent,
    onTab(name) {
      if (name !== 'welten') return;
      render();
      refresh().catch(showError);
    },
    reset() {
      local.open.clear();
      local.members.clear();
    },
  };
}
