/**
 * QContact to FibreFlow Status Mapping
 * 🟢 WORKING: Maps QContact status values to FibreFlow ticket statuses
 *
 * QContact Statuses (verified 2026-01-27 via UI):
 * - New (white) - newly created ticket
 * - Assigned (green) - assigned to team/person
 * - In Progress (orange) - actively being worked on
 * - Escalated (red) - escalated for attention
 * - In Review (blue) - under QA review
 * - Reviewed (green) - QA review passed
 * - Pending Customer (white) - waiting for customer response
 * - Solved (white) - work completed
 * - Unsolved - No Response (dark) - closed without resolution
 *
 * FibreFlow has 11 statuses in a kanban workflow:
 * Work Phase: open, assigned, in_progress
 * QA Phase: pending_qa, qa_in_progress, qa_rejected, qa_approved
 * Handover Phase: pending_handover, handed_to_ops, closed, cancelled
 */

import { TicketStatus } from '../types/ticket';

/**
 * Map QContact status string to FibreFlow TicketStatus
 * This mapping is used during INBOUND sync to align ticket statuses
 */
export const QCONTACT_TO_FIBREFLOW_STATUS: Record<string, TicketStatus> = {
  // New/Open states
  'New': TicketStatus.OPEN,
  'Pending Customer': TicketStatus.OPEN,

  // Active work states
  'Assigned': TicketStatus.ASSIGNED,
  'In Progress': TicketStatus.IN_PROGRESS,
  'Escalated': TicketStatus.IN_PROGRESS, // Escalated = urgent in-progress

  // QA states
  'In Review': TicketStatus.PENDING_QA,
  'Reviewed': TicketStatus.QA_APPROVED,

  // Terminal states
  'Solved': TicketStatus.RESOLVED,
  'Unsolved - No Response': TicketStatus.CANCELLED,

  // Legacy/fallback mappings (for historical data)
  'Closed': TicketStatus.CLOSED,
  'Open': TicketStatus.OPEN,
  'Pending': TicketStatus.OPEN,
  'Pending Company Response': TicketStatus.IN_PROGRESS, // QC UI shows this under "In Progress" column
  'Pending Customer Response': TicketStatus.OPEN,
};

/**
 * Reverse mapping: FibreFlow status to QContact status
 * Used for OUTBOUND sync when pushing FibreFlow changes to QContact
 */
/**
 * Valid QContact API status values (verified 2026-02-11 via PATCH tests):
 * Open, Assigned, InProgress, Escalated, InReview, Reviewed,
 * Pending Company Response, Solved
 *
 * NOTE: QC API is case-sensitive and uses PascalCase without spaces
 * e.g. "InProgress" NOT "In Progress", "InReview" NOT "In Review"
 */
export const FIBREFLOW_TO_QCONTACT_STATUS: Partial<Record<TicketStatus, string>> = {
  // Work phase
  [TicketStatus.OPEN]: 'Open',
  [TicketStatus.ASSIGNED]: 'Assigned',
  [TicketStatus.IN_PROGRESS]: 'InProgress',

  // QA phase
  [TicketStatus.PENDING_QA]: 'InReview',
  [TicketStatus.QA_IN_PROGRESS]: 'InReview',
  [TicketStatus.QA_REJECTED]: 'InProgress', // Rejected = back to work
  [TicketStatus.QA_APPROVED]: 'Reviewed',

  // Handover phase
  [TicketStatus.PENDING_HANDOVER]: 'Reviewed',
  [TicketStatus.HANDED_TO_OPS]: 'Solved',

  // Terminal states
  [TicketStatus.RESOLVED]: 'Solved',
  [TicketStatus.CLOSED]: 'Solved',
  [TicketStatus.CANCELLED]: 'Solved', // QC has no "Unsolved" via API
};

/**
 * Map a QContact status string to FibreFlow TicketStatus
 *
 * @param qcontactStatus - Status string from QContact API
 * @returns FibreFlow TicketStatus (defaults to OPEN for unknown statuses)
 */
