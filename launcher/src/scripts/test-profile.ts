// Prüft Skins & Capes (core/profile.ts) ohne Mojang: Skin-Prüfung (PNG, Größe, 64 KB), Modell-Erkennung,
// Sammlung (index.json + PNG), Mojang-Aufrufe gegen einen Fake-Server (Profil, Hochladen, Zurücksetzen, Capes,
// Fehler wie 429) und das Zusammenspiel in ProfileService (aktueller Skin in die Sammlung, „aktiv“, Figur neu laden).
//
// Aufruf: npm run test:profile

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SkinInfo } from '../shared/api';
import { createPaths } from '../main/core/paths';
import { MojangApi, ProfileService, SkinLibrary, inspectSkin, loadHeldixCapes, type ProfileAccount } from '../main/core/profile';
import { allowTestTextureOrigin, cachedTexture, textureUrl } from '../main/core/skins';
import { FakeMojang, check, encodePng, finish, freePort, makeSkin, pngChunk, rejects, skinPixels } from './testkit';

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const dataUrlBytes = (url: string | undefined | null) => Buffer.from((url ?? '').replace(/^data:image\/png;base64,/, ''), 'base64');

async function main(): Promise<void> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'heldix-profile-'));
  const fake = await new FakeMojang().start();
  try {
    // ---------- Skin-Prüfung und Modell ----------
    const variant = (png: Buffer) => inspectSkin(png).variant;
    check('64×64 RGBA, breit', variant(makeSkin()) === 'classic');
    check('64×64 RGBA, schmal (Arme x 54..55 durchsichtig)', variant(makeSkin({ slim: true })) === 'slim');
    check('alle PNG-Filter (Sub, Up, Average, Paeth)', variant(makeSkin({ slim: true, filter: 'mixed' })) === 'slim' && variant(makeSkin({ filter: 'mixed' })) === 'classic');
    check('alter 64×32-Skin: immer breit', variant(makeSkin({ height: 32 })) === 'classic');
    check('Palette mit tRNS (4 Bit), schmal', variant(makeSkin({ slim: true, colorType: 3, bitDepth: 4 })) === 'slim');
    check('Palette (8 Bit), breit', variant(makeSkin({ colorType: 3, bitDepth: 8 })) === 'classic');
    check('RGB ohne Alpha: breit', variant(makeSkin({ slim: true, colorType: 2 })) === 'classic');
    check('Grau mit Alpha, schmal', variant(makeSkin({ slim: true, colorType: 4 })) === 'slim');
    check('16 Bit RGBA, schmal', variant(makeSkin({ slim: true, bitDepth: 16 })) === 'slim');
    check('Interlacing: angenommen, breit', variant(makeSkin({ slim: true, interlace: true })) === 'classic');
    const almostSlim = skinPixels(64, true);
    almostSlim[(31 * 64 + 55) * 4 + 3] = 10; // ein Pixel nicht ganz durchsichtig
    check('ein sichtbares Pixel im Armbereich: breit', variant(encodePng(64, 64, almostSlim)) === 'classic');
    expectError('falsche Größe', () => inspectSkin(encodePng(32, 32, Buffer.alloc(32 * 32 * 4, 255)), 'klein.png'), /„klein\.png“ hat 32×32 Pixel/);
    expectError('kein PNG', () => inspectSkin(Buffer.from('GIF89a das ist kein PNG'), 'bild.png'), /kein PNG-Bild/);
    const big = makeSkin({ extra: [pngChunk('tEXt', Buffer.alloc(70 * 1024, 65))] });
    expectError('größer als 64 KB', () => inspectSkin(big, 'gross.png'), /höchstens 64 KB/);
    const broken = Buffer.from(makeSkin());
    broken.fill(7, 50, 120); // Bilddaten zerstört
    expectError('beschädigte Bilddaten', () => inspectSkin(broken, 'kaputt.png'), /beschädigt/);

    // ---------- Sammlung ----------
    const files = path.join(tmp, 'dateien');
    await mkdir(files, { recursive: true });
    const classic = makeSkin({ seed: 2 });
    const slim = makeSkin({ slim: true, seed: 4 });
    await writeFile(path.join(files, 'Mein Ritter.png'), classic);
    await writeFile(path.join(files, 'Alex Variante.png'), slim);
    await writeFile(path.join(files, 'notizen.png'), 'kein Bild');
    const library = new SkinLibrary(path.join(tmp, 'sammlung'));
    let added = await library.importFiles([path.join(files, 'Mein Ritter.png'), path.join(files, 'Alex Variante.png'), path.join(files, 'notizen.png'), 42]);
    check('Import: zwei Skins, ungültige Datei übersprungen', added.length === 2 && added.some((s) => s.name === 'Mein Ritter' && s.variant === 'classic') && added.some((s) => s.name === 'Alex Variante' && s.variant === 'slim'), added.map((s) => [s.name, s.variant]));
    check('Import: data:-URL mit den Bytes der Datei', dataUrlBytes(added.find((s) => s.name === 'Mein Ritter')?.dataUrl).equals(classic));
    await expectReject('Import: nur ungültige Dateien → Meldung', () => library.importFiles([path.join(files, 'notizen.png')]), /„notizen\.png“ ist kein PNG-Bild/);
    const again = await library.importFiles([path.join(files, 'Mein Ritter.png')]);
    check('Import: gleiches Bild nicht doppelt', again.length === 1 && again[0].id === added.find((s) => s.name === 'Mein Ritter')?.id && (await library.list()).length === 2);
    const index = JSON.parse(await readFile(path.join(tmp, 'sammlung', 'index.json'), 'utf8')) as { skins: { id: string; sha256: string }[] };
    check('index.json und PNG-Dateien', index.skins.length === 2 && (await readdir(path.join(tmp, 'sammlung'))).filter((f) => f.endsWith('.png')).length === 2 && index.skins.every((s) => /^[0-9a-f]{16}$/.test(s.id)));
    const knight = added.find((s) => s.name === 'Mein Ritter')!;
    const renamed = await library.update(knight.id, { name: '  Ritter\u0007 neu  ', variant: 'slim' });
    check('umbenennen und Modell ändern', renamed.name === 'Ritter neu' && renamed.variant === 'slim', renamed);
    await expectReject('leerer Name', () => library.update(knight.id, { name: '   ' }), /Namen/);
    await expectReject('ungültiges Modell', () => library.update(knight.id, { variant: 'dick' }), /Modell/);
    await expectReject('unbekannter Skin', () => library.update('0000000000000000', { name: 'x' }), /gibt es nicht/);
    await expectReject('Pfad statt ID', () => library.get('../index'), /gibt es nicht/);
    await library.remove(knight.id);
    check('löschen', (await library.list()).length === 1 && !(await readdir(path.join(tmp, 'sammlung'))).includes(`${knight.id}.png`));
    check('aktueller Skin wird übernommen', await library.adoptCurrent('uuid1', classic, 'classic', 'https://x/1'));
    check('… nur einmal', !(await library.adoptCurrent('uuid1', classic, 'classic', 'https://x/1')));
    const adopted = (await library.list()).find((s) => s.name === 'Aktueller Skin');
    await library.remove(adopted!.id);
    check('… und nach dem Löschen nicht wieder', !(await library.adoptCurrent('uuid1', classic, 'classic', 'https://x/1')) && !(await library.list()).some((s) => s.name === 'Aktueller Skin'));

    // ---------- Texturen ----------
    check('Textur-Adresse: Mojang über HTTPS', textureUrl('http://textures.minecraft.net/texture/abc') === 'https://textures.minecraft.net/texture/abc');
    check('Textur-Adresse: fremde Hosts abgelehnt', textureUrl('https://evil.example/texture/abc') === null && textureUrl('http://textures.minecraft.net:8080/x') === null && textureUrl(`${fake.url}/texture/x`) === null);
    allowTestTextureOrigin(fake.url);
    check('Textur-Adresse: Fake-Server nur im Test erlaubt', textureUrl(`${fake.url}/texture/x`) === `${fake.url}/texture/x`);
    expectError('Test-Texturen nur von Loopback', () => allowTestTextureOrigin('https://example.com'), /Loopback/);

    // ---------- Mojang-Aufrufe (Fake) ----------
    const capeA = makeSkin({ seed: 7, height: 32 });
    const capeB = makeSkin({ seed: 8, height: 32 });
    const startSkin = makeSkin({ seed: 1 });
    const player = fake.addPlayer('SkinTester', { skin: startSkin, capes: [{ alias: 'Migrator', png: capeA, active: true }, { alias: 'Vanilla', png: capeB }] });
    const api = new MojangApi(fake.url);
    let profile = await api.profile(player.token);
    check('Profil: Skins und Capes', profile.id === player.uuid && profile.skins.length === 1 && profile.skins[0].variant === 'classic' && profile.capes.length === 2 && profile.capes[0].alias === 'Migrator', profile);
    await expectReject('Profil ohne gültiges Token: deutsche Meldung', () => api.profile('falsch'), /Anmeldung bei Minecraft ist abgelaufen/);
    profile = await api.uploadSkin(player.token, slim, 'slim');
    const upload = fake.uploads.at(-1);
    check('Hochladen: multipart mit variant und file', upload?.variant === 'slim' && upload.file.equals(slim), upload && { variant: upload.variant, bytes: upload.file.length });
    check('Hochladen: neuer aktiver Skin, schmal', profile.skins.find((s) => s.state === 'ACTIVE')?.variant === 'slim');
    profile = await api.setCape(player.token, profile.capes[1].id);
    check('Cape wechseln (PUT capes/active)', profile.capes.find((c) => c.state === 'ACTIVE')?.alias === 'Vanilla' && fake.log.includes('PUT /minecraft/profile/capes/active'));
    profile = await api.setCape(player.token, null);
    check('Cape ablegen (DELETE capes/active)', profile.capes.every((c) => c.state !== 'ACTIVE'));
    await expectReject('fremdes Cape: deutsche Meldung', () => api.setCape(player.token, 'nicht-meins'), /gehört nicht zu deinem Konto/);
    fake.fail = { route: /^POST \/minecraft\/profile\/skins$/, status: 429 };
    await expectReject('429 beim Hochladen: zu viele Änderungen', () => api.uploadSkin(player.token, classic, 'classic'), /Zu viele Änderungen/);
    fake.fail = { route: /^POST \/minecraft\/profile\/skins$/, status: 400, body: { errorMessage: 'Could not validate image data' } };
    await expectReject('400 beim Hochladen: Bild abgelehnt', () => api.uploadSkin(player.token, classic, 'classic'), /abgelehnt/);
    fake.fail = { route: /^GET \/minecraft\/profile$/, status: 503 };
    await expectReject('5xx: Mojang nicht erreichbar', () => api.profile(player.token), /nicht erreichbar/);
    const closed = await freePort();
    await expectReject('Netzwerkfehler: Mojang nicht erreichbar', () => new MojangApi(`http://127.0.0.1:${closed}`).profile(player.token), /Mojang ist gerade nicht erreichbar/);
    profile = await api.resetSkin(player.token);
    check('zurücksetzen (DELETE skins/active)', profile.skins[0]?.alias === 'STEVE', profile.skins);

    // ---------- ProfileService ----------
    const paths = createPaths(path.join(tmp, 'launcher'));
    const capesFile = path.resolve(__dirname, '..', '..', '..', 'mod', 'src', 'main', 'resources', 'assets', 'heldixclient', 'textures', 'cape', 'capes.json');
    const capes = await loadHeldixCapes(capesFile);
    check('Heldix-Capes aus capes.json', capes.length === 9 && capes.find((c) => c.id === 'sakura')?.glow === false && capes.every((c) => c.frames === 24 && c.fps >= 10));
    const owner = fake.addPlayer('Sammler', { skin: startSkin, capes: [{ alias: 'Migrator', png: capeA, active: true }, { alias: 'Vanilla', png: capeB }] });
    const msAccount: ProfileAccount & { token: string } = { id: 'konto-ms', type: 'microsoft', name: owner.name, uuid: owner.uuid, token: owner.token };
    const fallback: SkinInfo = { dataUrl: `data:image/png;base64,${makeSkin({ seed: 50, slim: true }).toString('base64')}`, slim: null, source: 'default' };
    let account: (ProfileAccount & { token: string }) | null = msAccount;
    let tokenError: string | null = null;
    const skinChanges: (string | null)[] = [];
    let heldixCape = '';
    const service = new ProfileService<ProfileAccount & { token: string }>({
      paths,
      libraryDir: path.join(tmp, 'launcher', 'skins'),
      mojang: new MojangApi(fake.url),
      account: async () => account,
      accessToken: async (a) => {
        if (tokenError) throw new Error(tokenError);
        return a.token;
      },
      heldix: { getMe: async () => ({ cape: heldixCape }), setCape: async (cape) => ({ cape: (heldixCape = cape) }) },
      capes: async () => capes,
      fallbackSkin: async () => fallback,
      onSkinChanged: (_a, url) => {
        skinChanges.push(url);
      },
    });
    let state = await service.state();
    check('Microsoft-Konto: Skin änderbar, Skin von Mojang', state.canEditSkin && dataUrlBytes(state.skin?.dataUrl).equals(startSkin) && state.skin?.variant === 'classic' && state.error === null, { ...state, library: state.library.length, skin: state.skin?.variant });
    check('Mojang-Capes mit Bild und aktivem', state.mojangCapes.length === 2 && state.mojangCapes.every((c) => c.dataUrl?.startsWith('data:image/png;base64,')) && state.mojangCapes.find((c) => c.active)?.alias === 'Migrator');
    check('aktueller Skin automatisch in der Sammlung, aktiv', state.library.length === 1 && state.library[0].name === 'Aktueller Skin' && state.library[0].active, state.library.map((s) => [s.name, s.active]));
    check('Heldix-Capes und Auswahl', state.heldixAvailable && state.heldixCape === null && state.heldixCapes.length === 9);
    state = await service.state(true);
    check('kein zweites „Aktueller Skin“', state.library.length === 1);

    const imported = await service.importSkins([path.join(files, 'Alex Variante.png')]);
    check('Import über den Dienst: schmal erkannt, nicht aktiv', imported.length === 1 && imported[0].variant === 'slim' && !imported[0].active);
    state = await service.applySkin(imported[0].id);
    const sent = fake.uploads.at(-1);
    check('Skin anwenden: Bytes und Modell an Mojang', sent?.file.equals(slim) === true && sent.variant === 'slim');
    check('Skin anwenden: Figur auf der Startseite wird neu geladen', skinChanges.length === 1 && typeof skinChanges[0] === 'string' && skinChanges[0].startsWith(fake.url));
    const activeNow = state.library.filter((s) => s.active);
    check('Skin anwenden: dieser Skin ist jetzt aktiv (Mojang speichert ihn mit anderen Bytes)', activeNow.length === 1 && activeNow[0].id === imported[0].id && !dataUrlBytes(state.skin?.dataUrl).equals(slim), activeNow.map((s) => s.name));
    check('Skin anwenden: kein neues „Aktueller Skin“', state.library.length === 2 && state.skin?.variant === 'slim', state.library.map((s) => s.name));
    state = await service.state(true);
    check('… auch nach dem Neuladen', state.library.length === 2 && state.library.find((s) => s.active)?.id === imported[0].id);

    fake.fail = { route: /^POST \/minecraft\/profile\/skins$/, status: 429 };
    await expectReject('Skin anwenden: 429 als deutsche Meldung', () => service.applySkin(state.library[1].id), /Zu viele Änderungen/);
    await expectReject('Skin anwenden: unbekannter Skin', () => service.applySkin('ffffffffffffffff'), /gibt es nicht/);

    const capeId = state.mojangCapes.find((c) => !c.active)!.id;
    state = await service.setMojangCape(capeId);
    check('Mojang-Cape wechseln', state.mojangCapes.find((c) => c.active)?.id === capeId);
    state = await service.setMojangCape(null);
    check('Mojang-Cape ablegen', state.mojangCapes.every((c) => !c.active));
    await expectReject('Mojang-Cape, das das Konto nicht hat', () => service.setMojangCape('fremd'), /gehört nicht zu deinem Konto/);
    state = await service.setHeldixCape('neon');
    check('Heldix-Cape setzen', state.heldixCape === 'neon' && heldixCape === 'neon');
    await expectReject('Heldix-Cape außerhalb des Katalogs', () => service.setHeldixCape('../x'), /gibt es nicht/);

    state = await service.resetSkin();
    check('Standard-Skin: Mojang zurückgesetzt, Figur neu', fake.log.filter((l) => l === 'DELETE /minecraft/profile/skins/active').length === 2 && skinChanges.length === 2);
    check('Standard-Skin kommt nicht in die Sammlung, nichts aktiv', state.library.length === 2 && state.library.every((s) => !s.active), state.library.map((s) => [s.name, s.active]));

    // abgelaufene Anmeldung über den Minecraft Launcher
    tokenError = 'Die Anmeldung über den Minecraft Launcher ist abgelaufen. Bitte einmal spielen oder neu anmelden.';
    state = await service.state(true);
    check('Anmeldung abgelaufen: nicht änderbar, Hinweis, Ersatz-Skin', !state.canEditSkin && /Bitte einmal spielen oder neu anmelden/.test(state.error ?? '') && state.skin?.dataUrl === fallback.dataUrl && state.skin.variant === 'slim' && state.mojangCapes.length === 0, state.error);
    await expectReject('Anmeldung abgelaufen: Ändern geht nicht', () => service.resetSkin(), /Bitte einmal spielen/);
    tokenError = null;

    // Mojang weg: Texturen kommen aus dem Zwischenspeicher
    const cachedUrl = (await api.profile(owner.token)).capes[0].url;
    await fake.stop();
    state = await service.state(true);
    check('Mojang nicht erreichbar: Meldung, Sammlung bleibt', !state.canEditSkin && /Mojang ist gerade nicht erreichbar/.test(state.error ?? '') && state.library.length === 2, state.error);
    check('Textur offline aus dem Zwischenspeicher', (await cachedTexture(paths, cachedUrl))?.equals(capeA) === true);

    // Offline-Konto
    account = { id: 'konto-offline', type: 'offline', name: 'Offline', uuid: 'b'.repeat(32), token: '' };
    state = await service.state();
    check('Offline-Konto: nicht änderbar, Standard-Skin, kein Fehler, kein Heldix-Cape', !state.canEditSkin && state.error === null && state.skin?.dataUrl === fallback.dataUrl && !state.heldixAvailable && state.account?.type === 'offline');
    await expectReject('Offline-Konto: Skin anwenden geht nicht', () => service.applySkin(state.library[0].id), /nur mit einem Microsoft-Konto/);
    account = null;
    state = await service.state();
    check('ohne Konto: leerer Stand mit Sammlung', state.account === null && state.skin === null && state.library.length === 2 && state.heldixCapes.length === 9);
    check('Sammlung nach allem: Prüfsummen stimmen', (await new SkinLibrary(path.join(tmp, 'launcher', 'skins')).list()).every((s) => sha(dataUrlBytes(s.dataUrl)).length === 64));
  } finally {
    await fake.stop();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
  finish('Skins & Capes');
}

function expectError(label: string, task: () => unknown, pattern: RegExp): void {
  try {
    task();
    check(label, false, 'kein Fehler');
  } catch (error) {
    check(label, pattern.test(error instanceof Error ? error.message : String(error)), error);
  }
}

const expectReject = rejects;

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
