// Addons von Spielern: Jeder angemeldete Spieler reicht ein (Entwurf → JAR → Store-Angaben → Screenshots → zur
// Prüfung), das Team prüft im Team-Bereich. Freigeben heißt signieren: Ein Admin signiert im Browser genau das
// Manifest, das der Dienst für die Einreichung erzeugt hat (`official: false`, `author` = Einreicher); der Dienst
// prüft die Signatur mit dem öffentlichen Update-Schlüssel und veröffentlicht dann wie bei offiziellen Addons.
// Der Dienst hat nie den privaten Schlüssel. JARs werden nur gelesen (ZIP-Inhaltsverzeichnis, Konstanten), nie ausgeführt.
import { randomBytes, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import {
  ADDON_CATEGORIES,
  ADDON_PLATFORMS,
  checkAddonManifest,
  defaultLoaders,
  ICON_RE,
  ID_TAKEN,
  MAX_ADDON_MANIFEST_BYTES,
  MAX_SCREENSHOTS,
  type Addons,
} from './addons';
import type { AddonScreenshot, Store, SubmissionRow, SubmissionStatus, UserRow } from './db';
import { HttpError } from './http';
import { IMAGE_CONTENT_TYPES, IMAGE_EXTENSIONS, imageInfo } from './images';
import type { RateLimiter, Slots } from './limits';
import type { Realtime } from './realtime';
import { TEAM_AUTHOR } from './support';
import { playerLabel, textError, writeAudit, type Actor } from './team';
import { checkUploadLength, receiveFile, resolveInDir, sendFile } from './updates';
import { checkMultilineText, checkText } from './validate';
import { inspectAddonJar, ZipProblem } from './zip';

/** Höchstens so viele Entwürfe und so viele wartende Einreichungen je Spieler. */
export const MAX_DRAFTS = 10;
export const MAX_PENDING = 3;
/** Screenshots: höchstens 2 MiB, von 320×180 bis 3840×2160. */
export const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
export const MIN_SCREENSHOT = { width: 320, height: 180 };
export const MAX_SCREENSHOT = { width: 3840, height: 2160 };
/** Körper von POST/PATCH (lange Beschreibung und „Was ist neu“ passen nicht in 16 KB). */
export const SUBMISSION_BODY_LIMIT = 64 * 1024;
/** Höchstlänge der Begründung beim Ablehnen. */
export const MAX_REVIEW_NOTE = 1000;

/** 12 Zufallsbytes als base64url */
const SID_RE = /^[A-Za-z0-9_-]{16}$/;
const SCREENSHOT_NAME_RE = /^[A-Za-z0-9_-]{16}-[0-9a-f]{16}\.(?:png|jpg)$/;
/** Reste (abgebrochene Uploads, nicht mehr verwendete Dateien) erst nach dieser Zeit löschen. */
const ORPHAN_GRACE_MS = 10 * 60_000;

const NO_SUCH_SUBMISSION = 'Diese Einreichung gibt es nicht.';
const BUSY = 'Mit dieser Einreichung passiert gerade schon etwas (Hochladen oder Prüfen). Bitte kurz warten.';
const NO_KEY = 'Auf diesem Server ist kein Update-Schlüssel eingerichtet. Einreichungen lassen sich hier nicht freigeben.';
const CONTENT_TYPE_JAR = 'application/java-archive';

export interface SubmissionOptions {
  /** Größte JAR (50 MiB). */
  maxJarBytes: number;
  uploadIdleTimeoutMs: number;
  /** Uploads (JAR und Screenshots) pro Spieler und Zeitraum. */
  uploadLimiter: RateLimiter;
  /** Gleichzeitige Uploads von Spielern insgesamt. */
  uploadSlots: Slots;
  /** Gleichzeitig geprüfte JARs (die Prüfung liest die ganze Datei in den Speicher). */
  inspectSlots: Slots;
  /** Öffentlicher Update-Schlüssel; ohne: Freigeben geht nicht (503). */
  updateKey: KeyObject | null;
}

interface StoreFields {
  name: string;
  summary: string;
  description: string;
  category: string;
  icon: string;
  platforms: string[];
  notes: string[];
}

/** Store-Angaben aus dem Körper (nur die mitgeschickten Felder). Texte werden getrimmt, sonst 400 mit Hinweis. */
function readStoreFields(input: Record<string, unknown>): Partial<StoreFields> {
  const fields: Partial<StoreFields> = {};
  for (const [key, max] of [
    ['name', 40],
    ['summary', 200],
  ] as const) {
    if (!Object.hasOwn(input, key)) continue;
    const checked = checkText(input[key], max, true);
    if ('problem' in checked) throw new HttpError(400, textError(key, max, checked.problem));
    fields[key] = checked.text;
  }
  if (Object.hasOwn(input, 'description')) {
    const value = input.description;
    if (typeof value !== 'string') throw new HttpError(400, textError('description', 4000, 'type'));
    if (value.replace(/\r\n?/g, '\n').trim() === '') {
      fields.description = '';
    } else {
      const checked = checkMultilineText(value, 4000);
      if ('problem' in checked) throw new HttpError(400, textError('description', 4000, checked.problem));
      fields.description = checked.text;
    }
  }
  if (Object.hasOwn(input, 'category')) {
    if (typeof input.category !== 'string' || !(ADDON_CATEGORIES as readonly string[]).includes(input.category)) {
      throw new HttpError(400, `„category“ muss eins von ${ADDON_CATEGORIES.join(', ')} sein.`);
    }
    fields.category = input.category;
  }
  if (Object.hasOwn(input, 'icon')) {
    if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon)) throw new HttpError(400, '„icon“ ist ungültig (1–30 Zeichen aus a–z, 0–9 und -).');
    fields.icon = input.icon;
  }
  if (Object.hasOwn(input, 'platforms')) {
    const p = input.platforms;
    if (!Array.isArray(p) || !p.every((x) => typeof x === 'string' && (ADDON_PLATFORMS as readonly string[]).includes(x)) || new Set(p).size !== p.length) {
      throw new HttpError(400, '„platforms“ muss eine Liste aus windows, mac und linux sein (ohne Doppelte; leer = alle Systeme).');
    }
    fields.platforms = [...(p as string[])];
  }
  if (Object.hasOwn(input, 'notes')) {
    const n = input.notes;
    if (!Array.isArray(n) || n.length > 20) throw new HttpError(400, '„notes“ muss eine Liste mit höchstens 20 Einträgen sein.');
    fields.notes = n.map((note, i) => {
      const checked = checkText(note, 300, false);
      if ('problem' in checked) throw new HttpError(400, textError(`notes (Eintrag ${i + 1})`, 300, checked.problem));
      return checked.text;
    });
  }
  return fields;
}

