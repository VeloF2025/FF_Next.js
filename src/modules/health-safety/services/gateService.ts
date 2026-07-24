/**
 * H&S Gate Service
 *
 * Implements hard-block gate checking for contractor project assignment.
 * Contractors MUST pass all gate requirements before being assigned to projects.
 */

import { neon } from '@/lib/db-neon';
import type { GateCheckResult, DocumentStatus } from '../types/compliance.types';
import type { RAGStatus } from '../types/audit.types';
import { REQUIRED_DOCUMENTS, DOCUMENT_TYPES } from '../types/compliance.types';
import { DEFAULT_SCORING_CONFIG } from '../types/scoring.types';
import { TRAINING_GATE_MINIMUM } from '../types/training.types';
import { computeAndPersistContractorTrainingScore } from './trainingService';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Check if a contractor passes the H&S gate for project assignment
 *
 * Gate blockers (HARD BLOCK - cannot assign):
 * - Missing required documents (safety_policy, liability_insurance, safety_plan)
 * - Expired required documents
 * - Major/critical incidents in last 12 months
 * - Overall H&S score below minimum (50%)
 * - Training compliance below 70%
 *
 * Gate warnings (can assign but flagged):
 * - Score below recommended (70%)
 * - Audit overdue
 * - Documents expiring soon
 */
export async function checkContractorGate(contractorId: string): Promise<GateCheckResult> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Get or create compliance record
  const compliance = await getOrCreateCompliance(contractorId);

  // Recompute the training score from live worker-training data (Phase 1). This
  // replaces the previously inert stored value: it drives the score below and
  // is persisted onto the compliance row for the dashboard. `training` is the
  // authoritative training figure for the rest of this check.
  const training = await computeAndPersistContractorTrainingScore(contractorId);

  // Get documents
  const documents = await getContractorDocuments(contractorId);

  // Get recent incidents (H&S tickets in last 12 months)
  const recentIncidents = await getRecentIncidents(contractorId);

  // Check required documents
  for (const docType of REQUIRED_DOCUMENTS) {
    const doc = documents.find((d) => d.document_type === docType);
    const docConfig = DOCUMENT_TYPES[docType];

    if (!doc) {
      blockers.push(`Missing ${docConfig.label}`);
    } else if (doc.status === 'expired') {
      blockers.push(`${docConfig.label} has expired`);
    } else if (doc.status === 'rejected') {
      blockers.push(`${docConfig.label} was rejected`);
    } else if (doc.status === 'pending') {
      blockers.push(`${docConfig.label} pending verification`);
    } else if (doc.status === 'expiring_soon') {
      warnings.push(`${docConfig.label} expiring soon`);
    }
  }

  // Check incidents. Severity vocabulary is critical|major|moderate|minor —
  // 'critical' is the top tier (formerly 'fatal').
  const majorIncidents = recentIncidents.filter(
    (i) => i.severity === 'major' || i.severity === 'critical'
  );
  if (majorIncidents.length > 0) {
    blockers.push(`${majorIncidents.length} major/critical incident(s) in last 12 months`);
  }

  // Check overall score
  const overallScore = compliance.overall_score;
  if (overallScore < DEFAULT_SCORING_CONFIG.thresholds.gate_minimum) {
    blockers.push(
      `H&S score (${overallScore}%) below minimum (${DEFAULT_SCORING_CONFIG.thresholds.gate_minimum}%)`
    );
  } else if (overallScore < 70) {
    warnings.push(`H&S score (${overallScore}%) below recommended (70%)`);
  }

  // Check training score (null = no training data yet — do not block on absence).
  // Sourced from live worker-training data, not the stale stored column.
  if (training.training_score != null && training.training_score < TRAINING_GATE_MINIMUM) {
    blockers.push(
      `Training compliance (${training.training_score}%) below minimum (${TRAINING_GATE_MINIMUM}%)`
    );
  }
  // A worker with an EXPIRED STATUTORY certificate blocks outright, even if the
  // overall percentage would otherwise pass — an expired legal competency is
  // not a matter of degree (goal §7.3).
  if (training.expired_statutory_certs > 0) {
    blockers.push(
      `${training.expired_statutory_certs} expired statutory training certificate(s)`
    );
  } else if (training.expiring_certs > 0) {
    warnings.push(`${training.expiring_certs} training certificate(s) expiring soon`);
  }

  // Check audit due date
  if (compliance.next_audit_due) {
    const auditDue = new Date(compliance.next_audit_due);
    if (auditDue < new Date()) {
      warnings.push('H&S audit overdue');
    }
  }

  // Build document status array
  const documentStatuses = Object.values(DOCUMENT_TYPES).map((docType) => {
    const doc = documents.find((d) => d.document_type === docType.value);
    return {
      type: docType.value,
      status: (doc?.status || 'pending') as DocumentStatus,
      expiry_date: doc?.expiry_date || null,
      is_required: docType.required_for_gate,
    };
  });

  const canAssign = blockers.length === 0;

  // Update compliance record with gate status
  await updateGateStatus(contractorId, canAssign, blockers, warnings);

  return {
    can_assign: canAssign,
    contractor_id: contractorId,
    overall_score: overallScore,
    rag_status: compliance.rag_status as RAGStatus,
    blockers,
    warnings,
    checked_at: new Date().toISOString(),
    breakdown: {
      document_score: compliance.document_score,
      incident_score: compliance.incident_score,
      training_score: training.training_score,
      corrective_action_score: compliance.corrective_action_score,
      audit_score: compliance.audit_score,
    },
    documents: documentStatuses,
  };
}

