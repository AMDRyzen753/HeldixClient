// Direktnachrichten: Senden, Verlauf, Unterhaltungen, gelesen, Grenzen, Echtzeit, Aufbewahrung und Löschen.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  api,
  befriend,
  connect,
  devPlayer,
  randomUuid,
  sleep,
  startService,
  waitFor,
  type Player,
  type TestService,
  type WsClient,
} from './helpers';

function sendTo(service: TestService, from: Player, to: Player | string, text: unknown) {
  const uuid = typeof to === 'string' ? to : to.uuid;
  return api(service.url, 'POST', `/v1/messages/${uuid}`, { token: from.token, body: { text } });
}

function historyOf(service: TestService, me: Player, other: Player, query = '') {
  return api(service.url, 'GET', `/v1/messages/${other.uuid}${query}`, { token: me.token });
}

describe('Nachrichten', () => {
  let service: TestService;
  let anna: Player;
  let ben: Player;
  let carla: Player;
  let fremd: Player;

  before(async () => {
    service = await startService({ dev: true });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    carla = await devPlayer(service.url, 'Carla');
    fremd = await devPlayer(service.url, 'Fremd');
    await befriend(service.url, anna, ben);
    await befriend(service.url, anna, carla);
  });
  after(() => service.close());

  test('senden, Verlauf, Unterhaltungen und ungelesene Nachrichten', async () => {
    const first = await sendTo(service, anna, ben, '  Hallo Ben!  ');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const message = first.body.message;
    assert.deepEqual(Object.keys(first.body), ['message']);
    assert.deepEqual(Object.keys(message).sort(), ['at', 'card', 'from', 'id', 'reactions', 'read', 'replyTo', 'text', 'to']);
    assert.equal(Number.isInteger(message.id), true);
    assert.equal(message.from, anna.uuid);
    assert.equal(message.to, ben.uuid);
    assert.equal(message.text, 'Hallo Ben!');
    assert.equal(typeof message.at, 'number');
    // Eigene Nachrichten gelten für den Absender immer als gelesen.
    assert.equal(message.read, true);

    const second = (await sendTo(service, anna, ben, 'Spielst du mit?')).body.message;
    const answer = (await sendTo(service, ben, anna, 'Gleich!')).body.message;
    assert.ok(second.id > message.id && answer.id > second.id, 'IDs steigen');
    await sleep(5);
    const toCarla = (await sendTo(service, anna, carla, 'Hi Carla')).body.message;

    // Verlauf: älteste zuerst, aus Sicht des Abrufenden.
    const forBen = await historyOf(service, ben, anna);
    assert.equal(forBen.status, 200);
    assert.equal(forBen.body.more, false);
    assert.deepEqual(
      forBen.body.messages.map((m: { text: string; read: boolean }) => [m.text, m.read]),
      [
        ['Hallo Ben!', false],
        ['Spielst du mit?', false],
        ['Gleich!', true],
      ],
    );
    const forAnna = await historyOf(service, anna, ben);
    assert.deepEqual(
      forAnna.body.messages.map((m: { id: number; read: boolean }) => [m.id, m.read]),
      [
        [message.id, true],
        [second.id, true],
        [answer.id, false],
      ],
    );

    // Unterhaltungen: neueste zuerst, unread = ungelesene Nachrichten des Freundes an mich.
    const annaConversations = await api(service.url, 'GET', '/v1/messages', { token: anna.token });
    assert.equal(annaConversations.status, 200);
    assert.deepEqual(annaConversations.body, {
      conversations: [
        { uuid: carla.uuid, name: 'Carla', last: toCarla, unread: 0 },
        { uuid: ben.uuid, name: 'Ben', last: { ...answer, read: false }, unread: 1 },
      ],
    });
    const benConversations = await api(service.url, 'GET', '/v1/messages', { token: ben.token });
    assert.deepEqual(benConversations.body, {
      conversations: [{ uuid: anna.uuid, name: 'Anna', last: answer, unread: 2 }],
    });
    const fremdConversations = await api(service.url, 'GET', '/v1/messages', { token: fremd.token });
    assert.deepEqual(fremdConversations.body, { conversations: [] });

    // In der Freundesliste: nur Freunde mit ungelesenen Nachrichten.
    assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.unread, { [anna.uuid]: 2 });
    assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: anna.token })).body.unread, { [ben.uuid]: 1 });
    assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: carla.token })).body.unread, { [anna.uuid]: 1 });

    // Als gelesen markieren.
    const read = await api(service.url, 'POST', `/v1/messages/${anna.uuid}/read`, { token: ben.token });
    assert.equal(read.status, 200);
    assert.deepEqual(read.body, { ok: true });
    assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.unread, {});
    assert.equal((await api(service.url, 'GET', '/v1/messages', { token: ben.token })).body.conversations[0].unread, 0);
    assert.deepEqual(
      (await historyOf(service, ben, anna)).body.messages.map((m: { read: boolean }) => m.read),
      [true, true, true],
    );
    // Für Anna ändert sich nichts: keine Lesebestätigung.
    assert.deepEqual(
      (await historyOf(service, anna, ben)).body.messages.map((m: { read: boolean }) => m.read),
      [true, true, false],
    );
    // Noch einmal markieren schadet nicht.
    assert.equal((await api(service.url, 'POST', `/v1/messages/${anna.uuid}/read`, { token: ben.token })).status, 200);
  });

  test('Verlauf seitenweise mit before, limit und more', async () => {
    const dora = await devPlayer(service.url, 'Dora');
    await befriend(service.url, anna, dora);
    const ids: number[] = [];
    for (let i = 1; i <= 7; i++) ids.push((await sendTo(service, i % 2 ? anna : dora, i % 2 ? dora : anna, `Nachricht ${i}`)).body.message.id);

    let page = await historyOf(service, anna, dora, '?limit=3');
    assert.equal(page.status, 200);
    assert.deepEqual(
      page.body.messages.map((m: { text: string }) => m.text),
      ['Nachricht 5', 'Nachricht 6', 'Nachricht 7'],
    );
    assert.equal(page.body.more, true);
    page = await historyOf(service, anna, dora, `?limit=3&before=${page.body.messages[0].id}`);
    assert.deepEqual(
      page.body.messages.map((m: { id: number }) => m.id),
      ids.slice(1, 4),
    );
    assert.equal(page.body.more, true);
    page = await historyOf(service, anna, dora, `?before=${ids[1]}&limit=3`);
    assert.deepEqual(
      page.body.messages.map((m: { id: number }) => m.id),
      [ids[0]],
    );
    assert.equal(page.body.more, false);
    // Genau so viele, wie es gibt: more ist false.
    page = await historyOf(service, anna, dora, '?limit=7');
    assert.equal(page.body.messages.length, 7);
    assert.equal(page.body.more, false);
    // Ohne Angaben: bis zu 50, ab der neuesten. before über der neuesten ID: auch ab der neuesten.
    assert.equal((await historyOf(service, anna, dora)).body.messages.length, 7);
    assert.equal((await historyOf(service, anna, dora, '?before=9007199254740991&limit=100')).body.messages.length, 7);
    assert.deepEqual((await historyOf(service, anna, dora, '?before=1')).body, { messages: [], more: false });

    for (const query of ['?limit=0', '?limit=101', '?limit=abc', '?limit=', '?limit=-1', '?limit=2.5', '?before=0', '?before=-5', '?before=', '?before=x', '?before=99999999999999999']) {
      const res = await historyOf(service, anna, dora, query);
      assert.equal(res.status, 400, query);
      assert.equal(typeof res.body.error, 'string');
    }
    // Kein Freund: 404; ungültige UUID: 400.
    const notFriend = await historyOf(service, anna, fremd);
    assert.equal(notFriend.status, 404);
    assert.equal(notFriend.body.error, 'Dieser Spieler ist nicht in deiner Freundesliste.');
    assert.equal((await api(service.url, 'GET', '/v1/messages/NICHT-HEX', { token: anna.token })).status, 400);
    assert.equal((await api(service.url, 'POST', `/v1/messages/${fremd.uuid}/read`, { token: anna.token })).status, 404);
    assert.equal((await api(service.url, 'POST', '/v1/messages/123/read', { token: anna.token })).status, 400);
  });

  test('nur an Freunde, Schalter „messages“ und Prüfung des Textes', async () => {
    for (const target of [fremd.uuid, randomUuid(), anna.uuid]) {
      const res = await sendTo(service, anna, target, 'Hallo');
      assert.equal(res.status, 403, target);
      assert.equal(res.body.error, 'Nachrichten gehen nur an Freunde.');
    }
    assert.equal((await sendTo(service, anna, 'ABC', 'Hallo')).status, 400);

    // Ben nimmt keine Nachrichten an.
    const off = await api(service.url, 'PUT', '/v1/me', { token: ben.token, body: { messages: false } });
    assert.equal(off.body.messages, false);
    const refused = await sendTo(service, anna, ben, 'Hallo?');
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'Ben nimmt gerade keine Nachrichten an.');
    // Wer selbst aus hat, darf trotzdem schreiben (der Schalter gilt nur fürs Annehmen).
    assert.equal((await sendTo(service, ben, anna, 'Ich schreibe trotzdem')).status, 200);
    await api(service.url, 'PUT', '/v1/me', { token: ben.token, body: { messages: true } });
    assert.equal((await sendTo(service, anna, ben, 'Hallo!')).status, 200);

    const invalid: unknown[] = [undefined, null, 42, ['a'], '', '   ', 'a\nb', 'Zeile\r\nZwei', 'mit\tTab', 'a\u0000', 'a\u001b[31m', 'x'.repeat(501)];
    for (const text of invalid) {
      const res = await sendTo(service, anna, ben, text);
      assert.equal(res.status, 400, JSON.stringify(text)?.slice(0, 40));
      assert.equal(typeof res.body.error, 'string');
    }
    // 500 Zeichen gehen, auch Emoji (zählen als ein Zeichen), Leerzeichen am Rand fallen weg.
    assert.equal((await sendTo(service, anna, ben, 'x'.repeat(500))).status, 200);
    const emoji = '\u{1F600}'.repeat(500);
    const sent = await sendTo(service, anna, ben, `  ${emoji}\n`);
    assert.equal(sent.status, 200);
    assert.equal(sent.body.message.text, emoji);

    // Ohne Anmeldung: 401.
    assert.equal((await api(service.url, 'GET', '/v1/messages')).status, 401);
    assert.equal((await api(service.url, 'POST', `/v1/messages/${ben.uuid}`, { body: { text: 'x' } })).status, 401);
  });
});

