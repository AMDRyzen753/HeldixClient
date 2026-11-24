import os from 'node:os';
import type { Argument, Rule } from './types';

export const OS_NAME = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';

function archMatches(arch: string): boolean {
  if (arch === 'x86') return process.arch === 'ia32';
  if (arch === 'x86_64' || arch === 'x64') return process.arch === 'x64';
  return arch === process.arch;
}

function ruleMatches(rule: Rule, features: Record<string, boolean>): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== OS_NAME) return false;
    if (rule.os.arch && !archMatches(rule.os.arch)) return false;
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(os.release())) return false;
      } catch {
        return false;
      }
    }
  }
  if (rule.features) {
    for (const [name, expected] of Object.entries(rule.features)) {
      if ((features[name] ?? false) !== expected) return false;
    }
  }
  return true;
}

/** Wertet Mojang-Regeln aus: ohne Regeln erlaubt, sonst entscheidet die letzte passende Regel. */
export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow';
  }
  return allowed;
}

/** Wandelt eine Argumentliste aus der Versionsdatei in einfache Strings um. */
export function flattenArguments(args: Argument[] | undefined, features: Record<string, boolean>): string[] {
  const out: string[] = [];
  for (const arg of args ?? []) {
    if (typeof arg === 'string') {
      out.push(arg);
    } else if (rulesAllow(arg.rules, features)) {
      out.push(...(Array.isArray(arg.value) ? arg.value : [arg.value]));
    }
  }
  return out;
}
