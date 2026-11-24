import type { LogLevel, LogLine } from '../../shared/api';

const EVENT_START = '<log4j:Event';
const EVENT_END = '</log4j:Event>';
const LEVELS = new Set<LogLevel>(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']);

function attr(xml: string, name: string): string | undefined {
  return new RegExp(`${name}="([^"]*)"`).exec(xml)?.[1];
}

function section(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<log4j:${tag}>([\\s\\S]*?)</log4j:${tag}>`).exec(xml);
  return match?.[1].replace(/<!\[CDATA\[|\]\]>/g, '');
}

function time(timestamp: string | undefined): string {
  const date = timestamp ? new Date(Number(timestamp)) : new Date();
  return date.toTimeString().slice(0, 8);
}

/**
 * Minecraft schreibt mit der offiziellen Log-Konfiguration XML-Ereignisse nach stdout.
 * Dieser Parser macht daraus lesbare Zeilen und lässt normalen Text unverändert durch.
 */
export class GameLogParser {
  private buffer = '';

  constructor(private readonly fallbackLevel: LogLevel = 'INFO') {}

  push(chunk: string): LogLine[] {
    this.buffer += chunk;
    const out: LogLine[] = [];
    for (;;) {
      const start = this.buffer.indexOf(EVENT_START);
      if (start === -1) {
        const lastNewline = this.buffer.lastIndexOf('\n');
        if (lastNewline !== -1) {
          this.plain(this.buffer.slice(0, lastNewline), out);
          this.buffer = this.buffer.slice(lastNewline + 1);
        }
        break;
      }
      if (start > 0) {
        this.plain(this.buffer.slice(0, start), out);
        this.buffer = this.buffer.slice(start);
        continue;
      }
      const end = this.buffer.indexOf(EVENT_END);
      if (end === -1) break;
      const xml = this.buffer.slice(0, end + EVENT_END.length);
      this.buffer = this.buffer.slice(xml.length);
      this.event(xml, out);
    }
    if (this.buffer.length > 2_000_000) out.push(...this.flush());
    return out;
  }

  flush(): LogLine[] {
    const out: LogLine[] = [];
    this.plain(this.buffer, out);
    this.buffer = '';
    return out;
  }

  private plain(text: string, out: LogLine[]): void {
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) out.push({ level: this.fallbackLevel, text: line });
    }
  }

  private event(xml: string, out: LogLine[]): void {
    const rawLevel = (attr(xml, 'level') ?? 'INFO').toUpperCase() as LogLevel;
    const level = LEVELS.has(rawLevel) ? rawLevel : 'INFO';
    const thread = attr(xml, 'thread') ?? 'main';
    const message = section(xml, 'Message') ?? '';
    out.push({ level, text: `[${time(attr(xml, 'timestamp'))}] [${thread}/${level}]: ${message.trimEnd()}` });
    const throwable = section(xml, 'Throwable');
    if (throwable) {
      for (const line of throwable.trimEnd().split(/\r?\n/)) out.push({ level, text: line });
    }
  }
}
