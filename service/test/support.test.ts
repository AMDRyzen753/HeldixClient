// Support-Anfragen: Spieler und Team, Status, ungelesen, Namen des Teams, WebSocket, Grenzen, Aufbewahrung, Löschen.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { runAdmin } from '../src/admin';
import { api, connect, devPlayer, sleep, startService, waitFor, type Player, type TestService, type WsClient } from './helpers';
import { Clock, teamLogin, webApi, webLogin, WEBSITE } from './web-helpers';

const quiet = { out: () => {}, err: () => {} };
const TICKET_KEYS = ['at', 'attachments', 'category', 'id', 'messages', 'player', 'status', 'subject', 'unread', 'updatedAt'];

function create(service: TestService, player: Player, body: Record<string, unknown> = {}) {
  return api(service.url, 'POST', '/v1/support', {
    token: player.token,
    body: { category: 'hilfe', subject: 'Launcher startet nicht', text: 'Hallo,\nder Launcher startet nicht.', ...body },
  });
}

describe('Support', () => {
  const clock = new Clock();
  let service: TestService;
  let anna: Player;
  let ben: Player;
  let modCookie: string;
  let adminCookie: string;
  let mod: Player;

  before(async () => {
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    mod = await devPlayer(service.url, 'Moderator');
    adminCookie = (await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock)).cookie;
    modCookie = (await teamLogin(service, mod, 'moderator', clock)).cookie;
  });
  after(() => service.close());

  test('Anfrage schreiben, ansehen, antworten, schließen (Spieler) mit Bearer und Cookie', async () => {
    const created = await create(service, anna);
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const ticket = created.body.ticket;
    assert.deepEqual(Object.keys(ticket).sort(), TICKET_KEYS);
    assert.deepEqual([ticket.category, ticket.subject, ticket.status, ticket.unread], ['hilfe', 'Launcher startet nicht', 'open', false]);
    assert.deepEqual(ticket.player, { uuid: anna.uuid, name: 'Anna' });
    assert.equal(ticket.at, ticket.updatedAt);
    assert.equal(ticket.messages.length, 1);
    assert.deepEqual(Object.keys(ticket.messages[0]).sort(), ['at', 'author', 'from', 'id', 'text']);
    assert.deepEqual([ticket.messages[0].from, ticket.messages[0].author, ticket.messages[0].text], ['player', 'Anna', 'Hallo,\nder Launcher startet nicht.']);

    // Liste ohne Nachrichten, neueste Aktivität zuerst.
    await sleep(3);
    const second = (await create(service, anna, { category: 'konto', subject: 'Name geändert' })).body.ticket;
    let list = await api(service.url, 'GET', '/v1/support', { token: anna.token });
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.tickets.map((t: { id: number }) => t.id), [second.id, ticket.id]);
    assert.deepEqual(Object.keys(list.body.tickets[0]).sort(), TICKET_KEYS.filter((k) => k !== 'messages'));
    await sleep(3);
    const { cookie } = await webLogin(service, anna);
    const reply = await webApi(service, 'POST', `/v1/support/${ticket.id}/messages`, { cookie, body: { text: 'Noch da?' } });
    assert.equal(reply.status, 200);
    assert.equal(reply.body.ticket.messages.length, 2);
    list = await webApi(service, 'GET', '/v1/support', { cookie });
    assert.deepEqual(list.body.tickets.map((t: { id: number }) => t.id), [ticket.id, second.id], 'Aktivität zählt');

    // Nur eigene: fremde und unbekannte Nummern 404.
    assert.equal((await api(service.url, 'GET', `/v1/support/${ticket.id}`, { token: ben.token })).status, 404);
    assert.equal((await api(service.url, 'POST', `/v1/support/${ticket.id}/messages`, { token: ben.token, body: { text: 'x' } })).status, 404);
    assert.equal((await api(service.url, 'POST', `/v1/support/${ticket.id}/close`, { token: ben.token })).status, 404);
    assert.equal((await api(service.url, 'GET', '/v1/support/999999', { token: anna.token })).status, 404);
    assert.equal((await api(service.url, 'GET', '/v1/support/abc', { token: anna.token })).status, 404);
    assert.equal((await api(service.url, 'GET', '/v1/support')).status, 401);
    // CSRF gilt auch hier.
    assert.equal((await webApi(service, 'POST', '/v1/support', { cookie, body: {}, csrf: false })).status, 403);

    // Schließen: danach keine Antworten mehr, erneutes Schließen ändert nichts.
    const closed = await api(service.url, 'POST', `/v1/support/${second.id}/close`, { token: anna.token });
    assert.equal(closed.body.ticket.status, 'closed');
    assert.equal((await api(service.url, 'POST', `/v1/support/${second.id}/close`, { token: anna.token })).body.ticket.status, 'closed');
    const late = await api(service.url, 'POST', `/v1/support/${second.id}/messages`, { token: anna.token, body: { text: 'Doch noch was' } });
    assert.equal(late.status, 409);
    assert.equal((await webApi(service, 'POST', `/v1/team/support/${second.id}/messages`, { cookie: modCookie, body: { text: 'x' } })).status, 409);
  });

  test('Prüfungen beim Schreiben', async () => {
    const invalid: Record<string, unknown>[] = [
      { category: 'beschwerde' },
      { category: 42 },
      { subject: '' },
      { subject: 'zwei\nZeilen' },
      { subject: 'x'.repeat(101) },
      { text: '' },
      { text: 'x'.repeat(2001) },
      { text: 'mit\tTab' },
      { text: 42 },
    ];
    for (const body of invalid) {
      const res = await create(service, ben, body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(typeof res.body.error, 'string');
    }
    for (const category of ['hilfe', 'fehler', 'konto', 'sonstiges']) {
      const res = await create(service, ben, { category, subject: 'x'.repeat(100), text: 'y'.repeat(2000) });
      assert.equal(res.status, category === 'sonstiges' ? 409 : 200, category);
    }
    for (const t of (await api(service.url, 'GET', '/v1/support', { token: ben.token })).body.tickets) {
      await api(service.url, 'POST', `/v1/support/${t.id}/close`, { token: ben.token });
    }
  });

  test('Team: Liste nach Status, ansehen, antworten (WebSocket an den Spieler), schließen; ungelesen auf beiden Seiten', async () => {
    const carla = await devPlayer(service.url, 'Carla');
    const ticket = (await create(service, carla, { category: 'fehler', subject: 'Absturz' })).body.ticket;
    const ws1 = await connect(service.wsUrl, carla.token);
    const ws2 = await connect(service.wsUrl, carla.token);
    const clients: WsClient[] = [ws1.client, ws2.client];
    try {
      let list = await webApi(service, 'GET', '/v1/team/support', { cookie: modCookie });
      assert.equal(list.status, 200);
      const entry = list.body.tickets.find((t: { id: number }) => t.id === ticket.id);
      assert.deepEqual([entry.status, entry.unread, entry.player.name], ['open', true, 'Carla'], 'Team: wartet auf Antwort');
      assert.equal(entry.messages, undefined);

      const full = await webApi(service, 'GET', `/v1/team/support/${ticket.id}`, { cookie: modCookie });
      assert.equal(full.body.ticket.messages[0].author, 'Carla');
      const answered = await webApi(service, 'POST', `/v1/team/support/${ticket.id}/messages`, { cookie: modCookie, body: { text: 'Welche Version?\nBitte Log schicken.' } });
      assert.equal(answered.status, 200);
      assert.deepEqual([answered.body.ticket.status, answered.body.ticket.unread], ['answered', false]);
      assert.equal(answered.body.ticket.messages[1].author, 'Moderator', 'das Team sieht den echten Namen');
      for (const client of clients) {
        assert.deepEqual(await client.next('support'), { type: 'support', id: ticket.id, subject: 'Absturz' });
      }

      // Spieler: ungelesen, bis er die Anfrage öffnet; das Team-Mitglied ist nicht öffentlich.
      let mine = (await api(service.url, 'GET', '/v1/support', { token: carla.token })).body.tickets.find((t: { id: number }) => t.id === ticket.id);
      assert.deepEqual([mine.status, mine.unread], ['answered', true]);
      const opened = await api(service.url, 'GET', `/v1/support/${ticket.id}`, { token: carla.token });
      assert.equal(opened.body.ticket.messages[1].author, 'HeldixClient-Team');
      assert.equal(opened.body.ticket.unread, false);
      mine = (await api(service.url, 'GET', '/v1/support', { token: carla.token })).body.tickets.find((t: { id: number }) => t.id === ticket.id);
      assert.equal(mine.unread, false);

      // Ist das Mitglied öffentlich, sieht der Spieler seinen Namen.
      await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: modCookie, body: { public: true } });
      assert.equal((await api(service.url, 'GET', `/v1/support/${ticket.id}`, { token: carla.token })).body.ticket.messages[1].author, 'Moderator');
      await webApi(service, 'PUT', '/v1/team/me/profile', { cookie: modCookie, body: { public: false } });

      // Antwort des Spielers: wieder open, für das Team ungelesen.
      const back = await api(service.url, 'POST', `/v1/support/${ticket.id}/messages`, { token: carla.token, body: { text: 'Version 1.2.0' } });
      assert.equal(back.body.ticket.status, 'open');
      list = await webApi(service, 'GET', '/v1/team/support?status=open', { cookie: modCookie });
      assert.equal(list.body.tickets.find((t: { id: number }) => t.id === ticket.id).unread, true);
      assert.equal((await webApi(service, 'GET', '/v1/team/support?status=answered', { cookie: modCookie })).body.tickets.some((t: { id: number }) => t.id === ticket.id), false);

      const closed = await webApi(service, 'POST', `/v1/team/support/${ticket.id}/close`, { cookie: modCookie });
      assert.equal(closed.body.ticket.status, 'closed');
      assert.ok((await webApi(service, 'GET', '/v1/team/support?status=closed', { cookie: modCookie })).body.tickets.some((t: { id: number }) => t.id === ticket.id));
      assert.ok((await webApi(service, 'GET', '/v1/team/support?status=all', { cookie: modCookie })).body.tickets.length >= 3);
      assert.equal((await webApi(service, 'GET', '/v1/team/support?status=kaputt', { cookie: modCookie })).status, 400);
      assert.equal((await webApi(service, 'GET', '/v1/team/support/999999', { cookie: modCookie })).status, 404);

      const audit = (await webApi(service, 'GET', '/v1/team/audit', { cookie: adminCookie })).body.entries;
      assert.ok(audit.some((e: { action: string; target: string }) => e.action === 'support.reply' && e.target === `Anfrage ${ticket.id} (Carla)`));
      assert.ok(audit.some((e: { action: string; target: string }) => e.action === 'support.close' && e.target === `Anfrage ${ticket.id} (Carla)`));
    } finally {
      for (const client of clients) await client.close();
    }
  });

  test('Team-Gate: ohne Rolle forbidden, ohne bestätigten Code 2fa_required, mit Bearer 401', async () => {
    const player = await devPlayer(service.url, 'Neugierig');
    const { cookie } = await webLogin(service, player);
    let res = await webApi(service, 'GET', '/v1/team/support', { cookie });
    assert.deepEqual([res.status, res.body.code], [403, 'forbidden']);
    const second = await webLogin(service, mod);
    res = await webApi(service, 'GET', '/v1/team/support', { cookie: second.cookie });
    assert.deepEqual([res.status, res.body.code], [403, '2fa_required']);
    assert.equal((await api(service.url, 'GET', '/v1/team/support', { token: mod.token })).status, 401);
  });
});

