import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';

import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  try {
    const { date } = req.query;

    // Get daily stats
    const statsResult = date
      ? await sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_valid = true) as valid,
          COUNT(*) FILTER (WHERE is_valid = false) as invalid
        FROM marketing_activations
        WHERE DATE(whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = ${date}
      `
      : await sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE is_valid = true) as valid,
          COUNT(*) FILTER (WHERE is_valid = false) as invalid
        FROM marketing_activations
        WHERE DATE(whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE
      `;

    const stats = statsResult[0];

    // Get recent submissions with GPS data from onemap_properties
    // Use subquery to get only one GPS coordinate per drop (the earliest one)
    const submissions = date
      ? await sql`
        SELECT
          ma.drop_number,
          ma.whatsapp_message_date,
          ma.submitted_by,
          ma.user_name,
          ma.is_valid,
          ma.validation_message,
          ma.created_at,
          (
            SELECT latitude
            FROM onemap_properties
            WHERE drop_number = ma.drop_number
            ORDER BY created_at ASC
            LIMIT 1
          ) as latitude,
          (
            SELECT longitude
            FROM onemap_properties
            WHERE drop_number = ma.drop_number
            ORDER BY created_at ASC
            LIMIT 1
          ) as longitude
        FROM marketing_activations ma
        WHERE DATE(ma.whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = ${date}
        ORDER BY ma.whatsapp_message_date DESC
      `
      : await sql`
        SELECT
          ma.drop_number,
          ma.whatsapp_message_date,
          ma.submitted_by,
          ma.user_name,
          ma.is_valid,
          ma.validation_message,
          ma.created_at,
          (
            SELECT latitude
            FROM onemap_properties
            WHERE drop_number = ma.drop_number
            ORDER BY created_at ASC
            LIMIT 1
          ) as latitude,
          (
            SELECT longitude
            FROM onemap_properties
            WHERE drop_number = ma.drop_number
            ORDER BY created_at ASC
            LIMIT 1
          ) as longitude
        FROM marketing_activations ma
        WHERE DATE(ma.whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE
        ORDER BY ma.whatsapp_message_date DESC
      `;

    return res.status(200).json({
      success: true,
      data: {
        date: date || new Date().toISOString().split('T')[0],
        stats: {
          total: parseInt(stats.total) || 0,
          valid: parseInt(stats.valid) || 0,
          invalid: parseInt(stats.invalid) || 0
        },
        submissions: submissions.map(sub => ({
          dropNumber: sub.drop_number,
          submittedAt: sub.whatsapp_message_date,
          submittedBy: sub.submitted_by,
          userName: sub.user_name,
          isValid: sub.is_valid,
          validationMessage: sub.validation_message,
          latitude: sub.latitude,
          longitude: sub.longitude
        }))
      }
    });
  } catch (error: any) {
    log.error('Marketing activations API error', { error });
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

export default withAuth(handler);
