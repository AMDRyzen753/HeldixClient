// HeldixClient – Webseite: Konto → Privatsphäre → „Voice Chat“ (Heldix-Dienst ab 1.13.0, Voice-Moderation).
//
// GET /v1/voice/me → { rules: { version, accepted, acceptedAt, required }, clips, ban: { reason, at, until, message,
// appeal } | null, bans: [{ reason, at, until, liftedAt }] }
// - Zustimmung zu den Voice-Regeln: Version und Datum, Link /voice-regeln, „Zustimmung widerrufen“
//   (DELETE /v1/voice/rules/accept – danach ist Voice aus, bis man erneut zustimmt). Bei required: Hinweis und Dialog
//   mit dem Regeltext (wie im Browser-Voice), danach POST /v1/voice/rules/accept { version } (409 voice-rules-version →
//   neu laden).
// - Aktive Voice-Sperre mit Grund, Ende und Einspruch (Support-Anfrage, Kategorie „Konto“) und der Verlauf.
// Ohne innerHTML; Texte vom Dienst landen nur als Text im Dokument.
import { busy, confirmAction, formatDate, formatDateTime, h, icon, openDialog, showError, toast, uid } from './app-common.js';
import { clipMinutes, loadVoiceRules, parseRules, renderRules } from './voice-regeln.js';

const fill = (element, ...nodes) => element.replaceChildren(...nodes.flat(Infinity).filter((node) => node !== null && node !== undefined && node !== false));

