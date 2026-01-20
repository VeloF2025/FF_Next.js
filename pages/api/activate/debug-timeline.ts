/**
 * Debug endpoint to test activity timeline function
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  const drNumber = req.query.dr || 'DR1738319';
  const results: Record<string, unknown> = { drNumber };

  try {
    const sql = neon(process.env.DATABASE_URL!);

    // Test 1: Activity log
    const activityLog = await sql`
      SELECT id, event_type, created_at
      FROM dr_activity_log
      WHERE drop_number = ${drNumber as string}
      LIMIT 10
    `;
    results.activityLogCount = activityLog.length;

    // Test 2: DR timestamps
    const drRecords = await sql`
      SELECT
        wa_received_at,
        vlm_categorized_at,
        photo_count,
        sender_phone
      FROM dr_photo_unified_reviews
      WHERE drop_number = ${drNumber as string}
    `;
    results.drRecordCount = drRecords.length;

    if (drRecords.length > 0) {
      const dr = drRecords[0];
      results.drTimestamps = {
        wa_received_at: dr.wa_received_at,
        vlm_categorized_at: dr.vlm_categorized_at,
        photo_count: dr.photo_count,
        sender_phone: dr.sender_phone,
      };
    }

    // Test 3: OES
    const oesRecords = await sql`
      SELECT activation_date, serial_number, team
      FROM oes_activations
      WHERE drop_number = ${drNumber as string}
      LIMIT 1
    `;
    results.oesRecordCount = oesRecords.length;

    if (oesRecords.length > 0) {
      results.oesData = oesRecords[0];
    }

    results.success = true;
    results.expectedEventCount =
      (drRecords.length > 0 && drRecords[0].wa_received_at ? 1 : 0) +
      (drRecords.length > 0 && drRecords[0].vlm_categorized_at ? 1 : 0) +
      (oesRecords.length > 0 && oesRecords[0].activation_date ? 1 : 0);

  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    results.success = false;
  }

  res.status(200).json(results);
}
