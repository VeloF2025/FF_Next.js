# NOC Module

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Network Operations Centre — ticketing, fault management, SLA tracking |
| **Status** | Production |
| **Complexity** | High |
| **Category** | operations |
| **Scale** | 2,500+ active tickets |

## Key Features
- **Ticketing Dashboard**: Kanban board + list view with SLA countdown
- **12-Step Verification**: Structured fault resolution workflow
- **QContact Sync**: Bidirectional sync with QContact ticket system
- **Team Assignment**: Multi-team routing with escalation rules
- **Handover Wizard**: Shift handover with snapshot + history
- **Fault Attribution**: Root cause analysis with trend charts
- **QA Readiness Check**: Pre-activation quality gate
- **WhatsApp Integration**: DR photo processing + ticket notifications
- **DevOps VLM Analysis**: AI-powered screenshot/media analysis

## Directory Structure
```
src/modules/noc/
├── components/
│   ├── Dashboard/          # TicketingDashboard, SLAComplianceCard, WorkloadChart
│   ├── Assignment/         # TeamSelector, UserSelector, AssignmentPanel
│   ├── Escalation/         # EscalationAlert, EscalationList, RepeatFaultMap
│   ├── Handover/           # HandoverWizard, HandoverSnapshot, HandoverHistory
│   ├── KanbanBoard/        # KanbanBoard, KanbanCard, KanbanColumn
│   ├── QAReadiness/        # QAReadinessCheck
│   ├── FaultAttribution/   # FaultCauseSelector, FaultTrendAnalysis
│   ├── TicketForm/         # TicketForm, ScreenshotUploader
│   ├── Verification/       # VerificationChecklist, VerificationStep
│   ├── common/             # DRLookup, GuaranteeIndicator, SLACountdown
│   └── MaintenanceTab.tsx
├── hooks/                  # useVerification, useQAReadiness, useTickets
├── services/               # ticketService, notificationTriggers, fibertimeQContactClient
├── types/                  # ticket.types.ts
└── __tests__/              # 57 test files (best-covered module)
```

## API Routes
```
pages/api/noc/
├── alignment/              # Ticket alignment operations
├── qcontact/               # QContact sync endpoints
├── wa-messages/            # WhatsApp message handling
├── wa-photos/              # WhatsApp photo processing
├── statuses.ts             # Ticket status management
├── verification.ts         # Verification workflow
├── verification-step.ts    # Individual verification steps
├── process-photos.ts       # Photo processing pipeline
├── devops-vlm-analyse.ts   # VLM analysis for DevOps tickets
├── devops-media-analyse.ts # Media analysis endpoint
└── wa-ticket.ts            # WhatsApp ticket creation
```

## Database Tables
- `noc_tickets` — Main ticket records
- `noc_ticket_notes` — Ticket comments/notes
- `noc_verification_steps` — 12-step verification progress
- `noc_teams` — Team definitions
- `noc_team_members` — Team membership
- `noc_escalation_rules` — Escalation configuration
- `noc_handovers` — Shift handover records
- `noc_fault_causes` — Fault attribution data

## Dependencies
- QContact API (external ticket sync)
- WhatsApp Bridge (VPS 72.61.197.178)
- VLM service (Qwen3 on :8100) for DevOps media analysis
