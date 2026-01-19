/**
 * Ticketing Module - Ticket Status Constants
 * 🟢 WORKING: Ticket status workflow definitions with labels and descriptions
 *
 * Defines all possible ticket statuses, their display labels, colors,
 * and descriptions to maintain consistency across the application.
 */

import { TicketStatus } from '../types/ticket';

/**
 * Ticket status metadata
 */
export interface TicketStatusMetadata {
  value: TicketStatus;
  label: string;
  description: string;
  color: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  order: number; // Order in workflow
}

/**
 * Complete ticket status definitions
 * 🟢 WORKING: All ticket statuses with metadata for UI display
 */
export const TICKET_STATUS_DEFINITIONS: Record<TicketStatus, TicketStatusMetadata> = {
  [TicketStatus.OPEN]: {
    value: TicketStatus.OPEN,
    label: 'Open',
    description: 'Ticket created but not yet assigned',
    color: 'default',
    order: 1,
  },
  [TicketStatus.ASSIGNED]: {
    value: TicketStatus.ASSIGNED,
    label: 'Assigned',
    description: 'Ticket assigned to technician or contractor',
    color: 'info',
    order: 2,
  },
  [TicketStatus.IN_PROGRESS]: {
    value: TicketStatus.IN_PROGRESS,
    label: 'In Progress',
    description: 'Work has started on the ticket',
    color: 'primary',
    order: 3,
  },
  [TicketStatus.PENDING_QA]: {
    value: TicketStatus.PENDING_QA,
    label: 'Pending QA',
    description: 'Work completed, waiting for QA review',
    color: 'warning',
    order: 4,
  },
  [TicketStatus.QA_IN_PROGRESS]: {
    value: TicketStatus.QA_IN_PROGRESS,
    label: 'QA In Progress',
    description: 'QA team is reviewing the work',
    color: 'info',
    order: 5,
  },
  [TicketStatus.QA_REJECTED]: {
    value: TicketStatus.QA_REJECTED,
    label: 'QA Rejected',
    description: 'QA review failed, work needs correction',
    color: 'error',
    order: 6,
  },
  [TicketStatus.QA_APPROVED]: {
    value: TicketStatus.QA_APPROVED,
    label: 'QA Approved',
    description: 'QA review passed, ready for handover',
    color: 'success',
    order: 7,
  },
  [TicketStatus.PENDING_HANDOVER]: {
    value: TicketStatus.PENDING_HANDOVER,
    label: 'Pending Handover',
    description: 'Waiting for handover to maintenance',
    color: 'warning',
    order: 8,
  },
  [TicketStatus.HANDED_TO_MAINTENANCE]: {
    value: TicketStatus.HANDED_TO_MAINTENANCE,
    label: 'Handed to Maintenance',
    description: 'Successfully handed over to maintenance team',
    color: 'secondary',
    order: 9,
  },
  [TicketStatus.CLOSED]: {
    value: TicketStatus.CLOSED,
    label: 'Closed',
    description: 'Ticket completed and closed',
    color: 'success',
    order: 10,
  },
  [TicketStatus.CANCELLED]: {
    value: TicketStatus.CANCELLED,
    label: 'Cancelled',
    description: 'Ticket cancelled or deleted (soft delete)',
    color: 'default',
    order: 11,
  },
};

/**
 * Array of all ticket statuses
 * 🟢 WORKING: Ordered list of all ticket statuses
 */
export const TICKET_STATUSES = Object.values(TicketStatus);

/**
 * Array of ticket status options for dropdowns (ordered by workflow)
 * 🟢 WORKING: Sorted by workflow order for UI display
 */
export const TICKET_STATUS_OPTIONS = Object.values(TICKET_STATUS_DEFINITIONS).sort(
  (a, b) => a.order - b.order
);

/**
 * Active ticket statuses (excluding cancelled)
 * 🟢 WORKING: Filter for active tickets
 */
export const ACTIVE_TICKET_STATUSES = TICKET_STATUSES.filter(
  (status) => status !== TicketStatus.CANCELLED && status !== TicketStatus.CLOSED
);

/**
 * Statuses that indicate work is in progress
 * 🟢 WORKING: Filter for in-progress work
 */
