// HeldixClient – Webseite: Konto → „Meine Addons“. Eigene Einreichungen (Status, Begründung des Teams) und
// veröffentlichte Addons, dazu der Assistent „Addon einreichen“:
//   1. JAR hochladen (PUT /v1/addon-submissions/<sid>/jar, mit Fortschritt) → erkannte Daten und Prüf-Hinweise
//   2. Store-Angaben (Name, Kurz- und lange Beschreibung, Kategorie, Icon aus dem Heldix-Icon-Set, Systeme, Was ist neu)
//   3. Screenshots (bis 4, PNG/JPEG, ≤ 2 MB, 320 × 180 bis 3840 × 2160 – im Browser vorab geprüft)
//   4. Regeln bestätigen → „Zur Prüfung einreichen“ (POST …/submit)
// Der Konto-Bereich hat keine Echtzeit-Verbindung: Solange der Reiter offen ist, fragt die Seite alle 15 Sekunden
// nach und meldet, wenn das Team eine Einreichung freigegeben oder abgelehnt hat.
// Texte vom Server landen nur als Text im Dokument.
import { ApiError, api, busy, confirmAction, emptyState, formatBytes, formatDate, h, icon, loadingState, poller, relativeTime, rerender, showError, toast, upload } from './app-common.js';
import {
  ADDON_ID_RE,
  ALLE_SYSTEME,
  API_STUFE,
  KATEGORIEN,
  addonIcon,
  formatCount,
  hasIcon,
  iconNames,
  inspectionChips,
  inspectionList,
  normalizeAddons,
  normalizeInspection,
  originBadge,
  plainText,
  platformLimit,
  platformText,
  ratingSummary,
} from './addon-common.js';
import { openLightbox } from './lightbox.js';

const STATUS = {
  draft: ['Entwurf', ''],
  pending: ['Wird geprüft', 'accent'],
  approved: ['Freigegeben', 'success'],
  rejected: ['Abgelehnt', 'danger'],
  withdrawn: ['Zurückgezogen', ''],
};
const LIMITS = { name: 40, summary: 200, description: 4000, notes: 20, note: 300 };
const JAR_MAX = 50 * 1024 * 1024;
const SHOT_MAX = 2 * 1024 * 1024;
const SHOTS = 4;
const POLL_MS = 15_000;

const $ = (id) => document.getElementById(id);
const length = (value) => [...value].length;
const shortSha = (hash) => (typeof hash === 'string' && hash.length > 20 ? `${hash.slice(0, 12)}…${hash.slice(-6)}` : (hash ?? '–'));

/** Einreichung vom Dienst in eine sichere Form bringen (fehlende Felder bekommen Standardwerte). */
function normalizeSubmission(value) {
  if (!value || typeof value !== 'object' || (typeof value.id !== 'string' && typeof value.id !== 'number')) return null;
  const textOf = (field, max) => (typeof value[field] === 'string' ? value[field].slice(0, max) : '');
  return {
    id: String(value.id),
    status: Object.hasOwn(STATUS, value.status) ? value.status : 'draft',
    addonId: typeof value.addonId === 'string' && ADDON_ID_RE.test(value.addonId) ? value.addonId : null,
    version: typeof value.version === 'string' ? value.version.slice(0, 60) : null,
    name: textOf('name', LIMITS.name),
    summary: textOf('summary', LIMITS.summary),
    description: textOf('description', LIMITS.description),
    category: Object.hasOwn(KATEGORIEN, value.category) ? value.category : 'sonstiges',
    icon: typeof value.icon === 'string' && /^[a-z0-9-]{1,30}$/.test(value.icon) ? value.icon : 'addons',
    platforms: Array.isArray(value.platforms) ? ALLE_SYSTEME.filter((system) => value.platforms.includes(system)) : [],
    notes: Array.isArray(value.notes) ? value.notes.filter((note) => typeof note === 'string' && note.trim()).slice(0, LIMITS.notes) : [],
    authors: Array.isArray(value.authors) ? value.authors.filter((author) => typeof author === 'string').slice(0, 5) : [],
    api: Number.isInteger(value.api) ? value.api : null,
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : null,
    sha256: typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256) ? value.sha256 : null,
    screenshots: Number.isInteger(value.screenshots) ? Math.min(SHOTS, Math.max(0, value.screenshots)) : 0,
    inspection: normalizeInspection(value.inspection),
    createdAt: value.createdAt ?? null,
    submittedAt: value.submittedAt ?? null,
    reviewedAt: value.reviewedAt ?? null,
    reviewNote: typeof value.reviewNote === 'string' ? value.reviewNote.slice(0, 1000) : '',
  };
}
const fromResponse = (data) => normalizeSubmission(data?.submission ?? (data && data.id !== undefined ? data : null));

function statusChip(status) {
  const [label, kind] = STATUS[status] ?? [status, ''];
  return h('span', { class: `chip${kind ? ` ${kind}` : ''}`, text: label });
}

/**
 * call: Anfrage mit Sitzung (wie im Konto, 401 meldet ab). onUnauthorized: für Uploads (XMLHttpRequest),
 * die nicht über call laufen.
 */
