// HeldixClient – Webseite: Team-Bereich (/team) für Moderatoren und Admins
// (Meldungen, Support, Spieler, Sperren, Neuigkeiten, Mein Teamprofil; Admins zusätzlich Updates, Team, Protokoll).
// Zugang: Cookie-Sitzung + Team-Rolle + Zwei-Faktor-Anmeldung (TOTP), in dieser Sitzung bestätigt (12 Stunden).
// Der Dienst antwortet sonst mit 403 und code forbidden / 2fa_setup_required / 2fa_required – dann zeigt
// die Seite die passende Sperre (Einrichten, Code eingeben, kein Zugang).
import {
  $,
  $$,
  ApiError,
  api,
  avatar,
  bindCounter,
  busy,
  capeName,
  confirmAction,
  copyText,
  emptyState,
  flashSaved,
  formatBytes,
  formatDate,
  formatDateTime,
  h,
  icon,
  isPlayerName,
  loadingState,
  normalizeUuid,
  openDialog,
  poller,
  reasonLabel,
  relativeTime,
  rerender,
  ROLE_LABELS,
  setupTabs,
  showError,
  textBlocks,
  timeEl,
  toast,
  uid,
  upload,
} from './app-common.js';
import { memberCard, newsCard, publicGet, skinHead } from './public-cards.js';

const SETUP_FILE_RE = /^HeldixClient-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.exe$/;
const MAX_UPLOAD = 1024 ** 3;
const MAX_REASON = 300;
const MAX_TITLE = 120;
const MAX_TEXT = 5000;
const AUDIT_STEP = 100;
const AUDIT_MAX = 500;

const state = {
  me: null,
  reportFilter: 'open',
  reports: [],
  players: [],
  selectedPlayer: null,
  news: [],
  editing: null, // { id|null, initial: {title,text,published}, at, author }
  updates: null,
  uploaded: null, // Antwort des letzten Uploads in dieser Sitzung { file, size, sha512 }
  manifest: null, // { outer, inner }
  uploading: null,
  auditLimit: AUDIT_STEP,
  supportFilter: 'open',
  supportTickets: [],
  ticket: null, // offene Support-Anfrage
  profile: null, // eigenes Teamprofil { public, title, about }
  since: undefined, // „im Team seit“ für die Vorschau
  previewHead: null,
  previewHeadPublic: null,
};

let tabs = null;
const teamRefresher = poller(() => teamTick(), 30_000);

// ---------------------------------------------------------------------------------------------------------
// Anfragen: 401 und die 403-Codes führen zur passenden Ansicht
// ---------------------------------------------------------------------------------------------------------

async function teamCall(method, path, body, options) {
  try {
    return await api(method, path, body, options);
  } catch (error) {
    handleAccessError(error);
    throw error;
  }
}

function handleAccessError(error) {
  if (!(error instanceof ApiError)) return;
  if (error.status === 401) {
    error.handled = true;
    showGuest('Deine Anmeldung ist abgelaufen oder wurde beendet. Melde dich im Konto-Bereich erneut an.');
  } else if (error.status === 403 && error.code === '2fa_required') {
    error.handled = true;
    if (state.me) state.me.twoFactor = { ...state.me.twoFactor, enabled: true, verified: false };
    showVerify('Die Bestätigung ist abgelaufen. Bitte gib einen neuen Code ein.');
  } else if (error.status === 403 && error.code === '2fa_setup_required') {
    error.handled = true;
    if (state.me) state.me.twoFactor = { enabled: false, verified: false };
    showSetup();
  } else if (error.status === 403 && error.code === 'forbidden') {
    error.handled = true;
    toast(error.message, 'error');
    reloadMe();
  }
}

async function reloadMe() {
  try {
    route(await api('GET', '/v1/web/me'));
  } catch (error) {
    if (error.status === 401) showGuest('Deine Anmeldung ist abgelaufen. Melde dich im Konto-Bereich erneut an.');
    else showUnavailable(error);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ansichten
// ---------------------------------------------------------------------------------------------------------

const VIEWS = ['team-laden', 'team-fehler', 'team-gast', 'team-kein-zugang', 'team-2fa-einrichten', 'team-2fa-pruefen', 'team-app'];

function showView(id) {
  for (const view of VIEWS) $(`#${view}`).hidden = view !== id;
  for (const dialog of document.querySelectorAll('dialog.modal')) if (id !== 'team-app') dialog.remove();
  if (id !== 'team-app') teamRefresher.stop();
}

function showGuest(message) {
  const notice = $('#team-gast-hinweis');
  notice.textContent = message || '';
  notice.hidden = !message;
  showView('team-gast');
}

function showUnavailable(error) {
  $('#team-fehler-text').textContent = error?.message || 'Bitte versuche es in ein paar Minuten noch einmal.';
  showView('team-fehler');
}

async function start() {
  showView('team-laden');
  try {
    route(await api('GET', '/v1/web/me'));
  } catch (error) {
    if (error.status === 401) showGuest();
    else showUnavailable(error);
  }
}

function route(me) {
  state.me = me;
  if (!me.role) {
    $('#kein-zugang-name').textContent = me.name;
    showView('team-kein-zugang');
  } else if (!me.twoFactor?.enabled) {
    showSetup();
  } else if (!me.twoFactor?.verified) {
    showVerify();
  } else {
    showApp();
  }
}

// ---------------------------------------------------------------------------------------------------------
// Zwei-Faktor-Anmeldung
// ---------------------------------------------------------------------------------------------------------

function showSetup() {
  $('#setup-schluessel').classList.add('step-disabled');
  $('#setup-code').classList.add('step-disabled');
  $('#setup-schluessel-inhalt').hidden = true;
  $('#setup-code-input').disabled = true;
  $('#setup-aktivieren').disabled = true;
  $('#setup-code-input').value = '';
  $('#setup-fehler').hidden = true;
  $('#setup-start-fehler').hidden = true;
  $('#setup-start').lastChild.textContent = 'Schlüssel erzeugen';
  $('#setup-start').classList.remove('ghost');
  showView('team-2fa-einrichten');
}

async function startSetup(event) {
  const button = event.currentTarget;
  const error = $('#setup-start-fehler');
  error.hidden = true;
  try {
    const data = await busy(button, () => api('POST', '/v1/web/2fa/setup'));
    const secret = String(data?.secret ?? '').replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z2-7]+=*$/.test(secret)) throw new Error('Der Dienst hat keinen gültigen Schlüssel geschickt.');
    const groups = secret.replace(/=+$/, '').match(/.{1,4}/g) ?? [];
    $('#setup-secret').replaceChildren(...groups.map((group) => h('span', { text: group })));
    $('#setup-secret').dataset.secret = secret;
    const link = $('#setup-link');
    const uri = String(data?.uri ?? '');
    link.hidden = !uri.startsWith('otpauth://');
    if (uri.startsWith('otpauth://')) link.href = uri;
    $('#setup-schluessel-inhalt').hidden = false;
    $('#setup-schluessel').classList.remove('step-disabled');
    $('#setup-code').classList.remove('step-disabled');
    $('#setup-code-input').disabled = false;
    $('#setup-aktivieren').disabled = false;
    button.lastChild.textContent = 'Neuen Schlüssel erzeugen';
    button.classList.add('ghost');
    $('#setup-kopieren').focus();
  } catch (problem) {
    if (problem instanceof ApiError && problem.status === 401) return showGuest('Deine Anmeldung ist abgelaufen. Melde dich im Konto-Bereich erneut an.');
    error.textContent = problem.message;
    error.hidden = false;
  }
}

function readCode(input) {
  return input.value.replace(/[\s-]/g, '');
}

async function submitCode(event, { path, input, error, success }) {
  event.preventDefault();
  error.hidden = true;
  const code = readCode(input);
  if (!/^\d{6}$/.test(code)) {
    error.textContent = 'Der Code hat genau 6 Ziffern.';
    error.hidden = false;
    input.focus();
    return;
  }
  const button = event.currentTarget.querySelector('button[type="submit"]');
  try {
    const me = await busy(button, () => api('POST', path, { code }));
    input.value = '';
    route(me);
    toast(success, 'success');
  } catch (problem) {
    // 401 heißt hier meistens „Der Code stimmt nicht.“ – oder die Sitzung ist weg. Kurz nachsehen.
    if (problem instanceof ApiError && problem.status === 401) {
      const stillLoggedIn = await api('GET', '/v1/web/me').then(
        () => true,
        (check) => check.status !== 401,
      );
      if (!stillLoggedIn) {
        showGuest('Deine Anmeldung ist abgelaufen. Melde dich im Konto-Bereich erneut an.');
        return;
      }
    }
    error.textContent = problem.message;
    error.hidden = false;
    input.select();
  }
}

function showVerify(message) {
  const error = $('#verify-fehler');
  error.textContent = message || '';
  error.hidden = !message;
  showView('team-2fa-pruefen');
  $('#verify-code').focus();
}

// ---------------------------------------------------------------------------------------------------------
// Team-Bereich
// ---------------------------------------------------------------------------------------------------------

const isAdmin = () => state.me?.role === 'admin';

function showApp() {
  const admin = isAdmin();
  for (const tab of $$('[data-admin]')) tab.hidden = !admin;
  $('#team-meta').replaceChildren(
    h('span', { text: `Angemeldet als ${state.me.name}` }),
    h('span', { class: 'chip accent', text: ROLE_LABELS[state.me.role] ?? state.me.role }),
    h('span', { class: 'chip success' }, icon('lock'), '2FA bestätigt'),
  );
  showView('team-app');
  const wanted = location.hash.slice(1);
  const current = tabs.current();
  tabs.select(tabs.has(wanted) ? wanted : current && tabs.has(current) ? current : 'meldungen');
  refreshSupportCount().catch(() => {});
  if (tabs.current() !== 'profil') loadProfile().catch(() => {});
  teamRefresher.start();
}

function onTab(name) {
  history.replaceState(null, '', `${location.pathname}${location.search}#${name}`);
  const loaders = {
    meldungen: loadReports,
    sperren: loadBans,
    neuigkeiten: loadNews,
    updates: loadUpdates,
    team: loadMembers,
    protokoll: loadAudit,
    support: loadSupport,
    profil: loadProfile,
  };
  if (loaders[name]) loaders[name]().catch(showError);
  if (name === 'spieler' && !state.players.length && !state.selectedPlayer) $('#spieler-liste').replaceChildren(h('p', { class: 'hint', text: 'Gib einen Namen (oder den Anfang) oder eine UUID ein.' }));
}

