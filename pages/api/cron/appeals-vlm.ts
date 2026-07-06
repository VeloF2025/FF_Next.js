import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import { evaluateAppeal, type AppealInput } from '@/modules/sitecam/services/appealsVlmService';
import {
  findPendingAppeals,
  recordEvaluation,
  recordTransientFailure,
  type PendingAppeal,
} from '@/modules/sitecam/services/appealsVlmStore';

const MODULE = 'AppealsVlmCron';
const BATCH_LIMIT = 10;
// A transient VLM outage retries until this cap, then findPendingAppeals parks the row.
const MAX_ATTEMPTS = 3;

/** Strip the `data:image/…;base64,` prefix — the evaluator expects raw base64. */
function toRawBase64(dataUri: string | null): string {
  return (dataUri ?? '').replace(/^data:image\/[^;]+;base64,/, '');
}

function toAppealInput(a: PendingAppeal): AppealInput {
  return {
    jobType: (a.job_type ?? 'activations') as SiteCamJobType,
    stepNumber: a.step_number,
    photoBase64: toRawBase64(a.photo_url),
    appealText: a.appeal_text,
    serialScanned: a.serial_scanned,
    serialExpected: a.serial_expected,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    log.error('CRON_SECRET not configured', undefined, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Server misconfigured: CRON_SECRET not set');
  }
  if (req.headers.authorization !== `Bearer ${cronSecret}`) {
    return apiResponse.unauthorized(res, 'Invalid or missing cron secret');
  }

  try {
    const appeals = await findPendingAppeals(BATCH_LIMIT, MAX_ATTEMPTS);
    log.info(`Appeals VLM: ${appeals.length} pending`, undefined, MODULE);

    let scored = 0;
    let retried = 0;

    for (const appeal of appeals) {
      try {
        const evaluation = await evaluateAppeal(toAppealInput(appeal));
        // Only a transient VLM outage is retryable; every other outcome — a real
        // approve/deny or a terminal uncertain (no_photo/unsupported_step/
        // unreadable_image) — is written once and never re-scored.
        if (evaluation.skipReason === 'vlm_unavailable') {
          const { attempts, parked } = await recordTransientFailure(appeal.id, evaluation, MAX_ATTEMPTS);
          retried++;
          if (parked) {
            log.error(`Appeal ${appeal.id} parked after ${attempts} VLM outages`, undefined, MODULE);
          } else {
            log.warn(`Appeal ${appeal.id} VLM unavailable — attempt ${attempts}/${MAX_ATTEMPTS}, will retry`, undefined, MODULE);
          }
        } else {
          await recordEvaluation(appeal.id, evaluation);
          scored++;
          log.info(`Appeal ${appeal.id} scored: ${evaluation.recommendation} (${evaluation.confidence})`, undefined, MODULE);
        }
      } catch (err) {
        log.error(`Unexpected error scoring appeal ${appeal.id}`, { err: String(err) }, MODULE);
      }
    }

    return apiResponse.success(res, { processed: appeals.length, scored, retried });
  } catch (err) {
    log.error('Appeals VLM cron failed', { err: String(err) }, MODULE);
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Appeals VLM cron failed');
  }
}
