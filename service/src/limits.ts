// Begrenzung der Anfragen (fester Zeitraum pro Schlüssel, z. B. IP oder Token-Hash).

export interface RateResult {
  ok: boolean;
  /** Sekunden bis zum nächsten Zeitraum (für den Retry-After-Header). */
  retryAfter: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Höchstens so viele Schlüssel merken; darüber wird aufgeräumt. */
const MAX_KEYS = 100_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Zählt eine Anfrage für `key`. `ok` ist false, wenn die Grenze überschritten ist. */
  take(key: string, now = Date.now()): RateResult {
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (!bucket && this.buckets.size >= MAX_KEYS) this.sweep(now);
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count++;
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return { ok: bucket.count <= this.limit, retryAfter };
  }

  /** Entfernt abgelaufene Zeiträume. */
  sweep(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    // Notbremse, falls trotzdem zu viele Schlüssel übrig sind: die ältesten verwerfen.
    if (this.buckets.size >= MAX_KEYS) {
      let excess = this.buckets.size - MAX_KEYS / 2;
      for (const key of this.buckets.keys()) {
        if (excess-- <= 0) break;
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * Höchstens `max` Dinge gleichzeitig (z. B. Uploads oder das Prüfen von JARs). `tryAcquire` sagt sofort nein,
 * `acquire` wartet auf einen freien Platz. Beide liefern eine Funktion zum Freigeben (einmal aufrufen).
 */
export class Slots {
  private used = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly max: number) {}

  tryAcquire(): (() => void) | null {
    if (this.used >= this.max) return null;
    this.used++;
    return this.releaser();
  }

  async acquire(): Promise<() => void> {
    const release = this.tryAcquire();
    if (release) return release;
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    // Der Platz wurde beim Freigeben direkt weitergegeben.
    return this.releaser();
  }

  private releaser(): () => void {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.used--;
    };
  }
}
