// HeldixClient – Webseite: Cosmetics-Katalog (/cosmetics) mit 3D-Vorschau auf skinview3d (three.js, WebGL).
//
// Reiter je Slot (Kopf, Rücken, Aura, Begleiter, Capes). Die 13 eingebauten Capes stehen schon im HTML (die nur fürs
// Team mit data-team, Kennzeichnung wie bei Katalog-Cosmetics mit access: team); den Katalog
// lädt die Seite von GET /api/v1/cosmetics und zeigt jedes Cosmetic erst, wenn sein Umschlag im Browser geprüft ist
// (Ed25519-Signatur des HeldixClient-Teams und alle Regeln von Format 1 bzw. 2, siehe cosmetics-common.js).
// Format 2 (animierte Meshes): unter der Figur die Animationen des Cosmetics im offenen Reiter (Namen aus dem Manifest,
// Standard: Zustand idle); fährt man über die Kachel des angezogenen Cosmetics, spielt es sein Emote.
// Je Slot ist ein Cosmetic „angezogen“ – so lässt sich ein ganzes Outfit anprobieren. Adresse: /cosmetics#kopf/krone.
// Ohne WebGL zeichnet die Seite eine 2D-Ansicht. Mit Anmeldung: „Mit meinem Skin anprobieren“.
// Belohnungen für Einladungen (access: unlock) kann jeder anprobieren; sie tragen ein Schloss und den Weg zum
// Freischalten. Angemeldet fragt die Seite GET /api/v1/me/cosmetics (unlocked), was schon freigeschaltet ist.
import { api, h, icon, toast } from './app-common.js';
import {
  COSMETIC_SLOTS,
  CosmeticError,
  SLOT_HASHES,
  SLOT_NAMES,
  SLOT_TITLES,
  animationButtons,
  cosmeticAnimated,
  cosmeticAnimations,
  cosmeticsKeyAvailable,
  createCosmeticLayer,
  drawCosmeticPreview,
  loadCosmeticCatalog,
  loadVerifiedCosmetics,
  prepareBuiltinCape,
  prepareCosmetic,
} from './cosmetics-common.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DATE = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
const MOTION_TEXT = { rise: 'steigen auf', fall: 'rieseln herab', orbit: 'kreisen um dich', spark: 'funkeln auf', float: 'schweben um dich' };
/** Von wo die Figur zu sehen ist, wenn man einen Reiter öffnet (Drehung um y; Rücken/Cape: von hinten). */
const VIEW_YAW = { head: 0.45, back: Math.PI * 0.82, aura: 0.35, companion: 0.55, cape: Math.PI * 0.82 };
/** Blickrichtung je Reiter; Format-2-Begleiter von ihrer Seite (links gebaut, rechts gespiegelt). */
function viewYaw(slot) {
  const manifest = worn(slot)?.manifest;
  if (slot === 'companion' && manifest?.format === 2) return manifest.attach?.side === 'right' ? 0.75 : -0.75;
  return VIEW_YAW[slot];
}
const SLOT_FROM_HASH = Object.fromEntries(Object.entries(SLOT_HASHES).map(([slot, hash]) => [hash, slot]));

const $ = (id) => document.getElementById(id);
const page = document.querySelector('.cosmetics-page');
const host = $('cosmetic-viewer');
const canvas = $('cosmetic-canvas');
const flat = $('cosmetic-flach');
const picker = $('cosmetic-auswahl');
const tabs = [...document.querySelectorAll('#cosmetic-slots [role="tab"]')];
const els = {
  slotName: $('cosmetic-slot-name'),
  name: $('cosmetic-name'),
  description: $('cosmetic-beschreibung'),
  chips: $('cosmetic-chips'),
  meta: $('cosmetic-meta'),
  remove: $('cosmetic-ablegen'),
  status: $('cosmetic-status'),
  outfit: $('cosmetic-outfit'),
  overview: $('cosmetic-ueberblick'),
  elytra: $('cosmetic-elytra'),
  anim: $('cosmetic-animation'),
  skin: $('cosmetic-mein-skin'),
  hint: $('viewer-hinweis'),
  anims: $('cosmetic-animationen'),
};

