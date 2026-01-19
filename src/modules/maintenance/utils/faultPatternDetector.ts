/**
 * Fault Pattern Detector Utility
 * 🟢 WORKING: Detects repeat fault patterns on poles, PONs, zones, and DRs
 *
 * Analyzes ticket history to identify infrastructure-level issues that require escalation.
 * When repeat faults occur on the same infrastructure element (pole/PON/zone/DR),
 * this utility detects the pattern and recommends creating an escalation ticket.
 *
 * Key Features:
 * - Configurable thresholds per scope type
 * - Time window filtering (e.g., last 30 days)
 * - Existing escalation detection (prevents duplicates)
 * - Project-specific filtering
 * - Detailed contributing ticket tracking
 */

import { query } from './db';
import { EscalationScopeType } from '../types/escalation';
import type {
  FaultPatternDetectionResult,
  ContributingTicket,
} from '../types/escalation';

/**
 * Input for fault pattern detection
 */
export interface FaultPatternDetectorInput {
  scope_type: EscalationScopeType;
  scope_value: string;
  time_window_days: number;
  threshold: number;
  project_id?: string;
}

/**
 * Threshold configuration for all scope types
 */
export interface FaultPatternThresholdsConfig {
  pole_threshold: number;
  pon_threshold: number;
  zone_threshold: number;
  dr_threshold: number;
  time_window_days: number;
}

/**
 * Input for checking multiple patterns
 */
export interface MultiplePatternCheckInput {
  pole_number?: string | null;
  pon_number?: string | null;
  zone_id?: string | null;
  dr_number?: string | null;
  project_id?: string;
}

/**
 * Detects repeat fault patterns for a specific scope
 * 🟢 WORKING: Complete fault pattern detection with threshold checking
 *
 * @param input - Detection parameters (scope, threshold, time window)
 * @returns Pattern detection result with escalation recommendation
 */
