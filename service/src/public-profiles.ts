// Öffentliche Spielerprofile (ab 1.14.0): freiwillig (Standard aus). Wer es einschaltet, hat unter `/spieler/<name>`
// eine Seite mit Bio und – je nach Schalter – Abzeichen, Cape und getragenen Cosmetics, gelisteten Welten aus Entdecken
// und „Freund hinzufügen“. Unbekannte, private, gesperrte und vom Team ausgeblendete Profile sind nicht zu unterscheiden
// (404). Für Vorschaukarten (Discord, Messenger) liefert der Dienst die gebaute `spieler.html` der Webseite mit
// eingesetzten `<title>`/`og:*`/`twitter:*`; alle eingesetzten Werte sind HTML-maskiert.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { StatementSync } from 'node:sqlite';
import type { Addons } from './addons';
import type { Cosmetics } from './cosmetics';
import type { Store, UserRow } from './db';
import type { Discover } from './discover';
import { HttpError } from './http';
import type { Reports } from './reports';
import { BADGE_LABELS, type PlayerBadge } from './roles';
import { playerLabel, textError, writeAudit, type Actor } from './team';
import { checkText, isName, isUuid } from './validate';
import { checkWords } from './wordfilter';

export const BIO_MAX = 160;
export const PROFILE_UNKNOWN = 'Dieses Profil gibt es nicht oder es ist nicht öffentlich.';
/** Platzhalter in spieler.html, an dem die Angaben eingesetzt werden (sonst nach `<meta charset>` bzw. `<head>`). */
export const META_MARKER = '<!--heldix:spieler-meta-->';

export interface PublicProfileOptions {
  /** Adresse der Webseite (Origin) für kanonische Adresse und og:url; ohne: diese Angaben fehlen */
  website: string | null;
  /** Öffentliche Adresse der API (Origin) für das Bild der Vorschaukarte; ohne: `<website>/api` */
  apiUrl: string | null;
  /** Ordner mit der gebauten Webseite (darin spieler.html); fehlt die Datei: eine kleine eingebaute Seite */
  websiteDir: string | null;
}

export interface ProfileSettings {
  enabled: boolean;
  bio: string;
  showCosmetics: boolean;
  showWorlds: boolean;
  showBadges: boolean;
  showFriendsButton: boolean;
  hidden: boolean;
  updated: number | null;
}

const DEFAULTS: ProfileSettings = {
  enabled: false,
  bio: '',
  showCosmetics: true,
  showWorlds: true,
  showBadges: true,
  showFriendsButton: true,
  hidden: false,
  updated: null,
};

const SWITCHES = ['enabled', 'showCosmetics', 'showWorlds', 'showBadges', 'showFriendsButton'] as const;

type Row = Record<string, unknown>;

function toSettings(row: Row | undefined): ProfileSettings {
  if (!row) return { ...DEFAULTS };
  return {
    enabled: Number(row.enabled) === 1,
    bio: String(row.bio),
    showCosmetics: Number(row.show_cosmetics) === 1,
    showWorlds: Number(row.show_worlds) === 1,
    showBadges: Number(row.show_badges) === 1,
    showFriendsButton: Number(row.show_friends_button) === 1,
    hidden: Number(row.hidden) === 1,
    updated: Number(row.updated),
  };
}

/** Text für HTML (Inhalt und Attribute in Anführungszeichen). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Angaben in eine HTML-Seite einsetzen: vorhandene `<title>`, `description`, `robots`, `canonical`, `og:*` und
 * `twitter:*` im Kopf fallen weg, der neue Block steht am Platzhalter (META_MARKER), sonst nach `<meta charset>` bzw.
 * direkt nach `<head>`. Ersetzt wird nur mit Funktionen (keine `$`-Muster aus Benutzertexten).
 */
