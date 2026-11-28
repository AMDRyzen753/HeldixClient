// HeldixClient – Webseite: Konto → Einstellungen „Profil“ (Statustext), „Privatsphäre“ (Schalter), „Benachrichtigungen“
// („Ist online“-Hinweise, „Nicht stören“, Hinweise auf dieser Seite) – Heldix-Dienst ab 1.12.0 für die neuen Felder.
//
// Gespeichert wird sofort (PUT /v1/me, nacheinander). Die Hinweise auf dieser Seite merkt sich nur dieser Browser.
// hint(): zeigt einen Hinweis (Toast), wenn „Nicht stören“ aus ist, die Art auf dieser Seite an ist und – bei
// „ist online“ – onlineNotify passt.
import { bindCounter, busy, h, rerender, toast } from './app-common.js';

/** Schalter unter Privatsphäre: [Feld, Titel, Erklärung, Standard, ab Dienst 1.12.0?] */
const PRIVACY = [
  ['visible', 'Für andere erkennbar', 'Andere HeldixClient-Spieler sehen das Heldix-Symbol vor deinem Namen, dein Abzeichen, dein Cape und deine Cosmetics.', true, false],
  ['presence', 'Online-Status für Freunde', 'Freunde sehen, ob du online bist und ob du im Menü oder im Spiel bist.', true, false],
  ['showServer', 'Server für Freunde sichtbar', 'Freunde sehen, auf welchem öffentlichen Server du spielst, und können beitreten.', true, false],
  ['showLastOnline', 'Zuletzt online zeigen', 'Freunde sehen ungefähr, wann du zuletzt im Spiel warst („vor 3 Std.“). Nur mit Online-Status.', true, true],
  ['messages', 'Nachrichten von Freunden', 'Freunde können dir Nachrichten schicken.', true, false],
  ['suggestable', 'In Vorschlägen erscheinen', 'Freunde deiner Freunde sehen dich unter „Vielleicht kennst du“ (nur dein Name und wie viele gemeinsame Freunde).', false, true],
  ['showSuggestions', 'Vorschläge zeigen', 'Du siehst unter Freunde „Vielleicht kennst du“.', true, true],
];

/** Hinweise auf dieser Seite (nur lokal) */
const LOCAL_HINTS = [
  ['message', 'Neue Nachrichten', 'Wenn du gerade nicht im Chat mit diesem Freund bist.'],
  ['party', 'Party-Einladungen und „Folgen“', 'Wenn dich jemand einlädt oder die Party den Ort wechselt.'],
  ['party-chat', 'Party-Chat', 'Wenn jemand im Party-Chat schreibt und du nicht im Bereich Party bist.'],
  ['online', 'Freunde kommen online', 'Nach deiner Einstellung oben (alle, nur Favoriten oder keine).'],
  ['request', 'Freundschaftsanfragen', 'Neue Anfragen und angenommene Anfragen.'],
  ['world', 'Welt-Einladungen', 'Wenn dich ein Freund in seine Welt einlädt.'],
];
const STORAGE_KEY = 'heldix.konto.hinweise';
const MAX_STATUS = 40;