export async function detectFaultPattern(
  input: FaultPatternDetectorInput
): Promise<FaultPatternDetectionResult> {
  const { scope_type, scope_value, time_window_days, threshold, project_id } = input;

  // Handle empty scope value
  if (!scope_value || scope_value.trim().length === 0) {
    return {
      pattern_detected: false,
      scope_type,
      scope_value,
      fault_count: 0,
      threshold,
      contributing_tickets: [],
      should_escalate: false,
      existing_escalation_id: null,
      recommendation: 'No scope value provided',
    };
  }

  try {
    // Build WHERE clause based on scope type
    const whereColumn = getScopeColumnName(scope_type);

    // Build SQL query to find tickets matching the scope within time window
    let queryText = `
      SELECT
        id,
        ticket_uid,
        created_at,
        fault_cause,
        status
      FROM tickets
      WHERE ${whereColumn} = $1
        AND created_at >= NOW() - INTERVAL '1 day' * $2
    `;

    const params: any[] = [scope_value, time_window_days.toString()];

    // Add project filter if provided
    if (project_id) {
      queryText += ` AND project_id = $3`;
      params.push(project_id);
    }

    queryText += ` ORDER BY created_at DESC`;

    // Execute query to get contributing tickets
    const tickets = await query<any>(queryText, params);

    const fault_count = tickets.length;
    const pattern_detected = fault_count >= threshold;

    // Map to contributing tickets
    const contributing_tickets: ContributingTicket[] = tickets.map((ticket) => ({
      ticket_id: ticket.id,
      ticket_uid: ticket.ticket_uid,
      created_at: new Date(ticket.created_at),
      fault_cause: ticket.fault_cause,
      status: ticket.status,
    }));

    // Check for existing active escalations
    const existingEscalation = await checkExistingEscalation(scope_type, scope_value);

    const should_escalate = pattern_detected && existingEscalation === null;

    // Generate recommendation message
    const recommendation = generateRecommendation({
      scope_type,
      scope_value,
      fault_count,
      threshold,
      pattern_detected,
      has_existing_escalation: existingEscalation !== null,
    });

    return {
      pattern_detected,
      scope_type,
      scope_value,
      fault_count,
      threshold,
      contributing_tickets,
      should_escalate,
      existing_escalation_id: existingEscalation,
      recommendation,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * Get the database column name for a scope type
 * 🟢 WORKING: Maps scope type to database column
 */
function getScopeColumnName(scope_type: EscalationScopeType): string {
  switch (scope_type) {
    case 'pole':
      return 'pole_number';
    case 'pon':
      return 'pon_number';
    case 'zone':
      return 'zone_id';
    case 'dr':
      return 'dr_number';
    default:
      throw new Error(`Unknown scope type: ${scope_type}`);
  }
}

/**
 * Check for existing active escalations for the scope
 * 🟢 WORKING: Queries for active escalations to prevent duplicates
 *
 * @param scope_type - Type of scope (pole/pon/zone/dr)
 * @param scope_value - Value of the scope
 * @returns Escalation ID if active escalation exists, null otherwise
 */
async function checkExistingEscalation(
  scope_type: EscalationScopeType,
  scope_value: string
): Promise<string | null> {
  const queryText = `
    SELECT id
    FROM repeat_fault_escalations
    WHERE scope_type = $1
      AND scope_value = $2
      AND status IN ('open', 'investigating')
    LIMIT 1
  `;

  const result = await query<{ id: string }>(queryText, [scope_type, scope_value]);

  if (result && result.length > 0 && result[0]) {
    return result[0].id;
  }

  return null;
}

/**
 * Generate recommendation message based on detection result
 * 🟢 WORKING: Creates human-readable recommendation
 */
function generateRecommendation(params: {
  scope_type: EscalationScopeType;
  scope_value: string;
  fault_count: number;
  threshold: number;
  pattern_detected: boolean;
  has_existing_escalation: boolean;
}): string {
  const { scope_type, scope_value, fault_count, threshold, pattern_detected, has_existing_escalation } =
    params;

  if (!pattern_detected) {
    return `Monitor: ${fault_count} fault(s) on ${scope_type} ${scope_value} (threshold: ${threshold}). Continue monitoring.`;
  }

  if (has_existing_escalation) {
    return `Pattern detected: ${fault_count} fault(s) on ${scope_type} ${scope_value}, but an active escalation already exists. Update existing escalation instead of creating new one.`;
  }

  // Generate scope-specific recommendation
  switch (scope_type) {
    case 'pole':
      return `ESCALATE: ${fault_count} faults detected on pole ${scope_value} (threshold: ${threshold}). Create infrastructure-level ticket to investigate pole stability and replace if necessary.`;
    case 'pon':
      return `ESCALATE: ${fault_count} faults detected on PON ${scope_value} (threshold: ${threshold}). Create PON investigation ticket to check splitter, fiber path, and OLT port.`;
    case 'zone':
      return `ESCALATE: ${fault_count} faults detected in zone ${scope_value} (threshold: ${threshold}). Trigger zone-wide inspection to identify systemic issues.`;
    case 'dr':
      return `ESCALATE: ${fault_count} faults detected on DR ${scope_value} (threshold: ${threshold}). Investigate DR-specific issues including equipment and installation quality.`;
    default:
      return `ESCALATE: ${fault_count} faults detected on ${scope_type} ${scope_value} (threshold: ${threshold}). Investigation required.`;
  }
}

/**
 * Check multiple patterns simultaneously
 * 🟢 WORKING: Checks patterns for pole, PON, zone, and DR in parallel
 *
 * @param ticketData - Ticket data with scope values
 * @param thresholds - Threshold configuration for all scopes
 * @returns Array of patterns that should be escalated
 */
export async function checkMultiplePatterns(
  ticketData: MultiplePatternCheckInput,
  thresholds: FaultPatternThresholdsConfig
): Promise<FaultPatternDetectionResult[]> {
  const checks: Promise<FaultPatternDetectionResult | null>[] = [];

  // Check pole pattern
  if (ticketData.pole_number) {
    checks.push(
      detectFaultPattern({
        scope_type: EscalationScopeType.POLE,
        scope_value: ticketData.pole_number,
        time_window_days: thresholds.time_window_days,
        threshold: thresholds.pole_threshold,
        project_id: ticketData.project_id,
      }).catch(() => null)
    );
  }

  // Check PON pattern
  if (ticketData.pon_number) {
    checks.push(
      detectFaultPattern({
        scope_type: EscalationScopeType.PON,
        scope_value: ticketData.pon_number,
        time_window_days: thresholds.time_window_days,
        threshold: thresholds.pon_threshold,
        project_id: ticketData.project_id,
      }).catch(() => null)
    );
  }

  // Check zone pattern
  if (ticketData.zone_id) {
    checks.push(
      detectFaultPattern({
        scope_type: EscalationScopeType.ZONE,
        scope_value: ticketData.zone_id,
        time_window_days: thresholds.time_window_days,
        threshold: thresholds.zone_threshold,
        project_id: ticketData.project_id,
      }).catch(() => null)
    );
  }

  // Check DR pattern
  if (ticketData.dr_number) {
    checks.push(
      detectFaultPattern({
        scope_type: EscalationScopeType.DR,
        scope_value: ticketData.dr_number,
        time_window_days: thresholds.time_window_days,
        threshold: thresholds.dr_threshold,
        project_id: ticketData.project_id,
      }).catch(() => null)
    );
  }

  const results = await Promise.all(checks);

  // Filter out null results (failed checks) and patterns that shouldn't escalate
  return results.filter(
    (result): result is FaultPatternDetectionResult => result !== null && result.should_escalate
  );
}

/**
 * Get default threshold configuration
 * 🟢 WORKING: Returns recommended default thresholds
 *
 * Based on maintenance requirements from spec:
 * - Pole: 3 faults (physical infrastructure issues)
 * - PON: 5 faults (network-level issues)
 * - Zone: 10 faults (broader area issues)
 * - DR: 2 faults (customer-specific issues)
 * - Time window: 30 days
 */
export function getDefaultThresholds(): FaultPatternThresholdsConfig {
  return {
    pole_threshold: 3,
    pon_threshold: 5,
    zone_threshold: 10,
    dr_threshold: 2,
    time_window_days: 30,
  };
}
