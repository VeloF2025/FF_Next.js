import type { NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import type { AuthenticatedNextApiRequest } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const {
    boqItemId,
    stockItemId,
    /** Also save as supplier code mapping for future auto-matching */
    saveAsSupplierMapping,
    supplierId,
  } = req.body;

  if (!boqItemId || !stockItemId) {
    return apiResponse.badRequest(res, 'boqItemId and stockItemId are required');
  }

  const userName = req.user?.name || 'Unknown';

  try {
    // Verify both records exist
    const boqItem = await sql`
      SELECT id, item_code, description, boq_id
      FROM boq_items
      WHERE id = ${boqItemId}::uuid
    `;
    if (boqItem.length === 0) {
      return apiResponse.notFound(res, 'BOQ Item', boqItemId);
    }

    const stockItem = await sql`
      SELECT id, item_code, name
      FROM stock_items
      WHERE id = ${stockItemId}::uuid AND is_active = true
    `;
    if (stockItem.length === 0) {
      return apiResponse.notFound(res, 'Stock Item', stockItemId);
    }

    // Update the BOQ item with the stock mapping
    await sql`
      UPDATE boq_items
      SET stock_item_id = ${stockItemId}::uuid,
          stock_match_confidence = 1.0,
          stock_match_method = 'manual',
          updated_at = NOW()
      WHERE id = ${boqItemId}::uuid
    `;

    // Log the manual mapping in change log
    await sql`
      INSERT INTO boq_change_log (
        boq_id, boq_item_id, action, field_changed,
        old_value, new_value, changed_by_name, change_summary
      ) VALUES (
        ${boqItem[0].boq_id}::uuid,
        ${boqItemId}::uuid,
        'stock_mapped',
        'stock_item_id',
        '',
        ${stockItem[0].item_code || stockItem[0].name},
        ${userName},
        ${'Manually mapped to stock item: ' + (stockItem[0].item_code || stockItem[0].name)}
      )
    `;

    // Optionally save as supplier code mapping for future imports
    if (saveAsSupplierMapping && boqItem[0].item_code) {
      const existingMapping = await sql`
        SELECT id FROM supplier_item_codes
        WHERE LOWER(supplier_item_code) = LOWER(${boqItem[0].item_code})
          AND stock_item_id = ${stockItemId}::uuid
      `;

      if (existingMapping.length === 0) {
        await sql`
          INSERT INTO supplier_item_codes (
            stock_item_id, supplier_id, supplier_item_code, supplier_item_name,
            is_active, created_by
          ) VALUES (
            ${stockItemId}::uuid,
            ${supplierId ? Number(supplierId) : null},
            ${boqItem[0].item_code},
            ${boqItem[0].description},
            true,
            ${userName}
          )
        `;
        log.info('Saved supplier code mapping from manual BOQ mapping', {
          supplierCode: boqItem[0].item_code,
          stockItemId,
        });
      }
    }

    log.info('BOQ item manually mapped to stock item', {
      boqItemId,
      stockItemId,
      stockCode: stockItem[0].item_code,
    });

    return apiResponse.success(res, {
      boqItemId,
      stockItemId,
      stockCode: stockItem[0].item_code,
      stockName: stockItem[0].name,
      savedSupplierMapping: saveAsSupplierMapping && boqItem[0].item_code ? true : false,
    });
  } catch (error) {
    log.error('Failed to map BOQ item to stock item', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
