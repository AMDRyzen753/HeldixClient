// Installer (installer/install.sh) für dauerhafte Welten: Syntax (bash -n, auch das eingebettete Firewall-Skript),
// shellcheck (falls vorhanden), Hilfe mit den neuen Optionen und Ablehnung falscher Optionen – alles, bevor der
// Installer irgendetwas am System tut (Prüfungen in parse_args). Nie mit gültigen Optionen aufrufen: das würde
// installieren. Unter Windows nur mit Git-Bash (nie das bash.exe von WSL).
// Dazu der Schlüssel für Voice-Clips (1.13.0): nur die Funktionen aus dem Installer, in einem leeren Ordner.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

const INSTALLER = path.join(__dirname, '..', '..', '..', 'installer', 'install.sh');

function findBash(): string | null {
  if (process.platform === 'win32') {
    for (const candidate of ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }
  for (const candidate of ['/bin/bash', '/usr/bin/bash']) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function hasShellcheck(): boolean {
  const result = spawnSync('shellcheck', ['--version'], { encoding: 'utf8', shell: false });
  return result.status === 0;
}

const bash = findBash();
// Auf einem echten Server (root oder schon installiert) keine Aufrufe, die über parse_args hinauskommen könnten
const unsafe = (typeof process.getuid === 'function' && process.getuid() === 0) || fs.existsSync('/etc/heldix-dienst');

function run(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(bash!, [INSTALLER, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, LC_ALL: 'C.UTF-8' } });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('Installer: dauerhafte Welten', { skip: bash === null ? 'kein bash (unter Windows: Git-Bash)' : false }, () => {
  test('bash -n für den Installer und das eingebettete Firewall-Skript', () => {
    const syntax = spawnSync(bash!, ['-n', INSTALLER], { encoding: 'utf8' });
    assert.equal(syntax.status, 0, syntax.stderr);
    const text = fs.readFileSync(INSTALLER, 'utf8');
    const match = /<<'HELDIX_FIREWALL'\n([\s\S]*?)\nHELDIX_FIREWALL\n/.exec(text);
    assert.ok(match, 'Firewall-Skript im Installer');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-installer-'));
    try {
      const script = path.join(dir, 'welten-firewall.sh');
      fs.writeFileSync(script, `${match[1]}\n`);
      const check = spawnSync(bash!, ['-n', script], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
      // die Regeln, die die Vorgabe verlangt
      for (const needle of ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '100.64.0.0/10', 'ESTABLISHED,RELATED', 'DOCKER-USER', 'INPUT -i "$IF"']) {
        assert.ok(match[1]!.includes(needle), needle);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('shellcheck (falls installiert)', { skip: hasShellcheck() ? false : 'shellcheck nicht installiert' }, () => {
    const result = spawnSync('shellcheck', ['-S', 'error', '-s', 'bash', INSTALLER], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  test('--help nennt die neuen Optionen', { skip: unsafe ? 'auf einem Server nicht ausführen' : false }, () => {
    const result = run('--help');
    assert.equal(result.status, 0, result.stderr);
    for (const option of ['--hosting', '--no-hosting', '--accept-minecraft-eula', '--welten-max <n>', 'https://aka.ms/MinecraftEULA']) {
      assert.ok(result.stdout.includes(option), option);
    }
  });

  test('falsche Optionen brechen vor jeder Änderung ab', { skip: unsafe ? 'auf einem Server nicht ausführen' : false }, () => {
    const cases: [string[], RegExp][] = [
      [['--no-https', '--hosting', '--no-hosting'], /schließen sich aus/],
      [['--no-https', '--no-hosting', '--hosting'], /schließen sich aus/],
      // ohne Zustimmung zur EULA kein Hosting – mit Link zur EULA
      [['--no-https', '--hosting'], /https:\/\/aka\.ms\/MinecraftEULA/],
      [['--no-https', '--hosting', '--accept-minecraft-eula', '--welten-max', 'acht'], /Ungültige Zahl/],
      [['--no-https', '--hosting', '--accept-minecraft-eula', '--welten-max', '0'], /zwischen 1 und 200/],
      [['--no-https', '--hosting', '--accept-minecraft-eula', '--welten-max=999'], /zwischen 1 und 200/],
      [['--no-https', '--no-hosting', '--welten-max', '4'], /passt nicht zu --no-hosting/],
      [['--no-https', '--welten-max'], /braucht eine Zahl/],
    ];
    for (const [args, pattern] of cases) {
      const result = run(...args);
      assert.notEqual(result.status, 0, args.join(' '));
      assert.match(result.stderr, pattern, `${args.join(' ')}: ${result.stderr}`);
      assert.doesNotMatch(result.stderr, /Bitte mit sudo/, 'Abbruch schon in parse_args');
    }
  });
});

/** Funktionen aus dem Installer (vom Namen bis zur schließenden Klammer in Spalte 0). */
function installerFunctions(...names: string[]): string {
  const text = fs.readFileSync(INSTALLER, 'utf8');
  return names
    .map((name) => {
      const match = new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}\\n`, 'm').exec(text);
      assert.ok(match, `Funktion ${name} im Installer`);
      return match[0];
    })
    .join('\n');
}

const KEY_LINE = /^HELDIX_DIENST_VOICE_CLIP_KEY=(.*)$/gm;

describe('Installer: Schlüssel für Voice-Clips', { skip: bash === null ? 'kein bash (unter Windows: Git-Bash)' : false }, () => {
  const posix = (p: string) => p.replace(/\\/g, '/');

  /** configure_voice_clip_key mit Datenordner und env-Datei in `dir` (nichts am System). */
  function step(dir: string): { status: number | null; stdout: string; stderr: string; keys: string[] } {
    const script = path.join(dir, 'schritt.sh');
    fs.writeFileSync(
      script,
      [
        'set -euo pipefail',
        'ok() { printf "ok: %s\\n" "$*"; }',
        'warn() { printf "warn: %s\\n" "$*" >&2; }',
        'die() { printf "die: %s\\n" "$*" >&2; exit 1; }',
        'DATA_DIR="$1"',
        'ENV_FILE="$2"',
        installerFunctions('env_value', 'configure_voice_clip_key'),
        'configure_voice_clip_key',
        '',
      ].join('\n'),
    );
    const result = spawnSync(bash!, [script, posix(path.join(dir, 'daten')), posix(path.join(dir, 'dienst.env'))], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, LC_ALL: 'C.UTF-8' },
    });
    const env = fs.readFileSync(path.join(dir, 'dienst.env'), 'utf8');
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, keys: [...env.matchAll(KEY_LINE)].map((m) => m[1]!) };
  }

  function tempDir(env = 'PORT=8787\nHELDIX_DIENST_DATA=/var/lib/heldix-dienst\n'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'heldix-clipkey-'));
    fs.mkdirSync(path.join(dir, 'daten'));
    fs.writeFileSync(path.join(dir, 'dienst.env'), env);
    return dir;
  }

  test('erster Lauf: zufällig (32 Byte als 64 Hex-Zeichen, wie der Dienst ihn liest); Updates behalten ihn; nie in der Ausgabe', () => {
    const a = tempDir();
    const b = tempDir();
    try {
      const first = step(a);
      assert.equal(first.status, 0, first.stderr);
      assert.equal(first.keys.length, 1);
      const key = first.keys[0]!;
      assert.match(key, /^[0-9a-f]{64}$/);
      assert.match(first.stdout, /erzeugt/);
      assert.ok(!first.stdout.includes(key) && !first.stderr.includes(key), 'Schlüssel in der Ausgabe');
      // eigene Einträge bleiben
      assert.match(fs.readFileSync(path.join(a, 'dienst.env'), 'utf8'), /^PORT=8787$/m);
      // Update-Lauf: bleibt, nicht doppelt
      const again = step(a);
      assert.equal(again.status, 0, again.stderr);
      assert.deepEqual(again.keys, [key]);
      assert.match(again.stdout, /bleibt/);
      assert.ok(!again.stdout.includes(key));
      // ein anderer Server bekommt einen anderen Schlüssel
      const other = step(b);
      assert.equal(other.status, 0, other.stderr);
      assert.notEqual(other.keys[0], key);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test('voice-clips.key vom Dienst wird übernommen (alte Clips bleiben lesbar); eine leere Zeile wird ersetzt; kaputte Datei: neuer Schlüssel mit Warnung', () => {
    const existing = 'ab'.repeat(32);
    const a = tempDir('PORT=8787\nHELDIX_DIENST_VOICE_CLIP_KEY=\n');
    const b = tempDir();
    try {
      fs.writeFileSync(path.join(a, 'daten', 'voice-clips.key'), `${existing}\n`);
      const adopted = step(a);
      assert.equal(adopted.status, 0, adopted.stderr);
      assert.deepEqual(adopted.keys, [existing]);
      assert.match(adopted.stdout, /übernommen/);
      assert.ok(!adopted.stdout.includes(existing) && !adopted.stderr.includes(existing), 'Schlüssel in der Ausgabe');
      // Die Datei bleibt (der Dienst nimmt dann den gleichen Schlüssel aus der Umgebung)
      assert.equal(fs.readFileSync(path.join(a, 'daten', 'voice-clips.key'), 'utf8'), `${existing}\n`);
      // danach: bleibt, auch wenn die Datei inzwischen etwas anderes enthielte
      fs.writeFileSync(path.join(a, 'daten', 'voice-clips.key'), `${'cd'.repeat(32)}\n`);
      assert.deepEqual(step(a).keys, [existing]);

      fs.writeFileSync(path.join(b, 'daten', 'voice-clips.key'), 'kaputt\n');
      const broken = step(b);
      assert.equal(broken.status, 0, broken.stderr);
      assert.equal(broken.keys.length, 1);
      assert.match(broken.keys[0]!, /^[0-9a-f]{64}$/);
      assert.match(broken.stderr, /beschädigt/);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });

  test('write_config: env-Datei nur für root (0600, schon vor dem Schlüssel), Schlüssel-Schritt eingebunden', () => {
    const body = installerFunctions('write_config');
    assert.ok(body.includes('(umask 077 && cat > "$ENV_FILE"'), 'neu angelegt mit umask 077');
    assert.ok(!body.includes('chmod 644 "$ENV_FILE"'), 'keine Rechte 644 mehr');
    const restrict = body.indexOf('chmod 600 "$ENV_FILE"');
    const keyStep = body.indexOf('configure_voice_clip_key');
    assert.ok(restrict >= 0 && keyStep > restrict, 'erst Rechte 600, dann der Schlüssel');
    assert.ok(body.lastIndexOf('chmod 600 "$ENV_FILE"') > keyStep, 'am Ende wieder 600');
  });
});
