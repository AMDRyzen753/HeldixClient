// Echtzeit: WebSocket, Online-Status für Freunde und Nachschlagen von Spielern.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Store, type AddonVersionRow } from '../src/db';
import { api, connect, devPlayer, startService, upgradeStatus, waitFor, type Player, type TestService, type WsClient } from './helpers';

/** Veröffentlichte Version eines Community-Addons (wie nach der Freigabe), direkt für die Datenbank. */
function communityAddon(id: string, author: Player, manifest?: string): AddonVersionRow {
  const version = '1.0.0';
  const file = `heldix-addon-${id}-${version}.jar`;
  return {
    id,
    version,
    manifest:
      manifest ??
      JSON.stringify({
        type: 'heldix-addon',
        id,
        name: 'Test-Addon',
        version,
        summary: 'Zeigt etwas im HUD an.',
        description: '',
        authors: [author.name],
        api: 1,
        icon: 'clock',
        category: 'hud',
        platforms: [],
        file,
        size: 100,
        sha256: 'a'.repeat(64),
        date: '2026-11-25',
        notes: [],
        official: false,
        author: { uuid: author.uuid, name: author.name },
      }),
    signature: 'x'.repeat(88),
    file,
    size: 100,
    sha256: 'a'.repeat(64),
    publishedAt: Date.now(),
    publishedBy: 'Admin',
  };
}

/** Ändert die Datenbank des laufenden Dienstes direkt (wie die CLI). */
function withStore(service: TestService, change: (store: Store) => void): void {
  const store = new Store(service.dataDir);
  try {
    change(store);
  } finally {
    store.close();
  }
}

/** Macht zwei Spieler zu Freunden. */
async function befriend(service: TestService, a: Player, b: Player): Promise<void> {
  const sent = await api(service.url, 'POST', '/v1/friends/requests', { token: a.token, body: { name: b.name } });
  assert.equal(sent.status, 200);
  const accepted = await api(service.url, 'POST', `/v1/friends/requests/${a.uuid}/accept`, { token: b.token });
  assert.equal(accepted.status, 200);
}

