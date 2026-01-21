/**
 * Single Budget Template API
 * GET /api/procurement/budget/templates/[id] - Get template details
 * PUT /api/procurement/budget/templates/[id] - Update template
 * DELETE /api/procurement/budget/templates/[id] - Delete template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Template ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(id, res);
    case 'PUT':
      return handlePut(id, req, res);
    case 'DELETE':
      return handleDelete(id, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
  }
}

async function handleGet(id: string, res: NextApiResponse) {
  try {
    const template = await sql`
      SELECT * FROM v_budget_templates_summary WHERE id = ${id}::UUID
    `;

    if (template.length === 0) {
      return apiResponse.notFound(res, 'Template', id);
    }

    const categories = await sql`
      SELECT * FROM budget_template_categories
      WHERE template_id = ${id}::UUID
      ORDER BY sort_order
    `;

    return apiResponse.success(res, {
      ...template[0],
      categories,
    });
  } catch (error) {
    log.error('Template GET error', { error, module: 'procurement:budget' });
    return apiResponse.internalError(res, error);
  }
}

async function handlePut(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const data = req.body;

    // Check if template exists
    const existing = await sql`
      SELECT id, is_system FROM budget_templates WHERE id = ${id}::UUID
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Template', id);
    }

    // System templates can only have limited updates
    const existingRow = existing[0]!;
    if (existingRow.is_system && (data.code || data.template_type)) {
      return apiResponse.badRequest(res, 'Cannot change code or type of system templates');
    }

    const result = await sql`
      UPDATE budget_templates SET
        code = COALESCE(${data.code?.toUpperCase() || null}, code),
        name = COALESCE(${data.name || null}, name),
        description = COALESCE(${data.description || null}, description),
        template_type = COALESCE(${data.template_type || null}, template_type),
        default_currency = COALESCE(${data.default_currency || null}, default_currency),
        default_enforce_budget = COALESCE(${data.default_enforce_budget ?? null}::BOOLEAN, default_enforce_budget),
        default_allow_override = COALESCE(${data.default_allow_override ?? null}::BOOLEAN, default_allow_override),
        default_warning_threshold = COALESCE(${data.default_warning_threshold ?? null}::DECIMAL, default_warning_threshold),
        default_critical_threshold = COALESCE(${data.default_critical_threshold ?? null}::DECIMAL, default_critical_threshold),
        is_active = COALESCE(${data.is_active ?? null}::BOOLEAN, is_active),
        updated_at = NOW()
      WHERE id = ${id}::UUID
      RETURNING *
    `;

    // Update categories if provided
    if (data.categories && Array.isArray(data.categories)) {
      // Delete existing categories
      await sql`DELETE FROM budget_template_categories WHERE template_id = ${id}::UUID`;

      // Insert new categories
      for (const [index, cat] of data.categories.entries()) {
        await sql`
          INSERT INTO budget_template_categories (
            template_id,
            category_code,
            category_name,
            description,
            default_percent,
            default_amount,
            sort_order,
            color
          ) VALUES (
            ${id}::UUID,
            ${cat.category_code.toUpperCase()},
            ${cat.category_name},
            ${cat.description || null},
            ${cat.default_percent ?? null},
            ${cat.default_amount ?? null},
            ${cat.sort_order ?? index + 1},
            ${cat.color || null}
          )
        `;
      }
    }

    const categories = await sql`
      SELECT * FROM budget_template_categories WHERE template_id = ${id}::UUID ORDER BY sort_order
    `;

    return apiResponse.success(res, {
      ...result[0],
      categories,
    });
  } catch (error) {
    log.error('Template PUT error', { error, module: 'procurement:budget' });
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(id: string, res: NextApiResponse) {
  try {
    // Check if template exists
    const existing = await sql`
      SELECT id, is_system FROM budget_templates WHERE id = ${id}::UUID
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Template', id);
    }

    const existingTemplate = existing[0]!;
    if (existingTemplate.is_system) {
      return apiResponse.badRequest(res, 'Cannot delete system templates');
    }

    await sql`DELETE FROM budget_templates WHERE id = ${id}::UUID`;

    return apiResponse.success(res, { message: 'Template deleted' });
  } catch (error) {
    log.error('Template DELETE error', { error, module: 'procurement:budget' });
    return apiResponse.internalError(res, error);
  }
}
