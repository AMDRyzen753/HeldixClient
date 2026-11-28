// HeldixClient – Webseite: Team-Bereich → „Partner“ (Recht partners:manage, Heldix-Dienst ab 1.14.0).
//
// - Partner: GET /v1/team/partners → { partners: [{ id, name, description, website, servers, status (active | paused),
//   featured, created, contact? }] }; anlegen POST /v1/team/partners { id, name, description, website, servers,
//   featured }, ändern PUT /v1/team/partners/<id> (Teilfelder, auch status), löschen DELETE /v1/team/partners/<id>.
// - Schlüssel: POST /v1/team/partners/<id>/key → { key } (hxp_ + 40 Zeichen). Ein neuer Schlüssel macht den alten sofort
//   ungültig; der Dienst speichert nur den Hash – die Seite zeigt den Schlüssel genau einmal (mit Kopieren-Knopf).
// - Anträge: GET /v1/team/partner-applications → { applications: [{ id, uuid, server, name, description, contact,
//   created, status (open | accepted | declined), note, player? }] }, entscheiden mit PUT …/<id> { status, note }.
//   Annehmen legt keinen Partner an – das macht „Partner aus Antrag anlegen“ (Formular, vorbefüllt aus dem Antrag).
// - Zähler „offene Anträge“ am Bereich. Partner-Cosmetics (access: partner) vergibt der Bereich Cosmetics.
// Ohne innerHTML; Texte vom Dienst landen nur als Text im Dokument.
import { avatar, busy, confirmAction, copyText, emptyState, formatDate, formatDateTime, h, icon, loadingState, openDialog, showError, toast, uid } from './app-common.js';
import { PARTNER_ID_RE, SERVER_RE, safeWebsite } from './partner-common.js';

/** Inhalt ersetzen; null, undefined und false fallen weg. */
const fill = (element, ...nodes) => element.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined && node !== false));

const STATUS = { active: ['Aktiv', 'chip--online'], paused: ['Pausiert', 'chip--reward'] };
const APPLICATION_STATUS = { open: ['Offen', 'chip--soon'], accepted: ['Angenommen', 'chip--online'], declined: ['Abgelehnt', ''] };
const MAX_SERVERS = 10;
const KEY_RE = /^hxp_[A-Za-z0-9]{40}$/;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Server-Adresse wie im Dienst (normalizeServer): Kleinbuchstaben, ohne Schema, Pfad und Punkt am Ende. */
export function normalizeServerInput(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

/** Vorschlag für die Partner-ID aus einem Namen („Block Burg!“ → „block-burg“). */
export function partnerIdFrom(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return slug.length >= 3 ? slug : '';
}

function normalizePartner(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') return null;
  const contactUuid = [entry.contact?.uuid, entry.contactUuid, entry.contact_uuid].find((value) => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)) ?? null;
  return {
    id: entry.id,
    name: text(entry.name, 40) || entry.id,
    description: text(entry.description, 300),
    website: safeWebsite(entry.website),
    servers: (Array.isArray(entry.servers) ? entry.servers : []).filter((server) => typeof server === 'string').slice(0, MAX_SERVERS),
    status: entry.status === 'paused' ? 'paused' : 'active',
    featured: entry.featured === true,
    created: Number.isFinite(entry.created) ? entry.created : null,
    contact: contactUuid ? { uuid: contactUuid, name: text(entry.contact?.name ?? entry.contactName, 16) || null } : null,
    hasKey: typeof entry.hasKey === 'boolean' ? entry.hasKey : typeof entry.keyCreated === 'number' ? true : null,
    keyCreated: Number.isFinite(entry.keyCreated) ? entry.keyCreated : null,
    cosmetics: Array.isArray(entry.cosmetics) ? entry.cosmetics.filter((id) => typeof id === 'string').slice(0, 50) : null,
  };
}