export class AddonSubmissions {
  /** Ordner der Einreichungen (JARs und Screenshots, die noch nicht veröffentlicht sind). */
  readonly dir: string;
  /** Einreichungen, mit denen gerade etwas passiert (Upload, Einreichen, Freigeben, Zurückziehen). */
  private readonly busy = new Set<string>();

  constructor(
    private readonly store: Store,
    private readonly addons: Addons,
    private readonly realtime: Realtime,
    private readonly options: SubmissionOptions,
    private readonly log: (line: string) => void,
  ) {
    this.dir = path.join(addons.dir, 'einreichungen');
  }

  // ---------- Ansicht ----------

  /** `Submission`. Für Spieler heißt der Prüfer „HeldixClient-Team“, außer er steht auf der öffentlichen Teamseite. */
  private view(s: SubmissionRow, viewer: 'player' | 'team', publicTeam?: Set<string>) {
    let reviewer = s.reviewer;
    if (viewer === 'player' && reviewer !== null) {
      const visible = publicTeam ?? this.store.publicTeamUuids();
      if (s.reviewerUuid === null || !visible.has(s.reviewerUuid)) reviewer = TEAM_AUTHOR;
    }
    return {
      id: s.id,
      status: s.status,
      addonId: s.addonId,
      version: s.version,
      name: s.name,
      summary: s.summary,
      description: s.description,
      category: s.category,
      icon: s.icon,
      platforms: s.platforms,
      notes: s.notes,
      authors: s.authors,
      api: s.api,
      access: s.access,
      minecraft: s.minecraft,
      loaders: s.loaders,
      size: s.size,
      sha256: s.sha256,
      screenshots: s.screenshots.length,
      inspection: s.inspection,
      createdAt: s.createdAt,
      submittedAt: s.submittedAt,
      reviewedAt: s.reviewedAt,
      reviewNote: s.reviewNote,
      reviewer,
    };
  }

  private teamView(s: SubmissionRow) {
    return { ...this.view(s, 'team'), submitter: { uuid: s.uuid, name: s.submitterName } };
  }

