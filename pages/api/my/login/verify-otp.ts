/**
 * POST /api/my/login/verify-otp — second step of PIN onboarding / rebind.
 *
 * Body: { phone: string, otp: string, new_pin?: string, device_fingerprint?: string }
 *
 * On success:
 *   1. Pending OTP is cleared.
 *   2. If `new_pin` is supplied, its bcrypt hash becomes the pin_hash and
 *      the device_fingerprint is bound as primary.
 *   3. phone_verified_at is set to now (if not already).
 *   4. A session cookie is issued and an audit row is written.
 *
 * Failure modes (all return 401 with GENERIC_AUTH_FAIL):
 *   - unknown phone
 *   - no pending OTP (never requested, or already consumed)
 *   - OTP expired (invalidated)
 *   - OTP attempts exhausted (invalidated)
 *   - account locked via shared failed_attempts counter
 *   - bcrypt compare failed
 *
 * Every negative outcome before the happy path burns a bcrypt compare against
 * DUMMY_HASH via `consumeTimingPadding`, matching the pattern in login.ts. A
 * known vs unknown phone cannot be distinguished by response latency.
 *
 * Every bad OTP bumps BOTH `pending_otp_attempts` (per-OTP counter, burns the
 * current OTP at 5) AND `failed_attempts` (shared cross-credential counter,
 * locks the account at 5). This unifies the brute-force control with login.ts
 * so attackers cannot cycle OTPs to bypass the 15-min lockout.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  consumeTimingPadding,
  hashPin,
  lockoutMsRemaining,
  recordFailedAttempt,
} from '@/modules/attendance/portal/credentialUtils';
import {
  OTP_MAX_ATTEMPTS,
  bumpOtpAttempts,
  commitPinAndClearOtp,
  findPendingOtpByPhone,
  invalidatePendingOtp,
  normaliseSaPhone,
  verifyOtp,
} from '@/modules/attendance/portal/otpUtils';
import { issueSession } from '@/modules/attendance/portal/sessionUtils';

export const config = {
  api: {
    bodyParser: { sizeLimit: '2kb' },
  },
};

interface VerifyOtpBody {
  phone?: string;
  otp?: string;
  new_pin?: string;
  device_fingerprint?: string;
}

const GENERIC_AUTH_FAIL = 'Invalid code';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const body = (req.body ?? {}) as VerifyOtpBody;
  const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
  const newPin = typeof body.new_pin === 'string' ? body.new_pin : undefined;
  const deviceFingerprint =
    typeof body.device_fingerprint === 'string' ? body.device_fingerprint.slice(0, 256) : null;

  const normalised = normaliseSaPhone(rawPhone);
  if (!normalised || !/^\d{6}$/.test(otp)) {
    return apiResponse.badRequest(res, 'phone and 6-digit otp are required');
  }

  // Validate new_pin format up-front — if the caller is trying to set a PIN
  // we should reject a malformed one BEFORE burning an OTP attempt. That way
  // a user who mistyped their PIN can immediately try again with the same
  // OTP rather than being told "your code was wrong" when actually the PIN
  // was the problem.
  if (newPin !== undefined && !/^\d{6}$/.test(newPin)) {
    return apiResponse.badRequest(res, 'new_pin must be exactly 6 digits');
  }

  let stage = 'init';
  try {
    stage = 'lookup';
    const row = await findPendingOtpByPhone(normalised);

    if (!row) {
      // Unknown phone. Burn bcrypt time on the dummy hash so latency matches
      // the known-phone + bad-OTP path — without this, `findPendingOtpByPhone`
      // + one bcrypt.compare reveals whether the phone is registered.
      stage = 'timing_padding_no_row';
      await consumeTimingPadding(otp);
      log.info('[my-verify-otp] no matching active staff for phone');
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    // Shared 15-min lockout (same counter as login.ts). Must come AFTER the
    // row is found but BEFORE we mutate anything, so an already-locked account
    // doesn't get its attempts counter bumped further.
    const lockMs = lockoutMsRemaining(row);
    if (lockMs > 0) {
      stage = 'locked_padding';
      await consumeTimingPadding(otp);
      log.info('[my-verify-otp] rejected locked account', {
        staffId: row.staff_id,
        lockMsRemaining: lockMs,
      });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    if (!row.pending_otp_hash || !row.pending_otp_expires_at) {
      stage = 'no_pending_padding';
      await consumeTimingPadding(otp);
      log.info('[my-verify-otp] no pending OTP', { staffId: row.staff_id });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    // Per-OTP attempt cap: 5 guesses against a single OTP, then it's burned.
    // The shared lockout (failed_attempts) also applies, but this per-OTP cap
    // makes the OTP cheap to invalidate even if the shared lockout is close
    // to its threshold.
    if (row.pending_otp_attempts >= OTP_MAX_ATTEMPTS) {
      stage = 'exhausted_padding';
      await consumeTimingPadding(otp);
      await invalidatePendingOtp(row.staff_id);
      log.warn('[my-verify-otp] OTP attempts exhausted; invalidated', {
        staffId: row.staff_id,
        attempts: row.pending_otp_attempts,
      });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    const expiry = new Date(row.pending_otp_expires_at).getTime();
    if (Number.isNaN(expiry) || expiry <= Date.now()) {
      stage = 'expired_padding';
      await consumeTimingPadding(otp);
      await invalidatePendingOtp(row.staff_id);
      log.info('[my-verify-otp] OTP expired; invalidated', { staffId: row.staff_id });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    stage = 'verify';
    const ok = await verifyOtp(otp, row.pending_otp_hash);
    if (!ok) {
      stage = 'record_failed';
      // Bump BOTH counters. `bumpOtpAttempts` burns this specific OTP after
      // OTP_MAX_ATTEMPTS; `recordFailedAttempt` locks the whole account after
      // the shared threshold so OTP-cycling cannot bypass login's lockout.
      await Promise.all([
        bumpOtpAttempts(row.staff_id),
        recordFailedAttempt(row.staff_id),
      ]);
      log.info('[my-verify-otp] bad OTP', {
        staffId: row.staff_id,
        attempts: row.pending_otp_attempts + 1,
      });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    // ---- OTP valid ----
    // If caller supplied a new PIN, commit it. Otherwise just consume the OTP
    // and issue a session — allows "sign me in with just the OTP" as a recovery
    // path for a staff member who has forgotten their PIN.
    let pinCommitted = false;
    if (newPin !== undefined) {
      stage = 'commit_pin';
      const pinHash = await hashPin(newPin);
      await commitPinAndClearOtp({
        staffId: row.staff_id,
        pinHash,
        deviceFingerprint,
      });
      pinCommitted = true;
    } else {
      stage = 'consume_otp';
      await invalidatePendingOtp(row.staff_id);
    }

    // ---- Issue session ----
    // CRITICAL: if we reach here the PIN (if any) is already persisted. An
    // issueSession failure MUST NOT be reported as "invalid code" or as a raw
    // 500 — either would lock the user out of an account whose PIN we just
    // accepted. Instead return 200 with `sessionIssued: false` so the client
    // can redirect to the normal PIN login screen.
    stage = 'issue_session';
    try {
      const session = await issueSession({
        staffId: row.staff_id,
        staffName: row.staff_name,
        method: 'pin',
        req,
        res,
        deviceFingerprint,
      });

      log.info('[my-verify-otp] success', {
        staffId: row.staff_id,
        pinSet: pinCommitted,
        sessionId: session.sessionId,
      });

      return apiResponse.success(res, {
        staffId: row.staff_id,
        name: row.staff_name,
        pinSet: pinCommitted,
        sessionIssued: true,
        expiresAt: session.expiresAt,
      });
    } catch (sessionErr) {
      log.error('[my-verify-otp] issueSession failed AFTER PIN commit — preserving commit', {
        staffId: row.staff_id,
        pinSet: pinCommitted,
        error: sessionErr instanceof Error ? sessionErr.message : String(sessionErr),
      });
      return apiResponse.success(res, {
        staffId: row.staff_id,
        name: row.staff_name,
        pinSet: pinCommitted,
        sessionIssued: false,
      });
    }
  } catch (err) {
    log.error('[my-verify-otp] unexpected error', {
      stage,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