/** Spielername als Knopf, der die Details öffnet. */
function playerButton(player) {
  if (!player?.uuid) return h('span', { text: player?.name ?? 'Unbekannt' });
  return h('button', { type: 'button', class: 'link-button', onClick: () => openPlayer(player.uuid) }, player.name || player.uuid);
}

function chip(text, kind = '') {
  return h('span', { class: `chip${kind ? ` ${kind}` : ''}`, text });
}

/** Sperren mit Grund (aus Meldung, Spieler-Details). Optional die Meldung gleich erledigen. */
async function banDialog(target, { reason = '', report = null } = {}) {
  const reasonId = uid('grund');
  const input = h('input', { class: 'input', id: reasonId, maxlength: String(MAX_REASON), autocomplete: 'off', value: reason });
  const counter = h('span', { class: 'counter' });
  bindCounter(input, counter, MAX_REASON);
  const markDone = report && report.status !== 'done' ? h('input', { type: 'checkbox', checked: true }) : null;
  const ok = await openDialog({
    title: `${target.name} sperren?`,
    body: [
      h('p', { text: `${target.name} kann den Heldix-Dienst danach nicht mehr nutzen; offene Verbindungen werden sofort getrennt. Die Sperre bleibt, bis jemand im Team sie aufhebt.` }),
      h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { for: reasonId, text: 'Grund (sieht nur das Team)' }), counter), input),
      markDone ? h('label', { class: 'check-row' }, markDone, h('span', { text: `Meldung #${report.id} als erledigt markieren` })) : null,
    ],
    confirmLabel: 'Sperren',
    danger: true,
    canConfirm: () => input.value.trim().length > 0,
    onConfirm: async () => {
      await teamCall('POST', '/v1/team/bans', { uuid: target.uuid, reason: input.value.trim() });
      if (markDone?.checked) await teamCall('POST', `/v1/team/reports/${report.id}/done`);
    },
  });
  if (ok) toast(`${target.name} ist gesperrt.`, 'success');
  return Boolean(ok);
}

async function unbanDialog(target) {
  const ok = await confirmAction({
    title: `Sperre von ${target.name} aufheben?`,
    text: `${target.name} kann den Heldix-Dienst danach wieder nutzen.`,
    confirmLabel: 'Sperre aufheben',
    onConfirm: () => teamCall('DELETE', `/v1/team/bans/${target.uuid}`),
  });
  if (ok) toast(`Die Sperre von ${target.name} ist aufgehoben.`, 'success');
  return ok;
}

// ---------------------------------------------------------------------------------------------------------
// Meldungen
// ---------------------------------------------------------------------------------------------------------

async function loadReports({ focusId } = {}) {
  const box = $('#meldungen');
  if (!box.firstChild || box.dataset.filter !== state.reportFilter) {
    box.dataset.signature = '';
    box.replaceChildren(loadingState());
  }
  box.dataset.filter = state.reportFilter;
  const filter = state.reportFilter;
  const data = await teamCall('GET', `/v1/team/reports?status=${filter}`);
  if (filter !== state.reportFilter) return;
  state.reports = Array.isArray(data?.reports) ? data.reports : [];
  if (filter === 'open') setOpenCount(state.reports.length);
  else if (filter === 'all') setOpenCount(state.reports.filter((report) => report.status !== 'done').length);
  renderReports();
  if (focusId !== undefined) {
    const card = $(`#meldung-${focusId}`);
    if (card) {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' });
      card.focus({ preventScroll: true });
      card.classList.add('highlight');
      const details = card.querySelector('details');
      if (details) details.open = true;
    }
  }
}

function setOpenCount(count) {
  const badge = $('#count-meldungen');
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', `${count} offen`);
}

function renderReports() {
  const filter = state.reportFilter;
  rerender($('#meldungen'), JSON.stringify(state.reports), () => {
    if (!state.reports.length) {
      const text = filter === 'open' ? 'Keine offenen Meldungen. Alles erledigt!' : filter === 'done' ? 'Noch keine erledigten Meldungen.' : 'Keine Meldungen in den letzten 90 Tagen.';
      return emptyState(text, 'check');
    }
    return state.reports.map(reportCard);
  });
}

function reportCard(report) {
  const done = report.status === 'done';
  const reported = report.reported ?? {};
  const messages = Array.isArray(report.messages) ? report.messages : [];
  return h(
    'article',
    { class: 'app-card report', id: `meldung-${report.id}`, tabindex: '-1', 'aria-labelledby': `meldung-${report.id}-titel` },
    h(
      'div',
      { class: 'report-head' },
      h('h2', { class: 'report-id', id: `meldung-${report.id}-titel`, text: `Meldung #${report.id}` }),
      chip(done ? 'Erledigt' : 'Offen', done ? 'success' : 'warning'),
      chip(reasonLabel(report.reason)),
      h('span', { class: 'report-time' }, timeEl(report.at, formatDateTime(report.at))),
    ),
    h(
      'p',
      { class: 'report-who' },
      playerButton(report.reporter),
      ' hat ',
      playerButton(reported),
      ' gemeldet.',
      reported.banned ? h('span', { class: 'chip danger', text: 'gesperrt' }) : null,
    ),
    report.note ? h('blockquote', { class: 'quote' }, h('span', { class: 'quote-label', text: 'Hinweis: ' }), report.note) : h('p', { class: 'muted small', text: 'Kein Hinweis angegeben.' }),
    messages.length
      ? h(
          'details',
          { class: 'snapshot' },
          h('summary', null, `Chatverlauf ansehen (${messages.length} ${messages.length === 1 ? 'Nachricht' : 'Nachrichten'})`),
          h(
            'ol',
            { class: 'snap-list' },
            messages.map((message) =>
              h(
                'li',
                { class: `snap-line${message.from === reported.uuid ? ' reported' : ''}` },
                h('span', { class: 'snap-meta' }, h('strong', { text: message.fromName ?? (message.from === reported.uuid ? reported.name : report.reporter?.name) ?? '?' }), ` · ${formatDateTime(message.at)}`),
                h('span', { class: 'snap-text', text: message.text }),
              ),
            ),
          ),
          h('p', { class: 'hint', text: `Rot markiert: Nachrichten von ${reported.name ?? 'dem gemeldeten Spieler'}.` }),
        )
      : h('p', { class: 'muted small', text: 'Kein Chatverlauf: Die beiden hatten keine Nachrichten.' }),
    done ? h('p', { class: 'muted small', text: `Erledigt ${report.doneAt ? `am ${formatDateTime(report.doneAt)}` : ''}${report.doneBy ? ` von ${report.doneBy}` : ''}.` }) : null,
    h(
      'div',
      { class: 'card-actions' },
      done ? null : h('button', { type: 'button', class: 'button tiny', onClick: (event) => markDone(event.currentTarget, report) }, icon('check'), 'Als erledigt markieren'),
      reported.banned || !reported.uuid
        ? null
        : h('button', { type: 'button', class: 'button tiny ghost danger-text', onClick: () => banFromReport(report) }, icon('ban'), `${reported.name ?? 'Spieler'} sperren …`),
      reported.uuid ? h('button', { type: 'button', class: 'button tiny ghost', onClick: () => openPlayer(reported.uuid) }, icon('user'), 'Spieler ansehen') : null,
    ),
  );
}

async function markDone(button, report) {
  try {
    const data = await busy(button, () => teamCall('POST', `/v1/team/reports/${report.id}/done`));
    const updated = data?.report ?? { ...report, status: 'done' };
    state.reports = state.reportFilter === 'open' ? state.reports.filter((entry) => entry.id !== report.id) : state.reports.map((entry) => (entry.id === report.id ? updated : entry));
    if (state.reportFilter === 'open') setOpenCount(state.reports.length);
    renderReports();
    toast(`Meldung #${report.id} ist erledigt.`, 'success');
    $('#meldungen-filter [aria-pressed="true"]')?.focus();
  } catch (error) {
    showError(error);
  }
}

async function banFromReport(report) {
  const banned = await banDialog(report.reported, { reason: `Meldung #${report.id}: ${reasonLabel(report.reason)}`, report });
  if (banned) await loadReports().catch(showError);
}

function setReportFilter(status) {
  state.reportFilter = status;
  for (const button of $$('#meldungen-filter button')) button.setAttribute('aria-pressed', String(button.dataset.status === status));
}

async function showReport(id) {
  setReportFilter('all');
  tabs.select('meldungen', { silent: true });
  history.replaceState(null, '', `${location.pathname}#meldungen`);
  await loadReports({ focusId: id }).catch(showError);
}

// ---------------------------------------------------------------------------------------------------------
// Spieler
// ---------------------------------------------------------------------------------------------------------

let searchTimer = null;
let searchAbort = null;

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search().catch(showError), 300);
}

async function search() {
  const raw = $('#spieler-q').value.trim();
  const list = $('#spieler-liste');
  searchAbort?.abort();
  if (!raw) {
    state.players = [];
    list.dataset.signature = '';
    list.replaceChildren(h('p', { class: 'hint', text: 'Gib einen Namen (oder den Anfang) oder eine UUID ein.' }));
    return;
  }
  const query = normalizeUuid(raw) ?? raw;
  searchAbort = new AbortController();
  let data;
  try {
    data = await teamCall('GET', `/v1/team/players?q=${encodeURIComponent(query)}`, undefined, { signal: searchAbort.signal });
  } catch (error) {
    if (error.name === 'AbortError') return;
    throw error;
  }
  state.players = Array.isArray(data?.players) ? data.players : [];
  renderPlayers();
}

function renderPlayers() {
  const selected = state.selectedPlayer?.uuid ?? '';
  rerender($('#spieler-liste'), JSON.stringify([state.players, selected]), () => {
    if (!state.players.length) return emptyState('Kein Spieler gefunden.', 'search');
    return h(
      'ul',
      { class: 'rows' },
      state.players.map((player) =>
        h(
          'li',
          null,
          h(
            'button',
            { type: 'button', class: 'row row-button', 'aria-current': player.uuid === selected ? 'true' : undefined, dataset: { focusKey: `player:${player.uuid}` }, onClick: () => openPlayer(player.uuid, { fromList: true }) },
            avatar(player.name, player.uuid, { online: Boolean(player.online) }),
            h(
              'span',
              { class: 'row-main' },
              h('span', { class: 'row-title' }, h('span', { text: player.name }), player.banned ? chip('gesperrt', 'danger') : null, player.role ? chip(ROLE_LABELS[player.role] ?? player.role, 'accent') : null),
              h('span', { class: `row-sub${player.online ? ' online' : ''}`, text: player.online ? 'online' : `zuletzt online ${relativeTime(player.lastSeen)}` }),
            ),
            icon('chevron-right'),
          ),
        ),
      ),
    );
  });
}

