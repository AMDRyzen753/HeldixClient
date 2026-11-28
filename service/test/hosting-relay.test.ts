// Dauerhafte Welten über das Welt-Relay (1.13.0): schlafende Welt antwortet selbst in der Serverliste, ein Login weckt
// sie („startet gerade“), danach gehen Status und Login per TCP an den Server (127.0.0.1:<Port>, hier der Fake-Server
// des FakeRunners). Dazu Zugang (Mitglied/Freund/offen, Anklopfen an Besitzer und Operatoren), Rollen per Konsole,
// Schlafen nach Leerlauf, „alle Plätze belegt“ und „voll“.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, test } from 'node:test';
import { Store } from '../src/db';
import { HostingStore } from '../src/hosting/store';
import { api, befriend, connect, devPlayer, type Player } from './helpers';
import { grantBeta, hostedWorld, setTeam, startHosting, waitFor, waitState, type HostingTest } from './hosting-helpers';
import { teamLogin, webApi } from './web-helpers';
import { DOMAIN, handshake, loginStart, McClient, pingPacket, STATUS_REQUEST } from './world-helpers';

async function withRelay(fn: (t: HostingTest, mc: () => Promise<McClient>) => Promise<void>, options = {}): Promise<void> {
  const t = await startHosting(options);
  const clients: McClient[] = [];
  try {
    await fn(t, async () => {
      const client = await McClient.connect(t.service.relayPort!);
      clients.push(client);
      return client;
    });
  } finally {
    for (const client of clients) client.destroy();
    await t.close();
  }
}

/** Serverliste über das Relay: Status-Antwort (JSON), danach Ping/Pong. */
async function serverList(client: McClient, address: string): Promise<any> {
  client.write(handshake(address, 1), STATUS_REQUEST);
  const status = await client.json();
  const payload = randomBytes(8);
  client.write(pingPacket(payload));
  const pong = await client.packet();
  assert.deepEqual([pong.id, pong.data], [0x01, payload]);
  return status;
}

async function login(mc: () => Promise<McClient>, address: string, name: string): Promise<string> {
  const client = await mc();
  client.write(handshake(address, 2), loginStart(name));
  return client.disconnectText();
}

function text(description: any): string {
  return [description.text ?? '', ...(description.extra ?? []).map((e: any) => e.text ?? '')].join('');
}

async function openWorld(t: HostingTest, name = 'Anna'): Promise<{ player: Player; world: any; address: string }> {
  const { player, world } = await hostedWorld(t, name);
  await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: player.token, body: { access: 'open' } });
  return { player, world, address: `${world.code}.${DOMAIN}` };
}

