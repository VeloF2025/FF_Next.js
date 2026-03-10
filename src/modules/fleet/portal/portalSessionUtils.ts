/**
 * Portal Session Utilities
 *
 * Server-side utilities for verifying and managing portal sessions.
 */

import type { NextApiRequest } from 'next';
import { neon } from '@/lib/db-neon';
import { parse } from 'cookie';
import crypto from 'crypto';
import type { PortalSession } from './types';

const sql = neon(process.env.DATABASE_URL!);

// Cookie name must match plate-auth.ts
export const PORTAL_SESSION_COOKIE = 'ff_portal_session';

// HMAC signing secret for portal session tokens
const PORTAL_SESSION_SECRET = process.env.PORTAL_SESSION_SECRET;

/**
 * Extract portal session from request cookies
 */
export function getPortalSessionFromCookie(
  req: NextApiRequest
): PortalSession | null {
  try {
    const cookies = parse(req.headers.cookie || '');
    const sessionToken = cookies[PORTAL_SESSION_COOKIE];

    if (!sessionToken) {
      return null;
    }

    // Verify HMAC signature before trusting token data
    const dotIndex = sessionToken.lastIndexOf('.');
    if (dotIndex === -1 || !PORTAL_SESSION_SECRET) {
      return null;
    }

    const payload = sessionToken.substring(0, dotIndex);
    const signature = sessionToken.substring(dotIndex + 1);

    const expectedSignature = crypto
      .createHmac('sha256', PORTAL_SESSION_SECRET)
      .update(payload)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }

    // Signature valid - decode payload
    const sessionData = JSON.parse(
      Buffer.from(payload, 'base64').toString('utf-8')
    ) as PortalSession;

    return sessionData;
  } catch {
    return null;
  }
}

/**
 * Verify portal session is valid and not expired
 */
export async function verifyPortalSession(
  req: NextApiRequest
): Promise<{
  valid: boolean;
  session: PortalSession | null;
  error?: string;
}> {
  const session = getPortalSessionFromCookie(req);

  if (!session) {
    return {
      valid: false,
      session: null,
      error: 'No portal session found',
    };
  }

  // Check expiry
  const now = new Date();
  const expiresAt = new Date(session.expiresAt);

  if (now > expiresAt) {
    return {
      valid: false,
      session: null,
      error: 'Session expired',
    };
  }

  // Verify session exists in database and is active
  try {
    const rows = await sql`
      SELECT id, is_active, expires_at
      FROM fleet_portal_sessions
      WHERE id = ${session.sessionId}
      LIMIT 1
    ` as Array<{ id: string; is_active: boolean; expires_at: string }>;

    const row = rows[0];
    if (!row) {
      return {
        valid: false,
        session: null,
        error: 'Session not found in database',
      };
    }

    if (!row.is_active) {
      return {
        valid: false,
        session: null,
        error: 'Session has been revoked',
      };
    }

    return {
      valid: true,
      session,
    };
  } catch {
    return {
      valid: false,
      session: null,
      error: 'Failed to verify session',
    };
  }
}

/**
 * Log portal activity for audit trail
 */
export async function logPortalActivity(
  sessionId: string,
  action: string,
  details?: Record<string, unknown>,
  ipAddress?: string
): Promise<void> {
  try {
    await sql`
      INSERT INTO fleet_portal_session_activity (
        session_id,
        action,
        details,
        ip_address
      ) VALUES (
        ${sessionId},
        ${action},
        ${details ? JSON.stringify(details) : null},
        ${ipAddress || null}
      )
    `;
  } catch {
    // Log but don't fail on activity logging errors
  }
}

/**
 * Revoke a portal session (for fleet manager use)
 */
export async function revokePortalSession(
  sessionId: string,
  revokedBy: string,
  reason?: string
): Promise<boolean> {
  try {
    const result = await sql`
      UPDATE fleet_portal_sessions
      SET
        is_active = false,
        revoked_at = NOW(),
        revoked_by = ${revokedBy},
        revoke_reason = ${reason || null}
      WHERE id = ${sessionId}
        AND is_active = true
      RETURNING id
    ` as Array<{ id: string }>;

    return result.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get active sessions for a vehicle (for fleet manager dashboard)
 */
export async function getActiveSessionsForVehicle(
  vehicleId: string
): Promise<
  Array<{
    id: string;
    plateScanned: string;
    driverId: string | null;
    createdAt: string;
    expiresAt: string;
    ipAddress: string | null;
  }>
> {
  try {
    const rows = await sql`
      SELECT
        id,
        plate_scanned as "plateScanned",
        driver_id as "driverId",
        created_at as "createdAt",
        expires_at as "expiresAt",
        ip_address as "ipAddress"
      FROM fleet_portal_sessions
      WHERE vehicle_id = ${vehicleId}
        AND is_active = true
        AND expires_at > NOW()
      ORDER BY created_at DESC
    `;
    return rows as Array<{
      id: string;
      plateScanned: string;
      driverId: string | null;
      createdAt: string;
      expiresAt: string;
      ipAddress: string | null;
    }>;
  } catch {
    return [];
  }
}
