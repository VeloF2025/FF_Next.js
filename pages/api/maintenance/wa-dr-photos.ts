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
  vps_path: string;
  group_jid: string;
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
        p.filename,
        p.vps_path,
        p.group_jid,
        p.timestamp,
        m.sender
      FROM maintenance_wa_photos p
      LEFT JOIN maintenance_wa_messages m ON p.message_id = m.id
      WHERE p.drop_number = ${dropNumber}
      ORDER BY p.timestamp DESC
    `;

    // Build URLs for each photo
    const photosWithUrls: Photo[] = photos.map((p) => ({
      id: p.id,
      filename: p.filename,
      vps_path: p.vps_path,
      group_jid: p.group_jid,
      timestamp: p.timestamp,
      sender: p.sender || 'Unknown',
      url: `/api/maintenance/wa-photos/${p.group_jid}/${p.filename}`,
    }));

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
