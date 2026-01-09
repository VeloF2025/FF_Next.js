# Module: ticketing

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Comprehensive fiber network issue tracking system with verification, QA readiness, handover, and QContact integration |
| **Status** | Active |
| **Complexity** | High |
| **Category** | core |

## Dependencies

### Internal FF Modules
- `modules/sow` (for DR lookup)
- `modules/wa-monitor` (WhatsApp feedback)

### External Packages
- @neondatabase/serverless
- axios
- lucide-react
- @tanstack/react-query

## Database

### Tables
- `tickets` - Main ticket records
- `verification_steps` - 12-step verification workflow
- `weekly_reports` - Import batch tracking
- `qcontact_sync_log` - Bidirectional sync audit
- `guarantee_periods` - Project guarantee config
- `whatsapp_notifications` - Delivery tracking
- `ticket_attachments` - File metadata
- `ticket_notes` - Internal/client notes
- `qa_readiness_checks` - Pre-QA validation
- `qa_risk_acceptances` - Conditional approval
- `handover_snapshots` - Immutable audit trail
- `repeat_fault_escalations` - Infrastructure escalation

### Key Queries
- Ticket CRUD with filters and sorting
- DR lookup from SOW drops table
- QA readiness validation checks
- Verification step tracking and updates
- QContact bidirectional sync
- WhatsApp notification delivery

## API Endpoints
All under `/api/ticketing/*` namespace

## Services

### ticketService
```typescript
create(ticket)
getById(id)
update(id, updates)
delete(id)
list(filters)
```

### drLookupService
```typescript
lookupDR(drNumber)
validateDRFormat()
// Includes in-memory caching
```

### qaReadinessService
```typescript
checkReadiness(ticketId)
getBlockers()
```

### verificationService
```typescript
getVerificationSteps(ticketId)
updateStep(stepId, status)
validateCompletion()
```

### escalationService
```typescript
detectRepeatFaults()
createEscalation()
```

### handoverService
```typescript
createSnapshot()
getHistory()
```

### guaranteeService
```typescript
classifyGuarantee()
calculateCoverage()
```

### riskAcceptanceService
```typescript
createAcceptance()
validateRisk()
```

### attachmentService
```typescript
upload(file)
delete(attachmentId)
// Firebase Storage integration
```

### QContact Services
- `qcontactClient` - HTTP client
- `qcontactSyncInbound` - Sync IN
- `qcontactSyncOutbound` - Sync OUT
- `qcontactSyncOrchestrator` - Full sync

### whatsappService
```typescript
sendNotification(message)
// WAHA API integration
```

### dashboardService
```typescript
getTicketStats()
getSLAMetrics()
```

## Components (52 total)

### Core
- TicketList, TicketFilters, TicketStatusBadge, TicketListItem
- TicketingDashboard, RecentTickets, SLAComplianceCard, WorkloadChart

### Features
- DRLookup, SLACountdown, GuaranteeIndicator
- QAReadinessCheck, ReadinessBlocker, ReadinessResults
- VerificationChecklist, VerificationStep
- HandoverWizard, HandoverSnapshot, HandoverHistory
- EscalationList, EscalationAlert, RepeatFaultMap
- FaultCauseSelector, FaultTrendAnalysis
- WeeklyImportWizard, ImportPreview, ImportResults
- QContactSyncDashboard, SyncTrigger
- KanbanBoard, KanbanCard, KanbanColumn
- AssignmentPanel, TeamSelector, UserSelector

## Hooks (14 total)
```typescript
useTickets()
useTicket(id)
useDRLookup(drNumber)
useVerification(ticketId)
useQAReadiness(ticketId)
useHandover(ticketId)
useQContactSync()
useTicketForm()
useTeams()
useAssignment()
```

## Patterns
- TDD-first development (test-driven)
- Universal module structure (server/client exports)
- Service-based architecture (business logic separation)
- Modular component hierarchy
- In-memory caching for lookup operations
- Neon PostgreSQL serverless (no ORM)
- Parameterized SQL queries
- Real-time sync coordination

## Gotchas
- **Table Confusion**: drops table (SOW) vs tickets table - different purposes
- **Sync Loops**: QContact integration is bidirectional - watch for sync loops
- **12 Steps**: Verification has 12 mandatory steps - complex state management
- **Lifecycle Events**: WhatsApp notifications tied to specific lifecycle events
- **Billing Impact**: Guarantee classification affects billing determination
- **Server/Client Split**: Service exports are server-only; client exports in client.ts
- **Custom DB Utility**: Uses custom db.ts utility, not an ORM
