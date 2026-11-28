// HeldixClient – Webseite: Konto → Meine Welten → „Dauerhafte Welten“ (Heldix-Dienst ab 1.13.0).
//
// Eine geteilte Welt läuft auf Wunsch dauerhaft als Minecraft-Server (Paper) auf dem Heldix-Server – auch wenn der
// Besitzer offline ist. Leere Welten schlafen und wachen beim Beitreten auf. Hier verwaltet der Besitzer sie, Operatoren
// der Welt sehen sie mit weniger Rechten (Konsole, Starten/Anhalten, Anklopfen beantworten, alles andere nur ansehen).
//
// - GET /v1/hosting → { allowed, reason: "off"|"beta"|null, team, limits, worlds, operated }
//   Ohne Berechtigung: Hinweis „Dauerhafte Welten sind in der Beta – bald mit Heldix+“ mit Warteliste (GET/PUT/DELETE
//   /v1/plus…) und Link auf /plus. Aus (reason "off") oder älterer Dienst (404): der Bereich bleibt weg.
// - Karte je Welt: Zustand, Spieler, Adresse kopieren, Starten/Anhalten/Neustart, Anklopfen (hosting-knock bzw. knocks
//   aus GET …/<id>) zulassen/ablehnen; „Verwalten“ öffnet die Reiter Übersicht, Konsole (letzte Zeilen + Live-Log über
//   hosting-subscribe, Befehle), Plugins (Modrinth über den Dienst), Einstellungen (server.properties-Auswahl, Schlafen
//   nach …), Mitglieder, Sicherungen, Dateien (Plugin-Konfiguration) und Gefahrenzone (herunterladen, dauerhaft beenden).
// - Anlegen: „Neue Welt“ (Seed, Spielmodus, Schwierigkeit, Typ) oder aus einer geteilten Welt (das Hochladen macht das
//   Spiel); beim Anlegen der Hinweis auf die Minecraft-EULA (limits.eula).
// - Echtzeit: hosting-state (Zustand, Spieler …), hosting-log (nur mit Abo), hosting-knock, hosting-granted.
//
// Bilder von Modrinth lädt die Seite nicht (die CSP erlaubt nur eigene Bilder): Plugins bekommen ein Buchstaben-Symbol.
// Ohne innerHTML; Texte vom Dienst landen nur als Text im Dokument (app-common.js).
import { busy, confirmAction, copyText, emptyState, formatBytes, formatDate, formatDateTime, h, icon, openDialog, relativeTime, rerender, setupTabs, showError, toast, uid } from './app-common.js';
import { shellIcon } from './app-shell.js';

/** Inhalt ersetzen; null, undefined und false fallen weg (replaceChildren machte daraus den Text „null“). */
const fill = (element, ...nodes) => element.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined && node !== false));

const NUMBER = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
const WORLD_ID_RE = /^[0-9a-f]{32}$/;
const PLAYER_RE = /^[A-Za-z0-9_]{1,16}$/;
/** Höchstens so viele Zeilen hält die Konsole (wie der Dienst). */
const CONSOLE_MAX = 500;
/** Ohne WebSocket fragt die offene Konsole so oft nach. */
const CONSOLE_POLL_MS = 5000;
const FILE_MAX_BYTES = 256 * 1024;
const PLUGIN_NOTICE = 'Plugins sind fremder Code von Modrinth – sie können eigene Daten speichern und ins Internet verbinden.';
const EULA_FALLBACK = 'https://www.minecraft.net/eula';

const GAME_MODES = [
  ['survival', 'Überleben'],
  ['creative', 'Kreativ'],
  ['adventure', 'Abenteuer'],
  ['spectator', 'Zuschauer'],
];
const DIFFICULTIES = [
  ['peaceful', 'Friedlich'],
  ['easy', 'Einfach'],
  ['normal', 'Normal'],
  ['hard', 'Schwer'],
];
/** Bezeichnungen der server.properties-Auswahl (die erlaubten Werte kommen vom Dienst als rules). */
const PROPERTY_LABELS = {
  difficulty: 'Schwierigkeit',
  gamemode: 'Spielmodus',
  pvp: 'PvP (Spieler gegen Spieler)',
  'max-players': 'Höchstzahl der Spieler',
  'view-distance': 'Sichtweite (Chunks)',
  'simulation-distance': 'Simulationsweite (Chunks)',
  'spawn-protection': 'Spawnschutz (Blöcke)',
  'allow-flight': 'Fliegen erlauben',
  'generate-structures': 'Bauwerke erzeugen',
  hardcore: 'Hardcore',
  'force-gamemode': 'Spielmodus beim Beitreten erzwingen',
  'spawn-monsters': 'Monster erscheinen',
  'allow-nether': 'Nether erlauben',
};
const VALUE_LABELS = { ...Object.fromEntries(GAME_MODES), ...Object.fromEntries(DIFFICULTIES) };
const LEVEL_TYPES = { 'minecraft:normal': 'Normal', 'minecraft:flat': 'Flach', normal: 'Normal', flat: 'Flach' };
const BACKUP_KINDS = {
  daily: 'Täglich',
  manual: 'Von Hand',
  'before-plugin': 'Vor Plugin-Änderung',
  'before-version': 'Vor Versionswechsel',
  'before-import': 'Vor dem Hochladen',
  'before-restore': 'Vor dem Wiederherstellen',
};
const MEMBER_ROLES = { visitor: 'Besucher', player: 'Mitspieler', operator: 'Operator' };
const SLEEP_CHOICES = [5, 10, 15, 20, 30, 45, 60];

const TABS = [
  { id: 'uebersicht', label: 'Übersicht', icon: 'home' },
  { id: 'konsole', label: 'Konsole', icon: 'terminal' },
  { id: 'plugins', label: 'Plugins', icon: 'addons' },
  { id: 'einstellungen', label: 'Einstellungen', icon: 'settings' },
  { id: 'mitglieder', label: 'Mitglieder', icon: 'friends' },
  { id: 'sicherungen', label: 'Sicherungen', icon: 'clock', owner: true },
  { id: 'dateien', label: 'Dateien', icon: 'file' },
  { id: 'gefahr', label: 'Gefahrenzone', icon: 'warning', owner: true },
];

/** MB als „512 MB“ bzw. „2,5 GB“. */
export const mb = (value) => (typeof value !== 'number' || !Number.isFinite(value) ? '–' : value >= 1024 ? `${NUMBER.format(value / 1024)} GB` : `${NUMBER.format(Math.round(value))} MB`);

/** Zustand einer dauerhaften Welt als Text und Ton (auch für den Team-Bereich). */
export function hostedState(world) {
  switch (world?.state) {
    case 'running':
      return { label: 'Läuft', tone: 'online' };
    case 'starting':
      return { label: 'Startet …', tone: 'soon' };
    case 'stopping':
      return { label: 'Hält an …', tone: 'soon' };
    case 'sleeping':
      return { label: 'Schläft', tone: '' };
    case 'creating':
      return { label: world.awaitingUpload ? 'Wartet auf Upload' : 'Wird eingerichtet', tone: 'soon' };
    case 'error':
      return { label: 'Fehler', tone: 'danger' };
    default:
      return { label: String(world?.state ?? 'unbekannt'), tone: '' };
  }
}

/** Chip mit Punkt für den Zustand. */
export function hostedStateChip(world, extra = '') {
  const info = hostedState(world);
  return h(
    'span',
    { class: `chip hosted-state${info.tone ? ` chip--${info.tone}` : ''}${extra ? ` ${extra}` : ''}`, dataset: { zustand: world?.state ?? '' } },
    h('span', { class: `dot${world?.state === 'running' ? ' dot--online' : ''}`, 'aria-hidden': 'true' }),
    info.label,
  );
}

/** Balken „Belegt von Grenze“ (RAM, Speicher, Plätze). */
export function meter(label, used, limit, { text = null, unit = mb } = {}) {
  const ratio = limit > 0 && Number.isFinite(used) ? Math.min(1, Math.max(0, used / limit)) : 0;
  const bar = h('span', { class: 'progress__bar' });
  bar.style.width = `${Math.round(ratio * 100)}%`;
  return h(
    'div',
    { class: `hosted-meter${ratio >= 0.9 ? ' is-full' : ''}` },
    h('div', { class: 'hosted-meter__head' }, h('span', { text: label }), h('strong', { text: text ?? `${unit(used)} von ${unit(limit)}` })),
    h('div', { class: 'progress', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(Math.round(limit || 0)), 'aria-valuenow': String(Math.round(used || 0)) }, bar),
  );
}

/** Buchstaben-Symbol für Plugins (Bilder von Modrinth lädt die Seite nicht). */
function pluginTile(title) {
  const letter = String(title || '?').trim().charAt(0).toUpperCase() || '?';
  let hash = 0;
  for (const char of String(title || '?')) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const tile = h('span', { class: 'plugin-tile', 'aria-hidden': 'true', text: letter });
  tile.style.setProperty('--hue', String(hash % 360));
  return tile;
}

const sleepText = (minutes) => (minutes === 0 ? 'nie (vom Team eingestellt)' : Number.isFinite(minutes) ? `${minutes} Minuten ohne Spieler` : '–');
const softwareText = (world) => (world.software === 'paper' ? `Paper${Number.isFinite(world.paperBuild) ? ` (Build ${world.paperBuild})` : ''}` : world.software === 'vanilla' ? 'Vanilla (ohne Plugins)' : String(world.software ?? '–'));
const isModrinthUrl = (url) => typeof url === 'string' && /^https:\/\/modrinth\.com\//.test(url);