  /** Eigene Einreichung oder 404 (fremde sehen genauso aus wie unbekannte). */
  private own(user: UserRow, sid: string | undefined): SubmissionRow {
    const sub = sid !== undefined && SID_RE.test(sid) ? this.store.getSubmission(sid) : undefined;
    if (!sub || sub.uuid !== user.uuid) throw new HttpError(404, NO_SUCH_SUBMISSION);
    return sub;
  }

  /** Nur Entwürfe und abgelehnte Einreichungen lassen sich ändern. */
  private editable(sub: SubmissionRow): void {
    if (sub.status === 'draft' || sub.status === 'rejected') return;
    throw new HttpError(
      409,
      sub.status === 'pending'
        ? 'Die Einreichung wartet auf die Prüfung und lässt sich nicht ändern. Zum Ändern zurückziehen und neu einreichen.'
        : 'Diese Einreichung lässt sich nicht mehr ändern.',
    );
  }

  /** Jede Änderung macht aus einer abgelehnten Einreichung wieder einen Entwurf; das Manifest entsteht neu beim Einreichen. */
  private touched(sub: SubmissionRow): SubmissionRow {
    return { ...sub, status: 'draft', manifest: null, updatedAt: Date.now() };
  }

  private lock(sid: string): void {
    if (this.busy.has(sid)) throw new HttpError(409, BUSY);
    this.busy.add(sid);
  }

  private jarPath(sid: string): string {
    return path.join(this.dir, `${sid}.jar`);
  }

  private async realJar(sid: string): Promise<string | null> {
    return resolveInDir(this.dir, `${sid}.jar`);
  }

  // ---------- Spieler ----------

  /** `GET /v1/addon-submissions`: eigene Einreichungen (neueste zuerst) und eigene veröffentlichte Addons. */
  list(user: UserRow) {
    const publicTeam = this.store.publicTeamUuids();
    return {
      submissions: this.store.submissionsOf(user.uuid).map((s) => this.view(s, 'player', publicTeam)),
      addons: this.addons.ownedBy(user.uuid),
    };
  }

  /** `POST /v1/addon-submissions` mit Store-Angaben (alle freiwillig): neuer Entwurf. */
  create(user: UserRow, input: Record<string, unknown>) {
    const fields = readStoreFields(input);
    if (this.store.countSubmissions(user.uuid, 'draft') >= MAX_DRAFTS) {
      throw new HttpError(409, `Du hast schon ${MAX_DRAFTS} Entwürfe. Bitte erst einen einreichen oder löschen.`);
    }
    const sub = this.store.insertSubmission(
      randomBytes(12).toString('base64url'),
      user.uuid,
      {
        name: fields.name ?? '',
        summary: fields.summary ?? '',
        description: fields.description ?? '',
        category: fields.category ?? 'sonstiges',
        icon: fields.icon ?? 'addons',
        platforms: fields.platforms ?? [],
        notes: fields.notes ?? [],
      },
      Date.now(),
    );
    return { submission: this.view(sub, 'player') };
  }

  /** `PATCH /v1/addon-submissions/<sid>`: Store-Angaben ändern (nur Entwurf oder abgelehnt; abgelehnt wird wieder Entwurf). */
  update(user: UserRow, sid: string | undefined, input: Record<string, unknown>) {
    const sub = this.own(user, sid);
    this.editable(sub);
    const fields = readStoreFields(input);
    const next = { ...this.touched(sub), ...fields };
    this.store.saveSubmission(next);
    return { submission: this.view(this.store.getSubmission(sub.id)!, 'player') };
  }

  /** Nimmt einen Upload eines Spielers entgegen: Grenzen, dann gestreamt in den Ordner der Einreichungen. */
  private async receive(user: UserRow, req: IncomingMessage, file: string, maxBytes: number) {
    const rate = this.options.uploadLimiter.take(user.uuid);
    if (!rate.ok) throw new HttpError(429, 'Zu viele Uploads. Bitte später noch einmal.', { 'Retry-After': String(rate.retryAfter) });
    checkUploadLength(req, maxBytes);
    const release = this.options.uploadSlots.tryAcquire();
    if (!release) throw new HttpError(429, 'Gerade laden viele gleichzeitig hoch. Bitte gleich noch einmal versuchen.', { 'Retry-After': '10' });
    try {
      const received = await receiveFile(req, this.dir, file, maxBytes, this.options.uploadIdleTimeoutMs);
      return { ...received, path: path.join(await fs.promises.realpath(this.dir), file) };
    } finally {
      release();
    }
  }

