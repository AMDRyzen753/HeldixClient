// HeldixClient – Webseite: Oberfläche für den Voice Chat im Browser (auf /einladung bei Einladungen mit Voice-Gruppe).
//
// - Beitreten: als Gast mit Namen (POST /v1/public/invites/<code>/guest → Token, nur im Speicher dieser Seite) oder
//   angemeldet „Als <Name> beitreten“ (Web-Cookie). Ohne WebCodecs-Opus ein klarer Hinweis.
// - Im Gespräch: eigener Pegel mit Schwelle, Sprachaktivierung oder Push-to-Talk (Leertaste oder Knopf halten),
//   Mikrofon stumm, Ton aus, Teilnehmerliste mit Sprech-Anzeige, Gast/Browser-Kennzeichen, Lautstärke je Person,
//   Gäste entfernen (nur angemeldet), Verlassen. Verbindung und Audio: voice-browser.js.
// Einstellungen (Sprechmodus, Schwelle, Lautstärken) bleiben nur, solange die Seite offen ist.
import { ApiError, api, avatar, h, icon, toast, uid } from './app-common.js';
import { CLOSE_TEXTS, VoiceSession, checkVoiceSupport } from './voice-browser.js';

/** Gast-Name wie beim Dienst: 3–16 Zeichen aus Buchstaben (auch ÄÖÜäöüß), Ziffern, Leerzeichen, _ . -, mindestens ein Buchstabe oder eine Ziffer */
export const GUEST_NAME_RE = /^[A-Za-zÄÖÜäöüß0-9 _.-]{3,16}$/;
export const validGuestName = (name) => GUEST_NAME_RE.test(name) && /[A-Za-zÄÖÜäöüß0-9]/.test(name);
const SUPPORT_TEXTS = {
  unsicher: 'Der Voice Chat braucht eine sichere Verbindung (HTTPS). Öffne die Einladung über den Link mit https://.',
  webcodecs: 'Dein Browser kann hier keine Sprache übertragen. Nimm einen aktuellen Chrome, Edge oder Firefox.',
  opus: 'Dein Browser kann den Sprach-Codec Opus hier nicht nutzen. Nimm einen aktuellen Chrome, Edge oder Firefox.',
  worklet: 'Dein Browser kann den Ton hier nicht verarbeiten. Nimm einen aktuellen Chrome, Edge oder Firefox.',
};
const MIC_TEXTS = {
  verweigert: 'Du hast den Zugriff auf das Mikrofon nicht erlaubt – du hörst nur zu. Erlaube ihn in der Adresszeile (Schloss-Symbol) und klicke dann auf „Mikrofon erlauben“.',
  keins: 'Kein Mikrofon gefunden – du hörst nur zu. Schließ eins an und klicke auf „Mikrofon erlauben“.',
  'nicht-verfuegbar': 'Dein Browser gibt hier kein Mikrofon frei – du hörst nur zu.',
  beendet: 'Das Mikrofon wurde getrennt – du hörst nur zu.',
  fehler: 'Das Mikrofon ließ sich nicht öffnen – du hörst nur zu.',
};

const isTextField = (element) => {
  if (!element || element === document.body) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['range', 'button', 'submit', 'reset'].includes(element.type);
};

const shortName = (id) => `Spieler ${id.slice(0, 4)}`;

/**
 * Bereich in `root` einrichten. invite: Antwort von GET /v1/public/invites/<code>; me: Profil (angemeldet) oder null;
 * names: [[uuid, name]] bekannter Spieler (Einladender, Freunde); onChange(state): 'form' | 'call' | 'ended'.
 */
