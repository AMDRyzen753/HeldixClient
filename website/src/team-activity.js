// HeldixClient – Webseite: Team-Bereich → Aktivität (Glocke in der Kopfzeile, app-shell.js setActivity).
//
// Zeigt, was seit dem letzten Blick dazugekommen ist: neue Meldungen, neue Support-Anfragen und neue Antworten von
// Spielern, neue Addon-Einreichungen und Addon-Meldungen. Die Daten kommen aus dem Nachfragen, das team.js ohnehin
// alle 30 Sekunden macht – die Glocke stellt keine eigenen Anfragen.
//
// „Gesehen“ merkt sich die Seite je Team-Mitglied im localStorage dieses Browsers (nur ein Zeitpunkt, keine Inhalte),
// erst wenn die Glocke geöffnet wird. Geht localStorage nicht (privates Fenster, gesperrt), gilt es für diesen Tab.
// Noch nie geöffnet: Neu ist alles aus den letzten 7 Tagen.
import { reasonLabel } from './app-common.js';
import { addonReasonLabel } from './addon-common.js';

const KEY_PREFIX = 'heldix-team-gesehen:';
const FIRST_WINDOW_MS = 7 * 24 * 3600 * 1000;
const MAX_ITEMS = 15;
/** Eine Anfrage, deren letzte Nachricht so kurz nach dem Anlegen kam, ist „neu“ (sonst: Spieler hat geantwortet). */
const NEW_TICKET_MS = 60_000;

const memory = new Map();

function readSeen(key) {
  try {
    const value = Number(localStorage.getItem(key));
    if (Number.isFinite(value) && value > 0) return value;
  } catch {
    // kein localStorage: nur für diesen Tab
  }
  return memory.get(key) ?? null;
}

function writeSeen(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // egal – dann eben nur für diesen Tab
  }
}

/** Einträge der Glocke aus den nachgefragten Listen (neueste zuerst). */
export function activityItems(live) {
  const items = [];
  for (const report of live.reports ?? []) {
    items.push({
      id: `meldung:${report.id}`,
      title: `Neue Meldung #${report.id}`,
      text: `${report.reported?.name ?? '?'} gemeldet von ${report.reporter?.name ?? '?'} · ${reasonLabel(report.reason)}`,
      at: report.at,
      icon: 'flag',
      target: { section: 'meldungen', params: { meldung: report.id } },
    });
  }
  for (const ticket of live.tickets ?? []) {
    if (!ticket.unread || ticket.status === 'closed') continue;
    const at = ticket.updatedAt ?? ticket.at;
    const fresh = typeof ticket.at === 'number' && typeof at === 'number' && at - ticket.at < NEW_TICKET_MS;
    items.push({
      id: `anfrage:${ticket.id}:${at}`,
      title: fresh ? 'Neue Support-Anfrage' : `${ticket.player?.name ?? 'Spieler'} hat geantwortet`,
      text: `#${ticket.id} · ${ticket.subject}${fresh ? ` · von ${ticket.player?.name ?? '?'}` : ''}`,
      at,
      icon: 'chat',
      target: { section: 'support', params: { anfrage: ticket.id } },
    });
  }
  for (const sub of live.submissions ?? []) {
    items.push({
      id: `einreichung:${sub.id}`,
      title: 'Neue Addon-Einreichung',
      text: `${sub.name || sub.addonId} ${sub.version} von ${sub.submitter?.name ?? '?'}${sub.access?.access === 'minecraft' ? ' · greift in Minecraft ein' : ''}`,
      at: sub.submittedAt,
      icon: 'addons',
      target: { section: 'addons', params: { einreichung: sub.id } },
    });
  }
  if (!live.addonReportsForbidden) {
    for (const report of live.addonReports ?? []) {
      items.push({
        id: `addon-meldung:${report.id}`,
        title: `Addon-Meldung: ${report.addonName || report.addonId || '?'}`,
        text: `${addonReasonLabel(report.reason)} · von ${report.reporter?.name ?? '?'}`,
        at: report.at,
        icon: 'warning',
        target: { section: 'addons', params: { unterreiter: 'meldungen' } },
      });
    }
  }
  return items.filter((item) => typeof item.at === 'number' && Number.isFinite(item.at)).sort((a, b) => b.at - a.at);
}

/** shell: Rahmen (Glocke). „Gesehen“ gilt je Team-Mitglied (start(me)). */
export function initTeamActivity({ shell }) {
  let key = null;
  let seenAt = null; // gilt für die Anzeige
  let pendingSeen = null; // beim Öffnen gemerkt, gilt nach dem Schließen
  let live = null;
  let active = false;

  function render() {
    if (!active || !live) return;
    const items = activityItems(live).slice(0, MAX_ITEMS);
    const since = seenAt ?? Date.now() - FIRST_WINDOW_MS;
    shell.setActivity(items.map((item) => ({ ...item, unread: item.at > since })));
  }

  shell.onActivity((event) => {
    if (!active || event.type !== 'open') return;
    // Server- und Browseruhr können abweichen: nie früher als der neueste Eintrag
    const newest = live ? Math.max(0, ...activityItems(live).map((item) => item.at)) : 0;
    pendingSeen = Math.max(Date.now(), newest);
    writeSeen(key, pendingSeen);
  });

  // Erst nach dem Schließen gilt „gesehen“: Solange die Liste offen ist, bleiben die neuen Einträge markiert.
  const panel = document.getElementById('shell-aktivitaet');
  if (panel) {
    new MutationObserver(() => {
      if (panel.hidden && pendingSeen !== null) {
        seenAt = pendingSeen;
        pendingSeen = null;
        render();
      }
    }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  }

  return {
    /** Team-Bereich offen (nach der Zwei-Faktor-Abfrage). */
    start(me) {
      key = `${KEY_PREFIX}${me?.uuid ?? 'unbekannt'}`;
      seenAt = readSeen(key);
      pendingSeen = null;
      active = true;
      if (live) render();
      else shell.setActivity([]);
    },
    /** Neue Daten aus dem Nachfragen. */
    update(next) {
      live = next;
      render();
    },
    /** Team-Bereich verlassen: Glocke weg. */
    stop() {
      active = false;
      live = null;
      shell.setActivity(null);
    },
  };
}