async function openPlayer(uuid, { fromList = false } = {}) {
  if (tabs.current() !== 'spieler') tabs.select('spieler');
  const detail = $('#spieler-detail');
  detail.replaceChildren(loadingState('Spieler wird geladen …'));
  try {
    const player = await teamCall('GET', `/v1/team/players/${uuid}`);
    state.selectedPlayer = player;
    renderPlayerDetail(player);
    if (!fromList) {
      // Aus einer Meldung gekommen: die Suche zeigt den Spieler mit an.
      $('#spieler-q').value = player.name;
      await search().catch(() => {});
    } else {
      renderPlayers();
    }
    if (!window.matchMedia('(min-width: 901px)').matches) detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('#spieler-detail-titel')?.focus({ preventScroll: true });
  } catch (error) {
    if (error.handled) return;
    detail.replaceChildren(emptyState(error.message, 'warning'));
  }
}

function yesNo(value) {
  return value ? 'an' : 'aus';
}

function reportChips(ids) {
  if (!Array.isArray(ids) || !ids.length) return 'keine';
  return h('span', { class: 'chips-row' }, ids.map((id) => h('button', { type: 'button', class: 'chip link-chip', onClick: () => showReport(id), 'aria-label': `Meldung #${id} öffnen` }, `#${id}`)));
}

function renderPlayerDetail(player) {
  const detail = $('#spieler-detail');
  const admin = isAdmin();
  const copy = h('button', { type: 'button', class: 'icon-button small', 'aria-label': 'UUID kopieren', title: 'UUID kopieren' }, icon('copy'));
  copy.addEventListener('click', async () => toast((await copyText(player.uuid)) ? 'UUID kopiert.' : 'Kopieren ging nicht – bitte von Hand markieren.', 'info'));
  const facts = [
    ['UUID', h('span', { class: 'uuid-row' }, h('code', { class: 'mono', text: player.uuid }), copy)],
    ['Heldix-Cape', capeName(player.cape)],
    ['Für andere erkennbar', yesNo(player.visible)],
    ['Online-Status für Freunde', yesNo(player.presence)],
    ['Server für Freunde', yesNo(player.showServer)],
    ['Nachrichten von Freunden', yesNo(player.messages)],
    ['Erste Anmeldung', formatDateTime(player.createdAt)],
    ['Zuletzt online', player.online ? 'gerade online' : formatDateTime(player.lastSeen)],
    ['Freunde', String(player.friends ?? 0)],
    ['Hat blockiert', String(player.blocks ?? 0)],
    ['Wurde gemeldet', reportChips(player.reportsAbout)],
    ['Hat gemeldet', reportChips(player.reportsBy)],
  ];
  const ban = player.ban;
  detail.replaceChildren(
    h(
      'div',
      { class: 'detail-head' },
      avatar(player.name, player.uuid, { size: 'lg', online: Boolean(player.online) }),
      h(
        'div',
        { class: 'detail-title' },
        h('h2', { id: 'spieler-detail-titel', tabindex: '-1', text: player.name }),
        h('div', { class: 'chips-row' }, player.online ? chip('online', 'success') : chip('offline'), ban ? chip('gesperrt', 'danger') : null, player.role ? chip(ROLE_LABELS[player.role] ?? player.role, 'accent') : null),
      ),
    ),
    h('dl', { class: 'facts-list' }, facts.map(([term, value]) => [h('dt', { text: term }), h('dd', null, value)])),
    h('p', { class: 'hint', text: 'Nachrichteninhalte sind hier nicht sichtbar – nur der Chatverlauf in einer Meldung.' }),
    ban
      ? h(
          'div',
          { class: 'ban-box' },
          h('p', { class: 'ban-title' }, icon('ban'), h('strong', { text: 'Gesperrt' }), h('span', { class: 'muted', text: ` seit ${formatDateTime(ban.at)}${ban.by ? ` von ${ban.by}` : ''}` })),
          ban.reason ? h('blockquote', { class: 'quote', text: ban.reason }) : null,
          h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'button tiny ghost', onClick: () => unbanPlayer(player) }, 'Sperre aufheben')),
        )
      : h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'button tiny ghost danger-text', onClick: () => banPlayer(player) }, icon('ban'), 'Sperren …')),
    admin
      ? h(
          'div',
          { class: 'admin-actions' },
          h('h3', { text: 'Nur für Admins' }),
          h(
            'div',
            { class: 'card-actions' },
            h('button', { type: 'button', class: 'button tiny ghost', disabled: !player.cape || undefined, title: player.cape ? undefined : 'Kein Cape gewählt', onClick: () => resetCape(player) }, 'Cape zurücksetzen'),
            h('button', { type: 'button', class: 'button tiny ghost danger-text', onClick: () => deletePlayer(player) }, icon('trash'), 'Daten löschen …'),
          ),
        )
      : null,
  );
}

async function refreshPlayer(uuid) {
  try {
    const player = await teamCall('GET', `/v1/team/players/${uuid}`);
    state.selectedPlayer = player;
    renderPlayerDetail(player);
  } catch (error) {
    showError(error);
  }
  if ($('#spieler-q').value.trim()) search().catch(() => {});
}

async function banPlayer(player) {
  if (await banDialog(player)) await refreshPlayer(player.uuid);
}

async function unbanPlayer(player) {
  if (await unbanDialog(player)) await refreshPlayer(player.uuid);
}

async function resetCape(player) {
  let updated = null;
  const ok = await confirmAction({
    title: `Cape von ${player.name} zurücksetzen?`,
    text: `${player.name} hat danach kein Heldix-Cape mehr und kann sich im Spiel ein neues aussuchen.`,
    confirmLabel: 'Zurücksetzen',
    onConfirm: async () => {
      updated = await teamCall('POST', `/v1/team/players/${player.uuid}/reset-cape`);
    },
  });
  if (!ok) return;
  toast(`Das Cape von ${player.name} ist zurückgesetzt.`, 'success');
  if (updated && updated.uuid) {
    state.selectedPlayer = updated;
    renderPlayerDetail(updated);
  } else {
    await refreshPlayer(player.uuid);
  }
}

async function deletePlayer(player) {
  const inputId = uid('bestaetigung');
  const input = h('input', { class: 'input', id: inputId, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: player.name });
  const ok = await openDialog({
    title: `Alle Daten von ${player.name} löschen?`,
    body: [
      h('p', { text: 'Wie „Alle Daten löschen“ im Konto des Spielers: Profil, Einstellungen, Freundschaften, Anfragen, Nachrichten, Blockierte, eigene Meldungen und alle Anmeldungen. Eine Sperre bleibt bestehen. Das lässt sich nicht rückgängig machen.' }),
      h('div', { class: 'field' }, h('label', { for: inputId }, 'Zur Bestätigung den Spielernamen ', h('strong', { text: player.name }), ' eingeben:'), input),
    ],
    confirmLabel: 'Endgültig löschen',
    danger: true,
    canConfirm: () => input.value.trim().toLowerCase() === player.name.toLowerCase(),
    onConfirm: () => teamCall('DELETE', `/v1/team/players/${player.uuid}`),
  });
  if (!ok) return;
  toast(`Die Daten von ${player.name} sind gelöscht.`, 'success');
  state.selectedPlayer = null;
  $('#spieler-detail').replaceChildren(emptyState(`Die Daten von ${player.name} sind gelöscht.`, 'check'));
  search().catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------
// Sperren
// ---------------------------------------------------------------------------------------------------------

async function loadBans() {
  const box = $('#sperren');
  if (!box.firstChild) box.replaceChildren(loadingState());
  renderBans(await teamCall('GET', '/v1/team/bans'));
}

function renderBans(data) {
  const bans = Array.isArray(data?.bans) ? data.bans : [];
  $('#sperren-anzahl').textContent = bans.length ? `(${bans.length})` : '';
  rerender($('#sperren'), JSON.stringify(bans), () => {
    if (!bans.length) return emptyState('Niemand ist gesperrt.', 'check');
    return h(
      'ul',
      { class: 'rows' },
      bans.map((ban) =>
        h(
          'li',
          { class: 'row' },
          avatar(ban.name, ban.uuid, { size: 'sm' }),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title' }, playerButton(ban)),
            h('div', { class: 'row-sub', text: ban.reason || 'Ohne Grund' }),
            h('div', { class: 'row-meta', text: `seit ${formatDateTime(ban.at)} · ${ban.by ? `von ${ban.by}` : 'über die Kommandozeile'}` }),
          ),
          h(
            'div',
            { class: 'row-actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'button tiny ghost',
                dataset: { focusKey: `${ban.uuid}:unban` },
                onClick: async () => {
                  if (await unbanDialog(ban)) await loadBans().catch(showError);
                },
              },
              'Sperre aufheben',
            ),
          ),
        ),
      ),
    );
  });
}

async function onBanSubmit(event) {
  event.preventDefault();
  const nameInput = $('#sperre-name');
  const reasonInput = $('#sperre-grund');
  const error = $('#sperre-fehler');
  const name = nameInput.value.trim();
  const reason = reasonInput.value.trim();
  error.hidden = true;
  let problem = null;
  if (!isPlayerName(name)) problem = [nameInput, 'Ein Spielername hat 1 bis 16 Zeichen: Buchstaben, Ziffern und _.'];
  else if (!reason) problem = [reasonInput, 'Bitte einen Grund angeben (höchstens 300 Zeichen).'];
  if (problem) {
    error.textContent = problem[1];
    error.hidden = false;
    problem[0].focus();
    return;
  }
  const ok = await confirmAction({
    title: `${name} sperren?`,
    text: [`${name} kann den Heldix-Dienst danach nicht mehr nutzen; offene Verbindungen werden sofort getrennt.`, `Grund: ${reason}`],
    confirmLabel: 'Sperren',
    danger: true,
    onConfirm: async () => renderBans(await teamCall('POST', '/v1/team/bans', { name, reason })),
  });
  if (!ok) return;
  nameInput.value = '';
  reasonInput.value = '';
  reasonInput.dispatchEvent(new Event('input'));
  toast(`${name} ist gesperrt.`, 'success');
}

// ---------------------------------------------------------------------------------------------------------
// Neuigkeiten
// ---------------------------------------------------------------------------------------------------------

async function loadNews() {
  const box = $('#news-liste');
  if (!box.firstChild) box.replaceChildren(loadingState());
  const data = await teamCall('GET', '/v1/team/news');
  state.news = Array.isArray(data?.news) ? data.news : [];
  renderNews();
}

