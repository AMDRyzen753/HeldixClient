// HeldixClient – Webseite: öffentliches Spielerprofil (/spieler/<name>) – Heldix-Dienst ab 1.14.0.
//
// Der Name kommt aus dem Pfad (location.pathname, /spieler/<name> oder /spieler/<uuid32>). Caddy leitet /spieler/* an
// den Dienst (HELDIX_DIENST_WEBSITE_DIR); der liefert diese gebaute spieler.html aus: Er entfernt im <head> die
// allgemeinen Angaben (<title>, description, robots, canonical, og:*, twitter:*) und setzt an der Marke
// <!--heldix:spieler-meta--> die Vorschaukarte des Profils ein (Name, Bio, Kopf als Bild, Karte summary). Unbekannt
// oder privat: allgemeine Angaben mit noindex (Status 404); das Skript zeigt dann „gibt es nicht“. Ohne Dienst (reine
// Datei) bleiben die allgemeinen Angaben mit noindex stehen.
//
// GET /api/v1/public/players/<name|uuid32> (öffentlich) → { uuid, name, bio, badges?: [{ id, label }], cosmetics?:
// { cape, worn: { head, back, aura, companion } }, worlds?: [DiscoverEntry], friendsButton, since }; 404 = unbekannt
// oder nicht öffentlich. Skin: /api/v1/public/skins/<uuid>, Kopf: /api/v1/public/heads/<uuid>.png.
// - 3D-Figur: skinview3d wie im Konto und auf /cosmetics; Cape und Cosmetics aus dem Katalog, jedes erst nach
//   geprüfter Signatur (cosmetics-common.js). Ohne WebGL: großer Kopf.
// - „Freund hinzufügen“ (angemeldet, nur mit friendsButton): POST /v1/friends/requests { name }; schon befreundet,
//   Anfrage gesendet oder erhalten (GET /v1/friends) zeigt die Seite passend an. Ohne Anmeldung: Anmelden/Herunterladen.
// - „Melden“ (angemeldet): POST /v1/public/players/<name>/report { reason, note }. „Teilen“: Systemdialog oder Link kopieren.
// Texte vom Dienst landen nur als Text im Dokument.
import { api, avatar, busy, copyText, h, icon, isPlayerName, toast } from './app-common.js';
import { BADGE_IDS, badgeImg } from './abzeichen.js';
import { BUILTIN_CAPE_IDS, createCosmeticLayer, loadBuiltinCapes, loadCosmetic, loadCosmeticCatalog, prepareBuiltinCape, prepareCosmetic, SLOT_NAMES } from './cosmetics-common.js';
import { discoverCard } from './entdecken-karten.js';
import { reportDialog } from './melden.js';
import { publicGet } from './public-cards.js';
import { setupLoginLink } from './rueckweg.js';

const UUID_RE = /^[0-9a-f]{32}$/;
const COSMETIC_ID_RE = /^[a-z0-9](?:[a-z0-9_-]{0,30}[a-z0-9])?$/;
const WORN_SLOTS = ['head', 'back', 'aura', 'companion'];
const MONTH_YEAR = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const page = document.querySelector('.player-page');
const state = { wanted: null, profile: null, me: undefined, friends: null, figure: null };

// ---------------------------------------------------------------------------------------------------------
// Adresse und Ansichten
// ---------------------------------------------------------------------------------------------------------

/** Name oder UUID aus /spieler/<name> (Rückfall für Tests: /spieler.html#<name>). */
function readName() {
  let raw = '';
  const match = /^\/spieler\/([^/]+)\/?$/.exec(location.pathname);
  if (match) raw = match[1];
  else raw = location.hash.replace(/^#/, '');
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }
  raw = raw.trim();
  const uuid = raw.replace(/-/g, '').toLowerCase();
  if (UUID_RE.test(uuid)) return uuid;
  return isPlayerName(raw) ? raw : null;
}

