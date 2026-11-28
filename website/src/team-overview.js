// HeldixClient – Webseite: Team-Bereich → Übersicht (Dashboard, Heldix-Dienst ab 1.12.0).
//
// - Gruß mit dem, was für deine Rolle ansteht, „Stand … Uhr“ und „Aktualisieren“.
// - Kennzahlen aus GET /v1/team/dashboard: Spieler online, im Voice, offene Welten (genau, ohne Schwelle) und – nur
//   mit dem passenden Recht – offene Meldungen, wartender Support, Einreichungen, Addon-Meldungen.
// - „Als Nächstes zu tun“: die ältesten offenen Einträge, die deine Rolle bearbeiten darf (aus dem Nachfragen von
//   team.js), mit Filter nach Art und Knopf direkt in den Eintrag.
// - Letzte Aktivität (recent aus dem Dashboard, nur mit Recht „Protokoll“), Team und Abzeichen (team.view),
//   Heldix-Dienst (öffentlicher Status).
// Älterer Dienst ohne /v1/team/dashboard: Zahlen aus dem Nachfragen, Online/Voice/Welten als Strich.
import { avatar, h, icon, relativeTime, rerender, timeEl } from './app-common.js';
import { addonReasonLabel } from './addon-common.js';
import { publicGet } from './public-cards.js';
import { COMMUNITY_BADGES, ROLES, badgeIcon, roleIcon, roleShort } from './rollen.js';

const NUMBER = new Intl.NumberFormat('de-DE');
const TIME = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const TODO_MAX = 8;

const plural = (count, one, many) => `${NUMBER.format(count)} ${count === 1 ? one : many}`;

function joinParts(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} und ${parts[parts.length - 1]}`;
}

function waitText(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} Std.`;
  return `${Math.round(hours / 24)} Tagen`;
}

/**
 * shell: Rahmen. teamCall(method, path): Team-Anfrage. can(recht): darf die Rolle das? getMe(). getLive(): { reports,
 * tickets, submissions, addonReports, at } aus dem Nachfragen. refreshLive(): Zähler jetzt neu laden. actionLabel(action).
 */
