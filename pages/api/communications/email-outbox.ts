/**
 * GET /api/communications/email-outbox
 * List sent emails from the outbox (paginated, filterable)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const authReq = req as AuthenticatedNextApiRequest;

  try {
    const limit = Math.min(parseInt(String(req.query.limit || '20'), 10) || 20, 100);
    const offset = parseInt(String(req.query.offset || '0'), 10) || 0;
    const status = req.query.status as string | undefined;
    const sourceModule = req.query.source_module as string | undefined;

    // Build query based on filters
    let emails;
    let countResult;

    if (status && sourceModule) {
      emails = await sql`
        SELECT e.*, u.first_name || ' ' || u.last_name AS sender_name, u.email AS sender_email
        FROM email_outbox e
        LEFT JOIN users u ON e.sender_id = u.id
        WHERE e.status = ${status} AND e.source_module = ${sourceModule}
        ORDER BY e.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      countResult = await sql`
        SELECT COUNT(*) as count FROM email_outbox
        WHERE status = ${status} AND source_module = ${sourceModule}
      `;
    } else if (status) {
      emails = await sql`
        SELECT e.*, u.first_name || ' ' || u.last_name AS sender_name, u.email AS sender_email
        FROM email_outbox e
        LEFT JOIN users u ON e.sender_id = u.id
        WHERE e.status = ${status}
        ORDER BY e.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      countResult = await sql`
        SELECT COUNT(*) as count FROM email_outbox WHERE status = ${status}
      `;
    } else if (sourceModule) {
      emails = await sql`
        SELECT e.*, u.first_name || ' ' || u.last_name AS sender_name, u.email AS sender_email
        FROM email_outbox e
        LEFT JOIN users u ON e.sender_id = u.id
        WHERE e.source_module = ${sourceModule}
        ORDER BY e.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      countResult = await sql`
        SELECT COUNT(*) as count FROM email_outbox WHERE source_module = ${sourceModule}
      `;
    } else {
      emails = await sql`
        SELECT e.*, u.first_name || ' ' || u.last_name AS sender_name, u.email AS sender_email
        FROM email_outbox e
        LEFT JOIN users u ON e.sender_id = u.id
        ORDER BY e.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      countResult = await sql`SELECT COUNT(*) as count FROM email_outbox`;
    }

    return apiResponse.success(res, {
      emails,
      total: Number(countResult[0]?.count || 0),
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
