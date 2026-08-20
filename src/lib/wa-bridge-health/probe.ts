/**
 * Reaching the bridge's /health endpoint from off-box, with retries.
 *
 * Why retries exist: between 2026-08-03 and 2026-08-20 this monitor sent 89
 * "bridge UNREACHABLE — ACTION NEEDED" pages, off 128 `unreachable` verdicts.
 * Every one of them was wrong. The bridge's own on-box healthcheck logged
 * `healthy` at the same minute, in every case, and `whatsapp-bridge.service`
 * ran 20 days with zero restarts and a valid session throughout.
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

import { log } from '@/lib/logger';
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

/**
 * The caller's hard budget. The velo cron invokes this endpoint with
 * `curl -s -m 30` (~/bin/wa-bridge-health-cron.sh), so at 30 s curl gives up and
 * the tick lands in the log as a probe failure instead of a verdict.
 *
 * Every knob below is env-settable, which means an operator typo can otherwise
 * push the probe past the point where its answer can still be delivered —
 * `WA_BRIDGE_PROBE_TIMEOUT_MS=600000` was accepted verbatim before this clamp.
 */
export const CALLER_BUDGET_MS = 30_000;

/** Leaves room for classification, alert dispatch and writing the response. */
const PROBE_BUDGET_MS = 25_000;

/** Bounds each knob before the budget check, so one absurd value cannot dominate. */
const LIMITS = {
  attempts: { min: 1, max: 5 },
  // The floor matters as much as the ceiling: TIMEOUT_MS=1 fails every attempt
  // instantly and swings the monitor into the alert storm this file exists to
  // stop. 500 ms is already ~1.5x the observed p99 on the velo -> VPS path.
  timeoutMs: { min: 500, max: 15_000 },
  backoffMs: { min: 0, max: 5_000 },
} as const;

function clamp(value: number, { min, max }: { min: number; max: number }): number {
  return Math.min(max, Math.max(min, value));
}

export interface ProbeConfig {
  url: string;
  attempts: number;
  timeoutMs: number;
  backoffMs: number;
}

/** Worst case if every attempt burns its full timeout. No sleep after the last. */
export function probeBudgetMs(
  config: Pick<ProbeConfig, 'attempts' | 'timeoutMs' | 'backoffMs'>,
): number {
  return config.attempts * config.timeoutMs + (config.attempts - 1) * config.backoffMs;
}

/**
 * Resolve the probe config from options, then env, then defaults — and clamp it
 * so the worst case stays inside what the caller will wait for.
 *
 * Exported so the budget guarantee can be tested against the REAL defaults. A
 * test that recomputes `3 * 5000 + 2 * 1500` from its own literals keeps passing
 * after someone changes those defaults, which makes it no guard at all.
 *
 * Attempts are shed last-first when the budget is blown: one probe that
 * completes and reports beats three that curl cuts off mid-flight.
 */
export function resolveProbeConfig(opts: ProbeOptions = {}): ProbeConfig {
  const url = opts.url ?? process.env.WA_BRIDGE_HEALTH_URL ?? DEFAULT_BRIDGE_HEALTH_URL;

  // Clamping applies to ENV ONLY. The hazard being defended against is an
  // operator typo in a env file that nothing type-checks; an explicit argument
  // is code, written deliberately, and silently returning something other than
  // what the caller asked for would be its own trap. Production passes neither
  // — the handler supplies only `onAttemptFailure` — so the budget guarantee
  // below still holds for every real invocation.
  const timeoutMs =
    opts.timeoutMs ?? clamp(envInt('WA_BRIDGE_PROBE_TIMEOUT_MS', 5000), LIMITS.timeoutMs);
  const backoffMs =
    opts.backoffMs ?? clamp(envInt('WA_BRIDGE_PROBE_BACKOFF_MS', 1500), LIMITS.backoffMs);
  let attempts = opts.attempts ?? clamp(envInt('WA_BRIDGE_PROBE_ATTEMPTS', 3), LIMITS.attempts);

  if (opts.attempts === undefined) {
    const requested = attempts;
    while (
      attempts > LIMITS.attempts.min &&
      probeBudgetMs({ attempts, timeoutMs, backoffMs }) > PROBE_BUDGET_MS
    ) {
      attempts -= 1;
    }
    // Never shed in silence: an operator who set ATTEMPTS=9 and sees 3 in the
    // cron log needs to find out here why, not by reading this function.
    if (attempts !== requested) {
      log.warn('WA bridge probe attempts reduced to fit the caller budget', {
        requested, attempts, timeoutMs, backoffMs, budgetMs: PROBE_BUDGET_MS,
      }, 'WaBridgeHealth');
    }
  }

  return { url, attempts, timeoutMs, backoffMs };
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
 * The worst-case wall time is `probeBudgetMs(config)`; `resolveProbeConfig`
 * clamps the config so that stays inside the 30 s the velo cron's `curl -m 30`
 * allows, whatever the env vars say.
 */
export async function probeBridgeHealth(opts: ProbeOptions = {}): Promise<ProbeResult> {
  const { url, attempts, timeoutMs, backoffMs } = resolveProbeConfig(opts);
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
