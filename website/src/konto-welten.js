// HeldixClient – Webseite: Konto → „Meine Welten“ (Welt teilen, Heldix-Dienst ab 1.12.0).
//
// - Eigene Welten (GET /v1/worlds → mine): Name, Adresse (kopieren), Zugang, Plätze, ob gerade geöffnet, öffentliche
//   Seite /welt#<code>. Mitglieder ansehen und entfernen (GET/DELETE /v1/worlds/<id>/members[/<name>]), Freunde
//   einladen (POST /v1/worlds/<id>/invite { uuids }). Welten anlegen und öffnen geht im Spiel (Heldix-Menü → Welt teilen).
// - Offene Welten deiner Freunde (friends) mit „Beitreten“ (heldixclient://welt/<code> öffnet den Launcher).
// - Echtzeit: world-invite (Hinweis), world-open, world-closed.
// - Ab Dienst 1.13.0: dauerhafte Welten (konto-hosting.js, eigener Bereich oben; je geteilter Welt „Dauerhaft online
//   stellen“ bzw. „Verwalten“) und „Im Verzeichnis zeigen“ für Entdecken (GET/PUT/DELETE /v1/worlds/<id>/listing mit
//   Text, Tags, Sprache und den Regeln; ohne Zugang „Jeder mit der Adresse“ stellt die Seite ihn auf Wunsch um:
//   PATCH /v1/worlds/<id> { access: "open" }).
// Ohne Welt-Domain antwortet der Dienst mit 503 – dann erklärt die Seite, dass Welt teilen dort nicht eingerichtet ist.
import { avatar, bindCounter, busy, confirmAction, copyText, emptyState, formatDate, h, icon, openDialog, relativeTime, rerender, showError, toast, uid } from './app-common.js';
import { shellIcon } from './app-shell.js';
import { hostedStateChip, initHosting } from './konto-hosting.js';
import { displayName, joinButton, WORLD_CODE_RE } from './konto-sozial.js';

const ACCESS = { invited: 'Nur eingeladen', friends: 'Freunde dürfen rein', open: 'Offen für alle' };
/** Gründe, warum eine gelistete Welt gerade nicht im Verzeichnis steht (OwnListing.problem). */
const LISTING_PROBLEMS = {
  access: 'Steht nicht drin: Ins Verzeichnis kommen nur Welten mit Zugang „Jeder mit der Adresse“.',
  banned: 'Du bist für das Weltenverzeichnis gesperrt. Fragen dazu über eine Support-Anfrage.',
  hidden: 'Das Team hat den Eintrag ausgeblendet (zum Beispiel nach einer Meldung). Fragen dazu über eine Support-Anfrage.',
  words: 'Steht nicht drin: Der Name der Welt enthält Wörter, die der Filter des Verzeichnisses nicht durchlässt.',
};
const DEFAULT_TAGS = [
  ['survival', 'Survival'],
  ['kreativ', 'Kreativ'],
  ['minispiele', 'Minispiele'],
  ['rollenspiel', 'Rollenspiel'],
  ['bauen', 'Bauen'],
  ['parkour', 'Parkour'],
  ['technik', 'Technik'],
  ['entspannt', 'Entspannt'],
  ['hardcore', 'Hardcore'],
];
const DEFAULT_RULES = ['Keine Beleidigungen oder Hetze.', 'Keine Werbung für fremde Dienste.', 'Nichts Jugendgefährdendes.'];
const ROLES = { visitor: 'Besucher', player: 'Spieler', operator: 'Operator' };