describe('Nachrichten: Grenzen', () => {
  test('höchstens N Nachrichten pro Absender und Zeitraum (hier 3 pro 300 ms), dann 429', async () => {
    const service = await startService({ dev: true, messageRateLimit: 3, rateWindowMs: 300 });
    try {
      const [anna, ben, carla] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben'), await devPlayer(service.url, 'Carla')];
      await befriend(service.url, anna, ben);
      await befriend(service.url, carla, ben);
      for (let i = 0; i < 3; i++) assert.equal((await sendTo(service, anna, ben, `Nr. ${i}`)).status, 200);
      const limited = await sendTo(service, anna, ben, 'zu viel');
      assert.equal(limited.status, 429);
      assert.equal(limited.body.error, 'Zu viele Nachrichten. Warte kurz.');
      assert.ok(Number(limited.headers.get('retry-after')) >= 1);
      // Andere Absender haben ihre eigene Grenze; die Grenze gilt pro Spieler, nicht pro Empfänger.
      assert.equal((await sendTo(service, ben, anna, 'Antwort')).status, 200);
      assert.equal((await sendTo(service, anna, ben, 'immer noch')).status, 429);
      await sleep(350);
      assert.equal((await sendTo(service, anna, ben, 'wieder da')).status, 200);
      // Der abgelehnte Text wurde nicht gespeichert.
      const texts = (await historyOf(service, ben, anna)).body.messages.map((m: { text: string }) => m.text);
      assert.deepEqual(texts, ['Nr. 0', 'Nr. 1', 'Nr. 2', 'Antwort', 'wieder da']);
    } finally {
      await service.close();
    }
  });

  test('höchstens N Nachrichten pro Unterhaltung (hier 5), die ältesten fallen weg', async () => {
    const service = await startService({ dev: true, maxConversationMessages: 5 });
    try {
      const [anna, ben, carla] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben'), await devPlayer(service.url, 'Carla')];
      await befriend(service.url, anna, ben);
      await befriend(service.url, anna, carla);
      assert.equal((await sendTo(service, anna, carla, 'andere Unterhaltung')).status, 200);
      for (let i = 1; i <= 8; i++) await sendTo(service, i % 3 ? anna : ben, i % 3 ? ben : anna, `Nr. ${i}`);
      const page = await historyOf(service, anna, ben);
      assert.deepEqual(
        page.body.messages.map((m: { text: string }) => m.text),
        ['Nr. 4', 'Nr. 5', 'Nr. 6', 'Nr. 7', 'Nr. 8'],
      );
      assert.equal(page.body.more, false);
      // Andere Unterhaltungen bleiben unberührt.
      assert.equal((await historyOf(service, carla, anna)).body.messages.length, 1);
    } finally {
      await service.close();
    }
  });
});

