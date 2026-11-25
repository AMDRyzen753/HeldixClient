// Spieler-Bereich der Webseite: Datenauskunft (Export) und die eigenen Meldungen.
import type { Store, UserRow } from './db';

/** `GET /v1/reports/mine`: eigene Meldungen, neueste zuerst (ohne den Beleg). */
export function myReports(store: Store, user: UserRow) {
  return {
    reports: store.reportsBy(user.uuid).map((r) => ({
      id: r.id,
      at: r.at,
      reported: { uuid: r.reported, name: r.reportedName },
      reason: r.reason,
      note: r.note,
      status: r.status,
    })),
  };
}

/**
 * `GET /v1/me/export`: alles, was der Dienst über den Spieler speichert (Art. 15 DSGVO). Ohne Hashes von Tokens und
 * Sitzungen und ohne das 2FA-Geheimnis; die gelten nur als „vorhanden“.
 */
export function exportData(store: Store, user: UserRow, profile: Record<string, unknown>) {
  const member = store.getTeamMember(user.uuid);
  return {
    exportedAt: Date.now(),
    profile: { ...profile, createdAt: user.createdAt, lastSeen: user.lastSeen },
    friends: store.listFriends(user.uuid).map(({ user: friend, since }) => ({ uuid: friend.uuid, name: friend.name, since })),
    requests: { incoming: store.listIncoming(user.uuid), outgoing: store.listOutgoing(user.uuid) },
    messages: store.messagesOf(user.uuid),
    blocked: store.listBlocks(user.uuid),
    reports: store.reportsBy(user.uuid).map((r) => ({
      id: r.id,
      at: r.at,
      reported: { uuid: r.reported, name: r.reportedName },
      reason: r.reason,
      note: r.note,
      status: r.status,
      doneAt: r.doneAt,
      messages: (() => {
        try {
          return JSON.parse(r.messages) as unknown;
        } catch {
          return [];
        }
      })(),
    })),
    logins: store.tokensOf(user.uuid),
    webSessions: store.listWebSessions(user.uuid, 0, 0).map((s) => ({
      id: s.id,
      device: s.device,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      expiresAt: s.expiresAt,
    })),
    team: member ? { role: member.role, addedAt: member.addedAt, addedBy: member.addedBy, twoFactor: member.totpSecret !== null } : null,
    news: store.newsBy(user.uuid).map((n) => ({ id: n.id, title: n.title, createdAt: n.createdAt, published: n.published })),
    teamActions: store.auditBy(user.uuid).map((a) => ({ at: a.at, action: a.action, target: a.target, detail: a.detail })),
  };
}
