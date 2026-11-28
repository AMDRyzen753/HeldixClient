// HeldixClient – Webseite: Oberfläche für den Voice Chat im Browser (auf /einladung bei Einladungen mit Voice-Gruppe).
//
// - Beitreten: als Gast mit Namen (POST /v1/public/invites/<code>/guest → Token, nur im Speicher dieser Seite) oder
//   angemeldet „Als <Name> beitreten“ (Web-Cookie). Ohne WebCodecs-Opus ein klarer Hinweis.
// - Voice-Regeln (ab Dienst 1.13.0): Sind sie veröffentlicht (GET /v1/public/voice/rules), kommt vor dem Beitreten
//   ein eigener Dialog mit dem Text und dem Hinweis auf die Aufnahme beim Melden – „Annehmen“ oder „Ablehnen“, nichts
//   vorausgewählt. Gast: Die angenommene Version geht als rulesVersion mit dem Gast-Zugang (409 voice-rules → Dialog
//   mit dem neuen Text). Angemeldet: GET /v1/voice/me, bei rules.required der Dialog und POST /v1/voice/rules/accept
//   { version }; eine Voice-Sperre (ban) zeigt die Seite gleich an. Schließt der Dienst mit 4012 (neue Version), kommt
//   der Dialog, nach „Annehmen“ verbindet die Seite neu. 4013 (Voice-Sperre) zeigt Sperre, Grund und Einspruch.
// - Im Gespräch: eigener Pegel mit Schwelle, Sprachaktivierung oder Push-to-Talk (Leertaste oder Knopf halten),
//   Mikrofon stumm, Ton aus, Lautstärke-Schutz, Teilnehmerliste mit Sprech-Anzeige, Gast/Browser-Kennzeichen,
//   „vom Gastgeber stummgeschaltet“, Lautstärke je Person, Gäste entfernen (nur angemeldet), Spieler melden (ab 1.13.0:
//   Gast → POST /v1/public/voice/guest-reports mit dem Token, angemeldet → POST /v1/voice/reports; Grund, Notiz,
//   Kontext und Lautstärke-Verlauf, nie eine Aufnahme), Verlassen. Verbindung und Audio: voice-browser.js.
// Einstellungen (Sprechmodus, Schwelle, Lautstärken) bleiben nur, solange die Seite offen ist; nur die Wahl
// „Lautstärke-Schutz“ merkt sich der Browser (localStorage, ohne Bezug zur Person).
import { ApiError, api, avatar, bindCounter, fallbackMessage, formatDate, formatDateTime, h, icon, openDialog, toast, uid } from './app-common.js';
import { CLOSE_TEXTS, VoiceSession, checkVoiceSupport, normalizeBan } from './voice-browser.js';
import { clipMinutes, loadVoiceRules, parseRules, renderRules } from './voice-regeln.js';

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
/** Gründe für Voice-Meldungen (wie im Spiel) */
export const VOICE_REPORT_REASONS = [
  ['insult', 'Beleidigung'],
  ['harassment', 'Belästigung'],
  ['hate', 'Hassrede'],
  ['noise', 'Anschreien/Lärm'],
  ['other', 'Sonstiges'],
];
const NOTE_MAX = 300;
const MC_NAME_RE = /^[A-Za-z0-9_]{1,16}$/;
const PROTECTION_KEY = 'heldix-voice-schutz';
const DECLINED_TEXT = 'Ohne Zustimmung zu den Voice-Regeln kannst du nicht mitreden. Lesen kannst du sie jederzeit auf der Seite „Voice-Regeln“ – die Einladung annehmen und HeldixClient herunterladen geht trotzdem.';
const RULES_CHANGED_TEXT = 'Die Voice-Regeln haben sich gerade geändert. Versuch es gleich noch einmal.';
const APPEAL_TEXT = 'Einspruch: Support-Anfrage (Kategorie „Konto“) auf der Webseite oder im Launcher.';

const isTextField = (element) => {
  if (!element || element === document.body) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return !['range', 'button', 'submit', 'reset'].includes(element.type);
};