/**
 * Get or create compliance record for contractor
 */
async function getOrCreateCompliance(contractorId: string) {
  const existing = await sql`
    SELECT * FROM hs_contractor_compliance
    WHERE contractor_id = ${contractorId}
    LIMIT 1
  `;

  if (existing.length > 0) {
    return existing[0]!;
  }

  // Create new compliance record with default values
  const created = await sql`
    INSERT INTO hs_contractor_compliance (contractor_id)
    VALUES (${contractorId})
    RETURNING *
  `;

  return created[0]!;
}

/**
 * Get contractor H&S documents
 */
async function getContractorDocuments(contractorId: string) {
  return await sql`
    SELECT
      id,
      document_type,
      file_name,
      status,
      expiry_date
    FROM hs_contractor_documents
    WHERE contractor_id = ${contractorId}
    ORDER BY document_type
  `;
}

/**
 * Get recent H&S incidents (tickets) for contractor
 */
async function getRecentIncidents(contractorId: string) {
  return await sql`
    SELECT
      t.id,
      t.ticket_uid,
      htd.severity,
      htd.incident_type,
      t.created_at
    FROM maintenance_tickets t
    JOIN hs_ticket_details htd ON htd.ticket_id = t.id
    WHERE t.contractor_id = ${contractorId}
    AND t.source_type IN ('hse_incident', 'hse_near_miss')
    AND t.created_at >= NOW() - INTERVAL '12 months'
    ORDER BY t.created_at DESC
  `;
}

/**
 * Update gate status in compliance record
 */
async function updateGateStatus(
  contractorId: string,
  canAssign: boolean,
  blockers: string[],
  warnings: string[]
) {
  await sql`
    UPDATE hs_contractor_compliance
    SET
      is_gate_approved = ${canAssign},
      gate_blockers = ${JSON.stringify(blockers)}::jsonb,
      gate_warnings = ${JSON.stringify(warnings)}::jsonb,
      calculated_at = NOW(),
      updated_at = NOW()
    WHERE contractor_id = ${contractorId}
  `;
}

/**
 * Batch check gate status for multiple contractors
 */
export async function batchCheckGate(
  contractorIds: string[]
): Promise<Map<string, GateCheckResult>> {
  const results = new Map<string, GateCheckResult>();

  // Process in parallel for efficiency
  await Promise.all(
    contractorIds.map(async (id) => {
      const result = await checkContractorGate(id);
      results.set(id, result);
    })
  );

  return results;
}

/**
 * Quick gate check - returns just pass/fail without full details
 */
export async function quickGateCheck(contractorId: string): Promise<boolean> {
  const compliance = await sql`
    SELECT is_gate_approved FROM hs_contractor_compliance
    WHERE contractor_id = ${contractorId}
    LIMIT 1
  `;

  if (compliance.length === 0) {
    // No compliance record - needs full check
    const result = await checkContractorGate(contractorId);
    return result.can_assign;
  }

  return compliance[0]!.is_gate_approved;
}

/**
 * Get contractors blocked by H&S gate
 */
export async function getBlockedContractors(): Promise<
  { contractor_id: string; company_name: string; blockers: string[] }[]
> {
  const rows = await sql`
    SELECT
      hcc.contractor_id,
      c.company_name,
      hcc.gate_blockers as blockers
    FROM hs_contractor_compliance hcc
    JOIN contractors c ON c.id = hcc.contractor_id
    WHERE hcc.is_gate_approved = false
    ORDER BY c.company_name
  `;
  return rows.map(r => ({
    contractor_id: String(r.contractor_id),
    company_name: String(r.company_name),
    blockers: Array.isArray(r.blockers) ? r.blockers.map(String) : [],
  }));
}
