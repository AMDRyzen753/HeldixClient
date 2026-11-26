// Absturz-Hilfe: Dialog nach einem Absturz mit erkannter Ursache, passenden Schritten und „An den Support senden“.
// Die Analyse macht der Hauptprozess (main/core/crash.ts); gesendet wird nur, was hier vorher angezeigt wurde.
import type { CrashAction, CrashAnalysis, CrashReportPreview } from '../shared/api';
import { api, emit, errorMessage, h, reloadInstances, state, toast, uiIcon } from './core.js';
import { launchInstance, openDetail } from './instances.js';

type ShowView = (view: string) => void;
let showView: ShowView = () => undefined;
let backdrop: HTMLElement | null = null;
/** schon erledigte Schritte je Analyse (Knopf bleibt „erledigt“, wenn der Dialog neu aufgeht) */
const done = new Map<string, Set<string>>();

export function initCrash(view: ShowView): void {
  showView = view;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backdrop) close();
  });
}

function close(): void {
  backdrop?.remove();
  backdrop = null;
}

function actionKey(action: CrashAction): string {
  return `${action.kind}:${action.file ?? action.help ?? ''}`;
}

function formatGb(mb: number): string {
  return `${(mb / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} GB`;
}

async function saveSettings(patch: Parameters<typeof api.saveSettings>[0]): Promise<void> {
  state.settings = await api.saveSettings(patch);
  emit('settings');
}

/** Führt einen Vorschlag aus; Rückgabe = Text für den erledigten Knopf (null = nichts geändert) */
async function runAction(analysis: CrashAnalysis, action: CrashAction): Promise<string | null> {
  const instance = state.instances.find((i) => i.id === analysis.instanceId);
  const settings = state.settings;
  switch (action.kind) {
    case 'raise-memory':
    case 'lower-memory': {
      if (!settings) return null;
      const current = instance?.memoryMb ?? settings.memoryMb;
      const total = state.info?.totalMemoryMb ?? 8192;
      const max = Math.max(2048, Math.floor((total * 0.75) / 512) * 512);
      const target = action.kind === 'raise-memory'
        ? Math.min(max, Math.max(current + 2048, 6144))
        : Math.max(2048, current > 4096 ? 4096 : current - 1024);
      if (target === current) {
        toast(action.kind === 'raise-memory'
          ? 'Mehr Arbeitsspeicher geht auf diesem PC nicht. Schließe andere Programme oder nimm weniger Mods und Shader.'
          : 'Weniger geht nicht sinnvoll – 2 GB sind das Minimum.', 'error');
        return null;
      }
      if (instance?.memoryMb != null) await api.updateInstance(instance.id, { memoryMb: target });
      else await saveSettings({ memoryMb: target });
      await reloadInstances();
      return `Auf ${formatGb(target)} gestellt`;
    }
    case 'reset-java':
      await saveSettings({ javaPath: '' });
      return 'Automatisches Java an';
    case 'use-opengl':
      await saveSettings({ graphicsApi: 'opengl' });
      return 'Grafik-API: OpenGL';
    case 'help':
      await api.openWebsite(`hilfe/${action.help ?? 'absturz'}`);
      return null;
    case 'shaders':
      close();
      showView('instances');
      openDetail(analysis.instanceId, 'shaders');
      return null;
    case 'disable-mod':
      if (!action.file) return null;
      await api.setContentEnabled(analysis.instanceId, 'mods', action.file, false);
      await reloadInstances();
      return 'Ausgeschaltet';
    case 'open-report':
      await api.openCrashReport(analysis.id);
      return null;
    case 'open-logs':
      await api.openFolder('logs', analysis.instanceId);
      return null;
    default:
      return null;
  }
}

function actionButton(analysis: CrashAnalysis, action: CrashAction, primary: boolean): HTMLElement {
  const finished = done.get(analysis.id)?.has(actionKey(action)) ?? false;
  const icon = { 'raise-memory': 'chip', 'lower-memory': 'chip', 'reset-java': 'cup', 'use-opengl': 'monitor', help: 'external', shaders: 'sparkles', 'disable-mod': 'cube', 'open-report': 'file', 'open-logs': 'folder' }[action.kind];
  const label = h('span', { text: finished ? `${action.label} ✓` : action.label });
  const button = h('button', { class: primary && !finished ? 'primary' : 'ghost', type: 'button' }, uiIcon(icon, 'btn-icon'), label) as HTMLButtonElement;
  button.disabled = finished;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await runAction(analysis, action);
      if (result) {
        if (!done.has(analysis.id)) done.set(analysis.id, new Set());
        done.get(analysis.id)!.add(actionKey(action));
        label.textContent = `${result} ✓`;
        button.className = 'ghost';
        toast(`${result}. Probier es mit „Erneut starten“.`, 'success');
        return;
      }
      button.disabled = false;
    } catch (error) {
      button.disabled = false;
      toast(errorMessage(error), 'error');
    }
  });
  return button;
}

