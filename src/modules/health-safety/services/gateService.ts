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
import { computeContractorMedicalSummary } from './medicalService';
import { computeContractorCheckinSummary, sastToday } from './checkinService';

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
 * - A worker whose latest medical says unfit, or whose Certificate of Fitness
 *   has lapsed
 * - A worker blocked at today's daily site check-in and not yet cleared
 *
 * Gate warnings (can assign but flagged):
 * - Score below recommended (70%)
 * - Audit overdue
 * - Documents expiring soon
 * - Medical certificates expiring soon, or workers fit only with restrictions
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

  // Per-worker medical fitness (migration 463). Scored over each worker's
  // LATEST Certificate of Fitness — superseded certificates must not block.
  const medical = await computeContractorMedicalSummary(contractorId);

  // Today's site check-ins (migration 465). Scoped to TODAY only: this is a
  // daily control, so yesterday's blocked worker must not still be blocking
  // the contractor today once they have declared fit again.
  const checkins = await computeContractorCheckinSummary(contractorId, sastToday());

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

  // Check per-worker medical fitness. No medical data at all does not block
  // (same "absence is not evidence" rule the training score follows), but a
  // worker who is on file as unfit, or whose certificate has lapsed, does —
  // an expired legal fitness certificate is not a matter of degree.
  if (medical.unfit > 0) {
    blockers.push(`${medical.unfit} worker(s) medically unfit for duty`);
  }
  if (medical.expired > 0) {
    blockers.push(`${medical.expired} expired medical certificate(s)`);
  }
  // Independent of the blocker above, not `else if`: expired and expiring-soon
  // are different workers (separate COUNT(*) FILTER clauses), so suppressing the
  // warning because someone else is already blocking discards real information
  // the H&S officer needs in order to fix both.
  if (medical.expiring_soon > 0) {
    warnings.push(`${medical.expiring_soon} medical certificate(s) expiring soon`);
  }
  if (medical.restricted > 0) {
    warnings.push(`${medical.restricted} worker(s) medically fit with restrictions`);
  }

  // Daily site check-in. A worker blocked at check-in and not yet cleared by an
  // H&S officer is, by the definition of the check-in, not cleared to work.
  if (checkins.blocked > 0) {
    blockers.push(
      `${checkins.blocked} worker(s) blocked at today's H&S check-in and not yet cleared`
    );
  }
  // Independent of the blocker above (not `else if`): these describe different
  // workers, so reporting one must not suppress the other.
  if (checkins.medical_unverifiable > 0) {
    warnings.push(
      `${checkins.medical_unverifiable} unregistered worker(s) declared height/plant work — medical could not be verified`
    );
  }
  if (checkins.overridden > 0) {
    warnings.push(`${checkins.overridden} check-in(s) cleared by override today`);
  }
  if (checkins.hazards_reported > 0) {
    warnings.push(`${checkins.hazards_reported} hazard(s) reported at check-in today`);
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
