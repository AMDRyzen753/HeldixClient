// Setup teilen (0.14.1, main/core/setupshare.ts und setupinstall.ts):
// - Dialog #setup-share-dialog „Setup teilen“ (Instanz → „Teilen“): was mitgeht, was nicht (mit Grund), Grafik und Tasten
//   wählbar, Ablauf, „Link erstellen“ → Link und Code zum Kopieren.
// - Dialog #setups-dialog „Setups“ (Instanzen → „Setups“): Link oder Code einfügen und die eigenen geteilten Setups
//   mit Zählern, Link kopieren und Widerrufen.
// - Dialog #setup-preview-dialog: Vorschau eines Setups aus einem Link heldixclient://setup/<code> (Main-Prozess merkt sich
//   den Link bis takeSetupLink, wie bei Einladungen und Welten), aus „Setups“ oder dem Einfügen-Feld unter Freunde →
//   Einladen. „Als neue Instanz anlegen“ lädt alles und zeigt danach, was installiert und was übersprungen wurde.
// Ohne Klick passiert nichts.
import type {
  OwnSharedSetup,
  OwnSharedSetups,
  SharedSetupCreated,
  SharedSetupDraft,
  SharedSetupExpiry,
  SharedSetupKind,
  SharedSetupPreview,
  SharedSetupPreviewItem,
  SharedSetupResult,
} from '../shared/api';
import { LOADER_LABELS, api, confirmDialog, errorMessage, formatDate, h, reloadInstances, toast, uiIcon } from './core.js';
import { playerHead } from './friends.js';

export interface SetupShareLinks {
  showView(view: string): void;
  /** Detailansicht einer Instanz */
  openInstance(id: string): void;
  /** Instanz starten */
  playInstance(id: string): void;
}

let links: SetupShareLinks | null = null;

// ---------- Texte (ganze Sätze mit Platzhaltern) ----------

const KIND_TEXT: Record<SharedSetupKind, { one: string; many: string; title: string; icon: string }> = {
  mods: { one: '1 Mod', many: '{n} Mods', title: 'Mods', icon: 'cube' },
  resourcepacks: { one: '1 Ressourcenpaket', many: '{n} Ressourcenpakete', title: 'Ressourcenpakete', icon: 'image' },
  shaderpacks: { one: '1 Shaderpack', many: '{n} Shaderpacks', title: 'Shaderpacks', icon: 'shader' },
  addons: { one: '1 Addon', many: '{n} Addons', title: 'Addons', icon: 'addons' },
};
const KINDS: SharedSetupKind[] = ['mods', 'resourcepacks', 'shaderpacks', 'addons'];

