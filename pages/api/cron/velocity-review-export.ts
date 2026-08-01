import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { createLogger } from '@/lib/logger';
import {
  runVelocityReviewExport,
  type VelocityReviewRunInput,
  type VelocityReviewRunResult,
} from '@/modules/velocity-review';
import type { RunSummaryCounts } from '@/modules/velocity-review/types';

const logger = createLogger('velocity-review:cron');
const COUNT_KEYS = [
  'candidate_total', 'ready', 'duplicates', 'quarantined', 'completed', 'permanent_failure',
  'retryable', 'ambiguous', 'ack_cleanup_pending', 'pilot_deferred',
] as const;

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeCounts(counts: RunSummaryCounts): RunSummaryCounts {
  return Object.fromEntries(COUNT_KEYS.flatMap((key) =>
    typeof counts[key] === 'number' ? [[key, counts[key]]] : []));
}

function aggregateResult(result: VelocityReviewRunResult) {
  const counts = safeCounts(result.counts);
  const dates = result.dates.map((item) => ({
    targetDate: item.targetDate,
    status: item.status,
    counts: safeCounts(item.counts),
  }));
  return {
    status: result.status,
    counts,
    dates,
    workflowAcknowledged: counts.completed ?? 0,
    ...(result.reason === 'invalid_control' || result.reason === 'gap_older_than_7_days'
      ? { reason: result.reason } : {}),
  };
}

function parseInput(body: unknown): VelocityReviewRunInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'dryRun' && key !== 'targetDate')) return null;
  if ('dryRun' in value && value.dryRun !== true) return null;
  if ('targetDate' in value && (value.dryRun !== true || !validDate(value.targetDate))) return null;
  return value.dryRun === true
    ? { dryRun: true, ...('targetDate' in value ? { targetDate: value.targetDate as string } : {}) }
    : {};
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error('Velocity review cron is not configured', { status: 'misconfigured' });
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Velocity review export unavailable');
  }
  if (req.headers['x-cron-secret'] !== secret) {
    logger.warn('Velocity review cron authentication failed', { status: 'unauthorized' });
    return apiResponse.unauthorized(res, 'Invalid or missing x-cron-secret header');
  }
  const input = parseInput(req.body ?? {});
  if (!input) return apiResponse.badRequest(res, 'Invalid Velocity review export request');

  logger.info('Velocity review export started', {
    status: input.dryRun ? 'dry_run' : 'live',
    ...(input.targetDate ? { targetDate: input.targetDate } : {}),
  });
  try {
    const output = aggregateResult(await runVelocityReviewExport(input));
    logger.info('Velocity review export finished', output);
    return apiResponse.success(res, output);
  } catch {
    logger.error('Velocity review export failed', { status: 'failed' });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Velocity review export failed');
  }
}