function show(view) {
  page.dataset.zustand = view;
  page.setAttribute('aria-busy', String(view === 'laden'));
  $('spieler-laden').hidden = view !== 'laden';
  $('spieler-weg').hidden = view !== 'weg';
  $('spieler').hidden = view !== 'profil';
}

function showGone(kind) {
  const texts = {
    'ohne-name': ['Hier fehlt der Spielername', 'Ein Profil-Link sieht so aus: heldixclient.com/spieler/Steve.', 'info'],
    unbekannt: ['Dieses Profil gibt es nicht', 'Entweder gibt es keinen HeldixClient-Spieler mit diesem Namen, oder sein Profil ist nicht öffentlich.', 'user'],
    fehler: ['Das Profil lässt sich gerade nicht laden', 'Der Heldix-Dienst antwortet gerade nicht. Versuch es in ein paar Minuten noch einmal.', 'warning'],
    viele: ['Gerade kommen zu viele Anfragen', 'Warte eine Minute und versuch es dann noch einmal.', 'clock'],
  };
  const [title, text, symbol] = texts[kind] ?? texts.unbekannt;
  $('spieler-weg-titel').textContent = title;
  $('spieler-weg-text').textContent = text;
  $('spieler-weg-symbol').replaceChildren(icon(symbol));
  $('spieler-erneut').hidden = kind !== 'fehler' && kind !== 'viele';
  page.dataset.grund = kind;
  document.title = `${title} – HeldixClient`;
  show('weg');
}

// ---------------------------------------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------------------------------------

const clean = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

function normalizeProfile(data) {
  if (!data || typeof data !== 'object' || !UUID_RE.test(data.uuid ?? '') || !isPlayerName(data.name ?? '')) return null;
  const cosmetics = data.cosmetics && typeof data.cosmetics === 'object' ? data.cosmetics : null;
  const worn = {};
  if (cosmetics?.worn && typeof cosmetics.worn === 'object') for (const slot of WORN_SLOTS) if (typeof cosmetics.worn[slot] === 'string' && COSMETIC_ID_RE.test(cosmetics.worn[slot])) worn[slot] = cosmetics.worn[slot];
  return {
    uuid: data.uuid,
    name: data.name,
    bio: clean(data.bio, 160),
    badges: (Array.isArray(data.badges) ? data.badges : []).filter((badge) => badge && typeof badge.id === 'string').slice(0, 8).map((badge) => ({ id: badge.id, label: clean(badge.label, 40) || badge.id })),
    cosmetics: cosmetics ? { cape: typeof cosmetics.cape === 'string' && COSMETIC_ID_RE.test(cosmetics.cape) ? cosmetics.cape : null, worn } : null,
    worlds: Array.isArray(data.worlds) ? data.worlds.filter((entry) => entry && typeof entry === 'object' && typeof entry.name === 'string').slice(0, 24) : [],
    friendsButton: data.friendsButton === true,
    since: Number.isFinite(data.since) ? data.since : null,
  };
}

function render() {
  const profile = state.profile;
  document.title = `${profile.name} – HeldixClient`;
  page.dataset.spieler = profile.name;
  $('spieler-name').textContent = profile.name;
  // Abzeichen
  const badges = $('spieler-abzeichen');
  badges.replaceChildren(...profile.badges.map((badge) => h('li', { class: 'chip chip--lg player-badge', dataset: { abzeichen: badge.id } }, BADGE_IDS.includes(badge.id) ? badgeImg(badge.id, { size: 18, label: '' }) : icon('star'), badge.label)));
  badges.hidden = !profile.badges.length;
  $('spieler-bio').textContent = profile.bio;
  $('spieler-bio').hidden = !profile.bio;
  $('spieler-seit').textContent = profile.since ? `Spielt mit HeldixClient seit ${MONTH_YEAR.format(profile.since)}` : '';
  $('spieler-seit').hidden = !profile.since;
  // Welten
  $('spieler-welten-titel').textContent = `Welten von ${profile.name}`;
  $('spieler-welten').replaceChildren(...profile.worlds.map((entry) => discoverCard(entry, { host: false })));
  $('spieler-welten-bereich').hidden = !profile.worlds.length;
  renderLook();
  renderFriend();
  startFigure().catch(() => figureFallback());
}

