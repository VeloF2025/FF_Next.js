import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { sendWhatsAppGroupImage } from '@/modules/notifications/services/whatsappDelivery';
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
      `Reply:`,
      `  APPROVE sitecam-appeal-${appealId}`,
      `  DENY sitecam-appeal-${appealId}`,
    ].filter(Boolean).join('\n');

    sendWhatsAppGroupImage(APPEAL_GROUP_JID, waMessage, photoUrl).catch((err: unknown) => {
      log.warn('Appeal WA send failed (non-fatal)', { appealId, err: String(err) }, MODULE);
    });
  }

  log.info('Appeal submitted', { appealId, drNumber, stepNumber }, MODULE);
  return apiResponse.success(res, { appealId });
}

export default withMySession(handler);
