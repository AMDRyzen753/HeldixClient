// Melden: Beleg aus den letzten Nachrichten, Prüfungen, Grenzen, Löschregeln und Aufbewahrung.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Store, type ReportRow } from '../src/db';
import { api, befriend, devPlayer, randomUuid, sleep, startService, waitFor, type Player, type TestService } from './helpers';

const report = (service: TestService, me: Player, body: unknown) => api(service.url, 'POST', '/v1/reports', { token: me.token, body });

/** Liest die Meldungen direkt aus der Datenbank des laufenden Dienstes (wie heldix-dienst-admin). */
function storedReports(service: TestService): ReportRow[] {
  const store = new Store(service.dataDir);
  try {
    return store.listReports();
  } finally {
    store.close();
  }
}

describe('Melden', () => {
  test('speichert Grund, Notiz, Namen und die letzten 20 Nachrichten als Beleg', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben, carla] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben'), await devPlayer(service.url, 'Carla')];
      await befriend(service.url, anna, ben);
      await befriend(service.url, anna, carla);
      for (let i = 1; i <= 25; i++) {
        const [from, to] = i % 2 ? [ben, anna] : [anna, ben];
        assert.equal((await api(service.url, 'POST', `/v1/messages/${to.uuid}`, { token: from.token, body: { text: `Nr. ${i}` } })).status, 200);
      }
      await api(service.url, 'POST', `/v1/messages/${carla.uuid}`, { token: anna.token, body: { text: 'gehört nicht dazu' } });

      const started = Date.now();
      const res = await report(service, anna, { uuid: ben.uuid, reason: 'harassment', note: '  beleidigt mich ständig  ' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body, { reported: true });

      const [stored, ...others] = storedReports(service);
      assert.equal(others.length, 0);
      assert.equal(stored!.reporter, anna.uuid);
      assert.equal(stored!.reporterName, 'Anna');
      assert.equal(stored!.reported, ben.uuid);
      assert.equal(stored!.reportedName, 'Ben');
      assert.equal(stored!.reason, 'harassment');
      assert.equal(stored!.note, 'beleidigt mich ständig');
      assert.ok(stored!.at >= started && stored!.at <= Date.now());
      const snapshot = JSON.parse(stored!.messages);
      assert.equal(snapshot.length, 20);
      assert.deepEqual(
        snapshot.map((m: { text: string }) => m.text),
        Array.from({ length: 20 }, (_, i) => `Nr. ${i + 6}`),
      );
      assert.deepEqual(Object.keys(snapshot[0]).sort(), ['at', 'from', 'id', 'text', 'to']);
      // Beide Richtungen sind dabei.
      assert.deepEqual(new Set(snapshot.map((m: { from: string }) => m.from)), new Set([anna.uuid, ben.uuid]));

      // Ins Log kommt nur, dass es etwas zu prüfen gibt, ohne Namen.
      const line = service.logs.find((l) => l.includes('Neue Meldung'));
      assert.ok(line, 'Log-Eintrag fehlt');
      assert.equal(line!.includes('Anna') || line!.includes('Ben') || line!.includes(ben.uuid), false);

      // Melden geht auch ohne Freundschaft und ohne Notiz (dann ohne Nachrichten im Beleg).
      const fremd = await devPlayer(service.url, 'Fremd');
      assert.equal((await report(service, fremd, { uuid: anna.uuid, reason: 'spam' })).status, 200);
      assert.equal((await report(service, carla, { uuid: ben.uuid, reason: 'other', note: null })).status, 200);
      const all = storedReports(service);
      assert.equal(all.length, 3);
      assert.deepEqual([all[1]!.note, all[1]!.messages], ['', '[]']);
    } finally {
      await service.close();
    }
  });

  test('Prüfungen: 400 und 404', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben')];
      const invalid: unknown[] = [
        {},
        { uuid: ben.uuid },
        { uuid: ben.uuid, reason: 'gemein' },
        { uuid: ben.uuid, reason: 'SPAM' },
        { uuid: ben.uuid, reason: 42 },
        { uuid: 'ABC', reason: 'spam' },
        { uuid: ben.uuid, reason: 'spam', note: 42 },
        { uuid: ben.uuid, reason: 'spam', note: 'x'.repeat(301) },
        { uuid: ben.uuid, reason: 'spam', note: 'Zeile\nZwei' },
        { uuid: ben.uuid, reason: 'spam', note: 'a\u0007' },
        { uuid: anna.uuid, reason: 'spam' },
      ];
      for (const body of invalid) {
        const res = await report(service, anna, body);
        assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
        assert.equal(typeof res.body.error, 'string');
      }
      const unknown = await report(service, anna, { uuid: randomUuid(), reason: 'spam' });
      assert.equal(unknown.status, 404);
      assert.equal(unknown.body.error, 'Dieser Spieler nutzt HeldixClient nicht (oder war noch nie online).');
      assert.equal(storedReports(service).length, 0);
      // 300 Zeichen gehen.
      assert.equal((await report(service, anna, { uuid: ben.uuid, reason: 'other', note: 'x'.repeat(300) })).status, 200);
      assert.equal((await api(service.url, 'POST', '/v1/reports', { body: { uuid: ben.uuid, reason: 'spam' } })).status, 401);
    } finally {
      await service.close();
    }
  });

  test('Grenzen: einmal pro Spieler und Zeitraum, höchstens 10 Meldungen pro Zeitraum', async () => {
    const service = await startService({ dev: true });
    try {
      const melder = await devPlayer(service.url, 'Melder');
      const targets: Player[] = [];
      for (let i = 0; i < 11; i++) targets.push(await devPlayer(service.url, `Ziel${i}`));
      assert.equal((await report(service, melder, { uuid: targets[0]!.uuid, reason: 'spam' })).status, 200);
      const twice = await report(service, melder, { uuid: targets[0]!.uuid, reason: 'other' });
      assert.equal(twice.status, 429);
      assert.equal(twice.body.error, 'Du hast Ziel0 in den letzten 24 Stunden schon gemeldet.');
      assert.ok(Number(twice.headers.get('retry-after')) > 23 * 3600);
      for (let i = 1; i < 10; i++) assert.equal((await report(service, melder, { uuid: targets[i]!.uuid, reason: 'spam' })).status, 200, `Meldung ${i + 1}`);
      const tooMany = await report(service, melder, { uuid: targets[10]!.uuid, reason: 'spam' });
      assert.equal(tooMany.status, 429);
      assert.equal(tooMany.body.error, 'Du hast in den letzten 24 Stunden schon 10 Spieler gemeldet. Versuche es später noch einmal.');
      // Andere dürfen weiter melden, auch denselben Spieler.
      assert.equal((await report(service, targets[1]!, { uuid: targets[0]!.uuid, reason: 'spam' })).status, 200);
      assert.equal(storedReports(service).length, 11);
    } finally {
      await service.close();
    }
  });

  test('Grenzen gelten nur im Zeitraum (hier 2 Meldungen pro 200 ms)', async () => {
    const service = await startService({ dev: true, reportLimit: 2, reportWindowMs: 200 });
    try {
      const [melder, a, b, c] = [
        await devPlayer(service.url, 'Melder'),
        await devPlayer(service.url, 'A1'),
        await devPlayer(service.url, 'B1'),
        await devPlayer(service.url, 'C1'),
      ];
      assert.equal((await report(service, melder, { uuid: a.uuid, reason: 'spam' })).status, 200);
      assert.equal((await report(service, melder, { uuid: b.uuid, reason: 'spam' })).status, 200);
      assert.equal((await report(service, melder, { uuid: c.uuid, reason: 'spam' })).status, 429);
      assert.equal((await report(service, melder, { uuid: a.uuid, reason: 'spam' })).status, 429);
      await sleep(250);
      assert.equal((await report(service, melder, { uuid: c.uuid, reason: 'spam' })).status, 200);
      assert.equal((await report(service, melder, { uuid: a.uuid, reason: 'spam' })).status, 200);
    } finally {
      await service.close();
    }
  });

  test('Konto löschen: eigene Meldungen weg, Meldungen über einen bleiben bis zum Ablauf', async () => {
    const service = await startService({ dev: true });
    try {
      const [anna, ben, carla] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben'), await devPlayer(service.url, 'Carla')];
      await report(service, anna, { uuid: ben.uuid, reason: 'spam' });
      await report(service, ben, { uuid: anna.uuid, reason: 'harassment' });
      await report(service, carla, { uuid: anna.uuid, reason: 'other' });
      assert.equal(storedReports(service).length, 3);
      assert.equal((await api(service.url, 'DELETE', '/v1/me', { token: anna.token })).status, 200);
      const left = storedReports(service);
      assert.deepEqual(
        left.map((r) => [r.reporterName, r.reportedName, r.reported]),
        [
          ['Ben', 'Anna', anna.uuid],
          ['Carla', 'Anna', anna.uuid],
        ],
      );
    } finally {
      await service.close();
    }
  });

  test('Aufbewahrung: Das Aufräumen löscht alte Meldungen (im Test nach 150 ms)', async () => {
    const service = await startService({ dev: true, reportTtlMs: 150, sweepIntervalMs: 40 });
    try {
      const [anna, ben] = [await devPlayer(service.url, 'Anna'), await devPlayer(service.url, 'Ben')];
      await report(service, anna, { uuid: ben.uuid, reason: 'spam' });
      assert.equal(storedReports(service).length, 1);
      await waitFor(() => storedReports(service).length === 0);
    } finally {
      await service.close();
    }
  });
});
