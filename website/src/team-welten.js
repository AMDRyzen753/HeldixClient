// HeldixClient – Webseite: Team-Bereich → „Dauerhafte Welten“, „Heldix+“ und „Entdecken“ (Heldix-Dienst ab 1.13.0).
//
// - Dauerhafte Welten (Recht hosting:manage): GET /v1/team/hosting → Plätze, RAM des Servers, Standardgrenzen und alle
//   dauerhaften Welten mit RAM, CPU und Speicher; „Anhalten“ (POST …/worlds/<id>/stop) und „Grenzen“ (PATCH
//   …/worlds/<id> { memoryMb, diskMb, maxPlugins, sleepAfterMin (0 = nie) }).
//   Freischaltungen (Recht hosting:grant): GET /v1/team/hosting/grants, setzen/entziehen per PUT/DELETE
//   /v1/team/hosting/grants/<uuid> – hier mit Spielername, in den Spieler-Details als eigener Abschnitt.
// - Heldix+ (hosting:grant): Warteliste (GET /v1/team/plus/waitlist), einzeln, ausgewählt oder „die ersten N“ als
//   Beta-Tester freischalten (POST /v1/team/plus/grant { uuids | first }); der Dienst schickt hosting-granted.
// - Entdecken (discover:moderate): GET /v1/team/discover?status= → Einträge, Meldungen, Sperren; ausblenden/zeigen
//   (PATCH /v1/team/discover/<code>), Meldung erledigt, Besitzer fürs Verzeichnis sperren/entsperren.
// Ohne innerHTML; Texte vom Dienst landen nur als Text im Dokument.
import { avatar, busy, confirmAction, emptyState, formatDate, formatDateTime, h, icon, isPlayerName, loadingState, normalizeUuid, openDialog, relativeTime, showError, toast, uid } from './app-common.js';
import { shellIcon } from './app-shell.js';
import { hostedStateChip, mb, meter } from './konto-hosting.js';
import { createListTools } from './team-tabelle.js';

/** Inhalt ersetzen; null, undefined und false fallen weg (replaceChildren machte daraus den Text „null“). */
const fill = (element, ...nodes) => element.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined && node !== false));

const TAG_LABELS = { survival: 'Survival', kreativ: 'Kreativ', minispiele: 'Minispiele', rollenspiel: 'Rollenspiel', bauen: 'Bauen', parkour: 'Parkour', technik: 'Technik', entspannt: 'Entspannt', hardcore: 'Hardcore' };
export const DISCOVER_REASONS = [
  ['harassment', 'Beleidigung oder Hetze'],
  ['advertising', 'Werbung für fremde Dienste'],
  ['inappropriate', 'Unangemessen oder jugendgefährdend'],
  ['spam', 'Spam'],
  ['other', 'Sonstiges'],
];
const reasonText = (reason) => DISCOVER_REASONS.find(([id]) => id === reason)?.[1] ?? String(reason ?? '');
const ACCESS = { invited: 'Nur Eingeladene', friends: 'Freunde', open: 'Jeder mit der Adresse' };
const WORD_FILTER = { word: 'Wortfilter: grobe Wörter', link: 'Wortfilter: Link oder Werbung' };
const played = (ms) => {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours ? `${hours} Std. ${minutes} Min. gespielt` : `${minutes} Min. gespielt`;
};

