/**
 * POST /api/my/login/request-otp — first step of PIN onboarding / rebind.
 *
 * Body: { phone: string }
 *
 * Response: always `200 { ok: true }` so the caller cannot distinguish
 * registered phones from unregistered ones. A real OTP is only generated
 * and sent when the phone maps to an active staff row; otherwise we return
 * silently without hitting the WA sender at all.
 *
 * Side-effects (registered path):
 *   1. Generate 6-digit OTP (CSPRNG), bcrypt it.
 *   2. Upsert pending_otp_* columns in attendance_credentials. New rows are
 *      allowed post-migration 318 — the CHECK was relaxed.
 *   3. Send the plaintext OTP via WhatsApp DM to the phone on file.
 *
 * Rate limiting:
 *   A resend within 60s of the previous send is swallowed (we still return
 *   200 with no WA send), so an attacker cannot use this endpoint to flood
 *   a target phone with WA messages. The cooldown lives in the DB, so it
 *   survives process restarts and applies across concurrent requests.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { lockoutMsRemaining } from '@/modules/attendance/portal/credentialUtils';
import {
  findAuthRowByPhone,
  generateOtp,
  hashOtp,
  normaliseSaPhone,
  sendOtpViaWhatsApp,
  upsertPendingOtp,
} from '@/modules/attendance/portal/otpUtils';

export const config = {
  api: {
    bodyParser: { sizeLimit: '1kb' },
  },
};

interface RequestOtpBody {
  phone?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const body = (req.body ?? {}) as RequestOtpBody;
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const normalised = normaliseSaPhone(rawPhone);

  // Bad input still returns 200 — but we don't waste DB/WA calls on it.
  if (!normalised) {
    log.info('[my-request-otp] invalid phone input');
    return apiResponse.success(res, { ok: true });
  }

  let stage = 'init';
  try {
    stage = 'lookup';
    const row = await findAuthRowByPhone(normalised);
    if (!row) {
      // Unknown phone: return 200 silently. Server log captures the miss for
      // ops visibility without creating a client-visible oracle. `staffId`
      // is not available here, log the normalised form so ops can spot a
      // misprinted rollout flyer.
      log.info('[my-request-otp] no matching active staff');
      return apiResponse.success(res, { ok: true });
    }

    // Shared 15-min lockout: if the account is locked by too many bad login
    // or OTP attempts, refuse to mint a new OTP. Returns 200 (oracle-silent)
    // but skips the WA send so the attacker can't use OTP resends to probe
    // for valid phones or flood the victim's phone.
    const lockMs = lockoutMsRemaining(row);
    if (lockMs > 0) {
      log.info('[my-request-otp] rejected locked account — no OTP sent', {
        staffId: row.staff_id,
        lockMsRemaining: lockMs,
      });
      return apiResponse.success(res, { ok: true });
    }

    stage = 'generate';
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);

    stage = 'upsert_pending';
    const { sent: shouldSend, cooldownMs } = await upsertPendingOtp({
      staffId: row.staff_id,
      otpHash,
    });

    if (!shouldSend) {
      log.info('[my-request-otp] within resend cooldown — skipping WA send', {
        staffId: row.staff_id,
        cooldownMs,
      });
      return apiResponse.success(res, { ok: true });
    }

    stage = 'wa_send';
    try {
      await sendOtpViaWhatsApp({
        phone: normalised,
        otp,
        staffName: row.staff_name,
      });
      log.info('[my-request-otp] OTP sent', { staffId: row.staff_id });
    } catch (sendErr) {
      // A WA send failure is not visible to the client — if we returned 500
      // here, the attacker could A/B test which phones bounce. Ops still get
      // the error in the log.
      log.error('[my-request-otp] WA send failed', {
        staffId: row.staff_id,
        error: sendErr instanceof Error ? sendErr.message : String(sendErr),
      });
    }

    return apiResponse.success(res, { ok: true });
  } catch (err) {
    log.error('[my-request-otp] unexpected error', {
      stage,
      error: err instanceof Error ? err.message : String(err),
    });
    // Even on unexpected failure, return 200 to avoid leaking state. Ops
    // log captures it.
    return apiResponse.success(res, { ok: true });
  }
}
