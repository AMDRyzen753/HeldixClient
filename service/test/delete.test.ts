// Konto löschen (DELETE /v1/me): Daten weg, Verbindungen zu, Freunde sehen die neue Liste.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  api,
  connect,
  devPlayer,
  randomUuid,
  startFakeMojang,
  startService,
  upgradeStatus,
  type Player,
  type TestService,
  ME_DEFAULTS,
} from './helpers';

const NOT_FOUND = 'Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).';

async function befriend(service: TestService, a: Player, b: Player): Promise<void> {
  assert.equal((await api(service.url, 'POST', '/v1/friends/requests', { token: a.token, body: { name: b.name } })).status, 200);
  assert.equal((await api(service.url, 'POST', `/v1/friends/requests/${a.uuid}/accept`, { token: b.token })).status, 200);
}

describe('Konto löschen', () => {
  test('löscht alles, schließt Verbindungen und aktualisiert die anderen', async () => {
    const service = await startService({ dev: true });
    try {
      const weg = await devPlayer(service.url, 'Loeschmich');
      const freund = await devPlayer(service.url, 'Freund');
      const freundOffline = await devPlayer(service.url, 'FreundOffline');
      const fragtAn = await devPlayer(service.url, 'FragtAn');
      const angefragt = await devPlayer(service.url, 'Angefragt');
      const fremd = await devPlayer(service.url, 'Fremd');

      await api(service.url, 'PUT', '/v1/me', { token: weg.token, body: { cape: 'glut', showServer: false } });
      await befriend(service, weg, freund);
      await befriend(service, freundOffline, weg);
      await api(service.url, 'POST', '/v1/friends/requests', { token: fragtAn.token, body: { name: 'Loeschmich' } });
      await api(service.url, 'POST', '/v1/friends/requests', { token: weg.token, body: { name: 'Angefragt' } });
      const before = await api(service.url, 'GET', '/v1/friends', { token: weg.token });
      assert.equal(before.body.friends.length, 2);
      assert.equal(before.body.incoming.length, 1);
      assert.equal(before.body.outgoing.length, 1);

      // Zwei Verbindungen des Spielers, dazu die Betroffenen und ein Unbeteiligter.
      const wegA = (await connect(service.wsUrl, weg.token)).client;
      const wegB = (await connect(service.wsUrl, weg.token)).client;
      const freundWs = (await connect(service.wsUrl, freund.token)).client;
      const fragtAnWs = (await connect(service.wsUrl, fragtAn.token)).client;
      const angefragtWs = (await connect(service.wsUrl, angefragt.token)).client;
      const fremdWs = (await connect(service.wsUrl, fremd.token)).client;
      try {
        // Vorher: Der Spieler ist verbunden und sichtbar.
        let lookup = await api(service.url, 'POST', '/v1/players/lookup', { token: fremd.token, body: { uuids: [weg.uuid] } });
        assert.deepEqual(lookup.body, { players: { [weg.uuid]: { cape: 'glut', badge: null, cosmetics: { head: null, back: null, aura: null, companion: null } } } });

        for (const client of [freundWs, fragtAnWs, angefragtWs, fremdWs]) {
          await client.sync();
          client.drain();
        }

        // Vorher steht der Name in den Datenbankdateien (sonst wäre die Prüfung unten wertlos).
        const dbFiles = () => fs.readdirSync(service.dataDir).map((file) => fs.readFileSync(path.join(service.dataDir, file)));
        assert.ok(dbFiles().some((content) => content.includes('oeschmich')));

        const res = await api(service.url, 'DELETE', '/v1/me', { token: weg.token });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { deleted: true });

        // Alle Verbindungen des Spielers werden mit 4001 geschlossen.
        for (const client of [wegA, wegB]) {
          const closed = await client.closed;
          assert.equal(closed.code, 4001);
          assert.equal(closed.reason, 'Konto gelöscht');
        }

        // Der frühere Freund bekommt eine neue Liste ohne den Spieler (und keine friend-Nachricht).
        await freundWs.sync();
        const freundMessages = freundWs.drain();
        assert.deepEqual(
          freundMessages.map((m) => m.type),
          ['friends'],
        );
        assert.deepEqual(freundMessages[0].friends, []);

        // Wer angefragt hat oder angefragt wurde, sieht die Anfrage nicht mehr.
        await fragtAnWs.sync();
        const fragtAnMessages = fragtAnWs.drain();
        assert.deepEqual(
          fragtAnMessages.map((m) => [m.type, m.outgoing.length]),
          [['friends', 0]],
        );
        await angefragtWs.sync();
        const angefragtMessages = angefragtWs.drain();
        assert.deepEqual(
          angefragtMessages.map((m) => [m.type, m.incoming.length]),
          [['friends', 0]],
        );

        // Unbeteiligte bekommen nichts.
        await fremdWs.sync();
        assert.deepEqual(fremdWs.drain(), []);

        // Wer offline war, sieht es beim nächsten Abruf.
        const offlineList = await api(service.url, 'GET', '/v1/friends', { token: freundOffline.token });
        assert.deepEqual(offlineList.body, { friends: [], incoming: [], outgoing: [], unread: {} });

        // Das alte Token gilt nicht mehr, auch nicht für den WebSocket.
        assert.equal((await api(service.url, 'GET', '/v1/me', { token: weg.token })).status, 401);
        assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: weg.token })).status, 401);
        assert.equal((await upgradeStatus(service.wsUrl, { Authorization: `Bearer ${weg.token}` })).status, 401);

        // Nachschlagen meldet ihn nicht mehr, und per Name ist er unbekannt.
        lookup = await api(service.url, 'POST', '/v1/players/lookup', { token: fremd.token, body: { uuids: [weg.uuid] } });
        assert.deepEqual(lookup.body, { players: {} });
        const request = await api(service.url, 'POST', '/v1/friends/requests', { token: fremd.token, body: { name: 'Loeschmich' } });
        assert.equal(request.status, 404);
        assert.equal(request.body.error, NOT_FOUND);

        // In den Datenbankdateien steht der Name nicht mehr (auch nicht im WAL).
        for (const content of dbFiles()) {
          assert.equal(content.includes('oeschmich'), false, 'Name noch in der Datenbank');
          assert.equal(content.includes(weg.uuid), false, 'UUID noch in der Datenbank');
        }
      } finally {
        for (const client of [wegA, wegB, freundWs, fragtAnWs, angefragtWs, fremdWs]) await client.close();
      }

      // Neue Anmeldung: frischer Spieler mit Standardwerten.
      const again = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'Loeschmich', uuid: weg.uuid } });
      assert.equal(again.status, 200);
      const me = await api(service.url, 'GET', '/v1/me', { token: again.body.token });
      assert.deepEqual(me.body, { uuid: weg.uuid, name: 'Loeschmich', cape: '', visible: true, presence: true, showServer: true, messages: true, ...ME_DEFAULTS });
      const list = await api(service.url, 'GET', '/v1/friends', { token: again.body.token });
      assert.deepEqual(list.body, { friends: [], incoming: [], outgoing: [], unread: {} });
      // Die anderen Spieler sind davon unberührt.
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: freund.token })).status, 200);
    } finally {
      await service.close();
    }
  });

  test('ohne Token: 401; Spieler ohne Freunde und Verbindungen geht auch', async () => {
    const service = await startService({ dev: true });
    try {
      assert.equal((await api(service.url, 'DELETE', '/v1/me')).status, 401);
      const allein = await devPlayer(service.url, 'Allein');
      const res = await api(service.url, 'DELETE', '/v1/me', { token: allein.token });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { deleted: true });
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: allein.token })).status, 401);
    } finally {
      await service.close();
    }
  });

  test('alle Tokens des Spielers verfallen, auch von anderen Anmeldungen', async () => {
    const service = await startService({ dev: true });
    try {
      const uuid = randomUuid();
      const first = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'ZweiPCs', uuid } });
      const second = await api(service.url, 'POST', '/v1/auth/dev', { body: { name: 'ZweiPCs', uuid } });
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: second.body.token })).status, 200);
      assert.equal((await api(service.url, 'GET', '/v1/me', { token: first.body.token })).status, 401);
    } finally {
      await service.close();
    }
  });

  test('neue Anmeldung über Mojang nach dem Löschen legt den Spieler frisch an', async () => {
    const mojang = await startFakeMojang();
    const service = await startService({ sessionServer: mojang.url });
    try {
      const uuid = randomUuid();
      const login = async () => {
        const serverId = (await api(service.url, 'POST', '/v1/auth/challenge')).body.serverId;
        mojang.join('Wiederkehr', serverId, uuid);
        const res = await api(service.url, 'POST', '/v1/auth/login', { body: { name: 'Wiederkehr', serverId } });
        assert.equal(res.status, 200);
        return res.body.token as string;
      };
      const token = await login();
      await api(service.url, 'PUT', '/v1/me', { token, body: { cape: 'neon', visible: false, presence: false } });
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token })).status, 200);

      const fresh = await login();
      const me = await api(service.url, 'GET', '/v1/me', { token: fresh });
      assert.deepEqual(me.body, { uuid, name: 'Wiederkehr', cape: '', visible: true, presence: true, showServer: true, messages: true, ...ME_DEFAULTS });
    } finally {
      await service.close();
      await mojang.close();
    }
  });
});
