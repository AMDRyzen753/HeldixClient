// HeldixClient – Webseite: Team-Bereich → Übersicht (Startseite des Team-Bereichs).
//
// Was gerade ansteht, auf einen Blick: Zahlen (Meldungen, Support, Einreichungen, Addon-Meldungen, Sperren) als
// Kacheln mit Link in den Bereich, darunter die neuesten offenen Einträge je Bereich (ein Klick öffnet den Eintrag),
// für Admins die letzten Team-Aktionen und die Zahlen des Dienstes. Moderatoren sehen nichts, was nur Admins dürfen.
//
// Anfragen: Meldungen, Support, Einreichungen und Addon-Meldungen kommen aus dem Nachfragen, das team.js ohnehin
// alle 30 Sekunden macht (getLive). Sperren, Protokoll und /v1/status lädt die Übersicht nur beim Öffnen und mit
// „Aktualisieren“ – nicht bei jedem Nachfragen.
import { avatar, formatDateTime, h, icon, reasonLabel, relativeTime, rerender, timeEl } from './app-common.js';
import { accessChips, addonIcon, addonReasonLabel } from './addon-common.js';
import { publicGet } from './public-cards.js';

const LIST_MAX = 5;
const NUMBER = new Intl.NumberFormat('de-DE');

const plural = (count, one, many) => `${NUMBER.format(count)} ${count === 1 ? one : many}`;

/** „1 Meldung, 2 Anfragen und 3 Einreichungen“ */
function joinParts(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

function sinceText(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '–';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days >= 2) return `seit ${NUMBER.format(days)} Tagen`;
  const hours = Math.floor((Date.now() - ms) / 3_600_000);
  if (hours >= 1) return hours === 1 ? 'seit 1 Stunde' : `seit ${hours} Stunden`;
  return 'seit wenigen Minuten';
}

/**
 * shell: Rahmen. teamCall(method, path): Team-Anfrage. isAdmin(), getMe(). getLive(): { reports, tickets,
 * submissions, addonReports, addonReportsForbidden, at } aus dem Nachfragen. refreshLive(): Zähler jetzt neu laden.
 * actionLabel(action): Text für Protokoll-Einträge.
 */
