// HeldixClient – Webseite: Team-Bereich → Cosmetics (nur Admins).
//
// Katalog verwalten: Liste mit Trägern (GET /v1/team/cosmetics), signierten Umschlag hochladen und veröffentlichen
// (PUT /v1/team/cosmetics), ausblenden/einblenden (PATCH) und löschen (DELETE). Den Umschlag
// `<id>-<version>.cosmetic.json` baut und signiert `npm run cosmetic` im Launcher – hier wird nichts signiert.
//
// Vor dem Veröffentlichen prüft die Seite selbst (cosmetics-common.js, dieselben Regeln wie der Dienst): Form und
// Größe des Umschlags, Ed25519-Signatur über "heldix-cosmetic\n" + Manifest gegen den öffentlichen Update-Schlüssel
// aus GET /v1/team/cosmetics, alle Regeln von Format 1 bzw. 2, dazu Version und Slot gegen den Katalog. Erst wenn alles
// grün ist, geht der Umschlag unverändert an den Dienst – der prüft dasselbe noch einmal. Format 2 (animierte Meshes):
// Vorschau mit Auswahl der Animation (Namen aus dem Manifest), Steckbrief mit Mesh, Animationen, Zuständen und Leuchten.
import { busy, confirmAction, emptyState, formatBytes, formatDate, formatDateTime, h, icon, loadingState, openDialog, rerender, showError, toast, uid } from './app-common.js';
import {
  BUILTIN_CAPE_IDS,
  COSMETIC_ID_RE,
  COSMETIC_LIMITS,
  COSMETIC_LIMITS_2,
  COSMETIC_MAX_ENVELOPE_BYTES,
  COSMETIC_SLOTS,
  CosmeticError,
  SLOT_NAMES,
  SLOT_TITLES,
  animationButtons,
  checkCosmeticEnvelope,
  cosmeticAnimated,
  cosmeticAnimations,
  drawCosmeticPreview,
  prepareCosmetic,
  verifyCosmeticEnvelope,
} from './cosmetics-common.js';

const $ = (id) => document.getElementById(id);
const NUMBER = new Intl.NumberFormat('de-DE');
const SLOT_ICONS = { head: 'user', back: 'cape', aura: 'sparkles', companion: 'friends', cape: 'cape' };
const FILE_RE = /^([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)-(\d{1,10})\.cosmetic\.json$/;
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function chip(text, kind = '') {
  return h('span', { class: `chip${kind ? ` ${kind}` : ''}`, text });
}

const wearersText = (count) => (count === 1 ? '1 Träger' : `${NUMBER.format(count)} Träger`);

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !COSMETIC_ID_RE.test(entry.id) || !COSMETIC_SLOTS.includes(entry.slot)) return null;
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
  return {
    id: entry.id,
    slot: entry.slot,
    version: Number.isInteger(entry.version) && entry.version > 0 ? entry.version : null,
    name: text(entry.name, COSMETIC_LIMITS.nameMax) || entry.id,
    description: text(entry.description, COSMETIC_LIMITS.descriptionMax),
    access: entry.access === 'team' || entry.access === 'unlock' ? entry.access : 'all',
    date: typeof entry.date === 'string' ? entry.date : null,
    sha256: typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256) ? entry.sha256 : null,
    size: number(entry.size),
    hidden: entry.hidden === true,
    wearers: Number.isInteger(entry.wearers) && entry.wearers >= 0 ? entry.wearers : 0,
    createdAt: number(entry.createdAt),
    publishedAt: number(entry.publishedAt),
    publishedBy: typeof entry.publishedBy === 'string' ? entry.publishedBy.slice(0, 40) : null,
  };
}

function normalizeOverview(data) {
  const order = (entry) => COSMETIC_SLOTS.indexOf(entry.slot);
  return {
    cosmetics: (Array.isArray(data?.cosmetics) ? data.cosmetics : [])
      .map(normalizeEntry)
      .filter(Boolean)
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })),
    keyConfigured: data?.keyConfigured !== false,
    publicKey: typeof data?.publicKey === 'string' && data.publicKey.includes('PUBLIC KEY') ? data.publicKey : null,
  };
}

/**
 * Vorschau auf einer Leinwand, bewegt (wenn das Cosmetic sich bewegt und Bewegung erlaubt ist). choice (Format 2):
 * { animation } – gewählte Animation; ändert sie sich, beginnt die Zeit von vorn. Format 2 zeichnet höchstens
 * 24-mal pro Sekunde (so schnell laufen die Keyframes; die 2D-Zeichnung der Dreiecke ist aufwendiger).
 */
