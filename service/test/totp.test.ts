// Zwei-Faktor-Codes: RFC 6238 (TOTP, SHA-1), RFC 4226 (HOTP) und Base32 (RFC 4648).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { base32Decode, base32Encode, hotp, newTotpSecret, totp, totpUri, verifyTotp } from '../src/totp';

/** Geheimnis aus RFC 6238, Anhang B (SHA-1): „12345678901234567890“ als ASCII. */
const RFC_KEY = Buffer.from('12345678901234567890', 'ascii');

test('RFC 6238: Testwerte für SHA-1 (8 Ziffern)', () => {
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, expected] of vectors) assert.equal(totp(RFC_KEY, seconds * 1000, 8), expected, String(seconds));
  // 6 Ziffern sind die letzten 6 davon.
  assert.equal(totp(RFC_KEY, 59_000), '287082');
});

test('RFC 4226: Testwerte für HOTP', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => assert.equal(hotp(RFC_KEY, counter), code, String(counter)));
});

test('Base32 (RFC 4648) und neue Geheimnisse', () => {
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.equal(base32Encode(Buffer.from('f')), 'MY');
  assert.deepEqual(base32Decode('MZXW6YTBOI'), Buffer.from('foobar'));
  assert.deepEqual(base32Decode('mzxw 6ytb oi======'), Buffer.from('foobar'));
  assert.equal(base32Decode('MZXW1'), null);
  assert.equal(base32Encode(RFC_KEY), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const secret = newTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(base32Decode(secret)!.length, 20);
  assert.notEqual(newTotpSecret(), secret);
});

test('Prüfen: ±1 Schritt, jeder Schritt nur einmal, nur 6 Ziffern', () => {
  const secret = base32Encode(RFC_KEY);
  const t = 1_111_111_111_000;
  const step = Math.floor(t / 30_000);
  const code = totp(RFC_KEY, t);
  assert.equal(verifyTotp(secret, code, t, 0), step);
  assert.equal(verifyTotp(secret, code, t + 30_000, 0), step, 'ein Schritt später geht noch');
  assert.equal(verifyTotp(secret, code, t - 30_000, 0), step, 'ein Schritt früher geht noch');
  assert.equal(verifyTotp(secret, code, t + 60_000, 0), null, 'zwei Schritte später nicht mehr');
  assert.equal(verifyTotp(secret, code, t, step), null, 'schon benutzt');
  assert.equal(verifyTotp(secret, totp(RFC_KEY, t + 30_000), t, step), step + 1);
  for (const bad of ['', '12345', '1234567', 'abcdef', ' 123456']) assert.equal(verifyTotp(secret, bad, t, 0), null, bad);
  assert.equal(verifyTotp('kein base32!', code, t, 0), null);
});

test('Adresse für die Authenticator-App', () => {
  assert.equal(
    totpUri('Heldix_1', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
    'otpauth://totp/HeldixClient:Heldix_1?secret=ABCDEFGHIJKLMNOPQRSTUVWXYZ234567&issuer=HeldixClient&algorithm=SHA1&digits=6&period=30',
  );
});
