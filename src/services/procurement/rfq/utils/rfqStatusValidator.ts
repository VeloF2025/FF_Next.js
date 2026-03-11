/**
 * RFQ Status Validator
 * Validates RFQ status transitions
 */

import { RFQStatus } from '@/types/procurement.types';

/**
 * Validate status transition
 */
export function validateStatusTransition(currentStatus: RFQStatus, newStatus: RFQStatus): boolean {
  const validTransitions: Record<RFQStatus, RFQStatus[]> = {
    [RFQStatus.DRAFT]: [RFQStatus.READY_TO_SEND, RFQStatus.CANCELLED],
    [RFQStatus.OPEN]: [RFQStatus.ISSUED, RFQStatus.CANCELLED],
    [RFQStatus.READY_TO_SEND]: [RFQStatus.ISSUED, RFQStatus.CANCELLED],
    [RFQStatus.ISSUED]: [RFQStatus.RESPONSES_RECEIVED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
    [RFQStatus.RESPONSES_RECEIVED]: [RFQStatus.EVALUATED, RFQStatus.AWARDED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
    [RFQStatus.EVALUATING]: [RFQStatus.EVALUATED, RFQStatus.CANCELLED],
    [RFQStatus.EVALUATED]: [RFQStatus.AWARDED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
    [RFQStatus.AWARDED]: [RFQStatus.CLOSED],
    [RFQStatus.CLOSED]: [],
    [RFQStatus.CANCELLED]: []
  };

  return validTransitions[currentStatus]?.includes(newStatus) || false;
}

/**
 * Get allowed transitions for a status
 */
export function getAllowedTransitions(currentStatus: RFQStatus): RFQStatus[] {
  const validTransitions: Record<RFQStatus, RFQStatus[]> = {
    [RFQStatus.DRAFT]: [RFQStatus.READY_TO_SEND, RFQStatus.CANCELLED],
    [RFQStatus.OPEN]: [RFQStatus.ISSUED, RFQStatus.CANCELLED],
    [RFQStatus.READY_TO_SEND]: [RFQStatus.ISSUED, RFQStatus.CANCELLED],
    [RFQStatus.ISSUED]: [RFQStatus.RESPONSES_RECEIVED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
    [RFQStatus.RESPONSES_RECEIVED]: [RFQStatus.EVALUATED, RFQStatus.AWARDED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
    [RFQStatus.EVALUATING]: [RFQStatus.EVALUATED, RFQStatus.CANCELLED],
    [RFQStatus.EVALUATED]: [RFQStatus.AWARDED, RFQStatus.CLOSED, RFQStatus.CANCELLED],
    [RFQStatus.AWARDED]: [RFQStatus.CLOSED],
    [RFQStatus.CLOSED]: [],
    [RFQStatus.CANCELLED]: []
  };

  return validTransitions[currentStatus] || [];
}