export const IN_PROGRESS_STATUSES = [
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.QA_IN_PROGRESS,
];

/**
 * Statuses that indicate waiting/blocked state
 * 🟢 WORKING: Filter for blocked/waiting tickets
 */
export const WAITING_STATUSES = [
  TicketStatus.OPEN,
  TicketStatus.PENDING_QA,
  TicketStatus.PENDING_HANDOVER,
];

/**
 * Statuses that indicate completion
 * 🟢 WORKING: Filter for completed tickets
 */
export const COMPLETED_STATUSES = [
  TicketStatus.QA_APPROVED,
  TicketStatus.HANDED_TO_MAINTENANCE,
  TicketStatus.CLOSED,
];

/**
 * Statuses that require immediate attention
 * 🟢 WORKING: Filter for tickets needing attention
 */
export const ATTENTION_REQUIRED_STATUSES = [
  TicketStatus.QA_REJECTED,
  TicketStatus.OPEN,
];

/**
 * Get status metadata by value
 * 🟢 WORKING: Helper function to get status details
 */
export function getTicketStatusMetadata(status: TicketStatus): TicketStatusMetadata {
  return TICKET_STATUS_DEFINITIONS[status];
}

/**
 * Get status label
 * 🟢 WORKING: Helper function to get status label
 */
export function getTicketStatusLabel(status: TicketStatus): string {
  return TICKET_STATUS_DEFINITIONS[status].label;
}

/**
 * Get status color
 * 🟢 WORKING: Helper function to get status color for badges
 */
export function getTicketStatusColor(
  status: TicketStatus
): 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success' {
  return TICKET_STATUS_DEFINITIONS[status].color;
}

/**
 * Check if status is terminal (cannot be changed)
 * 🟢 WORKING: Helper to check if status is final
 */
export function isTerminalStatus(status: TicketStatus): boolean {
  return status === TicketStatus.CLOSED || status === TicketStatus.CANCELLED;
}

/**
 * Check if status allows editing
 * 🟢 WORKING: Helper to check if ticket can be edited in this status
 */
export function isEditableStatus(status: TicketStatus): boolean {
  return !isTerminalStatus(status);
}

/**
 * Valid status transitions
 * 🟢 WORKING: Defines allowed state transitions to enforce workflow
 */
export const VALID_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.OPEN]: [
    TicketStatus.ASSIGNED,
    TicketStatus.CANCELLED,
  ],
  [TicketStatus.ASSIGNED]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.OPEN,
    TicketStatus.CANCELLED,
  ],
  [TicketStatus.IN_PROGRESS]: [
    TicketStatus.PENDING_QA,
    TicketStatus.ASSIGNED,
    TicketStatus.CANCELLED,
  ],
  [TicketStatus.PENDING_QA]: [
    TicketStatus.QA_IN_PROGRESS,
    TicketStatus.IN_PROGRESS,
    TicketStatus.CANCELLED,
  ],
  [TicketStatus.QA_IN_PROGRESS]: [
    TicketStatus.QA_APPROVED,
    TicketStatus.QA_REJECTED,
    TicketStatus.PENDING_QA,
  ],
  [TicketStatus.QA_REJECTED]: [
    TicketStatus.IN_PROGRESS,
    TicketStatus.ASSIGNED,
    TicketStatus.CANCELLED,
  ],
  [TicketStatus.QA_APPROVED]: [
    TicketStatus.PENDING_HANDOVER,
    TicketStatus.CLOSED,
  ],
  [TicketStatus.PENDING_HANDOVER]: [
    TicketStatus.HANDED_TO_MAINTENANCE,
    TicketStatus.QA_APPROVED,
  ],
  [TicketStatus.HANDED_TO_MAINTENANCE]: [
    TicketStatus.CLOSED,
  ],
  [TicketStatus.CLOSED]: [],
  [TicketStatus.CANCELLED]: [],
};

/**
 * Check if status transition is valid
 * 🟢 WORKING: Validates if transition from one status to another is allowed
 */
export function isValidStatusTransition(
  currentStatus: TicketStatus,
  newStatus: TicketStatus
): boolean {
  const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus];
  return allowedTransitions.includes(newStatus);
}