describe('Nachrichten in Echtzeit', () => {
  test('an alle Verbindungen beider Seiten; „gelesen“ nur an die eigenen Geräte', async () => {
    const service = await startService({ dev: true });
    const clients: WsClient[] = [];
    try {
      const [anna, ben, carla] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben'), await devPlayer(service.url, 'Carla')];
      await befriend(service.url, anna, ben);
      await befriend(service.url, ben, carla);
      await sendTo(service, anna, ben, 'vorher');

      // Die friends-Nachricht nach dem Verbinden enthält die ungelesenen Nachrichten.
      const benA = await connect(service.wsUrl, ben.token);
      assert.deepEqual(benA.friends.unread, { [anna.uuid]: 1 });
      const benB = (await connect(service.wsUrl, ben.token)).client;
      const annaA = (await connect(service.wsUrl, anna.token)).client;
      const annaB = (await connect(service.wsUrl, anna.token)).client;
      const carlaWs = (await connect(service.wsUrl, carla.token)).client;
      clients.push(benA.client, benB, annaA, annaB, carlaWs);
      for (const client of clients) {
        await client.sync();
        client.drain();
      }

      const sent = (await sendTo(service, anna, ben, 'Neu!')).body.message;
      for (const client of [benA.client, benB]) {
        await client.sync();
        assert.deepEqual(client.drain(), [{ type: 'message', message: { ...sent, read: false }, name: 'Anna' }]);
      }
      for (const client of [annaA, annaB]) {
        await client.sync();
        assert.deepEqual(client.drain(), [{ type: 'message', message: sent, name: 'Anna' }]);
      }
      await carlaWs.sync();
      assert.deepEqual(carlaWs.drain(), []);

      // Ben liest: seine beiden Verbindungen erfahren es, Anna nicht.
      await api(service.url, 'POST', `/v1/messages/${anna.uuid}/read`, { token: ben.token });
      for (const client of [benA.client, benB]) {
        await client.sync();
        assert.deepEqual(client.drain(), [{ type: 'read', uuid: anna.uuid }]);
      }
      for (const client of [annaA, annaB, carlaWs]) {
        await client.sync();
        assert.deepEqual(client.drain(), []);
      }
    } finally {
      for (const client of clients) await client.close();
      await service.close();
    }
  });
});