export function mountVoicePanel(root, { code, invite, me, names = [], onChange = () => {} }) {
  const state = {
    support: null,
    session: null,
    asGuest: !me,
    guestName: '',
    selfId: null,
    selfName: '',
    peers: [],
    speaking: new Set(),
    mode: 'vad',
    threshold: 0.4,
    muted: false,
    deafened: false,
    status: 'idle',
    endMessage: null,
    endCode: null,
    microphone: { ok: false, reason: null },
    retryIn: 0,
  };
  const ids = { name: uid('gast-name'), error: uid('gast-fehler'), threshold: uid('schwelle') };
  const knownNames = new Map(names);

  // -------------------------------------------------------------------------------------------------------
  // Beitreten
  // -------------------------------------------------------------------------------------------------------

  function renderForm() {
    onChange('form');
    const voice = invite.voice ?? { members: 0, guests: 0, maxGuests: 4 };
    const full = voice.guests >= (voice.maxGuests || 4);
    const lead = h(
      'p',
      { class: 'voice-lead' },
      `Sprich mit ${invite.inviter.name} und der Gruppe${invite.server ? ` auf ${invite.server}` : ''} – direkt hier im Browser, ohne Minecraft. `,
      voice.members || voice.guests
        ? h('span', { class: 'voice-count', text: `Gerade dabei: ${voice.members} ${voice.members === 1 ? 'Spieler' : 'Spieler'}${voice.guests ? `, ${voice.guests} von ${voice.maxGuests || 4} Gästen` : ''}.` })
        : h('span', { class: 'voice-count', text: 'Gerade ist noch niemand im Gespräch.' }),
    );
    const parts = [h('div', { class: 'voice-head' }, h('span', { class: 'voice-badge', 'aria-hidden': 'true' }, icon('headphones')), h('div', null, h('h2', { id: 'voice-raum-titel', text: 'Im Browser mitreden' }), lead))];

    if (state.support && !state.support.ok) {
      parts.push(h('p', { class: 'notice voice-notice', role: 'status', dataset: { grund: state.support.reason } }, SUPPORT_TEXTS[state.support.reason] ?? SUPPORT_TEXTS.webcodecs));
      parts.push(advert());
      root.replaceChildren(...parts);
      return;
    }
    if (state.endMessage) parts.push(h('p', { class: 'notice voice-notice', role: 'alert', text: state.endMessage }));

    if (me && !state.asGuest) {
      const join = h('button', { type: 'button', class: 'button big voice-join', id: 'voice-beitreten', onClick: () => joinAsUser(join) }, icon('mic'), h('span', { text: `Als ${me.name} beitreten` }));
      parts.push(
        h(
          'div',
          { class: 'voice-join-box' },
          join,
          h('p', { class: 'hint voice-replace', text: 'Bist du gerade im Spiel mit dem Voice Chat verbunden, wechselt die Verbindung hierher – im Spiel bist du dann nicht mehr im Gespräch, bis du dort neu verbindest.' }),
          h('button', { type: 'button', class: 'link-button voice-switch', onClick: () => ((state.asGuest = true), renderForm()) }, 'Stattdessen als Gast mitreden'),
        ),
      );
    } else {
      const input = h('input', {
        class: 'input',
        id: ids.name,
        name: 'name',
        autocomplete: 'nickname',
        maxlength: '16',
        minlength: '3',
        spellcheck: 'false',
        placeholder: 'z. B. Lena',
        required: true,
        disabled: full || undefined,
        'aria-describedby': `${ids.error} ${ids.name}-hinweis`,
        value: state.guestName,
      });
      const error = h('p', { class: 'form-error', id: ids.error, role: 'alert', hidden: true });
      const submit = h('button', { type: 'submit', class: 'button', id: 'voice-gast-beitreten', disabled: full || undefined }, icon('mic'), 'Beitreten');
      const form = h(
        'form',
        { class: 'voice-guest', id: 'voice-gast-form', novalidate: true },
        h('label', { class: 'field', for: ids.name }, h('span', { text: 'Dein Name im Gespräch' })),
        h('div', { class: 'voice-guest-row' }, input, submit),
        error,
        h('p', { class: 'hint', id: `${ids.name}-hinweis`, text: full ? `Gerade sind schon ${voice.maxGuests || 4} Gäste dabei. Versuch es gleich noch einmal.` : '3 bis 16 Zeichen. Den Namen sehen nur die anderen in dieser Gruppe; er gilt nur für diese Sitzung (höchstens 6 Stunden) und wird nicht gespeichert.' }),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        joinAsGuest(input, error, submit);
      });
      parts.push(form);
      if (me) parts.push(h('button', { type: 'button', class: 'link-button voice-switch', onClick: () => ((state.asGuest = false), renderForm()) }, `Doch als ${me.name} beitreten`));
    }
    parts.push(
      h(
        'ul',
        { class: 'voice-facts' },
        h('li', null, icon('mic'), h('span', { text: 'Dein Browser fragt nach dem Mikrofon. Ohne Mikrofon hörst du nur zu.' })),
        h('li', null, icon('headphones'), h('span', { text: 'Nimm am besten Kopfhörer – sonst hören die anderen sich selbst.' })),
        h('li', null, icon('lock'), h('span', { text: 'Deine Stimme geht nur über den Heldix-Dienst an diese Gruppe. Niemand nimmt etwas auf, gespeichert wird nichts.' })),
      ),
    );
    parts.push(advert());
    root.replaceChildren(...parts);
  }

  function advert() {
    return h(
      'aside',
      { class: 'voice-advert' },
      h('span', { class: 'voice-advert-icon', 'aria-hidden': 'true' }, icon('loader-heldix')),
      h(
        'div',
        null,
        h('strong', { text: 'Hol dir HeldixClient – dann bist du auch im Spiel dabei.' }),
        h('p', { text: 'Kostenlos für Windows und Mac. Nimmst du die Einladung als neuer Spieler an, bekommst du die Willkommens-Belohnung dazu.' }),
      ),
      h('a', { class: 'button small', href: '/download' }, icon('download'), 'Herunterladen'),
    );
  }

  async function ensureSupport() {
    state.support ??= await checkVoiceSupport();
    root.dataset.voiceSupport = state.support.ok ? 'ja' : state.support.reason;
    return state.support;
  }

  async function joinAsGuest(input, error, submit) {
    const name = input.value.trim();
    error.hidden = true;
    if (!validGuestName(name)) {
      error.textContent = 'Der Name hat 3 bis 16 Zeichen aus Buchstaben, Ziffern, Leerzeichen und _ . - (mindestens ein Buchstabe oder eine Ziffer).';
      error.hidden = false;
      input.focus();
      return;
    }
    state.guestName = name;
    submit.disabled = true;
    submit.setAttribute('aria-busy', 'true');
    let guest;
    try {
      guest = await requestGuest(name);
    } catch (problem) {
      submit.disabled = false;
      submit.removeAttribute('aria-busy');
      error.textContent = problem.status === 404 ? CLOSE_TEXTS[4006] : problem.message;
      error.hidden = false;
      return;
    }
    start({ protocols: ['heldix-voice', `gast.${guest.token}`], selfId: guest.id, selfName: guest.name || name, guest: true });
  }

  async function requestGuest(name) {
    const data = await api('POST', `/v1/public/invites/${code}/guest`, { name });
    if (!data || typeof data.token !== 'string' || !/^[A-Za-z0-9._~-]{16,200}$/.test(data.token) || !/^[0-9a-f]{32}$/.test(data.id ?? '')) throw new ApiError(500, 'Der Heldix-Dienst hat keinen gültigen Gast-Zugang geschickt.');
    return data;
  }

  function joinAsUser(button) {
    button.disabled = true;
    start({ protocols: ['heldix-voice'], selfId: me.uuid, selfName: me.name, guest: false });
  }

  async function start({ protocols, selfId, selfName, guest }) {
    const support = await ensureSupport();
    if (!support.ok) return renderForm();
    state.selfId = selfId;
    state.selfName = selfName;
    state.endMessage = null;
    state.peers = [];
    state.status = 'connecting';
    const session = new VoiceSession({
      code,
      protocols,
      selfId,
      guest,
      encoderConfig: support.encoderConfig,
      renewGuest: guest
        ? async () => {
            const next = await requestGuest(state.guestName);
            state.selfId = next.id;
            session.selfId = next.id;
            return ['heldix-voice', `gast.${next.token}`];
          }
        : null,
      checkLogin: guest ? null : () => api('GET', '/v1/web/me').then(() => true, (error) => !(error instanceof ApiError && error.status === 401)),
      onEvent: (type, detail) => onEvent(session, type, detail),
    });
    session.setNames([...knownNames]);
    session.setMode(state.mode);
    session.setThreshold(state.threshold);
    state.session = session;
    state.muted = false;
    state.deafened = false;
    renderCall();
    await session.start();
  }

  // -------------------------------------------------------------------------------------------------------
  // Im Gespräch
  // -------------------------------------------------------------------------------------------------------

  const els = {};

  function onEvent(session, type, detail) {
    if (session !== state.session) return;
    if (type === 'status') {
      state.status = detail.status;
      state.retryIn = detail.retryIn ?? 0;
      if (detail.status === 'closed') {
        state.session = null;
        state.endMessage = detail.message ?? null;
        state.endCode = detail.code ?? null;
        stopKeys();
        renderEnded();
        return;
      }
      updateStatus();
    } else if (type === 'peers') {
      state.peers = detail;
      renderPeers();
    } else if (type === 'activity') {
      state.speaking = detail.speaking;
      updateActivity(detail);
    } else if (type === 'microphone') {
      state.microphone = detail;
      updateMicrophone();
    }
  }

  function renderCall() {
    onChange('call');
    rows.clear();
    const session = state.session;
    els.status = h('p', { class: 'voice-status', id: 'voice-status', role: 'status', 'aria-live': 'polite' });
    els.meterBar = h('span', { class: 'voice-meter-bar' });
    els.meterMark = h('span', { class: 'voice-meter-mark' });
    els.meter = h('div', { class: 'voice-meter', role: 'meter', 'aria-label': 'Pegel deines Mikrofons', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, els.meterBar, els.meterMark);
    els.self = h(
      'div',
      { class: 'voice-self', id: 'voice-ich' },
      avatar(state.selfName, state.selfId, { size: 'lg', skin: state.selfId === me?.uuid ? 'auth' : null }),
      h('div', { class: 'voice-self-main' }, h('div', { class: 'voice-self-name' }, h('strong', { text: state.selfName }), h('span', { class: 'chip accent', text: 'Du' })), els.meter, h('p', { class: 'voice-self-state', id: 'voice-ich-status' })),
    );
    els.mic = h('button', { type: 'button', class: 'voice-toggle', id: 'voice-mikrofon', 'aria-pressed': 'false', onClick: () => setMuted(!state.muted) }, icon('mic'), h('span', { text: 'Mikrofon' }));
    els.deaf = h('button', { type: 'button', class: 'voice-toggle', id: 'voice-ton', 'aria-pressed': 'false', onClick: () => setDeafened(!state.deafened) }, icon('headphones'), h('span', { text: 'Ton' }));
    els.leave = h('button', { type: 'button', class: 'button small ghost danger-text', id: 'voice-verlassen', onClick: () => session.leave() }, icon('close'), 'Verlassen');
    const modeName = uid('sprechen');
    const modeInput = (value, label) => {
      const input = h('input', { type: 'radio', name: modeName, value, onChange: () => setMode(value) });
      input.checked = state.mode === value;
      return h('label', { class: 'voice-mode-option' }, input, h('span', { text: label }));
    };
    els.thresholdInput = h('input', { type: 'range', class: 'range', id: ids.threshold, min: '0', max: '100', step: '1', value: String(Math.round(state.threshold * 100)), 'aria-describedby': `${ids.threshold}-hinweis` });
    els.thresholdInput.addEventListener('input', () => {
      state.threshold = Number(els.thresholdInput.value) / 100;
      state.session?.setThreshold(state.threshold);
      updateMeterMark();
    });
    els.vad = h('div', { class: 'voice-vad' }, h('label', { class: 'field-row', for: ids.threshold }, h('span', { text: 'Schwelle' }), h('span', { class: 'muted small', text: 'ab hier wird gesendet' })), els.thresholdInput, h('p', { class: 'hint', id: `${ids.threshold}-hinweis`, text: 'Sprich normal und schieb die Schwelle knapp unter deinen Pegel. Nach dem letzten Wort wird noch 0,3 Sekunden weiter gesendet.' }));
    els.ptt = h('button', { type: 'button', class: 'button voice-ptt', id: 'voice-ptt' }, icon('mic'), h('span', { text: 'Zum Sprechen halten' }));
    const press = (event) => {
      event.preventDefault();
      els.ptt.setPointerCapture?.(event.pointerId);
      setPtt(true);
    };
    const release = () => setPtt(false);
    els.ptt.addEventListener('pointerdown', press);
    els.ptt.addEventListener('pointerup', release);
    els.ptt.addEventListener('pointercancel', release);
    els.ptt.addEventListener('lostpointercapture', release);
    els.ptt.addEventListener('contextmenu', (event) => event.preventDefault());
    els.pttBox = h('div', { class: 'voice-ptt-box' }, els.ptt, h('p', { class: 'hint' }, 'Oder halte die ', h('kbd', { text: 'Leertaste' }), ' – solange kein Eingabefeld ausgewählt ist.'));
    els.micNotice = h('div', { class: 'voice-mic-notice', id: 'voice-mikrofon-hinweis', hidden: true });
    els.audioNotice = h('div', { class: 'voice-audio-notice', hidden: true }, h('p', { text: 'Dein Browser hat den Ton angehalten.' }), h('button', { type: 'button', class: 'button tiny', onClick: () => state.session?.resumeAudio() }, icon('volume'), 'Ton einschalten'));
    els.peers = h('ul', { class: 'voice-peers', id: 'voice-teilnehmer', 'aria-label': 'Teilnehmer' });
    els.peersEmpty = h('p', { class: 'voice-empty', text: 'Gerade ist sonst niemand in der Gruppe. Sobald jemand dazukommt, siehst du ihn hier.' });

    root.replaceChildren(
      h('div', { class: 'voice-head' }, h('span', { class: 'voice-badge', 'aria-hidden': 'true' }, icon('headphones')), h('div', null, h('h2', { id: 'voice-raum-titel', text: 'Im Gespräch' }), els.status)),
      h(
        'div',
        { class: 'voice-call' },
        h(
          'div',
          { class: 'voice-controls' },
          els.self,
          els.micNotice,
          els.audioNotice,
          h('div', { class: 'voice-toggles', role: 'group', 'aria-label': 'Mikrofon und Ton' }, els.mic, els.deaf),
          h('fieldset', { class: 'voice-mode' }, h('legend', { text: 'Sprechen' }), h('div', { class: 'voice-mode-options' }, modeInput('vad', 'Sprachaktivierung'), modeInput('ptt', 'Push-to-Talk'))),
          els.vad,
          els.pttBox,
          h('div', { class: 'voice-leave' }, els.leave),
        ),
        h('div', { class: 'voice-list' }, h('h3', { class: 'voice-list-title', text: 'In der Gruppe' }), els.peers, els.peersEmpty, h('p', { class: 'hint', text: 'Lautstärke je Person gilt nur hier in diesem Browser. Deine Stimme geht nur an diese Gruppe; niemand nimmt etwas auf.' })),
      ),
    );
    startKeys();
    updateMode();
    updateToggles();
    updateMicrophone();
    updateStatus();
    renderPeers();
    updateMeterMark();
  }

  function updateStatus() {
    if (!els.status) return;
    const text =
      state.status === 'connected'
        ? `Verbunden${invite.server ? ` · Gruppe auf ${invite.server}` : ''}`
        : state.status === 'reconnecting'
          ? `Verbindung unterbrochen – neuer Versuch in ${Math.max(1, Math.round(state.retryIn / 1000))} s …`
          : 'Verbinde …';
    els.status.textContent = text;
    els.status.dataset.state = state.status;
    root.dataset.voice = state.status;
  }

  function updateMicrophone() {
    if (!els.micNotice) return;
    const mic = state.microphone;
    const missing = !mic.ok && mic.reason && mic.reason !== 'aus';
    els.micNotice.hidden = !missing;
    if (missing) {
      const retry = h('button', { type: 'button', class: 'button tiny', id: 'voice-mikrofon-erlauben' }, icon('mic'), 'Mikrofon erlauben');
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        await state.session?.openMicrophone();
        retry.disabled = false;
      });
      els.micNotice.replaceChildren(h('p', { text: MIC_TEXTS[mic.reason] ?? MIC_TEXTS.fehler }), mic.reason === 'nicht-verfuegbar' ? null : retry);
    }
    updateToggles();
  }

  function updateToggles() {
    if (!els.mic) return;
    const micOff = state.muted || state.deafened || !state.microphone.ok;
    els.mic.setAttribute('aria-pressed', String(state.muted));
    els.mic.replaceChildren(icon(micOff ? 'mic-off' : 'mic'), h('span', { text: state.muted ? 'Stumm' : 'Mikrofon' }));
    els.mic.disabled = !state.microphone.ok;
    els.mic.title = state.muted ? 'Mikrofon wieder einschalten' : 'Mikrofon stumm schalten';
    els.deaf.setAttribute('aria-pressed', String(state.deafened));
    els.deaf.replaceChildren(icon(state.deafened ? 'headphones-off' : 'headphones'), h('span', { text: state.deafened ? 'Ton aus' : 'Ton' }));
    els.deaf.title = state.deafened ? 'Ton wieder einschalten' : 'Ton ausschalten (du hörst niemanden und sendest nichts)';
    const line = $self('#voice-ich-status');
    if (line) line.textContent = !state.microphone.ok ? 'Nur zuhören' : state.deafened ? 'Ton aus – du hörst niemanden' : state.muted ? 'Mikrofon stumm' : state.mode === 'ptt' ? 'Push-to-Talk' : 'Sprachaktivierung';
  }

  const $self = (selector) => root.querySelector(selector);

  function updateMode() {
    if (!els.vad) return;
    els.vad.hidden = state.mode !== 'vad';
    els.pttBox.hidden = state.mode !== 'ptt';
    updateToggles();
  }

  function updateMeterMark() {
    if (els.meterMark) els.meterMark.style.left = `${Math.round(state.threshold * 100)}%`;
  }

  function updateActivity({ level, talking }) {
    if (els.meterBar) {
      const percent = Math.round(level * 100);
      els.meterBar.style.width = `${percent}%`;
      els.meter.setAttribute('aria-valuenow', String(percent));
      els.meter.classList.toggle('over', level >= state.threshold && state.mode === 'vad');
    }
    els.self?.classList.toggle('speaking', talking);
    root.dataset.sendet = talking ? 'ja' : 'nein';
    for (const row of els.peers?.children ?? []) row.classList.toggle('speaking', state.speaking.has(row.dataset.id));
  }

  function setMuted(muted) {
    state.muted = muted;
    state.session?.setMuted(muted);
    updateToggles();
  }

  function setDeafened(deafened) {
    state.deafened = deafened;
    state.session?.setDeafened(deafened);
    updateToggles();
  }

  function setMode(mode) {
    state.mode = mode;
    state.session?.setMode(mode);
    updateMode();
  }

  function setPtt(down) {
    state.session?.setPtt(down);
    els.ptt?.classList.toggle('pressed', down);
    els.ptt?.setAttribute('aria-pressed', String(down));
  }

  // Leertaste als Push-to-Talk (nur ohne ausgewähltes Eingabefeld; Knöpfe lösen dabei nicht aus)
  let keysOn = false;
  const onKeyDown = (event) => {
    if (state.mode !== 'ptt' || event.code !== 'Space' || isTextField(event.target)) return;
    event.preventDefault();
    if (!event.repeat) setPtt(true);
  };
  const onKeyUp = (event) => {
    if (event.code !== 'Space' || isTextField(event.target)) return;
    if (state.mode === 'ptt') event.preventDefault();
    setPtt(false);
  };
  const onBlur = () => setPtt(false);
  function startKeys() {
    if (keysOn) return;
    keysOn = true;
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }
  function stopKeys() {
    keysOn = false;
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
  }

  function peerName(peer) {
    return peer.name ?? knownNames.get(peer.id) ?? shortName(peer.id);
  }

  /** Zeilen je Teilnehmer: nur neu bauen, was sich geändert hat (ein Lautstärkeregler in Bedienung bleibt stehen). */
  const rows = new Map();

  function renderPeers() {
    if (!els.peers) return;
    const sorted = [...state.peers].sort((a, b) => Number(b.id === invite.inviter.uuid) - Number(a.id === invite.inviter.uuid) || peerName(a).localeCompare(peerName(b), 'de', { sensitivity: 'base' }));
    els.peersEmpty.hidden = sorted.length > 0;
    const active = document.activeElement;
    const focusKey = active && els.peers.contains(active) ? active.dataset.focusKey : null;
    const canKick = Boolean(state.session && !state.session.guest);
    const nodes = sorted.map((peer) => {
      const signature = JSON.stringify([peerName(peer), peer.guest, peer.browser, peer.muted, peer.deafened, canKick]);
      const cached = rows.get(peer.id);
      if (cached && cached.signature === signature) return cached.element;
      const element = peerRow(peer);
      rows.set(peer.id, { signature, element });
      return element;
    });
    for (const id of [...rows.keys()]) if (!sorted.some((peer) => peer.id === id)) rows.delete(id);
    const current = [...els.peers.children];
    if (current.length !== nodes.length || current.some((element, index) => element !== nodes[index])) {
      els.peers.replaceChildren(...nodes);
      if (focusKey) els.peers.querySelector(`[data-focus-key="${focusKey}"]`)?.focus();
    }
    if (els.status && state.status === 'connected') {
      els.status.textContent = `Verbunden · ${sorted.length === 0 ? 'nur du' : sorted.length === 1 ? 'mit 1 weiteren' : `mit ${sorted.length} weiteren`}${invite.server ? ` · Gruppe auf ${invite.server}` : ''}`;
    }
  }

  function peerRow(peer) {
    const name = peerName(peer);
    const volumeId = uid('lautstaerke');
    const volume = h('input', { type: 'range', class: 'range', id: volumeId, min: '0', max: '200', step: '5', value: String(Math.round((peer.volume ?? 1) * 100)), 'aria-label': `Lautstärke von ${name}`, dataset: { focusKey: `vol:${peer.id}` } });
    const volumeText = h('output', { class: 'voice-volume-value', for: volumeId, text: `${volume.value} %` });
    volume.addEventListener('input', () => {
      state.session?.setVolume(peer.id, Number(volume.value) / 100);
      volumeText.textContent = `${volume.value} %`;
    });
    const chips = [];
    if (peer.id === invite.inviter.uuid) chips.push(h('span', { class: 'chip accent', text: 'lädt ein' }));
    if (peer.guest) chips.push(h('span', { class: 'chip', text: 'Gast' }));
    else if (peer.browser) chips.push(h('span', { class: 'chip', text: 'Browser' }));
    const status = [];
    if (peer.deafened) status.push(h('span', { class: 'voice-peer-icon', title: 'Ton aus' }, icon('headphones-off'), h('span', { class: 'visually-hidden', text: 'Ton aus' })));
    else if (peer.muted) status.push(h('span', { class: 'voice-peer-icon', title: 'Mikrofon stumm' }, icon('mic-off'), h('span', { class: 'visually-hidden', text: 'Mikrofon stumm' })));
    const kick =
      peer.guest && state.session && !state.session.guest
        ? h(
            'button',
            {
              type: 'button',
              class: 'button tiny ghost quiet-danger',
              'aria-label': `${name} aus der Gruppe entfernen`,
              dataset: { focusKey: `kick:${peer.id}` },
              onClick: () => {
                if (state.session?.kick(peer.id)) toast(`${name} wurde aus der Gruppe entfernt.`);
              },
            },
            icon('ban'),
            h('span', { class: 'label', text: 'Entfernen' }),
          )
        : null;
    return h(
      'li',
      { class: `voice-peer${state.speaking.has(peer.id) ? ' speaking' : ''}`, dataset: { id: peer.id, gast: peer.guest ? 'ja' : 'nein' } },
      h('span', { class: 'voice-peer-avatar' }, avatar(name, peer.guest ? null : peer.id, { skin: !peer.guest && me ? 'auth' : null }), h('span', { class: 'voice-wave', 'aria-hidden': 'true' }, icon('volume-2'))),
      h('div', { class: 'voice-peer-main' }, h('div', { class: 'voice-peer-name' }, h('strong', { text: name }), chips, status), h('div', { class: 'voice-volume' }, icon('volume'), volume, volumeText)),
      kick,
    );
  }

  // -------------------------------------------------------------------------------------------------------
  // Beendet
  // -------------------------------------------------------------------------------------------------------

  function renderEnded() {
    onChange('ended');
    root.dataset.voice = 'closed';
    els.status = null;
    els.peers = null;
    els.mic = null;
    els.vad = null;
    els.meterBar = null;
    const final = [4001, 4003, 4006].includes(state.endCode);
    const rejoin = final ? null : h('button', { type: 'button', class: 'button', id: 'voice-neu', onClick: () => ((state.endMessage = null), renderForm()) }, icon('refresh'), 'Wieder beitreten');
    root.replaceChildren(
      h('div', { class: 'voice-head' }, h('span', { class: 'voice-badge', 'aria-hidden': 'true' }, icon('headphones')), h('div', null, h('h2', { id: 'voice-raum-titel', text: state.endMessage ? 'Nicht mehr im Gespräch' : 'Du hast das Gespräch verlassen' }), state.endMessage ? h('p', { class: 'voice-lead', id: 'voice-ende', text: state.endMessage }) : h('p', { class: 'voice-lead', text: 'Dein Mikrofon ist wieder frei.' }))),
      rejoin ? h('div', { class: 'voice-join-box' }, rejoin) : null,
      advert(),
    );
  }

  ensureSupport().then(() => {
    if (!state.session) renderForm();
  });
  renderForm();

  return {
    /** Namen nachreichen (z. B. Freundesliste geladen). */
    addNames(entries) {
      for (const [id, name] of entries) knownNames.set(id, name);
      state.session?.setNames(entries);
      renderPeers();
    },
    leave() {
      state.session?.leave();
    },
    get active() {
      return Boolean(state.session);
    },
  };
}