function modal(...children: (Node | null)[]): HTMLElement {
  close();
  backdrop = h('div', { class: 'modal-backdrop crash-backdrop', onclick: (event: Event) => event.target === backdrop && close() },
    h('div', { class: 'modal crash-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'crash-title' }, ...children));
  document.body.append(backdrop);
  return backdrop;
}

function head(title: string, sub: string, success = false): HTMLElement {
  return h('div', { class: 'modal-head crash-head' },
    h('div', { class: `crash-head-icon${success ? ' ok' : ''}` }, uiIcon(success ? 'check' : 'warning')),
    h('div', { class: 'crash-head-text' },
      h('h3', { class: 'modal-title', id: 'crash-title', text: title }),
      h('p', { class: 'modal-sub', text: sub })),
    h('button', { class: 'icon-button', type: 'button', title: 'Schließen', onclick: close }, uiIcon('close')));
}

/** Dialog zur letzten Analyse (id: nur diese, sonst die jüngste) */
export async function showCrash(id?: string): Promise<void> {
  const analysis = await api.getLastCrash().catch(() => null);
  if (!analysis || (id && analysis.id !== id)) return;
  renderAnalysis(analysis);
}

function renderAnalysis(analysis: CrashAnalysis): void {
  const time = new Date(analysis.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const fixes = analysis.actions.filter((a) => a.kind !== 'open-report' && a.kind !== 'open-logs');
  const files = analysis.actions.filter((a) => a.kind === 'open-report' || a.kind === 'open-logs');
  const details = h('details', { class: 'crash-details' },
    h('summary', { text: 'Technische Details' }),
    h('dl', { class: 'crash-facts' },
      h('dt', { text: 'Fehlercode' }), h('dd', { text: analysis.exitCode === null ? '–' : String(analysis.exitCode) }),
      analysis.description ? h('dt', { text: 'Minecraft meldet' }) : null,
      analysis.description ? h('dd', { text: analysis.description }) : null,
      analysis.detail ? h('dt', { text: 'Fehler' }) : null,
      analysis.detail ? h('dd', { class: 'mono', text: analysis.detail }) : null,
      h('dt', { text: 'Dateien' }),
      h('dd', { text: [analysis.hasCrashReport ? 'Crash-Report' : null, analysis.hasJvmError ? 'JVM-Fehlerprotokoll' : null, 'Log'].filter(Boolean).join(', ') })),
    files.length ? h('div', { class: 'button-row' }, ...files.map((a) => actionButton(analysis, a, false))) : null);

  modal(
    head('Minecraft ist abgestürzt', `${analysis.instanceName} · ${time} Uhr`),
    h('div', { class: 'crash-cause' },
      h('div', { class: 'crash-cause-title', text: analysis.title }),
      h('p', { text: analysis.explanation }),
      analysis.suspects.length
        ? h('div', { class: 'crash-suspects' },
          h('span', { class: 'crash-suspects-label', text: analysis.suspects.length === 1 ? 'Beteiligter Mod' : 'Beteiligte Mods' }),
          ...analysis.suspects.map((m) => h('span', { class: 'tag', text: m.name })))
        : null),
    fixes.length
      ? h('div', { class: 'crash-actions' },
        h('div', { class: 'crash-section-title', text: 'Das kannst du tun' }),
        h('div', { class: 'button-row' }, ...fixes.map((a, i) => actionButton(analysis, a, i === 0))))
      : null,
    details,
    h('div', { class: 'modal-actions crash-footer' },
      h('button', { class: 'ghost', type: 'button', onclick: () => void copyReport(analysis) }, uiIcon('copy', 'btn-icon'), 'Bericht kopieren'),
      h('button', { class: 'ghost', type: 'button', onclick: () => void renderSend(analysis) }, uiIcon('send', 'btn-icon'), 'An den Support senden'),
      h('button', {
        class: 'primary',
        type: 'button',
        onclick: () => {
          close();
          void launchInstance(analysis.instanceId, showView);
        },
      }, uiIcon('play', 'btn-icon'), 'Erneut starten')));
}

async function copyReport(analysis: CrashAnalysis): Promise<void> {
  try {
    const preview = await api.getCrashPreview(analysis.id, '', true);
    const parts = [preview.message, ...preview.attachments.map((a) => `----- ${a.name} -----\n${a.text}`)];
    await navigator.clipboard.writeText(parts.join('\n\n'));
    toast('Bericht mit Log kopiert (Benutzerordner durch ~ ersetzt).', 'success');
  } catch (error) {
    toast(errorMessage(error), 'error');
  }
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('de-DE')} KB`;
}

/** Vorschau-Text: die ersten Zeilen */
function head200(text: string): string {
  const lines = text.split('\n');
  return lines.length > 200 ? `${lines.slice(0, 200).join('\n')}\n… (${lines.length - 200} weitere Zeilen)` : text;
}

async function renderSend(analysis: CrashAnalysis): Promise<void> {
  const note = h('textarea', { class: 'crash-note', rows: 3, maxlength: 800, placeholder: 'Was hast du gerade gemacht, als es passiert ist? (freiwillig)' }) as HTMLTextAreaElement;
  const counter = h('span', { class: 'crash-counter', text: '0 / 800' });
  const include = h('input', { type: 'checkbox', class: 'switch', checked: true }) as HTMLInputElement;
  const previewBox = h('div', { class: 'crash-preview' });
  const reasonBox = h('p', { class: 'crash-reason', hidden: true });
  const send = h('button', { class: 'primary', type: 'button' }, uiIcon('send', 'btn-icon'), 'Senden') as HTMLButtonElement;
  let preview: CrashReportPreview | null = null;

  const refresh = async () => {
    try {
      preview = await api.getCrashPreview(analysis.id, note.value, include.checked);
    } catch (error) {
      reasonBox.hidden = false;
      reasonBox.textContent = errorMessage(error);
      send.disabled = true;
      return;
    }
    send.disabled = !preview.canSend;
    reasonBox.hidden = preview.canSend;
    reasonBox.textContent = preview.reason ?? '';
    previewBox.textContent = '';
    previewBox.append(
      h('details', { class: 'crash-details' },
        h('summary', { text: `Das wird gesendet: „${preview.subject}“${preview.attachments.length ? ` mit ${preview.attachments.length} ${preview.attachments.length === 1 ? 'Anhang' : 'Anhängen'}` : ''}` }),
        h('pre', { class: 'crash-pre', text: preview.message }),
        ...preview.attachments.map((a) => h('details', { class: 'crash-attachment' },
          h('summary', { text: `${a.name} · ${formatSize(a.size)}` }),
          h('pre', { class: 'crash-pre', text: head200(a.text) })))));
  };
  let timer = 0;
  note.addEventListener('input', () => {
    counter.textContent = `${note.value.length} / 800`;
    clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 300);
  });
  include.addEventListener('change', () => void refresh());

  send.addEventListener('click', async () => {
    send.disabled = true;
    send.lastChild!.textContent = 'Wird gesendet …';
    try {
      const result = await api.sendCrashReport(analysis.id, note.value, include.checked);
      renderSent(analysis, result);
    } catch (error) {
      send.disabled = false;
      send.lastChild!.textContent = 'Senden';
      toast(errorMessage(error), 'error');
    }
  });

  modal(
    head('An den Support senden', 'Das HeldixClient-Team schaut sich den Absturz an und antwortet dir.'),
    h('label', { class: 'crash-field' }, h('span', { text: 'Notiz' }), note, counter),
    h('label', { class: 'toggle-row crash-include' },
      h('span', {}, 'Crash-Report und Log anhängen', h('small', { class: 'toggle-sub', text: 'Damit findet das Team die Ursache meist sofort.' })),
      include),
    previewBox,
    h('p', { class: 'hint small crash-privacy', text: 'Vor dem Senden ersetzt der Launcher deinen Benutzerordner durch ~ und entfernt Zugangsdaten. Gesendet wird nur, was oben steht – an den Heldix-Dienst, als Support-Anfrage unter deinem Microsoft-Konto.' }),
    reasonBox,
    h('div', { class: 'modal-actions crash-footer' },
      h('button', { class: 'ghost', type: 'button', onclick: () => renderAnalysis(analysis) }, uiIcon('chevron-left', 'btn-icon'), 'Zurück'),
      send));
  await refresh();
  note.focus();
}

function renderSent(analysis: CrashAnalysis, result: { ticketId: number; attached: number; attachmentError: string | null }): void {
  modal(
    head('Gesendet', `Support-Anfrage #${result.ticketId}`, true),
    h('div', { class: 'crash-cause crash-sent' },
      h('div', { class: 'crash-cause-title', text: 'Danke! Das Team schaut sich den Absturz an.' }),
      h('p', { text: 'Die Antwort bekommst du auf heldixclient.com unter Konto → Support und als Einblendung im Spiel.' }),
      result.attachmentError
        ? h('p', { class: 'crash-reason', text: `Die Anhänge konnten nicht hochgeladen werden (${result.attachmentError}). Die Anfrage selbst ist angekommen.` })
        : result.attached > 0 ? h('p', { class: 'hint small', text: `${result.attached} ${result.attached === 1 ? 'Datei angehängt' : 'Dateien angehängt'}.` }) : null),
    h('div', { class: 'modal-actions crash-footer' },
      h('button', {
        class: 'ghost',
        type: 'button',
        onclick: () => void api.openWebAccount('support').catch((error: unknown) => toast(errorMessage(error), 'error')),
      }, uiIcon('external', 'btn-icon'), 'Auf heldixclient.com ansehen'),
      h('button', { class: 'primary', type: 'button', onclick: close }, 'Fertig')));
  void analysis;
}