export function injectMeta(html: string, meta: string): string {
  const end = html.search(/<\/head\s*>/i);
  if (end < 0) return `${meta}\n${html}`;
  let head = html.slice(0, end);
  const rest = html.slice(end);
  head = head
    .replace(/[ \t]*<title\b[^>]*>[\s\S]*?<\/title\s*>[ \t]*\r?\n?/gi, () => '')
    .replace(/[ \t]*<meta\b[^>]*\b(?:name|property)\s*=\s*["'](?:og:[^"']*|twitter:[^"']*|description|robots)["'][^>]*>[ \t]*\r?\n?/gi, () => '')
    .replace(/[ \t]*<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>[ \t]*\r?\n?/gi, () => '');
  if (head.includes(META_MARKER)) {
    head = head.replace(META_MARKER, () => meta);
  } else if (/<meta\b[^>]*\bcharset\b[^>]*>/i.test(head)) {
    head = head.replace(/<meta\b[^>]*\bcharset\b[^>]*>/i, (tag) => `${tag}\n${meta}`);
  } else if (/<head\b[^>]*>/i.test(head)) {
    head = head.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n${meta}`);
  } else {
    head = `${head}${meta}\n`;
  }
  return head + rest;
}

const FALLBACK_PAGE = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${META_MARKER}
</head>
<body>
<main><h1>Spielerprofil</h1><p>Dieses Profil zeigt die Webseite von HeldixClient.</p></main>
</body>
</html>
`;

export class PublicProfiles {
  private readonly sql: Record<string, StatementSync>;
  private template: { path: string; mtimeMs: number; text: string } | null = null;

  constructor(
    private readonly store: Store,
    private readonly cosmetics: Cosmetics,
    private readonly addons: Addons,
    private readonly discover: Discover,
    private readonly reports: Reports,
    private readonly options: PublicProfileOptions,
  ) {
    const p = (sql: string) => store.prepare(sql);
    const COLUMNS = 'uuid, enabled, bio, show_cosmetics, show_worlds, show_badges, show_friends_button, hidden, hidden_at, hidden_by, updated';
    this.sql = {
      get: p(`SELECT ${COLUMNS} FROM public_profiles WHERE uuid = ?`),
      put: p(`INSERT INTO public_profiles (uuid, enabled, bio, show_cosmetics, show_worlds, show_badges, show_friends_button, updated)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (uuid) DO UPDATE SET enabled = excluded.enabled, bio = excluded.bio, show_cosmetics = excluded.show_cosmetics,
          show_worlds = excluded.show_worlds, show_badges = excluded.show_badges, show_friends_button = excluded.show_friends_button,
          updated = excluded.updated`),
      hide: p(`INSERT INTO public_profiles (uuid, hidden, hidden_at, hidden_by, updated) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (uuid) DO UPDATE SET hidden = excluded.hidden, hidden_at = excluded.hidden_at, hidden_by = excluded.hidden_by`),
      isPublic: p('SELECT 1 AS x FROM public_profiles WHERE uuid = ? AND enabled = 1 AND hidden = 0'),
    };
  }

  private settingsOf(uuid: string): ProfileSettings {
    return toSettings(this.sql.get!.get(uuid) as Row | undefined);
  }

  /** Hat der Spieler ein öffentliches Profil (an, nicht ausgeblendet)? Für Skin und Kopf ohne Anmeldung. */
  isPublic(uuid: string): boolean {
    return this.sql.isPublic!.get(uuid) !== undefined;
  }

  private profileUrl(name: string): string | null {
    return this.options.website === null ? null : `${this.options.website}/spieler/${encodeURIComponent(name)}`;
  }

  private ownView(user: UserRow) {
    const settings = this.settingsOf(user.uuid);
    return { ...settings, url: this.profileUrl(user.name) };
  }

  // ---------- Angemeldet ----------

  /** `GET /v1/account/public-profile` */
  get(user: UserRow) {
    return this.ownView(user);
  }

  /** `PUT /v1/account/public-profile { enabled, bio, showCosmetics, showWorlds, showBadges, showFriendsButton }` (Teilfelder) */
  put(user: UserRow, input: Record<string, unknown>) {
    const next = this.settingsOf(user.uuid);
    for (const key of SWITCHES) {
      if (!Object.hasOwn(input, key)) continue;
      if (typeof input[key] !== 'boolean') throw new HttpError(400, `„${key}“ muss true oder false sein.`);
      next[key] = input[key] as boolean;
    }
    if (Object.hasOwn(input, 'bio')) {
      const checked = checkText(input.bio === null ? '' : input.bio, BIO_MAX, true);
      if ('problem' in checked) throw new HttpError(400, textError('bio', BIO_MAX, checked.problem));
      const problem = checkWords(checked.text);
      if (problem === 'link') throw new HttpError(400, 'Links und Werbung für andere Dienste sind in der Bio nicht erlaubt.', {}, 'words-link');
      if (problem === 'word') throw new HttpError(400, 'Die Bio enthält Wörter, die hier nicht erlaubt sind.', {}, 'words-word');
      next.bio = checked.text;
    }
    this.sql.put!.run(
      user.uuid,
      next.enabled ? 1 : 0,
      next.bio,
      next.showCosmetics ? 1 : 0,
      next.showWorlds ? 1 : 0,
      next.showBadges ? 1 : 0,
      next.showFriendsButton ? 1 : 0,
      Date.now(),
    );
    return this.ownView(user);
  }

  // ---------- Öffentlich ----------

  /** Spieler zu `<name>` oder `<uuid32>` mit öffentlichem Profil, sonst undefined. */
  private find(param: string | undefined): { user: UserRow; settings: ProfileSettings } | undefined {
    let value = param ?? '';
    try {
      value = decodeURIComponent(value);
    } catch {
      return undefined;
    }
    const user = isUuid(value) ? this.store.getUser(value) : isName(value) ? this.store.findUserByName(value) : undefined;
    if (!user) return undefined;
    const settings = this.settingsOf(user.uuid);
    if (!settings.enabled || settings.hidden) return undefined;
    return { user, settings };
  }

  private badgesOf(uuid: string): { id: Exclude<PlayerBadge, null>; label: string }[] {
    const out: { id: Exclude<PlayerBadge, null>; label: string }[] = [];
    const role = this.store.publicTeamRolesIn([uuid]).get(uuid);
    if (role) out.push({ id: role, label: BADGE_LABELS[role] });
    const community = this.store.getCommunityBadge(uuid)?.badge;
    if (community) out.push({ id: community, label: BADGE_LABELS[community] });
    if (this.addons.developersAmong([uuid]).has(uuid)) out.push({ id: 'developer', label: BADGE_LABELS.developer });
    return out;
  }

  /** `GET /v1/public/players/<name|uuid32>`: nur öffentliche Profile, sonst 404. */
  publicView(param: string | undefined) {
    const found = this.find(param);
    if (!found) throw new HttpError(404, PROFILE_UNKNOWN, {}, 'PROFILE_UNKNOWN');
    const { user, settings } = found;
    const look = settings.showCosmetics ? this.cosmetics.forLookup([user]).get(user.uuid) : undefined;
    return {
      uuid: user.uuid,
      name: user.name,
      bio: settings.bio,
      ...(settings.showBadges ? { badges: this.badgesOf(user.uuid) } : {}),
      ...(look ? { cosmetics: { cape: look.cape === '' ? null : look.cape, worn: look.cosmetics } } : {}),
      ...(settings.showWorlds ? { worlds: this.discover.entriesOf(user.uuid) } : {}),
      friendsButton: settings.showFriendsButton,
      since: user.createdAt,
      head: `/v1/public/heads/${user.uuid}.png`,
      skin: `/v1/public/skins/${user.uuid}`,
      url: this.profileUrl(user.name),
    };
  }

  /** `POST /v1/public/players/<name>/report { reason, note? }` (angemeldet): in die Meldungen des Teams. */
  report(me: UserRow, param: string | undefined, input: Record<string, unknown>) {
    const found = this.find(param);
    if (!found) throw new HttpError(404, PROFILE_UNKNOWN, {}, 'PROFILE_UNKNOWN');
    const { user, settings } = found;
    return this.reports.reportSubject(
      me,
      { kind: 'profile', subject: user.uuid, owner: { uuid: user.uuid, name: user.name }, snapshot: { name: user.name, bio: settings.bio } },
      input,
    );
  }

  // ---------- Team ----------

  /** `PUT /v1/team/public-profiles/<uuid> { hidden }` (Moderation): Profil ausblenden bzw. wieder zeigen. */
  teamSetHidden(actor: Actor, uuid: string, input: Record<string, unknown>) {
    if (typeof input.hidden !== 'boolean') throw new HttpError(400, '„hidden“ muss true oder false sein.');
    const user = this.store.getUser(uuid);
    if (!user) throw new HttpError(404, 'Diesen Spieler kennt der Heldix-Dienst nicht.');
    const now = Date.now();
    this.sql.hide!.run(uuid, input.hidden ? 1 : 0, input.hidden ? now : null, input.hidden ? actor.name : null, now);
    writeAudit(this.store, actor, input.hidden ? 'profile.hide' : 'profile.show', playerLabel(user.name, uuid));
    const settings = this.settingsOf(uuid);
    return { uuid, name: user.name, hidden: settings.hidden, enabled: settings.enabled };
  }

  // ---------- Seite /spieler/<name> ----------

  /** Gebaute spieler.html (bei Änderung der Datei neu gelesen), sonst die eingebaute kleine Seite. */
  private page(): string {
    if (this.options.websiteDir === null) return FALLBACK_PAGE;
    const path = join(this.options.websiteDir, 'spieler.html');
    try {
      const { mtimeMs } = statSync(path);
      if (this.template?.path !== path || this.template.mtimeMs !== mtimeMs) this.template = { path, mtimeMs, text: readFileSync(path, 'utf8') };
      return this.template.text;
    } catch {
      this.template = null;
      return FALLBACK_PAGE;
    }
  }

  /** Bild der Vorschaukarte: Kopf (128 px) über die API. */
  private headUrl(uuid: string): string | null {
    const base = this.options.apiUrl ?? (this.options.website === null ? null : `${this.options.website}/api`);
    return base === null ? null : `${base}/v1/public/heads/${uuid}.png?size=256`;
  }

  /** Kopf der Seite für ein öffentliches Profil bzw. allgemein mit noindex. */
  private metaFor(found: { user: UserRow; settings: ProfileSettings } | undefined): string {
    const site = this.options.website;
    const e = escapeHtml;
    if (!found) {
      const title = 'Spielerprofil – HeldixClient';
      const description = 'Öffentliche Spielerprofile bei HeldixClient: Abzeichen, Cosmetics und Welten von Spielern.';
      return [
        `<title>${e(title)}</title>`,
        `<meta name="description" content="${e(description)}">`,
        '<meta name="robots" content="noindex">',
        '<meta property="og:site_name" content="HeldixClient">',
        '<meta property="og:locale" content="de_DE">',
        '<meta property="og:type" content="website">',
        `<meta property="og:title" content="${e(title)}">`,
        `<meta property="og:description" content="${e(description)}">`,
        site === null ? '' : `<meta property="og:image" content="${e(`${site}/og/start.png`)}">`,
        '<meta name="twitter:card" content="summary">',
        `<meta name="twitter:title" content="${e(title)}">`,
        `<meta name="twitter:description" content="${e(description)}">`,
      ]
        .filter(Boolean)
        .join('\n');
    }
    const { user, settings } = found;
    const title = `${user.name} – HeldixClient`;
    const description = settings.bio !== '' ? settings.bio : `Das öffentliche Profil von ${user.name} bei HeldixClient.`;
    const url = this.profileUrl(user.name);
    const image = this.headUrl(user.uuid);
    return [
      `<title>${e(title)}</title>`,
      `<meta name="description" content="${e(description)}">`,
      url === null ? '' : `<link rel="canonical" href="${e(url)}">`,
      '<meta property="og:site_name" content="HeldixClient">',
      '<meta property="og:locale" content="de_DE">',
      '<meta property="og:type" content="profile">',
      `<meta property="og:title" content="${e(title)}">`,
      `<meta property="og:description" content="${e(description)}">`,
      url === null ? '' : `<meta property="og:url" content="${e(url)}">`,
      image === null ? '' : `<meta property="og:image" content="${e(image)}">`,
      image === null ? '' : '<meta property="og:image:width" content="128">\n<meta property="og:image:height" content="128">',
      image === null ? '' : `<meta property="og:image:alt" content="${e(`Kopf von ${user.name}`)}">`,
      `<meta property="profile:username" content="${e(user.name)}">`,
      '<meta name="twitter:card" content="summary">',
      `<meta name="twitter:title" content="${e(title)}">`,
      `<meta name="twitter:description" content="${e(description)}">`,
      image === null ? '' : `<meta name="twitter:image" content="${e(image)}">`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** `GET /spieler/<name>`: Seite mit Vorschaukarte; unbekannt oder privat: dieselbe Seite allgemein mit noindex (404). */
  renderPage(param: string | undefined): { status: number; html: string } {
    const found = this.find(param);
    return { status: found ? 200 : 404, html: injectMeta(this.page(), this.metaFor(found)) };
  }

  // ---------- Datenschutz ----------

  /** Datenauskunft: Einstellungen des öffentlichen Profils (null, wenn nie eingerichtet). */
  exportFor(user: UserRow) {
    const row = this.sql.get!.get(user.uuid) as Row | undefined;
    return row ? toSettings(row) : null;
  }
}
