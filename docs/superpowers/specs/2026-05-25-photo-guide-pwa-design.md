# PhotoGuide PWA — Design Spec

> **Date:** 2026-05-25  
> **Status:** Approved — ready for implementation planning  
> **Author:** Brainstorming session with Zander

---

## 1. Overview

**PhotoGuide** is a standalone Progressive Web App (PWA) that guides field technicians through a step-by-step photo capture checklist. Each photo is validated in real-time by an AI vision model before the technician can proceed to the next step. Completed photo sets are automatically uploaded to FibreFlow and saved to the device with structured filenames.

### Goals
- Replace ad-hoc WhatsApp photo submissions with a guided, validated capture flow
- Catch bad photos (wrong angle, missing elements, poor quality) at the point of capture — before they reach QA
- Make technician fraud (old photos, wrong-site photos) detectable and auditable
- Work for VelocityFibre first; deployable to any other company via config

### Non-Goals (v1)
- Does NOT replace WhatsApp as the primary comms channel
- Does NOT integrate with QFieldCloud (deferred to v2)
- Does NOT work fully offline (connectivity is assumed)
- Does NOT run AI on-device

---

## 2. Architecture

### Deployment Model
**Standalone PWA** — a separate Next.js application, independent of FibreFlow's codebase. It communicates with FibreFlow exclusively via HTTP API calls. VelocityFibre's instance points at FibreFlow's API. Any other company deploys their own instance pointing at their own backend.

```
[ Technician's Phone — PhotoGuide PWA ]
        │
        ├─ POST /validate-photo ──────→ [ FibreFlow API ]
        │                                    └─ VLM (Qwen3-VL-8B @ :8100)
        │
        ├─ POST /upload-job ──────────→ [ FibreFlow API ]
        │                                    ├─ VF Storage (photos)
        │                                    └─ DB (DR / pole record update)
        │
        └─ Auth (JWT) ────────────────→ [ FibreFlow API ]

[ FibreFlow — existing app ]
        ├─ New: /api/photo-guide/validate   ← called per photo during capture
        ├─ New: /api/photo-guide/upload     ← called on job completion
        ├─ New: Comparison view (Activations)
        └─ New: Escalation view (supervisor dashboard)
```

### Multi-Tenant Config
Every instance is driven by a `tenant.json` file at the root of the PWA deployment:

```json
{
  "tenantName": "VelocityFibre",
  "logo": "/assets/vf-logo.png",
  "primaryColor": "#0ea5e9",
  "authEndpoint": "https://app.fibreflow.app/api/auth/token",
  "apiBase": "https://app.fibreflow.app/api/photo-guide",
  "siteIdLabel": "DR Number",
  "siteIdPattern": "^DR-\\d+$",
  "jobTypes": ["activations", "civils"],
  "maxRetries": 3
}
```

Steps for each job type are stored in separate config files (`steps-activations.json`, `steps-civils.json`) so they can be updated without code changes.

---

## 3. Job Types

### 3.1 Activations (Home Fiber Installation)
Triggered when a technician selects job type "Activation" and enters a DR number.

**Steps (10 — strict sequential):**

| # | Label | OneMap field | Key pass criteria |
|---|-------|-------------|-------------------|
| 1 | House Photo | `ph_prop` | Full front of house visible, address visible |
| 2 | Cable from Pole | `ph_pole`, `ph_outs` | Cable visibly running from pole toward property |
| 3 | Entry Outside | `ph_entry_out`, `ph_hm_ln` | Cable entry point on external wall visible |
| 4 | Entry Inside | `ph_entry_in`, `ph_hm_en` | Cable entry point on internal wall visible |
| 5 | Wall | `ph_wall` | ONT wall bracket / mounting position visible |
| 6 | ONT Back After Install | `ph_ont` | Full back panel + green fiber cable plugged in |
| 7 | Power Meter | `ph_powm` | dBm reading legible, in range -18 to -24 dBm |
| 8 | Final Installation | `ph_after` | Wide shot, white router + black ONT + power outlet all visible |
| 9 | Green Lights | `ph_lights` | White router front panel, all 4 lights on/blinking |
| 10 | Signature | `ph_sign1` | Signed document legible, customer name visible |

