// HeldixClient – Webseite: eine geteilte Welt (/welt#<code>).
// GET /api/v1/public/worlds/<code> → { name, address, host: { uuid, name }, online, players, maxPlayers, version, access }
// (öffentlich, ohne Anmeldung). Der Code steht hinter dem #, landet also nicht in Server-Protokollen.
// „Mit HeldixClient beitreten“ öffnet heldixclient://welt/<code>; ohne HeldixClient hilft die Adresse.
// Der Kopf des Gastgebers kommt vom Heldix-Dienst (/api/v1/public/heads/<uuid>.png), nie von Mojang.
// Ab Dienst 1.13.0: dauerhafte Welten (hosted: { state } – läuft, schläft …) und der Eintrag im Verzeichnis
// (GET /api/v1/public/discover/<code>: Beschreibung, Tags, Sprache, Gefällt mir). Angemeldet (Cookie): „Gefällt mir“
// (GET/PUT/DELETE /v1/discover/<code>/like) und „Melden“ (POST /v1/discover/<code>/report { reason, note }).
import { api, copyText, h, openDialog, toast, uid } from './app-common.js';
import { publicGet } from './public-cards.js';

const TAG_LABELS = { survival: 'Survival', kreativ: 'Kreativ', minispiele: 'Minispiele', rollenspiel: 'Rollenspiel', bauen: 'Bauen', parkour: 'Parkour', technik: 'Technik', entspannt: 'Entspannt', hardcore: 'Hardcore' };
const REPORT_REASONS = [
  ['harassment', 'Beleidigung oder Hetze'],
  ['advertising', 'Werbung für fremde Dienste'],
  ['inappropriate', 'Unangemessen oder jugendgefährdend'],
  ['spam', 'Spam'],
  ['other', 'Sonstiges'],
];
const NUMBER = new Intl.NumberFormat('de-DE');
/** Zustand einer dauerhaften Welt (hosted.state) als Text für die Seite. */
const HOSTED = {
  running: { chip: 'Läuft dauerhaft' },
  starting: { chip: 'Startet gerade', hint: 'Die Welt startet gerade – in etwa 30 Sekunden kannst du beitreten.' },
  stopping: { chip: 'Schläft gleich', hint: 'Die Welt hält gerade an. Beitreten weckt sie wieder – das dauert etwa 30 Sekunden.' },
  sleeping: { chip: 'Schläft – Beitreten weckt sie', hint: 'Die Welt läuft dauerhaft auf dem Heldix-Server und schläft gerade, weil niemand da ist. Einfach beitreten – sie wacht in etwa 30 Sekunden auf.' },
  creating: { chip: 'Wird eingerichtet', hint: 'Die Welt wird gerade auf dem Heldix-Server eingerichtet. Versuch es später noch einmal.' },
  error: { chip: 'Gerade nicht erreichbar', hint: 'Die Welt hat gerade ein Problem. Der Besitzer kann sie auf der Webseite neu starten.' },
};

const CODE = /^[a-hjkmnp-z2-9]{6}$/;
const page = document.getElementById('welt');
const $ = (id) => document.getElementById(id);

function readCode() {
  const raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim().toLowerCase();
  // Auch ganze Adressen („k7m2xq.welt.heldixclient.com“) und „code=…“ annehmen
  const code = raw.replace(/^code=/, '').split('.')[0];
  return CODE.test(code) ? code : null;
}

function setState(state) {
  page.dataset.zustand = state;
  page.setAttribute('aria-busy', String(state === 'laden'));
  const failed = state === 'fehlt' || state === 'fehler' || state === 'ohne-code';
  $('welt-karte').hidden = failed;
  $('welt-fehler').hidden = !failed;
}

function showError(state, title, text, retry = false) {
  setState(state);
  $('welt-fehler-titel').textContent = title;
  $('welt-fehler-text').textContent = text;
  $('welt-erneut').hidden = !retry;
  document.title = `${title} – HeldixClient`;
}

