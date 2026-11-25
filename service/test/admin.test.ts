// Verwaltung (heldix-dienst-admin): Meldungen ansehen und erledigen, sperren, entsperren – gegen die Datenbank des laufenden Dienstes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import { runAdmin } from '../src/admin';
import { Store } from '../src/db';
import { api, befriend, devPlayer, randomUuid, startFakeMojang, startService, type FakeMojang, type TestService } from './helpers';

const BANNED = 'Dieses Konto ist für den Heldix-Dienst gesperrt.';

function admin(service: TestService, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runAdmin(args, service.dataDir, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function mojangLogin(service: TestService, mojang: FakeMojang, name: string, uuid: string) {
  const serverId = (await api(service.url, 'POST', '/v1/auth/challenge')).body.serverId;
  mojang.join(name, serverId, uuid);
  return api(service.url, 'POST', '/v1/auth/login', { body: { name, serverId } });
}

describe('Verwaltung: Meldungen', () => {
  test('meldungen zeigt Meldungen mit Beleg, meldung-erledigt markiert sie als erledigt', async () => {
    const service = await startService({ dev: true });
    try {
      assert.equal(admin(service, 'meldungen').out, 'Keine offenen Meldungen.');
      const [anna, ben] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben')];
      await befriend(service.url, anna, ben);
      await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: ben.token, body: { text: 'Du bist so schlecht' } });
      await api(service.url, 'POST', `/v1/messages/${ben.uuid}`, { token: anna.token, body: { text: 'Hör auf damit' } });
      await api(service.url, 'POST', '/v1/reports', { token: anna.token, body: { uuid: ben.uuid, reason: 'harassment', note: 'seit Tagen' } });
      await api(service.url, 'POST', '/v1/reports', { token: ben.token, body: { uuid: anna.uuid, reason: 'spam' } });

      const list = admin(service, 'meldungen');
      assert.equal(list.code, 0);
      assert.match(list.out, /^2 offene Meldungen/);
      for (const part of [
        'Meldung 1 · ',
        `Von:    Anna (${anna.uuid})`,
        `Über:   Ben (${ben.uuid})`,
        'Grund:  Belästigung',
        'Notiz:  seit Tagen',
        'Nachrichten (letzte 2, älteste zuerst):',
        'Ben: Du bist so schlecht',
        'Anna: Hör auf damit',
        'Meldung 2 · ',
        'Grund:  Spam',
      ]) {
        assert.ok(list.out.includes(part), `fehlt: ${part}\n${list.out}`);
      }
      assert.ok(list.out.indexOf('Meldung 1') < list.out.indexOf('Meldung 2'), 'älteste zuerst');

      const done = admin(service, 'meldung-erledigt', '1');
      assert.equal(done.code, 0);
      assert.equal(done.out, 'Meldung 1 ist als erledigt markiert. Sie bleibt bis zum Ablauf nach 90 Tagen gespeichert.');
      const again = admin(service, 'meldung-erledigt', '1', 'abc', '99');
      assert.equal(again.code, 1);
      assert.equal(again.out, 'Meldung 1 war schon erledigt.');
      assert.ok(again.err.includes('„abc“ ist keine Nummer'));
      assert.ok(again.err.includes('Meldung 99 gibt es nicht'));
      assert.equal(admin(service, 'meldung-erledigt').code, 2);
      const rest = admin(service, 'meldungen').out;
      assert.ok(!rest.includes('Meldung 1 ·') && rest.includes('Meldung 2 ·'));
      // Mit „alle“ auch die erledigten, mit Datum und „von CLI“.
      const all = admin(service, 'meldungen', 'alle').out;
      assert.match(all, /Meldung 1 · \d\d\.\d\d\.\d{4} \d\d:\d\d · erledigt am \d\d\.\d\d\.\d{4} \d\d:\d\d von CLI/);
      assert.equal(admin(service, 'meldungen', 'kaputt').code, 2);
      assert.equal(admin(service, 'meldung-erledigt', '2').code, 0);
      assert.equal(admin(service, 'meldungen').out, 'Keine offenen Meldungen.');
      // Gespeichert bleiben sie, mit Status.
      const store = new Store(service.dataDir);
      try {
        assert.deepEqual(store.listReports().map((r) => [r.id, r.status, r.doneBy]), [
          [1, 'done', null],
          [2, 'done', null],
        ]);
        assert.deepEqual(store.listAudit(10).map((e) => [e.action, e.actorName, e.actorUuid]), [
          ['report.done', 'CLI', null],
          ['report.done', 'CLI', null],
        ]);
      } finally {
        store.close();
      }
    } finally {
      await service.close();
    }
  });

  test('Steuerzeichen landen nie im Terminal; falsche Aufrufe und fehlende Datenbank', async () => {
    const service = await startService({ dev: true });
    try {
      // Direkt in die Datenbank (die Schnittstelle lässt solche Zeichen gar nicht erst zu).
      const store = new Store(service.dataDir);
      store.insertReport({
        reporter: randomUuid(),
        reporterName: 'A\u001b[2J',
        reported: randomUuid(),
        reportedName: 'B',
        reason: 'other',
        note: 'Notiz\u001b]0;x\u0007',
        messages: '[]',
        at: Date.now(),
      });
      store.close();
      const out = admin(service, 'meldungen').out;
      assert.equal(/[\u0000-\u001f\u007f]/.test(out.replaceAll('\n', '')), false);

      assert.equal(admin(service).code, 2);
      assert.equal(admin(service, 'hilfe').code, 0);
      const unknown = admin(service, 'loeschen');
      assert.equal(unknown.code, 2);
      assert.ok(unknown.err.includes('Unbekannter Befehl: loeschen'));
    } finally {
      await service.close();
    }

    // Falscher Ordner: Fehler, und es wird keine leere Datenbank angelegt.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-dienst-admin-'));
    try {
      const err: string[] = [];
      const code = runAdmin(['meldungen'], empty, { out: () => {}, err: (line) => err.push(line) });
      assert.equal(code, 1);
      assert.ok(err[0]!.startsWith('Keine Datenbank gefunden'));
      assert.deepEqual(fs.readdirSync(empty), []);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('Verwaltung: Sperren', () => {
  test('sperren löscht alles beim Dienst und verhindert die Anmeldung; entsperren hebt das auf', async () => {
    const mojang = await startFakeMojang();
    const service = await startService({ dev: true, sessionServer: mojang.url });
    try {
      const uuid = randomUuid();
      const login = await mojangLogin(service, mojang, 'Stoerer', uuid);
      assert.equal(login.status, 200);
      const stoerer = { uuid, name: 'Stoerer', token: login.body.token as string };
      const [anna, ben, carla] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben'), await devPlayer(service.url, 'Carla')];
      await befriend(service.url, stoerer, anna);
      await api(service.url, 'POST', `/v1/messages/${anna.uuid}`, { token: stoerer.token, body: { text: 'Spam Spam Spam' } });
      await api(service.url, 'POST', '/v1/friends/requests', { token: stoerer.token, body: { name: 'Ben' } });
      await api(service.url, 'POST', '/v1/blocks', { token: stoerer.token, body: { name: 'Carla' } });
      await api(service.url, 'POST', '/v1/reports', { token: anna.token, body: { uuid, reason: 'spam' } });
      await api(service.url, 'POST', '/v1/reports', { token: stoerer.token, body: { uuid: carla.uuid, reason: 'other' } });

      const banned = admin(service, 'sperren', 'stoerer', 'Spam', 'im', 'Chat');
      assert.equal(banned.code, 0, banned.err);
      assert.ok(banned.out.startsWith(`Stoerer (${uuid}) ist jetzt gesperrt.`), banned.out);

      // Altes Token gilt nicht mehr, neue Anmeldung (Mojang und Entwicklungsweg) wird abgelehnt.
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: stoerer.token })).status, 401);
      const again = await mojangLogin(service, mojang, 'Stoerer', uuid);
      assert.equal(again.status, 403);
      assert.deepEqual(again.body, { error: BANNED });
      const dev = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Stoerer', uuid } });
      assert.equal(dev.status, 403);
      // Ein Namenswechsel hilft nicht: Es zählt die UUID.
      assert.equal((await mojangLogin(service, mojang, 'NeuerName', uuid)).status, 403);

      // Freundschaft, Nachrichten, Anfragen, Blockierungen: weg.
      const annaFriends = (await api(service.url, 'GET', '/v1/friends', { token: anna.token })).body;
      assert.deepEqual([annaFriends.friends, annaFriends.unread], [[], {}]);
      assert.deepEqual((await api(service.url, 'GET', '/v1/messages', { token: anna.token })).body, { conversations: [] });
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.incoming, []);
      assert.equal((await api(service.url, 'POST', '/v1/friends/requests', { token: carla.token, body: { name: 'Stoerer' } })).status, 404);
      // Meldungen bleiben (über ihn und von ihm), bis sie ablaufen.
      const reports = admin(service, 'meldungen').out;
      assert.ok(reports.includes(`Über:   Stoerer (${uuid})  [gesperrt]`), reports);
      assert.ok(reports.includes(`Von:    Stoerer (${uuid})`), reports);

      const list = admin(service, 'gesperrt');
      assert.equal(list.code, 0);
      assert.match(list.out, /^1 Sperre \(neueste zuerst\):\n {2}\d\d\.\d\d\.\d{4} \d\d:\d\d {2}Stoerer \([0-9a-f]{32}\) – Spam im Chat$/);

      // Zweimal sperren: Hinweis, Grund bleibt.
      const twice = admin(service, 'sperren', uuid);
      assert.equal(twice.code, 0);
      assert.ok(twice.out.includes('war schon gesperrt'));
      assert.ok(admin(service, 'gesperrt').out.endsWith('– Spam im Chat'));

      // Entsperren per Name (ohne Groß-/Kleinschreibung): Anmeldung geht wieder, mit frischem Konto.
      const unbanned = admin(service, 'entsperren', 'STOERER');
      assert.equal(unbanned.code, 0, unbanned.err);
      assert.equal(admin(service, 'gesperrt').out, 'Niemand ist gesperrt.');
      const back = await mojangLogin(service, mojang, 'Stoerer', uuid);
      assert.equal(back.status, 200);
      const me = await api(service.url, 'GET', '/v1/me', { token: back.body.token });
      assert.deepEqual(me.body, { uuid, name: 'Stoerer', cape: '', visible: true, presence: true, showServer: true, messages: true });
      assert.equal(admin(service, 'entsperren', 'Stoerer').code, 1);
    } finally {
      await service.close();
      await mojang.close();
    }
  });

  test('sperren per UUID (auch mit Bindestrichen) für Spieler, die nie online waren; falsche Angaben', async () => {
    const mojang = await startFakeMojang();
    const service = await startService({ sessionServer: mojang.url });
    try {
      const uuid = randomUuid();
      const dashed = `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`.toUpperCase();
      const result = admin(service, 'sperren', dashed);
      assert.equal(result.code, 0, result.err);
      assert.ok(result.out.startsWith(`${uuid} ist jetzt gesperrt.`), result.out);
      assert.equal((await mojangLogin(service, mojang, 'Unbekannt', uuid)).status, 403);

      assert.equal(admin(service, 'sperren').code, 2);
      assert.equal(admin(service, 'sperren', 'GibtEsNicht').code, 1);
      assert.equal(admin(service, 'sperren', 'kein-name!').code, 1);
      assert.equal(admin(service, 'entsperren').code, 2);
      assert.equal(admin(service, 'entsperren', 'GibtEsNicht').code, 1);
      assert.equal(admin(service, 'entsperren', uuid).code, 0);
      assert.equal((await mojangLogin(service, mojang, 'Unbekannt', uuid)).status, 200);
    } finally {
      await service.close();
      await mojang.close();
    }
  });

  test('eine Sperre überdauert das Löschen des Kontos', async () => {
    const service = await startService({ dev: true });
    try {
      const player = await devPlayer(service.url, 'Weg');
      const store = new Store(service.dataDir);
      try {
        store.ban(player.uuid, player.name, 'Test', Date.now());
        store.deleteUser(player.uuid);
        assert.equal(store.getBan(player.uuid)?.name, 'Weg');
      } finally {
        store.close();
      }
      assert.equal((await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Weg', uuid: player.uuid } })).status, 403);
    } finally {
      await service.close();
    }
  });
});

describe('Verwaltung: Team', () => {
  test('team, team-liste, team-2fa-reset, team-entfernen; nur Spieler, die schon angemeldet waren', async () => {
    const service = await startService({ dev: true });
    try {
      assert.match(admin(service, 'team-liste').out, /^Das Team ist leer/);
      const chef = await devPlayer(service.url, 'Chefin');
      const ben = await devPlayer(service.url, 'Ben');
      let res = admin(service, 'team', 'chefin', 'admin');
      assert.equal(res.code, 0, res.err);
      assert.ok(res.out.startsWith(`Chefin (${chef.uuid}) ist jetzt im Team (admin).`), res.out);
      assert.ok(res.out.includes('Zwei-Faktor-Anmeldung'));
      assert.equal(admin(service, 'team', 'Chefin', 'admin').out, `Chefin (${chef.uuid}) ist schon admin.`);
      assert.equal(admin(service, 'team', 'Ben', 'moderator').code, 0);
      assert.equal(admin(service, 'team', 'Ben', 'admin').out.split('\n')[0], `Ben (${ben.uuid}) ist jetzt admin.`);
      for (const args of [['team'], ['team', 'Ben'], ['team', 'Ben', 'chef'], ['team-entfernen'], ['team-2fa-reset']]) {
        assert.equal(admin(service, ...args).code, 2, args.join(' '));
      }
      assert.equal(admin(service, 'team', 'GibtEsNicht', 'admin').code, 1);
      assert.equal(admin(service, 'team', 'kein-name!', 'admin').code, 1);

      res = admin(service, 'team-liste');
      assert.match(res.out, /^2 Team-Mitglieder:/);
      assert.match(res.out, /admin {6}Chefin \([0-9a-f]{32}\) · seit .* \(von CLI\) · 2FA nicht eingerichtet/);

      assert.equal(admin(service, 'team-2fa-reset', 'Chefin').code, 0);
      assert.equal(admin(service, 'team-2fa-reset', 'GibtEsNicht').code, 1);
      res = admin(service, 'team-entfernen', 'Ben');
      assert.equal(res.code, 0);
      assert.equal(admin(service, 'team-entfernen', 'Ben').code, 1, 'nicht mehr im Team');
      res = admin(service, 'team-entfernen', chef.uuid);
      assert.ok(res.out.includes('keinen Admin mehr'), res.out);

      const store = new Store(service.dataDir);
      try {
        assert.deepEqual(store.listTeam(), []);
        assert.deepEqual(
          store.listAudit(10).map((e) => e.action).reverse(),
          ['team.add', 'team.add', 'team.role', 'team.reset-2fa', 'team.remove', 'team.remove'],
        );
        assert.ok(store.listAudit(10).every((e) => e.actorName === 'CLI' && e.actorUuid === null));
      } finally {
        store.close();
      }
    } finally {
      await service.close();
    }
  });
});
