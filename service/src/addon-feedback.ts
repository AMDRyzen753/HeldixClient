// Rückmeldungen zu Addons im Store: Bewertungen (1–5 Sterne, eine pro Spieler und Addon) und Meldungen an das Team
// (Schadcode, kaputt, unangemessen, Urheberrecht, Sonstiges). Das Team bearbeitet Meldungen im Team-Bereich.
import type { Addons } from './addons';
import { ratingView } from './addons';
import { DELETED_OWNER, type AddonReportRow, type AddonReportStatus, type Store, type UserRow } from './db';
import { HttpError } from './http';
import { writeAudit, type Actor } from './team';
import { checkText } from './validate';

export const ADDON_REPORT_REASONS = ['malware', 'broken', 'inappropriate', 'copyright', 'other'] as const;
export type AddonReportReason = (typeof ADDON_REPORT_REASONS)[number];
/** Höchstlänge der Notiz einer Meldung (Unicode-Zeichen, eine Zeile). */
export const MAX_ADDON_REPORT_NOTE = 500;

export interface AddonFeedbackLimits {
  /** Höchstens so viele Meldungen zu Addons pro Spieler und Zeitraum. */
  reportsPerWindow: number;
  windowMs: number;
}

export class AddonFeedback {
  constructor(
    private readonly store: Store,
    private readonly addons: Addons,
    private readonly limits: AddonFeedbackLimits,
    private readonly log: (line: string) => void,
  ) {}

  private summary(id: string, user: UserRow) {
    return { myRating: this.store.getAddonRating(id, user.uuid), ...ratingView(this.store.addonRatingSummary(id)) };
  }

  // ---------- Bewertungen ----------

  /** `GET /v1/addons/<id>/rating` → `{ myRating, average, count }` */
  rating(user: UserRow, id: string) {
    this.addons.requireVisible(id);
    return this.summary(id, user);
  }

