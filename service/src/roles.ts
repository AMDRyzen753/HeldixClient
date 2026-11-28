// Team-Rollen, Rechte je Rolle und Abzeichen (ab 1.12.0). Statt einer linearen Mindestrolle hat jede Team-Route ein Recht;
// welche Rolle welches Recht hat, steht nur hier (ROLE_PERMISSIONS). Dazu die Community-Abzeichen, die das Team vergibt,
// und die Regel, welches Abzeichen ein Spieler beim Nachschlagen zeigt.
import type { Addons } from './addons';
import type { Store } from './db';

/**
 * Team-Rollen in der Reihenfolge ihres Rangs (für Listen und die Teamseite). Der Wert ist zugleich das Abzeichen beim
 * Nachschlagen. Die Rolle „Entwickler“ heißt `developer-team`, weil `developer` schon „Addon-Entwickler“ bedeutet.
 */
export const TEAM_ROLES = ['admin', 'developer-team', 'moderator', 'supporter', 'designer', 'tester'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_LABELS: Record<TeamRole, string> = {
  admin: 'Team-Admin',
  'developer-team': 'Entwickler',
  moderator: 'Moderator',
  supporter: 'Supporter',
  designer: 'Designer',
  tester: 'Tester',
};

/** Community-Abzeichen: keine Team-Rechte, vom Team (Recht `team.manage`) vergeben. Höchstens eines je Spieler. */
export const COMMUNITY_BADGES = ['partner', 'creator', 'ambassador'] as const;
export type CommunityBadge = (typeof COMMUNITY_BADGES)[number];

export const COMMUNITY_BADGE_LABELS: Record<CommunityBadge, string> = {
  partner: 'Partner',
  creator: 'Creator',
  ambassador: 'Botschafter',
};

/**
 * Abzeichen beim Nachschlagen (Heldix-Symbol) und in Freundesliste und Profilkarte: Team-Rolle (nur mit öffentlichem
 * Teamprofil), sonst Community-Abzeichen, sonst `developer` (sichtbares Community-Addon im Store), sonst null.
 */
export type PlayerBadge = TeamRole | CommunityBadge | 'developer' | null;

/** Alle Werte, die `badge` haben kann (ohne null), in der Reihenfolge der Anzeige. */
export const BADGE_VALUES: readonly Exclude<PlayerBadge, null>[] = [...TEAM_ROLES, ...COMMUNITY_BADGES, 'developer'];

export const BADGE_LABELS: Record<Exclude<PlayerBadge, null>, string> = {
  ...ROLE_LABELS,
  ...COMMUNITY_BADGE_LABELS,
  developer: 'Addon-Entwickler',
};

/** Rechte für den Team-Bereich (je Route eines; Routen ohne Recht darf jedes Team-Mitglied). */
export const PERMISSIONS = [
  'team.manage',
  'players.delete',
  'updates',
  'addons',
  'addon-reports',
  'cosmetics',
  'news',
  'moderation',
  'players',
  'support',
  'audit',
  'team.view',
  // ab 1.13.0: Dauerhafte Welten (Übersicht, anhalten, Grenzen) und Freischaltungen dafür, Entdecken moderieren
  'hosting:manage',
  'hosting:grant',
  'discover:moderate',
  // ab 1.13.0: Voice-Moderation (Meldungen mit Clips, Voice-Sperren, Liste „Voice aus“ ansehen) und deren Einstellungen
  'voice:moderate',
  'voice:admin',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'team.manage': 'Team verwalten (Rollen, Abzeichen vergeben)',
  'players.delete': 'Spieler-Daten löschen',
  updates: 'Updates (Launcher hochladen und veröffentlichen)',
  addons: 'Addons (offizielle veröffentlichen, Einreichungen prüfen)',
  'addon-reports': 'Meldungen zu Addons',
  cosmetics: 'Cosmetics (hochladen, ausblenden)',
  news: 'Neuigkeiten',
  moderation: 'Meldungen, Sperren, Cape zurücksetzen',
  players: 'Spieler suchen und ansehen',
  support: 'Support-Anfragen',
  audit: 'Protokoll ansehen',
  'team.view': 'Team-Übersicht ansehen',
  'hosting:manage': 'Dauerhafte Welten (Übersicht, anhalten, Grenzen ändern)',
  'hosting:grant': 'Freischaltungen für dauerhafte Welten und Heldix+-Warteliste',
  'discover:moderate': 'Entdecken moderieren (Meldungen, ausblenden, Besitzer sperren)',
  'voice:moderate': 'Voice moderieren (Meldungen und Aufnahmen, Voice-Sperren, Liste „Voice aus“ ansehen)',
  'voice:admin': 'Voice-Einstellungen (Voice-Regeln veröffentlichen, Aufnahmen an/aus, Liste „Voice aus“ ändern)',
};

/**
 * Welche Rolle welches Recht hat (Tabelle aus rollen-spec.md; „Spieler-Daten löschen“ bleibt wie bisher nur Admin). Ab
 * 1.13.0: `hosting:manage` Admin und Entwickler, `hosting:grant` nur Admin, `discover:moderate` Admin, Moderator, Supporter;
 * `voice:moderate` Admin, Moderator, Supporter, `voice:admin` nur Admin.
 */
export const ROLE_PERMISSIONS: Record<TeamRole, readonly Permission[]> = {
  admin: [...PERMISSIONS],
  'developer-team': ['updates', 'addons', 'addon-reports', 'cosmetics', 'news', 'players', 'audit', 'team.view', 'hosting:manage'],
  moderator: ['addon-reports', 'news', 'moderation', 'players', 'support', 'audit', 'team.view', 'discover:moderate', 'voice:moderate'],
  supporter: ['players', 'support', 'team.view', 'discover:moderate', 'voice:moderate'],
  designer: ['cosmetics', 'team.view'],
  tester: ['team.view'],
};

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === 'string' && (TEAM_ROLES as readonly string[]).includes(value);
}