export function initTeamOverview({ shell, teamCall, isAdmin, getMe, getLive, refreshLive, actionLabel }) {
  const root = document.getElementById('team-dashboard');
  const extra = { bans: null, audit: null, status: null, loadedAt: 0 };
  let loading = null;

  /** Bereich wählen (mit Werten für den Eintrag), Seite hoch zum Titel. */
  function go(section, params = null) {
    shell.select(section, { history: 'push', params, scroll: true, source: 'user' });
    document.getElementById('shell-titel')?.focus({ preventScroll: true });
  }

  /** Link in einen Bereich: echte Adresse (Mittelklick, neuer Tab), Klick wechselt ohne Neuladen. */
  function sectionLink(section, params, attrs, ...children) {
    const query = new URLSearchParams({ reiter: section });
    if (params) for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const link = h('a', { href: `#${query}`, ...attrs }, ...children);
    link.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      go(section, params);
    });
    return link;
  }

  // -------------------------------------------------------------------------------------------------------
  // Laden
  // -------------------------------------------------------------------------------------------------------

  async function loadExtra() {
    const admin = isAdmin();
    const [bans, audit, status] = await Promise.all([
      teamCall('GET', '/v1/team/bans').catch(() => null),
      admin ? teamCall('GET', '/v1/team/audit?limit=6').catch(() => null) : null,
      publicGet('/v1/status').catch(() => null),
    ]);
    extra.bans = Array.isArray(bans?.bans) ? bans.bans : null;
    extra.audit = admin && Array.isArray(audit?.entries) ? audit.entries.slice(0, 6) : null;
    extra.status = status && typeof status === 'object' ? status : null;
    extra.loadedAt = Date.now();
  }

  /** Übersicht geöffnet (oder „Aktualisieren“): Zahlen, die nicht nachgefragt werden, und – wenn alt – die Zähler. */
  function load({ force = false } = {}) {
    if (loading) return loading;
    const live = getLive();
    const stale = force || !live.at || Date.now() - live.at > 5000;
    if (!root.firstChild) root.replaceChildren(h('div', { class: 'loading-inline', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Übersicht wird geladen …' })));
    loading = Promise.all([loadExtra(), stale ? refreshLive().catch(() => {}) : null])
      .then(() => render())
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  // -------------------------------------------------------------------------------------------------------
  // Zeichnen
  // -------------------------------------------------------------------------------------------------------

  function waitingTickets(live) {
    return (live.tickets ?? []).filter((ticket) => ticket.unread && ticket.status !== 'closed');
  }

  function statTile({ id, section, params, label, count, iconName, detail, tone }) {
    const known = typeof count === 'number';
    return sectionLink(
      section,
      params,
      { class: `dash-stat${known && count > 0 ? ` ${tone}` : known ? ' calm' : ''}`, dataset: { stat: id, focusKey: `stat:${id}` } },
      h('span', { class: 'dash-stat-icon', 'aria-hidden': 'true' }, icon(iconName)),
      h('span', { class: 'dash-stat-body' }, h('span', { class: 'dash-stat-value', text: known ? NUMBER.format(count) : '–' }), h('span', { class: 'dash-stat-label', text: label }), h('span', { class: 'dash-stat-detail', text: detail })),
    );
  }

  function listCard({ id, title, iconName, section, params, allLabel, items, empty, row }) {
    const headId = `dash-${id}-titel`;
    return h(
      'section',
      { class: 'app-card dash-list', dataset: { list: id }, 'aria-labelledby': headId },
      h(
        'div',
        { class: 'dash-list-head' },
        h('h3', { id: headId }, icon(iconName), h('span', { text: title }), items && items.length ? h('span', { class: 'count soft-count', text: String(items.length > 99 ? '99+' : items.length) }) : null),
        sectionLink(section, params, { class: 'dash-all', dataset: { focusKey: `alle:${id}` } }, allLabel, icon('chevron-right')),
      ),
      items === null
        ? h('p', { class: 'muted small dash-empty', text: 'Wird geladen …' })
        : items.length
          ? h('ul', { class: 'rows dash-rows' }, items.slice(0, LIST_MAX).map((item) => h('li', null, row(item))))
          : h('p', { class: 'dash-empty' }, icon('check'), h('span', { text: empty })),
      items && items.length > LIST_MAX ? h('p', { class: 'dash-more muted small', text: `und ${plural(items.length - LIST_MAX, 'weiterer Eintrag', 'weitere Einträge')}` }) : null,
    );
  }

  function rowLink(section, params, key, ...children) {
    return sectionLink(section, params, { class: 'row row-button dash-row', dataset: { focusKey: key } }, ...children, icon('chevron-right'));
  }

  const reportRow = (report) =>
    rowLink(
      'meldungen',
      { meldung: report.id },
      `meldung:${report.id}`,
      avatar(report.reported?.name, report.reported?.uuid, { size: 'sm' }),
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title' }, h('span', { text: report.reported?.name ?? 'Unbekannt' }), h('span', { class: 'chip', text: reasonLabel(report.reason) })),
        h('span', { class: 'row-meta' }, `#${report.id} · gemeldet von ${report.reporter?.name ?? '?'} · `, timeEl(report.at, relativeTime(report.at))),
      ),
    );

  const ticketRow = (ticket) =>
    rowLink(
      'support',
      { anfrage: ticket.id },
      `anfrage:${ticket.id}`,
      avatar(ticket.player?.name, ticket.player?.uuid, { size: 'sm' }),
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title' }, h('span', { class: 'dash-ellipsis', text: ticket.subject })),
        h('span', { class: 'row-meta' }, `#${ticket.id} · ${ticket.player?.name ?? '?'} · wartet `, timeEl(ticket.updatedAt ?? ticket.at, sinceText(ticket.updatedAt ?? ticket.at))),
      ),
    );

  const submissionRow = (sub) =>
    rowLink(
      'addons',
      { einreichung: sub.id },
      `einreichung:${sub.id}`,
      addonIcon(sub.icon, 'addon-icon small'),
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title' }, h('span', { text: sub.name || sub.addonId || '?' }), h('span', { class: 'chip', text: sub.version || '?' }), sub.access ? accessChips(sub.access, { compact: true }) : null),
        h('span', { class: 'row-meta' }, `von ${sub.submitter?.name ?? '?'} · `, timeEl(sub.submittedAt, relativeTime(sub.submittedAt))),
      ),
    );

  const addonReportRow = (report) =>
    rowLink(
      'addons',
      { unterreiter: 'meldungen' },
      `addon-meldung:${report.id}`,
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('flag')),
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title' }, h('span', { text: report.addonName || report.addonId || '?' }), h('span', { class: `chip${report.reason === 'malware' ? ' danger' : ''}`, text: addonReasonLabel(report.reason) })),
        h('span', { class: 'row-meta' }, `#${report.id} · von ${report.reporter?.name ?? '?'} · `, timeEl(report.at, relativeTime(report.at))),
      ),
    );

  const auditRow = (entry) =>
    h(
      'div',
      { class: 'row dash-audit' },
      avatar(entry.actor?.name, entry.actor?.uuid, { size: 'xs' }),
      h(
        'span',
        { class: 'row-main' },
        h('span', { class: 'row-title' }, h('strong', { text: entry.actor?.name ?? '?' }), h('span', { class: 'muted', text: actionLabel(entry.action) ?? String(entry.action ?? '?') })),
        h('span', { class: 'row-meta' }, entry.target ? `${entry.target} · ` : '', timeEl(entry.at, formatDateTime(entry.at))),
      ),
    );

  function numbers() {
    const status = extra.status;
    if (!status) return h('p', { class: 'muted small', text: 'Die Zahlen des Dienstes sind gerade nicht abrufbar.' });
    const facts = [
      ['online', 'Spieler online', typeof status.online === 'number' ? NUMBER.format(status.online) : '–'],
      ['spieler', 'Spieler gesamt', typeof status.players === 'number' ? NUMBER.format(status.players) : '–'],
      ['addons', 'Addons im Store', typeof status.addons === 'number' ? NUMBER.format(status.addons) : '–'],
      typeof status.cosmetics === 'number' ? ['cosmetics', 'Cosmetics im Katalog', NUMBER.format(status.cosmetics)] : null,
      ['launcher', 'Launcher', status.launcher ? `Version ${status.launcher}` : 'noch keine'],
      ['dienst', 'Heldix-Dienst', status.service ? `Version ${status.service}` : '–'],
      ['seit', 'Läuft', typeof status.since === 'number' ? sinceText(status.since) : '–'],
    ].filter(Boolean);
    return h(
      'dl',
      { class: 'dash-kpis' },
      facts.map(([key, label, value]) => h('div', { class: 'dash-kpi', dataset: { kpi: key } }, h('dt', { text: label }), h('dd', { text: value }))),
    );
  }

  function render() {
    if (!root) return;
    const live = getLive();
    const admin = isAdmin();
    const me = getMe();
    const reports = live.reports;
    const waiting = live.tickets ? waitingTickets(live) : null;
    const submissions = live.submissions;
    const addonReports = live.addonReportsForbidden ? null : live.addonReports;
    const bans = extra.bans;
    const oldest = (list, field) => (list && list.length ? Math.min(...list.map((item) => item[field] ?? Date.now())) : null);

    const parts = [];
    if (reports?.length) parts.push(plural(reports.length, 'Meldung', 'Meldungen'));
    if (waiting?.length) parts.push(plural(waiting.length, 'Anfrage', 'Anfragen'));
    if (submissions?.length) parts.push(plural(submissions.length, 'Einreichung', 'Einreichungen'));
    if (addonReports?.length) parts.push(plural(addonReports.length, 'Addon-Meldung', 'Addon-Meldungen'));
    const total = (reports?.length ?? 0) + (waiting?.length ?? 0) + (submissions?.length ?? 0) + (addonReports?.length ?? 0);
    const summary = reports === null && waiting === null ? 'Die offenen Punkte werden geladen …' : total ? `${joinParts(parts)} ${total === 1 ? 'wartet' : 'warten'} auf das Team.` : 'Gerade wartet nichts auf das Team. Alles erledigt!';

    const signature = JSON.stringify([admin, me?.name, reports, waiting, submissions, addonReports, live.addonReportsForbidden, bans, extra.audit, extra.status, Math.floor(Date.now() / 60_000)]);
    rerender(root, signature, () => {
      const refresh = h('button', { type: 'button', class: 'button tiny ghost', id: 'uebersicht-neu', dataset: { focusKey: 'uebersicht-neu' } }, icon('refresh'), 'Aktualisieren');
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        refresh.setAttribute('aria-busy', 'true');
        try {
          await load({ force: true });
        } finally {
          refresh.disabled = false;
          refresh.removeAttribute('aria-busy');
        }
      });
      const stand = Math.max(live.at || 0, extra.loadedAt || 0);
      const stats = [
        statTile({ id: 'meldungen', section: 'meldungen', label: 'offene Meldungen', count: reports?.length ?? null, iconName: 'flag', tone: 'warn', detail: reports?.length ? `älteste ${relativeTime(oldest(reports, 'at'))}` : 'nichts offen' }),
        statTile({ id: 'support', section: 'support', label: 'Anfragen warten', count: waiting?.length ?? null, iconName: 'chat', tone: 'warn', detail: waiting?.length ? `älteste ${sinceText(oldest(waiting, 'updatedAt'))}` : 'alles beantwortet' }),
        statTile({ id: 'einreichungen', section: 'addons', params: { unterreiter: 'einreichungen' }, label: 'Einreichungen zu prüfen', count: submissions?.length ?? null, iconName: 'addons', tone: 'accent', detail: submissions?.length ? `neueste ${relativeTime(Math.max(...submissions.map((sub) => sub.submittedAt ?? 0)))}` : 'nichts zu prüfen' }),
        live.addonReportsForbidden ? null : statTile({ id: 'addon-meldungen', section: 'addons', params: { unterreiter: 'meldungen' }, label: 'Addon-Meldungen', count: addonReports?.length ?? null, iconName: 'warning', tone: 'warn', detail: addonReports?.length ? `älteste ${relativeTime(oldest(addonReports, 'at'))}` : 'nichts offen' }),
        statTile({ id: 'sperren', section: 'sperren', label: 'aktive Sperren', count: bans?.length ?? null, iconName: 'ban', tone: 'neutral', detail: bans?.length ? `zuletzt ${[...bans].sort((a, b) => (b.at ?? 0) - (a.at ?? 0))[0].name}` : bans ? 'niemand gesperrt' : '–' }),
      ].filter(Boolean);
      return [
        h(
          'section',
          { class: 'app-card dash-hello', 'aria-labelledby': 'dash-hallo' },
          h('div', { class: 'dash-hello-text' }, h('h2', { id: 'dash-hallo', text: `Hallo, ${me?.name ?? ''}!` }), h('p', { id: 'dash-zusammenfassung', text: summary })),
          h('div', { class: 'dash-hello-side' }, stand ? h('span', { class: 'muted small dash-stand' }, 'Stand ', timeEl(stand, new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(stand)), ' Uhr') : null, refresh),
        ),
        h('div', { class: 'dash-stats', role: 'list', 'aria-label': 'Was ansteht' }, stats.map((tile) => h('div', { role: 'listitem', class: 'dash-stat-item' }, tile))),
        h(
          'div',
          { class: 'dash-grid' },
          listCard({ id: 'meldungen', title: 'Offene Meldungen', iconName: 'flag', section: 'meldungen', allLabel: 'Alle Meldungen', items: reports ? [...reports].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) : null, empty: 'Keine offenen Meldungen.', row: reportRow }),
          listCard({ id: 'support', title: 'Support wartet', iconName: 'chat', section: 'support', allLabel: 'Zum Support', items: waiting ? [...waiting].sort((a, b) => (a.updatedAt ?? a.at ?? 0) - (b.updatedAt ?? b.at ?? 0)) : null, empty: 'Alle Anfragen sind beantwortet.', row: ticketRow }),
          listCard({ id: 'einreichungen', title: 'Addons zur Prüfung', iconName: 'addons', section: 'addons', params: { unterreiter: 'einreichungen' }, allLabel: 'Alle Einreichungen', items: submissions ? [...submissions].sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)) : null, empty: 'Keine Einreichungen zu prüfen.', row: submissionRow }),
          live.addonReportsForbidden
            ? null
            : listCard({ id: 'addon-meldungen', title: 'Addon-Meldungen', iconName: 'warning', section: 'addons', params: { unterreiter: 'meldungen' }, allLabel: 'Alle Addon-Meldungen', items: addonReports ? [...addonReports].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)) : null, empty: 'Keine offenen Addon-Meldungen.', row: addonReportRow }),
          admin && extra.audit !== null
            ? h(
                'section',
                { class: 'app-card dash-list dash-wide', dataset: { list: 'protokoll' }, 'aria-labelledby': 'dash-protokoll-titel' },
                h('div', { class: 'dash-list-head' }, h('h3', { id: 'dash-protokoll-titel' }, icon('clock'), h('span', { text: 'Letzte Team-Aktionen' })), sectionLink('protokoll', null, { class: 'dash-all', dataset: { focusKey: 'alle:protokoll' } }, 'Ganzes Protokoll', icon('chevron-right'))),
                extra.audit.length ? h('div', { class: 'rows dash-rows' }, extra.audit.map(auditRow)) : h('p', { class: 'dash-empty' }, icon('check'), h('span', { text: 'Noch keine Einträge.' })),
              )
            : null,
        ),
        h('section', { class: 'app-card dash-numbers', 'aria-labelledby': 'dash-zahlen-titel' }, h('h3', { id: 'dash-zahlen-titel' }, icon('performance'), h('span', { text: 'Heldix-Dienst in Zahlen' })), numbers()),
      ];
    });
  }

  return {
    load,
    /** Neue Zähler aus dem Nachfragen: neu zeichnen, wenn die Übersicht offen ist. */
    update() {
      if (shell.current() === 'uebersicht' && root.isConnected && !document.getElementById('team-app').hidden) render();
    },
    reset() {
      extra.bans = null;
      extra.audit = null;
      extra.status = null;
      extra.loadedAt = 0;
      root.replaceChildren();
      root.dataset.signature = '';
    },
  };
}
