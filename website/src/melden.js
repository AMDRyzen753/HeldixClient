// HeldixClient – Webseite: „Melden“ auf öffentlichen Seiten (geteiltes Setup, öffentliches Spielerprofil).
//
// Die Meldung landet in den Meldungen des Teams (dieselben Gründe wie bei Spieler-Meldungen: spam, harassment,
// inappropriate, other; dazu eine kurze Notiz). Melden geht nur angemeldet – so kann das Team Missbrauch der Meldungen
// erkennen. Der Gemeldete erfährt nicht, wer gemeldet hat.
import { h, openDialog, REPORT_REASONS, uid } from './app-common.js';

const MAX_NOTE = 300;

/**
 * Dialog „… melden“. send({ reason, note }) schickt die Meldung (darf werfen: der Dialog zeigt den Fehler).
 * Ergebnis: true (gesendet), false (abgebrochen) oder 'abgemeldet' (send meldete 401).
 */
export async function reportDialog({ title, intro, send }) {
  const ids = { reason: uid('melden-grund'), note: uid('melden-notiz') };
  const reason = h('select', { class: 'select input', id: ids.reason }, REPORT_REASONS.map(([value, label]) => h('option', { value }, label)));
  const note = h('input', { class: 'input', id: ids.note, maxlength: String(MAX_NOTE), autocomplete: 'off', placeholder: 'Was stimmt nicht? (optional)' });
  let result = false;
  const ok = await openDialog({
    title,
    body: [
      h('p', { class: 'small text-2', text: intro }),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.reason, text: 'Grund' }), reason),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: ids.note, text: `Notiz (eine Zeile, höchstens ${MAX_NOTE} Zeichen)` }), note),
    ],
    confirmLabel: 'Melden',
    danger: true,
    onConfirm: async () => {
      try {
        const text = note.value.replace(/\s+/g, ' ').trim();
        await send({ reason: reason.value, note: text || undefined });
        result = true;
      } catch (error) {
        if (error?.status !== 401) throw error;
        result = 'abgemeldet';
      }
    },
  });
  return ok ? result : false;
}