> **Note:** Steps 1–5, 7, 10 need full pass/fail criteria defined before implementation. Steps 6, 8, 9 already have detailed criteria in `qaPhotoCriteria.ts`.

**On completion:**
1. Each photo saved to device gallery named: `DR-{number}_step{N}_{label}.jpg` (e.g. `DR-1234_step1_house-photo.jpg`)
2. All photos auto-uploaded to FibreFlow via `/api/photo-guide/upload`
3. DR record in FibreFlow updated: `pwa_submission_at`, `pwa_photo_count`, `pwa_tech_id`
4. Tech manually uploads photos to OneMap using renamed gallery files
5. QA manager uses FibreFlow comparison view to verify OneMap photos match PWA photos

### 3.2 Civils (Pole Installation)
Triggered when a technician selects job type "Civil" and enters a pole number.

**Steps (9 — strict sequential, standard pole):**

| # | Step | Required count | Key pass criteria |
|---|------|----------------|-------------------|
| 1 | BEFORE | 3 | Marked ground showing hole position, pole not yet in |
| 2 | DEPTH | 1 | Measuring tape in hole, depth readable |
| 3 | STUMPING | 3 | Pole planted, upright, various angles |
| 4 | COMPACTION | 1 | Backfill / cement visible (corner poles only) |
| 5 | HOUSEKEEPING | 3 | Clean site, no debris around completed pole |
| 6 | DURING *(bonus)* | — | Digging / preparation in progress |
| 7 | ENDPLATE *(bonus)* | — | End plates visible on pole |
| 8 | LEVEL *(bonus)* | — | Spirit level on pole, bubble centered |
| 9 | SIGNATURE *(bonus)* | — | Sign-off sheet visible and legible |

**On completion:**
1. All photos auto-uploaded to FibreFlow Field Ops via `/api/photo-guide/upload`
2. `pole_install_sessions` record updated in FibreFlow
3. No OneMap upload, no comparison view, no device download required

---

## 4. PWA Screen Flow

```
Login Screen
  └─ FibreFlow credentials (email + password)
  └─ JWT stored securely — session persists until logout
        │
        ▼
Home / Job Type Select
  └─ "Activations" or "Civils" tile
        │
        ▼
Site Lookup
  └─ Type DR number (Activations) or Pole number (Civils)
  └─ App validates site exists via FibreFlow API
  └─ Shows site details: address / customer name / project
        │
        ▼
Step Overview
  └─ All steps listed with status: locked / active / passed / flagged
  └─ Only the current step is unlocked
  └─ Progress bar at top
        │
        ▼
Step Detail (active step)
  └─ Step name, description, example photo
  └─ "Take Photo" button (opens rear camera — no gallery access)
        │
        ▼
Review & Submit
  └─ Preview of captured photo
  └─ "Submit for review" button
        │
        ▼
Validating... (spinner)
  └─ Photo sent to FibreFlow VLM endpoint
  └─ Waits for result (connectivity assumed)
        │
     ┌──┴──────────────────┐
     ▼                     ▼
  PASS                   FAIL
  └─ Step marked ✅      └─ Reason(s) shown in plain language
  └─ Next step unlocks   └─ "Retake" button
  └─ Photo saved         └─ Attempt count shown (1/3, 2/3, 3/3)
     to device gallery         │
                               ▼ (after 3 fails)
                          ESCALATED
                          └─ "Step flagged for supervisor review"
                          └─ Tech can continue remaining steps
                          └─ Supervisor notified in FibreFlow
        │
        ▼ (all steps passed or escalated)
Job Complete
  └─ Summary: X steps passed, Y escalated
  └─ "Upload to FibreFlow" button (Activations: auto-triggers)
  └─ Photos saved to gallery with DR-named filenames (Activations)
  └─ Instructions shown: "Now upload your gallery photos to OneMap" (Activations)
```

