/**
 * Apply Budget Template API
 * POST /api/procurement/budget/templates/apply - Create budget from template
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';

const sql = neon(process.env.DATABASE_URL!);

interface ApplyTemplateRequest {
  template_id: string;
  project_id: string;
  total_budget: number;
  created_by?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res);
  }

  try {
    const data: ApplyTemplateRequest = req.body;

    if (!data.template_id || !data.project_id || !data.total_budget) {
      return apiResponse.badRequest(res, 'template_id, project_id, and total_budget are required');
    }

    if (data.total_budget <= 0) {
      return apiResponse.badRequest(res, 'total_budget must be greater than 0');
    }

    // Check if project exists
    const project = await sql`
      SELECT id, project_name FROM projects WHERE id = ${data.project_id}::UUID
    `;

    if (project.length === 0) {
      return apiResponse.notFound(res, 'Project', data.project_id);
    }

    // Check if project already has a budget
    const existingBudget = await sql`
      SELECT id FROM project_budgets WHERE project_id = ${data.project_id}::UUID
    `;

    if (existingBudget.length > 0) {
      return apiResponse.badRequest(res, 'Project already has a budget. Delete existing budget first.');
    }

    // Check if template exists
    const template = await sql`
      SELECT * FROM budget_templates WHERE id = ${data.template_id}::UUID AND is_active = true
    `;

    if (template.length === 0) {
      return apiResponse.notFound(res, 'Template', data.template_id);
    }

    // Get template categories
    const templateCategories = await sql`
      SELECT * FROM budget_template_categories
      WHERE template_id = ${data.template_id}::UUID
      ORDER BY sort_order
    `;

    // Create budget
    const budget = await sql`
      INSERT INTO project_budgets (
        project_id,
        source_type,
        total_budget,
        available_budget,
        currency,
        enforce_budget,
        allow_override,
        alert_threshold_warning,
        alert_threshold_critical,
        status,
        created_by
      ) VALUES (
        ${data.project_id}::UUID,
        'manual',
        ${data.total_budget},
        ${data.total_budget},
        ${template[0].default_currency},
        ${template[0].default_enforce_budget},
        ${template[0].default_allow_override},
        ${template[0].default_warning_threshold},
        ${template[0].default_critical_threshold},
        'draft',
        ${data.created_by || null}
      )
      RETURNING *
    `;

    const budgetId = budget[0].id;

    // Create categories from template
    const createdCategories = [];
    for (const cat of templateCategories) {
      const allocatedAmount = cat.default_percent
        ? Math.round(data.total_budget * parseFloat(cat.default_percent as string) / 100 * 100) / 100
        : parseFloat(cat.default_amount as string) || 0;

      const category = await sql`
        INSERT INTO budget_categories (
          project_budget_id,
          category_code,
          category_name,
          allocated_amount,
          available_amount,
          sort_order
        ) VALUES (
          ${budgetId}::UUID,
          ${cat.category_code},
          ${cat.category_name},
          ${allocatedAmount},
          ${allocatedAmount},
          ${cat.sort_order}
        )
        RETURNING *
      `;

      createdCategories.push(category[0]);
    }

    // Update template usage
    await sql`
      UPDATE budget_templates SET
        usage_count = usage_count + 1,
        last_used_at = NOW()
      WHERE id = ${data.template_id}::UUID
    `;

    // Create initial transaction
    await sql`
      INSERT INTO budget_transactions (
        project_budget_id,
        transaction_type,
        source_type,
        amount,
        description,
        created_by
      ) VALUES (
        ${budgetId}::UUID,
        'allocation',
        'template',
        ${data.total_budget},
        ${`Budget created from template: ${template[0].name}`},
        ${data.created_by || 'system'}
      )
    `;

    return apiResponse.created(res, {
      budget: budget[0],
      categories: createdCategories,
      template: template[0],
      message: `Budget created from template "${template[0].name}"`,
    });
  } catch (error) {
    console.error('Apply Template error:', error);
    return apiResponse.internalError(res, error);
  }
}
