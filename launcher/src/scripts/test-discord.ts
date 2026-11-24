// Test für den Discord-Status: verbindet sich mit dem laufenden Discord und setzt einen Beispielstatus.
// Aufruf: npm run test:discord -- <Application-ID> [Sekunden]
// Ohne ID wird HELDIX_DISCORD_CLIENT_ID bzw. die ID aus config.ts genommen.

import { DISCORD_CLIENT_ID } from '../main/config';
import { DiscordRpc } from '../main/core/discord';
import { buildActivity, publicServerName } from '../main/core/presence';

async function main(): Promise<void> {
  const [idArg, secondsArg = '20'] = process.argv.slice(2);
  const clientId = idArg || DISCORD_CLIENT_ID;
  if (!clientId) throw new Error('Keine Application-ID: npm run test:discord -- <ID>');

  // Datenschutz-Regeln für Servernamen
  const cases: [string, string | null][] = [
    ['mc.hypixel.net', 'mc.hypixel.net'],
    ['Hypixel.net:25565', 'hypixel.net'],
    ['192.168.0.12', null],
    ['192.168.0.12:25565', null],
    ['localhost', null],
    ['[::1]:25565', null],
    ['meinserver.local', null],
    ['minecraft', null],
  ];
  for (const [input, expected] of cases) {
    const result = publicServerName(input);
    if (result !== expected) throw new Error(`publicServerName("${input}") = ${result}, erwartet ${expected}`);
  }
  console.log('Servernamen-Filter: OK');

  const rpc = new DiscordRpc(clientId, (message) => console.log(`[Discord] ${message}`));
  rpc.onStatus = (status) => console.log(`Status: ${JSON.stringify(status)}`);
  rpc.start();
  rpc.setActivity(buildActivity({
    phase: 'running',
    minecraft: '26.3',
    loader: 'heldix',
    startedAt: Date.now(),
    status: { mode: 'multiplayer', server: 'mc.hypixel.net' },
    showServer: true,
    clientVersion: 'test',
  }));
  await new Promise((resolve) => setTimeout(resolve, Number(secondsArg) * 1000));
  const final = rpc.connection;
  rpc.stop();
  await new Promise((resolve) => setTimeout(resolve, 700));
  console.log(`Ergebnis: ${JSON.stringify(final)}`);
  process.exit(final.state === 'connected' ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
