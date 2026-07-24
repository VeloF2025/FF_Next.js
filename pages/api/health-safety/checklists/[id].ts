/**
 * H&S Checklist Template Detail API
 *
 * GET    /api/health-safety/checklists/[id] - Get template with items
 * PUT    /api/health-safety/checklists/[id] - Update template
 * DELETE /api/health-safety/checklists/[id] - Delete template (soft)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';
const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Template ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(id, res);
      case 'PUT':
        return handlePut(id, req, res);
      case 'DELETE':
        return handleDelete(id, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
    }
  } catch (error) {
    log.error('[H&S Checklist Detail API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  const templateRows = await sql`
    SELECT
      t.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', i.id,
            'item_text', i.item_text,
            'category', i.category,
            'severity', i.severity,
            'regulation_reference', i.regulation_reference,
            'sort_order', i.sort_order,
            'is_mandatory', i.is_mandatory,
            'requires_photo', i.requires_photo
          ) ORDER BY i.sort_order
        ) FILTER (WHERE i.id IS NOT NULL),
        '[]'
      ) as items
    FROM hs_checklist_templates t
    LEFT JOIN hs_checklist_items i ON i.template_id = t.id
    WHERE t.id = ${id}
    GROUP BY t.id
  `;
  const template = templateRows[0]!;

  if (!template) {
    return apiResponse.notFound(res, 'Checklist template', id);
  }

  return apiResponse.success(res, template);
}

async function handlePut(id: string, req: NextApiRequest, res: NextApiResponse) {
  const { name, category, description, is_active, items } = req.body;

  // Check template exists
  const [existing] = await sql`
    SELECT id, is_default FROM hs_checklist_templates WHERE id = ${id}
  `;

  if (!existing) {
    return apiResponse.notFound(res, 'Checklist template', id);
  }

  // Update template
  const templateRows = await sql`
    UPDATE hs_checklist_templates
    SET
      name = COALESCE(${name}, name),
      category = COALESCE(${category}, category),
      description = COALESCE(${description}, description),
      is_active = COALESCE(${is_active}, is_active),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  const template = templateRows[0]!;

  // Update items if provided
  if (items && Array.isArray(items)) {
    // Delete existing items
    await sql`DELETE FROM hs_checklist_items WHERE template_id = ${id}`;

    // Insert new items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await sql`
        INSERT INTO hs_checklist_items (
          template_id, item_text, category, severity,
          regulation_reference, sort_order, is_mandatory, requires_photo
        ) VALUES (
          ${id},
          ${item.item_text},
          ${item.category || template.category},
          ${item.severity || 'medium'},
          ${item.regulation_reference || null},
          ${item.sort_order ?? i},
          ${item.is_mandatory ?? true},
          ${item.requires_photo ?? false}
        )
      `;
    }
  }

  await logHsActivity({
    activityType: 'checklist_template_updated',
    entityType: 'checklist_template',
    entityId: id,
    description: `Checklist template updated: ${name}`,
    metadata: { category },
    user: getAuthUser(req),
  });

  return apiResponse.success(res, template);
}

async function handleDelete(id: string, req: NextApiRequest, res: NextApiResponse) {
  // Check template exists and is not default
  const [existing] = await sql`
    SELECT id, is_default, name FROM hs_checklist_templates WHERE id = ${id}
  `;

  if (!existing) {
    return apiResponse.notFound(res, 'Checklist template', id);
  }

  if (existing.is_default) {
    return apiResponse.badRequest(res, 'Cannot delete default checklist templates');
  }

  // Soft delete by setting is_active = false
  await sql`
    UPDATE hs_checklist_templates
    SET is_active = false, updated_at = NOW()
    WHERE id = ${id}
  `;

  await logHsActivity({
    activityType: 'checklist_template_deleted',
    entityType: 'checklist_template',
    entityId: id,
    description: `Checklist template deactivated: ${existing.name}`,
    user: getAuthUser(req),
  });

  return apiResponse.success(res, { message: 'Template deactivated', id });
}

export default withHsPermission(handler);