function renderNews() {
  const list = [...state.news].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  rerender($('#news-liste'), JSON.stringify(list), () => {
    if (!list.length) return emptyState('Noch keine Neuigkeiten. Die erste schreibst du mit „Neue Neuigkeit“.', 'news');
    return list.map((news) => {
      const excerpt = news.text.length > 280 ? `${news.text.slice(0, 280).trimEnd()} …` : news.text;
      const changed = news.updatedAt && news.at && news.updatedAt - news.at > 60_000;
      return h(
        'article',
        { class: 'app-card news-item' },
        h('div', { class: 'news-item-head' }, h('h2', { text: news.title }), news.published ? chip('Veröffentlicht', 'success') : chip('Entwurf', 'warning')),
        h('p', { class: 'row-meta', text: `von ${news.author ?? 'Unbekannt'} · ${formatDate(news.at)}${changed ? ` · geändert ${relativeTime(news.updatedAt)}` : ''}` }),
        h('div', { class: 'news-excerpt' }, textBlocks(excerpt)),
        h(
          'div',
          { class: 'card-actions' },
          h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `${news.id}:edit` }, onClick: () => openEditor(news) }, icon('edit'), 'Bearbeiten'),
          h(
            'button',
            { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `${news.id}:publish` }, onClick: (event) => togglePublished(event.currentTarget, news) },
            icon(news.published ? 'eye-off' : 'eye'),
            news.published ? 'Zurückziehen' : 'Veröffentlichen',
          ),
          h('button', { type: 'button', class: 'button tiny ghost quiet-danger', dataset: { focusKey: `${news.id}:delete` }, onClick: () => deleteNews(news) }, icon('trash'), 'Löschen'),
        ),
      );
    });
  });
}

function editorValues() {
  return { title: $('#news-titel').value, text: $('#news-text').value, published: $('#news-veroeffentlicht').checked };
}

function editorDirty() {
  if (!state.editing) return false;
  const now = editorValues();
  const before = state.editing.initial;
  return now.title !== before.title || now.text !== before.text || now.published !== before.published;
}

async function openEditor(news) {
  if (state.editing && editorDirty()) {
    const discard = await confirmAction({ title: 'Änderungen verwerfen?', text: 'Die Neuigkeit, die du gerade bearbeitest, ist noch nicht gespeichert.', confirmLabel: 'Verwerfen', danger: true });
    if (!discard) return;
  }
  const initial = { title: news?.title ?? '', text: news?.text ?? '', published: Boolean(news?.published) };
  state.editing = { id: news?.id ?? null, initial, at: news?.at ?? null, author: news?.author ?? state.me.name };
  $('#news-editor-titel').textContent = news ? 'Neuigkeit bearbeiten' : 'Neue Neuigkeit';
  $('#news-titel').value = initial.title;
  $('#news-text').value = initial.text;
  $('#news-veroeffentlicht').checked = initial.published;
  $('#news-fehler').hidden = true;
  $('#news-titel').dispatchEvent(new Event('input'));
  $('#news-text').dispatchEvent(new Event('input'));
  $('#news-editor').hidden = false;
  $('#news-neu').hidden = true;
  updatePreview();
  $('#news-editor').scrollIntoView({ block: 'start', behavior: 'smooth' });
  $('#news-titel').focus({ preventScroll: true });
}

function closeEditor() {
  state.editing = null;
  $('#news-editor').hidden = true;
  $('#news-neu').hidden = false;
  $('#news-neu').focus();
}

async function cancelEditor() {
  if (editorDirty()) {
    const discard = await confirmAction({ title: 'Änderungen verwerfen?', text: 'Was du geschrieben hast, geht verloren.', confirmLabel: 'Verwerfen', danger: true });
    if (!discard) return;
  }
  closeEditor();
}

/** Vorschau genau so, wie die Startseite die Neuigkeit zeigt: nur Text, Leerzeilen trennen Absätze. */
function updatePreview() {
  const { title, text, published } = editorValues();
  const at = state.editing?.at ?? Date.now();
  const author = `${state.editing?.author ?? state.me.name}${published ? '' : ' · Entwurf, noch nicht sichtbar'}`;
  // Dieselbe Karte wie auf der Startseite und unter /neuigkeiten.
  $('#news-vorschau').replaceChildren(newsCard({ id: 'vorschau', title: title.trim() || 'Titel', text: text.trim() ? text : 'Hier erscheint der Text.', at }, { author }));
}

async function onNewsSubmit(event) {
  event.preventDefault();
  const error = $('#news-fehler');
  error.hidden = true;
  const values = editorValues();
  const title = values.title.trim();
  const text = values.text.replace(/\r\n?/g, '\n').replace(/^\s*\n|\s+$/g, '');
  let problem = null;
  if (!title) problem = [$('#news-titel'), 'Bitte einen Titel eingeben.'];
  else if ([...title].length > MAX_TITLE) problem = [$('#news-titel'), `Der Titel ist zu lang (höchstens ${MAX_TITLE} Zeichen).`];
  else if (!text.trim()) problem = [$('#news-text'), 'Bitte einen Text eingeben.'];
  else if ([...text].length > MAX_TEXT) problem = [$('#news-text'), `Der Text ist zu lang (höchstens ${MAX_TEXT} Zeichen).`];
  if (problem) {
    error.textContent = problem[1];
    error.hidden = false;
    problem[0].focus();
    return;
  }
  const body = { title, text, published: values.published };
  const id = state.editing?.id;
  try {
    await busy($('#news-speichern'), () => (id ? teamCall('PUT', `/v1/team/news/${id}`, body) : teamCall('POST', '/v1/team/news', body)));
    state.editing = null;
    closeEditor();
    toast(values.published ? 'Gespeichert und veröffentlicht.' : 'Als Entwurf gespeichert.', 'success');
    await loadNews();
  } catch (problemError) {
    if (problemError.handled) return;
    error.textContent = problemError.message;
    error.hidden = false;
  }
}

async function togglePublished(button, news) {
  try {
    await busy(button, () => teamCall('PUT', `/v1/team/news/${news.id}`, { published: !news.published }));
    toast(news.published ? `„${news.title}“ ist zurückgezogen und nur noch hier sichtbar.` : `„${news.title}“ ist veröffentlicht.`, 'success');
    await loadNews();
  } catch (error) {
    showError(error);
  }
}

async function deleteNews(news) {
  const ok = await confirmAction({
    title: 'Neuigkeit löschen?',
    text: `„${news.title}“ verschwindet sofort von der Startseite und aus dem Launcher.`,
    confirmLabel: 'Löschen',
    danger: true,
    onConfirm: () => teamCall('DELETE', `/v1/team/news/${news.id}`),
  });
  if (!ok) return;
  if (state.editing?.id === news.id) closeEditor();
  toast('Neuigkeit gelöscht.', 'success');
  await loadNews().catch(showError);
}

// ---------------------------------------------------------------------------------------------------------
// Updates (nur Admins)
// ---------------------------------------------------------------------------------------------------------

/** Manifest aus der Antwort lesen: als Objekt oder als update.json-Inhalt mit Manifest-Text. */
function manifestFields(current) {
  if (!current || typeof current !== 'object') return null;
  if (typeof current.manifest === 'string') {
    try {
      return JSON.parse(current.manifest);
    } catch {
      return null;
    }
  }
  return current;
}

