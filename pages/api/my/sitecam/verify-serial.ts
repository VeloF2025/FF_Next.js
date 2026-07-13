import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { validateSerialFormat, type SerialDevice } from '@/modules/sitecam/lib/verifySerial';
import { crossReferenceSerial, crossRefStatusToColumn } from '@/modules/sitecam/lib/serialCrossRef';
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

  // Valid format — cross-reference against the DR's 1Map/OES record. Falls
  // back to 'pending' when the DR has no reference data yet (best-effort,
  // never blocks the scan flow).
  const crossRef = await crossReferenceSerial(drNumber, device, validation.normalised);

  const attemptsCol = isOnt ? 'ont_serial_attempts' : 'ups_serial_attempts';
  const statusCol   = isOnt ? 'ont_serial_status'   : 'ups_serial_status';
  const scannedCol  = isOnt ? 'ont_serial_scanned'  : 'ups_serial_scanned';

  // Persist the mapped column value, NOT the raw crossRef.status: the column's
  // CHECK constraint forbids 'verified'/'mismatch', so writing those 500s the
  // save and strands the tech on step 6. The raw status still flows to the UI
  // via the response below.
  const persistedStatus = crossRefStatusToColumn(crossRef.status);

  await pool.query(
    `INSERT INTO dr_photo_unified_reviews (drop_number, ${attemptsCol}, ${statusCol}, ${scannedCol})
     VALUES ($1, $2, $4, $3)
     ON CONFLICT (drop_number)
     DO UPDATE SET
       ${attemptsCol} = $2,
       ${statusCol}   = $4,
       ${scannedCol}  = $3`,
    [drNumber, attemptNumber, validation.normalised, persistedStatus],
  );

  log.info('Serial scan saved', {
    drNumber, step, serial: validation.normalised, attemptNumber,
    crossRefStatus: crossRef.status, expectedSerial: crossRef.expectedSerial,
  }, MODULE);

  const message =
    crossRef.status === 'verified'
      ? 'Serial verified against FibreFlow records'
      : crossRef.status === 'mismatch'
        ? `Serial does not match the recorded ${device.toUpperCase()} serial for this DR — flagged for QA review`
        : 'Serial saved — cross-reference pending (1Map + OES)';

  return apiResponse.success(res, {
    result: 'saved',
    serial: validation.normalised,
    crossRefStatus: crossRef.status,
    message,
  });
}

export default withMySession(handler);
