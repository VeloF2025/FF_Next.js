# NOC Module — CHANGELOG

---

## 2026-03-13 — Type-Specific Verification Steps + Photo Upload UX

**Commit**: [`a63c493`](https://github.com/FibreFlow/fibreflow/commit/a63c49316f0eddae0d0df95f57576708cc7f8cde)  
**Author**: Claude Sonnet 4.5  
**Size**: 604 lines changed, 4 files modified

### Summary

Verification checklists are now **customized per ticket type**. Previously, all ticket types used the same 12-step new installation checklist. Now each ticket type (fault repair, ONT swap, incidents, etc.) has a tailored checklist that matches the actual work being done.

Photo upload UX improved with **clipboard paste support** (Ctrl+V) in addition to drag-drop and click-to-upload.

---

### Type-Specific Verification Steps

Each ticket type now has its own verification checklist:

| Ticket Type | Steps | Focus |
|-------------|-------|-------|
| **new_installation** | 12 | Full fiber installation workflow: site assessment → materials → installation → splicing → testing → documentation |
| **fault_repair** | 7 | Fault assessment → root cause → repair → signal verification → connectivity test → documentation |
| **ont_swap** | 7 | Document old ONT → swap device → activate → signal test → connectivity → documentation |
| **olt_investigation** | 4 | Review OLT data → cross-reference with tickets → verify signal → resolve |
| **serial_mismatch** | 3 | Review mismatch → physical check → resolve |
| **pre_provision** | 3 | Check OES → search 1Map → resolve |
| **hse_incident** | 6 | Scene assessment → injuries → witnesses → RCA → corrective actions → documentation |
| **hse_near_miss** | 3 | Document event → contributing factors → corrective actions |
| **incident** | 7 | Impact assessment → containment → RCA → restore → verify → post-incident review |
| **modification** | 6 | Assess scope → plan → modify → verify → test → documentation |

**Note**: Ticket types without a defined checklist fall back to the 12-step new_installation workflow.

---

### Photo Upload: Clipboard Paste

Users can now **paste images directly from clipboard** into photo upload fields:

- **Ctrl+V** (or Cmd+V on Mac) — paste from clipboard
- **Drag & drop** — existing feature
- **Click to upload** — existing feature

Useful for screenshots, phone camera photos synced via cloud, or images copied from other apps.

---

### Files Changed

| File | Purpose |
|------|---------|
| `src/modules/noc/constants/verificationSteps.ts` | **+496 lines** — Defines all 10 ticket-type-specific step arrays |
| `src/modules/noc/services/verificationService.ts` | **+51 lines** — Updated to fetch steps based on ticket type |
| `app/api/noc/tickets/[id]/verification/route.ts` | **+27 lines** — API route now returns type-specific steps |
| `src/modules/noc/components/Verification/PhotoUpload.tsx` | **+45 lines** — Added clipboard paste handler |
| `pages/api/noc/verification.ts` | Refactored (70 lines changed) |

---

### API Impact

**No breaking changes.** Existing GET `/api/noc/tickets/[id]/verification` endpoint now returns type-specific steps based on `ticket.type`. Clients that already handle dynamic step arrays (by step count and step_number) will work without modification.

**Example response** (fault_repair ticket):
```json
{
  "ticket_id": "uuid",
  "ticket_type": "fault_repair",
  "steps": [
    { "step_number": 1, "step_name": "Fault Assessment", "photo_required": true, ... },
    { "step_number": 2, "step_name": "Safety Check", "photo_required": false, ... },
    { "step_number": 3, "step_name": "Root Cause Identification", "photo_required": true, ... },
    ...
  ],
  "total_steps": 7,
  "completed_steps": 2,
  "progress_percent": 29
}
```

---

### Migration Notes

**No database migration required.** The verification step structure is code-only — steps are generated dynamically based on ticket type at runtime.

**Existing tickets**: Any tickets with in-progress verification checklists will now see the **correct type-specific steps** on their next load. If they had completed steps using the old 12-step checklist, those completed steps will still be marked as complete (step numbers are preserved).

---

### Testing

**Manual testing completed** (per commit message):
- ✅ New installation ticket → 12-step checklist
- ✅ Fault repair ticket → 7-step checklist
- ✅ ONT swap ticket → 7-step checklist
- ✅ HSE incident ticket → 6-step checklist
- ✅ Clipboard paste for photo upload (tested on Chrome, Firefox)

**Unit tests**: Not included in commit. Verification service tests should be added to cover ticket type mapping.

---

### Co-Authors

- Claude Opus 4.6 (design review + QA)

---

## 2026-03-12 — NOC Module Rename + PP Data Enrichment

**Commit**: [`96d8cc9`](https://github.com/FibreFlow/fibreflow/commit/96d8cc9411b41be6427ae40629dbf4972fd6bcc4)  
**Author**: Claude Sonnet 4.5  
**Size**: 1,876 lines changed, 68 files modified

### Summary

The **maintenance** module was renamed to **noc** (Network Operations Centre) to better reflect its scope. The module handles the full NOC function — faults, escalations, QA workflows, handovers, QContact sync — not just reactive maintenance.

This was a **code-only refactor**: all directories, imports, exports, navigation config, sidebar sections, data-sync groups, and API routes were updated. Database schema and data were not migrated.

Additionally, **PP data enrichment** was added to the module: a new endpoint enriches Pre-Provision tickets with location data from `drops` and `onemap_properties` tables.

---

### Files Changed

**Renamed directories:**
- `src/modules/maintenance/` → `src/modules/noc/`
- `app/(main)/maintenance/` → `app/(main)/noc/`
- `app/api/maintenance/` → `app/api/noc/`

**Updated imports** (68 files total):
- All components, services, hooks, and constants now import from `@/modules/noc/`
- Navigation config updated: sidebar section renamed `maintenance` → `noc`
- Data-sync groups updated: `noc_tickets`, `noc_escalations`, etc.

---

### PP Data Enrichment

**New endpoint**: `PATCH /api/activate/pp-data-tickets`

Enriches Pre-Provision (PP) tickets with location data from:
- **`drops` table** — pole, PON, zone, GPS coordinates
- **`onemap_properties` table** — address, ERF number, cadastral info

**Backfill status**: 372 tickets enriched (as of 2026-03-12).

**Why**: PP tickets often arrive from QContact with incomplete location data. Enrichment fills gaps before NOC triage.

---

### Known Issues

**Test failures** (pre-existing, unrelated to rename):
- 6 NOC module tests failing (verification service, QA readiness, handover)
- GitHub Actions billing suspended — CI offline
- Tests were failing before the rename and are not addressed in this commit

---

### Migration Notes

**No database migration required.** Database table names (`noc_tickets`, `noc_escalations`, etc.) were already named `noc_*` — the rename was code-only.

**API routes**: All `/api/maintenance/*` routes are now `/api/noc/*`. Frontend clients were updated in the same commit. No backwards compatibility layer needed.

---

## 2026-03-11 — Procurement 10-Step Workflow Restructure

**Commit**: [`146da95`](https://github.com/FibreFlow/fibreflow/commit/146da958008d20f5cc3429411d05cc85302f8ba0)  
**Author**: Claude Sonnet 4.5  
**Size**: 1,142 lines changed, 11 files modified

### Summary

Procurement workflow restructured from **9 steps to 10 steps** to separate RFQ award and PO creation into distinct stages. Previously, Step 6 combined "Quote Award" and "Create PO" — now Step 6 is Quote Award, and Step 7 is Create PO.

**Why**: POs can be created via RFQ award OR directly (no RFQ). Splitting the steps clarifies the two paths and allows direct PO creation to skip RFQ-related steps.

---

### Step Comparison

| Old (9 steps) | New (10 steps) | Change |
|---------------|----------------|--------|
| Step 1: Create Draft | Step 1: Create Draft | _(unchanged)_ |
| Step 2: Add Suppliers | Step 2: Add Suppliers | _(unchanged)_ |
| Step 3: Add Items | Step 3: Add Items | _(unchanged)_ |
| Step 4: Send RFQ | Step 4: Send RFQ | _(unchanged)_ |
| Step 5: Receive Quotes | Step 5: Receive Quotes | _(unchanged)_ |
| **Step 6: Quote Award + Create PO** | **Step 6: Quote Award** | **Split** |
|  | **Step 7: Create PO** | **New** |
| Step 7: Receive Goods | Step 8: Receive Goods | _(renumbered)_ |
| Step 8: Verify Delivery | Step 9: Verify Delivery | _(renumbered)_ |
| Step 9: Invoice Processing | Step 10: Invoice Processing | _(renumbered)_ |

---

### RFQ vs Direct PO Paths

**RFQ Path** (full 10-step workflow):
1. Create Draft → 2. Add Suppliers → 3. Add Items → 4. Send RFQ → 5. Receive Quotes → **6. Award Quote** → **7. Create PO** → 8. Receive → 9. Verify → 10. Invoice

**Direct PO Path** (skip RFQ steps):
1. Create Draft → 2. Add Suppliers → 3. Add Items → _(skip 4-6)_ → **7. Create PO** → 8. Receive → 9. Verify → 10. Invoice

---

### Files Changed

| File | Purpose |
|------|---------|
| `src/modules/procurement/components/Step6QuoteAward.tsx` | **New** — Quote award UI (split from old Step6) |
| `src/modules/procurement/components/Step7CreatePO.tsx` | **New** — PO creation UI (previously part of Step6) |
| `src/modules/procurement/components/Step6Receive.tsx` → `Step8Receive.tsx` | Renumbered |
| `src/modules/procurement/components/Step7Verify.tsx` → `Step9Verify.tsx` | Renumbered |
| `src/modules/procurement/components/Step8Invoice.tsx` → `Step10Invoice.tsx` | Renumbered |
| `src/modules/procurement/constants/workflowSteps.ts` | Updated to 10-step array |
| `app/api/procurement/rfq-suppliers/route.ts` | **New endpoint** — GET `/api/procurement/rfq-suppliers` |

---

### API Changes

**New endpoint**: `GET /api/procurement/rfq-suppliers`

Returns suppliers associated with an RFQ (for quote award step). Previously this data was fetched inline — now it's a dedicated endpoint for clarity.

**No breaking changes**: Existing procurement endpoints unchanged.

---

### Migration Notes

**No database migration required.** Workflow step numbering is code-only — the step field is an enum/string, not a stored integer.

**Existing procurement records**: Any in-flight procurement workflows will see the new 10-step UI on their next load. Step numbering is cosmetic — the actual workflow state fields (`rfq_sent`, `quotes_received`, `po_created`, etc.) are unchanged.

---

### Known Issues

**Step file naming discrepancy**: The step component files are named based on their **logical position** (Step8Receive, Step9Verify, Step10Invoice) but the old Step6/7/8 file names were retained in some places. This is cosmetic only — the components render correctly based on the `workflowSteps` array order.

**TODO**: Rename all step component files to match their logical position (Step1CreateDraft, Step2AddSuppliers, etc.) in a future refactor for consistency.

---

