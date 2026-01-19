// 🟢 WORKING: Component exports for FibreFlow Ticketing Module
// This file will export all React components for the ticketing module

// Verification Components (✅ Completed - subtask 2.11)
export { VerificationChecklist, VerificationStep, PhotoUpload } from './Verification';

// QA Readiness Components (✅ Completed - subtask 2.12)
export { QAReadinessCheck, ReadinessResults, ReadinessBlocker } from './QAReadiness';

// Fault Attribution Components (✅ Completed - subtask 3.9)
export { FaultCauseSelector } from './FaultAttribution/FaultCauseSelector';
export { FaultTrendAnalysis } from './FaultAttribution/FaultTrendAnalysis';

// Handover Components (✅ Completed - subtask 3.10)
export { HandoverWizard, HandoverSnapshot, HandoverHistory } from './Handover';

// Escalation Components (✅ Completed - subtask 3.11)
export { EscalationAlert, EscalationList, RepeatFaultMap } from './Escalation';

// QContact Sync Components (✅ Completed - subtask 4.8)
export { SyncDashboard, SyncTrigger, SyncAuditLog } from './QContact';
export type { AuditLogFilters } from './QContact';

// Weekly Import Components (✅ Completed - subtask 5.10)
export { WeeklyImportWizard, ImportPreview, ImportResults } from './WeeklyImport';

// Dashboard Components (✅ Completed - subtask 5.11)
export { TicketingDashboard } from './Dashboard/TicketingDashboard';
export { SLAComplianceCard } from './Dashboard/SLAComplianceCard';
export { WorkloadChart } from './Dashboard/WorkloadChart';
export { RecentTickets } from './Dashboard/RecentTickets';

// TicketList Components (✅ Completed - subtask 5.12)
export { TicketList } from './TicketList/TicketList';
export { TicketListItem } from './TicketList/TicketListItem';
export { TicketFilters } from './TicketList/TicketFilters';
export { TicketStatusBadge } from './TicketList/TicketStatusBadge';

// TicketDetail Components (✅ Completed - subtask 5.12)
export { TicketDetail } from './TicketDetail/TicketDetail';
export { TicketHeader } from './TicketDetail/TicketHeader';
export { TicketTimeline } from './TicketDetail/TicketTimeline';
export { TicketActions } from './TicketDetail/TicketActions';
export { RelatedTickets } from './TicketDetail/RelatedTickets';

// Common Components (✅ Completed - subtask 5.12)
export { DRLookup } from './common/DRLookup';
export { GuaranteeIndicator } from './common/GuaranteeIndicator';
export { SLACountdown } from './common/SLACountdown';

// Assignment Components (✅ Completed)
export { UserSelector, TeamSelector, AssignmentPanel } from './Assignment';

// KanbanBoard Components (✅ Completed)
export { KanbanBoard } from './KanbanBoard/KanbanBoard';