describe('Dauerhafte Welten über das Relay', () => {
  test('schläft: eigene Serverliste mit Werbezeile; Login weckt sie; läuft: Status und Login vom Server selbst', async () => {
    await withRelay(async (t, mc) => {
      const { player, world, address } = await openWorld(t);
      let status = await serverList(await mc(), address);
      assert.equal(text(status.description), 'Insel schläft – zum Aufwecken einfach beitreten\nGeteilt mit HeldixClient · heldix.example');
      assert.deepEqual([status.version.name, status.players.max, status.players.online], ['HeldixClient', 8, 0]);
      assert.equal(t.runner.ops('start', world.id).length, 0, 'Serverliste weckt nicht');
      // Login weckt (Disconnect mit Hinweis), Welt startet; bereit erst, wenn der Test es sagt
      t.runner.readyDelayMs = Infinity;
      assert.equal(await login(mc, address, 'Steve'), 'Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.');
      assert.equal(t.runner.ops('start', world.id).length, 1);
      await waitState(t.service, player, world.id, 'starting');
      // Während des Starts: eigene Antwort „startet gerade“, ein weiterer Login startet nicht noch einmal
      status = await serverList(await mc(), address);
      assert.equal(text(status.description).split('\n')[0], 'Insel startet gerade …');
      assert.equal(await login(mc, address, 'Alex'), 'Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.');
      assert.equal(t.runner.ops('start', world.id).length, 1);
      t.runner.ready(world.id);
      await waitState(t.service, player, world.id, 'running');
      // Läuft: die Serverliste kommt vom (Fake-)Server, mit der Werbe-MOTD aus prepare
      status = await serverList(await mc(), address);
      assert.equal(status.version.name, 'Paper 26.3 (Fake)');
      assert.match(text(status.description), /Geteilt mit §bHeldixClient/);
      assert.ok(t.runner.get(world.id).statusRequests >= 1);
      // Login geht an den Server (der prüft online-mode); hier antwortet der Fake-Server
      assert.equal(await login(mc, address, 'Steve'), 'Hallo vom Fake-Server');
      assert.deepEqual(t.runner.get(world.id).logins, ['Steve']);
      // Öffentliche Ansicht und eigene Welt zeigen den Zustand
      const pub = await api(t.service.url, 'GET', `/v1/public/worlds/${world.code}`);
      assert.deepEqual([pub.body.online, pub.body.hosted, pub.body.version], [true, { state: 'running' }, '26.3']);
    });
  });

  test('Zugang wie bei Welt teilen: Fremde klopfen an (Besitzer und Operatoren bekommen hosting-knock), zulassen und ablehnen', async () => {
    await withRelay(async (t, mc) => {
      const { player, world } = await hostedWorld(t, 'Anna');
      const address = `${world.code}.${DOMAIN}`;
      const ben = await devPlayer(t.service.url, 'Ben');
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ben`, { token: player.token, body: { role: 'operator' } });
      const owner = (await connect(t.service.wsUrl, player.token)).client;
      const op = (await connect(t.service.wsUrl, ben.token)).client;
      assert.equal(await login(mc, address, 'Fremder'), 'Du bist noch nicht eingeladen – Anna wurde gefragt. Versuch es gleich noch einmal.');
      const knock = await owner.next('hosting-knock');
      assert.deepEqual([knock.name, knock.world.id, knock.world.address], ['Fremder', world.id, address]);
      assert.equal((await op.next('hosting-knock')).name, 'Fremder');
      assert.equal(t.runner.ops('start', world.id).length, 0, 'Anklopfen weckt nicht');
      const detail = await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}`, { token: player.token });
      assert.deepEqual(detail.body.knocks.map((k: { name: string }) => k.name), ['fremder']);
      // Ablehnen (Operator darf das): 10 Minuten „abgelehnt“
      let res = await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/knocks/Fremder`, { token: ben.token, body: { allow: false } });
      assert.equal(res.body.allowed, false);
      assert.equal(await login(mc, address, 'Fremder'), 'Der Gastgeber hat deine Anfrage abgelehnt.');
      // Zulassen: wird Mitglied, Login weckt die Welt
      res = await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/knocks/Fremder`, { token: player.token, body: { allow: true } });
      assert.deepEqual([res.body.allowed, res.body.members.map((m: { name: string }) => m.name).sort()], [true, ['Ben', 'Fremder']]);
      assert.equal(await login(mc, address, 'Fremder'), 'Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.');
      assert.equal((await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/knocks/x!`, { token: player.token, body: { allow: true } })).status, 400);
      // Freunde bei Zugang „Freunde“
      const carl = await devPlayer(t.service.url, 'Carl');
      await befriend(t.service.url, player, carl);
      await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: player.token, body: { access: 'friends' } });
      await waitState(t.service, player, world.id, 'running');
      assert.equal(await login(mc, address, 'Carl'), 'Hallo vom Fake-Server');
      // Blockierte merken nichts
      await api(t.service.url, 'POST', '/v1/blocks', { token: player.token, body: { uuid: carl.uuid } });
      assert.equal(await login(mc, address, 'Carl'), 'Du bist noch nicht eingeladen – Anna wurde gefragt. Versuch es gleich noch einmal.');
      await owner.close();
      await op.close();
    });
  });

  test('Rollen beim Beitreten per Konsole: Besucher adventure, Operatoren op, Wechsel deop; Spielerzahl aus dem Log', async () => {
    await withRelay(async (t) => {
      const { player, world } = await openWorld(t, 'Anna');
      await api(t.service.url, 'PATCH', `/v1/worlds/${world.id}`, { token: player.token, body: { defaultRole: 'visitor' } });
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ops`, { token: player.token, body: { role: 'operator' } });
      await api(t.service.url, 'POST', `/v1/hosting/worlds/${world.id}/start`, { token: player.token });
      await waitState(t.service, player, world.id, 'running');
      const commands = () => t.runner.get(world.id).commands;
      t.runner.join(world.id, 'Gast');
      t.runner.join(world.id, 'Ops');
      t.runner.join(world.id, 'Anna');
      await waitFor(() => commands().includes('op Anna'), 'Besitzer op');
      assert.ok(commands().includes('gamemode adventure Gast'));
      assert.ok(commands().includes('op Ops'));
      assert.ok(!commands().some((c) => c.includes('Ops') && c.startsWith('gamemode')));
      let detail = await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}`, { token: player.token });
      assert.equal(detail.body.players, 3);
      // Rolle ändern, während er online ist: sofort per Konsole
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Ops`, { token: player.token, body: { role: 'player' } });
      await waitFor(() => commands().includes('deop Ops'), 'deop');
      await api(t.service.url, 'PUT', `/v1/worlds/${world.id}/members/Gast`, { token: player.token, body: { role: 'player' } });
      await waitFor(() => commands().includes('gamemode survival Gast'), 'Spielmodus zurück');
      // Chat-Zeilen sind keine Joins
      t.runner.emit(world.id, '<Gast> Evil joined the game');
      t.runner.leave(world.id, 'Gast');
      await new Promise((resolve) => setTimeout(resolve, 50));
      detail = await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}`, { token: player.token });
      assert.equal(detail.body.players, 2);
      assert.ok(!commands().some((c) => c.includes('Evil')));
    });
  });

  test('Schlafen nach Leerlauf (Minuten im Test kurz); Spieler halten wach; „nie schlafen“ vom Team', async () => {
    await withRelay(
      async (t, mc) => {
        const { player, world, address } = await openWorld(t);
        const state = async () => (await api(t.service.url, 'GET', `/v1/hosting/worlds/${world.id}`, { token: player.token })).body.state;
        // Wie oft sie wegen Leerlauf eingeschlafen ist (das prüft der Dienst nur, solange sie läuft)
        const sleeps = () => t.service.logs.filter((l) => l.includes('schläft (keine Spieler)')).length;
        // Bereit erst, wenn der Test es sagt: So tritt der Spieler bei, bevor die Zeit fürs Schlafen (5 „Minuten“ =
        // 250 ms) zu laufen beginnt. Sonst könnte die Welt auf einem langsamen Rechner einschlafen, bevor er da ist.
        t.runner.readyDelayMs = Infinity;
        const wake = async () => {
          assert.equal(await login(mc, address, 'Steve'), 'Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.');
          // Server beim Runner gestartet und der Dienst liest sein Log (erst dann zählt ein Beitreten)
          await waitFor(() => {
            const fake = t.runner.get(world.id);
            return fake.state === 'starting' && fake.listeners.size > 0;
          }, 'Start beim Runner');
        };
        await wake();
        t.runner.join(world.id, 'Steve');
        t.runner.ready(world.id);
        await waitState(t.service, player, world.id, 'running');
        // mit Spieler bleibt sie wach (doppelt so lange wie die Zeit fürs Schlafen)
        await new Promise((resolve) => setTimeout(resolve, 500));
        assert.equal(await state(), 'running');
        assert.equal(sleeps(), 0);
        t.runner.leave(world.id, 'Steve');
        const slept = await waitState(t.service, player, world.id, 'sleeping', 3000);
        assert.equal(slept.error, null);
        assert.equal(sleeps(), 1);
        // Die Status-Abfrage gleicht die Zahl ab: Server meldet 0, obwohl das Log jemanden hatte → sie schläft wieder ein
        await wake();
        t.runner.join(world.id, 'Steve');
        t.runner.get(world.id).online = 0;
        t.runner.ready(world.id);
        await waitFor(() => sleeps() === 2, 'eingeschlafen trotz Spieler im Log', 3000);
        await waitState(t.service, player, world.id, 'sleeping', 3000);
        // „nie schlafen“ (nur das Team): bleibt ohne Spieler wach
        const admin = await teamLogin(t.service, await devPlayer(t.service.url, 'Chefin'), 'admin', t.clock);
        const patch = await webApi(t.service, 'PATCH', `/v1/team/hosting/worlds/${world.id}`, { cookie: admin.cookie, body: { sleepAfterMin: 0 } });
        assert.equal(patch.body.sleepAfterMin, 0);
        await wake();
        t.runner.ready(world.id);
        await waitState(t.service, player, world.id, 'running');
        await new Promise((resolve) => setTimeout(resolve, 600));
        assert.equal(await state(), 'running');
        assert.equal(sleeps(), 2);
      },
      { hostingSleepMin: 5, hostingMinuteMs: 50 },
    );
  });

  test('alle Plätze belegt: Login bekommt den Hinweis; Welt startet nicht; „voll“ bei maxPlayers', async () => {
    await withRelay(
      async (t, mc) => {
        const anna = await devPlayer(t.service.url, 'Anna');
        setTeam(t.service, anna.uuid, 'admin');
        const ids: string[] = [];
        for (const name of ['Eins', 'Zwei']) {
          const res = await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: null, name } });
          ids.push(res.body.id);
          await waitState(t.service, anna, res.body.id, 'sleeping');
          await api(t.service.url, 'PATCH', `/v1/worlds/${res.body.id}`, { token: anna.token, body: { access: 'open', maxPlayers: 1 } });
        }
        const code = async (id: string) => (await api(t.service.url, 'GET', `/v1/worlds/${id}`, { token: anna.token })).body.code;
        const first = `${await code(ids[0]!)}.${DOMAIN}`;
        const second = `${await code(ids[1]!)}.${DOMAIN}`;
        assert.equal(await login(mc, first, 'Steve'), 'Die Welt startet gerade – in etwa 30 Sekunden noch einmal beitreten.');
        assert.equal(await login(mc, second, 'Steve'), 'Gerade sind alle Plätze belegt – versuch es in ein paar Minuten noch einmal.');
        assert.equal(t.runner.ops('start', ids[1]).length, 0);
        await waitState(t.service, anna, ids[0]!, 'running');
        t.runner.join(ids[0]!, 'Steve');
        await waitFor(async () => (await api(t.service.url, 'GET', `/v1/hosting/worlds/${ids[0]}`, { token: anna.token })).body.players === 1, 'ein Spieler');
        assert.equal(await login(mc, first, 'Alex'), 'Die Welt ist voll (höchstens 1 Spieler).');
      },
      { hostingMax: 1 },
    );
  });

  test('wartet auf Upload bzw. Fehler: eigene Texte; ohne Freischaltung „pausiert“', async () => {
    await withRelay(async (t, mc) => {
      const anna = await devPlayer(t.service.url, 'Anna');
      grantBeta(t.service, anna.uuid);
      const shared = (await api(t.service.url, 'POST', '/v1/worlds', { token: anna.token, body: { name: 'Höhle', access: 'open' } })).body;
      await api(t.service.url, 'POST', '/v1/hosting/worlds', { token: anna.token, body: { world: shared.id } });
      const address = `${shared.code}.${DOMAIN}`;
      assert.equal(await login(mc, address, 'Steve'), 'Die Welt wird gerade eingerichtet. Versuch es später noch einmal.');
      const status = await serverList(await mc(), address);
      assert.equal(text(status.description).split('\n')[0], 'Höhle wird gerade eingerichtet');
      // Pausiert: Besitzer ohne Freischaltung
      const { player, world, address: other } = await openWorld(t, 'Bea');
      const store = new Store(t.service.dataDir);
      new HostingStore(store).revoke(player.uuid, 'beta');
      store.close();
      assert.equal(await login(mc, other, 'Steve'), 'Diese dauerhafte Welt ist gerade pausiert.');
      assert.equal(t.runner.ops('start', world.id).length, 0);
    });
  });
});