describe('WebSocket und Online-Status', () => {
  let service: TestService;
  let anna: Player;
  let ben: Player;
  const open: WsClient[] = [];

  before(async () => {
    service = await startService({ dev: true });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    await befriend(service, anna, ben);
  });
  after(async () => {
    for (const client of open) await client.close();
    await service.close();
  });

  async function online(player: Player) {
    const result = await connect(service.wsUrl, player.token);
    open.push(result.client);
    return result;
  }

  test('nach dem Verbinden kommt sofort die Freundesliste', async () => {
    const { client, friends } = await online(ben);
    assert.equal(friends.type, 'friends');
    assert.equal(friends.friends.length, 1);
    assert.equal(friends.friends[0].uuid, anna.uuid);
    assert.equal(friends.friends[0].online, false);
    assert.deepEqual(friends.incoming, []);
    assert.deepEqual(friends.outgoing, []);
    client.send({ type: 'ping' });
    assert.deepEqual(await client.next('pong'), { type: 'pong' });
  });

  test('Freund kommt online, meldet Status, geht offline', async () => {
    const benClient = open[0]!;
    benClient.drain();

    const { client: annaClient, friends } = await online(anna);
    assert.equal(friends.friends[0].uuid, ben.uuid);
    assert.equal(friends.friends[0].online, true);

    let msg = await benClient.next('friend');
    assert.deepEqual(msg.friend, { uuid: anna.uuid, name: 'Anna', online: true, state: null, server: null, since: msg.friend.since });

    annaClient.send({ type: 'status', state: 'multiplayer', server: 'Mc.Hypixel.NET' });
    msg = await benClient.next('friend');
    assert.equal(msg.friend.state, 'multiplayer');
    assert.equal(msg.friend.server, 'mc.hypixel.net');

    // Ungültige Server-Adressen werden zu null.
    for (const server of ['192.168.178.20', 'localhost', 'minecraft', 'fritz.box', 'server.local', '[::1]', 'a'.repeat(250) + '.net', 42]) {
      annaClient.send({ type: 'status', state: 'multiplayer', server: 'play.example.org' });
      assert.equal((await benClient.next('friend')).friend.server, 'play.example.org');
      annaClient.send({ type: 'status', state: 'multiplayer', server });
      const update = await benClient.next('friend');
      assert.equal(update.friend.state, 'multiplayer');
      assert.equal(update.friend.server, null, `server ${String(server)}`);
    }

    // Außerhalb von Mehrspieler gibt es keinen Server.
    annaClient.send({ type: 'status', state: 'singleplayer', server: 'hypixel.net' });
    msg = await benClient.next('friend');
    assert.equal(msg.friend.state, 'singleplayer');
    assert.equal(msg.friend.server, null);

    // Gleicher Status noch einmal: keine neue Nachricht. Ungültiger Status: ignoriert.
    annaClient.send({ type: 'status', state: 'singleplayer', server: null });
    annaClient.send({ type: 'status', state: 'unterwegs', server: null });
    annaClient.send({ type: 'gibtsnicht' });
    await annaClient.sync();
    await benClient.sync();
    assert.deepEqual(benClient.drain(), []);

    // Die REST-Liste zeigt dasselbe.
    const list = await api(service.url, 'GET', '/v1/friends', { token: ben.token });
    assert.equal(list.body.friends[0].online, true);
    assert.equal(list.body.friends[0].state, 'singleplayer');

    await annaClient.close();
    open.splice(open.indexOf(annaClient), 1);
    msg = await benClient.next('friend');
    assert.deepEqual(msg.friend, { uuid: anna.uuid, name: 'Anna', online: false, state: null, server: null, since: msg.friend.since });
  });

  test('showServer aus: Status ja, Server nein', async () => {
    const benClient = open[0]!;
    const { client: annaClient } = await online(anna);
    await benClient.next((m) => m.type === 'friend' && m.friend.online);

    annaClient.send({ type: 'status', state: 'multiplayer', server: 'hypixel.net' });
    assert.equal((await benClient.next('friend')).friend.server, 'hypixel.net');

    const put = await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { showServer: false } });
    assert.equal(put.status, 200);
    let msg = await benClient.next('friend');
    assert.equal(msg.friend.online, true);
    assert.equal(msg.friend.state, 'multiplayer');
    assert.equal(msg.friend.server, null);

    annaClient.send({ type: 'status', state: 'multiplayer', server: 'gommehd.net' });
    await annaClient.sync();
    await benClient.sync();
    // Anderer Server, aber für Ben sieht es gleich aus: keine Nachricht.
    assert.deepEqual(benClient.drain(), []);
    const list = await api(service.url, 'GET', '/v1/friends', { token: ben.token });
    assert.equal(list.body.friends[0].server, null);

    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { showServer: true } });
    msg = await benClient.next('friend');
    assert.equal(msg.friend.server, 'gommehd.net');
  });

  test('presence aus: Freund erscheint immer offline', async () => {
    const benClient = open[0]!;
    const annaClient = open[1]!;
    benClient.drain();

    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { presence: false } });
    let msg = await benClient.next('friend');
    assert.deepEqual(msg.friend, { uuid: anna.uuid, name: 'Anna', online: false, state: null, server: null, since: msg.friend.since });

    // Statusänderungen bleiben unsichtbar.
    annaClient.send({ type: 'status', state: 'realms', server: null });
    await annaClient.sync();
    await benClient.sync();
    assert.deepEqual(benClient.drain(), []);
    const list = await api(service.url, 'GET', '/v1/friends', { token: ben.token });
    assert.deepEqual(
      { online: list.body.friends[0].online, state: list.body.friends[0].state, server: list.body.friends[0].server },
      { online: false, state: null, server: null },
    );

    // Eine zweite Verbindung ändert daran nichts.
    const second = await online(anna);
    await benClient.sync();
    assert.deepEqual(benClient.drain(), []);
    await second.client.close();
    open.splice(open.indexOf(second.client), 1);

    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { presence: true } });
    msg = await benClient.next('friend');
    assert.equal(msg.friend.online, true);
    assert.equal(msg.friend.state, 'realms');
  });

  test('mehrere Verbindungen: online bis zur letzten, zuletzt gemeldeter Status gilt', async () => {
    const benClient = open[0]!;
    const annaFirst = open[1]!;
    benClient.drain();
    const { client: annaSecond } = await online(anna);
    await annaSecond.sync();
    await benClient.sync();
    assert.deepEqual(benClient.drain(), [], 'zweite Verbindung ändert nichts');

    annaSecond.send({ type: 'status', state: 'lan', server: null });
    assert.equal((await benClient.next('friend')).friend.state, 'lan');
    annaFirst.send({ type: 'status', state: 'menu', server: null });
    assert.equal((await benClient.next('friend')).friend.state, 'menu');

    await annaFirst.close();
    open.splice(open.indexOf(annaFirst), 1);
    await annaSecond.sync();
    await benClient.sync();
    assert.deepEqual(benClient.drain(), [], 'noch eine Verbindung offen');

    await annaSecond.close();
    const msg = await benClient.next('friend');
    assert.equal(msg.friend.online, false);
  });
});