function show(code, world) {
  const host = typeof world.host?.name === 'string' && world.host.name ? world.host.name : 'unbekannt';
  const hosted = world.hosted && typeof world.hosted === 'object' ? HOSTED[world.hosted.state] ?? HOSTED.error : null;
  const online = world.online === true;
  const name = typeof world.name === 'string' && world.name ? world.name : `Welt von ${host}`;
  $('welt-name').textContent = name;
  $('welt-gastgeber-name').textContent = host;
  document.title = `${name} – HeldixClient`;

  const status = $('welt-status');
  status.dataset.status = online ? 'online' : 'offline';
  status.className = `chip chip--lg ${online ? 'chip--online' : ''}`.trim();
  status.querySelector('.dot').className = online ? 'dot dot--online' : 'dot';
  status.querySelector('span:last-child').textContent = hosted ? hosted.chip : online ? 'Gerade geöffnet' : 'Gerade nicht geöffnet';
  if (hosted) status.dataset.dauerhaft = world.hosted.state;
  else delete status.dataset.dauerhaft;
  $('welt-sicher-text').textContent = hosted
    ? 'Der Heldix-Dienst leitet die Verbindung nur weiter – weder der Besitzer noch der Server sehen deine IP-Adresse. Die Welt läuft dauerhaft auf dem Heldix-Server.'
    : 'Der Heldix-Dienst leitet die Verbindung nur weiter – der Gastgeber sieht deine IP-Adresse nicht. Die Welt selbst läuft auf seinem PC.';

  const players = Number.isFinite(world.players) ? world.players : 0;
  const max = Number.isFinite(world.maxPlayers) ? world.maxPlayers : null;
  $('welt-spieler').textContent = online ? (max ? `${players} von ${max}` : String(players)) : max ? `bis zu ${max}` : '–';
  $('welt-version').textContent = typeof world.version === 'string' && world.version ? world.version : 'unbekannt';
  $('welt-zugang').textContent = world.access === 'open' ? 'Jeder mit der Adresse' : 'Nur auf Einladung';

  const hint = $('welt-hinweis');
  const full = online && max !== null && players >= max;
  if (hosted?.hint) hint.textContent = hosted.hint;
  else if (!online) hint.textContent = `${host} teilt die Welt gerade nicht. Sobald sie wieder geöffnet ist, kommst du mit demselben Link und derselben Adresse hinein.`;
  else if (full) hint.textContent = `Die Welt ist gerade voll (höchstens ${max} Spieler). Versuch es etwas später noch einmal.`;
  else if (world.access !== 'open') hint.textContent = `Nur Eingeladene kommen direkt hinein. Bist du nicht eingeladen, klopfst du beim Beitreten an – ${host} wird im Spiel gefragt.`;
  else hint.textContent = '';
  hint.hidden = !hint.textContent;

  const address = typeof world.address === 'string' && world.address ? world.address : null;
  $('welt-adresse').textContent = address ?? code;
  $('welt-adresse-box').hidden = !address;
  $('welt-kopieren').onclick = async () => {
    const ok = await copyText(address ?? code);
    toast(ok ? 'Adresse kopiert – in Minecraft unter Mehrspieler → Server hinzufügen einfügen.' : 'Kopieren ging nicht – bitte von Hand markieren.', ok ? 'success' : 'error');
  };
  $('welt-beitreten').href = `heldixclient://welt/${code}`;

  const head = $('welt-kopf');
  head.alt = `Kopf von ${host}`;
  if (typeof world.host?.uuid === 'string' && /^[0-9a-f]{32}$/.test(world.host.uuid)) {
    head.addEventListener('error', () => head.setAttribute('src', '/assets/standard-kopf.svg'), { once: true });
    head.src = `/api/v1/public/heads/${world.host.uuid}.png?size=64`;
  }
  setState('ok');
  loadListing(code);
}

// ---------------------------------------------------------------------------------------------------------
// Verzeichnis: Beschreibung, Tags, Gefällt mir, Melden
// ---------------------------------------------------------------------------------------------------------

const listing = { code: null, liked: false, likes: 0, signedIn: null, ticket: 0 };

function socialHint(text, withLogin = false) {
  const hint = $('welt-sozial-hinweis');
  hint.replaceChildren(text, withLogin ? ' ' : '', withLogin ? h('a', { href: '/konto', text: 'Im Konto anmelden' }) : '');
  hint.hidden = !text;
}

function paintLike() {
  const button = $('welt-gefaellt');
  button.setAttribute('aria-pressed', String(listing.liked));
  $('welt-gefaellt-text').textContent = listing.liked ? 'Gefällt dir' : 'Gefällt mir';
  $('welt-likes').textContent = NUMBER.format(listing.likes);
  button.setAttribute('aria-label', `${listing.liked ? 'Gefällt dir' : 'Gefällt mir'} (${listing.likes})`);
}

