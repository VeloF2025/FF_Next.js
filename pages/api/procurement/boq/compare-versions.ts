import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface ItemRow {
  id: string;
  item_code: string;
  description: string;
  quantity: string;
  unit: string;
  rate: string;
  amount: string;
  category: string;
  sequence_number: number;
}

/**
 * Compare two BOQ versions — returns added, removed, and modified items.
 * Items are matched by item_code first, then by description if no code match.
 */
async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  }

  const { fromId, toId } = req.query;

  if (!fromId || !toId || typeof fromId !== 'string' || typeof toId !== 'string') {
    return apiResponse.badRequest(res, 'fromId and toId query parameters are required');
  }

  if (fromId === toId) {
    return apiResponse.badRequest(res, 'Cannot compare a version with itself');
  }

  try {
    // Fetch both versions' metadata + items in parallel
    const [fromBoq, toBoq, fromItems, toItems] = await Promise.all([
      sql`SELECT id, version, title, status, project_id FROM boqs WHERE id = ${fromId}`,
      sql`SELECT id, version, title, status, project_id FROM boqs WHERE id = ${toId}`,
      sql`SELECT id, item_code, description, quantity, unit, rate, amount, category, sequence_number
          FROM boq_items WHERE boq_id = ${fromId} ORDER BY sequence_number, item_code`,
      sql`SELECT id, item_code, description, quantity, unit, rate, amount, category, sequence_number
          FROM boq_items WHERE boq_id = ${toId} ORDER BY sequence_number, item_code`,
    ]);

    if (!fromBoq[0] || !toBoq[0]) {
      return apiResponse.notFound(res, 'BOQ version', !fromBoq[0] ? fromId : toId);
    }

    // Verify same project
    if (fromBoq[0].project_id !== toBoq[0].project_id) {
      return apiResponse.badRequest(res, 'Cannot compare BOQs from different projects');
    }

    // Build lookup maps — match by item_code (preferred) or description
    const fromMap = new Map<string, ItemRow>();
    const toMap = new Map<string, ItemRow>();

    for (const item of fromItems as ItemRow[]) {
      const key = item.item_code?.trim() || item.description?.trim().toLowerCase();
      if (key) fromMap.set(key, item);
    }
    for (const item of toItems as ItemRow[]) {
      const key = item.item_code?.trim() || item.description?.trim().toLowerCase();
      if (key) toMap.set(key, item);
    }

    const added: Array<{ itemCode: string; description: string; quantity: number; rate: number; amount: number; category: string }> = [];
    const removed: Array<{ itemCode: string; description: string; quantity: number; rate: number; amount: number; category: string }> = [];
    const modified: Array<{
      itemCode: string;
      description: string;
      changes: Array<{ field: string; from: string | number; to: string | number }>;
    }> = [];

    // Find added and modified
    for (const [key, toItem] of toMap) {
      const fromItem = fromMap.get(key);
      if (!fromItem) {
        added.push({
          itemCode: toItem.item_code || '',
          description: toItem.description,
          quantity: Number(toItem.quantity),
          rate: Number(toItem.rate),
          amount: Number(toItem.amount),
          category: toItem.category || '',
        });
      } else {
        const changes: Array<{ field: string; from: string | number; to: string | number }> = [];
        if (toItem.description !== fromItem.description) {
          changes.push({ field: 'description', from: fromItem.description, to: toItem.description });
        }
        if (Number(toItem.quantity) !== Number(fromItem.quantity)) {
          changes.push({ field: 'quantity', from: Number(fromItem.quantity), to: Number(toItem.quantity) });
        }
        if (Number(toItem.rate) !== Number(fromItem.rate)) {
          changes.push({ field: 'rate', from: Number(fromItem.rate), to: Number(toItem.rate) });
        }
        if ((toItem.unit || '') !== (fromItem.unit || '')) {
          changes.push({ field: 'unit', from: fromItem.unit || '', to: toItem.unit || '' });
        }
        if ((toItem.category || '') !== (fromItem.category || '')) {
          changes.push({ field: 'category', from: fromItem.category || '', to: toItem.category || '' });
        }
        if (changes.length > 0) {
          modified.push({
            itemCode: toItem.item_code || fromItem.item_code || '',
            description: toItem.description,
            changes,
          });
        }
      }
    }

    // Find removed
    for (const [key, fromItem] of fromMap) {
      if (!toMap.has(key)) {
        removed.push({
          itemCode: fromItem.item_code || '',
          description: fromItem.description,
          quantity: Number(fromItem.quantity),
          rate: Number(fromItem.rate),
          amount: Number(fromItem.amount),
          category: fromItem.category || '',
        });
      }
    }

    return apiResponse.success(res, {
      from: { id: fromBoq[0].id, version: fromBoq[0].version, title: fromBoq[0].title },
      to: { id: toBoq[0].id, version: toBoq[0].version, title: toBoq[0].title },
      summary: {
        added: added.length,
        removed: removed.length,
        modified: modified.length,
        unchanged: toMap.size - modified.length - added.length,
      },
      added,
      removed,
      modified,
    });
  } catch (error) {
    log.error('Failed to compare BOQ versions', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
