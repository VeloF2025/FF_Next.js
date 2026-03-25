/**
 * Budget Templates API
 * GET /api/procurement/budget/templates - List templates
 * POST /api/procurement/budget/templates - Create template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { is_active = 'true', template_type, include_categories = 'true' } = req.query;

    // Get templates with summary
    let templates = await sql`
      SELECT /* TODO: specify columns */ * FROM v_budget_templates_summary
      WHERE (${is_active === 'all'} OR is_active = ${is_active === 'true'})
      AND (${!template_type}::boolean OR template_type = ${template_type as string})
      ORDER BY is_system DESC, usage_count DESC, name
    `;

    // Include categories if requested
    if (include_categories === 'true') {
      const templateIds = templates.map(t => t.id);

      if (templateIds.length > 0) {
        const categories = await sql`
          SELECT id, template_id, category_code, category_name, description,
                 default_percent, default_amount, sort_order, color
          FROM budget_template_categories
          WHERE template_id = ANY(${templateIds}::UUID[])
          ORDER BY sort_order
        `;

        // Group categories by template
        const categoryMap = categories.reduce((acc, cat) => {
          const templateId = cat.template_id as string;
          if (!acc[templateId]) acc[templateId] = [];
          acc[templateId].push(cat);
          return acc;
        }, {} as Record<string, typeof categories>);

        templates = templates.map(t => ({
          ...t,
          categories: categoryMap[t.id as string] || [],
        }));
      }
    }

    return apiResponse.success(res, templates);
  } catch (error) {
    log.error('Templates GET error', { error, module: 'procurement:budget' });
    return apiResponse.internalError(res, error);
  }
}

interface CreateTemplateRequest {
  code: string;
  name: string;
  description?: string;
  template_type?: string;
  default_currency?: string;
  default_enforce_budget?: boolean;
  default_allow_override?: boolean;
  default_warning_threshold?: number;
  default_critical_threshold?: number;
  categories?: Array<{
    category_code: string;
    category_name: string;
    description?: string;
    default_percent?: number;
    default_amount?: number;
    sort_order?: number;
    color?: string;
  }>;
  created_by?: string;
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const data: CreateTemplateRequest = req.body;

    if (!data.code || !data.name) {
      return apiResponse.badRequest(res, 'Code and name are required');
    }

    // Check for duplicate code
    const existing = await sql`
      SELECT id FROM budget_templates WHERE code = ${data.code}
    `;

    if (existing.length > 0) {
      return apiResponse.badRequest(res, `Template with code "${data.code}" already exists`);
    }

    // Create template
    const template = await sql`
      INSERT INTO budget_templates (
        code,
        name,
        description,
        template_type,
        default_currency,
        default_enforce_budget,
        default_allow_override,
        default_warning_threshold,
        default_critical_threshold,
        created_by
      ) VALUES (
        ${data.code.toUpperCase()},
        ${data.name},
        ${data.description || null},
        ${data.template_type || 'project'},
        ${data.default_currency || 'ZAR'},
        ${data.default_enforce_budget ?? true},
        ${data.default_allow_override ?? false},
        ${data.default_warning_threshold ?? 80},
        ${data.default_critical_threshold ?? 95},
        ${data.created_by || null}
      )
      RETURNING id, code, name, description, template_type, default_currency,
                default_enforce_budget, default_allow_override,
                default_warning_threshold, default_critical_threshold,
                is_system, is_active, usage_count, created_by, created_at, updated_at
    `;

    const templateRow = template[0]!;
    const templateId = templateRow.id;

    // Create categories if provided
    if (data.categories && data.categories.length > 0) {
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
            ${templateId}::UUID,
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

    // Get complete template
    const result = await sql`
      SELECT /* TODO: specify columns */ * FROM v_budget_templates_summary WHERE id = ${templateId}::UUID
    `;

    const categories = await sql`
      SELECT * FROM budget_template_categories WHERE template_id = ${templateId}::UUID ORDER BY sort_order
    `;

    return apiResponse.created(res, {
      ...result[0]!,
      categories,
    });
  } catch (error) {
    log.error('Templates POST error', { error, module: 'procurement:budget' });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
