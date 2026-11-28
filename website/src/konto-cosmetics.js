// HeldixClient – Webseite: Konto → „Cape & Cosmetics“.
//
// Plätze (Slots): Cape (eingebaute Heldix-Capes und Katalog-Capes), Kopf, Rücken, Aura, Begleiter. Der Katalog kommt
// vom Heldix-Dienst (GET /v1/cosmetics, Umschläge GET /v1/cosmetics/<id>?v=<sha256>); jedes Cosmetic erscheint erst,
// wenn seine Ed25519-Signatur und alle Regeln von Format 1 bzw. 2 im Browser geprüft sind (cosmetics-common.js, Schlüssel
// aus /update-key.js). Cosmetics „nur fürs Team“ sieht und wählt nur, wer im Team ist. Eingebaute Team-Capes (capes.json:
// "team": true) sehen alle; wählbar sind sie wie im Heldix-Menü nur im Team, sonst gesperrt. Ob der Spieler im
// Team ist, sagt GET/PUT /v1/me/cosmetics (`team`); ohne diese Antwort gilt die Rolle aus /v1/web/me.
// Belohnungen für Einladungen (access: unlock) sehen alle; wählbar sind sie erst, wenn ihre ID in `unlocked` steht
// (GET/PUT /v1/me/cosmetics, Dienst ab 1.11.0) – sonst mit Schloss und Weg zu Freunde → „Freunde einladen“.
// Auswahl: GET/PUT /v1/me/cosmetics ({ slot, id | null }); eingebaute Capes wie bisher über PUT /v1/me ({ cape }), so
// geht die Cape-Wahl auch mit einem Dienst ohne Cosmetics. Gespeichert wird sofort (nach kurzer Pause, damit
// Pfeiltasten nicht jeden Schritt senden).
// Vorschau: skinview3d (wird erst beim Öffnen des Bereichs geladen) mit den Meshes aus dem Manifest
// (createCosmeticLayer); ohne WebGL zeichnet die Seite die Auswahl als 2D-Bilder (drawCosmeticPreview).
import { avatar, CAPES, capeName, flashSaved, h, icon, rerender, setupTabs, showError, teamCape } from './app-common.js';
import {
  COSMETIC_SLOTS,
  animationButtons,
  cosmeticAnimated,
  cosmeticAnimations,
  cosmeticsKeyAvailable,
  createCosmeticLayer,
  drawCosmeticPreview,
  loadBuiltinCapes,
  loadCosmetic,
  loadCosmeticCatalog,
  loadVerifiedCosmetics,
  prepareBuiltinCape,
  prepareCosmetic,
  SLOT_HASHES,
} from './cosmetics-common.js';

const SAVE_DELAY = 350;
const THUMB = 112;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Plätze in der Reihenfolge der Reiter. */
const SLOTS = [
  { slot: 'cape', label: 'Cape', none: 'Kein Cape', saved: 'Cape gespeichert', removed: 'Kein Cape gewählt', icon: 'cape' },
  { slot: 'head', label: 'Kopf', none: 'Nichts', saved: 'Kopfschmuck gespeichert', removed: 'Kopfschmuck abgelegt', icon: 'krone' },
  { slot: 'back', label: 'Rücken', none: 'Nichts', saved: 'Rücken gespeichert', removed: 'Rücken abgelegt', icon: 'fluegel' },
  { slot: 'aura', label: 'Aura', none: 'Keine', saved: 'Aura gespeichert', removed: 'Aura abgelegt', icon: 'sparkles' },
  { slot: 'companion', label: 'Begleiter', none: 'Keiner', saved: 'Begleiter gespeichert', removed: 'Begleiter abgelegt', icon: 'begleiter' },
];
const SLOT = Object.fromEntries(SLOTS.map((entry) => [entry.slot, entry]));
const HASH_TO_SLOT = Object.fromEntries(Object.entries(SLOT_HASHES).map(([slot, hash]) => [hash, slot]));

// Symbole, die das Heldix-Icon-Set nicht hat (24er-Raster, Strich 2 – wie die übrigen)
const SLOT_ICONS = {
  krone: ['M4 17.5 L5 8 L9.5 12 L12 6 L14.5 12 L19 8 L20 17.5 Z', 'M4.5 20.5 H19.5'],
  fluegel: ['M11 8.5 C7.5 4.5 3.5 5 2.5 7.5 C3.5 12.5 7.5 15 11 15 Z', 'M13 8.5 C16.5 4.5 20.5 5 21.5 7.5 C20.5 12.5 16.5 15 13 15 Z', 'M12 8 V18'],
  begleiter: ['M6 20 V11 A6 6 0 0 1 18 11 V20 L15.5 18 L13.5 20 L12 18.5 L10.5 20 L8.5 18 Z', 'M9.5 11.5 H9.51', 'M14.5 11.5 H14.51'],
};
const SVG_NS = 'http://www.w3.org/2000/svg';
function slotIcon(name) {
  const paths = SLOT_ICONS[name];
  if (!paths) return icon(name);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

/**
 * Eigenen Skin als Bild laden – gleiche Adresse und Art wie die Köpfe in den Listen (app-common.js), so kommt er aus
 * dem Zwischenspeicher des Browsers statt ein zweites Mal vom Dienst.
 */
function loadSkinImage(uuid) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => (image.naturalWidth === 64 && (image.naturalHeight === 64 || image.naturalHeight === 32) ? resolve(image) : reject(new Error('kein Skin'))));
    image.addEventListener('error', () => reject(new Error('kein Skin')));
    image.src = `/api/v1/skins/${encodeURIComponent(uuid)}`;
  });
}

/** Kann der Browser WebGL? (Probe auf einer eigenen Leinwand, danach gleich wieder freigegeben.) */
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

