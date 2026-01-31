import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { boqId, limit = '50', offset = '0' } = req.query;

  if (!boqId || typeof boqId !== 'string') {
    return apiResponse.badRequest(res, 'boqId query parameter is required');
  }

  try {
    const limitNum = Math.min(Number(limit) || 50, 200);
    const offsetNum = Number(offset) || 0;

    const changes = await sql`
      SELECT
        cl.id,
        cl.boq_id,
        cl.boq_item_id,
        cl.action,
        cl.field_changed,
        cl.old_value,
        cl.new_value,
        cl.changed_by,
        cl.changed_by_name,
        cl.change_summary,
        cl.created_at,
        bi.item_code,
        bi.description as item_description
      FROM boq_change_log cl
      LEFT JOIN boq_items bi ON bi.id = cl.boq_item_id
      WHERE cl.boq_id::text = ${boqId}
      ORDER BY cl.created_at DESC
      LIMIT ${limitNum} OFFSET ${offsetNum}
    `;

    const countResult = await sql`
      SELECT COUNT(*)::int as total
      FROM boq_change_log
      WHERE boq_id::text = ${boqId}
    `;

    return apiResponse.success(res, {
      changes: changes.map((c: any) => ({
        id: c.id,
        boqItemId: c.boq_item_id,
        action: c.action,
        fieldChanged: c.field_changed,
        oldValue: c.old_value,
        newValue: c.new_value,
        changedBy: c.changed_by,
        changedByName: c.changed_by_name,
        changeSummary: c.change_summary,
        createdAt: c.created_at,
        itemCode: c.item_code,
        itemDescription: c.item_description,
      })),
      total: countResult[0]?.total || 0,
    });
  } catch (error) {
    log.error('Failed to fetch BOQ change history', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