/** Alle Einträge je Slot: { key, slot, id, name, description, builtin, manifest?, entry?, cape?, art? } */
const items = Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, []]));
const state = {
  active: 'head',
  /** angezogen je Slot: key oder null */
  outfit: Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, null])),
  /** Slots, die man selbst abgelegt hat (dort nicht von allein etwas anziehen) */
  emptied: new Set(),
  /** laden | fertig | fehler | ohne-pruefung */
  catalog: 'laden',
  rejected: [],
  playing: !reduceMotion,
  elytra: false,
  visible: true,
  wantedHash: null,
  tokens: Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, 0])),
  ownSkin: false,
  /** freigeschaltete Belohnungen (angemeldet, Dienst ab 1.11.0); null = unbekannt */
  unlocked: null,
  /** Format 2: gewählte Animation je Eintrag (key → Name) */
  anims: new Map(),
};
let viewer = null;
let layer = null;

const find = (key) => (key ? COSMETIC_SLOTS.flatMap((slot) => items[slot]).find((item) => item.key === key) : null) ?? null;
const worn = (slot) => find(state.outfit[slot]);

// ---------------------------------------------------------------------------------------------------------
// Einträge
// ---------------------------------------------------------------------------------------------------------

/** Eingebaute Capes aus den Knöpfen im HTML (Daten aus capes.json der Mod). */
function readBuiltinCapes() {
  for (const button of picker.querySelectorAll('.cape-pick[data-cape]')) {
    const { cape, name, beschreibung, frames, fps, glow, team } = button.dataset;
    items.cape.push({
      key: `cape:${cape}`,
      slot: 'cape',
      id: cape,
      name,
      description: beschreibung,
      builtin: true,
      cape: { id: cape, name, description: beschreibung, frames: Number(frames) || 1, fps: Number(fps) || 10, glow: glow === '1', team: team === '1' },
    });
  }
}

/** Nur für das HeldixClient-Team: Katalog-Cosmetics mit access: team und eingebaute Team-Capes. */
const teamOnly = (item) => (item.builtin ? item.cape.team === true : item.manifest?.access === 'team');
/** Belohnung für Einladungen (access: unlock) – und ob der angemeldete Spieler sie schon hat. */
const rewardOnly = (item) => !item.builtin && item.manifest?.access === 'unlock';
const rewardUnlocked = (item) => rewardOnly(item) && state.unlocked?.has(item.id) === true;
const INVITE_HREF = '/konto#reiter=freunde&teil=einladen';

const preparedCache = new Map();
function prepare(item) {
  if (!preparedCache.has(item.key)) {
    const promise = item.builtin ? prepareBuiltinCape(item.cape) : prepareCosmetic(item.manifest);
    promise.catch(() => preparedCache.delete(item.key));
    preparedCache.set(item.key, promise);
  }
  return preparedCache.get(item.key);
}

function addCatalogItem(entry, manifest) {
  const item = { key: `katalog:${manifest.id}`, slot: manifest.slot, id: manifest.id, name: manifest.name, description: manifest.description, builtin: false, manifest, entry };
  const list = items[manifest.slot];
  // Reihenfolge des Katalogs (Slot, dann Name); eingebaute Capes zuerst
  list.push(item);
  return item;
}

// ---------------------------------------------------------------------------------------------------------
// Auswahl (Reiter, Knöpfe, Info)
// ---------------------------------------------------------------------------------------------------------

function artFor(item) {
  if (item.builtin) return h('span', { class: 'cape-art', dataset: { cape: item.id }, 'aria-hidden': 'true' });
  // Katalog-Capes im selben Hochformat wie die eingebauten (Vorderseite des Capes)
  const cape = item.slot === 'cape';
  // Als Bild (data-URL) statt als Leinwand: Bilder behalten ihren Inhalt, auch wenn der Browser 2D-Leinwände verwirft
  const art = h('img', { class: `cosmetic-art${cape ? ' cape-thumb' : ''}`, alt: '', width: cape ? '80' : '112', height: cape ? '122' : '112', dataset: { slot: item.slot } });
  thumbnail(item, cape)
    .then((url) => {
      art.src = url;
      art.dataset.gezeichnet = 'ja';
    })
    .catch(() => art.classList.add('broken'));
  return art;
}

const thumbnails = new Map();
/** Vorschaubild eines Katalog-Cosmetics als PNG-data-URL (einmal je Cosmetic gezeichnet). */
function thumbnail(item, cape) {
  if (!thumbnails.has(item.key)) {
    const promise = prepare(item).then((prepared) => {
      const canvas = document.createElement('canvas');
      canvas.width = cape ? 80 : 112;
      canvas.height = cape ? 122 : 112;
      drawCosmeticPreview(canvas, prepared, cape ? { padding: 0 } : undefined);
      return canvas.toDataURL('image/png');
    });
    promise.catch(() => thumbnails.delete(item.key));
    thumbnails.set(item.key, promise);
  }
  return thumbnails.get(item.key);
}

