// HeldixClient – Webseite: Konto → „Meine Setups“ (Setup teilen, Heldix-Dienst ab 1.14.0).
//
// Setups teilt man im Launcher (Instanz → „Teilen“). Hier stehen die eigenen mit Zählern:
// GET /v1/setups → { setups: [{ code, url, name, description, created, expires, status (active | expired | revoked),
// revoked, expired, views, installs, minecraft, loader, counts: { mods, resourcepacks, shaderpacks, addons } }],
// limits: { active, daily } } und
// „Widerrufen“ mit DELETE /v1/setups/<code> (der Link gilt danach nicht mehr; die Seite /setup#<code> sagt dann „gilt
// nicht mehr“). Höchstens 50 aktive Setups je Spieler. Älterer Dienst (404): Hinweis statt Liste.
// Texte vom Dienst landen nur als Text im Dokument.
import { busy, confirmAction, copyText, emptyState, formatDate, h, icon, loadingState, rerender, showError, toast } from './app-common.js';

const CODE_RE = /^[a-hjkmnp-z2-9]{10}$/;
const MAX_ACTIVE = 50;
const NUMBER = new Intl.NumberFormat('de-DE');

const webLink = (code) => `${location.origin}/setup#${code}`;

function normalize(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.code !== 'string' || !CODE_RE.test(entry.code)) return null;
  const expires = Number.isFinite(entry.expires) ? entry.expires : null;
  const revoked = entry.revoked === true || entry.status === 'revoked';
  const counts = entry.counts && typeof entry.counts === 'object' ? entry.counts : {};
  const count = (key) => (Number.isInteger(counts[key]) && counts[key] > 0 ? counts[key] : 0);
  return {
    code: entry.code,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 40) : 'Setup',
    description: typeof entry.description === 'string' ? entry.description.trim().slice(0, 300) : '',
    created: Number.isFinite(entry.created) ? entry.created : null,
    expires,
    revoked,
    expired: !revoked && (entry.expired === true || entry.status === 'expired' || (expires !== null && expires <= Date.now())),
    minecraft: typeof entry.minecraft === 'string' ? entry.minecraft.slice(0, 32) : null,
    loader: { heldix: 'Heldix Loader', fabric: 'Fabric', vanilla: 'Vanilla' }[entry.loader] ?? null,
    counts: { mods: count('mods'), resourcepacks: count('resourcepacks'), shaderpacks: count('shaderpacks'), addons: count('addons') },
    views: Number.isFinite(entry.views) ? entry.views : 0,
    installs: Number.isFinite(entry.installs) ? entry.installs : 0,
  };
}

