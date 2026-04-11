/**
 * Risk Register API
 *
 * GET  /api/health-safety/risks - List risks with filters
 * POST /api/health-safety/risks - Create new risk entry
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET':
        return handleGet(req, res);
      case 'POST':
        return handlePost(req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    log.error('[Risk Register API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const { project_id, risk_level, category, status = 'active', limit = '100', offset = '0' } = req.query;
  const lim = parseInt(limit as string);
  const off = parseInt(offset as string);

  let risks;
  if (project_id && risk_level) {
    risks = await sql`
      SELECT r.*, p.project_name,
             CONCAT(u.first_name, ' ', u.last_name) as responsible_person_name
      FROM hs_risk_register r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.responsible_person
      WHERE r.project_id = ${project_id} AND r.risk_level = ${risk_level}
        AND r.status = ${status}
      ORDER BY r.risk_score DESC, r.created_at DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else if (project_id) {
    risks = await sql`
      SELECT r.*, p.project_name,
             CONCAT(u.first_name, ' ', u.last_name) as responsible_person_name
      FROM hs_risk_register r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.responsible_person
      WHERE r.project_id = ${project_id} AND r.status = ${status}
      ORDER BY r.risk_score DESC, r.created_at DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else if (risk_level) {
    risks = await sql`
      SELECT r.*, p.project_name,
             CONCAT(u.first_name, ' ', u.last_name) as responsible_person_name
      FROM hs_risk_register r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.responsible_person
      WHERE r.risk_level = ${risk_level} AND r.status = ${status}
      ORDER BY r.risk_score DESC, r.created_at DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  } else {
    risks = await sql`
      SELECT r.*, p.project_name,
             CONCAT(u.first_name, ' ', u.last_name) as responsible_person_name
      FROM hs_risk_register r
      LEFT JOIN projects p ON p.id = r.project_id
      LEFT JOIN users u ON u.id = r.responsible_person
      WHERE r.status = ${status}
      ORDER BY r.risk_score DESC, r.created_at DESC
      LIMIT ${lim} OFFSET ${off}
    `;
  }

  // Matrix summary — count risks by likelihood x severity
  const matrix = await sql`
    SELECT likelihood, severity, COUNT(*)::int as count
    FROM hs_risk_register
    WHERE status = 'active'
    GROUP BY likelihood, severity
  `;

  // Stats
  const [stats] = await sql`
    SELECT
      COUNT(*)::int as total,
      COUNT(*) FILTER (WHERE risk_level = 'extreme')::int as extreme,
      COUNT(*) FILTER (WHERE risk_level = 'high')::int as high,
      COUNT(*) FILTER (WHERE risk_level = 'medium')::int as medium,
      COUNT(*) FILTER (WHERE risk_level = 'low')::int as low,
      COUNT(*) FILTER (WHERE review_date < CURRENT_DATE)::int as overdue_review
    FROM hs_risk_register
    WHERE status = 'active'
  `;

  return apiResponse.success(res, { risks, matrix, stats });
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const userId = (req as any).userId || null;
  const body = req.body;

  if (!body.hazard_description || !body.risk_category || !body.likelihood || !body.severity) {
    return apiResponse.badRequest(res, 'hazard_description, risk_category, likelihood, and severity are required');
  }

  const riskRows = await sql`
    INSERT INTO hs_risk_register (
      project_id, hazard_description, risk_category,
      site_location, activity_description, persons_at_risk,
      likelihood, severity, existing_controls,
      residual_likelihood, residual_severity, additional_controls,
      responsible_person, review_date, regulation_reference,
      created_by
    ) VALUES (
      ${body.project_id || null},
      ${body.hazard_description},
      ${body.risk_category},
      ${body.site_location || null},
      ${body.activity_description || null},
      ${body.persons_at_risk || null},
      ${body.likelihood},
      ${body.severity},
      ${body.existing_controls || null},
      ${body.residual_likelihood || null},
      ${body.residual_severity || null},
      ${body.additional_controls || null},
      ${body.responsible_person || null},
      ${body.review_date || null},
      ${body.regulation_reference || null},
      ${userId}
    )
    RETURNING *
  `;
  const risk = riskRows[0]!;

  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, actor_id, details)
    VALUES ('risk', ${risk.id}, 'created', ${userId}, ${JSON.stringify({
      hazard: body.hazard_description,
      category: body.risk_category,
      risk_score: body.likelihood * body.severity,
    })}::jsonb)
  `;

  return apiResponse.created(res, risk);
}

export default withAuth(handler);