  /** Die Addon-ID muss frei sein oder dem Einreicher gehören; kein anderer Spieler darf sie gerade zur Prüfung haben. */
  private checkId(sub: SubmissionRow, addonId: string): void {
    const addon = this.store.getAddon(addonId);
    if (addon && addon.owner !== sub.uuid) throw new HttpError(409, ID_TAKEN);
    if (this.store.pendingSubmissionsFor(addonId).some((other) => other.uuid !== sub.uuid)) throw new HttpError(409, ID_TAKEN);
  }

  /**
   * `PUT /v1/addon-submissions/<sid>/jar` (roher Körper, höchstens 50 MiB): prüft die JAR (ZIP, heldix.addon.json,
   * Einstiegspunkte, Hinweise aus den Klassen), die Addon-ID (Besitz) und dass die Version höher ist als jede
   * veröffentlichte. Zugriff, Minecraft-Versionen und Loader kommen aus der JAR; leere Felder Name und
   * Kurzbeschreibung übernimmt sie aus heldix.addon.json.
   */
  async uploadJar(user: UserRow, sid: string | undefined, req: IncomingMessage) {
    const sub = this.own(user, sid);
    this.editable(sub);
    this.lock(sub.id);
    const upload = `${sub.id}.upload`;
    let received: { path: string; size: number; sha256: string } | undefined;
    try {
      received = await this.receive(user, req, upload, this.options.maxJarBytes);
      // Erst mit freiem Platz lesen: So liegen höchstens so viele JARs im Speicher, wie gleichzeitig geprüft werden.
      const release = await this.options.inspectSlots.acquire();
      let info;
      try {
        info = await inspectAddonJar(await fs.promises.readFile(received.path));
      } catch (err) {
        if (err instanceof ZipProblem) throw new HttpError(400, err.message);
        throw err;
      } finally {
        release();
      }
      const current = this.store.getSubmission(sub.id);
      if (!current) throw new HttpError(404, NO_SUCH_SUBMISSION);
      this.editable(current);
      this.checkId(current, info.id);
      this.addons.checkHigherVersion(info.id, info.version);
      const { size, sha256 } = received;
      await fs.promises.rename(received.path, path.join(await fs.promises.realpath(this.dir), `${sub.id}.jar`));
      received = undefined;
      const next: SubmissionRow = {
        ...this.touched(current),
        addonId: info.id,
        version: info.version,
        api: info.api,
        access: info.access,
        minecraft: info.minecraft,
        loaders: info.loaders,
        authors: info.authors.length > 0 ? info.authors : [user.name],
        size,
        sha256,
        inspection: info.inspection,
        name: current.name === '' ? info.name : current.name,
        summary: current.summary === '' ? info.description : current.summary,
      };
      this.store.saveSubmission(next);
      return { submission: this.view(this.store.getSubmission(sub.id)!, 'player') };
    } finally {
      if (received) await fs.promises.rm(received.path, { force: true }).catch(() => {});
      this.busy.delete(sub.id);
    }
  }

  /** Nummer eines Screenshots (1–4) aus dem Pfad. */
  private screenshotIndex(n: string | undefined): number {
    if (n === undefined || !/^[1-4]$/.test(n)) throw new HttpError(404, 'Diesen Screenshot gibt es nicht.');
    return Number(n) - 1;
  }

