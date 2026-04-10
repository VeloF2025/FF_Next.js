/**
 * H&S Checklist Templates API
 *
 * GET  /api/health-safety/checklists - List all templates
 * POST /api/health-safety/checklists - Create new template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';

import { withAuth } from '@/lib/auth';
const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    log.error('[H&S Checklists API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { category, active_only = 'true', include_items = 'false' } = req.query;

  let templates;

  if (include_items === 'true') {
    // Get templates with their items
    templates = await sql`
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
        ) as items,
        COUNT(i.id)::int as item_count
      FROM hs_checklist_templates t
      LEFT JOIN hs_checklist_items i ON i.template_id = t.id
      WHERE (${active_only}::boolean = false OR t.is_active = true)
      AND (${category}::text IS NULL OR t.category = ${category})
      GROUP BY t.id
      ORDER BY t.is_default DESC, t.name
    `;
  } else {
    // Get templates with item count only
    templates = await sql`
      SELECT
        t.*,
        COUNT(i.id)::int as item_count
      FROM hs_checklist_templates t
      LEFT JOIN hs_checklist_items i ON i.template_id = t.id
      WHERE (${active_only}::boolean = false OR t.is_active = true)
      AND (${category}::text IS NULL OR t.category = ${category})
      GROUP BY t.id
      ORDER BY t.is_default DESC, t.name
    `;
  }

  return apiResponse.success(res, {
    templates,
    count: templates.length,
  });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const { name, category, description, is_default = false, items = [] } = req.body;

  if (!name || !category) {
    return apiResponse.badRequest(res, 'Name and category are required');
  }

  // Create template
  const templateRows = await sql`
    INSERT INTO hs_checklist_templates (name, category, description, is_default, is_active)
    VALUES (${name}, ${category}, ${description || null}, ${is_default}, true)
    RETURNING *
  `;
  const template = templateRows[0]!;

  // Create items if provided
  if (items.length > 0) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      await sql`
        INSERT INTO hs_checklist_items (
          template_id, item_text, category, severity,
          regulation_reference, sort_order, is_mandatory, requires_photo
        ) VALUES (
          ${template.id},
          ${item.item_text},
          ${item.category || category},
          ${item.severity || 'medium'},
          ${item.regulation_reference || null},
          ${item.sort_order ?? i},
          ${item.is_mandatory ?? true},
          ${item.requires_photo ?? false}
        )
      `;
    }
  }

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('checklist_template', ${template.id}, 'created', ${JSON.stringify({ name, category })}::jsonb)
  `;

  return apiResponse.created(res, template);
}

export default withAuth(handler);