const fill = (template: string, values: Record<string, string | number>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
const amount = (kind: SharedSetupKind, n: number) => fill(n === 1 ? KIND_TEXT[kind].one : KIND_TEXT[kind].many, { n });
const plural = (n: number, one: string, many: string) => fill(n === 1 ? one : many, { n });

function countLine(items: { kind: SharedSetupKind }[]): string {
  const parts = KINDS.map((kind) => ({ kind, n: items.filter((i) => i.kind === kind).length })).filter((p) => p.n > 0).map((p) => amount(p.kind, p.n));
  return parts.length ? parts.join(' · ') : 'Keine Mods, Pakete oder Addons';
}

function loaderText(loader: SharedSetupPreview['loader'], heldixClient: boolean): string {
  if (loader === 'fabric') return heldixClient ? 'Fabric mit HeldixClient' : 'Fabric';
  return loader === 'heldix' ? 'HeldixClient (Heldix Loader)' : LOADER_LABELS.vanilla;
}

function expiryText(expires: number | null): string {
  return expires ? fill('Läuft am {datum} ab', { datum: formatDate(expires) }) : 'Läuft nicht ab';
}

// ---------- Bausteine ----------

interface Dialog {
  id: string;
  backdrop: HTMLElement;
  modal: HTMLElement;
  busy: boolean;
}
let dialog: Dialog | null = null;

function close(): void {
  dialog?.backdrop.remove();
  dialog = null;
}

function openDialog(id: string, labelledBy: string): Dialog {
  close();
  const modal = h('div', { class: 'modal setup-modal', id, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy });
  const backdrop = h('div', { class: 'modal-backdrop', onclick: (event: Event) => event.target === backdrop && !dialog?.busy && close() }, modal);
  document.body.append(backdrop);
  dialog = { id, backdrop, modal, busy: false };
  return dialog;
}

function button(id: string, label: string, kind: 'primary' | 'ghost' | 'danger', onclick: () => void, icon?: string, disabled = false): HTMLButtonElement {
  return h('button', { id, class: kind, type: 'button', disabled, onclick }, icon ? uiIcon(icon, 'btn-icon') : null, h('span', { text: label }));
}

function head(title: string, sub: string, titleId: string, icon: Node | string = 'send'): HTMLElement {
  return h('div', { class: 'invite-head' },
    typeof icon === 'string' ? h('div', { class: 'friends-state-icon invite-head-icon' }, uiIcon(icon)) : icon,
    h('div', {}, h('h3', { class: 'modal-title', id: titleId, text: title }), h('p', { class: 'modal-sub', text: sub })));
}

function frame(target: Dialog, content: { head: Node; body: Node[]; actions: Node[] }): void {
  if (dialog !== target) return;
  target.modal.replaceChildren(
    h('div', { class: 'modal-head' }, content.head,
      h('button', { class: 'icon-button', type: 'button', title: 'Schließen', 'aria-label': 'Schließen', disabled: target.busy, onclick: close }, uiIcon('close'))),
    h('div', { class: 'invite-body' }, ...content.body),
    h('div', { class: 'modal-actions' }, ...content.actions));
}

function loading(text: string): HTMLElement {
  return h('div', { class: 'invite-loading' }, h('div', { class: 'friends-spinner', 'aria-hidden': 'true' }), h('span', { text }));
}

function note(tone: 'info' | 'warn' | 'success', text: string, id?: string): HTMLElement {
  return h('p', { class: `invite-note ${tone}`, id }, uiIcon(tone === 'success' ? 'check' : tone === 'warn' ? 'warning' : 'info', 'invite-note-icon'), h('span', { text }));
}

function fact(icon: string, label: string, value: string, id?: string): HTMLElement {
  return h('div', { class: 'invite-fact' },
    h('span', { class: 'invite-fact-icon' }, uiIcon(icon)),
    h('span', { class: 'invite-fact-label', text: label }),
    h('span', { class: 'invite-fact-value', text: value, id }));
}

function toggleRow(id: string, label: string, sub: string, checked: boolean, disabled: boolean, onchange: (value: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', class: 'switch', id, disabled });
  input.checked = checked;
  input.addEventListener('change', () => onchange(input.checked));
  return h('label', { class: `toggle-row setup-toggle${disabled ? ' disabled' : ''}` }, h('span', {}, label, h('small', { class: 'toggle-sub', text: sub })), input);
}

async function copy(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(done, 'success');
  } catch {
    toast('Kopieren ging nicht.', 'error');
  }
}

function itemIcon(kind: SharedSetupKind, item?: Pick<SharedSetupPreviewItem, 'iconUrl' | 'icon'>): HTMLElement {
  if (item?.iconUrl) return h('img', { class: 'setup-item-icon', src: item.iconUrl, alt: '', loading: 'lazy' });
  return h('span', { class: 'setup-item-icon' }, uiIcon(item?.icon ?? KIND_TEXT[kind].icon));
}

// ---------- Setup teilen (aus einer Instanz) ----------

interface ShareState {
  instanceId: string;
  draft: SharedSetupDraft | null;
  error: string | null;
  created: SharedSetupCreated | null;
  name: string;
  description: string;
  graphics: boolean;
  keys: boolean;
  expiresDays: SharedSetupExpiry;
}

const EXPIRIES: { value: SharedSetupExpiry; label: string }[] = [
  { value: 7, label: '7 Tage' },
  { value: 30, label: '30 Tage' },
  { value: 90, label: '90 Tage' },
  { value: null, label: 'Nie' },
];

/** „Teilen“ in der Detailansicht einer Instanz */
export function openShareDialog(instanceId: string): void {
  const target = openDialog('setup-share-dialog', 'setup-share-title');
  const share: ShareState = { instanceId, draft: null, error: null, created: null, name: '', description: '', graphics: true, keys: false, expiresDays: 30 };
  const render = () => renderShare(target, share, render);
  render();
  void api.prepareSetupShare(instanceId).then((draft) => {
    share.draft = draft;
    share.name = draft.instanceName.slice(0, 40);
    share.graphics = draft.graphics > 0;
    render();
  }).catch((error) => {
    share.error = errorMessage(error);
    render();
  });
}

function renderShare(target: Dialog, share: ShareState, render: () => void): void {
  const draft = share.draft;
  const titleId = 'setup-share-title';
  if (share.created) {
    renderShared(target, share.created, share.name);
    return;
  }
  if (!draft) {
    frame(target, {
      head: head('Setup teilen', 'Mods, Pakete, Addons und Einstellungen dieser Instanz als Link', titleId),
      body: [share.error ? note('warn', share.error, 'setup-share-error') : loading('Inhalte werden geprüft …')],
      actions: [button('setup-share-cancel', 'Schließen', 'ghost', close)],
    });
    return;
  }
  const sub = fill('„{name}“ · Minecraft {version} · {loader}', { name: draft.instanceName, version: draft.minecraft, loader: loaderText(draft.loader, draft.heldixClient) });
  const name = h('input', { type: 'text', id: 'setup-share-name', maxlength: '40', spellcheck: 'false', value: share.name, placeholder: draft.instanceName });
  name.addEventListener('input', () => (share.name = name.value));
  const description = h('textarea', { class: 'setup-textarea', id: 'setup-share-description', maxlength: '300', rows: '2', placeholder: 'Wofür ist das Setup? (optional)' });
  description.value = share.description;
  description.addEventListener('input', () => (share.description = description.value));

  const shared = h('div', { class: 'setup-list', id: 'setup-share-items' });
  if (draft.items.length === 0) shared.append(h('p', { class: 'hint setup-empty', text: 'Keine Mods, Pakete oder Addons – geteilt werden nur Minecraft-Version, Loader und die gewählten Einstellungen.' }));
  for (const kind of KINDS) {
    const list = draft.items.filter((i) => i.kind === kind);
    if (!list.length) continue;
    shared.append(h('div', { class: 'setup-group-title', text: `${KIND_TEXT[kind].title} (${list.length})` }));
    for (const item of list) shared.append(h('div', { class: 'setup-item' }, itemIcon(kind), h('span', { class: 'setup-item-title', text: item.title })));
  }

  const expiry = h('div', { class: 'chip-toggle segmented setup-expiry', id: 'setup-share-expiry', role: 'group', 'aria-label': 'Ablauf' },
    ...EXPIRIES.map((option) => h('button', {
      type: 'button',
      class: option.value === share.expiresDays ? 'active' : '',
      'data-days': option.value === null ? 'nie' : String(option.value),
      onclick: () => {
        share.expiresDays = option.value;
        render();
      },
    }, option.label)));

  const body: Node[] = [
    h('label', { class: 'stack' }, h('span', { text: 'Name' }), name),
    h('label', { class: 'stack' }, h('span', { text: 'Beschreibung' }), description),
    h('div', { class: 'stack' }, h('span', { text: fill('Wird geteilt: {inhalt}', { inhalt: countLine(draft.items) }), id: 'setup-share-count' }), shared),
    toggleRow('setup-share-graphics', 'Grafik-Einstellungen mitteilen',
      draft.graphics > 0 ? fill(plural(draft.graphics, '1 Wert', '{n} Werte') + ' – Sichtweite, FPS-Grenze, GUI-Größe{heldix} …', { heldix: draft.heldixClient ? ', Heldix-Leistungsprofil' : '' }) : 'Diese Instanz hat noch keine eigenen Grafik-Einstellungen.',
      share.graphics && draft.graphics > 0, draft.graphics === 0, (value) => (share.graphics = value)),
    toggleRow('setup-share-keys', 'Tastenbelegung mitteilen',
      draft.keys > 0 ? fill(plural(draft.keys, '1 Taste', '{n} Tasten') + ' aus der Steuerung – nur, wenn andere genau deine Belegung wollen', {}) : 'Diese Instanz hat noch keine gespeicherte Tastenbelegung.',
      share.keys && draft.keys > 0, draft.keys === 0, (value) => (share.keys = value)),
    h('div', { class: 'stack' }, h('span', { text: 'Link gilt' }), expiry),
  ];
  if (draft.notShared.length) {
    const list = h('div', { class: 'setup-list compact', id: 'setup-share-skipped' },
      ...draft.notShared.map((item) => h('div', { class: 'setup-item skip' }, itemIcon(item.kind),
        h('span', { class: 'setup-item-title' }, item.name, h('span', { class: 'setup-item-note', text: fill('nicht geteilt: {grund}', { grund: item.reason }) })))));
    body.push(h('div', { class: 'stack' }, h('span', { text: fill('Nicht geteilt ({anzahl})', { anzahl: draft.notShared.length }) }), list));
  }
  if (draft.problem) body.push(h('div', { class: 'invite-problem', id: 'setup-share-problem' }, uiIcon('info', 'invite-note-icon'), h('span', { text: draft.problem })));

  frame(target, {
    head: head('Setup teilen', sub, titleId),
    body,
    actions: [
      button('setup-share-cancel', 'Abbrechen', 'ghost', close),
      button('setup-share-create', target.busy ? 'Wird erstellt …' : 'Link erstellen', 'primary', () => void createShare(target, share, render), 'send', target.busy || !!draft.problem),
    ],
  });
}

async function createShare(target: Dialog, share: ShareState, render: () => void): Promise<void> {
  if (target.busy || !share.draft) return;
  target.busy = true;
  render();
  try {
    share.created = await api.createSetupShare(share.instanceId, {
      name: share.name.trim() || share.draft.instanceName,
      description: share.description.trim(),
      graphics: share.graphics && share.draft.graphics > 0,
      keys: share.keys && share.draft.keys > 0,
      expiresDays: share.expiresDays,
    });
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    target.busy = false;
    render();
  }
}

function renderShared(target: Dialog, created: SharedSetupCreated, name: string): void {
  const link = h('input', { type: 'text', id: 'setup-share-link', readonly: true, value: created.url, spellcheck: 'false', 'aria-label': 'Link zum Setup' });
  link.addEventListener('focus', () => link.select());
  frame(target, {
    head: head('Setup geteilt', fill('„{name}“ · {ablauf}', { name, ablauf: expiryText(created.expires) }), 'setup-share-title', 'check'),
    body: [
      note('success', 'Wer den Link öffnet, sieht die Vorschau und kann das Setup mit einem Klick als neue Instanz anlegen – mit HeldixClient direkt, sonst über die Webseite.', 'setup-share-done'),
      h('div', { class: 'setup-link-row' }, link, button('setup-share-copy', 'Link kopieren', 'primary', () => void copy(created.url, 'Link kopiert.'), 'copy')),
      h('div', { class: 'invite-facts' },
        fact('lock', 'Code', created.code, 'setup-share-code'),
        fact('send', 'In HeldixClient', created.appUrl),
        fact('clock', 'Ablauf', expiryText(created.expires))),
      created.notShared.length ? note('info', plural(created.notShared.length, '1 Datei wurde nicht geteilt (siehe vorher).', '{n} Dateien wurden nicht geteilt (siehe vorher).')) : null,
    ].filter((n): n is HTMLElement => n !== null),
    actions: [
      button('setup-share-code-copy', 'Code kopieren', 'ghost', () => void copy(created.code, 'Code kopiert.'), 'copy'),
      button('setup-share-mine', 'Meine Setups', 'ghost', () => openSetupsDialog(), 'list'),
      button('setup-share-close', 'Fertig', 'primary', close),
    ],
  });
}

// ---------- Setups: einfügen und eigene verwalten ----------

/** Instanzen → „Setups“ */
export function openSetupsDialog(): void {
  const target = openDialog('setups-dialog', 'setups-title');
  let own: OwnSharedSetups | null = null;
  const input = h('input', { type: 'text', id: 'setups-paste-input', placeholder: 'heldixclient.com/setup#… oder Code', spellcheck: 'false', maxlength: '2000', autocomplete: 'off', 'aria-label': 'Setup-Link oder Code' });
  const open = button('setups-paste-open', 'Öffnen', 'ghost', () => void paste(), 'chevron-right');
  const paste = async () => {
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    open.disabled = true;
    try {
      // der Main-Prozess prüft den Link und öffnet die Vorschau (setups:open → takeSetupLink)
      await api.pasteSetupLink(text);
    } catch (error) {
      toast(errorMessage(error), 'error');
      open.disabled = false;
      input.focus();
    }
  };
  const form = h('form', { class: 'friends-invite-row', onsubmit: (e: Event) => {
    e.preventDefault();
    void paste();
  } }, input, open);

  const render = () => {
    const mine: Node[] = [];
    if (!own) mine.push(loading('Deine Setups werden geladen …'));
    else if (own.status === 'off') mine.push(note('info', own.error ?? 'Eigene Setups gibt es mit einem Microsoft-Konto.'));
    else if (own.status === 'unsupported') mine.push(note('info', 'Der Heldix-Dienst kennt noch keine geteilten Setups.'));
    else if (own.status === 'error') {
      mine.push(note('warn', own.error ?? 'Die Setups ließen sich nicht laden.'),
        h('div', { class: 'button-row' }, button('setups-retry', 'Erneut versuchen', 'ghost', () => void load(), 'refresh')));
    } else if (own.setups.length === 0) {
      mine.push(h('p', { class: 'hint', id: 'setups-empty', text: 'Du hast noch kein Setup geteilt. Öffne eine Instanz und klick dort auf „Teilen“.' }));
    } else {
      mine.push(h('div', { class: 'setup-own-list', id: 'setups-own' }, ...own.setups.map((setup) => ownRow(setup, (next) => {
        own = next;
        render();
      }))));
    }
    frame(target, {
      head: head('Setups', 'Geteilte Instanzen öffnen und deine eigenen verwalten', 'setups-title'),
      body: [
        h('div', { class: 'stack' }, h('span', { text: 'Setup von jemand anderem öffnen' }), form,
          h('p', { class: 'hint', text: 'Web-Link (heldixclient.com/setup#…), heldixclient://setup/… oder nur der Code – du siehst zuerst eine Vorschau.' })),
        h('div', { class: 'stack' }, h('span', { text: 'Deine geteilten Setups' }), ...mine),
      ],
      actions: [button('setups-close', 'Schließen', 'primary', close)],
    });
  };
  const load = async () => {
    own = null;
    render();
    own = await api.listOwnSetups().catch((error): OwnSharedSetups => ({ status: 'error', error: errorMessage(error), setups: [] }));
    if (dialog === target) render();
  };
  void load();
}

function ownRow(setup: OwnSharedSetup, update: (next: OwnSharedSetups) => void): HTMLElement {
  const meta = [
    fill('Geteilt am {datum}', { datum: formatDate(setup.created) }),
    setup.active ? expiryText(setup.expires) : 'Zurückgezogen oder abgelaufen',
    plural(setup.views, '1 Aufruf', '{n} Aufrufe'),
    plural(setup.installs, '1 Mal angelegt', '{n} Mal angelegt'),
  ].join(' · ');
  const revoke = async () => {
    const ok = await confirmDialog('Setup zurückziehen?', fill('Der Link zu „{name}“ funktioniert danach nicht mehr. Schon angelegte Instanzen bleiben bei den anderen.', { name: setup.name }), 'Zurückziehen');
    if (!ok) return;
    try {
      update(await api.revokeSetup(setup.code));
      toast('Setup zurückgezogen.', 'success');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  };
  return h('div', { class: `setup-own${setup.active ? '' : ' inactive'}`, 'data-code': setup.code },
    h('div', { class: 'setup-own-text' }, h('strong', { text: setup.name }), h('span', { class: 'setup-own-meta', text: meta })),
    h('div', { class: 'button-row' },
      setup.active && setup.url ? h('button', { class: 'icon-button small', type: 'button', title: 'Link kopieren', 'aria-label': 'Link kopieren', onclick: () => void copy(setup.url!, 'Link kopiert.') }, uiIcon('copy')) : null,
      setup.active ? h('button', { class: 'icon-button small danger-hover', type: 'button', title: 'Zurückziehen', 'aria-label': 'Zurückziehen', onclick: () => void revoke() }, uiIcon('trash')) : null));
}

// ---------- Vorschau und „Als neue Instanz anlegen“ ----------

interface PreviewState {
  code: string;
  view: SharedSetupPreview | null;
  name: string;
  graphics: boolean;
  keys: boolean;
  progress: { stage: string; done: number; total: number } | null;
  result: SharedSetupResult | null;
}

/** Vorschau eines Setups öffnen (ersetzt einen offenen Dialog) */
export function openSetupPreview(code: string): void {
  const target = openDialog('setup-preview-dialog', 'setup-preview-title');
  const preview: PreviewState = { code, view: null, name: '', graphics: true, keys: false, progress: null, result: null };
  const render = () => renderPreview(target, preview, render);
  const load = async () => {
    preview.view = null;
    render();
    let view: SharedSetupPreview;
    try {
      view = await api.getSetupPreview(code);
    } catch (error) {
      view = { code, status: 'error', error: errorMessage(error), name: '', description: '', creator: null, created: 0, expires: null, views: 0, installs: 0, minecraft: '', loader: 'vanilla', heldixClient: false, items: [], graphics: [], keys: 0, problem: null, notes: [] };
    }
    if (dialog !== target) return;
    preview.view = view;
    preview.name = view.name.slice(0, 40);
    preview.graphics = view.graphics.length > 0;
    render();
  };
  previewReload = load;
  void load();
}
let previewReload: (() => Promise<void>) | null = null;

function renderPreview(target: Dialog, preview: PreviewState, render: () => void): void {
  const titleId = 'setup-preview-title';
  const view = preview.view;
  if (preview.result) {
    renderResult(target, preview.result);
    return;
  }
  if (!view) {
    frame(target, { head: head('Geteiltes Setup', 'Wird geladen …', titleId), body: [loading('Setup wird geladen …')], actions: [button('setup-preview-cancel', 'Schließen', 'ghost', close)] });
    return;
  }
  target.modal.dataset.state = view.status;
  if (view.status !== 'ok') {
    const text = view.status === 'missing' ? 'Dieses Setup gibt es nicht. Prüf den Link oder frag nach einem neuen.'
      : view.status === 'gone' ? 'Dieses Setup ist abgelaufen oder wurde zurückgezogen. Frag nach einem neuen Link.'
        : view.error ?? 'Unbekannter Fehler beim Heldix-Dienst.';
    frame(target, {
      head: head(view.status === 'error' ? 'Setup lässt sich nicht laden' : 'Setup nicht verfügbar', 'Der Link funktioniert nicht.', titleId, 'warning'),
      body: [h('p', { class: 'modal-text', id: 'setup-preview-missing', text })],
      actions: [
        button('setup-preview-cancel', 'Schließen', view.status === 'error' ? 'ghost' : 'primary', close),
        view.status === 'error' ? button('setup-preview-retry', 'Erneut versuchen', 'primary', () => void previewReload?.(), 'refresh') : null,
      ].filter((n): n is HTMLButtonElement => n !== null),
    });
    return;
  }
  if (preview.progress) {
    const p = preview.progress;
    const percent = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    const bar = h('div', { class: 'setup-progress-bar' }, h('span', {}));
    bar.style.setProperty('--p', `${percent}%`);
    frame(target, {
      head: head(fill('„{name}“ wird angelegt', { name: preview.name || view.name }), 'Lädt von Modrinth und aus dem Addon-Store …', titleId, 'download'),
      body: [h('div', { class: 'setup-progress', id: 'setup-preview-progress' },
        h('div', { class: 'invite-loading' }, h('div', { class: 'friends-spinner', 'aria-hidden': 'true' }), h('span', { text: p.stage })),
        bar,
        h('span', { class: 'hint', text: fill('{fertig} von {gesamt}', { fertig: Math.min(p.done, p.total), gesamt: p.total }) }))],
      actions: [],
    });
    return;
  }

  const creator = view.creator;
  const sub = creator ? fill('von {name} · Minecraft {version}', { name: creator.name, version: view.minecraft }) : fill('Minecraft {version}', { version: view.minecraft });
  const headNode = h('div', { class: 'invite-head' },
    creator ? playerHead(creator.uuid, creator.name, 'md') : h('div', { class: 'friends-state-icon invite-head-icon' }, uiIcon('send')),
    h('div', {}, h('h3', { class: 'modal-title', id: titleId, text: view.name }), h('p', { class: 'modal-sub', text: sub })));

  const body: Node[] = [];
  if (view.description) body.push(h('p', { class: 'modal-text setup-description', id: 'setup-preview-description', text: view.description }));
  body.push(h('div', { class: 'invite-facts' },
    fact('cube', 'Minecraft', fill('Version {version}', { version: view.minecraft }), 'setup-preview-version'),
    fact(`loader-${view.loader}`, 'Loader', loaderText(view.loader, view.heldixClient), 'setup-preview-loader'),
    fact('clock', 'Ablauf', expiryText(view.expires)),
    fact('eye', 'Beliebtheit', fill('{aufrufe} · {anlagen}', { aufrufe: plural(view.views, '1 Aufruf', '{n} Aufrufe'), anlagen: plural(view.installs, '1 Mal angelegt', '{n} Mal angelegt') }))));

  const list = h('div', { class: 'setup-list', id: 'setup-preview-items' });
  if (view.items.length === 0) list.append(h('p', { class: 'hint setup-empty', text: 'Keine Mods, Pakete oder Addons – nur Minecraft-Version, Loader und Einstellungen.' }));
  for (const kind of KINDS) {
    const items = view.items.filter((i) => i.kind === kind);
    if (!items.length) continue;
    list.append(h('div', { class: 'setup-group-title', text: `${KIND_TEXT[kind].title} (${items.length})` }));
    for (const item of items) {
      list.append(h('div', { class: `setup-item ${item.state}`, 'data-kind': kind, 'data-state': item.state, title: item.note ?? '' },
        itemIcon(kind, item),
        h('span', { class: 'setup-item-title' }, item.title, item.note ? h('span', { class: 'setup-item-note', text: item.note }) : null),
        item.version ? h('span', { class: 'setup-item-version', text: item.version }) : null));
    }
  }
  const skipped = view.items.filter((i) => i.state === 'skip').length;
  body.push(h('div', { class: 'stack' }, h('span', { id: 'setup-preview-count', text: skipped
    ? fill('Inhalt: {inhalt} – {nicht} nicht installierbar', { inhalt: countLine(view.items), nicht: skipped })
    : fill('Inhalt: {inhalt}', { inhalt: countLine(view.items) }) }), list));

  if (view.graphics.length) {
    const shown = view.graphics.slice(0, 6);
    body.push(h('div', { class: 'setup-settings' },
      toggleRow('setup-preview-graphics', 'Grafik-Einstellungen übernehmen', plural(view.graphics.length, '1 Wert aus dem Setup', '{n} Werte aus dem Setup'), preview.graphics, false, (value) => (preview.graphics = value)),
      h('ul', { class: 'setup-settings-lines' }, ...shown.map((line) => h('li', { text: line })),
        view.graphics.length > shown.length ? h('li', { text: fill('und {n} weitere', { n: view.graphics.length - shown.length }) }) : null)));
  }
  if (view.keys) {
    body.push(toggleRow('setup-preview-keys', 'Tastenbelegung übernehmen', plural(view.keys, '1 Taste – ersetzt die Standardbelegung', '{n} Tasten – ersetzen die Standardbelegung'), preview.keys, false, (value) => (preview.keys = value)));
  }
  for (const text of view.notes) body.push(note('warn', text));

  const name = h('input', { type: 'text', id: 'setup-preview-name', maxlength: '40', spellcheck: 'false', value: preview.name, placeholder: view.name });
  name.addEventListener('input', () => (preview.name = name.value));
  body.push(h('label', { class: 'stack' }, h('span', { text: 'Name der neuen Instanz' }), name));
  if (view.problem) body.push(h('div', { class: 'invite-problem', id: 'setup-preview-problem' }, uiIcon('info', 'invite-note-icon'), h('span', { text: view.problem })));

  frame(target, {
    head: headNode,
    body,
    actions: [
      button('setup-preview-cancel', 'Später', 'ghost', close),
      button('setup-preview-install', 'Als neue Instanz anlegen', 'primary', () => void install(target, preview, render), 'plus', target.busy || !!view.problem),
    ],
  });
}

async function install(target: Dialog, preview: PreviewState, render: () => void): Promise<void> {
  const view = preview.view;
  if (target.busy || !view || view.status !== 'ok') return;
  target.busy = true;
  preview.progress = { stage: 'Vorbereiten …', done: 0, total: Math.max(1, view.items.length) };
  render();
  const stop = api.onProgress((event) => {
    if (!preview.progress || dialog !== target) return;
    preview.progress = event;
    render();
  });
  try {
    preview.result = await api.installSharedSetup(preview.code, { name: preview.name.trim() || view.name, graphics: preview.graphics, keys: preview.keys });
    await reloadInstances().catch(() => undefined);
  } catch (error) {
    toast(errorMessage(error), 'error');
  } finally {
    stop();
    target.busy = false;
    preview.progress = null;
    render();
  }
}

function renderResult(target: Dialog, result: SharedSetupResult): void {
  const body: Node[] = [
    note('success', result.installed.length
      ? fill('Installiert: {inhalt}.', { inhalt: countLine(result.installed) })
      : 'Die Instanz ist angelegt – das Setup hatte nichts zum Herunterladen.', 'setup-result-installed'),
  ];
  if (result.graphics || result.keys) {
    const parts = [result.graphics ? plural(result.graphics, '1 Grafik-Wert', '{n} Grafik-Werte') : null, result.keys ? plural(result.keys, '1 Taste', '{n} Tasten') : null].filter(Boolean).join(' und ');
    body.push(note('info', fill('{werte} kommen beim ersten Start in die Einstellungen.', { werte: parts })));
  }
  if (result.skipped.length) {
    body.push(h('div', { class: 'stack' }, h('span', { text: fill('Nicht installiert ({anzahl})', { anzahl: result.skipped.length }) }),
      h('div', { class: 'setup-list compact', id: 'setup-result-skipped' }, ...result.skipped.map((item) => h('div', { class: 'setup-item skip' }, itemIcon(item.kind),
        h('span', { class: 'setup-item-title' }, item.title, h('span', { class: 'setup-item-note', text: item.reason })))))));
  }
  for (const text of result.notes.slice(0, 8)) body.push(note('info', text));
  frame(target, {
    head: head(fill('„{name}“ ist angelegt', { name: result.instanceName }), 'Neue Instanz aus dem Setup', 'setup-preview-title', 'check'),
    body,
    actions: [
      button('setup-result-open', 'Zur Instanz', 'ghost', () => {
        close();
        links?.showView('instances');
        links?.openInstance(result.instanceId);
      }, 'grid'),
      button('setup-result-play', 'Jetzt spielen', 'primary', () => {
        close();
        links?.playInstance(result.instanceId);
      }, 'play'),
    ],
  });
}

// ---------- Links ----------

async function takeLink(): Promise<void> {
  const code = await api.takeSetupLink().catch(() => null);
  if (code) openSetupPreview(code);
}

/** Nach dem Einrichtungs-Assistenten: einen zurückgehaltenen Setup-Link abholen */
export function openPendingSetup(): Promise<void> {
  return takeLink();
}

/** einmal beim Start: geöffnete Links abholen */
export function initSetupShare(options: SetupShareLinks): void {
  links = options;
  api.onSetupLinkOpen(() => void takeLink());
  // Escape entfernt Dialoge (app.ts) – nur nicht, während ein Setup angelegt bzw. geteilt wird; danach aufräumen
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !dialog) return;
    if (dialog.busy) {
      event.stopPropagation();
      return;
    }
    window.setTimeout(() => {
      if (dialog && !dialog.backdrop.isConnected) dialog = null;
    }, 0);
  }, true);
  void takeLink();
}