/** skinview3d einmal nachladen (CSP: nur Skripte von dieser Seite). */
let viewerScript = null;
function loadViewerScript() {
  if (window.skinview3d) return Promise.resolve(window.skinview3d);
  if (!viewerScript) {
    viewerScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/vendor/skinview3d.bundle.js';
      script.async = true;
      script.addEventListener('load', () => (window.skinview3d ? resolve(window.skinview3d) : reject(new Error('skinview3d fehlt'))));
      script.addEventListener('error', () => reject(new Error('skinview3d ließ sich nicht laden')));
      document.head.append(script);
    });
    viewerScript.catch(() => (viewerScript = null));
  }
  return viewerScript;
}

/**
 * call: Anfrage mit Sitzung. enqueue(task): Speichern der Reihe nach (mit den Profil-Schaltern). getMe/applyMe: Profil
 * lesen und ändern. saveCape(cape, savedText): eingebautes Cape über PUT /v1/me (→ true/false). onLook(look): Stand für
 * die Übersicht ({ capeName, capeThumb, worn: [Namen] }).
 */
export function initCosmetics({ call, enqueue, getMe, applyMe, saveCape, onLook }) {
  const $ = (id) => document.getElementById(id);
  const state = {
    worn: { cape: null, head: null, back: null, aura: null, companion: null },
    mineLoaded: false,
    available: null, // null = unbekannt, true = Dienst kennt Cosmetics, false = nicht (alter Dienst)
    catalog: null, // [Eintrag] (normalisiert, ohne fremde Team-Cosmetics)
    catalogState: 'idle', // idle | loading | ready | error
    verified: new Map(), // id → { entry, manifest }
    rejected: new Map(), // id → Fehler
    prepared: new Map(), // id → Promise<prepared>
    thumbs: new Map(), // id → data:-URL
    builtins: null, // [{ id, name, description, frames, fps, glow, team? }]
    team: null, // im Team? (GET/PUT /v1/me/cosmetics → team; null = unbekannt, dann zählt die Rolle)
    unlocked: new Set(), // freigeschaltete Belohnungen (GET/PUT /v1/me/cosmetics → unlocked)
    slot: 'cape',
    /** Format 2: gewählte Animation je Cosmetic (id → Name) */
    anims: new Map(),
    loadedFull: false,
    /** Bereich „Profil“ gerade offen (dann prüft die Anmeldung gleich den ganzen Katalog) */
    profileOpen: false,
    token: 0,
  };
  const timers = new Map();
  const viewer = { status: 'idle', instance: null, layer: null, visible: false, ownSkin: null, skin: 'standard', observer: null };

  // -------------------------------------------------------------------------------------------------------
  // Reiter (Plätze)
  // -------------------------------------------------------------------------------------------------------

  const tablist = $('cosmetics-plaetze');
  for (const entry of SLOTS) {
    tablist.append(
      h(
        'button',
        { type: 'button', role: 'tab', class: 'cos-slot', id: `platz-${entry.slot}`, 'aria-controls': `platzpanel-${entry.slot}`, 'aria-selected': entry.slot === 'cape' ? 'true' : 'false', tabindex: entry.slot === 'cape' ? '0' : '-1', dataset: { tab: entry.slot } },
        h('span', { class: 'cos-slot-icon', 'aria-hidden': 'true' }, slotIcon(entry.icon)),
        h('span', { class: 'cos-slot-text' }, h('span', { class: 'cos-slot-label', text: entry.label }), h('small', { class: 'cos-slot-current', id: `platz-${entry.slot}-wahl` })),
      ),
    );
  }
  const tabs = setupTabs(tablist, (slot) => {
    state.slot = slot;
    renderDetail();
    turnTo(slot);
  });

  // -------------------------------------------------------------------------------------------------------
  // Laden
  // -------------------------------------------------------------------------------------------------------

  const me = () => getMe() ?? {};
  const isTeam = () => state.team ?? Boolean(me().role);
  const builtInCape = (id) => CAPES.some(([capeId]) => capeId === id);

  /** Katalog-Einträge, die dieser Spieler sehen darf (Team-Cosmetics nur fürs Team). */
  const visibleEntry = (entry) => entry && (entry.access !== 'team' || isTeam());

  async function loadMine() {
    try {
      const data = await call('GET', '/v1/me/cosmetics');
      applyWorn(data);
      state.available = true;
    } catch (error) {
      if (error.status === 401) throw error;
      // Alter Dienst (404) oder gestört: nur das Cape aus dem Profil, keine weiteren Plätze.
      state.available = error.status === 404 ? false : state.available;
      state.worn = { ...state.worn, cape: me().cape || null };
    }
    state.mineLoaded = true;
  }

  /** Antwort von GET/PUT /v1/me/cosmetics übernehmen ({ head, back, aura, companion, cape, team, unlocked }, null = nichts). */
  function applyWorn(data) {
    if (typeof data?.team === 'boolean') state.team = data.team;
    if (Array.isArray(data?.unlocked)) state.unlocked = new Set(data.unlocked.filter((id) => typeof id === 'string'));
    const next = { ...state.worn };
    for (const slot of COSMETIC_SLOTS) {
      const value = data?.[slot];
      next[slot] = typeof value === 'string' && value ? value : null;
    }
    state.worn = next;
    const cape = next.cape ?? '';
    if ((me().cape || '') !== cape) applyMe({ cape });
  }

  async function loadCatalog() {
    if (state.catalogState === 'loading' || state.catalogState === 'ready') return;
    if (!cosmeticsKeyAvailable()) {
      state.catalogState = 'error';
      state.catalogError = 'key';
      return;
    }
    state.catalogState = 'loading';
    try {
      const entries = await loadCosmeticCatalog();
      state.catalog = entries.filter(visibleEntry);
      state.catalogState = 'ready';
      if (state.available === null) state.available = true;
    } catch (error) {
      state.catalogState = 'error';
      state.catalogError = error?.status === 404 ? 'missing' : 'network';
      if (error?.status === 404) state.available = false;
    }
  }

  /** Geprüftes Cosmetic merken (und für die Übersicht und die Vorschau bereitstellen). */
  function remember(entry, manifest, error) {
    if (manifest) {
      state.verified.set(entry.id, { entry, manifest });
      state.rejected.delete(entry.id);
    } else if (error) {
      state.rejected.set(entry.id, error);
    }
  }

  /** Nur was getragen wird prüfen (Übersicht, Start) – der Rest erst, wenn der Bereich offen ist. */
  async function verifyWorn() {
    if (!state.catalog) return;
    const ids = new Set(Object.values(state.worn).filter(Boolean));
    const entries = state.catalog.filter((entry) => ids.has(entry.id) && !state.verified.has(entry.id));
    await Promise.all(
      entries.map((entry) =>
        loadCosmetic(entry).then(
          (manifest) => remember(entry, manifest, null),
          (error) => remember(entry, null, error),
        ),
      ),
    );
  }

  async function verifyAll() {
    if (!state.catalog || state.loadedFull) return;
    state.loadedFull = true;
    const token = state.token;
    await loadVerifiedCosmetics(
      state.catalog.filter((entry) => !state.verified.has(entry.id)),
      {
        onItem: (entry, manifest, error) => {
          if (token !== state.token) return;
          remember(entry, manifest, error);
          scheduleRender();
        },
      },
    );
  }

  function prepared(id) {
    if (!state.prepared.has(id)) {
      const info = state.verified.get(id);
      if (!info) return Promise.resolve(null);
      const promise = prepareCosmetic(info.manifest);
      promise.catch(() => state.prepared.delete(id));
      state.prepared.set(id, promise);
    }
    return state.prepared.get(id);
  }

  async function preparedBuiltin(id) {
    const key = `builtin:${id}`;
    if (!state.prepared.has(key)) {
      const promise = (async () => {
        const list = state.builtins ?? (state.builtins = await loadBuiltinCapes().catch(() => []));
        const cape = list.find((entry) => entry.id === id) ?? { id, name: capeName(id), frames: 24, fps: 10, glow: false };
        return prepareBuiltinCape(cape);
      })();
      promise.catch(() => state.prepared.delete(key));
      state.prepared.set(key, promise);
    }
    return state.prepared.get(key);
  }

  /** Vorschaubild (2D) eines geprüften Cosmetics, einmal gezeichnet und als data:-URL gemerkt. */
  async function thumbnail(id) {
    if (state.thumbs.has(id)) return state.thumbs.get(id);
    const item = await prepared(id);
    if (!item) return null;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB;
    canvas.height = THUMB;
    try {
      drawCosmeticPreview(canvas, item, { t: 0.35 });
      const url = canvas.toDataURL('image/png');
      state.thumbs.set(id, url);
      return url;
    } catch {
      state.thumbs.set(id, null);
      return null;
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Zeichnen
  // -------------------------------------------------------------------------------------------------------

  let renderQueued = false;
  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  /** Name eines getragenen Cosmetics (eingebaut, geprüft) – sonst null. */
  function nameOf(slot, id) {
    if (!id) return null;
    if (slot === 'cape' && builtInCape(id)) return capeName(id);
    return state.verified.get(id)?.manifest.name ?? null;
  }

  function options(slot) {
    const list = [];
    const current = state.worn[slot];
    // Eingebaute Team-Capes: für alle sichtbar, außerhalb des Teams gesperrt (der Dienst lehnt sie sonst mit 403 ab)
    if (slot === 'cape') for (const [id, name, team] of CAPES) list.push({ id, name, kind: 'builtin', team: team === true, locked: team === true && !isTeam() && id !== current });
    for (const entry of state.catalog ?? []) {
      if (entry.slot !== slot) continue;
      const info = state.verified.get(entry.id);
      if (info) {
        const reward = info.manifest.access === 'unlock';
        list.push({ id: entry.id, name: info.manifest.name, kind: 'catalog', manifest: info.manifest, team: info.manifest.access === 'team', reward, locked: reward && !state.unlocked.has(entry.id) && entry.id !== current });
      }
      else if (!state.rejected.has(entry.id)) list.push({ id: entry.id, name: entry.name, kind: 'pending' });
    }
    // Getragen, aber (noch) nicht in der Liste – z. B. ein Cape, das diese Seite nicht kennt
    if (current && !list.some((option) => option.id === current) && !(slot !== 'cape' && state.rejected.has(current))) {
      list.push({ id: current, name: nameOf(slot, current) ?? current, kind: slot === 'cape' && !state.catalog ? 'unknown' : 'pending' });
    }
    return list;
  }

  function optionNode(slot, option, checked) {
    const name = slot === 'cape' ? 'cape' : `cosmetic-${slot}`;
    const pending = option.kind === 'pending';
    const locked = option.locked === true;
    const label = locked
      ? option.reward
        ? `${option.name} (Belohnung für Einladungen, noch gesperrt)`
        : `${option.name} (nur für das HeldixClient-Team, für dich gesperrt)`
      : option.team
        ? `${option.name} (nur fürs Team)`
        : option.reward
          ? `${option.name} (Belohnung für Einladungen)`
          : option.name;
    const input = h('input', { type: 'radio', name, value: option.id, 'aria-label': label, disabled: pending || locked || undefined, dataset: { focusKey: `${slot}:${option.id}` } });
    input.checked = checked;
    let art;
    if (option.id === '') art = h('span', { class: `cape-art none${slot === 'cape' ? '' : ' cos-art-none'}`, 'aria-hidden': 'true' }, icon('close'));
    else if (option.kind === 'builtin') art = h('span', { class: 'cape-art', dataset: { cape: option.id }, 'aria-hidden': 'true' });
    else if (option.kind === 'unknown' || pending) art = h('span', { class: `cape-art unknown${pending ? ' cos-art-pending' : ''}`, 'aria-hidden': 'true' }, pending ? h('span', { class: 'spinner' }) : null);
    else {
      const url = state.thumbs.get(option.id);
      art = url ? h('img', { class: 'cos-thumb', src: url, alt: '', width: THUMB, height: THUMB }) : h('span', { class: 'cape-art unknown cos-art-pending', 'aria-hidden': 'true' }, h('span', { class: 'spinner' }));
      if (!url) thumbnail(option.id).then((done) => done && scheduleRender());
    }
    return h(
      'label',
      {
        class: `cape-option cos-option${pending ? ' pending' : ''}${option.team ? ' team' : ''}${option.reward ? ' reward' : ''}${locked ? ' locked' : ''}`,
        title: locked ? (option.reward ? `${option.name} – Belohnung für Einladungen` : `${option.name} – nur für das HeldixClient-Team`) : undefined,
        dataset: { id: option.id || 'none', art: option.kind },
      },
      input,
      art,
      h('span', { class: 'cape-name', text: option.id === '' ? SLOT[slot].none : option.name, 'aria-hidden': 'true' }),
      option.team ? h('span', { class: 'cos-team', 'aria-hidden': 'true' }, locked ? icon('lock') : null, 'Team') : null,
      option.reward ? h('span', { class: 'cos-team reward', 'aria-hidden': 'true' }, locked ? icon('lock') : null, 'Belohnung') : null,
      h('span', { class: 'cape-tick', 'aria-hidden': 'true' }, icon('check')),
    );
  }

  function renderGrid(slot) {
    const grid = slot === 'cape' ? $('cape-grid') : $(`cosmetics-${slot}`);
    const current = state.worn[slot] ?? '';
    const list = [{ id: '', name: SLOT[slot].none, kind: 'none' }, ...options(slot)];
    const loading = slot !== 'cape' && (state.catalogState === 'loading' || state.catalogState === 'idle') && !list.some((option) => option.kind !== 'none');
    const signature = JSON.stringify([current, list.map((option) => [option.id, option.kind, option.name, option.locked === true, state.thumbs.has(option.id)]), loading, state.catalogState, state.available]);
    rerender(grid, signature, () => {
      const nodes = list.map((option) => optionNode(slot, option, option.id === current));
      if (slot !== 'cape' && list.length === 1) {
        nodes.push(h('p', { class: 'cos-grid-note', text: loading ? 'Cosmetics werden geladen und geprüft …' : emptyText(slot) }));
      }
      // Gesperrte Belohnungen: wie man sie bekommt
      if (list.some((option) => option.reward && option.locked)) {
        nodes.push(
          h(
            'p',
            { class: 'cos-lock-note', dataset: { hinweis: 'belohnung' } },
            icon('lock'),
            h('span', null, 'Mit Schloss: Belohnungen für Einladungen – du schaltest sie frei, wenn Freunde über deinen Link neu zu HeldixClient kommen. ', h('a', { href: '#reiter=freunde&teil=einladen', text: 'Freunde einladen' })),
          ),
        );
      }
      return nodes;
    });
  }

  function emptyText(slot) {
    if (state.available === false) return 'Der Heldix-Dienst bietet noch keine Cosmetics an. Sobald es welche gibt, wählst du sie hier.';
    if (state.catalogState === 'error') return state.catalogError === 'key' ? 'Diese Seite kann Cosmetics gerade nicht prüfen und zeigt deshalb keine.' : 'Die Cosmetics sind gerade nicht erreichbar. Versuch es gleich noch einmal.';
    return `Für den Platz „${SLOT[slot].label}“ gibt es noch nichts.`;
  }

  function renderTabs() {
    for (const entry of SLOTS) {
      const name = nameOf(entry.slot, state.worn[entry.slot]);
      $(`platz-${entry.slot}-wahl`).textContent = state.worn[entry.slot] ? (name ?? '…') : entry.none;
      $(`platz-${entry.slot}`).classList.toggle('worn', Boolean(state.worn[entry.slot]));
    }
  }

  function renderDetail() {
    const slot = state.slot;
    const id = state.worn[slot];
    const box = $('cosmetics-detail');
    const entry = SLOT[slot];
    let title;
    let text;
    const chips = [];
    if (!id) {
      title = entry.slot === 'cape' ? 'Kein Cape' : `${entry.label}: nichts gewählt`;
      text = entry.slot === 'cape' ? 'Wähl ein Heldix-Cape oder eines aus dem Katalog.' : 'Wähl oben etwas aus – andere sehen es sofort im Spiel.';
    } else if (slot === 'cape' && builtInCape(id)) {
      title = capeName(id);
      text = teamCape(id) ? 'Eingebautes Heldix-Cape, animiert – nur für das HeldixClient-Team.' : 'Eingebautes Heldix-Cape, animiert.';
      chips.push(h('span', { class: 'chip', text: 'Heldix-Cape' }));
      if (teamCape(id)) chips.push(h('span', { class: 'chip accent', text: 'Nur fürs Team' }));
    } else {
      const info = state.verified.get(id);
      title = info?.manifest.name ?? id;
      text = info?.manifest.description || (info ? '' : 'Wird geprüft …');
      if (info) {
        chips.push(h('span', { class: 'chip success' }, icon('check'), 'Signatur geprüft'));
        if (info.manifest.access === 'team') chips.push(h('span', { class: 'chip accent', text: 'Nur fürs Team' }));
        if (info.manifest.access === 'unlock') chips.push(h('span', { class: 'chip accent', text: 'Belohnung für Einladungen' }));
        if (cosmeticAnimated(info.manifest)) chips.push(h('span', { class: 'chip', text: 'Animiert' }));
        if (info.manifest.glow || info.manifest.particles?.fullbright) chips.push(h('span', { class: 'chip', text: 'Leuchtet' }));
      }
    }
    const remove = id
      ? h('button', { type: 'button', class: 'button tiny ghost', id: 'cosmetics-ablegen', onClick: () => choose(slot, '', { now: true }) }, icon('close'), slot === 'cape' ? 'Cape ablegen' : 'Ablegen')
      : null;
    // Format 2: Animationen an der Figur auswählen (nur mit 3D-Vorschau)
    const manifest = id && slot !== 'cape' ? state.verified.get(id)?.manifest : null;
    const animations = manifest && viewer.layer?.supported ? cosmeticAnimations(manifest) : null;
    const active = animations ? (state.anims.get(id) ?? animations.idle) : null;
    const animationRow =
      animations && animations.clips.length > 1
        ? h(
            'div',
            { class: 'anim-chips cos-anims', role: 'group', 'aria-label': `Animation von ${title}`, dataset: { animation: active ?? '' } },
            ...animationButtons(animations, active, (name) => {
              state.anims.set(id, name);
              viewer.layer?.setAnimation(slot, name);
              renderDetail();
            }),
          )
        : null;
    rerender(box, JSON.stringify([slot, id, title, text, chips.length, active, Boolean(animationRow)]), () => [
      h('div', { class: 'cos-detail-text' }, h('p', { class: 'cos-detail-eyebrow', text: entry.slot === 'cape' ? 'Cape' : `Platz: ${entry.label}` }), h('strong', { class: 'cos-detail-name', text: title }), text ? h('p', { class: 'cos-detail-desc', text }) : null, chips.length ? h('div', { class: 'chips-row' }, chips) : null, animationRow),
      remove,
    ]);
  }

  function renderNotice() {
    const notice = $('cosmetics-katalog-hinweis');
    let text = '';
    const rejected = [...state.rejected.keys()].filter((id) => state.catalog?.some((entry) => entry.id === id));
    if (rejected.length) text = `${rejected.length === 1 ? 'Ein Cosmetic fehlt' : `${rejected.length} Cosmetics fehlen`} hier, weil die Prüfung nicht geklappt hat (Signatur oder Format). Sie bleiben ausgeblendet.`;
    else if (state.catalogState === 'error' && state.catalogError === 'key') text = 'Diese Seite kann die Signaturen der Cosmetics nicht prüfen und zeigt deshalb nur die eingebauten Capes.';
    else if (state.catalogState === 'error' && state.catalogError === 'network') text = 'Die Cosmetics sind gerade nicht erreichbar – die eingebauten Capes kannst du trotzdem wählen.';
    notice.textContent = text;
    notice.hidden = !text;
  }

  function look() {
    const capeId = state.worn.cape;
    const worn = ['head', 'back', 'aura', 'companion'].map((slot) => nameOf(slot, state.worn[slot])).filter(Boolean);
    // Für die Übersicht: jeder getragene Platz mit Bezeichnung („Rücken: Engelsflügel“), Belohnungen markiert
    const items = SLOTS.map((entry) => {
      const id = state.worn[entry.slot];
      const name = entry.slot === 'cape' && id ? nameOf('cape', id) ?? capeName(id) : nameOf(entry.slot, id);
      return id && name ? { slot: entry.slot, label: entry.label, name, reward: state.verified.get(id)?.manifest.access === 'unlock' } : null;
    }).filter(Boolean);
    return {
      capeName: capeId ? nameOf('cape', capeId) ?? capeName(capeId) : null,
      capeThumb: capeId && !builtInCape(capeId) ? state.thumbs.get(capeId) ?? null : null,
      worn,
      items,
    };
  }

  let lookSignature = '';
  function render() {
    for (const entry of SLOTS) renderGrid(entry.slot);
    renderTabs();
    renderDetail();
    renderNotice();
    // Plätze ohne Dienst-Unterstützung: nur das Cape
    for (const entry of SLOTS) if (entry.slot !== 'cape') $(`platz-${entry.slot}`).hidden = state.available === false;
    const next = look();
    const signature = JSON.stringify(next);
    if (signature !== lookSignature) {
      lookSignature = signature;
      onLook(next);
    }
    const capeId = state.worn.cape;
    if (capeId && !builtInCape(capeId) && state.verified.has(capeId) && !state.thumbs.has(capeId)) thumbnail(capeId).then(() => scheduleRender());
    $('cosmetics-vorschau').dataset.getragen = SLOTS.map((entry) => `${entry.slot}:${state.worn[entry.slot] ?? ''}`).join(',');
    updatePreview();
  }

  // -------------------------------------------------------------------------------------------------------
  // Auswählen und speichern
  // -------------------------------------------------------------------------------------------------------

  function onChange(event) {
    const input = event.target;
    if (input.type !== 'radio') return;
    const slot = input.name === 'cape' ? 'cape' : input.name.replace(/^cosmetic-/, '');
    if (!SLOT[slot]) return;
    choose(slot, input.value);
  }

  /** Auswahl sofort zeigen, nach kurzer Pause speichern (Pfeiltasten wechseln die Auswahl bei jedem Schritt). */
  function choose(slot, id, { now = false } = {}) {
    const before = state.worn[slot];
    state.worn = { ...state.worn, [slot]: id || null };
    render();
    clearTimeout(timers.get(slot));
    const run = () => enqueue(() => save(slot, id, before));
    if (now) run();
    else timers.set(slot, setTimeout(run, SAVE_DELAY));
  }

  async function save(slot, id, before) {
    const texts = SLOT[slot];
    // Eingebautes Cape oder „kein Cape“: über das Profil (geht auch ohne Cosmetics im Dienst)
    if (slot === 'cape' && (!id || builtInCape(id))) {
      const ok = await saveCape(id, id ? texts.saved : texts.removed);
      if (!ok) state.worn = { ...state.worn, cape: me().cape || null };
      else state.worn = { ...state.worn, cape: me().cape || null };
      render();
      // Team-Cape abgelehnt (403, z. B. nicht mehr im Team): Stand beim Dienst neu holen, dann ist es wieder gesperrt
      if (!ok && teamCape(id)) {
        const token = state.token;
        loadMine()
          .then(() => token === state.token && render())
          .catch(() => {});
      }
      return;
    }
    try {
      const data = await call('PUT', '/v1/me/cosmetics', { slot, id: id || null });
      applyWorn(data);
      flashSaved($('cape-gespeichert'), id ? texts.saved : texts.removed);
    } catch (error) {
      showError(error);
      state.worn = { ...state.worn, [slot]: before };
      // Gesperrt (403, z. B. Belohnung noch nicht freigeschaltet oder nicht mehr im Team): Stand beim Dienst neu holen
      if (error?.status === 403) {
        const token = state.token;
        loadMine()
          .then(() => token === state.token && render())
          .catch(() => {});
      }
    }
    render();
  }

  // -------------------------------------------------------------------------------------------------------
  // Figur auf der Übersicht: dieselbe Auswahl in einem zweiten, kleinen Viewer (ohne WebGL: großer Kopf)
  // -------------------------------------------------------------------------------------------------------

  const figure = { host: $('uebersicht-figur'), canvas: $('uebersicht-canvas'), status: 'idle', instance: null, layer: null, shown: {}, visible: false };

  function figureFallback() {
    figure.status = 'fallback';
    if (!figure.host) return;
    figure.host.dataset.webgl = 'nein';
    figure.canvas.hidden = true;
    $('uebersicht-figur-hinweis').hidden = true;
    const spare = $('uebersicht-figur-ersatz');
    spare.hidden = false;
    spare.replaceChildren(avatar(me().name, me().uuid, { size: 'xl' }));
  }

  async function startFigure() {
    if (!figure.host || figure.status !== 'idle') return;
    figure.status = 'loading';
    let lib;
    try {
      lib = await loadViewerScript();
    } catch {
      return figureFallback();
    }
    if (!webglAvailable()) return figureFallback();
    let created = null;
    try {
      created = new lib.SkinViewer({ canvas: figure.canvas, width: figure.host.clientWidth || 220, height: figure.host.clientHeight || 220, skin: '/assets/standard-skin.png', fov: 38, zoom: 0.78 });
    } catch {
      created = null;
    }
    if (!created) return figureFallback();
    figure.instance = created;
    figure.status = 'ready';
    figure.host.dataset.webgl = 'ja';
    created.autoRotate = !reduceMotion;
    created.autoRotateSpeed = 0.6;
    created.controls.enableZoom = false;
    created.controls.enablePan = false;
    created.controls.minPolarAngle = Math.PI * 0.3;
    created.controls.maxPolarAngle = Math.PI * 0.62;
    created.controls.addEventListener('start', () => {
      created.autoRotate = false;
      $('uebersicht-figur-hinweis').hidden = true;
    });
    created.playerWrapper.rotation.y = Math.PI * 0.84;
    try {
      figure.layer = createCosmeticLayer(created, { skinview3d: lib, idle: !reduceMotion, playing: !reduceMotion });
    } catch {
      figure.layer = null;
    }
    new ResizeObserver(() => {
      if (figure.host.clientWidth > 0 && figure.host.clientHeight > 0) created.setSize(figure.host.clientWidth, figure.host.clientHeight);
    }).observe(figure.host);
    new IntersectionObserver((entries) => {
      figure.visible = entries.some((entry) => entry.isIntersecting);
      created.renderPaused = !figure.visible || document.hidden;
    }).observe(figure.host);
    document.addEventListener('visibilitychange', () => {
      created.renderPaused = !figure.visible || document.hidden;
    });
    const uuid = me().uuid;
    if (uuid) {
      try {
        viewer.ownSkin = viewer.ownSkin ?? (await loadSkinImage(uuid));
        await created.loadSkin(viewer.ownSkin, { model: 'auto-detect' });
        figure.host.dataset.skin = 'eigener';
      } catch {
        figure.host.dataset.skin = 'standard';
      }
    }
    figure.shown = {};
    updateFigure();
  }

  async function updateFigure() {
    if (figure.status !== 'ready' || !figure.instance) return;
    for (const entry of SLOTS) {
      const slot = entry.slot;
      const id = state.worn[slot] ?? null;
      if (figure.shown[slot] === id) continue;
      figure.shown[slot] = id;
      let item = null;
      if (id && slot === 'cape' && builtInCape(id)) item = await preparedBuiltin(id).catch(() => null);
      else if (id && state.verified.has(id)) item = await prepared(id).catch(() => null);
      else if (id) figure.shown[slot] = undefined;
      if (figure.shown[slot] !== id && id) continue;
      if ((state.worn[slot] ?? null) !== id) continue;
      if (figure.layer?.supported || slot === 'cape') {
        if (figure.layer) {
          figure.layer.wear(slot, item);
          if (id && state.anims.has(id)) figure.layer.setAnimation(slot, state.anims.get(id));
        } else if (slot === 'cape') figure.instance.loadCape(null);
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Vorschau (3D mit skinview3d, sonst 2D)
  // -------------------------------------------------------------------------------------------------------

  const host = $('cosmetics-vorschau');
  const canvas = $('cosmetics-canvas');
  const spinButton = $('cosmetics-drehen');
  const skinButton = $('cosmetics-skin');

  function showFallback(text) {
    viewer.status = 'fallback';
    host.dataset.webgl = 'nein';
    canvas.hidden = true;
    $('cosmetics-hinweis').hidden = true;
    spinButton.hidden = true;
    skinButton.hidden = true;
    $('cosmetics-ersatz').hidden = false;
    if (text) $('cosmetics-ersatz-text').textContent = text;
    updatePreview();
  }

  async function startViewer() {
    if (viewer.status !== 'idle') return;
    viewer.status = 'loading';
    host.classList.add('loading');
    let lib;
    try {
      lib = await loadViewerScript();
    } catch {
      host.classList.remove('loading');
      return showFallback('Die 3D-Vorschau ließ sich nicht laden. Hier siehst du deine Auswahl als Bild.');
    }
    // Ohne WebGL gar nicht erst versuchen (three.js meldet das sonst als Fehler in der Konsole)
    if (!webglAvailable()) {
      host.classList.remove('loading');
      return showFallback();
    }
    let created = null;
    try {
      created = new lib.SkinViewer({ canvas, width: host.clientWidth || 360, height: host.clientHeight || 420, skin: '/assets/standard-skin.png', fov: 40, zoom: 0.72 });
    } catch {
      created = null;
    }
    host.classList.remove('loading');
    if (!created) return showFallback();
    viewer.instance = created;
    viewer.status = 'ready';
    host.dataset.webgl = 'ja';
    created.autoRotate = !reduceMotion;
    created.autoRotateSpeed = 0.5;
    const controls = created.controls;
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.3;
    controls.maxPolarAngle = Math.PI * 0.62;
    controls.addEventListener('start', () => {
      created.autoRotate = false;
      spinButton.setAttribute('aria-pressed', 'false');
      $('cosmetics-hinweis').hidden = true;
    });
    try {
      viewer.layer = createCosmeticLayer(created, { skinview3d: lib, idle: !reduceMotion, playing: !reduceMotion });
    } catch {
      viewer.layer = null;
    }
    host.dataset.ebene = viewer.layer?.supported ? 'ja' : 'nein';
    if (!viewer.layer?.supported) $('cosmetics-ersatz-text').textContent = 'Die 3D-Vorschau zeigt hier nur das Cape. Kopf, Rücken, Aura und Begleiter siehst du als Bild.';
    spinButton.setAttribute('aria-pressed', String(created.autoRotate));
    if (reduceMotion) $('cosmetics-hinweis').textContent = 'Ziehen zum Drehen';
    new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) created.setSize(host.clientWidth, host.clientHeight);
    }).observe(host);
    viewer.observer = new IntersectionObserver((entries) => {
      viewer.visible = entries.some((entry) => entry.isIntersecting);
      created.renderPaused = !viewer.visible || document.hidden;
    });
    viewer.observer.observe(host);
    document.addEventListener('visibilitychange', () => {
      created.renderPaused = !viewer.visible || document.hidden;
    });
    turnTo(state.slot);
    offerOwnSkin();
    viewer.shown = {};
    updatePreview();
    // Format 2: jetzt gibt es die 3D-Vorschau – Auswahl der Animation zeigen
    renderDetail();
  }

  /** Figur so drehen, dass man den gewählten Platz sieht (Cape, Rücken: von hinten). */
  function turnTo(slot) {
    const instance = viewer.instance;
    if (!instance) return;
    instance.playerWrapper.rotation.y = slot === 'cape' || slot === 'back' ? Math.PI * 0.84 : slot === 'companion' ? -0.5 : 0.35;
  }

  async function offerOwnSkin() {
    const uuid = me().uuid;
    if (!uuid || !viewer.instance) return;
    try {
      viewer.ownSkin = viewer.ownSkin ?? (await loadSkinImage(uuid));
      await viewer.instance.loadSkin(viewer.ownSkin, { model: 'auto-detect' });
      viewer.skin = 'eigener';
      skinButton.hidden = false;
      skinButton.setAttribute('aria-pressed', 'true');
    } catch {
      viewer.skin = 'standard';
      skinButton.hidden = true;
      try {
        await viewer.instance.loadSkin('/assets/standard-skin.png');
      } catch {
        // bleibt beim Standard-Skin des Viewers
      }
    }
    host.dataset.skin = viewer.skin;
  }

  /** Vorschau auf die aktuelle Auswahl bringen (nur was sich geändert hat). */
  async function updatePreview() {
    updateFigure();
    if (viewer.status === 'ready' && viewer.instance) {
      const layer = viewer.layer;
      for (const entry of SLOTS) {
        const slot = entry.slot;
        const id = state.worn[slot] ?? null;
        if (viewer.shown[slot] === id) continue;
        viewer.shown[slot] = id;
        let item = null;
        if (id && slot === 'cape' && builtInCape(id)) item = await preparedBuiltin(id).catch(() => null);
        else if (id && state.verified.has(id)) item = await prepared(id).catch(() => null);
        else if (id) viewer.shown[slot] = undefined; // noch nicht geprüft: beim nächsten Zeichnen erneut
        if (viewer.shown[slot] !== id && id) continue;
        if ((state.worn[slot] ?? null) !== id) continue; // inzwischen anders gewählt
        if (layer?.supported || slot === 'cape') {
          if (layer) {
            layer.wear(slot, item);
            // Format 2: zuvor gewählte Animation wieder abspielen
            if (id && state.anims.has(id)) layer.setAnimation(slot, state.anims.get(id));
          } else if (slot === 'cape') viewer.instance.loadCape(null);
        }
      }
      // Ohne eigene Meshes (Ebene nicht verfügbar): Rest als Bild daneben
      if (!viewer.layer?.supported) renderFallbackImages(['head', 'back', 'aura', 'companion']);
      else $('cosmetics-ersatz').hidden = true;
      return;
    }
    if (viewer.status === 'fallback') renderFallbackImages(SLOTS.map((entry) => entry.slot));
  }

  async function renderFallbackImages(slots) {
    const box = $('cosmetics-ersatz-bilder');
    const shown = slots.filter((slot) => state.worn[slot]);
    $('cosmetics-ersatz').hidden = viewer.status !== 'fallback' && !shown.length;
    const signature = JSON.stringify(shown.map((slot) => [slot, state.worn[slot], state.verified.has(state.worn[slot])]));
    if (box.dataset.signature === signature) return;
    box.dataset.signature = signature;
    const figures = [];
    for (const slot of shown) {
      const id = state.worn[slot];
      const item = slot === 'cape' && builtInCape(id) ? await preparedBuiltin(id).catch(() => null) : await prepared(id).catch(() => null);
      if (!item) continue;
      const art = document.createElement('canvas');
      art.width = 160;
      art.height = 160;
      art.className = 'cos-fallback-art';
      try {
        drawCosmeticPreview(art, item, { t: 0.35 });
      } catch {
        continue;
      }
      figures.push(h('figure', { class: 'cos-fallback-item' }, art, h('figcaption', { text: `${SLOT[slot].label}: ${nameOf(slot, id) ?? id}` })));
    }
    if (box.dataset.signature !== signature) return;
    box.replaceChildren(...(figures.length ? figures : [h('p', { class: 'muted small', text: 'Noch nichts gewählt.' })]));
  }

  spinButton.addEventListener('click', () => {
    const instance = viewer.instance;
    if (!instance) return;
    instance.autoRotate = !instance.autoRotate;
    spinButton.setAttribute('aria-pressed', String(instance.autoRotate));
    viewer.layer?.setPlaying(instance.autoRotate || !reduceMotion);
  });
  skinButton.addEventListener('click', async () => {
    const instance = viewer.instance;
    if (!instance) return;
    skinButton.disabled = true;
    try {
      if (viewer.skin === 'eigener') {
        await instance.loadSkin('/assets/standard-skin.png');
        viewer.skin = 'standard';
      } else {
        viewer.ownSkin = viewer.ownSkin ?? (await loadSkinImage(me().uuid));
        await instance.loadSkin(viewer.ownSkin, { model: 'auto-detect' });
        viewer.skin = 'eigener';
      }
    } catch {
      // bleibt, wie es war
    } finally {
      skinButton.disabled = false;
      skinButton.setAttribute('aria-pressed', String(viewer.skin === 'eigener'));
      host.dataset.skin = viewer.skin;
    }
  });

  $('panel-profil').addEventListener('change', (event) => {
    if (event.target.closest('.cos-grid')) onChange(event);
  });
  // Format 2: über der Kachel des getragenen Cosmetics spielt es an der Figur sein Emote
  let emoting = null;
  const hover = (event) => {
    const option = event.target.closest?.('.cos-option');
    const grid = option?.closest('.cos-grid');
    const slot = grid?.id?.replace(/^cosmetics-/, '');
    const id = option?.dataset.id;
    const hit = slot && SLOT[slot] && id && state.worn[slot] === id && state.verified.get(id)?.manifest.format === 2 ? slot : null;
    if (hit === emoting) return;
    if (emoting) viewer.layer?.emote(emoting, false);
    emoting = hit;
    if (hit) viewer.layer?.emote(hit, true);
  };
  $('panel-profil').addEventListener('pointerover', hover);
  $('panel-profil').addEventListener('pointerleave', () => hover({ target: document.body }));

  // -------------------------------------------------------------------------------------------------------

  return {
    /** Angemeldet: Auswahl und Katalog laden, getragene Cosmetics prüfen (für Übersicht und Vorschau). */
    setUser() {
      state.token++;
      state.worn = { cape: me().cape || null, head: null, back: null, aura: null, companion: null };
      state.mineLoaded = false;
      state.available = null;
      state.team = null;
      state.unlocked = new Set();
      state.catalog = null;
      state.catalogState = 'idle';
      state.loadedFull = false;
      state.verified = new Map();
      state.rejected = new Map();
      viewer.ownSkin = null;
      if (viewer.shown) viewer.shown = {};
      render();
      const token = state.token;
      // Ist der Bereich „Profil“ schon offen (direkter Link wie #reiter=profil&platz=aura), gleich alles prüfen –
      // sonst bliebe der Katalog dort „wird geprüft“, weil onTab vor der Anmeldung lief.
      Promise.all([loadMine(), loadCatalog()])
        .then(() => token === state.token && (render(), state.profileOpen ? verifyAll() : verifyWorn()))
        .then(() => token === state.token && render())
        .catch(() => {});
    },
    /** Bereich gewechselt (params: weitere Werte aus der Adresse, z. B. platz=kopf). */
    onTab(name, params = null) {
      state.profileOpen = name === 'profil';
      if (name === 'uebersicht') {
        startFigure();
        // Für die Figur müssen die getragenen Cosmetics geprüft sein
        const token = state.token;
        loadCatalog()
          .then(() => token === state.token && verifyWorn())
          .then(() => token === state.token && render())
          .catch(() => {});
      }
      if (name !== 'profil') return;
      const wanted = HASH_TO_SLOT[params?.platz] ?? (COSMETIC_SLOTS.includes(params?.platz) ? params.platz : null);
      if (wanted && tabs.has(wanted)) tabs.select(wanted);
      startViewer();
      const token = state.token;
      loadCatalog()
        .then(() => token === state.token && verifyAll())
        .then(() => token === state.token && render())
        .catch(() => {});
      render();
    },
    /** Neu zeichnen (z. B. nachdem Speichern fehlgeschlagen ist). */
    render() {
      state.worn = { ...state.worn, cape: me().cape || null };
      render();
    },
    /** Trägt der Spieler etwas (für den Hinweis „für andere unsichtbar“)? */
    wearsSomething: () => Object.values(state.worn).some(Boolean),
    /** Name eines Cosmetics aus dem geprüften Katalog (z. B. für die Profilkarte eines Freundes), sonst null. */
    nameById: (id) => state.verified.get(id)?.manifest.name ?? state.catalog?.find((entry) => entry.id === id)?.name ?? null,
    stop() {
      state.token++;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