function pickButton(item) {
  const checked = state.outfit[item.slot] === item.key;
  return h(
    'button',
    {
      class: `cape-pick cosmetic-pick${item.builtin ? '' : ' katalog'}`,
      type: 'button',
      role: 'radio',
      'aria-checked': String(checked),
      tabindex: '-1',
      dataset: { key: item.key, id: item.id, slot: item.slot },
    },
    artFor(item),
    h('span', { class: 'cape-pick-name', text: item.name }),
    teamOnly(item) ? h('span', { class: 'cosmetic-pick-badge', title: 'Nur für das HeldixClient-Team' }, icon('shield')) : null,
    rewardOnly(item) ? h('span', { class: 'cosmetic-pick-badge reward', title: rewardUnlocked(item) ? 'Belohnung für Einladungen – freigeschaltet' : 'Belohnung für Einladungen' }, icon(rewardUnlocked(item) ? 'check' : 'lock')) : null,
  );
}

function renderTabs() {
  for (const tab of tabs) {
    const slot = tab.dataset.slot;
    const selected = slot === state.active;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    const count = tab.querySelector('[data-anzahl]');
    count.textContent = slot === 'cape' || state.catalog === 'fertig' || items[slot].length ? String(items[slot].length) : state.catalog === 'laden' ? '…' : '0';
  }
  $('cosmetic-panel').setAttribute('aria-labelledby', `slot-${SLOT_HASHES[state.active]}`);
}

function pickerMessage(text, iconName, action = null) {
  return h('div', { class: 'cosmetic-picker-state', role: 'status' }, icon(iconName), h('p', { text }), action);
}

function renderPicker() {
  const list = items[state.active];
  picker.setAttribute('aria-label', `${SLOT_TITLES[state.active]} wählen`);
  picker.dataset.slot = state.active;
  if (!list.length) {
    picker.setAttribute('role', 'group');
    if (state.catalog === 'laden') picker.replaceChildren(pickerMessage('Cosmetics werden geladen und geprüft …', 'hourglass'));
    else if (state.catalog === 'fehler') picker.replaceChildren(pickerMessage('Der Katalog ist gerade nicht erreichbar.', 'warning', h('button', { class: 'btn btn--secondary btn--sm', type: 'button', onClick: loadCatalog }, icon('refresh'), 'Erneut versuchen')));
    else if (state.catalog === 'ohne-pruefung') picker.replaceChildren(pickerMessage('Dein Browser kann die Signaturen der Cosmetics nicht prüfen – deshalb zeigt die Seite hier nichts an.', 'lock'));
    else picker.replaceChildren(pickerMessage(`Unter „${SLOT_TITLES[state.active]}“ gibt es noch keine Cosmetics. Schau bald wieder vorbei.`, 'sparkles'));
    return;
  }
  picker.setAttribute('role', 'radiogroup');
  const buttons = list.map(pickButton);
  picker.replaceChildren(...buttons);
  const focusable = buttons.find((button) => button.getAttribute('aria-checked') === 'true') ?? buttons[0];
  focusable.tabIndex = 0;
}

function chip(text, className = '', iconName = null, title = null) {
  return h('span', { class: `chip${className ? ` ${className}` : ''}`, title }, iconName ? icon(iconName) : null, text);
}