export function initSetups({ call }) {
  const $ = (id) => document.getElementById(id);
  const local = { setups: null, available: null, loading: null, maxActive: MAX_ACTIVE };

  async function load() {
    if (local.loading) return local.loading;
    const box = $('setups-liste');
    if (!box.firstChild) box.replaceChildren(loadingState('Setups werden geladen …'));
    local.loading = (async () => {
      try {
        const data = await call('GET', '/v1/setups');
        const list = Array.isArray(data?.setups) ? data.setups : Array.isArray(data) ? data : [];
        local.setups = list.map(normalize).filter(Boolean).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
        if (Number.isInteger(data?.limits?.active) && data.limits.active > 0) local.maxActive = data.limits.active;
        local.available = true;
      } catch (error) {
        if (error.status === 404) local.available = false;
        else if (error.status !== 401) {
          showError(error);
          if (!local.setups) box.replaceChildren(emptyState(error.message, 'warning'));
        }
      } finally {
        local.loading = null;
      }
      render();
    })();
    return local.loading;
  }

  function stateChip(setup) {
    if (setup.revoked) return h('span', { class: 'chip', text: 'Widerrufen' });
    if (setup.expired) return h('span', { class: 'chip', text: 'Abgelaufen' });
    return h('span', { class: 'chip chip--online' }, h('span', { class: 'dot dot--online', 'aria-hidden': 'true' }), 'Aktiv');
  }

  /** „Minecraft 26.3 · Fabric · 12 Mods · 1 Shader“ */
  function contentLine(setup) {
    const { mods, resourcepacks, shaderpacks, addons } = setup.counts;
    return [
      setup.minecraft ? `Minecraft ${setup.minecraft}` : null,
      setup.loader,
      mods ? (mods === 1 ? '1 Mod' : `${mods} Mods`) : null,
      resourcepacks ? (resourcepacks === 1 ? '1 Ressourcenpaket' : `${resourcepacks} Ressourcenpakete`) : null,
      shaderpacks ? (shaderpacks === 1 ? '1 Shader' : `${shaderpacks} Shader`) : null,
      addons ? (addons === 1 ? '1 Addon' : `${addons} Addons`) : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  function row(setup) {
    const active = !setup.revoked && !setup.expired;
    const meta = [
      setup.created ? `geteilt am ${formatDate(setup.created)}` : null,
      setup.revoked ? null : setup.expires === null ? 'läuft nicht ab' : setup.expired ? `abgelaufen am ${formatDate(setup.expires)}` : `gültig bis ${formatDate(setup.expires)}`,
    ].filter(Boolean);
    return h(
      'li',
      { class: `row setup-row${active ? '' : ' is-inactive'}`, dataset: { code: setup.code } },
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('cube')),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: setup.name }), stateChip(setup)),
        setup.description ? h('div', { class: 'row-sub', text: setup.description }) : null,
        contentLine(setup) ? h('div', { class: 'row-meta', text: contentLine(setup) }) : null,
        h('div', { class: 'row-meta' }, h('code', { class: 'mono', text: setup.code }), ` · ${meta.join(' · ')}`),
        h(
          'dl',
          { class: 'setup-counts' },
          h('div', null, h('dt', { text: 'Aufrufe' }), h('dd', { text: NUMBER.format(setup.views) })),
          h('div', null, h('dt', { text: 'Installiert' }), h('dd', { text: NUMBER.format(setup.installs) })),
        ),
      ),
      h(
        'div',
        { class: 'row-actions' },
        active ? h('a', { class: 'btn btn--secondary btn--sm', href: `/setup#${setup.code}`, dataset: { aktion: 'ansehen', focusKey: `ansehen:${setup.code}` } }, icon('eye'), 'Ansehen') : null,
        active
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', dataset: { aktion: 'kopieren', focusKey: `kopieren:${setup.code}` }, 'aria-label': `Link zu ${setup.name} kopieren`, onClick: () => copyLink(setup) }, icon('link'), 'Link kopieren')
          : null,
        active
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm danger-text', dataset: { aktion: 'widerrufen', focusKey: `widerrufen:${setup.code}` }, 'aria-label': `${setup.name} widerrufen`, onClick: (event) => revoke(setup, event.currentTarget) }, icon('close'), 'Widerrufen')
          : null,
      ),
    );
  }

  function render() {
    const box = $('setups-liste');
    const off = $('setups-aus');
    if (local.available === false) {
      off.hidden = false;
      box.replaceChildren();
      $('setups-zahl').textContent = '';
      return;
    }
    off.hidden = true;
    if (!local.setups) return;
    const active = local.setups.filter((setup) => !setup.revoked && !setup.expired);
    const old = local.setups.filter((setup) => setup.revoked || setup.expired);
    $('setups-zahl').textContent = `${active.length} von ${local.maxActive} aktiv`;
    rerender(box, JSON.stringify(local.setups), () => {
      if (!local.setups.length) return emptyState('Du hast noch kein Setup geteilt. Im Launcher öffnest du eine Instanz und klickst auf „Teilen“.', 'cube');
      return [
        active.length ? h('ul', { class: 'rows', id: 'setups-aktiv' }, active.map(row)) : emptyState('Gerade ist keins deiner Setups aktiv.', 'cube'),
        old.length
          ? h('details', { class: 'setups-old', id: 'setups-alt' }, h('summary', null, old.length === 1 ? '1 abgelaufenes oder widerrufenes Setup' : `${old.length} abgelaufene oder widerrufene Setups`), h('ul', { class: 'rows' }, old.map(row)))
          : null,
      ];
    });
  }

  async function copyLink(setup) {
    const ok = await copyText(webLink(setup.code));
    toast(ok ? `Link zu „${setup.name}“ kopiert.` : 'Kopieren ging nicht – öffne das Setup und kopier den Link dort.', ok ? 'success' : 'error');
  }

  async function revoke(setup, button) {
    const ok = await confirmAction({
      title: `„${setup.name}“ widerrufen?`,
      text: ['Der Link gilt danach nicht mehr – wer ihn öffnet, sieht „gilt nicht mehr“. Schon angelegte Instanzen bei anderen bleiben, wie sie sind.', 'Das lässt sich nicht rückgängig machen. Du kannst das Setup im Launcher aber jederzeit neu teilen.'],
      confirmLabel: 'Widerrufen',
      danger: true,
      onConfirm: () => call('DELETE', `/v1/setups/${setup.code}`),
    });
    if (!ok) return;
    toast(`„${setup.name}“ ist widerrufen.`, 'success');
    await busy(button, load).catch(() => {});
    $('setups-titel').focus?.();
  }

  $('setups-neu').addEventListener('click', (event) => busy(event.currentTarget, load).catch(showError));

  return {
    onTab(name) {
      if (name === 'setups') load().catch(() => {});
    },
    reset() {
      local.setups = null;
      local.available = null;
      $('setups-liste').replaceChildren();
      $('setups-liste').dataset.signature = '';
    },
  };
}