/** „Trägt gerade“: Namen von Cape und Cosmetics (aus dem Katalog bzw. den eingebauten Capes). */
async function renderLook() {
  const list = $('spieler-traegt');
  const cosmetics = state.profile.cosmetics;
  if (!cosmetics || (!cosmetics.cape && !Object.keys(cosmetics.worn).length)) {
    list.hidden = true;
    return;
  }
  const [catalog, capes] = await Promise.all([loadCosmeticCatalog().catch(() => []), loadBuiltinCapes().catch(() => [])]);
  const nameOf = (id) => capes.find((cape) => cape.id === id)?.name ?? catalog.find((entry) => entry.id === id)?.name ?? null;
  const chips = [];
  if (cosmetics.cape && nameOf(cosmetics.cape)) chips.push(['Cape', nameOf(cosmetics.cape)]);
  for (const slot of WORN_SLOTS) if (cosmetics.worn[slot] && nameOf(cosmetics.worn[slot])) chips.push([SLOT_NAMES[slot] ?? slot, nameOf(cosmetics.worn[slot])]);
  list.replaceChildren(...chips.map(([slot, name]) => h('li', null, h('span', { class: 'chip' }, icon(slot === 'Cape' ? 'cape' : 'sparkles'), `${slot}: ${name}`))));
  list.hidden = !chips.length;
}

// ---------------------------------------------------------------------------------------------------------
// 3D-Figur (skinview3d, nur Skripte von dieser Seite)
// ---------------------------------------------------------------------------------------------------------

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

function loadSkinImage(uuid) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => (image.naturalWidth === 64 && (image.naturalHeight === 64 || image.naturalHeight === 32) ? resolve(image) : reject(new Error('kein Skin'))));
    image.addEventListener('error', () => reject(new Error('kein Skin')));
    image.src = `/api/v1/public/skins/${encodeURIComponent(uuid)}`;
  });
}

function figureFallback() {
  const host = $('spieler-figur');
  host.dataset.webgl = 'nein';
  $('spieler-canvas').hidden = true;
  $('spieler-figur-hinweis').hidden = true;
  const spare = $('spieler-figur-ersatz');
  spare.hidden = false;
  spare.replaceChildren(avatar(state.profile.name, state.profile.uuid, { size: 'xl', skin: 'public' }));
}

async function startFigure() {
  const host = $('spieler-figur');
  const canvas = $('spieler-canvas');
  if (state.figure) return;
  state.figure = { status: 'loading' };
  let lib;
  try {
    lib = await loadViewerScript();
  } catch {
    return figureFallback();
  }
  if (!webglAvailable()) return figureFallback();
  let viewer = null;
  try {
    viewer = new lib.SkinViewer({ canvas, width: host.clientWidth || 320, height: host.clientHeight || 320, skin: '/assets/standard-skin.png', fov: 38, zoom: 0.78 });
  } catch {
    viewer = null;
  }
  if (!viewer) return figureFallback();
  state.figure = { status: 'ready', viewer, layer: null };
  host.dataset.webgl = 'ja';
  viewer.autoRotate = !reduceMotion;
  viewer.autoRotateSpeed = 0.6;
  viewer.controls.enableZoom = false;
  viewer.controls.enablePan = false;
  viewer.controls.minPolarAngle = Math.PI * 0.3;
  viewer.controls.maxPolarAngle = Math.PI * 0.62;
  viewer.controls.addEventListener('start', () => {
    viewer.autoRotate = false;
    $('spieler-figur-hinweis').hidden = true;
  });
  viewer.playerWrapper.rotation.y = Math.PI * 0.84;
  try {
    state.figure.layer = createCosmeticLayer(viewer, { skinview3d: lib, idle: !reduceMotion, playing: !reduceMotion });
  } catch {
    state.figure.layer = null;
  }
  new ResizeObserver(() => {
    if (host.clientWidth > 0 && host.clientHeight > 0) viewer.setSize(host.clientWidth, host.clientHeight);
  }).observe(host);
  let visible = true;
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    viewer.renderPaused = !visible || document.hidden;
  }).observe(host);
  document.addEventListener('visibilitychange', () => {
    viewer.renderPaused = !visible || document.hidden;
  });
  try {
    await viewer.loadSkin(await loadSkinImage(state.profile.uuid), { model: 'auto-detect' });
    host.dataset.skin = 'eigener';
  } catch {
    host.dataset.skin = 'standard';
  }
  await wearCosmetics();
}

