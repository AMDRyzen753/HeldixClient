// Tests für den Serverstatus auf der Startseite (core/serverstatus.ts) gegen nachgebaute Minecraft-Server auf 127.0.0.1.
//   npm run test:serverstatus
import net from 'node:net';
import { cleanMotd, parseServerAddress, serverStatus } from '../main/core/serverstatus';

let failed = 0;
let passed = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'OK    ' : 'FEHLER'} ${label}${detail ? ` (${detail})` : ''}`);
}

function varInt(value: number): Buffer {
  const bytes: number[] = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}
const frame = (id: number, body: Buffer) => {
  const inner = Buffer.concat([varInt(id), body]);
  return Buffer.concat([varInt(inner.length), inner]);
};
const mcString = (text: string) => Buffer.concat([varInt(Buffer.byteLength(text)), Buffer.from(text)]);

type Mode = 'normal' | 'no-pong' | 'garbage' | 'huge' | 'silent';

/** Fake-Server: antwortet auf Handshake + Statusanfrage und (je nach Modus) auf den Ping */
function fakeServer(mode: Mode, status: object): Promise<{ port: number; connections: () => number; handshakeHost: () => string; close: () => void }> {
  let connections = 0;
  let host = '';
  const server = net.createServer((socket) => {
    connections++;
    let buffer = Buffer.alloc(0);
    let answered = false;
    socket.on('error', () => undefined);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (mode === 'silent') return;
      if (!answered) {
        // Handshake: Länge, ID 0, Protokoll, Host, Port, Zustand – dann Statusanfrage (Länge 1, ID 0)
        try {
          let offset = 0;
          const readVar = () => {
            let value = 0;
            for (let i = 0; i < 5; i++) {
              const byte = buffer[offset++];
              value |= (byte & 0x7f) << (7 * i);
              if ((byte & 0x80) === 0) return value;
            }
            throw new Error('varint');
          };
          readVar(); // Länge
          readVar(); // ID
          readVar(); // Protokoll
          const hostLength = readVar();
          host = buffer.subarray(offset, offset + hostLength).toString('utf8');
        } catch {
          // egal
        }
        answered = true;
        if (mode === 'garbage') {
          socket.write(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));
          return;
        }
        const json = mode === 'huge' ? JSON.stringify({ ...status, favicon: 'x'.repeat(300 * 1024) }) : JSON.stringify(status);
        socket.write(frame(0x00, mcString(json)));
        return;
      }
      // Ping (ID 1, 8 Byte) → Pong mit gleichem Inhalt
      if (mode === 'normal' && buffer.length >= 10) {
        const payload = buffer.subarray(buffer.length - 8);
        setTimeout(() => socket.write(frame(0x01, payload)), 15);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as net.AddressInfo).port;
    resolve({ port, connections: () => connections, handshakeHost: () => host, close: () => server.close() });
  }));
}

async function main(): Promise<void> {
  // Adressen
  check('Adresse: Name ohne Port', JSON.stringify(parseServerAddress('Play.Example.de')) === JSON.stringify({ host: 'play.example.de', port: null }));
  check('Adresse: Name mit Port', JSON.stringify(parseServerAddress('mc.example.de:25570')) === JSON.stringify({ host: 'mc.example.de', port: 25570 }));
  check('Adresse: IPv4 mit Port', parseServerAddress('192.168.0.5:25565')?.host === '192.168.0.5');
  check('Adresse: IPv6 in Klammern', parseServerAddress('[::1]:25565')?.host === '::1');
  check('Adresse: ungültig abgelehnt', [' ', 'exa mple.de', 'a.de:99999', 'http://x.de', 'x.de:0', '-x.de', 'a..b'].every((a) => parseServerAddress(a) === null));

  // MOTD
  check('MOTD: Formatcodes und Komponenten', cleanMotd({ text: '§aWillkommen', extra: [{ text: ' auf §lHeldix' }, '\n§7Zeile 2'] }) === 'Willkommen auf Heldix · Zeile 2', String(cleanMotd({ text: '§aWillkommen', extra: [{ text: ' auf §lHeldix' }, '\n§7Zeile 2'] })));
  check('MOTD: leer → null', cleanMotd('   ') === null);

  const status = { version: { name: '§cPaper 1.21.4', protocol: 767 }, players: { online: 1234, max: 5000 }, description: { text: '§6Heldix§r Testserver', extra: [{ text: '\nMinigames' }] } };

  const normal = await fakeServer('normal', status);
  const a = await serverStatus(`127.0.0.1:${normal.port}`);
  check('Online: Spieler, Version, MOTD', a.online && a.players?.online === 1234 && a.players.max === 5000 && a.version === 'Paper 1.21.4' && a.motd === 'Heldix Testserver · Minigames', JSON.stringify(a));
  check('Online: Ping gemessen', a.latencyMs !== null && a.latencyMs >= 1 && a.latencyMs < 2000, String(a.latencyMs));
  check('Handshake nennt die Adresse', normal.handshakeHost() === '127.0.0.1', normal.handshakeHost());
  const again = await serverStatus(`127.0.0.1:${normal.port}`);
  check('Zwischenspeicher: kein zweiter Verbindungsaufbau', normal.connections() === 1 && again.online, String(normal.connections()));
  normal.close();

  const noPong = await fakeServer('no-pong', status);
  const started = Date.now();
  const b = await serverStatus(`127.0.0.1:${noPong.port}`);
  check('Ohne Pong: trotzdem online (Zeit bis zur Antwort)', b.online && b.players?.online === 1234 && b.latencyMs !== null, `${JSON.stringify(b)} nach ${Date.now() - started} ms`);
  noPong.close();

  const garbage = await fakeServer('garbage', status);
  const c = await serverStatus(`127.0.0.1:${garbage.port}`);
  check('Unsinnige Antwort: nicht erreichbar', !c.online, JSON.stringify(c));
  garbage.close();

  const huge = await fakeServer('huge', status);
  const d = await serverStatus(`127.0.0.1:${huge.port}`);
  check('Zu große Antwort: abgebrochen', !d.online, JSON.stringify(d));
  huge.close();

  const silent = await fakeServer('silent', status);
  const t0 = Date.now();
  const e = await serverStatus(`127.0.0.1:${silent.port}`);
  check('Server schweigt: nach Zeitlimit nicht erreichbar', !e.online && Date.now() - t0 < 6000, `${Date.now() - t0} ms`);
  silent.close();

  // geschlossener Port
  const probe = net.createServer();
  const freePort = await new Promise<number>((resolve) => probe.listen(0, '127.0.0.1', () => resolve((probe.address() as net.AddressInfo).port)));
  probe.close();
  const f = await serverStatus(`127.0.0.1:${freePort}`);
  check('Geschlossener Port: nicht erreichbar', !f.online, JSON.stringify(f));

  const g = await serverStatus('nicht gültig');
  check('Ungültige Adresse: nicht erreichbar, kein Fehler', !g.online);

  console.log(failed === 0 ? `Serverstatus: alle ${passed} Prüfungen bestanden` : `Serverstatus: ${failed} von ${passed + failed} fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