export function initSettings(ctx) {
  const { store } = ctx;
  const $ = (id) => document.getElementById(id);
  const local = { hints: readHints() };

  function readHints() {
    const defaults = Object.fromEntries(LOCAL_HINTS.map(([id]) => [id, true]));
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved && typeof saved === 'object') for (const [id] of LOCAL_HINTS) if (typeof saved[id] === 'boolean') defaults[id] = saved[id];
    } catch {
      // ohne localStorage: Standard
    }
    return defaults;
  }

  function writeHints() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(local.hints));
    } catch {
      // nur bis zum Neuladen
    }
  }

  const me = () => store.me ?? {};
  const v12 = () => 'dnd' in me() || 'statusText' in me();

  function switchRow(key, label, description, checked, { dim = false } = {}) {
    const descriptionId = `einstellung-${key}`;
    const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', name: key, 'aria-describedby': descriptionId, dataset: { focusKey: `setting:${key}` } });
    input.checked = checked;
    return h('label', { class: `switch-row${dim ? ' dim' : ''}` }, h('span', { class: 'switch-text' }, h('strong', { text: label }), h('small', { id: descriptionId, text: description })), input);
  }

  function renderPrivacy() {
    const data = me();
    const rows = PRIVACY.filter(([key, , , , isNew]) => !isNew || key in data);
    rerender($('einstellungen'), JSON.stringify(rows.map(([key]) => [key, data[key]])), () =>
      rows.map(([key, label, description, fallback]) => switchRow(key, label, description, typeof data[key] === 'boolean' ? data[key] : fallback, { dim: (key === 'showServer' || key === 'showLastOnline') && data.presence === false })),
    );
    $('cape-unsichtbar').hidden = data.visible !== false || !(data.cape || ctx.wearsSomething());
  }

  function renderProfile() {
    const data = me();
    const input = $('status-text');
    if (document.activeElement !== input) input.value = data.statusText ?? '';
    input.dispatchEvent(new Event('input'));
    $('status-form').hidden = !v12();
    $('status-loeschen').disabled = !data.statusText;
    for (const id of ['profil-dnd', 'hinweise-dnd']) {
      const box = $(id);
      box.checked = Boolean(data.dnd);
      box.closest('.switch-row').hidden = !v12();
    }
  }

  function renderNotifications() {
    const data = me();
    const fieldset = $('online-hinweise');
    fieldset.hidden = !('onlineNotify' in data);
    for (const radio of fieldset.querySelectorAll('input')) radio.checked = radio.value === (data.onlineNotify ?? 'all');
    rerender($('hinweise-lokal'), JSON.stringify(local.hints), () => LOCAL_HINTS.map(([id, label, description]) => switchRow(`hinweis-${id}`, label, description, local.hints[id] !== false)));
  }

  function render() {
    if (!store.me) return;
    renderPrivacy();
    renderProfile();
    renderNotifications();
  }

  async function onPrivacyChange(event) {
    const input = event.target;
    if (!input.classList.contains('switch')) return;
    await ctx.saveMe({ [input.name]: input.checked }, $('einstellungen-gespeichert'));
  }

  async function onStatusSubmit(event) {
    event.preventDefault();
    const input = $('status-text');
    const error = $('status-fehler');
    const text = input.value.replace(/[\r\n]+/g, ' ').trim();
    error.hidden = true;
    if ([...text].length > MAX_STATUS) {
      error.textContent = `Der Statustext ist zu lang (höchstens ${MAX_STATUS} Zeichen).`;
      error.hidden = false;
      return;
    }
    const ok = await busy($('status-speichern'), () => ctx.saveMe({ statusText: text || null }, $('profil-gespeichert'), text ? 'Status gespeichert' : 'Status gelöscht', { onError: (problem) => ((error.textContent = problem.message), (error.hidden = false)) }));
    if (ok) input.value = text;
  }

  async function clearStatus() {
    $('status-text').value = '';
    await ctx.saveMe({ statusText: null }, $('profil-gespeichert'), 'Status gelöscht');
  }

  async function onDnd(event) {
    const value = event.target.checked;
    for (const id of ['profil-dnd', 'hinweise-dnd']) $(id).checked = value;
    await ctx.saveMe({ dnd: value }, event.target.id === 'profil-dnd' ? $('profil-gespeichert') : $('hinweise-gespeichert'), value ? '„Nicht stören“ an' : '„Nicht stören“ aus');
  }

  async function onNotifyChange(event) {
    if (event.target.name !== 'onlineNotify') return;
    await ctx.saveMe({ onlineNotify: event.target.value }, $('hinweise-gespeichert'));
  }

  function onLocalChange(event) {
    const input = event.target;
    if (!input.name?.startsWith('hinweis-')) return;
    local.hints[input.name.slice('hinweis-'.length)] = input.checked;
    writeHints();
  }

  /**
   * Hinweis zeigen, wenn erlaubt. kind: message | party | party-chat | online | request | world.
   * options: { friend (für online), section/params (wohin es gehört), quiet (z. B. Party-Einladung bei „Nicht stören“) }
   */
  function hint(kind, text, options = {}) {
    const data = me();
    if (data.dnd || options.quiet) return false;
    if (local.hints[kind] === false) return false;
    if (kind === 'online') {
      const mode = data.onlineNotify ?? 'all';
      if (mode === 'none' || (mode === 'favorites' && !options.friend?.favorite)) return false;
    }
    if (options.section && ctx.shell.current() === options.section && document.visibilityState === 'visible' && kind !== 'online') return false;
    toast(text.length > 140 ? `${text.slice(0, 139)}…` : text);
    return true;
  }

  $('einstellungen').addEventListener('change', onPrivacyChange);
  $('status-form').addEventListener('submit', onStatusSubmit);
  $('status-loeschen').addEventListener('click', clearStatus);
  $('profil-dnd').addEventListener('change', onDnd);
  $('hinweise-dnd').addEventListener('change', onDnd);
  $('online-hinweise').addEventListener('change', onNotifyChange);
  $('hinweise-lokal').addEventListener('change', onLocalChange);
  bindCounter($('status-text'), $('status-zaehler'), MAX_STATUS);
  ctx.on('me', render);

  return {
    render,
    hint,
    /** Dialog „Status setzen“ (Übersicht): Statustext und „Nicht stören“. */
    focusStatus() {
      ctx.shell.select('profil', { history: 'push', scroll: true });
      requestAnimationFrame(() => $('status-text').focus());
    },
  };
}
