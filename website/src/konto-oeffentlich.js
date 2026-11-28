// HeldixClient – Webseite: Konto → Einstellungen → „Öffentliches Profil“ (Heldix-Dienst ab 1.14.0).
//
// GET/PUT /v1/account/public-profile { enabled, bio, showCosmetics, showWorlds, showBadges, showFriendsButton } (PUT
// immer mit allen Feldern; der Dienst kann dazu hidden: true melden, wenn das Team das Profil ausgeblendet hat). Die
// Seite heldixclient.com/spieler/<Name> zeigt dann Name, Kopf und 3D-Figur, dazu – je nach Schalter – Bio, Abzeichen,
// Cape und Cosmetics, Welten aus Entdecken und „Freund hinzufügen“. Schalter speichern sofort, die Bio mit „Speichern“
// (Wortfilter wie bei anderen Texten: 400 mit Hinweis). Älterer Dienst (404): Hinweis statt Einstellungen.
// Texte vom Dienst landen nur als Text im Dokument.
import { bindCounter, busy, copyText, flashSaved, h, rerender, showError, toast } from './app-common.js';

const MAX_BIO = 160;
/** Schalter: [Feld, Titel, Erklärung, Standard] */
const SWITCHES = [
  ['showCosmetics', 'Cape und Cosmetics zeigen', 'Deine Figur trägt auf der Profilseite, was du gerade gewählt hast. Aus: nur dein Skin.', true],
  ['showBadges', 'Abzeichen zeigen', 'Team-Rolle und Community-Abzeichen wie „Partner“ oder „Creator“.', true],
  ['showWorlds', 'Welten aus Entdecken zeigen', 'Deine Welten, die im Weltenverzeichnis stehen – mit „Beitreten“.', true],
  ['showFriendsButton', '„Freund hinzufügen“ zeigen', 'Angemeldete Besucher können dir von der Profilseite aus eine Freundschaftsanfrage schicken.', true],
];