/** Cape und Cosmetics anziehen – jedes erst nach geprüfter Signatur; was nicht klappt, bleibt still weg. */
async function wearCosmetics() {
  const figure = state.figure;
  const cosmetics = state.profile.cosmetics;
  if (figure?.status !== 'ready' || !figure.layer || !cosmetics) return;
  const worn = { ...cosmetics.worn };
  if (cosmetics.cape) worn.cape = cosmetics.cape;
  const ids = Object.entries(worn);
  if (!ids.length) return;
  const catalog = await loadCosmeticCatalog().catch(() => []);
  const capes = worn.cape && BUILTIN_CAPE_IDS.includes(worn.cape) ? await loadBuiltinCapes().catch(() => []) : [];
  let shown = 0;
  await Promise.all(
    ids.map(async ([slot, id]) => {
      try {
        let item = null;
        if (slot === 'cape' && BUILTIN_CAPE_IDS.includes(id)) {
          const cape = capes.find((entry) => entry.id === id);
          if (cape) item = await prepareBuiltinCape(cape);
        } else {
          const entry = catalog.find((candidate) => candidate.id === id && candidate.slot === slot);
          if (entry) item = await prepareCosmetic(await loadCosmetic(entry));
        }
        if (item && (figure.layer.supported || slot === 'cape')) {
          figure.layer.wear(slot, item);
          shown++;
        }
      } catch {
        // nicht geprüft oder nicht ladbar: weglassen
      }
    }),
  );
  $('spieler-figur').dataset.cosmetics = String(shown);
}

// ---------------------------------------------------------------------------------------------------------
// Freund hinzufügen, Zusammen spielen
// ---------------------------------------------------------------------------------------------------------

async function loadMe() {
  try {
    return await api('GET', '/v1/web/me');
  } catch {
    return null;
  }
}

/** Beziehung zum angemeldeten Spieler: self | friend | outgoing | incoming | none | guest. */
function relation() {
  const profile = state.profile;
  if (!state.me) return 'guest';
  if (state.me.uuid === profile.uuid) return 'self';
  const friends = state.friends;
  if (!friends) return 'none';
  const has = (list) => (Array.isArray(list) ? list : []).some((entry) => entry?.uuid === profile.uuid);
  if (has(friends.friends)) return 'friend';
  if (has(friends.outgoing)) return 'outgoing';
  if (has(friends.incoming)) return 'incoming';
  return 'none';
}

function setFriendState(text) {
  const box = $('spieler-freund-stand');
  box.textContent = text || '';
  box.hidden = !text;
}

function renderFriend() {
  const profile = state.profile;
  const kind = relation();
  page.dataset.beziehung = kind;
  const button = $('spieler-freund');
  const label = button.querySelector('span');
  button.hidden = true;
  button.disabled = false;
  setFriendState('');
  if (kind === 'incoming') {
    button.hidden = false;
    label.textContent = 'Anfrage annehmen';
    setFriendState(`${profile.name} hat dir eine Freundschaftsanfrage geschickt.`);
  } else if (kind === 'none' && profile.friendsButton) {
    button.hidden = false;
    label.textContent = 'Freund hinzufügen';
  } else if (kind === 'guest' && profile.friendsButton) {
    button.hidden = false;
    label.textContent = 'Freund hinzufügen';
  } else if (kind === 'outgoing') {
    setFriendState(`Deine Anfrage an ${profile.name} ist unterwegs.`);
  } else if (kind === 'friend') {
    setFriendState(`Du und ${profile.name} seid befreundet.`);
  }
  $('spieler-melden').hidden = kind === 'self';
  renderTogether(kind);
}

