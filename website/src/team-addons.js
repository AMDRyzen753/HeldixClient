// HeldixClient – Webseite: Team-Bereich → Addons. Unterreiter „Einreichungen“ (Addons von Spielern prüfen, ablehnen,
// freigeben), „Veröffentlicht“ (nur Admins, Liste in team.js) und „Meldungen“ (Addon-Meldungen von Spielern).
//
// Freigeben heißt signieren – und das passiert hier im Browser (addon-signing.js): Der Admin wählt seine
// Schlüsseldatei, die Seite prüft sie gegen den öffentlichen Schlüssel des Dienstes, rechnet die SHA-256 der JAR
// selbst nach, vergleicht das Manifest mit der Einreichung und signiert genau den Manifest-Text, den der Dienst
// geliefert hat. Gesendet wird nur die Signatur.
import { api, avatar, bindCounter, busy, emptyState, formatBytes, formatDateTime, h, icon, loadingState, openDialog, relativeTime, rerender, setupTabs, showError, timeEl, toast, uid } from './app-common.js';
import {
  ADDON_ID_RE,
  KATEGORIEN,
  addonIcon,
  addonReasonLabel,
  hasIcon,
  inspectionChips,
  inspectionList,
  normalizeAddons,
  normalizeInspection,
  plainText,
  platformText,
} from './addon-common.js';
import { forgetSigningKey, loadSigningKey, onSigningKeyChange, signAddonManifest, signingKeyInfo } from './addon-signing.js';
import { openLightbox } from './lightbox.js';
import { publicGet } from './public-cards.js';

const STATUS = {
  pending: ['Zu prüfen', 'warning'],
  approved: ['Freigegeben', 'success'],
  rejected: ['Abgelehnt', 'danger'],
  withdrawn: ['Zurückgezogen', ''],
  draft: ['Entwurf', ''],
};
const MAX_REJECT = 1000;
const RED = ['prozesse', 'nativ', 'minecraft'];
const $ = (id) => document.getElementById(id);
const shortSha = (hash) => (typeof hash === 'string' && hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : (hash ?? '–'));

function chip(text, kind = '') {
  return h('span', { class: `chip${kind ? ` ${kind}` : ''}`, text });
}

function statusChip(status) {
  const [label, kind] = STATUS[status] ?? [status, ''];
  return chip(label, kind);
}

function normalizeSubmission(value) {
  if (!value || typeof value !== 'object' || (typeof value.id !== 'string' && typeof value.id !== 'number')) return null;
  const text = (field, max) => (typeof value[field] === 'string' ? value[field].slice(0, max) : '');
  const who = value.submitter && typeof value.submitter === 'object' ? value.submitter : {};
  const submitter = { uuid: typeof who.uuid === 'string' && /^[0-9a-f]{32}$/.test(who.uuid) ? who.uuid : null, name: typeof who.name === 'string' && who.name ? who.name.slice(0, 40) : 'Unbekannt' };
  return {
    id: String(value.id),
    status: Object.hasOwn(STATUS, value.status) ? value.status : 'pending',
    addonId: typeof value.addonId === 'string' && ADDON_ID_RE.test(value.addonId) ? value.addonId : null,
    version: text('version', 60),
    name: text('name', 40),
    summary: text('summary', 200),
    description: text('description', 4000),
    category: Object.hasOwn(KATEGORIEN, value.category) ? value.category : 'sonstiges',
    icon: typeof value.icon === 'string' && /^[a-z0-9-]{1,30}$/.test(value.icon) ? value.icon : 'addons',
    platforms: Array.isArray(value.platforms) ? value.platforms.filter((system) => ['windows', 'mac', 'linux'].includes(system)) : [],
    notes: Array.isArray(value.notes) ? value.notes.filter((note) => typeof note === 'string').slice(0, 20) : [],
    authors: Array.isArray(value.authors) ? value.authors.filter((author) => typeof author === 'string').slice(0, 5) : [],
    api: Number.isInteger(value.api) ? value.api : null,
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : null,
    sha256: typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256) ? value.sha256 : null,
    screenshots: Number.isInteger(value.screenshots) ? Math.min(4, Math.max(0, value.screenshots)) : 0,
    inspection: normalizeInspection(value.inspection),
    submittedAt: value.submittedAt ?? null,
    reviewedAt: value.reviewedAt ?? null,
    reviewNote: text('reviewNote', 1000),
    reviewer: text('reviewer', 40),
    submitter,
  };
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * teamCall: Anfrage mit Team-Zugang (401/2FA führen zur passenden Ansicht). handleAccessError: dieselbe Behandlung
 * für Fehler aus eigenen Aufrufen. isAdmin(): Rolle. openPlayer(uuid): Spieler-Details. getTeamAddons(): Daten aus
 * GET /v1/team/addons (nur Admins, mit publicKey). loadTeamAddons(): neu laden. setAddonHidden(id, hidden).
 */