/** Versionen wie 1.2.3 oder 1.2.3-beta.2 vergleichen (SemVer-Reihenfolge). */
function compareVersions(a, b) {
  const parse = (version) => {
    const [core, pre] = String(version).split('-', 2);
    return { core: core.split('.').map((part) => Number.parseInt(part, 10) || 0), pre: pre ? pre.split('.') : null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let index = 0; index < 3; index++) {
    const diff = (x.core[index] ?? 0) - (y.core[index] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (!x.pre && !y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  for (let index = 0; index < Math.max(x.pre.length, y.pre.length); index++) {
    const p = x.pre[index];
    const q = y.pre[index];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Math.sign(Number(p) - Number(q));
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function manifestDate(value) {
  if (typeof value !== 'string') return '–';
  const time = Date.parse(value);
  return Number.isFinite(time) ? formatDate(time) : value;
}

async function loadUpdates() {
  const box = $('#update-aktuell');
  if (!box.firstChild) box.replaceChildren(loadingState());
  const data = await teamCall('GET', '/v1/team/updates');
  state.updates = { current: data?.current ?? null, files: Array.isArray(data?.files) ? data.files : [] };
  renderUpdates();
}

function renderUpdates() {
  const current = manifestFields(state.updates?.current);
  rerender($('#update-aktuell'), JSON.stringify(current), () => {
    if (!current) return emptyState('Noch keine Version veröffentlicht.', 'download');
    const notes = Array.isArray(current.notes) ? current.notes.filter((note) => typeof note === 'string' && note.trim()) : [];
    return [
      h('p', { class: 'version-big' }, h('span', { class: 'muted', text: 'Version ' }), h('strong', { text: current.version ?? '?' })),
      h(
        'dl',
        { class: 'facts-list' },
        h('dt', { text: 'Installer' }),
        h('dd', null, h('code', { class: 'mono', text: current.file ?? '–' })),
        h('dt', { text: 'Größe' }),
        h('dd', { text: formatBytes(current.size) }),
        h('dt', { text: 'Datum' }),
        h('dd', { text: manifestDate(current.date) }),
        current.sha512 ? [h('dt', { text: 'SHA-512' }), h('dd', null, h('code', { class: 'mono hash', title: current.sha512, text: `${current.sha512.slice(0, 24)}…` }))] : null,
        notes.length ? [h('dt', { text: 'Hinweise' }), h('dd', null, h('ul', { class: 'plain-list' }, notes.map((note) => h('li', { text: note }))))] : null,
      ),
    ];
  });
  const files = [...(state.updates?.files ?? [])].sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
  rerender($('#update-dateien'), JSON.stringify([files, current?.file]), () => {
    if (!files.length) return emptyState('Noch keine Dateien hochgeladen.', 'file');
    return h(
      'ul',
      { class: 'rows' },
      files.map((file) => {
        const isCurrent = current?.file === file.file;
        return h(
          'li',
          { class: 'row' },
          h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('file')),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title' }, h('code', { class: 'mono', text: file.file }), isCurrent ? chip('veröffentlicht', 'success') : null),
            h('div', { class: 'row-sub', text: `${formatBytes(file.size)} · hochgeladen ${formatDateTime(file.uploadedAt)}` }),
          ),
          h(
            'div',
            { class: 'row-actions' },
            h(
              'button',
              {
                type: 'button',
                class: 'button tiny ghost quiet-danger',
                disabled: isCurrent || undefined,
                title: isCurrent ? 'Die veröffentlichte Datei kann nicht gelöscht werden.' : undefined,
                'aria-label': `${file.file} löschen`,
                dataset: { focusKey: `${file.file}:delete` },
                onClick: () => deleteUpdateFile(file),
              },
              icon('trash'),
              h('span', { class: 'label', text: 'Löschen' }),
            ),
          ),
        );
      }),
    );
  });
  if (state.manifest) renderManifestCheck();
}

async function deleteUpdateFile(file) {
  const ok = await confirmAction({
    title: `${file.file} löschen?`,
    text: 'Die Datei verschwindet vom Server. Launcher, die gerade diese Version laden, brechen ab.',
    confirmLabel: 'Löschen',
    danger: true,
    onConfirm: async () => {
      const data = await teamCall('DELETE', `/v1/team/updates/files/${encodeURIComponent(file.file)}`);
      state.updates = { current: data?.current ?? null, files: Array.isArray(data?.files) ? data.files : [] };
    },
  });
  if (!ok) return;
  renderUpdates();
  toast(`${file.file} ist gelöscht.`, 'success');
}

function setUploadMessage(kind, text) {
  const error = $('#upload-exe-fehler');
  const okBox = $('#upload-exe-ok');
  error.hidden = kind !== 'error';
  okBox.hidden = kind !== 'ok';
  if (kind === 'error') error.textContent = text;
  if (kind === 'ok') okBox.replaceChildren(icon('check'), h('span', { text }));
}

async function onExeChosen(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  $('#upload-exe-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
  setUploadMessage(null);
  if (!SETUP_FILE_RE.test(file.name)) {
    setUploadMessage('error', 'Der Installer muss so heißen wie beim Bauen: HeldixClient-Setup-<version>.exe (z. B. HeldixClient-Setup-1.4.0.exe).');
    return;
  }
  if (file.size === 0 || file.size > MAX_UPLOAD) {
    setUploadMessage('error', file.size ? 'Die Datei ist größer als 1 GB.' : 'Die Datei ist leer.');
    return;
  }
  const exists = state.updates?.files?.some((entry) => entry.file === file.name);
  if (exists) {
    const replace = await confirmAction({ title: `${file.name} ersetzen?`, text: 'Eine Datei mit diesem Namen liegt schon auf dem Server.', confirmLabel: 'Ersetzen' });
    if (!replace) return;
  }
  const bar = $('#upload-balken');
  const fill = bar.firstElementChild;
  const label = $('#upload-text');
  $('#upload-fortschritt').hidden = false;
  $('#upload-abbrechen').hidden = false;
  fill.style.width = '0%';
  bar.setAttribute('aria-valuenow', '0');
  label.textContent = `0 % · 0 von ${formatBytes(file.size)}`;
  const chooser = input.closest('label');
  chooser.classList.add('disabled');
  input.disabled = true;
  const started = Date.now();
  const job = upload(`/v1/team/updates/files/${encodeURIComponent(file.name)}`, file, (loaded, total) => {
    const percent = Math.min(100, Math.floor((loaded / total) * 100));
    fill.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
    const seconds = (Date.now() - started) / 1000;
    const speed = seconds > 0.5 ? ` · ${formatBytes(loaded / seconds)}/s` : '';
    label.textContent = `${percent} % · ${formatBytes(loaded)} von ${formatBytes(total)}${speed}`;
  });
  state.uploading = job;
  try {
    const result = await job.promise;
    state.uploaded = result && result.file ? result : { file: file.name, size: file.size, sha512: null };
    label.textContent = `100 % · ${formatBytes(file.size)}`;
    fill.style.width = '100%';
    setUploadMessage('ok', `${state.uploaded.file} ist hochgeladen (${formatBytes(state.uploaded.size)}). Jetzt update.json wählen.`);
    toast(`${state.uploaded.file} ist hochgeladen.`, 'success');
    await loadUpdates().catch(showError);
  } catch (error) {
    handleAccessError(error);
    if (!error.handled) setUploadMessage('error', error.message);
  } finally {
    state.uploading = null;
    $('#upload-abbrechen').hidden = true;
    chooser.classList.remove('disabled');
    input.disabled = false;
    setTimeout(() => {
      if (!state.uploading) $('#upload-fortschritt').hidden = true;
    }, 1500);
  }
}

async function onManifestChosen(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  input.value = '';
  const error = $('#upload-json-fehler');
  error.hidden = true;
  state.manifest = null;
  $('#manifest-pruefung').hidden = true;
  $('#manifest-aktionen').hidden = true;
  if (!file) return;
  $('#upload-json-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
  const fail = (text) => {
    error.textContent = text;
    error.hidden = false;
  };
  if (file.size > 64 * 1024) return fail('Diese Datei ist zu groß für eine update.json.');
  let outer;
  let inner;
  try {
    outer = JSON.parse((await file.text()).replace(/^﻿/, ''));
  } catch {
    return fail('Die Datei ist kein gültiges JSON. Bitte die update.json aus launcher/release/update wählen.');
  }
  if (!outer || typeof outer !== 'object' || typeof outer.manifest !== 'string' || typeof outer.signature !== 'string' || !outer.signature) {
    return fail('Das ist keine update.json: Es fehlen „manifest“ oder „signature“. Sie entsteht mit npm run release.');
  }
  try {
    inner = JSON.parse(outer.manifest);
  } catch {
    return fail('„manifest“ in der update.json ist kein gültiges JSON.');
  }
  if (!inner || inner.v !== 1 || typeof inner.version !== 'string' || typeof inner.file !== 'string' || typeof inner.size !== 'number') {
    return fail('Das Manifest ist unvollständig (v, version, file oder size fehlen).');
  }
  state.manifest = { outer: { manifest: outer.manifest, signature: outer.signature }, inner };
  renderManifestCheck();
}

function renderManifestCheck() {
  const { inner } = state.manifest;
  const current = manifestFields(state.updates?.current);
  const onServer = state.updates?.files?.find((entry) => entry.file === inner.file);
  const checks = [];
  checks.push([onServer ? 'ok' : 'fail', onServer ? `Installer ${inner.file} liegt auf dem Server` : `Installer ${inner.file} fehlt noch – zuerst hochladen (Schritt 1)`]);
  if (onServer) checks.push([onServer.size === inner.size ? 'ok' : 'fail', onServer.size === inner.size ? `Größe passt (${formatBytes(inner.size)})` : `Größe passt nicht: Manifest ${formatBytes(inner.size)}, Server ${formatBytes(onServer.size)}`]);
  if (state.uploaded?.file === inner.file && state.uploaded.sha512 && typeof inner.sha512 === 'string') {
    const same = state.uploaded.sha512 === inner.sha512;
    checks.push([same ? 'ok' : 'fail', same ? 'SHA-512 passt zum hochgeladenen Installer' : 'SHA-512 passt nicht zum hochgeladenen Installer – falsche Datei?']);
  } else {
    checks.push(['info', 'SHA-512 und Signatur prüft der Dienst beim Veröffentlichen']);
  }
  if (current?.version) {
    const newer = compareVersions(inner.version, current.version) > 0;
    checks.push([newer ? 'ok' : 'fail', newer ? `Version ${inner.version} ist neuer als ${current.version}` : `Version ${inner.version} ist nicht neuer als die veröffentlichte ${current.version}`]);
  } else {
    checks.push(['ok', 'Erste veröffentlichte Version']);
  }
  const notes = Array.isArray(inner.notes) ? inner.notes.filter((note) => typeof note === 'string' && note.trim()) : [];
  $('#manifest-pruefung').replaceChildren(
    h(
      'dl',
      { class: 'facts-list' },
      h('dt', { text: 'Version' }),
      h('dd', null, h('strong', { text: inner.version })),
      h('dt', { text: 'Installer' }),
      h('dd', null, h('code', { class: 'mono', text: inner.file })),
      h('dt', { text: 'Größe' }),
      h('dd', { text: formatBytes(inner.size) }),
      h('dt', { text: 'Datum' }),
      h('dd', { text: manifestDate(inner.date) }),
      notes.length ? [h('dt', { text: 'Hinweise' }), h('dd', null, h('ul', { class: 'plain-list' }, notes.map((note) => h('li', { text: note }))))] : null,
    ),
    h(
      'ul',
      { class: 'check-list' },
      checks.map(([kind, text]) => h('li', { class: kind }, icon(kind === 'ok' ? 'check' : kind === 'fail' ? 'close' : 'info'), h('span', { text }))),
    ),
  );
  $('#manifest-pruefung').hidden = false;
  const blocked = checks.some(([kind]) => kind === 'fail');
  $('#manifest-aktionen').hidden = false;
  $('#manifest-veroeffentlichen').disabled = blocked;
  $('#manifest-veroeffentlichen').title = blocked ? 'Erst die rot markierten Punkte klären.' : '';
}

async function publishManifest(event) {
  if (!state.manifest) return;
  const { inner, outer } = state.manifest;
  const ok = await confirmAction({
    title: `Version ${inner.version} veröffentlichen?`,
    text: 'Alle Launcher mit automatischen Updates laden diese Version beim nächsten Start oder spätestens nach sechs Stunden.',
    confirmLabel: 'Veröffentlichen',
    onConfirm: async () => {
      const data = await teamCall('PUT', '/v1/team/updates/manifest', outer);
      state.updates = { ...(state.updates ?? { files: [] }), current: data?.current ?? null };
    },
  });
  if (!ok) {
    event.currentTarget?.focus?.();
    return;
  }
  state.manifest = null;
  $('#manifest-pruefung').hidden = true;
  $('#manifest-aktionen').hidden = true;
  $('#upload-json-name').textContent = 'Keine Datei gewählt';
  toast(`Version ${inner.version} ist veröffentlicht.`, 'success');
  await loadUpdates().catch(showError);
}

// ---------------------------------------------------------------------------------------------------------
// Team (nur Admins)
// ---------------------------------------------------------------------------------------------------------

async function loadMembers() {
  const box = $('#mitglieder');
  if (!box.firstChild) box.replaceChildren(loadingState());
  renderMembers(await teamCall('GET', '/v1/team/members'));
}

function renderMembers(data) {
  const members = Array.isArray(data?.members) ? [...data.members] : [];
  members.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }) : a.role === 'admin' ? -1 : 1));
  $('#mitglieder-anzahl').textContent = members.length ? `(${members.length})` : '';
  rerender($('#mitglieder'), JSON.stringify(members), () => {
    if (!members.length) return emptyState('Noch niemand im Team.', 'friends');
    return h(
      'ul',
      { class: 'rows' },
      members.map((member) => {
        const self = member.uuid === state.me.uuid;
        const selectId = uid('rolle');
        const select = h(
          'select',
          { class: 'input select tiny-select', id: selectId, dataset: { focusKey: `${member.uuid}:role` } },
          Object.entries(ROLE_LABELS).map(([value, label]) => h('option', { value, text: label })),
        );
        select.value = member.role;
        select.addEventListener('change', () => changeRole(member, select));
        return h(
          'li',
          { class: 'row member-row' },
          avatar(member.name, member.uuid),
          h(
            'div',
            { class: 'row-main' },
            h(
              'div',
              { class: 'row-title' },
              h('span', { text: member.name }),
              self ? chip('du') : null,
              member.twoFactor ? h('span', { class: 'chip success' }, icon('lock'), '2FA aktiv') : chip('2FA fehlt', 'warning'),
            ),
            h('div', { class: 'row-meta', text: `im Team seit ${formatDate(member.addedAt)} · ${member.addedBy ? `hinzugefügt von ${member.addedBy}` : 'über die Kommandozeile'}` }),
          ),
          h(
            'div',
            { class: 'row-actions' },
            h('label', { class: 'visually-hidden', for: selectId, text: `Rolle von ${member.name}` }),
            select,
            h(
              'button',
              {
                type: 'button',
                class: 'button tiny ghost',
                disabled: !member.twoFactor || undefined,
                title: member.twoFactor ? undefined : 'Noch nicht eingerichtet',
                dataset: { focusKey: `${member.uuid}:2fa` },
                onClick: () => resetTwoFactor(member),
              },
              '2FA zurücksetzen',
            ),
            h('button', { type: 'button', class: 'button tiny ghost quiet-danger', 'aria-label': `${member.name} aus dem Team entfernen`, dataset: { focusKey: `${member.uuid}:remove` }, onClick: () => removeMember(member) }, icon('trash'), h('span', { class: 'label', text: 'Entfernen' })),
          ),
        );
      }),
    );
  });
}

async function afterSelfChange(member) {
  if (member.uuid === state.me.uuid) await reloadMe();
}

async function changeRole(member, select) {
  const role = select.value;
  const label = ROLE_LABELS[role] ?? role;
  const self = member.uuid === state.me.uuid;
  const ok = await confirmAction({
    title: `${member.name} zum ${label} machen?`,
    text: [
      role === 'admin' ? 'Admins können zusätzlich Updates veröffentlichen, das Team verwalten, das Protokoll lesen, Capes zurücksetzen und Spielerdaten löschen.' : 'Moderatoren sehen Meldungen, Spieler und Sperren und schreiben Neuigkeiten.',
      self ? 'Das betrifft dich selbst: Danach siehst du nur noch die Bereiche für Moderatoren.' : null,
    ],
    confirmLabel: 'Rolle ändern',
    danger: self && role !== 'admin',
    onConfirm: async () => renderMembers(await teamCall('PUT', `/v1/team/members/${member.uuid}`, { role })),
  });
  if (!ok) {
    select.value = member.role;
    return;
  }
  toast(`${member.name} ist jetzt ${label}.`, 'success');
  await afterSelfChange(member);
}

async function resetTwoFactor(member) {
  const ok = await confirmAction({
    title: `2FA von ${member.name} zurücksetzen?`,
    text: `${member.name} muss die Zwei-Faktor-Anmeldung danach neu einrichten, bevor der Team-Bereich wieder geht. Gedacht für ein verlorenes Handy.`,
    confirmLabel: 'Zurücksetzen',
    danger: true,
    onConfirm: async () => renderMembers(await teamCall('POST', `/v1/team/members/${member.uuid}/reset-2fa`)),
  });
  if (!ok) return;
  toast(`Die 2FA von ${member.name} ist zurückgesetzt.`, 'success');
  await afterSelfChange(member);
}

async function removeMember(member) {
  const self = member.uuid === state.me.uuid;
  const ok = await confirmAction({
    title: `${member.name} aus dem Team entfernen?`,
    text: [`${member.name} verliert sofort den Zugang zum Team-Bereich. Das Konto beim Heldix-Dienst bleibt.`, self ? 'Das bist du selbst – danach hast du hier keinen Zugang mehr.' : null],
    confirmLabel: 'Entfernen',
    danger: true,
    onConfirm: async () => renderMembers(await teamCall('DELETE', `/v1/team/members/${member.uuid}`)),
  });
  if (!ok) return;
  toast(`${member.name} ist nicht mehr im Team.`, 'success');
  await afterSelfChange(member);
}

async function onMemberSubmit(event) {
  event.preventDefault();
  const input = $('#mitglied-name');
  const role = $('#mitglied-rolle').value;
  const error = $('#mitglied-fehler');
  const name = input.value.trim();
  error.hidden = true;
  if (!isPlayerName(name)) {
    error.textContent = 'Ein Spielername hat 1 bis 16 Zeichen: Buchstaben, Ziffern und _.';
    error.hidden = false;
    input.focus();
    return;
  }
  const label = ROLE_LABELS[role] ?? role;
  const ok = await confirmAction({
    title: `${name} als ${label} hinzufügen?`,
    text: role === 'admin' ? 'Admins haben alle Rechte, auch für Updates und das Team.' : 'Moderatoren sehen Meldungen mit Chatverlauf, Spieler und Sperren.',
    confirmLabel: 'Hinzufügen',
    onConfirm: async () => renderMembers(await teamCall('POST', '/v1/team/members', { name, role })),
  });
  if (!ok) return;
  input.value = '';
  toast(`${name} ist jetzt im Team (${label}).`, 'success');
}

// ---------------------------------------------------------------------------------------------------------
// Support (Moderatoren und Admins)
// ---------------------------------------------------------------------------------------------------------

const SUPPORT_CATEGORIES = { hilfe: 'Hilfe', fehler: 'Fehler', konto: 'Konto', sonstiges: 'Sonstiges' };
const SUPPORT_STATUS = {
  open: ['Wartet auf Antwort', 'warning'],
  answered: ['Beantwortet', 'success'],
  closed: ['Geschlossen', ''],
};
const MAX_TICKET_TEXT = 2000;

function supportChip(status) {
  const [label, kind] = SUPPORT_STATUS[status] ?? [status, ''];
  return chip(label, kind);
}

function setSupportCount(count) {
  const badge = $('#count-support');
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', count === 1 ? '1 wartet auf Antwort' : `${count} warten auf Antwort`);
}

/** Zähler am Reiter: Anfragen, deren letzte Nachricht vom Spieler ist. */
async function refreshSupportCount() {
  const data = await teamCall('GET', '/v1/team/support?status=open');
  setSupportCount((Array.isArray(data?.tickets) ? data.tickets : []).filter((ticket) => ticket.unread).length);
}

function setSupportFilter(status) {
  state.supportFilter = status;
  for (const button of $$('#support-filter button')) button.setAttribute('aria-pressed', String(button.dataset.status === status));
}

async function loadSupport() {
  const box = $('#team-support-liste');
  const filter = state.supportFilter;
  if (!box.firstChild || box.dataset.filter !== filter) {
    box.dataset.signature = '';
    box.replaceChildren(loadingState());
  }
  box.dataset.filter = filter;
  const data = await teamCall('GET', `/v1/team/support?status=${filter}`);
  if (filter !== state.supportFilter) return;
  state.supportTickets = Array.isArray(data?.tickets) ? data.tickets : [];
  if (filter === 'open' || filter === 'all') setSupportCount(state.supportTickets.filter((ticket) => ticket.unread && ticket.status !== 'closed').length);
  renderSupportList();
}

function renderSupportList() {
  const tickets = state.supportTickets;
  const filter = state.supportFilter;
  const current = state.ticket?.id ?? null;
  rerender($('#team-support-liste'), JSON.stringify([tickets, current]), () => {
    if (!tickets.length) {
      const text = filter === 'open' ? 'Keine offenen Anfragen. Alles beantwortet!' : filter === 'answered' ? 'Keine beantworteten Anfragen, die noch offen sind.' : filter === 'closed' ? 'Keine geschlossenen Anfragen.' : 'Noch keine Anfragen.';
      return emptyState(text, 'check');
    }
    return h(
      'ul',
      { class: 'rows' },
      tickets.map((ticket) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              type: 'button',
              class: `row row-button ticket-row${ticket.unread && ticket.status !== 'closed' ? ' waiting' : ''}`,
              'aria-current': ticket.id === current ? 'true' : undefined,
              dataset: { focusKey: `ticket:${ticket.id}` },
              onClick: () => openTeamTicket(ticket.id),
            },
            h(
              'span',
              { class: 'row-main' },
              h('span', { class: 'row-title' }, h('span', { class: 'ticket-subject', text: ticket.subject })),
              h(
                'span',
                { class: 'chips-row' },
                ticket.unread && ticket.status !== 'closed' ? chip('wartet', 'warning') : supportChip(ticket.status),
                chip(SUPPORT_CATEGORIES[ticket.category] ?? ticket.category),
              ),
              h('span', { class: 'row-meta', text: `#${ticket.id} · ${ticket.player?.name ?? '?'} · zuletzt ${relativeTime(ticket.updatedAt ?? ticket.at)}` }),
            ),
            icon('chevron-right'),
          ),
        ),
      ),
    );
  });
}