---

## 5. VLM Validation

### Endpoint (new in FibreFlow)
```
POST /api/photo-guide/validate
Authorization: Bearer {jwt}

Body:
{
  "jobType": "activations",
  "stepNumber": 8,
  "drNumber": "DR-1234",
  "photoBase64": "...",
  "attemptNumber": 1
}

Response:
{
  "pass": false,
  "reasons": ["Power outlet not in view", "ONT not visible in frame"],
  "corrections": [
    "Step back so the power outlet where the cables plug in is visible in the shot",
    "Make sure the black ONT box is visible behind or below the white router"
  ],
  "stepLabel": "Final Installation",
  "attemptNumber": 1,
  "maxAttempts": 3
}
```

### VLM Prompt Strategy
- Uses existing `qaPhotoCriteria.ts` criteria injected into prompt
- Few-shot examples from existing `qa_correction_examples` table
- Returns structured JSON: `{ pass, reasons[], corrections[] }`
- `corrections[]` are the technician-friendly version of `reasons[]` — plain language, actionable

### Fraud Detection (applied before VLM call)
1. **Force camera**: `<input type="file" accept="image/*" capture="environment">` — no gallery access
2. **EXIF date check**: Photo EXIF timestamp must be within 2 hours of submission time
3. **GPS check**: Photo GPS coordinates (if present) must be within 500m of site address
4. **Hash dedup**: SHA-256 hash checked against previously submitted photos for this DR — rejects identical photos
5. **Photo-of-photo detection**: VLM instructed to flag screen glare, pixelation, or another device visible

---

## 6. Photo Naming & Download

### Activations — filename convention
```
{DR-NUMBER}_step{N}_{step-label-kebab}.jpg

Examples:
  DR-1234_step1_house-photo.jpg
  DR-1234_step6_ont-back.jpg
  DR-1234_step8_final-installation.jpg
  DR-1234_step10_signature.jpg
```

### Save to device
- After each step passes, the photo is offered as a direct download via `<a href="{objectURL}" download="DR-1234_step1_house-photo.jpg">` — the browser saves it to the device Downloads folder automatically
- On Android this lands in Downloads / DCIM; on iOS it goes to Files
- Tech can find photos easily by DR number when opening OneMap to upload

---

## 7. FibreFlow Additions

### 7.1 New API Endpoints (in FibreFlow)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/photo-guide/validate` | VLM validation per photo |
| POST | `/api/photo-guide/upload` | Receive completed job photos |
| GET | `/api/photo-guide/site/:id` | Look up DR or pole by ID |
| POST | `/api/photo-guide/escalate` | Flag step for supervisor |
| GET | `/api/photo-guide/escalations` | Supervisor: list flagged jobs |
| POST | `/api/photo-guide/escalate/:id/resolve` | Supervisor: resolve escalation |

### 7.2 Comparison View (Activations only)
New tab/section inside the Activate module DR detail page:

**"PWA vs OneMap Photos" tab:**
- Shows each step side-by-side: PWA photo (left) | OneMap photo (right)
- PWA photo: pulled from VF Storage (uploaded from PWA)
- OneMap photo: pulled from OneMap API (`prop_id` photo fields)
- Status per step: ✅ Match | ⚠️ Mismatch | ❌ OneMap missing
- Mismatch = different photo uploaded to OneMap than what was validated

### 7.3 Supervisor Escalation View
New section in the **Action Centre** module (consistent with other escalation workflows in FibreFlow):

- Lists all jobs with escalated steps
- Per-escalation: tech name, DR/pole number, step, fail reason, attempt photos
- Actions: Approve (override, step marked passed) | Reject (job requires rework) | Contact tech
- All actions logged with timestamp + supervisor name

### 7.4 New DB Columns
On `dr_photo_unified_reviews`:
```sql
pwa_submission_at     TIMESTAMPTZ
pwa_tech_id           UUID  -- FK to staff
pwa_photo_count       INT
pwa_completed_at      TIMESTAMPTZ
```

