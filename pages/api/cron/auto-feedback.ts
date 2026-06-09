import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import pool from '@/lib/db';
import {
  generateFeedbackMessage,
  type AutoQaResults,
} from '@/modules/activate/services/autoQaCommentGenerator';
import {
  sendPrivateToTech,
  markAutoFeedbackSent,
  markAutoFeedbackSkipped,
} from '@/modules/activate/services/feedbackSendService';

const MODULE = 'AutoFeedbackCron';
const CUTOFF_DATE = '2026-06-09T00:00:00+02:00';
const BATCH_LIMIT = 10;

interface EligibleDR {
  drop_number: string;
  wa_sender_jid: string | null;
  auto_qa_results: Record<string, unknown> | null;
  project: string | null;
}

async function isAutoFeedbackEnabled(): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ value: string }>(
      `SELECT value FROM system_flags WHERE key = 'auto_feedback_enabled'`
    );
    return rows[0]?.value !== 'false';
  } catch (err) {
    log.error('Failed to read system_flags — pausing auto-feedback', { err: String(err) }, MODULE);
    return false;
  }
}

async function findEligibleDRs(): Promise<EligibleDR[]> {
  const { rows } = await pool.query<EligibleDR>(
    `SELECT drop_number, wa_sender_jid, auto_qa_results, project
     FROM dr_photo_unified_reviews
     WHERE human_review_status = 'pending_hitl'
       AND feedback_sent        = false
       AND auto_feedback_sent_at    IS NULL
       AND auto_feedback_skip_reason IS NULL
       AND auto_qa_processed_at <= NOW() - INTERVAL '30 minutes'
       AND auto_qa_processed_at >= $1
     ORDER BY auto_qa_processed_at ASC
     LIMIT $2`,
    [CUTOFF_DATE, BATCH_LIMIT]
  );
  return rows;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
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

  const enabled = await isAutoFeedbackEnabled();
  if (!enabled) {
    log.info('Auto-feedback paused via system_flags', undefined, MODULE);
    return apiResponse.success(res, { paused: true, processed: 0, sent: 0, skipped: 0 });
  }

  const drs = await findEligibleDRs();
  log.info(`Auto-feedback: found ${drs.length} eligible DRs`, undefined, MODULE);

  if (drs.length === 0) {
    return apiResponse.success(res, { paused: false, processed: 0, sent: 0, skipped: 0 });
  }

  let sent = 0;
  let skipped = 0;

  for (const dr of drs) {
    try {
      if (!dr.wa_sender_jid) {
        await markAutoFeedbackSkipped(dr.drop_number, 'no_wa_sender_jid');
        log.info(`Skipped ${dr.drop_number}: no wa_sender_jid`, undefined, MODULE);
        skipped++;
        continue;
      }

      if (!dr.auto_qa_results) {
        await markAutoFeedbackSkipped(dr.drop_number, 'no_auto_qa_results');
        log.warn(`Skipped ${dr.drop_number}: no auto_qa_results`, undefined, MODULE);
        skipped++;
        continue;
      }

      const results = dr.auto_qa_results as AutoQaResults;
      const message = generateFeedbackMessage(
        dr.drop_number,
        results.summary.decision,
        results.photos,
        results.validations
      );

      const result = await sendPrivateToTech(dr.wa_sender_jid, message, {
        dropNumber: dr.drop_number,
        project: dr.project,
      });

      if (result.success) {
        await markAutoFeedbackSent(dr.drop_number, message, result.messageId);
        log.info(`Auto-sent feedback for ${dr.drop_number}`, undefined, MODULE);
        sent++;
      } else {
        log.error(`WA send failed for ${dr.drop_number} — will retry next tick`, undefined, MODULE);
      }
    } catch (err) {
      log.error(`Unexpected error processing ${dr.drop_number}`, { err: String(err) }, MODULE);
    }
  }

  return apiResponse.success(res, {
    paused: false,
    processed: drs.length,
    sent,
    skipped,
  });
}