  /**
   * `PUT /v1/addon-submissions/<sid>/screenshots/<n>`: PNG oder JPEG, höchstens 2 MiB, 320×180 bis 3840×2160 (aus dem
   * Dateikopf). Ersetzt Nummer n oder hängt an (n = Anzahl + 1); höchstens 4.
   */
  async putScreenshot(user: UserRow, sid: string | undefined, n: string | undefined, req: IncomingMessage) {
    const sub = this.own(user, sid);
    const index = this.screenshotIndex(n);
    this.editable(sub);
    if (index > sub.screenshots.length || index >= MAX_SCREENSHOTS) {
      throw new HttpError(400, `Bitte die Screenshots der Reihe nach hochladen (als Nächstes Nummer ${sub.screenshots.length + 1}, höchstens ${MAX_SCREENSHOTS}).`);
    }
    this.lock(sub.id);
    const id = randomBytes(8).toString('hex');
    let received: { path: string } | undefined;
    try {
      received = await this.receive(user, req, `${sub.id}-${id}.upload`, MAX_SCREENSHOT_BYTES);
      const data = await fs.promises.readFile(received.path);
      const image = imageInfo(data);
      if (!image) throw new HttpError(400, 'Screenshots müssen PNG- oder JPEG-Bilder sein.');
      if (image.width < MIN_SCREENSHOT.width || image.height < MIN_SCREENSHOT.height || image.width > MAX_SCREENSHOT.width || image.height > MAX_SCREENSHOT.height) {
        throw new HttpError(
          400,
          `Das Bild ist ${image.width}×${image.height} Pixel groß; erlaubt sind ${MIN_SCREENSHOT.width}×${MIN_SCREENSHOT.height} bis ${MAX_SCREENSHOT.width}×${MAX_SCREENSHOT.height}.`,
        );
      }
      const current = this.store.getSubmission(sub.id);
      if (!current) throw new HttpError(404, NO_SUCH_SUBMISSION);
      this.editable(current);
      if (index > current.screenshots.length) throw new HttpError(400, 'Bitte die Screenshots der Reihe nach hochladen.');
      const file = `${sub.id}-${id}.${IMAGE_EXTENSIONS[image.type]}`;
      await fs.promises.rename(received.path, path.join(await fs.promises.realpath(this.dir), file));
      received = undefined;
      const shot: AddonScreenshot = { file, type: image.type, width: image.width, height: image.height, size: data.length };
      const screenshots = [...current.screenshots];
      const replaced = screenshots[index];
      screenshots[index] = shot;
      this.store.saveSubmission({ ...this.touched(current), screenshots });
      if (replaced) await this.unlink(replaced.file);
      return { submission: this.view(this.store.getSubmission(sub.id)!, 'player') };
    } finally {
      if (received) await fs.promises.rm(received.path, { force: true }).catch(() => {});
      this.busy.delete(sub.id);
    }
  }

  /** `DELETE /v1/addon-submissions/<sid>/screenshots/<n>`: die folgenden rücken auf. */
  async deleteScreenshot(user: UserRow, sid: string | undefined, n: string | undefined) {
    const sub = this.own(user, sid);
    const index = this.screenshotIndex(n);
    this.editable(sub);
    const shot = sub.screenshots[index];
    if (!shot) throw new HttpError(404, 'Diesen Screenshot gibt es nicht.');
    this.lock(sub.id);
    try {
      this.store.saveSubmission({ ...this.touched(sub), screenshots: sub.screenshots.filter((_, i) => i !== index) });
      await this.unlink(shot.file);
      return { submission: this.view(this.store.getSubmission(sub.id)!, 'player') };
    } finally {
      this.busy.delete(sub.id);
    }
  }

  /** Screenshot der eigenen Einreichung ansehen (`GET /v1/addon-submissions/<sid>/screenshots/<n>`). */
  async ownScreenshot(user: UserRow, sid: string | undefined, n: string | undefined, req: IncomingMessage, res: ServerResponse, idleTimeoutMs: number) {
    await this.sendScreenshot(this.own(user, sid), n, req, res, idleTimeoutMs);
  }

  private async sendScreenshot(sub: SubmissionRow, n: string | undefined, req: IncomingMessage, res: ServerResponse, idleTimeoutMs: number) {
    const shot = sub.screenshots[this.screenshotIndex(n)];
    const real = shot && SCREENSHOT_NAME_RE.test(shot.file) ? await resolveInDir(this.dir, shot.file) : null;
    if (!shot || real === null) throw new HttpError(404, 'Diesen Screenshot gibt es nicht.');
    await sendFile(req, res, real, {
      name: `${sub.id}-${n}.${IMAGE_EXTENSIONS[shot.type]}`,
      contentType: IMAGE_CONTENT_TYPES[shot.type],
      cacheControl: 'private, no-store',
      idleTimeoutMs,
      disposition: 'inline',
    });
  }

