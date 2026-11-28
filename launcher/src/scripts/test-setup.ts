// Prüft den Einrichtungs-Assistenten (core/setup.ts) ohne Electron-Fenster: wann er erscheint (setupDone, bestehende
// Installation), die Reihenfolge mit Einladung und „Neu in …“ (SetupGate), die Auswahl der Addons (nur offiziell,
// Signatur geprüft, passende API-Stufe, System, Minecraft-Version und Loader, Empfehlungen vorausgewählt, ohne
// Verbindung) und die Installation in die Standard-Instanzen gegen einen kleinen Fake-Store mit Test-Schlüssel.
//
// Aufruf: npm run test:setup

import AdmZip from 'adm-zip';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { ADDON_SIGNATURE_PREFIX, HELDIX_ADDON_API, currentPlatform, parseAddonManifest, type OverviewInstance, type StoreEntry } from '../main/core/addonstore';
import { pickWhatsNew } from '../main/core/startup-update';
import { RECOMMENDED_ADDONS, SetupGate, installSetupAddon, installedAddonVersions, loadSetupAddons, setupAddonList, setupStart, setupTargets } from '../main/core/setup';
import { Store } from '../main/store';
import { check, finish, rejects } from './testkit';

interface FakeAddon {
  id: string;
  name: string;
  version: string;
  official?: boolean;
  api?: number;
  platforms?: string[];
  /** Manifest v2: access, minecraft, loaders */
  v2?: Record<string, unknown>;
  badSignature?: boolean;
}

