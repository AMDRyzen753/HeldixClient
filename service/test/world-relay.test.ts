// Welt-Relay (ab 1.12.0) mit einem kleinen Test-Minecraft-Client über TCP: Handshake und Status (Welt zu, unbekannt,
// geöffnet über den Gastgeber), Login (zu, nicht eingeladen → Anklopfen, abgelehnt, erlaubt, eingeladen → Datenstrom mit
// genau den gepufferten Bytes zuerst und dann beidseitig), Zugang Freunde und offen, voll, Müll, zu lang, zu langsam,
// Teilpakete, Grenzen (Verbindungen je IP, Datenrate je Welt, Serverlisten-Abfragen), Datenströme nur für den Gastgeber.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import type { ServiceOptions } from '../src/app';
import { NEED_MORE, normalizeAddress, parseHandshake, ProtocolError, readPacket, readVarInt } from '../src/minecraft-protocol';
import { ipKey } from '../src/world-relay';
import { api, befriend, devPlayer, sleep, startService, upgradeStatus, type Player, type TestService, type WsClient } from './helpers';
import {
  createWorld,
  DOMAIN,
  handshake,
  hostConnect,
  loginStart,
  McClient,
  mcString,
  openStream,
  openWorld,
  packet,
  pingPacket,
  PROTOCOL,
  STATUS_REQUEST,
  varInt,
  type StreamClient,
} from './world-helpers';

const NOT_OPEN = 'Die Welt ist gerade nicht geöffnet.';

interface RelaySetup {
  service: TestService;
  player(name: string): Promise<Player>;
  /** Steuerverbindung mit geöffneter Welt (`members` nach `ready` schon gelesen). */
  host(player: Player, world: string, extra?: Record<string, unknown>): Promise<WsClient>;
  /** Neue TCP-Verbindung zum Relay. */
  mc(): Promise<McClient>;
  /** Datenstrom öffnen (wie der Gastgeber). */
  stream(player: Player, id: string): Promise<StreamClient>;
}

async function withRelay(options: Partial<ServiceOptions>, run: (setup: RelaySetup) => Promise<void>): Promise<void> {
  const service = await startService({ dev: true, weltDomain: DOMAIN, worldConnectionsPerMinute: 1000, ...options });
  assert.ok(service.relayPort !== null, 'Relay lauscht');
  const hosts: WsClient[] = [];
  const clients: McClient[] = [];
  const streams: StreamClient[] = [];
  try {
    await run({
      service,
      player: (name) => devPlayer(service.url, name),
      async host(player, world, extra = {}) {
        const client = await hostConnect(service, player.token);
        hosts.push(client);
        await openWorld(client, world, extra);
        await client.next('members');
        return client;
      },
      async mc() {
        const client = await McClient.connect(service.relayPort!);
        clients.push(client);
        return client;
      },
      async stream(player, id) {
        const client = await openStream(service, player.token, id);
        streams.push(client);
        return client;
      },
    });
  } finally {
    for (const client of clients) client.destroy();
    for (const client of streams) await client.close();
    for (const client of hosts) await client.close();
    await service.close();
  }
}

/** Status-Abfrage wie die Serverliste: Handshake, Anfrage, Antwort; dann Ping und Pong. */
async function serverList(client: McClient, address: string, protocol = PROTOCOL): Promise<any> {
  client.write(handshake(address, 1, protocol), STATUS_REQUEST);
  const status = await client.json();
  const payload = randomBytes(8);
  client.write(pingPacket(payload));
  const pong = await client.packet();
  assert.deepEqual([pong.id, pong.data], [0x01, payload]);
  await client.waitClosed();
  return status;
}

