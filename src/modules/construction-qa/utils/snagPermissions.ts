/**
 * Snag Workflow Permissions
 *
 * Determines which workflow actions a user can perform on a snag ticket.
 * QA approval actions are restricted to authorized roles + specific users.
 *
 * QA Approvers: super_admin, manager, ticket assignee, named users
 * Field Actions: any authenticated user (Start Work, Mark as Fixed, etc.)
 */

/** Roles that can approve QA on snag tickets */
const QA_APPROVER_ROLES = new Set(['super_admin', 'manager', 'admin']);

/**
 * Specific user IDs with QA approval rights (in addition to role-based).
 * Add users here who need approval rights but don't have manager/super_admin role.
 */
const QA_APPROVER_USER_IDS = new Set([
  '8ef76ee3-7c01-47d7-8819-bda77d71d411', // Chantall Cordier
  // Charl White — add ID here when user is created
]);

/** Actions that require QA approval permission */
const QA_ACTIONS = new Set([
  'approve_qa',       // pending_qa → resolved
  'customer_confirmed', // resolved → verified
  'close',            // verified → closed
  'approve_rejection', // wont_fix → closed
]);

/** Status transitions that are QA-gated (the "forward" action from these statuses) */
const QA_FORWARD_STATUSES = new Set([
  'pending_qa',  // forward = Approve QA
  'fixed',       // forward = Approve QA (legacy)
  'resolved',    // forward = Customer Confirmed
  'verified',    // forward = Close
  'wont_fix',    // forward = Approve Rejection
]);

export interface SnagPermissionContext {
  userId: string | null;
  userRole: string | null;
  ticketAssignedTo: string | null;
}

/**
 * Check if the current user can approve QA (move tickets through QA stages)
 */
export function canApproveQA(ctx: SnagPermissionContext): boolean {
  if (!ctx.userId) return false;

  // Role-based
  if (ctx.userRole && QA_APPROVER_ROLES.has(ctx.userRole)) return true;

  // Named user
  if (QA_APPROVER_USER_IDS.has(ctx.userId)) return true;

  // Ticket assignee
  if (ctx.ticketAssignedTo && ctx.userId === ctx.ticketAssignedTo) return true;

  return false;
}

/**
 * Check if the forward action for a given status requires QA approval permission
 */
export function isQAGatedStatus(status: string): boolean {
  return QA_FORWARD_STATUSES.has(status);
}

/**
 * Determine which workflow buttons should be shown for the current user + status
 */
export function getVisibleActions(
  status: string,
  ctx: SnagPermissionContext
): { showForward: boolean; showBackward: boolean; showReject: boolean } {
  const isQAApprover = canApproveQA(ctx);
  const isQAGated = isQAGatedStatus(status);

  return {
    // Forward button: always shown for field statuses, QA-gated for approval statuses
    showForward: isQAGated ? isQAApprover : true,
    // Backward button: QA-gated for rejection actions, otherwise always shown
    showBackward: isQAGated ? isQAApprover : true,
    // Reject button: available for assigned/in_progress (field actions, not QA-gated)
    showReject: status === 'assigned' || status === 'in_progress',
  };
}
