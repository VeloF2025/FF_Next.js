import { query } from '@/lib/db-pool';
import type {
  DecisionProvenance,
  EvidenceBreakdownEntry,
  InferenceDecision,
  InferenceOutcome,
} from './types';

export interface ProposalDriver {
  staffId: string;
  staffName: string;
  vehicleAssignmentId: string;
  /** vehicle_assignments' own registration string; may differ from the vehicle's. */
  assignmentRegistration: string;
}

export interface SiteInferenceProposal {
  vehicleId: string;
  registration: string;
  outcome: InferenceOutcome;
  inferredProjectId: string | null;
  inferredProjectName: string | null;
  dominantShare: number | null;
  pings: number;
  dwellSeconds: number;
  distinctDays: number;
  totalPositions: number;
  windowStart: string;
  windowEnd: string;
  breakdown: EvidenceBreakdownEntry[];
  computedAt: string;
  decision: InferenceDecision | null;
  decidedProjectId: string | null;
  decidedProjectName: string | null;
  decidedFrom: DecisionProvenance | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionMatchesInference: boolean | null;
  effectiveProjectId: string | null;
  appliedAssignmentId: string | null;
  appliedAt: string | null;
  drivers: ProposalDriver[];
}

interface ProposalRow extends Record<string, unknown> {
  vehicle_id: string; registration: string; outcome: InferenceOutcome;
  inferred_project_id: string | null; inferred_project_name: string | null;
  dominant_share: string | null; pings: string; dwell_seconds: string;
  distinct_days: number; total_positions: number;
  window_start: Date; window_end: Date; breakdown: EvidenceBreakdownEntry[];
  computed_at: Date; decision: InferenceDecision | null;
  decided_project_id: string | null; decided_project_name: string | null;
  decided_from: DecisionProvenance | null; note: string | null;
  decided_by: string | null; decided_at: Date | null;
  decision_matches_inference: boolean | null; effective_project_id: string | null;
  applied_assignment_id: string | null; applied_at: Date | null;
  drivers: ProposalDriver[];
}

export interface ProposalFilters {
  /** Only proposals a human has not answered yet. */
  undecidedOnly?: boolean;
  outcome?: InferenceOutcome;
}

function toNumber(value: string | number | null): number {
  if (value === null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapProposal(row: ProposalRow): SiteInferenceProposal {
  return {
    vehicleId: row.vehicle_id,
    registration: row.registration,
    outcome: row.outcome,
    inferredProjectId: row.inferred_project_id,
    inferredProjectName: row.inferred_project_name,
    dominantShare: row.dominant_share === null ? null : Number(row.dominant_share),
    pings: toNumber(row.pings),
    dwellSeconds: toNumber(row.dwell_seconds),
    distinctDays: toNumber(row.distinct_days),
    totalPositions: toNumber(row.total_positions),
    windowStart: row.window_start.toISOString(),
    windowEnd: row.window_end.toISOString(),
    breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
    computedAt: row.computed_at.toISOString(),
    decision: row.decision,
    decidedProjectId: row.decided_project_id,
    decidedProjectName: row.decided_project_name,
    decidedFrom: row.decided_from,
    note: row.note,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionMatchesInference: row.decision_matches_inference,
    effectiveProjectId: row.effective_project_id,
    appliedAssignmentId: row.applied_assignment_id,
    appliedAt: row.applied_at?.toISOString() ?? null,
    drivers: Array.isArray(row.drivers) ? row.drivers : [],
  };
}

/**
 * Explicit query branches rather than conditional tagged-template fragments:
 * `${cond ? sql`AND x` : sql``}` is broken in this repo for both the webpack
 * Neon shim and the @/lib/db-pool SQL tag.
 */
export async function listProposals(
  filters: ProposalFilters = {},
): Promise<SiteInferenceProposal[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.undecidedOnly) conditions.push('decision IS NULL');
  if (filters.outcome) {
    params.push(filters.outcome);
    conditions.push(`outcome = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query<ProposalRow>(
    `SELECT * FROM fleet_site_inference_proposals ${where} ORDER BY registration`, params);
  return rows.map(mapProposal);
}

export async function getProposal(vehicleId: string): Promise<SiteInferenceProposal | null> {
  const rows = await query<ProposalRow>(
    `SELECT * FROM fleet_site_inference_proposals WHERE vehicle_id = $1::uuid`, [vehicleId]);
  const row = rows[0];
  return row ? mapProposal(row) : null;
}