/** Wer steht beim Spieler als Absender? Hängt am eigenen Teamprofil. */
function authorNote(playerName) {
  const who = playerName || 'Der Spieler';
  if (!state.profile) return `${who} sieht als Absender „HeldixClient-Team“ – deinen Namen nur, wenn dein Teamprofil öffentlich ist.`;
  if (state.profile.public) return `Dein Teamprofil ist öffentlich: ${who} sieht deinen Namen „${state.me.name}“ als Absender.`;
  return `${who} sieht als Absender „HeldixClient-Team“. Deinen Namen nur, wenn du dein Teamprofil öffentlich machst (Reiter „Mein Teamprofil“).`;
}

async function openTeamTicket(id) {
  if (tabs.current() !== 'support') tabs.select('support');
  state.ticket = { id, loading: true };
  renderSupportList();
  const detail = $('#team-ticket');
  detail.replaceChildren(loadingState('Anfrage wird geladen …'));
  if (!window.matchMedia('(min-width: 901px)').matches) detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
  try {
    const data = await teamCall('GET', `/v1/team/support/${encodeURIComponent(id)}`);
    if (state.ticket?.id !== id) return;
    buildTicketView(data.ticket);
    $('#team-ticket-titel')?.focus({ preventScroll: true });
  } catch (error) {
    if (error.handled || state.ticket?.id !== id) return;
    detail.replaceChildren(emptyState(error.message, 'warning'));
  }
}