describe('Support: Grenzen', () => {
  test('höchstens 3 offene, 5 neue pro 24 Stunden, N Nachrichten pro Stunde (hier 4)', async () => {
    const service = await startService({ dev: true, supportHourlyMessages: 4 });
    try {
      const player = await devPlayer(service.url, 'Viel');
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) ids.push((await create(service, player, { subject: `Nr. ${i}` })).body.ticket.id);
      const fourth = await create(service, player);
      assert.equal(fourth.status, 409);
      assert.equal(fourth.body.error, 'Du hast schon 3 offene Anfragen. Schließ eine, bevor du eine neue schreibst.');
      // Nachrichten pro Stunde: 3 erste Nachrichten + 1 Antwort = 4, die fünfte nicht.
      assert.equal((await api(service.url, 'POST', `/v1/support/${ids[0]}/messages`, { token: player.token, body: { text: 'x' } })).status, 200);
      const tooMany = await api(service.url, 'POST', `/v1/support/${ids[0]}/messages`, { token: player.token, body: { text: 'y' } });
      assert.equal(tooMany.status, 429);
      assert.ok(Number(tooMany.headers.get('retry-after')) > 3000);
    } finally {
      await service.close();
    }
    const daily = await startService({ dev: true });
    try {
      const player = await devPlayer(daily.url, 'Taeglich');
      for (let i = 0; i < 5; i++) {
        const res = await create(daily, player, { subject: `Nr. ${i}` });
        assert.equal(res.status, 200, `Anfrage ${i + 1}`);
        await api(daily.url, 'POST', `/v1/support/${res.body.ticket.id}/close`, { token: player.token });
      }
      const sixth = await create(daily, player);
      assert.equal(sixth.status, 429);
      assert.ok(Number(sixth.headers.get('retry-after')) > 23 * 3600);
      // 30 Nachrichten pro Stunde (Standard): Die erste Nachricht einer neuen Anfrage zählt mit.
      const other = await devPlayer(daily.url, 'Schreiber');
      const id = (await create(daily, other)).body.ticket.id;
      for (let i = 0; i < 29; i++) {
        assert.equal((await api(daily.url, 'POST', `/v1/support/${id}/messages`, { token: other.token, body: { text: `m${i}` } })).status, 200, `Nachricht ${i + 2}`);
      }
      assert.equal((await api(daily.url, 'POST', `/v1/support/${id}/messages`, { token: other.token, body: { text: 'zu viel' } })).status, 429);
    } finally {
      await daily.close();
    }
  });
});

