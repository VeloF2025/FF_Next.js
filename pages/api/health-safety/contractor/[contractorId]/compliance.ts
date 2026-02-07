/**
 * Contractor H&S Compliance API
 *
 * GET  /api/health-safety/contractor/[contractorId]/compliance - Get compliance record
 * PUT  /api/health-safety/contractor/[contractorId]/compliance - Update compliance
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { calculateContractorHSScore } from '@/modules/health-safety/services/scoringService';
import type { HSScoreInput } from '@/modules/health-safety/types/scoring.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Contractor ID is required');
  }

  try {
    switch (req.method) {
      case 'GET':
        return handleGet(contractorId, res);
      case 'PUT':
        return handlePut(contractorId, req, res);
      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
    }
  } catch (error) {
    log.error('[H&S Contractor Compliance API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

async function handleGet(contractorId: string, res: NextApiResponse) {
  // Get contractor info
  const [contractor] = await sql`
    SELECT id, company_name, status FROM contractors WHERE id = ${contractorId}
  `;

  if (!contractor) {
    return apiResponse.notFound(res, 'Contractor', contractorId);
  }

  // Get compliance record
  const [compliance] = await sql`
    SELECT * FROM hs_contractor_compliance WHERE contractor_id = ${contractorId}
  `;

  // Get documents
  const documents = await sql`
    SELECT * FROM hs_contractor_documents
    WHERE contractor_id = ${contractorId}
    ORDER BY document_type, created_at DESC
  `;

  // Calculate document status
  const validDocs = documents.filter(
    (d: any) => d.status === 'valid' && (!d.expiry_date || new Date(d.expiry_date) > new Date())
  ).length;
  const totalRequiredDocs = 5; // letter_of_good_standing, liability_insurance, safety_plan, etc.

  // Get incident stats (from maintenance tickets with H&S types)
  const [incidentStats] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE t.created_at > NOW() - INTERVAL '12 months')::int as total_incidents,
      COUNT(*) FILTER (WHERE hd.severity = 'critical' AND t.created_at > NOW() - INTERVAL '12 months')::int as critical_incidents,
      COUNT(*) FILTER (WHERE t.status = 'open' OR t.status = 'in_progress')::int as open_incidents
    FROM tickets t
    LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    WHERE t.contractor_id = ${contractorId}
    AND t.ticket_type IN ('hse_incident', 'hse_near_miss')
  `;

  // Get training status (simplified - would need actual training tracking)
  const trainingStatus = {
    height_work: compliance?.training_records?.height_work || false,
    first_aid: compliance?.training_records?.first_aid || false,
    fire_fighting: compliance?.training_records?.fire_fighting || false,
    induction: compliance?.training_records?.induction || false,
  };

  const validTraining = Object.values(trainingStatus).filter(Boolean).length;
  const totalTraining = 4;

  // Get corrective actions
  const [caStats] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE t.status != 'closed')::int as open_actions,
      COUNT(*) FILTER (WHERE t.status = 'closed')::int as closed_actions,
      COUNT(*) FILTER (WHERE t.status != 'closed' AND t.due_date < NOW())::int as overdue_actions
    FROM tickets t
    LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    WHERE t.contractor_id = ${contractorId}
    AND hd.corrective_action_required = true
  `;

  // Get recent audits (from project audits where contractor was involved)
  const [auditStats] = await sql`
    SELECT
      AVG(overall_score)::int as average_audit_score,
      COUNT(*)::int as total_audits
    FROM hs_project_audits a
    JOIN projects p ON p.id = a.project_id
    WHERE p.contractor_id = ${contractorId}
    AND a.status IN ('completed', 'requires_action')
    AND a.audit_date > NOW() - INTERVAL '12 months'
  `;

  // Calculate overall score
  const scoreInput: HSScoreInput = {
    documentScore: totalRequiredDocs > 0 ? (validDocs / totalRequiredDocs) * 100 : 0,
    incidentScore: calculateIncidentScore(incidentStats),
    trainingScore: totalTraining > 0 ? (validTraining / totalTraining) * 100 : 0,
    correctiveActionScore: calculateCAScore(caStats),
    auditScore: auditStats?.average_audit_score || 100,
  };

  const scoreResult = calculateContractorHSScore(scoreInput);

  // Determine overall status
  const overallStatus = scoreResult.ragStatus;

  return apiResponse.success(res, {
    contractor: {
      id: contractor.id,
      company_name: contractor.company_name,
      status: contractor.status,
    },
    compliance: compliance || {
      contractor_id: contractorId,
      overall_score: scoreResult.overallScore,
      rag_status: overallStatus,
      last_audit_date: null,
      next_audit_due: null,
    },
    score: scoreResult,
    documents: {
      items: documents,
      valid_count: validDocs,
      required_count: totalRequiredDocs,
      percentage: totalRequiredDocs > 0 ? Math.round((validDocs / totalRequiredDocs) * 100) : 0,
    },
    incidents: {
      total_12_months: incidentStats?.total_incidents || 0,
      critical_12_months: incidentStats?.critical_incidents || 0,
      open: incidentStats?.open_incidents || 0,
    },
    training: {
      status: trainingStatus,
      valid_count: validTraining,
      required_count: totalTraining,
      percentage: Math.round((validTraining / totalTraining) * 100),
    },
    corrective_actions: {
      open: caStats?.open_actions || 0,
      closed: caStats?.closed_actions || 0,
      overdue: caStats?.overdue_actions || 0,
    },
    audits: {
      average_score: auditStats?.average_audit_score || null,
      total_12_months: auditStats?.total_audits || 0,
    },
  });
}

async function handlePut(contractorId: string, req: NextApiRequest, res: NextApiResponse) {
  const { training_records, notes, next_audit_due } = req.body;

  // Verify contractor exists
  const [contractor] = await sql`
    SELECT id, company_name FROM contractors WHERE id = ${contractorId}
  `;

  if (!contractor) {
    return apiResponse.notFound(res, 'Contractor', contractorId);
  }

  // Upsert compliance record
  const [compliance] = await sql`
    INSERT INTO hs_contractor_compliance (contractor_id, training_records, notes, next_audit_due)
    VALUES (
      ${contractorId},
      ${training_records ? JSON.stringify(training_records) : '{}'}::jsonb,
      ${notes || null},
      ${next_audit_due || null}
    )
    ON CONFLICT (contractor_id)
    DO UPDATE SET
      training_records = COALESCE(${training_records ? JSON.stringify(training_records) : null}::jsonb, hs_contractor_compliance.training_records),
      notes = COALESCE(${notes}, hs_contractor_compliance.notes),
      next_audit_due = COALESCE(${next_audit_due}, hs_contractor_compliance.next_audit_due),
      updated_at = NOW()
    RETURNING *
  `;

  // Recalculate score
  await recalculateComplianceScore(contractorId);

  // Log activity
  await sql`
    INSERT INTO hs_activity_log (entity_type, entity_id, action, details)
    VALUES ('contractor_compliance', ${compliance.id}, 'updated', ${JSON.stringify({
      contractor_id: contractorId,
      company_name: contractor.company_name,
    })}::jsonb)
  `;

  return apiResponse.success(res, compliance);
}

// Helper functions
function calculateIncidentScore(stats: any): number {
  if (!stats) return 100;

  const { total_incidents = 0, critical_incidents = 0 } = stats;

  // Deduct points for incidents
  let score = 100;
  score -= total_incidents * 5; // -5 per incident
  score -= critical_incidents * 20; // Additional -20 for critical

  return Math.max(0, score);
}

function calculateCAScore(stats: any): number {
  if (!stats) return 100;

  const { open_actions = 0, closed_actions = 0, overdue_actions = 0 } = stats;
  const total = open_actions + closed_actions;

  if (total === 0) return 100;

  // Completion rate with penalty for overdue
  const completionRate = (closed_actions / total) * 100;
  const overduePenalty = overdue_actions * 10;

  return Math.max(0, completionRate - overduePenalty);
}

async function recalculateComplianceScore(contractorId: string) {
  // This would recalculate and update the stored score
  // For now, scores are calculated on-the-fly in GET
  // Could be called from a cron job or after document updates
}

export default withAuth(handler);