describe('Anfragen in Echtzeit', () => {
  let service: TestService;
  before(async () => {
    service = await startService({ dev: true });
  });
  after(() => service.close());

  test('request, accepted und friends gehen an beide Seiten', async () => {
    const carla = await devPlayer(service.url, 'Carla');
    const dirk = await devPlayer(service.url, 'Dirk');
    const { client: carlaClient } = await connect(service.wsUrl, carla.token);
    const { client: dirkClient } = await connect(service.wsUrl, dirk.token);
    try {
      carlaClient.send({ type: 'status', state: 'multiplayer', server: 'hypixel.net' });
      await carlaClient.sync();

      await api(service.url, 'POST', '/v1/friends/requests', { token: carla.token, body: { name: 'dirk' } });
      await dirkClient.sync();
      const dirkMessages = dirkClient.drain();
      assert.deepEqual(
        dirkMessages.map((m) => m.type),
        ['request', 'friends'],
      );
      assert.deepEqual(dirkMessages[0], { type: 'request', from: { uuid: carla.uuid, name: 'Carla' } });
      assert.deepEqual(dirkMessages[1].incoming.map((r: { uuid: string }) => r.uuid), [carla.uuid]);
      await carlaClient.sync();
      const carlaFriends = carlaClient.drain();
      assert.deepEqual(
        carlaFriends.map((m) => m.type),
        ['friends'],
      );
      assert.deepEqual(carlaFriends[0].outgoing.map((r: { uuid: string }) => r.uuid), [dirk.uuid]);

      // Dirk nimmt an: Carla bekommt accepted (mit Dirks Status) und danach friends.
      await api(service.url, 'POST', `/v1/friends/requests/${carla.uuid}/accept`, { token: dirk.token });
      await carlaClient.sync();
      const carlaMessages = carlaClient.drain();
      assert.deepEqual(
        carlaMessages.map((m) => m.type),
        ['accepted', 'friends'],
      );
      assert.equal(carlaMessages[0].friend.uuid, dirk.uuid);
      assert.equal(carlaMessages[0].friend.online, true);
      assert.equal(carlaMessages[1].friends[0].uuid, dirk.uuid);
      await dirkClient.sync();
      const dirkAfter = dirkClient.drain();
      assert.deepEqual(
        dirkAfter.map((m) => m.type),
        ['friends'],
      );
      // Carla ist für Dirk online, mit Server.
      assert.deepEqual(
        { online: dirkAfter[0].friends[0].online, state: dirkAfter[0].friends[0].state, server: dirkAfter[0].friends[0].server },
        { online: true, state: 'multiplayer', server: 'hypixel.net' },
      );

      // Entfernen: beide bekommen friends.
      await api(service.url, 'DELETE', `/v1/friends/${carla.uuid}`, { token: dirk.token });
      await carlaClient.sync();
      await dirkClient.sync();
      assert.deepEqual(carlaClient.drain().map((m) => [m.type, m.friends.length]), [['friends', 0]]);
      assert.deepEqual(dirkClient.drain().map((m) => [m.type, m.friends.length]), [['friends', 0]]);

      // Gegenseitige Anfrage: die erste Seite bekommt accepted.
      await api(service.url, 'POST', '/v1/friends/requests', { token: dirk.token, body: { name: 'Carla' } });
      await api(service.url, 'POST', '/v1/friends/requests', { token: carla.token, body: { name: 'Dirk' } });
      await dirkClient.sync();
      assert.deepEqual(
        dirkClient.drain().map((m) => m.type),
        ['friends', 'accepted', 'friends'],
      );

      // Ablehnen: beide bekommen friends.
      await api(service.url, 'DELETE', `/v1/friends/${dirk.uuid}`, { token: carla.token });
      await api(service.url, 'POST', '/v1/friends/requests', { token: dirk.token, body: { name: 'Carla' } });
      await carlaClient.sync();
      await dirkClient.sync();
      carlaClient.drain();
      dirkClient.drain();
      await api(service.url, 'DELETE', `/v1/friends/requests/${dirk.uuid}`, { token: carla.token });
      await carlaClient.sync();
      await dirkClient.sync();
      assert.deepEqual(carlaClient.drain().map((m) => [m.type, m.incoming.length]), [['friends', 0]]);
      assert.deepEqual(dirkClient.drain().map((m) => [m.type, m.outgoing.length]), [['friends', 0]]);
    } finally {
      await carlaClient.close();
      await dirkClient.close();
    }
  });
});

