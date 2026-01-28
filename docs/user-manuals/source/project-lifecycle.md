# FibreFlow Project Lifecycle Manual

## End-to-End Guide: From Project Creation to Activation

**Version:** 1.0
**Last Updated:** January 2026
**Audience:** Project Managers, Field Supervisors, Operations Staff

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Creation](#2-project-creation)
3. [SOW Import (Scope of Work)](#3-sow-import)
4. [Procurement Workflow](#4-procurement-workflow)
5. [Project Execution](#5-project-execution)
6. [Drop Activation & QA](#6-drop-activation-and-qa)
7. [Post-Activation & Maintenance](#7-post-activation-and-maintenance)
8. [Budget Management](#8-budget-management)
9. [Team Management](#9-team-management)
10. [Reporting & Analytics](#10-reporting-and-analytics)
11. [Troubleshooting](#11-troubleshooting)
12. [Glossary](#12-glossary)

---

## 1. Overview

### What is FibreFlow?

FibreFlow is a comprehensive fiber network project management system that tracks the entire lifecycle of FTTH (Fiber to the Home) projects from initial planning through installation and ongoing maintenance.

### The Project Lifecycle

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   CREATE    │───▶│  SOW IMPORT │───▶│ PROCUREMENT │───▶│  EXECUTION  │
│   Project   │    │ Poles/Drops │    │ BOQ/RFQ/PO  │    │ Field Work  │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                                │
                                                                ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────────────────────────┐
│ MAINTENANCE │◀───│  HANDOVER   │◀───│       ACTIVATION & QA           │
│   Ongoing   │    │  Complete   │    │ Photo Review → Validation → Go  │
└─────────────┘    └─────────────┘    └─────────────────────────────────┘
```

### Key Modules Involved

| Phase | Module | Purpose |
|-------|--------|---------|
| Creation | Projects | Create and configure project settings |
| Planning | SOW | Import scope of work data (poles, drops, fiber) |
| Materials | Procurement | BOQ import, RFQ creation, PO management |
| Field Work | Execution | Track installation progress |
| Quality | Activate | 5-phase QA wizard for drop verification |
| Support | Maintenance | Post-installation ticket management |

---

## 2. Project Creation

### 2.1 Creating a New Project

**Navigation:** Projects → + New Project

#### Required Information

| Field | Description | Example |
|-------|-------------|---------|
| Project Name | Descriptive name | "Greenfields Phase 2" |
| Project Code | Unique identifier | "GF-2024-002" |
| Client | Select from client list | "Metro Fibre" |
| Project Type | FTTH, Backbone, etc. | "FTTH" |
| Start Date | Project kickoff date | 2024-01-15 |
| End Date | Target completion | 2024-06-30 |

#### Optional Settings

- **Project Manager:** Assign primary PM
- **Location:** Province, city, coordinates
- **Description:** Project scope summary
- **Priority:** Low / Medium / High / Critical
- **Budget:** Initial budget allocation

### 2.2 Project Statuses

| Status | Description | When to Use |
|--------|-------------|-------------|
| Planning | Initial setup phase | Project created, gathering requirements |
| Active | Work in progress | Field work has commenced |
| On Hold | Temporarily paused | Waiting for approvals/resources |
| Completed | All work finished | All drops activated, QA passed |
| Cancelled | Project terminated | Project abandoned |

### 2.3 Project Dashboard

After creation, the project detail page shows:

- **Overview Tab:** Project info, progress, key metrics
- **Team Tab:** Assigned staff and contractors
- **Procurement Tab:** BOQs, RFQs, POs linked to project
- **SOW Data Tab:** Imported poles, drops, fiber data
- **Budget Tab:** Financial tracking and health
- **H&S Tab:** Health and safety incidents/audits
- **Timeline Tab:** Milestones and deadlines

---

## 3. SOW Import

### 3.1 What is SOW?

SOW (Scope of Work) defines the physical infrastructure to be installed:

- **Poles:** Aerial pole locations
- **Drops:** Individual customer connection points
- **Fiber:** Fiber cable routes and lengths

### 3.2 Importing SOW Data

**Navigation:** Projects → [Project] → SOW Data → Import

#### Supported File Formats

| Format | Typical Source | Contains |
|--------|----------------|----------|
| Excel (.xlsx) | Nokia/OES Export | Poles, drops, coordinates |
| CSV | Custom exports | Flexible data format |
| GeoJSON | GIS systems | Geographic data |

#### Import Process

1. **Upload File:** Select your SOW data file
2. **Map Columns:** Match file columns to FibreFlow fields
3. **Preview:** Review first 10 rows before import
4. **Validate:** System checks for duplicates and errors
5. **Import:** Confirm to create records

#### Key Fields for Drops

| Field | Description | Required |
|-------|-------------|----------|
| Drop Number | Unique identifier (DR######) | Yes |
| Latitude | GPS coordinate | Yes |
| Longitude | GPS coordinate | Yes |
| Subscriber Name | Customer name | No |
| Address | Installation address | No |
| Zone | Geographic zone | No |
| PON | PON assignment | No |

### 3.3 Drop Hierarchy

```
Project
├── Zone (geographic area)
│   ├── PON (Passive Optical Network)
│   │   ├── Drop (DR1234567)
│   │   ├── Drop (DR1234568)
│   │   └── ...
│   └── PON
└── Zone
```

### 3.4 Post-Import Review

After import, verify:

- [ ] Total drop count matches expected
- [ ] Coordinates display correctly on map
- [ ] No duplicate drop numbers
- [ ] All zones/PONs are correctly assigned

---

## 4. Procurement Workflow

### 4.1 Overview

The procurement workflow ensures materials are properly sourced and tracked:

```
BOQ Import → RFQ Creation → Quote Collection → PO Generation → GRN (Goods Receipt)
```

### 4.2 BOQ (Bill of Quantities)

**What is BOQ?**
A BOQ is a detailed list of materials required for the project, typically exported from design software.

**Navigation:** Procurement → BOQ → Import

#### BOQ Import Process

1. **Upload Excel/CSV** with material list
2. **Map categories** to FibreFlow material catalog
3. **Review quantities** and unit costs
4. **Link to project** for tracking

#### BOQ Fields

| Field | Description | Example |
|-------|-------------|---------|
| Material Code | Item identifier | "FIB-SC-100" |
| Description | Material name | "SC/APC Fiber Connector" |
| Quantity | Amount needed | 500 |
| Unit | Measurement | "each" |
| Unit Cost | Price per unit | R25.00 |

### 4.3 RFQ (Request for Quotation)

**Purpose:** Request pricing from suppliers for BOQ items

**Navigation:** Procurement → RFQ → Create New

#### Creating an RFQ

1. **Select BOQ items** to quote
2. **Choose suppliers** (min 3 recommended)
3. **Set deadline** for quote submission
4. **Add requirements** (delivery date, terms)
5. **Send RFQ** to suppliers

#### RFQ Statuses

| Status | Description |
|--------|-------------|
| Draft | RFQ being prepared |
| Sent | Sent to suppliers |
| Quoting | Awaiting responses |
| Closed | All quotes received |
| Awarded | Supplier selected |

### 4.4 Quote Comparison

**Navigation:** Procurement → RFQ → [RFQ] → Compare Quotes

The system displays:

- Side-by-side price comparison
- Delivery time comparison
- Total cost per supplier
- Recommendation based on criteria

### 4.5 PO (Purchase Order)

**Navigation:** Procurement → Purchase Orders → Create from RFQ

#### PO Approval Workflow

| Approval Level | Amount Threshold | Approver |
|----------------|------------------|----------|
| Level 1 | < R50,000 | Procurement Manager |
| Level 2 | R50,000 - R200,000 | Operations Director |
| Level 3 | > R200,000 | Finance Director |

#### PO Statuses

| Status | Description |
|--------|-------------|
| Draft | Being prepared |
| Pending Approval | Awaiting sign-off |
| Approved | Ready to send |
| Sent | Sent to supplier |
| Partially Received | Some items delivered |
| Completed | All items received |
| Cancelled | Order cancelled |

### 4.6 GRN (Goods Receipt Note)

**Purpose:** Record receipt of ordered materials

**Navigation:** Procurement → GRN → Create from PO

#### GRN Process

1. **Select PO** being received
2. **Enter quantities** actually received
3. **Note discrepancies** (damaged, short, over)
4. **Upload photos** of delivery (optional)
5. **Update stock** automatically on save

---

## 5. Project Execution

### 5.1 Field Work Tracking

**Navigation:** Projects → [Project] → Execution

#### Work Categories

| Category | Description |
|----------|-------------|
| Trenching | Underground cable routes |
| Pole Installation | Aerial infrastructure |
| Fiber Pulling | Cable installation |
| Splicing | Fiber connections |
| Drop Installation | Customer premises work |

### 5.2 Progress Monitoring

The system tracks progress through:

- **Drop Completion %** - Installations done vs. total
- **Milestone Status** - Key dates tracked
- **Daily Progress** - Day-by-day completion rates
- **Team Performance** - Output per technician

### 5.3 QField Integration

Field teams use QField mobile app to:

- View assigned drops on map
- Navigate to installation locations
- Record completion status
- Upload field photos
- Sync data to FibreFlow

**QField Sync:** Automatic sync every 15 minutes, or manual via Projects → QField Sync

---

## 6. Drop Activation and QA

### 6.1 Overview

Drop activation is the quality assurance process that verifies each installation meets standards before being marked complete.

**Navigation:** Activate → QA Centre

### 6.2 How Drops Enter the System

1. **WhatsApp Submission:** Technicians submit photos via WhatsApp
2. **Bridge Processing:** WA Bridge receives and categorizes photos
3. **AI Analysis:** VLM analyzes photos for completeness
4. **QA Queue:** Drop appears in QA Centre for review

### 6.3 The 5-Phase QA Wizard

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ PREREQUISITES│──▶│ PHOTO REVIEW │──▶│ DATA CHECK   │──▶│ FINAL DECISION│──▶│ FEEDBACK     │
│   Phase 1    │   │   Phase 2    │   │   Phase 3    │   │    Phase 4    │   │   Phase 5    │
└──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

#### Phase 1: Prerequisites Check

Verifies basic data exists:

- [ ] Drop has OES coordinates
- [ ] Subscriber information available
- [ ] Required photos uploaded
- [ ] No blocking issues

#### Phase 2: Photo Review

Reviews the 10-step installation checklist:

| Step | Photo Required | What to Check |
|------|----------------|---------------|
| 1 | House Number | Visible house number/address |
| 2 | Cable Route | Cable path from pole/duct |
| 3 | Entry Point | Where cable enters building |
| 4 | Wall Plate | Indoor termination point |
| 5 | ONT Device | Optical Network Terminal |
| 6 | Power Meter | Light level reading |
| 7 | Final Setup | Complete installation |
| 8 | ONT Lights | Green/red indicator lights |
| 9 | Customer Signature | Sign-off document |
| 10 | UPS (if applicable) | Backup power unit |

**Photo Approval Actions:**
- ✅ **Approve** - Photo meets requirements
- ❌ **Reject** - Photo does not meet requirements (specify reason)
- ⏭️ **Skip** - Photo not required for this installation

#### Phase 3: Data Validation

Cross-references installation data:

| Check | Source | Validates |
|-------|--------|-----------|
| Serial Number | ONT Photo | Matches 1Map record |
| Location | GPS | Within expected coordinates |
| Power Reading | Power Meter Photo | Acceptable light level |
| UPS Serial | UPS Photo | If battery backup present |

**Serial Mismatch Handling:**
- If ONT serial doesn't match 1Map, system flags for review
- QA staff can update 1Map via OLT Report tool
- Automatic serial swap detection prevents fraud

#### Phase 4: Final Decision

Based on all checks, make final determination:

| Decision | Description | Action |
|----------|-------------|--------|
| ✅ Approve | All checks passed | Mark as activated |
| ❌ Reject | Critical issues found | Return for rework |
| 🔄 Rework | Minor issues | Request specific fixes |
| ⏸️ Hold | Needs investigation | Escalate to supervisor |

#### Phase 5: Feedback

Generate and send feedback to technician:

- Auto-generated message based on decision
- Includes specific issues if rejected
- Sent via WhatsApp to technician
- Logged in activity history

### 6.4 QA Centre Navigation

**Tab Structure:**

| Tab | Shows |
|-----|-------|
| Pending | Drops awaiting QA review |
| In Progress | Currently being reviewed |
| Approved | Passed QA |
| Rejected | Failed QA |
| All | Complete list |

**Filters:**
- Date range
- Project
- Zone
- PON
- Technician
- Status

### 6.5 Bulk Operations

For efficient processing:

- **Bulk Approve:** Select multiple drops → Bulk Actions → Approve
- **Bulk Export:** Download drop data to Excel
- **Auto-Evaluate:** AI-assisted batch processing

---

## 7. Post-Activation and Maintenance

### 7.1 Handover to Maintenance

Once a drop is activated:

1. Drop status changes to "Activated"
2. Warranty period begins (typically 12 months)
3. Drop becomes visible in Maintenance module
4. Customer can log support tickets

### 7.2 Maintenance Tickets

**Creating a Ticket:**

**Navigation:** Maintenance → Tickets → New Ticket

| Field | Description |
|-------|-------------|
| Drop Number | Affected installation |
| Issue Type | No Signal, Slow Speed, Equipment Fault |
| Priority | Low, Medium, High, Critical |
| Description | Detailed issue description |
| Contact | Customer contact details |

### 7.3 Ticket Workflow

```
New → Assigned → In Progress → Resolved → Closed
                     │
                     ▼
              (Escalated if needed)
```

### 7.4 QContact Integration

Maintenance tickets sync with QContact for:

- Field technician dispatch
- SLA tracking
- Customer communication
- Resolution verification

---

## 8. Budget Management

### 8.1 Project Budget Setup

**Navigation:** Projects → [Project] → Budget

#### Budget Categories

| Category | Description |
|----------|-------------|
| Materials | Fiber, connectors, equipment |
| Labour | Contractor costs |
| Equipment | Tools, vehicles |
| Permits | Municipal approvals |
| Contingency | Buffer for unexpected costs |

### 8.2 Budget Tracking

The system tracks:

- **Allocated:** Total budget assigned
- **Committed:** POs issued but not paid
- **Actual:** Invoices paid
- **Available:** Remaining funds

### 8.3 Budget Health Indicators

| Health | Utilization | Color |
|--------|-------------|-------|
| Healthy | < 80% | 🟢 Green |
| Warning | 80-95% | 🟡 Yellow |
| Critical | > 95% | 🔴 Red |

### 8.4 Budget Reports

- **Burn Rate:** Monthly spending trend
- **Category Breakdown:** Spending by category
- **Variance Analysis:** Budget vs. actual
- **Forecast:** Projected final cost

---

## 9. Team Management

### 9.1 Assigning Team Members

**Navigation:** Projects → [Project] → Team

#### Roles

| Role | Responsibilities |
|------|------------------|
| Project Manager | Overall project delivery |
| Site Supervisor | Field team management |
| QA Manager | Quality control |
| Procurement Lead | Materials management |
| H&S Officer | Safety compliance |

### 9.2 Contractor Management

Contractors can be linked to specific:

- Projects
- Work packages
- Zones/areas
- Tasks

### 9.3 Performance Tracking

Track team performance via:

- Drops completed per day
- QA pass rate
- Rework rate
- Response time

---

## 10. Reporting and Analytics

### 10.1 Standard Reports

| Report | Description |
|--------|-------------|
| Project Status | Overall progress summary |
| Daily Progress | Day-by-day completion |
| QA Summary | Approval/rejection rates |
| Budget Report | Financial status |
| Team Performance | Staff productivity |

### 10.2 Export Options

All reports can be exported as:

- Excel (.xlsx)
- PDF
- CSV

### 10.3 Dashboards

**Key Metrics Displayed:**

- Total drops vs. completed
- QA approval rate
- Budget utilization
- Active issues
- Team capacity

---

## 11. Troubleshooting

### 11.1 Common Issues

#### "Drop not appearing in QA Centre"

**Causes:**
- Photos not submitted via WhatsApp
- WA Bridge processing delay
- Drop number not in SOW import

**Solution:**
1. Verify drop exists in SOW Data tab
2. Check WA Monitor for submission status
3. Manual entry if needed via Activate → Manual Entry

#### "Serial mismatch in validation"

**Cause:** ONT serial in photo doesn't match 1Map record

**Solution:**
1. Verify serial from photo is correct
2. Use OLT Report (System → Data Sync → OLT Report) to fix
3. Re-run validation

#### "Budget showing incorrect amounts"

**Cause:** PO not linked to project

**Solution:**
1. Edit PO and ensure project is selected
2. Refresh budget dashboard
3. Check for duplicate POs

### 11.2 Getting Help

- **In-app:** Help → Documentation
- **Support:** support@velocityfibre.co.za
- **Emergency:** Contact system administrator

---

## 12. Glossary

| Term | Definition |
|------|------------|
| **BOQ** | Bill of Quantities - List of materials needed |
| **Drop** | Individual customer connection point |
| **FTTH** | Fiber to the Home |
| **GRN** | Goods Receipt Note - Record of material delivery |
| **OES** | Nokia's Optical Equipment System |
| **ONT** | Optical Network Terminal - Customer premises device |
| **PO** | Purchase Order |
| **PON** | Passive Optical Network |
| **QA** | Quality Assurance |
| **RFQ** | Request for Quotation |
| **SOW** | Scope of Work |
| **UPS** | Uninterruptible Power Supply |
| **VLM** | Vision Language Model - AI for photo analysis |

---

## Appendix A: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + N` | New item |
| `Ctrl + S` | Save |
| `Ctrl + F` | Search |
| `Esc` | Close modal |

## Appendix B: Status Quick Reference

### Project Statuses
- 🔵 Planning
- 🟢 Active
- 🟡 On Hold
- ⚫ Completed
- 🔴 Cancelled

### Drop Statuses
- ⬜ Pending (not started)
- 🟦 In Progress
- 🟩 Activated
- 🟥 Rejected
- 🟨 Rework Required

### PO Statuses
- 📝 Draft
- ⏳ Pending Approval
- ✅ Approved
- 📤 Sent
- 📦 Partially Received
- ✔️ Completed
- ❌ Cancelled

---

**End of Document**

*FibreFlow Project Lifecycle Manual v1.0*
*Copyright 2026 VelocityFibre*