describe('Nachrichten löschen', () => {
  test('Freundschaft beendet: Unterhaltung weg (für beide)', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben')];
      await befriend(service.url, anna, ben);
      await sendTo(service, anna, ben, 'eins');
      await sendTo(service, ben, anna, 'zwei');
      assert.equal((await api(service.url, 'DELETE', `/v1/friends/${anna.uuid}`, { token: ben.token })).status, 200);
      assert.deepEqual((await api(service.url, 'GET', '/v1/messages', { token: anna.token })).body, { conversations: [] });
      // Wieder befreundet: frischer Anfang.
      await befriend(service.url, ben, anna);
      assert.deepEqual((await historyOf(service, anna, ben)).body, { messages: [], more: false });
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: anna.token })).body.unread, {});
    } finally {
      await service.close();
    }
  });

  test('Konto gelöscht: Nachrichten weg, auch beim früheren Freund', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben')];
      await befriend(service.url, anna, ben);
      await sendTo(service, anna, ben, 'Geheimnis-Text-123');
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: anna.token })).status, 200);
      assert.deepEqual((await api(service.url, 'GET', '/v1/messages', { token: ben.token })).body, { conversations: [] });
      assert.deepEqual((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.unread, {});
    } finally {
      await service.close();
    }
  });

  test('Aufbewahrung: Das Aufräumen löscht alte Nachrichten (im Test nach 150 ms)', async () => {
    const service = await startService({ dev: true, messageTtlMs: 150, sweepIntervalMs: 40 });
    try {
      const [anna, ben] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben')];
      await befriend(service.url, anna, ben);
      await sendTo(service, anna, ben, 'alt');
      assert.equal((await historyOf(service, ben, anna)).body.messages.length, 1);
      await waitFor(async () => (await historyOf(service, ben, anna)).body.messages.length === 0);
      assert.deepEqual((await api(service.url, 'GET', '/v1/messages', { token: ben.token })).body, { conversations: [] });
      // Die Freundschaft bleibt.
      assert.equal((await api(service.url, 'GET', '/v1/friends', { token: ben.token })).body.friends.length, 1);
    } finally {
      await service.close();
    }
  });
});