describe('Spieler nachschlagen', () => {
  test('nur verbundene Spieler mit visible an', async () => {
    const service = await startService({ dev: true });
    const clients: WsClient[] = [];
    try {
      const sichtbar = await devPlayer(service.url, 'Sichtbar');
      const versteckt = await devPlayer(service.url, 'Versteckt');
      const offline = await devPlayer(service.url, 'Offline');
      await api(service.url, 'PUT', '/v1/me', { token: sichtbar.token, body: { cape: 'galaxie' } });
      await api(service.url, 'PUT', '/v1/me', { token: versteckt.token, body: { visible: false, cape: 'neon' } });
      await api(service.url, 'PUT', '/v1/me', { token: offline.token, body: { cape: 'glut' } });
      clients.push((await connect(service.wsUrl, sichtbar.token)).client);
      clients.push((await connect(service.wsUrl, versteckt.token)).client);

      const uuids = [sichtbar.uuid, versteckt.uuid, offline.uuid, 'f'.repeat(32), sichtbar.uuid];
      let res = await api(service.url, 'POST', '/v1/players/lookup', { token: offline.token, body: { uuids } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { players: { [sichtbar.uuid]: { cape: 'galaxie', badge: null, cosmetics: { head: null, back: null, aura: null, companion: null } } } });

      // Wer selbst verbunden und sichtbar ist, steht mit drin.
      res = await api(service.url, 'POST', '/v1/players/lookup', { token: sichtbar.token, body: { uuids: [sichtbar.uuid] } });
      assert.deepEqual(res.body, { players: { [sichtbar.uuid]: { cape: 'galaxie', badge: null, cosmetics: { head: null, back: null, aura: null, companion: null } } } });

      // Nach dem Trennen nicht mehr (der Dienst bemerkt das Trennen kurz nach dem Client).
      await clients[0]!.close();
      await waitFor(async () => {
        res = await api(service.url, 'POST', '/v1/players/lookup', { token: offline.token, body: { uuids } });
        return Object.keys(res.body.players).length === 0;
      });
      assert.deepEqual(res.body, { players: {} });

      // Kein Cape: "".
      await api(service.url, 'PUT', '/v1/me', { token: versteckt.token, body: { visible: true, cape: '' } });
      res = await api(service.url, 'POST', '/v1/players/lookup', { token: offline.token, body: { uuids } });
      assert.deepEqual(res.body, { players: { [versteckt.uuid]: { cape: '', badge: null, cosmetics: { head: null, back: null, aura: null, companion: null } } } });
    } finally {
      for (const client of clients) await client.close();
      await service.close();
    }
  });

  test('ungültige Abfragen: 400', async () => {
    const service = await startService({ dev: true });
    try {
      const player = await devPlayer(service.url);
      const tooMany = Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(32, '0'));
      const exactly = tooMany.slice(0, 200);
      for (const body of [{}, { uuids: 'abc' }, { uuids: ['ABC'] }, { uuids: [42] }, { uuids: tooMany }]) {
        const res = await api(service.url, 'POST', '/v1/players/lookup', { token: player.token, body });
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      }
      const ok = await api(service.url, 'POST', '/v1/players/lookup', { token: player.token, body: { uuids: exactly } });
      assert.equal(ok.status, 200);
    } finally {
      await service.close();
    }
  });

  test('Rolle fürs Heldix-Symbol: Team nur mit öffentlichem Teamprofil, Entwickler mit sichtbarem Community-Addon', async () => {
    const service = await startService({ dev: true });
    const clients: WsClient[] = [];
    try {
      const admin = await devPlayer(service.url, 'Admina');
      const leiseAdmin = await devPlayer(service.url, 'LeiseAdmin');
      const mod = await devPlayer(service.url, 'Moderata');
      const leiseMod = await devPlayer(service.url, 'LeiseMod');
      const dev = await devPlayer(service.url, 'Entwickla');
      const versteckt = await devPlayer(service.url, 'NurVersteckt');
      const kaputt = await devPlayer(service.url, 'KaputtesManifest');
      const spieler = await devPlayer(service.url, 'Spielerin');
      const fragt = await devPlayer(service.url, 'Fragt');
      const all = [admin, leiseAdmin, mod, leiseMod, dev, versteckt, kaputt, spieler];
      withStore(service, (store) => {
        const now = Date.now();
        store.setTeamMember(admin.uuid, 'admin', now, null);
        store.setTeamProfile(admin.uuid, { public: true });
        store.insertAddonVersion(communityAddon('admin-addon', admin), admin.uuid);
        // Admin ohne öffentliches Teamprofil, aber mit Addon: nur Entwickler, die Team-Rolle bleibt verborgen
        store.setTeamMember(leiseAdmin.uuid, 'admin', now, null);
        store.insertAddonVersion(communityAddon('leise-addon', leiseAdmin), leiseAdmin.uuid);
        store.setTeamMember(mod.uuid, 'moderator', now, null);
        store.setTeamProfile(mod.uuid, { public: true });
        store.setTeamMember(leiseMod.uuid, 'moderator', now, null);
        store.insertAddonVersion(communityAddon('entwickler-addon', dev), dev.uuid);
        store.insertAddonVersion(communityAddon('versteckt-addon', versteckt), versteckt.uuid);
        store.setAddonHidden('versteckt-addon', true);
        // Manifest unlesbar: das Addon steht nicht im Store, also auch kein Entwickler (wie bei der Entwicklerseite)
        store.insertAddonVersion(communityAddon('kaputt-addon', kaputt, '{"type":"heldix-addon"}'), kaputt.uuid);
        // Addons des Teams (owner null) machen niemanden zum Entwickler, auch nicht den Autor im Manifest
        store.insertAddonVersion(communityAddon('offiziell-addon', spieler));
      });
      for (const player of [...all, fragt]) clients.push((await connect(service.wsUrl, player.token)).client);

      const badges = async () => {
        const res = await api(service.url, 'POST', '/v1/players/lookup', { token: fragt.token, body: { uuids: all.map((p) => p.uuid) } });
        assert.equal(res.status, 200);
        return Object.fromEntries(Object.entries(res.body.players as Record<string, { badge: unknown }>).map(([uuid, entry]) => [uuid, entry.badge]));
      };
      assert.deepEqual(await badges(), {
        [admin.uuid]: 'admin',
        [leiseAdmin.uuid]: 'developer',
        [mod.uuid]: 'moderator',
        [leiseMod.uuid]: null,
        [dev.uuid]: 'developer',
        [versteckt.uuid]: null,
        [kaputt.uuid]: null,
        [spieler.uuid]: null,
      });
      // dieselbe Bedingung wie die öffentliche Entwicklerseite
      assert.equal((await api(service.url, 'GET', `/v1/addon-authors/${dev.uuid}`)).status, 200);
      assert.equal((await api(service.url, 'GET', `/v1/addon-authors/${versteckt.uuid}`)).status, 404);
      assert.equal((await api(service.url, 'GET', `/v1/addon-authors/${kaputt.uuid}`)).status, 404);

      // Teamprofil nicht mehr öffentlich, Addon versteckt: sofort ohne Rolle
      withStore(service, (store) => {
        store.setTeamProfile(mod.uuid, { public: false });
        store.setAddonHidden('entwickler-addon', true);
        store.setTeamProfile(leiseMod.uuid, { public: true });
      });
      const after = await badges();
      assert.equal(after[mod.uuid], null);
      assert.equal(after[dev.uuid], null);
      assert.equal(after[leiseMod.uuid], 'moderator');

      // „Für andere erkennbar“ aus: gar nicht in der Antwort, also auch keine Rolle
      await api(service.url, 'PUT', '/v1/me', { token: admin.token, body: { visible: false } });
      assert.equal(Object.hasOwn(await badges(), admin.uuid), false);
      // Wer selbst nachschlägt, sieht die eigene Rolle (für das eigene Symbol in der Tab-Liste)
      const own = await api(service.url, 'POST', '/v1/players/lookup', { token: leiseMod.token, body: { uuids: [leiseMod.uuid] } });
      assert.deepEqual(own.body, { players: { [leiseMod.uuid]: { cape: '', badge: 'moderator', cosmetics: { head: null, back: null, aura: null, companion: null } } } });
    } finally {
      for (const client of clients) await client.close();
      await service.close();
    }
  });
});

