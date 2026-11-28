// HeldixClient – Webseite: Team-Bereich → „Voice“ (Heldix-Dienst ab 1.13.0, Voice-Moderation).
//
// Recht voice:moderate (Admin, Moderator, Supporter): Voice-Meldungen je Spieler gebündelt oder einzeln, eine Meldung
// mit Grund, Meldendem samt Verlässlichkeit, Kontext (Server bzw. Welt, Dimension, wer in Hörweite war), Lautstärke-
// Verlauf als Kurve und – falls vorhanden – der Aufnahme (erst beim Klick auf „Anhören“ geladen, jedes Abspielen steht
// im Protokoll), Abschließen mit Ergebnis, Voice-Sperren (1 Std., 24 Std., 7 Tage, dauerhaft; Grund Pflicht), Spieler-
// Zeitleiste, Liste „Voice aus“ und Voice-Regeln ansehen. Recht voice:admin (Admin): Voice-Regeln veröffentlichen und
// zurückziehen, Schalter „Aufnahmen beim Melden“, Liste „Voice aus“ ändern.
// Routen: GET /v1/team/voice, …/reports, …/reports/<id>, …/reports/<id>/done, …/clips/<id>, …/bans[/<uuid>],
// …/players/<uuid>, …/servers[/<domain>], …/rules, …/rules/versions, …/settings (voice-1.13-fertig.md).
// Ohne innerHTML; Texte vom Dienst landen nur als Text im Dokument.
import { avatar, busy, confirmAction, emptyState, formatBytes, formatDate, formatDateTime, h, icon, loadingState, normalizeUuid, openDialog, showError, timeEl, toast, uid } from './app-common.js';
import { parseRules, renderRules } from './voice-regeln.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DURATIONS = [
  ['1h', '1 Stunde'],
  ['24h', '24 Stunden'],
  ['7d', '7 Tage'],
  ['permanent', 'Dauerhaft'],
];
const OUTCOMES = [
  ['justified', 'Berechtigt'],
  ['unjustified', 'Unberechtigt'],
  ['unclear', 'Unklar'],
];
const DEFAULT_REASONS = { insult: 'Beleidigung', harassment: 'Belästigung', hate: 'Hassrede', noise: 'Anschreien/Lärm', other: 'Sonstiges' };
const DIMENSIONS = { 'minecraft:overworld': 'Oberwelt', 'minecraft:the_nether': 'Nether', 'minecraft:the_end': 'Ende' };

/** Inhalt ersetzen; null, undefined und false fallen weg. */
const fill = (element, ...nodes) => element.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined && node !== false));
const outcomeLabel = (outcome) => OUTCOMES.find(([id]) => id === outcome)?.[1] ?? null;
const durationText = (ban) => (!ban ? '' : ban.permanent || ban.until === null ? 'dauerhaft' : `bis ${formatDateTime(ban.until)}`);
const dimensionText = (value) => DIMENSIONS[value] ?? (typeof value === 'string' ? value.replace(/^minecraft:/, '') : '–');
const percent = (share) => (Number.isFinite(share) ? `${Math.round(share * 100)} %` : null);

/** Verlässlichkeit eines Meldenden: „3 von 4 berechtigt (75 %)“, „neu“ ohne abgeschlossene Meldungen. */
export function reliabilityText(reliability, guest = false) {
  if (guest) return 'Gast im Browser';
  if (!reliability) return 'neu – noch keine abgeschlossene Meldung';
  const total = (reliability.justified ?? 0) + (reliability.unjustified ?? 0) + (reliability.unclear ?? 0);
  if (!total) return 'neu – noch keine abgeschlossene Meldung';
  return `${reliability.justified ?? 0} von ${total} berechtigt${percent(reliability.share) ? ` (${percent(reliability.share)})` : ''}`;
}

/**
 * Lautstärke-Verlauf als SVG: rms (Fläche) und peak (Linie) je Sekunde, −100…0 dBFS, null = Lücke; Linien bei −18
 * (weiche Begrenzung) und −3 dBFS (harte Grenze). x-Achse aus end/step.
 */
