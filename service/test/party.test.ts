// Party (Freunde 2.0): einladen, annehmen/ablehnen, verlassen, entfernen, Leitung, Chat, Gnadenfrist, Folgen, Voice-Prüfwert
// und Zugang zur geteilten Welt des Gastgebers.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { api, befriend, connect, devPlayer, sleep, startService, waitFor, type Player, type TestService, type WsClient } from './helpers';
import { createWorld, DOMAIN, handshake, hostConnect, loginStart, McClient, openWorld } from './world-helpers';

describe('Party', () => {
  let service: TestService;
  let leo: Player;
  const open: WsClient[] = [];

  before(async () => {
    service = await startService({ dev: true, weltDomain: DOMAIN, partyGraceMs: 300, partyInviteTtlMs: 60_000, worldConnectionsPerMinute: 1000 });
    leo = await devPlayer(service.url, 'Leo');
  });
  after(async () => {
    for (const client of open) await client.close();
    await service.close();
  });

  const call = (player: Player, method: string, path: string, body?: unknown) => api(service.url, method, path, { token: player.token, body });

  async function online(player: Player): Promise<WsClient> {
    const { client } = await connect(service.wsUrl, player.token);
    open.push(client);
    return client;
  }

  /** Neuer Freund von `of`, mit offener Verbindung. */
  async function friendOf(of: Player, name: string): Promise<{ player: Player; ws: WsClient }> {
    const player = await devPlayer(service.url, name);
    await befriend(service.url, of, player);
    return { player, ws: await online(player) };
  }

  /** `party` mit passender Bedingung (ältere Stände überspringen). */
  async function partyState(ws: WsClient, check: (party: any) => boolean = () => true): Promise<any> {
    for (;;) {
      const message = await ws.next('party');
      if (message.party !== null && check(message.party)) return message.party;
    }
  }

  test('einladen nur Freunde und nur als Leiter; annehmen, ablehnen, Einladungen in GET', async () => {
    const leoWs = await online(leo);
    const { player: mia, ws: miaWs } = await friendOf(leo, 'Mia');
    const { player: nik, ws: nikWs } = await friendOf(leo, 'Nik');
    const fremd = await devPlayer(service.url, 'Fremd');

    assert.deepEqual((await call(leo, 'GET', '/v1/party')).body, { party: null, invites: [] });
    assert.equal((await call(leo, 'POST', '/v1/party/invite', { uuid: fremd.uuid })).status, 403, 'kein Freund');
    assert.equal((await call(leo, 'POST', '/v1/party/invite', { uuid: leo.uuid })).status, 400, 'sich selbst');
    assert.equal((await call(leo, 'POST', '/v1/party/invite', { uuid: 'kaputt' })).status, 400);

    let res = await call(leo, 'POST', '/v1/party/invite', { uuid: mia.uuid });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const party = res.body.party;
    assert.match(party.id, /^[0-9a-f]{32}$/);
    assert.deepEqual([party.leader, party.max, party.members.length, party.invites.map((i: { uuid: string }) => i.uuid)], [leo.uuid, 8, 1, [mia.uuid]]);
    assert.deepEqual(Object.keys(party).sort(), ['created', 'id', 'invites', 'leader', 'max', 'members', 'target', 'voice']);
    assert.deepEqual(Object.keys(party.members[0]).sort(), ['away', 'awayUntil', 'joined', 'leader', 'location', 'name', 'online', 'state', 'uuid']);

    // Einladung kommt per Echtzeit, mit der Liste aller offenen Einladungen
    const invite = await miaWs.next('party-invite');
    assert.deepEqual(invite.invite.from, { uuid: leo.uuid, name: 'Leo' });
    assert.deepEqual([invite.invite.party, invite.invite.leader.name, invite.invite.members, invite.invite.quiet], [party.id, 'Leo', 1, false]);
    assert.equal(invite.invites.length, 1);
    assert.equal((await call(mia, 'GET', '/v1/party')).body.invites[0].party, party.id);

    // Erneut einladen innerhalb einer Minute: kein neuer Toast (invite null), nur die Liste
    await call(leo, 'POST', '/v1/party/invite', { uuid: mia.uuid });
    assert.equal((await miaWs.next('party-invite')).invite, null);

    // Annehmen
    res = await call(mia, 'POST', `/v1/party/${party.id}/accept`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.party.members.map((m: { name: string; leader: boolean }) => [m.name, m.leader]), [
      ['Leo', true],
      ['Mia', false],
    ]);
    assert.deepEqual(res.body.party.invites, []);
    await partyState(leoWs, (p) => p.members.length === 2);

    // Nur der Leiter lädt ein
    assert.equal((await call(mia, 'POST', '/v1/party/invite', { uuid: leo.uuid })).status, 403);
    // Ablehnen
    await call(leo, 'POST', '/v1/party/invite', { uuid: nik.uuid });
    await nikWs.next((m) => m.type === 'party-invite' && m.invite !== null);
    res = await call(nik, 'POST', `/v1/party/${party.id}/decline`);
    assert.deepEqual(res.body, { invites: [] });
    await partyState(leoWs, (p) => p.invites.length === 0 && p.members.length === 2);
    assert.equal((await call(nik, 'POST', `/v1/party/${party.id}/accept`)).status, 404, 'abgelehnt: weg');
    // Schon in der Party: 409
    assert.equal((await call(leo, 'POST', '/v1/party/invite', { uuid: mia.uuid })).status, 409);

    // Party-Chat: alle Mitglieder, nur im Speicher, in GET dabei
    const chat = await call(mia, 'POST', '/v1/party/chat', { text: '  Los gehts!  ' });
    assert.equal(chat.status, 200);
    assert.deepEqual([chat.body.message.text, chat.body.message.from, chat.body.message.name], ['Los gehts!', mia.uuid, 'Mia']);
    for (const ws of [leoWs, miaWs]) assert.equal((await ws.next('party-chat')).message.text, 'Los gehts!');
    assert.equal((await call(leo, 'GET', '/v1/party')).body.party.chat.length, 1);
    assert.equal((await call(nik, 'POST', '/v1/party/chat', { text: 'hallo' })).status, 404, 'nicht in der Party');
    assert.equal((await call(mia, 'POST', '/v1/party/chat', { text: 'a\nb' })).status, 400);
    assert.equal((await call(mia, 'POST', '/v1/party/chat', { text: 'x'.repeat(501) })).status, 400);

    // Verlassen: Party mit nur noch einem Mitglied löst sich auf
    res = await call(mia, 'POST', '/v1/party/leave');
    assert.deepEqual(res.body, { party: null });
    assert.deepEqual(await miaWs.next((m) => m.type === 'party' && m.party === null), { type: 'party', party: null, reason: 'left' });
    assert.deepEqual(await leoWs.next((m) => m.type === 'party' && m.party === null), { type: 'party', party: null, reason: 'dissolved' });
    assert.deepEqual((await call(leo, 'GET', '/v1/party')).body, { party: null, invites: [] });
    assert.equal((await call(mia, 'POST', '/v1/party/leave')).status, 404);
  });

  test('höchstens 8, Leitung übergeben, entfernen, Leiter geht', async () => {
    const boss = await devPlayer(service.url, 'Boss');
    const bossWs = await online(boss);
    const friends: { player: Player; ws: WsClient }[] = [];
    for (let i = 1; i <= 8; i++) friends.push(await friendOf(boss, `Gast${i}`));
    let partyId = '';
    for (const [i, friend] of friends.entries()) {
      const res = await call(boss, 'POST', '/v1/party/invite', { uuid: friend.player.uuid });
      if (i < 7) {
        assert.equal(res.status, 200, JSON.stringify(res.body));
        partyId = res.body.party.id;
        assert.equal((await call(friend.player, 'POST', `/v1/party/${partyId}/accept`)).status, 200);
      } else {
        // 8 Mitglieder (Boss + 7): voll
        assert.deepEqual([res.status, res.body.error], [409, 'Die Party ist voll (höchstens 8).']);
      }
    }
    const [first, second] = friends;
    // Leitung übergeben
    assert.equal((await call(first!.player, 'POST', '/v1/party/leader', { uuid: first!.player.uuid })).status, 403, 'nur der Leiter');
    let res = await call(boss, 'POST', '/v1/party/leader', { uuid: first!.player.uuid });
    assert.equal(res.body.party.leader, first!.player.uuid);
    assert.equal((await partyState(bossWs, (p) => p.leader === first!.player.uuid)).leader, first!.player.uuid);
    assert.equal((await call(boss, 'DELETE', `/v1/party/members/${second!.player.uuid}`)).status, 403, 'Boss ist nicht mehr Leiter');
    // Entfernen
    res = await call(first!.player, 'DELETE', `/v1/party/members/${second!.player.uuid}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.party.members.length, 7);
    assert.deepEqual(await second!.ws.next((m) => m.type === 'party' && m.party === null), { type: 'party', party: null, reason: 'removed' });
    assert.equal((await call(first!.player, 'DELETE', `/v1/party/members/${first!.player.uuid}`)).status, 400);
    // Leiter geht: das Mitglied, das am längsten dabei ist, übernimmt (Boss)
    await call(first!.player, 'POST', '/v1/party/leave');
    assert.equal((await call(boss, 'GET', '/v1/party')).body.party.leader, boss.uuid);
  });

  test('Gnadenfrist: ohne Verbindung away, danach raus; mit neuer Verbindung bleibt man', async () => {
    const chef = await devPlayer(service.url, 'Chef');
    const chefWs = await online(chef);
    const { player: ole, ws: oleWs } = await friendOf(chef, 'Ole');
    const { player: pia, ws: piaWs } = await friendOf(chef, 'Pia');
    const partyId = (await call(chef, 'POST', '/v1/party/invite', { uuid: ole.uuid })).body.party.id;
    await call(chef, 'POST', '/v1/party/invite', { uuid: pia.uuid });
    await call(ole, 'POST', `/v1/party/${partyId}/accept`);
    await call(pia, 'POST', `/v1/party/${partyId}/accept`);

    // Ole trennt kurz und kommt zurück: bleibt
    await oleWs.close();
    open.splice(open.indexOf(oleWs), 1);
    const away = await partyState(chefWs, (p) => p.members.some((m: { uuid: string; away: boolean }) => m.uuid === ole.uuid && m.away));
    assert.equal(typeof away.members.find((m: { uuid: string }) => m.uuid === ole.uuid).awayUntil, 'number');
    const back = await online(ole);
    await partyState(chefWs, (p) => p.members.some((m: { uuid: string; away: boolean }) => m.uuid === ole.uuid && !m.away));
    await sleep(400);
    assert.equal((await call(chef, 'GET', '/v1/party')).body.party.members.length, 3, 'Ole ist noch dabei');
    // Pia trennt und kommt nicht zurück: nach der Frist raus
    await piaWs.close();
    open.splice(open.indexOf(piaWs), 1);
    await waitFor(async () => (await call(chef, 'GET', '/v1/party')).body.party.members.length === 2, 3000);
    assert.equal((await call(pia, 'GET', '/v1/party')).body.party, null);
    await back.close();
    open.splice(open.indexOf(back), 1);
  });

  test('Folgen: Leiter wechselt den Server → party-follow; Voice-Prüfwert nur zusammen, neu nach dem Gehen', async () => {
    const kim = await devPlayer(service.url, 'Kim');
    const kimWs = await online(kim);
    const { player: lou, ws: louWs } = await friendOf(kim, 'Lou');
    const { player: max, ws: maxWs } = await friendOf(kim, 'Maxi');
    const partyId = (await call(kim, 'POST', '/v1/party/invite', { uuid: lou.uuid })).body.party.id;
    await call(kim, 'POST', '/v1/party/invite', { uuid: max.uuid });
    await call(lou, 'POST', `/v1/party/${partyId}/accept`);
    await call(max, 'POST', `/v1/party/${partyId}/accept`);
    // Server ist auch mit „Server zeigen“ aus in der Party sichtbar
    await api(service.url, 'PUT', '/v1/me', { token: kim.token, body: { showServer: false } });
    louWs.send({ type: 'status', state: 'multiplayer', server: 'mc.example.de' });
    await partyState(kimWs, (p) => (p.members.find((m: { uuid: string }) => m.uuid === lou.uuid)?.location ?? null) !== null);

    kimWs.send({ type: 'status', state: 'multiplayer', server: 'mc.example.de' });
    // Lou ist schon dort: kein party-follow; Maxi bekommt es
    const follow = await maxWs.next('party-follow');
    assert.deepEqual(follow, {
      type: 'party-follow',
      party: partyId,
      leader: { uuid: kim.uuid, name: 'Kim' },
      target: { kind: 'server', target: 'mc.example.de', address: 'mc.example.de', title: 'mc.example.de' },
    });
    await louWs.sync();
    assert.equal(louWs.messages.some((m) => m.type === 'party-follow'), false);

    // Voice: Kim und Lou zusammen → beide denselben Prüfwert, Maxi (woanders) keinen
    const kimState = await partyState(kimWs, (p) => p.voice !== null);
    const louState = await partyState(louWs, (p) => p.voice !== null);
    assert.match(kimState.voice.group, /^[0-9a-f]{64}$/);
    assert.deepEqual(kimState.voice, louState.voice);
    assert.equal(kimState.voice.server, 'mc.example.de');
    assert.deepEqual(kimState.target, { kind: 'server', target: 'mc.example.de', address: 'mc.example.de', title: 'mc.example.de' });
    const maxState = (await call(max, 'GET', '/v1/party')).body.party;
    assert.equal(maxState.voice, null);
    assert.equal(maxState.members.find((m: { uuid: string }) => m.uuid === kim.uuid).location.target, 'mc.example.de');

    // Gleicher Server noch einmal: kein neues party-follow
    kimWs.send({ type: 'status', state: 'multiplayer', server: 'mc.example.de' });
    await kimWs.sync();
    await maxWs.sync();
    assert.equal(maxWs.messages.some((m) => m.type === 'party-follow'), false);

    // Maxi geht: neuer Prüfwert für die übrigen
    await call(max, 'POST', '/v1/party/leave');
    const after = await partyState(kimWs, (p) => p.members.length === 2 && p.voice !== null);
    assert.notEqual(after.voice.group, kimState.voice.group);
  });

  test('Folgen in die geteilte Welt des Leiters; Party-Mitglieder dürfen hinein (Zugang „eingeladen“)', async () => {
    const ina = await devPlayer(service.url, 'Ina');
    const inaWs = await online(ina);
    const { player: jo, ws: joWs } = await friendOf(ina, 'Jo');
    const partyId = (await call(ina, 'POST', '/v1/party/invite', { uuid: jo.uuid })).body.party.id;
    await call(jo, 'POST', `/v1/party/${partyId}/accept`);
    const world = await createWorld(service, ina, { name: 'Inselreich' });
    const host = await hostConnect(service, ina.token);
    open.push(host);
    await openWorld(host, world.id);
    await host.next('members');
    const follow = await joWs.next('party-follow');
    assert.deepEqual(follow.target, { kind: 'world', target: world.code, address: world.address, title: 'Inselreich' });
    const state = await partyState(inaWs, (p) => p.target !== null);
    assert.equal(state.target.kind, 'world');

    // Jo (Party) kommt über das Relay durch, obwohl er nicht auf der Liste steht; ein Fremder klopft an.
    const mc = await McClient.connect(service.relayPort!);
    mc.write(handshake(world.address, 2), loginStart('Jo'));
    const stream = await host.next('stream');
    assert.deepEqual([stream.kind, stream.name], ['login', 'Jo']);
    mc.destroy();
    const steve = await McClient.connect(service.relayPort!);
    steve.write(handshake(world.address, 2), loginStart('Steve'));
    assert.match(await steve.disconnectText(), /nicht eingeladen/);
    assert.equal((await host.next('knock')).name, 'Steve');

    // Jo meldet sich in der Welt (Status vom Spiel): gleicher Ort wie Ina → Voice-Prüfwert
    joWs.send({ type: 'status', state: 'multiplayer', server: world.address });
    const together = await partyState(joWs, (p) => p.voice !== null);
    assert.equal(together.voice.server, world.address);
    assert.equal(together.members.find((m: { uuid: string }) => m.uuid === jo.uuid).location.kind, 'world');
    await host.close();
    open.splice(open.indexOf(host), 1);
  });

  test('Blockieren entfernt aus der Party; Konto löschen ebenso; Einladung nach Ende der Freundschaft ungültig', async () => {
    const una = await devPlayer(service.url, 'Una');
    await online(una);
    const { player: vic, ws: vicWs } = await friendOf(una, 'Vic');
    const { player: wil } = await friendOf(una, 'Wil');
    const { player: xia } = await friendOf(una, 'Xia');
    const partyId = (await call(una, 'POST', '/v1/party/invite', { uuid: vic.uuid })).body.party.id;
    await call(vic, 'POST', `/v1/party/${partyId}/accept`);
    await call(una, 'POST', '/v1/party/invite', { uuid: wil.uuid });
    await call(wil, 'POST', `/v1/party/${partyId}/accept`);
    // Wil blockiert Vic: Vic fliegt raus
    await call(wil, 'POST', '/v1/blocks', { uuid: vic.uuid });
    assert.deepEqual(await vicWs.next((m) => m.type === 'party' && m.party === null), { type: 'party', party: null, reason: 'removed' });
    assert.deepEqual((await call(una, 'GET', '/v1/party')).body.party.members.map((m: { name: string }) => m.name), ['Una', 'Wil']);
    // Vic lässt sich nicht mehr einladen, solange Wil dabei ist (Vic ist noch Unas Freund)
    assert.equal((await call(una, 'POST', '/v1/party/invite', { uuid: vic.uuid })).status, 409);
    // Einladung an Xia, dann endet die Freundschaft: Einladung weg
    await call(una, 'POST', '/v1/party/invite', { uuid: xia.uuid });
    await call(una, 'DELETE', `/v1/friends/${xia.uuid}`);
    assert.equal((await call(xia, 'POST', `/v1/party/${partyId}/accept`)).status, 404);
    // Wil löscht sein Konto: Una bleibt allein, die Party löst sich auf
    await call(wil, 'DELETE', '/v1/me');
    assert.equal((await call(una, 'GET', '/v1/party')).body.party, null);
  });

  test('Annehmen verlässt die alte Party; Nicht stören macht Einladungen still', async () => {
    const ada = await devPlayer(service.url, 'Ada');
    await online(ada);
    const bea = await devPlayer(service.url, 'Bea');
    await online(bea);
    const { player: cem, ws: cemWs } = await friendOf(ada, 'Cem');
    await befriend(service.url, bea, cem);
    await api(service.url, 'PUT', '/v1/me', { token: cem.token, body: { dnd: true } });
    const first = (await call(ada, 'POST', '/v1/party/invite', { uuid: cem.uuid })).body.party.id;
    assert.equal((await cemWs.next((m) => m.type === 'party-invite' && m.invite !== null)).invite.quiet, true);
    await call(cem, 'POST', `/v1/party/${first}/accept`);
    const second = (await call(bea, 'POST', '/v1/party/invite', { uuid: cem.uuid })).body.party.id;
    const res = await call(cem, 'POST', `/v1/party/${second}/accept`);
    assert.equal(res.status, 200);
    assert.equal(res.body.party.leader, bea.uuid);
    // Ada war mit Cem allein: aufgelöst
    assert.equal((await call(ada, 'GET', '/v1/party')).body.party, null);
    assert.equal((await call(cem, 'GET', '/v1/party')).body.party.id, second);
  });
});
