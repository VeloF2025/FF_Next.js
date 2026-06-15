/**
 * POST /api/my/register — PUBLIC self-registration for field workers (Slice A).
 * Body: { firstName, lastName, phone, projectId, role: 'technician'|'casual', idNumber?, selfieBase64? }
 *
 * Creates a PENDING self-registered field worker (account_status='pending',
 * source='self_registered'), then sends a WhatsApp OTP. Step 2 (OTP+PIN) reuses
 * /api/my/login/verify-otp. Always 200 once inputs are valid — never reveals
 * whether the phone already existed (anti-enumeration). 400 only for
 * missing/malformed inputs. bodyParser caps the selfie payload at 2mb.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  createSelfRegisteredFieldWorker,
  storeRegistrationSelfie,
} from '@/modules/attendance/portal/registrationUtils';
import {
  generateOtp,
  hashOtp,
  normaliseSaPhone,
  sendOtpViaWhatsApp,
  upsertPendingOtp,
} from '@/modules/attendance/portal/otpUtils';
import { findExistingStaffForRegistration } from '@/services/staff/staffPhoneDedup';
import { sql } from '@/lib/db-pool';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const ALLOWED_ROLES = new Set(['technician', 'casual']);

interface RegisterBody {
  firstName?: string;
  lastName?: string;
  phone?: string;
  projectId?: string;
  role?: string;
  idNumber?: string;
  selfieBase64?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const b = (req.body ?? {}) as RegisterBody;
  const firstName = typeof b.firstName === 'string' ? b.firstName.trim() : '';
  const lastName = typeof b.lastName === 'string' ? b.lastName.trim() : '';
  const projectId = typeof b.projectId === 'string' ? b.projectId.trim() : '';
  const role = typeof b.role === 'string' ? b.role.trim() : '';
  const idNumber =
    typeof b.idNumber === 'string' && b.idNumber.trim() ? b.idNumber.trim() : null;
  const selfieBase64 =
    typeof b.selfieBase64 === 'string' && b.selfieBase64 ? b.selfieBase64 : null;
  const rawPhone = typeof b.phone === 'string' ? b.phone.trim() : '';

  if (!firstName || !lastName || !projectId) {
    return apiResponse.badRequest(res, 'firstName, lastName and projectId are required');
  }
  if (!ALLOWED_ROLES.has(role)) {
    return apiResponse.badRequest(res, "role must be 'technician' or 'casual'");
  }
  const normalised = normaliseSaPhone(rawPhone);
  if (!normalised) {
    return apiResponse.badRequest(res, 'A valid South African phone number is required');
  }

  let stage = 'dedup';
  try {
    let staffId: string;
    const existing = await findExistingStaffForRegistration(normalised, firstName, lastName);

    if (existing) {
      staffId = existing.id;
    } else {
      stage = 'create';
      staffId = await createSelfRegisteredFieldWorker({
        firstName,
        lastName,
        phone: normalised,
        role: role as 'technician' | 'casual',
        declaredProjectId: projectId,
        idNumber,
        selfieUrl: null,
      });

      if (selfieBase64) {
        stage = 'selfie';
        try {
          const url = await storeRegistrationSelfie({ base64: selfieBase64, staffId });
          await sql`UPDATE staff SET selfie_url = ${url} WHERE id = ${staffId}`;
        } catch (selfieErr) {
          log.error('[my-register] selfie store failed (continuing)', {
            staffId,
            error: selfieErr instanceof Error ? selfieErr.message : String(selfieErr),
          });
        }
      }
    }

    stage = 'otp';
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const { sent } = await upsertPendingOtp({ staffId, otpHash });

    if (sent) {
      stage = 'wa_send';
      try {
        await sendOtpViaWhatsApp({
          phone: normalised,
          otp,
          staffName: `${firstName} ${lastName}`.trim(),
        });
        log.info('[my-register] OTP sent', { staffId });
      } catch (sendErr) {
        const errMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        log.error('[my-register] WA send failed', { staffId, error: errMsg });
        process.stderr.write(
          JSON.stringify({
            level: 'ERROR',
            component: 'attendance-register',
            event: 'wa_send_failed',
            staffId,
            error: errMsg,
            timestamp: new Date().toISOString(),
          }) + '\n',
        );
      }
    }

    return apiResponse.success(res, { ok: true });
  } catch (err) {
    log.error('[my-register] unexpected error', {
      stage,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
