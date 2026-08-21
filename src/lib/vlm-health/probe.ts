/**
 * Reaching the on-box vLLM server's /v1/models, and telling a real outage
 * apart from a legitimate restart still loading its model.
 *
 * This runs on velo, the same box as vLLM, so — unlike the WhatsApp bridge
 * probe (src/lib/wa-bridge-health) — there is no WAN flakiness to defend
 * against. What DOES need defending against is the model-load window: a
 * restart (nightly at 03:00, or a manual fix) takes ~1-3 minutes normally but
 * has taken over 13 minutes at least once (see STARTUP_GRACE_MS below). A gate
 * that alerts on the first failed tick would page on every routine restart.
 *
 * @module lib/vlm-health/probe
 */

import { execFileSync } from 'child_process';
import { log } from '@/lib/logger';

export const DEFAULT_VLM_MODELS_URL = 'http://localhost:8100/v1/models';

/** Caller's fetch timeout for one attempt. Generous: this is localhost. */
const PROBE_TIMEOUT_MS = 8_000;

const SERVICE_NAME = 'vllm-qwen.service';

/**
 * Grace window after a (re)start before an unanswered probe counts as a real
 * outage. Matches STARTUP_GRACE in `/home/velo/scripts/vllm/health-check.sh`,
 * tuned there after a model load exceeded 13 minutes on 2026-06-11 and a
 * shorter grace caused that script to kill-loop the service. Keeping the same
 * value means this monitor and the self-healing script agree on what counts
 * as "still starting".
 */
export const STARTUP_GRACE_MS = 25 * 60 * 1000;

export interface VlmProbeOptions {
  url?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injectable for tests; returns service uptime in ms, or null if unknown. */
  serviceUptimeMs?: () => number | null;
}

export interface VlmProbeResult {
  /** The first model id, or null when unreachable / no model listed. */
  modelId: string | null;
  /**
   * True when the probe failed but the service is still inside its startup
   * grace window — callers should not treat this as an outage.
   */
  withinStartupGrace: boolean;
  /** Reason the probe failed, for logging. Null on success. */
  failureReason: string | null;
}

interface ModelsResponse {
  data?: Array<{ id?: string }>;
}

/** Real uptime lookup via systemd. Read-only `systemctl show`, no sudo needed. */
function defaultServiceUptimeMs(): number | null {
  try {
    const value = execFileSync(
      'systemctl',
      ['show', SERVICE_NAME, '--property=ActiveEnterTimestamp', '--value'],
      { timeout: 2000, encoding: 'utf8' },
    ).trim();
    if (!value || value === 'n/a') return null;
    const enteredAt = new Date(value).getTime();
    if (Number.isNaN(enteredAt)) return null;
    return Date.now() - enteredAt;
  } catch (err) {
    log.warn('vLLM probe could not read service uptime', {
      reason: err instanceof Error ? err.message : String(err),
    }, 'VlmHealth');
    return null;
  }
}

async function fetchModelId(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as ModelsResponse;
    const modelId = body?.data?.[0]?.id;
    if (!modelId) throw new Error('response listed no model');
    return modelId;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe vLLM once. Not retried — this is localhost, so a failure here is a
 * real symptom, not a stalled network hop. The startup-grace check is what
 * absorbs the routine "just restarted" case instead.
 */
export async function probeVlmHealth(opts: VlmProbeOptions = {}): Promise<VlmProbeResult> {
  const url = opts.url ?? DEFAULT_VLM_MODELS_URL;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const uptimeMs = (opts.serviceUptimeMs ?? defaultServiceUptimeMs)();

  try {
    const modelId = await fetchModelId(url, timeoutMs, fetchImpl);
    return { modelId, withinStartupGrace: false, failureReason: null };
  } catch (err) {
    const failureReason = err instanceof Error ? err.message : String(err);
    const withinStartupGrace = uptimeMs !== null && uptimeMs < STARTUP_GRACE_MS;
    return { modelId: null, withinStartupGrace, failureReason };
  }
}
