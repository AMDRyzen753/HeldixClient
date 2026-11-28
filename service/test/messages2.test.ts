// Nachrichten-Extras (Freunde 2.0): Antworten, Beitreten-Karten, Reaktionen, eigene Nachrichten löschen, „schreibt …“.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { REACTIONS } from '../src/messages';
import { api, befriend, connect, devPlayer, sleep, startService, type Player, type TestService, type WsClient } from './helpers';

describe('Nachrichten-Extras', () => {
  let service: TestService;
  let anna: Player;
  let ben: Player;
  let carla: Player;
  let annaWs: WsClient;
  let benWs: WsClient;

  before(async () => {
    service = await startService({ dev: true, typingIntervalMs: 200 });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    carla = await devPlayer(service.url, 'Carla');
    await befriend(service.url, anna, ben);
    await befriend(service.url, anna, carla);
    annaWs = (await connect(service.wsUrl, anna.token)).client;
    benWs = (await connect(service.wsUrl, ben.token)).client;
  });
  after(async () => {
    await annaWs.close();
    await benWs.close();
    await service.close();
  });

  const send = (from: Player, to: Player, body: unknown) => api(service.url, 'POST', `/v1/messages/${to.uuid}`, { token: from.token, body });
  const history = async (viewer: Player, other: Player) => (await api(service.url, 'GET', `/v1/messages/${other.uuid}`, { token: viewer.token })).body.messages;

  test('Antwort auf eine Nachricht: nur in derselben Unterhaltung, mit Vorschau; gelöscht ohne Text', async () => {
    const original = (await send(anna, ben, { text: `Treffen um acht? ${'x'.repeat(150)}` })).body.message;
    assert.deepEqual([original.replyTo, original.card, original.reactions], [null, null, {}]);
    const reply = await send(ben, anna, { text: 'Klar!', replyTo: original.id });
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
    assert.equal(reply.body.message.replyTo.id, original.id);
    assert.equal(reply.body.message.replyTo.from, anna.uuid);
    assert.equal([...reply.body.message.replyTo.text].length, 101, '100 Zeichen und …');
    // Echtzeit an beide, mit Antwort-Bezug
    const live = await annaWs.next((m) => m.type === 'message' && m.message.id === reply.body.message.id);
    assert.equal(live.message.replyTo.id, original.id);
    // Fremde Unterhaltung, unbekannt, falsche Art: 400
    const other = (await send(anna, carla, { text: 'Hallo Carla' })).body.message;
    for (const replyTo of [other.id, 999_999, 'abc', 1.5]) {
      assert.equal((await send(ben, anna, { text: 'x', replyTo })).status, 400, String(replyTo));
    }
    // Original gelöscht: replyTo bleibt mit id, ohne Text
    assert.equal((await api(service.url, 'DELETE', `/v1/messages/${ben.uuid}/${original.id}`, { token: anna.token })).status, 200);
    const after = (await history(ben, anna)).find((m: { id: number }) => m.id === reply.body.message.id);
    assert.deepEqual(after.replyTo, { id: original.id, from: null, text: null });
  });

  test('Beitreten-Karten: Server, Welt, Einladung; Text bleibt Pflicht; Prüfungen', async () => {
    const cases = [
      [{ kind: 'server', target: 'Mc.Example.de:25565', title: 'Unser Server' }, { kind: 'server', target: 'mc.example.de', title: 'Unser Server' }],
      [{ kind: 'world', target: 'K7M2XQ', title: 'Insel' }, { kind: 'world', target: 'k7m2xq', title: 'Insel' }],
      [{ kind: 'invite', target: 'abcdefghjk', title: '' }, { kind: 'invite', target: 'abcdefghjk', title: '' }],
    ] as const;
    for (const [card, stored] of cases) {
      const res = await send(anna, ben, { text: 'Komm vorbei!', card });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.message.card, stored);
      const live = await benWs.next((m) => m.type === 'message' && m.message.id === res.body.message.id);
      assert.deepEqual(live.message.card, stored);
    }
    assert.deepEqual((await history(ben, anna)).slice(-1)[0].card, { kind: 'invite', target: 'abcdefghjk', title: '' });
    for (const card of [
      { kind: 'server', target: '127.0.0.1' },
      { kind: 'server', target: 'localhost' },
      { kind: 'world', target: 'abc' },
      { kind: 'invite', target: 'abcdefghij' }, // i ist nicht im Alphabet
      { kind: 'link', target: 'x' },
      { kind: 'server', target: 'mc.example.de', title: 'x'.repeat(61) },
      { kind: 'server', target: 'mc.example.de', title: 'a\nb' },
      'server',
      [],
    ]) {
      assert.equal((await send(anna, ben, { text: 'x', card })).status, 400, JSON.stringify(card));
    }
    assert.equal((await send(anna, ben, { card: { kind: 'server', target: 'mc.example.de', title: '' } })).status, 400, 'ohne Text');
  });

  test('Reaktionen: acht feste, eine je Person (ersetzen, zurücknehmen), Echtzeit an beide', async () => {
    assert.deepEqual(Object.keys(REACTIONS), ['like', 'love', 'laugh', 'wow', 'sad', 'party', 'fire', 'eyes']);
    const message = (await send(anna, ben, { text: 'Gewonnen!' })).body.message;
    const path = `/v1/messages/${anna.uuid}/${message.id}/reaction`;
    let res = await api(service.url, 'PUT', path, { token: ben.token, body: { reaction: 'party' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.message.reactions, { [ben.uuid]: 'party' });
    const forAnna = await annaWs.next((m) => m.type === 'reaction' && m.id === message.id);
    assert.deepEqual(forAnna, { type: 'reaction', uuid: ben.uuid, id: message.id, reactions: { [ben.uuid]: 'party' } });
    const forBen = await benWs.next((m) => m.type === 'reaction' && m.id === message.id);
    assert.equal(forBen.uuid, anna.uuid);
    // Ersetzen, zweite Person
    res = await api(service.url, 'PUT', path, { token: ben.token, body: { reaction: 'fire' } });
    assert.deepEqual(res.body.message.reactions, { [ben.uuid]: 'fire' });
    res = await api(service.url, 'PUT', `/v1/messages/${ben.uuid}/${message.id}/reaction`, { token: anna.token, body: { reaction: 'like' } });
    assert.deepEqual(res.body.message.reactions, { [ben.uuid]: 'fire', [anna.uuid]: 'like' });
    assert.deepEqual((await history(anna, ben)).find((m: { id: number }) => m.id === message.id).reactions, { [ben.uuid]: 'fire', [anna.uuid]: 'like' });
    // Zurücknehmen
    res = await api(service.url, 'DELETE', path, { token: ben.token });
    assert.deepEqual(res.body.message.reactions, { [anna.uuid]: 'like' });
    // Ungültig, fremde Unterhaltung, unbekannt
    assert.equal((await api(service.url, 'PUT', path, { token: ben.token, body: { reaction: '👍' } })).status, 400);
    assert.equal((await api(service.url, 'PUT', `/v1/messages/${anna.uuid}/${message.id}/reaction`, { token: carla.token, body: { reaction: 'like' } })).status, 404);
    assert.equal((await api(service.url, 'PUT', `/v1/messages/${anna.uuid}/999999/reaction`, { token: ben.token, body: { reaction: 'like' } })).status, 404);
    // Datenauskunft: eigene Reaktionen
    const exported = (await api(service.url, 'GET', '/v1/me/export', { token: anna.token })).body;
    assert.deepEqual(
      exported.reactions.map((r: { message: number; reaction: string }) => [r.message, r.reaction]),
      [[message.id, 'like']],
    );
  });

  test('Löschen: nur eigene, für beide (mit Reaktionen), Echtzeit message-deleted', async () => {
    const mine = (await send(anna, ben, { text: 'Upps, falscher Chat' })).body.message;
    const theirs = (await send(ben, anna, { text: 'Bleibt' })).body.message;
    await api(service.url, 'PUT', `/v1/messages/${anna.uuid}/${mine.id}/reaction`, { token: ben.token, body: { reaction: 'laugh' } });
    assert.equal((await api(service.url, 'DELETE', `/v1/messages/${ben.uuid}/${theirs.id}`, { token: anna.token })).status, 403, 'fremde Nachricht');
    assert.equal((await api(service.url, 'DELETE', `/v1/messages/${carla.uuid}/${mine.id}`, { token: anna.token })).status, 404, 'falsche Unterhaltung');
    const res = await api(service.url, 'DELETE', `/v1/messages/${ben.uuid}/${mine.id}`, { token: anna.token });
    assert.deepEqual([res.status, res.body], [200, { ok: true }]);
    assert.deepEqual(await benWs.next((m) => m.type === 'message-deleted' && m.id === mine.id), { type: 'message-deleted', uuid: anna.uuid, id: mine.id });
    assert.deepEqual(await annaWs.next((m) => m.type === 'message-deleted' && m.id === mine.id), { type: 'message-deleted', uuid: ben.uuid, id: mine.id });
    assert.equal((await history(ben, anna)).some((m: { id: number }) => m.id === mine.id), false);
    assert.equal((await api(service.url, 'DELETE', `/v1/messages/${ben.uuid}/${mine.id}`, { token: anna.token })).status, 404, 'schon weg');
    const exported = (await api(service.url, 'GET', '/v1/me/export', { token: ben.token })).body;
    assert.equal(exported.reactions.some((r: { message: number }) => r.message === mine.id), false, 'Reaktion ist mit weg');
    assert.equal(exported.messages.some((m: { id: number }) => m.id === mine.id), false);
  });

  test('„schreibt …“: per Echtzeit oder HTTP, nur an Freunde, gedrosselt, nichts gespeichert', async () => {
    annaWs.drain();
    benWs.drain();
    benWs.send({ type: 'typing', to: anna.uuid });
    assert.deepEqual(await annaWs.next('typing'), { type: 'typing', from: ben.uuid });
    // Gleich noch einmal: gedrosselt
    benWs.send({ type: 'typing', to: anna.uuid });
    await benWs.sync();
    await annaWs.sync();
    assert.equal(annaWs.messages.some((m) => m.type === 'typing'), false);
    await sleep(250);
    const res = await api(service.url, 'POST', `/v1/messages/${anna.uuid}/typing`, { token: ben.token });
    assert.deepEqual([res.status, res.body], [200, { ok: true }]);
    assert.deepEqual(await annaWs.next('typing'), { type: 'typing', from: ben.uuid });
    // Kein Freund: HTTP 404, Echtzeit still ignoriert
    const fremd = await devPlayer(service.url, 'Fremd');
    assert.equal((await api(service.url, 'POST', `/v1/messages/${anna.uuid}/typing`, { token: fremd.token })).status, 404);
    const fremdWs = (await connect(service.wsUrl, fremd.token)).client;
    fremdWs.send({ type: 'typing', to: anna.uuid });
    fremdWs.send({ type: 'typing', to: 'kaputt' });
    await fremdWs.sync();
    await annaWs.sync();
    assert.equal(annaWs.messages.some((m) => m.type === 'typing'), false);
    await fremdWs.close();
    // Wer keine Nachrichten annimmt, bekommt auch kein „schreibt …“
    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { messages: false } });
    await sleep(250);
    benWs.send({ type: 'typing', to: anna.uuid });
    await benWs.sync();
    await annaWs.sync();
    assert.equal(annaWs.messages.some((m) => m.type === 'typing'), false);
    await api(service.url, 'PUT', '/v1/me', { token: anna.token, body: { messages: true } });
  });
});
