/**
 * H&S Audit Detail API
 *
 * GET  /api/health-safety/audits/[auditId] - Get audit with responses
 * PUT  /api/health-safety/audits/[auditId] - Update audit (status, score, responses)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const getSql = () => neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { auditId } = req.query;

  if (!auditId || typeof auditId !== 'string') {
    return apiResponse.badRequest(res, 'Audit ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(auditId, res);
      case 'PUT':
        return handlePut(auditId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    log.error('HSAuditDetail', { error, auditId });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(auditId: string, res: NextApiResponse) {
  const sql = getSql();

  const [audit] = await sql`
    SELECT
      a.*,
      s.full_name as auditor_name,
      p.project_name
    FROM hs_project_audits a
    LEFT JOIN staff s ON s.id = a.auditor_id
    LEFT JOIN projects p ON p.id = a.project_id
    WHERE a.id = ${auditId}
  `;

  if (!audit) {
    return apiResponse.notFound(res, 'Audit', auditId);
  }

  // Get responses with checklist item details
  const responses = await sql`
    SELECT
      r.id,
      r.audit_id,
      r.checklist_item_id,
      r.response,
      r.notes,
      r.photo_url,
      r.created_at,
      i.item_text,
      i.category,
      i.severity,
      i.regulation_reference,
      i.is_mandatory,
      i.requires_photo
    FROM hs_audit_responses r
    LEFT JOIN hs_checklist_items i ON i.id = r.checklist_item_id
    WHERE r.audit_id = ${auditId}
    ORDER BY i.sort_order
  `;

  // Calculate summary
  const summary = {
    total: responses.length,
    passed: responses.filter((r: any) => r.response === 'pass').length,
    failed: responses.filter((r: any) => r.response === 'fail').length,
    na: responses.filter((r: any) => r.response === 'na').length,
    not_checked: responses.filter((r: any) => r.response === 'not_checked').length,
    critical_failures: responses.filter(
      (r: any) => r.response === 'fail' && r.severity === 'critical'
    ).length,
  };

  // Group by category
  const byCategory: Record<string, any> = {};
  for (const r of responses) {
    const cat = (r as any).category || 'uncategorized';
    if (!byCategory[cat]) {
      byCategory[cat] = { items: [], passed: 0, failed: 0, total: 0 };
    }
    byCategory[cat].items.push(r);
    byCategory[cat].total++;
    if ((r as any).response === 'pass') byCategory[cat].passed++;
    if ((r as any).response === 'fail') byCategory[cat].failed++;
  }

  return apiResponse.success(res, {
    audit,
    responses,
    summary,
    by_category: byCategory,
  });
}

async function handlePut(auditId: string, req: NextApiRequest, res: NextApiResponse) {
  const sql = getSql();
  const { status, notes, responses, complete = false } = req.body;

  const [existing] = await sql`
    SELECT id, project_id, status, overall_score, rag_status, completed_at
    FROM hs_project_audits WHERE id = ${auditId}
  `;

  if (!existing) {
    return apiResponse.notFound(res, 'Audit', auditId);
  }

  // Update responses if provided
  if (responses && Array.isArray(responses)) {
    for (const r of responses) {
      await sql`
        UPDATE hs_audit_responses
        SET
          response = COALESCE(${r.response}, response),
          notes = COALESCE(${r.notes}, notes),
          photo_url = COALESCE(${r.photo_url}, photo_url)
        WHERE id = ${r.id}
      `;
    }
  }

  // Calculate score if completing
  let overallScore = existing.overall_score;
  let ragStatus = existing.rag_status;

  if (complete || status === 'completed') {
    const allResponses = await sql`
      SELECT r.response, i.severity
      FROM hs_audit_responses r
      LEFT JOIN hs_checklist_items i ON i.id = r.checklist_item_id
      WHERE r.audit_id = ${auditId}
    `;

    const applicable = allResponses.filter(
      (r: any) => r.response !== 'not_checked' && r.response !== 'na'
    );

    if (applicable.length > 0) {
      let weightedPassed = 0;
      let weightedTotal = 0;

      for (const r of applicable) {
        const weight =
          (r as any).severity === 'critical' ? 4
            : (r as any).severity === 'high' ? 3
              : (r as any).severity === 'medium' ? 2
                : 1;
        weightedTotal += weight;
        if ((r as any).response === 'pass') weightedPassed += weight;
      }

      overallScore = Math.round((weightedPassed / weightedTotal) * 100);

      const criticalFailures = applicable.filter(
        (r: any) => r.response === 'fail' && r.severity === 'critical'
      ).length;

      if (criticalFailures > 0) {
        overallScore = Math.min(overallScore, 79);
      }

      ragStatus = overallScore < 50 ? 'red' : overallScore < 80 ? 'amber' : 'green';
    }
  }

  const newStatus = complete ? 'completed' : status || existing.status;
  const [failCount] = await sql`
    SELECT COUNT(*)::int as count FROM hs_audit_responses
    WHERE audit_id = ${auditId} AND response = 'fail'
  `;
  const hasFailures = failCount.count > 0;
  const finalStatus = newStatus === 'completed' && hasFailures ? 'requires_action' : newStatus;

  const completedAt = (finalStatus === 'completed' || finalStatus === 'requires_action')
    ? new Date().toISOString()
    : existing.completed_at;

  const [audit] = await sql`
    UPDATE hs_project_audits
    SET
      status = ${finalStatus},
      overall_score = ${overallScore},
      rag_status = ${ragStatus},
      notes = COALESCE(${notes || null}, notes),
      completed_at = ${completedAt}
    WHERE id = ${auditId}
    RETURNING *
  `;

  // Update next audit due date on completion
  if (finalStatus === 'completed' || finalStatus === 'requires_action') {
    const [config] = await sql`
      SELECT audit_frequency, custom_frequency_days
      FROM hs_project_config
      WHERE project_id = ${existing.project_id}
    `;

    if (config) {
      const freqMap: Record<string, number> = { daily: 1, weekly: 7, fortnightly: 14, monthly: 30 };
      const days = config.audit_frequency === 'custom'
        ? (config.custom_frequency_days || 7)
        : (freqMap[config.audit_frequency] || 7);

      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + days);

      await sql`
        UPDATE hs_project_config
        SET next_audit_due = ${nextDue.toISOString().split('T')[0]}, updated_at = NOW()
        WHERE project_id = ${existing.project_id}
      `;
    }
  }

  return apiResponse.success(res, audit);
}

export default withAuth(handler);
