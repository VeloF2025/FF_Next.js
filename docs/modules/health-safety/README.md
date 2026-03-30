# Health & Safety Module

## Overview
Comprehensive Health & Safety (H&S) management system for FibreFlow, covering project safety configuration, contractor compliance, incident management, and South African regulatory compliance.

## Key Features

### 1. Project H&S Configuration
- Project-level H&S setup and audits
- Safety audit wizard with structured checklists
- Project incident tracking and reporting

### 2. Contractor Compliance
- Contractor H&S score calculation
- Gate checking system (blocks non-compliant contractors)
- Batch gate validation for multiple contractors
- Quick gate check API for real-time validation
- Blocked contractor reporting

### 3. Incident Management
- Incident reporting form with structured fields
- Photo gallery for incident documentation
- Investigation workflow and tracking
- Integration with maintenance ticketing system

### 4. Regulatory Compliance
- South African OHS Act compliance tracking
- Construction Regulations adherence
- CAPA (Corrective & Preventive Action) tracking

## Data Model

**Core types:**
- `audit.types` — Safety audit structure and results
- `ticket.types` — Incident tickets and investigations
- `compliance.types` — Regulatory compliance tracking
- `checklist.types` — Audit checklist definitions

## Components

**Main UI:**
- `ProjectHSTab.tsx` — Project-level H&S management
- `ContractorHSTab.tsx` — Contractor compliance dashboard
- `AuditWizard.tsx` — Guided audit workflow
- `ProjectIncidentsSection.tsx` — Incident list and details
- `PhotoGallery.tsx` — Visual incident documentation

**Specialized:**
- `incident-form/` — Structured incident reporting
- `investigation/` — Investigation workflow components
- `capa/` — CAPA tracking and management
- `ContractorHSGrid.tsx` — Contractor safety metrics grid

## Services

**Scoring:**
- `calculateContractorHSScore()` — Compute contractor safety score
- `calculateAuditScore()` — Score project audits

**Gate Checking:**
- `checkContractorGate()` — Single contractor validation
- `batchCheckGate()` — Multiple contractor validation
- `quickGateCheck()` — Fast validation for real-time checks
- `getBlockedContractors()` — List non-compliant contractors

## Use Cases

1. **Project Setup:** Configure H&S requirements for a new project
2. **Contractor Validation:** Block non-compliant contractors from working on projects
3. **Incident Response:** Report and investigate safety incidents with photo evidence
4. **Audit Management:** Conduct structured safety audits using checklists
5. **Compliance Reporting:** Track adherence to SA OHS Act and Construction Regulations
6. **CAPA Tracking:** Manage corrective actions from audits and incidents

## Regulatory Context

**South African Compliance:**
- Occupational Health & Safety Act (OHS Act)
- Construction Regulations (as defined in `constants/sa-regulations`)
- Industry-specific safety standards

## Access Control
- Project managers: full access to project H&S
- Contractors: view own compliance status
- Safety officers: audit and incident management
- Admins: system-wide compliance reporting

## Integration Points
- **Maintenance Module:** Incident tickets link to maintenance system
- **Contractors Module:** Gate checking blocks non-compliant contractors from tasks
- **Projects Module:** H&S requirements scoped per project
- **Photo Review:** Incident photos integrated with photo review workflow

## Data Flow
```
Project → H&S Config → Audits → Scores
                              ↘
Contractor → Compliance Check → Gate (PASS/FAIL)
                              ↘
Incident → Investigation → CAPA → Resolution
```

## API Endpoints
- `POST /api/health-safety/audit` — Create new audit
- `GET /api/health-safety/contractor-gate/:contractorId` — Check contractor compliance
- `POST /api/health-safety/incident` — Report incident
- `GET /api/health-safety/blocked-contractors` — List blocked contractors
- `PATCH /api/health-safety/capa/:id` — Update CAPA status

---

**Last updated:** 2026-03-30  
**Status:** Production (active H&S management)  
**Regulatory:** SA OHS Act compliant