export function initMyAddons({ call, onUnauthorized }) {
  const state = {
    submissions: null,
    addons: null,
    known: null, // id → Status beim letzten Nachfragen (für den Hinweis „freigegeben/abgelehnt“)
    fresh: new Set(),
    previews: new Map(), // id → [data:-URL | null] (hochgeladen oder vom Dienst nachgeladen)
    shotLoads: new Set(), // „id/n“, die gerade nachgeladen werden
    wizard: null, // { sub, forAddon, step, job, busy }
    iconsBuilt: false,
  };
  const refresher = poller(() => refresh(), POLL_MS);

  // -------------------------------------------------------------------------------------------------------
  // Übersicht
  // -------------------------------------------------------------------------------------------------------

  async function refresh() {
    const data = await call('GET', '/v1/addon-submissions');
    const submissions = (Array.isArray(data?.submissions) ? data.submissions : []).map(normalizeSubmission).filter(Boolean);
    const addons = normalizeAddons(data?.addons);
    if (state.known) {
      for (const sub of submissions) {
        const before = state.known.get(sub.id);
        if (before !== 'pending' || sub.status === 'pending') continue;
        const label = `„${sub.name || sub.addonId}“${sub.version ? ` ${sub.version}` : ''}`;
        if (sub.status === 'approved') {
          state.fresh.add(sub.id);
          toast(`${label} ist freigegeben und steht jetzt im Addon-Store.`, 'success');
        } else if (sub.status === 'rejected') {
          state.fresh.add(sub.id);
          toast(`${label} wurde abgelehnt. Die Begründung des Teams steht unter Meine Addons.`, 'info');
        }
      }
    }
    state.known = new Map(submissions.map((sub) => [sub.id, sub.status]));
    state.submissions = submissions;
    state.addons = addons;
    render();
  }

  function render() {
    const submissions = state.submissions ?? [];
    $('einreichungen-anzahl').textContent = submissions.length ? `(${submissions.length})` : '';
    rerender($('einreichungen'), JSON.stringify([submissions, [...state.fresh]]), () => {
      if (!state.submissions) return loadingState();
      if (!submissions.length) return emptyState('Noch keine Einreichungen. Mit „Addon einreichen“ legst du los.', 'addons');
      return h('ul', { class: 'rows submission-rows' }, submissions.map(submissionRow));
    });
    const addons = state.addons ?? [];
    rerender($('eigene-addons'), JSON.stringify(addons), () => {
      if (!state.addons) return loadingState();
      if (!addons.length) return emptyState('Noch kein Addon im Store. Sobald das Team eine Einreichung freigibt, steht sie hier.', 'addons');
      return h('ul', { class: 'rows' }, addons.map(addonRow));
    });
  }

  function submissionRow(sub) {
    const title = sub.name || sub.addonId || 'Neues Addon';
    const when =
      sub.status === 'draft'
        ? `angelegt ${relativeTime(sub.createdAt)}`
        : sub.status === 'pending'
          ? `eingereicht ${relativeTime(sub.submittedAt)}`
          : sub.reviewedAt
            ? `geprüft am ${formatDate(sub.reviewedAt)}`
            : `eingereicht am ${formatDate(sub.submittedAt)}`;
    const actions = [];
    if (sub.status === 'draft' || sub.status === 'rejected') {
      actions.push(h('button', { type: 'button', class: 'button tiny', dataset: { focusKey: `sub:${sub.id}:edit` }, onClick: () => openWizard({ sub }) }, icon('edit'), sub.status === 'rejected' ? 'Überarbeiten' : 'Bearbeiten'));
    }
    if (sub.status === 'pending') {
      actions.push(h('button', { type: 'button', class: 'button tiny ghost', dataset: { focusKey: `sub:${sub.id}:withdraw` }, onClick: () => withdraw(sub) }, 'Zurückziehen'));
    }
    if (sub.status === 'draft' || sub.status === 'rejected' || sub.status === 'withdrawn') {
      actions.push(
        h('button', { type: 'button', class: 'button tiny ghost quiet-danger', 'aria-label': `${title} löschen`, dataset: { focusKey: `sub:${sub.id}:delete` }, onClick: () => removeSubmission(sub) }, icon('trash'), h('span', { class: 'label', text: 'Löschen' })),
      );
    }
    if (sub.status === 'approved' && sub.addonId && state.addons?.some((addon) => addon.id === sub.addonId && !addon.hidden)) {
      actions.push(h('a', { class: 'button tiny ghost', href: `/addons#${sub.addonId}` }, icon('external'), 'Im Store'));
    }
    return h(
      'li',
      { class: `row submission-row${state.fresh.has(sub.id) ? ' fresh' : ''}`, dataset: { id: sub.id, status: sub.status } },
      addonIcon(sub.icon, 'addon-icon small'),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: title }), statusChip(sub.status), sub.version ? h('span', { class: 'chip', text: `Version ${sub.version}` }) : null),
        h('div', { class: 'row-sub', text: [sub.addonId ? sub.addonId : 'noch ohne JAR', when].join(' · ') }),
        sub.inspection && (sub.status === 'draft' || sub.status === 'pending') ? h('div', { class: 'chips-row' }, inspectionChips(sub.inspection)) : null,
        sub.status === 'rejected' && sub.reviewNote ? h('blockquote', { class: 'quote review-quote' }, h('span', { class: 'quote-label', text: 'Begründung des Teams: ' }), sub.reviewNote) : null,
        sub.status === 'pending' ? h('p', { class: 'row-meta', text: 'Das Team prüft den Code. Du bekommst hier Bescheid, sobald es entschieden hat.' }) : null,
      ),
      actions.length ? h('div', { class: 'row-actions' }, actions) : null,
    );
  }

  function addonRow(addon) {
    return h(
      'li',
      { class: 'row own-addon', dataset: { id: addon.id } },
      addonIcon(addon.icon, 'addon-icon small'),
      h(
        'div',
        { class: 'row-main' },
        h('div', { class: 'row-title' }, h('span', { text: addon.name }), h('span', { class: 'chip', text: `Version ${addon.version}` }), originBadge(addon), addon.hidden ? h('span', { class: 'chip warning', text: 'ausgeblendet' }) : null),
        h('div', { class: 'row-sub' }, formatCount(addon.downloads), ' · ', ratingSummary(addon.rating, { long: true })),
        addon.hidden ? h('p', { class: 'row-meta', text: 'Das Team hat das Addon aus dem Store genommen. Wer es installiert hat, behält es. Fragen dazu beantwortet das Team über eine Support-Anfrage.' }) : null,
      ),
      h(
        'div',
        { class: 'row-actions' },
        addon.hidden ? null : h('a', { class: 'button tiny ghost', href: `/addons#${addon.id}` }, icon('external'), 'Im Store'),
        h('button', { type: 'button', class: 'button tiny', dataset: { focusKey: `addon:${addon.id}:version` }, onClick: () => openWizard({ forAddon: addon }) }, icon('plus'), 'Neue Version einreichen'),
      ),
    );
  }

  async function withdraw(sub) {
    const ok = await confirmAction({
      title: `„${sub.name || sub.addonId}“ zurückziehen?`,
      text: 'Das Team prüft die Einreichung dann nicht weiter. Du kannst sie danach löschen und neu einreichen.',
      confirmLabel: 'Zurückziehen',
      onConfirm: () => call('DELETE', `/v1/addon-submissions/${encodeURIComponent(sub.id)}`),
    });
    if (!ok) return;
    toast('Die Einreichung ist zurückgezogen.');
    await refresh().catch(showError);
  }

  async function removeSubmission(sub) {
    const ok = await confirmAction({
      title: `„${sub.name || sub.addonId || 'Entwurf'}“ löschen?`,
      text: 'Die Einreichung samt JAR und Screenshots ist danach weg. Veröffentlichte Addons sind davon nicht betroffen.',
      confirmLabel: 'Löschen',
      danger: true,
      onConfirm: () => call('DELETE', `/v1/addon-submissions/${encodeURIComponent(sub.id)}`),
    });
    if (!ok) return;
    state.previews.delete(sub.id);
    toast('Die Einreichung ist gelöscht.');
    await refresh().catch(showError);
  }

  // -------------------------------------------------------------------------------------------------------
  // Assistent
  // -------------------------------------------------------------------------------------------------------

  const form = {
    name: $('angabe-name'),
    summary: $('angabe-kurz'),
    description: $('angabe-beschreibung'),
    category: $('angabe-kategorie'),
    notes: $('angabe-neu'),
  };

  function showWizardError(text, focus) {
    const box = $('assistent-fehler');
    box.textContent = text || '';
    box.hidden = !text;
    if (focus) focus.focus();
  }

  function buildIconPicker() {
    if (state.iconsBuilt) return;
    state.iconsBuilt = true;
    const names = iconNames()
      .filter((name) => !/^loader-|^microsoft$/.test(name))
      .sort((a, b) => a.localeCompare(b));
    $('icon-auswahl').replaceChildren(
      ...names.map((name) =>
        h('label', { class: 'icon-choice', title: name, dataset: { icon: name } }, h('input', { type: 'radio', name: 'addon-icon', value: name, class: 'visually-hidden' }), icon(name), h('span', { class: 'visually-hidden', text: name })),
      ),
    );
  }

  function selectedIcon() {
    return $('icon-auswahl').querySelector('input:checked')?.value ?? 'addons';
  }

  function setIcon(name) {
    const target = hasIcon(name) ? name : 'addons';
    for (const input of $('icon-auswahl').querySelectorAll('input')) input.checked = input.value === target;
    $('icon-gewaehlt').textContent = `gewählt: ${target}`;
  }

  function fillForm(fields) {
    form.name.value = fields.name ?? '';
    form.summary.value = fields.summary ?? '';
    form.description.value = fields.description ?? '';
    form.category.value = Object.hasOwn(KATEGORIEN, fields.category) ? fields.category : 'sonstiges';
    for (const box of $('angabe-systeme').querySelectorAll('input')) box.checked = (fields.platforms ?? []).includes(box.value);
    form.notes.value = (fields.notes ?? []).join('\n');
    setIcon(fields.icon ?? 'addons');
    $('icon-suche').value = '';
    filterIcons();
    for (const input of Object.values(form)) input.dispatchEvent(new Event('input'));
  }

  function readForm() {
    return {
      name: form.name.value.replace(/\s+/g, ' ').trim(),
      summary: form.summary.value.replace(/\s+/g, ' ').trim(),
      description: form.description.value.replace(/\r\n?/g, '\n').trim(),
      category: form.category.value,
      icon: selectedIcon(),
      platforms: [...$('angabe-systeme').querySelectorAll('input:checked')].map((box) => box.value),
      notes: form.notes.value
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/^[-•*]\s+/, '').trim())
        .filter(Boolean),
    };
  }

  /** Felder prüfen wie der Dienst; gibt [Hinweis, Feld] oder null zurück. */
  function formProblem(fields) {
    if (!fields.name) return ['Bitte einen Namen eingeben (1–40 Zeichen).', form.name];
    if (length(fields.name) > LIMITS.name) return [`Der Name ist zu lang (höchstens ${LIMITS.name} Zeichen).`, form.name];
    if (!fields.summary) return ['Bitte eine Kurzbeschreibung eingeben – ein Satz, was dein Addon macht.', form.summary];
    if (length(fields.summary) > LIMITS.summary) return [`Die Kurzbeschreibung ist zu lang (höchstens ${LIMITS.summary} Zeichen).`, form.summary];
    if (length(fields.description) > LIMITS.description) return [`Die Beschreibung ist zu lang (höchstens ${LIMITS.description} Zeichen).`, form.description];
    if (!Object.hasOwn(KATEGORIEN, fields.category)) return ['Bitte eine Kategorie wählen.', form.category];
    if (fields.notes.length > LIMITS.notes) return [`Unter „Was ist neu?“ gehen höchstens ${LIMITS.notes} Punkte.`, form.notes];
    if (fields.notes.some((note) => length(note) > LIMITS.note)) return [`Ein Punkt unter „Was ist neu?“ ist länger als ${LIMITS.note} Zeichen.`, form.notes];
    return null;
  }

  const sameFields = (sub, fields) =>
    Boolean(sub) && JSON.stringify([sub.name, sub.summary, sub.description, sub.category, sub.icon, sub.platforms, sub.notes]) === JSON.stringify([fields.name, fields.summary, fields.description, fields.category, fields.icon, fields.platforms, fields.notes]);

  function openWizard({ sub = null, forAddon = null } = {}) {
    buildIconPicker();
    state.wizard = { sub, forAddon, step: sub?.sha256 ? 2 : 1, job: null, busy: false };
    if (sub) fillForm(sub);
    else if (forAddon) fillForm({ name: forAddon.name, summary: forAddon.summary, description: forAddon.description, category: forAddon.category, icon: forAddon.icon, platforms: forAddon.platforms, notes: [] });
    else fillForm({});
    for (const box of $('regeln').querySelectorAll('input')) box.checked = false;
    $('jar-name').textContent = 'Keine Datei gewählt';
    $('jar-fehler').hidden = true;
    $('screenshot-fehler').hidden = true;
    showWizardError('');
    $('addons-uebersicht').hidden = true;
    $('assistent').hidden = false;
    renderWizard();
    $('assistent').scrollIntoView({ block: 'start' });
    $('assistent-titel').focus({ preventScroll: true });
  }

  async function closeWizard({ save = true } = {}) {
    const wizard = state.wizard;
    if (!wizard) return;
    if (wizard.job) {
      const stop = await confirmAction({ title: 'Hochladen abbrechen?', text: 'Die Datei wird gerade hochgeladen.', confirmLabel: 'Abbrechen und schließen', danger: true });
      if (!stop) return;
      wizard.job?.abort();
    }
    // Geänderte Angaben als Entwurf sichern
    if (save && wizard.sub && (wizard.sub.status === 'draft' || wizard.sub.status === 'rejected')) {
      const fields = readForm();
      if (!sameFields(wizard.sub, fields) && !formProblem(fields)) {
        try {
          await call('PATCH', `/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}`, fields);
          toast('Entwurf gespeichert.');
        } catch (error) {
          if (error.status === 401) return;
          showWizardError(`Speichern ging nicht: ${error.message}`);
          return;
        }
      }
    }
    state.wizard = null;
    $('assistent').hidden = true;
    $('addons-uebersicht').hidden = false;
    $('addon-einreichen').focus({ preventScroll: true });
    await refresh().catch(showError);
  }

  /** Höchster Schritt, der gerade erreichbar ist (ohne JAR nur Schritt 1). */
  const reachable = () => (state.wizard?.sub?.sha256 ? 4 : 1);

  function renderWizard() {
    const wizard = state.wizard;
    if (!wizard) return;
    const { sub, forAddon, step } = wizard;
    $('assistent-titel').textContent = forAddon ? `Neue Version von ${forAddon.name}` : sub?.name ? `${sub.name} einreichen` : 'Addon einreichen';
    $('assistent-untertitel').textContent = sub ? [sub.addonId, sub.version ? `Version ${sub.version}` : null, STATUS[sub.status]?.[0]].filter(Boolean).join(' · ') : forAddon ? `${forAddon.id} · zuletzt Version ${forAddon.version}` : 'Schritt für Schritt in den Addon-Store';
    const rejected = $('assistent-abgelehnt');
    rejected.hidden = !(sub?.status === 'rejected' && sub.reviewNote);
    if (!rejected.hidden) {
      rejected.replaceChildren(icon('warning'), h('div', null, h('strong', { text: 'Das Team hat diese Einreichung abgelehnt.' }), h('p', { text: sub.reviewNote }), h('p', { class: 'muted small', text: 'Bessere nach, lade bei Bedarf eine neue JAR hoch und reiche erneut ein.' })));
    }
    for (const button of $('assistent-schritte').querySelectorAll('button')) {
      const number = Number(button.dataset.step);
      button.setAttribute('aria-current', number === step ? 'step' : 'false');
      button.classList.toggle('done', number < step && number <= reachable());
      button.disabled = number > reachable() || wizard.busy;
    }
    for (const panel of document.querySelectorAll('#assistent [data-panel]')) panel.hidden = Number(panel.dataset.panel) !== step;
    $('assistent-zurueck').hidden = step === 1;
    $('assistent-weiter').hidden = step === 4;
    $('assistent-einreichen').hidden = step !== 4;
    $('assistent-weiter').disabled = wizard.busy || (step === 1 && !sub?.sha256);
    $('assistent-zurueck').disabled = wizard.busy;
    $('jar-knopf').textContent = sub?.sha256 ? 'Andere JAR wählen …' : 'JAR wählen …';
    renderDetected();
    if (step === 3) renderShots();
    if (step === 4) renderSummary();
    updateSubmitButton();
  }

  async function goTo(step) {
    const wizard = state.wizard;
    if (!wizard || wizard.busy || step === wizard.step) return;
    showWizardError('');
    if (step > reachable()) return;
    // Vom Formular weg nach vorn: erst prüfen und speichern
    if (wizard.step === 2 && step > 2 && !(await saveFields())) return;
    if (wizard.step === 2 && step < 2) await saveFields({ quiet: true });
    wizard.step = step;
    renderWizard();
    $('assistent').querySelector(`[data-panel="${step}"] h3`)?.focus?.();
    $('assistent-schritte').scrollIntoView({ block: 'nearest' });
  }

  async function saveFields({ quiet = false } = {}) {
    const wizard = state.wizard;
    const fields = readForm();
    const problem = formProblem(fields);
    if (problem) {
      if (!quiet) showWizardError(problem[0], problem[1]);
      return false;
    }
    if (sameFields(wizard.sub, fields)) return true;
    try {
      wizard.busy = true;
      renderWizard();
      const data = await call('PATCH', `/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}`, fields);
      wizard.sub = fromResponse(data) ?? { ...wizard.sub, ...fields };
      return true;
    } catch (error) {
      if (!quiet && error.status !== 401) showWizardError(error.message);
      return false;
    } finally {
      wizard.busy = false;
      renderWizard();
    }
  }

  // --- Schritt 1: JAR

  function setJarProgress(percent, text) {
    const bar = $('jar-balken');
    bar.firstElementChild.style.width = `${percent}%`;
    bar.setAttribute('aria-valuenow', String(percent));
    $('jar-fortschritt-text').textContent = text;
  }

  async function onJarChosen(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    const wizard = state.wizard;
    if (!file || !wizard || wizard.busy) return;
    const error = $('jar-fehler');
    error.hidden = true;
    $('jar-name').textContent = `${file.name} · ${formatBytes(file.size)}`;
    const fail = (text) => {
      error.textContent = text;
      error.hidden = false;
    };
    if (!/\.jar$/i.test(file.name)) return fail('Das ist keine JAR-Datei. Gewählt werden muss die fertige Addon-JAR (…/build/libs/…jar).');
    if (!file.size) return fail('Die Datei ist leer.');
    if (file.size > JAR_MAX) return fail('Die JAR ist größer als 50 MB.');
    wizard.busy = true;
    renderWizard();
    let created = false;
    try {
      if (!wizard.sub) {
        // Entwurf anlegen – bei einer neuen Version gleich mit den Angaben aus dem Store
        const prefill = wizard.forAddon ? { name: wizard.forAddon.name, summary: wizard.forAddon.summary, description: wizard.forAddon.description, category: wizard.forAddon.category, icon: wizard.forAddon.icon, platforms: wizard.forAddon.platforms } : {};
        const data = await call('POST', '/v1/addon-submissions', prefill);
        wizard.sub = fromResponse(data);
        if (!wizard.sub) throw new ApiError(500, 'Der Dienst hat keinen Entwurf angelegt.');
        created = true;
      }
      $('jar-fortschritt').hidden = false;
      $('jar-abbrechen').hidden = false;
      setJarProgress(0, `0 % · 0 von ${formatBytes(file.size)}`);
      const started = Date.now();
      wizard.job = upload(`/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}/jar`, file, (loaded, total) => {
        const percent = Math.min(100, Math.floor((loaded / total) * 100));
        const seconds = (Date.now() - started) / 1000;
        setJarProgress(percent, `${percent} % · ${formatBytes(loaded)} von ${formatBytes(total)}${seconds > 0.5 ? ` · ${formatBytes(loaded / seconds)}/s` : ''}`);
      });
      const data = await wizard.job.promise;
      setJarProgress(100, `100 % · ${formatBytes(file.size)} – geprüft`);
      const sub = fromResponse(data);
      if (sub) {
        wizard.sub = sub;
        // Was der Dienst aus der heldix.addon.json übernommen hat, ins Formular – Eigenes bleibt
        if (!form.name.value.trim()) form.name.value = sub.name;
        if (!form.summary.value.trim()) form.summary.value = sub.summary;
        form.name.dispatchEvent(new Event('input'));
        form.summary.dispatchEvent(new Event('input'));
      }
      toast(`${file.name} ist hochgeladen und geprüft.`, 'success');
    } catch (problem) {
      if (problem.status === 401) {
        onUnauthorized?.();
        return;
      }
      fail(problem.status === -1 ? 'Hochladen abgebrochen.' : problem.message);
      if (created && wizard.sub) {
        // Frisch angelegten, leeren Entwurf wieder entfernen
        await call('DELETE', `/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}`).catch(() => {});
        wizard.sub = null;
      }
    } finally {
      wizard.job = null;
      wizard.busy = false;
      $('jar-abbrechen').hidden = true;
      setTimeout(() => {
        if (!state.wizard?.job) $('jar-fortschritt').hidden = true;
      }, 1500);
      renderWizard();
    }
  }

  function renderDetected() {
    const box = $('jar-erkannt');
    const wizard = state.wizard;
    const sub = wizard?.sub;
    if (!sub?.sha256) {
      box.replaceChildren(h('p', { class: 'muted small', text: wizard?.forAddon ? `Wähl die JAR der neuen Version. Sie braucht die ID „${wizard.forAddon.id}“ und eine höhere Versionsnummer als ${wizard.forAddon.version}.` : 'Sobald die JAR hochgeladen ist, stehen hier die erkannten Daten.' }));
      box.classList.remove('filled');
      return;
    }
    box.classList.add('filled');
    const warnings = [];
    if (wizard.forAddon && sub.addonId !== wizard.forAddon.id) warnings.push(`Die JAR hat die ID „${sub.addonId}“, nicht „${wizard.forAddon.id}“. So entsteht ein eigenes, neues Addon – keine neue Version von ${wizard.forAddon.name}.`);
    if (sub.api !== null && sub.api > API_STUFE) warnings.push(`Das Addon braucht die Heldix-API-Stufe ${sub.api}. HeldixClient lädt derzeit bis Stufe ${API_STUFE} – so kann es niemand nutzen.`);
    const red = sub.inspection?.uses.some((use) => ['prozesse', 'nativ', 'minecraft'].includes(use));
    box.replaceChildren(
      h('h4', { text: 'Erkannt in der JAR' }),
      h(
        'dl',
        { class: 'facts-list' },
        h('dt', { text: 'ID' }),
        h('dd', null, h('code', { class: 'mono', text: sub.addonId ?? '–' })),
        h('dt', { text: 'Version' }),
        h('dd', null, h('strong', { text: sub.version ?? '–' })),
        h('dt', { text: 'Name' }),
        h('dd', { text: sub.name || '–' }),
        h('dt', { text: 'API-Stufe' }),
        h('dd', { text: sub.api === null ? '–' : String(sub.api) }),
        h('dt', { text: sub.authors.length === 1 ? 'Autor' : 'Autoren' }),
        h('dd', { text: sub.authors.join(', ') || '–' }),
        h('dt', { text: 'Größe' }),
        h('dd', { text: formatBytes(sub.size) }),
        h('dt', { text: 'SHA-256' }),
        h('dd', null, h('code', { class: 'mono hash', title: sub.sha256, text: shortSha(sub.sha256) })),
        h('dt', { text: 'Klassen' }),
        h('dd', { text: sub.inspection?.classes === null || sub.inspection?.classes === undefined ? '–' : String(sub.inspection.classes) }),
      ),
      ...warnings.map((text) => h('p', { class: 'addon-warning' }, icon('warning'), h('span', { text }))),
      h('h4', { text: 'Prüf-Hinweise' }),
      inspectionList(sub.inspection),
      h(
        'p',
        { class: 'hint' },
        red
          ? 'Rot markierte Zugriffe darf ein Addon praktisch nie – mit ihnen lehnt das Team fast immer ab. Addons nutzen nur die Heldix-API.'
          : 'Die Hinweise kommen aus einer groben Suche in den Klassendateien. Das Team sieht sie auch und fragt bei Bedarf nach.',
      ),
    );
  }

  // --- Schritt 2: Icons durchsuchen

  function filterIcons() {
    const term = $('icon-suche').value.trim().toLowerCase();
    for (const label of $('icon-auswahl').querySelectorAll('.icon-choice')) label.hidden = Boolean(term) && !label.dataset.icon.includes(term);
  }

  // --- Schritt 3: Screenshots

  function previewsOf(sub) {
    let list = state.previews.get(sub.id);
    if (!list) state.previews.set(sub.id, (list = []));
    list.length = sub.screenshots;
    return list;
  }

  function renderShots() {
    const wizard = state.wizard;
    const sub = wizard?.sub;
    if (!sub) return;
    const previews = previewsOf(sub);
    const slots = [];
    for (let index = 0; index < sub.screenshots; index++) {
      const src = previews[index];
      slots.push(
        h(
          'figure',
          { class: 'shot-slot filled', dataset: { n: String(index + 1) } },
          src
            ? h('button', { type: 'button', class: 'shot-preview', 'aria-label': `Screenshot ${index + 1} groß ansehen`, onClick: () => showPreview(index) }, h('img', { src, alt: '' }))
            : h('div', { class: 'shot-placeholder' }, icon('image'), h('span', { text: 'hochgeladen' })),
          h(
            'figcaption',
            null,
            h('span', { text: `Bild ${index + 1}` }),
            h('button', { type: 'button', class: 'icon-button small quiet-danger', 'aria-label': `Screenshot ${index + 1} entfernen`, disabled: wizard.busy || undefined, onClick: () => removeShot(index + 1) }, icon('trash')),
          ),
        ),
      );
    }
    if (sub.screenshots < SHOTS) {
      const input = h('input', { type: 'file', accept: 'image/png,image/jpeg', multiple: true, class: 'visually-hidden', id: 'screenshot-datei', disabled: wizard.busy || undefined });
      input.addEventListener('change', onShotsChosen);
      slots.push(
        h(
          'label',
          { class: `shot-slot add${wizard.busy ? ' disabled' : ''}` },
          input,
          wizard.busy ? h('span', { class: 'spinner', 'aria-hidden': 'true' }) : icon('plus'),
          h('span', { class: 'shot-add-text', text: wizard.busy ? 'Wird hochgeladen …' : sub.screenshots ? 'Weiteres Bild' : 'Bild hinzufügen' }),
          h('span', { class: 'shot-add-hint', text: `noch ${SHOTS - sub.screenshots} frei` }),
        ),
      );
    }
    $('screenshots').replaceChildren(...slots);
    void loadMissingShots(sub);
  }

  /** Vorschauen früher hochgeladener Bilder vom Dienst holen (GET /v1/addon-submissions/<id>/screenshots/<n>) */
  async function loadMissingShots(sub) {
    const previews = previewsOf(sub);
    const count = sub.screenshots;
    let changed = false;
    for (let index = 0; index < count; index++) {
      const key = `${sub.id}/${index + 1}`;
      if (previews[index] || state.shotLoads.has(key)) continue;
      state.shotLoads.add(key);
      try {
        const response = await api('GET', `/v1/addon-submissions/${encodeURIComponent(sub.id)}/screenshots/${index + 1}`, undefined, { raw: true });
        const src = await readDataUrl(await response.blob());
        const current = state.wizard?.sub;
        // inzwischen gelöscht oder umsortiert: verwerfen
        if (!current || current.id !== sub.id || current.screenshots !== count) continue;
        const list = previewsOf(current);
        if (!list[index] && src.startsWith('data:image/')) {
          list[index] = src;
          changed = true;
        }
      } catch {
        // bleibt Platzhalter
      } finally {
        state.shotLoads.delete(key);
      }
    }
    if (changed && state.wizard?.sub?.id === sub.id) renderShots();
  }

  function showPreview(index) {
    const sub = state.wizard?.sub;
    if (!sub) return;
    const previews = previewsOf(sub);
    const images = previews.map((src, i) => (src ? { src, alt: `Screenshot ${i + 1}`, i } : null)).filter(Boolean);
    openLightbox(
      images.map(({ src, alt }) => ({ src, alt })),
      Math.max(0, images.findIndex((image) => image.i === index)),
      { label: 'Deine Screenshots' },
    );
  }

  const readDataUrl = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result)));
      reader.addEventListener('error', () => reject(new Error('lesen')));
      reader.readAsDataURL(file);
    });
  const imageSize = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener('load', () => resolve({ width: image.naturalWidth, height: image.naturalHeight }));
      image.addEventListener('error', () => reject(new Error('bild')));
      image.src = src;
    });

  /** Bild im Browser prüfen (Typ, Größe, Pixel) – gibt die Vorschau (data:-URL) zurück oder wirft mit Hinweis. */
  async function checkShot(file) {
    const isImage = /^image\/(png|jpeg)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
    if (!isImage) throw new Error(`${file.name}: Nur PNG- oder JPEG-Bilder.`);
    if (file.size > SHOT_MAX) throw new Error(`${file.name}: Das Bild ist größer als 2 MB (${formatBytes(file.size)}).`);
    if (!file.size) throw new Error(`${file.name}: Die Datei ist leer.`);
    let src;
    let size;
    try {
      src = await readDataUrl(file);
      size = await imageSize(src);
    } catch {
      throw new Error(`${file.name}: Das Bild lässt sich nicht öffnen.`);
    }
    if (size.width < 320 || size.height < 180) throw new Error(`${file.name}: Zu klein (${size.width} × ${size.height}). Mindestens 320 × 180 Pixel.`);
    if (size.width > 3840 || size.height > 2160) throw new Error(`${file.name}: Zu groß (${size.width} × ${size.height}). Höchstens 3840 × 2160 Pixel.`);
    return src;
  }

  async function onShotsChosen(event) {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    const wizard = state.wizard;
    if (!files.length || !wizard?.sub || wizard.busy) return;
    const error = $('screenshot-fehler');
    error.hidden = true;
    const problems = [];
    const free = SHOTS - wizard.sub.screenshots;
    if (files.length > free) problems.push(`Es passen nur noch ${free === 1 ? '1 Bild' : `${free} Bilder`} – die übrigen wurden nicht hochgeladen.`);
    wizard.busy = true;
    renderWizard();
    try {
      for (const file of files.slice(0, free)) {
        let src;
        try {
          src = await checkShot(file);
        } catch (problem) {
          problems.push(problem.message);
          continue;
        }
        const n = wizard.sub.screenshots + 1;
        try {
          wizard.job = upload(`/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}/screenshots/${n}`, file);
          const sub = fromResponse(await wizard.job.promise) ?? { ...wizard.sub, screenshots: n };
          const previews = previewsOf(wizard.sub);
          previews[n - 1] = src;
          wizard.sub = sub;
          state.previews.set(sub.id, previews);
        } catch (problem) {
          if (problem.status === 401) {
            onUnauthorized?.();
            return;
          }
          problems.push(`${file.name}: ${problem.message}`);
        } finally {
          wizard.job = null;
        }
      }
    } finally {
      wizard.busy = false;
      renderWizard();
    }
    if (problems.length) {
      error.textContent = problems.join(' ');
      error.hidden = false;
    }
  }

  async function removeShot(n) {
    const wizard = state.wizard;
    if (!wizard?.sub || wizard.busy) return;
    wizard.busy = true;
    renderWizard();
    try {
      const data = await call('DELETE', `/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}/screenshots/${n}`);
      const previews = previewsOf(wizard.sub);
      previews.splice(n - 1, 1);
      wizard.sub = fromResponse(data) ?? { ...wizard.sub, screenshots: wizard.sub.screenshots - 1 };
      state.previews.set(wizard.sub.id, previews);
    } catch (error) {
      if (error.status !== 401) showError(error);
    } finally {
      wizard.busy = false;
      renderWizard();
    }
  }

  // --- Schritt 4: Zusammenfassung und Einreichen

  function renderSummary() {
    const sub = state.wizard?.sub;
    if (!sub) return;
    const limit = platformLimit(sub.platforms);
    const checks = [
      ['ok', `JAR ${sub.addonId} ${sub.version} (${formatBytes(sub.size)})`],
      [sub.inspection?.uses.some((use) => ['prozesse', 'nativ', 'minecraft'].includes(use)) ? 'fail' : sub.inspection?.uses.length ? 'warn' : 'ok', sub.inspection?.uses.length ? 'Prüf-Hinweise: Das Team sieht sich diese Zugriffe genauer an' : 'Prüf-Hinweise: nichts Auffälliges'],
      [sub.screenshots ? 'ok' : 'info', sub.screenshots ? `${sub.screenshots} ${sub.screenshots === 1 ? 'Screenshot' : 'Screenshots'}` : 'Keine Screenshots (freiwillig)'],
      [sub.notes.length ? 'ok' : 'info', sub.notes.length ? `Was ist neu: ${sub.notes.length} ${sub.notes.length === 1 ? 'Punkt' : 'Punkte'}` : 'Ohne „Was ist neu?“'],
      ['ok', `Systeme: ${platformText(sub.platforms)}`],
    ];
    $('zusammenfassung').replaceChildren(
      h('p', { class: 'eyebrow', text: 'So erscheint es im Store' }),
      h(
        'article',
        { class: 'addon-card preview-card' },
        h('div', { class: 'addon-card-head' }, addonIcon(sub.icon), h('div', { class: 'addon-card-title' }, h('h3', { text: sub.name }), h('p', { class: 'addon-card-meta', text: [`Version ${sub.version}`, sub.authors.length ? `von ${sub.authors.join(', ')}` : null].filter(Boolean).join(' · ') }))),
        sub.summary ? h('p', { class: 'addon-summary', text: sub.summary }) : null,
        h('div', { class: 'addon-card-foot' }, h('span', { class: 'addon-chips' }, originBadge({ official: false }), h('span', { class: 'chip accent', text: KATEGORIEN[sub.category] }), limit ? h('span', { class: 'chip warning', text: limit }) : null)),
      ),
      sub.description ? h('details', { class: 'preview-text' }, h('summary', null, 'Beschreibung ansehen', icon('chevron-down')), h('div', { class: 'addon-text' }, plainText(sub.description))) : '',
      h('ul', { class: 'check-list' }, checks.map(([kind, text]) => h('li', { class: kind }, icon(kind === 'ok' ? 'check' : kind === 'fail' ? 'warning' : kind === 'warn' ? 'warning' : 'info'), h('span', { text })))),
    );
  }

  function updateSubmitButton() {
    const all = [...$('regeln').querySelectorAll('input')].every((box) => box.checked);
    const button = $('assistent-einreichen');
    button.disabled = !all || Boolean(state.wizard?.busy);
    button.title = all ? '' : 'Bitte zuerst die drei Punkte bestätigen.';
  }

  async function submit() {
    const wizard = state.wizard;
    if (!wizard?.sub || wizard.busy) return;
    showWizardError('');
    const fields = readForm();
    const problem = formProblem(fields);
    if (problem) {
      wizard.step = 2;
      renderWizard();
      showWizardError(problem[0], problem[1]);
      return;
    }
    try {
      wizard.busy = true;
      renderWizard();
      if (!sameFields(wizard.sub, fields)) wizard.sub = fromResponse(await call('PATCH', `/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}`, fields)) ?? wizard.sub;
      const sub = fromResponse(await call('POST', `/v1/addon-submissions/${encodeURIComponent(wizard.sub.id)}/submit`));
      const label = `„${sub?.name || wizard.sub.name}“ ${sub?.version || wizard.sub.version}`;
      state.wizard = null;
      $('assistent').hidden = true;
      $('addons-uebersicht').hidden = false;
      toast(`Eingereicht! Das Team prüft ${label} – das dauert meist ein paar Tage. Den Stand siehst du hier.`, 'success');
      await refresh().catch(showError);
      $('addon-einreichen').focus({ preventScroll: true });
      $('einreichungen').scrollIntoView({ block: 'nearest' });
    } catch (error) {
      if (error.status === 401) return;
      showWizardError(error.message);
      if (state.wizard) {
        state.wizard.busy = false;
        renderWizard();
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------
  // Verdrahten
  // -------------------------------------------------------------------------------------------------------

  $('addon-einreichen').addEventListener('click', () => openWizard());
  $('assistent-schliessen').addEventListener('click', () => closeWizard());
  $('assistent-weiter').addEventListener('click', () => goTo((state.wizard?.step ?? 1) + 1));
  $('assistent-zurueck').addEventListener('click', () => goTo((state.wizard?.step ?? 2) - 1));
  $('assistent-schritte').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-step]');
    if (button) goTo(Number(button.dataset.step));
  });
  $('assistent-einreichen').addEventListener('click', submit);
  $('jar-datei').addEventListener('change', onJarChosen);
  $('jar-abbrechen').addEventListener('click', () => state.wizard?.job?.abort());
  $('regeln').addEventListener('change', updateSubmitButton);
  $('icon-suche').addEventListener('input', filterIcons);
  $('icon-auswahl').addEventListener('change', () => setIcon(selectedIcon()));
  $('angaben-form').addEventListener('submit', (event) => event.preventDefault());
  $('angaben-form').addEventListener('input', () => showWizardError(''));
  // Name und Kurzbeschreibung sind eine Zeile
  for (const input of [form.name, form.summary]) input.addEventListener('keydown', (event) => event.key === 'Enter' && event.preventDefault());
  const counter = (input, output, max, measure = (value) => length(value)) => {
    const update = () => {
      const used = measure(input.value);
      output.textContent = `${used}/${max}`;
      output.classList.toggle('near', used > max * 0.9);
    };
    input.addEventListener('input', update);
    update();
  };
  counter(form.name, $('angabe-name-zaehler'), LIMITS.name);
  counter(form.summary, $('angabe-kurz-zaehler'), LIMITS.summary);
  counter(form.description, $('angabe-beschreibung-zaehler'), LIMITS.description);
  counter(form.notes, $('angabe-neu-zaehler'), LIMITS.notes, (value) => value.split(/\r?\n/).filter((line) => line.trim()).length);
  window.addEventListener('beforeunload', (event) => {
    if (state.wizard?.job) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  return {
    /** Reiter gewechselt: nur solange „Meine Addons“ offen ist, wird nachgefragt. */
    onTab(name) {
      if (name === 'addons') {
        refresh().catch(showError);
        refresher.start();
      } else {
        refresher.stop();
      }
    },
    stop() {
      refresher.stop();
      state.wizard?.job?.abort();
      state.wizard = null;
      state.known = null;
      $('assistent').hidden = true;
      $('addons-uebersicht').hidden = false;
    },
    /** Assistent für eine neue Version (z. B. aus einem Link). */
    hasWizard: () => Boolean(state.wizard),
  };
}
