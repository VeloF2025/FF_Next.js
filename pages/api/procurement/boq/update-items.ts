import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface ItemUpdate {
  id: string;
  quantity?: number;
  unitPrice?: number;
  description?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method!, ['PUT']);
  }

  const { boqId, items } = req.body as { boqId: string; items: ItemUpdate[] };

  if (!boqId || !items || !Array.isArray(items) || items.length === 0) {
    return apiResponse.badRequest(res, 'boqId and items array are required');
  }

  try {
    // Verify BOQ exists
    const boqCheck = await sql`SELECT id FROM boqs WHERE id::text = ${boqId}`;
    if (boqCheck.length === 0) {
      return apiResponse.notFound(res, 'BOQ', boqId);
    }

    let updatedCount = 0;

    for (const item of items) {
      if (!item.id) continue;

      const quantity = item.quantity != null ? Number(item.quantity) : null;
      const unitPrice = item.unitPrice != null ? Number(item.unitPrice) : null;
      const totalPrice =
        quantity != null && unitPrice != null ? quantity * unitPrice : null;

      await sql`
        UPDATE boq_items
        SET
          quantity = COALESCE(${quantity}, quantity),
          unit_price = COALESCE(${unitPrice}, unit_price),
          total_price = COALESCE(${totalPrice}, total_price),
          description = COALESCE(${item.description || null}, description),
          updated_at = NOW()
        WHERE id::text = ${item.id} AND boq_id::text = ${boqId}
      `;
      updatedCount++;
    }

    // Recalculate BOQ total
    await sql`
      UPDATE boqs
      SET
        total_estimated_value = (
          SELECT COALESCE(SUM(total_price), 0)
          FROM boq_items
          WHERE boq_id::text = ${boqId}
        ),
        updated_at = NOW()
      WHERE id::text = ${boqId}
    `;

    log.info('BOQ items updated', { boqId, count: updatedCount });
    return apiResponse.success(res, {
      message: `${updatedCount} items updated`,
      boqId,
    });
  } catch (error) {
    log.error('Failed to update BOQ items', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
