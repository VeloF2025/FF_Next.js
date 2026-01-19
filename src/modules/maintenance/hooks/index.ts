// 🟢 WORKING: React hooks for FibreFlow Ticketing Module
// This file exports all custom React hooks for the ticketing module

// ==================== Verification Hooks (Subtask 2.9) ====================

/**
 * Verification hooks for managing 12-step verification checklist state
 *
 * Exports:
 * - useVerificationSteps: Fetch all verification steps for a ticket
 * - useVerificationProgress: Fetch verification progress (completed/total)
 * - useUpdateVerificationStep: Update a specific step
 * - useVerification: Combined hook for steps + progress
 * - verificationKeys: Query keys for React Query
 */
export {
  useVerificationSteps,
  useVerificationProgress,
  useUpdateVerificationStep,
  useVerification,
  verificationKeys,
} from './useVerification';

// ==================== QA Readiness Hooks (Subtask 2.10) ====================

/**
 * QA Readiness hooks for managing pre-QA validation checks
 *
 * Exports:
 * - useQAReadinessStatus: Fetch current QA readiness status
 * - useRunQAReadinessCheck: Run a new QA readiness check
 * - useQAReadiness: Combined hook for status + check
 * - qaReadinessKeys: Query keys for React Query
 */
export {
  useQAReadinessStatus,
  useRunQAReadinessCheck,
  useQAReadiness,
  qaReadinessKeys,
} from './useQAReadiness';

// ==================== Handover Hooks (Subtask 3.10) ====================

/**
 * Handover hooks for managing ticket ownership transfers and snapshots
 *
 * Exports:
 * - useHandoverGateValidation: Validate handover gates before handover
 * - useCreateHandover: Create handover snapshot
 * - useHandoverHistory: Fetch handover history for a ticket
 * - useHandover: Fetch specific handover by ID
 * - useHandoverWizard: Combined hook for validation + creation
 * - handoverKeys: Query keys for React Query
 */
export {
  useHandoverGateValidation,
  useCreateHandover,
  useHandoverHistory,
  useHandover,
  useHandoverWizard,
  handoverKeys,
} from './useHandover';

// ==================== QContact Sync Hooks (Subtask 4.8) ====================

/**
 * QContact Sync hooks for managing QContact bidirectional sync
 *
 * Exports:
 * - useQContactSyncStatus: Fetch sync status overview
 * - useQContactSyncLog: Fetch sync audit log
 * - useTriggerManualSync: Trigger manual sync operation
 * - useInvalidateSyncQueries: Invalidate sync queries for manual refresh
 * - qcontactSyncKeys: Query keys for React Query
 */
export {
  useQContactSyncStatus,
  useQContactSyncLog,
  useTriggerManualSync,
  useInvalidateSyncQueries,
  qcontactSyncKeys,
} from './useQContactSync';

// ==================== Ticket Management Hooks (Subtask 5.12) ====================

/**
 * Ticket management hooks for managing tickets list and individual tickets
 *
 * Exports:
 * - useTickets: Fetch tickets list with filters and pagination
 * - useCreateTicket: Create new ticket
 * - ticketsKeys: Query keys for React Query
 * - useTicket: Fetch single ticket by ID
 * - useUpdateTicket: Update ticket details
 * - useDeleteTicket: Soft delete ticket
 */
export {
  useTickets,
  useCreateTicket,
  ticketsKeys,
} from './useTickets';

export {
  useTicket,
  useUpdateTicket,
  useDeleteTicket,
} from './useTicket';

export { useRelatedTickets } from './useRelatedTickets';

// Hooks to be added in future subtasks:
// - useRiskAcceptance (phase 2)
// - useEscalation (phase 3)
// - useGuarantee (phase 3)
// - useDashboard (phase 5)