export function initVoiceAccount({ call }) {
  const box = document.getElementById('voice-konto');
  const local = { data: null, loading: null };

  async function load() {
    if (!box) return;
    if (local.loading) return local.loading;
    local.loading = (async () => {
      try {
        local.data = await call('GET', '/v1/voice/me');
      } catch (error) {
        // Älterer Dienst ohne Voice-Moderation: der Bereich bleibt weg
        if (error.status === 404) local.data = null;
        else if (error.status !== 401) showError(error);
      } finally {
        local.loading = null;
      }
      render();
    })();
    return local.loading;
  }

  async function accept(button) {
    const rules = await loadVoiceRules();
    if (!rules?.published) {
      toast('Gerade sind keine Voice-Regeln veröffentlicht.');
      return load();
    }
    const minutes = clipMinutes(rules.limits);
    const textId = uid('voice-regeln-text');
    const ok = await openDialog({
      title: 'Voice-Regeln lesen und annehmen',
      body: [
        h('p', { text: 'Nur wenn du die Voice-Regeln annimmst, kannst du den Voice Chat nutzen – im Spiel und im Browser.' }),
        h('p', { class: 'notice-line notice-line--warn' }, icon('warning'), h('span', { text: rules.clips ? `Meldungen können die letzten ${minutes} Minuten deiner Stimme enthalten – verschlüsselt, nur für das Team, gelöscht ${rules.limits.deleteAfterDoneDays} Tage nach Abschluss der Meldung.` : `Aufnahmen beim Melden sind gerade aus. Schaltet das Team sie ein, können Meldungen die letzten ${minutes} Minuten deiner Stimme enthalten.` })),
        h('div', { class: 'voice-rules-preview prose voice-rules-preview--dialog', id: textId, tabindex: '0', role: 'region', 'aria-label': 'Text der Voice-Regeln' }, renderRules(parseRules(rules.text), { level: 3 }).nodes),
        h('p', { class: 'hint' }, `Version ${rules.version}${rules.publishedAt ? ` vom ${formatDate(rules.publishedAt)}` : ''} · `, h('a', { href: '/voice-regeln', target: '_blank', rel: 'noopener' }, 'Voice-Regeln in neuem Tab')),
      ],
      confirmLabel: 'Annehmen',
      cancelLabel: 'Ablehnen',
      focus: `#${textId}`,
      onConfirm: async () => {
        try {
          local.data = await call('POST', '/v1/voice/rules/accept', { version: rules.version });
        } catch (error) {
          if (error.status === 409 && error.code === 'voice-rules-version') {
            error.message = 'Die Voice-Regeln haben sich gerade geändert. Bitte schließ den Dialog und lies die neue Fassung.';
          }
          throw error;
        }
      },
    });
    void button;
    if (!ok) return load();
    toast('Danke! Du hast die Voice-Regeln angenommen.', 'success');
    render();
  }

  async function withdraw(button) {
    const ok = await confirmAction({ title: 'Zustimmung zu den Voice-Regeln widerrufen?', text: 'Danach ist der Voice Chat für dich aus, bis du erneut zustimmst. Eine laufende Voice-Verbindung wird getrennt.', confirmLabel: 'Widerrufen', danger: true });
    if (!ok) return;
    try {
      local.data = await busy(button, () => call('DELETE', '/v1/voice/rules/accept'));
      toast('Zustimmung widerrufen. Der Voice Chat ist für dich aus.');
      render();
    } catch (error) {
      showError(error);
    }
  }

  function render() {
    if (!box) return;
    const data = local.data;
    if (!data || typeof data !== 'object') {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const rules = data.rules ?? {};
    const ban = data.ban ?? null;
    const history = (Array.isArray(data.bans) ? data.bans : []).filter((entry) => !ban || entry.at !== ban.at);
    const consent = !rules.version
      ? h('p', { class: 'small text-2', id: 'voice-zustimmung', text: 'Gerade sind keine Voice-Regeln veröffentlicht – du musst nichts annehmen.' })
      : rules.required
        ? h(
            'div',
            { class: 'notice-line notice-line--accent', id: 'voice-zustimmung' },
            icon('info'),
            h('span', { text: rules.accepted ? `Die Voice-Regeln haben sich geändert (Version ${rules.version}). Bitte die neue Fassung annehmen – bis dahin ist der Voice Chat für dich aus.` : 'Bitte die Voice-Regeln annehmen – ohne Zustimmung kannst du den Voice Chat nicht nutzen.' }),
            h('button', { type: 'button', class: 'btn btn--primary btn--sm', id: 'voice-annehmen', onClick: (event) => accept(event.currentTarget) }, icon('check'), 'Voice-Regeln lesen …'),
          )
        : h(
            'div',
            { class: 'voice-consent', id: 'voice-zustimmung' },
            h('p', { class: 'small' }, icon('check'), ' Du hast die ', h('a', { href: '/voice-regeln' }, 'Voice-Regeln'), ` in Version ${rules.accepted} am ${formatDateTime(rules.acceptedAt)} angenommen.`),
            h('button', { type: 'button', class: 'btn btn--ghost btn--sm', id: 'voice-widerrufen', onClick: (event) => withdraw(event.currentTarget) }, icon('close'), 'Zustimmung widerrufen'),
          );
    fill(
      box,
      h('div', { class: 'card__head' }, h('span', { class: 'icon-tile icon-tile--voice' }, icon('mic')), h('div', null, h('h2', { class: 'card__title', id: 'voice-konto-titel', text: 'Voice Chat' }), h('p', { class: 'tiny text-3', text: 'Deine Zustimmung zu den Voice-Regeln und Voice-Sperren durch das Team.' }))),
      ban
        ? h(
            'div',
            { class: 'ban-box voice-ban', id: 'voice-sperre', role: 'status' },
            h('p', { class: 'ban-title' }, icon('mic-off'), h('strong', { text: ban.until ? `Voice gesperrt bis ${formatDateTime(ban.until)}` : 'Dauerhaft vom Voice Chat gesperrt' })),
            h('p', { class: 'small', text: ban.message || `Grund: ${ban.reason}` }),
            h('p', { class: 'small text-2', text: ban.appeal || 'Einspruch: Support-Anfrage (Kategorie „Konto“).' }),
            h('a', { class: 'btn btn--secondary btn--sm', id: 'voice-einspruch', href: '#reiter=support&neu=konto', dataset: { goto: 'support', params: JSON.stringify({ neu: 'konto', betreff: 'Einspruch gegen meine Voice-Sperre' }) } }, icon('chat'), 'Support-Anfrage stellen'),
          )
        : h('p', { class: 'small text-2', id: 'voice-keine-sperre' }, icon('check'), ' Keine Voice-Sperre.'),
      consent,
      data.clips && rules.version ? h('p', { class: 'tiny text-3', text: 'Aufnahmen beim Melden sind gerade eingeschaltet: Meldet dich jemand im Spiel, kann seine Meldung die letzten Minuten deiner Stimme enthalten (siehe Voice-Regeln).' }) : null,
      history.length
        ? h(
            'details',
            { class: 'voice-history' },
            h('summary', null, `Frühere Voice-Sperren (${history.length})`),
            h('ul', { class: 'plain-list', id: 'voice-sperren-verlauf' }, history.map((entry) => h('li', { text: `${formatDate(entry.at)}: ${entry.reason} – ${entry.liftedAt ? `aufgehoben am ${formatDate(entry.liftedAt)}` : entry.until ? `bis ${formatDateTime(entry.until)}` : 'dauerhaft'}` }))),
          )
        : null,
    );
  }

  return { load, render };
}
