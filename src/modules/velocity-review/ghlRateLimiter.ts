const DEFAULT_RATE_LIMIT_MAX = 20;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 10_000;

// Bounds for values adopted from live response headers. The header is first-party
// and normally sane, but a misconfigured edge proxy sending an absurd ceiling would
// silently defang the limiter, and a tiny window would make it permit a burst. Clamp
// rather than trust, so a bad header degrades to "slightly wrong" instead of "off".
const MIN_ADOPTED_MAX = 1;
const MAX_ADOPTED_MAX = 1_000;
const MIN_ADOPTED_WINDOW_MS = 1_000;
const MAX_ADOPTED_WINDOW_MS = 600_000;

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function positiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Sliding-window limiter shared by every request from one client instance.
 *
 * Acquisition is serialised through a promise chain so that concurrent exports queue
 * for tokens instead of all observing "window has space" at the same instant.
 */
export class GhlRateLimiter {
  private hits: number[] = [];
  private chain: Promise<void> = Promise.resolve();
  private blockedUntil = 0;

  constructor(
    private max: number = DEFAULT_RATE_LIMIT_MAX,
    private windowMs: number = DEFAULT_RATE_LIMIT_WINDOW_MS,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = defaultSleep,
  ) {}

  /** Re-read the authoritative ceiling from a live response. */
  observeLimits(headers: Pick<Headers, 'get'>): void {
    const max = positiveInt(headers.get('x-ratelimit-max'));
    const windowMs = positiveInt(headers.get('x-ratelimit-interval-milliseconds'));
    // Stay a token under the advertised ceiling: the window is server-side and its
    // boundary does not line up with ours, so spending the last token invites a 429.
    if (max !== null) this.max = clamp(max - 1, MIN_ADOPTED_MAX, MAX_ADOPTED_MAX);
    if (windowMs !== null) {
      this.windowMs = clamp(windowMs, MIN_ADOPTED_WINDOW_MS, MAX_ADOPTED_WINDOW_MS);
    }
  }

  /**
   * Hold EVERY caller off until `until`, after a 429.
   *
   * An earlier revision cleared the recorded hits instead. That was backwards: the
   * limiter is shared by all concurrent exports, so wiping the window let the other
   * workers see free capacity and burst at the exact moment the server had said it
   * was overloaded — the same concurrent-burst shape that caused the incident this
   * limiter exists to prevent. A 429 means the window is FULL, not empty.
   */
  penaliseFor(ms: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms);
  }

  async acquire(): Promise<void> {
    const next = this.chain.then(() => this.reserve());
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async reserve(): Promise<void> {
    for (;;) {
      const at = this.now();
      if (at < this.blockedUntil) {
        await this.sleep(this.blockedUntil - at);
        // Drop the penalty if the clock did not move. Re-checking against a clock that
        // cannot satisfy the condition spins forever and hangs the worker — reachable
        // with a frozen test clock, and in production with an NTP step backwards. The
        // requested interval has already been slept, so the penalty is spent either way.
        if (this.now() <= at) this.blockedUntil = 0;
        continue;
      }
      this.hits = this.hits.filter((hit) => at - hit < this.windowMs);
      if (this.hits.length < this.max) {
        this.hits.push(at);
        return;
      }
      const oldest = this.hits[0] ?? at;
      await this.sleep(Math.max(1, this.windowMs - (at - oldest) + 1));
    }
  }
}
