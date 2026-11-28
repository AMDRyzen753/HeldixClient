// Partner-Server (Heldix-Dienst 1.14.0, Server-Partner-Programm): GET /v1/public/partners (öffentlich, nur aktive
// Partner, beim Dienst 5 Minuten zwischengespeichert). Der Launcher zeigt sie unter „Beliebte Welten“ mit dem Abzeichen
// „Partner“ und „Beitreten“ (Schnellstart auf den Server, main.ts joinServerAddress).
//
// - Liste im Speicher (1 Stunde, wie im Spiel); hervorgehobene (featured) zuerst, sonst nach Name.
// - Adressen werden wie Einladungs-Server geprüft (öffentliche Domain, Port nur, wenn nicht 25565; core/invites.ts
//   inviteServer, wie normalizeServer im Dienst). Ein Partner ohne gültige Adresse fällt weg.
// - partnerFor: Passt eine Adresse zu einem Partner? Eine Domain deckt ihre Subdomains ab (example.net passt zu
//   play.example.net); ein Eintrag mit Port passt nur mit genau diesem Port.
// - Dienst ohne Partner (404): Bereich aus, 30 Minuten Ruhe.

import type { PartnerServer, PartnerServers } from '../../shared/api';
import { SERVICE_UNREACHABLE, ServiceError, serviceBase, serviceRequest } from './heldixservice';
import { inviteServer } from './invites';

export const PARTNERS_FRESH_MS = 60 * 60_000;
const UNSUPPORTED_MS = 30 * 60_000;
const PARTNER_ID_RE = /^[a-z0-9-]{3,32}$/;
const MAX_SERVERS = 10;

function line(raw: unknown, max: number): string {
  const text = (typeof raw === 'string' ? raw : '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('').trim() : text;
}

/** Eintrag aus GET /v1/public/partners → partners; ungültig: null */
export function mapPartner(raw: unknown): PartnerServer | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' && PARTNER_ID_RE.test(r.id) ? r.id : null;
  const name = line(r.name, 40);
  if (!id || !name) return null;
  const servers = [...new Set((Array.isArray(r.servers) ? r.servers : []).map((s) => inviteServer(s)).filter((s): s is string => s !== null))].slice(0, MAX_SERVERS);
  if (servers.length === 0) return null;
  const website = typeof r.website === 'string' && r.website.length <= 300 && /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(r.website) ? r.website : null;
  return { id, name, description: line(r.description, 300), website, servers, featured: r.featured === true, address: servers[0] };
}

/** Liste aus der Antwort: gültige Partner, hervorgehobene zuerst, sonst nach Name */
export function mapPartners(raw: unknown): PartnerServer[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { partners?: unknown }).partners) ? (raw as { partners: unknown[] }).partners : [];
  const seen = new Set<string>();
  return list
    .map(mapPartner)
    .filter((p): p is PartnerServer => p !== null && !seen.has(p.id) && !!seen.add(p.id))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, 'de'));
}

function hostAndPort(address: string): { host: string; port: number | null } {
  const match = /^(.+):(\d{1,5})$/.exec(address);
  return match ? { host: match[1], port: Number(match[2]) } : { host: address, port: null };
}

/** Partner, zu dem diese Server-Adresse gehört (Domain deckt Subdomains ab), sonst null */
export function partnerFor(address: unknown, partners: readonly PartnerServer[]): PartnerServer | null {
  const normal = inviteServer(address);
  if (!normal) return null;
  const target = hostAndPort(normal);
  for (const partner of partners) {
    for (const server of partner.servers) {
      const entry = hostAndPort(server);
      if (entry.port !== null && entry.port !== target.port) continue;
      if (target.host === entry.host || target.host.endsWith(`.${entry.host}`)) return partner;
    }
  }
  return null;
}

export interface PartnerOptions {
  serviceUrl: string;
  onUpdate?(partners: PartnerServers): void;
}

export class PartnerClient {
  private readonly base: string;
  private current: PartnerServers = { status: 'off', error: null, partners: [] };
  private loadedAt = 0;
  private unsupportedUntil = 0;
  private running: Promise<PartnerServers> | null = null;
  private lastSent = '';

  constructor(private readonly options: PartnerOptions) {
    this.base = serviceBase(options.serviceUrl ?? '');
  }

  get partners(): PartnerServers {
    return this.current;
  }

  /** Partner-Liste; fresh = am Speicher vorbei */
  list(fresh = false): Promise<PartnerServers> {
    if (!fresh && this.current.status === 'ok' && Date.now() - this.loadedAt < PARTNERS_FRESH_MS) return Promise.resolve(this.current);
    this.running ??= this.load().finally(() => (this.running = null));
    return this.running;
  }

  private publish(next: PartnerServers): PartnerServers {
    this.current = next;
    const json = JSON.stringify(next);
    if (json !== this.lastSent) {
      this.lastSent = json;
      this.options.onUpdate?.(next);
    }
    return next;
  }

  private async load(): Promise<PartnerServers> {
    if (!this.base) return this.publish({ status: 'off', error: null, partners: [] });
    if (Date.now() < this.unsupportedUntil) return this.publish({ status: 'unsupported', error: null, partners: [] });
    let raw: unknown;
    try {
      raw = await serviceRequest<unknown>(this.base, '/v1/public/partners', { timeoutMs: 10_000 });
    } catch (error) {
      if (error instanceof ServiceError && (error.status === 404 || (error.status === 503 && error.message !== SERVICE_UNREACHABLE))) {
        this.unsupportedUntil = Date.now() + UNSUPPORTED_MS;
        return this.publish({ status: 'unsupported', error: null, partners: [] });
      }
      // letzter Stand bleibt sichtbar, mit Fehler
      return this.publish({ status: this.current.partners.length ? this.current.status : 'error', error: error instanceof Error ? error.message : String(error), partners: this.current.partners });
    }
    this.loadedAt = Date.now();
    return this.publish({ status: 'ok', error: null, partners: mapPartners(raw) });
  }
}
