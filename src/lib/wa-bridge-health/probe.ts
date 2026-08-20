/**
 * Reaching the bridge's /health endpoint from off-box, with retries.
 *
 * Why retries exist: between 2026-08-03 and 2026-08-20 this monitor fired 124
 * "bridge UNREACHABLE — ACTION NEEDED" pages. Every one of them was wrong. The
 * bridge's own on-box healthcheck logged `healthy` at the same minute, in every
 * case, and `whatsapp-bridge.service` ran 20 days with zero restarts and a
 * valid session throughout.
 *
 * The cause was a single-shot 8-second fetch across the public internet from
 * velo to the Hostinger VPS. Median round trip on that path is ~320 ms, so an
 * 8-second budget is not marginal — it only expires when the path stalls
 * outright. One stalled window was enough to page someone and tell them field
 * submissions were being lost. Over half the false pages landed between 10:00
 * and 11:00 SAST, the peak field-photo hour, which is congestion on the path
 * rather than anything wrong with the bridge.
 *
 * So: try more than once before calling the box dead. A logout is still
 * detected on the first attempt, because a logged-out bridge ANSWERS — it
 * serves a payload saying it needs pairing. Retries only affect the case where
 * we got no answer at all, which is exactly the case that was lying.
 *
 * Everything is injectable so the retry policy can be tested without real
 * sleeps, and tunable by env so a bad week on the path does not need a deploy.
 *
 * @module lib/wa-bridge-health/probe
 */

import type { BridgeHealthPayload } from './monitor';

/** Read a positive integer from env, falling back when unset or malformed. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  // NaN and negatives fall back rather than disabling the probe outright: a
  // typo in an env var must not silently turn the monitor off.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export const DEFAULT_BRIDGE_HEALTH_URL = 'http://72.61.197.178:8083/health';

export interface ProbeOptions {
  url?: string;
  /** Total attempts, not retries after the first. */
  attempts?: number;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Pause between attempts. */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onAttemptFailure?: (info: { attempt: number; reason: string }) => void;
}

export interface ProbeResult {
  /** Null when no attempt got a usable answer — the caller classifies that. */
  payload: BridgeHealthPayload | null;
  /** How many attempts were made, for the cron log. */
  attempts: number;
  /** Why the last attempt failed, or null on success. */
  lastFailure: string | null;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * One attempt. Resolves to a payload, or throws with a reason worth logging.
 *
 * "Timed out" vs "connection refused" vs "HTTP 502" is the difference between a
 * stalled route, a stopped service and a broken nginx in front of it, and it is
 * the first thing anyone diagnosing will want.
 */
async function attemptProbe(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<BridgeHealthPayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      // A bare string or array would cast happily and then read as every field
      // undefined, which classifies as logged_out — a false page in the other
      // direction.
      throw new Error(`unexpected payload shape: ${Array.isArray(body) ? 'array' : typeof body}`);
    }
    return body as BridgeHealthPayload;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the bridge, retrying transient failures.
 *
 * Retries cover HTTP errors as well as network errors on purpose: a 502 from
 * the nginx in front of the bridge is the same class of transient blip as a
 * dropped packet, and the previous code collapsed both into an immediate page.
 *
 * The worst-case wall time is `attempts * timeoutMs + (attempts - 1) *
 * backoffMs`. With the defaults that is 18 s, which must stay comfortably
 * inside the caller's own budget — the velo cron gives the endpoint 30 s.
 */
export async function probeBridgeHealth(opts: ProbeOptions = {}): Promise<ProbeResult> {
  const url = opts.url ?? process.env.WA_BRIDGE_HEALTH_URL ?? DEFAULT_BRIDGE_HEALTH_URL;
  const attempts = Math.max(1, opts.attempts ?? envInt('WA_BRIDGE_PROBE_ATTEMPTS', 3));
  const timeoutMs = opts.timeoutMs ?? envInt('WA_BRIDGE_PROBE_TIMEOUT_MS', 5000);
  const backoffMs = opts.backoffMs ?? envInt('WA_BRIDGE_PROBE_BACKOFF_MS', 1500);
  const fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const sleep = opts.sleep ?? defaultSleep;

  let lastFailure: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const payload = await attemptProbe(url, timeoutMs, fetchImpl);
      return { payload, attempts: attempt, lastFailure: null };
    } catch (err) {
      lastFailure = err instanceof Error ? err.message : String(err);
      opts.onAttemptFailure?.({ attempt, reason: lastFailure });
      // No sleep after the final attempt — it would just delay the verdict.
      if (attempt < attempts && backoffMs > 0) await sleep(backoffMs);
    }
  }

  return { payload: null, attempts, lastFailure };
}
