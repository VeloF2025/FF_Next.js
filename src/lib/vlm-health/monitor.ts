/**
 * Health classification and alert rendering for the on-box vLLM (Qwen3-VL)
 * server that backs license-plate / VLM verification in the field apps.
 *
 * Why this exists: on 2026-08-20 09:26 SAST the host's kernel auto-updated to
 * 6.8.0-138 on reboot, but the matching NVIDIA kernel module package never
 * installed. The GPU had no driver bound, `vllm-qwen.service` crash-looped
 * every ~90s for the next 23 hours (1,705 restart attempts logged in
 * /var/log/vllm-maintenance.log), and nobody was told — the existing
 * `/home/velo/scripts/vllm/health-check.sh` self-heals by restarting the
 * service on every failure but only logs to a file nobody watches. The first
 * anyone heard of it was a field worker's WhatsApp message: "Verification
 * Failed: VLM API call failed: fetch failed".
 *
 * @module lib/vlm-health/monitor
 */

export type VlmVerdict = 'healthy' | 'unreachable';

export interface VlmStatus {
  verdict: VlmVerdict;
  /** Human-readable reason, used in the alert body. */
  detail: string;
  modelId: string | null;
}

/** Verdicts that warrant waking someone up. */
export function isAlerting(verdict: VlmVerdict): boolean {
  return verdict === 'unreachable';
}

/**
 * Classify a probe result.
 *
 * `modelId` is null when the probe could not reach `/v1/models` at all, or the
 * response listed no model — both mean field VLM verification is failing right
 * now, whatever the underlying cause (GPU driver, OOM, crash loop, cache
 * assertion).
 */
export function classifyVlmHealth(modelId: string | null): VlmStatus {
  if (!modelId) {
    return {
      verdict: 'unreachable',
      detail:
        'The vLLM /v1/models endpoint on localhost:8100 did not answer, or ' +
        'returned no model. Field VLM verification (license-plate scans, photo ' +
        'QA scoring) is failing right now.',
      modelId: null,
    };
  }
  return { verdict: 'healthy', detail: `Serving ${modelId}.`, modelId };
}

/** Strip CR/LF so a value can never inject extra mail headers. */
export function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n\0]+/g, ' ').trim();
}

const REMEDY = [
  'Check what the self-healing script and systemd think is going on:',
  '',
  '  tail -30 /var/log/vllm-maintenance.log',
  '  systemctl status vllm-qwen.service',
  '  sudo journalctl -u vllm-qwen.service -n 100 --no-pager',
  '',
  'If the traceback says "Failed to infer device type" or nvidia-smi cannot',
  "communicate with the driver, this is the 2026-08-20 kernel/NVIDIA-module",
  'mismatch recurring — a kernel upgrade landed without its matching',
  '`linux-modules-nvidia-580-open-<kernel>-generic` package:',
  '',
  '  uname -r',
  "  apt-cache policy linux-modules-nvidia-580-open-$(uname -r)",
  '  sudo apt install -y linux-modules-nvidia-580-open-$(uname -r)',
  '  sudo modprobe nvidia && nvidia-smi',
  '  sudo systemctl restart vllm-qwen.service',
  '',
  'Otherwise this is a plain crash loop or hang — the self-healing script',
  '(`/home/velo/scripts/vllm/health-check.sh`, every 5 min) has already been',
  'restarting it and failing; a manual restart with the traceback in hand is',
  'the next step.',
].join('\n');

/**
 * Render the alert for a status, or null when there is nothing to say.
 *
 * `recovered` renders the all-clear instead, so whoever got paged learns the
 * outage ended without having to go and check.
 */
export function buildVlmAlert(
  status: VlmStatus,
  opts: { recovered?: boolean; downtimeMs?: number } = {},
): { subject: string; text: string } | null {
  if (opts.recovered) {
    const forMins = opts.downtimeMs ? ` after ${Math.round(opts.downtimeMs / 60000)} min` : '';
    return {
      subject: `[FibreFlow] VLM service RECOVERED${forMins}`,
      text: [
        `vLLM (${status.modelId ?? 'model unknown'}) is answering again${forMins}.`,
        '',
        'No action needed.',
        '',
        '— Jarvis 🤖',
      ].join('\n'),
    };
  }

  if (status.verdict === 'healthy') return null;

  return {
    subject: '[FibreFlow] VLM service UNREACHABLE — ACTION NEEDED',
    text: [
      'The vLLM server backing field VLM verification is not answering.',
      '',
      status.detail,
      '',
      REMEDY,
      '',
      '— Jarvis 🤖',
    ].join('\n'),
  };
}