describe('Minecraft-Protokoll (Teile für das Relay)', () => {
  test('VarInt, Teilpakete, zu lange Pakete, Adresse bereinigen', () => {
    assert.deepEqual(readVarInt(Buffer.from([0xac, 0x02]), 0), { value: 300, next: 2 });
    assert.equal(readVarInt(Buffer.from([0xac]), 0), NEED_MORE);
    assert.throws(() => readVarInt(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x01]), 0), ProtocolError);
    const hs = handshake('ABCDEF.Welt.Test.\0FML3\0', 2, 767, 25570);
    for (let i = 0; i < hs.length; i++) assert.equal(readPacket(hs.subarray(0, i), 0, 300), NEED_MORE, `nach ${i} Byte`);
    const parsed = parseHandshake(readPacket(hs, 0, 300)!);
    assert.deepEqual(parsed, { protocol: 767, address: 'abcdef.welt.test', port: 25570, next: 2 });
    assert.throws(() => readPacket(hs, 0, 10), ProtocolError, 'länger als erlaubt');
    assert.throws(() => parseHandshake(readPacket(packet(0x00, Buffer.from([0x01]), mcString('a'.repeat(256)), Buffer.alloc(2), Buffer.from([1])), 0, 300)!), ProtocolError);
    const badState = packet(0x00, varInt(1), mcString('x.welt.test'), Buffer.alloc(2), varInt(7));
    assert.throws(() => parseHandshake(readPacket(badState, 0, 300)!), ProtocolError, 'Zustand 7');
    const trailing = packet(0x00, varInt(1), mcString('x.welt.test'), Buffer.alloc(2), varInt(1), Buffer.from([0]));
    assert.throws(() => parseHandshake(readPacket(trailing, 0, 300)!), ProtocolError, 'Bytes nach dem Zustand');
    assert.equal(normalizeAddress('k7m2xq.welt.heldixclient.com:25565'), 'k7m2xq.welt.heldixclient.com');
    assert.equal(normalizeAddress('K7M2XQ.WELT.test.'), 'k7m2xq.welt.test');
    assert.equal(ipKey('::ffff:192.168.1.5'), '192.168.1.5');
    assert.equal(ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
    assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  });
});

