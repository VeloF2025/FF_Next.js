/**
 * Get photos for a specific DR from WhatsApp maintenance tracking
 *
 * GET /api/maintenance/wa-dr-photos?dropNumber=DR1856394
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { neon } from '@neondatabase/serverless';

const logger = createLogger('maintenance:wa-dr-photos');

interface Photo {
  id: string;
  filename: string;
  local_path: string;
  timestamp: string;
  sender: string;
  url: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return res.status(400).json({ error: 'dropNumber is required' });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // Get photos linked to this DR
    const photos = await sql`
      SELECT
        p.id,
        p.original_filename,
        p.local_path,
        p.created_at,
        m.sender_name
      FROM maintenance_wa_photos p
      LEFT JOIN maintenance_wa_messages m ON p.message_id = m.id
      WHERE p.drop_number = ${dropNumber}
      ORDER BY p.created_at DESC
    `;

    // Build URLs for each photo
    // local_path format: /opt/whatsapp-bridge/store/{group_jid}/{filename}
    const photosWithUrls: Photo[] = photos.map((p) => {
      const pathParts = (p.local_path || '').split('/');
      const groupJid = pathParts[pathParts.length - 2] || '';
      const filename = pathParts[pathParts.length - 1] || p.original_filename;

      return {
        id: p.id,
        filename: p.original_filename || filename,
        local_path: p.local_path,
        timestamp: p.created_at,
        sender: p.sender_name || 'Unknown',
        url: `/api/maintenance/wa-photos/${groupJid}/${filename}`,
      };
    });

    logger.info({ dropNumber, count: photosWithUrls.length }, 'Fetched photos for DR');

    return res.status(200).json({
      success: true,
      data: {
        dropNumber,
        photos: photosWithUrls,
      },
    });
  } catch (error) {
    logger.error({ error }, 'Error fetching DR photos');
    return res.status(500).json({ error: 'Failed to fetch photos' });
  }
}
