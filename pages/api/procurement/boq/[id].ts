import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

// Infer stock category from item code/description (fallback when boq_items.category is null)
function inferCategory(code: string, description: string): string {
  const text = `${code} ${description}`.toLowerCase();
  if (text.includes('ont') || text.includes('drop cable') || text.includes('power cable')) return 'activations';
  if (/cable|fibre|fiber|aerial|adss|trench|mb-sm|dead-?end|tangent|trunking|wall.?attach/.test(text)) return 'stringing';
  if (/connector|lcapc|scapc|pigtail|midcoupler|coupler|splitter|splice|protector|encl/.test(text)) return 'optics';
  if (/pole|creosote|stay|guy|mast|hook|bracket|slack|buckle|strapping|coach/.test(text)) return 'poles';
  if (/conduit|pipe|hdpe|duct|coupling|endcap|manhole|chamber|micro.?duct|cement|tar|bitum/.test(text)) return 'backhaul';
  if (/tool|wrench/.test(text)) return 'tools';
  if (text.startsWith('cons-') || /consumable|label|tape|alcohol|wipe|kim|clip|screw|gland|spray|wallplug/.test(text)) return 'consumable';
  return 'uncategorized';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'BOQ ID is required');
  }

  if (req.method === 'GET') {
    return handleGet(req, res, id);
  } else if (req.method === 'PUT') {
    return handlePut(req, res, id);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res, id);
  } else {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT', 'DELETE']);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    // Get BOQ details
    const boqResult = await sql`
      SELECT * FROM boqs WHERE id::text = ${id}
    `;

    if (boqResult.length === 0) {
      return apiResponse.notFound(res, 'BOQ', id);
    }

    const boq = boqResult[0]!;

    // Get BOQ items with budget category names
    const items = await sql`
      SELECT bi.*, bc.category_name as budget_category_name
      FROM boq_items bi
      LEFT JOIN budget_categories bc ON bi.budget_category_id = bc.id
      WHERE bi.boq_id::text = ${id}
      ORDER BY bi.line_number
    `;

    const transformedBoq = {
      id: boq.id,
      projectId: boq.project_id,
      title: boq.title || 'Untitled BOQ',
      description: boq.description || '',
      version: boq.version || 'V1',
      status: boq.status || 'draft',
      fileName: boq.file_name || boq.title,
      itemCount: boq.item_count || items.length,
      totalEstimatedValue: Number(boq.total_estimated_value) || 0,
      mappingStatus: boq.mapping_status || 'pending',
      uploadedBy: boq.uploaded_by || 'System',
      createdAt: boq.created_at,
      updatedAt: boq.updated_at,
      items: items.map((item: any) => ({
        id: item.id,
        lineNumber: Number(item.line_number) || 0,
        itemCode: item.item_code || '',
        description: item.description,
        quantity: Number(item.quantity) || 0,
        uom: item.uom || 'Each',
        unitPrice: Number(item.unit_price) || 0,
        totalPrice: Number(item.total_price) || 0,
        category: item.budget_category_name || item.category || 'Uncategorized',
        stockItemId: item.stock_item_id || null,
        stockMatchMethod: item.stock_match_method || null,
        stockMatchConfidence: item.stock_match_confidence != null ? Number(item.stock_match_confidence) : null,
      })),
    };

    return res.status(200).json(transformedBoq);
  } catch (error) {
    log.error('Failed to fetch BOQ', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    const { title, description, status } = req.body;

    const updated = await sql`
      UPDATE boqs
      SET
        title = COALESCE(${title}, title),
        description = COALESCE(${description}, description),
        status = COALESCE(${status}, status),
        updated_at = NOW()
      WHERE id::text = ${id}
      RETURNING *
    `;

    if (updated.length === 0) {
      return apiResponse.notFound(res, 'BOQ', id);
    }

    log.info('BOQ updated', { boqId: id });
    return apiResponse.success(res, { id, message: 'BOQ updated successfully' });
  } catch (error) {
    log.error('Failed to update BOQ', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(req: NextApiRequest, res: NextApiResponse, id: string) {
  try {
    // Delete BOQ items first
    await sql`DELETE FROM boq_items WHERE boq_id::text = ${id}`;

    // Delete BOQ
    const deleted = await sql`
      DELETE FROM boqs WHERE id::text = ${id}
      RETURNING id
    `;

    if (deleted.length === 0) {
      return apiResponse.notFound(res, 'BOQ', id);
    }

    log.info('BOQ deleted', { boqId: id });
    return apiResponse.success(res, { message: 'BOQ deleted successfully' });
  } catch (error) {
    log.error('Failed to delete BOQ', error);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
