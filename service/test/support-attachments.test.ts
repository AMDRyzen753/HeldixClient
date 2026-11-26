// Anhänge an Support-Anfragen (Absturzhilfe des Launchers): nur Text, Name und Größe geprüft, gzip in der Datenbank,
// Download nie als HTML, Grenzen je Anfrage und Stunde, nur eigene Anfragen, Team sieht alle, Löschen mit der Anfrage.
import assert from 'node:assert/strict';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { api, devPlayer, rawRequest, rawUpload, startService, waitFor, type Player, type TestService } from './helpers';
import { Clock, teamLogin, webApi, WEBSITE } from './web-helpers';
import { SESSION_COOKIE } from '../src/web';

const TEXT = 'text/plain; charset=utf-8';
const crash = (n: number) => `---- Minecraft Crash Report ----\n// Ups.\nDatei: ~/AppData/Roaming/.heldixclient/mods ${n}\n<script>alert(1)</script> Grüße ✓\n`.repeat(50);

describe('Anhänge an Support-Anfragen', () => {
  const clock = new Clock();
  let service: TestService;
  let anna: Player;
  let ben: Player;
  let mod: string;

  const ticket = async (player: Player, subject = 'Absturz') => {
    const res = await api(service.url, 'POST', '/v1/support', { token: player.token, body: { category: 'fehler', subject, text: 'Mein Spiel stürzt ab.' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.ticket.id as number;
  };
  const attach = (player: Player, id: number, name: string | null, data: Buffer | string, contentType = TEXT, declared?: number) =>
    rawUpload(
      service.url,
      'POST',
      `/v1/support/${id}/attachments${name === null ? '' : `?name=${encodeURIComponent(name)}`}`,
      Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'),
      { Authorization: `Bearer ${player.token}`, 'Content-Type': contentType },
      declared,
    );
  const db = () => new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));

  before(async () => {
    service = await startService({ dev: true, website: WEBSITE, totpNow: clock.read });
    anna = await devPlayer(service.url, 'Anna');
    ben = await devPlayer(service.url, 'Ben');
    mod = (await teamLogin(service, await devPlayer(service.url, 'Moderator'), 'moderator', clock)).cookie;
  });
  after(() => service.close());

  test('hochladen, in der Anfrage sehen, als Text herunterladen (Spieler und Team), gzip in der Datenbank', async () => {
    const id = await ticket(anna);
    const text = crash(1);
    let res = await attach(anna, id, 'crash-2026-11-26_12.00.00-client.txt', text);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const [attachment] = res.body.ticket.attachments;
    assert.deepEqual(Object.keys(attachment).sort(), ['at', 'id', 'name', 'size']);
    assert.deepEqual([attachment.name, attachment.size], ['crash-2026-11-26_12.00.00-client.txt', Buffer.byteLength(text)]);
    // In der Liste und in der Ansicht des Teams
    assert.deepEqual((await api(service.url, 'GET', '/v1/support', { token: anna.token })).body.tickets[0].attachments, [attachment]);
    assert.deepEqual((await webApi(service, 'GET', `/v1/team/support/${id}`, { cookie: mod })).body.ticket.attachments, [attachment]);

    for (const [p, headers] of [
      [`/v1/support/${id}/attachments/${attachment.id}`, { Authorization: `Bearer ${anna.token}` }],
      [`/v1/team/support/${id}/attachments/${attachment.id}`, { Cookie: `${SESSION_COOKIE}=${mod}` }],
    ] as [string, Record<string, string>][]) {
      const download = await rawRequest(service.url, 'GET', p, headers);
      assert.equal(download.status, 200, p);
      assert.equal(download.body.toString('utf8'), text);
      assert.equal(download.headers['content-type'], TEXT);
      assert.equal(download.headers['content-disposition'], 'attachment; filename="crash-2026-11-26_12.00.00-client.txt"');
      assert.equal(download.headers['x-content-type-options'], 'nosniff');
      assert.equal(download.headers['cache-control'], 'private, no-store');
      assert.match(String(download.headers['content-security-policy']), /sandbox/);
    }
    // Gespeichert gzip-komprimiert
    const check = db();
    try {
      const row = check.prepare('SELECT size, data FROM ticket_attachments WHERE id = ?').get(attachment.id) as { size: number; data: Uint8Array };
      assert.deepEqual([row.data[0], row.data[1]], [0x1f, 0x8b]);
      assert.ok(row.data.length < row.size / 5, 'komprimiert');
    } finally {
      check.close();
    }
    // Ohne charset, .log und Großbuchstaben in der Endung gehen auch
    res = await attach(anna, id, 'latest.LOG', 'Zeile\n', 'text/plain');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.ticket.attachments.map((a: { name: string }) => a.name), ['crash-2026-11-26_12.00.00-client.txt', 'latest.LOG']);
  });

  test('abgelehnt: falscher Name, kein Text, leer, kein UTF-8, Nullbytes, über 512 KiB', async () => {
    const id = await ticket(ben, 'Prüfungen');
    for (const name of [null, '', 'crash.exe', 'crash.txt.html', '../crash.txt', 'ordner/crash.txt', 'mit leer.txt', 'ümlaut.txt', `${'a'.repeat(77)}.txt`, 'crash']) {
      const res = await attach(ben, id, name, 'x');
      assert.equal(res.status, 400, String(name));
      assert.match(res.body.error, /Ungültiger Dateiname/);
    }
    assert.equal((await attach(ben, id, `${'a'.repeat(76)}.txt`, 'x')).status, 200, '80 Zeichen gehen');
    for (const type of ['application/octet-stream', 'text/html', 'text/plain; charset=iso-8859-1', '']) {
      const res = await attach(ben, id, 'a.txt', 'x', type);
      assert.equal(res.status, 415, type);
    }
    let res = await attach(ben, id, 'a.txt', '');
    assert.deepEqual([res.status, res.body.error], [400, 'Der Anhang ist leer.']);
    res = await attach(ben, id, 'a.txt', Buffer.from([0x48, 0xff, 0xfe, 0x41]));
    assert.deepEqual([res.status, res.body.error], [400, 'Der Anhang ist kein gültiger UTF-8-Text.']);
    res = await attach(ben, id, 'a.txt', Buffer.from('ab\u0000cd', 'latin1'));
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Nullbytes/);
    res = await attach(ben, id, 'a.txt', Buffer.alloc(100, 0x41), TEXT, 512 * 1024 + 1);
    assert.equal(res.status, 413);
    // Genau 512 KiB gehen
    assert.equal((await attach(ben, id, 'gross.log', Buffer.alloc(512 * 1024, 0x41))).status, 200);
    assert.equal((await api(service.url, 'GET', `/v1/support/${id}`, { token: ben.token })).body.ticket.attachments.length, 2);
  });

  test('nur eigene Anfragen, nicht geschlossen; Download nur aus der eigenen Anfrage; ohne Anmeldung 401', async () => {
    const annas = (await api(service.url, 'GET', '/v1/support', { token: anna.token })).body.tickets[0];
    const own = annas.attachments[0].id;
    assert.equal((await attach(ben, annas.id, 'a.txt', 'x')).status, 404);
    assert.equal((await rawRequest(service.url, 'GET', `/v1/support/${annas.id}/attachments/${own}`, { Authorization: `Bearer ${ben.token}` })).status, 404);
    assert.equal((await rawRequest(service.url, 'GET', `/v1/support/${annas.id}/attachments/${own}`)).status, 401);
    // Anhang über eine andere (eigene) Anfrage abrufen: 404
    const bens = (await api(service.url, 'GET', '/v1/support', { token: ben.token })).body.tickets[0];
    assert.equal((await rawRequest(service.url, 'GET', `/v1/support/${bens.id}/attachments/${own}`, { Authorization: `Bearer ${ben.token}` })).status, 404);
    assert.equal((await rawRequest(service.url, 'GET', `/v1/team/support/${bens.id}/attachments/${own}`, { Cookie: `${SESSION_COOKIE}=${mod}` })).status, 404);
    for (const aid of ['999999', 'x']) {
      assert.equal((await rawRequest(service.url, 'GET', `/v1/support/${annas.id}/attachments/${aid}`, { Authorization: `Bearer ${anna.token}` })).status, 404, aid);
    }
    assert.equal((await rawRequest(service.url, 'GET', `/v1/team/support/${annas.id}/attachments/${own}`, { Authorization: `Bearer ${anna.token}` })).status, 401);
    // Antwort des Teams, dann ein Anhang: wieder offen; geschlossen: 409
    assert.equal((await webApi(service, 'POST', `/v1/team/support/${bens.id}/messages`, { cookie: mod, body: { text: 'Bitte das Log schicken.' } })).body.ticket.status, 'answered');
    const res = await attach(ben, bens.id, 'latest.log', 'Log');
    assert.deepEqual([res.status, res.body.ticket.status], [200, 'open']);
    assert.equal((await api(service.url, 'POST', `/v1/support/${bens.id}/close`, { token: ben.token })).status, 200);
    const closed = await attach(ben, bens.id, 'latest.log', 'Log');
    assert.deepEqual([closed.status, closed.body.error], [409, 'Diese Anfrage ist geschlossen. Bitte schreib eine neue.']);
  });

  test('Grenzen: 5 je Anfrage (409), 10 je Spieler und Stunde (429 mit Retry-After)', async () => {
    const carla = await devPlayer(service.url, 'Carla');
    const first = await ticket(carla, 'Eins');
    for (let i = 1; i <= 5; i++) assert.equal((await attach(carla, first, `log-${i}.log`, `Log ${i}`)).status, 200, String(i));
    let res = await attach(carla, first, 'log-6.log', 'zu viel');
    assert.deepEqual([res.status, res.body.error], [409, 'Höchstens 5 Anhänge pro Anfrage.']);
    const second = await ticket(carla, 'Zwei');
    for (let i = 1; i <= 5; i++) assert.equal((await attach(carla, second, `log-${i}.log`, `Log ${i}`)).status, 200, String(i));
    const third = await ticket(carla, 'Drei');
    res = await attach(carla, third, 'log-11.log', 'zu viel');
    assert.equal(res.status, 429);
    assert.match(res.body.error, /Höchstens 10 Anhänge pro Stunde/);
    assert.ok(Number(res.headers['retry-after']) >= 1);
  });

  test('Datenexport (Namen und Größen, kein Inhalt) und Löschen mit dem Konto', async () => {
    const exported = await rawRequest(service.url, 'GET', '/v1/me/export', { Authorization: `Bearer ${anna.token}` });
    const tickets = JSON.parse(exported.body.toString('utf8')).support;
    const names = tickets.flatMap((t: { attachments: { name: string }[] }) => t.attachments.map((a) => a.name));
    assert.deepEqual(names, ['crash-2026-11-26_12.00.00-client.txt', 'latest.LOG']);
    assert.deepEqual(Object.keys(tickets[0].attachments[0]).sort(), ['at', 'id', 'name', 'size']);
    assert.equal(exported.body.toString('utf8').includes('Minecraft Crash Report'), false, 'ohne Inhalt');

    const count = (uuid: string) => {
      const check = db();
      try {
        return Number((check.prepare('SELECT count(*) AS n FROM ticket_attachments WHERE uuid = ?').get(uuid) as { n: number }).n);
      } finally {
        check.close();
      }
    };
    assert.equal(count(anna.uuid), 2);
    assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: anna.token })).status, 200);
    assert.equal(count(anna.uuid), 0);
    assert.equal(count(ben.uuid), 3, 'andere bleiben');
  });
});

