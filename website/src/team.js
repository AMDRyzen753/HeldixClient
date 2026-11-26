// HeldixClient – Webseite: Team-Bereich (/team) für Moderatoren und Admins
// (Meldungen, Support, Spieler, Sperren, Neuigkeiten, Addons: Einreichungen und Addon-Meldungen (team-addons.js), Mein
// Teamprofil; Admins zusätzlich Updates, Addons freigeben und veröffentlichen, Cosmetics, Team, Protokoll).
// Startseite ist die Übersicht (team-overview.js); dazu Schnellsuche (Strg+K, team-search.js) und Aktivität mit Glocke
// (team-activity.js). Übersicht und Glocke nutzen dieselben Daten wie das Nachfragen alle 30 Sekunden (live).
// Zugang: Cookie-Sitzung + Team-Rolle + Zwei-Faktor-Anmeldung (TOTP), in dieser Sitzung bestätigt (12 Stunden).
// Der Dienst antwortet sonst mit 403 und code forbidden / 2fa_setup_required / 2fa_required – dann zeigt
// die Seite die passende Sperre (Einrichten, Code eingeben, kein Zugang).
// Rahmen mit Seitenleiste (app-shell.js): „Mein Konto“ bleibt auch hinter der Zwei-Faktor-Abfrage erreichbar; ein
// Link wie /team#reiter=support öffnet den Bereich direkt (nach der Abfrage), mit Werten auch einen Eintrag:
// #reiter=support&anfrage=12, #reiter=meldungen&meldung=5, #reiter=spieler&spieler=<uuid>, #reiter=addons&einreichung=<id>
// (oder &unterreiter=meldungen, &addon=<id>), #reiter=cosmetics&cosmetic=<id>.
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
  setSkinSource,
  showError,
  textBlocks,
  timeEl,
  toast,
  uid,
  upload,
} from './app-common.js';
import { ADDON_ID_RE, API_STUFE, KATEGORIEN, accessChips, addonIcon, hasIcon, platformText } from './addon-common.js';
import { memberCard, newsCard, publicGet, skinHead } from './public-cards.js';
import { AREAS, createShell, parseShellHash } from './app-shell.js';
import { initTeamAddons, normalizeAccess } from './team-addons.js';
import { initTeamActivity } from './team-activity.js';
import { initTeamCosmetics } from './team-cosmetics.js';
import { initTeamOverview } from './team-overview.js';
import { initTeamSearch } from './team-search.js';
import { attachmentList, normalizeAttachments } from './support-attachments.js';

// Spielerbilder im Team-Bereich: Minecraft-Köpfe über die Cookie-Sitzung (das bestätigte Team darf alle).
setSkinSource('auth');

const SETUP_FILE_RE = /^HeldixClient-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.exe$/;
/** Mac-Downloads wie beim Bauen benannt, z. B. HeldixClient-0.13.0-mac-arm64.dmg (gleiches Muster wie im Dienst). */
const MAC_FILE_RE = /^HeldixClient-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)-mac-(arm64|x64)\.(dmg|zip)$/;
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
  macUploading: null,
  teamAddons: null, // { addons, pending, keyConfigured } aus GET /v1/team/addons
  addonJar: null, // in dieser Sitzung hochgeladene JAR { file, size, sha256 (selbst gerechnet), serverSha256 }
  addonManifest: null, // gewählte .addon.json { outer, inner, problems, fileName } oder { error, fileName }
  addonUploading: null,
  addonUploadingFile: null,
  auditLimit: AUDIT_STEP,
  supportFilter: 'open',
  supportTickets: [],
  ticket: null, // offene Support-Anfrage
  profile: null, // eigenes Teamprofil { public, title, about }
  since: undefined, // „im Team seit“ für die Vorschau
  previewHead: null,
};

/** Bereich, wenn die Adresse keinen nennt. */
const DEFAULT_SECTION = 'uebersicht';

let shell = null;
let teamAddonsUi = null;
let overview = null;
let activity = null;
let quickSearch = null;
let cosmeticsUi = null;

/**
 * Was gerade offen ist – aus dem Nachfragen (Zähler) und den Listen der Bereiche, ohne eigene Anfragen. Nutzen
 * Übersicht, Glocke und Suche. null = noch nicht geladen.
 */
const live = { reports: null, tickets: null, submissions: null, addonReports: null, addonReportsForbidden: false, at: 0 };

function liveChanged() {
  live.at = Date.now();
  overview?.update();
  activity?.update({ ...live });
}
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
/** Ansichten im Rahmen (mit Seitenleiste); die anderen stehen allein auf der Seite. */
const SHELL_VIEWS = new Set(['team-kein-zugang', 'team-2fa-einrichten', 'team-2fa-pruefen', 'team-app']);