function renderInfo() {
  const slot = state.active;
  const item = worn(slot);
  els.slotName.textContent = SLOT_TITLES[slot];
  els.remove.hidden = !item;
  renderRewardHint(item);
  els.remove.querySelector('span').textContent = slot === 'cape' ? 'Cape ablegen' : 'Ablegen';
  if (!item) {
    els.name.textContent = items[slot].length ? 'Nichts angezogen' : SLOT_TITLES[slot];
    els.description.textContent = items[slot].length ? 'Wähle unten ein Cosmetic, um es anzuprobieren.' : '';
    els.chips.replaceChildren();
    els.meta.textContent = '';
    return;
  }
  els.name.textContent = item.name;
  els.description.textContent = item.description || '';
  const chips = [];
  const meta = [];
  if (item.builtin) {
    chips.push(chip('Eingebaut', 'accent', 'cape', 'Kommt mit HeldixClient'));
    if (item.cape.team) chips.push(chip('Nur fürs Team', 'warning', 'shield', 'Tragen können es nur Mitglieder des HeldixClient-Teams'));
    if (item.cape.glow) chips.push(chip('leuchtet', 'accent'));
    meta.push(`${item.cape.frames} Bilder, ${item.cape.fps} pro Sekunde${item.cape.glow ? ' · leuchtet im Dunkeln' : ''}`);
  } else {
    const { manifest } = item;
    chips.push(chip('Signatur geprüft', 'success', 'check', 'Vom HeldixClient-Team signiert – in deinem Browser geprüft'));
    if (manifest.access === 'team') chips.push(chip('Nur fürs Team', 'warning', 'shield', 'Tragen können es nur Mitglieder des HeldixClient-Teams'));
    if (manifest.access === 'unlock') {
      chips.push(chip('Belohnung für Einladungen', 'accent', rewardUnlocked(item) ? 'sparkles' : 'lock', 'Tragen kann es, wer es über Einladungen freigeschaltet hat'));
      if (rewardUnlocked(item)) chips.push(chip('Freigeschaltet', 'success', 'check', 'Du hast es freigeschaltet'));
    }
    if (manifest.glow) chips.push(chip('leuchtet', 'accent'));
    const mesh = manifest.format === 2;
    if ((mesh || (manifest.slot !== 'aura' && manifest.slot !== 'cape')) && cosmeticAnimated(manifest)) chips.push(chip('bewegt sich', 'accent'));
    if (mesh) {
      const count = Object.keys(manifest.animations).length;
      meta.push(count === 1 ? '1 Animation' : `${count} Animationen`);
    } else if (manifest.slot === 'aura') meta.push(`Partikel, die ${MOTION_TEXT[manifest.particles.motion]}`);
    if (manifest.slot === 'cape') meta.push(`${manifest.cape.frames === 1 ? '1 Bild' : `${manifest.cape.frames} Bilder, ${manifest.cape.fps} pro Sekunde`}`);
    if (manifest.slot === 'companion') meta.push('Begleitet dich im Spiel');
    meta.push(`Version ${manifest.version}`);
    const date = Date.parse(manifest.date);
    if (Number.isFinite(date)) meta.push(DATE.format(date));
  }
  els.chips.replaceChildren(...chips);
  els.meta.textContent = meta.join(' · ');
  renderAnimations();
}

/**
 * Format 2: Animationen des Cosmetics im offenen Reiter unter der Figur (nur mit 3D-Ansicht). Gewählt wird je Eintrag;
 * ohne Wahl läuft der Zustand idle.
 */
function renderAnimations() {
  const box = els.anims;
  if (!box) return;
  const item = worn(state.active);
  const info = layer?.supported && item?.manifest ? cosmeticAnimations(item.manifest) : null;
  if (!info || info.clips.length < 2) {
    box.hidden = true;
    box.replaceChildren();
    delete box.dataset.cosmetic;
    return;
  }
  const active = state.anims.get(item.key) ?? info.idle;
  box.hidden = false;
  box.dataset.cosmetic = item.id;
  box.dataset.animation = active ?? '';
  box.setAttribute('aria-label', `Animation von ${item.name}`);
  box.replaceChildren(
    ...animationButtons(info, active, (name) => {
      state.anims.set(item.key, name);
      layer?.setAnimation(item.slot, name);
      renderAnimations();
    }),
  );
}

/** Unter der Beschreibung: wie man eine Belohnung freischaltet (oder: schon freigeschaltet → im Konto tragen). */
function renderRewardHint(item) {
  const box = $('cosmetic-belohnung');
  if (!box) return;
  if (!item || !rewardOnly(item)) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  if (rewardUnlocked(item)) {
    box.replaceChildren(icon('sparkles'), h('span', null, 'Du hast es freigeschaltet. ', h('a', { href: `/konto#reiter=profil&platz=${SLOT_HASHES[item.slot]}`, text: 'Im Konto tragen' })));
  } else {
    box.replaceChildren(icon('lock'), h('span', null, 'Belohnung für Einladungen: Lade Freunde zu HeldixClient ein – kommen sie neu dazu und spielen 30 Minuten, schaltest du es frei. ', h('a', { href: INVITE_HREF, text: 'Freunde einladen' })));
  }
  box.hidden = false;
  box.dataset.freigeschaltet = rewardUnlocked(item) ? 'ja' : 'nein';
}

