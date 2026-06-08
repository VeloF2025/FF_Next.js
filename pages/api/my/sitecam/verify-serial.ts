import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { validateSerialFormat, type SerialDevice } from '@/modules/sitecam/lib/verifySerial';
import { log } from '@/lib/logger';

const MODULE = 'verify-serial';

interface VerifySerialBody {
  drNumber: string;
  step: number;           // 6 = ONT, 8 = UPS
  scannedSerial: string;
  attemptNumber: number;  // counts invalid-format retries
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  _session: AttendanceSession,
): Promise<void> {
  if (req.method !== 'POST')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { drNumber, step, scannedSerial, attemptNumber } = req.body as VerifySerialBody;

  // attemptNumber is 1-based (caller sends serialAttempts + 1, min 1), so null/undefined check only
  if (!drNumber || !step || !scannedSerial || attemptNumber == null)
    return apiResponse.badRequest(res, 'drNumber, step, scannedSerial, attemptNumber required');

  const isOnt = step === 6;
  const isUps = step === 8;
  if (!isOnt && !isUps)
    return apiResponse.badRequest(res, 'step must be 6 (ONT) or 8 (UPS)');

  const device: SerialDevice = isOnt ? 'ont' : 'ups';
  const validation = validateSerialFormat(scannedSerial, device);

  if (!validation.valid) {
    return apiResponse.success(res, {
      result: 'invalid_format',
      serial: validation.normalised,
      message: validation.message,
    });
  }

  // Valid format — save to DB as pending (no comparison at scan time)
  const attemptsCol = isOnt ? 'ont_serial_attempts' : 'ups_serial_attempts';
  const statusCol   = isOnt ? 'ont_serial_status'   : 'ups_serial_status';
  const scannedCol  = isOnt ? 'ont_serial_scanned'  : 'ups_serial_scanned';

  await pool.query(
    `INSERT INTO dr_photo_unified_reviews (drop_number, ${attemptsCol}, ${statusCol}, ${scannedCol})
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (drop_number)
     DO UPDATE SET
       ${attemptsCol} = $2,
       ${statusCol}   = 'pending',
       ${scannedCol}  = $3`,
    [drNumber, attemptNumber, validation.normalised],
  );

  log.info('Serial scan saved as pending', {
    drNumber, step, serial: validation.normalised, attemptNumber,
  }, MODULE);

  return apiResponse.success(res, {
    result: 'saved',
    serial: validation.normalised,
    message: 'Serial saved — cross-reference pending (1Map + OES)',
  });
}

export default withMySession(handler);