describe('Support: Aufbewahrung, Export, Löschen', () => {
  test('geschlossene nach N (hier 150 ms), offene nach M ohne Nachricht (hier 400 ms)', async () => {
    const service = await startService({ dev: true, supportClosedTtlMs: 150, supportIdleTtlMs: 400, sweepIntervalMs: 40 });
    try {
      const player = await devPlayer(service.url, 'Alt');
      const closed = (await create(service, player, { subject: 'zu' })).body.ticket.id;
      const open = (await create(service, player, { subject: 'offen' })).body.ticket.id;
      await api(service.url, 'POST', `/v1/support/${closed}/close`, { token: player.token });
      await waitFor(async () => (await api(service.url, 'GET', `/v1/support/${closed}`, { token: player.token })).status === 404);
      assert.equal((await api(service.url, 'GET', `/v1/support/${open}`, { token: player.token })).status, 200, 'offene bleibt länger');
      await waitFor(async () => (await api(service.url, 'GET', `/v1/support/${open}`, { token: player.token })).status === 404);
    } finally {
      await service.close();
    }
  });

  test('Export enthält die Anfragen; DELETE /v1/me und Sperre löschen sie', async () => {
    const clock = new Clock();
    const service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    try {
      const { cookie } = await teamLogin(service, await devPlayer(service.url, 'Chefin'), 'admin', clock);
      const anna = await devPlayer(service.url, 'Anna');
      const ben = await devPlayer(service.url, 'Ben');
      const annaTicket = (await create(service, anna, { subject: 'Exportiert' })).body.ticket.id;
      await webApi(service, 'POST', `/v1/team/support/${annaTicket}/messages`, { cookie, body: { text: 'Antwort' } });
      const benTicket = (await create(service, ben, { subject: 'Gesperrt' })).body.ticket.id;

      const exported = await api(service.url, 'GET', '/v1/me/export', { token: anna.token });
      assert.deepEqual(exported.body.support.map((t: { subject: string; messages: { author: string }[] }) => [t.subject, t.messages.map((m) => m.author)]), [
        ['Exportiert', ['Anna', 'HeldixClient-Team']],
      ]);

      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: anna.token })).status, 200);
      assert.equal((await webApi(service, 'GET', `/v1/team/support/${annaTicket}`, { cookie })).status, 404);
      assert.equal(runAdmin(['sperren', 'Ben'], service.dataDir, quiet), 0);
      assert.equal((await webApi(service, 'GET', `/v1/team/support/${benTicket}`, { cookie })).status, 404);
      assert.deepEqual((await webApi(service, 'GET', '/v1/team/support?status=all', { cookie })).body.tickets, []);
    } finally {
      await service.close();
    }
  });
});
