/**
 * H&S Scoring Service
 *
 * Calculates H&S compliance scores for contractors and audit scores for projects.
 */

import type {
  HSScoreInput,
  HSScoreResult,
  AuditScoreInput,
  AuditScoreResult,
  ScoringConfig,
} from '../types/scoring.types';
import { DEFAULT_SCORING_CONFIG } from '../types/scoring.types';
import type { RAGStatus } from '../types/audit.types';
import { getRAGStatus } from '../types/audit.types';

/**
 * Calculate contractor H&S compliance score
 *
 * Weighted calculation:
 * - Documents: 25%
 * - Incidents: 30%
 * - Training: 15%
 * - Corrective Actions: 15%
 * - Audits: 15%
 */
export function calculateContractorHSScore(
  input: HSScoreInput,
  config: ScoringConfig = DEFAULT_SCORING_CONFIG
): HSScoreResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const gateBlockers: string[] = [];

  // Document Score (25%)
  let documentScore = 0;
  if (input.document_compliance.total > 0) {
    documentScore = Math.round(
      (input.document_compliance.valid / input.document_compliance.total) * 100
    );
  }
  if (input.document_compliance.expired > 0) {
    issues.push(`${input.document_compliance.expired} expired document(s)`);
    gateBlockers.push('Expired H&S documents');
  }
  if (input.document_compliance.pending > 0) {
    warnings.push(`${input.document_compliance.pending} document(s) pending verification`);
  }

  // Incident Score (30%) - starts at 100, decreases with incidents
  let incidentScore = 100;
  const { incidents } = input;
  incidentScore -= incidents.minor * config.incident_penalties.minor;
  incidentScore -= incidents.moderate * config.incident_penalties.moderate;
  incidentScore -= incidents.major * config.incident_penalties.major;
  incidentScore -= incidents.fatal * config.incident_penalties.fatal;
  incidentScore = Math.max(0, incidentScore);

  if (incidents.fatal > 0) {
    issues.push('FATAL INCIDENT - Immediate review required');
    gateBlockers.push('Fatal incident in last 12 months');
  }
  if (incidents.major > 0) {
    issues.push(`${incidents.major} major incident(s) in last 12 months`);
    gateBlockers.push(`${incidents.major} major incident(s) in last 12 months`);
  }
  if (incidents.moderate > 0) {
    warnings.push(`${incidents.moderate} moderate incident(s) in last 12 months`);
  }

  // Training Score (15%)
  let trainingScore = 0;
  if (input.training_records.total > 0) {
    trainingScore = Math.round(
      (input.training_records.current / input.training_records.total) * 100
    );
  }
  if (trainingScore < 70) {
    warnings.push('Training compliance below 70%');
    recommendations.push('Schedule refresher training for personnel');
  }
  if (input.training_records.expired > 0) {
    warnings.push(`${input.training_records.expired} expired training certificate(s)`);
  }

  // Corrective Action Score (15%)
  let correctiveActionScore = 100;
  if (input.corrective_actions.total > 0) {
    correctiveActionScore = Math.round(
      (input.corrective_actions.completed / input.corrective_actions.total) * 100
    );
    if (input.corrective_actions.overdue > 0) {
      correctiveActionScore -= input.corrective_actions.overdue * 10;
      issues.push(`${input.corrective_actions.overdue} overdue corrective action(s)`);
    }
  }
  correctiveActionScore = Math.max(0, correctiveActionScore);

  // Audit Score (15%)
  const auditScore = input.last_audit_score ?? 0;
  if (auditScore === 0) {
    warnings.push('No H&S audit on record');
    recommendations.push('Schedule initial H&S audit');
  } else if (auditScore < 70) {
    warnings.push(`Last audit score (${auditScore}%) below threshold`);
    recommendations.push('Review and address audit findings');
  }

  // Calculate weighted overall score
  const overallScore = Math.round(
    (documentScore * config.weights.documents +
      incidentScore * config.weights.incidents +
      trainingScore * config.weights.training +
      correctiveActionScore * config.weights.corrective_actions +
      auditScore * config.weights.audits) /
      100
  );

  // Determine RAG status
  const ragStatus = getRAGStatus(overallScore);

  // Check gate approval
  if (overallScore < config.thresholds.gate_minimum) {
    gateBlockers.push(
      `H&S score (${overallScore}%) below minimum (${config.thresholds.gate_minimum}%)`
    );
  }

  const gateApproved = gateBlockers.length === 0;

  return {
    overall_score: overallScore,
    rag_status: ragStatus,
    breakdown: {
      document_score: documentScore,
      incident_score: incidentScore,
      training_score: trainingScore,
      corrective_action_score: correctiveActionScore,
      audit_score: auditScore,
    },
    issues,
    warnings,
    recommendations,
    gate_approved: gateApproved,
    gate_blockers: gateBlockers,
  };
}

