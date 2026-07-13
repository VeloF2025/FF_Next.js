export interface EligibilityInput {
  userId: string;
  userRole: string;
  approverType: string;
  approverUserId: string | null;
  approverRole: string | null;
  assignedTo: string | null;
}

/** True if the user may act on the current approval level. */
export function isEligibleApprover(i: EligibilityInput): boolean {
  if (i.userRole === 'super_admin') return true;
  if (i.assignedTo && i.assignedTo === i.userId) return true;
  if (i.approverType === 'user') {
    return !!i.approverUserId && i.approverUserId === i.userId;
  }
  if (i.approverType === 'role') {
    return !!i.approverRole && i.approverRole === i.userRole;
  }
  // department_head / project_manager / any_of_group: not yet modelled with a
  // direct column here — deny by default (safer); extend when those workflows
  // gain concrete assignment data. assigned_to still grants access above.
  return false;
}