function animatePreview(canvas, item, choice = { animation: null }) {
  let started = performance.now();
  let shown = choice.animation;
  let last = -Infinity;
  const mesh = item.manifest.format === 2;
  const moving = cosmeticAnimated(item.manifest) && !reducedMotion();
  const draw = (now) => {
    if (!canvas.isConnected) return;
    if (choice.animation !== shown) {
      shown = choice.animation;
      started = now;
      last = -Infinity;
    }
    if (!mesh || now - last >= 1000 / 24 || !moving) {
      last = now;
      try {
        drawCosmeticPreview(canvas, item, { t: moving ? (now - started) / 1000 : 0, animation: shown });
      } catch {
        return;
      }
    }
    if (moving || choice.redraw) {
      choice.redraw = false;
      requestAnimationFrame(draw);
    }
  };
  choice.restart = () => {
    choice.redraw = true;
    if (!moving) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

/** Format 2: Auswahl der Animation (Namen aus dem Manifest, Standard: Zustand idle). */
function animationChips(manifest, choice) {
  const info = cosmeticAnimations(manifest);
  if (!info || info.clips.length < 2) return null;
  choice.animation = info.idle;
  const group = h('div', { class: 'anim-chips cosmetic-anims', role: 'group', 'aria-label': `Animation von ${manifest.name}` });
  const render = () =>
    group.replaceChildren(
      ...animationButtons(info, choice.animation, (name) => {
        choice.animation = name;
        render();
        choice.restart?.();
      }),
    );
  render();
  return group;
}

/** Leinwand + Textur (+ Leuchtebene) eines geprüften Manifests. */
function previewBlock(manifest, { size = 168 } = {}) {
  const canvas = h('canvas', { class: 'cosmetic-canvas', width: String(size * 2), height: String(size * 2), role: 'img', 'aria-label': `Vorschau: ${manifest.name}` });
  const choice = { animation: null };
  const chips = animationChips(manifest, choice);
  prepareCosmetic(manifest)
    .then((item) => animatePreview(canvas, item, choice))
    .catch(() => canvas.replaceWith(h('p', { class: 'muted small', text: 'Die Vorschau ließ sich nicht zeichnen.' })));
  // Format 2: Leucht-Streifen mit emissive.frames Bildern untereinander
  const glowFrames = manifest.format === 2 ? (manifest.emissive?.frames ?? 1) : 1;
  return h(
    'div',
    { class: 'cosmetic-preview' },
    h('div', { class: 'cosmetic-stage' }, canvas),
    chips,
    h(
      'div',
      { class: 'cosmetic-textures' },
      h('figure', null, h('img', { class: 'cosmetic-texture', src: manifest.texture, alt: `Textur von ${manifest.name}`, width: String(manifest.image.width), height: String(manifest.image.height) }), h('figcaption', { text: `Textur ${manifest.image.width} × ${manifest.image.height}` })),
      manifest.glow ? h('figure', null, h('img', { class: 'cosmetic-texture', src: manifest.glow, alt: `Leuchtebene von ${manifest.name}`, width: String(manifest.image.width), height: String(manifest.image.height * glowFrames) }), h('figcaption', { text: glowFrames > 1 ? `Leuchtebene (${glowFrames} Bilder)` : 'Leuchtebene' })) : null,
    ),
  );
}

/** Format 2: Mesh, Animationen, Zustände, Leuchten, Partikel und Platz des Begleiters. */
function meshFacts(manifest, fact) {
  const { mesh, bones, states, emissive, particles, attach } = manifest;
  const clips = Object.entries(manifest.animations);
  const stateList = Object.entries(states)
    .filter(([key]) => key !== 'blendSeconds')
    .map(([key, name]) => `${key} → ${name}`)
    .join(', ');
  return [
    fact('Format', '2 · animiertes Mesh (ab Launcher und Spiel 0.13.8)'),
    fact('Mesh', `${NUMBER.format(mesh.vertexCount)} Ecken · ${NUMBER.format(mesh.triangleCount)} Dreiecke · ${bones.length === 1 ? '1 Knochen' : `${bones.length} Knochen`}${mesh.joints ? ' · weiche Haut' : ''}`),
    fact('Animationen', clips.map(([name, clip]) => `${name} (${(clip.frames / clip.fps).toFixed(1).replace('.', ',')} s${clip.loop ? '' : ', einmalig'})`).join(' · ')),
    fact('Zustände', `${stateList} · Überblenden ${String(states.blendSeconds).replace('.', ',')} s`),
    emissive ? fact('Leuchten', `${emissive.frames === 1 ? '1 Bild' : `${emissive.frames} Bilder`} · ${emissive.frametimeTicks} Ticks je Bild · Puls ${String(emissive.pulse.min).replace('.', ',')}–${String(emissive.pulse.max).replace('.', ',')} alle ${String(emissive.pulse.period).replace('.', ',')} s`) : null,
    particles.length ? fact('Partikel', [...new Set(particles.map((p) => p.particle))].join(', ')) : null,
    attach ? fact('Begleiter', `Ursprung ${attach.origin.join(' / ')} px · ${attach.side === 'right' ? 'rechte' : 'linke'} Seite`) : null,
  ].filter(Boolean).flat();
}

/** Steckbrief eines geprüften Manifests. */
function manifestFacts(manifest, { envelopeBytes = null } = {}) {
  const fact = (label, ...value) => [h('dt', { text: label }), h('dd', null, ...value)];
  const cubes = manifest.model ? manifest.model.bones.reduce((sum, bone) => sum + bone.cubes.length, 0) : 0;
  return h(
    'dl',
    { class: 'facts-list cosmetic-facts' },
    fact('Slot', `${SLOT_TITLES[manifest.slot] ?? manifest.slot}`),
    fact('Name', h('strong', { text: manifest.name })),
    fact('ID', h('code', { class: 'mono', text: manifest.id })),
    fact('Version', String(manifest.version)),
    fact('Wählbar für', manifest.access === 'team' ? 'nur Team-Mitglieder' : manifest.access === 'unlock' ? 'nur, wer es freigeschaltet hat (Belohnung für Einladungen)' : 'alle Spieler'),
    fact('Beschreibung', manifest.description || '–'),
    fact('Textur', `${manifest.image.width} × ${manifest.image.height} Pixel · ${formatBytes(manifest.image.bytes)}${manifest.glow ? ' · mit Leuchtebene' : ''}`),
    ...(manifest.format === 2 ? meshFacts(manifest, fact) : []),
    manifest.model ? fact('Modell', `${manifest.model.bones.length === 1 ? '1 Bone' : `${manifest.model.bones.length} Bones`} · ${cubes === 1 ? '1 Würfel' : `${cubes} Würfel`}${manifest.model.scale !== 1 ? ` · Größe ${manifest.model.scale}` : ''}${manifest.animations.length ? ` · ${manifest.animations.length === 1 ? '1 Animation' : `${manifest.animations.length} Animationen`} (${[...new Set(manifest.animations.map((a) => a.type))].join(', ')})` : ''}`) : null,
    manifest.particles ? fact('Partikel', `${manifest.particles.frames} Bilder · ${manifest.particles.rate}/s · ${manifest.particles.motion} · Radius ${manifest.particles.radius}`) : null,
    manifest.cape ? fact('Cape', `${manifest.cape.frames === 1 ? '1 Bild' : `${manifest.cape.frames} Bilder`} · ${manifest.cape.fps} Bilder/s`) : null,
    manifest.companion ? fact('Begleiter', `Platz ${manifest.companion.offset.join(' / ')} · Größe ${manifest.companion.scale}`) : null,
    fact('Datum', Number.isFinite(Date.parse(manifest.date)) ? formatDateTime(Date.parse(manifest.date)) : manifest.date),
    envelopeBytes !== null ? fact('Umschlag', formatBytes(envelopeBytes)) : null,
  );
}

/**
 * teamCall: Anfrage mit Team-Zugang. onChange(): nach Änderungen am Katalog (Suche, Übersicht).
 */
export function initTeamCosmetics({ teamCall, onChange }) {
  const state = { data: null, filter: 'all', chosen: null, focusId: null };
  let previewDialog = null;

  // -------------------------------------------------------------------------------------------------------
  // Liste
  // -------------------------------------------------------------------------------------------------------

  async function load({ focusId = null } = {}) {
    const box = $('cosmetic-liste');
    if (focusId) state.focusId = focusId;
    if (!box.firstChild) box.replaceChildren(loadingState('Katalog wird geladen …'));
    apply(await teamCall('GET', '/v1/team/cosmetics'));
  }

  function apply(data) {
    state.data = normalizeOverview(data);
    render();
    if (state.chosen) renderCheck();
    onChange?.();
  }

  function renderFilter() {
    const counts = Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, 0]));
    for (const entry of state.data?.cosmetics ?? []) counts[entry.slot]++;
    const total = state.data?.cosmetics.length ?? 0;
    const options = [['all', 'Alle', total], ...COSMETIC_SLOTS.map((slot) => [slot, SLOT_NAMES[slot] ?? slot, counts[slot]])];
    if (state.filter !== 'all' && !counts[state.filter]) state.filter = 'all';
    rerender($('cosmetic-filter'), JSON.stringify([options, state.filter]), () =>
      options.map(([value, label, count]) =>
        h('button', { type: 'button', dataset: { slot: value, focusKey: `slot:${value}` }, 'aria-pressed': String(state.filter === value), disabled: value !== 'all' && !count ? true : undefined }, label, h('span', { class: 'segment-count', text: String(count) })),
      ),
    );
  }

  function render() {
    const data = state.data;
    if (!data) return;
    $('cosmetic-schluessel-fehlt').hidden = data.keyConfigured;
    $('cosmetic-anzahl').textContent = data.cosmetics.length ? `(${data.cosmetics.length})` : '';
    renderFilter();
    const list = data.cosmetics.filter((entry) => state.filter === 'all' || entry.slot === state.filter);
    rerender($('cosmetic-liste'), JSON.stringify([list, state.filter]), () => {
      if (!data.cosmetics.length) return emptyState('Noch kein Cosmetic im Katalog. Das erste veröffentlichst du oben mit einer .cosmetic.json.', 'sparkles');
      return h('ul', { class: 'rows cosmetic-rows' }, list.map(row));
    });
    if (state.focusId) {
      const target = document.querySelector(`#cosmetic-liste [data-id="${CSS.escape(state.focusId)}"]`);
      state.focusId = null;
      if (target) {
        target.classList.add('highlight');
        target.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
        target.querySelector('button')?.focus({ preventScroll: true });
        setTimeout(() => target.classList.remove('highlight'), 2400);
      }
    }
  }

  function row(entry) {
    const switchId = `cosmetic-sichtbar-${entry.id}`;
    const toggle = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id: switchId, dataset: { focusKey: `visible:${entry.id}` } });
    toggle.checked = !entry.hidden;
    toggle.addEventListener('change', () => toggleHidden(entry, toggle));
    const meta = [wearersText(entry.wearers), entry.publishedAt ? `veröffentlicht ${formatDate(entry.publishedAt)}${entry.publishedBy ? ` von ${entry.publishedBy}` : ''}` : null, entry.size !== null ? formatBytes(entry.size) : null].filter(Boolean).join(' · ');
    return h(
      'li',
      { class: `row cosmetic-row${entry.hidden ? ' is-hidden' : ''}`, dataset: { id: entry.id, slot: entry.slot } },
      h('span', { class: `cosmetic-slot-icon slot-${entry.slot}`, 'aria-hidden': 'true' }, icon(SLOT_ICONS[entry.slot] ?? 'sparkles')),
      h(
        'div',
        { class: 'row-main' },
        h(
          'div',
          { class: 'row-title' },
          h('span', { class: 'cosmetic-name', text: entry.name }),
          h('code', { class: 'mono muted', text: entry.id }),
          chip(SLOT_NAMES[entry.slot] ?? entry.slot),
          chip(`Version ${entry.version ?? '?'}`, 'accent'),
          entry.access === 'team' ? h('span', { class: 'chip team-only' }, icon('shield'), 'Nur Team') : null,
          entry.access === 'unlock' ? h('span', { class: 'chip accent' }, icon('lock'), 'Belohnung') : null,
          entry.hidden ? chip('ausgeblendet', 'warning') : null,
        ),
        entry.description ? h('div', { class: 'row-sub', text: entry.description }) : null,
        h('div', { class: 'row-meta', text: meta }),
      ),
      h(
        'div',
        { class: 'row-actions cosmetic-actions' },
        h('label', { class: 'inline-switch', for: switchId }, toggle, h('span', { text: 'Sichtbar' })),
        h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `preview:${entry.id}` }, 'aria-label': `Vorschau von ${entry.name}`, onClick: (event) => openPreview(entry, event.currentTarget) }, icon('eye'), h('span', { class: 'label', text: 'Vorschau' })),
        h('button', { type: 'button', class: 'button tiny ghost quiet-danger', dataset: { focusKey: `delete:${entry.id}` }, 'aria-label': `${entry.name} löschen`, onClick: () => remove(entry) }, icon('trash'), h('span', { class: 'label', text: 'Löschen' })),
      ),
    );
  }

  async function toggleHidden(entry, input) {
    const hidden = !input.checked;
    const patch = async () => apply(await teamCall('PATCH', `/v1/team/cosmetics/${encodeURIComponent(entry.id)}`, { hidden }));
    if (hidden) {
      const ok = await confirmAction({
        title: `${entry.name} ausblenden?`,
        text: [
          entry.wearers
            ? `${entry.wearers === 1 ? '1 Spieler trägt' : `${NUMBER.format(entry.wearers)} Spieler tragen`} es gerade. Niemand sieht es dann mehr – im Spiel, im Launcher und auf der Webseite. Die Auswahl bleibt gespeichert und gilt wieder, sobald du es einblendest.`
            : 'Das Cosmetic verschwindet aus dem Katalog (Spiel, Launcher, Webseite). Wieder einblenden geht jederzeit.',
        ],
        confirmLabel: 'Ausblenden',
        danger: true,
        onConfirm: patch,
      });
      if (!ok) {
        input.checked = true;
        return;
      }
      toast(`${entry.name} ist ausgeblendet.`, 'success');
    } else {
      try {
        await busy(input, patch);
        toast(`${entry.name} ist wieder im Katalog.`, 'success');
      } catch (error) {
        input.checked = false;
        showError(error);
      }
    }
  }

  async function remove(entry) {
    const sure = entry.wearers ? h('input', { type: 'checkbox', id: uid('sicher') }) : null;
    const ok = await openDialog({
      title: `${entry.name} löschen?`,
      body: [
        h('p', {
          text: entry.wearers
            ? `${entry.wearers === 1 ? '1 Spieler trägt' : `${NUMBER.format(entry.wearers)} Spieler tragen`} „${entry.name}“ gerade. Beim Löschen wird ${entry.wearers === 1 ? 'seine' : 'ihre'} Auswahl zurückgesetzt – das lässt sich nicht rückgängig machen.`
            : `„${entry.name}“ trägt gerade niemand.`,
        }),
        h('p', { class: 'muted small', text: `Das Cosmetic verschwindet ganz aus dem Katalog und die ID „${entry.id}“ wird frei. Nur ausblenden geht mit dem Schalter „Sichtbar“.` }),
        sure ? h('label', { class: 'check-row' }, sure, h('span', { text: `Ja, die Auswahl von ${entry.wearers === 1 ? '1 Spieler' : `${NUMBER.format(entry.wearers)} Spielern`} zurücksetzen` })) : null,
      ],
      confirmLabel: 'Endgültig löschen',
      danger: true,
      canConfirm: () => !sure || sure.checked,
      onConfirm: async () => apply(await teamCall('DELETE', `/v1/team/cosmetics/${encodeURIComponent(entry.id)}`)),
    });
    if (ok) toast(`${entry.name} ist gelöscht.`, 'success');
  }

  /** Vorschau eines veröffentlichten Cosmetics (GET /v1/team/cosmetics/<id>, auch ausgeblendete) – geprüft wie beim Hochladen. */
  async function openPreview(entry, opener) {
    closePreview();
    const body = h('div', { class: 'cosmetic-dialog-body' }, loadingState('Cosmetic wird geladen und geprüft …'));
    const closeButton = h('button', { type: 'button', class: 'button small ghost' }, 'Schließen');
    const titleId = uid('cosmetic-vorschau');
    previewDialog = h(
      'dialog',
      { class: 'modal cosmetic-dialog', 'aria-labelledby': titleId },
      h('div', { class: 'dialog-form' }, h('h2', { id: titleId, text: `${entry.name} · Version ${entry.version ?? '?'}` }), body, h('div', { class: 'dialog-actions' }, closeButton)),
    );
    const dialog = previewDialog;
    const finish = () => {
      if (!dialog.isConnected) return;
      dialog.close();
      dialog.remove();
      if (previewDialog === dialog) previewDialog = null;
      if (opener?.isConnected) opener.focus();
    };
    closeButton.addEventListener('click', finish);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish();
    });
    document.body.append(dialog);
    dialog.showModal();
    closeButton.focus();
    try {
      const data = await teamCall('GET', `/v1/team/cosmetics/${encodeURIComponent(entry.id)}`);
      const manifest = await verifyCosmeticEnvelope({ manifest: data?.manifest, signature: data?.signature }, { publicKey: state.data?.publicKey ?? undefined, expect: { id: entry.id, slot: entry.slot } });
      if (!dialog.isConnected) return;
      body.replaceChildren(
        h('div', { class: 'cosmetic-result' }, previewBlock(manifest), h('div', null, manifestFacts(manifest), h('p', { class: 'form-ok' }, icon('check'), h('span', { text: 'Signatur und Regeln im Browser geprüft.' })))),
      );
    } catch (error) {
      if (!dialog.isConnected || error?.handled) return;
      body.replaceChildren(h('p', { class: 'form-error', role: 'alert', text: error instanceof CosmeticError ? `Prüfung fehlgeschlagen: ${error.message}.` : error.message }));
    }
  }

  function closePreview() {
    if (previewDialog?.isConnected) {
      previewDialog.close();
      previewDialog.remove();
    }
    previewDialog = null;
  }

  // -------------------------------------------------------------------------------------------------------
  // Hochladen: prüfen, Vorschau, veröffentlichen
  // -------------------------------------------------------------------------------------------------------

  function resetUpload() {
    state.chosen = null;
    $('cosmetic-datei-name').textContent = 'Keine Datei gewählt';
    $('cosmetic-fehler').hidden = true;
    renderCheck();
  }

  async function onFileChosen(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    $('cosmetic-datei-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
    $('cosmetic-fehler').hidden = true;
    const chosen = { fileName: file.name, size: file.size, text: null, envelope: null, manifest: null, raw: null, problems: [], signature: null, checking: true };
    state.chosen = chosen;
    renderCheck();
    if (!state.data) await load().catch(() => {});
    // 1. Größe und Form
    if (file.size > COSMETIC_MAX_ENVELOPE_BYTES) {
      chosen.problems.push(['fail', `Die Datei ist zu groß (${formatBytes(file.size)}; höchstens ${COSMETIC_MAX_ENVELOPE_BYTES / 1024} KB).`]);
    } else {
      try {
        chosen.text = (await file.text()).replace(/^﻿/, '');
      } catch {
        chosen.problems.push(['fail', 'Die Datei ließ sich nicht lesen.']);
      }
    }
    let value = null;
    if (chosen.text !== null) {
      try {
        value = JSON.parse(chosen.text);
      } catch {
        chosen.problems.push(['fail', 'Die Datei ist kein gültiges JSON. Gewählt werden muss die .cosmetic.json aus launcher/release/cosmetics.']);
      }
    }
    if (value !== null) {
      const envelope = checkCosmeticEnvelope(value);
      if (typeof envelope === 'string') chosen.problems.push(['fail', `Das ist kein Cosmetic-Umschlag: ${envelope}. Er entsteht mit npm run cosmetic.`]);
      else {
        chosen.envelope = { manifest: envelope.manifest, signature: envelope.signature };
        try {
          const raw = JSON.parse(envelope.manifest);
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) chosen.raw = raw;
        } catch {
          // meldet die Prüfung unten
        }
      }
    }
    // 2. Signatur und Regeln (WebCrypto, cosmetics-common.js)
    if (chosen.envelope) {
      const publicKey = state.data?.publicKey ?? null;
      if (!publicKey) {
        chosen.signature = 'nokey';
      } else {
        try {
          chosen.manifest = await verifyCosmeticEnvelope(chosen.envelope, { publicKey });
          chosen.signature = 'ok';
        } catch (error) {
          if (error instanceof CosmeticError && error.reason === 'manifest') {
            chosen.signature = 'ok';
            chosen.manifestError = error.message;
          } else if (error instanceof CosmeticError && error.reason === 'signature') {
            chosen.signature = 'fail';
          } else {
            chosen.signature = 'error';
            chosen.signatureError = error?.message ?? String(error);
          }
        }
      }
    }
    chosen.checking = false;
    if (state.chosen === chosen) renderCheck();
  }

  /** Prüfpunkte der gewählten Datei: [[ok|fail|warn|info, Text]]. */
  function checks(chosen) {
    const list = [...chosen.problems];
    if (!chosen.envelope) return list;
    const data = state.data;
    if (data && !data.keyConfigured) list.push(['fail', 'Im Dienst ist kein Update-Schlüssel eingerichtet – Veröffentlichen geht erst danach.']);
    // Grenze des Formats (Format 1: 192 KB, Format 2: 544 KB); solange das Format offen ist, die größte
    const format = (chosen.manifest ?? chosen.raw)?.format;
    const envelopeMax = format === 2 ? COSMETIC_LIMITS_2.envelopeBytes : format === 1 ? COSMETIC_LIMITS.envelopeBytes : COSMETIC_MAX_ENVELOPE_BYTES;
    list.push(['ok', `Umschlag { manifest, signature }, ${formatBytes(new TextEncoder().encode(chosen.text ?? '').length)} (höchstens ${envelopeMax / 1024} KB)`]);
    if (chosen.signature === 'ok') list.push(['ok', 'Signatur gültig – mit dem Update-Schlüssel des Dienstes signiert (im Browser geprüft)']);
    else if (chosen.signature === 'fail') list.push(['fail', 'Die Signatur stimmt nicht: nicht mit dem Update-Schlüssel signiert oder nachträglich verändert.']);
    else if (chosen.signature === 'nokey') list.push(['fail', 'Ohne öffentlichen Update-Schlüssel des Dienstes lässt sich die Signatur nicht prüfen.']);
    else if (chosen.signature === 'error') list.push(['fail', `Die Signatur ließ sich nicht prüfen: ${chosen.signatureError}`]);
    if (chosen.manifest?.format === 2) {
      list.push(['ok', 'Manifest erfüllt alle Regeln von Format 2 (Slot, Textur, Mesh, Knochen, Animationen, Grenzen)']);
      list.push(['info', 'Format 2 (animiertes Mesh) zeigen Launcher und Spiel ab 0.13.8 – ältere lassen es einfach weg.']);
    } else if (chosen.manifest) list.push(['ok', 'Manifest erfüllt alle Regeln von Format 1 (Slot, Textur, Modell, Grenzen)']);
    else if (chosen.manifestError) list.push(['fail', `Manifest: ${chosen.manifestError}.`]);
    const m = chosen.manifest ?? chosen.raw;
    if (m && typeof m.id === 'string') {
      if (BUILTIN_CAPE_IDS.includes(m.id)) list.push(['fail', `Die ID „${m.id}“ gehört einem eingebauten Cape.`]);
      const existing = data?.cosmetics.find((entry) => entry.id === m.id);
      if (existing) {
        if (existing.slot !== m.slot) list.push(['fail', `„${m.id}“ gehört zum Slot ${SLOT_NAMES[existing.slot] ?? existing.slot}; den Slot ändern geht nicht (neue ID nehmen).`]);
        const higher = Number.isInteger(m.version) && existing.version !== null && m.version > existing.version;
        list.push([higher ? 'ok' : 'fail', higher ? `Neue Version ${m.version} (bisher ${existing.version}, ${wearersText(existing.wearers)})` : `Version ${m.version} ist nicht höher als die veröffentlichte ${existing.version}.`]);
        if (existing.hidden) list.push(['warn', 'Das Cosmetic ist ausgeblendet. Auch die neue Version sieht erst jemand, wenn du es wieder einblendest.']);
      } else if (data) {
        list.push(['ok', 'Neues Cosmetic – nach dem Veröffentlichen sofort im Katalog']);
      }
      const name = FILE_RE.exec(chosen.fileName);
      if (!name || name[1] !== m.id || Number(name[2]) !== m.version) list.push(['warn', `Der Dateiname passt nicht zu ID und Version (erwartet ${m.id}-${m.version}.cosmetic.json). Geprüft wird der Inhalt.`]);
      if (m.access === 'team') list.push(['info', 'Wählbar nur für Team-Mitglieder (access: team). Sehen können es alle.']);
      if (m.access === 'unlock') list.push(['info', 'Belohnung (access: unlock): wählbar nur für Spieler, die es freigeschaltet haben – zum Beispiel über Einladungen. Sehen können es alle. Freigeschaltet wird nur, was der Dienst als Belohnung kennt.']);
    }
    return list;
  }

  function renderCheck() {
    const box = $('cosmetic-pruefung');
    const actions = $('cosmetic-aktionen');
    const chosen = state.chosen;
    if (!chosen) {
      box.replaceChildren(h('p', { class: 'muted small', text: 'Sobald eine .cosmetic.json gewählt ist, stehen hier Vorschau und Prüfung.' }));
      box.classList.remove('filled');
      actions.hidden = true;
      return;
    }
    box.classList.add('filled');
    actions.hidden = false;
    const publish = $('cosmetic-veroeffentlichen');
    if (chosen.checking) {
      box.replaceChildren(loadingState('Datei wird geprüft …'));
      publish.disabled = true;
      return;
    }
    const list = checks(chosen);
    const icons = { ok: 'check', fail: 'close', warn: 'warning', info: 'info' };
    const m = chosen.manifest;
    box.replaceChildren(
      m
        ? h('div', { class: 'cosmetic-result' }, previewBlock(m), manifestFacts(m, { envelopeBytes: new TextEncoder().encode(chosen.text ?? '').length }))
        : chosen.raw
          ? h('div', { class: 'manifest-head' }, h('span', { class: 'cosmetic-slot-icon', 'aria-hidden': 'true' }, icon('sparkles')), h('div', null, h('strong', { text: typeof chosen.raw.name === 'string' ? chosen.raw.name : '?' }), h('p', { class: 'muted small', text: `${typeof chosen.raw.id === 'string' ? chosen.raw.id : '?'} · Version ${chosen.raw.version ?? '?'} · ${SLOT_TITLES[chosen.raw.slot] ?? '?'} – ohne gültige Prüfung keine Vorschau` })))
          : null,
      h('ul', { class: 'check-list', id: 'cosmetic-checks' }, list.map(([kind, text]) => h('li', { class: kind }, icon(icons[kind] ?? 'info'), h('span', { text })))),
    );
    const blocked = !m || list.some(([kind]) => kind === 'fail');
    publish.disabled = blocked;
    publish.title = blocked ? 'Erst die rot markierten Punkte klären.' : '';
  }

  async function publishChosen(event) {
    const chosen = state.chosen;
    const m = chosen?.manifest;
    if (!m || !chosen.envelope) return;
    const existing = state.data?.cosmetics.find((entry) => entry.id === m.id);
    const error = $('cosmetic-fehler');
    error.hidden = true;
    const ok = await openDialog({
      title: `${m.name} ${existing ? `Version ${m.version}` : ''} veröffentlichen?`.replace(/\s+/g, ' ').trim(),
      body: [
        h('p', {
          text: existing
            ? `Die neue Version ersetzt Version ${existing.version}. ${existing.wearers ? `${wearersText(existing.wearers)} sehen sie beim nächsten Laden des Katalogs.` : ''}`.trim()
            : `„${m.name}“ steht danach im Katalog (${SLOT_TITLES[m.slot] ?? m.slot}) – im Spiel, im Launcher und auf der Webseite${m.access === 'team' ? ', wählbar nur für das Team' : m.access === 'unlock' ? ', wählbar nur für Spieler, die es freigeschaltet haben' : ''}.`,
        }),
        h('p', { class: 'muted small', text: 'Gesendet wird der Umschlag genau so, wie er in der Datei steht. Der Dienst prüft Signatur und Regeln noch einmal.' }),
      ],
      confirmLabel: 'Veröffentlichen',
      onConfirm: async () => apply(await teamCall('PUT', '/v1/team/cosmetics', chosen.envelope)),
    });
    if (!ok) {
      event.currentTarget?.focus?.();
      return;
    }
    resetUpload();
    state.focusId = m.id;
    render();
    toast(`${m.name} ist im Katalog.`, 'success');
  }

  // -------------------------------------------------------------------------------------------------------
  // Verdrahten
  // -------------------------------------------------------------------------------------------------------

  $('cosmetic-datei').addEventListener('change', (event) => onFileChosen(event).catch(showError));
  $('cosmetic-veroeffentlichen').addEventListener('click', (event) => publishChosen(event).catch((error) => {
    const box = $('cosmetic-fehler');
    box.textContent = error.message;
    box.hidden = false;
  }));
  $('cosmetic-verwerfen').addEventListener('click', resetUpload);
  $('cosmetics-neu').addEventListener('click', (event) => busy(event.currentTarget, () => load()).catch(showError));
  $('cosmetic-filter').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-slot]');
    if (!button || button.dataset.slot === state.filter) return;
    state.filter = button.dataset.slot;
    render();
  });
  renderCheck();

  return {
    /** Bereich geöffnet; focusId: diesen Eintrag hervorheben (Suche, Links). */
    show({ focusId = null } = {}) {
      if (focusId) state.filter = 'all';
      return load({ focusId });
    },
    /** Zuletzt geladene Liste (für die Suche) oder null. */
    list: () => state.data?.cosmetics ?? null,
    /** Team-Bereich verlassen. */
    reset() {
      closePreview();
      resetUpload();
      state.data = null;
      $('cosmetic-liste').replaceChildren();
      $('cosmetic-liste').dataset.signature = '';
    },
  };
}
