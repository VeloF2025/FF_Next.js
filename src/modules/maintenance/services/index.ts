/**
 * Ticketing Module - Services Exports
 * 🟢 WORKING: Central export point for all ticketing services (server-side only)
 */

// Ticket CRUD Service (subtask 1.5)
export * from './ticketService';

// DR Lookup Service (subtask 1.6)
export * from './drLookupService';

// QA Readiness Service (subtask 2.2)
export * from './qaReadinessService';

// Verification Service - 12-Step Workflow (subtask 2.3)
export * from './verificationService';

// Risk Acceptance Service (subtask 2.4)
export * from './riskAcceptanceService';

// Attachment Service - Firebase Storage Integration (subtask 2.8)
export * from './attachmentService';

// Escalation Service - Repeat Fault Escalation Management (subtask 3.2)
export * from './escalationService';

// Handover Service - Ownership Transfer & Snapshots (subtask 3.4)
export * from './handoverService';

// Guarantee Service - Guarantee Classification & Billing Determination (subtask 3.5)
export * from './guaranteeService';

// QContact HTTP Client - API Integration (subtask 4.1)
export * from './qcontactClient';

// QContact Inbound Sync Service (subtask 4.2)
export * from './qcontactSyncInbound';

// QContact Outbound Sync Service (subtask 4.3)
export * from './qcontactSyncOutbound';

// QContact Sync Orchestrator - Full Bidirectional Sync (subtask 4.4)
export * from './qcontactSyncOrchestrator';

// QContact Sync Log Service - Sync Status & Audit Logs (subtask 4.5)
export * from './qcontactSyncLogService';

// Weekly Report Service - Import Management (subtask 5.2)
export * from './weeklyReportService';

// WhatsApp Service - WAHA API Integration (subtask 5.4)
export * from './whatsappService';

// Notification Triggers Service - Automatic WhatsApp Notifications (subtask 5.6)
export * from './notificationTriggers';

// Dashboard Service - Statistics & Metrics (subtask 5.8)
export * from './dashboardService';
