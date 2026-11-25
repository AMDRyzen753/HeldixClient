// Prüfungen der Eingaben: Server-Adressen, UUIDs, Namen, Cape-Liste.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkText, codePointLength, DEFAULT_CAPES, isName, isUuid, normalizeServer, normalizeUuid, parseCapeList } from '../src/validate';

test('Server-Adressen: nur öffentliche Domains', () => {
  const valid: Record<string, string> = {
    'hypixel.net': 'hypixel.net',
    'mc.hypixel.net': 'mc.hypixel.net',
    'Play.GommeHD.net': 'play.gommehd.net',
    '  hypixel.net  ': 'hypixel.net',
    'hypixel.net.': 'hypixel.net',
    'mc.hypixel.net:25565': 'mc.hypixel.net',
    'play.example.org:25566': 'play.example.org:25566',
    'Play.Example.ORG:1': 'play.example.org:1',
    'play.example.org:65535': 'play.example.org:65535',
    'play.example.org:00080': 'play.example.org:80',
    'play.example.org.:19132': 'play.example.org:19132',
    'münchen.de:25570': 'xn--mnchen-3ya.de:25570',
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
    'hypixel.net:0',
    'hypixel.net:65536',
    'hypixel.net:99999',
    'hypixel.net:',
    'hypixel.net:25565:1',
    'mc.hypixel.net:025565',
    'localhost:25566',
    '192.168.178.20:25566',
    'fritz.box:8080',
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

test('Texte von Spielern (Nachrichten, Notizen)', () => {
  assert.deepEqual(checkText('  Hallo  ', 10, false), { text: 'Hallo' });
  assert.deepEqual(checkText('Hallo\n', 10, false), { text: 'Hallo' }, 'Zeilenumbruch am Ende fällt beim Trimmen weg');
  assert.deepEqual(checkText('', 10, true), { text: '' });
  assert.deepEqual(checkText('   ', 10, false), { problem: 'empty' });
  assert.deepEqual(checkText(42, 10, false), { problem: 'type' });
  assert.deepEqual(checkText(null, 10, true), { problem: 'type' });
  const bad = ['a\nb', 'a\rb', 'a\tb', 'a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0085b', 'a\u2028b', 'a\u202Eb', 'a\u2066b', 'a\ud800b', 'a\udc00'];
  for (const text of bad) assert.deepEqual(checkText(text, 10, false), { problem: 'chars' }, JSON.stringify(text));
  // Gezählt werden Unicode-Zeichen: Emoji aus zwei UTF-16-Einheiten zählen einfach.
  assert.equal(codePointLength('\u{1F600}\u{1F600}'), 2);
  assert.equal(codePointLength('äöü'), 3);
  assert.deepEqual(checkText('\u{1F600}'.repeat(10), 10, false), { text: '\u{1F600}'.repeat(10) });
  assert.deepEqual(checkText('\u{1F600}'.repeat(11), 10, false), { problem: 'long' });
  // Verbundene Emoji (mit Nullbreiten-Verbinder) und Umlaute sind erlaubt.
  const joined = '\u{1F469}\u200D\u{1F4BB} grüß dich';
  assert.deepEqual(checkText(joined, 20, false), { text: joined });
});
