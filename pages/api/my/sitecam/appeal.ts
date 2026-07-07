import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';
import { log } from '@/lib/logger';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import { scoreAppealNow } from '@/modules/sitecam/services/appealsVlmRunner';

const MODULE = 'sitecam-appeal';
const APPEAL_GROUP_JID = process.env.SITECAM_APPEAL_GROUP_JID ?? '';

interface AppealBody {
  drNumber: string;
  stepNumber: number;
  appealText: string;
  photoUrl: string;
  serialScanned?: string;
  serialExpected?: string;
  attemptNumber: number;
  jobType?: SiteCamJobType;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession,
): Promise<void> {
  if (req.method !== 'POST')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const {
    drNumber, stepNumber, appealText, photoUrl,
    serialScanned, serialExpected, attemptNumber, jobType,
  } = req.body as AppealBody;

  if (!drNumber || !stepNumber || !appealText || !photoUrl || !attemptNumber)
    return apiResponse.badRequest(res, 'drNumber, stepNumber, appealText, photoUrl, attemptNumber required');

  // photoUrl is a camera-captured base64 data URI. Enforce that shape: it keeps the value
  // self-contained (no external fetch) and prevents a crafted URL being relayed to the WA bridge.
  if (!photoUrl.startsWith('data:image/'))
    return apiResponse.badRequest(res, 'photoUrl must be a data:image/ URI');

  // job_type drives which step criteria/gallery the appeals VLM cron uses (Phase 2).
  // Tolerate a missing value — a stale/cached SiteCam PWA predates this field, and the
  // column is nullable (the scoring cron treats NULL as 'activations'). Reject only an
  // explicit out-of-enum value so a technician's appeal is never hard-blocked by a cache.
  if (jobType != null && jobType !== 'activations' && jobType !== 'civils')
    return apiResponse.badRequest(res, 'jobType must be "activations" or "civils"');

  const { rows: staffRows } = await pool.query<{ first_name: string; last_name: string }>(
    `SELECT first_name, last_name FROM staff WHERE id = $1 LIMIT 1`,
    [session.staffId],
  );
  const techName = staffRows[0]
    ? `${staffRows[0].first_name} ${staffRows[0].last_name}`
    : 'Unknown Technician';

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sitecam_appeals
       (dr_number, step_number, technician_id, appeal_text, photo_url,
        serial_scanned, serial_expected, attempt_number, job_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [drNumber, stepNumber, session.staffId, appealText, photoUrl,
     serialScanned ?? null, serialExpected ?? null, attemptNumber, jobType ?? null],
  );
  const appealId = rows[0]!.id;

  if (APPEAL_GROUP_JID) {
    const waMessage = [
      `🔴 *SiteCam Appeal — ${drNumber}*`,
      `Step ${stepNumber} | Tech: ${techName}`,
      `Reason: "${appealText}"`,
      serialScanned
        ? `Serial scanned: \`${serialScanned}\`\nExpected: \`${serialExpected ?? 'unknown'}\``
        : '',
      `Attempt: ${attemptNumber}`,
      ``,
      `Review (approve/deny) in the SiteCam appeals queue:`,
      `  https://app.fibreflow.app/activate/sitecam-appeals`,
    ].filter(Boolean).join('\n');

    // Text-only: the photo is a base64 data URI the bridge cannot download as media_url.
    // Reviewers open the in-app queue (linked above) to view the photo and decide.
    sendWhatsAppGroup(APPEAL_GROUP_JID, waMessage).catch((err: unknown) => {
      log.warn('Appeal WA send failed (non-fatal)', { appealId, err: String(err) }, MODULE);
    });
  }

  // Fast path: kick off VLM scoring immediately so the appeal is checked (and, if
  // auto-decide is on, decided) in seconds instead of waiting up to a full cron
  // cycle. Fire-and-forget — best-effort, never blocks or fails the submit; the
  // batch cron is the safety net if this doesn't land. scoreAppealNow already
  // swallows its own errors; the .catch is a belt-and-suspenders guard so a future
  // refactor that lets it reject can never surface an unhandled rejection here.
  scoreAppealNow(appealId).catch((err: unknown) => {
    log.warn('On-submit appeal scoring rejected unexpectedly', { appealId, err: String(err) }, MODULE);
  });

  log.info('Appeal submitted', { appealId, drNumber, stepNumber }, MODULE);
  return apiResponse.success(res, { appealId });
}

export default withMySession(handler);

// The appeal body carries the step photo as a base64 data URI (several MB for a
// phone camera shot). Match the validate endpoint's limit — the Next.js default
// of 1mb rejects the request with a 413 before the handler runs, which the PWA
// surfaces as a misleading "Network error".
export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
};