  /**
   * `POST /v1/addon-submissions/<sid>/submit`: zur Prüfung (braucht JAR und Kurzbeschreibung; alle Angaben wie im
   * Manifest geprüft). Der Dienst erzeugt dabei das Manifest, das ein Admin beim Freigeben signiert.
   */
  submit(user: UserRow, sid: string | undefined) {
    const sub = this.own(user, sid);
    if (sub.status !== 'draft') {
      throw new HttpError(409, sub.status === 'pending' ? 'Die Einreichung wartet schon auf die Prüfung.' : 'Nur Entwürfe lassen sich einreichen.');
    }
    if (this.busy.has(sub.id)) throw new HttpError(409, BUSY);
    if (sub.addonId === null || sub.version === null || sub.sha256 === null || sub.size === null || sub.api === null) {
      throw new HttpError(400, 'Bitte zuerst die JAR hochladen.');
    }
    if (!fs.existsSync(this.jarPath(sub.id))) throw new HttpError(400, 'Die JAR fehlt. Bitte noch einmal hochladen.');
    if (sub.summary === '') throw new HttpError(400, 'Bitte eine Kurzbeschreibung angeben („summary“).');
    if (this.store.countSubmissions(user.uuid, 'pending') >= MAX_PENDING) {
      throw new HttpError(409, `Du hast schon ${MAX_PENDING} Einreichungen in der Prüfung. Bitte warte, bis das Team sie geprüft hat.`);
    }
    this.checkId(sub, sub.addonId);
    if (this.store.pendingSubmissionsFor(sub.addonId).length > 0) {
      throw new HttpError(409, 'Für dieses Addon wartet schon eine Einreichung auf die Prüfung.');
    }
    this.addons.checkHigherVersion(sub.addonId, sub.version);
    const now = Date.now();
    // Aus der JAR (Einreichungen vor 1.6.1 nutzten nur die Heldix-API)
    const access = sub.access ?? 'api';
    const manifest = JSON.stringify({
      type: 'heldix-addon',
      id: sub.addonId,
      name: sub.name,
      version: sub.version,
      summary: sub.summary,
      description: sub.description,
      authors: sub.authors.length > 0 ? sub.authors : [user.name],
      api: sub.api,
      icon: sub.icon,
      category: sub.category,
      platforms: sub.platforms,
      file: `heldix-addon-${sub.addonId}-${sub.version}.jar`,
      size: sub.size,
      sha256: sub.sha256,
      date: new Date(now).toISOString(),
      notes: sub.notes,
      official: false,
      author: { uuid: user.uuid, name: user.name },
      access,
      minecraft: sub.minecraft,
      loaders: sub.loaders.length > 0 ? sub.loaders : defaultLoaders(access),
    });
    const checked = checkAddonManifest(JSON.parse(manifest));
    if (typeof checked === 'string') throw new HttpError(400, `Bitte noch korrigieren: ${checked}.`);
    if (Buffer.byteLength(manifest, 'utf8') > MAX_ADDON_MANIFEST_BYTES) throw new HttpError(400, 'Die Angaben sind zusammen zu lang.');
    this.store.saveSubmission({
      ...sub,
      status: 'pending',
      manifest,
      updatedAt: now,
      submittedAt: now,
      reviewedAt: null,
      reviewNote: null,
      reviewer: null,
      reviewerUuid: null,
    });
    this.log(`Neue Addon-Einreichung ${sub.id}: ${sub.addonId} ${sub.version}. Prüfen im Team-Bereich unter Addons → Einreichungen.`);
    return { submission: this.view(this.store.getSubmission(sub.id)!, 'player') };
  }

  /**
   * `DELETE /v1/addon-submissions/<sid>`: Ein nie eingereichter Entwurf verschwindet ganz; sonst wird zurückgezogen
   * (bleibt 90 Tage sichtbar, JAR und Screenshots sind sofort weg). Freigegebene: 409.
   */
  async remove(user: UserRow, sid: string | undefined) {
    const sub = this.own(user, sid);
    if (sub.status === 'approved') throw new HttpError(409, 'Freigegebene Einreichungen lassen sich nicht zurückziehen.');
    this.lock(sub.id);
    try {
      if (sub.status === 'draft' && sub.submittedAt === null) {
        this.store.deleteSubmission(sub.id);
        await this.removeFiles(sub);
        return { deleted: true, submission: null };
      }
      if (sub.status !== 'withdrawn') {
        this.store.saveSubmission({ ...sub, status: 'withdrawn', manifest: sub.manifest, screenshots: [], updatedAt: Date.now() });
        await this.removeFiles(sub);
      }
      return { deleted: false, submission: this.view(this.store.getSubmission(sub.id)!, 'player') };
    } finally {
      this.busy.delete(sub.id);
    }
  }

  private async unlink(file: string): Promise<void> {
    await fs.promises.unlink(path.join(this.dir, file)).catch(() => {});
  }

  private async removeFiles(sub: SubmissionRow): Promise<void> {
    await this.unlink(`${sub.id}.jar`);
    for (const shot of sub.screenshots) await this.unlink(shot.file);
  }