function buildTicketView(ticket) {
  const detail = $('#team-ticket');
  const textId = uid('antwort');
  const counter = h('span', { class: 'counter' });
  const textarea = h('textarea', { class: 'input textarea small-textarea', id: textId, maxlength: String(MAX_TICKET_TEXT), rows: '5', placeholder: `Antwort an ${ticket.player?.name ?? 'den Spieler'} …` });
  bindCounter(textarea, counter, MAX_TICKET_TEXT);
  const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const send = h('button', { type: 'submit', class: 'button small' }, icon('send'), 'Antworten');
  const close = h('button', { type: 'button', class: 'button small ghost', onClick: () => closeTeamTicket() }, icon('check'), 'Anfrage schließen');
  const form = h(
    'form',
    { class: 'ticket-reply', id: 'team-ticket-antwort', novalidate: true },
    h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { for: textId, text: 'Antwort' }), counter), textarea),
    h('p', { class: 'info-box small author-note' }, icon('eye'), h('span', { id: 'team-ticket-absender', text: authorNote(ticket.player?.name) })),
    error,
    h('div', { class: 'card-actions' }, send, close),
  );
  form.addEventListener('submit', (event) => replyTeamTicket(event, textarea, error, [send, close]));
  textarea.addEventListener('input', () => {
    error.hidden = true;
  });
  detail.replaceChildren(
    h('div', { class: 'ticket-title' }, h('h2', { id: 'team-ticket-titel', tabindex: '-1', text: ticket.subject }), h('p', { class: 'row-meta', id: 'team-ticket-meta' })),
    h('p', { class: 'ticket-player' }, avatar(ticket.player?.name, ticket.player?.uuid, { size: 'sm' }), h('span', null, 'Von ', playerButton(ticket.player)), h('span', { class: 'muted', id: 'team-ticket-seit' })),
    h('ol', { class: 'ticket-messages', id: 'team-ticket-verlauf', 'aria-labelledby': 'team-ticket-titel' }),
    form,
    h('p', { class: 'notice small-notice closed-notice', id: 'team-ticket-geschlossen', hidden: true, text: 'Diese Anfrage ist geschlossen. Antworten geht nicht mehr.' }),
  );
  updateTicketView(ticket);
}

function updateTicketView(ticket) {
  if (!ticket || !$('#team-ticket-verlauf')) return;
  state.ticket = ticket;
  $('#team-ticket-titel').textContent = ticket.subject;
  $('#team-ticket-meta').replaceChildren(
    ticket.unread && ticket.status !== 'closed' ? chip('wartet auf Antwort', 'warning') : supportChip(ticket.status),
    chip(SUPPORT_CATEGORIES[ticket.category] ?? ticket.category),
    h('span', { text: `#${ticket.id} · erstellt am ${formatDateTime(ticket.at)}` }),
  );
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  const box = $('#team-ticket-verlauf');
  rerender(box, JSON.stringify(messages), () =>
    messages.map((message) => {
      const fromPlayer = message.from === 'player';
      return h(
        'li',
        { class: `ticket-msg ${fromPlayer ? 'player' : 'team'}` },
        h(
          'p',
          { class: 'ticket-msg-head' },
          h('strong', { text: fromPlayer ? ticket.player?.name ?? 'Spieler' : message.author || 'Team' }),
          fromPlayer ? null : h('span', { class: 'chip accent tiny-chip', text: 'Team' }),
          ' · ',
          timeEl(message.at, formatDateTime(message.at)),
        ),
        h('div', { class: 'ticket-msg-text' }, textBlocks(message.text)),
      );
    }),
  );
  const closed = ticket.status === 'closed';
  $('#team-ticket-antwort').hidden = closed;
  $('#team-ticket-geschlossen').hidden = !closed;
  const note = $('#team-ticket-absender');
  if (note) note.textContent = authorNote(ticket.player?.name);
  // Liste ohne neues Laden angleichen
  const listed = state.supportTickets.find((entry) => entry.id === ticket.id);
  if (listed) {
    Object.assign(listed, { status: ticket.status, unread: ticket.unread, updatedAt: ticket.updatedAt });
    renderSupportList();
  }
}

async function replyTeamTicket(event, textarea, error, buttons) {
  event.preventDefault();
  const ticket = state.ticket;
  if (!ticket?.id) return;
  const text = textarea.value.replace(/\r\n?/g, '\n').trim();
  error.hidden = true;
  if (!text || [...text].length > MAX_TICKET_TEXT) {
    error.textContent = text ? `Die Antwort ist zu lang (höchstens ${MAX_TICKET_TEXT} Zeichen).` : 'Bitte eine Antwort schreiben.';
    error.hidden = false;
    textarea.focus();
    return;
  }
  try {
    const data = await busy(buttons, () => teamCall('POST', `/v1/team/support/${encodeURIComponent(ticket.id)}/messages`, { text }));
    textarea.value = '';
    textarea.dispatchEvent(new Event('input'));
    updateTicketView(data.ticket);
    $('#team-ticket-verlauf').lastElementChild?.scrollIntoView({ block: 'nearest' });
    toast(`Antwort gesendet. ${ticket.player?.name ?? 'Der Spieler'} sieht sie im Konto und im Spiel.`, 'success');
    loadSupport().catch(() => {});
    refreshSupportCount().catch(() => {});
  } catch (problem) {
    if (problem.handled) return;
    error.textContent = problem.message;
    error.hidden = false;
  }
}

async function closeTeamTicket() {
  const ticket = state.ticket;
  if (!ticket?.id) return;
  let updated = null;
  const ok = await confirmAction({
    title: `Anfrage #${ticket.id} schließen?`,
    text: `Danach kann niemand mehr antworten. ${ticket.player?.name ?? 'Der Spieler'} sieht die Anfrage als geschlossen und kann bei Bedarf eine neue schreiben.`,
    confirmLabel: 'Schließen',
    onConfirm: async () => {
      updated = await teamCall('POST', `/v1/team/support/${encodeURIComponent(ticket.id)}/close`);
    },
  });
  if (!ok) return;
  if (updated?.ticket) updateTicketView(updated.ticket);
  toast(`Anfrage #${ticket.id} ist geschlossen.`, 'success');
  loadSupport().catch(() => {});
  refreshSupportCount().catch(() => {});
}

/** Alle 30 Sekunden (solange sichtbar): Zähler am Reiter, im Support-Reiter auch Liste und offene Anfrage. */
async function teamTick() {
  if ($('#team-app').hidden) return;
  const tasks = [refreshSupportCount()];
  if (tabs.current() === 'support') {
    tasks.push(loadSupport());
    const id = state.ticket?.id;
    if (id && !state.ticket.loading) {
      tasks.push(
        teamCall('GET', `/v1/team/support/${encodeURIComponent(id)}`).then((data) => {
          if (state.ticket?.id === id) updateTicketView(data.ticket);
        }),
      );
    }
  }
  await Promise.all(tasks);
}

// ---------------------------------------------------------------------------------------------------------
// Mein Teamprofil (jede Rolle)
// ---------------------------------------------------------------------------------------------------------

const MAX_PROFILE_TITLE = 40;
const MAX_PROFILE_ABOUT = 200;

const oneLine = (value) => value.replace(/\s*[\r\n]+\s*/g, ' ');

function profileValues() {
  return { public: $('#profil-public').checked, title: oneLine($('#profil-titel').value).trim(), about: oneLine($('#profil-text').value).trim() };
}

function profileDirty() {
  if (!state.profile) return false;
  const now = profileValues();
  return now.public !== state.profile.public || now.title !== state.profile.title || now.about !== state.profile.about;
}

async function loadProfile() {
  const data = await teamCall('GET', '/v1/team/me/profile');
  state.profile = { public: Boolean(data?.public), title: String(data?.title ?? ''), about: String(data?.about ?? '') };
  $('#profil-public').checked = state.profile.public;
  $('#profil-titel').value = state.profile.title;
  $('#profil-text').value = state.profile.about;
  $('#profil-titel').dispatchEvent(new Event('input'));
  $('#profil-text').dispatchEvent(new Event('input'));
  $('#profil-fehler').hidden = true;
  state.previewHead = null;
  renderProfilePreview();
  const note = $('#team-ticket-absender');
  if (note) note.textContent = authorNote(state.ticket?.player?.name);
  if (state.since === undefined) loadSince().catch(() => {});
}

/** „im Team seit“ für die Vorschau: aus der öffentlichen Teamseite oder (Admins) aus der Mitgliederliste. */
async function loadSince() {
  state.since = null;
  try {
    const data = await publicGet('/v1/public/team');
    const self = (data?.members ?? []).find((member) => member.uuid === state.me.uuid);
    if (self && typeof self.since === 'number') state.since = self.since;
  } catch {
    // egal – dann eben aus der Mitgliederliste
  }
  if (state.since === null && isAdmin()) {
    const data = await teamCall('GET', '/v1/team/members').catch(() => null);
    const self = (data?.members ?? []).find((member) => member.uuid === state.me.uuid);
    if (self && typeof self.addedAt === 'number') state.since = self.addedAt;
  }
  renderProfilePreview();
}

function renderProfilePreview() {
  if (!state.profile) return;
  const values = profileValues();
  const savedPublic = state.profile.public;
  // Den Skin gibt der Dienst nur für öffentliche Profile heraus – sonst gleich Initialen, ohne Anfrage.
  if (!state.previewHead || state.previewHeadPublic !== savedPublic) {
    state.previewHead = skinHead(savedPublic ? state.me.uuid : null, state.me.name);
    state.previewHeadPublic = savedPublic;
  }
  const card = memberCard({ uuid: state.me.uuid, name: state.me.name, role: state.me.role, title: values.title, about: values.about, since: state.since ?? null }, { head: state.previewHead });
  $('#profil-vorschau').replaceChildren(card);
  const status = $('#profil-vorschau-status');
  if (values.public && savedPublic) status.textContent = 'So sieht man dich gerade auf der Teamseite.';
  else if (values.public) status.textContent = 'Noch nicht öffentlich – nach dem Speichern sieht man dich so auf der Teamseite.';
  else status.textContent = 'Nicht öffentlich – so würde deine Karte aussehen. Den Kopf deines Skins zeigt die Teamseite erst, wenn dein Profil öffentlich ist.';
  status.classList.toggle('public', values.public && savedPublic);
  $('#profil-public-text').textContent = values.public ? 'An: Dein Profil erscheint auf der Teamseite.' : 'Aus: Niemand sieht dein Teamprofil.';
  $('#profil-ungespeichert').hidden = !profileDirty();
}