describe('Verbindungsdauer', () => {
  test('ohne Nachricht schließt der Dienst die Verbindung (im Test nach 150 ms), Ping hält sie offen', async () => {
    const service = await startService({ dev: true, idleTimeoutMs: 150 });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      await befriend(service, anna, ben);
      const { client: benClient } = await connect(service.wsUrl, ben.token);
      const { client: annaClient } = await connect(service.wsUrl, anna.token);
      await benClient.next((m) => m.type === 'friend' && m.friend.online);

      // Ben pingt regelmäßig, Anna schweigt.
      const pinger = setInterval(() => benClient.send({ type: 'ping' }), 40);
      try {
        const closed = await annaClient.closed;
        assert.equal(closed.code, 4000);
        const msg = await benClient.next((m) => m.type === 'friend' && !m.friend.online);
        assert.equal(msg.friend.uuid, anna.uuid);
        assert.equal(benClient.ws.readyState, benClient.ws.OPEN);
      } finally {
        clearInterval(pinger);
      }
      await benClient.close();
    } finally {
      await service.close();
    }
  });

  test('WebSocket nur unter /v1/ws; normales GET bekommt 426', async () => {
    const service = await startService({ dev: true });
    try {
      const player = await devPlayer(service.url);
      const wrong = await upgradeStatus(service.wsUrl.replace('/v1/ws', '/v1/me'), { Authorization: `Bearer ${player.token}` });
      assert.equal(wrong.status, 404);
      const plain = await api(service.url, 'GET', '/v1/ws', { token: player.token });
      assert.equal(plain.status, 426);
    } finally {
      await service.close();
    }
  });
});