On `pole_install_sessions`:
```sql
pwa_submission_at     TIMESTAMPTZ
pwa_tech_id           UUID
pwa_completed_at      TIMESTAMPTZ
```

New table `pwa_escalations`:
```sql
id                UUID PRIMARY KEY
job_type          TEXT  -- 'activations' | 'civils'
site_id           TEXT  -- DR number or pole number
step_number       INT
tech_id           UUID
fail_reasons      TEXT[]
attempt_photos    JSONB -- [{attempt: 1, url: '...', reasons: [...]}]
status            TEXT  -- 'pending' | 'approved' | 'rejected'
resolved_by       UUID
resolved_at       TIMESTAMPTZ
created_at        TIMESTAMPTZ DEFAULT NOW()
```

---

## 8. Tech Stack

### PWA (new repo)
| Layer | Choice | Reason |
|-------|--------|--------|
| Framework | Next.js 14+ App Router | Familiar stack, first-class PWA support |
| PWA | Serwist | Active successor to next-pwa, Workbox-based |
| Styling | Tailwind CSS + shadcn/ui | Consistent with FibreFlow patterns |
| State | Zustand | Lightweight, works well with step-machine logic |
| Local storage | Dexie.js (IndexedDB wrapper) | Photo blob + job state persistence |
| Camera | `<input capture="environment">` | Native rear camera, no gallery — fraud prevention |
| Config | `tenant.json` at deployment root | Drives all tenant-specific values |
| Auth | JWT via fetch to `authEndpoint` | Stored in `localStorage`, persists session |
| Language | TypeScript | 100% type coverage |

### FibreFlow additions
- New API routes under `/api/photo-guide/*`
- New UI components in Activate module
- New DB migrations (columns + `pwa_escalations` table)
- VLM prompt additions in `vlmPrompts.ts`

---

## 9. Fraud Prevention Summary

| Threat | Mitigation |
|--------|-----------|
| Uploading old gallery photos | `capture="environment"` forces camera — no gallery picker |
| Same photo resubmitted | SHA-256 hash check before VLM call |
| Photo taken on wrong day | EXIF timestamp checked ± 2 hours of submission |
| Photo taken at wrong location | GPS metadata checked within 500m of site address |
| Photo of another screen/photo | VLM prompt instructs detection of screen glare, pixel artifacts |
| Uploading different photo to OneMap | FibreFlow comparison view flags mismatches between PWA and OneMap photos |
| Skipping difficult steps | Strict sequential — next step only unlocks after current passes |
| Colluding supervisor override | All overrides logged with supervisor ID, timestamp, and reason |

---

## 10. Out of Scope (v1)

- QFieldCloud integration
- Full offline mode (no network = no validation)
- On-device AI inference
- Push notifications for escalations (polling / manual refresh for now)
- Replacing WhatsApp as comms channel
- Building criteria for steps 1–5, 7, 10 — must be defined by QA team before these steps can be validated by VLM
- Android/iOS native app (PWA only)
- Multi-language support

---

## 11. Open Questions Before Implementation

1. **Step criteria gaps**: Steps 1, 2, 3, 4, 5, 7, 10 need full pass/fail criteria defined with Zander/QA team — VLM cannot give accurate feedback without these
2. **GPS on mobile**: GPS metadata in EXIF is device-dependent — need to decide fallback if GPS not present (warn tech vs skip check)
3. **Retry count**: Confirmed as 3 retries before escalation — needs confirmation from Hein
4. **Supervisor notification**: How does supervisor know they have a pending escalation? (Email, WhatsApp, FibreFlow notification — TBD)
5. **OneMap photo field mapping**: Confirm exact OneMap field names for each of the 10 activation steps (partial mapping exists in `activate.md`)
6. **PWA domain**: What URL will this deploy to? (e.g., `field.fibreflow.app` or `guide.velocityfibre.co.za`)
