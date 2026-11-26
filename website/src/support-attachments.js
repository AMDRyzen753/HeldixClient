// HeldixClient – Webseite: Anhänge an Support-Anfragen (Absturzberichte und Logs, die der Launcher auf Wunsch des
// Spielers mitschickt). Konto: Liste mit Name, Größe, Datum und Download. Team-Bereich: dazu eine Vorschau der ersten
// 200 Zeilen in einem scrollbaren Kasten und „Ganze Datei laden“. Der Text kommt per fetch und landet nur als Text
// (textContent) im Dokument – nie als HTML.
import { api, formatBytes, formatDateTime, h, icon, timeEl } from './app-common.js';

const PREVIEW_LINES = 200;
const NUMBER = new Intl.NumberFormat('de-DE');
/** Vorschau-Texte dieser Sitzung: `${ticket}:${anhang}` → { text, error } (damit das Nachfragen nicht neu lädt). */
const cache = new Map();

/** Anhänge vom Dienst → [{ id, name, size, at }] (unbrauchbare fallen weg). */
export function normalizeAttachments(list) {
  return (Array.isArray(list) ? list : [])
    .filter((entry) => entry && (typeof entry.id === 'string' || typeof entry.id === 'number'))
    .map((entry) => ({
      id: String(entry.id),
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 120) : 'anhang.txt',
      size: typeof entry.size === 'number' && Number.isFinite(entry.size) ? entry.size : null,
      at: typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : null,
    }));
}

const safeFileName = (name) => name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');

/**
 * Liste der Anhänge. base: '/v1/support' (Spieler) oder '/v1/team/support' (Team). preview: Vorschau laden.
 * onError(error): Fehler beim Laden der Vorschau (z. B. abgelaufene Anmeldung) an die Seite melden.
 */
export function attachmentList(ticketId, attachments, { base, preview = false, onError } = {}) {
  if (!attachments.length) return null;
  return h(
    'div',
    { class: 'ticket-attachments' },
    h('h3', { class: 'list-title', text: attachments.length === 1 ? 'Anhang' : `Anhänge (${attachments.length})` }),
    h(
      'ul',
      { class: 'attachment-list' },
      attachments.map((attachment) => {
        const url = `/api${base}/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachment.id)}`;
        const item = h(
          'li',
          { class: 'attachment', dataset: { id: attachment.id } },
          h(
            'div',
            { class: 'attachment-head' },
            h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon('file')),
            h(
              'div',
              { class: 'attachment-main' },
              h('strong', { class: 'attachment-name', text: attachment.name }),
              h('span', { class: 'row-meta' }, [attachment.size !== null ? formatBytes(attachment.size) : null, attachment.at ? timeEl(attachment.at, formatDateTime(attachment.at)) : null].filter(Boolean).flatMap((part, index) => (index ? [' · ', part] : [part]))),
            ),
            h('a', { class: 'button tiny ghost', href: url, download: safeFileName(attachment.name), 'aria-label': `${attachment.name} herunterladen` }, icon('download'), h('span', { class: 'label', text: 'Herunterladen' })),
          ),
        );
        if (preview) item.append(previewBox(`${ticketId}:${attachment.id}`, base, ticketId, attachment, onError));
        return item;
      }),
    ),
  );
}

function previewBox(key, base, ticketId, attachment, onError) {
  const code = h('code');
  const pre = h('pre', { class: 'attachment-preview', tabindex: '0', 'aria-label': `Vorschau von ${attachment.name}` }, code);
  const status = h('p', { class: 'hint attachment-status' });
  const more = h('button', { type: 'button', class: 'button tiny ghost', hidden: true }, icon('download'), 'Ganze Datei laden');
  const box = h('div', { class: 'attachment-preview-box' }, pre, h('div', { class: 'attachment-preview-foot' }, status, more));

  const show = (text, full) => {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const total = lines.length;
    const shown = full ? lines : lines.slice(0, PREVIEW_LINES);
    code.textContent = shown.join('\n');
    if (!full && total > PREVIEW_LINES) {
      status.textContent = `Die ersten ${PREVIEW_LINES} von ${NUMBER.format(total)} Zeilen.`;
      more.hidden = false;
    } else {
      status.textContent = total === 1 ? '1 Zeile.' : `${NUMBER.format(total)} Zeilen.`;
      more.hidden = true;
    }
    box.dataset.zeilen = String(shown.length);
  };

  const load = async () => {
    const cached = cache.get(key);
    if (cached?.text !== undefined) return cached.text;
    const response = await api('GET', `${base}/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachment.id)}`, undefined, { raw: true });
    const text = await response.text();
    cache.set(key, { text });
    return text;
  };

  more.addEventListener('click', async () => {
    try {
      show(await load(), true);
      pre.focus({ preventScroll: true });
    } catch (error) {
      status.textContent = `Die Datei lässt sich nicht laden: ${error.message}`;
      onError?.(error);
    }
  });

  status.textContent = 'Vorschau wird geladen …';
  load()
    .then((text) => show(text, false))
    .catch((error) => {
      code.textContent = '';
      pre.hidden = true;
      status.textContent = `Keine Vorschau: ${error.message}`;
      onError?.(error);
    });
  return box;
}
