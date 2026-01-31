import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

interface ItemUpdate {
  id: string;
  quantity?: number;
  unitPrice?: number;
  description?: string;
}

interface FieldChange {
  boqItemId: string;
  field: string;
  oldValue: string;
  newValue: string;
  summary: string;
}

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PUT') {
    return apiResponse.methodNotAllowed(res, req.method!, ['PUT']);
  }

  const { boqId, items } = req.body as { boqId: string; items: ItemUpdate[] };

  if (!boqId || !items || !Array.isArray(items) || items.length === 0) {
    return apiResponse.badRequest(res, 'boqId and items array are required');
  }

  const user = req.user;
  const userId = user?.id || null;
  const userName = user?.name || 'Unknown';

  try {
    // Verify BOQ exists
    const boqCheck = await sql`SELECT id FROM boqs WHERE id::text = ${boqId}`;
    if (boqCheck.length === 0) {
      return apiResponse.notFound(res, 'BOQ', boqId);
    }

    let updatedCount = 0;
    const allChanges: FieldChange[] = [];

    for (const item of items) {
      if (!item.id) continue;

      // Fetch current values before updating
      const currentRows = await sql`
        SELECT id, item_code, description, quantity, unit_price, total_price
        FROM boq_items
        WHERE id::text = ${item.id} AND boq_id::text = ${boqId}
      `;

      if (currentRows.length === 0) continue;
      const current = currentRows[0]!;
      const itemLabel = current.item_code || item.id.substring(0, 8);

      // Detect changes per field
      if (item.quantity != null && Number(item.quantity) !== Number(current.quantity)) {
        allChanges.push({
          boqItemId: item.id,
          field: 'quantity',
          oldValue: String(current.quantity),
          newValue: String(item.quantity),
          summary: `${itemLabel}: quantity ${current.quantity} → ${item.quantity}`,
        });
      }

      if (item.unitPrice != null && Number(item.unitPrice) !== Number(current.unit_price)) {
        allChanges.push({
          boqItemId: item.id,
          field: 'unit_price',
          oldValue: String(current.unit_price),
          newValue: String(item.unitPrice),
          summary: `${itemLabel}: unit price ${current.unit_price} → ${item.unitPrice}`,
        });
      }

      if (item.description && item.description !== current.description) {
        allChanges.push({
          boqItemId: item.id,
          field: 'description',
          oldValue: String(current.description || ''),
          newValue: item.description,
          summary: `${itemLabel}: description updated`,
        });
      }

      // Perform the update
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

    // Log all changes to boq_change_log
    for (const change of allChanges) {
      await sql`
        INSERT INTO boq_change_log (boq_id, boq_item_id, action, field_changed, old_value, new_value, changed_by, changed_by_name, change_summary)
        VALUES (${boqId}::uuid, ${change.boqItemId}::uuid, 'item_updated', ${change.field}, ${change.oldValue}, ${change.newValue}, ${userId}::uuid, ${userName}, ${change.summary})
      `;
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

    log.info('BOQ items updated', { boqId, count: updatedCount, changes: allChanges.length, user: userName });
    return apiResponse.success(res, {
      message: `${updatedCount} items updated`,
      changesLogged: allChanges.length,
      boqId,
    });
  } catch (error) {
    log.error('Failed to update BOQ items', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