/**
 * Calculate project audit score from responses
 */
export function calculateAuditScore(input: AuditScoreInput): AuditScoreResult {
  const { responses } = input;

  // Filter out not_checked items
  const checkedItems = responses.filter((r) => r.response !== 'not_checked');
  const applicableItems = checkedItems.filter((r) => r.response !== 'na');

  const totalItems = responses.length;
  const checkedCount = checkedItems.length;
  const passedItems = applicableItems.filter((r) => r.response === 'pass');
  const failedItems = applicableItems.filter((r) => r.response === 'fail');
  const naItems = checkedItems.filter((r) => r.response === 'na');

  // Calculate score based on passed vs failed (NA items don't count)
  let overallScore = 0;
  if (applicableItems.length > 0) {
    // Weight by severity
    let weightedPassed = 0;
    let weightedTotal = 0;

    for (const item of applicableItems) {
      const weight = getSeverityWeight(item.severity);
      weightedTotal += weight;
      if (item.response === 'pass') {
        weightedPassed += weight;
      }
    }

    overallScore = weightedTotal > 0 ? Math.round((weightedPassed / weightedTotal) * 100) : 0;
  }

  // Count critical failures
  const criticalFailures = failedItems.filter(
    (r) => r.severity === 'critical' && r.is_mandatory
  ).length;

  // If any critical mandatory item fails, cap score at amber threshold
  let adjustedScore = overallScore;
  if (criticalFailures > 0) {
    adjustedScore = Math.min(adjustedScore, 79); // Cap at amber
  }

  const ragStatus = getRAGStatus(adjustedScore);

  // Group by category for breakdown
  const categoryBreakdown: Record<
    string,
    { total: number; passed: number; failed: number; score: number }
  > = {};

  // This would need category info passed in - simplified version
  // In real implementation, responses would include category

  return {
    overall_score: adjustedScore,
    rag_status: ragStatus,
    total_items: totalItems,
    checked_items: checkedCount,
    passed_items: passedItems.length,
    failed_items: failedItems.length,
    na_items: naItems.length,
    critical_failures: criticalFailures,
    requires_immediate_action: criticalFailures > 0,
    category_breakdown: categoryBreakdown,
  };
}

/**
 * Get weight multiplier for severity level
 */
function getSeverityWeight(severity: 'critical' | 'high' | 'medium' | 'low'): number {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 1;
  }
}

/**
 * Format score as display string with RAG indicator
 */
export function formatScore(score: number, ragStatus: RAGStatus): string {
  const indicator = ragStatus === 'green' ? '🟢' : ragStatus === 'amber' ? '🟡' : '🔴';
  return `${indicator} ${score}%`;
}

/**
 * Get score trend (improvement/decline)
 */
export function getScoreTrend(
  currentScore: number,
  previousScore: number
): 'improving' | 'declining' | 'stable' {
  const diff = currentScore - previousScore;
  if (diff > 5) return 'improving';
  if (diff < -5) return 'declining';
  return 'stable';
}
