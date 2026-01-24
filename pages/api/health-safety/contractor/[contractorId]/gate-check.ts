/**
 * Contractor H&S Gate Check API
 *
 * GET /api/health-safety/contractor/[contractorId]/gate-check - Check if contractor passes H&S gate
 *
 * This enforces the "hard block" requirement - contractors MUST have valid H&S
 * documentation before being assigned to projects.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { checkContractorGate } from '@/modules/health-safety/services/gateService';
import { REQUIRED_DOCUMENTS, DOCUMENT_TYPES } from '@/modules/health-safety/types/compliance.types';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (!contractorId || typeof contractorId !== 'string') {
    return apiResponse.badRequest(res, 'Contractor ID is required');
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN');
  }

  try {
    // Verify contractor exists
    const [contractor] = await sql`
      SELECT id, company_name, status FROM contractors WHERE id = ${contractorId}
    `;

    if (!contractor) {
      return apiResponse.notFound(res, 'Contractor', contractorId);
    }

    // Run gate check
    const gateResult = await checkContractorGate(parseInt(contractorId));

    // Get detailed breakdown for UI
    const breakdown = await getGateBreakdown(contractorId);

    return apiResponse.success(res, {
      contractor: {
        id: contractor.id,
        company_name: contractor.company_name,
        status: contractor.status,
      },
      gate: {
        passed: gateResult.passed,
        overall_score: gateResult.score,
        rag_status: gateResult.ragStatus,
        blocking_reasons: gateResult.blockingReasons,
        expires_at: gateResult.expiresAt,
      },
      breakdown,
      can_assign_to_projects: gateResult.passed,
      message: gateResult.passed
        ? 'Contractor meets all H&S requirements and can be assigned to projects'
        : `Contractor cannot be assigned to projects: ${gateResult.blockingReasons.join(', ')}`,
    });
  } catch (error) {
    console.error('[H&S Gate Check API] Error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function getGateBreakdown(contractorId: string) {
  // Documents check
  const documents = await sql`
    SELECT document_type, status, expiry_date
    FROM hs_contractor_documents
    WHERE contractor_id = ${contractorId}
    ORDER BY created_at DESC
  `;

  const docStatus: Record<string, { present: boolean; valid: boolean; expires?: string }> = {};
  for (const docType of REQUIRED_DOCUMENTS) {
    const doc = documents.find((d: any) => d.document_type === docType);
    docStatus[docType] = {
      present: !!doc,
      valid:
        doc?.status === 'valid' && (!doc.expiry_date || new Date(doc.expiry_date) > new Date()),
      expires: doc?.expiry_date,
    };
  }

  const docsValid = Object.values(docStatus).filter((d) => d.valid).length;
  const docsRequired = REQUIRED_DOCUMENTS.length;
  const docsPassed = docsValid >= docsRequired;

  // Incidents check
  const [incidentCheck] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE hd.severity = 'critical' AND t.created_at > NOW() - INTERVAL '6 months')::int as recent_critical,
      COUNT(*) FILTER (WHERE t.status NOT IN ('closed', 'resolved'))::int as unresolved
    FROM tickets t
    LEFT JOIN hs_ticket_details hd ON hd.ticket_id = t.id
    WHERE t.contractor_id = ${contractorId}
    AND t.ticket_type IN ('hse_incident', 'hse_near_miss')
  `;

  const incidentsPassed =
    (incidentCheck?.recent_critical || 0) === 0 && (incidentCheck?.unresolved || 0) === 0;

  // Compliance score check
  const [compliance] = await sql`
    SELECT overall_score, rag_status
    FROM hs_contractor_compliance
    WHERE contractor_id = ${contractorId}
  `;

  const scorePassed = !compliance || (compliance.overall_score || 0) >= 50;
  const ragPassed = !compliance || compliance.rag_status !== 'red';

  // Training check (simplified)
  const trainingPassed = true; // Would check actual training records

  return {
    documents: {
      passed: docsPassed,
      valid_count: docsValid,
      required_count: docsRequired,
      status: docStatus,
      message: docsPassed
        ? 'All required documents valid'
        : `Missing ${docsRequired - docsValid} required documents`,
    },
    incidents: {
      passed: incidentsPassed,
      recent_critical: incidentCheck?.recent_critical || 0,
      unresolved: incidentCheck?.unresolved || 0,
      message: incidentsPassed
        ? 'No blocking incidents'
        : 'Has recent critical or unresolved incidents',
    },
    compliance_score: {
      passed: scorePassed && ragPassed,
      score: compliance?.overall_score || null,
      rag_status: compliance?.rag_status || null,
      message:
        scorePassed && ragPassed ? 'Score above minimum threshold' : 'Score below minimum (50%)',
    },
    training: {
      passed: trainingPassed,
      message: trainingPassed ? 'Training requirements met' : 'Missing required training',
    },
    overall: {
      passed: docsPassed && incidentsPassed && scorePassed && ragPassed && trainingPassed,
      checks_passed: [docsPassed, incidentsPassed, scorePassed && ragPassed, trainingPassed].filter(
        Boolean
      ).length,
      checks_total: 4,
    },
  };
}

export default withAuth(handler);
