/**
 * POST /api/my/login — /my portal login
 *
 * Two flows share one endpoint:
 *   - method='pin':      identifier = SA phone number, credential = 6-digit PIN
 *   - method='password': identifier = email (case-insensitive), credential = password
 *
 * Design goals:
 *   1. Never leak whether an identifier is registered. All failure paths
 *      (unknown identifier, wrong credential, inactive account, account
 *      locked) return the same `401 Invalid credentials`. Detailed reason
 *      is logged server-side only.
 *   2. Constant-time failure: when no row matches, we still run a bcrypt
 *      compare against a dummy hash so response latency is dominated by
 *      bcrypt in every path. Without this, unknown identifiers return in
 *      ~0 ms while registered ones take ~200 ms — a trivial enumeration
 *      oracle.
 *   3. Lockout is enforced server-side (5 failed attempts → 15 min lock
 *      in attendance_credentials). The lock never reveals itself to the
 *      caller — a locked account looks identical to a wrong credential.
 *   4. Success issues an HMAC-signed cookie (`ff_my_session`, 12h,
 *      httpOnly, path=/my) and writes an audit row to
 *      attendance_auth_sessions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  consumeTimingPadding,
  findAuthRowByEmail,
  findAuthRowByPhone,
  lockoutMsRemaining,
  recordFailedAttempt,
  recordSuccessfulLogin,
  verifyCredential,
} from '@/modules/attendance/portal/credentialUtils';
import { issueSession } from '@/modules/attendance/portal/sessionUtils';
import type { LoginMethod } from '@/modules/attendance/portal/types';

export const config = {
  api: {
    bodyParser: { sizeLimit: '4kb' },
  },
};

interface LoginBody {
  method?: LoginMethod;
  identifier?: string;
  credential?: string;
  device_fingerprint?: string;
}

const GENERIC_AUTH_FAIL = 'Invalid credentials';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const body = (req.body ?? {}) as LoginBody;
  const method = body.method;
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
  const credential = typeof body.credential === 'string' ? body.credential : '';
  const deviceFingerprint =
    typeof body.device_fingerprint === 'string' ? body.device_fingerprint.slice(0, 256) : null;

  if ((method !== 'pin' && method !== 'password') || !identifier || !credential) {
    return apiResponse.badRequest(res, 'method, identifier, and credential are required');
  }

  // `stage` breadcrumb makes catch-all logs diagnosable — tells ops whether
  // failure happened in lookup, bcrypt, a lockout UPDATE, or session issue.
  let stage = 'init';
  try {
    stage = 'lookup';
    const row =
      method === 'pin'
        ? await findAuthRowByPhone(identifier)
        : await findAuthRowByEmail(identifier);

    // ---- Unified failure path ----
    // Every negative outcome returns the same 401 with GENERIC_AUTH_FAIL so
    // the caller can't tell "no row" from "wrong credential" from "locked"
    // from "inactive". We still burn bcrypt time on the no-row path via
    // consumeTimingPadding so the response distribution is flat.

    if (!row) {
      stage = 'timing_padding';
      await consumeTimingPadding(credential);
      log.info('[my-login] no matching row', { method });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    // Currently-locked: burn bcrypt time too so locked + unlocked+wrong look
    // identical from the client's perspective.
    const lockMs = lockoutMsRemaining(row);
    if (lockMs > 0) {
      stage = 'locked_padding';
      await consumeTimingPadding(credential);
      log.info('[my-login] rejected locked account', {
        staffId: row.staff_id,
        lockMsRemaining: lockMs,
      });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    // Staff status is stored in mixed case ('active' / 'ACTIVE') across the
    // dataset — the SQL filter lowercases too, but belt-and-braces.
    if (row.staff_status && row.staff_status.toLowerCase() !== 'active') {
      stage = 'inactive_padding';
      await consumeTimingPadding(credential);
      log.info('[my-login] rejected non-active staff', {
        staffId: row.staff_id,
        status: row.staff_status,
      });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    const hash = method === 'pin' ? row.pin_hash : row.password_hash;
    if (!hash) {
      // Row exists, credentials of this flavour do not. Treat as failed
      // attempt — deliberately — so brute-forcing either flavour against
      // an account that only has the other flavour still trips lockout.
      stage = 'wrong_method';
      await consumeTimingPadding(credential);
      await recordFailedAttempt(row.staff_id);
      log.info('[my-login] no hash for requested method', {
        staffId: row.staff_id,
        method,
      });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    stage = 'verify_credential';
    const ok = await verifyCredential(credential, hash);
    if (!ok) {
      stage = 'record_failed';
      await recordFailedAttempt(row.staff_id);
      log.info('[my-login] bad credential', { staffId: row.staff_id, method });
      return apiResponse.error(res, ErrorCode.UNAUTHORIZED, GENERIC_AUTH_FAIL);
    }

    // ---- Success path ----

    stage = 'record_success';
    await recordSuccessfulLogin(row.staff_id);

    stage = 'issue_session';
    const session = await issueSession({
      staffId: row.staff_id,
      staffName: row.staff_name,
      method,
      req,
      res,
      deviceFingerprint,
    });

    log.info('[my-login] success', {
      staffId: row.staff_id,
      method,
      sessionId: session.sessionId,
    });

    return apiResponse.success(res, {
      staffId: row.staff_id,
      name: row.staff_name,
      expiresAt: session.expiresAt,
    });
  } catch (err) {
    log.error('[my-login] unexpected error', {
      stage,
      method,
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