  /** Für die Datenauskunft: eigene Einreichungen mit erzeugtem Manifest. */
  exportFor(user: UserRow) {
    return this.store.submissionsOf(user.uuid).map((s) => ({ ...this.view(s, 'player'), updatedAt: s.updatedAt, manifest: s.manifest }));
  }

  // ---------- Team ----------

  /** Einreichung für das Team: nie eingereichte Entwürfe sind privat (404). */
  private forTeam(sid: string | undefined): SubmissionRow {
    const sub = sid !== undefined && SID_RE.test(sid) ? this.store.getSubmission(sid) : undefined;
    if (!sub || (sub.status === 'draft' && sub.submittedAt === null)) throw new HttpError(404, NO_SUCH_SUBMISSION);
    return sub;
  }

  /** `GET /v1/team/addon-submissions?status=pending|all`: wartende (älteste zuerst) oder alle eingereichten (neueste zuerst). */
  teamList(status: string | null) {
    const filter = status ?? 'pending';
    if (filter !== 'pending' && filter !== 'all') throw new HttpError(400, '„status“ muss pending oder all sein.');
    const statuses: SubmissionStatus[] = filter === 'pending' ? ['pending'] : ['pending', 'approved', 'rejected', 'withdrawn', 'draft'];
    let rows = this.store.submissions(statuses).filter((s) => !(s.status === 'draft' && s.submittedAt === null));
    if (filter === 'pending') rows = rows.reverse();
    return { submissions: rows.map((s) => this.teamView(s)) };
  }

  /** `GET /v1/team/addon-submissions/<sid>`: alles plus `manifest` (genau der Text, der beim Freigeben signiert wird). */
  teamGet(sid: string | undefined) {
    const sub = this.forTeam(sid);
    return { submission: { ...this.teamView(sub), manifest: sub.manifest } };
  }

  /** `GET /v1/team/addon-submissions/<sid>/jar`: die JAR zum Prüfen (als Anhang). */
  async teamJar(sid: string | undefined, req: IncomingMessage, res: ServerResponse, idleTimeoutMs: number) {
    const sub = this.forTeam(sid);
    const real = sub.addonId !== null && sub.status !== 'approved' && sub.status !== 'withdrawn' ? await this.realJar(sub.id) : null;
    if (real === null) throw new HttpError(404, 'Zu dieser Einreichung gibt es keine JAR (mehr).');
    await sendFile(req, res, real, {
      name: `heldix-addon-${sub.addonId}-${sub.version}.jar`,
      contentType: CONTENT_TYPE_JAR,
      cacheControl: 'private, no-store',
      idleTimeoutMs,
    });
  }

  /** `GET /v1/team/addon-submissions/<sid>/screenshots/<n>` */
  async teamScreenshot(sid: string | undefined, n: string | undefined, req: IncomingMessage, res: ServerResponse, idleTimeoutMs: number) {
    await this.sendScreenshot(this.forTeam(sid), n, req, res, idleTimeoutMs);
  }

  private pending(sid: string | undefined): SubmissionRow {
    const sub = this.forTeam(sid);
    if (sub.status !== 'pending') throw new HttpError(409, 'Diese Einreichung wartet nicht (mehr) auf die Prüfung.');
    return sub;
  }

  private notify(sub: SubmissionRow) {
    this.realtime.send(sub.uuid, {
      type: 'addon-review',
      submission: sub.id,
      status: sub.status,
      addonId: sub.addonId,
      version: sub.version,
      note: sub.reviewNote,
    });
  }

