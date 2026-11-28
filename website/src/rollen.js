// HeldixClient – Webseite: Team-Rollen, Rechte und Abzeichen (Heldix-Dienst 1.12.0, rollen-spec.md; 1.13.0: Rechte
// hosting:manage, hosting:grant und discover:moderate für dauerhafte Welten, Heldix+-Warteliste und Entdecken;
// voice:moderate und voice:admin für die Voice-Moderation).
//
// Der Dienst entscheidet über jede Route selbst (403 code forbidden). Die Webseite blendet nur aus, was die eigene
// Rolle nicht darf: WebMe.permissions bzw. GET /v1/team/permissions. Fehlen die Angaben (älterer Dienst bis 1.11),
// gilt die feste Tabelle unten – dort kennt der Dienst nur admin und moderator.
import { badgeImg } from './abzeichen.js';

/** Team-Rollen in Rang-Reihenfolge (gleiche IDs wie badge im Lookup). */
export const ROLES = [
  { id: 'admin', label: 'Team-Admin', short: 'Admin' },
  { id: 'developer-team', label: 'Entwickler', short: 'Entwickler' },
  { id: 'moderator', label: 'Moderator', short: 'Moderator' },
  { id: 'supporter', label: 'Supporter', short: 'Supporter' },
  { id: 'designer', label: 'Designer', short: 'Designer' },
  { id: 'tester', label: 'Tester', short: 'Tester' },
];

/** Rechte (Permission-IDs des Dienstes) mit Bezeichnung und kurzer Erklärung. */
export const PERMISSIONS = [
  { id: 'team.manage', label: 'Team verwalten', text: 'Rollen vergeben, Mitglieder aufnehmen und entfernen, Community-Abzeichen vergeben' },
  { id: 'players.delete', label: 'Spieler-Daten löschen', text: 'Alle Daten eines Spielers beim Dienst löschen' },
  { id: 'updates', label: 'Updates', text: 'Launcher-Versionen hochladen und veröffentlichen' },
  { id: 'addons', label: 'Addons', text: 'Offizielle Addons veröffentlichen, Einreichungen prüfen' },
  { id: 'addon-reports', label: 'Meldungen zu Addons', text: 'Gemeldete Addons prüfen und erledigen' },
  { id: 'cosmetics', label: 'Cosmetics', text: 'Cosmetics hochladen, ausblenden und entfernen' },
  { id: 'news', label: 'Neuigkeiten', text: 'Neuigkeiten schreiben und veröffentlichen' },
  { id: 'moderation', label: 'Meldungen und Sperren', text: 'Meldungen prüfen, Spieler sperren, Capes zurücksetzen' },
  { id: 'players', label: 'Spieler ansehen', text: 'Spieler suchen und Details sehen' },
  { id: 'support', label: 'Support', text: 'Support-Anfragen beantworten und schließen' },
  { id: 'audit', label: 'Protokoll', text: 'Jede Änderung durch das Team ansehen' },
  { id: 'team.view', label: 'Team-Übersicht', text: 'Team-Mitglieder und Abzeichen ansehen' },
  // Ab Dienst 1.13.0
  { id: 'hosting:manage', label: 'Dauerhafte Welten', text: 'Dauerhafte Welten (Übersicht, anhalten, Grenzen ändern)' },
  { id: 'hosting:grant', label: 'Freischaltungen', text: 'Freischaltungen für dauerhafte Welten und Heldix+-Warteliste' },
  { id: 'discover:moderate', label: 'Entdecken moderieren', text: 'Entdecken moderieren (Meldungen, ausblenden, Besitzer sperren)' },
  { id: 'voice:moderate', label: 'Voice moderieren', text: 'Voice-Meldungen prüfen (auch Aufnahmen anhören), Voice-Sperren, Regeln und Liste „Voice aus“ ansehen' },
  { id: 'voice:admin', label: 'Voice verwalten', text: 'Voice-Regeln veröffentlichen, Aufnahmen beim Melden schalten, Liste „Voice aus“ ändern' },
];

/** Rechte je Rolle (Tabelle aus rollen-spec.md bzw. dienst-1.12 §7, ab 1.13.0 mit Hosting und Entdecken) – nur als Rückfall, der Dienst liefert sie selbst. */
export const ROLE_PERMISSIONS = {
  admin: ['team.manage', 'players.delete', 'updates', 'addons', 'addon-reports', 'cosmetics', 'news', 'moderation', 'players', 'support', 'audit', 'team.view', 'hosting:manage', 'hosting:grant', 'discover:moderate', 'voice:moderate', 'voice:admin'],
  'developer-team': ['updates', 'addons', 'addon-reports', 'cosmetics', 'news', 'players', 'audit', 'team.view', 'hosting:manage'],
  moderator: ['addon-reports', 'news', 'moderation', 'players', 'support', 'audit', 'team.view', 'discover:moderate', 'voice:moderate'],
  supporter: ['players', 'support', 'team.view', 'discover:moderate', 'voice:moderate'],
  designer: ['cosmetics', 'team.view'],
  tester: ['team.view'],
};

/** Community-Abzeichen (keine Team-Rechte, vom Team vergeben). */
export const COMMUNITY_BADGES = [
  { id: 'partner', label: 'Partner', text: 'Partner-Server und -Projekte' },
  { id: 'creator', label: 'Creator', text: 'Videos, Streams und Inhalte rund um HeldixClient' },
  { id: 'ambassador', label: 'Botschafter', text: 'Hilft neuen Spielern und bringt Freunde mit' },
];

/** Bezeichnungen aller Abzeichen-Werte (badge im Lookup, Friend.badge, Me.badge). */
export const BADGE_LABELS = {
  admin: 'Team-Admin',
  'developer-team': 'Entwickler',
  moderator: 'Moderator',
  supporter: 'Supporter',
  designer: 'Designer',
  tester: 'Tester',
  partner: 'Partner',
  creator: 'Creator',
  ambassador: 'Botschafter',
  developer: 'Addon-Entwickler',
};

export const roleLabel = (role) => ROLES.find((entry) => entry.id === role)?.label ?? (role ? String(role) : '');
export const roleShort = (role) => ROLES.find((entry) => entry.id === role)?.short ?? (role ? String(role) : '');
export const permissionLabel = (id) => PERMISSIONS.find((entry) => entry.id === id)?.label ?? String(id);
export const badgeLabel = (id) => BADGE_LABELS[id] ?? '';

/** Rechte des angemeldeten Spielers: vom Dienst (WebMe.permissions), sonst aus der Tabelle. */
export function permissionsOf(me) {
  if (!me?.role) return [];
  if (Array.isArray(me.permissions)) return me.permissions.filter((entry) => typeof entry === 'string');
  // Dienst bis 1.11: unbekannte Rolle → wie Tester
  return ROLE_PERMISSIONS[me.role] ?? ROLE_PERMISSIONS.tester;
}

/** Hat die Rolle mindestens eines der Rechte? (leere Liste = immer) */
export function allows(permissions, needed) {
  const list = [needed].flat().filter(Boolean);
  if (!list.length) return true;
  return list.some((entry) => permissions.includes(entry));
}

/** Abzeichen als Bild (für Listen); id null → kein Bild. */
export function badgeIcon(id, { size = 16, label = true } = {}) {
  if (!id) return null;
  return badgeImg(id, { size, label: label ? badgeLabel(id) : '' });
}

/** Rollen-Icon (Sechseck) für Team-Rollen. */
export function roleIcon(role, { size = 18, label = false } = {}) {
  if (!role) return null;
  return badgeImg(role, { size, label: label ? roleLabel(role) : '' });
}
