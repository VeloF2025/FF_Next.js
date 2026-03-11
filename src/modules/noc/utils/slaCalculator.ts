/**
 * SLA Calculator Utility
 * 🟢 WORKING: Production-ready SLA calculation functions
 *
 * Provides utilities for:
 * - SLA compliance rate calculation
 * - Overdue ticket detection
 * - Resolution time calculation
 * - SLA time remaining calculation
 *
 * All calculations use UTC timestamps to avoid timezone issues.
 */

/**
 * Input for SLA compliance calculation
 */
export interface SLAComplianceInput {
  total_tickets: number;
  sla_met: number;
  sla_breached: number;
}

/**
 * Result of SLA compliance calculation
 */
export interface SLAComplianceResult {
  compliance_rate: number; // Percentage (0-100)
  compliance_percentage: string; // Formatted string (e.g., "85.00%")
  total_tickets: number;
  sla_met: number;
  sla_breached: number;
}

/**
 * Input for overdue check
 */
export interface OverdueCheckInput {
  sla_due_at: Date | null;
  current_status: string;
}

/**
 * Result of overdue check
 */
export interface OverdueCheckResult {
  is_overdue: boolean;
  hours_overdue: number;
}

/**
 * Input for SLA time remaining calculation
 */
export interface SLATimeRemainingInput {
  sla_due_at: Date | null;
}

/**
 * Result of SLA time remaining calculation
 */
export interface SLATimeRemainingResult {
  hours_remaining: number;
  is_breached: boolean;
  status: 'ok' | 'warning' | 'breached' | 'no_sla';
}

/**
 * Input for resolution time calculation
 */
export interface ResolutionTimeInput {
  created_at: Date;
  closed_at: Date | null;
}

/**
 * Result of resolution time calculation
 */
export interface ResolutionTimeResult {
  resolution_hours: number | null;
  resolution_days: number | null;
  is_resolved: boolean;
}

/**
 * Calculate SLA compliance rate
 * 🟢 WORKING: Calculates percentage of tickets that met SLA
 *
 * @param input - SLA compliance data
 * @returns Compliance rate and formatted percentage
 */
export function calculateSLACompliance(input: SLAComplianceInput): SLAComplianceResult {
  const { total_tickets, sla_met, sla_breached } = input;

  // Handle zero tickets (avoid division by zero)
  if (total_tickets === 0) {
    return {
      compliance_rate: 0,
      compliance_percentage: '0.00%',
      total_tickets: 0,
      sla_met: 0,
      sla_breached: 0
    };
  }

  // Calculate compliance rate: (met / total) * 100
  const compliance_rate = (sla_met / total_tickets) * 100;

  // Round to 2 decimal places
  const rounded_rate = Math.round(compliance_rate * 100) / 100;

  return {
    compliance_rate: rounded_rate,
    compliance_percentage: `${rounded_rate.toFixed(2)}%`,
    total_tickets,
    sla_met,
    sla_breached
  };
}

/**
 * Check if ticket is overdue (past SLA)
 * 🟢 WORKING: Determines if ticket has breached SLA deadline
 *
 * Closed and cancelled tickets are exempt from overdue status.
 *
 * @param input - Ticket SLA and status data
 * @returns Whether ticket is overdue and hours overdue
 */
export function isTicketOverdue(input: OverdueCheckInput): OverdueCheckResult {
  const { sla_due_at, current_status } = input;

  // No SLA set = not overdue
  if (!sla_due_at) {
    return {
      is_overdue: false,
      hours_overdue: 0
    };
  }

  // Closed and cancelled tickets are exempt
  const exempt_statuses = ['closed', 'cancelled'];
  if (exempt_statuses.includes(current_status.toLowerCase())) {
    return {
      is_overdue: false,
      hours_overdue: 0
    };
  }

  // Calculate time difference in milliseconds
  const now = new Date();
  const due_date = new Date(sla_due_at);
  const time_diff_ms = now.getTime() - due_date.getTime();

  // Convert to hours
  const hours_overdue = time_diff_ms / (1000 * 60 * 60);

  // If positive, ticket is overdue
  if (hours_overdue > 0) {
    return {
      is_overdue: true,
      hours_overdue: Math.round(hours_overdue * 100) / 100 // Round to 2 decimals
    };
  }

  return {
    is_overdue: false,
    hours_overdue: 0
  };
}

/**
 * Calculate time remaining until SLA breach
 * 🟢 WORKING: Calculates hours remaining and status
 *
 * Status levels:
 * - ok: More than 4 hours remaining
 * - warning: Less than 4 hours remaining
 * - breached: Past SLA deadline
 * - no_sla: No SLA set
 *
 * @param input - SLA due date
 * @returns Hours remaining and status
 */
export function calculateSLATimeRemaining(input: SLATimeRemainingInput): SLATimeRemainingResult {
  const { sla_due_at } = input;

  // No SLA set
  if (!sla_due_at) {
    return {
      hours_remaining: 0,
      is_breached: false,
      status: 'no_sla'
    };
  }

  // Calculate time difference
  const now = new Date();
  const due_date = new Date(sla_due_at);
  const time_diff_ms = due_date.getTime() - now.getTime();
  const hours_remaining = time_diff_ms / (1000 * 60 * 60);

  // Round to 2 decimals
  const rounded_hours = Math.round(hours_remaining * 100) / 100;

  // Determine status
  if (rounded_hours < 0) {
    return {
      hours_remaining: rounded_hours,
      is_breached: true,
      status: 'breached'
    };
  } else if (rounded_hours < 4) {
    return {
      hours_remaining: rounded_hours,
      is_breached: false,
      status: 'warning'
    };
  } else {
    return {
      hours_remaining: rounded_hours,
      is_breached: false,
      status: 'ok'
    };
  }
}

/**
 * Calculate resolution time for closed tickets
 * 🟢 WORKING: Calculates time from creation to closure
 *
 * @param input - Created and closed timestamps
 * @returns Resolution time in hours and days, or null if not resolved
 */
export function calculateResolutionTime(input: ResolutionTimeInput): ResolutionTimeResult {
  const { created_at, closed_at } = input;

  // Not resolved yet
  if (!closed_at) {
    return {
      resolution_hours: null,
      resolution_days: null,
      is_resolved: false
    };
  }

  // Calculate time difference in milliseconds
  const created = new Date(created_at);
  const closed = new Date(closed_at);
  const time_diff_ms = closed.getTime() - created.getTime();

  // Convert to hours and days
  const resolution_hours = time_diff_ms / (1000 * 60 * 60);
  const resolution_days = resolution_hours / 24;

  // Round to 2 decimals
  const rounded_hours = Math.round(resolution_hours * 100) / 100;
  const rounded_days = Math.round(resolution_days * 100) / 100;

  return {
    resolution_hours: rounded_hours,
    resolution_days: rounded_days,
    is_resolved: true
  };
}