export function mapQContactStatusToFibreFlow(qcontactStatus: string | null | undefined): TicketStatus {
  if (!qcontactStatus) {
    return TicketStatus.OPEN;
  }

  // Try exact match first
  const mapped = QCONTACT_TO_FIBREFLOW_STATUS[qcontactStatus];
  if (mapped) {
    return mapped;
  }

  // Try case-insensitive match
  const normalizedStatus = qcontactStatus.toLowerCase().trim();
  for (const [key, value] of Object.entries(QCONTACT_TO_FIBREFLOW_STATUS)) {
    if (key.toLowerCase() === normalizedStatus) {
      return value;
    }
  }

  // Default to OPEN for unknown statuses
  return TicketStatus.OPEN;
}

/**
 * Map a FibreFlow TicketStatus to QContact status string
 *
 * @param fibreflowStatus - FibreFlow TicketStatus
 * @returns QContact status string (defaults to 'Open' for unmapped statuses)
 */
export function mapFibreFlowStatusToQContact(fibreflowStatus: TicketStatus): string {
  return FIBREFLOW_TO_QCONTACT_STATUS[fibreflowStatus] ?? 'Assigned';
}

/**
 * Check if a QContact status maps to a terminal FibreFlow status
 *
 * @param qcontactStatus - Status string from QContact
 * @returns true if the status is terminal (closed/cancelled)
 */
export function isQContactStatusTerminal(qcontactStatus: string): boolean {
  const mapped = mapQContactStatusToFibreFlow(qcontactStatus);
  return mapped === TicketStatus.RESOLVED || mapped === TicketStatus.CLOSED || mapped === TicketStatus.CANCELLED;
}

/**
 * Get alignment status between QContact and FibreFlow statuses
 *
 * @param qcontactStatus - Status from QContact
 * @param fibreflowStatus - Current status in FibreFlow
 * @returns Alignment info
 */
export function getStatusAlignment(
  qcontactStatus: string,
  fibreflowStatus: TicketStatus
): {
  isAligned: boolean;
  expectedFibreFlowStatus: TicketStatus;
  suggestedAction: 'none' | 'update' | 'review';
  reason: string;
} {
  const expectedStatus = mapQContactStatusToFibreFlow(qcontactStatus);
  const isAligned = expectedStatus === fibreflowStatus;

  if (isAligned) {
    return {
      isAligned: true,
      expectedFibreFlowStatus: expectedStatus,
      suggestedAction: 'none',
      reason: 'Status matches',
    };
  }

  // Determine suggested action based on status transition
  const isQContactTerminal = isQContactStatusTerminal(qcontactStatus);
  const isFibreFlowTerminal =
    fibreflowStatus === TicketStatus.RESOLVED || fibreflowStatus === TicketStatus.CLOSED || fibreflowStatus === TicketStatus.CANCELLED;

  if (isQContactTerminal && !isFibreFlowTerminal) {
    // QContact closed but FibreFlow still open - should close
    return {
      isAligned: false,
      expectedFibreFlowStatus: expectedStatus,
      suggestedAction: 'update',
      reason: `QContact is ${qcontactStatus} but FibreFlow is ${fibreflowStatus}`,
    };
  }

  if (!isQContactTerminal && isFibreFlowTerminal) {
    // FibreFlow closed but QContact still open - needs review
    return {
      isAligned: false,
      expectedFibreFlowStatus: expectedStatus,
      suggestedAction: 'review',
      reason: `FibreFlow is ${fibreflowStatus} but QContact is still ${qcontactStatus}`,
    };
  }

  // Different active statuses - suggest update
  return {
    isAligned: false,
    expectedFibreFlowStatus: expectedStatus,
    suggestedAction: 'update',
    reason: `Status mismatch: QContact=${qcontactStatus}, FibreFlow=${fibreflowStatus}`,
  };
}