export function initTeamWorlds({ teamCall, can, shell, openPlayer }) {
  const $ = (id) => document.getElementById(id);
  const state = { hosting: null, grants: null, plus: null, discover: null, discoverStatus: 'open', discoverView: 'meldungen' };
  let waitTools = null;
  let reportTools = null;
  let listingTools = null;

  const playerLink = (player) =>
    player?.uuid ? h('button', { type: 'button', class: 'link-button', onClick: () => openPlayer(player.uuid) }, player.name || player.uuid) : h('span', { text: player?.name ?? 'Unbekannt' });

  /** Spieler per Name (oder UUID) finden – über die Spielersuche des Team-Bereichs. */
  async function resolvePlayer(value) {
    const raw = String(value ?? '').trim();
    const uuid = normalizeUuid(raw);
    if (uuid) return { uuid, name: raw };
    if (!isPlayerName(raw)) throw new Error('Bitte einen Spielernamen (oder eine UUID) eingeben.');
    const data = await teamCall('GET', `/v1/team/players?${new URLSearchParams({ q: raw })}`);
    const found = (data?.players ?? []).find((player) => String(player.name).toLowerCase() === raw.toLowerCase());
    if (!found) throw new Error(`${raw} kennt der Heldix-Dienst nicht – er muss sich zuerst einmal mit HeldixClient anmelden.`);
    return found;
  }

  // -------------------------------------------------------------------------------------------------------
  // Dauerhafte Welten
  // -------------------------------------------------------------------------------------------------------

  async function showHosting() {
    const box = $('team-hosting');
    if (!box.dataset.built) {
      box.dataset.built = '1';
      fill(box, 
        can('hosting:manage')
          ? h(
              'section',
              { class: 'app-card', 'aria-labelledby': 'team-hosting-titel' },
              h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'team-hosting-titel', text: 'Dauerhafte Welten auf dem Server' }), h('p', { class: 'muted small', text: 'Alle dauerhaften Welten mit Zustand, Arbeitsspeicher, Prozessor und Speicher. Anhalten trennt die Spieler; beim nächsten Beitreten startet die Welt wieder.' })), h('button', { type: 'button', class: 'button tiny ghost', id: 'team-hosting-neu', onClick: (event) => busy(event.currentTarget, loadHosting).catch(showError) }, icon('refresh'), 'Aktualisieren')),
              h('div', { id: 'team-hosting-zahlen', class: 'team-hosting-kpis' }),
              h('div', { id: 'team-hosting-welten' }, loadingState()),
            )
          : null,
        can('hosting:grant')
          ? h(
              'section',
              { class: 'app-card', 'aria-labelledby': 'team-freischaltungen-titel' },
              h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'team-freischaltungen-titel', text: 'Freischaltungen „Beta: Dauerhafte Welten“' }), h('p', { class: 'muted small', text: 'Team-Mitglieder dürfen immer (2 Welten). Alle anderen brauchen eine Freischaltung (1 Welt). Entziehen hält laufende Welten des Spielers an.' }))),
              grantForm(),
              h('div', { id: 'team-freischaltungen' }, loadingState()),
            )
          : null,
      );
    }
    await Promise.all([can('hosting:manage') ? loadHosting() : null, can('hosting:grant') ? loadGrants() : null]);
  }

  async function loadHosting() {
    try {
      state.hosting = await teamCall('GET', '/v1/team/hosting');
    } catch (error) {
      if (error.handled) return;
      fill($('team-hosting-welten'), emptyState(error.status === 503 ? 'Dauerhafte Welten sind auf diesem Heldix-Dienst nicht eingerichtet.' : error.message, 'server'));
      fill($('team-hosting-zahlen'), );
      return;
    }
    renderHosting();
  }

  function renderHosting() {
    const data = state.hosting ?? {};
    const worlds = Array.isArray(data.worlds) ? data.worlds : [];
    const slots = data.slots ?? { max: 0, used: 0 };
    const memory = data.memory ?? null;
    const defaults = data.defaults ?? null;
    const running = worlds.filter((world) => world.state === 'running' || world.state === 'starting').length;
    fill($('team-hosting-zahlen'), 
      meter('Plätze (gleichzeitig laufend)', slots.used, slots.max, { text: `${slots.used} von ${slots.max}`, unit: String }),
      memory ? meter('Arbeitsspeicher des Servers (belegt)', Math.max(0, memory.totalMb - memory.freeMb), memory.totalMb, { text: `${mb(Math.max(0, memory.totalMb - memory.freeMb))} von ${mb(memory.totalMb)}` }) : null,
      h('div', { class: 'hosted-meter' }, h('div', { class: 'hosted-meter__head' }, h('span', { text: 'Welten' }), h('strong', { text: `${worlds.length} dauerhaft · ${running} laufen` })), defaults ? h('p', { class: 'tiny text-3', text: `Standard: ${mb(defaults.memoryMb)} RAM, ${mb(defaults.diskMb)} Speicher, ${defaults.maxPlugins} Plugins, schlafen nach ${defaults.sleepAfterMin} Min.` }) : null),
    );
    const order = { running: 0, starting: 1, stopping: 2, error: 3, sleeping: 4, creating: 5 };
    const sorted = [...worlds].sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || String(a.name).localeCompare(String(b.name), 'de'));
    fill($('team-hosting-welten'), 
      sorted.length
        ? h(
            'ul',
            { class: 'rows', id: 'team-hosting-liste' },
            sorted.map((world) => {
              const active = world.state === 'running' || world.state === 'starting';
              return h(
                'li',
                { class: 'row team-hosting-world', dataset: { world: world.id, code: world.code ?? '' } },
                h('span', { class: 'row-icon', 'aria-hidden': 'true' }, shellIcon('server')),
                h(
                  'div',
                  { class: 'row-main' },
                  h('div', { class: 'row-title' }, h('span', { text: world.name }), hostedStateChip(world, 'chip--xs'), world.software === 'vanilla' ? h('span', { class: 'chip chip--xs', text: 'Vanilla' }) : null, world.restartNeeded ? h('span', { class: 'chip chip--xs chip--accent', text: 'Neustart nötig' }) : null),
                  h('div', { class: 'row-sub' }, 'von ', playerLink(world.owner), ` · ${world.code ?? '–'} · Minecraft ${world.version ?? '?'} · ${active ? `${world.players ?? 0} von ${world.maxPlayers} Spielern` : `bis zu ${world.maxPlayers} Spieler`} · ${world.plugins ?? 0}/${world.maxPlugins ?? '–'} Plugins · schlafen nach ${world.sleepAfterMin === 0 ? 'nie' : `${world.sleepAfterMin} Min.`}`),
                  world.error ? h('div', { class: 'row-sub text-danger', text: world.error }) : null,
                ),
                h(
                  'div',
                  { class: 'row-actions' },
                  active ? h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'anhalten' }, onClick: (event) => stopWorld(world, event.currentTarget) }, icon('pause'), 'Anhalten') : null,
                  h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'grenzen' }, onClick: () => editLimits(world) }, icon('settings'), 'Grenzen …'),
                ),
                h(
                  'div',
                  { class: 'hosted-meters' },
                  meter('RAM', active ? Number(world.ram?.used) || 0 : 0, Number(world.ram?.limit) || 0, { text: active ? `${mb(world.ram?.used)} von ${mb(world.ram?.limit)}` : `schläft · ${mb(world.ram?.limit)}` }),
                  meter('CPU', active ? Number(world.cpuPercent) || 0 : 0, 200, { text: active ? `${Math.round(Number(world.cpuPercent) || 0)} %` : '–' }),
                  meter('Speicher', Number(world.disk?.used) || 0, Number(world.disk?.limit) || 0),
                ),
              );
            }),
          )
        : emptyState('Noch keine dauerhafte Welt.', 'server'),
    );
  }

  async function stopWorld(world, button) {
    const ok = await confirmAction({ title: `„${world.name}“ anhalten?`, text: `${world.players ? `${world.players} Spieler werden getrennt. ` : ''}Die Welt speichert und schläft danach. Beim nächsten Beitreten startet sie wieder – außer der Besitzer hat keine Berechtigung mehr.`, confirmLabel: 'Anhalten', danger: true });
    if (!ok) return;
    try {
      await busy(button, () => teamCall('POST', `/v1/team/hosting/worlds/${world.id}/stop`));
      toast(`„${world.name}“ hält an.`, 'success');
      await loadHosting();
    } catch (error) {
      showError(error);
    }
  }

  async function editLimits(world) {
    const ids = { memory: uid('grenze-ram'), disk: uid('grenze-speicher'), plugins: uid('grenze-plugins'), sleep: uid('grenze-schlafen') };
    const number = (id, value, min, max, step = 1) => h('input', { class: 'input', type: 'number', id, min: String(min), max: String(max), step: String(step), value: String(value ?? ''), inputmode: 'numeric' });
    const memory = number(ids.memory, world.ram?.limit, 1024, 16384, 256);
    const disk = number(ids.disk, world.disk?.limit, 1024, 65536, 512);
    const plugins = number(ids.plugins, world.maxPlugins, 0, 100);
    const sleep = number(ids.sleep, world.sleepAfterMin, 0, 1440);
    const field = (id, label, input, help) => h('div', { class: 'field' }, h('label', { class: 'field__label', for: id, text: label }), input, help ? h('p', { class: 'field__help', text: help }) : null);
    const inRange = (input) => {
      const value = Number(input.value);
      return Number.isInteger(value) && value >= Number(input.min) && value <= Number(input.max);
    };
    let updated = null;
    const ok = await openDialog({
      title: `Grenzen für „${world.name}“`,
      body: [
        h('p', { class: 'small text-2', text: 'Mehr RAM wirkt beim nächsten Start (läuft die Welt, steht dort „Neustart nötig“). Jede Änderung steht im Protokoll.' }),
        h('div', { class: 'team-limits' }, field(ids.memory, 'RAM (MB, 1024–16384)', memory), field(ids.disk, 'Speicher (MB, 1024–65536)', disk), field(ids.plugins, 'Plugins (0–100)', plugins), field(ids.sleep, 'Schlafen nach (Min., 0 = nie)', sleep, '0 heißt: die Welt schläft nie.')),
      ],
      confirmLabel: 'Speichern',
      canConfirm: () => [memory, disk, plugins, sleep].every(inRange),
      onConfirm: async () => {
        const patch = {};
        if (Number(memory.value) !== world.ram?.limit) patch.memoryMb = Number(memory.value);
        if (Number(disk.value) !== world.disk?.limit) patch.diskMb = Number(disk.value);
        if (Number(plugins.value) !== world.maxPlugins) patch.maxPlugins = Number(plugins.value);
        if (Number(sleep.value) !== world.sleepAfterMin) patch.sleepAfterMin = Number(sleep.value);
        updated = Object.keys(patch).length ? await teamCall('PATCH', `/v1/team/hosting/worlds/${world.id}`, patch) : world;
      },
    });
    if (!ok) return;
    toast(`Grenzen für „${world.name}“ gespeichert.`, 'success');
    if (updated) await loadHosting();
  }

  // --- Freischaltungen

  function grantForm() {
    const inputId = uid('freischalten-name');
    const input = h('input', { class: 'input', id: inputId, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '40', placeholder: 'Spielername oder UUID' });
    const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const form = h('form', { class: 'team-grant-form', id: 'freischalten-form', novalidate: true }, h('div', { class: 'field' }, h('label', { class: 'field__label', for: inputId, text: 'Spieler freischalten' }), input), h('button', { type: 'submit', class: 'button small' }, icon('check'), 'Freischalten'));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      error.hidden = true;
      try {
        await busy(form.querySelector('button'), async () => {
          const player = await resolvePlayer(input.value);
          const result = await teamCall('PUT', `/v1/team/hosting/grants/${player.uuid}`);
          toast(result?.added === false ? `${result?.grant?.name ?? player.name} war schon freigeschaltet.` : `${result?.grant?.name ?? player.name} ist für die Beta freigeschaltet und bekommt einen Hinweis.`, 'success');
        });
        input.value = '';
        await loadGrants();
      } catch (problem) {
        if (problem.handled) return;
        error.textContent = problem.message;
        error.hidden = false;
      }
    });
    return h('div', null, form, error);
  }

  async function loadGrants() {
    try {
      const data = await teamCall('GET', '/v1/team/hosting/grants');
      state.grants = Array.isArray(data?.grants) ? data.grants : [];
    } catch (error) {
      if (!error.handled) fill($('team-freischaltungen'), emptyState(error.message, 'warning'));
      return;
    }
    renderGrants();
  }

  function renderGrants() {
    const list = [...(state.grants ?? [])].sort((a, b) => (b.grantedAt ?? 0) - (a.grantedAt ?? 0));
    fill($('team-freischaltungen'), 
      list.length
        ? h(
            'ul',
            { class: 'rows', id: 'freischaltungen-liste' },
            list.map((grant) =>
              h(
                'li',
                { class: 'row', dataset: { uuid: grant.uuid } },
                avatar(grant.name, grant.uuid, { size: 'sm' }),
                h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, playerLink(grant), grant.seen ? null : h('span', { class: 'chip chip--xs', text: 'Hinweis noch nicht gesehen' })), h('div', { class: 'row-sub', text: `${grant.label ?? 'Beta: Dauerhafte Welten'} · seit ${formatDate(grant.grantedAt)}${grant.grantedBy ? ` von ${grant.grantedBy}` : ''}` })),
                h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'button tiny ghost quiet-danger', dataset: { aktion: 'entziehen' }, onClick: (event) => revokeGrant(grant, event.currentTarget) }, icon('close'), 'Entziehen')),
              ),
            ),
          )
        : emptyState('Noch niemand freigeschaltet.', 'check'),
    );
  }

  async function revokeGrant(grant, button) {
    const ok = await confirmAction({ title: `Freischaltung von ${grant.name} entziehen?`, text: 'Laufende dauerhafte Welten des Spielers halten an und lassen sich nicht mehr starten, bis er wieder freigeschaltet ist. Die Welt selbst bleibt.', confirmLabel: 'Entziehen', danger: true });
    if (!ok) return;
    try {
      await busy(button, () => teamCall('DELETE', `/v1/team/hosting/grants/${grant.uuid}`));
      toast(`Freischaltung von ${grant.name} entzogen.`);
      await loadGrants();
    } catch (error) {
      showError(error);
    }
  }

  /** Abschnitt „Freischaltungen“ in den Spieler-Details (Recht hosting:grant). */
  function playerGrants(player) {
    const box = h('section', { class: 'player-grants', id: 'spieler-freischaltungen', 'aria-labelledby': 'spieler-freischaltungen-titel' }, h('h3', { id: 'spieler-freischaltungen-titel', text: 'Freischaltungen' }), h('p', { class: 'hint', text: 'Wird geladen …' }));
    const load = async () => {
      let data;
      try {
        data = await teamCall('GET', `/v1/team/hosting/grants/${player.uuid}`);
      } catch (error) {
        if (!error.handled) fill(box, h('h3', { id: 'spieler-freischaltungen-titel', text: 'Freischaltungen' }), h('p', { class: 'hint', text: error.status === 404 ? 'Freischaltungen gibt es mit dem Heldix-Dienst ab Version 1.13.0.' : error.message }));
        return;
      }
      const grant = (data?.grants ?? []).find((entry) => entry.source === 'beta');
      const action = grant
        ? h('button', { type: 'button', class: 'button tiny ghost quiet-danger', dataset: { aktion: 'spieler-entziehen' }, onClick: async (event) => { await revokeGrant({ ...grant, name: player.name }, event.currentTarget); load(); } }, icon('close'), 'Entziehen')
        : h(
            'button',
            {
              type: 'button',
              class: 'button tiny',
              dataset: { aktion: 'spieler-freischalten' },
              onClick: async (event) => {
                try {
                  await busy(event.currentTarget, () => teamCall('PUT', `/v1/team/hosting/grants/${player.uuid}`));
                  toast(`${player.name} ist für die Beta freigeschaltet.`, 'success');
                  load();
                } catch (error) {
                  showError(error);
                }
              },
            },
            icon('check'),
            'Beta freischalten',
          );
      fill(box, 
        h('h3', { id: 'spieler-freischaltungen-titel', text: 'Freischaltungen' }),
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'row-icon', 'aria-hidden': 'true' }, shellIcon('server')),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: 'Beta: Dauerhafte Welten' }), h('div', { class: 'row-sub', text: data?.team ? 'Darf als Team-Mitglied ohnehin (2 Welten).' : grant ? `Freigeschaltet seit ${formatDate(grant.grantedAt)}${grant.grantedBy ? ` von ${grant.grantedBy}` : ''}` : 'Nicht freigeschaltet.' })),
          data?.team && !grant ? null : h('div', { class: 'row-actions' }, action),
        ),
      );
    };
    load();
    return box;
  }

  // -------------------------------------------------------------------------------------------------------
  // Heldix+-Warteliste
  // -------------------------------------------------------------------------------------------------------

  async function showPlus() {
    const box = $('team-plus');
    if (!box.dataset.built) {
      box.dataset.built = '1';
      const firstId = uid('erste');
      const first = h('input', { class: 'input', type: 'number', id: firstId, min: '1', max: '200', step: '1', value: '10', inputmode: 'numeric' });
      const firstForm = h('form', { class: 'team-first-form', id: 'plus-erste-form', novalidate: true }, h('div', { class: 'field' }, h('label', { class: 'field__label', for: firstId, text: 'Die ersten …' }), first), h('button', { type: 'submit', class: 'button small' }, icon('check'), 'freischalten'));
      firstForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const count = Number(first.value);
        if (!Number.isInteger(count) || count < 1 || count > 200) return toast('Bitte eine Zahl von 1 bis 200.', 'error');
        const waiting = state.plus?.waiting ?? 0;
        const ok = await confirmAction({ title: `Die ersten ${count} freischalten?`, text: `Die ${Math.min(count, waiting)} am längsten Wartenden ohne Freischaltung bekommen „Beta: Dauerhafte Welten“ und einen Hinweis (Glocke, Konto, Spiel). Team-Mitglieder zählen nicht mit.`, confirmLabel: 'Freischalten' });
        if (!ok) return;
        await grantPlus({ first: count }, firstForm.querySelector('button'));
      });
      fill(box, 
        h(
          'section',
          { class: 'app-card', 'aria-labelledby': 'plus-titel' },
          h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'plus-titel', text: 'Heldix+-Warteliste' }), h('p', { class: 'muted small', text: 'Wer sich auf /plus oder im Konto einträgt. Freischalten setzt „Beta: Dauerhafte Welten“ und schickt den Hinweis. Heldix+ selbst gibt es noch nicht – nichts kostet etwas.' })), h('span', { class: 'chip', id: 'plus-zahl' })),
          firstForm,
          h('div', { id: 'plus-werkzeuge' }),
          h('div', { id: 'plus-liste' }, loadingState()),
        ),
      );
    }
    await loadPlus();
  }

  async function loadPlus() {
    try {
      state.plus = await teamCall('GET', '/v1/team/plus/waitlist');
    } catch (error) {
      if (!error.handled) fill($('plus-liste'), emptyState(error.message, 'warning'));
      return;
    }
    $('plus-zahl').textContent = `${state.plus?.count ?? 0} auf der Liste · ${state.plus?.waiting ?? 0} warten`;
    waitTools ??= createListTools({
      id: 'warteliste',
      toolbar: $('plus-werkzeuge'),
      list: $('plus-liste'),
      items: () => state.plus?.entries ?? [],
      key: (entry) => entry.uuid,
      text: (entry) => entry.name,
      filters: [
        {
          id: 'stand',
          label: 'Stand',
          options: [
            ['alle', 'Alle'],
            ['wartet', 'Wartet'],
            ['frei', 'Freigeschaltet'],
            ['team', 'Team'],
          ],
          test: (entry, value) => (value === 'wartet' ? !entry.granted && !entry.team : value === 'frei' ? entry.granted : entry.team),
        },
      ],
      sorts: [
        { id: 'seit', label: 'Am längsten wartend', compare: (a, b) => (a.since ?? 0) - (b.since ?? 0) },
        { id: 'neu', label: 'Neueste zuerst', compare: (a, b) => (b.since ?? 0) - (a.since ?? 0) },
        { id: 'name', label: 'Nach Name', compare: (a, b) => String(a.name).localeCompare(String(b.name), 'de', { sensitivity: 'base' }) },
      ],
      pageSizes: [25, 50],
      selectable: (entry) => !entry.granted && !entry.team,
      bulk: [
        {
          id: 'freischalten',
          label: 'Ausgewählte freischalten',
          icon: 'check',
          run: async (entries) => {
            await grantPlus({ uuids: entries.map((entry) => entry.uuid) });
          },
        },
      ],
      render: (entries, { checkbox }) =>
        h(
          'ul',
          { class: 'rows', id: 'warteliste-liste' },
          entries.map((entry) =>
            h(
              'li',
              { class: 'row', dataset: { uuid: entry.uuid } },
              checkbox(entry),
              avatar(entry.name, entry.uuid, { size: 'sm' }),
              h(
                'div',
                { class: 'row-main' },
                h('div', { class: 'row-title' }, playerLink(entry), entry.team ? h('span', { class: 'chip chip--xs chip--accent', text: 'Team' }) : null, entry.granted ? h('span', { class: 'chip chip--xs chip--online', text: 'freigeschaltet' }) : null),
                h('div', { class: 'row-sub', text: [`seit ${formatDate(entry.since)} auf der Liste`, `dabei seit ${formatDate(entry.memberSince)}`, entry.lastOnline ? `zuletzt online ${relativeTime(entry.lastOnline)}` : null, played(entry.playedMs)].filter(Boolean).join(' · ') }),
              ),
              !entry.granted && !entry.team ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'freischalten' }, onClick: (event) => grantPlus({ uuids: [entry.uuid] }, event.currentTarget) }, icon('check'), 'Als Beta-Tester freischalten')) : null,
            ),
          ),
        ),
      empty: (any) => emptyState(any ? 'Niemand passt zum Filter.' : 'Noch niemand auf der Warteliste.', 'star'),
    });
    waitTools.refresh();
  }

  async function grantPlus(body, button = null) {
    try {
      const result = await busy(button, () => teamCall('POST', '/v1/team/plus/grant', body));
      const names = (result?.granted ?? []).map((entry) => entry.name);
      toast(names.length ? `Freigeschaltet: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ` und ${names.length - 8} weitere` : ''}` : 'Niemand Neues freigeschaltet.', names.length ? 'success' : 'info');
      if (result && Array.isArray(result.entries)) {
        state.plus = { entries: result.entries, count: result.count, waiting: result.waiting };
        $('plus-zahl').textContent = `${state.plus.count ?? 0} auf der Liste · ${state.plus.waiting ?? 0} warten`;
        waitTools?.refresh();
      } else await loadPlus();
    } catch (error) {
      showError(error);
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Entdecken moderieren
  // -------------------------------------------------------------------------------------------------------

  async function showDiscover() {
    const box = $('team-entdecken');
    if (!box.dataset.built) {
      box.dataset.built = '1';
      const filter = h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Meldungen filtern', id: 'entdecken-filter' },
        [
          ['open', 'Offen'],
          ['done', 'Erledigt'],
          ['all', 'Alle'],
        ].map(([status, label]) => h('button', { type: 'button', dataset: { status }, 'aria-pressed': String(status === state.discoverStatus) }, label)),
      );
      filter.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-status]');
        if (!button || button.dataset.status === state.discoverStatus) return;
        state.discoverStatus = button.dataset.status;
        for (const other of filter.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
        loadDiscover().catch(showError);
      });
      const banName = h('input', { class: 'input', id: 'entdecken-sperre-name', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: '40', placeholder: 'Spielername oder UUID' });
      const banReason = h('input', { class: 'input', id: 'entdecken-sperre-grund', autocomplete: 'off', maxlength: '200', placeholder: 'Grund (optional)' });
      const banError = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const banForm = h('form', { class: 'team-grant-form', id: 'entdecken-sperre-form', novalidate: true }, h('div', { class: 'field' }, h('label', { class: 'field__label', for: banName.id, text: 'Spieler' }), banName), h('div', { class: 'field' }, h('label', { class: 'field__label', for: banReason.id, text: 'Grund' }), banReason), h('button', { type: 'submit', class: 'button small danger' }, icon('ban'), 'Fürs Verzeichnis sperren'));
      banForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        banError.hidden = true;
        try {
          await busy(banForm.querySelector('button'), async () => {
            const player = await resolvePlayer(banName.value);
            const data = await teamCall('PUT', `/v1/team/discover/bans/${player.uuid}`, { reason: banReason.value.trim() || undefined });
            if (state.discover) state.discover.bans = Array.isArray(data?.bans) ? data.bans : state.discover.bans;
            toast(`${player.name ?? 'Der Spieler'} ist fürs Verzeichnis gesperrt. Seine Welten erscheinen dort nicht mehr.`, 'success');
          });
          banName.value = '';
          banReason.value = '';
          await loadDiscover();
        } catch (problem) {
          if (problem.handled) return;
          banError.textContent = problem.message;
          banError.hidden = false;
        }
      });
      fill(box, 
        h('div', { class: 'toolbar' }, filter, h('button', { type: 'button', class: 'button tiny ghost', id: 'entdecken-neu', onClick: (event) => busy(event.currentTarget, loadDiscover).catch(showError) }, icon('refresh'), 'Aktualisieren')),
        h('section', { class: 'app-card', 'aria-labelledby': 'entdecken-meldungen-titel' }, h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'entdecken-meldungen-titel', text: 'Meldungen zu Einträgen' }), h('p', { class: 'muted small', text: 'Ausblenden nimmt den Eintrag sofort aus dem Verzeichnis (der Besitzer sieht „ausgeblendet“). Bei wiederholten Verstößen den Besitzer fürs Verzeichnis sperren.' }))), h('div', { id: 'entdecken-meldungen-werkzeuge' }), h('div', { id: 'entdecken-meldungen' }, loadingState())),
        h('section', { class: 'app-card', 'aria-labelledby': 'entdecken-eintraege-titel' }, h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'entdecken-eintraege-titel', text: 'Einträge im Verzeichnis' }), h('p', { class: 'muted small', text: 'Alle gelisteten Welten – auch ausgeblendete, gesperrte und solche, die der Wortfilter aufhält.' }))), h('div', { id: 'entdecken-eintraege-werkzeuge' }), h('div', { id: 'entdecken-eintraege' }, loadingState())),
        h('section', { class: 'app-card', 'aria-labelledby': 'entdecken-sperren-titel' }, h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'entdecken-sperren-titel', text: 'Fürs Verzeichnis gesperrt' }), h('p', { class: 'muted small', text: 'Gesperrte Besitzer können nichts listen; ihre Welten erscheinen nie. Spielen und teilen können sie weiter.' }))), banForm, banError, h('div', { id: 'entdecken-sperren' })),
      );
    }
    await loadDiscover();
  }

  async function loadDiscover() {
    try {
      state.discover = await teamCall('GET', `/v1/team/discover?status=${state.discoverStatus}`);
    } catch (error) {
      if (error.handled) return;
      for (const id of ['entdecken-meldungen', 'entdecken-eintraege']) $(id).replaceChildren(emptyState(error.status === 503 ? 'Welt teilen ist auf diesem Heldix-Dienst nicht eingerichtet.' : error.message, 'warning'));
      return;
    }
    const open = (state.discover?.reports ?? []).filter((report) => report.status === 'open').length;
    if (state.discoverStatus !== 'done') shell.setBadge('entdecken', open, { label: open === 1 ? '1 offene Meldung' : `${open} offene Meldungen` });
    renderDiscover();
  }

  const bannedSet = () => new Set((state.discover?.bans ?? []).map((ban) => ban.uuid));
  const listingByCode = (code) => (state.discover?.listings ?? []).find((listing) => listing.code === code) ?? null;

  function renderDiscover() {
    reportTools ??= createListTools({
      id: 'entdecken-meldungen',
      toolbar: $('entdecken-meldungen-werkzeuge'),
      list: $('entdecken-meldungen'),
      items: () => state.discover?.reports ?? [],
      key: (report) => report.id,
      text: (report) => `${report.worldName} ${report.code} ${report.owner?.name ?? ''} ${report.reporter?.name ?? ''} ${report.note ?? ''} ${reasonText(report.reason)}`,
      filters: [{ id: 'grund', label: 'Grund', options: [['alle', 'Alle Gründe'], ...DISCOVER_REASONS], test: (report, value) => report.reason === value }],
      sorts: [
        { id: 'neu', label: 'Neueste zuerst', compare: (a, b) => (b.at ?? 0) - (a.at ?? 0) },
        { id: 'alt', label: 'Älteste zuerst', compare: (a, b) => (a.at ?? 0) - (b.at ?? 0) },
      ],
      pageSizes: [10, 25],
      selectable: (report) => report.status === 'open',
      bulk: [
        {
          id: 'erledigt',
          label: 'Als erledigt markieren',
          icon: 'check',
          run: async (reports) => {
            for (const report of reports) await teamCall('POST', `/v1/team/discover/reports/${report.id}/done`);
            toast(reports.length === 1 ? 'Meldung erledigt.' : `${reports.length} Meldungen erledigt.`, 'success');
            await loadDiscover();
          },
        },
      ],
      render: (reports, { checkbox }) => h('ul', { class: 'rows', id: 'entdecken-meldungen-liste' }, reports.map((report) => reportRow(report, checkbox))),
      empty: (any) => emptyState(any ? 'Keine Meldung passt zum Filter.' : state.discoverStatus === 'open' ? 'Keine offenen Meldungen.' : 'Keine Meldungen.', 'flag'),
    });
    listingTools ??= createListTools({
      id: 'entdecken-eintraege',
      toolbar: $('entdecken-eintraege-werkzeuge'),
      list: $('entdecken-eintraege'),
      items: () => state.discover?.listings ?? [],
      key: (listing) => listing.code,
      text: (listing) => `${listing.name} ${listing.code} ${listing.owner?.name ?? ''} ${listing.description ?? ''}`,
      filters: [
        {
          id: 'stand',
          label: 'Stand',
          options: [
            ['alle', 'Alle'],
            ['sichtbar', 'Sichtbar'],
            ['ausgeblendet', 'Ausgeblendet'],
            ['gemeldet', 'Mit offenen Meldungen'],
            ['filter', 'Vom Wortfilter aufgehalten'],
          ],
          test: (listing, value) => (value === 'sichtbar' ? listing.listed && !listing.hidden && !listing.ownerBanned && !listing.wordFilter && listing.access === 'open' : value === 'ausgeblendet' ? listing.hidden : value === 'gemeldet' ? listing.openReports > 0 : Boolean(listing.wordFilter)),
        },
      ],
      sorts: [
        { id: 'meldungen', label: 'Meiste Meldungen', compare: (a, b) => (b.openReports ?? 0) - (a.openReports ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) },
        { id: 'neu', label: 'Zuletzt geändert', compare: (a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) },
        { id: 'beliebt', label: 'Meiste „Gefällt mir“', compare: (a, b) => (b.likes ?? 0) - (a.likes ?? 0) },
      ],
      pageSizes: [10, 25, 50],
      render: (listings) => h('ul', { class: 'rows', id: 'entdecken-eintraege-liste' }, listings.map(listingRow)),
      empty: (any) => emptyState(any ? 'Kein Eintrag passt zum Filter.' : 'Noch keine Einträge im Verzeichnis.', 'compass'),
    });
    reportTools.refresh();
    listingTools.refresh();
    renderBans();
  }

  function hiddenButton(code, hidden, name) {
    return h(
      'button',
      { type: 'button', class: `button tiny ghost${hidden ? '' : ' quiet-danger'}`, dataset: { aktion: hidden ? 'zeigen' : 'ausblenden' }, onClick: (event) => setHidden(code, !hidden, name, event.currentTarget) },
      icon(hidden ? 'eye' : 'eye-off'),
      hidden ? 'Wieder zeigen' : 'Ausblenden',
    );
  }

  function banButton(owner) {
    if (!owner?.uuid) return null;
    const banned = bannedSet().has(owner.uuid);
    return banned
      ? h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'entsperren' }, onClick: (event) => unban(owner, event.currentTarget) }, icon('check'), 'Besitzer entsperren')
      : h('button', { type: 'button', class: 'button tiny ghost quiet-danger', dataset: { aktion: 'besitzer-sperren' }, onClick: () => banOwner(owner) }, icon('ban'), 'Besitzer sperren …');
  }

  function reportRow(report, checkbox) {
    const listing = listingByCode(report.code);
    const hidden = Boolean(listing?.hidden);
    return h(
      'li',
      { class: 'row discover-report', dataset: { meldung: String(report.id), code: report.code } },
      checkbox(report),
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('flag')),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: report.worldName }), h('span', { class: 'chip chip--xs chip--danger', text: reasonText(report.reason) }), report.status === 'done' ? h('span', { class: 'chip chip--xs chip--online', text: `erledigt${report.doneBy ? ` von ${report.doneBy}` : ''}` }) : null, hidden ? h('span', { class: 'chip chip--xs', text: 'ausgeblendet' }) : null),
        h('div', { class: 'row-sub' }, 'Welt von ', playerLink(report.owner), ' · gemeldet von ', playerLink(report.reporter), ` · ${formatDateTime(report.at)}`),
        report.description ? h('div', { class: 'row-sub', text: `Beschreibung: „${report.description}“` }) : null,
        report.note ? h('blockquote', { class: 'quote', text: report.note }) : null,
      ),
      h(
        'div',
        { class: 'row-actions' },
        h('a', { class: 'button tiny ghost', href: `/welt#${report.code}`, target: '_blank', rel: 'noopener' }, icon('external'), 'Ansehen'),
        listing ? hiddenButton(report.code, hidden, report.worldName) : null,
        banButton(report.owner),
        report.status === 'open' ? h('button', { type: 'button', class: 'button tiny', dataset: { aktion: 'erledigt' }, onClick: (event) => reportDone(report, event.currentTarget) }, icon('check'), 'Erledigt') : null,
      ),
    );
  }

  function listingRow(listing) {
    const tags = (listing.tags ?? []).map((tag) => TAG_LABELS[tag] ?? tag).join(', ');
    return h(
      'li',
      { class: 'row', dataset: { code: listing.code } },
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('compass')),
      h(
        'div',
        { class: 'row-main' },
        h(
          'div',
          { class: 'row-title' },
          h('span', { text: listing.name }),
          listing.hidden ? h('span', { class: 'chip chip--xs chip--danger', text: `ausgeblendet${listing.hiddenBy ? ` von ${listing.hiddenBy}` : ''}` }) : null,
          listing.ownerBanned ? h('span', { class: 'chip chip--xs chip--danger', text: 'Besitzer gesperrt' }) : null,
          listing.wordFilter ? h('span', { class: 'chip chip--xs', text: WORD_FILTER[listing.wordFilter] ?? 'Wortfilter' }) : null,
          !listing.listed ? h('span', { class: 'chip chip--xs', text: 'nicht gelistet' }) : null,
          listing.access !== 'open' ? h('span', { class: 'chip chip--xs', text: ACCESS[listing.access] ?? listing.access }) : null,
          listing.openReports ? h('span', { class: 'chip chip--xs chip--danger', text: listing.openReports === 1 ? '1 Meldung' : `${listing.openReports} Meldungen` }) : null,
        ),
        h('div', { class: 'row-sub' }, 'von ', playerLink(listing.owner), ` · ${listing.code} · ${listing.lang === 'en' ? 'Englisch' : 'Deutsch'}${tags ? ` · ${tags}` : ''} · ${listing.likes ?? 0} × Gefällt mir · gelistet ${formatDate(listing.listedAt)}`),
        listing.description ? h('div', { class: 'row-sub', text: `„${listing.description}“` }) : null,
      ),
      h('div', { class: 'row-actions' }, h('a', { class: 'button tiny ghost', href: `/welt#${listing.code}`, target: '_blank', rel: 'noopener' }, icon('external'), 'Ansehen'), hiddenButton(listing.code, listing.hidden, listing.name), banButton(listing.owner)),
    );
  }

  function renderBans() {
    const bans = [...(state.discover?.bans ?? [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    fill($('entdecken-sperren'), 
      bans.length
        ? h(
            'ul',
            { class: 'rows', id: 'entdecken-sperren-liste' },
            bans.map((ban) =>
              h(
                'li',
                { class: 'row', dataset: { uuid: ban.uuid } },
                avatar(ban.name, ban.uuid, { size: 'sm' }),
                h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, playerLink(ban)), h('div', { class: 'row-sub', text: `seit ${formatDateTime(ban.at)}${ban.by ? ` von ${ban.by}` : ''}${ban.reason ? ` · ${ban.reason}` : ''}` })),
                h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'entsperren' }, onClick: (event) => unban(ban, event.currentTarget) }, icon('check'), 'Entsperren')),
              ),
            ),
          )
        : emptyState('Niemand ist fürs Verzeichnis gesperrt.', 'check'),
    );
  }

  async function setHidden(code, hidden, name, button) {
    try {
      await busy(button, () => teamCall('PATCH', `/v1/team/discover/${code}`, { hidden }));
      toast(hidden ? `„${name}“ ist ausgeblendet.` : `„${name}“ steht wieder im Verzeichnis.`, 'success');
      await loadDiscover();
    } catch (error) {
      showError(error);
    }
  }

  async function reportDone(report, button) {
    try {
      await busy(button, () => teamCall('POST', `/v1/team/discover/reports/${report.id}/done`));
      toast('Meldung erledigt.', 'success');
      await loadDiscover();
    } catch (error) {
      showError(error);
    }
  }

  async function banOwner(owner) {
    const reasonId = uid('verzeichnis-grund');
    const reason = h('input', { class: 'input', id: reasonId, maxlength: '200', autocomplete: 'off', placeholder: 'z. B. wiederholt Werbung (Meldung #3)' });
    let data = null;
    const ok = await openDialog({
      title: `${owner.name} fürs Verzeichnis sperren?`,
      body: [h('p', { text: `Alle Welten von ${owner.name} verschwinden aus dem Verzeichnis, und neue Einträge gehen nicht mehr. Spielen und Welten teilen kann ${owner.name} weiter.` }), h('div', { class: 'field' }, h('label', { class: 'field__label', for: reasonId, text: 'Grund (optional, nur fürs Team)' }), reason)],
      confirmLabel: 'Sperren',
      danger: true,
      onConfirm: async () => {
        data = await teamCall('PUT', `/v1/team/discover/bans/${owner.uuid}`, { reason: reason.value.trim() || undefined });
      },
    });
    if (!ok) return;
    if (state.discover && Array.isArray(data?.bans)) state.discover.bans = data.bans;
    toast(`${owner.name} ist fürs Verzeichnis gesperrt.`, 'success');
    await loadDiscover();
  }

  async function unban(owner, button) {
    try {
      await busy(button, () => teamCall('DELETE', `/v1/team/discover/bans/${owner.uuid}`));
      toast(`${owner.name} darf wieder ins Verzeichnis.`, 'success');
      await loadDiscover();
    } catch (error) {
      showError(error);
    }
  }

  return { showHosting, showPlus, showDiscover, playerGrants };
}
