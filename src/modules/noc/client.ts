// 🟢 WORKING: FibreFlow Maintenance Module - Client-Safe Exports
// Following FibreFlow Universal Module Structure
//
// This file exports ONLY client-safe code (no server-side dependencies).
// Use this in client components with 'use client' directive.

// ============================================================================
// CLIENT-SAFE TYPES
// ============================================================================
// All types are client-safe and will be exported from types/index.ts

// ============================================================================
// CLIENT-SAFE COMPONENTS
// ============================================================================
// React components will be exported from components/index.ts
// Note: Components should use 'use client' directive if they have client-side state

// ============================================================================
// CLIENT-SAFE HOOKS
// ============================================================================
// React hooks will be exported from hooks/index.ts
// All hooks are client-safe by nature (React hooks only run in browser)

// ============================================================================
// CLIENT-SAFE CONSTANTS
// ============================================================================
// Constants are client-safe (no server dependencies)

// Re-export client-safe modules
// Types (all interfaces and enums)
export * from './types';
// Hooks
export * from './hooks';
// Constants (explicit to avoid VerificationStepTemplate clash with types/verification.ts)
export * from './constants/ticketStatus';
export * from './constants/ticketTypes';
export * from './constants/faultCauses';
// Components (explicit to avoid VerificationStep, QAReadinessCheck, HandoverSnapshot,
// TicketFilters clashing with same-named interfaces from ./types)
export { VerificationChecklist, PhotoUpload } from './components/Verification';
export { ReadinessResults, ReadinessBlocker } from './components/QAReadiness';
export { FaultCauseSelector } from './components/FaultAttribution/FaultCauseSelector';
export { FaultTrendAnalysis } from './components/FaultAttribution/FaultTrendAnalysis';
export { HandoverWizard, HandoverHistory } from './components/Handover';
export { EscalationAlert, EscalationList, RepeatFaultMap } from './components/Escalation';
export { SyncDashboard, SyncTrigger, SyncAuditLog } from './components/QContact';
export type { AuditLogFilters } from './components/QContact';
export { WeeklyImportWizard, ImportPreview, ImportResults } from './components/WeeklyImport';
export { TicketingDashboard } from './components/Dashboard/TicketingDashboard';
export { SLAComplianceCard } from './components/Dashboard/SLAComplianceCard';
export { WorkloadChart } from './components/Dashboard/WorkloadChart';
export { RecentTickets } from './components/Dashboard/RecentTickets';
export { TicketList } from './components/TicketList/TicketList';
export { TicketListItem } from './components/TicketList/TicketListItem';
export { TicketStatusBadge } from './components/TicketList/TicketStatusBadge';
export { TicketDetail } from './components/TicketDetail/TicketDetail';
export { TicketHeader } from './components/TicketDetail/TicketHeader';
export { TicketTimeline } from './components/TicketDetail/TicketTimeline';
export { TicketActions } from './components/TicketDetail/TicketActions';
export { RelatedTickets } from './components/TicketDetail/RelatedTickets';
export { DRLookup } from './components/common/DRLookup';
export { GuaranteeIndicator } from './components/common/GuaranteeIndicator';
export { SLACountdown } from './components/common/SLACountdown';
export { UserSelector, TeamSelector, AssignmentPanel } from './components/Assignment';
export { KanbanBoard } from './components/KanbanBoard/KanbanBoard';

// NOTE: Do NOT export:
// - services (may contain server-side database code)
// - utils (may contain server-side utilities like db.ts)