function addonJar(addon: FakeAddon): Buffer {
  const zip = new AdmZip();
  const minecraft = (addon.v2?.minecraft as string[] | undefined) ?? undefined;
  const meta: Record<string, unknown> = { id: addon.id, name: addon.name, version: addon.version, api: 1, entrypoint: 'test.Main', description: `${addon.name} zum Testen` };
  if (minecraft) meta.minecraft = minecraft;
  if (addon.v2?.access === 'minecraft') meta.clientEntrypoint = 'test.Start';
  zip.addFile('heldix.addon.json', Buffer.from(JSON.stringify(meta)));
  zip.addFile('test/Main.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]));
  return zip.toBuffer();
}

const elsewhere = (['windows', 'mac', 'linux'] as const).find((p) => p !== currentPlatform())!;
const ADDONS: FakeAddon[] = [
  { id: 'spotify', name: 'Spotify', version: '1.1.0' },
  { id: 'uhrzeit', name: 'Uhrzeit & Spielzeit', version: '1.3.0' },
  { id: 'voicechat', name: 'Voice Chat', version: '1.2.0' },
  { id: 'minimap', name: 'Minimap', version: '1.0.0' },
  { id: 'emoterad', name: 'Emote-Rad', version: '1.0.0', v2: { access: 'minecraft', minecraft: ['26.3'], loaders: ['heldix', 'fabric'] } },
  { id: 'chatplus', name: 'Chat Plus', version: '2.0.0', official: false },
  { id: 'zukunft', name: 'Aus der Zukunft', version: '1.0.0', api: HELDIX_ADDON_API + 1 },
  { id: 'woanders', name: 'Anderes System', version: '1.0.0', platforms: [elsewhere] },
  { id: 'nurfabric', name: 'Nur Fabric', version: '1.0.0', v2: { access: 'api', minecraft: [], loaders: ['fabric'] } },
  { id: 'altmc', name: 'Altes Minecraft', version: '1.0.0', v2: { access: 'minecraft', minecraft: ['1.21.4'], loaders: ['heldix'] } },
  { id: 'falsch', name: 'Falsch signiert', version: '1.0.0', badSignature: true },
];
const JARS = new Map(ADDONS.map((a) => [a.id, addonJar(a)]));

function manifestOf(addon: FakeAddon): Record<string, unknown> {
  const jar = JARS.get(addon.id)!;
  return {
    type: 'heldix-addon',
    id: addon.id,
    name: addon.name,
    version: addon.version,
    summary: `${addon.name} zum Testen`,
    description: '',
    authors: ['HeldixClient'],
    api: addon.api ?? 1,
    icon: 'mic',
    category: 'hud',
    platforms: addon.platforms ?? [],
    file: `heldix-addon-${addon.id}-${addon.version}.jar`,
    size: jar.length,
    sha256: createHash('sha256').update(jar).digest('hex'),
    date: '2026-11-27',
    notes: [],
    official: addon.official ?? true,
    author: addon.official === false ? { uuid: 'c'.repeat(32), name: 'Bastler_1' } : null,
    ...addon.v2,
  };
}

/** geprüfte Store-Einträge ohne Netz (für die reinen Funktionen) */
function entriesOf(list: FakeAddon[]): StoreEntry[] {
  return list.map((a) => ({ manifest: parseAddonManifest(manifestOf(a)), downloads: 0, rating: { average: 0, count: 0 }, screenshots: 0, screenshotsVersion: '' }));
}

const ids = (list: { id: string }[]) => list.map((a) => a.id).join(',');

async function main(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-setup-'));
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const other = generateKeyPairSync('ed25519').privateKey;
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  let storeUp = true;
  const downloads: string[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (!storeUp) return json(503, { error: 'Wartung' });
    if (req.method === 'GET' && url.pathname === '/v1/addons') {
      return json(200, {
        addons: ADDONS.map((a) => {
          const manifest = JSON.stringify(manifestOf(a));
          const signature = sign(null, Buffer.from(ADDON_SIGNATURE_PREFIX + manifest, 'utf8'), a.badSignature ? other : privateKey).toString('base64');
          return { manifest, signature, downloads: 1, rating: { average: 0, count: 0 }, screenshots: 0, screenshotsVersion: '' };
        }),
      });
    }
    const m = /^\/v1\/addons\/([a-z0-9_-]+)\/files\/(.+)$/.exec(url.pathname);
    if (req.method === 'GET' && m) {
      const addon = ADDONS.find((a) => a.id === m[1] && `heldix-addon-${a.id}-${a.version}.jar` === m[2]);
      if (!addon) return json(404, { error: 'Diese Datei gibt es nicht.' });
      downloads.push(addon.id);
      const jar = JARS.get(addon.id)!;
      res.writeHead(200, { 'content-type': 'application/java-archive', 'content-length': jar.length });
      res.end(jar);
      return;
    }
    json(404, { error: 'Nicht gefunden.' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // ---------- Erscheint der Assistent? ----------
    const start = (stored: Record<string, unknown> | null, instances = 0, accounts = 0) => JSON.stringify(setupStart({ stored, instances, accounts }));
    check('Start: ganz neue Installation → Assistent, setupDone = false speichern', start(null) === JSON.stringify({ show: true, save: false }));
    check('Start: setupDone = false → Assistent (nach Abbruch wieder)', start({ setupDone: false }) === JSON.stringify({ show: true, save: null }));
    check('Start: setupDone = true → kein Assistent', start({ setupDone: true }, 0, 0) === JSON.stringify({ show: false, save: null }));
    check('Start: setupDone gewinnt auch mit Instanzen', start({ setupDone: false }, 3, 1) === JSON.stringify({ show: true, save: null }));
    check('Start: bestehende Installation mit Instanzen → eingerichtet', start(null, 1) === JSON.stringify({ show: false, save: true }));
    check('Start: bestehende Installation mit Konto → eingerichtet', start(null, 0, 1) === JSON.stringify({ show: false, save: true }));
    check('Start: lastSeenVersion gesetzt → eingerichtet', start({ lastSeenVersion: '0.13.7' }) === JSON.stringify({ show: false, save: true }));
    check('Start: Einstellungsdatei aus einer älteren Version → eingerichtet', start({ discordPresence: false }) === JSON.stringify({ show: false, save: true }));
    check('Start: ungültiges setupDone zählt wie fehlend', start({ setupDone: 'ja', selectedInstanceId: 'x' }) === JSON.stringify({ show: false, save: true }));

    // ---------- setupDone in den Einstellungen (Store) ----------
    const dataDir = path.join(tmp, 'daten');
    await mkdir(dataDir, { recursive: true });
    const settingsStore = new Store(dataDir, { offline: true });
    let probe = await settingsStore.setupProbe();
    check('Einstellungen: neue Installation ohne Datei und Konten', probe.stored === null && probe.accounts === 0, probe);
    let decision = setupStart({ ...probe, instances: 0 });
    if (decision.save !== null) await settingsStore.saveSettings({ setupDone: decision.save });
    check('Einstellungen: erster Start zeigt den Assistenten', decision.show && (await settingsStore.getSettings()).setupDone === false);
    probe = await settingsStore.setupProbe();
    decision = setupStart({ ...probe, instances: 1 });
    check('Einstellungen: Abbruch → beim nächsten Start wieder (trotz Instanz)', decision.show && decision.save === null && probe.stored?.setupDone === false);
    await settingsStore.saveSettings({ setupDone: true });
    decision = setupStart({ ...(await settingsStore.setupProbe()), instances: 1 });
    check('Einstellungen: nach „Los geht’s“ kein Assistent mehr', !decision.show && decision.save === null);
    const oldDir = path.join(tmp, 'alt');
    await mkdir(oldDir, { recursive: true });
    await writeFile(path.join(oldDir, 'launcher-settings.json'), JSON.stringify({ selectedInstanceId: 'heldixclient-26-3', lastSeenVersion: '0.13.7', setupDone: 'kaputt' }));
    await writeFile(path.join(oldDir, 'launcher-accounts.json'), JSON.stringify({ activeId: 'a', accounts: [{ id: 'a', type: 'offline', name: 'Alt', uuid: 'b'.repeat(32) }] }));
    const oldStore = new Store(oldDir, { offline: false });
    probe = await oldStore.setupProbe();
    check('Einstellungen: alte Konten zählen (auch ausgeblendete Offline-Konten)', probe.accounts === 1);
    check('Einstellungen: ungültiges setupDone → Standard false beim Lesen', (await oldStore.getSettings()).setupDone === false);
    decision = setupStart({ ...probe, instances: 1 });
    if (decision.save !== null) await oldStore.saveSettings({ setupDone: decision.save });
    check('Einstellungen: Update auf 0.13.8 → eingerichtet und gespeichert', !decision.show && (await oldStore.getSettings()).setupDone === true);

    // ---------- Reihenfolge mit Einladung und „Neu in …“ ----------
    // nachgebaut wie in main.ts: pendingInvite bleibt liegen, solange der Assistent offen ist
    const gate = new SetupGate(false);
    let pendingInvite: string | null = 'abcdefgh23';
    const take = () => {
      const { code, keep } = gate.takeInvite(pendingInvite);
      pendingInvite = keep;
      return code;
    };
    gate.begin();
    check('Reihenfolge: beim Laden der Oberfläche gibt invites:take nichts heraus', take() === null && pendingInvite === 'abcdefgh23');
    check('Reihenfolge: der Assistent sieht die Einladung (Karte)', gate.peekInvite(pendingInvite) === 'abcdefgh23');
    check('Reihenfolge: „Neu in …“ wartet', !gate.whatsNewAllowed());
    pendingInvite = 'zyxwvuts98'; // zweiter Link, während der Assistent offen ist
    check('Reihenfolge: neuer Link ersetzt die Karte, bleibt aber liegen', take() === null && gate.peekInvite(pendingInvite) === 'zyxwvuts98');
    gate.end();
    check('Reihenfolge: nach dem Assistenten kommt der Einladungsdialog (einmal)', take() === 'zyxwvuts98' && take() === null);
    check('Reihenfolge: danach darf „Neu in …“ fragen', gate.whatsNewAllowed() && gate.peekInvite('x') === null);
    const fresh = pickWhatsNew('0.13.8', null, [], null);
    check('Reihenfolge: erste Installation zeigt kein „Neu in …“ (nur merken)', fresh.show === null && fresh.markSeen);
    const updated = setupStart({ stored: { lastSeenVersion: '0.13.7' }, instances: 1, accounts: 1 });
    const whatsNew = pickWhatsNew('0.13.8', '0.13.7', [{ version: '0.13.8', date: '2026-11-27', notes: ['Neu: Assistent'] }], null);
    check('Reihenfolge: Update ohne Assistent → „Neu in …“ wie bisher', !updated.show && new SetupGate(updated.show).whatsNewAllowed() && whatsNew.show?.version === '0.13.8');
    gate.begin();
    pendingInvite = 'qrstuvwx23';
    check('Reihenfolge: „Einrichtung erneut starten“ hält wieder zurück', take() === null && !gate.whatsNewAllowed());
    gate.end();
    check('Reihenfolge: und gibt danach wieder frei', take() === 'qrstuvwx23');

    // ---------- Auswahl (ohne Netz) ----------
    const dirs = { heldix: path.join(tmp, 'heldix'), zweite: path.join(tmp, 'zweite'), fabric: path.join(tmp, 'fabric') };
    for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
    const heldix: OverviewInstance = { id: 'heldixclient-26-3', name: 'HeldixClient 26.3', minecraft: '26.3', loader: 'heldix', dir: dirs.heldix };
    const zweite: OverviewInstance = { id: 'zweite', name: 'Zweite', minecraft: '26.3', loader: 'heldix', dir: dirs.zweite };
    const fabric: OverviewInstance = { id: 'fabric', name: 'Fabric mit HeldixClient', minecraft: '26.3', loader: 'fabric', dir: dirs.fabric };
    check('Ziele: Instanzen mit Heldix Loader sind die Standard-Instanzen', ids(setupTargets([fabric, heldix, zweite])) === 'heldixclient-26-3,zweite');
    check('Ziele: ohne Heldix Loader alle mit HeldixClient', ids(setupTargets([fabric])) === 'fabric' && setupTargets([]).length === 0);

    const all = entriesOf(ADDONS.filter((a) => !a.badSignature));
    const list = setupAddonList(all, [heldix]);
    check('Auswahl: nur offizielle, passende Addons; Empfehlungen zuerst', ids(list) === 'voicechat,minimap,uhrzeit,emoterad,spotify', ids(list));
    check('Auswahl: Community-Addon fehlt', !list.some((a) => a.id === 'chatplus'));
    check('Auswahl: zu neue API-Stufe fehlt', !list.some((a) => a.id === 'zukunft'));
    check('Auswahl: anderes System fehlt', !list.some((a) => a.id === 'woanders'));
    check('Auswahl: nur Fabric fehlt in Heldix-Instanz', !list.some((a) => a.id === 'nurfabric'));
    check('Auswahl: falsche Minecraft-Version fehlt', !list.some((a) => a.id === 'altmc'));
    check('Auswahl: Empfehlung = voicechat, minimap, uhrzeit', JSON.stringify(RECOMMENDED_ADDONS) === JSON.stringify(['voicechat', 'minimap', 'uhrzeit']));
    check('Auswahl: genau die Empfehlungen vorausgewählt', ids(list.filter((a) => a.preselected)) === 'voicechat,minimap,uhrzeit' && list.filter((a) => a.recommended).length === 3);
    const emote = list.find((a) => a.id === 'emoterad');
    check('Auswahl: „Greift in Minecraft ein“ und Größe kommen mit', emote?.access === 'minecraft' && (emote?.size ?? 0) > 0 && list.find((a) => a.id === 'voicechat')?.access === 'api');
    check('Auswahl: Fabric-Instanz bekommt das Fabric-Addon', setupAddonList(all, [fabric]).some((a) => a.id === 'nurfabric'));
    check('Auswahl: in eine von zwei Instanzen passend reicht', setupAddonList(all, [heldix, fabric]).some((a) => a.id === 'nurfabric'));
    const withoutClock = setupAddonList(entriesOf(ADDONS.filter((a) => a.id !== 'uhrzeit' && !a.badSignature)), [heldix]);
    check('Auswahl: fehlende Empfehlung wird nicht vorausgewählt', ids(withoutClock.filter((a) => a.preselected)) === 'voicechat,minimap');
    check('Auswahl: ohne Ziel-Instanz nichts', setupAddonList(all, []).length === 0);
    const installedMap = [new Map<string, string | null>([['voicechat', '1.2.0'], ['minimap', '0.9.0']])];
    const again = setupAddonList(all, [heldix], installedMap);
    check('Auswahl: schon installiert → nicht vorausgewählt', again.find((a) => a.id === 'voicechat')?.installed === true && again.find((a) => a.id === 'voicechat')?.preselected === false);
    check('Auswahl: ältere Version installiert → vorausgewählt', again.find((a) => a.id === 'minimap')?.installed === false && again.find((a) => a.id === 'minimap')?.preselected === true);
    const twoTargets = setupAddonList(all, [heldix, zweite], [new Map([['voicechat', '1.2.0']]), new Map()]);
    check('Auswahl: nur in einer von zwei Instanzen installiert → noch nicht fertig', twoTargets.find((a) => a.id === 'voicechat')?.installed === false);

    // ---------- Store laden (Signatur, ohne Verbindung) ----------
    const loaded = await loadSetupAddons(base, pem, [heldix]);
    check('Laden: Store mit geprüfter Signatur', loaded.view.status === 'ok' && loaded.view.error === null && ids(loaded.view.addons) === 'voicechat,minimap,uhrzeit,emoterad,spotify', ids(loaded.view.addons));
    check('Laden: falsch signiertes Addon fehlt', !loaded.view.addons.some((a) => a.id === 'falsch') && !loaded.entries?.some((e) => e.manifest.id === 'falsch'));
    check('Laden: Ziel-Instanzen ohne Spielordner', JSON.stringify(loaded.view.targets) === JSON.stringify([{ id: heldix.id, name: heldix.name }]));
    const wrongKey = await loadSetupAddons(base, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString(), [heldix]);
    check('Laden: fremder Schlüssel → keine Addons', wrongKey.view.status === 'ok' && wrongKey.view.addons.length === 0);
    const offline = await loadSetupAddons('http://127.0.0.1:1', pem, [heldix]);
    check('Laden: ohne Verbindung → offline mit Meldung', offline.view.status === 'offline' && /nicht erreichbar/.test(offline.view.error ?? '') && offline.entries === null && offline.view.targets.length === 1, offline.view.error);
    storeUp = false;
    const maintenance = await loadSetupAddons(base, pem, [heldix]);
    check('Laden: Store antwortet mit Fehler → offline', maintenance.view.status === 'offline' && /503/.test(maintenance.view.error ?? ''), maintenance.view.error);
    storeUp = true;
    const noService = await loadSetupAddons('', pem, [heldix]);
    check('Laden: kein Heldix-Dienst eingerichtet → offline', noService.view.status === 'offline' && /Kein Heldix-Dienst/.test(noService.view.error ?? ''));
    const noInstance = await loadSetupAddons(base, pem, []);
    check('Laden: keine Instanz mit HeldixClient → no-instance, Store nicht gefragt', noInstance.view.status === 'no-instance' && noInstance.entries === null);

    // ---------- Installieren ----------
    const busy = new Set<string>();
    const logs: string[] = [];
    const ctx = { serviceUrl: base, publicKey: pem, entries: loaded.entries!, targets: [heldix, zweite], busy: (id: string) => busy.has(id), log: (line: string) => logs.push(line) };
    const voice = await installSetupAddon('voicechat', ctx);
    const files = async (dir: string) => (await readdir(path.join(dir, 'heldix-addons')).catch(() => [] as string[])).filter((f) => f.endsWith('.jar')).sort().join(',');
    check('Installieren: in beide Standard-Instanzen', voice.installed.join() === 'HeldixClient 26.3,Zweite' && voice.error === null && voice.name === 'Voice Chat', voice);
    check('Installieren: Datei liegt in heldix-addons', (await files(dirs.heldix)) === 'heldix-addon-voicechat-1.2.0.jar' && (await files(dirs.zweite)) === 'heldix-addon-voicechat-1.2.0.jar');
    check('Installieren: Log ohne Geheimnisse', logs.length === 2 && logs.every((l) => l.startsWith('Einrichtung: Voice Chat 1.2.0 in „')), logs);
    check('Installieren: installierte Version lesbar', (await installedAddonVersions(dirs.heldix)).get('voicechat') === '1.2.0');
    const twice = await installSetupAddon('voicechat', ctx);
    check('Installieren: zweites Mal → schon da, kein Download', twice.installed.length === 0 && twice.already.length === 2 && downloads.filter((d) => d === 'voicechat').length === 2, { twice, downloads });
    const emoteResult = await installSetupAddon('emoterad', { ...ctx, targets: [heldix] });
    check('Installieren: Addon, das in Minecraft eingreift (passend signiert)', emoteResult.installed.join() === 'HeldixClient 26.3' && emoteResult.error === null, emoteResult);
    busy.add('zweite');
    const whileRunning = await installSetupAddon('minimap', ctx);
    check('Installieren: laufende Instanz wird ausgelassen, mit Hinweis', whileRunning.installed.join() === 'HeldixClient 26.3' && /läuft gerade/.test(whileRunning.error ?? ''), whileRunning);
    busy.clear();
    await rejects('Installieren: Community-Addon nicht über den Assistenten', () => installSetupAddon('chatplus', ctx), /Einrichtungs-Assistenten nicht/);
    await rejects('Installieren: unpassendes Addon nicht über den Assistenten', () => installSetupAddon('nurfabric', ctx), /Einrichtungs-Assistenten nicht/);
    await rejects('Installieren: ungültige ID', () => installSetupAddon('../x', ctx), /Einrichtungs-Assistenten nicht/);
    await rejects('Installieren: keine Zeichenkette', () => installSetupAddon(42, ctx), /Einrichtungs-Assistenten nicht/);
    storeUp = false;
    const failed = await installSetupAddon('uhrzeit', { ...ctx, targets: [heldix] });
    check('Installieren: Download geht nicht → Fehler im Ergebnis, nichts liegt herum', failed.installed.length === 0 && /Download fehlgeschlagen/.test(failed.error ?? '') && !(await files(dirs.heldix)).includes('uhrzeit'), failed);
    storeUp = true;
    const later = await installSetupAddon('uhrzeit', { ...ctx, targets: [heldix] });
    check('Installieren: danach klappt es', later.installed.join() === 'HeldixClient 26.3' && (await files(dirs.heldix)).includes('heldix-addon-uhrzeit-1.3.0.jar'), later);
    const afterwards = (await loadSetupAddons(base, pem, [heldix])).view.addons;
    check('Erneut starten: Installiertes ist markiert und nicht mehr vorausgewählt', afterwards.filter((a) => a.installed).map((a) => a.id).sort().join() === 'emoterad,minimap,uhrzeit,voicechat' && afterwards.filter((a) => a.preselected).length === 0);
  } finally {
    server.close();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  finish('Einrichtung');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
