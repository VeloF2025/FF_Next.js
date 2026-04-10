/**
 * Snag Share Token API
 * POST /api/snags/share — Create a share token for a ticket (requires auth)
 *   Body: { ticketId: string }
 *   Returns: { token, url }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, getAuthUser } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'Unknown', ['POST']);
  }

  const { ticketId } = req.body as { ticketId?: string };
  if (!ticketId) {
    return apiResponse.error(res, 400 as never, 'ticketId is required');
  }

  try {
    const user = getAuthUser(req);

    // Check ticket exists
    const tickets = await sql`
      SELECT id, ticket_uid, status FROM maintenance_tickets WHERE id = ${ticketId}
    ` as Array<{ id: string; ticket_uid: string; status: string }>;

    if (tickets.length === 0) {
      return apiResponse.notFound(res, 'Ticket', ticketId);
    }

    // Check if an active token already exists for this ticket
    const existing = await sql`
      SELECT token FROM snag_share_tokens
      WHERE ticket_id = ${ticketId} AND is_active = true
      LIMIT 1
    ` as Array<{ token: string }>;

    if (existing.length > 0) {
      const host = req.headers.host ?? 'dev.fibreflow.app';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      return apiResponse.success(res, {
        token: existing[0]!.token,
        url: `${protocol}://${host}/snag/resolve/${existing[0]!.token}`,
        reused: true,
      });
    }

    // Generate new token
    const token = crypto.randomBytes(24).toString('hex');

    await sql`
      INSERT INTO snag_share_tokens (token, ticket_id, created_by)
      VALUES (${token}, ${ticketId}, ${user?.id ?? null})
    `;

    const host = req.headers.host ?? 'dev.fibreflow.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';

    log.info('Share token created', { ticketId, token: token.substring(0, 8) + '...' });

    return apiResponse.success(res, {
      token,
      url: `${protocol}://${host}/snag/resolve/${token}`,
      reused: false,
    });
  } catch (error) {
    log.error('Share token creation error', { error, ticketId });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
