import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { sendWhatsAppGroup } from '@/modules/notifications/services/whatsappDelivery';
import { log } from '@/lib/logger';

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
    serialScanned, serialExpected, attemptNumber,
  } = req.body as AppealBody;

  if (!drNumber || !stepNumber || !appealText || !photoUrl || !attemptNumber)
    return apiResponse.badRequest(res, 'drNumber, stepNumber, appealText, photoUrl, attemptNumber required');

  // photoUrl is a camera-captured base64 data URI. Enforce that shape: it keeps the value
  // self-contained (no external fetch) and prevents a crafted URL being relayed to the WA bridge.
  if (!photoUrl.startsWith('data:image/'))
    return apiResponse.badRequest(res, 'photoUrl must be a data:image/ URI');

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
        serial_scanned, serial_expected, attempt_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [drNumber, stepNumber, session.staffId, appealText, photoUrl,
     serialScanned ?? null, serialExpected ?? null, attemptNumber],
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