function renderOutfit() {
  const entries = COSMETIC_SLOTS.map((slot) => [slot, worn(slot)]).filter(([, item]) => item);
  els.outfit.replaceChildren(
    ...(entries.length
      ? entries.map(([slot, item]) =>
          h(
            'li',
            { dataset: { slot } },
            h('button', { class: 'outfit-jump', type: 'button', title: `Zu ${SLOT_TITLES[slot]}`, onClick: () => selectSlot(slot, { focus: true }) }, h('span', { class: 'outfit-slot', text: SLOT_NAMES[slot] }), h('span', { text: item.name })),
            h('button', { class: 'icon-button small outfit-remove', type: 'button', 'aria-label': `${item.name} ablegen`, title: 'Ablegen', onClick: () => takeOff(slot) }, icon('close')),
          ),
        )
      : [h('li', { class: 'muted small', text: 'Gerade trägt die Figur nichts.' })]),
  );
  for (const slot of COSMETIC_SLOTS) host.dataset[`traegt${slot[0].toUpperCase()}${slot.slice(1)}`] = worn(slot)?.id ?? '';
}

function renderOverview() {
  const groups = COSMETIC_SLOTS.filter((slot) => items[slot].length).map((slot) =>
    h(
      'div',
      { class: 'cosmetic-overview-group' },
      h('h3', { text: `${SLOT_TITLES[slot]} (${items[slot].length})` }),
      h(
        'ul',
        null,
        items[slot].map((item) =>
          h(
            'li',
            null,
            h('a', { href: `#${SLOT_HASHES[slot]}/${item.id}`, text: item.name }),
            item.description ? ` – ${item.description}` : '',
            teamOnly(item) ? h('span', { class: 'chip warning', text: 'nur Team' }) : null,
            rewardOnly(item) ? h('span', { class: 'chip accent', text: 'Belohnung für Einladungen' }) : null,
          ),
        ),
      ),
    ),
  );
  els.overview.replaceChildren(...groups);
}

