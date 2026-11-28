// HeldixClient – Webseite: Partner-Programm (/partner) – Heldix-Dienst ab 1.14.0.
//
// - „Diese Server sind schon dabei“: GET /api/v1/public/partners (partner-common.js), hervorgehobene zuerst.
// - Antrag (angemeldet, Cookie): POST /v1/partner-applications { server, name, description, contact } → 201 { id };
//   höchstens ein offener Antrag je Spieler (der Dienst antwortet sonst mit 409). Eigene Anträge mit Stand:
//   GET /v1/account/partner-applications → { applications: [{ id, server, name, description, contact, created, status
//   (open | accepted | declined), note }] }.
// - Ohne Anmeldung: „Anmelden“ (rueckweg.js merkt sich /partner#antrag, konto.js führt nach der Anmeldung zurück).
// - Älterer Dienst ohne Partner-Programm (404): Hinweis statt Formular.
// Texte vom Dienst landen nur als Text im Dokument.
import { ApiError, api, bindCounter, busy, formatDate, h, toast } from './app-common.js';
import { loadPartners, partnerCard, SERVER_RE } from './partner-common.js';
import { setupLoginLink } from './rueckweg.js';

const $ = (id) => document.getElementById(id);
const box = $('partner-antrag');
const STATUS = {
  open: { label: 'In Prüfung', chip: 'chip--soon', text: 'Das Team sieht sich deinen Antrag an und meldet sich über deine Kontaktangabe.' },
  accepted: { label: 'Angenommen', chip: 'chip--online', text: 'Willkommen im Partner-Programm! Das Team richtet deinen Server ein und gibt dir den Partner-Schlüssel.' },
  declined: { label: 'Abgelehnt', chip: 'chip--danger', text: 'Diesmal hat es nicht gepasst. Du kannst einen neuen Antrag stellen.' },
};
const state = { me: null, applications: [] };

function view(name) {
  box.dataset.zustand = name;
  $('antrag-laden').hidden = name !== 'laden';
  $('antrag-gast').hidden = name !== 'gast';
  $('antrag-aus').hidden = name !== 'aus';
  $('antrag-form').hidden = name !== 'formular';
  $('antrag-eigene').hidden = name === 'laden' || name === 'gast' || !state.applications.length;
}

function showOff(text) {
  $('antrag-aus').textContent = text;
  view('aus');
}

/** Server-Adresse wie im Dienst: Kleinbuchstaben, ohne Schema und Pfad. */
function normalizeServer(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

function normalizeApplication(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    id: entry.id,
    server: typeof entry.server === 'string' ? entry.server.slice(0, 255) : '',
    name: typeof entry.name === 'string' ? entry.name.slice(0, 40) : '',
    description: typeof entry.description === 'string' ? entry.description.slice(0, 300) : '',
    created: Number.isFinite(entry.created) ? entry.created : null,
    status: STATUS[entry.status] ? entry.status : 'open',
    note: typeof entry.note === 'string' && entry.note.trim() ? entry.note.trim().slice(0, 500) : null,
  };
}

function renderApplications() {
  const list = state.applications;
  $('antrag-eigene-liste').replaceChildren(
    ...list.map((entry) => {
      const status = STATUS[entry.status];
      return h(
        'li',
        { class: 'partner-application', dataset: { status: entry.status } },
        h(
          'div',
          { class: 'partner-application__head' },
          h('strong', { text: entry.name || entry.server }),
          h('span', { class: `chip ${status.chip}`, text: status.label }),
        ),
        h('p', { class: 'small text-2', text: `${entry.server}${entry.created ? ` · gestellt am ${formatDate(entry.created)}` : ''}` }),
        h('p', { class: 'small', text: status.text }),
        entry.note ? h('p', { class: 'quote small' }, h('strong', { text: 'Nachricht vom Team: ' }), entry.note) : null,
      );
    }),
  );
  $('antrag-eigene').hidden = !list.length;
  const open = list.some((entry) => entry.status === 'open');
  const form = $('antrag-form');
  form.classList.toggle('is-blocked', open);
  for (const field of form.querySelectorAll('input, textarea, button')) field.disabled = open;
  $('antrag-fehler').textContent = open ? 'Du hast schon einen offenen Antrag. Sobald das Team entschieden hat, kannst du einen neuen stellen.' : '';
  $('antrag-fehler').hidden = !open;
}