export function isCommunityBadge(value: unknown): value is CommunityBadge {
  return typeof value === 'string' && (COMMUNITY_BADGES as readonly string[]).includes(value);
}

export function hasPermission(role: TeamRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: TeamRole | null): Permission[] {
  return role === null ? [] : [...ROLE_PERMISSIONS[role]];
}

/** Rang einer Rolle (0 = Admin) für Sortierungen. */
export function roleRank(role: string): number {
  const index = (TEAM_ROLES as readonly string[]).indexOf(role);
  return index < 0 ? TEAM_ROLES.length : index;
}

/** `GET /v1/team/permissions`: welche Rolle was darf, für die Rechte-Übersicht im Team-Bereich. */
export function rightsOverview(own: TeamRole) {
  return {
    roles: TEAM_ROLES.map((id) => ({ id, label: ROLE_LABELS[id], permissions: [...ROLE_PERMISSIONS[id]] })),
    permissions: PERMISSIONS.map((id) => ({ id, label: PERMISSION_LABELS[id] })),
    badges: COMMUNITY_BADGES.map((id) => ({ id, label: COMMUNITY_BADGE_LABELS[id] })),
    mine: { role: own, permissions: permissionsOf(own) },
  };
}

/**
 * Abzeichen mehrerer Spieler auf einmal (gebündelte Abfragen): Team-Rolle nur mit öffentlichem Teamprofil, dann
 * Community-Abzeichen, dann Addon-Entwickler. Spieler ohne Abzeichen fehlen in der Map.
 */
export function badgesOf(store: Store, addons: Addons, uuids: readonly string[]): Map<string, Exclude<PlayerBadge, null>> {
  const result = new Map<string, Exclude<PlayerBadge, null>>();
  const unique = [...new Set(uuids)];
  if (unique.length === 0) return result;
  for (const [uuid, role] of store.publicTeamRolesIn(unique)) result.set(uuid, role);
  let rest = unique.filter((uuid) => !result.has(uuid));
  if (rest.length > 0) for (const [uuid, badge] of store.communityBadgesIn(rest)) result.set(uuid, badge);
  rest = rest.filter((uuid) => !result.has(uuid));
  if (rest.length > 0) for (const uuid of addons.developersAmong(rest)) result.set(uuid, 'developer');
  return result;
}