describe('Server mit Port im Online-Status', () => {
  test('ein Port außer 25565 bleibt erhalten (zum Beitreten), 25565 fällt weg', async () => {
    const service = await startService({ dev: true });
    try {
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      await befriend(service, anna, ben);
      const { client: benClient } = await connect(service.wsUrl, ben.token);
      const { client: annaClient } = await connect(service.wsUrl, anna.token);
      try {
        await benClient.next((m) => m.type === 'friend' && m.friend.online);
        const cases: [string, string | null][] = [
          ['Play.Example.org:25570', 'play.example.org:25570'],
          ['play.example.org:25565', 'play.example.org'],
          ['mc.example.net', 'mc.example.net'],
          ['play.example.org:0', null],
          ['mc.example.net:19132', 'mc.example.net:19132'],
          ['192.168.178.20:25570', null],
        ];
        for (const [server, expected] of cases) {
          annaClient.send({ type: 'status', state: 'multiplayer', server });
          const msg = await benClient.next('friend');
          assert.equal(msg.friend.server, expected, server);
          const list = await api(service.url, 'GET', '/v1/friends', { token: ben.token });
          assert.equal(list.body.friends[0].server, expected, server);
        }
      } finally {
        await annaClient.close();
        await benClient.close();
      }
    } finally {
      await service.close();
    }
  });
});