export function levelChart(levels) {
  const rms = Array.isArray(levels?.rms) ? levels.rms : [];
  const peak = Array.isArray(levels?.peak) ? levels.peak : [];
  const count = Math.max(rms.length, peak.length);
  if (!count) return null;
  const width = 600;
  const height = 150;
  const pad = { left: 34, right: 8, top: 8, bottom: 20 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const x = (index) => pad.left + (count <= 1 ? plotW : (index / (count - 1)) * plotW);
  const y = (db) => pad.top + (Math.min(0, Math.max(-100, db)) / -100) * plotH;
  const el = (tag, attrs = {}, text = null) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== null) node.textContent = text;
    return node;
  };
  const svg = el('svg', { class: 'voice-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Lautstärke der letzten ${count} Sekunden vor der Meldung` });
  for (const db of [0, -18, -3, -50, -100]) {
    const line = el('line', { x1: pad.left, x2: width - pad.right, y1: y(db), y2: y(db), class: db === -18 ? 'voice-chart__soft' : db === -3 ? 'voice-chart__hard' : 'voice-chart__grid' });
    svg.append(line);
    if (db !== -3) svg.append(el('text', { x: pad.left - 4, y: y(db) + 3, class: 'voice-chart__label', 'text-anchor': 'end' }, `${db}`));
  }
  svg.append(el('text', { x: width - pad.right, y: y(-3) - 3, class: 'voice-chart__label voice-chart__label--hard', 'text-anchor': 'end' }, '−3 dBFS'));
  svg.append(el('text', { x: width - pad.right, y: y(-18) - 3, class: 'voice-chart__label voice-chart__label--soft', 'text-anchor': 'end' }, '−18 dBFS'));
  // Zusammenhängende Stücke (null = Lücke)
  const runs = (values) => {
    const out = [];
    let run = [];
    values.forEach((value, index) => {
      if (typeof value === 'number' && Number.isFinite(value)) run.push([index, value]);
      else if (run.length) {
        out.push(run);
        run = [];
      }
    });
    if (run.length) out.push(run);
    return out;
  };
  for (const run of runs(rms)) {
    const top = run.map(([index, value]) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    const bottom = `${x(run.at(-1)[0]).toFixed(1)},${y(-100).toFixed(1)} ${x(run[0][0]).toFixed(1)},${y(-100).toFixed(1)}`;
    svg.append(el('polygon', { points: `${top} ${bottom}`, class: 'voice-chart__rms' }));
  }
  for (const run of runs(peak)) svg.append(el(run.length > 1 ? 'polyline' : 'circle', run.length > 1 ? { points: run.map(([index, value]) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' '), class: 'voice-chart__peak' } : { cx: x(run[0][0]), cy: y(run[0][1]), r: 2, class: 'voice-chart__dot' }));
  // Zeitachse: Anfang und Ende
  const end = Number(levels.end) || Date.now();
  const step = Number(levels.step) || 1000;
  const start = end - (count - 1) * step;
  const clock = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  svg.append(el('text', { x: pad.left, y: height - 4, class: 'voice-chart__label' }, clock(start)));
  svg.append(el('text', { x: width - pad.right, y: height - 4, class: 'voice-chart__label', 'text-anchor': 'end' }, clock(end)));
  return h(
    'figure',
    { class: 'voice-chart-box' },
    // Auf schmalen Bildschirmen wird das Diagramm nicht winzig, sondern innerhalb der Karte waagerecht scrollbar
    h('div', { class: 'voice-chart-scroll', tabindex: '0', 'aria-label': 'Lautstärke-Verlauf' }, svg),
    h('figcaption', { class: 'tiny text-3' }, h('span', { class: 'voice-legend voice-legend--rms' }), 'Lautstärke (RMS) ', h('span', { class: 'voice-legend voice-legend--peak' }), 'Spitzen · je Sekunde, gemessen beim Meldenden vor dem Lautstärke-Schutz; Lücke = nichts gehört'),
  );
}

/** Vorschau im Regelformat: Titel (erste Überschrift) als h3, Abschnitte als h4. */
function rulesPreview(text) {
  const parsed = parseRules(text);
  return [parsed.title ? h('h3', { class: 'voice-rules-title', text: parsed.title }) : null, ...renderRules(parsed, { level: 4 }).nodes];
}

export function initTeamVoice({ teamCall, can, shell, openPlayer }) {
  const $ = (id) => document.getElementById(id);
  const state = { overview: null, reports: null, status: 'open', view: 'spieler', bans: null, servers: null, versions: null, open: null, player: null };
  const reasons = () => state.reports?.reasons ?? state.overview?.reasons ?? DEFAULT_REASONS;
  const admin = () => can('voice:admin');

  const playerLink = (player, onOpen = null) =>
    player?.uuid && /^[0-9a-f]{32}$/.test(player.uuid)
      ? h('button', { type: 'button', class: 'link-button', onClick: () => (onOpen ? onOpen(player.uuid) : showPlayer(player.uuid)) }, player.name || player.uuid)
      : h('span', { text: player?.name ?? 'Unbekannt' });

  // -------------------------------------------------------------------------------------------------------
  // Aufbau
  // -------------------------------------------------------------------------------------------------------

  function build() {
    const box = $('team-voice');
    if (box.dataset.built) return;
    box.dataset.built = '1';
    const tabs = h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': 'Voice: Ansicht', id: 'voice-ansicht' },
      [
        ['meldungen', 'Meldungen'],
        ['sperren', 'Sperren'],
        ['regeln', 'Regeln & Aufnahmen'],
        ['server', 'Voice aus'],
      ].map(([id, label]) => h('button', { type: 'button', dataset: { ansicht: id }, 'aria-pressed': String(id === 'meldungen') }, label)),
    );
    tabs.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-ansicht]');
      if (button) showSub(button.dataset.ansicht);
    });
    fill(
      box,
      h('div', { class: 'voice-stats', id: 'voice-zahlen' }),
      h('div', { class: 'toolbar' }, tabs, h('button', { type: 'button', class: 'button tiny ghost', id: 'voice-neu', onClick: (event) => busy(event.currentTarget, () => reload()).catch(showError) }, icon('refresh'), 'Aktualisieren')),
      h('div', { id: 'voice-sub-meldungen', class: 'stack' }),
      h('div', { id: 'voice-sub-sperren', class: 'stack', hidden: true }),
      h('div', { id: 'voice-sub-regeln', class: 'stack', hidden: true }),
      h('div', { id: 'voice-sub-server', class: 'stack', hidden: true }),
      h('div', { id: 'voice-sub-spieler', class: 'stack', hidden: true }),
    );
  }

  function showSub(name) {
    for (const button of $('voice-ansicht').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.ansicht === name));
    for (const id of ['meldungen', 'sperren', 'regeln', 'server', 'spieler']) $(`voice-sub-${id}`).hidden = id !== name;
    state.sub = name;
    const run = { meldungen: loadReports, sperren: loadBans, regeln: loadRules, server: loadServers }[name];
    if (run) run().catch(showError);
  }

  async function reload() {
    await loadOverview();
    if (state.sub === 'spieler' && state.player) return showPlayer(state.player.player.uuid);
    showSub(state.sub ?? 'meldungen');
  }

  /** Bereich gewählt; params: spieler=<uuid> oder meldung=<id> aus der Adresse. */
  async function show(params = null) {
    build();
    await loadOverview();
    const player = normalizeUuid(params?.spieler ?? '');
    const report = /^\d{1,9}$/.test(String(params?.meldung ?? '')) ? Number(params.meldung) : null;
    if (player) return showPlayer(player);
    showSub('meldungen');
    if (report !== null) openReport(report);
  }

  async function loadOverview() {
    try {
      state.overview = await teamCall('GET', '/v1/team/voice');
    } catch (error) {
      if (error.handled) return;
      fill($('voice-zahlen'), h('p', { class: 'hint', text: error.status === 404 ? 'Die Voice-Moderation gibt es mit dem Heldix-Dienst ab Version 1.13.0.' : error.message }));
      return;
    }
    const stats = state.overview?.stats ?? {};
    const clips = state.overview?.clips ?? {};
    const published = state.overview?.rules?.published;
    shell.setBadge('voice', stats.openReports ?? 0, { label: `${stats.openReports ?? 0} offene Voice-Meldungen` });
    // Zahlen groß, Zustände (Text) kleiner – sonst bricht „nicht veröffentlicht“ mitten im Wort um
    const tile = (id, label, value, text) =>
      h(
        'div',
        { class: 'kpi voice-kpi', dataset: { kpi: id } },
        h('span', { class: 'kpi__label', text: label }),
        h('strong', { class: typeof value === 'string' ? 'kpi__value kpi__value--text' : 'kpi__value', text: String(value ?? '–') }),
        text ? h('span', { class: 'kpi__trend', text }) : null,
      );
    const clip = clipState(clips);
    fill(
      $('voice-zahlen'),
      tile('meldungen', 'Offene Voice-Meldungen', stats.openReports, null),
      tile('sperren', 'Aktive Voice-Sperren', stats.activeBans, null),
      tile('verbunden', 'Im Voice verbunden', stats.connected, null),
      tile('regeln', 'Voice-Regeln', published ? `Version ${published.version}` : 'nicht veröffentlicht', published ? `seit ${formatDate(published.at)}` : 'keine Pflicht, keine Aufnahmen'),
      tile('aufnahmen', 'Aufnahmen beim Melden', clip.value, clip.text),
    );
  }

  function clipState(clips) {
    if (clips?.allowed === false) return { value: 'hart aus', text: 'vom Betreiber abgeschaltet' };
    if (clips?.active) return { value: 'aktiv', text: null };
    if (clips?.enabled && !clips?.rulesPublished) return { value: 'aus', text: 'eingeschaltet, aber Voice-Regeln nicht veröffentlicht' };
    return { value: 'aus', text: null };
  }

  function clipText(clips) {
    const { value, text } = clipState(clips);
    return text ? `${value} – ${text}` : value;
  }

  // -------------------------------------------------------------------------------------------------------
  // Meldungen
  // -------------------------------------------------------------------------------------------------------

  async function loadReports() {
    const box = $('voice-sub-meldungen');
    if (!state.reports) fill(box, loadingState('Voice-Meldungen werden geladen …'));
    state.reports = await teamCall('GET', `/v1/team/voice/reports?status=${state.status}`);
    renderReports();
  }

  function renderReports() {
    const box = $('voice-sub-meldungen');
    const data = state.reports ?? {};
    const reports = Array.isArray(data.reports) ? data.reports : [];
    const players = Array.isArray(data.players) ? data.players : [];
    const filter = h(
      'div',
      { class: 'segmented segmented--sm', role: 'group', 'aria-label': 'Voice-Meldungen filtern', id: 'voice-filter' },
      [
        ['open', 'Offen'],
        ['done', 'Erledigt'],
        ['all', 'Alle'],
      ].map(([status, label]) => h('button', { type: 'button', dataset: { status }, 'aria-pressed': String(status === state.status), onClick: () => { state.status = status; loadReports().catch(showError); } }, label)),
    );
    const view = h(
      'div',
      { class: 'segmented segmented--sm', role: 'group', 'aria-label': 'Darstellung', id: 'voice-darstellung' },
      [
        ['spieler', 'Je Spieler'],
        ['einzeln', 'Einzeln'],
      ].map(([id, label]) => h('button', { type: 'button', dataset: { darstellung: id }, 'aria-pressed': String(id === state.view), onClick: () => { state.view = id; renderReports(); } }, label)),
    );
    const list =
      state.view === 'spieler'
        ? players.length
          ? h('ul', { class: 'rows', id: 'voice-buendel' }, players.map(bundleRow))
          : emptyState(state.status === 'open' ? 'Keine offenen Voice-Meldungen.' : 'Keine Voice-Meldungen.', 'mic')
        : reports.length
          ? h('ul', { class: 'rows', id: 'voice-meldungen' }, reports.map(reportRow))
          : emptyState(state.status === 'open' ? 'Keine offenen Voice-Meldungen.' : 'Keine Voice-Meldungen.', 'mic');
    fill(
      box,
      h(
        'section',
        { class: 'app-card', 'aria-labelledby': 'voice-meldungen-titel' },
        h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'voice-meldungen-titel', text: 'Voice-Meldungen' }), h('p', { class: 'muted small', text: 'Je Spieler gebündelt: wie oft, von wie vielen verschiedenen Meldenden und in welchem Zeitraum. Erst die einzelne Meldung zeigt Kontext, Lautstärke-Verlauf und – falls vorhanden – die Aufnahme.' })), h('div', { class: 'btn-group voice-head-side' }, view, filter)),
        list,
      ),
      h('div', { id: 'voice-meldung', class: 'voice-detail-slot' }),
    );
    if (state.open !== null) openReport(state.open, { scroll: false });
  }

  function reasonChips(counts) {
    return Object.entries(counts ?? {}).map(([reason, count]) => h('span', { class: 'chip chip--xs', text: `${reasons()[reason] ?? reason}${count > 1 ? ` × ${count}` : ''}` }));
  }

  function bundleRow(bundle) {
    const ban = bundle.voiceBan;
    return h(
      'li',
      { class: 'row voice-bundle', dataset: { uuid: bundle.reported?.uuid ?? '' } },
      avatar(bundle.reported?.name, bundle.reported?.uuid, { size: 'sm' }),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, playerLink(bundle.reported), bundle.open ? h('span', { class: 'chip chip--xs chip--danger', text: `${bundle.open} offen` }) : null, ban?.active !== false && ban ? h('span', { class: 'chip chip--xs', text: `Voice gesperrt ${durationText(ban)}` }) : null),
        h('div', { class: 'row-sub', text: `${bundle.reports} ${bundle.reports === 1 ? 'Meldung' : 'Meldungen'} von ${bundle.reporters} ${bundle.reporters === 1 ? 'Meldendem' : 'verschiedenen Meldenden'} · ${bundle.first === bundle.last ? formatDateTime(bundle.last) : `${formatDate(bundle.first)} bis ${formatDateTime(bundle.last)}`}` }),
        h('div', { class: 'chips-row' }, reasonChips(bundle.reasons)),
      ),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'meldungen-zeigen' }, onClick: () => { state.view = 'einzeln'; renderReports(); } }, 'Meldungen'),
        h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'zeitleiste' }, onClick: () => showPlayer(bundle.reported.uuid) }, icon('clock'), 'Zeitleiste'),
        !ban ? h('button', { type: 'button', class: 'button tiny ghost danger-text', dataset: { aktion: 'sperren' }, onClick: () => banDialog(bundle.reported, { reports: bundle.ids ?? [] }) }, icon('ban'), 'Sperren …') : null,
      ),
    );
  }

  function reportRow(report) {
    return h(
      'li',
      { class: `row voice-report-row${state.open === report.id ? ' is-open' : ''}`, dataset: { meldung: String(report.id) } },
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon(report.clip ? 'volume-2' : 'flag')),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('button', { type: 'button', class: 'link-button', dataset: { aktion: 'oeffnen' }, onClick: () => openReport(report.id) }, `Voice-Meldung #${report.id}`), h('span', { class: 'chip chip--xs chip--danger', text: report.reasonLabel ?? reasons()[report.reason] ?? report.reason }), report.status === 'done' ? h('span', { class: 'chip chip--xs chip--online', text: `erledigt${report.outcome ? ` · ${outcomeLabel(report.outcome)}` : ''}` }) : null, report.clip ? h('span', { class: 'chip chip--xs chip--voice', text: 'mit Aufnahme' }) : null),
        h('div', { class: 'row-sub' }, playerLink(report.reporter), report.reporter?.guest ? ' (Gast)' : '', ' meldet ', playerLink(report.reported), ` · ${formatDateTime(report.at)}`),
      ),
    );
  }

  async function openReport(id, { scroll = true } = {}) {
    state.open = id;
    const slot = $('voice-meldung');
    if (!slot) return;
    for (const row of document.querySelectorAll('#voice-meldungen .row')) row.classList.toggle('is-open', row.dataset.meldung === String(id));
    fill(slot, loadingState('Meldung wird geladen …'));
    let report;
    try {
      report = (await teamCall('GET', `/v1/team/voice/reports/${id}`))?.report;
    } catch (error) {
      if (!error.handled) fill(slot, emptyState(error.message, 'warning'));
      return;
    }
    if (!report || state.open !== id) return;
    fill(slot, reportDetail(report));
    if (scroll) slot.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function contextBlock(report) {
    const service = report.context?.service ?? null;
    const client = report.context?.client ?? null;
    if (!service && !client) return h('p', { class: 'muted small', text: 'Kein Kontext übermittelt.' });
    const nearby = (list) => (Array.isArray(list) && list.length ? list.map((entry) => `${entry.name ?? 'Unbekannt'}${entry.guest ? ' (Gast)' : ''}`).join(', ') : 'niemand');
    const facts = (ctx, title) =>
      h(
        'div',
        { class: 'voice-context' },
        h('h4', { class: 'h4', text: title }),
        h(
          'dl',
          { class: 'facts-list' },
          h('dt', { text: ctx.world ? 'Welt' : 'Server' }),
          h('dd', { text: ctx.world ? `${ctx.world.name} (${ctx.world.code})` : ctx.server ?? '–' }),
          h('dt', { text: 'Dimension' }),
          h('dd', { text: dimensionText(ctx.dimension) }),
          h('dt', { text: 'Gruppe' }),
          h('dd', { text: ctx.group ? 'ja' : 'nein' }),
          h('dt', { text: 'In Hörweite' }),
          h('dd', { text: nearby(ctx.nearby) }),
          'reportedPresent' in ctx ? [h('dt', { text: 'Gemeldeter dabei' }), h('dd', { text: ctx.reportedPresent ? 'ja (laut Dienst)' : 'nein (laut Dienst)' })] : null,
          ctx.at ? [h('dt', { text: 'Zeitpunkt' }), h('dd', { text: formatDateTime(ctx.at) })] : null,
        ),
      );
    return h('div', { class: 'voice-contexts' }, service ? facts(service, 'Kontext laut Dienst') : null, client ? facts(client, 'Kontext laut Meldendem') : null);
  }

  function clipBlock(report) {
    const clip = report.clip;
    if (!clip) return h('p', { class: 'muted small', id: 'voice-keine-aufnahme', text: report.reporter?.guest ? 'Keine Aufnahme: Gäste im Browser nehmen nichts auf.' : 'Keine Aufnahme (Aufnahmen waren aus oder der Meldende hat keine geschickt).' });
    const audio = h('audio', { class: 'voice-audio', controls: true, preload: 'none', hidden: true, 'aria-label': `Aufnahme zu Meldung #${report.id}` });
    const play = h('button', { type: 'button', class: 'button small', id: 'voice-anhoeren', dataset: { aktion: 'anhoeren' } }, icon('play'), 'Anhören');
    play.addEventListener('click', () => {
      // Erst jetzt laden: jeder Abruf steht im Protokoll (voice.clip.play)
      const url = typeof clip.url === 'string' && /^\/v1\/team\/voice\/clips\/\d+$/.test(clip.url) ? clip.url : `/v1/team/voice/clips/${report.id}`;
      audio.src = `/api${url}`;
      audio.hidden = false;
      play.disabled = true;
      audio.play().catch(() => {});
    });
    const remove = h('button', { type: 'button', class: 'button small ghost danger-text', dataset: { aktion: 'aufnahme-loeschen' } }, icon('trash'), 'Aufnahme löschen');
    remove.addEventListener('click', async () => {
      const ok = await confirmAction({ title: 'Aufnahme löschen?', text: 'Die Aufnahme ist danach weg. Die Meldung, der Kontext und der Lautstärke-Verlauf bleiben.', confirmLabel: 'Löschen', danger: true });
      if (!ok) return;
      try {
        await busy(remove, () => teamCall('DELETE', `/v1/team/voice/clips/${report.id}`));
        toast('Aufnahme gelöscht.', 'success');
        openReport(report.id, { scroll: false });
        loadReports().catch(() => {});
      } catch (error) {
        showError(error);
      }
    });
    const segments = Array.isArray(clip.segments) ? clip.segments : [];
    return h(
      'div',
      { class: 'voice-clip', id: 'voice-aufnahme' },
      h('h4', { class: 'h4' }, icon('volume-2'), ' Aufnahme'),
      h('p', { class: 'small text-2', text: `${Math.round((clip.durationMs ?? 0) / 1000)} Sekunden · ${formatBytes(clip.size)} · ${segments.length} ${segments.length === 1 ? 'Satz' : 'Sätze'}${clip.start ? ` ab ${formatDateTime(clip.start)}` : ''} · wird ${clip.deleteAt ? `am ${formatDate(clip.deleteAt)}` : 'automatisch'} gelöscht` }),
      segments.length ? h('ol', { class: 'voice-segments' }, segments.slice(0, 30).map((segment) => h('li', { text: `${Math.round((segment.offset ?? 0) / 1000)} s in der Aufnahme · ${formatDateTime(segment.at)}` }))) : null,
      h('p', { class: 'notice-line notice-line--warn' }, icon('eye'), h('span', { text: 'Jedes Abspielen wird protokolliert (wer, wann). Nur anhören, wenn es für die Prüfung nötig ist.' })),
      h('div', { class: 'btn-group' }, play, remove),
      audio,
    );
  }

  function reportDetail(report) {
    const done = report.status === 'done';
    const outcome = h('select', { class: 'input select tiny-select', id: uid('voice-ergebnis'), 'aria-label': 'Ergebnis' }, OUTCOMES.map(([value, label]) => h('option', { value, selected: report.outcome === value || undefined }, label)));
    const finish = h('button', { type: 'button', class: 'button small', dataset: { aktion: 'abschliessen' } }, icon('check'), done ? 'Ergebnis ändern' : 'Abschließen');
    finish.addEventListener('click', async () => {
      try {
        await busy(finish, () => teamCall('POST', `/v1/team/voice/reports/${report.id}/done`, { outcome: outcome.value }));
        toast(`Voice-Meldung #${report.id}: ${outcomeLabel(outcome.value)}.`, 'success');
        await loadOverview();
        await loadReports();
      } catch (error) {
        showError(error);
      }
    });
    return h(
      'article',
      { class: 'app-card voice-report', id: `voice-meldung-${report.id}`, tabindex: '-1', dataset: { status: report.status } },
      h('div', { class: 'card-head' }, h('div', null, h('h2', { text: `Voice-Meldung #${report.id}` }), h('p', { class: 'muted small' }, timeEl(report.at, formatDateTime(report.at)))), h('div', { class: 'chips-row voice-head-side' }, h('span', { class: 'chip chip--danger', text: report.reasonLabel ?? reasons()[report.reason] ?? report.reason }), done ? h('span', { class: 'chip chip--online', text: `erledigt${report.outcome ? ` · ${outcomeLabel(report.outcome)}` : ''}${report.doneBy ? ` von ${report.doneBy}` : ''}` }) : h('span', { class: 'chip', text: 'offen' }))),
      h(
        'dl',
        { class: 'facts-list' },
        h('dt', { text: 'Gemeldet' }),
        h('dd', null, playerLink(report.reported), report.reported?.voiceBan ? h('span', { class: 'chip chip--xs', text: ` Voice gesperrt ${durationText(report.reported.voiceBan)}` }) : null, report.reported?.banned ? h('span', { class: 'chip chip--xs chip--danger', text: 'gesperrt' }) : null),
        h('dt', { text: 'Meldender' }),
        h('dd', null, report.reporter?.guest ? h('span', { text: report.reporter.name ?? 'Gast' }) : playerLink(report.reporter), h('span', { class: 'muted', id: 'voice-verlaesslichkeit', text: ` · ${reliabilityText(report.reporter?.reliability, report.reporter?.guest)}` })),
        h('dt', { text: 'Notiz' }),
        h('dd', { text: report.note || '–' }),
      ),
      contextBlock(report),
      h('div', { class: 'voice-levels', id: 'voice-verlauf' }, h('h4', { class: 'h4', text: 'Lautstärke-Verlauf' }), levelChart(report.levels) ?? h('p', { class: 'muted small', text: 'Kein Lautstärke-Verlauf übermittelt.' })),
      clipBlock(report),
      h(
        'div',
        { class: 'card-actions' },
        h('label', { class: 'voice-outcome' }, h('span', { class: 'small', text: 'Ergebnis' }), outcome),
        finish,
        report.reported?.uuid && !report.reported?.voiceBan ? h('button', { type: 'button', class: 'button small ghost danger-text', dataset: { aktion: 'sperren' }, onClick: () => banDialog(report.reported, { reports: [report.id] }) }, icon('ban'), 'Sperren …') : null,
        report.reported?.uuid ? h('button', { type: 'button', class: 'button small ghost', onClick: () => showPlayer(report.reported.uuid) }, icon('clock'), 'Zeitleiste') : null,
      ),
    );
  }

  // -------------------------------------------------------------------------------------------------------
  // Sperren
  // -------------------------------------------------------------------------------------------------------

  /** Sperr-Dialog: Dauer, Grund (Pflicht, wörtlich sichtbar), Meldungen als Begründung. */
  async function banDialog(player, { reports = [] } = {}) {
    let about = [];
    try {
      about = (await teamCall('GET', `/v1/team/voice/players/${player.uuid}`))?.reportsAbout ?? [];
    } catch (error) {
      if (error.handled) return false;
    }
    const ids = { duration: uid('voice-dauer'), reason: uid('voice-grund') };
    const duration = h('fieldset', { class: 'choice-cards voice-durations' }, h('legend', { class: 'field__label', text: 'Dauer' }), DURATIONS.map(([value, label], index) => h('label', { class: 'choice-card' }, h('input', { type: 'radio', name: ids.duration, value, checked: index === 1 || undefined }), h('span', null, h('strong', { text: label })))));
    const reason = h('input', { class: 'input', id: ids.reason, maxlength: '300', autocomplete: 'off', placeholder: 'z. B. Beleidigungen im Voice (Meldung #12)' });
    const picks = about.length
      ? h('fieldset', { class: 'pick-list' }, h('legend', { class: 'field__label', text: 'Meldungen als Begründung' }), about.map((report) => h('label', { class: 'pick-row' }, h('input', { type: 'checkbox', value: String(report.id), checked: reports.includes(report.id) || undefined }), h('span', { text: `#${report.id} · ${report.reasonLabel ?? reasons()[report.reason] ?? report.reason} · ${formatDateTime(report.at)}` }))))
      : null;
    let result = null;
    const ok = await openDialog({
      title: `${player.name ?? 'Spieler'} im Voice sperren`,
      body: [
        h('p', { class: 'small text-2', text: 'Wirkt sofort: Die Voice-Verbindung wird getrennt, Gast-Links des Spielers laden nicht mehr in den Voice Chat ein. Einspruch geht über den Support.' }),
        duration,
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.reason, text: 'Grund (Pflicht)' }), reason, h('p', { class: 'field__help', text: 'Der Spieler sieht den Grund wörtlich – sachlich bleiben.' })),
        picks,
      ],
      confirmLabel: 'Sperren',
      danger: true,
      canConfirm: () => reason.value.trim().length > 0 && [...reason.value.trim()].length <= 300,
      onConfirm: async () => {
        const chosen = picks ? [...picks.querySelectorAll('input:checked')].map((input) => Number(input.value)) : reports;
        result = await teamCall('PUT', `/v1/team/voice/bans/${player.uuid}`, { duration: duration.querySelector('input:checked')?.value ?? '24h', reason: reason.value.trim(), reports: chosen });
      },
    });
    if (!ok) return false;
    toast(`${player.name ?? 'Der Spieler'} ist im Voice gesperrt (${durationText(result?.ban) || 'gesetzt'}).`, 'success');
    await loadOverview();
    if (state.sub === 'spieler') await showPlayer(player.uuid);
    else if (state.sub === 'sperren') await loadBans();
    else await loadReports();
    return true;
  }

  async function liftBan(player, button) {
    const ok = await confirmAction({ title: `Voice-Sperre von ${player.name ?? 'Spieler'} aufheben?`, text: 'Der Spieler kann den Voice Chat sofort wieder nutzen.', confirmLabel: 'Aufheben' });
    if (!ok) return;
    try {
      await busy(button, () => teamCall('DELETE', `/v1/team/voice/bans/${player.uuid}`));
      toast(`Voice-Sperre von ${player.name ?? 'Spieler'} aufgehoben.`, 'success');
      await loadOverview();
      if (state.sub === 'spieler') await showPlayer(player.uuid);
      else await loadBans();
    } catch (error) {
      showError(error);
    }
  }

  async function loadBans() {
    const box = $('voice-sub-sperren');
    if (!state.bans) fill(box, loadingState());
    state.bans = await teamCall('GET', '/v1/team/voice/bans');
    const active = Array.isArray(state.bans?.bans) ? state.bans.bans : [];
    const recent = Array.isArray(state.bans?.recent) ? state.bans.recent : [];
    const banRow = (ban, withLift) =>
      h(
        'li',
        { class: 'row', dataset: { uuid: ban.uuid, sperre: String(ban.id) } },
        avatar(ban.name, ban.uuid, { size: 'sm' }),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, playerLink(ban), h('span', { class: `chip chip--xs${ban.active ? ' chip--danger' : ''}`, text: ban.active ? durationText(ban) : ban.liftedAt ? `aufgehoben${ban.liftedBy ? ` von ${ban.liftedBy}` : ''}` : 'abgelaufen' })), h('div', { class: 'row-sub', text: `„${ban.reason}“ · ${formatDateTime(ban.at)}${ban.by ? ` von ${ban.by}` : ''}${ban.reports?.length ? ` · Meldungen ${ban.reports.map((id) => `#${id}`).join(', ')}` : ''}` })),
        withLift && ban.active ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'aufheben' }, onClick: (event) => liftBan(ban, event.currentTarget) }, icon('check'), 'Aufheben')) : null,
      );
    fill(
      box,
      h('section', { class: 'app-card', 'aria-labelledby': 'voice-sperren-titel' }, h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'voice-sperren-titel', text: 'Aktive Voice-Sperren' }), h('p', { class: 'muted small', text: 'Gesperrte können den Voice Chat nicht nutzen – im Spiel und im Browser. Neu sperren geht aus einer Meldung oder der Zeitleiste eines Spielers.' }))), active.length ? h('ul', { class: 'rows', id: 'voice-sperren-liste' }, active.map((ban) => banRow(ban, true))) : emptyState('Gerade ist niemand im Voice gesperrt.', 'check')),
      h('section', { class: 'app-card', 'aria-labelledby': 'voice-verlauf-titel' }, h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'voice-verlauf-titel', text: 'Verlauf' }), h('p', { class: 'muted small', text: 'Die letzten 100 Voice-Sperren, auch aufgehobene und abgelaufene.' }))), recent.length ? h('ul', { class: 'rows', id: 'voice-sperren-verlauf' }, recent.map((ban) => banRow(ban, false))) : emptyState('Noch keine Voice-Sperren.', 'clock')),
    );
  }

  // -------------------------------------------------------------------------------------------------------
  // Spieler (Zeitleiste)
  // -------------------------------------------------------------------------------------------------------

  async function showPlayer(uuid) {
    build();
    for (const button of $('voice-ansicht').querySelectorAll('button')) button.setAttribute('aria-pressed', 'false');
    for (const id of ['meldungen', 'sperren', 'regeln', 'server']) $(`voice-sub-${id}`).hidden = true;
    const box = $('voice-sub-spieler');
    box.hidden = false;
    state.sub = 'spieler';
    fill(box, loadingState('Spieler wird geladen …'));
    let data;
    try {
      data = await teamCall('GET', `/v1/team/voice/players/${uuid}`);
    } catch (error) {
      if (!error.handled) fill(box, emptyState(error.message, 'warning'));
      return;
    }
    state.player = data;
    const player = data.player ?? { uuid, name: '?' };
    const ban = data.ban;
    const timeline = Array.isArray(data.timeline) ? [...data.timeline].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) : [];
    const entryText = (entry) => {
      if (entry.kind === 'report') return [`Gemeldet${entry.reporter?.name ? ` von ${entry.reporter.name}` : ''} · ${reasons()[entry.reason] ?? entry.reason}`, entry.status === 'done' ? `erledigt${entry.outcome ? ` · ${outcomeLabel(entry.outcome)}` : ''}` : 'offen'];
      if (entry.kind === 'ban') return [`Voice-Sperre ${entry.until ? `bis ${formatDateTime(entry.until)}` : 'dauerhaft'}${entry.by ? ` von ${entry.by}` : ''}`, entry.reason];
      if (entry.kind === 'unban') return [`Voice-Sperre aufgehoben${entry.by ? ` von ${entry.by}` : ''}`, null];
      if (entry.kind === 'consent') return [`Voice-Regeln Version ${entry.version} angenommen`, null];
      return [entry.kind, null];
    };
    const reportsBy = data.reportsBy ?? null;
    fill(
      box,
      h(
        'section',
        { class: 'app-card', id: 'voice-spieler', dataset: { uuid: player.uuid } },
        h('div', { class: 'detail-head' }, avatar(player.name, player.uuid, { size: 'lg' }), h('div', { class: 'detail-title' }, h('h2', { text: `Voice: ${player.name}` }), h('div', { class: 'chips-row voice-player-chips' }, ban ? h('span', { class: 'chip danger', text: `Voice gesperrt ${durationText(ban)}` }) : h('span', { class: 'chip', text: 'nicht im Voice gesperrt' }), data.consent ? h('span', { class: 'chip', text: `Regeln v${data.consent.version} angenommen` }) : h('span', { class: 'chip', text: 'Regeln nicht angenommen' })))),
        ban ? h('div', { class: 'ban-box' }, h('p', { class: 'ban-title' }, icon('ban'), h('strong', { text: 'Voice gesperrt' }), h('span', { class: 'muted', text: ` ${durationText(ban)} · seit ${formatDateTime(ban.at)}${ban.by ? ` von ${ban.by}` : ''}` })), h('blockquote', { class: 'quote', text: ban.reason }), h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'aufheben' }, onClick: (event) => liftBan(player, event.currentTarget) }, icon('check'), 'Sperre aufheben'))) : h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'button tiny ghost danger-text', dataset: { aktion: 'sperren' }, onClick: () => banDialog(player) }, icon('ban'), 'Im Voice sperren …')),
        h('dl', { class: 'facts-list' }, h('dt', { text: 'Als Meldender' }), h('dd', { text: reliabilityText(reportsBy && (reportsBy.justified || reportsBy.unjustified || reportsBy.unclear) ? reportsBy : null) }), h('dt', { text: 'Zustimmung' }), h('dd', { text: data.consent ? `Version ${data.consent.version} am ${formatDateTime(data.consent.at)}` : 'keine' }), h('dt', { text: 'Meldungen über ihn' }), h('dd', { text: String((data.reportsAbout ?? []).length) })),
        h('div', { class: 'card-actions' }, h('button', { type: 'button', class: 'button tiny ghost', onClick: () => openPlayer(player.uuid) }, icon('user'), 'Spieler-Details')),
        h('h3', { text: 'Voice-Zeitleiste' }),
        h(
          'ol',
          { class: 'timeline', id: 'voice-zeitleiste' },
          timeline.length
            ? timeline.map((entry) => {
                const [title, text] = entryText(entry);
                return h('li', { class: `timeline__item timeline__item--${entry.kind === 'ban' ? 'sperre' : entry.kind === 'report' ? 'meldung' : 'team'}`, dataset: { art: entry.kind } }, h('span', { class: 'timeline__icon', 'aria-hidden': 'true' }, icon(entry.kind === 'ban' ? 'ban' : entry.kind === 'report' ? 'flag' : entry.kind === 'consent' ? 'check' : 'shield')), h('div', null, entry.kind === 'report' && entry.id ? h('button', { type: 'button', class: 'link-button', onClick: () => { state.view = 'einzeln'; state.status = 'all'; state.open = entry.id; showSub('meldungen'); } }, title) : h('strong', { text: title }), text ? h('span', { class: 'timeline__text', text }) : null, entry.at ? h('span', null, timeEl(entry.at, formatDateTime(entry.at))) : null));
              })
            : [h('li', { class: 'timeline__empty', text: 'Im Voice ist noch nichts passiert.' })],
        ),
        Array.isArray(data.audit) && data.audit.length ? h('details', { class: 'snapshot' }, h('summary', null, `Protokoll (${data.audit.length})`), h('ul', { class: 'plain-list' }, data.audit.map((entry) => h('li', { text: `${formatDateTime(entry.at)} · ${entry.actor?.name ?? entry.actor ?? '?'} · ${entry.action}${entry.detail ? ` · ${entry.detail}` : ''}` })))) : null,
      ),
    );
  }

  /** Einträge für die allgemeine Spieler-Zeitleiste (team.js): Voice-Meldungen, -Sperren, Zustimmung. */
  async function timelineEvents(player) {
    if (!can('voice:moderate')) return [];
    let data;
    try {
      data = await teamCall('GET', `/v1/team/voice/players/${player.uuid}`);
    } catch {
      return [];
    }
    return (Array.isArray(data?.timeline) ? data.timeline : []).map((entry) => {
      if (entry.kind === 'report') return { at: entry.at, kind: 'meldung', icon: 'mic', title: `Voice-Meldung${entry.reporter?.name ? ` von ${entry.reporter.name}` : ''} · ${reasons()[entry.reason] ?? entry.reason}`, text: entry.status === 'done' ? 'erledigt' : 'offen', voice: { meldung: entry.id } };
      if (entry.kind === 'ban') return { at: entry.at, kind: 'sperre', icon: 'mic-off', title: `Voice-Sperre ${entry.until ? `bis ${formatDateTime(entry.until)}` : 'dauerhaft'}${entry.by ? ` von ${entry.by}` : ''}`, text: entry.reason, voice: { spieler: player.uuid } };
      if (entry.kind === 'unban') return { at: entry.at, kind: 'team', icon: 'mic', title: `Voice-Sperre aufgehoben${entry.by ? ` von ${entry.by}` : ''}`, voice: { spieler: player.uuid } };
      return { at: entry.at, kind: 'team', icon: 'check', title: `Voice-Regeln Version ${entry.version} angenommen` };
    });
  }

  // -------------------------------------------------------------------------------------------------------
  // Regeln und Aufnahmen
  // -------------------------------------------------------------------------------------------------------

  async function loadRules() {
    const box = $('voice-sub-regeln');
    fill(box, loadingState());
    const [overview, versions] = await Promise.all([teamCall('GET', '/v1/team/voice'), teamCall('GET', '/v1/team/voice/rules/versions').catch(() => ({ versions: [] }))]);
    state.overview = overview;
    state.versions = Array.isArray(versions?.versions) ? versions.versions : [];
    const rules = overview?.rules ?? {};
    const clips = overview?.clips ?? {};
    const published = rules.published ?? null;
    const max = Number(rules.maxLength) || 12000;
    const preview = h('div', { class: 'voice-rules-preview prose', id: 'voice-regeln-vorschau' });
    const paint = (text) => fill(preview, rulesPreview(text));
    const textId = uid('voice-regeln-text');
    const area = h('textarea', { class: 'input textarea voice-rules-input', id: textId, rows: '14', maxlength: String(max), value: rules.text ?? rules.defaultText ?? '', readonly: !admin() || undefined });
    const counter = h('span', { class: 'counter' });
    const update = () => {
      counter.textContent = `${[...area.value].length}/${max}`;
      paint(area.value);
    };
    area.addEventListener('input', update);
    const publishButton = h('button', { type: 'button', class: 'button small', id: 'voice-regeln-veroeffentlichen', dataset: { aktion: 'veroeffentlichen' } }, icon('check'), published ? 'Neue Version veröffentlichen …' : 'Veröffentlichen …');
    publishButton.addEventListener('click', () => publishRules(area.value, published));
    const withdraw = published ? h('button', { type: 'button', class: 'button small ghost danger-text', id: 'voice-regeln-zurueckziehen', dataset: { aktion: 'zurueckziehen' } }, icon('close'), 'Zurückziehen …') : null;
    withdraw?.addEventListener('click', () => withdrawRules(published));
    const defaultButton = h('button', { type: 'button', class: 'button small ghost', dataset: { aktion: 'standardtext' } }, icon('undo'), 'Standardtext');
    defaultButton.addEventListener('click', () => {
      area.value = rules.defaultText ?? '';
      update();
    });
    const toggle = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id: 'voice-aufnahmen', checked: clips.enabled || undefined, disabled: !admin() || clips.allowed === false || undefined });
    toggle.addEventListener('change', async () => {
      try {
        const data = await teamCall('PUT', '/v1/team/voice/settings', { clips: toggle.checked });
        if (state.overview) state.overview.clips = data?.clips ?? state.overview.clips;
        toast(toggle.checked ? 'Aufnahmen beim Melden sind eingeschaltet.' : 'Aufnahmen beim Melden sind ausgeschaltet.', 'success');
        await loadRules();
        await loadOverview();
      } catch (error) {
        toggle.checked = !toggle.checked;
        showError(error);
      }
    });
    fill(
      box,
      h(
        'section',
        { class: 'app-card', 'aria-labelledby': 'voice-regeln-titel' },
        h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'voice-regeln-titel', text: 'Voice-Regeln' }), h('p', { class: 'muted small', id: 'voice-regeln-stand', text: published ? `Veröffentlicht: Version ${published.version} am ${formatDateTime(published.at)}${published.by ? ` von ${published.by}` : ''}. Alle müssen diese Version annehmen.` : 'Noch nicht veröffentlicht – keine Pflicht zur Zustimmung, keine Aufnahmen beim Melden. Die Seite /voice-regeln zeigt den Standardtext.' })), h('a', { class: 'button tiny ghost', href: '/voice-regeln', target: '_blank', rel: 'noopener' }, icon('external'), 'Öffentliche Seite')),
        admin() ? h('p', { class: 'notice-line notice-line--warn', id: 'voice-regeln-warnung' }, icon('warning'), h('span', null, h('strong', { text: 'Veröffentlichen hat Folgen: ' }), 'Ab dann müssen alle – Spieler und Gäste – zustimmen; Verbindungen ohne Zustimmung werden getrennt, und Aufnahmen beim Melden werden aktiv. Empfehlung: vorher rechtlich prüfen lassen (Einwilligung Minderjähriger, Datenschutz-Folgenabschätzung).')) : h('p', { class: 'hint', text: 'Veröffentlichen und zurückziehen darf nur ein Admin.' }),
        h('div', { class: 'voice-rules-editor' }, h('div', { class: 'field' }, h('span', { class: 'field-row' }, h('label', { class: 'field__label', for: textId, text: admin() ? 'Text (Zeilen mit „# “ = Überschrift, „- “ = Listenpunkt, Leerzeile = Absatz)' : 'Text' }), counter), area), h('div', null, h('p', { class: 'eyebrow', text: 'Vorschau' }), preview)),
        admin() ? h('div', { class: 'card-actions' }, publishButton, withdraw, defaultButton) : null,
      ),
      h(
        'section',
        { class: 'app-card', 'aria-labelledby': 'voice-aufnahmen-titel' },
        h('h2', { id: 'voice-aufnahmen-titel', text: 'Aufnahmen beim Melden' }),
        h('label', { class: 'switch-row', for: 'voice-aufnahmen' }, h('span', { class: 'switch-text' }, h('strong', { text: 'Aufnahmen beim Melden erlauben' }), h('small', { id: 'voice-aufnahmen-stand', text: `Stand: ${clipText(clips)}${clips.allowed === false ? ' – HELDIX_DIENST_VOICE_CLIPS=0 ist gesetzt.' : ''}` })), toggle),
        h('p', { class: 'hint', text: `Nur mit veröffentlichten Regeln: Spieler halten die Stimmen anderer bis zu ${Math.round((overview?.limits?.clipMs ?? 600000) / 60000)} Minuten im Arbeitsspeicher und laden beim Melden nur die des Gemeldeten hoch (verschlüsselt, gelöscht ${overview?.limits?.deleteAfterDoneDays ?? 30} Tage nach Abschluss, spätestens nach ${overview?.limits?.deleteAfterDays ?? 90} Tagen).` }),
        admin() ? null : h('p', { class: 'hint', text: 'Den Schalter darf nur ein Admin ändern.' }),
      ),
      h(
        'section',
        { class: 'app-card', 'aria-labelledby': 'voice-versionen-titel' },
        h('h2', { id: 'voice-versionen-titel', text: 'Versionen' }),
        state.versions.length
          ? h('ul', { class: 'rows', id: 'voice-versionen' }, state.versions.map((version) => h('li', { class: 'row' }, h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: `Version ${version.version}` }), h('div', { class: 'row-sub', text: `${formatDateTime(version.at)}${version.by ? ` von ${version.by}` : ''}${version.withdrawnAt ? ` · zurückgezogen ${formatDateTime(version.withdrawnAt)}${version.withdrawnBy ? ` von ${version.withdrawnBy}` : ''}` : ''}` })))))
          : emptyState('Noch keine Version veröffentlicht.', 'file'),
      ),
    );
    update();
  }

  async function publishRules(text, published) {
    const ok = await openDialog({
      title: published ? `Version ${published.version + 1} der Voice-Regeln veröffentlichen?` : 'Voice-Regeln veröffentlichen?',
      body: [
        h('p', { class: 'notice-line notice-line--danger' }, icon('warning'), h('span', { text: 'Ab jetzt müssen alle (Spieler und Gäste) zustimmen; alle Verbindungen ohne Zustimmung werden getrennt; Aufnahmen beim Melden werden aktiv. Empfehlung: vorher rechtlich prüfen lassen (Einwilligung Minderjähriger, Datenschutz-Folgenabschätzung).' })),
        h('p', { class: 'eyebrow', text: 'Vorschau' }),
        h('div', { class: 'voice-rules-preview prose voice-rules-preview--dialog' }, rulesPreview(text)),
      ],
      confirmLabel: 'Ja, veröffentlichen',
      danger: true,
      onConfirm: async () => teamCall('POST', '/v1/team/voice/rules', { text }),
    });
    if (!ok) return;
    toast('Voice-Regeln veröffentlicht. Alle müssen jetzt zustimmen.', 'success');
    await loadRules();
    await loadOverview();
  }

  async function withdrawRules(published) {
    const ok = await confirmAction({ title: `Version ${published.version} zurückziehen?`, text: 'Danach gibt es keine Pflicht zur Zustimmung mehr, und Aufnahmen beim Melden sind aus. Schon gespeicherte Aufnahmen bleiben bis zu ihrer Löschfrist.', confirmLabel: 'Zurückziehen', danger: true });
    if (!ok) return;
    try {
      await teamCall('DELETE', '/v1/team/voice/rules');
      toast('Voice-Regeln zurückgezogen.', 'success');
      await loadRules();
      await loadOverview();
    } catch (error) {
      showError(error);
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Voice aus (Server-Liste)
  // -------------------------------------------------------------------------------------------------------

  async function loadServers() {
    const box = $('voice-sub-server');
    fill(box, loadingState());
    const data = await teamCall('GET', '/v1/team/voice/servers');
    state.servers = Array.isArray(data?.servers) ? data.servers : [];
    renderServers();
  }

  function renderServers() {
    const box = $('voice-sub-server');
    let form = null;
    if (admin()) {
      const ids = { domain: uid('voice-domain'), reason: uid('voice-server-grund'), contact: uid('voice-kontakt'), sub: uid('voice-sub') };
      const domain = h('input', { class: 'input input--mono', id: ids.domain, maxlength: '253', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'example.net' });
      const reason = h('input', { class: 'input', id: ids.reason, maxlength: '200', autocomplete: 'off', placeholder: 'z. B. Wunsch des Betreibers (Support #31)' });
      const contact = h('input', { class: 'input', id: ids.contact, maxlength: '200', autocomplete: 'off', placeholder: 'optional' });
      const sub = h('input', { type: 'checkbox', id: ids.sub, checked: true });
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      form = h(
        'form',
        { class: 'voice-server-form', id: 'voice-server-form', novalidate: true },
        h('div', { class: 'field-grid' }, h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.domain, text: 'Domain (ohne Port)' }), domain), h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.reason, text: 'Grund (Pflicht)' }), reason), h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.contact, text: 'Kontakt' }), contact)),
        h('label', { class: 'check-row', for: ids.sub }, sub, h('span', { text: 'Auch alle Subdomains' })),
        error,
        h('div', { class: 'card-actions' }, h('button', { type: 'submit', class: 'button small' }, icon('plus'), 'Eintragen')),
      );
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.hidden = true;
        const value = domain.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
        if (!value || !reason.value.trim()) {
          error.textContent = 'Domain und Grund sind Pflicht.';
          error.hidden = false;
          return;
        }
        try {
          const data = await busy(form.querySelector('button[type=submit]'), () => teamCall('PUT', `/v1/team/voice/servers/${encodeURIComponent(value)}`, { subdomains: sub.checked, reason: reason.value.trim(), contact: contact.value.trim() || undefined }));
          state.servers = Array.isArray(data?.servers) ? data.servers : state.servers;
          toast(`Voice ist auf ${value} jetzt aus.`, 'success');
          renderServers();
        } catch (problem) {
          if (problem.handled) return;
          error.textContent = problem.message;
          error.hidden = false;
        }
      });
    }
    fill(
      box,
      h(
        'section',
        { class: 'app-card', 'aria-labelledby': 'voice-server-titel' },
        h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'voice-server-titel', text: 'Voice aus – auf Wunsch von Server-Betreibern' }), h('p', { class: 'muted small', text: 'Auf diesen Servern gibt es weder Raum noch Gruppe; Spieler sehen „Voice ist auf diesem Server aus (auf Wunsch des Server-Betreibers)“. Betreiber beantragen das über den Support – vorher prüfen, ob die Anfrage wirklich vom Betreiber kommt.' }))),
        form ?? h('p', { class: 'hint', text: 'Eintragen und austragen darf nur ein Admin.' }),
        state.servers.length
          ? h(
              'ul',
              { class: 'rows', id: 'voice-server-liste' },
              state.servers.map((server) =>
                h(
                  'li',
                  { class: 'row', dataset: { domain: server.domain } },
                  h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('mic-off')),
                  h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('code', { class: 'mono', text: server.domain }), server.subdomains ? h('span', { class: 'chip chip--xs', text: 'mit Subdomains' }) : null), h('div', { class: 'row-sub', text: `${server.reason}${server.contact ? ` · Kontakt: ${server.contact}` : ''} · ${formatDate(server.at)}${server.by ? ` von ${server.by}` : ''}` })),
                  admin() ? h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'austragen' }, onClick: (event) => removeServer(server, event.currentTarget) }, icon('close'), 'Austragen')) : null,
                ),
              ),
            )
          : emptyState('Kein Server auf der Liste.', 'mic'),
      ),
    );
  }

  async function removeServer(server, button) {
    const ok = await confirmAction({ title: `${server.domain} austragen?`, text: 'Auf diesem Server gibt es dann wieder Voice.', confirmLabel: 'Austragen' });
    if (!ok) return;
    try {
      const data = await busy(button, () => teamCall('DELETE', `/v1/team/voice/servers/${encodeURIComponent(server.domain)}`));
      state.servers = Array.isArray(data?.servers) ? data.servers : state.servers.filter((entry) => entry !== server);
      toast(`${server.domain} ist ausgetragen.`, 'success');
      renderServers();
    } catch (error) {
      showError(error);
    }
  }

  return { show, showPlayer, timelineEvents };
}