export function initTeamOverview({ shell, teamCall, can, getMe, getLive, refreshLive, actionLabel }) {
  const root = document.getElementById('team-dashboard');
  const extra = { dashboard: null, members: null, badges: null, status: null, loadedAt: 0, filter: 'alle', available: true };
  let loading = null;

  function go(section, params = null) {
    shell.select(section, { history: 'push', params, scroll: true, source: 'user' });
    document.getElementById('shell-titel')?.focus({ preventScroll: true });
  }

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
    const [dashboard, members, badges, status] = await Promise.all([
      teamCall('GET', '/v1/team/dashboard').catch((error) => (error.status === 404 ? 'alt' : null)),
      can('team.view') ? teamCall('GET', '/v1/team/members').catch(() => null) : null,
      can('team.view') ? teamCall('GET', '/v1/team/badges').catch(() => null) : null,
      publicGet('/v1/status').catch(() => null),
    ]);
    extra.available = dashboard !== 'alt';
    extra.dashboard = dashboard && dashboard !== 'alt' ? dashboard : null;
    extra.members = Array.isArray(members?.members) ? members.members : null;
    extra.badges = Array.isArray(badges?.badges) ? badges.badges : null;
    extra.status = status && typeof status === 'object' ? status : null;
    extra.loadedAt = Date.now();
  }

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
  // Als Nächstes zu tun
  // -------------------------------------------------------------------------------------------------------

  function todoItems(live) {
    const items = [];
    if (can('support')) {
      for (const ticket of live.tickets ?? []) {
        if (ticket.status === 'closed' || !ticket.unread) continue;
        const since = ticket.updatedAt ?? ticket.at;
        items.push({ kind: 'support', at: since, title: ticket.subject, meta: `Support #${ticket.id} · ${ticket.player?.name ?? '?'} · wartet seit ${waitText(since)}`, chip: Date.now() - since > 2 * 3600_000 ? ['Dringend', 'danger'] : null, action: 'Antworten', section: 'support', params: { anfrage: ticket.id }, primary: true });
      }
    }
    if (can('moderation')) {
      const byPlayer = new Map();
      for (const report of live.reports ?? []) {
        const key = report.reported?.uuid ?? report.id;
        byPlayer.set(key, [...(byPlayer.get(key) ?? []), report]);
      }
      for (const reports of byPlayer.values()) {
        const first = [...reports].sort((a, b) => (a.at ?? 0) - (b.at ?? 0))[0];
        items.push({ kind: 'flag', at: first.at, title: `${first.reported?.name ?? '?'} · ${reasonLabelOf(first.reason)}`, meta: `Meldung #${first.id} · von ${first.reporter?.name ?? '?'}${first.messages?.length ? ' · mit Chatverlauf' : ''} · ${relativeTime(first.at)}`, chip: reports.length > 1 ? [`${reports.length} Meldungen`, ''] : null, action: 'Prüfen', section: 'meldungen', params: { meldung: first.id }, primary: true });
      }
    }
    if (can('addons')) {
      for (const sub of live.submissions ?? []) {
        const at = sub.submittedAt ?? sub.createdAt;
        items.push({ kind: 'addon', at, title: `${sub.name || sub.addonId || 'Addon'}${sub.version ? ` ${sub.version}` : ''}`, meta: `Einreichung · ${sub.submitter?.name ?? '?'} · ${relativeTime(at)}`, chip: sub.access?.access === 'minecraft' ? ['Greift in Minecraft ein', 'voice'] : null, action: 'Prüfen', section: 'addons', params: { einreichung: sub.id }, primary: true });
      }
    }
    if (can('addon-reports')) {
      for (const report of live.addonReports ?? []) {
        items.push({ kind: 'addon', at: report.at, title: `${report.addon?.name ?? report.addonId ?? 'Addon'} gemeldet`, meta: `Addon-Meldung · ${addonReasonLabel ? addonReasonLabel(report.reason) : report.reason} · ${relativeTime(report.at)}`, chip: null, action: 'Ansehen', section: 'addons', params: { unterreiter: 'meldungen' }, primary: false });
      }
    }
    return items.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  }

  function reasonLabelOf(reason) {
    return { spam: 'Spam', harassment: 'Belästigung', inappropriate: 'Unangemessen', other: 'Sonstiges' }[reason] ?? String(reason ?? '');
  }

  const TYPE_ICON = { support: 'help-circle', flag: 'flag', addon: 'addons', cosmetic: 'sparkles', update: 'download' };

  function todoRow(item) {
    return h(
      'li',
      { class: 'row todo__item', dataset: { art: item.kind } },
      h('span', { class: `todo__type todo__type--${item.kind}`, 'aria-hidden': 'true' }, shellIconFallback(TYPE_ICON[item.kind])),
      h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: item.title }), h('span', { class: 'row-sub', text: item.meta })),
      item.chip ? h('span', { class: `chip${item.chip[1] ? ` chip--${item.chip[1]}` : ''}`, text: item.chip[0] }) : null,
      sectionLink(item.section, item.params, { class: `btn btn--sm ${item.primary ? 'btn--primary' : 'btn--secondary'}`, dataset: { focusKey: `todo:${item.section}:${JSON.stringify(item.params)}` } }, item.action),
    );
  }

  function shellIconFallback(name) {
    const node = icon(name);
    return node.nodeType === 1 ? node : icon('info');
  }

  // -------------------------------------------------------------------------------------------------------
  // Zeichnen
  // -------------------------------------------------------------------------------------------------------

  function kpi({ id, label, value, trend, tone = '', dot = null, iconName = null, section = null, params = null }) {
    const known = typeof value === 'number';
    const body = [h('span', { class: 'kpi__label' }, dot ? h('span', { class: `dot dot--${dot}` }) : iconName ? icon(iconName) : null, label), h('strong', { class: 'kpi__value', text: known ? NUMBER.format(value) : '–' }), trend ? h('span', { class: 'kpi__trend', text: trend }) : null];
    const cls = `kpi${tone && known && value > 0 ? ` kpi--${tone}` : ''}`;
    if (section) return h('li', { dataset: { kpi: id } }, sectionLink(section, params, { class: `${cls} kpi--link` }, ...body));
    return h('li', { class: cls, dataset: { kpi: id } }, ...body);
  }

  function summary(live, dashboard) {
    const parts = [];
    const reports = can('moderation') ? live.reports?.length ?? dashboard?.reports : null;
    const support = can('support') ? (live.tickets ?? []).filter((ticket) => ticket.unread && ticket.status !== 'closed').length : null;
    const submissions = can('addons') ? live.submissions?.length ?? dashboard?.submissions : null;
    const addonReports = can('addon-reports') ? live.addonReports?.length ?? dashboard?.addonReports : null;
    if (reports) parts.push(plural(reports, 'Meldung', 'Meldungen'));
    if (support) parts.push(plural(support, 'Support-Anfrage', 'Support-Anfragen'));
    if (submissions) parts.push(plural(submissions, 'Einreichung', 'Einreichungen'));
    if (addonReports) parts.push(plural(addonReports, 'Addon-Meldung', 'Addon-Meldungen'));
    if (!parts.length) {
      if (getMe()?.role === 'tester') return 'Gerade gibt es für dich nichts zu tun. Vorab-Versionen erscheinen hier, sobald es sie gibt.';
      return 'Gerade wartet nichts auf dich. Danke fürs Mitmachen!';
    }
    return `${joinParts(parts)} ${parts.length === 1 && /^1 /.test(parts[0]) ? 'wartet' : 'warten'} aufs Team.`;
  }

  function render() {
    const live = getLive();
    const me = getMe();
    const dashboard = extra.dashboard;
    const todo = todoItems(live);
    const kinds = [...new Set(todo.map((item) => item.kind))];
    if (!kinds.includes(extra.filter)) extra.filter = 'alle';
    const shown = (extra.filter === 'alle' ? todo : todo.filter((item) => item.kind === extra.filter)).slice(0, TODO_MAX);
    const stand = Math.max(live.at || 0, extra.loadedAt || 0);
    const signature = JSON.stringify([me?.name, me?.role, dashboard, todo.map((item) => [item.title, item.meta, item.chip]), extra.filter, extra.members?.length, extra.badges, extra.status?.service, Math.floor(stand / 60_000)]);
    rerender(root, signature, () => {
      const refresh = h('button', { type: 'button', class: 'btn btn--secondary btn--sm', id: 'dash-aktualisieren', dataset: { focusKey: 'dash:aktualisieren' } }, icon('refresh'), 'Aktualisieren');
      refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        try {
          await load({ force: true });
        } finally {
          refresh.disabled = false;
        }
      });
      const waiting = can('support') ? (live.tickets ?? []).filter((ticket) => ticket.unread && ticket.status !== 'closed') : [];
      const oldestWait = waiting.length ? Math.min(...waiting.map((ticket) => ticket.updatedAt ?? ticket.at ?? Date.now())) : null;
      const oldestReport = (live.reports ?? []).length ? Math.min(...live.reports.map((report) => report.at ?? Date.now())) : null;
      const kpis = [
        kpi({ id: 'online', label: 'Spieler online', value: dashboard?.online ?? null, dot: 'online', trend: dashboard ? 'im Spiel verbunden' : extra.available ? '' : 'ab Dienst 1.12.0' }),
        kpi({ id: 'voice', label: 'Im Voice', value: dashboard?.voice ?? null, dot: 'voice', trend: dashboard ? 'Spiel und Browser' : '' }),
        kpi({ id: 'welten', label: 'Offene Welten', value: dashboard?.worlds ?? null, iconName: 'world', trend: dashboard && dashboard.worlds === null ? 'Welt teilen aus' : dashboard ? 'gerade geöffnet' : '' }),
        can('moderation') ? kpi({ id: 'meldungen', label: 'Meldungen', value: live.reports?.length ?? dashboard?.reports ?? null, iconName: 'flag', tone: 'warn', trend: oldestReport ? `offen · älteste ${relativeTime(oldestReport)}` : 'nichts offen', section: 'meldungen' }) : null,
        can('support') ? kpi({ id: 'support', label: 'Support', value: waiting.length, iconName: 'help-circle', tone: 'warn', trend: oldestWait ? `warten · älteste ${waitText(oldestWait)}` : 'alles beantwortet', section: 'support' }) : null,
        can('addons') || can('addon-reports')
          ? kpi({ id: 'pruefen', label: 'Zu prüfen', value: (can('addons') ? live.submissions?.length ?? dashboard?.submissions ?? 0 : 0) + (can('addon-reports') ? live.addonReports?.length ?? dashboard?.addonReports ?? 0 : 0), iconName: 'addons', tone: 'warn', trend: [can('addons') ? plural(live.submissions?.length ?? dashboard?.submissions ?? 0, 'Einreichung', 'Einreichungen') : null, can('addon-reports') ? plural(live.addonReports?.length ?? dashboard?.addonReports ?? 0, 'Addon-Meldung', 'Addon-Meldungen') : null].filter(Boolean).join(' · '), section: 'addons' })
          : null,
      ].filter(Boolean);
      const filterGroup =
        kinds.length > 1
          ? h(
              'div',
              { class: 'segmented segmented--sm card__head-end', role: 'radiogroup', 'aria-label': 'Nach Art filtern', id: 'todo-filter' },
              [['alle', 'Alle'], ...kinds.map((kind) => [kind, { support: 'Support', flag: 'Meldungen', addon: 'Addons' }[kind] ?? kind])].map(([value, label]) => {
                const input = h('input', { type: 'radio', name: 'todo-filter', value, checked: extra.filter === value || undefined });
                input.addEventListener('change', () => {
                  extra.filter = value;
                  render();
                });
                return h('label', null, input, h('span', { text: label }));
              }),
            )
          : null;
      const recent = Array.isArray(dashboard?.recent) ? dashboard.recent.slice(0, 6) : null;
      const roleCounts = extra.members ? ROLES.map((role) => [role.id, extra.members.filter((member) => member.role === role.id).length]) : null;
      const badgeCounts = extra.badges ? COMMUNITY_BADGES.map((badge) => [badge.id, extra.badges.filter((entry) => entry.badge === badge.id).length]) : null;
      const status = extra.status;
      return [
        h(
          'section',
          { class: 'card team-hello', 'aria-labelledby': 'dash-hallo' },
          h('div', null, h('h2', { class: 'h3', id: 'dash-hallo', text: `Hallo, ${me?.name ?? ''}!` }), h('p', { class: 'text-2', id: 'dash-zusammenfassung', text: summary(live, dashboard) })),
          h('span', { class: 'team-hello__time' }, stand ? h('span', { class: 'dash-stand' }, 'Stand ', timeEl(stand, TIME.format(stand)), ' Uhr') : null, refresh),
        ),
        h('ul', { class: 'kpis', 'aria-label': 'Kennzahlen', id: 'dash-kennzahlen' }, kpis),
        h(
          'div',
          { class: 'team-grid' },
          h(
            'section',
            { class: 'card todo', 'aria-labelledby': 'todo-titel', id: 'dash-todo' },
            h('div', { class: 'card__head' }, h('span', { class: 'icon-tile' }, icon('check')), h('div', null, h('h2', { class: 'card__title', id: 'todo-titel', text: 'Als Nächstes zu tun' }), h('p', { class: 'tiny text-3', text: 'Nach Wartezeit · nur, was deine Rolle darf' })), filterGroup),
            shown.length
              ? h('ul', { class: 'rows todo__list' }, shown.map(todoRow))
              : h('ul', { class: 'rows todo__list' }, h('li', { class: 'row todo__empty' }, h('span', { class: 'todo__type' }, icon('check')), h('span', { class: 'row-main' }, h('span', { class: 'row-title', text: 'Nichts zu tun' }), h('span', { class: 'row-sub', text: me?.role === 'tester' ? 'Als Tester siehst du hier künftig Vorab-Versionen zum Ausprobieren.' : 'Alles erledigt – neue Einträge erscheinen hier von selbst.' })))),
            todo.length > TODO_MAX ? h('p', { class: 'tiny text-3', text: `und ${todo.length - TODO_MAX} weitere` }) : null,
          ),
          h(
            'div',
            { class: 'team-side' },
            recent
              ? h(
                  'section',
                  { class: 'card', 'aria-labelledby': 'aktivitaet-titel', id: 'dash-aktivitaet' },
                  h('div', { class: 'card__head' }, h('span', { class: 'icon-tile' }, icon('clock')), h('div', null, h('h2', { class: 'card__title', id: 'aktivitaet-titel', text: 'Letzte Aktivität' }), h('p', { class: 'tiny text-3', text: 'Aus dem Protokoll' })), sectionLink('protokoll', null, { class: 'btn btn--ghost btn--sm card__head-end' }, 'Alles')),
                  recent.length
                    ? h(
                        'ol',
                        { class: 'timeline' },
                        recent.map((entry) =>
                          h(
                            'li',
                            null,
                            avatar(entry.actor?.name, entry.actor?.uuid, { size: 'sm' }),
                            h('div', null, h('strong', { text: entry.actor?.uuid === me?.uuid ? 'Du' : entry.actor?.name ?? '?' }), ` · ${actionLabel(entry.action) ?? entry.action}${entry.target ? `: ${entry.target}` : ''}`, h('span', null, timeEl(entry.at, relativeTime(entry.at)))),
                          ),
                        ),
                      )
                    : h('p', { class: 'small text-3', text: 'Noch keine Einträge.' }),
                )
              : null,
            roleCounts
              ? h(
                  'section',
                  { class: 'card', 'aria-labelledby': 'rollen-titel', id: 'dash-team' },
                  h('div', { class: 'card__head' }, h('span', { class: 'icon-tile' }, icon('friends')), h('div', null, h('h2', { class: 'card__title', id: 'rollen-titel', text: 'Team und Abzeichen' }), h('p', { class: 'tiny text-3', text: `${plural(extra.members.length, 'Mitglied', 'Mitglieder')}${extra.badges ? ` · ${plural(extra.badges.length, 'Community-Abzeichen', 'Community-Abzeichen')}` : ''}` })), sectionLink('team', null, { class: 'btn btn--ghost btn--sm card__head-end' }, can('team.manage') ? 'Verwalten' : 'Ansehen')),
                  h('ul', { class: 'roles' }, roleCounts.map(([role, count]) => h('li', null, roleIcon(role), h('span', { text: roleShort(role) }), h('b', { text: String(count) })))),
                  badgeCounts ? h('ul', { class: 'roles roles--community' }, badgeCounts.map(([badge, count]) => h('li', null, badgeIcon(badge, { label: false }), h('span', { text: COMMUNITY_BADGES.find((entry) => entry.id === badge).label }), h('b', { text: String(count) })))) : null,
                )
              : null,
            h(
              'section',
              { class: 'card', 'aria-labelledby': 'dienst-titel', id: 'dash-dienst' },
              h('div', { class: 'card__head' }, h('span', { class: `icon-tile${status?.ok ? ' icon-tile--online' : ''}` }, icon('server')), h('div', null, h('h2', { class: 'card__title', id: 'dienst-titel', text: 'Heldix-Dienst' }), h('p', { class: 'tiny text-3', text: status?.since ? `läuft seit ${relativeTime(status.since).replace(/^vor /, '')}` : 'Stand unbekannt' })), status?.ok ? h('span', { class: 'chip chip--online card__head-end' }, h('span', { class: 'dot dot--online' }), 'Online') : null),
              h('dl', { class: 'mini-stats' }, h('div', null, h('dt', { text: 'Launcher' }), h('dd', { text: status?.launcher ?? '–' })), h('div', null, h('dt', { text: 'Dienst' }), h('dd', { text: status?.service ?? '–' })), h('div', null, h('dt', { text: 'Addons' }), h('dd', { text: typeof status?.addons === 'number' ? NUMBER.format(status.addons) : '–' }))),
            ),
          ),
        ),
      ];
    });
  }

  return {
    load,
    /** Neuer Stand aus dem Nachfragen. */
    update() {
      if (shell.current() === 'uebersicht' && root.firstChild) render();
    },
    reset() {
      Object.assign(extra, { dashboard: null, members: null, badges: null, status: null, loadedAt: 0 });
      root.replaceChildren();
      delete root.dataset.signature;
    },
  };
}