export function initHosting(ctx, { inviteFriends, removeMember } = {}) {
  const { call } = ctx;
  const $ = (id) => document.getElementById(id);
  const root = $('welten-dauerhaft');
  const local = {
    data: null, // Antwort von GET /v1/hosting, { unavailable: true } oder null (noch nicht geladen)
    plus: null, // GET /v1/plus
    meta: null,
    views: new Map(), // Welt-ID → Ansicht
    open: null, // ID der Welt, deren Verwaltung offen ist
    autoOpened: false,
    knocks: new Map(), // Welt-ID → Map(name → { name, at })
    subscribed: new Set(), // Welt-IDs mit Live-Log-Abo
    subscribedOk: new Set(), // vom Dienst bestätigt (hosting-subscribed)
    granted: null, // Freischaltung (Banner, bis gesehen)
    seenSent: false,
    loading: null,
  };

  // Feste Teile des Bereichs (Listen bleiben stehen, damit Konsole und Eingaben beim Aktualisieren nicht verloren gehen)
  const grantedSlot = h('div', { class: 'hosting-granted-slot' });
  const introBody = h('div', { class: 'hosting-intro__body' });
  const ownList = h('ul', { class: 'world-list hosted-list', id: 'hosting-liste', 'aria-label': 'Deine dauerhaften Welten' });
  const introCard = h('section', { class: 'card hosting-intro', id: 'hosting-kopf', 'aria-labelledby': 'hosting-titel' }, introBody, ownList);
  const opList = h('ul', { class: 'world-list hosted-list', id: 'hosting-operator', 'aria-label': 'Welten, in denen du Operator bist' });
  const opCard = h(
    'section',
    { class: 'card', id: 'hosting-operator-karte', 'aria-labelledby': 'hosting-operator-titel', hidden: true },
    h('div', { class: 'card__head' }, h('span', { class: 'icon-tile icon-tile--voice' }, shellIcon('crown')), h('div', null, h('h2', { class: 'card__title', id: 'hosting-operator-titel', text: 'Als Operator' }), h('p', { class: 'tiny text-3', text: 'Dauerhafte Welten anderer, in denen du Operator bist: starten, anhalten, Konsole und Anklopfen. Ändern darf nur der Besitzer.' }))),
    opList,
  );
  if (root) fill(root, grantedSlot, introCard, opCard);

  const limits = () => local.data?.limits ?? null;
  const allowed = () => Boolean(local.data?.allowed);
  const ownWorlds = () => (Array.isArray(local.data?.worlds) ? local.data.worlds : []);
  const operatedWorlds = () => (Array.isArray(local.data?.operated) ? local.data.operated : []);
  const allWorlds = () => [...ownWorlds(), ...operatedWorlds()];
  const find = (id) => allWorlds().find((world) => world.id === id) ?? null;
  const isOwner = (world) => world?.role !== 'operator';

  // -------------------------------------------------------------------------------------------------------
  // Laden
  // -------------------------------------------------------------------------------------------------------

  async function refresh() {
    if (local.loading) return local.loading;
    local.loading = (async () => {
      try {
        const data = await call('GET', '/v1/hosting');
        local.data = data && typeof data === 'object' ? data : { unavailable: true };
      } catch (error) {
        if (error.status === 404 || error.status === 503) local.data = { unavailable: true, reason: error.status === 503 ? 'off' : 'alt' };
        else throw error;
      } finally {
        local.loading = null;
      }
      if (local.data && !local.data.unavailable && (!local.data.allowed || local.data.reason === 'beta')) await refreshPlus().catch(() => {});
      for (const world of allWorlds()) if (!local.knocks.has(world.id)) local.knocks.set(world.id, new Map());
      render();
      publish();
    })();
    return local.loading;
  }

  async function refreshPlus() {
    try {
      local.plus = await call('GET', '/v1/plus');
      if (local.plus?.unseen && local.plus?.granted && !local.granted) local.granted = { text: 'Du bist für die Beta „Dauerhafte Welten“ freigeschaltet. Stell eine deiner Welten dauerhaft online!', at: local.plus.grantedAt ?? Date.now() };
    } catch (error) {
      if (error.status === 404) local.plus = null;
      else throw error;
    }
  }

  /** Stand für Übersicht und Glocke (konto.js → konto-uebersicht.js). */
  function publish() {
    const knocks = [];
    for (const [id, map] of local.knocks) {
      const world = find(id);
      if (!world) continue;
      for (const knock of map.values()) knocks.push({ world: id, worldName: world.name, name: knock.name, at: knock.at });
    }
    ctx.store.hosting = { worlds: ownWorlds(), operated: operatedWorlds(), knocks, granted: local.granted };
    ctx.emit('hosting');
  }

  /** Neue Ansicht einer Welt vom Dienst (Antwort einer Aktion oder hosting-state). */
  function applyWorld(world) {
    if (!world || !WORLD_ID_RE.test(world.id ?? '') || !local.data || local.data.unavailable) return;
    if (world.state === 'deleted') {
      local.data.worlds = ownWorlds().filter((entry) => entry.id !== world.id);
      local.data.operated = operatedWorlds().filter((entry) => entry.id !== world.id);
      local.knocks.delete(world.id);
      unsubscribe(world.id);
      render();
      publish();
      ctx.emit('worlds');
      return;
    }
    const list = world.role === 'operator' ? 'operated' : 'worlds';
    const current = Array.isArray(local.data[list]) ? local.data[list] : [];
    const index = current.findIndex((entry) => entry.id === world.id);
    const merged = index >= 0 ? { ...current[index], ...world } : world;
    local.data[list] = index >= 0 ? current.map((entry, i) => (i === index ? merged : entry)) : [...current, merged];
    if (index < 0 && list === 'worlds' && local.data.limits) local.data.limits = { ...local.data.limits, used: local.data.worlds.length };
    const view = local.views.get(world.id);
    if (view && index >= 0) view.update(merged);
    else render();
    publish();
    if (index < 0) ctx.emit('worlds');
  }

  // -------------------------------------------------------------------------------------------------------
  // Echtzeit
  // -------------------------------------------------------------------------------------------------------

  function subscribe(id) {
    local.subscribed.add(id);
    ctx.live?.send?.({ type: 'hosting-subscribe', world: id });
  }

  function unsubscribe(id) {
    if (!local.subscribed.delete(id)) return;
    local.subscribedOk.delete(id);
    ctx.live?.send?.({ type: 'hosting-unsubscribe', world: id });
    local.views.get(id)?.liveChanged();
  }

  function onLiveOpen() {
    // Der Dienst führt Abos je Verbindung: nach dem (Wieder-)Verbinden neu anmelden
    local.subscribedOk.clear();
    for (const id of local.subscribed) ctx.live?.send?.({ type: 'hosting-subscribe', world: id });
  }

  function handleEvent(message) {
    switch (message.type) {
      case 'hosting-state':
        if (message.world) applyWorld(message.world);
        return true;
      case 'hosting-log': {
        const view = typeof message.world === 'string' ? local.views.get(message.world) : null;
        if (view && Array.isArray(message.lines)) view.appendLog(message.lines.filter((line) => typeof line === 'string'));
        return true;
      }
      case 'hosting-subscribed':
        if (typeof message.world === 'string' && local.subscribed.has(message.world)) {
          local.subscribedOk.add(message.world);
          local.views.get(message.world)?.liveChanged();
        }
        return true;
      case 'hosting-error':
        if (typeof message.world === 'string') {
          local.subscribedOk.delete(message.world);
          local.views.get(message.world)?.liveChanged();
        }
        return true;
      case 'hosting-knock': {
        const id = message.world?.id;
        const name = typeof message.name === 'string' && PLAYER_RE.test(message.name) ? message.name : null;
        if (!id || !name) return true;
        if (!local.knocks.has(id)) local.knocks.set(id, new Map());
        local.knocks.get(id).set(name.toLowerCase(), { name, at: Date.now() });
        local.views.get(id)?.renderKnocks();
        ctx.hint('world', `${name} klopft bei „${message.world.name ?? 'deiner Welt'}“ an`, { section: 'welten' });
        publish();
        return true;
      }
      case 'hosting-granted':
        local.granted = { text: typeof message.text === 'string' && message.text ? message.text : 'Du bist für die Beta „Dauerhafte Welten“ freigeschaltet.', at: message.at ?? Date.now() };
        local.seenSent = false;
        toast(local.granted.text, 'success');
        publish();
        refresh().catch(() => {});
        return true;
      default:
        return false;
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Aktionen
  // -------------------------------------------------------------------------------------------------------

  const worldPath = (world, rest = '') => `/v1/hosting/worlds/${world.id}${rest}`;

  async function startWorld(world, button) {
    try {
      const updated = await busy(button, () => call('POST', worldPath(world, '/start')));
      applyWorld(updated);
      toast(`„${world.name}“ startet – in etwa 30 Sekunden kannst du beitreten.`, 'success');
    } catch (error) {
      showError(error);
    }
  }

  async function stopWorld(world, button) {
    const players = Number(world.players) || 0;
    if (players > 0) {
      const ok = await confirmAction({ title: `„${world.name}“ anhalten?`, text: `${players === 1 ? 'Gerade ist 1 Spieler' : `Gerade sind ${players} Spieler`} in der Welt und ${players === 1 ? 'wird' : 'werden'} getrennt. Die Welt speichert vorher.`, confirmLabel: 'Anhalten' });
      if (!ok) return;
    }
    try {
      applyWorld(await busy(button, () => call('POST', worldPath(world, '/stop'))));
      toast(`„${world.name}“ hält an und schläft danach.`);
    } catch (error) {
      showError(error);
    }
  }

  async function restartWorld(world, button) {
    const players = Number(world.players) || 0;
    if (players > 0) {
      const ok = await confirmAction({ title: `„${world.name}“ neu starten?`, text: `${players === 1 ? 'Gerade ist 1 Spieler' : `Gerade sind ${players} Spieler`} in der Welt. Beim Neustart werden alle kurz getrennt und können danach wieder beitreten.`, confirmLabel: 'Neu starten' });
      if (!ok) return;
    }
    try {
      applyWorld(await busy(button, () => call('POST', worldPath(world, '/restart'))));
      toast(`„${world.name}“ startet neu.`, 'success');
    } catch (error) {
      showError(error);
    }
  }

  async function answerKnock(world, knock, allow, button) {
    try {
      await busy(button, () => call('POST', worldPath(world, `/knocks/${encodeURIComponent(knock.name)}`), { allow }));
      local.knocks.get(world.id)?.delete(knock.name.toLowerCase());
      local.views.get(world.id)?.renderKnocks();
      local.views.get(world.id)?.reloadMembers();
      publish();
      toast(allow ? `${knock.name} darf jetzt in „${world.name}“ – noch einmal beitreten genügt.` : `${knock.name} kann 10 Minuten lang nicht noch einmal anklopfen.`, allow ? 'success' : 'info');
    } catch (error) {
      showError(error);
    }
  }

  async function copyAddress(world) {
    const ok = await copyText(world.address);
    toast(ok ? `${world.address} kopiert – in Minecraft unter Mehrspieler → Server hinzufügen einfügen.` : world.address, ok ? 'success' : 'info');
  }

  /** Hinweis auf die Minecraft-EULA (beim Anlegen). */
  function eulaNote() {
    const url = typeof limits()?.eula === 'string' && /^https:\/\//.test(limits().eula) ? limits().eula : EULA_FALLBACK;
    return h(
      'p',
      { class: 'info-box small hosting-eula' },
      icon('info'),
      h('span', null, 'Die Welt läuft als Minecraft-Server auf dem Heldix-Server. Dafür gilt die ', h('a', { href: url, target: '_blank', rel: 'noopener' }, 'Minecraft-EULA'), ' – mit dem Anlegen hältst du dich an sie (zum Beispiel keine Bezahlvorteile im Spiel).'),
    );
  }

  /** „Neue dauerhafte Welt“: Name, Seed, Spielmodus, Schwierigkeit, Typ. */
  async function createNew(button) {
    const ids = { name: uid('hw-name'), seed: uid('hw-seed'), mode: uid('hw-modus'), difficulty: uid('hw-schwierigkeit') };
    const me = ctx.store.me?.name ?? '';
    const name = h('input', { class: 'input', id: ids.name, maxlength: '32', autocomplete: 'off', value: me ? `Welt von ${me}`.slice(0, 32) : '' });
    const seed = h('input', { class: 'input input--mono', id: ids.seed, maxlength: '64', autocomplete: 'off', placeholder: 'leer = zufällig' });
    const mode = h('select', { class: 'input select', id: ids.mode }, GAME_MODES.map(([value, text]) => h('option', { value, selected: value === 'survival' || undefined }, text)));
    const difficulty = h('select', { class: 'input select', id: ids.difficulty }, DIFFICULTIES.map(([value, text]) => h('option', { value, selected: value === 'normal' || undefined }, text)));
    const type = h(
      'fieldset',
      { class: 'choice-cards hosting-type' },
      h('legend', { class: 'field__label', text: 'Welttyp' }),
      [
        ['normal', 'Normal', 'Berge, Meere, Dörfer – wie im Einzelspieler'],
        ['flat', 'Flach', 'Superflach zum Bauen, ohne Bauwerke'],
      ].map(([value, text, sub]) => h('label', { class: 'choice-card' }, h('input', { type: 'radio', name: 'hw-typ', value, checked: value === 'normal' || undefined }), h('span', null, h('strong', { text }), h('small', { text: sub })))),
    );
    const field = (id, label, input, help = null) => h('div', { class: 'field' }, h('label', { class: 'field__label', for: id, text: label }), input, help ? h('p', { class: 'field__help', text: help }) : null);
    let created = null;
    const ok = await openDialog({
      title: 'Neue dauerhafte Welt',
      body: [
        h('p', { class: 'small text-2', text: 'Die Welt entsteht direkt auf dem Heldix-Server und bekommt eine feste Adresse. Freunde treten über die Adresse oder „Beitreten“ bei – auch wenn du offline bist.' }),
        field(ids.name, 'Name (1–32 Zeichen)', name),
        h('div', { class: 'field-grid' }, field(ids.mode, 'Spielmodus', mode), field(ids.difficulty, 'Schwierigkeit', difficulty)),
        field(ids.seed, 'Seed (optional)', seed, 'Zahl oder Text, höchstens 64 Zeichen.'),
        type,
        eulaNote(),
      ],
      confirmLabel: 'Welt anlegen',
      canConfirm: () => name.value.trim().length >= 1 && [...name.value.trim()].length <= 32,
      onConfirm: async () => {
        const chosen = type.querySelector('input:checked')?.value ?? 'normal';
        created = await call('POST', '/v1/hosting/worlds', { world: null, name: name.value.trim(), seed: seed.value.trim() || undefined, gameMode: mode.value, difficulty: difficulty.value, type: chosen });
      },
    });
    if (!ok || !created) return;
    applyWorld(created);
    local.open = created.id;
    render();
    toast(`„${created.name}“ wird eingerichtet – das dauert einen Moment.`, 'success');
    ctx.emit('worlds-refresh');
    void button;
  }

  /** Geteilte Welt dauerhaft online stellen (das Hochladen macht das Spiel). */
  async function makeHosted(world) {
    let created = null;
    const ok = await openDialog({
      title: `„${world.name}“ dauerhaft online stellen?`,
      body: [
        h('p', { text: 'Dann läuft die Welt auf dem Heldix-Server – auch wenn du offline bist. Adresse, Code, Mitglieder und Zugang bleiben gleich. Leere Welten schlafen und wachen beim Beitreten auf.' }),
        h(
          'ol',
          { class: 'mini-steps hosting-steps' },
          h('li', null, h('span', { text: 'Hier bestätigen – die Welt wartet dann auf den Upload.' })),
          h('li', null, h('span', null, 'Im Spiel ', h('strong', { text: 'Spielen → Heldix-Welten' }), ', deine Welt wählen und ', h('strong', { text: '„Dauerhaft online stellen“' }), ' – HeldixClient sichert und lädt sie hoch.')),
          h('li', null, h('span', { text: 'Fertig: Die Welt läuft auf dem Heldix-Server. Selbst teilen geht für diese Welt dann nicht mehr.' })),
        ),
        eulaNote(),
      ],
      confirmLabel: 'Dauerhaft online stellen',
      onConfirm: async () => {
        created = await call('POST', '/v1/hosting/worlds', { world: world.id });
      },
    });
    if (!ok || !created) return;
    applyWorld(created);
    local.open = created.id;
    render();
    toast(`„${created.name}“ wartet jetzt auf den Upload aus dem Spiel.`, 'success');
  }

  async function joinWaitlist(button) {
    try {
      local.plus = await busy(button, () => call('PUT', '/v1/plus/waitlist'));
      toast('Du stehst auf der Warteliste. Wir melden uns über die Glocke im Launcher, hier im Konto und im Spiel.', 'success');
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function leaveWaitlist(button) {
    const ok = await confirmAction({ title: 'Von der Warteliste nehmen?', text: 'Dein Platz auf der Warteliste geht dabei verloren. Eintragen kannst du dich jederzeit wieder – dann zählt der neue Zeitpunkt.', confirmLabel: 'Austragen' });
    if (!ok) return;
    try {
      local.plus = await busy(button, () => call('DELETE', '/v1/plus/waitlist'));
      toast('Du stehst nicht mehr auf der Warteliste.');
      render();
    } catch (error) {
      showError(error);
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Ansicht einer Welt (Karte mit Verwaltung)
  // -------------------------------------------------------------------------------------------------------

  function createView(initial) {
    const id = initial.id;
    const short = id.slice(0, 8);
    const view = {
      id,
      world: initial,
      el: null,
      tab: 'uebersicht',
      loaded: new Set(),
      detail: null, // GET /v1/hosting/worlds/<id> (knocks, members)
      log: [],
      pollTimer: null,
      properties: null,
      plugins: null,
      backups: null,
      files: null,
      fileOpen: null,
      searchHits: null,
    };

    const head = h('div', { class: 'world-card__head hosted-card__head' });
    const notices = h('div', { class: 'hosted-notices' });
    const knocksBox = h('div', { class: 'hosted-knocks', hidden: true });
    const address = h('div', { class: 'input-group world-card__address' });
    const actions = h('div', { class: 'btn-group world-card__actions hosted-actions' });
    const tablist = h('div', { class: 'subtabs hosted-tabs', role: 'tablist', 'aria-label': `Verwaltung von ${initial.name}` });
    const panels = {};
    const detail = h('div', { class: 'hosted-detail', id: `hw-${short}-verwaltung`, hidden: true }, tablist);
    for (const tab of TABS) {
      const tabId = `hw-${short}-reiter-${tab.id}`;
      const panelId = `hw-${short}-${tab.id}`;
      tablist.append(h('button', { type: 'button', class: 'subtab', role: 'tab', id: tabId, 'aria-controls': panelId, 'aria-selected': 'false', tabindex: '-1', dataset: { tab: tab.id } }, shellIcon(tab.icon), h('span', { text: tab.label })));
      panels[tab.id] = h('div', { class: 'subpanel hosted-panel', role: 'tabpanel', id: panelId, 'aria-labelledby': tabId, tabindex: '0', hidden: true, dataset: { reiter: tab.id } });
      detail.append(panels[tab.id]);
    }
    const tabs = setupTabs(tablist, (name) => {
      view.tab = name;
      loadTab(name);
    });

    view.el = h('li', { class: 'card world-card hosted-card', dataset: { world: id, code: initial.code ?? '' } }, head, notices, knocksBox, address, actions, detail);

    const owner = () => isOwner(view.world);
    const running = () => view.world.state === 'running';

    // --- Kopf, Hinweise, Adresse, Knöpfe
    function renderHead() {
      const world = view.world;
      const players = Number(world.players) || 0;
      const line =
        world.state === 'running'
          ? `${players} von ${world.maxPlayers} Spielern online`
          : world.state === 'sleeping'
            ? 'Schläft – Beitreten weckt sie auf'
            : world.state === 'starting'
              ? 'Startet gerade – gleich kannst du beitreten'
              : world.state === 'stopping'
                ? 'Hält an und speichert'
                : world.state === 'creating'
                  ? world.awaitingUpload
                    ? 'Wartet auf den Upload aus dem Spiel'
                    : 'Wird auf dem Heldix-Server eingerichtet'
                  : world.error || 'Die Welt hat gerade ein Problem';
      fill(head, 
        h('span', { class: `icon-tile${world.state === 'running' ? ' icon-tile--online' : world.state === 'error' ? ' icon-tile--danger' : ''}` }, shellIcon('server')),
        h(
          'div',
          { class: 'world-card__title' },
          h('h3', { class: 'card__title', text: world.name }),
          h('p', { class: `small ${world.state === 'running' ? 'text-online' : world.state === 'error' ? 'text-danger' : 'text-3'}`, text: owner() ? line : `${line} · Welt von ${world.owner?.name ?? '?'}` }),
        ),
        h('div', { class: 'hosted-card__chips' }, owner() ? null : h('span', { class: 'chip chip--voice', text: 'Operator' }), hostedStateChip(world)),
      );
    }

    function renderNotices() {
      const world = view.world;
      const items = [];
      if (world.error && world.state !== 'error') items.push(h('p', { class: 'notice-line notice-line--warn' }, icon('warning'), h('span', { text: world.error })));
      if (world.state === 'error') {
        items.push(
          h(
            'div',
            { class: 'notice-line notice-line--danger' },
            icon('warning'),
            h('span', { text: world.error || 'Die Welt hat gerade ein Problem.' }),
            h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { aktion: 'starten' }, onClick: (event) => startWorld(world, event.currentTarget) }, icon('refresh'), 'Neu starten'),
          ),
        );
      }
      if (world.notice) items.push(h('p', { class: 'notice-line' }, icon('info'), h('span', { text: world.notice })));
      if (world.restartNeeded) {
        items.push(
          h(
            'div',
            { class: 'notice-line notice-line--accent hosted-restart', dataset: { hinweis: 'neustart' } },
            icon('refresh'),
            h('span', null, h('strong', { text: 'Neustart nötig: ' }), 'Änderungen an Einstellungen, Plugins oder Dateien wirken nach einem Neustart.'),
            running() ? h('button', { type: 'button', class: 'btn btn--primary btn--sm', dataset: { aktion: 'jetzt-neu-starten' }, onClick: (event) => restartWorld(world, event.currentTarget) }, icon('refresh'), 'Jetzt neu starten') : null,
          ),
        );
      }
      if (owner() && (world.awaitingUpload || world.upload)) {
        const upload = world.upload;
        const chunks = Number(upload?.chunks) || 0;
        const received = Array.isArray(upload?.received) ? upload.received.length : 0;
        const percent = chunks ? Math.round((received / chunks) * 100) : 0;
        const bar = h('span', { class: 'progress__bar' });
        bar.style.width = `${percent}%`;
        items.push(
          h(
            'div',
            { class: 'hosted-upload', dataset: { hinweis: 'upload' } },
            h('p', { class: 'small' }, h('strong', { text: upload ? `Upload läuft: ${received} von ${chunks} Teilen (${percent} %)` : 'Wartet auf den Upload' })),
            upload ? h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Upload', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) }, bar) : null,
            h('p', { class: 'small text-2' }, 'Weiter geht’s im Spiel: ', h('strong', { text: 'Spielen → Heldix-Welten' }), ` → „${world.name}“ → `, h('strong', { text: 'Dauerhaft online stellen' }), '. HeldixClient sichert die Welt und lädt sie hoch (höchstens 2 GB).'),
            h(
              'div',
              { class: 'btn-group' },
              upload ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'upload-abbrechen' }, onClick: (event) => cancelUpload(event.currentTarget) }, icon('close'), 'Upload abbrechen') : null,
              world.awaitingUpload ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm quiet-danger', dataset: { aktion: 'verwerfen' }, onClick: () => endHosting() }, icon('trash'), 'Doch nicht dauerhaft') : null,
            ),
          ),
        );
      }
      fill(notices, ...items);
      notices.hidden = !items.length;
    }

    function renderKnocks() {
      const list = [...(local.knocks.get(id)?.values() ?? [])].filter((knock) => Date.now() - knock.at < 10 * 60_000).sort((a, b) => b.at - a.at);
      knocksBox.hidden = !list.length;
      if (!list.length) {
        fill(knocksBox, );
        return;
      }
      fill(knocksBox, 
        h('p', { class: 'hosted-knocks__title' }, shellIcon('bell'), h('strong', { text: list.length === 1 ? 'Klopft an' : `${list.length} klopfen an` })),
        h(
          'ul',
          { class: 'rows' },
          list.map((knock) =>
            h(
              'li',
              { class: 'row', dataset: { anklopfen: knock.name } },
              h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: knock.name }), h('div', { class: 'row-sub', text: `möchte beitreten · ${relativeTime(knock.at)}` })),
              h(
                'div',
                { class: 'row-actions' },
                h('button', { type: 'button', class: 'btn btn--primary btn--sm', dataset: { aktion: 'zulassen' }, onClick: (event) => answerKnock(view.world, knock, true, event.currentTarget) }, icon('check'), 'Zulassen'),
                h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'ablehnen' }, onClick: (event) => answerKnock(view.world, knock, false, event.currentTarget) }, icon('close'), 'Ablehnen'),
              ),
            ),
          ),
        ),
      );
    }

    function renderAddress() {
      const world = view.world;
      fill(address, 
        h('input', { class: 'input input--mono', readonly: true, value: world.address ?? '', 'aria-label': `Adresse von ${world.name}` }),
        h('button', { type: 'button', class: 'btn btn--secondary btn--icon', 'aria-label': 'Adresse kopieren', title: 'Adresse kopieren', dataset: { aktion: 'kopieren' }, onClick: () => copyAddress(world) }, icon('copy')),
      );
    }

    function renderActions() {
      const world = view.world;
      const open = local.open === id;
      const state = world.state;
      const canStart = state === 'sleeping' || state === 'error';
      const canStop = state === 'running' || state === 'starting';
      fill(actions, 
        canStart ? h('button', { type: 'button', class: 'btn btn--primary btn--sm', dataset: { aktion: 'starten' }, onClick: (event) => startWorld(view.world, event.currentTarget) }, icon('play'), 'Starten') : null,
        canStop ? h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { aktion: 'anhalten' }, onClick: (event) => stopWorld(view.world, event.currentTarget) }, icon('pause'), 'Anhalten') : null,
        state === 'running' ? h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { aktion: 'neustart' }, onClick: (event) => restartWorld(view.world, event.currentTarget) }, icon('refresh'), 'Neu starten') : null,
        state !== 'creating' && world.code ? h('a', { class: 'btn btn--ghost btn--sm', href: `heldixclient://welt/${world.code}`, dataset: { aktion: 'beitreten' } }, shellIcon('join'), 'Beitreten') : null,
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm hosted-toggle', 'aria-expanded': String(open), 'aria-controls': detail.id, dataset: { aktion: 'verwalten' }, onClick: () => toggle() }, icon(open ? 'chevron-down' : 'settings'), open ? 'Verwaltung schließen' : 'Verwalten'),
      );
    }

    function toggle(force) {
      const open = force ?? local.open !== id;
      if (open) {
        const before = local.open;
        local.open = id;
        if (before && before !== id) local.views.get(before)?.close();
        view.openDetail();
      } else {
        local.open = null;
        view.close();
      }
    }

    view.openDetail = () => {
      detail.hidden = false;
      for (const tab of TABS) {
        const button = tablist.querySelector(`[data-tab="${tab.id}"]`);
        button.hidden = Boolean(tab.owner && !owner());
      }
      if (TABS.find((entry) => entry.id === view.tab)?.owner && !owner()) view.tab = 'uebersicht';
      tabs.select(view.tab);
      renderActions();
      loadDetail().catch(() => {});
    };
    view.close = () => {
      detail.hidden = true;
      stopConsole();
      renderActions();
    };

    view.update = (world) => {
      const before = view.world;
      view.world = world;
      view.el.dataset.code = world.code ?? '';
      renderHead();
      renderNotices();
      renderAddress();
      renderActions();
      if (!detail.hidden) {
        if (view.tab === 'uebersicht') renderOverview();
        if (view.tab === 'konsole') renderConsoleForm();
        if (before.state !== world.state && ['sicherungen', 'einstellungen'].includes(view.tab)) loadTab(view.tab, { force: true });
        if (view.tab === 'plugins' && before.plugins !== world.plugins) loadTab('plugins', { force: true });
      }
    };
    view.renderKnocks = renderKnocks;
    view.reloadMembers = () => {
      if (!detail.hidden && view.tab === 'mitglieder') loadDetail().then(renderMembers).catch(() => {});
    };
    view.liveChanged = () => {
      if (!detail.hidden && view.tab === 'konsole') renderConsoleHead();
    };
    view.appendLog = (lines) => {
      if (!lines.length) return;
      view.log.push(...lines.map((line) => line.slice(0, 2000)));
      if (view.log.length > CONSOLE_MAX) view.log.splice(0, view.log.length - CONSOLE_MAX);
      paintLog();
    };
    view.destroy = () => {
      stopConsole();
    };

    async function loadDetail() {
      const data = await call('GET', worldPath(view.world));
      view.detail = data;
      if (Array.isArray(data?.knocks)) {
        if (!local.knocks.has(id)) local.knocks.set(id, new Map());
        const map = local.knocks.get(id);
        for (const knock of data.knocks) if (typeof knock?.name === 'string' && PLAYER_RE.test(knock.name)) map.set(knock.name.toLowerCase(), { name: knock.name, at: Number(knock.at) || Date.now() });
        renderKnocks();
        publish();
      }
      const { knocks, members, ...world } = data ?? {};
      void knocks;
      void members;
      if (world.id === id) {
        view.world = { ...view.world, ...world };
        renderHead();
        renderNotices();
        if (!detail.hidden && view.tab === 'uebersicht') renderOverview();
      }
      return data;
    }

    async function cancelUpload(button) {
      try {
        await busy(button, () => call('DELETE', worldPath(view.world, '/upload')));
        applyWorld({ ...view.world, upload: null });
        toast('Upload abgebrochen. Im Spiel kannst du neu beginnen.');
      } catch (error) {
        showError(error);
      }
    }

    // --- Reiter laden
    function loadTab(name, { force = false } = {}) {
      if (name !== 'konsole') stopConsole();
      const run = {
        uebersicht: async () => renderOverview(),
        konsole: () => openConsole(),
        plugins: () => loadPlugins(force),
        einstellungen: () => loadSettings(force),
        mitglieder: async () => {
          fill(panels.mitglieder, loadingLine('Mitglieder werden geladen …'));
          await loadDetail();
          renderMembers();
        },
        sicherungen: () => loadBackups(),
        dateien: () => loadFiles(force),
        gefahr: async () => renderDanger(),
      }[name];
      if (run) run().catch((error) => {
        panels[name].replaceChildren(emptyState(error.message || 'Das hat nicht geklappt.', 'warning'));
        if (error.status !== 404) showError(error);
      });
    }

    const loadingLine = (text) => h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text }));
    const readOnlyNote = () => (owner() ? null : h('p', { class: 'hint hosted-readonly' }, icon('lock'), h('span', { text: `Ansehen darfst du als Operator – ändern darf nur ${view.world.owner?.name ?? 'der Besitzer'}.` })));

    // --- Übersicht
    function renderOverview() {
      const world = view.world;
      const ram = world.ram ?? {};
      const disk = world.disk ?? {};
      const facts = [
        ['Zustand', hostedState(world).label],
        ['Spieler', world.state === 'running' ? `${Number(world.players) || 0} von ${world.maxPlayers}` : `bis zu ${world.maxPlayers}`],
        ['Minecraft', world.version ?? '–'],
        ['Software', softwareText(world)],
        ['Plugins', `${Number(world.plugins) || 0} von ${world.maxPlugins ?? '–'}`],
        ['Schlafen nach', sleepText(world.sleepAfterMin)],
        ['Zuletzt gestartet', world.lastStartedAt ? formatDateTime(world.lastStartedAt) : 'noch nie'],
        ['Dauerhaft seit', formatDate(world.createdAt)],
        owner() ? null : ['Besitzer', world.owner?.name ?? '–'],
      ].filter(Boolean);
      fill(panels.uebersicht, 
        h(
          'div',
          { class: 'hosted-meters' },
          meter('Arbeitsspeicher (RAM)', world.state === 'running' || world.state === 'starting' ? Number(ram.used) || 0 : 0, Number(ram.limit) || 0, { text: world.state === 'running' || world.state === 'starting' ? `${mb(Number(ram.used) || 0)} von ${mb(ram.limit)}` : `schläft · bis zu ${mb(ram.limit)}` }),
          Number.isFinite(world.cpuPercent) ? meter('Prozessor (CPU)', world.cpuPercent, 200, { text: `${NUMBER.format(world.cpuPercent)} %` }) : null,
          meter('Speicher (Welt, Plugins, Sicherungen von Hand)', Number(disk.used) || 0, Number(disk.limit) || 0),
        ),
        h('dl', { class: 'world-card__facts hosted-facts' }, facts.map(([term, value]) => h('div', null, h('dt', { text: term }), h('dd', { text: value })))),
        h('p', { class: 'small text-3', text: `Ohne Spieler schläft die Welt nach ${world.sleepAfterMin === 0 ? '– nie (vom Team eingestellt)' : `${world.sleepAfterMin} Minuten`} und wacht beim Beitreten wieder auf (das dauert etwa 30 Sekunden). Tägliche Sicherungen zählen nicht zum Speicher.` }),
        world.code ? h('div', { class: 'btn-group' }, h('a', { class: 'btn btn--ghost btn--sm', href: `/welt#${world.code}`, target: '_blank', rel: 'noopener', dataset: { aktion: 'seite' } }, icon('external'), 'Öffentliche Seite')) : null,
      );
    }

    // --- Konsole
    let consoleLog = null;
    let consoleHead = null;
    let consoleForm = null;
    function paintLog() {
      if (!consoleLog) return;
      const atBottom = consoleLog.scrollHeight - consoleLog.scrollTop - consoleLog.clientHeight < 40;
      consoleLog.textContent = view.log.length ? view.log.join('\n') : 'Noch keine Zeilen.';
      if (atBottom) consoleLog.scrollTop = consoleLog.scrollHeight;
      renderConsoleHead();
    }
    function renderConsoleHead() {
      if (!consoleHead) return;
      const live = local.subscribedOk.has(id);
      fill(consoleHead, 
        h('span', { class: `chip chip--xs${live ? ' chip--online' : ''}`, dataset: { konsole: live ? 'live' : 'abfrage' } }, h('span', { class: `dot${live ? ' dot--online' : ''}`, 'aria-hidden': 'true' }), live ? 'Live' : 'Fragt alle 5 Sekunden nach'),
        h('span', { class: 'tiny text-3', text: `Letzte ${Math.min(view.log.length, CONSOLE_MAX)} Zeilen` }),
      );
    }
    function renderConsoleForm() {
      if (!consoleForm) return;
      const input = consoleForm.querySelector('input');
      const button = consoleForm.querySelector('button');
      const can = running();
      input.disabled = !can;
      button.disabled = !can;
      consoleForm.querySelector('.hosted-console__hint').textContent = can ? 'Ohne „/“ am Anfang, eine Zeile, höchstens 256 Zeichen – zum Beispiel „say Hallo“ oder „time set day“.' : 'Befehle gehen nur, wenn die Welt läuft.';
    }
    async function openConsole() {
      consoleLog = h('pre', { class: 'hosted-console__log', tabindex: '0', 'aria-label': `Konsole von ${view.world.name}`, id: `hw-${short}-log` });
      consoleHead = h('div', { class: 'hosted-console__head' });
      const input = h('input', { class: 'input input--mono', id: `hw-${short}-befehl`, maxlength: '256', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Befehl, z. B. say Hallo', 'aria-label': 'Befehl an den Server' });
      consoleForm = h(
        'form',
        { class: 'hosted-console__form', novalidate: true },
        h('div', { class: 'input-group' }, input, h('button', { type: 'submit', class: 'btn btn--primary btn--sm', dataset: { aktion: 'befehl' } }, icon('send'), 'Senden')),
        h('p', { class: 'tiny text-3 hosted-console__hint' }),
      );
      consoleForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const command = input.value.trim().replace(/^\/+/, '');
        if (!command) return;
        try {
          await busy(consoleForm.querySelector('button'), () => call('POST', worldPath(view.world, '/command'), { command }));
          input.value = '';
          view.appendLog([`> ${command}`]);
          input.focus();
        } catch (error) {
          showError(error);
        }
      });
      fill(panels.konsole, consoleHead, consoleLog, consoleForm, h('p', { class: 'hint', text: 'Server-Befehle dürfen Besitzer und Operatoren der Welt senden. Das Log des Servers (Spielernamen, Chat, Befehle) hebt der Heldix-Dienst 7 Tage auf.' }));
      renderConsoleForm();
      renderConsoleHead();
      paintLog();
      const data = await call('GET', `${worldPath(view.world, '/console')}?lines=200`);
      view.log = Array.isArray(data?.lines) ? data.lines.filter((line) => typeof line === 'string').slice(-CONSOLE_MAX) : [];
      paintLog();
      if (consoleLog) consoleLog.scrollTop = consoleLog.scrollHeight;
      renderConsoleHead();
      subscribe(id);
      // Ohne WebSocket: alle 5 Sekunden die letzten Zeilen holen
      clearInterval(view.pollTimer);
      view.pollTimer = setInterval(async () => {
        if (local.subscribedOk.has(id) || document.visibilityState !== 'visible' || detail.hidden || view.tab !== 'konsole') return;
        try {
          const next = await call('GET', `${worldPath(view.world, '/console')}?lines=200`);
          view.log = Array.isArray(next?.lines) ? next.lines.filter((line) => typeof line === 'string').slice(-CONSOLE_MAX) : view.log;
          paintLog();
        } catch {
          // beim nächsten Mal
        }
      }, CONSOLE_POLL_MS);
    }
    function stopConsole() {
      clearInterval(view.pollTimer);
      view.pollTimer = null;
      unsubscribe(id);
    }

    // --- Plugins
    async function loadPlugins(force) {
      if (!view.plugins || force) fill(panels.plugins, loadingLine('Plugins werden geladen …'));
      view.plugins = await call('GET', `${worldPath(view.world, '/plugins')}?updates=1`);
      renderPlugins();
    }
    function renderPlugins() {
      const data = view.plugins ?? {};
      const list = Array.isArray(data.plugins) ? data.plugins : [];
      const vanilla = data.software === 'vanilla' || view.world.software === 'vanilla';
      const max = Number(data.max) || view.world.maxPlugins || 0;
      const installed = list.length
        ? h(
            'ul',
            { class: 'rows hosted-plugins', id: `hw-${short}-plugins` },
            list.map((plugin) =>
              h(
                'li',
                { class: 'row', dataset: { plugin: plugin.project } },
                pluginTile(plugin.title),
                h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: plugin.title }), h('div', { class: 'row-sub', text: `Version ${plugin.version ?? '?'} · installiert ${relativeTime(plugin.installedAt)}${plugin.update ? ` · Update auf ${plugin.update.version}` : ''}` })),
                h(
                  'div',
                  { class: 'row-actions' },
                  plugin.update ? h('span', { class: 'chip chip--xs chip--accent', text: 'Update' }) : null,
                  isModrinthUrl(plugin.url) ? h('a', { class: 'btn btn--ghost btn--sm btn--icon', href: plugin.url, target: '_blank', rel: 'noopener', 'aria-label': `${plugin.title} bei Modrinth`, title: 'Bei Modrinth ansehen' }, icon('external')) : null,
                  owner() && plugin.update ? h('button', { type: 'button', class: 'btn btn--secondary btn--sm', dataset: { aktion: 'aktualisieren' }, onClick: (event) => updatePlugin(plugin, event.currentTarget) }, icon('refresh'), 'Aktualisieren') : null,
                  owner() ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon quiet-danger', 'aria-label': `${plugin.title} entfernen`, title: 'Entfernen', dataset: { aktion: 'entfernen' }, onClick: (event) => removePlugin(plugin, event.currentTarget) }, icon('trash')) : null,
                ),
              ),
            ),
          )
        : emptyState(vanilla ? 'Diese Welt läuft mit Vanilla – Plugins gehen nur mit Paper.' : 'Noch keine Plugins installiert.', 'addons');
      const search = owner() && !vanilla ? pluginSearch(list.length >= max) : null;
      fill(panels.plugins, 
        h('p', { class: 'info-box small hosted-plugin-notice' }, icon('shield'), h('span', { text: PLUGIN_NOTICE })),
        h('div', { class: 'hosted-section-head' }, h('h4', { class: 'h4', text: 'Installiert' }), h('span', { class: 'chip chip--xs', text: `${list.length} von ${max}` })),
        installed,
        search,
        readOnlyNote(),
      );
    }
    function pluginSearch(full) {
      const input = h('input', { class: 'input', type: 'search', id: `hw-${short}-suche`, maxlength: '64', autocomplete: 'off', placeholder: 'Plugin suchen, z. B. Rechte, Warps, Karten …', 'aria-label': 'Plugins bei Modrinth suchen' });
      const results = h('div', { class: 'hosted-plugin-results', id: `hw-${short}-treffer`, 'aria-live': 'polite' });
      const form = h('form', { class: 'hosted-plugin-search', role: 'search', novalidate: true }, h('div', { class: 'input-group' }, input, h('button', { type: 'submit', class: 'btn btn--secondary btn--sm', dataset: { aktion: 'suchen' } }, icon('search'), 'Suchen')));
      const show = () => {
        const hits = view.searchHits;
        if (!hits) return fill(results, );
        if (!hits.length) return fill(results, emptyState('Kein passendes Plugin für diese Minecraft-Version gefunden.', 'search'));
        const installedIds = new Set((view.plugins?.plugins ?? []).map((plugin) => plugin.project));
        fill(results, 
          h(
            'ul',
            { class: 'rows' },
            hits.map((hit) =>
              h(
                'li',
                { class: 'row', dataset: { treffer: hit.project } },
                pluginTile(hit.title),
                h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: hit.title }), h('div', { class: 'row-sub', text: `${hit.author ? `von ${hit.author} · ` : ''}${NUMBER.format(Number(hit.downloads) || 0)} Downloads` }), hit.description ? h('div', { class: 'row-sub hosted-plugin-desc', text: hit.description }) : null),
                h(
                  'div',
                  { class: 'row-actions' },
                  isModrinthUrl(hit.url) ? h('a', { class: 'btn btn--ghost btn--sm btn--icon', href: hit.url, target: '_blank', rel: 'noopener', 'aria-label': `${hit.title} bei Modrinth`, title: 'Bei Modrinth ansehen' }, icon('external')) : null,
                  installedIds.has(hit.project) ? h('span', { class: 'chip chip--xs chip--online', text: 'installiert' }) : h('button', { type: 'button', class: 'btn btn--primary btn--sm', disabled: full || undefined, title: full ? 'Höchstzahl der Plugins erreicht' : undefined, dataset: { aktion: 'installieren' }, onClick: (event) => installPlugin(hit, event.currentTarget) }, icon('download'), 'Installieren'),
                ),
              ),
            ),
          ),
        );
      };
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const q = input.value.trim();
        fill(results, loadingLine('Suche bei Modrinth …'));
        try {
          const data = await call('GET', `/v1/hosting/plugins/search?${new URLSearchParams({ q, version: view.world.version ?? '', limit: '10' })}`);
          view.searchHits = Array.isArray(data?.hits) ? data.hits : [];
          show();
        } catch (error) {
          fill(results, emptyState(error.message, 'warning'));
        }
      });
      show();
      return h('div', { class: 'hosted-plugin-add' }, h('h4', { class: 'h4', text: 'Plugin hinzufügen' }), h('p', { class: 'small text-3', text: `Nur Paper-Plugins aus dem Modrinth-Katalog, passend zu Minecraft ${view.world.version ?? ''}. Der Dienst prüft jede Datei, bevor sie in die Welt kommt.` }), form, results);
    }
    async function installPlugin(hit, button) {
      const ok = await confirmAction({
        title: `„${hit.title}“ installieren?`,
        text: [PLUGIN_NOTICE, 'Vorher legt der Dienst eine Sicherung an. Das Plugin wirkt nach einem Neustart der Welt.'],
        confirmLabel: 'Installieren',
      });
      if (!ok) return;
      try {
        const result = await busy(button, () => call('POST', worldPath(view.world, '/plugins'), { project: hit.project }));
        toast(`„${result?.plugin?.title ?? hit.title}“ ist installiert.${result?.restartNeeded ? ' Neustart nötig.' : ''}`, 'success');
        applyWorld({ ...view.world, plugins: (Number(view.world.plugins) || 0) + 1, restartNeeded: Boolean(result?.restartNeeded) || view.world.restartNeeded });
        await loadPlugins(false);
      } catch (error) {
        showError(error);
      }
    }
    async function updatePlugin(plugin, button) {
      try {
        const result = await busy(button, () => call('POST', worldPath(view.world, `/plugins/${encodeURIComponent(plugin.project)}/update`)));
        toast(result?.updated ? `„${plugin.title}“ ist aktualisiert.${result?.restartNeeded ? ' Neustart nötig.' : ''}` : `„${plugin.title}“ ist schon aktuell.`, 'success');
        if (result?.restartNeeded) applyWorld({ ...view.world, restartNeeded: true });
        await loadPlugins(false);
      } catch (error) {
        showError(error);
      }
    }
    async function removePlugin(plugin, button) {
      const ok = await confirmAction({ title: `„${plugin.title}“ entfernen?`, text: 'Vorher legt der Dienst eine Sicherung an. Die Konfiguration des Plugins bleibt im Ordner plugins/ liegen.', confirmLabel: 'Entfernen', danger: true });
      if (!ok) return;
      try {
        const result = await busy(button, () => call('DELETE', worldPath(view.world, `/plugins/${encodeURIComponent(plugin.project)}`)));
        toast(`„${plugin.title}“ ist entfernt.${result?.restartNeeded ? ' Neustart nötig.' : ''}`);
        applyWorld({ ...view.world, plugins: Math.max(0, (Number(view.world.plugins) || 1) - 1), restartNeeded: Boolean(result?.restartNeeded) || view.world.restartNeeded });
        await loadPlugins(false);
      } catch (error) {
        showError(error);
      }
    }

    // --- Einstellungen
    async function loadSettings(force) {
      if (!view.properties || force) fill(panels.einstellungen, loadingLine('Einstellungen werden geladen …'));
      view.properties = await call('GET', worldPath(view.world, '/properties'));
      renderSettings();
    }
    function renderSettings() {
      const data = view.properties ?? {};
      const rules = data.rules && typeof data.rules === 'object' ? data.rules : {};
      const values = data.properties && typeof data.properties === 'object' ? data.properties : {};
      const editable = owner();
      const inputs = new Map();
      const fieldFor = (key, rule) => {
        const fieldId = `hw-${short}-p-${key}`;
        const label = PROPERTY_LABELS[key] ?? key;
        const value = values[key];
        let input;
        if (rule.kind === 'bool') {
          input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id: fieldId, checked: value === true || undefined, disabled: !editable || undefined });
          inputs.set(key, { input, read: () => input.checked, initial: value === true });
          return h('label', { class: 'switch-row hosted-switch', for: fieldId }, h('span', { class: 'switch-text' }, h('strong', { text: label })), input);
        }
        if (rule.kind === 'int') {
          input = h('input', { type: 'number', class: 'input', id: fieldId, min: String(rule.min), max: String(rule.max), step: '1', value: value ?? '', disabled: !editable || undefined, inputmode: 'numeric' });
          inputs.set(key, { input, read: () => Number(input.value), initial: value, rule });
          return h('div', { class: 'field' }, h('label', { class: 'field__label', for: fieldId, text: `${label} (${rule.min}–${rule.max})` }), input);
        }
        const options = Array.isArray(rule.values) ? rule.values : [];
        input = h('select', { class: 'input select', id: fieldId, disabled: !editable || undefined }, options.map((option) => h('option', { value: option, selected: option === value || undefined }, VALUE_LABELS[option] ?? option)));
        inputs.set(key, { input, read: () => input.value, initial: value });
        return h('div', { class: 'field' }, h('label', { class: 'field__label', for: fieldId, text: label }), input);
      };
      const keys = Object.keys(rules);
      const choiceKeys = keys.filter((key) => rules[key]?.kind !== 'bool');
      const boolKeys = keys.filter((key) => rules[key]?.kind === 'bool');

      // Welt: Name, Schlafen nach, Version
      const world = view.world;
      const nameId = `hw-${short}-name`;
      const sleepId = `hw-${short}-schlafen`;
      const versionId = `hw-${short}-version`;
      const name = h('input', { class: 'input', id: nameId, maxlength: '32', value: world.name ?? '', disabled: !editable || undefined, autocomplete: 'off' });
      const sleepValues = [...new Set([...SLEEP_CHOICES, ...(world.sleepAfterMin > 0 ? [world.sleepAfterMin] : [])])].sort((a, b) => a - b);
      const sleep = h(
        'select',
        { class: 'input select', id: sleepId, disabled: !editable || undefined },
        world.sleepAfterMin === 0 ? h('option', { value: '0', selected: true }, 'Nie (vom Team eingestellt)') : null,
        sleepValues.map((minutes) => h('option', { value: String(minutes), selected: minutes === world.sleepAfterMin || undefined }, `${minutes} Minuten ohne Spieler`)),
      );
      const asleep = world.state === 'sleeping' || world.state === 'error';
      const version = h('input', { class: 'input input--mono', id: versionId, maxlength: '32', value: world.version ?? '', disabled: !editable || !asleep || undefined, autocomplete: 'off', spellcheck: 'false' });
      const fixed = [
        values['level-seed'] !== undefined ? ['Seed', String(values['level-seed'])] : null,
        values['level-type'] !== undefined ? ['Welttyp', LEVEL_TYPES[values['level-type']] ?? String(values['level-type'])] : null,
        typeof data.motd === 'string' ? ['Beschreibung in der Serverliste', data.motd] : null,
      ].filter(Boolean);

      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const form = h(
        'form',
        { class: 'hosted-settings', novalidate: true, id: `hw-${short}-einstellungen-form` },
        h('h4', { class: 'h4', text: 'Welt' }),
        h(
          'div',
          { class: 'field-grid' },
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: nameId, text: 'Name' }), name),
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: sleepId, text: 'Schlafen nach' }), sleep),
          h('div', { class: 'field' }, h('label', { class: 'field__label', for: versionId, text: 'Minecraft-Version' }), version, h('p', { class: 'field__help', text: asleep ? 'Vorher legt der Dienst eine Sicherung an.' : 'Ändern geht nur, wenn die Welt schläft.' })),
        ),
        h('h4', { class: 'h4', text: 'Server (server.properties)' }),
        h('div', { class: 'field-grid' }, choiceKeys.map((key) => fieldFor(key, rules[key]))),
        h('div', { class: 'switches hosted-switches' }, boolKeys.map((key) => fieldFor(key, rules[key]))),
        fixed.length ? h('dl', { class: 'world-card__facts hosted-facts' }, fixed.map(([term, value]) => h('div', null, h('dt', { text: term }), h('dd', { text: value })))) : null,
        error,
        editable ? h('div', { class: 'btn-group' }, h('button', { type: 'submit', class: 'btn btn--primary btn--sm', dataset: { aktion: 'speichern' } }, icon('check'), 'Speichern'), h('span', { class: 'tiny text-3', text: 'Läuft die Welt, wirken Änderungen nach einem Neustart.' })) : null,
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!editable) return;
        error.hidden = true;
        const props = {};
        for (const [key, entry] of inputs) {
          const value = entry.read();
          if (entry.rule && (!Number.isInteger(value) || value < entry.rule.min || value > entry.rule.max)) {
            error.textContent = `„${PROPERTY_LABELS[key] ?? key}“ muss eine ganze Zahl von ${entry.rule.min} bis ${entry.rule.max} sein.`;
            error.hidden = false;
            entry.input.focus();
            return;
          }
          if (value !== entry.initial) props[key] = value;
        }
        const patch = {};
        if (name.value.trim() !== world.name) patch.name = name.value.trim();
        if (Number(sleep.value) !== world.sleepAfterMin && Number(sleep.value) > 0) patch.sleepAfterMin = Number(sleep.value);
        if (asleep && version.value.trim() && version.value.trim() !== world.version) patch.version = version.value.trim();
        if (!Object.keys(props).length && !Object.keys(patch).length) {
          toast('Nichts geändert.');
          return;
        }
        try {
          await busy(form.querySelector('button[type="submit"]'), async () => {
            if (Object.keys(patch).length) applyWorld(await call('PATCH', worldPath(view.world), patch));
            if (Object.keys(props).length) {
              view.properties = await call('PATCH', worldPath(view.world, '/properties'), props);
              if (view.properties?.restartNeeded) applyWorld({ ...view.world, restartNeeded: true, ...(props['max-players'] ? { maxPlayers: props['max-players'] } : {}) });
              else if (props['max-players']) applyWorld({ ...view.world, maxPlayers: props['max-players'] });
            }
          });
          toast('Einstellungen gespeichert.', 'success');
          renderSettings();
        } catch (problem) {
          error.textContent = problem.message;
          error.hidden = false;
        }
      });
      fill(panels.einstellungen, readOnlyNote(), form);
    }

    // --- Mitglieder
    function renderMembers() {
      const members = Array.isArray(view.detail?.members) ? view.detail.members : [];
      const sorted = [...members].sort((a, b) => String(a.name).localeCompare(String(b.name), 'de', { sensitivity: 'base' }));
      const shared = { id, name: view.world.name, defaultRole: view.detail?.defaultRole ?? 'player' };
      fill(panels.mitglieder, 
        h('p', { class: 'small text-3', text: `Zugang: ${{ invited: 'Nur Eingeladene', friends: 'Freunde und Eingeladene', open: 'Jeder mit der Adresse' }[view.world.access] ?? view.world.access ?? '–'}. Besitzer und Operatoren bekommen beim Beitreten Operator-Rechte, Besucher spielen im Abenteuer-Modus.` }),
        owner() && inviteFriends ? h('div', { class: 'btn-group' }, h('button', { type: 'button', class: 'btn btn--social btn--sm', dataset: { aktion: 'einladen' }, onClick: async () => { if (await inviteFriends(shared)) view.reloadMembers(); } }, icon('user-plus'), 'Freunde einladen')) : null,
        sorted.length
          ? h(
              'ul',
              { class: 'rows', id: `hw-${short}-mitglieder` },
              sorted.map((member) =>
                h(
                  'li',
                  { class: 'row', dataset: { name: member.name } },
                  h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: member.name }), h('div', { class: 'row-sub', text: `${MEMBER_ROLES[member.role] ?? member.role}${member.added ? ` · seit ${formatDate(member.added)}` : ''}${member.uuid ? '' : ' · kein Heldix-Konto bekannt'}` })),
                  owner() && removeMember ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon quiet-danger', 'aria-label': `${member.name} entfernen`, title: 'Entfernen', dataset: { aktion: 'mitglied-entfernen' }, onClick: async () => { if (await removeMember(shared, member)) view.reloadMembers(); } }, icon('close'))) : null,
                ),
              ),
            )
          : emptyState('Noch keine Mitglieder. Lade Freunde ein – oder lass anklopfen.', 'friends'),
        readOnlyNote(),
      );
    }

    // --- Sicherungen
    async function loadBackups() {
      fill(panels.sicherungen, loadingLine('Sicherungen werden geladen …'));
      view.backups = await call('GET', worldPath(view.world, '/backups'));
      renderBackups();
    }
    function renderBackups() {
      const data = view.backups ?? {};
      const list = (Array.isArray(data.backups) ? data.backups : []).slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      const manual = list.filter((backup) => backup.kind === 'manual').length;
      const maxManual = Number(data.maxManual) || 5;
      const asleep = view.world.state === 'sleeping' || view.world.state === 'error';
      fill(panels.sicherungen, 
        h('p', { class: 'small text-2', text: `Der Dienst sichert die Welt täglich (die letzten ${data.keepDaily ?? 7} bleiben) und vor jeder Plugin-Änderung, jedem Versionswechsel und jedem Hochladen. Von Hand gehen bis zu ${maxManual}.` }),
        h(
          'div',
          { class: 'btn-group' },
          h('button', { type: 'button', class: 'btn btn--primary btn--sm', disabled: manual >= maxManual || view.world.state === 'creating' || undefined, title: manual >= maxManual ? `Höchstens ${maxManual} Sicherungen von Hand` : undefined, dataset: { aktion: 'sichern' }, onClick: (event) => createBackup(event.currentTarget) }, icon('plus'), 'Jetzt sichern'),
          h('span', { class: 'tiny text-3', text: `${manual} von ${maxManual} von Hand` }),
        ),
        list.length
          ? h(
              'ul',
              { class: 'rows hosted-backups', id: `hw-${short}-sicherungen` },
              list.map((backup) =>
                h(
                  'li',
                  { class: 'row', dataset: { sicherung: backup.name } },
                  h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon(backup.kind === 'daily' ? 'clock' : backup.kind === 'manual' ? 'user' : 'shield')),
                  h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: formatDateTime(backup.createdAt) }), h('div', { class: 'row-sub', text: `${BACKUP_KINDS[backup.kind] ?? backup.kind} · ${formatBytes(backup.sizeBytes)}` })),
                  h(
                    'div',
                    { class: 'row-actions' },
                    h('a', { class: 'btn btn--ghost btn--sm btn--icon', href: `/api${worldPath(view.world, `/backups/${encodeURIComponent(backup.name)}/download`)}`, download: `${backup.name}.zip`, 'aria-label': `Sicherung vom ${formatDateTime(backup.createdAt)} herunterladen`, title: 'Herunterladen', dataset: { aktion: 'herunterladen' } }, icon('download')),
                    h('button', { type: 'button', class: 'btn btn--secondary btn--sm', disabled: !asleep || undefined, title: asleep ? undefined : 'Erst anhalten – wiederherstellen geht nur, wenn die Welt schläft', dataset: { aktion: 'wiederherstellen' }, onClick: (event) => restoreBackup(backup, event.currentTarget) }, icon('undo'), 'Wiederherstellen'),
                    h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon quiet-danger', 'aria-label': 'Sicherung löschen', title: 'Löschen', dataset: { aktion: 'sicherung-loeschen' }, onClick: (event) => deleteBackup(backup, event.currentTarget) }, icon('trash')),
                  ),
                ),
              ),
            )
          : emptyState('Noch keine Sicherungen.', 'clock'),
        asleep ? null : h('p', { class: 'hint', text: 'Wiederherstellen geht nur, wenn die Welt schläft. Halte sie dafür vorher an.' }),
      );
    }
    async function createBackup(button) {
      try {
        await busy(button, () => call('POST', worldPath(view.world, '/backups')));
        toast('Sicherung angelegt.', 'success');
        await loadBackups();
      } catch (error) {
        showError(error);
      }
    }
    async function restoreBackup(backup, button) {
      const ok = await confirmAction({ title: 'Sicherung wiederherstellen?', text: `Die Welt geht auf den Stand vom ${formatDateTime(backup.createdAt)} zurück – samt Plugin-Liste. Den jetzigen Stand sichert der Dienst vorher („Vor dem Wiederherstellen“).`, confirmLabel: 'Wiederherstellen', danger: true });
      if (!ok) return;
      try {
        const result = await busy(button, () => call('POST', worldPath(view.world, `/backups/${encodeURIComponent(backup.name)}/restore`)));
        if (result?.world) applyWorld(result.world);
        toast('Sicherung wiederhergestellt.', 'success');
        await loadBackups();
      } catch (error) {
        showError(error);
      }
    }
    async function deleteBackup(backup, button) {
      const ok = await confirmAction({ title: 'Sicherung löschen?', text: `Die Sicherung vom ${formatDateTime(backup.createdAt)} ist danach weg.`, confirmLabel: 'Löschen', danger: true });
      if (!ok) return;
      try {
        await busy(button, () => call('DELETE', worldPath(view.world, `/backups/${encodeURIComponent(backup.name)}`)));
        toast('Sicherung gelöscht.');
        await loadBackups();
      } catch (error) {
        showError(error);
      }
    }

    // --- Dateien (Plugin-Konfiguration)
    async function loadFiles(force) {
      if (!view.files || force) fill(panels.dateien, loadingLine('Dateien werden geladen …'));
      const data = await call('GET', worldPath(view.world, '/files'));
      view.files = Array.isArray(data?.files) ? data.files.filter((file) => typeof file === 'string') : [];
      renderFiles();
      if (view.fileOpen && view.files.includes(view.fileOpen.path)) openFile(view.fileOpen.path).catch(showError);
    }
    function renderFiles() {
      const files = view.files ?? [];
      const editor = h('div', { class: 'hosted-file', id: `hw-${short}-datei` });
      const list = files.length
        ? h(
            'ul',
            { class: 'hosted-file-list', 'aria-label': 'Konfigurationsdateien' },
            files.map((path) => h('li', null, h('button', { type: 'button', class: `hosted-file-pick${view.fileOpen?.path === path ? ' is-open' : ''}`, 'aria-pressed': String(view.fileOpen?.path === path), dataset: { datei: path }, onClick: () => openFile(path).catch(showError) }, icon('file'), h('span', { text: path })))),
          )
        : emptyState('Noch keine Konfigurationsdateien – Plugins legen sie beim ersten Start an.', 'file');
      fill(panels.dateien, h('p', { class: 'small text-2', text: 'Konfiguration der Plugins (Textdateien unter plugins/, höchstens 256 KB). Änderungen wirken nach einem Neustart.' }), h('div', { class: 'hosted-files' }, list, editor), readOnlyNote());
      if (view.fileOpen) renderEditor(editor);
    }
    async function openFile(path) {
      const data = await call('GET', `${worldPath(view.world, '/files')}?${new URLSearchParams({ path })}`);
      view.fileOpen = { path, content: typeof data?.content === 'string' ? data.content : '' };
      renderFiles();
    }
    function renderEditor(editor) {
      const file = view.fileOpen;
      const areaId = `hw-${short}-inhalt`;
      const area = h('textarea', { class: 'input textarea hosted-file__text', id: areaId, spellcheck: 'false', rows: '16', readonly: !owner() || undefined, value: file.content, autocapitalize: 'off' });
      const size = h('span', { class: 'tiny text-3 hosted-file__size' });
      const updateSize = () => {
        const bytes = new TextEncoder().encode(area.value).length;
        size.textContent = `${formatBytes(bytes)} von 256 KB`;
        size.classList.toggle('near', bytes > FILE_MAX_BYTES * 0.9);
        return bytes;
      };
      area.addEventListener('input', updateSize);
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const save = h('button', { type: 'button', class: 'btn btn--primary btn--sm', dataset: { aktion: 'datei-speichern' } }, icon('check'), 'Speichern');
      save.addEventListener('click', async () => {
        error.hidden = true;
        if (updateSize() > FILE_MAX_BYTES) {
          error.textContent = 'Die Datei ist zu groß (höchstens 256 KB).';
          error.hidden = false;
          return;
        }
        try {
          const result = await busy(save, () => call('PUT', `${worldPath(view.world, '/files')}?${new URLSearchParams({ path: file.path })}`, { content: area.value }));
          view.fileOpen = { path: file.path, content: area.value };
          if (result?.restartNeeded) applyWorld({ ...view.world, restartNeeded: true });
          toast(`${file.path} gespeichert.${result?.restartNeeded ? ' Neustart nötig.' : ''}`, 'success');
        } catch (problem) {
          error.textContent = problem.message;
          error.hidden = false;
        }
      });
      fill(editor, h('label', { class: 'field__label', for: areaId }, h('code', { text: file.path })), area, h('div', { class: 'btn-group' }, owner() ? save : null, size), error);
      updateSize();
    }

    // --- Gefahrenzone
    function renderDanger() {
      const world = view.world;
      const ready = !world.awaitingUpload && world.state !== 'creating';
      fill(panels.gefahr, 
        h(
          'div',
          { class: 'hosted-danger-row' },
          h('div', null, h('h4', { class: 'h4', text: 'Welt herunterladen' }), h('p', { class: 'small text-2', text: 'Als ZIP im Einzelspieler-Format. Im Spiel unter Heldix-Welten → „Herunterladen“ kommt sie als neue Einzelspielerwelt dazu. Läuft die Welt, speichert sie vorher.' })),
          ready ? h('a', { class: 'btn btn--secondary btn--sm', href: `/api${worldPath(world, '/download')}`, download: `${world.name}.zip`, dataset: { aktion: 'welt-herunterladen' } }, icon('download'), 'Herunterladen') : h('span', { class: 'tiny text-3', text: 'Noch nichts herunterzuladen.' }),
        ),
        h(
          'div',
          { class: 'hosted-danger-row danger-zone' },
          h('div', null, h('h4', { class: 'h4', text: 'Dauerhaft beenden' }), h('p', { class: 'small text-2', text: 'Der Server hält an, und Weltdaten, Plugins und Sicherungen auf dem Heldix-Server werden gelöscht. Die geteilte Welt mit Adresse und Mitgliedern bleibt – teilen kannst du sie dann wieder selbst.' })),
          h('button', { type: 'button', class: 'btn btn--danger btn--sm', dataset: { aktion: 'beenden' }, onClick: () => endHosting() }, icon('trash'), 'Dauerhaft beenden …'),
        ),
      );
    }

    async function endHosting() {
      const world = view.world;
      const inputId = uid('hw-bestaetigen');
      const input = h('input', { class: 'input', id: inputId, autocomplete: 'off', placeholder: world.name });
      const ok = await openDialog({
        title: `„${world.name}“ nicht mehr dauerhaft?`,
        body: [
          h('p', { text: 'Der Server hält an. Weltdaten, Plugins und Sicherungen auf dem Heldix-Server werden gelöscht – lade die Welt vorher herunter, wenn du den Stand behalten willst. Die geteilte Welt mit Adresse und Mitgliedern bleibt.' }),
          h('div', { class: 'field' }, h('label', { for: inputId }, 'Gib zur Bestätigung den Namen der Welt ', h('strong', { text: world.name }), ' ein:'), input),
        ],
        confirmLabel: 'Dauerhaft beenden',
        danger: true,
        canConfirm: () => input.value.trim().toLowerCase() === String(world.name).trim().toLowerCase(),
        onConfirm: () => call('DELETE', worldPath(world)),
      });
      if (!ok) return;
      applyWorld({ id: world.id, state: 'deleted' });
      toast(`„${world.name}“ läuft nicht mehr dauerhaft. Die geteilte Welt bleibt.`);
    }

    renderHead();
    renderNotices();
    renderKnocks();
    renderAddress();
    renderActions();
    return view;
  }

  // -------------------------------------------------------------------------------------------------------
  // Bereich zeichnen
  // -------------------------------------------------------------------------------------------------------

  /** Listen abgleichen, ohne vorhandene Karten neu zu bauen. */
  function reconcile(list, worlds) {
    const keep = new Set(worlds.map((world) => world.id));
    for (const [id, view] of local.views) {
      if (!keep.has(id) && list.contains(view.el)) {
        view.destroy();
        view.el.remove();
        local.views.delete(id);
        if (local.open === id) local.open = null;
      }
    }
    worlds.forEach((world, index) => {
      let view = local.views.get(world.id);
      if (!view) {
        view = createView(world);
        local.views.set(world.id, view);
      } else if (view.world !== world) view.update(world);
      if (list.children[index] !== view.el) list.insertBefore(view.el, list.children[index] ?? null);
    });
  }

  function renderIntro() {
    const data = local.data;
    const lim = limits();
    const used = ownWorlds().length;
    const max = Number(lim?.worlds) || 0;
    const slots = lim?.slots;
    const canCreate = allowed() && used < max;
    ownList.hidden = false;
    rerender(introBody, JSON.stringify([used, max, lim, data.team, canCreate]), () => [
      h(
        'div',
        { class: 'card__head' },
        h('span', { class: 'icon-tile icon-tile--online' }, shellIcon('server')),
        h('div', null, h('h2', { class: 'card__title', id: 'hosting-titel' }, 'Dauerhafte Welten ', h('span', { class: 'chip chip--xs chip--soon', text: 'Beta' })), h('p', { class: 'tiny text-3', text: 'Deine Welt läuft auf dem Heldix-Server – auch wenn du offline bist. Leere Welten schlafen und wachen beim Beitreten auf.' })),
        canCreate ? h('div', { class: 'card__head-end' }, h('button', { type: 'button', class: 'btn btn--primary btn--sm', id: 'hosting-neu', onClick: (event) => createNew(event.currentTarget) }, icon('plus'), 'Neue dauerhafte Welt')) : null,
      ),
      lim
        ? h(
            'ul',
            { class: 'hosting-limits', 'aria-label': 'Grenzen' },
            h('li', null, h('strong', { text: `${used} von ${max}` }), max === 1 ? ' dauerhafte Welt' : ' dauerhafte Welten', data.team ? ' (Team)' : ''),
            h('li', null, h('strong', { text: mb(lim.memoryMb) }), ' RAM je Welt'),
            h('li', null, h('strong', { text: mb(lim.diskMb) }), ' Speicher'),
            h('li', null, 'bis zu ', h('strong', { text: String(lim.maxPlugins) }), ' Plugins'),
            slots ? h('li', { id: 'hosting-plaetze' }, 'gerade ', h('strong', { text: `${slots.used} von ${slots.max}` }), ' Plätzen auf dem Server belegt') : null,
          )
        : null,
      used === 0 && allowed() ? h('p', { class: 'small text-2', text: 'Noch keine dauerhafte Welt. Leg oben eine neue an – oder stell unten eine deiner geteilten Welten mit „Dauerhaft online stellen“ um (hochgeladen wird sie im Spiel).' }) : null,
      allowed() && used >= max && max > 0 ? h('p', { class: 'tiny text-3', text: max === 1 ? 'Mehr als eine dauerhafte Welt geht gerade nicht. Beende eine, um eine andere dauerhaft zu machen.' : `Mehr als ${max} dauerhafte Welten gehen gerade nicht.` }) : null,
    ].filter(Boolean));
  }

  function renderBeta() {
    const plus = local.plus;
    const waiting = plus?.waitlist?.since;
    ownList.hidden = true;
    rerender(introBody, JSON.stringify(['beta', plus]), () =>
      h(
        'div',
        { class: 'hosting-beta', id: 'hosting-beta' },
        h('span', { class: 'icon-tile icon-tile--lg icon-tile--reward' }, shellIcon('star')),
        h(
          'div',
          { class: 'hosting-beta__text' },
          h('h2', { class: 'card__title', id: 'hosting-titel', text: 'Dauerhafte Welten sind in der Beta – bald mit Heldix+' }),
          h('p', { class: 'small text-2', text: 'Mit dauerhaften Welten läuft deine Welt rund um die Uhr auf dem Heldix-Server, auch wenn du offline bist. Gerade testen das Team und ausgewählte Beta-Tester. Später kommt das mit Heldix+ – Preise und Inhalte stehen noch nicht fest.' }),
          plus
            ? waiting
              ? h('p', { class: 'hosting-waitlist is-on', id: 'warteliste-stand' }, icon('check'), h('span', null, 'Du stehst seit ', h('strong', { text: formatDate(waiting) }), ' auf der Warteliste.'))
              : h('p', { class: 'hosting-waitlist', id: 'warteliste-stand' }, icon('info'), h('span', { text: 'Du stehst noch nicht auf der Warteliste.' }))
            : null,
          h('p', { class: 'tiny text-3', text: 'Beta-Plätze vergeben wir nach und nach. Bescheid bekommst du über die Glocke im Launcher, hier im Konto und im Spiel – ohne E-Mail.' }),
          h(
            'div',
            { class: 'btn-group' },
            plus && !waiting ? h('button', { type: 'button', class: 'btn btn--primary btn--sm', id: 'warteliste-eintragen', onClick: (event) => joinWaitlist(event.currentTarget) }, shellIcon('star'), 'Auf die Warteliste') : null,
            plus && waiting ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'warteliste-austragen', onClick: (event) => leaveWaitlist(event.currentTarget) }, icon('close'), 'Von der Warteliste nehmen') : null,
            h('a', { class: 'btn btn--secondary btn--sm', href: '/plus', id: 'hosting-plus-link' }, icon('info'), 'Mehr zu Heldix+'),
          ),
        ),
      ),
    );
  }

  function renderGranted() {
    if (!local.granted || !allowed()) {
      fill(grantedSlot, );
      return;
    }
    fill(grantedSlot, 
      h(
        'section',
        { class: 'card card--accent hosting-granted', id: 'hosting-freigeschaltet', role: 'status' },
        h('span', { class: 'icon-tile icon-tile--online' }, icon('check')),
        h('div', null, h('h2', { class: 'card__title', text: 'Freigeschaltet!' }), h('p', { class: 'small text-2', text: local.granted.text })),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm btn--icon', 'aria-label': 'Hinweis schließen', onClick: () => dismissGranted() }, icon('close')),
      ),
    );
    // Gesehen, sobald der Hinweis hier im sichtbaren Bereich steht
    if (!local.seenSent && ctx.shell.current() === 'welten' && document.visibilityState === 'visible') {
      local.seenSent = true;
      call('POST', '/v1/plus/seen').catch(() => {});
    }
  }

  function dismissGranted() {
    local.granted = null;
    if (!local.seenSent) {
      local.seenSent = true;
      call('POST', '/v1/plus/seen').catch(() => {});
    }
    renderGranted();
    publish();
  }

  function render() {
    if (!root) return;
    const data = local.data;
    if (!data) {
      if (!root.dataset.started) {
        root.dataset.started = '1';
        fill(introBody, h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Dauerhafte Welten werden geladen …' })));
        delete introBody.dataset.signature;
      }
      root.hidden = false;
      return;
    }
    // Aus oder älterer Dienst: der Bereich bleibt weg
    if (data.unavailable || data.reason === 'off' || (!data.allowed && data.reason !== 'beta')) {
      root.hidden = true;
      for (const view of local.views.values()) view.destroy();
      local.views.clear();
      fill(ownList, );
      fill(opList, );
      return;
    }
    root.hidden = false;
    renderGranted();
    if (data.allowed) {
      renderIntro();
      reconcile(ownList, ownWorlds());
      // Nur eine Welt: Verwaltung gleich offen
      if (!local.autoOpened && ownWorlds().length === 1 && !local.open) {
        local.autoOpened = true;
        local.open = ownWorlds()[0].id;
      }
    } else {
      renderBeta();
      for (const world of ownWorlds()) local.views.get(world.id)?.destroy();
    }
    reconcile(opList, operatedWorlds());
    opCard.hidden = !operatedWorlds().length;
    if (local.open) {
      const view = local.views.get(local.open);
      if (view && view.el.isConnected) {
        const detail = view.el.querySelector('.hosted-detail');
        if (detail?.hidden) view.openDetail();
      }
    }
  }

  return {
    refresh,
    render,
    handleEvent,
    onLiveOpen,
    /** Dauerhafte Welt zu einer geteilten Welt (gleiche ID) oder null. */
    hostedFor: (id) => ownWorlds().find((world) => world.id === id) ?? null,
    /** Darf eine (weitere) geteilte Welt dauerhaft werden? */
    canHost: () => allowed() && ownWorlds().length < (Number(limits()?.worlds) || 0),
    available: () => Boolean(local.data && !local.data.unavailable && local.data.reason !== 'off'),
    makeHosted,
    /** Verwaltung einer Welt öffnen (z. B. aus „Deine Welten“). */
    open(id) {
      const view = local.views.get(id);
      if (!view) return;
      local.open = id;
      view.openDetail();
      for (const [other, entry] of local.views) if (other !== id) entry.close();
      view.el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
    onTab(name) {
      if (name === 'welten') {
        refresh().catch(showError);
        return;
      }
      // Bereich verlassen: Live-Log abbestellen, Abfragen beenden
      for (const view of local.views.values()) view.destroy();
    },
    reset() {
      for (const view of local.views.values()) view.destroy();
      local.views.clear();
      local.data = null;
      local.plus = null;
      local.open = null;
      local.autoOpened = false;
      local.knocks.clear();
      local.subscribed.clear();
      local.subscribedOk.clear();
      local.granted = null;
      local.seenSent = false;
      fill(ownList, );
      fill(opList, );
      fill(introBody, );
      delete introBody.dataset.signature;
      if (root) delete root.dataset.started;
      ctx.store.hosting = null;
    },
    /** Beim Start im Hintergrund: Freischaltung noch nicht gesehen? (für die Glocke) */
    async checkGranted() {
      try {
        await refreshPlus();
      } catch {
        return;
      }
      if (local.granted) publish();
    },
  };
}
