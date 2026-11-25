// Prüfungen der Eingaben: Server-Adressen, UUIDs, Namen, Cape-Liste.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_CAPES, isName, isUuid, normalizeServer, normalizeUuid, parseCapeList } from '../src/validate';

test('Server-Adressen: nur öffentliche Domains', () => {
  const valid: Record<string, string> = {
    'hypixel.net': 'hypixel.net',
    'mc.hypixel.net': 'mc.hypixel.net',
    'Play.GommeHD.net': 'play.gommehd.net',
    '  hypixel.net  ': 'hypixel.net',
    'hypixel.net.': 'hypixel.net',
    'mc.hypixel.net:25565': 'mc.hypixel.net',
    'my-server.example.co.uk': 'my-server.example.co.uk',
    'münchen.de': 'xn--mnchen-3ya.de',
    'xn--mnchen-3ya.de': 'xn--mnchen-3ya.de',
  };
  for (const [input, expected] of Object.entries(valid)) assert.equal(normalizeServer(input), expected, input);

  const invalid: unknown[] = [
    null,
    undefined,
    42,
    {},
    '',
    '   ',
    'localhost',
    'localhost:25565',
    'sub.localhost',
    'minecraft',
    '127.0.0.1',
    '192.168.178.20',
    '10.0.0.1:25565',
    '1.2.3.4.5',
    '::1',
    '[::1]',
    '[2001:db8::1]:25565',
    'fe80::1',
    'fritz.box',
    'server.fritz.box',
    'nas.local',
    'pc.lan',
    'server.home',
    'host.internal',
    'speedport.ip',
    'mc.home.arpa',
    'example.test',
    'bad_name.net',
    '-bad.net',
    'bad-.net',
    'a..b.net',
    '.hypixel.net',
    'hypixel.net/pfad',
    'http://hypixel.net',
    'user@hypixel.net',
    'hypixel.net:abc',
    'hypixel.net:123456',
    `${'a'.repeat(64)}.net`,
    'x'.repeat(301),
  ];
  for (const input of invalid) assert.equal(normalizeServer(input), null, String(input));

  // Höchstens 253 Zeichen.
  const longest = `${'abcdefghi.'.repeat(24)}abcdefghij.net`;
  assert.equal(longest.length, 254);
  const ok253 = `${'abcdefghi.'.repeat(24)}abcdefghi.net`;
  assert.equal(ok253.length, 253);
  assert.equal(normalizeServer(ok253), ok253);
  assert.equal(normalizeServer(longest), null);
});

test('UUIDs', () => {
  assert.equal(isUuid('0123456789abcdef0123456789abcdef'), true);
  assert.equal(isUuid('0123456789ABCDEF0123456789ABCDEF'), false);
  assert.equal(isUuid('01234567-89ab-cdef-0123-456789abcdef'), false);
  assert.equal(isUuid('0123456789abcdef0123456789abcde'), false);
  assert.equal(isUuid(42), false);
  assert.equal(normalizeUuid('01234567-89AB-CDEF-0123-456789ABCDEF'), '0123456789abcdef0123456789abcdef');
  assert.equal(normalizeUuid('0123456789abcdef0123456789abcdef'), '0123456789abcdef0123456789abcdef');
  assert.equal(normalizeUuid('0123-456789abcdef0123456789abcdef'), null);
  assert.equal(normalizeUuid('zz23456789abcdef0123456789abcdef'), null);
  assert.equal(normalizeUuid(null), null);
});

test('Spielernamen', () => {
  for (const name of ['a', 'Notch', 'jeb_', 'A_B_C_1234567890'.slice(0, 16), '___']) assert.equal(isName(name), true, name);
  for (const name of ['', 'a'.repeat(17), 'mit leer', 'ümlaut', 'name-strich', 'a.b', 42, null]) assert.equal(isName(name), false, String(name));
});

test('Cape-Liste aus HELDIX_DIENST_CAPES', () => {
  assert.deepEqual(parseCapeList(undefined), [...DEFAULT_CAPES]);
  assert.deepEqual(parseCapeList(''), [...DEFAULT_CAPES]);
  assert.deepEqual(parseCapeList(' winter, sommer ,,winter'), ['winter', 'sommer']);
  assert.throws(() => parseCapeList('gut,Schlecht'));
  assert.throws(() => parseCapeList('mit leer'));
});