async function load() {
  view('laden');
  try {
    state.me = await api('GET', '/v1/web/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setupLoginLink($('antrag-anmelden'), '/partner#antrag');
      return view('gast');
    }
    return showOff('Der Heldix-Dienst ist gerade nicht erreichbar. Versuch es in ein paar Minuten noch einmal.');
  }
  try {
    const data = await api('GET', '/v1/account/partner-applications');
    state.applications = (Array.isArray(data?.applications) ? data.applications : Array.isArray(data) ? data : []).map(normalizeApplication).filter(Boolean);
  } catch (error) {
    if (error.status === 404) return showOff('Das Partner-Programm startet mit dem Heldix-Dienst 1.14.0. Schau bald wieder vorbei.');
    if (error.status === 401) {
      setupLoginLink($('antrag-anmelden'), '/partner#antrag');
      return view('gast');
    }
    state.applications = [];
  }
  view('formular');
  renderApplications();
}

async function submit(event) {
  event.preventDefault();
  const error = $('antrag-fehler');
  error.hidden = true;
  const server = normalizeServer($('antrag-server').value);
  const name = $('antrag-name').value.replace(/\s+/g, ' ').trim();
  const description = $('antrag-beschreibung').value.replace(/\r\n?/g, '\n').trim();
  const contact = $('antrag-kontakt').value.replace(/\s+/g, ' ').trim();
  let problem = null;
  if (!SERVER_RE.test(server)) problem = [$('antrag-server'), 'Bitte gib die Adresse deines Servers an, zum Beispiel play.example.net.'];
  else if (!name) problem = [$('antrag-name'), 'Bitte gib den Namen deines Servers an.'];
  else if ([...name].length > 40) problem = [$('antrag-name'), 'Der Name ist zu lang (höchstens 40 Zeichen).'];
  else if (!description) problem = [$('antrag-beschreibung'), 'Bitte beschreib kurz deinen Server.'];
  else if ([...description].length > 300) problem = [$('antrag-beschreibung'), 'Die Beschreibung ist zu lang (höchstens 300 Zeichen).'];
  else if (!contact) problem = [$('antrag-kontakt'), 'Bitte gib an, wie dich das Team erreicht.'];
  else if ([...contact].length > 200) problem = [$('antrag-kontakt'), 'Die Kontaktangabe ist zu lang (höchstens 200 Zeichen).'];
  else if (!$('antrag-bestaetigen').checked) problem = [$('antrag-bestaetigen'), 'Bitte bestätige, dass du den Server betreibst oder ihn vertreten darfst.'];
  if (problem) {
    error.textContent = problem[1];
    error.hidden = false;
    problem[0].focus();
    return;
  }
  try {
    await busy($('antrag-senden'), () => api('POST', '/v1/partner-applications', { server, name, description, contact }));
    toast('Danke! Dein Antrag ist beim Team. Den Stand siehst du hier auf dieser Seite.', 'success');
    for (const id of ['antrag-server', 'antrag-name', 'antrag-beschreibung', 'antrag-kontakt']) {
      $(id).value = '';
      $(id).dispatchEvent(new Event('input'));
    }
    $('antrag-bestaetigen').checked = false;
    await load();
    $('antrag-eigene').scrollIntoView({ block: 'nearest' });
  } catch (problemError) {
    if (problemError.status === 401) return load();
    error.textContent = problemError.status === 409 && !problemError.message ? 'Du hast schon einen offenen Antrag.' : problemError.message;
    error.hidden = false;
  }
}

async function loadList() {
  const partners = await loadPartners();
  $('partner-liste-bereich').hidden = !partners.length;
  if (partners.length) $('partner-liste').replaceChildren(...partners.map(partnerCard));
}

$('antrag-form').addEventListener('submit', submit);
$('antrag-form').addEventListener('input', () => {
  if (!$('antrag-form').classList.contains('is-blocked')) $('antrag-fehler').hidden = true;
});
bindCounter($('antrag-name'), $('antrag-name-zaehler'), 40);
bindCounter($('antrag-beschreibung'), $('antrag-beschreibung-zaehler'), 300);
bindCounter($('antrag-kontakt'), $('antrag-kontakt-zaehler'), 200);
load();
loadList();
