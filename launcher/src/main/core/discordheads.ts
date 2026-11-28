// Eigener Minecraft-Kopf als kleines Bild im Discord-Status: GET /v1/public/heads/<uuid>.png?size=64 vom Heldix-Dienst
// (ab 1.12.0, öffentlich – Discord lädt das Bild selbst). Ältere Dienste kennen die Route nicht; darum prüft der
// Launcher einmal, ob das Bild kommt, und nimmt sonst das Loader-Symbol (presence.ts). Nur https-Adressen, die Discord
// auch laden kann; Ergebnis 6 Stunden gemerkt, Fehler 30 Minuten.

export const HEAD_SIZE = 64;
const OK_MS = 6 * 60 * 60_000;
const FAIL_MS = 30 * 60_000;

/** Link zum Kopf (nur https, UUID ohne Bindestriche), sonst null */
export function publicHeadUrl(serviceUrl: string, rawUuid: string): string | null {
  const base = serviceUrl.trim().replace(/\/+$/, '');
  const uuid = rawUuid.replace(/-/g, '').toLowerCase();
  if (!/^https:\/\/[^\s/]+[^\s]*$/i.test(base) || !/^[0-9a-f]{32}$/.test(uuid)) return null;
  return `${base}/v1/public/heads/${uuid}.png?size=${HEAD_SIZE}`;
}

export class PublicHeads {
  private readonly known = new Map<string, { ok: boolean; until: number }>();
  private readonly probes = new Set<string>();

  constructor(
    private readonly serviceUrl: string,
    /** Ergebnis einer Prüfung ist da (Status neu setzen) */
    private readonly onChange: () => void = () => undefined,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Link zum Kopf, wenn der Dienst ihn liefert; unbekannt = null und Prüfung im Hintergrund */
  url(uuid: string): string | null {
    const url = publicHeadUrl(this.serviceUrl, uuid);
    if (!url) return null;
    const hit = this.known.get(url);
    if (hit && hit.until > this.now()) return hit.ok ? url : null;
    if (!this.probes.has(url)) {
      this.probes.add(url);
      void this.probe(url).finally(() => this.probes.delete(url));
    }
    return hit?.ok ? url : null;
  }

  private async probe(url: string): Promise<void> {
    let ok = false;
    try {
      const response = await this.fetchImpl(url, { headers: { accept: 'image/png' }, signal: AbortSignal.timeout(8000), redirect: 'error' });
      ok = response.ok && (response.headers.get('content-type') ?? '').toLowerCase().startsWith('image/png');
      await response.body?.cancel().catch(() => undefined);
    } catch {
      ok = false;
    }
    const before = this.known.get(url)?.ok;
    this.known.set(url, { ok, until: this.now() + (ok ? OK_MS : FAIL_MS) });
    if (before !== ok) this.onChange();
  }
}
