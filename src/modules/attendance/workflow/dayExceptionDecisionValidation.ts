import { ATTENDANCE_CLASSIFICATIONS } from './types';
import {
  ApprovedBucketInvariantError,
  assertApprovedBucketInvariant,
} from '@/services/attendance/policy/approvedBuckets';
import type {
  ApprovedHours, AttendanceClassification, DayExceptionDecisionAction,
  DayExceptionDecisionInput, DayExceptionKind, DayExceptionStatus,
} from './types';

export type DayExceptionWorkflowErrorCode =
  | 'not_found' | 'forbidden' | 'period_locked' | 'result_stale'
  | 'already_decided' | 'invalid_action' | 'invalid_classification'
  | 'invalid_hours' | 'invalid_reason';

export class DayExceptionWorkflowError extends Error {
  constructor(public readonly code: DayExceptionWorkflowErrorCode, message: string) {
    super(message);
    this.name = 'DayExceptionWorkflowError';
  }
}

const CLASSIFICATIONS = new Set<AttendanceClassification>(ATTENDANCE_CLASSIFICATIONS);
const APPROVABLE_KINDS = new Set<DayExceptionKind>([
  'late_arrival', 'early_departure', 'outside_schedule',
  'sunday_work', 'public_holiday_work', 'evidence_unreliable',
]);
function invalid(code: DayExceptionWorkflowErrorCode, message: string): never {
  throw new DayExceptionWorkflowError(code, message);
}

export function validateApprovedHours(
  hours: ApprovedHours,
  classification: AttendanceClassification | null = null,
): void {
  try {
    assertApprovedBucketInvariant(classification, hours);
  } catch (error) {
    if (error instanceof ApprovedBucketInvariantError) invalid('invalid_hours', error.message);
    throw error;
  }
}

export function validateDecisionInput(input: DayExceptionDecisionInput): string {
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) invalid('invalid_reason', 'A decision reason of at most 1000 characters is required');
  if (!Number.isInteger(input.expectedResultVersion) || input.expectedResultVersion < 1) {
    invalid('result_stale', 'expectedResultVersion must be a positive integer');
  }
  if (!['approve', 'return', 'classify'].includes(input.action)) invalid('invalid_action', 'Unsupported decision action');
  if (input.action === 'approve' && !input.approvedHours) invalid('invalid_hours', 'approvedHours is required for approval');
  if (input.action === 'classify' && (!input.classification || !CLASSIFICATIONS.has(input.classification))) {
    invalid('invalid_classification', 'An exact attendance classification is required');
  }
  if (input.action !== 'classify' && input.classification) invalid('invalid_classification', 'classification is only valid for classify');
  if (input.approvedHours) validateApprovedHours(
    input.approvedHours,
    input.action === 'classify' ? input.classification ?? null : null,
  );
  return reason;
}

export function classificationApprovedHours(
  classification: AttendanceClassification, scheduled: number,
): ApprovedHours {
  const paidLeave = classification === 'approved_leave' || classification === 'sick_leave';
  const paidClosure = classification === 'site_shutdown_weather';
  return {
    regular: paidClosure ? scheduled : 0, overtime: 0, sunday: 0,
    holiday: classification === 'public_holiday' ? scheduled : 0,
    leave: paidLeave ? scheduled : 0,
    unpaid: classification === 'unauthorised_absence' ? scheduled : 0,
  };
}

export function permittedDecisionActions(state: {
  kind: DayExceptionKind;
  status: DayExceptionStatus;
  adjustmentId: string | null;
  adjustmentStatus: string | null;
}): DayExceptionDecisionAction[] {
  if (state.status !== 'awaiting_supervisor') return [];
  if (state.kind === 'missing_clock_in') return ['classify'];
  if (state.kind === 'missing_clock_out') {
    return state.adjustmentId && state.adjustmentStatus === 'pending'
      ? ['approve', 'return'] : [];
  }
  return APPROVABLE_KINDS.has(state.kind) ? ['approve'] : [];
}

export function assertDecisionActionPermitted(
  state: Parameters<typeof permittedDecisionActions>[0],
  action: DayExceptionDecisionAction,
): void {
  if (!permittedDecisionActions(state).includes(action)) {
    invalid('invalid_action', `Action ${action} is not permitted for ${state.kind} in ${state.status}`);
  }
}