describe('Welt-Relay: Serverliste', () => {
  test('Welt zu: eigene Antwort (Version vom Client, 0/0, „Welt von … ist gerade nicht geöffnet“), Ping/Pong; unbekannt', async () => {
    await withRelay({}, async ({ service, player, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      const status = await serverList(await mc(), world.address, 770);
      assert.deepEqual(status, {
        version: { name: 'HeldixClient', protocol: 770 },
        players: { max: 0, online: 0 },
        description: { text: 'Welt von Anna ist gerade nicht geöffnet', color: 'gray' },
      });
      // Großschreibung, Punkt und Port am Ende, Mod-Kennung nach \0: dieselbe Welt
      const variant = await serverList(await mc(), `${world.code.toUpperCase()}.WELT.TEST.:25565\0FML3\0`);
      assert.equal(variant.description.text, 'Welt von Anna ist gerade nicht geöffnet');
      for (const address of ['zzzzzz.welt.test', 'welt.test', 'abc.example.net', '127.0.0.1']) {
        const unknown = await serverList(await mc(), address);
        assert.equal(unknown.description.text, 'Diese Welt gibt es nicht', address);
      }
    });
  });

  test('Welt geöffnet: Datenstrom „status“ zum Gastgeber, genau die Bytes, Antwort und Ping durchgereicht', async () => {
    await withRelay({}, async ({ service, player, host, mc, stream }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      const hostWs = await host(anna, world.id);
      const client = await mc();
      const hello = Buffer.concat([handshake(world.address, 1), STATUS_REQUEST]);
      client.write(hello);
      const message = await hostWs.next('stream');
      assert.deepEqual(Object.keys(message).sort(), ['id', 'kind', 'name', 'type'], 'keine IP, nichts weiter');
      assert.deepEqual([message.kind, message.name], ['status', null]);
      assert.match(message.id, /^[0-9a-f]{32}$/);
      const data = await stream(anna, message.id);
      assert.deepEqual(await data.bytes(hello.length), hello);
      // Der „integrierte Server“ antwortet
      const answer = packet(0x00, mcString(JSON.stringify({ version: { name: '26.3', protocol: PROTOCOL }, players: { max: 8, online: 1 }, description: { text: 'Echt' } })));
      data.send(answer);
      assert.equal((await client.json()).description.text, 'Echt');
      const ping = pingPacket(randomBytes(8));
      client.write(ping);
      assert.deepEqual(await data.bytes(ping.length), ping);
      data.send(pingPacket(ping.subarray(2)));
      assert.equal((await client.packet()).id, 0x01);
      // Gastgeber schließt den Datenstrom: Spieler wird getrennt
      await data.close();
      await client.waitClosed();
    });
  });

  test('zu viele Serverlisten-Abfragen je Welt: der Dienst antwortet selbst mit MOTD und Spielerzahl des Gastgebers', async () => {
    await withRelay({ worldStatusPerMinute: 1 }, async ({ service, player, host, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna, { maxPlayers: 6 });
      const hostWs = await host(anna, world.id, { motd: 'Annas Insel', version: '26.3', protocol: 771 });
      hostWs.send({ type: 'players', count: 2 });
      await hostWs.sync();
      const first = await mc();
      first.write(handshake(world.address, 1), STATUS_REQUEST);
      await hostWs.next('stream');
      const status = await serverList(await mc(), world.address);
      assert.deepEqual(status, {
        version: { name: '26.3', protocol: 771 },
        players: { max: 6, online: 2 },
        description: { text: 'Annas Insel' },
      });
    });
  });
});

describe('Welt-Relay: Login', () => {
  test('Welt zu oder unbekannt: Disconnect mit Text (JSON-Text-Komponente)', async () => {
    await withRelay({}, async ({ service, player, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      let client = await mc();
      client.write(handshake(world.address, 2), loginStart('Ben'));
      assert.equal(await client.disconnectText(), NOT_OPEN);
      // Transfer (3) wie Login
      client = await mc();
      client.write(handshake(world.address, 3), loginStart('Ben'));
      assert.equal(await client.disconnectText(), NOT_OPEN);
      client = await mc();
      client.write(handshake('zzzzzz.welt.test', 2), loginStart('Ben'));
      assert.equal(await client.disconnectText(), 'Diese Welt gibt es nicht. Prüf die Adresse.');
      client = await mc();
      client.write(handshake(world.address, 2), packet(0x00, mcString('kein name!'), randomBytes(16)));
      assert.equal(await client.disconnectText(), 'Ungültiger Spielername.');
    });
  });

  test('nicht eingeladen: knock an den Gastgeber und freundliche Ablehnung; einmal je 30 s; deny; allow → Mitglied', async () => {
    await withRelay({}, async ({ service, player, host, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      const hostWs = await host(anna, world.id);
      const notInvited = 'Du bist noch nicht eingeladen – Anna wurde gefragt. Versuch es gleich noch einmal.';
      let client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      assert.equal(await client.disconnectText(), notInvited);
      assert.deepEqual(await hostWs.next('knock'), { type: 'knock', name: 'Steve' });
      // gleich noch einmal: kein zweites Anklopfen
      client = await mc();
      client.write(handshake(world.address, 2), loginStart('steve'));
      assert.equal(await client.disconnectText(), notInvited);
      await hostWs.sync();
      assert.equal(hostWs.messages.some((m) => m.type === 'knock'), false);
      // abgelehnt
      hostWs.send({ type: 'deny', name: 'Steve' });
      await hostWs.sync();
      client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      assert.equal(await client.disconnectText(), 'Der Gastgeber hat deine Anfrage abgelehnt.');
      // erlaubt: Mitglied mit Standardrolle, neue Liste an den Gastgeber, Login geht durch
      hostWs.send({ type: 'allow', name: 'Steve' });
      const members = await hostWs.next('members');
      assert.deepEqual(members.members.map((m: { name: string; role: string }) => [m.name, m.role]), [['Steve', 'player']]);
      client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      const stream = await hostWs.next('stream');
      assert.deepEqual([stream.kind, stream.name], ['login', 'Steve']);
    });
  });

  test('eingeladen: Datenstrom „login“ mit genau den gepufferten Bytes zuerst, dann beidseitig; Ende in beide Richtungen', async () => {
    await withRelay({}, async ({ service, player, host, mc, stream }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      await api(service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: anna.token, body: {} });
      const hostWs = await host(anna, world.id);
      const client = await mc();
      const hello = Buffer.concat([handshake(world.address, 2), loginStart('Ben')]);
      const extra = randomBytes(40);
      client.write(hello, extra);
      const message = await hostWs.next('stream');
      assert.deepEqual([message.kind, message.name], ['login', 'Ben']);
      // wartende Logins zählen schon mit
      assert.equal((await api(service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token })).body.players, 2);
      const data = await stream(anna, message.id);
      assert.deepEqual(await data.bytes(hello.length + extra.length), Buffer.concat([hello, extra]));
      assert.deepEqual(data.frames[0]!.subarray(0, hello.length), hello, 'die gepufferten Bytes kommen zuerst');
      // beide Richtungen
      const toPlayer = randomBytes(70_000);
      data.send(toPlayer);
      assert.deepEqual(await client.bytes(toPlayer.length), toPlayer);
      const toHost = randomBytes(5000);
      client.write(toHost);
      assert.deepEqual(await data.bytes(toHost.length), toHost);
      // Spieler trennt: Datenstrom schließt
      client.destroy();
      assert.equal(await data.closed, 1000);
      assert.equal((await api(service.url, 'GET', `/v1/worlds/${world.id}`, { token: anna.token })).body.players, 1);
    });
  });

  test('Zugang „Freunde“: Heldix-Freunde des Gastgebers dürfen, andere klopfen an; „offen“: alle', async () => {
    await withRelay({}, async ({ service, player, host, mc }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      await player('Carla');
      await befriend(service.url, anna, ben);
      const world = await createWorld(service, anna, { access: 'friends' });
      const hostWs = await host(anna, world.id);
      let client = await mc();
      client.write(handshake(world.address, 2), loginStart('ben'));
      assert.equal((await hostWs.next('stream')).name, 'ben');
      client = await mc();
      client.write(handshake(world.address, 2), loginStart('Carla'));
      assert.ok((await client.disconnectText()).startsWith('Du bist noch nicht eingeladen'));
      assert.equal((await hostWs.next('knock')).name, 'Carla');

      await api(service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: anna.token, body: { access: 'open' } });
      client = await mc();
      client.write(handshake(world.address, 2), loginStart('Zufall'));
      assert.equal((await hostWs.next('stream')).name, 'Zufall');
    });
  });

  test('Blockierte kommen nicht durch (ohne Anklopfen, gleicher Text); voll: Disconnect mit Höchstzahl', async () => {
    await withRelay({}, async ({ service, player, host, mc }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      await api(service.url, 'POST', '/v1/blocks', { token: ben.token, body: { uuid: anna.uuid } });
      const world = await createWorld(service, anna, { access: 'open', maxPlayers: 2 });
      const hostWs = await host(anna, world.id);
      let client = await mc();
      client.write(handshake(world.address, 2), loginStart('Ben'));
      assert.ok((await client.disconnectText()).startsWith('Du bist noch nicht eingeladen'));
      await hostWs.sync();
      assert.equal(hostWs.messages.some((m) => m.type === 'knock'), false);

      // Gastgeber meldet 2 Spieler bei höchstens 2: voll
      hostWs.send({ type: 'players', count: 2 });
      await hostWs.sync();
      client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      assert.equal(await client.disconnectText(), 'Die Welt ist voll (höchstens 2 Spieler).');
      // 1 gemeldet, aber ein Login wartet schon (Gastgeber + 1 = 2): auch voll
      hostWs.send({ type: 'players', count: 1 });
      await hostWs.sync();
      const waiting = await mc();
      waiting.write(handshake(world.address, 2), loginStart('Alex'));
      await hostWs.next('stream');
      client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      assert.equal(await client.disconnectText(), 'Die Welt ist voll (höchstens 2 Spieler).');
    });
  });

  test('Gastgeber öffnet den Datenstrom nicht: Disconnect nach der Wartezeit', async () => {
    await withRelay({ worldStreamTimeoutMs: 400 }, async ({ service, player, host, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna, { access: 'open' });
      const hostWs = await host(anna, world.id);
      const client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      await hostWs.next('stream');
      assert.equal(await client.disconnectText(), 'Der Gastgeber antwortet gerade nicht. Versuch es gleich noch einmal.');
    });
  });

  test('Datenstrom nur für den Gastgeber dieser Welt und nur einmal (sonst 404), ohne Token 401', async () => {
    await withRelay({}, async ({ service, player, host, mc, stream }) => {
      const anna = await player('Anna');
      const ben = await player('Ben');
      const world = await createWorld(service, anna, { access: 'open' });
      const hostWs = await host(anna, world.id);
      const client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      const { id } = await hostWs.next('stream');
      const wsBase = service.url.replace('http', 'ws');
      // fremder Spieler, unbekannte ID, ohne Token
      assert.equal((await upgradeStatus(`${wsBase}/v1/worlds/streams/${id}`, { Authorization: `Bearer ${ben.token}` })).status, 404);
      assert.equal((await upgradeStatus(`${wsBase}/v1/worlds/streams/${'0'.repeat(32)}`, { Authorization: `Bearer ${anna.token}` })).status, 404);
      assert.equal((await upgradeStatus(`${wsBase}/v1/worlds/streams/${id}`)).status, 401);
      await stream(anna, id);
      // zweites Mal: 404
      assert.equal((await upgradeStatus(`${wsBase}/v1/worlds/streams/${id}`, { Authorization: `Bearer ${anna.token}` })).status, 404);
      assert.equal((await api(service.url, 'GET', `/v1/worlds/streams/${id}`)).status, 426);
    });
  });

  test('Steuerverbindung zu: offene Datenströme und Spieler-Verbindungen schließen, die Welt ist zu', async () => {
    await withRelay({}, async ({ service, player, host, mc, stream }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna, { access: 'open' });
      const hostWs = await host(anna, world.id);
      const client = await mc();
      client.write(handshake(world.address, 2), loginStart('Steve'));
      const data = await stream(anna, (await hostWs.next('stream')).id);
      await data.bytes(1);
      await hostWs.close();
      assert.equal(await data.closed, 1000);
      await client.waitClosed();
      const again = await mc();
      again.write(handshake(world.address, 2), loginStart('Steve'));
      assert.equal(await again.disconnectText(), NOT_OPEN);
    });
  });
});