function updateHash() {
  const item = worn(state.active);
  const hash = `#${SLOT_HASHES[state.active]}${item ? `/${item.id}` : ''}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function setStatus(text, kind = 'info') {
  els.status.hidden = !text;
  els.status.textContent = text || '';
  els.status.dataset.art = kind;
}

// ---------------------------------------------------------------------------------------------------------
// 3D und 2D
// ---------------------------------------------------------------------------------------------------------

/** Kann der Browser WebGL? (Vorher prüfen, damit three.js nicht erst einen Fehler in die Konsole schreibt.) */
function webglAvailable() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

function createViewer() {
  const lib = window.skinview3d;
  if (!lib || !webglAvailable()) return null;
  try {
    const created = new lib.SkinViewer({ canvas, width: host.clientWidth || 480, height: host.clientHeight || 520, skin: '/assets/standard-skin.png', fov: 40, zoom: 0.66 });
    created.autoRotate = !reduceMotion;
    created.autoRotateSpeed = 0.55;
    created.playerWrapper.rotation.y = viewYaw(state.active);
    const controls = created.controls;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.28;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.addEventListener('start', () => {
      created.autoRotate = false;
      els.hint.hidden = true;
    });
    new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) created.setSize(host.clientWidth, host.clientHeight);
    }).observe(host);
    return created;
  } catch {
    return null;
  }
}

/** Zoom: Begleiter stehen neben der Figur – dann etwas weiter weg. */
function updateZoom() {
  if (!viewer) return;
  const zoom = worn('companion') ? 0.5 : 0.66;
  if (Math.abs(viewer.zoom - zoom) > 0.001) viewer.zoom = zoom;
}

async function drawFlat() {
  if (viewer || !flat) return;
  const item = worn(state.active);
  const context = flat.getContext('2d');
  if (!item) {
    context.clearRect(0, 0, flat.width, flat.height);
    return;
  }
  try {
    const prepared = await prepare(item);
    if (worn(state.active) !== item) return;
    drawCosmeticPreview(flat, prepared, { padding: 0.16 });
  } catch {
    context.clearRect(0, 0, flat.width, flat.height);
  }
}

/** Cosmetic in der Ansicht an- oder ablegen (lädt die Bilder, alte Anfragen verfallen). */
async function show(slot) {
  const item = worn(slot);
  const token = ++state.tokens[slot];
  updateZoom();
  if (!layer) {
    if (slot === state.active) drawFlat();
    return;
  }
  if (!item) {
    layer.wear(slot, null);
    return;
  }
  host.classList.add('loading');
  try {
    const prepared = await prepare(item);
    if (token !== state.tokens[slot]) return;
    layer.wear(slot, prepared);
    // Format 2: zuvor gewählte Animation wieder abspielen
    if (state.anims.has(item.key)) layer.setAnimation(slot, state.anims.get(item.key));
    host.dataset.geladen = item.id;
    if (slot === state.active) renderAnimations();
  } catch {
    if (token === state.tokens[slot]) toast(`„${item.name}“ ließ sich gerade nicht laden.`, 'error');
  } finally {
    if (token === state.tokens[slot]) host.classList.remove('loading');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Bedienung
// ---------------------------------------------------------------------------------------------------------

function wear(item, { focus = false } = {}) {
  state.outfit[item.slot] = item.key;
  state.emptied.delete(item.slot);
  if (item.slot === state.active) {
    for (const button of picker.querySelectorAll('.cosmetic-pick')) {
      const checked = button.dataset.key === item.key;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
      if (checked && focus) button.focus();
    }
    renderInfo();
    updateHash();
  }
  renderOutfit();
  show(item.slot);
}

function takeOff(slot) {
  state.outfit[slot] = null;
  state.emptied.add(slot);
  if (slot === state.active) {
    for (const button of picker.querySelectorAll('.cosmetic-pick')) button.setAttribute('aria-checked', 'false');
    const first = picker.querySelector('.cosmetic-pick');
    if (first) first.tabIndex = 0;
    renderInfo();
    updateHash();
  }
  renderOutfit();
  show(slot);
}

/** Reiter öffnen; ist dort nichts angezogen (und nicht selbst abgelegt), das erste Cosmetic anziehen. */
function selectSlot(slot, { focus = false, item = null } = {}) {
  const changed = state.active !== slot;
  state.active = slot;
  renderTabs();
  if (focus) tabs.find((tab) => tab.dataset.slot === slot)?.focus();
  if (item) {
    state.outfit[slot] = item.key;
    state.emptied.delete(slot);
  } else if (!worn(slot) && !state.emptied.has(slot) && items[slot].length) {
    state.outfit[slot] = items[slot][0].key;
  }
  renderPicker();
  renderInfo();
  renderOutfit();
  els.elytra.hidden = !viewer || slot !== 'cape';
  if (viewer && changed) viewer.playerWrapper.rotation.y = viewYaw(slot);
  updateHash();
  show(slot);
}

function setupTabs() {
  const list = $('cosmetic-slots');
  list.addEventListener('click', (event) => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectSlot(tab.dataset.slot);
  });
  list.addEventListener('keydown', (event) => {
    const index = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next = null;
    if (step) next = tabs[(index + step + tabs.length) % tabs.length];
    else if (event.key === 'Home') next = tabs[0];
    else if (event.key === 'End') next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    selectSlot(next.dataset.slot, { focus: true });
  });
}

function setupPicker() {
  picker.addEventListener('click', (event) => {
    const button = event.target.closest('.cosmetic-pick');
    const item = button && find(button.dataset.key);
    if (item) wear(item);
  });
  // Format 2: über der Kachel des angezogenen Cosmetics spielt es sein Emote
  let emoting = null;
  const hover = (event) => {
    const button = event.target.closest?.('.cosmetic-pick');
    const item = button && find(button.dataset.key);
    const slot = item && item.manifest?.format === 2 && state.outfit[item.slot] === item.key ? item.slot : null;
    if (slot === emoting) return;
    if (emoting) layer?.emote(emoting, false);
    emoting = slot;
    if (slot) layer?.emote(slot, true);
  };
  picker.addEventListener('pointerover', hover);
  picker.addEventListener('pointerleave', () => hover({ target: picker }));
  picker.addEventListener('focusin', hover);
  picker.addEventListener('focusout', () => hover({ target: picker }));
  picker.addEventListener('keydown', (event) => {
    const buttons = [...picker.querySelectorAll('.cosmetic-pick')];
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next = null;
    if (step) next = buttons[(index + step + buttons.length) % buttons.length];
    else if (event.key === 'Home') next = buttons[0];
    else if (event.key === 'End') next = buttons[buttons.length - 1];
    if (!next) return;
    event.preventDefault();
    const item = find(next.dataset.key);
    if (item) wear(item, { focus: true });
  });
  els.remove.addEventListener('click', () => takeOff(state.active));
}

function setupControls() {
  els.elytra.addEventListener('click', () => {
    state.elytra = !state.elytra;
    els.elytra.setAttribute('aria-pressed', String(state.elytra));
    layer?.setElytra(state.elytra);
  });
  const updateAnimButton = () => {
    els.anim.setAttribute('aria-pressed', String(state.playing));
    els.anim.querySelector('span').textContent = state.playing ? 'Animation anhalten' : 'Animation abspielen';
    els.anim.querySelector('.icon')?.replaceWith(icon(state.playing ? 'pause' : 'play'));
  };
  els.anim.addEventListener('click', () => {
    state.playing = !state.playing;
    if (viewer && !reduceMotion) viewer.autoRotate = state.playing;
    layer?.setPlaying(state.playing);
    updateAnimButton();
  });
  updateAnimButton();
  // Nur rechnen, wenn man die Figur sieht
  const pause = () => {
    if (viewer) viewer.renderPaused = !state.visible || document.hidden;
  };
  new IntersectionObserver((entries) => {
    state.visible = entries.some((entry) => entry.isIntersecting);
    pause();
  }).observe(host);
  document.addEventListener('visibilitychange', pause);
}

async function offerOwnSkin() {
  let me;
  try {
    me = await api('GET', '/v1/web/me');
  } catch {
    return; // nicht angemeldet: Knopf bleibt versteckt
  }
  if (!me?.uuid) return;
  loadUnlocked();
  if (!viewer) return;
  els.skin.hidden = false;
  els.skin.addEventListener('click', async () => {
    els.skin.disabled = true;
    try {
      if (state.ownSkin) {
        await viewer.loadSkin('/assets/standard-skin.png');
        state.ownSkin = false;
      } else {
        await viewer.loadSkin(`/api/v1/skins/${encodeURIComponent(me.uuid)}`, { model: 'auto-detect' });
        state.ownSkin = true;
      }
      els.skin.querySelector('span').textContent = state.ownSkin ? 'Standard-Skin' : 'Mit meinem Skin anprobieren';
      host.dataset.skin = state.ownSkin ? 'eigener' : 'standard';
    } catch {
      toast('Dein Skin ist gerade nicht abrufbar. Er erscheint, sobald du einmal mit HeldixClient gespielt hast.', 'error');
    } finally {
      els.skin.disabled = false;
    }
  });
}

/** Angemeldet: freigeschaltete Belohnungen holen (älterer Dienst ohne `unlocked`: bleibt unbekannt). */
async function loadUnlocked() {
  try {
    const data = await api('GET', '/v1/me/cosmetics');
    if (!Array.isArray(data?.unlocked)) return;
    state.unlocked = new Set(data.unlocked.filter((id) => typeof id === 'string'));
  } catch {
    return;
  }
  renderPicker();
  renderInfo();
}

// ---------------------------------------------------------------------------------------------------------
// Katalog laden und prüfen
// ---------------------------------------------------------------------------------------------------------

/** #kopf/krone → { slot, id } */
function parseHash() {
  const raw = decodeURIComponent(location.hash.slice(1));
  const [slotHash, id = ''] = raw.split('/');
  const slot = SLOT_FROM_HASH[slotHash];
  return slot ? { slot, id } : null;
}

function applyWantedHash() {
  const wanted = state.wantedHash;
  if (!wanted) return;
  const item = wanted.id ? items[wanted.slot].find((entry) => entry.id === wanted.id) : null;
  // Noch nicht geprüft? Dann wartet der Wunsch auf den Katalog.
  if (wanted.id && !item && state.catalog === 'laden') return;
  state.wantedHash = null;
  if (wanted.id && !item) setStatus(`„${wanted.id}“ gibt es im Katalog nicht (mehr).`, 'warn');
  selectSlot(wanted.slot, { item });
}

function rejectionText(rejected) {
  const reasons = new Set(rejected.map(({ error }) => error.reason));
  const n = rejected.length;
  const what = n === 1 ? '1 Cosmetic zeigt die Seite nicht' : `${n} Cosmetics zeigt die Seite nicht`;
  if (reasons.has('signature')) return `${what}: Die Signatur stimmt nicht – es stammt nicht vom HeldixClient-Team oder wurde verändert.`;
  if (reasons.has('network')) return `${what}, weil es sich gerade nicht laden ließ.`;
  return `${what}, weil es nicht den Regeln für Cosmetics entspricht.`;
}

async function loadCatalog() {
  state.catalog = 'laden';
  page.dataset.katalog = 'laden';
  setStatus('');
  renderTabs();
  renderPicker();
  if (!cosmeticsKeyAvailable()) {
    state.catalog = 'ohne-pruefung';
    page.dataset.katalog = 'ohne-pruefung';
    setStatus('Die Cosmetics aus dem Katalog lassen sich hier nicht prüfen (öffentlicher Schlüssel oder WebCrypto fehlt). Die eingebauten Capes siehst du trotzdem.', 'warn');
    renderTabs();
    renderPicker();
    return;
  }
  let entries;
  try {
    entries = await loadCosmeticCatalog();
  } catch {
    state.catalog = 'fehler';
    page.dataset.katalog = 'fehler';
    setStatus('Der Cosmetics-Katalog ist gerade nicht erreichbar. Die eingebauten Capes siehst du trotzdem.', 'warn');
    renderTabs();
    renderPicker();
    return;
  }
  // Schon geladene Einträge (erneuter Versuch) nicht doppelt aufnehmen
  for (const slot of COSMETIC_SLOTS) items[slot] = items[slot].filter((item) => item.builtin);
  let pendingRender = 0;
  const scheduleRender = (slot) => {
    if (slot !== state.active || pendingRender) return;
    pendingRender = requestAnimationFrame(() => {
      pendingRender = 0;
      renderPicker();
    });
  };
  const { rejected } = await loadVerifiedCosmetics(entries, {
    onItem: (entry, manifest) => {
      if (!manifest) return;
      addCatalogItem(entry, manifest);
      renderTabs();
      scheduleRender(manifest.slot);
    },
  });
  // Reihenfolge wie im Katalog (die Prüfungen werden in beliebiger Reihenfolge fertig)
  const order = new Map(entries.map((entry, index) => [entry.id, index]));
  for (const slot of COSMETIC_SLOTS) items[slot].sort((a, b) => (a.builtin === b.builtin ? (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0) : a.builtin ? -1 : 1));
  state.rejected = rejected;
  state.catalog = 'fertig';
  page.dataset.katalog = 'fertig';
  page.dataset.geprueft = String(entries.length - rejected.length);
  page.dataset.abgelehnt = String(rejected.length);
  if (rejected.some(({ error }) => error instanceof CosmeticError && error.reason === 'unsupported')) {
    setStatus('Dein Browser kann die Signaturen der Cosmetics nicht prüfen (Ed25519). Nimm einen aktuellen Chrome, Edge, Firefox oder Safari – bis dahin siehst du nur die eingebauten Capes.', 'warn');
  } else if (rejected.length) setStatus(rejectionText(rejected), 'warn');
  if (pendingRender) cancelAnimationFrame(pendingRender);
  pendingRender = 0;
  renderTabs();
  if (state.wantedHash) applyWantedHash();
  else selectSlot(state.active);
  renderOverview();
}

// ---------------------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------------------

readBuiltinCapes();
state.outfit.cape = items.cape[0]?.key ?? null;
const initial = parseHash();
if (initial) {
  state.active = initial.slot;
  state.wantedHash = initial;
}

viewer = createViewer();
if (viewer) {
  layer = createCosmeticLayer(viewer, { idle: !reduceMotion, playing: state.playing });
  if (!layer.supported) {
    // three.js-Klassen nicht erreichbar: Figur und Capes in 3D, die übrigen Cosmetics nur als Bild
    setStatus('Die 3D-Ansicht kann hier nur Capes zeigen – Hüte, Flügel, Auren und Begleiter erscheinen als Bild in der Auswahl.', 'info');
  }
}
host.dataset.webgl = viewer ? 'ja' : 'nein';
if (!viewer) {
  // Verwirft der Browser die Leinwand (z. B. nach einer Größenänderung), neu zeichnen
  flat.addEventListener('contextrestored', drawFlat);
  canvas.hidden = true;
  els.hint.hidden = true;
  flat.hidden = false;
  $('viewer-ersatz').hidden = false;
  els.anim.hidden = true;
}
els.elytra.hidden = !viewer || state.active !== 'cape';
if (reduceMotion) els.hint.textContent = 'Ziehen zum Drehen · Animation mit „Animation abspielen“';

setupTabs();
setupPicker();
setupControls();
renderTabs();
renderPicker();
renderInfo();
renderOutfit();
updateHash();
show('cape');
if (state.wantedHash && !state.wantedHash.id) applyWantedHash();
else if (state.wantedHash && state.wantedHash.slot === 'cape') applyWantedHash();
window.addEventListener('hashchange', () => {
  const wanted = parseHash();
  if (!wanted) return;
  const current = worn(state.active);
  if (wanted.slot === state.active && (wanted.id || '') === (current?.id ?? '')) return;
  state.wantedHash = wanted;
  applyWantedHash();
});
loadCatalog();
offerOwnSkin();