test('Aufbewahrung: Anhänge gehen mit der Anfrage', async () => {
  const service = await startService({ dev: true, supportClosedTtlMs: 50, sweepIntervalMs: 50 });
  try {
    const anna = await devPlayer(service.url, 'Anna');
    const created = await api(service.url, 'POST', '/v1/support', { token: anna.token, body: { category: 'fehler', subject: 'Absturz', text: 'Hilfe' } });
    const id = created.body.ticket.id;
    const res = await rawUpload(service.url, 'POST', `/v1/support/${id}/attachments?name=crash.txt`, Buffer.from('Bericht'), {
      Authorization: `Bearer ${anna.token}`,
      'Content-Type': TEXT,
    });
    assert.equal(res.status, 200);
    assert.equal((await api(service.url, 'POST', `/v1/support/${id}/close`, { token: anna.token })).status, 200);
    const count = () => {
      const check = new DatabaseSync(path.join(service.dataDir, 'heldix-dienst.db'));
      try {
        return Number((check.prepare('SELECT count(*) AS n FROM ticket_attachments').get() as { n: number }).n);
      } finally {
        check.close();
      }
    };
    await waitFor(() => count() === 0, 3000);
    assert.equal((await api(service.url, 'GET', '/v1/support', { token: anna.token })).body.tickets.length, 0);
  } finally {
    await service.close();
  }
});
