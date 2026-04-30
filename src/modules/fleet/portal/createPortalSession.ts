/**
 * Server-side helper: create a fleet portal session and return the
 * Set-Cookie string the caller should add to their response headers.
 *
 * Two callers today:
 *   - pages/api/fleet/portal/plate-auth.ts (legacy plate-photo flow)
 *   - pages/api/my/fleet-handoff.ts        (PRD-040 SSO from /my)
 *
 * Both paths converge on the same `fleet_portal_sessions` row + HMAC-signed
 * cookie shape so downstream fleet code (withFleetAuth, /api/fleet/portal/*,
 * the /fleet/portal page itself) is identity-agnostic.
 */

import crypto from 'crypto';
import { serialize } from 'cookie';
import { neon } from '@/lib/db-neon';

import type { PortalSession, PortalSessionSource } from './types';

const sql = neon(process.env.DATABASE_URL!);

export const PORTAL_SESSION_COOKIE = 'ff_portal_session';
const PORTAL_SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

const PORTAL_SESSION_SECRET = process.env.PORTAL_SESSION_SECRET;

interface CreatePortalSessionArgs {
  vehicleId: string;
  vehicleRegistration: string;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  /**
   * How the session was minted. 'plate' = VLM plate-photo verified;
   * 'my' = bridged from a verified /my staff session via fleet-handoff.
   * Persisted as `plate_scanned` text marker on the audit row so we can
   * trace which path created any given session.
   */
  source: PortalSessionSource;
  /** VLM confidence when source='plate'; pass 1.0 for source='my'. */
  confidence: number;
  /** Best-effort attribution for the audit trail. */
  ipAddress: string;
  userAgent: string;
}

export interface CreatePortalSessionResult {
  session: PortalSession;
  setCookieHeader: string;
}

export async function createPortalSession(
  args: CreatePortalSessionArgs
): Promise<CreatePortalSessionResult> {
  if (!PORTAL_SESSION_SECRET) {
    throw new Error('PORTAL_SESSION_SECRET env var not set — cannot sign session token');
  }

  const sessionId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PORTAL_SESSION_DURATION_MS);

  // Persist for audit trail (replay detection, session listing, revocation).
  // plate_scanned column is overloaded as the source marker for non-plate
  // paths. The column is VARCHAR(20) so we keep the marker short — the
  // staff member's driver_id is already on the row separately if anyone
  // needs to trace which user the session belonged to.
  const plateMarker = args.source === 'my' ? 'sso:my' : args.vehicleRegistration;
  await sql`
    INSERT INTO fleet_portal_sessions (
      id,
      vehicle_id,
      driver_id,
      plate_scanned,
      confidence,
      created_at,
      expires_at,
      ip_address,
      user_agent
    ) VALUES (
      ${sessionId},
      ${args.vehicleId},
      ${args.driverId},
      ${plateMarker},
      ${args.confidence},
      ${now.toISOString()},
      ${expiresAt.toISOString()},
      ${args.ipAddress},
      ${args.userAgent}
    )
  `;

  const sessionData: PortalSession = {
    sessionId,
    vehicleId: args.vehicleId,
    vehicleRegistration: args.vehicleRegistration,
    driverId: args.driverId,
    driverName: args.driverName,
    driverPhone: args.driverPhone,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    source: args.source,
  };

  const payload = Buffer.from(JSON.stringify(sessionData)).toString('base64');
  const signature = crypto
    .createHmac('sha256', PORTAL_SESSION_SECRET)
    .update(payload)
    .digest('hex');
  const sessionToken = `${payload}.${signature}`;

  const setCookieHeader = serialize(PORTAL_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PORTAL_SESSION_DURATION_MS / 1000,
  });

  return { session: sessionData, setCookieHeader };
}
