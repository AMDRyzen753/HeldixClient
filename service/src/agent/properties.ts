// server.properties lesen und schreiben (Format von java.util.Properties). Der Wächter schreibt die Datei vor jedem
// Start neu: bestehende Schlüssel des Servers bleiben, die erlaubte Auswahl des Besitzers kommt aus world.json, und
// einige Schlüssel setzt er immer selbst (MANAGED_PROPERTIES), damit niemand sie über die Datei ändert.

/** Fest vorgegeben; der Besitzer kann sie nicht ändern. */
export const MANAGED_PROPERTIES: Readonly<Record<string, string>> = {
  'server-port': '25565',
  'server-ip': '',
  'online-mode': 'true',
  'enable-status': 'true',
  'enable-rcon': 'false',
  'rcon.password': '',
  'enable-query': 'false',
  'enable-jmx-monitoring': 'false',
  'management-server-enabled': 'false',
  'level-name': 'world',
  // Der Server sieht ohnehin nur die Adresse der Docker-Brücke; so stehen nicht einmal die im Log
  'log-ips': 'false',
};

const KEY_RE = /^[A-Za-z0-9._-]{1,64}$/;

function unescape(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c !== '\\' || i + 1 >= text.length) {
      out += c;
      continue;
    }
    const n = text[++i]!;
    if (n === 't') out += '\t';
    else if (n === 'n') out += '\n';
    else if (n === 'r') out += '\r';
    else if (n === 'f') out += '\f';
    else if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) {
      out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
      i += 4;
    } else out += n;
  }
  return out;
}

/** Liest key=value-Zeilen; Fortsetzungszeilen, Kommentare und Escapes wie java.util.Properties. */
export function parseProperties(text: string): Map<string, string> {
  const result = new Map<string, string>();
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const logical: string[] = [];
  let current: string | null = null;
  for (const line of raw) {
    const piece: string = current === null ? line : line.replace(/^[ \t\f]+/, '');
    if (current === null && /^[ \t\f]*[#!]/.test(piece)) continue;
    const trailing = /\\+$/.exec(piece)?.[0].length ?? 0;
    if (trailing % 2 === 1) {
      current = (current ?? '') + piece.slice(0, -1);
      continue;
    }
    logical.push((current ?? '') + piece);
    current = null;
  }
  if (current !== null) logical.push(current);
  for (const line of logical) {
    const trimmed = line.replace(/^[ \t\f]+/, '');
    if (trimmed === '') continue;
    let i = 0;
    let key = '';
    while (i < trimmed.length) {
      const c = trimmed[i]!;
      if (c === '\\' && i + 1 < trimmed.length) {
        key += c + trimmed[i + 1];
        i += 2;
        continue;
      }
      if (c === '=' || c === ':' || c === ' ' || c === '\t' || c === '\f') break;
      key += c;
      i++;
    }
    let rest = trimmed.slice(i).replace(/^[ \t\f]*/, '');
    if (rest.startsWith('=') || rest.startsWith(':')) rest = rest.slice(1).replace(/^[ \t\f]*/, '');
    const name = unescape(key);
    if (KEY_RE.test(name)) result.set(name, unescape(rest));
  }
  return result;
}

function escape(value: string, isKey: boolean): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    const code = c.charCodeAt(0);
    if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (c === '\f') out += '\\f';
    else if (c === '=' || c === ':' || c === '#' || c === '!') out += `\\${c}`;
    else if (c === ' ' && (isKey || i === 0)) out += '\\ ';
    else if (code < 0x20 || code > 0x7e) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += c;
  }
  return out;
}

export function formatProperties(values: Map<string, string>): string {
  const lines = [
    '#Minecraft server properties',
    '# Verwaltet vom Heldix-Welten-Wächter: motd, Ports, online-mode, rcon/query und level-name setzt er bei jedem Start.',
  ];
  for (const key of [...values.keys()].sort()) lines.push(`${escape(key, true)}=${escape(values.get(key)!, false)}`);
  return `${lines.join('\n')}\n`;
}

/**
 * bukkit.yml mit `settings.connection-throttle: -1`: Alle Spieler kommen über das Relay von derselben Adresse (im
 * Container die Docker-Brücke, die Bukkit nicht wie 127.0.0.1 ausnimmt) – mit der Drossel würden Logins innerhalb von
 * 4 s abgewiesen. Ändert nur diesen einen Wert (bzw. legt ihn an), der Rest der Datei bleibt, wie er ist.
 */
export function disableConnectionThrottle(text: string | null): string {
  const block = 'settings:\n  connection-throttle: -1\n';
  if (text === null || text.trim() === '') return block;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => /^settings:[ \t]*(#.*)?$/.test(line));
  if (start === -1) return `${text.replace(/\r\n?/g, '\n').replace(/\n*$/, '\n')}${block}`;
  // Ende des Blocks: nächste nicht eingerückte Zeile (Leer- und Kommentarzeilen zählen nicht)
  let end = start + 1;
  let indent: string | null = null;
  for (; end < lines.length; end++) {
    const line = lines[end]!;
    if (line.trim() === '' || /^[ \t]*#/.test(line)) continue;
    if (!/^[ \t]/.test(line)) break;
    indent ??= /^[ \t]+/.exec(line)![0];
  }
  const childIndent = indent ?? '  ';
  for (let i = start + 1; i < end; i++) {
    if (lines[i]!.startsWith(`${childIndent}connection-throttle:`)) {
      lines[i] = `${childIndent}connection-throttle: -1`;
      return lines.join('\n');
    }
  }
  lines.splice(start + 1, 0, `${childIndent}connection-throttle: -1`);
  return lines.join('\n');
}

/** Neue server.properties: bestehend + Auswahl des Besitzers + motd + feste Schlüssel. */
export function mergeProperties(existing: Map<string, string>, owner: Record<string, string>, motd: string): Map<string, string> {
  const result = new Map(existing);
  for (const [key, value] of Object.entries(owner)) result.set(key, value);
  result.set('motd', motd);
  for (const [key, value] of Object.entries(MANAGED_PROPERTIES)) result.set(key, value);
  return result;
}
