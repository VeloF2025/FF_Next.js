/**
 * Stable correction-query public surface.
 *
 * Approval authority intentionally does not live here. Production approval
 * callers must use guardedApproval so the payroll-period guard and mutation
 * share one transaction.
 */

export {
  cancelOwnAdjustment,
  insertAdjustment,
  transitionAdjustmentStatus,
} from './adjustmentMutations';
export { countOwnAdjustmentsByStatus, listOwnAdjustments } from './ownQueries';
export {
  countSupervisedAdjustmentsByStatus,
  listAdjustmentsForReview,
  loadAdjustmentWithEntry,
} from './reviewQueries';
export type {
  AdjustmentKind,
  AdjustmentRow,
  AdjustmentStatus,
  AdjustmentWithEntry,
  OwnAdjustmentStatusCounts,
} from './types';
