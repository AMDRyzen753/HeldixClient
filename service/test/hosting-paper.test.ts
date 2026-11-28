// Ende-zu-Ende mit echtem Paper (1.13.0): ProcessRunner (Java-Prozess ohne Container), echte Fill-API für das Jar,
// Welt anlegen → Login über das Relay weckt sie → Status kommt vom echten Paper (MOTD mit „Geteilt mit HeldixClient“) →
// Login geht an Paper (online-mode: Verschlüsselungsanfrage) → anhalten → schläft.
//
// Läuft nur mit HELDIX_TEST_PAPER=1 (lädt einmal das Paper-Jar und beim ersten Start die Bibliotheken von Mojang):
//   HELDIX_TEST_PAPER=1
//   HELDIX_DIENST_WELTEN_JAVA=<Java 25>           (sonst „java“ aus dem PATH)
//   HELDIX_TEST_PAPER_CACHE=<Ordner für das Jar>   (sonst im Temp-Ordner)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { ProcessRunner } from '../src/hosting/process-runner';
import { api, devPlayer, startService } from './helpers';
import { grantBeta, waitState } from './hosting-helpers';
import { DOMAIN, handshake, loginStart, McClient, pingPacket, STATUS_REQUEST } from './world-helpers';

const enabled = process.env.HELDIX_TEST_PAPER === '1';

function text(description: unknown): string {
  if (typeof description === 'string') return description;
  if (typeof description !== 'object' || description === null) return '';
  const d = description as { text?: string; extra?: unknown[] };
  return [d.text ?? '', ...(d.extra ?? []).map(text)].join('');
}

describe('Ende-zu-Ende mit echtem Paper 26.3', { skip: enabled ? false : 'nur mit HELDIX_TEST_PAPER=1' }, () => {
  test('Welt anlegen, Login über das Relay weckt sie, Status und Login vom echten Paper, anhalten', { timeout: 15 * 60_000 }, async () => {
    const previousDev = process.env.HELDIX_DIENST_DEV;
    process.env.HELDIX_DIENST_DEV = '1';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-paper-e2e-'));
    const logs: string[] = [];
    const runner = new ProcessRunner({
      root: path.join(root, 'worlds'),
      java: process.env.HELDIX_DIENST_WELTEN_JAVA ?? 'java',
      jarCache: process.env.HELDIX_TEST_PAPER_CACHE ?? path.join(os.tmpdir(), 'heldix-paper-cache'),
      userAgent: 'heldix-dienst/1.13.0 (test)',
      log: (line) => logs.push(line),
    });
    const service = await startService({
      dev: true,
      weltDomain: DOMAIN,
      website: 'https://heldix.example',
      hostingRunner: runner,
      hostingMax: 1,
      hostingStartTimeoutMs: 10 * 60_000,
      hostingStopTimeoutMs: 120_000,
      hostingTickMs: 500,
      hostingReadyPollMs: 1000,
      worldConnectionsPerMinute: 1000,
    });
    const clients: McClient[] = [];
    const mc = async () => {
      const client = await McClient.connect(service.relayPort!);
      clients.push(client);
      return client;
    };
    try {
      const anna = await devPlayer(service.url, 'Anna');
      grantBeta(service, anna.uuid);
      const created = await api(service.url, 'POST', '/v1/hosting/worlds', {
        token: anna.token,
        body: { world: null, name: 'Paperwelt', version: '26.3', type: 'flat', gameMode: 'creative' },
      });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.deepEqual([created.body.software, created.body.version], ['paper', '26.3']);
      const id = created.body.id;
      await waitState(service, anna, id, 'sleeping', 5 * 60_000);
      await api(service.url, 'PATCH', `/v1/worlds/${id}`, { token: anna.token, body: { access: 'open' } });
      const address = `${created.body.code}.${DOMAIN}`;

      // Login über das Relay weckt die Welt
      const first = await mc();
      first.write(handshake(address, 2), loginStart('Steve'));
      assert.equal(await first.disconnectText(), 'Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.');
      const running = await waitState(service, anna, id, 'running', 10 * 60_000);
      assert.equal(running.software, 'paper');

      // Status vom echten Paper über das Relay
      const status = await mc();
      status.write(handshake(address, 1), STATUS_REQUEST);
      const json = await status.json(0x00, 10_000);
      const payload = randomBytes(8);
      status.write(pingPacket(payload));
      const pong = await status.packet(10_000);
      assert.deepEqual([pong.id, pong.data], [0x01, payload]);
      const description = text(json.description);
      assert.match(description, /Paperwelt/);
      assert.match(description, /Geteilt mit .*HeldixClient/);
      assert.match(String(json.version?.name ?? ''), /26\.3/);
      assert.equal(json.players.max, 8);

      // Login geht an Paper: im online-mode antwortet Paper mit der Verschlüsselungsanfrage (Paket 0x01)
      // (mit der Protokollnummer, die Paper in der Serverliste meldet, sonst lehnt Paper als „veraltet“ ab)
      const protocol = Number(json.version?.protocol);
      const login = await mc();
      login.write(handshake(address, 2, protocol), loginStart('Steve'));
      const answer = await login.packet(15_000);
      assert.equal(answer.id, 0x01, `erwartet Encryption Request, kam Paket ${answer.id}: ${answer.data.toString('utf8').slice(0, 300)}`);
      login.destroy();

      // Konsole: Log vom echten Server
      const consoleRes = await api(service.url, 'GET', `/v1/hosting/worlds/${id}/console?lines=50`, { token: anna.token });
      assert.ok(consoleRes.body.lines.some((l: string) => /Done \(/.test(l)), 'Done im Log');

      // Anhalten: schläft wieder, Java-Prozess beendet
      assert.equal((await api(service.url, 'POST', `/v1/hosting/worlds/${id}/stop`, { token: anna.token })).status, 200);
      await waitState(service, anna, id, 'sleeping', 3 * 60_000);
      assert.equal(await runner.state(id), 'stopped');
      // Danach antwortet wieder das Relay selbst
      const asleep = await mc();
      asleep.write(handshake(address, 1), STATUS_REQUEST);
      assert.match(text((await asleep.json()).description), /^Paperwelt schläft – zum Aufwecken einfach beitreten/);
    } finally {
      for (const client of clients) client.destroy();
      await service.close();
      if (previousDev === undefined) delete process.env.HELDIX_DIENST_DEV;
      else process.env.HELDIX_DIENST_DEV = previousDev;
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    }
  });
});