function normalizeApplication(entry) {
  if (!entry || typeof entry !== 'object' || entry.id === undefined || entry.id === null) return null;
  const uuid = typeof entry.uuid === 'string' && /^[0-9a-f]{32}$/.test(entry.uuid) ? entry.uuid : typeof entry.player?.uuid === 'string' ? entry.player.uuid : null;
  return {
    id: entry.id,
    uuid,
    playerName: text(entry.player?.name ?? entry.playerName, 16) || null,
    server: text(entry.server, 255),
    name: text(entry.name, 40),
    description: text(entry.description, 300),
    contact: text(entry.contact, 200),
    created: Number.isFinite(entry.created) ? entry.created : null,
    status: APPLICATION_STATUS[entry.status] ? entry.status : 'open',
    note: text(entry.note, 500),
  };
}

export function initTeamPartner({ teamCall, shell, openPlayer }) {
  const $ = (id) => document.getElementById(id);
  const state = { partners: null, applications: null, view: 'partner', filter: 'open' };

  const playerLink = (uuid, name) => (uuid ? h('button', { type: 'button', class: 'link-button', onClick: () => openPlayer(uuid) }, name || `${uuid.slice(0, 8)}…`) : h('span', { text: name || 'Unbekannt' }));

  // -------------------------------------------------------------------------------------------------------
  // Aufbau
  // -------------------------------------------------------------------------------------------------------

  function build() {
    const box = $('team-partner');
    if (box.dataset.built) return;
    box.dataset.built = '1';
    const views = h(
      'div',
      { class: 'segmented', role: 'group', 'aria-label': 'Ansicht', id: 'partner-ansicht' },
      h('button', { type: 'button', dataset: { ansicht: 'partner' }, 'aria-pressed': 'true' }, icon('server'), 'Partner'),
      h('button', { type: 'button', dataset: { ansicht: 'antraege' }, 'aria-pressed': 'false' }, icon('send'), 'Anträge', h('span', { class: 'count', id: 'partner-antraege-zahl', hidden: true })),
    );
    views.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-ansicht]');
      if (!button) return;
      setView(button.dataset.ansicht);
    });
    const filter = h(
      'div',
      { class: 'segmented segmented--sm', role: 'group', 'aria-label': 'Anträge filtern', id: 'partner-antraege-filter' },
      [
        ['open', 'Offen'],
        ['all', 'Alle'],
      ].map(([value, label]) => h('button', { type: 'button', dataset: { filter: value }, 'aria-pressed': String(value === state.filter) }, label)),
    );
    filter.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-filter]');
      if (!button || button.dataset.filter === state.filter) return;
      state.filter = button.dataset.filter;
      for (const other of filter.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
      renderApplications();
    });
    fill(
      box,
      h(
        'div',
        { class: 'toolbar' },
        views,
        h(
          'span',
          { class: 'toolbar-end' },
          h('button', { type: 'button', class: 'button small', id: 'partner-neu', onClick: () => editPartner(null) }, icon('plus'), 'Partner anlegen'),
          h('button', { type: 'button', class: 'button tiny ghost', id: 'partner-aktualisieren', onClick: (event) => busy(event.currentTarget, load).catch(showError) }, icon('refresh'), 'Aktualisieren'),
        ),
      ),
      h(
        'section',
        { class: 'app-card', id: 'partner-sicht-partner', 'aria-labelledby': 'partner-liste-titel' },
        h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'partner-liste-titel', text: 'Partner-Server' }), h('p', { class: 'muted small', text: 'Aktive Partner stehen auf der Webseite unter Entdecken und tragen im Spiel das Abzeichen „Partner“. Pausieren sperrt den Schlüssel sofort.' })), h('span', { class: 'chip', id: 'partner-zahl' })),
        h('div', { id: 'partner-liste' }, loadingState()),
      ),
      h(
        'section',
        { class: 'app-card', id: 'partner-sicht-antraege', 'aria-labelledby': 'partner-antraege-titel', hidden: true },
        h('div', { class: 'card-head' }, h('div', null, h('h2', { id: 'partner-antraege-titel', text: 'Anträge' }), h('p', { class: 'muted small', text: 'Annehmen oder ablehnen schickt dem Spieler den Stand (auf /partner sichtbar). Annehmen legt noch keinen Partner an – dafür „Partner aus Antrag anlegen“.' })), filter),
        h('div', { id: 'partner-antraege' }, loadingState()),
      ),
    );
  }

  function setView(view) {
    state.view = view === 'antraege' ? 'antraege' : 'partner';
    for (const button of document.querySelectorAll('#partner-ansicht button')) button.setAttribute('aria-pressed', String(button.dataset.ansicht === state.view));
    $('partner-sicht-partner').hidden = state.view !== 'partner';
    $('partner-sicht-antraege').hidden = state.view !== 'antraege';
  }

  // -------------------------------------------------------------------------------------------------------
  // Laden
  // -------------------------------------------------------------------------------------------------------

  async function loadPartners() {
    try {
      const data = await teamCall('GET', '/v1/team/partners');
      state.partners = (Array.isArray(data?.partners) ? data.partners : Array.isArray(data) ? data : []).map(normalizePartner).filter(Boolean);
    } catch (error) {
      if (!error.handled) fill($('partner-liste'), emptyState(error.status === 404 ? 'Das Partner-Programm gibt es mit dem Heldix-Dienst ab Version 1.14.0.' : error.message, 'warning'));
      return;
    }
    renderPartners();
  }

  async function loadApplications() {
    try {
      const data = await teamCall('GET', '/v1/team/partner-applications?status=all');
      state.applications = (Array.isArray(data?.applications) ? data.applications : Array.isArray(data) ? data : []).map(normalizeApplication).filter(Boolean).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
    } catch (error) {
      if (!error.handled) fill($('partner-antraege'), emptyState(error.status === 404 ? 'Anträge gibt es mit dem Heldix-Dienst ab Version 1.14.0.' : error.message, 'warning'));
      return;
    }
    renderApplications();
  }

  function load() {
    return Promise.all([loadPartners(), loadApplications()]);
  }

  // -------------------------------------------------------------------------------------------------------
  // Partner
  // -------------------------------------------------------------------------------------------------------

  function renderPartners() {
    const list = state.partners ?? [];
    $('partner-zahl').textContent = `${list.filter((partner) => partner.status === 'active').length} aktiv · ${list.length} gesamt`;
    if (!list.length) return fill($('partner-liste'), emptyState('Noch kein Partner. Lege den ersten mit „Partner anlegen“ an – oder aus einem Antrag.', 'server'));
    const sorted = [...list].sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
    fill($('partner-liste'), h('ul', { class: 'rows partner-rows', id: 'partner-zeilen' }, sorted.map(partnerRow)));
  }

  function partnerRow(partner) {
    const [statusLabel, statusChip] = STATUS[partner.status];
    const featureId = `partner-hervorheben-${partner.id}`;
    const feature = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id: featureId, dataset: { aktion: 'hervorheben' } });
    feature.checked = partner.featured;
    feature.addEventListener('change', () => setFeatured(partner, feature));
    return h(
      'li',
      { class: `row partner-row${partner.status === 'paused' ? ' is-paused' : ''}`, dataset: { partner: partner.id } },
      h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('server')),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: partner.name }), h('code', { class: 'mono muted', text: partner.id }), h('span', { class: `chip ${statusChip}`, text: statusLabel }), partner.featured ? h('span', { class: 'chip chip--reward' }, icon('star'), 'Hervorgehoben') : null),
        partner.description ? h('div', { class: 'row-sub', text: partner.description }) : null,
        h('div', { class: 'row-meta' }, partner.servers.length ? `Server: ${partner.servers.join(', ')}` : 'Noch keine Server-Adresse – ohne Adresse erkennt kein Client den Partner.'),
        h(
          'div',
          { class: 'row-meta' },
          [
            partner.website ? h('a', { href: partner.website, rel: 'noopener', text: partner.website.replace(/^https:\/\//, '').replace(/\/$/, '') }) : null,
            partner.created ? `angelegt am ${formatDate(partner.created)}` : null,
            partner.hasKey === false ? 'noch kein Schlüssel' : partner.keyCreated ? `Schlüssel vom ${formatDate(partner.keyCreated)}` : null,
            partner.contact ? ['Kontakt: ', playerLink(partner.contact.uuid, partner.contact.name)] : null,
            partner.cosmetics?.length ? (partner.cosmetics.length === 1 ? '1 Partner-Cosmetic' : `${partner.cosmetics.length} Partner-Cosmetics`) : null,
          ]
            .filter(Boolean)
            .flatMap((part, index) => (index ? [' · ', part] : [part])),
        ),
      ),
      h(
        'div',
        { class: 'row-actions partner-actions' },
        h('label', { class: 'inline-switch', for: featureId }, feature, h('span', { text: 'Hervorheben' })),
        h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'bearbeiten' }, 'aria-label': `${partner.name} bearbeiten`, onClick: () => editPartner(partner) }, icon('edit'), h('span', { class: 'label', text: 'Bearbeiten' })),
        h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'schluessel' }, 'aria-label': `Schlüssel für ${partner.name} erzeugen`, onClick: (event) => createKey(partner, event.currentTarget) }, icon('key'), h('span', { class: 'label', text: 'Schlüssel erzeugen' })),
        h(
          'button',
          { type: 'button', class: 'button tiny ghost', dataset: { aktion: partner.status === 'paused' ? 'fortsetzen' : 'pausieren' }, onClick: (event) => setStatus(partner, partner.status === 'paused' ? 'active' : 'paused', event.currentTarget) },
          icon(partner.status === 'paused' ? 'play' : 'pause'),
          h('span', { class: 'label', text: partner.status === 'paused' ? 'Fortsetzen' : 'Pausieren' }),
        ),
        h('button', { type: 'button', class: 'button tiny ghost quiet-danger', dataset: { aktion: 'loeschen' }, 'aria-label': `${partner.name} löschen`, onClick: () => removePartner(partner) }, icon('trash'), h('span', { class: 'label', text: 'Löschen' })),
      ),
    );
  }

  /** Antwort einer Änderung übernehmen: ganze Liste, ein Partner oder nichts (dann neu laden). */
  async function applyPartnerResult(data) {
    if (Array.isArray(data?.partners)) {
      state.partners = data.partners.map(normalizePartner).filter(Boolean);
      renderPartners();
      return;
    }
    await loadPartners();
  }

  async function setFeatured(partner, input) {
    const featured = input.checked;
    try {
      await busy(input, async () => applyPartnerResult(await teamCall('PUT', `/v1/team/partners/${encodeURIComponent(partner.id)}`, { featured })));
      toast(featured ? `${partner.name} steht jetzt oben bei den Partner-Servern.` : `${partner.name} ist nicht mehr hervorgehoben.`, 'success');
    } catch (error) {
      input.checked = !featured;
      showError(error);
    }
  }

  async function setStatus(partner, status, button) {
    if (status === 'paused') {
      const ok = await confirmAction({
        title: `${partner.name} pausieren?`,
        text: ['Der Partner-Schlüssel gilt sofort nicht mehr: Voice-Gruppen und Belohnungen über die Schnittstelle gehen nicht mehr, das Abzeichen verschwindet, und der Server steht nicht mehr bei den Partner-Servern.', 'Fortsetzen geht jederzeit – der Schlüssel gilt dann wieder.'],
        confirmLabel: 'Pausieren',
        danger: true,
        onConfirm: async () => applyPartnerResult(await teamCall('PUT', `/v1/team/partners/${encodeURIComponent(partner.id)}`, { status })),
      });
      if (ok) toast(`${partner.name} ist pausiert.`, 'success');
      return;
    }
    try {
      await busy(button, async () => applyPartnerResult(await teamCall('PUT', `/v1/team/partners/${encodeURIComponent(partner.id)}`, { status })));
      toast(`${partner.name} ist wieder aktiv.`, 'success');
    } catch (error) {
      showError(error);
    }
  }

  async function removePartner(partner) {
    const ok = await confirmAction({
      title: `${partner.name} löschen?`,
      text: ['Der Partner verschwindet ganz: Der Schlüssel gilt nicht mehr, das Abzeichen und der Eintrag bei den Partner-Servern sind weg. Schon vergebene Belohnungen behalten die Spieler.', 'Nur vorübergehend? Dann lieber pausieren.'],
      confirmLabel: 'Endgültig löschen',
      danger: true,
      onConfirm: async () => applyPartnerResult(await teamCall('DELETE', `/v1/team/partners/${encodeURIComponent(partner.id)}`)),
    });
    if (ok) toast(`${partner.name} ist gelöscht.`, 'success');
  }

  /** Neuen Schlüssel erzeugen und genau einmal zeigen. */
  async function createKey(partner, button) {
    const ok = await confirmAction({
      title: `Schlüssel für ${partner.name} erzeugen?`,
      text: [partner.hasKey === false ? 'Der Schlüssel erscheint nur ein einziges Mal. Gib ihn dem Betreiber auf sicherem Weg – er trägt ihn in die config.yml des Plugins ein.' : 'Ein neuer Schlüssel macht den bisherigen sofort ungültig – der Server muss dann den neuen eintragen. Der Schlüssel erscheint nur ein einziges Mal.'],
      confirmLabel: 'Schlüssel erzeugen',
    });
    if (!ok) return;
    let key = null;
    try {
      const data = await busy(button, () => teamCall('POST', `/v1/team/partners/${encodeURIComponent(partner.id)}/key`));
      key = typeof data?.key === 'string' ? data.key : null;
    } catch (error) {
      showError(error);
      return;
    }
    if (!key) return toast('Der Dienst hat keinen Schlüssel geliefert.', 'error');
    const inputId = uid('partner-schluessel');
    const field = h('input', { class: 'input input--mono partner-key', id: inputId, readonly: true, value: key, spellcheck: 'false', autocomplete: 'off', 'aria-describedby': `${inputId}-hinweis` });
    const copy = h('button', { type: 'button', class: 'button small', id: 'partner-schluessel-kopieren' }, icon('copy'), 'Kopieren');
    copy.addEventListener('click', async () => {
      const copied = await copyText(key);
      toast(copied ? 'Schlüssel kopiert.' : 'Kopieren ging nicht – markier den Schlüssel von Hand.', copied ? 'success' : 'error');
      field.select();
    });
    field.addEventListener('focus', () => field.select());
    await openDialog({
      title: `Partner-Schlüssel für ${partner.name}`,
      body: [
        h('p', { class: 'notice-line notice-line--warn', id: `${inputId}-hinweis` }, icon('warning'), h('span', { text: 'Nur jetzt sichtbar: Der Dienst speichert nur einen Hash. Schließt du diesen Dialog, lässt sich der Schlüssel nicht mehr anzeigen – nur ein neuer erzeugen.' })),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: inputId, text: 'Schlüssel' }), h('div', { class: 'partner-key-row' }, field, copy)),
        KEY_RE.test(key) ? null : h('p', { class: 'muted small', text: 'Hinweis: Der Schlüssel hat nicht das erwartete Format (hxp_ und 40 Zeichen).' }),
        h('p', { class: 'muted small', text: 'In die config.yml des Plugins „HeldixClient Server“ unter partner-key eintragen. Nie öffentlich posten oder in ein Repository legen.' }),
      ],
      confirmLabel: 'Fertig',
      cancelLabel: 'Schließen',
      focus: `#${inputId}`,
    });
    key = null;
    await loadPartners();
  }

  /** Formular: Partner anlegen (partner null; prefill aus einem Antrag) oder bearbeiten. */
  async function editPartner(partner, { prefill = null, application = null } = {}) {
    const creating = !partner;
    const start = partner ?? { id: '', name: '', description: '', website: null, servers: [], featured: false, ...prefill };
    const ids = { id: uid('partner-id'), name: uid('partner-name'), description: uid('partner-text'), website: uid('partner-web'), servers: uid('partner-server'), featured: uid('partner-hervor'), accept: uid('partner-annehmen') };
    const idInput = h('input', { class: 'input input--mono', id: ids.id, maxlength: '32', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', value: start.id ?? '', placeholder: 'z. B. blockburg', disabled: creating ? undefined : true });
    const nameInput = h('input', { class: 'input', id: ids.name, maxlength: '40', autocomplete: 'off', value: start.name ?? '' });
    const descriptionInput = h('textarea', { class: 'input textarea small-textarea', id: ids.description, maxlength: '300', rows: '3', value: start.description ?? '' });
    const websiteInput = h('input', { class: 'input', id: ids.website, type: 'url', maxlength: '200', autocomplete: 'off', placeholder: 'https://…', value: start.website ?? '' });
    const serversInput = h('textarea', { class: 'input textarea small-textarea input--mono', id: ids.servers, rows: '3', spellcheck: 'false', placeholder: 'play.example.net', value: (start.servers ?? []).join('\n') });
    const featuredInput = h('input', { type: 'checkbox', id: ids.featured });
    featuredInput.checked = Boolean(start.featured);
    const acceptInput = application && application.status === 'open' ? h('input', { type: 'checkbox', id: ids.accept }) : null;
    if (acceptInput) acceptInput.checked = true;
    let suggested = creating && !start.id;
    if (creating) {
      nameInput.addEventListener('input', () => {
        if (suggested) idInput.value = partnerIdFrom(nameInput.value);
      });
      idInput.addEventListener('input', () => {
        suggested = false;
      });
    }
    let saved = null;
    const ok = await openDialog({
      title: creating ? (application ? `Partner aus Antrag #${application.id} anlegen` : 'Partner anlegen') : `${partner.name} bearbeiten`,
      body: [
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.id, text: 'ID' }), idInput, h('span', { class: 'field__help', text: creating ? '3 bis 32 Zeichen aus a–z, 0–9 und -. Steht in Cosmetics (partner) und lässt sich später nicht ändern.' : 'Die ID lässt sich nicht ändern.' })),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.name, text: 'Name' }), nameInput),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.description, text: 'Beschreibung (höchstens 300 Zeichen)' }), descriptionInput),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.website, text: 'Webseite (optional, nur https)' }), websiteInput),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.servers, text: `Server-Adressen (eine je Zeile, höchstens ${MAX_SERVERS})` }), serversInput, h('span', { class: 'field__help', text: 'Eine Domain deckt ihre Subdomains ab. Die erste Adresse steht auf der Webseite zum Kopieren.' })),
        h('label', { class: 'check-row' }, featuredInput, h('span', { text: 'Hervorheben – steht bei den Partner-Servern ganz oben' })),
        acceptInput ? h('label', { class: 'check-row' }, acceptInput, h('span', { text: `Antrag #${application.id} dabei als angenommen markieren` })) : null,
      ],
      confirmLabel: creating ? 'Anlegen' : 'Speichern',
      focus: `#${ids.name}`,
      onConfirm: async () => {
        const id = idInput.value.trim();
        const name = nameInput.value.replace(/\s+/g, ' ').trim();
        const description = descriptionInput.value.replace(/\s+/g, ' ').trim();
        const websiteRaw = websiteInput.value.trim();
        const website = websiteRaw ? safeWebsite(websiteRaw) : null;
        const servers = [...new Set(serversInput.value.split(/[\s,]+/).map(normalizeServerInput).filter(Boolean))];
        if (creating && !PARTNER_ID_RE.test(id)) throw new Error('Die ID braucht 3 bis 32 Zeichen aus a–z, 0–9 und -.');
        if (creating && (state.partners ?? []).some((other) => other.id === id)) throw new Error(`Die ID „${id}“ gibt es schon.`);
        if (!name) throw new Error('Bitte einen Namen eingeben.');
        if ([...name].length > 40) throw new Error('Der Name ist zu lang (höchstens 40 Zeichen).');
        if ([...description].length > 300) throw new Error('Die Beschreibung ist zu lang (höchstens 300 Zeichen).');
        if (websiteRaw && !website) throw new Error('Die Webseite muss mit https:// beginnen.');
        if (servers.length > MAX_SERVERS) throw new Error(`Höchstens ${MAX_SERVERS} Server-Adressen.`);
        const wrong = servers.find((server) => !SERVER_RE.test(server));
        if (wrong) throw new Error(`„${wrong}“ ist keine gültige Server-Adresse.`);
        const body = { name, description, website, servers, featured: featuredInput.checked };
        // Aus einem Antrag: application mitschicken – der Dienst trägt dann den Antragsteller als Kontakt ein
        const data = creating ? await teamCall('POST', '/v1/team/partners', { id, ...body, ...(application ? { application: application.id } : {}) }) : await teamCall('PUT', `/v1/team/partners/${encodeURIComponent(partner.id)}`, body);
        saved = { id: creating ? id : partner.id, name, data };
      },
    });
    if (!ok || !saved) return;
    await applyPartnerResult(saved.data);
    toast(creating ? `${saved.name} ist als Partner angelegt. Als Nächstes den Schlüssel erzeugen.` : `${saved.name} ist gespeichert.`, 'success');
    if (acceptInput?.checked) await decide(application, 'accepted', { note: '', quiet: true });
    if (creating) setView('partner');
  }

  // -------------------------------------------------------------------------------------------------------
  // Anträge
  // -------------------------------------------------------------------------------------------------------

  function renderApplications() {
    const all = state.applications ?? [];
    const open = all.filter((entry) => entry.status === 'open').length;
    shell.setBadge('partner', open, { label: open === 1 ? '1 offener Antrag' : `${open} offene Anträge` });
    const count = $('partner-antraege-zahl');
    count.hidden = !open;
    count.textContent = String(open);
    const list = state.filter === 'open' ? all.filter((entry) => entry.status === 'open') : all;
    if (!list.length) return fill($('partner-antraege'), emptyState(state.filter === 'open' ? 'Keine offenen Anträge.' : 'Noch keine Anträge.', 'send'));
    fill($('partner-antraege'), h('ul', { class: 'rows partner-application-rows', id: 'partner-antrag-zeilen' }, list.map(applicationRow)));
  }

  function applicationRow(entry) {
    const [label, chip] = APPLICATION_STATUS[entry.status];
    const known = (state.partners ?? []).find((partner) => partner.servers.some((server) => server === entry.server || entry.server.endsWith(`.${server}`)));
    return h(
      'li',
      { class: 'row partner-application-row', dataset: { antrag: String(entry.id), status: entry.status } },
      entry.uuid ? avatar(entry.playerName ?? '?', entry.uuid, { size: 'sm' }) : h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('send')),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: entry.name || entry.server }), h('span', { class: `chip ${chip}`.trim(), text: label }), known ? h('span', { class: 'chip chip--accent', text: `schon Partner: ${known.name}` }) : null),
        h('div', { class: 'row-sub' }, h('code', { class: 'mono', text: entry.server })),
        entry.description ? h('p', { class: 'small', text: entry.description }) : null,
        h('div', { class: 'row-meta' }, `Antrag #${entry.id}`, entry.created ? ` · ${formatDateTime(entry.created)}` : '', ' · von ', playerLink(entry.uuid, entry.playerName)),
        entry.contact ? h('p', { class: 'small' }, h('strong', { text: 'Kontakt: ' }), entry.contact) : null,
        entry.note ? h('p', { class: 'quote small' }, h('span', { class: 'quote-label', text: 'Notiz: ' }), entry.note) : null,
      ),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', class: 'button tiny', dataset: { aktion: 'anlegen' }, onClick: () => editPartner(null, { prefill: { id: partnerIdFrom(entry.name || entry.server), name: entry.name, description: entry.description, servers: entry.server ? [entry.server] : [] }, application: entry }) }, icon('plus'), 'Partner aus Antrag anlegen'),
        entry.status === 'open' ? h('button', { type: 'button', class: 'button tiny ghost', dataset: { aktion: 'annehmen' }, onClick: () => decideDialog(entry, 'accepted') }, icon('check'), 'Annehmen') : null,
        entry.status === 'open' ? h('button', { type: 'button', class: 'button tiny ghost quiet-danger', dataset: { aktion: 'ablehnen' }, onClick: () => decideDialog(entry, 'declined') }, icon('close'), 'Ablehnen') : null,
      ),
    );
  }

  async function decide(entry, status, { note = '', quiet = false } = {}) {
    const data = await teamCall('PUT', `/v1/team/partner-applications/${encodeURIComponent(entry.id)}`, { status, note });
    if (Array.isArray(data?.applications)) {
      state.applications = data.applications.map(normalizeApplication).filter(Boolean).sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
      renderApplications();
    } else await loadApplications();
    if (!quiet) toast(status === 'accepted' ? `Antrag #${entry.id} ist angenommen.` : `Antrag #${entry.id} ist abgelehnt.`, 'success');
  }

  async function decideDialog(entry, status) {
    const noteId = uid('partner-notiz');
    const note = h('textarea', { class: 'input textarea small-textarea', id: noteId, maxlength: '500', rows: '3', placeholder: status === 'accepted' ? 'z. B. Wir melden uns mit dem Schlüssel.' : 'Warum es diesmal nicht passt (sieht der Spieler auf /partner).' });
    await openDialog({
      title: status === 'accepted' ? `Antrag #${entry.id} annehmen?` : `Antrag #${entry.id} ablehnen?`,
      body: [
        h('p', { text: status === 'accepted' ? `„${entry.name || entry.server}“ wird angenommen. Den Partner legst du danach mit „Partner aus Antrag anlegen“ an.` : `„${entry.name || entry.server}“ wird abgelehnt. Der Spieler kann danach einen neuen Antrag stellen.` }),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: noteId, text: 'Notiz an den Spieler (optional)' }), note),
      ],
      confirmLabel: status === 'accepted' ? 'Annehmen' : 'Ablehnen',
      danger: status === 'declined',
      onConfirm: () => decide(entry, status, { note: note.value.replace(/\s+/g, ' ').trim() }),
    });
  }

  return {
    /** Bereich geöffnet. params.ansicht: antraege öffnet die Anträge. */
    async show(params = null) {
      build();
      if (params?.ansicht === 'antraege') setView('antraege');
      await load();
    },
    /** Zähler der offenen Anträge (z. B. beim Start), ohne den Bereich aufzubauen. */
    async refreshCount() {
      try {
        const data = await teamCall('GET', '/v1/team/partner-applications?status=open');
        const list = (Array.isArray(data?.applications) ? data.applications : Array.isArray(data) ? data : []).map(normalizeApplication).filter(Boolean);
        const open = list.filter((entry) => entry.status === 'open').length;
        shell.setBadge('partner', open, { label: open === 1 ? '1 offener Antrag' : `${open} offene Anträge` });
      } catch {
        // still
      }
    },
    /** Partner für andere Bereiche (Cosmetics): zuletzt geladene Liste oder frisch geladen. */
    async list() {
      if (!state.partners) {
        const data = await teamCall('GET', '/v1/team/partners');
        state.partners = (Array.isArray(data?.partners) ? data.partners : Array.isArray(data) ? data : []).map(normalizePartner).filter(Boolean);
      }
      return state.partners;
    },
    reset() {
      state.partners = null;
      state.applications = null;
    },
  };
}