  /**
   * `POST /v1/team/addon-submissions/<sid>/approve` mit `{ signature }` (nur Admin): Signatur über
   * `"heldix-addon\n" + manifest` prüfen, dann veröffentlichen (JAR in den Addon-Ordner, Addon mit Besitzer,
   * Screenshots übernehmen), Status `approved`, Echtzeit-Nachricht an den Einreicher, Protokoll `addon.approve`.
   */
  async approve(actor: Actor & { uuid: string }, sid: string | undefined, input: Record<string, unknown>) {
    const key = this.options.updateKey;
    if (!key) throw new HttpError(503, NO_KEY);
    const sub = this.pending(sid);
    if (input.manifest !== undefined && input.manifest !== sub.manifest) throw new HttpError(400, 'Das Manifest passt nicht zur Einreichung (inzwischen geändert?).');
    this.lock(sub.id);
    try {
      const jar = await this.realJar(sub.id);
      if (jar === null || sub.manifest === null) throw new HttpError(409, 'Die JAR der Einreichung fehlt.');
      const screenshots = [];
      for (const shot of sub.screenshots) {
        const real = SCREENSHOT_NAME_RE.test(shot.file) ? await resolveInDir(this.dir, shot.file) : null;
        if (real === null) throw new HttpError(409, 'Ein Screenshot der Einreichung fehlt.');
        screenshots.push({ path: real, shot });
      }
      const now = Date.now();
      const approved: SubmissionRow = {
        ...sub,
        status: 'approved',
        screenshots: [],
        updatedAt: now,
        reviewedAt: now,
        reviewNote: null,
        reviewer: actor.name,
        reviewerUuid: actor.uuid,
      };
      const row = await this.addons.publishSubmission({
        manifest: sub.manifest,
        signature: input.signature,
        key,
        owner: sub.uuid,
        by: actor.name,
        jar,
        screenshots,
        inTransaction: () => {
          // Inzwischen gelöscht (Konto gelöscht oder gesperrt)? Dann nichts veröffentlichen.
          if (this.store.getSubmission(sub.id)?.status !== 'pending') throw new HttpError(409, 'Diese Einreichung wartet nicht (mehr) auf die Prüfung.');
          this.store.saveSubmission(approved);
        },
      });
      this.notify(approved);
      writeAudit(this.store, actor, 'addon.approve', `${row.id} ${row.version}`, `Einreichung ${sub.id} von ${playerLabel(sub.submitterName, sub.uuid)}`);
      return { submission: { ...this.teamView(this.store.getSubmission(sub.id)!), manifest: sub.manifest } };
    } finally {
      this.busy.delete(sub.id);
    }
  }

  /** `POST /v1/team/addon-submissions/<sid>/reject` mit `{ note }` (1–1000 Zeichen): abgelehnt, Echtzeit, Protokoll. */
  reject(actor: Actor & { uuid: string }, sid: string | undefined, input: Record<string, unknown>) {
    const note = checkMultilineText(input.note, MAX_REVIEW_NOTE);
    if ('problem' in note) throw new HttpError(400, textError('note', MAX_REVIEW_NOTE, note.problem));
    const sub = this.pending(sid);
    if (this.busy.has(sub.id)) throw new HttpError(409, BUSY);
    const now = Date.now();
    const rejected: SubmissionRow = {
      ...sub,
      status: 'rejected',
      updatedAt: now,
      reviewedAt: now,
      reviewNote: note.text,
      reviewer: actor.name,
      reviewerUuid: actor.uuid,
    };
    this.store.saveSubmission(rejected);
    this.notify(rejected);
    writeAudit(this.store, actor, 'addon.reject', `${sub.addonId} ${sub.version}`, `Einreichung ${sub.id} von ${playerLabel(sub.submitterName, sub.uuid)}`);
    return { submission: { ...this.teamView(this.store.getSubmission(sub.id)!), manifest: sub.manifest } };
  }

  // ---------- Aufräumen ----------

  /**
   * Löscht Dateien im Ordner der Einreichungen, die zu keiner Einreichung (mehr) gehören: nach dem Löschen eines
   * Kontos, nach Ablauf der Aufbewahrung und Reste abgebrochener Uploads (diese erst nach ein paar Minuten).
   */
  async sweepFiles(now = Date.now()): Promise<number> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch {
      return 0;
    }
    const ids = this.store.submissionIds();
    let removed = 0;
    for (const name of names) {
      const sid = name.slice(0, 16);
      if (!SID_RE.test(sid) || (name[16] !== '.' && name[16] !== '-') || this.busy.has(sid)) continue;
      let keep = false;
      if (ids.has(sid)) {
        const sub = this.store.getSubmission(sid);
        const used = new Set(sub ? sub.screenshots.map((s) => s.file) : []);
        if (sub && sub.sha256 !== null && sub.status !== 'approved' && sub.status !== 'withdrawn') used.add(`${sid}.jar`);
        if (used.has(name)) continue;
        const info = await fs.promises.lstat(path.join(this.dir, name)).catch(() => null);
        keep = !info || now - info.mtimeMs < ORPHAN_GRACE_MS;
      }
      if (keep) continue;
      if (await fs.promises.rm(path.join(this.dir, name), { force: true }).then(() => true, () => false)) removed++;
    }
    return removed;
  }
}
