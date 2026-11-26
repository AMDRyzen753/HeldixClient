// Nachgebautes Spiel für npm run test:accounts-ipc: spricht das Protokoll des Konto-Wechsels (docs/konto-wechsel.md)
// wie die HeldixClient-Mod – Anfragen als Marker-Zeilen auf stdout, Antworten als JSON-Zeilen auf stdin – und schreibt
// dazwischen normale Log-Ausgabe. Was es empfängt, landet in einer Ergebnisdatei (nie auf stdout).
//   node fake-game-ipc.js <schritte.json> <ergebnis.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const MARKER = '\u0001heldix-ipc ';

export type FakeStep =
  /** Text wie er ist auf stdout (darf alles enthalten) */
  | { kind: 'log'; text: string }
  /** mehrere Schreibvorgänge mit kurzen Pausen (Zeilen über Blockgrenzen) */
  | { kind: 'chunks'; parts: string[] }
  | { kind: 'stderr'; text: string }
  /** Anfrage als Marker-Zeile; ein String wird unverändert gesendet (für kaputtes JSON) */
  | { kind: 'request'; body: unknown; split?: boolean }
  /** auf die Antwort mit dieser ID warten (null: Antwort ohne ID) */
  | { kind: 'wait'; id: number | null; timeoutMs?: number }
  | { kind: 'sleep'; ms: number };

export interface FakeResult {
  /** alle Zeilen von stdin, in der Reihenfolge */
  lines: string[];
  /** je wait-Schritt: kam die Antwort? */
  waits: { id: number | null; received: boolean }[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (text: string) => new Promise<void>((resolve) => process.stdout.write(text, () => resolve()));

async function main(): Promise<void> {
  const [stepsFile, resultFile] = process.argv.slice(2);
  const steps = JSON.parse(readFileSync(stepsFile, 'utf8')) as FakeStep[];
  const result: FakeResult = { lines: [], waits: [] };
  /** Antworten je ID, die noch kein wait-Schritt abgeholt hat */
  const seen = new Map<string, number>();
  const waiters: (() => void)[] = [];

  const input = createInterface({ input: process.stdin });
  input.on('line', (line) => {
    result.lines.push(line);
    try {
      const message = JSON.parse(line) as { id?: number | null };
      if ('id' in message) seen.set(String(message.id), (seen.get(String(message.id)) ?? 0) + 1);
    } catch {
      // keine JSON-Zeile: nur mitschreiben
    }
    for (const wake of waiters.splice(0)) wake();
  });

  for (const step of steps) {
    switch (step.kind) {
      case 'log':
        await out(step.text);
        break;
      case 'chunks':
        for (const part of step.parts) {
          await out(part);
          await sleep(15);
        }
        break;
      case 'stderr':
        await new Promise<void>((resolve) => process.stderr.write(step.text, () => resolve()));
        break;
      case 'request': {
        const json = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
        const line = `${MARKER}${json}\n`;
        if (step.split) {
          const cut = Math.floor(line.length / 2);
          await out(line.slice(0, 5));
          await sleep(15);
          await out(line.slice(5, cut));
          await sleep(15);
          await out(line.slice(cut));
        } else {
          await out(line);
        }
        break;
      }
      case 'wait': {
        const key = String(step.id);
        const deadline = Date.now() + (step.timeoutMs ?? 4000);
        while (!seen.get(key) && Date.now() < deadline) {
          await Promise.race([new Promise<void>((resolve) => waiters.push(resolve)), sleep(Math.max(1, deadline - Date.now()))]);
        }
        const count = seen.get(key) ?? 0;
        result.waits.push({ id: step.id, received: count > 0 });
        if (count > 0) seen.set(key, count - 1);
        break;
      }
      case 'sleep':
        await sleep(step.ms);
        break;
    }
  }

  writeFileSync(resultFile, JSON.stringify(result));
  input.close();
  process.stdin.destroy();
  await out('fake game: fertig\n');
  process.exit(0);
}

void main();