async function onProfileSubmit(event) {
  event.preventDefault();
  const error = $('#profil-fehler');
  error.hidden = true;
  const values = profileValues();
  if ([...values.title].length > MAX_PROFILE_TITLE || [...values.about].length > MAX_PROFILE_ABOUT) {
    error.textContent = `Aufgabe höchstens ${MAX_PROFILE_TITLE}, Text höchstens ${MAX_PROFILE_ABOUT} Zeichen.`;
    error.hidden = false;
    return;
  }
  const publish = values.public && !state.profile.public;
  const save = async () => {
    const data = await teamCall('PUT', '/v1/team/me/profile', values);
    state.profile = { public: Boolean(data?.public), title: String(data?.title ?? ''), about: String(data?.about ?? '') };
  };
  try {
    if (publish) {
      const ok = await confirmAction({
        title: 'Teamprofil veröffentlichen?',
        text: [
          `Auf heldixclient.com/das-team erscheinen dann für alle sichtbar: dein Spielername „${state.me.name}“, deine Rolle, deine Aufgabe, dein Text und der Kopf deines Minecraft-Skins.`,
          'Bei deinen Support-Antworten sehen Spieler deinen Namen statt „HeldixClient-Team“. Du kannst das jederzeit wieder ausschalten.',
        ],
        confirmLabel: 'Veröffentlichen',
        onConfirm: save,
      });
      if (!ok) return;
    } else {
      await busy($('#profil-speichern'), save);
    }
  } catch (problem) {
    if (problem.handled) return;
    error.textContent = problem.message;
    error.hidden = false;
    return;
  }
  $('#profil-public').checked = state.profile.public;
  $('#profil-titel').value = state.profile.title;
  $('#profil-text').value = state.profile.about;
  flashSaved($('#profil-gespeichert'));
  renderProfilePreview();
  const note = $('#team-ticket-absender');
  if (note) note.textContent = authorNote(state.ticket?.player?.name);
  toast(state.profile.public ? 'Gespeichert. Dein Profil steht auf der Teamseite.' : 'Gespeichert. Dein Profil ist nicht öffentlich.', 'success');
  state.since = undefined;
  loadSince().catch(() => {});
}

// ---------------------------------------------------------------------------------------------------------
// Protokoll (nur Admins)
// ---------------------------------------------------------------------------------------------------------

const ACTIONS = {
  'report.done': 'Meldung erledigt',
  ban: 'Spieler gesperrt',
  'ban.add': 'Spieler gesperrt',
  'ban.create': 'Spieler gesperrt',
  unban: 'Sperre aufgehoben',
  'ban.remove': 'Sperre aufgehoben',
  'ban.delete': 'Sperre aufgehoben',
  'player.reset-cape': 'Cape zurückgesetzt',
  'player.cape-reset': 'Cape zurückgesetzt',
  'player.delete': 'Spielerdaten gelöscht',
  'news.create': 'Neuigkeit erstellt',
  'news.update': 'Neuigkeit geändert',
  'news.publish': 'Neuigkeit veröffentlicht',
  'news.unpublish': 'Neuigkeit zurückgezogen',
  'news.delete': 'Neuigkeit gelöscht',
  'update.upload': 'Installer hochgeladen',
  'update.file': 'Installer hochgeladen',
  'update.file.upload': 'Installer hochgeladen',
  'update.file.delete': 'Installer gelöscht',
  'update.delete': 'Installer gelöscht',
  'update.publish': 'Update veröffentlicht',
  'update.manifest': 'Update veröffentlicht',
  'member.add': 'Mitglied hinzugefügt',
  'team.add': 'Mitglied hinzugefügt',
  'member.role': 'Rolle geändert',
  'member.update': 'Rolle geändert',
  'team.role': 'Rolle geändert',
  'member.remove': 'Mitglied entfernt',
  'team.remove': 'Mitglied entfernt',
  'member.reset-2fa': '2FA zurückgesetzt',
  'team.reset-2fa': '2FA zurückgesetzt',
  '2fa.reset': '2FA zurückgesetzt',
  '2fa.enable': '2FA eingerichtet',
  'support.reply': 'Support beantwortet',
  'support.close': 'Support-Anfrage geschlossen',
  'team.profile': 'Teamprofil geändert',
};

function actionLabel(action) {
  const key = String(action ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[_:/\s]+/g, '.');
  return ACTIONS[key] ?? ACTIONS[key.replace(/\.(\d)/g, '-$1')] ?? null;
}

async function loadAudit() {
  const box = $('#protokoll');
  if (!box.firstChild) box.replaceChildren(loadingState());
  const limit = state.auditLimit;
  const data = await teamCall('GET', `/v1/team/audit?limit=${limit}`);
  const entries = Array.isArray(data?.entries) ? data.entries : [];
  $('#protokoll-mehr').hidden = entries.length < limit || limit >= AUDIT_MAX;
  rerender(box, JSON.stringify(entries), () => {
    if (!entries.length) return emptyState('Noch keine Einträge.', 'clock');
    return h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'table' },
        h('caption', { class: 'visually-hidden', text: 'Protokoll der Team-Aktionen' }),
        h('thead', null, h('tr', null, ['Zeit', 'Wer', 'Aktion', 'Betrifft', 'Details'].map((title) => h('th', { scope: 'col', text: title })))),
        h(
          'tbody',
          null,
          entries.map((entry) => {
            const label = actionLabel(entry.action);
            return h(
              'tr',
              null,
              h('td', { class: 'nowrap', 'data-label': 'Zeit' }, timeEl(entry.at, formatDateTime(entry.at))),
              h('td', { class: 'nowrap', 'data-label': 'Wer' }, h('strong', { text: entry.actor?.name ?? '?' })),
              h('td', { 'data-label': 'Aktion' }, label ? h('span', { title: entry.action, text: label }) : h('code', { class: 'mono', text: entry.action ?? '?' })),
              h('td', { 'data-label': 'Betrifft', text: entry.target ?? '–' }),
              h('td', { class: 'muted', 'data-label': 'Details', text: entry.detail ?? '' }),
            );
          }),
        ),
      ),
    );
  });
}

// ---------------------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------------------

async function logout() {
  try {
    await busy($('#team-abmelden'), () => api('POST', '/v1/web/logout'));
  } catch (error) {
    if (error.status !== 401) return showError(error);
  }
  showGuest('Du hast dich abgemeldet.');
}

function init() {
  tabs = setupTabs($('#team-tabs'), onTab);
  $('#team-erneut').addEventListener('click', start);
  $('#team-abmelden').addEventListener('click', logout);

  $('#setup-start').addEventListener('click', startSetup);
  $('#setup-kopieren').addEventListener('click', async () => {
    const ok = await copyText($('#setup-secret').dataset.secret ?? '');
    toast(ok ? 'Schlüssel kopiert.' : 'Kopieren ging nicht – bitte von Hand abschreiben.', ok ? 'success' : 'error');
  });
  $('#setup-form').addEventListener('submit', (event) =>
    submitCode(event, { path: '/v1/web/2fa/enable', input: $('#setup-code-input'), error: $('#setup-fehler'), success: 'Die Zwei-Faktor-Anmeldung ist eingerichtet.' }),
  );
  $('#verify-form').addEventListener('submit', (event) => submitCode(event, { path: '/v1/web/2fa/verify', input: $('#verify-code'), error: $('#verify-fehler'), success: 'Bestätigt für 12 Stunden.' }));

  $('#meldungen-filter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button || button.dataset.status === state.reportFilter) return;
    setReportFilter(button.dataset.status);
    loadReports().catch(showError);
  });
  $('#meldungen-neu').addEventListener('click', (event) => busy(event.currentTarget, () => loadReports()).catch(showError));

  $('#spieler-suche').addEventListener('submit', (event) => {
    event.preventDefault();
    clearTimeout(searchTimer);
    search().catch(showError);
  });
  $('#spieler-q').addEventListener('input', onSearchInput);

  $('#sperre-form').addEventListener('submit', onBanSubmit);
  bindCounter($('#sperre-grund'), $('#sperre-zaehler'), MAX_REASON);

  $('#news-neu').addEventListener('click', () => openEditor(null));
  $('#news-abbrechen').addEventListener('click', cancelEditor);
  $('#news-form').addEventListener('submit', onNewsSubmit);
  $('#news-form').addEventListener('input', updatePreview);
  $('#news-form').addEventListener('change', updatePreview);
  bindCounter($('#news-titel'), $('#news-titel-zaehler'), MAX_TITLE);
  bindCounter($('#news-text'), $('#news-text-zaehler'), MAX_TEXT);

  $('#upload-exe').addEventListener('change', onExeChosen);
  $('#upload-abbrechen').addEventListener('click', () => state.uploading?.abort());
  $('#upload-json').addEventListener('change', onManifestChosen);
  $('#manifest-veroeffentlichen').addEventListener('click', publishManifest);

  $('#mitglied-form').addEventListener('submit', onMemberSubmit);

  $('#support-filter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button || button.dataset.status === state.supportFilter) return;
    setSupportFilter(button.dataset.status);
    loadSupport().catch(showError);
  });
  $('#support-neu-laden').addEventListener('click', (event) => busy(event.currentTarget, () => Promise.all([loadSupport(), refreshSupportCount()])).catch(showError));

  $('#profil-form').addEventListener('submit', onProfileSubmit);
  $('#profil-form').addEventListener('input', () => {
    $('#profil-fehler').hidden = true;
    renderProfilePreview();
  });
  $('#profil-form').addEventListener('change', renderProfilePreview);
  // „Über dich“ ist eine Zeile: Enter fügt keinen Umbruch ein, eingefügte Umbrüche werden Leerzeichen.
  $('#profil-text').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  $('#profil-text').addEventListener('input', (event) => {
    if (/[\r\n]/.test(event.target.value)) event.target.value = oneLine(event.target.value);
  });
  bindCounter($('#profil-titel'), $('#profil-titel-zaehler'), MAX_PROFILE_TITLE);
  bindCounter($('#profil-text'), $('#profil-text-zaehler'), MAX_PROFILE_ABOUT);

  $('#protokoll-neu').addEventListener('click', (event) => busy(event.currentTarget, () => loadAudit()).catch(showError));
  $('#protokoll-mehr').addEventListener('click', (event) => {
    state.auditLimit = Math.min(AUDIT_MAX, state.auditLimit + AUDIT_STEP);
    busy(event.currentTarget, () => loadAudit()).catch(showError);
  });

  window.addEventListener('beforeunload', (event) => {
    if (state.uploading || editorDirty() || profileDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  window.addEventListener('hashchange', () => {
    const wanted = location.hash.slice(1);
    if (!$('#team-app').hidden && tabs.has(wanted) && tabs.current() !== wanted) tabs.select(wanted);
  });
  start();
}

init();
