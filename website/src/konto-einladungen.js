// HeldixClient – Webseite: Konto → „Freunde einladen“ (Heldix-Dienst ab 1.11.0).
//
// GET /v1/invites → { link, invites: [{ code, url, appUrl, created, expires, server, voice, accepted }], invited,
// confirmed, pending, rewards: [{ cosmetic, friends, unlocked }], unlocked }. `link` ist die offene allgemeine Einladung
// (ohne Server), die der Dienst bei Bedarf anlegt. DELETE /v1/invites/<code> zieht einen Link zurück.
// Ohne Dienst 1.11.0 (404) zeigt der Bereich einen Hinweis. Adresse: /konto#reiter=einladen (alt: #reiter=freunde&teil=einladen).
// onChange(stand): nach jedem Laden (für Übersicht und Chat: „Einladung teilen“).
import { busy, confirmAction, copyText, emptyState, formatDate, formatDateTime, h, icon, relativeTime, rerender, showError, toast } from './app-common.js';
import { INVITE_CODE_RE, inviteWebLink, rewardInfo, rewardPreview, SLOT_LABELS, wearHref } from './einladung-common.js';

const REFRESH_MS = 60_000;

/** Web-Link einer Einladung: wie vom Dienst (https://…/einladung#<code>), sonst auf dieser Seite gebaut. */
function linkOf(invite) {
  if (invite && typeof invite.url === 'string' && /^https:\/\/[^\s#]+\/einladung#[a-hjkmnp-z2-9]{10}$/.test(invite.url)) return invite.url;
  return invite && INVITE_CODE_RE.test(invite.code ?? '') ? inviteWebLink(invite.code) : null;
}

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);

/** call: Anfrage mit Sitzung (401 meldet konto.js selbst ab). isCurrent(): ist der Bereich „Freunde einladen“ offen? */
export function initInvites({ call, isCurrent, onChange = () => {} }) {
  const off = document.getElementById('einladen-aus');
  const card = document.getElementById('einladen-karte');
  const box = document.getElementById('einladen-inhalt');
  const state = { data: null, available: null, timer: null, token: 0, focusOnShow: false };

  function normalize(data) {
    const invites = (Array.isArray(data?.invites) ? data.invites : []).filter((invite) => invite && INVITE_CODE_RE.test(invite.code ?? ''));
    let link = null;
    if (typeof data?.link === 'string') link = { url: data.link, code: /#([a-hjkmnp-z2-9]{10})$/.exec(data.link)?.[1] ?? null };
    else if (data?.link && typeof data.link === 'object') link = data.link;
    return {
      link,
      invites,
      invited: count(data?.invited),
      confirmed: count(data?.confirmed),
      pending: count(data?.pending),
      rewards: (Array.isArray(data?.rewards) ? data.rewards : []).filter((reward) => reward && typeof reward.cosmetic === 'string' && Number.isInteger(reward.friends)),
      unlocked: new Set(Array.isArray(data?.unlocked) ? data.unlocked.filter((id) => typeof id === 'string') : []),
    };
  }

  async function refresh() {
    const token = state.token;
    let data;
    try {
      data = await call('GET', '/v1/invites');
    } catch (error) {
      if (token !== state.token) return;
      if (error.status === 404) {
        // Älterer Dienst ohne Einladungen: unauffällig weglassen
        state.available = false;
        card.hidden = true;
        if (off) off.hidden = false;
        onChange(null);
        return;
      }
      if (error.status !== 401 && !state.data) {
        card.hidden = false;
        rerender(box, 'fehler', () => emptyState('Deine Einladungen lassen sich gerade nicht laden. Versuch es gleich noch einmal.', 'warning'));
      }
      return;
    }
    if (token !== state.token) return;
    state.available = true;
    state.data = normalize(data);
    card.hidden = false;
    if (off) off.hidden = true;
    render();
    onChange({ ...state.data, unlocked: [...state.data.unlocked] });
    if (state.focusOnShow) {
      state.focusOnShow = false;
      reveal();
    }
  }

  function reveal() {
    if (card.hidden) return;
    card.scrollIntoView({ behavior: 'instant', block: 'start' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1600);
  }

  // -------------------------------------------------------------------------------------------------------

  function render() {
    const data = state.data;
    const signature = JSON.stringify([data.link, data.invites, data.invited, data.confirmed, data.pending, data.rewards, [...data.unlocked]]);
    rerender(box, signature, () => [generalLink(data), counters(data), rewards(data), openLinks(data), h('p', { class: 'hint', text: 'Gezählt wird, wer über deinen Link neu zu HeldixClient kommt und insgesamt 30 Minuten spielt – bestehende Spieler werden über den Link nur deine Freunde. Einladungen gelten 30 Tage, mit Voice-Gruppe 24 Stunden.' })]);
  }

  function generalLink(data) {
    const url = linkOf(data.link);
    if (!url) return h('p', { class: 'muted small', text: 'Gerade gibt es keinen offenen Link – lad die Seite gleich neu.' });
    const input = h('input', { class: 'input invite-link-input', id: 'einladen-link', readonly: true, value: url, 'aria-label': 'Dein Einladungs-Link', onFocus: (event) => event.currentTarget.select() });
    const copy = h('button', { type: 'button', class: 'btn btn--social btn--sm', id: 'einladen-kopieren', dataset: { focusKey: 'einladen:kopieren' } }, icon('copy'), 'Link kopieren');
    copy.addEventListener('click', async () => {
      const ok = await copyText(url);
      toast(ok ? 'Einladungs-Link kopiert. Schick ihn an deine Freunde.' : 'Kopieren ging nicht – markier den Link und kopier ihn von Hand.', ok ? 'success' : 'error');
    });
    const share =
      typeof navigator.share === 'function'
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn btn--secondary btn--sm',
              dataset: { focusKey: 'einladen:teilen' },
              onClick: () => navigator.share({ title: 'HeldixClient', text: 'Komm zu HeldixClient – hier ist meine Einladung:', url }).catch(() => {}),
            },
            icon('send'),
            'Teilen',
          )
        : null;
    return h('div', { class: 'invite-link' }, h('label', { class: 'field-row', for: 'einladen-link' }, h('span', { text: 'Dein Link' }), data.link?.expires ? h('span', { class: 'muted small', text: `gültig bis ${formatDate(data.link.expires)}` }) : null), h('div', { class: 'invite-link-row' }, input, copy, share));
  }

  function counters(data) {
    const tile = (id, label, value, note) => h('div', { class: 'invite-stat', dataset: { zaehler: id } }, h('span', { class: 'invite-stat-value', text: String(value) }), h('span', { class: 'invite-stat-label', text: label }), h('span', { class: 'invite-stat-note', text: note }));
    return h(
      'div',
      { class: 'invite-stats', role: 'list', 'aria-label': 'Deine Einladungen' },
      tile('eingeladen', 'Eingeladen', data.invited, 'neu über deine Links'),
      tile('bestaetigt', 'Bestätigt', data.confirmed, '30 Minuten gespielt'),
      tile('ausstehend', 'Ausstehend', data.pending, 'noch nicht 30 Minuten'),
    );
  }

  function rewards(data) {
    if (!data.rewards.length) return null;
    return h(
      'div',
      { class: 'invite-rewards' },
      h('h3', { class: 'list-title', text: 'Belohnungen' }),
      h(
        'ul',
        { class: 'invite-reward-list' },
        data.rewards.map((reward) => {
          const unlocked = reward.unlocked === true || data.unlocked.has(reward.cosmetic);
          const info = rewardInfo(reward.cosmetic);
          const art = h('span', { class: 'invite-reward-thumb', 'aria-hidden': 'true' }, icon(unlocked ? 'sparkles' : 'lock'));
          const name = h('strong', { text: info.name });
          const slot = h('span', { class: 'muted small', text: info.slot ? SLOT_LABELS[info.slot] : '' });
          const wear = unlocked ? h('a', { class: 'btn btn--secondary btn--sm', href: wearHref(info.slot), dataset: { focusKey: `belohnung:${reward.cosmetic}` } }, icon('cape'), 'Tragen') : null;
          rewardPreview(reward.cosmetic, 96).then((preview) => {
            if (!preview) return;
            name.textContent = preview.name;
            slot.textContent = preview.slot ? SLOT_LABELS[preview.slot] : '';
            if (wear) wear.href = wearHref(preview.slot);
            if (preview.image) art.replaceChildren(h('img', { src: preview.image, alt: '', width: '56', height: '56' }));
          });
          const done = Math.min(data.confirmed, reward.friends);
          const percent = reward.friends > 0 ? Math.round((done / reward.friends) * 100) : 100;
          const bar = h('div', { class: 'progress progress--reward', role: 'progressbar', 'aria-label': `Fortschritt zu ${info.name}`, 'aria-valuemin': '0', 'aria-valuemax': String(reward.friends), 'aria-valuenow': String(done) }, h('div', { class: 'progress__bar' }));
          bar.firstElementChild.style.width = `${unlocked ? 100 : percent}%`;
          return h(
            'li',
            { class: `invite-reward-item${unlocked ? ' unlocked' : ''}`, dataset: { cosmetic: reward.cosmetic } },
            art,
            h(
              'div',
              { class: 'invite-reward-main' },
              h('div', { class: 'invite-reward-title' }, name, slot, unlocked ? h('span', { class: 'chip chip--online' }, icon('check'), 'Freigeschaltet') : null),
              h('p', { class: 'row-sub', text: `ab ${reward.friends} ${reward.friends === 1 ? 'bestätigten Freund' : 'bestätigten Freunden'}` }),
              unlocked ? null : bar,
              unlocked ? null : h('p', { class: 'row-meta', text: `${done} von ${reward.friends}` }),
            ),
            wear,
          );
        }),
      ),
    );
  }

  function openLinks(data) {
    const generalCode = data.link?.code ?? null;
    const sorted = [...data.invites].sort((a, b) => Number(b.code === generalCode) - Number(a.code === generalCode) || (b.created ?? 0) - (a.created ?? 0));
    return h(
      'details',
      { class: 'invite-open', open: sorted.length > 1 ? true : undefined },
      h('summary', null, h('span', { text: `Offene Links (${sorted.length})` }), icon('chevron-down')),
      sorted.length
        ? h(
            'ul',
            { class: 'rows' },
            sorted.map((invite) => {
              const label = invite.code === generalCode ? 'Allgemeiner Link' : invite.voice ? `Voice-Gruppe${invite.server ? ` auf ${invite.server}` : ''}` : invite.server ? `Server: ${invite.server}` : 'Link ohne Server';
              const accepted = count(invite.accepted);
              return h(
                'li',
                { class: 'row', dataset: { code: invite.code } },
                h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon(invite.voice ? 'headphones' : invite.server ? 'server' : 'user-plus')),
                h(
                  'div',
                  { class: 'row-main' },
                  h('div', { class: 'row-title', text: label }),
                  h('div', { class: 'row-sub', text: `${accepted === 0 ? 'noch nicht angenommen' : accepted === 1 ? '1-mal angenommen' : `${accepted}-mal angenommen`} · erstellt ${relativeTime(invite.created)}` }),
                  h('div', { class: 'row-meta', text: `gültig bis ${formatDateTime(invite.expires)}` }),
                ),
                h(
                  'div',
                  { class: 'row-actions' },
                  h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'aria-label': `${label} kopieren`, dataset: { focusKey: `einladung:${invite.code}:kopieren` }, onClick: () => copyLink(invite) }, icon('copy'), h('span', { class: 'label', text: 'Kopieren' })),
                  h('button', { type: 'button', class: 'btn btn--ghost btn--sm quiet-danger', 'aria-label': `${label} zurückziehen`, dataset: { focusKey: `einladung:${invite.code}:weg` }, onClick: (event) => revoke(event.currentTarget, invite, label) }, icon('trash'), h('span', { class: 'label', text: 'Zurückziehen' })),
                ),
              );
            }),
          )
        : emptyState('Keine offenen Links.', 'user-plus'),
    );
  }

  async function copyLink(invite) {
    const url = linkOf(invite);
    const ok = url ? await copyText(url) : false;
    toast(ok ? 'Link kopiert.' : 'Kopieren ging nicht.', ok ? 'success' : 'error');
  }

  async function revoke(button, invite, label) {
    const ok = await confirmAction({
      title: `${label} zurückziehen?`,
      text: invite.voice
        ? 'Der Link gilt danach nicht mehr. Gäste, die gerade über ihn im Voice Chat sind, werden sofort getrennt. Freundschaften, die schon entstanden sind, bleiben.'
        : 'Der Link gilt danach nicht mehr. Freundschaften, die schon über ihn entstanden sind, bleiben – und auch deine Belohnungen.',
      confirmLabel: 'Zurückziehen',
      danger: true,
      onConfirm: () => call('DELETE', `/v1/invites/${invite.code}`),
    });
    if (!ok) return;
    toast('Link zurückgezogen.');
    await busy(button, refresh).catch(showError);
  }

  return {
    setUser() {
      state.token++;
      state.data = null;
      state.available = null;
      card.hidden = true;
      box.replaceChildren();
      delete box.dataset.signature;
      refresh().catch(() => {});
    },
    /** Bereich gewechselt. */
    onTab(name) {
      clearInterval(state.timer);
      state.timer = null;
      if (name !== 'einladen' || state.available === false) return;
      refresh().catch(() => {});
      state.timer = setInterval(() => {
        if (document.visibilityState === 'visible' && isCurrent()) refresh().catch(() => {});
      }, REFRESH_MS);
    },
    stop() {
      state.token++;
      clearInterval(state.timer);
      state.timer = null;
    },
  };
}