export function initPublicProfile({ call, getMe }) {
  const $ = (id) => document.getElementById(id);
  const local = { data: null, available: null, loading: null, saving: Promise.resolve() };

  /** Adresse der eigenen Seite: vom Dienst (url), sonst aus dem Namen. */
  const profileUrl = () => (typeof local.data?.url === 'string' && /^https:\/\/[^\s]+\/spieler\/[A-Za-z0-9_]{1,16}$/.test(local.data.url) ? local.data.url : `${location.origin}/spieler/${encodeURIComponent(getMe()?.name ?? '')}`);

  function normalize(data) {
    const value = data && typeof data === 'object' ? data : {};
    return {
      enabled: value.enabled === true,
      bio: typeof value.bio === 'string' ? value.bio.slice(0, MAX_BIO) : '',
      showCosmetics: value.showCosmetics !== false,
      showWorlds: value.showWorlds !== false,
      showBadges: value.showBadges !== false,
      showFriendsButton: value.showFriendsButton !== false,
      hidden: value.hidden === true,
      url: typeof value.url === 'string' ? value.url : null,
    };
  }

  async function load() {
    if (local.loading) return local.loading;
    local.loading = (async () => {
      try {
        local.data = normalize(await call('GET', '/v1/account/public-profile'));
        local.available = true;
      } catch (error) {
        if (error.status === 404) local.available = false;
        else if (error.status !== 401) showError(error);
      } finally {
        local.loading = null;
      }
      render();
    })();
    return local.loading;
  }

  function switchRow(key, label, description, checked, { disabled = false } = {}) {
    const descriptionId = `oeffentlich-${key}-text`;
    const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', name: key, id: `oeffentlich-${key}`, 'aria-describedby': descriptionId, disabled: disabled ? true : undefined, dataset: { focusKey: `oeffentlich:${key}` } });
    input.checked = checked;
    return h('label', { class: `switch-row${disabled ? ' dim' : ''}` }, h('span', { class: 'switch-text' }, h('strong', { text: label }), h('small', { id: descriptionId, text: description })), input);
  }

  function render() {
    const off = $('oeffentlich-aus');
    const body = $('oeffentlich-inhalt');
    if (local.available === false) {
      off.hidden = false;
      body.hidden = true;
      return;
    }
    off.hidden = true;
    if (!local.data) return;
    body.hidden = false;
    const data = local.data;
    $('oeffentlich-an').checked = data.enabled;
    $('oeffentlich-ausgeblendet').hidden = !data.hidden;
    const bio = $('oeffentlich-bio');
    if (document.activeElement !== bio) {
      bio.value = data.bio;
      bio.dispatchEvent(new Event('input'));
    }
    rerender($('oeffentlich-schalter'), JSON.stringify(data), () => SWITCHES.map(([key, label, description, fallback]) => switchRow(key, label, description, typeof data[key] === 'boolean' ? data[key] : fallback, { disabled: !data.enabled })));
    for (const element of [$('oeffentlich-bio-form')]) element.classList.toggle('is-off', !data.enabled);
    const link = $('oeffentlich-link');
    const url = profileUrl();
    link.href = url;
    link.textContent = url.replace(/^https?:\/\//, '');
    $('oeffentlich-ansehen').href = url;
    $('oeffentlich-vorschau').hidden = !data.enabled;
    $('oeffentlich-privat').hidden = data.enabled;
    $('oeffentlich-stand').textContent = data.enabled ? (data.hidden ? 'Ausgeblendet' : 'Öffentlich') : 'Privat';
    $('oeffentlich-stand').className = `chip ${data.enabled && !data.hidden ? 'chip--online' : data.hidden ? 'chip--reward' : ''}`.trim();
  }

  /** Alles speichern (PUT mit allen Feldern), der Reihe nach. patch: geänderte Felder. */
  function save(patch, savedText) {
    const run = async () => {
      const next = { ...local.data, ...patch };
      const body = { enabled: next.enabled, bio: next.bio, showCosmetics: next.showCosmetics, showWorlds: next.showWorlds, showBadges: next.showBadges, showFriendsButton: next.showFriendsButton };
      try {
        const data = await call('PUT', '/v1/account/public-profile', body);
        local.data = normalize(data && typeof data === 'object' && 'enabled' in data ? { url: local.data?.url, ...data } : { ...body, hidden: local.data?.hidden, url: local.data?.url });
        flashSaved($('oeffentlich-gespeichert'), savedText);
        render();
        return true;
      } catch (error) {
        render();
        throw error;
      }
    };
    local.saving = local.saving.then(run, run);
    return local.saving;
  }

  async function onMaster(event) {
    const enabled = event.currentTarget.checked;
    try {
      await save({ enabled }, enabled ? 'Profil ist öffentlich' : 'Profil ist privat');
      if (enabled) toast('Dein Profil ist jetzt öffentlich. Den Link findest du hier im Bereich.', 'success');
    } catch (error) {
      if (error.status !== 401) showError(error);
    }
  }

  async function onSwitch(event) {
    const input = event.target;
    if (!input.classList?.contains('switch') || !SWITCHES.some(([key]) => key === input.name)) return;
    try {
      await save({ [input.name]: input.checked });
    } catch (error) {
      if (error.status !== 401) showError(error);
    }
  }

  async function onBio(event) {
    event.preventDefault();
    const input = $('oeffentlich-bio');
    const error = $('oeffentlich-bio-fehler');
    const bio = input.value.replace(/\s+/g, ' ').trim();
    error.hidden = true;
    if ([...bio].length > MAX_BIO) {
      error.textContent = `Die Bio ist zu lang (höchstens ${MAX_BIO} Zeichen).`;
      error.hidden = false;
      return;
    }
    try {
      await busy($('oeffentlich-bio-speichern'), () => save({ bio }, bio ? 'Bio gespeichert' : 'Bio gelöscht'));
      input.value = bio;
      input.dispatchEvent(new Event('input'));
    } catch (problem) {
      if (problem.status === 401) return;
      error.textContent = problem.message;
      error.hidden = false;
      input.focus();
    }
  }

  async function copyLink() {
    const ok = await copyText(profileUrl());
    toast(ok ? 'Link zu deinem Profil kopiert.' : 'Kopieren ging nicht – öffne das Profil und kopier den Link dort.', ok ? 'success' : 'error');
  }

  $('oeffentlich-an').addEventListener('change', onMaster);
  $('oeffentlich-schalter').addEventListener('change', onSwitch);
  $('oeffentlich-bio-form').addEventListener('submit', onBio);
  $('oeffentlich-bio-form').addEventListener('input', () => {
    $('oeffentlich-bio-fehler').hidden = true;
  });
  $('oeffentlich-kopieren').addEventListener('click', copyLink);
  bindCounter($('oeffentlich-bio'), $('oeffentlich-bio-zaehler'), MAX_BIO);

  return {
    onTab(name) {
      if (name === 'oeffentlich') load().catch(() => {});
    },
    reset() {
      local.data = null;
      local.available = null;
    },
  };
}