export function initWorlds(ctx) {
  const { call, store } = ctx;
  const $ = (id) => document.getElementById(id);
  const local = { open: new Set(), members: new Map(), loading: false, listings: new Map(), meta: null };
  // Dauerhafte Welten (eigener Bereich über den geteilten Welten)
  const hosting = initHosting(ctx, { inviteFriends: (world) => inviteFriends(world), removeMember: (world, member) => removeMember(world, member) });
  ctx.on('hosting', () => {
    if (ctx.shell.current() === 'welten') render();
  });

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
    return ok;
  }

  async function inviteFriends(world) {
    const friends = [...(store.friends?.friends ?? [])].sort((a, b) => displayName(a).localeCompare(displayName(b), 'de'));
    if (!friends.length) {
      toast('Du hast noch keine Freunde, die du einladen kannst.');
      return false;
    }
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
    if (!ok) return false;
    local.open.add(world.id);
    render();
    const names = (result?.invited ?? []).map((entry) => entry.name);
    toast(names.length ? `Eingeladen: ${names.join(', ')}` : 'Niemand Neues eingeladen.', 'success');
    return true;
  }

  async function copyAddress(world) {
    const ok = await copyText(world.address);
    toast(ok ? `${world.address} kopiert.` : world.address, ok ? 'success' : 'info');
  }

  // --- Entdecken: Eintrag der Welt im öffentlichen Verzeichnis

  async function discoverMeta() {
    if (local.meta) return local.meta;
    try {
      local.meta = await call('GET', '/v1/public/discover/meta');
    } catch {
      local.meta = null;
    }
    return local.meta ?? { tags: DEFAULT_TAGS.map(([id, label]) => ({ id, label })), rules: DEFAULT_RULES, descriptionMax: 160, maxTags: 3 };
  }

  /** Einträge der eigenen Welten (für die Chips „Im Verzeichnis“); fehlt die Route (älterer Dienst), bleibt es still. */
  async function loadListings() {
    const mine = store.worlds?.available ? store.worlds.mine : [];
    const results = await Promise.all(
      mine.map(async (world) => {
        try {
          return [world.id, await call('GET', `/v1/worlds/${world.id}/listing`)];
        } catch (error) {
          if (error.status === 404 || error.status === 503) {
            // Älterer Dienst ohne Entdecken: kein Knopf „Im Verzeichnis zeigen“
            if (error.status === 404 && !error.code) local.listingsOff = true;
            return [world.id, null];
          }
          throw error;
        }
      }),
    );
    let changed = false;
    for (const [id, listing] of results) {
      if (JSON.stringify(local.listings.get(id) ?? null) !== JSON.stringify(listing)) changed = true;
      local.listings.set(id, listing);
    }
    if (changed && ctx.shell.current() === 'welten') render();
  }

  async function editListing(world) {
    let listing;
    try {
      listing = await call('GET', `/v1/worlds/${world.id}/listing`);
    } catch (error) {
      return showError(error);
    }
    const meta = await discoverMeta();
    const max = Number(meta.descriptionMax) || 160;
    const maxTags = Number(meta.maxTags) || 3;
    const tags = Array.isArray(meta.tags) && meta.tags.length ? meta.tags : DEFAULT_TAGS.map(([id, label]) => ({ id, label }));
    const rules = Array.isArray(listing?.rules) && listing.rules.length ? listing.rules : Array.isArray(meta.rules) ? meta.rules : DEFAULT_RULES;
    let access = listing?.access ?? world.access;
    const ids = { on: uid('verz-an'), text: uid('verz-text'), count: uid('verz-zaehler'), lang: uid('verz-sprache'), rules: uid('verz-regeln') };
    const on = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id: ids.on, checked: true });
    const text = h('input', { class: 'input', id: ids.text, maxlength: String(max), autocomplete: 'off', value: listing?.description ?? '', placeholder: 'Worum geht es in deiner Welt? Eine Zeile.' });
    const counter = h('span', { class: 'counter', id: ids.count });
    const lang = h('select', { class: 'input select', id: ids.lang }, [['de', 'Deutsch'], ['en', 'Englisch']].map(([value, label]) => h('option', { value, selected: (listing?.lang ?? 'de') === value || undefined }, label)));
    const chosen = new Set(Array.isArray(listing?.tags) ? listing.tags : []);
    const tagBox = h(
      'fieldset',
      { class: 'tag-picks', id: uid('verz-tags') },
      h('legend', { class: 'field__label', text: `Tags (bis zu ${maxTags})` }),
      tags.map((tag) => h('label', { class: 'tag-pick' }, h('input', { type: 'checkbox', value: tag.id, checked: chosen.has(tag.id) || undefined }), h('span', { text: tag.label }))),
    );
    const syncTags = () => {
      const checked = tagBox.querySelectorAll('input:checked').length;
      for (const input of tagBox.querySelectorAll('input')) input.disabled = !input.checked && checked >= maxTags;
    };
    tagBox.addEventListener('change', syncTags);
    syncTags();
    const confirmRules = h('input', { type: 'checkbox', id: ids.rules });
    const accessBox = h('div', { class: 'listing-access' });
    const renderAccess = () => {
      if (access === 'open') {
        accessBox.replaceChildren();
        accessBox.hidden = true;
        return;
      }
      accessBox.hidden = false;
      const button = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', id: 'verzeichnis-zugang' }, icon('world'), 'Zugang auf „Jeder mit der Adresse“ stellen');
      button.addEventListener('click', async () => {
        try {
          const updated = await busy(button, () => call('PATCH', `/v1/worlds/${world.id}`, { access: 'open' }));
          access = updated?.access ?? 'open';
          if (store.worlds?.available) {
            store.worlds.mine = store.worlds.mine.map((entry) => (entry.id === world.id ? { ...entry, ...(updated ?? {}), access } : entry));
            ctx.emit('worlds');
          }
          renderAccess();
          text.dispatchEvent(new Event('input', { bubbles: true }));
          toast(`„${world.name}“ ist jetzt für jeden mit der Adresse offen.`, 'success');
        } catch (error) {
          showError(error);
        }
      });
      accessBox.replaceChildren(h('p', { class: 'notice-line notice-line--warn' }, icon('lock'), h('span', { text: `Ins Verzeichnis kommen nur Welten mit Zugang „Jeder mit der Adresse“. „${world.name}“ ist gerade „${ACCESS[access] ?? access}“.` })), button);
    };
    renderAccess();
    const status = listing?.listed
      ? h('p', { class: `notice-line${listing.problem ? ' notice-line--warn' : ''}` }, icon(listing.problem ? 'warning' : 'check'), h('span', { text: listing.problem ? LISTING_PROBLEMS[listing.problem] ?? 'Steht gerade nicht im Verzeichnis.' : `Steht im Verzeichnis${listing.listedAt ? ` seit ${formatDate(listing.listedAt)}` : ''} · ${listing.likes ?? 0} × Gefällt mir` }))
      : listing?.problem === 'banned'
        ? h('p', { class: 'notice-line notice-line--warn' }, icon('ban'), h('span', { text: LISTING_PROBLEMS.banned }))
        : null;
    const wasListed = Boolean(listing?.listed);
    let saved = null;
    bindCounter(text, counter, max);
    const ok = await openDialog({
      title: `„${world.name}“ im Verzeichnis`,
      body: [
        h('p', { class: 'small text-2' }, 'Auf ', h('a', { href: '/entdecken', target: '_blank', rel: 'noopener' }, 'heldixclient.com/entdecken'), ' und im Spiel unter Heldix-Welten → Entdecken finden andere deine Welt. Öffentlich sind nur der Name, dein Text, die Tags, die Sprache und dein Spielername mit Kopf. Geteilte Welten stehen dort nur, solange sie geöffnet sind; dauerhafte immer.'),
        status,
        h('label', { class: 'switch-row', for: ids.on }, h('span', { class: 'switch-text' }, h('strong', { text: 'Im Verzeichnis zeigen' }), h('small', { text: wasListed ? 'Aus: Der Eintrag verschwindet samt „Gefällt mir“.' : 'Freiwillig – ausschalten geht jederzeit.' })), on),
        accessBox,
        h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { class: 'field__label', for: ids.text, text: 'Kurzbeschreibung' }), counter), text),
        tagBox,
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.lang, text: 'Sprache' }), lang),
        h('fieldset', { class: 'rules-confirm' }, h('legend', { text: 'Regeln fürs Verzeichnis' }), h('ul', { class: 'rules-list' }, rules.map((rule) => h('li', { text: rule }))), h('label', { class: 'check-row', for: ids.rules }, confirmRules, h('span', { text: 'Ich halte mich an diese Regeln. Verstöße kann jeder melden; das Team blendet Einträge dann aus.' }))),
      ],
      confirmLabel: wasListed ? 'Speichern' : 'Im Verzeichnis zeigen',
      canConfirm: () => (!on.checked ? wasListed : access === 'open' && confirmRules.checked && [...text.value.trim()].length <= max && listing?.problem !== 'banned'),
      onConfirm: async () => {
        if (!on.checked) {
          await call('DELETE', `/v1/worlds/${world.id}/listing`);
          saved = null;
          return;
        }
        const picked = [...tagBox.querySelectorAll('input:checked')].map((input) => input.value).slice(0, maxTags);
        saved = await call('PUT', `/v1/worlds/${world.id}/listing`, { listed: true, description: text.value.trim(), tags: picked, lang: lang.value, rulesAccepted: true });
      },
    });
    if (!ok) return;
    local.listings.set(world.id, saved);
    render();
    if (saved) toast(saved.problem ? LISTING_PROBLEMS[saved.problem] ?? 'Gespeichert, steht aber gerade nicht im Verzeichnis.' : `„${world.name}“ steht jetzt im Verzeichnis.`, saved.problem ? 'info' : 'success');
    else toast(`„${world.name}“ steht nicht mehr im Verzeichnis.`);
  }

  // -------------------------------------------------------------------------------------------------------
  // Anzeige
  // -------------------------------------------------------------------------------------------------------

  function worldCard(world) {
    const open = local.open.has(world.id);
    const members = local.members.get(world.id);
    const hosted = hosting.hostedFor(world.id);
    const listing = local.listings.get(world.id);
    const status = hosted
      ? `Dauerhaft auf dem Heldix-Server${hosted.state === 'running' ? ` · ${hosted.players ?? 0} von ${hosted.maxPlayers ?? world.maxPlayers} Spielern` : ''}`
      : world.online
        ? `Geöffnet · ${world.players ?? 1} von ${world.maxPlayers} Spielern`
        : world.lastOnline
          ? `Zu · zuletzt geöffnet ${relativeTime(world.lastOnline)}`
          : 'Noch nie geöffnet';
    return h(
      'li',
      { class: `card world-card${world.online ? ' is-online' : ''}`, dataset: { world: world.id, code: world.code } },
      h(
        'div',
        { class: 'world-card__head' },
        h('span', { class: `icon-tile${world.online ? ' icon-tile--online' : ''}` }, icon('world')),
        h('div', { class: 'world-card__title' }, h('h3', { class: 'card__title', text: world.name }), h('p', { class: `small ${world.online ? 'text-online' : 'text-3'}`, text: status })),
        h(
          'div',
          { class: 'world-card__chips' },
          hosted ? hostedStateChip(hosted, 'world-card__hosted') : null,
          listing?.listed ? h('span', { class: `chip${listing.problem ? '' : ' chip--accent'} world-card__listed`, title: listing.problem ? LISTING_PROBLEMS[listing.problem] : 'Steht im öffentlichen Verzeichnis (Entdecken)' }, icon('compass'), listing.problem ? 'Verzeichnis: pausiert' : 'Im Verzeichnis') : null,
          h('span', { class: 'chip world-card__access', text: ACCESS[world.access] ?? world.access }),
        ),
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
        !local.listingsOff ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'verzeichnis' }, onClick: () => editListing(world) }, icon('compass'), 'Im Verzeichnis zeigen') : null,
        hosted
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'dauerhaft-verwalten' }, onClick: () => hosting.open(world.id) }, shellIcon('server'), 'Dauerhafte Welt verwalten')
          : hosting.canHost()
            ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'dauerhaft' }, onClick: () => hosting.makeHosted(world) }, shellIcon('server'), 'Dauerhaft online stellen')
            : null,
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

  /** Welt eines Freundes bzw. mit Mitgliedschaft: geöffnet geteilt oder dauerhaft (hosted: { state }, ab Dienst 1.13.0). */
  function friendWorldRow(world) {
    const hosted = world.hosted && typeof world.hosted === 'object' ? world.hosted : null;
    const target = WORLD_CODE_RE.test(world.address?.split('.')[0] ?? '') ? { kind: 'world', code: world.address.split('.')[0], address: world.address, title: world.name, href: `heldixclient://welt/${world.address.split('.')[0]}` } : null;
    return h(
      'li',
      { class: 'row', dataset: { world: world.id } },
      avatar(world.host?.name, world.host?.uuid, { online: hosted ? Boolean(world.online) : true }),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: world.name }), hosted ? hostedStateChip({ state: hosted.state }, 'chip--xs') : null),
        h('div', { class: `row-sub${!hosted || world.online ? ' online' : ''}`, text: hosted ? `von ${world.host?.name ?? '?'} · dauerhaft${world.online ? ` · ${world.players ?? 0} von ${world.maxPlayers ?? '?'}` : ' · Beitreten weckt sie'}${world.version ? ` · ${world.version}` : ''}` : `von ${world.host?.name ?? '?'} · ${world.players ?? 1} von ${world.maxPlayers ?? '?'}${world.version ? ` · ${world.version}` : ''}` }),
      ),
      h('div', { class: 'row-actions' }, target ? joinButton(target) : null),
    );
  }

  function render() {
    hosting.render();
    const box = $('welten-geteilt');
    const data = store.worlds;
    if (!data) {
      if (!box.firstChild) box.replaceChildren(h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Welten werden geladen …' })));
      return;
    }
    const hostedSignature = (data.mine ?? []).map((world) => {
      const hosted = hosting.hostedFor(world.id);
      return hosted ? [hosted.state, hosted.players, hosted.maxPlayers] : null;
    });
    const signature = JSON.stringify([data, [...local.open], [...local.members], [...local.listings], local.listingsOff, hostedSignature, hosting.canHost()]);
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
          h('div', { class: 'card__head' }, h('span', { class: 'icon-tile icon-tile--online' }, shellIcon('join')), h('div', null, h('h2', { class: 'card__title', id: 'welten-freunde-titel', text: 'Offen bei Freunden' }), h('p', { class: 'tiny text-3', text: '„Beitreten“ öffnet HeldixClient und verbindet dich mit der Welt – schlafende dauerhafte Welten wachen dabei auf.' }))),
          data.friends.length ? h('ul', { class: 'rows', id: 'welten-freunde' }, data.friends.map(friendWorldRow)) : emptyState('Gerade hat keiner deiner Freunde eine Welt geöffnet oder dauerhaft online.', 'world'),
        ),
      ];
    });
  }

  function handleEvent(message) {
    if (typeof message.type === 'string' && message.type.startsWith('hosting-')) return hosting.handleEvent(message);
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
    onLiveOpen: () => hosting.onLiveOpen(),
    /** Beim Start: noch nicht gesehene Freischaltung für die Glocke. */
    checkHosting: () => hosting.checkGranted(),
    onTab(name) {
      hosting.onTab(name);
      if (name !== 'welten') return;
      render();
      refresh()
        .then(() => loadListings())
        .catch(showError);
    },
    reset() {
      local.open.clear();
      local.members.clear();
      local.listings.clear();
      local.listingsOff = false;
      hosting.reset();
    },
  };
}
