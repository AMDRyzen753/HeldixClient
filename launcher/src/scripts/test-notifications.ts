// Prüft den Verlauf der Benachrichtigungen (Glocke, core/notifications.ts) in einem eigenen Temp-Ordner
// (npm run test:notifications): Reihenfolge, ungelesen, Zusammenfassen, einmalige Meldungen, Grenzen (100 Einträge,
// 30 Tage), Konten, „alle gelesen“, Leeren, Speichern und Laden, kaputte Dateien.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NOTIFICATION_LIMIT, NOTIFICATION_MAX_AGE_MS, NotificationStore } from '../main/core/notifications';
import { check, finish } from './testkit';

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'heldix-benachrichtigungen-'));
  const file = path.join(dir, 'notifications.json');
  try {
    let now = 1_000_000_000_000;
    let changes = 0;
    const store = new NotificationStore(file, { now: () => now, onChange: () => changes++, writeDelayMs: 5 });

    let list = await store.list('konto-1');
    check('Leer am Anfang', list.items.length === 0 && list.unread === 0);

    await store.add({ kind: 'friend-request', title: 'Lena möchte mit dir befreundet sein', body: 'Unter Freunde annehmen.', target: { view: 'friends' }, account: 'konto-1', key: 'request:a' });
    now += 1000;
    await store.add({ kind: 'message', title: 'Neue Nachricht von Max', body: 'Hi!', target: { view: 'friends', uuid: 'b'.repeat(32) }, account: 'konto-1', key: 'message:b' });
    now += 1000;
    await store.add({ kind: 'update', title: 'Update 0.13.9 ist bereit', target: { view: 'updates' }, account: null, key: 'update:0.13.9', once: true });
    list = await store.list('konto-1');
    check('Neueste zuerst, alle ungelesen', list.items.map((n) => n.kind).join() === 'update,message,friend-request' && list.unread === 3, list.items.map((n) => n.kind));
    check('Änderungen werden gemeldet', changes === 3, changes);
    check('Felder: Ziel, Zähler 1, keine internen Felder', list.items[1].target?.uuid === 'b'.repeat(32) && list.items[1].count === 1 && !('account' in list.items[1]) && !('key' in list.items[1]));

    now += 1000;
    await store.add({ kind: 'message', title: 'Neue Nachricht von Max', body: 'Bist du da?', target: { view: 'friends', uuid: 'b'.repeat(32) }, account: 'konto-1', key: 'message:b' });
    list = await store.list('konto-1');
    const merged = list.items.find((n) => n.kind === 'message');
    check('Gleicher Schlüssel, ungelesen → zusammengefasst (×2, neuester Text, nach oben)', list.items.length === 3 && merged?.count === 2 && merged.body === 'Bist du da?' && list.items[0].kind === 'message', list.items);

    const again = await store.add({ kind: 'update', title: 'Update 0.13.9 ist bereit', account: null, key: 'update:0.13.9', once: true });
    check('Einmalig (Update je Version): kein zweiter Eintrag', again === null && (await store.list('konto-1')).items.length === 3);

    check('Anderes Konto sieht nur Einträge für alle', (await store.list('konto-2')).items.map((n) => n.kind).join() === 'update');
    await store.markRead(merged!.id);
    list = await store.list('konto-1');
    check('Einen gelesen', list.unread === 2 && list.items.find((n) => n.id === merged!.id)?.read === true);
    now += 1000;
    await store.add({ kind: 'message', title: 'Neue Nachricht von Max', body: 'Neu', account: 'konto-1', key: 'message:b' });
    check('Nach dem Lesen: gleicher Schlüssel = neuer Eintrag', (await store.list('konto-1')).items.filter((n) => n.kind === 'message').length === 2);

    await store.markAllRead('konto-2');
    list = await store.list('konto-1');
    check('„Alle gelesen“ bei Konto 2: Einträge von Konto 1 bleiben ungelesen', list.unread === 2, list.unread);
    await store.markAllRead('konto-1');
    check('„Alle gelesen“ bei Konto 1', (await store.list('konto-1')).unread === 0);

    // Texte: Steuerzeichen weg, lange gekürzt; ungültige Ziele fallen weg
    const odd = await store.add({ kind: 'world-open', title: `Lena\u0000 hat eine Welt geöffnet ${'x'.repeat(300)}`, body: 'b'.repeat(500), target: { view: 'world', code: 'kaputt!' }, account: 'konto-1' });
    check('Texte gekürzt, Steuerzeichen weg, ungültiger Welt-Code weg', !!odd && [...odd.title].length <= 120 && !odd.title.includes('\u0000') && [...odd.body].length <= 240 && odd.target?.code === undefined, odd);

    // dauerhafte Welten (Dienst 1.13.0): eigene Arten, Klick führt zur Webseite (Ziel „hosting“)
    const knock = await store.add({ kind: 'hosting-knock', title: 'Gast_1 möchte in „Insel“', target: { view: 'hosting' }, account: 'konto-1', key: 'hosting-knock:x:gast_1' });
    const granted = await store.add({ kind: 'hosting-granted', title: 'Du kannst jetzt dauerhafte Welten anlegen', target: { view: 'hosting' }, account: 'konto-1', key: 'hosting-granted', once: true });
    const twice = await store.add({ kind: 'hosting-granted', title: 'Du kannst jetzt dauerhafte Welten anlegen', target: { view: 'hosting' }, account: 'konto-1', key: 'hosting-granted', once: true });
    check('Dauerhafte Welten: Anklopfen und Freischaltung mit Ziel „hosting“, Freischaltung nur einmal', knock?.target?.view === 'hosting' && granted?.kind === 'hosting-granted' && twice === null);
    await store.markRead(knock!.id);
    await store.markRead(granted!.id);

    // Speichern und neu laden
    await store.flush();
    const reloaded = new NotificationStore(file, { now: () => now });
    const fromDisk = await reloaded.list('konto-1');
    check('Gespeichert und wieder geladen', fromDisk.items.length === (await store.list('konto-1')).items.length && fromDisk.unread === 1, fromDisk);
    check('Gespeichert und wieder geladen: dauerhafte Welten bleiben erhalten', fromDisk.items.some((n) => n.kind === 'hosting-knock' && n.target?.view === 'hosting')
      && fromDisk.items.some((n) => n.kind === 'hosting-granted'));
    const raw = await readFile(file, 'utf8');
    check('Datei enthält keine Tokens oder Nachrichten anderer Art (nur Verlauf)', raw.includes('"version": 1') && !/token/i.test(raw));

    // 30 Tage: alte Einträge fallen weg
    now += NOTIFICATION_MAX_AGE_MS + 5000;
    await store.add({ kind: 'addons', title: 'Addon aktualisiert', account: null });
    list = await store.list('konto-1');
    check('Älter als 30 Tage: weg', list.items.length === 1 && list.items[0].kind === 'addons', list.items.map((n) => n.title));

    // höchstens 100 Einträge, die neuesten bleiben
    for (let i = 0; i < NOTIFICATION_LIMIT + 20; i++) {
      now += 10;
      await store.add({ kind: 'friend-request', title: `Anfrage ${i}`, account: 'konto-1' });
    }
    list = await store.list('konto-1');
    check('Höchstens 100 Einträge, die neuesten bleiben', list.items.length === NOTIFICATION_LIMIT && list.items[0].title === `Anfrage ${NOTIFICATION_LIMIT + 19}`, list.items.length);

    await store.clear('konto-1');
    check('Verlauf leeren (für dieses Konto)', (await store.list('konto-1')).items.length === 0);
    await store.flush();

    // kaputte Datei: unbrauchbare Einträge fallen weg, der Rest bleibt
    await writeFile(file, JSON.stringify({
      version: 1,
      items: [
        { id: '0123456789abcdef', kind: 'message', title: 'Gut', body: '', at: now, read: false, count: 1, target: { view: 'friends' }, account: null, key: null },
        { id: 'kurz', kind: 'message', title: 'falsche ID', at: now },
        { id: 'fedcba9876543210', kind: 'hack', title: 'unbekannte Art', at: now },
        { id: 'aaaaaaaaaaaaaaaa', kind: 'update', title: '', at: now },
        'Müll',
      ],
    }));
    const broken = await new NotificationStore(file, { now: () => now }).list(null);
    check('Kaputte Einträge fallen weg', broken.items.length === 1 && broken.items[0].title === 'Gut', broken.items);
    await writeFile(file, '{ kaputt');
    check('Kaputte Datei: leer, kein Absturz', (await new NotificationStore(file, { now: () => now }).list(null)).items.length === 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  finish('Benachrichtigungen');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