function renderTogether(kind) {
  const profile = state.profile;
  const box = $('zusammen');
  const parts = [];
  const download = h('a', { class: 'btn btn--secondary btn--sm', href: '/download', id: 'zusammen-download' }, icon('download'), 'HeldixClient herunterladen');
  if (kind === 'self') {
    parts.push(
      h('p', { class: 'small', text: 'Das ist dein öffentliches Profil. Was hier steht, legst du im Konto unter Öffentliches Profil fest.' }),
      h('div', { class: 'btn-group' }, h('a', { class: 'btn btn--primary btn--sm', href: '/konto#reiter=oeffentlich', id: 'zusammen-bearbeiten' }, icon('edit'), 'Profil bearbeiten')),
    );
  } else if (kind === 'friend') {
    parts.push(
      h('p', { class: 'small', text: `Ihr seid befreundet: Schreib ${profile.name} eine Nachricht oder lade ihn in deine Party ein – im Konto, im Launcher oder im Spiel.` }),
      h(
        'div',
        { class: 'btn-group' },
        h('a', { class: 'btn btn--primary btn--sm', href: `/konto#reiter=nachrichten&mit=${profile.uuid}`, id: 'zusammen-nachricht' }, icon('chat'), 'Nachricht schreiben'),
        h('a', { class: 'btn btn--secondary btn--sm', href: '/konto#reiter=party', id: 'zusammen-party' }, icon('friends'), 'Zur Party'),
      ),
    );
  } else if (kind === 'guest') {
    const login = h('a', { class: 'btn btn--primary btn--sm', href: '/konto', id: 'zusammen-anmelden' }, icon('user'), 'Anmelden');
    setupLoginLink(login, `/spieler/${profile.name}`);
    parts.push(
      h('p', { class: 'small', text: profile.friendsButton ? `Melde dich mit deinem Minecraft-Konto an, um ${profile.name} als Freund hinzuzufügen. Noch kein HeldixClient? Er ist kostenlos für Windows und Mac.` : `Mit HeldixClient spielst du mit Freunden zusammen, seht ihr, wo der andere spielt, und tretet mit einem Klick bei. Er ist kostenlos für Windows und Mac.` }),
      h('div', { class: 'btn-group' }, profile.friendsButton ? login : null, download),
    );
  } else {
    parts.push(
      h('p', {
        class: 'small',
        text:
          kind === 'outgoing'
            ? `Sobald ${profile.name} deine Anfrage annimmt, seid ihr Freunde und seht, wo der andere spielt.`
            : kind === 'incoming'
              ? `Nimm die Anfrage an, dann seid ihr Freunde und seht, wo der andere spielt.`
              : profile.friendsButton
                ? `Füge ${profile.name} als Freund hinzu. Nimmt er an, seht ihr, wo der andere spielt, und könnt euch Nachrichten schreiben.`
                : `${profile.name} nimmt über diese Seite keine Freundschaftsanfragen an.`,
      }),
      h('div', { class: 'btn-group' }, h('a', { class: 'btn btn--secondary btn--sm', href: '/konto#reiter=freunde', id: 'zusammen-freunde' }, icon('friends'), 'Zur Freundesliste')),
    );
  }
  if (profile.worlds.length && kind !== 'self') parts.push(h('p', { class: 'small text-2', id: 'zusammen-welten' }, icon('world'), ` ${profile.name} hat ${profile.worlds.length === 1 ? 'eine offene Welt' : `${profile.worlds.length} offene Welten`} – unten mit „Beitreten“ direkt hinein.`));
  box.replaceChildren(...parts.filter(Boolean));
}