async function loadListing(code) {
  const ticket = ++listing.ticket;
  listing.code = code;
  $('welt-eintrag').hidden = true;
  $('welt-sozial').hidden = true;
  socialHint('');
  let entry;
  try {
    entry = await publicGet(`/v1/public/discover/${code}`);
  } catch {
    return; // nicht im Verzeichnis (oder älterer Dienst): nur die Angaben oben
  }
  if (ticket !== listing.ticket || !entry || typeof entry !== 'object') return;
  const description = typeof entry.description === 'string' ? entry.description.trim() : '';
  $('welt-beschreibung').textContent = description;
  $('welt-beschreibung').hidden = !description;
  const tags = Array.isArray(entry.tags) ? entry.tags.filter((tag) => typeof tag === 'string') : [];
  $('welt-tags').replaceChildren(
    ...tags.map((tag) => h('a', { class: 'chip', href: `/entdecken#tag=${encodeURIComponent(tag)}`, text: TAG_LABELS[tag] ?? tag })),
    h('span', { class: 'chip', text: entry.lang === 'en' ? 'Englisch' : 'Deutsch' }),
    h('a', { class: 'chip chip--accent', href: '/entdecken', text: 'Im Verzeichnis' }),
  );
  $('welt-eintrag').hidden = false;
  listing.likes = Number(entry.likes) || 0;
  listing.liked = false;
  paintLike();
  $('welt-sozial').hidden = false;
  // Angemeldet? Dann den eigenen Stand von „Gefällt mir“ holen (401: nicht angemeldet, still)
  try {
    const state = await api('GET', `/v1/discover/${code}/like`);
    if (ticket !== listing.ticket) return;
    listing.signedIn = true;
    listing.liked = Boolean(state?.liked);
    listing.likes = Number.isFinite(state?.likes) ? state.likes : listing.likes;
    paintLike();
  } catch (error) {
    if (ticket !== listing.ticket) return;
    if (error.status === 401) listing.signedIn = false;
  }
}

async function toggleLike() {
  const code = listing.code;
  if (!code) return;
  if (listing.signedIn === false) return socialHint('Für „Gefällt mir“ meldest du dich mit deinem Minecraft-Konto an.', true);
  const button = $('welt-gefaellt');
  button.disabled = true;
  try {
    const state = await api(listing.liked ? 'DELETE' : 'PUT', `/v1/discover/${code}/like`);
    listing.signedIn = true;
    listing.liked = Boolean(state?.liked);
    listing.likes = Number(state?.likes) || 0;
    paintLike();
    socialHint('');
  } catch (error) {
    if (error.status === 401) {
      listing.signedIn = false;
      socialHint('Für „Gefällt mir“ meldest du dich mit deinem Minecraft-Konto an.', true);
    } else toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function report() {
  const code = listing.code;
  if (!code) return;
  if (listing.signedIn === false) return socialHint('Zum Melden meldest du dich mit deinem Minecraft-Konto an – so kann das Team Missbrauch der Meldungen erkennen.', true);
  const ids = { reason: uid('melden-grund'), note: uid('melden-notiz') };
  const reason = h('select', { class: 'select input', id: ids.reason }, REPORT_REASONS.map(([value, label]) => h('option', { value }, label)));
  const note = h('input', { class: 'input', id: ids.note, maxlength: '300', autocomplete: 'off', placeholder: 'Was stimmt nicht? (optional)' });
  let sent = false;
  const ok = await openDialog({
    title: `„${$('welt-name').textContent}“ melden`,
    body: [
      h('p', { class: 'small text-2', text: 'Das Team sieht sich den Eintrag an und blendet ihn bei einem Verstoß aus. Der Besitzer erfährt nicht, wer gemeldet hat.' }),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.reason, text: 'Grund' }), reason),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.note, text: 'Notiz (eine Zeile, höchstens 300 Zeichen)' }), note),
    ],
    confirmLabel: 'Melden',
    danger: true,
    onConfirm: async () => {
      try {
        await api('POST', `/v1/discover/${code}/report`, { reason: reason.value, note: note.value.trim() || undefined });
        sent = true;
      } catch (error) {
        if (error.status !== 401) throw error;
        listing.signedIn = false;
      }
    },
  });
  if (!ok) return;
  if (sent) toast('Danke! Die Meldung ist beim Team.', 'success');
  else socialHint('Zum Melden meldest du dich mit deinem Minecraft-Konto an.', true);
}

$('welt-gefaellt').addEventListener('click', toggleLike);
$('welt-melden').addEventListener('click', report);

async function load() {
  const code = readCode();
  if (!code) {
    showError('ohne-code', 'Kein Welt-Link', 'Öffne den Link, den du vom Gastgeber bekommen hast – er sieht aus wie heldixclient.com/welt#k7m2xq.');
    return;
  }
  setState('laden');
  try {
    const response = await fetch(`/api/v1/public/worlds/${code}`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
    if (response.status === 404) {
      showError('fehlt', 'Diese Welt gibt es nicht', 'Prüf den Link – vielleicht hat der Gastgeber die Welt gelöscht.');
      return;
    }
    const data = await response.json().catch(() => null);
    if (response.status === 503) {
      showError('fehler', 'Welt teilen ist gerade nicht verfügbar', typeof data?.error === 'string' ? data.error : 'Versuch es später noch einmal.', true);
      return;
    }
    if (!response.ok || !data || typeof data !== 'object') throw new Error(String(response.status));
    show(code, data);
  } catch {
    showError('fehler', 'Gerade nicht erreichbar', 'Die Angaben zur Welt konnten nicht geladen werden. Versuch es gleich noch einmal.', true);
  }
}

$('welt-erneut').addEventListener('click', load);
window.addEventListener('hashchange', load);
load();