export function initTeamAddons({ teamCall, handleAccessError, isAdmin, openPlayer, getTeamAddons, loadTeamAddons, setAddonHidden }) {
  const state = {
    sub: 'einreichungen',
    filter: 'pending',
    submissions: [],
    selected: null, // { submission, manifest, loading }
    reportFilter: 'open',
    reports: [],
    reportsForbidden: false,
    published: null, // öffentliche Liste (um Updates von neuen Addons zu unterscheiden)
    checklist: new Set(),
  };

  /** Wie teamCall, aber ein 403 „forbidden“ (Route nur für Admins) wird still zu null – ohne Neuladen der Seite. */
  async function softCall(method, path) {
    try {
      return await api(method, path);
    } catch (error) {
      if (error.status === 403 && error.code === 'forbidden') return null;
      handleAccessError(error);
      throw error;
    }
  }

  const subtabs = setupTabs($('addon-unterreiter'), (name) => {
    state.sub = name;
    if (name === 'einreichungen') loadSubmissions().catch(showError);
    if (name === 'meldungen') loadReports().catch(showError);
    if (name === 'veroeffentlicht') loadTeamAddons().catch(showError);
  });

  // -------------------------------------------------------------------------------------------------------
  // Zähler (Reiter „Addons“, Unterreiter)
  // -------------------------------------------------------------------------------------------------------

  function setCount(id, count, label) {
    const badge = $(id);
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-label', label);
  }

  let counts = { submissions: 0, reports: 0 };
  function renderCounts() {
    setCount('count-einreichungen', counts.submissions, `${counts.submissions} zu prüfen`);
    setCount('count-addon-meldungen', counts.reports, `${counts.reports} offen`);
    const total = counts.submissions + counts.reports;
    setCount('count-addons', total, `${counts.submissions} Einreichungen zu prüfen, ${counts.reports} offene Addon-Meldungen`);
  }

  async function refreshCounts() {
    const [subs, reports] = await Promise.all([softCall('GET', '/v1/team/addon-submissions?status=pending'), state.reportsForbidden ? null : softCall('GET', '/v1/team/addon-reports?status=open')]);
    if (subs) counts.submissions = Array.isArray(subs.submissions) ? subs.submissions.length : 0;
    if (reports) counts.reports = Array.isArray(reports.reports) ? reports.reports.length : 0;
    else if (!state.reportsForbidden && reports === null) hideReports();
    renderCounts();
  }

  function hideReports() {
    state.reportsForbidden = true;
    $('unterreiter-meldungen').hidden = true;
    if (state.sub === 'meldungen') subtabs.select('einreichungen');
  }

  // -------------------------------------------------------------------------------------------------------
  // Einreichungen: Liste
  // -------------------------------------------------------------------------------------------------------

  async function loadPublished() {
    if (state.published) return state.published;
    try {
      state.published = normalizeAddons((await publicGet('/v1/addons'))?.addons);
    } catch {
      state.published = [];
    }
    return state.published;
  }

  /** Gibt es das Addon schon (dann ist es ein Update)? Admins sehen auch ausgeblendete. */
  function existingAddon(id) {
    const team = getTeamAddons()?.addons.find((addon) => addon.id === id);
    if (team) return { name: team.name ?? team.id, version: team.versions?.[0]?.version ?? team.latest ?? null, hidden: Boolean(team.hidden) };
    const listed = state.published?.find((addon) => addon.id === id);
    return listed ? { name: listed.name, version: listed.version, hidden: false } : null;
  }

  async function loadSubmissions({ keep = true } = {}) {
    const box = $('einreichungen-liste');
    if (!box.firstChild || box.dataset.filter !== state.filter) {
      box.dataset.signature = '';
      box.replaceChildren(loadingState());
    }
    box.dataset.filter = state.filter;
    const filter = state.filter;
    const [data] = await Promise.all([teamCall('GET', `/v1/team/addon-submissions?status=${filter}`), loadPublished()]);
    if (filter !== state.filter) return;
    state.submissions = (Array.isArray(data?.submissions) ? data.submissions : []).map(normalizeSubmission).filter(Boolean);
    if (filter === 'pending') {
      counts.submissions = state.submissions.length;
      renderCounts();
    }
    renderList();
    if (keep && state.selected && !state.submissions.some((sub) => sub.id === state.selected.submission.id) && filter === 'pending') {
      // Erledigt (z. B. von jemand anderem im Team): Details bleiben, zeigen aber den neuen Stand
      openSubmission(state.selected.submission.id, { quiet: true }).catch(() => {});
    }
  }

  function renderList() {
    const current = state.selected?.submission.id ?? '';
    rerender($('einreichungen-liste'), JSON.stringify([state.submissions, current]), () => {
      if (!state.submissions.length) return emptyState(state.filter === 'pending' ? 'Keine Einreichungen zu prüfen. Alles erledigt!' : 'Noch keine Einreichungen.', 'check');
      return h(
        'ul',
        { class: 'rows' },
        state.submissions.map((sub) =>
          h(
            'li',
            null,
            h(
              'button',
              { type: 'button', class: 'row row-button submission-item', 'aria-current': sub.id === current ? 'true' : undefined, dataset: { id: sub.id, focusKey: `einreichung:${sub.id}` }, onClick: () => openSubmission(sub.id) },
              addonIcon(sub.icon, 'addon-icon small'),
              h(
                'span',
                { class: 'row-main' },
                h('span', { class: 'row-title' }, h('span', { text: sub.name || sub.addonId }), h('span', { class: 'chip', text: sub.version }), state.filter === 'all' ? statusChip(sub.status) : null),
                h('span', { class: 'row-sub', text: `${sub.addonId} · von ${sub.submitter.name} · ${relativeTime(sub.submittedAt)}${existingAddon(sub.addonId) ? ' · Update' : ' · neues Addon'}` }),
                h('span', { class: 'chips-row' }, inspectionChips(sub.inspection)),
              ),
              icon('chevron-right'),
            ),
          ),
        ),
      );
    });
  }

  // -------------------------------------------------------------------------------------------------------
  // Einreichungen: Details und Prüfung
  // -------------------------------------------------------------------------------------------------------

  async function openSubmission(id, { quiet = false } = {}) {
    const detail = $('einreichung-detail');
    if (!quiet) {
      state.selected = { submission: state.submissions.find((sub) => sub.id === id) ?? normalizeSubmission({ id }), manifest: null, loading: true };
      state.checklist = new Set();
      renderList();
      detail.replaceChildren(loadingState('Einreichung wird geladen …'));
      if (!window.matchMedia('(min-width: 901px)').matches) detail.scrollIntoView({ block: 'start' });
    }
    try {
      const data = await teamCall('GET', `/v1/team/addon-submissions/${encodeURIComponent(id)}`);
      if (state.selected?.submission.id !== id) return;
      const submission = normalizeSubmission(data?.submission ?? data);
      const manifest = typeof data?.manifest === 'string' ? data.manifest : typeof data?.submission?.manifest === 'string' ? data.submission.manifest : null;
      state.selected = { submission, manifest, loading: false };
      renderDetail({ focus: !quiet });
    } catch (error) {
      if (error.handled || state.selected?.submission.id !== id) return;
      detail.replaceChildren(emptyState(error.message, 'warning'));
    }
  }

  function closeDetail() {
    const id = state.selected?.submission.id;
    state.selected = null;
    $('einreichung-detail').replaceChildren(h('div', { class: 'empty placeholder' }, icon('addons'), h('p', { text: 'Wähle links eine Einreichung, um Code-Hinweise, Store-Angaben und Screenshots zu prüfen.' })));
    renderList();
    const item = [...document.querySelectorAll('#einreichungen-liste [data-focus-key]')].find((element) => element.dataset.focusKey === `einreichung:${id}`);
    item?.focus();
  }

  function fact(label, ...value) {
    return [h('dt', { text: label }), h('dd', null, ...value)];
  }

  function renderDetail({ focus = false } = {}) {
    const selected = state.selected;
    if (!selected?.submission) return;
    const sub = selected.submission;
    const existing = sub.addonId ? existingAddon(sub.addonId) : null;
    const red = (sub.inspection?.uses ?? []).filter((use) => RED.includes(use));
    const pending = sub.status === 'pending';
    const images = Array.from({ length: sub.screenshots }, (_, index) => ({ src: `/api/v1/team/addon-submissions/${encodeURIComponent(sub.id)}/screenshots/${index + 1}`, alt: `${sub.name} – Screenshot ${index + 1}` }));
    const titleId = uid('einreichung');
    $('einreichung-detail').replaceChildren(
      ...[
      h(
        'div',
        { class: 'detail-top' },
        h('button', { type: 'button', class: 'icon-button back', 'aria-label': 'Zurück zur Liste', onClick: closeDetail }, icon('chevron-left')),
        addonIcon(sub.icon, 'addon-icon'),
        h(
          'div',
          { class: 'review-title' },
          h('h2', { id: titleId, tabindex: '-1', text: `${sub.name || sub.addonId} ${sub.version}` }),
          h(
            'p',
            { class: 'row-meta review-meta' },
            statusChip(sub.status),
            existing ? chip(`Update von ${existing.version ?? '?'}`, 'accent') : chip('Neues Addon', 'accent'),
            existing?.hidden ? chip('Addon ist ausgeblendet', 'warning') : null,
            h('span', { class: 'player-inline' }, avatar(sub.submitter.name, sub.submitter.uuid, { size: 'xs' }), sub.submitter.uuid ? h('button', { type: 'button', class: 'link-button', onClick: () => openPlayer(sub.submitter.uuid) }, sub.submitter.name) : h('span', { text: sub.submitter.name })),
            h('span', null, 'eingereicht ', timeEl(sub.submittedAt, relativeTime(sub.submittedAt))),
          ),
        ),
      ),
      sub.status !== 'pending' ? reviewResult(sub) : null,
      h(
        'section',
        { class: `inspect-box${red.length ? ' danger' : sub.inspection?.uses.length ? ' warn' : ' ok'}`, 'aria-labelledby': `${titleId}-pruefung` },
        h('h3', { id: `${titleId}-pruefung` }, icon(red.length ? 'warning' : 'shield'), 'Prüf-Hinweise aus der JAR'),
        inspectionList(sub.inspection),
        h('p', { class: 'hint', text: `${sub.inspection?.classes ?? '?'} Klassendateien durchsucht. Die Hinweise kommen aus einer groben Suche nach Konstanten – sie ersetzen nicht den Blick in den Code. Rot heißt: darf ein Addon praktisch nie (nur die Heldix-API ist erlaubt).` }),
        h(
          'div',
          { class: 'card-actions' },
          h('a', { class: 'button small', id: 'einreichung-jar', href: `/api/v1/team/addon-submissions/${encodeURIComponent(sub.id)}/jar`, download: `heldix-addon-${sub.addonId}-${sub.version}.jar` }, icon('download'), 'JAR herunterladen'),
          h('span', { class: 'muted small', text: `heldix-addon-${sub.addonId}-${sub.version}.jar · ${formatBytes(sub.size)}` }),
        ),
      ),
      h(
        'section',
        { class: 'review-section' },
        h('h3', { text: 'Store-Angaben' }),
        h(
          'dl',
          { class: 'facts-list' },
          fact('Addon-ID', h('code', { class: 'mono', text: sub.addonId ?? '–' })),
          fact('Version', h('strong', { text: sub.version || '–' })),
          fact('Name', sub.name || '–'),
          fact('Kategorie', KATEGORIEN[sub.category]),
          fact('Icon', h('span', { class: 'icon-fact' }, addonIcon(sub.icon, 'addon-icon tiny'), h('code', { class: 'mono', text: sub.icon }), hasIcon(sub.icon) ? null : chip('unbekannt → Puzzleteil', 'warning'))),
          fact('Systeme', platformText(sub.platforms)),
          fact('API-Stufe', sub.api === null ? '–' : String(sub.api)),
          fact(sub.authors.length === 1 ? 'Autor' : 'Autoren', sub.authors.join(', ') || '–'),
          fact('SHA-256', h('code', { class: 'mono hash-full', text: sub.sha256 ?? '–' })),
        ),
        h('h4', { text: 'Kurzbeschreibung' }),
        h('p', { class: 'review-summary', text: sub.summary || '–' }),
        h('h4', { text: 'Beschreibung' }),
        sub.description ? h('div', { class: 'addon-text review-text' }, plainText(sub.description)) : h('p', { class: 'muted small', text: 'Keine Beschreibung.' }),
        h('h4', { text: 'Was ist neu' }),
        sub.notes.length ? h('ul', { class: 'plain-list' }, sub.notes.map((note) => h('li', { text: note }))) : h('p', { class: 'muted small', text: 'Keine Angaben.' }),
      ),
      h(
        'section',
        { class: 'review-section' },
        h('h3', { text: images.length ? `Screenshots (${images.length})` : 'Screenshots' }),
        images.length
          ? h(
              'div',
              { class: `shot-grid count-${images.length}` },
              images.map((image, index) => h('button', { type: 'button', class: 'shot-thumb', 'aria-label': `${image.alt} groß ansehen`, onClick: () => openLightbox(images, index, { label: `Screenshots von ${sub.name}` }) }, h('img', { src: image.src, alt: '', loading: 'lazy', width: '320', height: '180' }))),
            )
          : h('p', { class: 'muted small', text: 'Keine Screenshots eingereicht.' }),
      ),
      selected.manifest
        ? h(
            'details',
            { class: 'manifest-text' },
            h('summary', null, 'Manifest, das signiert wird', icon('chevron-down')),
            h('p', { class: 'hint', text: 'Genau diesen Text hat der Dienst für die Einreichung erzeugt. Signiert wird „heldix-addon“, ein Zeilenumbruch und dieser Text.' }),
            h('pre', { class: 'code', tabindex: '0' }, h('code', { text: selected.manifest })),
          )
        : null,
      pending ? reviewActions(sub) : null,
      ].filter(Boolean),
    );
    updateApprove();
    if (focus) document.getElementById(titleId)?.focus({ preventScroll: true });
  }

  function reviewResult(sub) {
    const texts = {
      approved: `Freigegeben${sub.reviewer ? ` von ${sub.reviewer}` : ''}${sub.reviewedAt ? ` am ${formatDateTime(sub.reviewedAt)}` : ''}. Das Addon steht im Store.`,
      rejected: `Abgelehnt${sub.reviewer ? ` von ${sub.reviewer}` : ''}${sub.reviewedAt ? ` am ${formatDateTime(sub.reviewedAt)}` : ''}.`,
      withdrawn: 'Der Spieler hat die Einreichung zurückgezogen.',
    };
    return h(
      'div',
      { class: `review-result ${sub.status}` },
      icon(sub.status === 'approved' ? 'check' : sub.status === 'rejected' ? 'close' : 'info'),
      h('div', null, h('p', { text: texts[sub.status] ?? '' }), sub.status === 'rejected' && sub.reviewNote ? h('blockquote', { class: 'quote' }, h('span', { class: 'quote-label', text: 'Begründung: ' }), sub.reviewNote) : null),
    );
  }

  // --- Checkliste, Schlüssel, Freigeben/Ablehnen

  function checklistItems(sub) {
    const red = (sub.inspection?.uses ?? []).filter((use) => RED.includes(use));
    return [
      ['code', 'Ich habe die JAR heruntergeladen und den Code angesehen.'],
      ['api', 'Das Addon nutzt nur die Heldix-API – keine Minecraft-Klassen, kein nachgeladener Code.'],
      ['hinweise', red.length ? 'Die rot markierten Prüf-Hinweise habe ich geprüft und sie sind harmlos erklärt.' : 'Die Prüf-Hinweise habe ich geprüft und sie passen zu dem, was das Addon tun soll.'],
      ['inhalt', 'Name, Texte, Icon und Screenshots sind in Ordnung – nichts Anstößiges, keine fremden Marken.'],
    ];
  }

  function reviewActions(sub) {
    const admin = isAdmin();
    const items = checklistItems(sub);
    const list = h(
      'fieldset',
      { class: 'review-checklist' },
      h('legend', { text: 'Vor dem Freigeben' }),
      items.map(([key, text]) => {
        const box = h('input', { type: 'checkbox', dataset: { check: key } });
        box.checked = state.checklist.has(key);
        box.addEventListener('change', () => {
          if (box.checked) state.checklist.add(key);
          else state.checklist.delete(key);
          updateApprove();
        });
        return h('label', { class: 'check-row' }, box, h('span', { text }));
      }),
    );
    return h(
      'section',
      { class: 'review-section review-actions', id: 'pruefen' },
      h('h3', { text: 'Prüfen und entscheiden' }),
      admin ? list : null,
      admin ? h('div', { id: 'schluessel-box' }, keyBox()) : h('p', { class: 'info-box small' }, icon('lock'), h('span', { text: 'Freigeben können nur Admins – sie signieren das Addon dabei mit dem Update-Schlüssel. Ablehnen mit Begründung kannst du.' })),
      h('p', { class: 'form-error', id: 'freigabe-fehler', role: 'alert', hidden: true }),
      h(
        'div',
        { class: 'card-actions' },
        admin ? h('button', { type: 'button', class: 'button small', id: 'einreichung-freigeben', onClick: (event) => approve(event.currentTarget) }, icon('shield'), 'Signieren und freigeben …') : null,
        h('button', { type: 'button', class: 'button small ghost danger-text', id: 'einreichung-ablehnen', onClick: () => reject() }, icon('close'), 'Ablehnen …'),
      ),
      admin ? h('p', { class: 'hint', id: 'freigabe-hinweis' }) : null,
    );
  }

  function keyBox() {
    const info = signingKeyInfo();
    const publicPem = getTeamAddons()?.publicKey ?? null;
    const input = h('input', { type: 'file', id: 'schluessel-datei', accept: '.pem,application/x-pem-file,text/plain', class: 'visually-hidden' });
    input.addEventListener('change', onKeyChosen);
    if (info) {
      return h(
        'div',
        { class: 'key-box loaded' },
        icon('lock'),
        h(
          'div',
          { class: 'key-text' },
          h('strong', { text: `Schlüssel geladen: ${info.fileName}` }),
          h('span', { class: 'muted small', text: `Passt zum öffentlichen Update-Schlüssel des Dienstes. Nur im Arbeitsspeicher dieses Tabs – vergessen spätestens um ${new Date(info.forgetsAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr oder beim Verlassen der Seite.` }),
        ),
        h('button', { type: 'button', class: 'button tiny ghost', id: 'schluessel-vergessen', onClick: () => forgetSigningKey() }, icon('close'), 'Schlüssel vergessen'),
      );
    }
    return h(
      'div',
      { class: 'key-box' },
      icon('lock'),
      h(
        'div',
        { class: 'key-text' },
        h('strong', { text: 'Schlüsseldatei für die Signatur' }),
        h('span', { class: 'muted small', text: publicPem ? 'Wähl update-key.pem (Ed25519, PKCS#8). Die Datei bleibt im Arbeitsspeicher dieses Tabs und wird nie hochgeladen – zum Dienst geht nur die Signatur.' : 'Im Dienst ist kein öffentlicher Update-Schlüssel eingerichtet. Freigeben geht erst, wenn HELDIX_DIENST_UPDATE_KEY gesetzt ist.' }),
        h('span', { class: 'form-error key-error', id: 'schluessel-fehler', role: 'alert', hidden: true }),
      ),
      h('label', { class: `button tiny ghost file-button${publicPem ? '' : ' disabled'}` }, icon('file'), 'Schlüsseldatei wählen …', input),
    );
  }

  function renderKeyBox() {
    const box = $('schluessel-box');
    if (box) box.replaceChildren(keyBox());
    updateApprove();
  }

  async function onKeyChosen(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = ''; // die Auswahl nicht im Formular stehen lassen
    if (!file) return;
    try {
      await loadSigningKey(file, getTeamAddons()?.publicKey ?? null);
      toast('Schlüssel geladen und geprüft – er passt zum Dienst.', 'success');
      $('schluessel-vergessen')?.focus();
    } catch (error) {
      renderKeyBox();
      const box = $('schluessel-fehler');
      if (box) {
        box.textContent = error.message;
        box.hidden = false;
      } else toast(error.message, 'error');
    }
  }

  function updateApprove() {
    const button = $('einreichung-freigeben');
    if (!button) return;
    const sub = state.selected?.submission;
    const missing = [];
    if (sub && checklistItems(sub).some(([key]) => !state.checklist.has(key))) missing.push('alle Punkte der Checkliste abhaken');
    if (!signingKeyInfo()) missing.push('die Schlüsseldatei wählen');
    if (!getTeamAddons()?.publicKey) missing.push('den Update-Schlüssel im Dienst einrichten');
    if (!state.selected?.manifest) missing.push('auf das Manifest vom Dienst warten');
    button.disabled = missing.length > 0;
    const hint = $('freigabe-hinweis');
    if (hint) hint.textContent = missing.length ? `Zum Freigeben noch: ${missing.join(', ')}.` : 'Alles bereit. Vor dem Senden zeigt die Seite noch einmal genau, was signiert wird.';
  }

  /** Manifest gegen die Einreichung und die nachgerechnete JAR prüfen → [[ok|fail, Text]]. */
  function manifestChecks(sub, manifestText, jar) {
    const checks = [];
    let m = null;
    try {
      m = JSON.parse(manifestText);
    } catch {
      return [['fail', 'Das Manifest vom Dienst ist kein gültiges JSON.']];
    }
    if (!m || typeof m !== 'object') return [['fail', 'Das Manifest vom Dienst ist kein Objekt.']];
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    checks.push([m.type === 'heldix-addon' ? 'ok' : 'fail', m.type === 'heldix-addon' ? 'Typ heldix-addon' : '„type“ ist nicht heldix-addon']);
    checks.push([m.official === false ? 'ok' : 'fail', m.official === false ? 'Community-Addon (official: false)' : 'Das Manifest gibt sich als offizielles Addon aus – so darf keine Einreichung signiert werden']);
    const authorOk = m.author && typeof m.author === 'object' && m.author.uuid === sub.submitter.uuid;
    checks.push([authorOk ? 'ok' : 'fail', authorOk ? `Entwickler im Manifest: ${m.author.name} (Einreicher)` : 'Der Entwickler im Manifest ist nicht der Einreicher']);
    const idOk = m.id === sub.addonId && m.version === sub.version && m.file === `heldix-addon-${sub.addonId}-${sub.version}.jar`;
    checks.push([idOk ? 'ok' : 'fail', idOk ? `ID, Version und Datei passen (${m.file})` : 'ID, Version oder Dateiname im Manifest weichen von der Einreichung ab']);
    const storeOk = same(m.name, sub.name) && same(m.summary, sub.summary) && same(m.description ?? '', sub.description) && same(m.category, sub.category) && same(m.icon, sub.icon) && same(m.platforms ?? [], sub.platforms) && same(m.notes ?? [], sub.notes);
    checks.push([storeOk ? 'ok' : 'fail', storeOk ? 'Store-Angaben im Manifest = geprüfte Angaben' : 'Die Store-Angaben im Manifest weichen von dem ab, was du geprüft hast – Seite neu laden']);
    const sizeOk = m.size === jar.size && m.size === sub.size;
    checks.push([sizeOk ? 'ok' : 'fail', sizeOk ? `Größe passt (${formatBytes(jar.size)})` : `Größe passt nicht: Manifest ${formatBytes(m.size)}, JAR ${formatBytes(jar.size)}`]);
    const shaOk = m.sha256 === jar.sha256 && m.sha256 === sub.sha256;
    checks.push([shaOk ? 'ok' : 'fail', shaOk ? 'SHA-256 der JAR selbst nachgerechnet – passt' : 'SHA-256 der heruntergeladenen JAR passt nicht zum Manifest']);
    return { checks, manifest: m };
  }

  async function approve(button) {
    const selected = state.selected;
    const sub = selected?.submission;
    if (!sub || !selected.manifest) return;
    const error = $('freigabe-fehler');
    error.hidden = true;
    const publicPem = getTeamAddons()?.publicKey ?? null;
    let jar;
    try {
      // JAR so laden, wie sie der Dienst ausliefern würde, und selbst nachrechnen
      jar = await busy(button, async () => {
        const response = await teamCall('GET', `/v1/team/addon-submissions/${encodeURIComponent(sub.id)}/jar`, undefined, { raw: true });
        const buffer = await response.arrayBuffer();
        return { size: buffer.byteLength, sha256: await sha256Hex(buffer) };
      });
    } catch (problem) {
      if (problem.handled) return;
      error.textContent = `Die JAR ließ sich nicht laden: ${problem.message}`;
      error.hidden = false;
      return;
    }
    const result = manifestChecks(sub, selected.manifest, jar);
    const checks = Array.isArray(result) ? result : result.checks;
    const m = Array.isArray(result) ? null : result.manifest;
    const failed = checks.some(([kind]) => kind === 'fail');
    const ok = await openDialog({
      title: `${m?.name ?? sub.name} ${m?.version ?? sub.version} freigeben?`,
      body: [
        h('p', { text: 'Die Seite signiert jetzt mit deinem Schlüssel genau das Manifest unten. Danach steht das Addon sofort im Store – auf der Webseite, im Launcher und im Spiel – als Community-Addon.' }),
        m
          ? h(
              'dl',
              { class: 'facts-list sign-facts' },
              fact('Addon', `${m.name} (${m.id})`),
              fact('Version', String(m.version)),
              fact('Entwickler', String(m.author?.name ?? '–')),
              fact('Datei', h('code', { class: 'mono', text: String(m.file) })),
              fact('SHA-256', h('code', { class: 'mono hash-full', text: String(m.sha256) })),
            )
          : null,
        h('ul', { class: 'check-list' }, checks.map(([kind, text]) => h('li', { class: kind }, icon(kind === 'ok' ? 'check' : 'close'), h('span', { text })))),
        h('details', { class: 'manifest-text' }, h('summary', null, 'Signierter Text', icon('chevron-down')), h('pre', { class: 'code', tabindex: '0' }, h('code', { text: `heldix-addon\n${selected.manifest}` }))),
        failed ? h('p', { class: 'form-error', text: 'Rot markierte Punkte: So wird nichts signiert.' }) : null,
      ],
      confirmLabel: 'Signieren und freigeben',
      canConfirm: () => !failed && Boolean(signingKeyInfo()),
      onConfirm: async () => {
        const signature = await signAddonManifest(selected.manifest, publicPem);
        await teamCall('POST', `/v1/team/addon-submissions/${encodeURIComponent(sub.id)}/approve`, { signature });
      },
    });
    if (!ok) return;
    toast(`${sub.name} ${sub.version} ist freigegeben und steht im Store.`, 'success');
    state.published = null;
    await Promise.all([loadSubmissions(), loadTeamAddons().catch(() => {})]).catch(showError);
    openSubmission(sub.id, { quiet: true }).catch(() => {});
  }

  async function reject() {
    const sub = state.selected?.submission;
    if (!sub) return;
    const noteId = uid('begruendung');
    const counter = h('span', { class: 'counter' });
    const note = h('textarea', { class: 'input textarea small-textarea', id: noteId, maxlength: String(MAX_REJECT), rows: '5', placeholder: 'Was muss sich ändern? Der Spieler sieht diesen Text in seinem Konto.' });
    bindCounter(note, counter, MAX_REJECT);
    const ok = await openDialog({
      title: `${sub.name || sub.addonId} ${sub.version} ablehnen?`,
      body: [
        h('p', { text: `${sub.submitter.name} sieht die Begründung unter Konto → Meine Addons und kann nachbessern und erneut einreichen.` }),
        h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { for: noteId, text: 'Begründung' }), counter), note),
      ],
      confirmLabel: 'Ablehnen',
      danger: true,
      canConfirm: () => note.value.trim().length > 0 && [...note.value.trim()].length <= MAX_REJECT,
      onConfirm: () => teamCall('POST', `/v1/team/addon-submissions/${encodeURIComponent(sub.id)}/reject`, { note: note.value.replace(/\r\n?/g, '\n').trim() }),
    });
    if (!ok) return;
    toast(`Abgelehnt. ${sub.submitter.name} sieht die Begründung im Konto.`, 'success');
    await loadSubmissions().catch(showError);
    openSubmission(sub.id, { quiet: true }).catch(() => {});
  }

  onSigningKeyChange(() => renderKeyBox());

  // -------------------------------------------------------------------------------------------------------
  // Addon-Meldungen
  // -------------------------------------------------------------------------------------------------------

  async function loadReports() {
    const box = $('addon-meldungen');
    if (!box.firstChild || box.dataset.filter !== state.reportFilter) {
      box.dataset.signature = '';
      box.replaceChildren(loadingState());
    }
    box.dataset.filter = state.reportFilter;
    const filter = state.reportFilter;
    const data = await softCall('GET', `/v1/team/addon-reports?status=${filter}`);
    if (data === null) {
      hideReports();
      return;
    }
    if (filter !== state.reportFilter) return;
    state.reports = Array.isArray(data?.reports)
      ? data.reports.filter((report) => report && (typeof report.id === 'number' || typeof report.id === 'string')).map(normalizeReport)
      : [];
    if (filter === 'open') {
      counts.reports = state.reports.length;
      renderCounts();
    }
    renderReports();
  }

  // Der Dienst liefert das Addon verschachtelt: { addon: { id, name, exists, hidden, official, owner } }
  function normalizeReport(report) {
    const nested = report.addon && typeof report.addon === 'object' ? report.addon : null;
    if (!nested) return report;
    return {
      ...report,
      addonId: report.addonId ?? nested.id,
      addonName: report.addonName ?? nested.name,
      hidden: typeof report.hidden === 'boolean' ? report.hidden : nested.exists === false ? null : Boolean(nested.hidden),
    };
  }

  function addonState(report) {
    const team = getTeamAddons()?.addons.find((addon) => addon.id === report.addonId);
    return { name: report.addonName || team?.name || report.addonId, hidden: typeof report.hidden === 'boolean' ? report.hidden : Boolean(team?.hidden), exists: report.hidden !== null };
  }

  function renderReports() {
    rerender($('addon-meldungen'), JSON.stringify([state.reports, getTeamAddons()?.addons.map((addon) => [addon.id, addon.hidden])]), () => {
      if (!state.reports.length) return emptyState(state.reportFilter === 'open' ? 'Keine offenen Addon-Meldungen.' : 'Keine Addon-Meldungen in den letzten 90 Tagen.', 'check');
      return state.reports.map(reportCard);
    });
  }

  function reportCard(report) {
    const done = report.status === 'done';
    const addon = addonState(report);
    const reporter = report.reporter ?? {};
    return h(
      'article',
      { class: 'app-card report addon-report', id: `addon-meldung-${report.id}`, dataset: { id: String(report.id), addon: String(report.addonId ?? '') } },
      h(
        'div',
        { class: 'report-head' },
        h('h2', { class: 'report-id', text: `Addon-Meldung #${report.id}` }),
        chip(done ? 'Erledigt' : 'Offen', done ? 'success' : 'warning'),
        chip(addonReasonLabel(report.reason), report.reason === 'malware' ? 'danger' : ''),
        addon.hidden ? chip('Addon ausgeblendet', 'warning') : null,
        h('span', { class: 'report-time' }, timeEl(report.at, formatDateTime(report.at))),
      ),
      h(
        'p',
        { class: 'report-who' },
        h('span', { class: 'player-inline' }, avatar(reporter.name, reporter.uuid, { size: 'xs' }), reporter.uuid ? h('button', { type: 'button', class: 'link-button', onClick: () => openPlayer(reporter.uuid) }, reporter.name ?? '?') : h('span', { text: reporter.name ?? '?' })),
        ' hat ',
        addon.hidden ? h('strong', { text: addon.name }) : h('a', { href: `/addons#${encodeURIComponent(report.addonId)}`, target: '_blank', rel: 'noopener', text: addon.name }),
        h('code', { class: 'mono muted', text: ` (${report.addonId})` }),
        ' gemeldet.',
      ),
      report.note ? h('blockquote', { class: 'quote' }, h('span', { class: 'quote-label', text: 'Hinweis: ' }), report.note) : h('p', { class: 'muted small', text: 'Kein Hinweis angegeben.' }),
      done ? h('p', { class: 'muted small', text: `Erledigt ${report.doneAt ? `am ${formatDateTime(report.doneAt)}` : ''}${report.doneBy ? ` von ${report.doneBy}` : ''}.` }) : null,
      h(
        'div',
        { class: 'card-actions' },
        done ? null : h('button', { type: 'button', class: 'button tiny', onClick: (event) => markDone(event.currentTarget, report) }, icon('check'), 'Erledigt'),
        isAdmin() && !addon.hidden && addon.exists ? h('button', { type: 'button', class: 'button tiny ghost danger-text', onClick: () => hideFromReport(report, addon) }, icon('eye-off'), 'Ausblenden …') : null,
        !isAdmin() && !addon.hidden ? h('span', { class: 'hint', text: 'Aus dem Store nehmen können Admins.' }) : null,
      ),
    );
  }

  async function markDone(button, report, { quiet = false } = {}) {
    try {
      await busy(button, () => teamCall('POST', `/v1/team/addon-reports/${encodeURIComponent(report.id)}/done`));
      if (!quiet) toast(`Addon-Meldung #${report.id} ist erledigt.`, 'success');
      await loadReports();
      $('addon-meldungen-filter').querySelector('[aria-pressed="true"]')?.focus();
    } catch (error) {
      showError(error);
    }
  }

  async function hideFromReport(report, addon) {
    const done = report.status !== 'done' ? h('input', { type: 'checkbox', checked: true }) : null;
    const ok = await openDialog({
      title: `${addon.name} aus dem Store nehmen?`,
      body: [
        h('p', { text: 'Das Addon verschwindet aus dem Store auf der Webseite, im Launcher und im Spiel. Wer es installiert hat, behält es. Wieder einblenden geht unter „Veröffentlicht“.' }),
        done ? h('label', { class: 'check-row' }, done, h('span', { text: `Meldung #${report.id} gleich als erledigt markieren` })) : null,
      ],
      confirmLabel: 'Aus dem Store nehmen',
      danger: true,
      onConfirm: async () => {
        await setAddonHidden(report.addonId, true);
        if (done?.checked) await teamCall('POST', `/v1/team/addon-reports/${encodeURIComponent(report.id)}/done`);
      },
    });
    if (!ok) return;
    toast(`${addon.name} steht nicht mehr im Store.`, 'success');
    state.published = null;
    await loadReports().catch(showError);
  }

  // -------------------------------------------------------------------------------------------------------
  // Verdrahten
  // -------------------------------------------------------------------------------------------------------

  $('einreichungen-filter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button || button.dataset.status === state.filter) return;
    state.filter = button.dataset.status;
    for (const other of $('einreichungen-filter').querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
    loadSubmissions().catch(showError);
  });
  $('einreichungen-neu').addEventListener('click', (event) => busy(event.currentTarget, () => Promise.all([loadSubmissions(), refreshCounts()])).catch(showError));
  $('addon-meldungen-filter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-status]');
    if (!button || button.dataset.status === state.reportFilter) return;
    state.reportFilter = button.dataset.status;
    for (const other of $('addon-meldungen-filter').querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
    loadReports().catch(showError);
  });
  $('addon-meldungen-neu').addEventListener('click', (event) => busy(event.currentTarget, () => loadReports()).catch(showError));

  return {
    /** Reiter „Addons“ geöffnet: Unterreiter wählen und laden. */
    show() {
      if (!subtabs.has(state.sub)) state.sub = 'einreichungen';
      subtabs.select(state.sub);
      refreshCounts().catch(() => {});
    },
    refreshCounts,
    /** Nach dem Laden von GET /v1/team/addons (publicKey, ausgeblendete Addons). */
    teamAddonsChanged() {
      renderKeyBox();
      if (state.sub === 'meldungen') renderReports();
      if (state.selected) renderList();
    },
    /** Beim Verlassen des Team-Bereichs (Abmelden, Sitzung abgelaufen). */
    reset() {
      forgetSigningKey();
      state.selected = null;
      state.checklist = new Set();
    },
  };
}