  /** `PUT /v1/addons/<id>/rating` mit `{ stars: 1–5 }`; eigene Addons: 403. */
  rate(user: UserRow, id: string, input: Record<string, unknown>) {
    const addon = this.addons.requireVisible(id);
    const { stars } = input;
    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      throw new HttpError(400, '„stars“ muss eine ganze Zahl von 1 bis 5 sein.');
    }
    if (addon.owner === user.uuid) throw new HttpError(403, 'Eigene Addons kannst du nicht bewerten.');
    this.store.setAddonRating(id, user.uuid, stars, Date.now());
    return this.summary(id, user);
  }

  /** `DELETE /v1/addons/<id>/rating`: eigene Bewertung zurücknehmen. */
  unrate(user: UserRow, id: string) {
    this.addons.requireVisible(id);
    this.store.deleteAddonRating(id, user.uuid);
    return this.summary(id, user);
  }

  /** `GET /v1/me/addon-ratings`: alle eigenen Bewertungen auf einmal (`{ ratings: { "<id>": 1–5 } }`). */
  myRatings(user: UserRow) {
    const ratings: Record<string, number> = {};
    for (const r of this.store.addonRatingsBy(user.uuid)) ratings[r.addon] = r.stars;
    return { ratings };
  }

  // ---------- Meldungen ----------

  /**
   * `POST /v1/addons/<id>/reports` mit `{ reason, note? }`. Eine offene Meldung pro Spieler und Addon: Weitere
   * antworten genauso, ohne eine zweite anzulegen.
   */
  report(user: UserRow, id: string, input: Record<string, unknown>): { reported: true } {
    const addon = this.addons.requireVisible(id);
    const { reason } = input;
    if (typeof reason !== 'string' || !(ADDON_REPORT_REASONS as readonly string[]).includes(reason)) {
      throw new HttpError(400, `Ungültiger Grund (erlaubt: ${ADDON_REPORT_REASONS.join(', ')}).`);
    }
    let note = '';
    if (input.note !== undefined && input.note !== null) {
      const checked = checkText(input.note, MAX_ADDON_REPORT_NOTE, true);
      if ('problem' in checked) {
        throw new HttpError(
          400,
          checked.problem === 'long'
            ? `Die Notiz ist zu lang (höchstens ${MAX_ADDON_REPORT_NOTE} Zeichen).`
            : checked.problem === 'type'
              ? '„note“ muss ein Text sein.'
              : 'Die Notiz enthält Zeichen, die nicht erlaubt sind (z. B. Zeilenumbrüche).',
        );
      }
      note = checked.text;
    }
    if (addon.owner === user.uuid) throw new HttpError(400, 'Dein eigenes Addon kannst du nicht melden.');
    if (this.store.hasOpenAddonReport(user.uuid, id)) return { reported: true };
    const now = Date.now();
    const recent = this.store.addonReportsSince(user.uuid, now - this.limits.windowMs);
    if (recent.count >= this.limits.reportsPerWindow) {
      const until = (recent.oldest ?? now) + this.limits.windowMs;
      throw new HttpError(429, `Du hast in letzter Zeit schon ${this.limits.reportsPerWindow} Addons gemeldet. Versuche es später noch einmal.`, {
        'Retry-After': String(Math.max(1, Math.ceil((until - now) / 1000))),
      });
    }
    const reportId = this.store.insertAddonReport({ addon: id, reporter: user.uuid, reporterName: user.name, reason, note, at: now });
    this.log(`Neue Meldung zum Addon ${id} (#${reportId}, Grund: ${reason}). Ansehen im Team-Bereich unter Addons → Meldungen.`);
    return { reported: true };
  }

  /** Meldung für das Team: mit Addon (Name, sichtbar, offiziell, Besitzer) und Meldendem. */
  private reportView(report: AddonReportRow) {
    const addon = this.store.getAddon(report.addon);
    let name = report.addon;
    if (addon) {
      try {
        const [latest] = this.store.addonVersionsOf(addon.id).sort((a, b) => b.publishedAt - a.publishedAt);
        const parsed = latest ? (JSON.parse(latest.manifest) as { name?: unknown }) : {};
        if (typeof parsed.name === 'string') name = parsed.name;
      } catch {
        // Name bleibt die ID
      }
    }
    const owner =
      !addon || addon.owner === null
        ? null
        : addon.owner === DELETED_OWNER
          ? { uuid: null, name: 'Gelöschter Spieler' }
          : { uuid: addon.owner, name: this.store.getUser(addon.owner)?.name ?? '' };
    return {
      id: report.id,
      at: report.at,
      status: report.status,
      reason: report.reason,
      note: report.note,
      addon: { id: report.addon, name, exists: addon !== undefined, hidden: addon?.hidden ?? false, official: addon !== undefined && addon.owner === null, owner },
      reporter: { uuid: report.reporter, name: report.reporterName },
      doneAt: report.doneAt,
      doneBy: report.doneBy,
    };
  }

  /** `GET /v1/team/addon-reports?status=open|done|all` (Standard open), neueste zuerst. */
  teamReports(status: string | null) {
    const filter = status ?? 'open';
    if (filter !== 'open' && filter !== 'done' && filter !== 'all') throw new HttpError(400, '„status“ muss open, done oder all sein.');
    return { reports: this.store.listAddonReports(filter as AddonReportStatus | 'all').map((r) => this.reportView(r)) };
  }

  /** `POST /v1/team/addon-reports/<id>/done` (schon erledigt: unverändert). */
  reportDone(actor: Actor, id: number) {
    const report = this.store.getAddonReport(id);
    if (!report) throw new HttpError(404, 'Diese Meldung gibt es nicht (mehr).');
    if (this.store.markAddonReportDone(id, Date.now(), actor.name)) {
      writeAudit(this.store, actor, 'addon-report.done', `Addon-Meldung ${id}`, report.addon);
    }
    return { report: this.reportView(this.store.getAddonReport(id)!) };
  }

  /** Für die Datenauskunft: eigene Bewertungen und Meldungen. */
  exportFor(user: UserRow) {
    return {
      ratings: this.store.addonRatingsBy(user.uuid),
      reports: this.store.addonReportsBy(user.uuid).map((r) => ({
        id: r.id,
        addon: r.addon,
        reason: r.reason,
        note: r.note,
        at: r.at,
        status: r.status,
        doneAt: r.doneAt,
      })),
    };
  }
}