async function onFriend(event) {
  const button = event.currentTarget;
  const profile = state.profile;
  const kind = relation();
  if (kind === 'guest') {
    const login = $('zusammen-anmelden');
    setFriendState(`Melde dich zuerst mit deinem Minecraft-Konto an – danach kommst du hierher zurück.`);
    login?.focus();
    return;
  }
  try {
    let data;
    if (kind === 'incoming') data = await busy(button, () => api('POST', `/v1/friends/requests/${profile.uuid}/accept`));
    else data = await busy(button, () => api('POST', '/v1/friends/requests', { name: profile.name }));
    if (data && typeof data === 'object' && Array.isArray(data.friends)) state.friends = data;
    else state.friends = await api('GET', '/v1/friends').catch(() => state.friends);
    renderFriend();
    const now = relation();
    toast(now === 'friend' ? `Ihr seid jetzt Freunde: ${profile.name} steht in deiner Freundesliste.` : `Anfrage an ${profile.name} gesendet.`, 'success');
  } catch (error) {
    if (error.status === 401) {
      state.me = null;
      state.friends = null;
      renderFriend();
      setFriendState('Deine Anmeldung ist abgelaufen. Melde dich noch einmal an.');
      return;
    }
    setFriendState(error.message);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Teilen und Melden
// ---------------------------------------------------------------------------------------------------------

const profileUrl = () => `${location.origin}/spieler/${encodeURIComponent(state.profile?.name ?? '')}`;

async function share() {
  const url = profileUrl();
  const title = `${state.profile.name} auf HeldixClient`;
  if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  const ok = await copyText(url);
  toast(ok ? 'Link zum Profil kopiert.' : 'Kopieren ging nicht – bitte den Link aus der Adresszeile nehmen.', ok ? 'success' : 'error');
}

async function report() {
  const profile = state.profile;
  if (!profile) return;
  if (state.me === undefined) state.me = await loadMe();
  if (!state.me) {
    setFriendState('Zum Melden meldest du dich mit deinem Minecraft-Konto an – so kann das Team Missbrauch der Meldungen erkennen.');
    renderTogether('guest');
    $('zusammen-anmelden')?.focus();
    return;
  }
  const result = await reportDialog({
    title: `Profil von ${profile.name} melden`,
    intro: 'Das Team sieht sich das Profil an und blendet es bei einem Verstoß aus. Der Spieler erfährt nicht, wer gemeldet hat.',
    send: (body) => api('POST', `/v1/public/players/${encodeURIComponent(profile.name)}/report`, body),
  });
  if (result === true) toast('Danke! Die Meldung ist beim Team.', 'success');
  else if (result === 'abgemeldet') {
    state.me = null;
    renderFriend();
    setFriendState('Deine Anmeldung ist abgelaufen. Melde dich noch einmal an, um das Profil zu melden.');
  }
}

// ---------------------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------------------

async function start() {
  state.wanted = readName();
  if (!state.wanted) return showGone('ohne-name');
  show('laden');
  const mePromise = loadMe();
  let data;
  try {
    data = await publicGet(`/v1/public/players/${encodeURIComponent(state.wanted)}`);
  } catch (error) {
    if (error.status === 404 || error.status === 400) return showGone('unbekannt');
    if (error.status === 429) return showGone('viele');
    return showGone('fehler');
  }
  const profile = normalizeProfile(data);
  if (!profile) return showGone('unbekannt');
  state.profile = profile;
  // Schreibweise wie im Dienst (z. B. /spieler/steve → /spieler/Steve, UUID → Name)
  if (/^\/spieler\//.test(location.pathname) && decodeURIComponent(location.pathname.slice(9)).replace(/\/$/, '') !== profile.name) history.replaceState(null, '', `/spieler/${encodeURIComponent(profile.name)}`);
  state.me = await mePromise;
  if (state.me && state.me.uuid !== profile.uuid) state.friends = await api('GET', '/v1/friends').catch(() => null);
  show('profil');
  render();
}

$('spieler-freund').addEventListener('click', onFriend);
$('spieler-teilen').addEventListener('click', share);
$('spieler-melden').addEventListener('click', report);
$('spieler-erneut').addEventListener('click', start);
start();