describe('Welt-Relay: Müll und Grenzen', () => {
  test('Müll, Legacy-Ping, zu lange Adresse, zu langsam: schließen ohne Antwort; Teilpakete Byte für Byte gehen', async () => {
    await withRelay({ worldHandshakeTimeoutMs: 400 }, async ({ service, player, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      for (const junk of [
        Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n'),
        Buffer.from([0xfe, 0x01, 0xfa]),
        Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0x0f]),
        packet(0x05, Buffer.alloc(10)),
        handshake(`${'a'.repeat(250)}.welt.test`, 1),
        Buffer.concat([handshake(world.address, 1), packet(0x07)]),
      ]) {
        const client = await mc();
        client.write(junk);
        await client.waitClosed();
        assert.equal(client.received().length, 0, junk.subarray(0, 8).toString('hex'));
      }
      // zu langsam: halber Handshake, dann nichts mehr
      const slow = await mc();
      const started = Date.now();
      slow.write(handshake(world.address, 2).subarray(0, 5));
      await slow.waitClosed(3000);
      assert.ok(Date.now() - started >= 300, 'erst nach der Wartezeit');
      assert.equal(slow.received().length, 0);
    });
  });

  test('Teilpakete: Handshake und Login Start Byte für Byte ergeben die normale Antwort', async () => {
    await withRelay({}, async ({ service, player, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      const patient = await mc();
      const bytes = Buffer.concat([handshake(world.address, 2), loginStart('Ben')]);
      for (const byte of bytes) {
        patient.write(Buffer.from([byte]));
        await sleep(1);
      }
      assert.equal(await patient.disconnectText(), NOT_OPEN);
    });
  });

  test('neue Verbindungen je IP und Minute: darüber sofort getrennt', async () => {
    await withRelay({ worldConnectionsPerMinute: 3 }, async ({ service, player, mc }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna);
      for (let i = 0; i < 3; i++) assert.equal((await serverList(await mc(), world.address)).players.max, 0);
      const refused = await mc();
      refused.write(handshake(world.address, 1), STATUS_REQUEST);
      await refused.waitClosed();
      assert.equal(refused.received().length, 0);
    });
  });

  test('Datenrate je Welt: darüber gedrosselt, aber alles kommt an', async () => {
    await withRelay({ worldBytesPerSecond: 40_000 }, async ({ service, player, host, mc, stream }) => {
      const anna = await player('Anna');
      const world = await createWorld(service, anna, { access: 'open' });
      const hostWs = await host(anna, world.id);
      const client = await mc();
      const hello = Buffer.concat([handshake(world.address, 2), loginStart('Steve')]);
      client.write(hello);
      const data = await stream(anna, (await hostWs.next('stream')).id);
      await data.bytes(hello.length);
      const big = randomBytes(100_000);
      const started = Date.now();
      client.write(big);
      assert.deepEqual(await data.bytes(big.length, 8000), big);
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 1000, `gedrosselt (${elapsed} ms für 100 KB bei 40 KB/s)`);
      // Gegenrichtung zählt zur selben Grenze (der Vorrat ist aufgebraucht)
      const back = randomBytes(40_000);
      const backStarted = Date.now();
      data.send(back);
      assert.deepEqual(await client.bytes(back.length, 8000), back);
      const backElapsed = Date.now() - backStarted;
      assert.ok(backElapsed >= 700, `Gegenrichtung gedrosselt (${backElapsed} ms für 40 KB)`);
    });
  });
});