function showView(id) {
  for (const view of VIEWS) $(`#${view}`).hidden = view !== id;
  $('#team-shell').hidden = !SHELL_VIEWS.has(id);
  if (!SHELL_VIEWS.has(id)) shell.closeAll();
  shell.setTeamLocked(id === 'team-2fa-einrichten' || id === 'team-2fa-pruefen');
  if (id === 'team-kein-zugang') shell.setTitle('Team-Bereich');
  for (const dialog of document.querySelectorAll('dialog.modal, dialog.lightbox-dialog')) if (id !== 'team-app') dialog.remove();
  if (id !== 'team-app') {
    teamRefresher.stop();
    // Signier-Schlüssel nie über das Ende der Team-Ansicht hinaus behalten
    teamAddonsUi?.reset();
    // Suche, Glocke und Daten der Übersicht gehören zur bestätigten Team-Ansicht
    quickSearch?.disable();
    activity?.stop();
    overview?.reset();
    cosmeticsUi?.reset();
    Object.assign(live, { reports: null, tickets: null, submissions: null, addonReports: null, addonReportsForbidden: false, at: 0 });
  }
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
  shell.setUser(me);
  if (!me.role) {
    $('#kein-zugang-name').textContent = me.name;
    showView('team-kein-zugang');
    return;
  }
  // Gewünschten Bereich schon markieren – auch hinter der Zwei-Faktor-Abfrage (Titel in der Kopfzeile)
  const wanted = parseShellHash().section;
  if (!shell.current() || (shell.has(wanted) && wanted !== shell.current())) shell.select(shell.has(wanted) ? wanted : DEFAULT_SECTION, { silent: true, history: 'none' });
  if (!me.twoFactor?.enabled) {
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
  // Unterreiter nur für Admins (die Bereiche in der Seitenleiste blendet die Shell selbst aus)
  for (const tab of $$('[data-admin]')) tab.hidden = !admin;
  shell.setMeta([`Angemeldet als ${state.me.name}`, h('span', { class: 'chip success' }, icon('lock'), '2FA bestätigt')]);
  showView('team-app');
  quickSearch.enable();
  activity.start(state.me);
  const { section: wanted, extra } = parseShellHash();
  const current = shell.current();
  // Die Übersicht lädt die Zähler selbst (sonst doppelt beim Start)
  const target = shell.has(wanted) ? wanted : current && shell.has(current) ? current : DEFAULT_SECTION;
  if (target !== 'uebersicht') refreshLive().catch(() => {});
  shell.select(target, { params: shell.has(wanted) ? extra : null });
  if (shell.current() !== 'profil') loadProfile().catch(() => {});
  teamRefresher.start();
}

/** Zähler (Meldungen, Support, Einreichungen, Addon-Meldungen) neu laden – dieselben Anfragen wie das Nachfragen. */
function refreshLive() {
  return Promise.all([refreshReportCount(), refreshSupportCount(), teamAddonsUi.refreshCounts()]);
}

/** Werte aus der Adresse (#reiter=…&anfrage=12) als Zahl bzw. Text. */
const paramId = (params, key) => {
  const value = params?.[key];
  return /^\d{1,9}$/.test(String(value ?? '')) ? Number(value) : null;
};
const paramText = (params, key, re) => {
  const value = params?.[key];
  return typeof value === 'string' && re.test(value) ? value : value !== undefined && value !== null && re.test(String(value)) ? String(value) : null;
};

/**
 * Bereich gewählt (Seitenleiste, Adresse, Suche, Glocke, Übersicht). params: Werte aus der Adresse, die einen Eintrag
 * gleich öffnen (siehe Kopf der Datei).
 */
function onTab(name, { params = null } = {}) {
  // Hinter der Zwei-Faktor-Abfrage nur merken, was gewählt ist – geladen wird erst danach (showApp).
  if ($('#team-app').hidden) return;
  const report = paramId(params, 'meldung');
  const ticket = paramId(params, 'anfrage');
  const player = paramText(params, 'spieler', /^[0-9a-f]{32}$/);
  const submission = paramText(params, 'einreichung', /^[A-Za-z0-9_-]{1,64}$/);
  const addon = paramText(params, 'addon', /^[a-z0-9][a-z0-9_-]{0,39}$/);
  const sub = paramText(params, 'unterreiter', /^(einreichungen|veroeffentlicht|meldungen)$/);
  const cosmetic = paramText(params, 'cosmetic', /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/);
  const loaders = {
    uebersicht: () => overview.load(),
    meldungen: () => {
      if (report === null) return loadReports();
      setReportFilter('all');
      return loadReports({ focusId: report });
    },
    sperren: loadBans,
    neuigkeiten: loadNews,
    updates: loadUpdates,
    addons: async () => {
      teamAddonsUi.show({ sub: addon ? 'veroeffentlicht' : sub, submission });
      // Admins: Liste, öffentlicher Schlüssel (für die Prüfung der Schlüsseldatei) und ausgeblendete Addons
      if (isAdmin()) await loadTeamAddons();
      if (addon) focusTeamAddon(addon);
    },
    cosmetics: () => cosmeticsUi.show({ focusId: cosmetic }),
    team: loadMembers,
    protokoll: loadAudit,
    support: async () => {
      const job = loadSupport();
      if (ticket !== null) openTeamTicket(ticket);
      await job;
    },
    profil: loadProfile,
  };
  if (loaders[name]) loaders[name]().catch(showError);
  if (name === 'spieler') {
    if (player) openPlayer(player);
    else if (!state.players.length && !state.selectedPlayer) $('#spieler-liste').replaceChildren(h('p', { class: 'hint', text: 'Gib einen Namen (oder den Anfang) oder eine UUID ein.' }));
  }
}

/** Zu einem Bereich (mit Eintrag) springen: neuer Eintrag im Verlauf, Seite hoch, Fokus auf den Titel. */
function jump(section, params = null) {
  shell.select(section, { history: 'push', params, scroll: true, source: 'search' });
  $('#shell-titel').focus({ preventScroll: true });
}

/** Bereich öffnen und danach etwas darin tun (z. B. ein Feld fokussieren). */
function jumpThen(section, then) {
  jump(section);
  requestAnimationFrame(() => then());
}

/** Adresse an den offenen Eintrag anpassen (ohne neuen Eintrag im Verlauf, ohne neu zu laden): teilbare Links. */
function syncHash(section, params) {
  if (shell.current() === section) shell.select(section, { silent: true, history: 'replace', params });
}

/** Veröffentlichtes Addon in der Verwaltung zeigen (Suche, Links). */
function focusTeamAddon(id) {
  const card = [...document.querySelectorAll('#addon-verwaltung .addon-admin')].find((element) => element.dataset.id === id);
  if (!card) return;
  card.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  card.classList.add('highlight');
  card.querySelector('input, a, button')?.focus({ preventScroll: true });
  setTimeout(() => card.classList.remove('highlight'), 2400);
}

/** Kleiner Kopf + Name als Knopf (Meldungen). */
function playerWithHead(player) {
  return h('span', { class: 'player-inline' }, avatar(player?.name, player?.uuid, { size: 'xs' }), playerButton(player));
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
  if (filter === 'open') setOpenReports(state.reports);
  else if (filter === 'all') setOpenReports(state.reports.filter((report) => report.status !== 'done'));
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
  shell.setBadge('meldungen', count, { label: `${count} offen` });
}

/** Offene Meldungen: Zähler und Daten für Übersicht und Glocke. */
function setOpenReports(reports) {
  live.reports = reports;
  setOpenCount(reports.length);
  liveChanged();
}

/** Zähler „Meldungen“ (offen), auch wenn der Bereich nicht offen ist. */
async function refreshReportCount() {
  const data = await teamCall('GET', '/v1/team/reports?status=open');
  setOpenReports(Array.isArray(data?.reports) ? data.reports : []);
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
    { class: 'app-card report', id: `meldung-${report.id}`, tabindex: '-1', 'aria-labelledby': `meldung-${report.id}-titel`, dataset: { status: done ? 'done' : 'open' } },
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
      playerWithHead(report.reporter),
      ' hat ',
      playerWithHead(reported),
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
    const open = live.reports ?? (state.reportFilter === 'open' ? state.reports : null);
    if (open) setOpenReports(open.filter((entry) => entry.id !== report.id));
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
  shell.select('meldungen', { silent: true });
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
  if (shell.current() !== 'spieler') shell.select('spieler');
  const detail = $('#spieler-detail');
  detail.replaceChildren(loadingState('Spieler wird geladen …'));
  try {
    const player = await teamCall('GET', `/v1/team/players/${uuid}`);
    state.selectedPlayer = player;
    renderPlayerDetail(player);
    syncHash('spieler', { spieler: player.uuid });
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
  syncHash('spieler', null);
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
  // Mac: die neueste Datei je Prozessor und Art steht auf der Download-Seite (latest/mac-…)
  const newestMac = new Map();
  for (const file of files) {
    if (file.platform !== 'mac' || !file.version) continue;
    const key = `${file.arch}:${file.kind}`;
    const best = newestMac.get(key);
    if (!best || compareVersions(file.version, best.version) > 0) newestMac.set(key, file);
  }
  const SYSTEM_LABEL = { arm64: 'Mac Apple Silicon', x64: 'Mac Intel' };
  rerender($('#update-dateien'), JSON.stringify([files, current?.file]), () => {
    if (!files.length) return emptyState('Noch keine Dateien hochgeladen.', 'file');
    return h(
      'ul',
      { class: 'rows' },
      files.map((file) => {
        const isCurrent = current?.file === file.file;
        const isMac = file.platform === 'mac';
        const onDownloadPage = isMac && newestMac.get(`${file.arch}:${file.kind}`)?.file === file.file;
        return h(
          'li',
          { class: 'row' },
          h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon(isMac ? 'chip' : 'file')),
          h(
            'div',
            { class: 'row-main' },
            h(
              'div',
              { class: 'row-title' },
              h('code', { class: 'mono', text: file.file }),
              isMac ? chip(SYSTEM_LABEL[file.arch] ?? 'Mac') : chip('Windows'),
              isCurrent ? chip('veröffentlicht', 'success') : null,
              onDownloadPage ? chip('auf der Download-Seite', 'success') : null,
            ),
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
    text:
      file.platform === 'mac'
        ? 'Die Datei verschwindet vom Server. Die Download-Seite zeigt dann die nächstältere Version für diesen Prozessor (falls es eine gibt).'
        : 'Die Datei verschwindet vom Server. Launcher, die gerade diese Version laden, brechen ab.',
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

function setMacMessage(kind, text) {
  const error = $('#upload-mac-fehler');
  const okBox = $('#upload-mac-ok');
  error.hidden = kind !== 'error';
  okBox.hidden = kind !== 'ok';
  if (kind === 'error') error.textContent = text;
  if (kind === 'ok') okBox.replaceChildren(icon('check'), h('span', { text }));
}

/** Mac-Downloads (DMG/ZIP) nacheinander hochladen; sie brauchen keine update.json. */
async function onMacChosen(event) {
  const input = event.currentTarget;
  const chosen = [...(input.files ?? [])];
  input.value = '';
  if (!chosen.length) return;
  $('#upload-mac-name').textContent = chosen.length === 1 ? `${chosen[0].name} · ${formatBytes(chosen[0].size)}` : `${chosen.length} Dateien · ${formatBytes(chosen.reduce((sum, f) => sum + f.size, 0))}`;
  setMacMessage(null);
  const wrong = chosen.find((file) => !MAC_FILE_RE.test(file.name));
  if (wrong) {
    setMacMessage('error', `${wrong.name}: Mac-Dateien müssen so heißen wie beim Bauen, z. B. HeldixClient-1.4.0-mac-arm64.dmg oder HeldixClient-1.4.0-mac-x64.zip.`);
    return;
  }
  const bad = chosen.find((file) => file.size === 0 || file.size > MAX_UPLOAD);
  if (bad) {
    setMacMessage('error', `${bad.name}: ${bad.size ? 'Die Datei ist größer als 1 GB.' : 'Die Datei ist leer.'}`);
    return;
  }
  const existing = chosen.filter((file) => state.updates?.files?.some((entry) => entry.file === file.name));
  if (existing.length) {
    const replace = await confirmAction({
      title: existing.length === 1 ? `${existing[0].name} ersetzen?` : `${existing.length} Dateien ersetzen?`,
      text: 'Dateien mit diesen Namen liegen schon auf dem Server.',
      confirmLabel: 'Ersetzen',
    });
    if (!replace) return;
  }
  const bar = $('#upload-mac-balken');
  const fill = bar.firstElementChild;
  const label = $('#upload-mac-text');
  const chooser = input.closest('label');
  $('#upload-mac-fortschritt').hidden = false;
  $('#upload-mac-abbrechen').hidden = false;
  chooser.classList.add('disabled');
  input.disabled = true;
  const done = [];
  try {
    for (const [index, file] of chosen.entries()) {
      const prefix = chosen.length > 1 ? `${index + 1}/${chosen.length} · ` : '';
      fill.style.width = '0%';
      bar.setAttribute('aria-valuenow', '0');
      label.textContent = `${prefix}0 % · 0 von ${formatBytes(file.size)}`;
      const started = Date.now();
      const job = upload(`/v1/team/updates/files/${encodeURIComponent(file.name)}`, file, (loaded, total) => {
        const percent = Math.min(100, Math.floor((loaded / total) * 100));
        fill.style.width = `${percent}%`;
        bar.setAttribute('aria-valuenow', String(percent));
        const seconds = (Date.now() - started) / 1000;
        const speed = seconds > 0.5 ? ` · ${formatBytes(loaded / seconds)}/s` : '';
        label.textContent = `${prefix}${percent} % · ${formatBytes(loaded)} von ${formatBytes(total)}${speed}`;
      });
      state.macUploading = job;
      await job.promise;
      done.push(file.name);
    }
    fill.style.width = '100%';
    label.textContent = '100 %';
    setMacMessage('ok', done.length === 1 ? `${done[0]} ist hochgeladen und steht auf der Download-Seite.` : `${done.length} Dateien sind hochgeladen und stehen auf der Download-Seite.`);
    toast(done.length === 1 ? `${done[0]} ist hochgeladen.` : `${done.length} Mac-Dateien sind hochgeladen.`, 'success');
  } catch (error) {
    handleAccessError(error);
    if (!error.handled) setMacMessage('error', done.length ? `${error.message} (schon hochgeladen: ${done.join(', ')})` : error.message);
  } finally {
    state.macUploading = null;
    $('#upload-mac-abbrechen').hidden = true;
    chooser.classList.remove('disabled');
    input.disabled = false;
    setTimeout(() => {
      if (!state.macUploading) $('#upload-mac-fortschritt').hidden = true;
    }, 1500);
    await loadUpdates().catch(showError);
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
// Addons (nur Admins): JAR hochladen, signiertes Manifest prüfen und veröffentlichen, ausblenden, löschen
// ---------------------------------------------------------------------------------------------------------

const ADDON_FILE_RE = /^heldix-addon-[a-z0-9][a-z0-9_-]{0,39}-\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?\.jar$/;
const ADDON_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const ADDON_MAX = 50 * 1024 * 1024;
/** Höchste Heldix-API-Stufe, die HeldixClient derzeit lädt. */
const ADDON_API_HEUTE = API_STUFE;

const textLength = (value) => [...value].length;

function normalizeTeamAddons(data) {
  return {
    addons: (Array.isArray(data?.addons) ? data.addons : [])
      .filter((addon) => addon && typeof addon.id === 'string')
      .map((addon) => ({ ...addon, versions: Array.isArray(addon.versions) ? [...addon.versions].sort((a, b) => compareVersions(b.version, a.version)) : [] }))
      .sort((a, b) => String(a.name ?? a.id).localeCompare(String(b.name ?? b.id), 'de', { sensitivity: 'base' })),
    pending: Array.isArray(data?.pending) ? data.pending.filter((entry) => entry && typeof entry.file === 'string') : [],
    keyConfigured: data?.keyConfigured !== false,
    publicKey: typeof data?.publicKey === 'string' && data.publicKey.includes('PUBLIC KEY') ? data.publicKey : null,
    pendingSubmissions: Number.isInteger(data?.pendingSubmissions) ? data.pendingSubmissions : null,
    openReports: Number.isInteger(data?.openReports) ? data.openReports : null,
  };
}

async function loadTeamAddons() {
  const box = $('#addon-verwaltung');
  if (!box.firstChild) box.replaceChildren(loadingState());
  state.teamAddons = normalizeTeamAddons(await teamCall('GET', '/v1/team/addons'));
  renderTeamAddons();
}

/** Antworten der Änderungs-Routen: mit Liste übernehmen, sonst neu laden. */
async function applyTeamAddons(data) {
  if (data && Array.isArray(data.addons)) {
    state.teamAddons = normalizeTeamAddons(data);
    renderTeamAddons();
  } else {
    await loadTeamAddons();
  }
}

const shortSha = (hash) => (typeof hash === 'string' && hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : (hash ?? '–'));
const addonDownloads = (count) => (count === 1 ? '1 Download' : `${new Intl.NumberFormat('de-DE').format(count ?? 0)} Downloads`);

function renderTeamAddons() {
  const data = state.teamAddons;
  if (!data) return;
  $('#addon-schluessel-fehlt').hidden = data.keyConfigured;
  $('#addon-anzahl').textContent = data.addons.length ? String(data.addons.length) : '';
  rerender($('#addon-verwaltung'), JSON.stringify(data.addons), () => {
    if (!data.addons.length) return emptyState('Noch kein Addon veröffentlicht.', 'addons');
    return h('div', { class: 'addon-admin-list' }, data.addons.map(addonAdminItem));
  });
  const pending = [...data.pending].sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
  rerender($('#addon-offen'), JSON.stringify(pending), () => {
    if (!pending.length) return emptyState('Keine offenen Dateien.', 'file');
    return h(
      'ul',
      { class: 'rows' },
      pending.map((entry) =>
        h(
          'li',
          { class: 'row' },
          h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('file')),
          h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('code', { class: 'mono', text: entry.file })), h('div', { class: 'row-sub', text: `${formatBytes(entry.size)} · hochgeladen ${formatDateTime(entry.uploadedAt)}` })),
          h(
            'div',
            { class: 'row-actions' },
            h(
              'button',
              { type: 'button', class: 'button tiny ghost quiet-danger', 'aria-label': `${entry.file} löschen`, dataset: { focusKey: `pending:${entry.file}` }, onClick: () => deletePendingAddonFile(entry) },
              icon('trash'),
              h('span', { class: 'label', text: 'Löschen' }),
            ),
          ),
        ),
      ),
    );
  });
  renderAddonCheck();
  teamAddonsUi?.teamAddonsChanged();
}

/** Aus Addon-Meldungen: ausblenden (PATCH) und die Liste übernehmen. */
async function setAddonHidden(id, hidden) {
  await applyTeamAddons(await teamCall('PATCH', `/v1/team/addons/${encodeURIComponent(id)}`, { hidden }));
}

/** Besitzer eines Community-Addons (Einreicher) oder null bei offiziellen Addons. */
function ownerName(addon) {
  if (addon.owner && typeof addon.owner === 'object') return typeof addon.owner.name === 'string' ? addon.owner.name : '?';
  return typeof addon.ownerName === 'string' ? addon.ownerName : null;
}

function addonAdminItem(addon) {
  const name = addon.name ?? addon.id;
  const latest = addon.versions[0] ?? null;
  const switchId = `addon-sichtbar-${addon.id}`;
  const toggle = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id: switchId, dataset: { focusKey: `visible:${addon.id}` } });
  toggle.checked = !addon.hidden;
  toggle.addEventListener('change', () => toggleAddonVisible(addon, toggle));
  return h(
    'article',
    { class: 'addon-admin', dataset: { id: addon.id } },
    h(
      'div',
      { class: 'addon-admin-head' },
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('addons')),
      h(
        'div',
        { class: 'row-main' },
        h(
          'div',
          { class: 'row-title' },
          h('span', { text: name }),
          h('code', { class: 'mono muted', text: addon.id }),
          chip(`Version ${addon.latest ?? latest?.version ?? '?'}`, 'accent'),
          addon.hidden ? chip('ausgeblendet', 'warning') : null,
          addon.official === false || ownerName(addon) ? h('span', { class: 'chip community' }, icon('friends'), 'Community') : h('span', { class: 'chip official' }, icon('shield'), 'Offiziell'),
          // Mods & Addons: Zugriff der neuesten Version (Dienst ab 1.6.1; ältere Angaben = nur Heldix-API)
          accessChips(normalizeAccess(addon, latest)),
        ),
        ownerName(addon)
          ? h('div', { class: 'row-meta addon-owner' }, 'Besitzer: ', addon.owner?.uuid ? h('button', { type: 'button', class: 'link-button', onClick: () => openPlayer(addon.owner.uuid) }, ownerName(addon)) : h('span', { text: ownerName(addon) }))
          : null,
        h(
          'div',
          { class: 'row-sub', text: [addonDownloads(addon.downloads), addon.versions.length === 1 ? '1 Version' : `${addon.versions.length} Versionen`, latest?.publishedAt ? `zuletzt ${formatDate(latest.publishedAt)}${latest.publishedBy ? ` von ${latest.publishedBy}` : ''}` : null].filter(Boolean).join(' · ') },
        ),
      ),
      h(
        'div',
        { class: 'row-actions addon-admin-actions' },
        h('label', { class: 'inline-switch', for: switchId }, toggle, h('span', { text: 'Im Store sichtbar' })),
        addon.hidden ? null : h('a', { class: 'button tiny ghost', href: `/addons#${addon.id}`, target: '_blank', rel: 'noopener' }, icon('external'), h('span', { class: 'label', text: 'Im Store' })),
      ),
    ),
    h(
      'ul',
      { class: 'rows addon-admin-versions', 'aria-label': `Versionen von ${name}` },
      addon.versions.map((version, index) => {
        const notes = Array.isArray(version.notes) ? version.notes.filter((note) => typeof note === 'string' && note.trim()) : [];
        return h(
          'li',
          { class: 'row' },
          h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('file')),
          h(
            'div',
            { class: 'row-main' },
            h('div', { class: 'row-title' }, h('strong', { text: version.version }), index === 0 ? chip('neueste', 'success') : null, version.api ? chip(`API ${version.api}`) : null, index > 0 ? accessChips(normalizeAccess(version), { compact: true }) : null),
            h('div', { class: 'row-sub', text: [formatBytes(version.size), version.publishedAt ? `veröffentlicht ${formatDateTime(version.publishedAt)}` : null, version.publishedBy ? `von ${version.publishedBy}` : null].filter(Boolean).join(' · ') }),
            h('div', { class: 'row-meta' }, h('code', { class: 'mono', title: version.sha256 ?? '', text: `SHA-256 ${shortSha(version.sha256)}` })),
            notes.length ? h('ul', { class: 'plain-list addon-admin-notes' }, notes.map((note) => h('li', { text: note }))) : null,
          ),
          h(
            'div',
            { class: 'row-actions' },
            h(
              'button',
              { type: 'button', class: 'button tiny ghost quiet-danger', 'aria-label': `${name} ${version.version} löschen`, dataset: { focusKey: `version:${addon.id}:${version.version}` }, onClick: () => deleteAddonVersion(addon, version) },
              icon('trash'),
              h('span', { class: 'label', text: 'Löschen' }),
            ),
          ),
        );
      }),
    ),
  );
}

async function toggleAddonVisible(addon, input) {
  const hidden = !input.checked;
  const name = addon.name ?? addon.id;
  const patch = async () => applyTeamAddons(await teamCall('PATCH', `/v1/team/addons/${encodeURIComponent(addon.id)}`, { hidden }));
  if (hidden) {
    const ok = await confirmAction({
      title: `${name} aus dem Store nehmen?`,
      text: 'Das Addon verschwindet aus dem Store auf der Webseite, im Launcher und im Spiel. Wer es installiert hat, behält es. Die Dateien bleiben auf dem Server.',
      confirmLabel: 'Aus dem Store nehmen',
      danger: true,
      onConfirm: patch,
    });
    if (!ok) {
      input.checked = true;
      return;
    }
    toast(`${name} steht nicht mehr im Store.`, 'success');
  } else {
    try {
      await busy(input, patch);
      toast(`${name} steht wieder im Store.`, 'success');
    } catch (error) {
      input.checked = false;
      showError(error);
    }
  }
}

async function deleteAddonVersion(addon, version) {
  const name = addon.name ?? addon.id;
  const only = addon.versions.length === 1;
  const newest = addon.versions[0]?.version === version.version;
  const ok = await confirmAction({
    title: `${name} ${version.version} löschen?`,
    text: [
      only
        ? 'Das ist die einzige Version: Das Addon verschwindet ganz aus dem Store.'
        : newest
          ? `Die Datei wird gelöscht. Der Store bietet dann wieder Version ${addon.versions[1].version} an.`
          : 'Die Datei dieser Version wird gelöscht.',
      'Wer diese Version installiert hat, behält sie.',
    ],
    confirmLabel: 'Löschen',
    danger: true,
    onConfirm: async () => applyTeamAddons(await teamCall('DELETE', `/v1/team/addons/${encodeURIComponent(addon.id)}/versions/${encodeURIComponent(version.version)}`)),
  });
  if (ok) toast(`${name} ${version.version} ist gelöscht.`, 'success');
}

async function deletePendingAddonFile(entry) {
  const ok = await confirmAction({
    title: `${entry.file} löschen?`,
    text: 'Die hochgeladene Datei verschwindet vom Server. Veröffentlicht war sie noch nicht.',
    confirmLabel: 'Löschen',
    danger: true,
    onConfirm: async () => applyTeamAddons(await teamCall('DELETE', `/v1/team/addons/files/${encodeURIComponent(entry.file)}`)),
  });
  if (!ok) return;
  if (state.addonJar?.file === entry.file) state.addonJar = null;
  renderAddonCheck();
  toast(`${entry.file} ist gelöscht.`, 'success');
}

/** Felder des Manifests nach den Regeln des Dienstes prüfen; gibt deutsche Hinweise zurück (leer = alles gut). */
function addonManifestProblems(m) {
  const problems = [];
  const isText = (value, min, max) => typeof value === 'string' && textLength(value) >= min && textLength(value) <= max;
  if (m.type !== 'heldix-addon') problems.push('„type“ muss "heldix-addon" sein.');
  if (typeof m.id !== 'string' || !ADDON_ID_RE.test(m.id)) problems.push('„id“: nur a–z, 0–9, _ und -, höchstens 40 Zeichen.');
  if (!isText(m.name, 1, 40)) problems.push('„name“: 1–40 Zeichen.');
  if (typeof m.version !== 'string' || !ADDON_VERSION_RE.test(m.version)) problems.push('„version“ wie 1.2.3 oder 1.2.3-beta.1.');
  if (!isText(m.summary, 1, 200)) problems.push('„summary“: 1–200 Zeichen.');
  if (!isText(m.description, 0, 4000)) problems.push('„description“: Text mit höchstens 4000 Zeichen.');
  if (!Array.isArray(m.authors) || m.authors.length < 1 || m.authors.length > 5 || !m.authors.every((author) => isText(author, 1, 40))) problems.push('„authors“: 1–5 Namen mit je 1–40 Zeichen.');
  if (!Number.isInteger(m.api) || m.api < 1 || m.api > 99) problems.push('„api“: ganze Zahl von 1 bis 99.');
  if (typeof m.icon !== 'string' || !/^[a-z0-9-]{1,30}$/.test(m.icon)) problems.push('„icon“: Name aus dem Heldix-Icon-Set (a–z, 0–9, -).');
  if (!Object.hasOwn(KATEGORIEN, m.category)) problems.push(`„category“: eine von ${Object.keys(KATEGORIEN).join(', ')}.`);
  if (!Array.isArray(m.platforms) || !m.platforms.every((system) => ['windows', 'mac', 'linux'].includes(system)) || new Set(m.platforms).size !== m.platforms.length) problems.push('„platforms“: windows, mac und/oder linux, ohne Doppelte (leer = alle).');
  if (typeof m.id === 'string' && typeof m.version === 'string' && m.file !== `heldix-addon-${m.id}-${m.version}.jar`) problems.push(`„file“ muss heldix-addon-${m.id}-${m.version}.jar heißen.`);
  if (!Number.isInteger(m.size) || m.size < 1 || m.size > ADDON_MAX) problems.push('„size“: 1 Byte bis 50 MB.');
  if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(m.sha256)) problems.push('„sha256“: 64 Hex-Zeichen (klein).');
  if (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(m.date) || !Number.isFinite(Date.parse(m.date))) problems.push('„date“: Datum nach ISO 8601, z. B. 2026-11-25.');
  if (m.notes !== undefined && (!Array.isArray(m.notes) || m.notes.length > 20 || !m.notes.every((note) => isText(note, 1, 300)))) problems.push('„notes“: höchstens 20 Texte mit je 1–300 Zeichen.');
  // Mods & Addons (Dienst ab 1.6.1): freiwillig; fehlen sie, gilt access api
  if (m.access !== undefined && !['api', 'minecraft'].includes(m.access)) problems.push('„access“: api oder minecraft.');
  if (m.minecraft !== undefined && (!Array.isArray(m.minecraft) || m.minecraft.length > 50 || !m.minecraft.every((version) => typeof version === 'string' && /^[0-9A-Za-z][0-9A-Za-z._+*-]{0,31}$/.test(version)) || new Set(m.minecraft).size !== m.minecraft.length)) problems.push('„minecraft“: Liste mit höchstens 50 Minecraft-Versionen (z. B. 26.3), ohne Doppelte.');
  else if (m.access === 'minecraft' && !(m.minecraft ?? []).length) problems.push('„minecraft“ darf nicht leer sein, wenn das Addon in Minecraft eingreift.');
  if (m.loaders !== undefined && (!Array.isArray(m.loaders) || !m.loaders.length || !m.loaders.every((loader) => ['heldix', 'fabric'].includes(loader)) || new Set(m.loaders).size !== m.loaders.length)) problems.push('„loaders“: heldix und/oder fabric, ohne Doppelte.');
  return problems;
}

function setAddonUploadMessage(kind, text) {
  const error = $('#addon-upload-fehler');
  const okBox = $('#addon-upload-ok');
  error.hidden = kind !== 'error';
  okBox.hidden = kind !== 'ok';
  if (kind === 'error') error.textContent = text;
  if (kind === 'ok') okBox.replaceChildren(icon('check'), h('span', { text }));
}

async function sha256Hex(file) {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const publishedAddonFile = (file) => state.teamAddons?.addons.some((addon) => addon.versions.some((version) => version.file === file));

async function onAddonFilesChosen(event) {
  const input = event.currentTarget;
  const chosen = [...(input.files ?? [])];
  input.value = '';
  if (!chosen.length) return;
  $('#addon-dateien-name').textContent = chosen.map((file) => `${file.name} · ${formatBytes(file.size)}`).join(', ');
  setAddonUploadMessage(null);
  const jars = chosen.filter((file) => /\.jar$/i.test(file.name));
  const manifests = chosen.filter((file) => /\.json$/i.test(file.name));
  if (jars.length > 1 || manifests.length > 1 || jars.length + manifests.length !== chosen.length) {
    setAddonUploadMessage('error', 'Bitte höchstens eine JAR und eine .addon.json wählen.');
    return;
  }
  if (manifests.length) {
    await readAddonManifest(manifests[0]);
    renderAddonCheck();
  }
  if (jars.length) await uploadAddonJar(jars[0]);
  renderAddonCheck();
}

async function readAddonManifest(file) {
  const fail = (text) => {
    state.addonManifest = { error: text, fileName: file.name };
  };
  if (file.size > 64 * 1024) return fail('Diese Datei ist zu groß für eine .addon.json.');
  let outer;
  try {
    outer = JSON.parse((await file.text()).replace(/^﻿/, ''));
  } catch {
    return fail('Die Datei ist kein gültiges JSON. Bitte die .addon.json wählen, die npm run addon erzeugt.');
  }
  if (!outer || typeof outer !== 'object' || typeof outer.manifest !== 'string' || typeof outer.signature !== 'string' || !outer.signature) {
    return fail('Das ist keine .addon.json: Es fehlen „manifest“ oder „signature“. Sie entsteht mit npm run addon.');
  }
  let inner;
  try {
    inner = JSON.parse(outer.manifest);
  } catch {
    return fail('„manifest“ in der .addon.json ist kein gültiges JSON.');
  }
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return fail('„manifest“ in der .addon.json ist kein Objekt.');
  state.addonManifest = { outer: { manifest: outer.manifest, signature: outer.signature }, inner, problems: addonManifestProblems(inner), fileName: file.name };
}

async function uploadAddonJar(file) {
  const inner = state.addonManifest?.inner;
  if (!ADDON_FILE_RE.test(file.name)) {
    setAddonUploadMessage('error', 'Die JAR muss so heißen wie beim Bauen: heldix-addon-<id>-<version>.jar (z. B. heldix-addon-spotify-1.0.0.jar).');
    return;
  }
  if (inner && typeof inner.file === 'string' && inner.file !== file.name) {
    setAddonUploadMessage('error', `Die JAR passt nicht zum Manifest: Erwartet wird ${inner.file}.`);
    return;
  }
  if (file.size === 0 || file.size > ADDON_MAX) {
    setAddonUploadMessage('error', file.size ? 'Die Datei ist größer als 50 MB.' : 'Die Datei ist leer.');
    return;
  }
  if (publishedAddonFile(file.name)) {
    setAddonUploadMessage('error', 'Diese Version ist schon veröffentlicht und lässt sich nicht ersetzen. Für Änderungen eine höhere Version bauen.');
    return;
  }
  if (state.teamAddons?.pending.some((entry) => entry.file === file.name)) {
    const replace = await confirmAction({ title: `${file.name} ersetzen?`, text: 'Eine Datei mit diesem Namen liegt schon auf dem Server (noch nicht veröffentlicht).', confirmLabel: 'Ersetzen' });
    if (!replace) return;
  }
  const bar = $('#addon-balken');
  const fill = bar.firstElementChild;
  const label = $('#addon-fortschritt-text');
  const chooser = $('#addon-dateien').closest('label');
  $('#addon-fortschritt').hidden = false;
  $('#addon-abbrechen').hidden = false;
  fill.style.width = '0%';
  bar.setAttribute('aria-valuenow', '0');
  label.textContent = 'Prüfsumme wird berechnet …';
  chooser.classList.add('disabled');
  $('#addon-dateien').disabled = true;
  state.addonJar = null;
  state.addonUploadingFile = file.name;
  renderAddonCheck();
  try {
    const sha256 = await sha256Hex(file).catch(() => null);
    label.textContent = `0 % · 0 von ${formatBytes(file.size)}`;
    const started = Date.now();
    const job = upload(`/v1/team/addons/files/${encodeURIComponent(file.name)}`, file, (loaded, total) => {
      const percent = Math.min(100, Math.floor((loaded / total) * 100));
      fill.style.width = `${percent}%`;
      bar.setAttribute('aria-valuenow', String(percent));
      const seconds = (Date.now() - started) / 1000;
      const speed = seconds > 0.5 ? ` · ${formatBytes(loaded / seconds)}/s` : '';
      label.textContent = `${percent} % · ${formatBytes(loaded)} von ${formatBytes(total)}${speed}`;
    });
    state.addonUploading = job;
    const result = await job.promise;
    state.addonJar = { file: file.name, size: result?.size ?? file.size, sha256, serverSha256: typeof result?.sha256 === 'string' ? result.sha256 : null };
    fill.style.width = '100%';
    label.textContent = `100 % · ${formatBytes(file.size)}`;
    setAddonUploadMessage('ok', `${file.name} ist hochgeladen (${formatBytes(state.addonJar.size)}).${state.addonManifest?.inner ? '' : ' Jetzt die .addon.json wählen.'}`);
    toast(`${file.name} ist hochgeladen.`, 'success');
    await loadTeamAddons().catch(showError);
  } catch (error) {
    handleAccessError(error);
    if (!error.handled) setAddonUploadMessage('error', error.message);
  } finally {
    state.addonUploading = null;
    state.addonUploadingFile = null;
    $('#addon-abbrechen').hidden = true;
    chooser.classList.remove('disabled');
    $('#addon-dateien').disabled = false;
    setTimeout(() => {
      if (!state.addonUploading) $('#addon-fortschritt').hidden = true;
    }, 1500);
  }
}

function renderAddonCheck() {
  const box = $('#addon-pruefung');
  const actions = $('#addon-aktionen');
  const chosen = state.addonManifest;
  if (!chosen && !state.addonJar) {
    box.replaceChildren(h('p', { class: 'muted small', text: 'Sobald JAR und .addon.json da sind, steht hier die Prüfung.' }));
    box.classList.remove('filled');
    actions.hidden = true;
    return;
  }
  box.classList.add('filled');
  actions.hidden = false;
  const publish = $('#addon-veroeffentlichen');
  if (chosen?.error) {
    box.replaceChildren(h('ul', { class: 'check-list' }, h('li', { class: 'fail' }, icon('close'), h('span', { text: `${chosen.fileName}: ${chosen.error}` }))));
    publish.disabled = true;
    return;
  }
  if (!chosen) {
    box.replaceChildren(h('ul', { class: 'check-list' }, h('li', { class: 'info' }, icon('info'), h('span', { text: `${state.addonJar.file} liegt bereit. Jetzt die passende .addon.json wählen.` }))));
    publish.disabled = true;
    return;
  }
  const inner = chosen.inner;
  const data = state.teamAddons;
  const checks = [];
  if (data && !data.keyConfigured) checks.push(['fail', 'Im Dienst ist kein Update-Schlüssel eingerichtet – Veröffentlichen geht erst danach.']);
  if (chosen.problems.length) for (const problem of chosen.problems.slice(0, 4)) checks.push(['fail', `Manifest: ${problem}`]);
  else checks.push(['ok', 'Manifest vollständig, Typ heldix-addon']);
  const jar = state.addonJar?.file === inner.file ? state.addonJar : null;
  const pending = data?.pending.find((entry) => entry.file === inner.file);
  if (jar) checks.push(['ok', `JAR ${inner.file} ist hochgeladen`]);
  else if (state.addonUploadingFile === inner.file) checks.push(['wait', `JAR ${inner.file} wird gerade hochgeladen …`]);
  else if (pending) checks.push(['ok', `JAR ${inner.file} liegt schon auf dem Server (hochgeladen ${formatDateTime(pending.uploadedAt)})`]);
  else checks.push(['fail', `JAR ${typeof inner.file === 'string' ? inner.file : ''} fehlt noch – zuerst hochladen (Schritt 1)`]);
  const size = jar?.size ?? pending?.size;
  if (typeof size === 'number') checks.push([size === inner.size ? 'ok' : 'fail', size === inner.size ? `Größe passt (${formatBytes(size)})` : `Größe passt nicht: Manifest ${formatBytes(inner.size)}, JAR ${formatBytes(size)}`]);
  if (jar?.sha256) {
    const same = jar.sha256 === inner.sha256 && (!jar.serverSha256 || jar.serverSha256 === jar.sha256);
    checks.push([same ? 'ok' : 'fail', same ? 'SHA-256 passt zur hochgeladenen JAR (selbst nachgerechnet)' : 'SHA-256 passt nicht zur hochgeladenen JAR – falsche Datei oder altes Manifest?']);
  } else if (jar?.serverSha256 || pending) {
    const known = jar?.serverSha256 ?? null;
    if (known) checks.push([known === inner.sha256 ? 'ok' : 'fail', known === inner.sha256 ? 'SHA-256 passt (laut Dienst)' : 'SHA-256 passt nicht zur JAR auf dem Server']);
    else checks.push(['info', 'SHA-256 prüft der Dienst beim Veröffentlichen (die JAR wurde nicht in dieser Sitzung gewählt)']);
  }
  const existing = data?.addons.find((addon) => addon.id === inner.id);
  if (existing) {
    const highest = existing.versions[0]?.version ?? existing.latest;
    if (highest && typeof inner.version === 'string') {
      const higher = compareVersions(inner.version, highest) > 0;
      checks.push([higher ? 'ok' : 'fail', higher ? `Version ${inner.version} ist höher als ${highest}` : `Version ${inner.version} ist nicht höher als die vorhandene ${highest}`]);
    }
    if (existing.hidden) checks.push(['warn', 'Das Addon ist ausgeblendet. Auch die neue Version erscheint erst, wenn du es wieder einblendest.']);
  } else if (data) {
    checks.push(['ok', 'Neues Addon – es steht nach dem Veröffentlichen sofort im Store']);
  }
  if (Number.isInteger(inner.api) && inner.api > ADDON_API_HEUTE) checks.push(['warn', `Braucht Heldix-API-Stufe ${inner.api} – HeldixClient kann derzeit bis Stufe ${ADDON_API_HEUTE}.`]);
  if (typeof inner.icon === 'string' && !hasIcon(inner.icon)) checks.push(['warn', `Icon „${inner.icon}“ gibt es im Heldix-Icon-Set nicht – angezeigt wird das Puzzleteil.`]);
  checks.push(['info', 'Die Signatur prüft der Dienst beim Veröffentlichen']);

  const notes = Array.isArray(inner.notes) ? inner.notes.filter((note) => typeof note === 'string' && note.trim()) : [];
  const platforms = Array.isArray(inner.platforms) ? inner.platforms.filter((system) => typeof system === 'string') : [];
  box.replaceChildren(
    h(
      'div',
      { class: 'manifest-head' },
      addonIcon(typeof inner.icon === 'string' ? inner.icon : 'addons'),
      h('div', null, h('strong', { text: typeof inner.name === 'string' ? inner.name : '?' }), h('p', { class: 'muted small', text: typeof inner.summary === 'string' ? inner.summary : '' })),
    ),
    h(
      'dl',
      { class: 'facts-list' },
      h('dt', { text: 'ID' }),
      h('dd', null, h('code', { class: 'mono', text: String(inner.id ?? '–') })),
      h('dt', { text: 'Version' }),
      h('dd', null, h('strong', { text: String(inner.version ?? '–') })),
      h('dt', { text: 'Datei' }),
      h('dd', null, h('code', { class: 'mono', text: String(inner.file ?? '–') })),
      h('dt', { text: 'Größe' }),
      h('dd', { text: formatBytes(inner.size) }),
      h('dt', { text: 'SHA-256' }),
      h('dd', null, h('code', { class: 'mono hash', title: String(inner.sha256 ?? ''), text: shortSha(inner.sha256) })),
      h('dt', { text: 'Kategorie' }),
      h('dd', { text: KATEGORIEN[inner.category] ?? String(inner.category ?? '–') }),
      h('dt', { text: 'Systeme' }),
      h('dd', { text: platformText(platforms.filter((system) => ['windows', 'mac', 'linux'].includes(system))) }),
      h('dt', { text: 'API-Stufe' }),
      h('dd', { text: String(inner.api ?? '–') }),
      h('dt', { text: 'Zugriff' }),
      h('dd', null, normalizeAccess(inner).access === 'minecraft' ? h('span', { class: 'chips-row' }, accessChips(normalizeAccess(inner))) : 'Nur Heldix-API'),
      h('dt', { text: 'Autoren' }),
      h('dd', { text: Array.isArray(inner.authors) ? inner.authors.join(', ') : '–' }),
      notes.length ? [h('dt', { text: 'Neu' }), h('dd', null, h('ul', { class: 'plain-list' }, notes.map((note) => h('li', { text: note }))))] : null,
    ),
    h(
      'ul',
      { class: 'check-list' },
      checks.map(([kind, text]) => h('li', { class: kind }, icon(kind === 'ok' ? 'check' : kind === 'fail' ? 'close' : kind === 'warn' ? 'warning' : kind === 'wait' ? 'clock' : 'info'), h('span', { text }))),
    ),
  );
  const blocked = checks.some(([kind]) => kind === 'fail' || kind === 'wait');
  publish.disabled = blocked;
  publish.title = blocked ? 'Erst die rot markierten Punkte klären.' : '';
}

function resetAddonUpload() {
  state.addonManifest = null;
  state.addonJar = null;
  $('#addon-dateien-name').textContent = 'Keine Datei gewählt';
  setAddonUploadMessage(null);
  renderAddonCheck();
}

async function publishAddon(event) {
  const chosen = state.addonManifest;
  if (!chosen?.inner) return;
  const { inner, outer } = chosen;
  const existing = state.teamAddons?.addons.some((addon) => addon.id === inner.id);
  const ok = await confirmAction({
    title: `${inner.name} ${inner.version} veröffentlichen?`,
    text: existing
      ? 'Die neue Version steht sofort im Store. Launcher und Spiel bieten sie als Aktualisierung an.'
      : 'Das Addon steht sofort im Store – auf der Webseite, im Launcher und im Spiel.',
    confirmLabel: 'Veröffentlichen',
    onConfirm: async () => {
      const data = await teamCall('PUT', '/v1/team/addons/manifest', outer);
      state.addonManifest = null;
      state.addonJar = null;
      await applyTeamAddons(data);
    },
  });
  if (!ok) {
    event.currentTarget?.focus?.();
    return;
  }
  resetAddonUpload();
  toast(`${inner.name} ${inner.version} ist im Store.`, 'success');
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
      role === 'admin' ? 'Admins können zusätzlich Updates und Addons veröffentlichen, das Team verwalten, das Protokoll lesen, Capes zurücksetzen und Spielerdaten löschen.' : 'Moderatoren sehen Meldungen, Spieler und Sperren und schreiben Neuigkeiten.',
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
    text: role === 'admin' ? 'Admins haben alle Rechte, auch für Updates, Addons und das Team.' : 'Moderatoren sehen Meldungen mit Chatverlauf, Spieler und Sperren.',
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
  shell.setBadge('support', count, { label: count === 1 ? '1 wartet auf Antwort' : `${count} warten auf Antwort` });
}

/** Zähler am Reiter: Anfragen, deren letzte Nachricht vom Spieler ist (dazu die Daten für Übersicht und Glocke). */
async function refreshSupportCount() {
  const data = await teamCall('GET', '/v1/team/support?status=open');
  live.tickets = Array.isArray(data?.tickets) ? data.tickets : [];
  setSupportCount(live.tickets.filter((ticket) => ticket.unread).length);
  liveChanged();
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
  if (filter === 'open') {
    live.tickets = state.supportTickets;
    liveChanged();
  }
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
            avatar(ticket.player?.name, ticket.player?.uuid, { size: 'sm' }),
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
  if (shell.current() !== 'support') shell.select('support');
  state.ticket = { id, loading: true };
  renderSupportList();
  const detail = $('#team-ticket');
  detail.replaceChildren(loadingState('Anfrage wird geladen …'));
  if (!window.matchMedia('(min-width: 901px)').matches) detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
  try {
    const data = await teamCall('GET', `/v1/team/support/${encodeURIComponent(id)}`);
    if (state.ticket?.id !== id) return;
    buildTicketView(data.ticket);
    syncHash('support', { anfrage: id });
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
    h('div', { id: 'team-ticket-anhaenge' }),
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
  // Anhänge mit Vorschau (erste 200 Zeilen, nur als Text) und Download
  const attachments = normalizeAttachments(ticket.attachments);
  rerender($('#team-ticket-anhaenge'), JSON.stringify([ticket.id, attachments]), () => attachmentList(ticket.id, attachments, { base: '/v1/team/support', preview: true, onError: handleAccessError }));
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
  const tasks = [refreshReportCount(), refreshSupportCount(), teamAddonsUi.refreshCounts()];
  if (shell.current() === 'support') {
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

let profileLoading = null;

/** Teamprofil laden. Läuft schon ein Laden, kommt dessen Ergebnis (Start der Seite + Öffnen des Bereichs). */
function loadProfile() {
  if (!profileLoading) profileLoading = fetchProfile().finally(() => (profileLoading = null));
  return profileLoading;
}

async function fetchProfile() {
  const data = await teamCall('GET', '/v1/team/me/profile');
  // Hat jemand währenddessen schon getippt, bleiben die Eingaben stehen (sonst wären sie still weg).
  const keepInput = profileDirty();
  state.profile = { public: Boolean(data?.public), title: String(data?.title ?? ''), about: String(data?.about ?? '') };
  if (!keepInput) {
    $('#profil-public').checked = state.profile.public;
    $('#profil-titel').value = state.profile.title;
    $('#profil-text').value = state.profile.about;
    $('#profil-titel').dispatchEvent(new Event('input'));
    $('#profil-text').dispatchEvent(new Event('input'));
  }
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
  // Den eigenen Kopf liefert die angemeldete Route immer – auch solange das Profil privat ist.
  if (!state.previewHead) state.previewHead = skinHead(state.me.uuid, state.me.name, { source: 'auth' });
  const card = memberCard({ uuid: state.me.uuid, name: state.me.name, role: state.me.role, title: values.title, about: values.about, since: state.since ?? null }, { head: state.previewHead });
  $('#profil-vorschau').replaceChildren(card);
  const status = $('#profil-vorschau-status');
  if (values.public && savedPublic) status.textContent = 'So sieht man dich gerade auf der Teamseite.';
  else if (values.public) status.textContent = 'Noch nicht öffentlich – nach dem Speichern sieht man dich so auf der Teamseite.';
  else status.textContent = 'Nicht öffentlich – so würde deine Karte auf der Teamseite aussehen.';
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
  'addon.upload': 'Addon-Datei hochgeladen',
  'addon.publish': 'Addon veröffentlicht',
  'addon.hide': 'Addon aus dem Store genommen',
  'addon.show': 'Addon wieder im Store',
  'addon.delete': 'Addon-Datei gelöscht',
  'addon.approve': 'Addon-Einreichung freigegeben',
  'addon.reject': 'Addon-Einreichung abgelehnt',
  'addon.report.done': 'Addon-Meldung erledigt',
  'addon-report.done': 'Addon-Meldung erledigt',
  'addon.report': 'Addon-Meldung erledigt',
  'cosmetic.publish': 'Cosmetic veröffentlicht',
  'cosmetic.hide': 'Cosmetic ausgeblendet',
  'cosmetic.show': 'Cosmetic wieder im Katalog',
  'cosmetic.delete': 'Cosmetic gelöscht',
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
              h('td', { class: 'nowrap', 'data-label': 'Wer' }, h('span', { class: 'player-inline' }, avatar(entry.actor?.name, entry.actor?.uuid, { size: 'xs' }), h('strong', { text: entry.actor?.name ?? '?' }))),
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

/** Aus dem Addons-Reiter zu den Spieler-Details wechseln. */
function openPlayerFromAddons(uuid) {
  shell.select('spieler');
  openPlayer(uuid);
}

async function logout() {
  try {
    await busy($('#team-abmelden'), () => api('POST', '/v1/web/logout'));
  } catch (error) {
    if (error.status !== 401) return showError(error);
  }
  showGuest('Du hast dich abgemeldet.');
}

function init() {
  shell = createShell({ root: $('#team-shell'), page: 'team', defaultSection: DEFAULT_SECTION, onSelect: onTab, onSignOut: logout });
  shell.mountOverview($('#uebersicht-kacheln'));
  teamAddonsUi = initTeamAddons({
    teamCall,
    handleAccessError,
    isAdmin,
    openPlayer: (uuid) => openPlayerFromAddons(uuid),
    getTeamAddons: () => state.teamAddons,
    loadTeamAddons,
    setAddonHidden,
    setBadge: (count, label) => shell.setBadge('addons', count, { label }),
    onData: (data) => {
      if (data.submissions) live.submissions = data.submissions;
      if (data.reports) live.addonReports = data.reports;
      live.addonReportsForbidden = data.reportsForbidden;
      liveChanged();
    },
    onNavigate: (params) => syncHash('addons', params),
  });
  overview = initTeamOverview({ shell, teamCall, isAdmin, getMe: () => state.me, getLive: () => live, refreshLive, actionLabel });
  activity = initTeamActivity({ shell });
  cosmeticsUi = initTeamCosmetics({ teamCall, onChange: () => quickSearch?.invalidate() });
  quickSearch = initTeamSearch({
    shell,
    teamCall,
    isAdmin,
    sections: () => shell.sections().map((id) => AREAS.team.sections.find((section) => section.id === id)).filter(Boolean),
    getTeamAddons: () => state.teamAddons,
    getCosmetics: () => cosmeticsUi.list(),
    open: {
      section: (id) => jump(id),
      player: (uuid) => jump('spieler', { spieler: uuid }),
      ticket: (id) => jump('support', { anfrage: id }),
      report: (id) => jump('meldungen', { meldung: id }),
      submission: (id) => jump('addons', { einreichung: id }),
      addon: (id) => (isAdmin() ? jump('addons', { addon: id }) : window.open(`/addons#${encodeURIComponent(id)}`, '_blank', 'noopener')),
      cosmetic: (id) => jump('cosmetics', { cosmetic: id }),
    },
    actions: () =>
      [
        { id: 'neuigkeit', label: 'Neue Neuigkeit schreiben', text: 'Neuigkeiten → Editor öffnen', icon: 'news', keywords: ['news', 'beitrag', 'schreiben', 'neuigkeit'], run: () => jumpThen('neuigkeiten', () => openEditor(null)) },
        { id: 'sperren', label: 'Spieler sperren …', text: 'Sperren → Name und Grund eingeben', icon: 'ban', keywords: ['bann', 'ban', 'sperre'], run: () => jumpThen('sperren', () => $('#sperre-name').focus()) },
        isAdmin() ? { id: 'mitglied', label: 'Mitglied hinzufügen …', text: 'Team → Spielername und Rolle', icon: 'user-plus', keywords: ['team', 'moderator', 'admin', 'rolle'], run: () => jumpThen('team', () => $('#mitglied-name').focus()) } : null,
        isAdmin() ? { id: 'cosmetic', label: 'Cosmetic veröffentlichen …', text: 'Cosmetics → .cosmetic.json wählen', icon: 'sparkles', keywords: ['cosmetic', 'hut', 'flügel', 'cape', 'katalog'], run: () => jumpThen('cosmetics', () => $('#cosmetic-datei').focus()) } : null,
        isAdmin() ? { id: 'update', label: 'Launcher-Update veröffentlichen …', text: 'Updates → Installer und update.json', icon: 'download', keywords: ['update', 'version', 'release', 'installer'], run: () => jumpThen('updates', () => $('#upload-exe').focus()) } : null,
      ].filter(Boolean),
  });
  $('#team-erneut').addEventListener('click', start);

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
  $('#upload-mac').addEventListener('change', onMacChosen);
  $('#upload-mac-abbrechen').addEventListener('click', () => state.macUploading?.abort());
  $('#upload-json').addEventListener('change', onManifestChosen);
  $('#manifest-veroeffentlichen').addEventListener('click', publishManifest);

  $('#addon-dateien').addEventListener('change', onAddonFilesChosen);
  $('#addon-abbrechen').addEventListener('click', () => state.addonUploading?.abort());
  $('#addon-veroeffentlichen').addEventListener('click', publishAddon);
  $('#addon-verwerfen').addEventListener('click', resetAddonUpload);
  $('#addons-neu').addEventListener('click', (event) => busy(event.currentTarget, () => loadTeamAddons()).catch(showError));
  renderAddonCheck();

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
    if (state.uploading || state.macUploading || state.addonUploading || editorDirty() || profileDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  start();
}

init();