const shortName = (id) => `Spieler ${id.slice(0, 4)}`;

/** Lautstärke-Schutz: Wahl des Besuchers (Standard an). Ohne localStorage (privates Fenster, gesperrt) einfach an. */
function loadProtection() {
  try {
    return window.localStorage.getItem(PROTECTION_KEY) !== '0';
  } catch {
    return true;
  }
}

function saveProtection(on) {
  try {
    window.localStorage.setItem(PROTECTION_KEY, on ? '1' : '0');
  } catch {
    // ohne localStorage gilt die Wahl nur, solange die Seite offen ist
  }
}

/** Text zu einer Voice-Sperre (aus `banned` bzw. GET /v1/voice/me) mit Einspruch. */
export function banText(ban) {
  if (!ban) return `${CLOSE_TEXTS[4013]} ${APPEAL_TEXT}`;
  const reason = ban.reason ? ` Grund: ${ban.reason}` : '';
  const main = ban.message ?? (ban.until ? `Du bist bis ${formatDateTime(ban.until)} vom Voice Chat gesperrt.${reason}` : `Du bist dauerhaft vom Voice Chat gesperrt.${reason}`);
  return `${main} ${ban.appeal ?? APPEAL_TEXT}`;
}

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
    protection: loadProtection(),
    status: 'idle',
    endMessage: null,
    endCode: null,
    microphone: { ok: false, reason: null },
    retryIn: 0,
    /** zuletzt geladene Voice-Regeln (für die Hinweise vor dem Beitreten) */
    rules: null,
    /** vom Gast auf dieser Seite angenommene Version (gilt für neue Gast-Zugänge) */
    guestRules: null,
    guestToken: null,
    joinedAsGuest: false,
    /** Neuverbindungen nach 4012 ohne zwischendurch verbunden zu sein (Schutz vor einer Schleife) */
    rulesRetries: 0,
    moderation: false,
    clips: null,
    selfSilenced: false,
    selfSilencedText: null,
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
    if (state.endCode === 4013) parts.push(supportLink());

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
    parts.push(factsList());
    parts.push(advert());
    root.replaceChildren(...parts);
  }

  /** Was beim Mitreden passiert – mit Voice-Regeln (sobald veröffentlicht) und Hinweis auf Aufnahmen beim Melden. */
  function factsList() {
    const rules = state.rules;
    const items = [
      h('li', null, icon('mic'), h('span', { text: 'Dein Browser fragt nach dem Mikrofon. Ohne Mikrofon hörst du nur zu.' })),
      h('li', null, icon('headphones'), h('span', { text: 'Nimm am besten Kopfhörer – sonst hören die anderen sich selbst.' })),
      h('li', null, icon('lock'), h('span', { text: rules?.clips ? 'Deine Stimme geht nur über den Heldix-Dienst an diese Gruppe. Dein Browser nimmt nichts auf und speichert nichts.' : 'Deine Stimme geht nur über den Heldix-Dienst an diese Gruppe. Niemand nimmt etwas auf, gespeichert wird nichts.' })),
    ];
    if (rules?.published) {
      items.push(
        h(
          'li',
          null,
          icon('shield'),
          h(
            'span',
            null,
            'Es gelten die ',
            h('a', { href: '/voice-regeln', target: '_blank', rel: 'noopener' }, 'Voice-Regeln'),
            rules.clips ? `. Meldet dich ein Spieler im Spiel, kann seine Meldung die letzten ${clipMinutes(rules.limits)} Minuten deiner Stimme enthalten.` : ' – vor dem Beitreten fragen wir dich, ob du sie annimmst.',
          ),
        ),
      );
    }
    return h('ul', { class: 'voice-facts', id: 'voice-fakten' }, items);
  }

  function refreshFacts() {
    root.querySelector('#voice-fakten')?.replaceWith(factsList());
  }

  function supportLink() {
    return h('div', { class: 'voice-join-box' }, h('a', { class: 'button small ghost', href: '/konto#reiter=support', id: 'voice-einspruch' }, icon('help-circle'), 'Support-Anfrage stellen'));
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
    const problem = await beginGuest();
    if (!problem) return;
    submit.disabled = false;
    submit.removeAttribute('aria-busy');
    error.textContent = problem.text;
    error.hidden = false;
  }

  /** Gast: Voice-Regeln (falls veröffentlicht), Gast-Zugang, Gespräch. → null (Gespräch beginnt) oder { text }. */
  async function beginGuest({ changed = false } = {}) {
    for (let round = 0; round < 3; round++) {
      const consent = await consentRules({ guest: true, changed: changed || round > 0 });
      if (consent.error) return { text: consent.error };
      let guest;
      try {
        guest = await requestGuest(state.guestName, consent.version);
      } catch (problem) {
        // Regeln noch nicht oder in alter Version angenommen: Dialog mit dem aktuellen Text noch einmal
        if (problem instanceof ApiError && problem.status === 409 && problem.code === 'voice-rules' && !consent.unavailable) {
          state.guestRules = null;
          continue;
        }
        return { text: problem.status === 404 ? CLOSE_TEXTS[4006] : problem.message };
      }
      start({ protocols: ['heldix-voice', `gast.${guest.token}`], selfId: guest.id, selfName: guest.name || state.guestName, guest: true, token: guest.token });
      return null;
    }
    return { text: RULES_CHANGED_TEXT };
  }

  async function requestGuest(name, rulesVersion = null) {
    const body = { name };
    if (rulesVersion) body.rulesVersion = rulesVersion;
    const data = await api('POST', `/v1/public/invites/${code}/guest`, body);
    if (!data || typeof data.token !== 'string' || !/^[A-Za-z0-9._~-]{16,200}$/.test(data.token) || !/^[0-9a-f]{32}$/.test(data.id ?? '')) throw new ApiError(500, 'Der Heldix-Dienst hat keinen gültigen Gast-Zugang geschickt.');
    return data;
  }

  async function joinAsUser(button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const problem = await beginUser();
    if (!problem) return;
    state.endMessage = problem.text;
    state.endCode = problem.code ?? null;
    renderForm();
  }

  /** Angemeldet: Sperre und Voice-Regeln prüfen (GET /v1/voice/me), dann Gespräch. → null oder { text, code? }. */
  async function beginUser({ changed = false } = {}) {
    const consent = await consentRules({ guest: false, changed });
    if (consent.ban) return { text: banText(consent.ban), code: 4013 };
    if (consent.error) return { text: consent.error };
    start({ protocols: ['heldix-voice'], selfId: me.uuid, selfName: me.name, guest: false });
    return null;
  }

  /**
   * Voice-Regeln vor dem Beitreten. → { version } (angenommen, schon angenommen oder nicht nötig; null = keine
   * veröffentlicht bzw. älterer Dienst), { error } (abgelehnt oder nicht ladbar) oder { ban } (angemeldet und vom Voice
   * Chat gesperrt). unavailable: Die Regeln ließen sich nicht laden (dann entscheidet der Dienst beim Beitreten).
   */
  async function consentRules({ guest, changed = false }) {
    for (let round = 0; round < 3; round++) {
      const rules = await loadVoiceRules();
      if (rules) {
        state.rules = rules;
        refreshFacts();
      }
      if (guest) {
        if (!rules) return { version: null, unavailable: true };
        if (!rules.published) return { version: null };
        if (state.guestRules === rules.version) return { version: rules.version };
        const answer = await rulesDialog(rules, { changed: changed || round > 0 });
        if (!answer) return { error: DECLINED_TEXT };
        state.guestRules = rules.version;
        return { version: rules.version };
      }
      let status = null;
      try {
        status = await api('GET', '/v1/voice/me');
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return { error: 'Du bist auf dieser Seite nicht mehr angemeldet. Melde dich neu an oder tritt als Gast bei.' };
        // Älterer Dienst (404) oder gerade nicht erreichbar: wie bisher verbinden – der Dienst prüft beim Verbinden selbst
        status = null;
      }
      const ban = normalizeBan(status?.ban);
      if (ban) return { ban };
      if (status?.rules?.required !== true) return { version: Number.isInteger(status?.rules?.version) ? status.rules.version : null };
      if (!rules?.published) return { error: 'Die Voice-Regeln lassen sich gerade nicht laden. Versuch es gleich noch einmal.' };
      const answer = await rulesDialog(rules, {
        changed: changed || round > 0,
        onAccept: async () => {
          try {
            await api('POST', '/v1/voice/rules/accept', { version: rules.version });
            return 'ok';
          } catch (error) {
            // Inzwischen gilt eine andere Version: Dialog mit dem neuen Text; nichts mehr veröffentlicht: einfach weiter
            if (error instanceof ApiError && error.status === 409 && error.code === 'voice-rules-version') return 'neu';
            if (error instanceof ApiError && error.status === 409 && error.code === 'voice-rules-none') return 'ok';
            throw error;
          }
        },
      });
      if (!answer) return { error: DECLINED_TEXT };
      if (answer === 'neu') continue;
      return { version: rules.version };
    }
    return { error: RULES_CHANGED_TEXT };
  }

  /**
   * Eigenständiger Dialog mit den Voice-Regeln: Hinweis auf die Aufnahme beim Melden, Text zum Scrollen, Link auf
   * /voice-regeln, „Ablehnen“ und „Annehmen“ (der Fokus liegt auf dem Text, nicht auf „Annehmen“).
   * → Ergebnis von onAccept (bzw. true) oder null (abgelehnt).
   */
  function rulesDialog(rules, { changed = false, onAccept = null } = {}) {
    const minutes = clipMinutes(rules.limits);
    const textId = uid('regeln-text');
    const box = h('div', { class: 'voice-rules-text', id: textId, tabindex: '0', role: 'region', 'aria-label': 'Text der Voice-Regeln' }, renderRules(parseRules(rules.text), { level: 3 }).nodes);
    const body = [
      changed ? h('p', { class: 'notice', role: 'status', text: 'Die Voice-Regeln wurden geändert – bitte lies die neue Fassung.' }) : null,
      h('p', { text: 'Bevor du mitredest, lies bitte die Voice-Regeln. Nur wenn du sie annimmst, kannst du den Voice Chat nutzen – im Spiel und hier im Browser.' }),
      h(
        'div',
        { class: 'voice-rules-record' },
        icon('warning'),
        h(
          'div',
          null,
          h('strong', { text: `Meldungen können die letzten ${minutes} Minuten deiner Stimme enthalten.` }),
          h('p', {
            text: `Hier im Browser wird nichts aufgenommen. Spieler im Spiel halten aber die Stimmen, die sie hören, bis zu ${minutes} Minuten im Arbeitsspeicher. Meldet dich einer von ihnen, kann diese Aufnahme deiner Stimme zur Meldung gehören – verschlüsselt gespeichert, nur für das Team, gelöscht ${rules.limits.deleteAfterDoneDays} Tage nach Abschluss der Meldung, spätestens nach ${rules.limits.deleteAfterDays} Tagen.`,
          }),
          h('p', { class: 'hint', text: rules.clips ? 'Aufnahmen beim Melden sind gerade eingeschaltet.' : 'Aufnahmen beim Melden sind gerade ausgeschaltet. Schaltet das Team sie ein, gilt deine Zustimmung auch dafür.' }),
        ),
      ),
      box,
      h('p', { class: 'hint voice-rules-meta' }, `Version ${rules.version}${rules.publishedAt ? ` vom ${formatDate(rules.publishedAt)}` : ''} · `, h('a', { href: '/voice-regeln', target: '_blank', rel: 'noopener' }, 'Voice-Regeln in neuem Tab öffnen')),
    ];
    return openDialog({ title: 'Voice-Regeln lesen und annehmen', body, confirmLabel: 'Annehmen', cancelLabel: 'Ablehnen', onConfirm: onAccept ?? undefined, focus: `#${textId}` });
  }

  /** Nach 4012 (neue Voice-Regeln während des Gesprächs): Dialog, nach „Annehmen“ gleich wieder verbinden. */
  async function resumeAfterRules() {
    if (++state.rulesRetries > 2) {
      state.endMessage = 'Die Voice-Regeln ließen sich gerade nicht bestätigen. Versuch es gleich noch einmal.';
      renderEnded();
      return;
    }
    state.guestRules = null;
    const problem = state.joinedAsGuest ? await beginGuest({ changed: true }) : await beginUser({ changed: true });
    if (!problem || state.session) return;
    state.endMessage = problem.text;
    state.endCode = problem.code ?? null;
    renderEnded();
  }

  async function start({ protocols, selfId, selfName, guest, token = null }) {
    const support = await ensureSupport();
    if (!support.ok) return renderForm();
    state.selfId = selfId;
    state.selfName = selfName;
    state.endMessage = null;
    state.endCode = null;
    state.peers = [];
    state.status = 'connecting';
    state.guestToken = guest ? token : null;
    state.joinedAsGuest = guest;
    state.moderation = false;
    state.clips = null;
    state.selfSilenced = false;
    state.selfSilencedText = null;
    const session = new VoiceSession({
      code,
      protocols,
      selfId,
      guest,
      encoderConfig: support.encoderConfig,
      protection: state.protection,
      renewGuest: guest
        ? async () => {
            const next = await requestGuest(state.guestName, state.guestRules);
            state.selfId = next.id;
            state.guestToken = next.token;
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
        state.endCode = detail.code ?? null;
        state.endMessage = detail.code === 4013 ? banText(detail.ban) : (detail.message ?? null);
        stopKeys();
        renderEnded();
        if (detail.code === 4012) resumeAfterRules();
        return;
      }
      if (detail.status === 'connected') state.rulesRetries = 0;
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
    } else if (type === 'moderation') {
      state.moderation = detail.moderation;
      state.clips = detail.clips;
      updateListHint();
      renderPeers();
    } else if (type === 'self') {
      state.selfSilenced = detail.silenced;
      state.selfSilencedText = detail.message ?? null;
      updateModNotice();
    } else if (type === 'notice' && detail?.message) {
      toast(detail.message);
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
    els.modNotice = h('div', { class: 'voice-mod-notice', id: 'voice-stumm-hinweis', role: 'status', hidden: true });
    els.audioNotice = h('div', { class: 'voice-audio-notice', hidden: true }, h('p', { text: 'Dein Browser hat den Ton angehalten.' }), h('button', { type: 'button', class: 'button tiny', onClick: () => state.session?.resumeAudio() }, icon('volume'), 'Ton einschalten'));
    // Lautstärke-Schutz (Standard an, Wahl bleibt im Browser)
    const protectionId = uid('schutz');
    els.protection = h('input', { type: 'checkbox', role: 'switch', id: protectionId, 'aria-describedby': `${protectionId}-hinweis` });
    els.protection.checked = state.protection;
    els.protection.addEventListener('change', () => setProtection(els.protection.checked));
    els.protectionBox = h(
      'div',
      { class: 'voice-protection', id: 'voice-schutz' },
      h('label', { class: 'switch', for: protectionId }, h('span', { class: 'switch__text' }, h('strong', { text: 'Lautstärke-Schutz' }), h('span', { class: 'hint', id: `${protectionId}-hinweis`, text: 'Dämpft Schreien, Lärm und sehr laute Stimmen, bevor sie bei dir ankommen. Normal laute Sprache ändert er kaum.' })), els.protection),
    );
    els.peers = h('ul', { class: 'voice-peers', id: 'voice-teilnehmer', 'aria-label': 'Teilnehmer' });
    els.peersEmpty = h('p', { class: 'voice-empty', text: 'Gerade ist sonst niemand in der Gruppe. Sobald jemand dazukommt, siehst du ihn hier.' });
    els.listHint = h('p', { class: 'hint', id: 'voice-liste-hinweis' });

    root.replaceChildren(
      h('div', { class: 'voice-head' }, h('span', { class: 'voice-badge', 'aria-hidden': 'true' }, icon('headphones')), h('div', null, h('h2', { id: 'voice-raum-titel', text: 'Im Gespräch' }), els.status)),
      h(
        'div',
        { class: 'voice-call' },
        h(
          'div',
          { class: 'voice-controls' },
          els.self,
          els.modNotice,
          els.micNotice,
          els.audioNotice,
          h('div', { class: 'voice-toggles', role: 'group', 'aria-label': 'Mikrofon und Ton' }, els.mic, els.deaf),
          h('fieldset', { class: 'voice-mode' }, h('legend', { text: 'Sprechen' }), h('div', { class: 'voice-mode-options' }, modeInput('vad', 'Sprachaktivierung'), modeInput('ptt', 'Push-to-Talk'))),
          els.vad,
          els.pttBox,
          els.protectionBox,
          h('div', { class: 'voice-leave' }, els.leave),
        ),
        h('div', { class: 'voice-list' }, h('h3', { class: 'voice-list-title', text: 'In der Gruppe' }), els.peers, els.peersEmpty, els.listHint),
      ),
    );
    startKeys();
    updateMode();
    updateToggles();
    updateMicrophone();
    updateModNotice();
    updateListHint();
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

  /** Vom Gastgeber bzw. Party-Leiter für alle stumm geschaltet: Hinweis über den Knöpfen. */
  function updateModNotice() {
    if (!els.modNotice) return;
    els.modNotice.hidden = !state.selfSilenced;
    root.dataset.stumm = state.selfSilenced ? 'ja' : 'nein';
    if (state.selfSilenced) els.modNotice.replaceChildren(icon('mic-off'), h('p', { text: state.selfSilencedText ?? 'Du wurdest in dieser Gruppe für alle stummgeschaltet – die anderen hören dich gerade nicht.' }));
  }

  function updateListHint() {
    if (!els.listHint) return;
    els.listHint.textContent = state.clips
      ? `Lautstärke je Person gilt nur hier in diesem Browser. Dein Browser nimmt nichts auf – Meldungen aus dem Spiel können aber die letzten ${Math.max(1, Math.round(state.clips.maxMs / 60_000))} Minuten enthalten, auch deine Stimme.`
      : 'Lautstärke je Person gilt nur hier in diesem Browser. Deine Stimme geht nur an diese Gruppe; niemand nimmt etwas auf.';
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

  function setProtection(on) {
    state.protection = Boolean(on);
    saveProtection(state.protection);
    state.session?.setProtection(state.protection);
    root.dataset.schutz = state.protection ? 'an' : 'aus';
  }

  // Leertaste als Push-to-Talk (nur ohne ausgewähltes Eingabefeld; Knöpfe lösen dabei nicht aus)
  let keysOn = false;
  const onKeyDown = (event) => {
    if (state.mode !== 'ptt' || event.code !== 'Space' || isTextField(event.target) || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    if (!event.repeat) setPtt(true);
  };
  const onKeyUp = (event) => {
    if (event.code !== 'Space' || isTextField(event.target)) return;
    if (state.mode === 'ptt' && !document.querySelector('dialog[open]')) event.preventDefault();
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
    const canReport = Boolean(state.session && state.moderation);
    const nodes = sorted.map((peer) => {
      const signature = JSON.stringify([peerName(peer), peer.guest, peer.browser, peer.muted, peer.deafened, peer.silenced, canKick, canReport]);
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
    if (peer.silenced) chips.push(h('span', { class: 'chip warning voice-silenced', title: 'Der Heldix-Dienst leitet die Stimme gerade an niemanden weiter.', text: 'vom Gastgeber stummgeschaltet' }));
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
    // Melden geht nur bei Spielern (Gäste haben eine zufällige ID) und nur mit Dienst ab 1.13.0
    const report =
      !peer.guest && state.session && state.moderation
        ? h(
            'button',
            { type: 'button', class: 'button tiny ghost quiet-danger voice-report', 'aria-label': `${name} melden`, title: `${name} beim HeldixClient-Team melden`, dataset: { focusKey: `melden:${peer.id}` }, onClick: () => reportPeer(peer.id) },
            icon('flag'),
            h('span', { class: 'label', text: 'Melden' }),
          )
        : null;
    return h(
      'li',
      { class: `voice-peer${state.speaking.has(peer.id) ? ' speaking' : ''}`, dataset: { id: peer.id, gast: peer.guest ? 'ja' : 'nein', stumm: peer.silenced ? 'ja' : 'nein' } },
      h('span', { class: 'voice-peer-avatar' }, avatar(name, peer.guest ? null : peer.id, { skin: !peer.guest && me ? 'auth' : null }), h('span', { class: 'voice-wave', 'aria-hidden': 'true' }, icon('volume-2'))),
      h('div', { class: 'voice-peer-main' }, h('div', { class: 'voice-peer-name' }, h('strong', { text: name }), chips, status), h('div', { class: 'voice-volume' }, icon('volume'), volume, volumeText)),
      kick,
      report,
    );
  }

  // -------------------------------------------------------------------------------------------------------
  // Melden
  // -------------------------------------------------------------------------------------------------------

  /** Dialog „<Name> melden“: Grund (Pflicht, nichts vorausgewählt) und Notiz (eine Zeile, höchstens 300 Zeichen). */
  async function reportPeer(id) {
    const session = state.session;
    const peer = state.peers.find((entry) => entry.id === id);
    if (!session || !peer || peer.guest) return;
    const name = peerName(peer);
    const radioName = uid('melden-grund');
    const radios = VOICE_REPORT_REASONS.map(([value, label]) => h('label', { class: 'check voice-report-reason' }, h('input', { type: 'radio', name: radioName, value }), h('span', { text: label })));
    const noteId = uid('melden-notiz');
    const note = h('input', { class: 'input', id: noteId, name: 'notiz', maxlength: String(NOTE_MAX), autocomplete: 'off', placeholder: 'Was ist passiert?' });
    const counter = h('output', { class: 'hint', for: noteId });
    bindCounter(note, counter, NOTE_MAX);
    const heard = Boolean(session.levelsFor(peer.id));
    const body = [
      h('p', { text: `Das HeldixClient-Team prüft deine Meldung. ${name} erfährt nicht, wer gemeldet hat.` }),
      h('fieldset', { class: 'voice-report-reasons' }, h('legend', { text: 'Grund' }), h('div', { class: 'voice-report-grid' }, radios)),
      h('div', { class: 'field' }, h('label', { class: 'field-row', for: noteId }, h('span', { text: 'Notiz (freiwillig)' }), counter), note),
      h('p', {
        class: 'hint',
        text: `Mitgeschickt werden Grund und Notiz, der Zeitpunkt, ${invite.server ? `der Server (${invite.server}), ` : ''}wer gerade in der Gruppe ist${heard ? ` und ein Lautstärke-Verlauf von ${name} aus den letzten 10 Minuten (nur der Pegel je Sekunde, kein Inhalt)` : ''}. Eine Aufnahme schickt der Browser nicht – er nimmt nichts auf.`,
      }),
    ];
    const selected = () => radios.map((label) => label.querySelector('input')).find((input) => input.checked)?.value ?? null;
    const done = await openDialog({
      title: `${name} melden`,
      body,
      confirmLabel: 'Melden',
      canConfirm: () => Boolean(selected()),
      focus: 'input[type="radio"]',
      onConfirm: () => sendReport(session, peer, selected(), note.value),
    });
    if (done) toast(`Danke – deine Meldung zu ${name} ist beim Team.`, 'success');
  }

  /** Wer gerade in der Gruppe ist (nur Spieler, ohne den Gemeldeten und ohne mich), Server, Zeitpunkt. */
  function reportContext(target) {
    const nearby = [];
    for (const peer of state.peers) {
      if (peer.id === target.id || peer.guest || nearby.length >= 20) continue;
      const name = peer.name ?? knownNames.get(peer.id) ?? null;
      nearby.push(name && MC_NAME_RE.test(name) ? { uuid: peer.id, name } : { uuid: peer.id });
    }
    const context = { at: Date.now(), group: true, nearby };
    if (invite.server) context.server = invite.server;
    return context;
  }

  async function sendReport(session, peer, reason, rawNote) {
    if (!VOICE_REPORT_REASONS.some(([value]) => value === reason)) throw new Error('Wähle einen Grund.');
    const note = [...String(rawNote ?? '').replace(/\s+/g, ' ').trim()].slice(0, NOTE_MAX).join('');
    const report = { uuid: peer.id, reason };
    if (note) report.note = note;
    report.context = reportContext(peer);
    const levels = session.levelsFor(peer.id);
    if (levels) report.levels = levels;
    try {
      if (session.guest) {
        if (!state.guestToken) throw new ApiError(401, fallbackMessage(401));
        await api('POST', '/v1/public/voice/guest-reports', { token: state.guestToken, ...report });
      } else {
        await api('POST', '/v1/voice/reports', report);
      }
    } catch (error) {
      throw new Error(reportErrorText(error, session.guest));
    }
    return true;
  }

  function reportErrorText(error, guest) {
    if (!(error instanceof ApiError)) return fallbackMessage(-2);
    const own = error.message && error.message !== fallbackMessage(error.status) ? error.message : null;
    if (error.status === 429) {
      const minutes = error.retryAfter ? Math.max(1, Math.ceil(error.retryAfter / 60)) : null;
      const base = own ?? (guest ? 'Als Gast kannst du höchstens 3 Meldungen in der Stunde schicken.' : 'Du hast gerade schon viele Meldungen geschickt – oder diesen Spieler in den letzten 24 Stunden schon gemeldet.');
      return minutes ? `${base} Versuch es in ${minutes === 1 ? 'einer Minute' : `${minutes} Minuten`} noch einmal.` : base;
    }
    if (error.status === 401) return guest ? 'Deine Gast-Sitzung ist abgelaufen. Tritt neu bei, dann kannst du wieder melden.' : 'Du bist auf dieser Seite nicht mehr angemeldet. Melde dich neu an, dann kannst du melden.';
    if (error.status === 404 && !own) return 'Der Heldix-Dienst nimmt Meldungen aus dem Browser gerade nicht an. Versuch es später noch einmal.';
    return own ?? fallbackMessage(error.status);
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
    els.modNotice = null;
    els.listHint = null;
    // Endgültig: Konto weg/gesperrt, Einladung ungültig, Voice-Sperre, Voice auf dem Server aus
    const final = [4001, 4003, 4006, 4013, 'aus'].includes(state.endCode);
    const rejoin = final
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'button',
            id: 'voice-neu',
            onClick: () => {
              state.endMessage = null;
              state.endCode = null;
              renderForm();
            },
          },
          icon('refresh'),
          'Wieder beitreten',
        );
    root.replaceChildren(
      h('div', { class: 'voice-head' }, h('span', { class: 'voice-badge', 'aria-hidden': 'true' }, icon('headphones')), h('div', null, h('h2', { id: 'voice-raum-titel', text: state.endMessage ? 'Nicht mehr im Gespräch' : 'Du hast das Gespräch verlassen' }), state.endMessage ? h('p', { class: 'voice-lead', id: 'voice-ende', text: state.endMessage }) : h('p', { class: 'voice-lead', text: 'Dein Mikrofon ist wieder frei.' }))),
      rejoin ? h('div', { class: 'voice-join-box' }, rejoin) : null,
      state.endCode === 4013 ? supportLink() : null,
      advert(),
    );
  }

  ensureSupport().then(() => {
    if (!state.session) renderForm();
  });
  loadVoiceRules().then((rules) => {
    if (!rules) return;
    state.rules = rules;
    refreshFacts();
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
