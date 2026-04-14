/**
 * WhatsApp Maintenance Messages List Endpoint
 *
 * GET /api/noc/wa-messages
 * Query parameters:
 *   - drop_number: Filter by DR number
 *   - project: Filter by project (default: Mohadin)
 *   - status: Filter by issue status (flagged, reviewing, ticket_created, resolved)
 *   - limit: Number of results (default: 50)
 *   - offset: Pagination offset (default: 0)
 *
 * @module api/noc/wa-messages
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import {
  getMessagesForDR,
  getMaintenanceFlag,
  getPhotosForDR,
  getFlaggedDRs,
} from '@/modules/noc/services/waMaintenanceProcessor';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';

const logger = createLogger('api:maintenance:wa-messages');

function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const {
      drop_number,
      project,
      status,
      limit = '50',
      offset = '0',
    } = req.query;

    // If specific DR requested, get detailed info
    if (drop_number && typeof drop_number === 'string') {
      const [messages, flag, photos] = await Promise.all([
        getMessagesForDR(drop_number),
        getMaintenanceFlag(drop_number),
        getPhotosForDR(drop_number),
      ]);

      return res.status(200).json({
        success: true,
        data: {
          drop_number,
          flag,
          messages,
          photos,
          message_count: messages.length,
          photo_count: photos.length,
        },
      });
    }

    // Otherwise, list flagged DRs
    const flags = await getFlaggedDRs({
      project: typeof project === 'string' ? project : undefined,
      status: typeof status === 'string' ? status : undefined,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });

    // Get total count for pagination
    const sql = getDb();
    let countResult;

    if (project && status) {
      countResult = await sql`
        SELECT COUNT(*) as total FROM dr_maintenance_flags
        WHERE project = ${project} AND issue_status = ${status}
      `;
    } else if (project) {
      countResult = await sql`
        SELECT COUNT(*) as total FROM dr_maintenance_flags
        WHERE project = ${project}
      `;
    } else if (status) {
      countResult = await sql`
        SELECT COUNT(*) as total FROM dr_maintenance_flags
        WHERE issue_status = ${status}
      `;
    } else {
      countResult = await sql`
        SELECT COUNT(*) as total FROM dr_maintenance_flags
      `;
    }

    const total = parseInt((countResult[0] as { total: string })?.total ?? '0', 10);

    return res.status(200).json({
      success: true,
      data: {
        items: flags,
        pagination: {
          total,
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
          has_more: parseInt(offset as string, 10) + flags.length < total,
        },
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    logger.error('Failed to fetch WA messages', { error: errorMessage });

    return res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
}

export default withAuth(handler);
