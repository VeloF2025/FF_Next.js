# PhotoGuide PWA — Session Handoff
> **Date:** 2026-05-25  
> **Continue with:** Implementation planning → then build  
> **Spec file:** `docs/superpowers/specs/2026-05-25-photo-guide-pwa-design.md`

---

## What We Built Today

A complete, approved design for **PhotoGuide** — a standalone PWA that guides field technicians through step-by-step photo capture with real-time AI validation, fraud detection, and structured export to FibreFlow.

---

## All Decisions Made (don't re-litigate these)

| Decision | Outcome |
|---|---|
| Architecture | Standalone Next.js PWA — separate repo, calls FibreFlow via API |
| Multi-tenant | Config-driven via `tenant.json` from day 1 — VF is first tenant |
| Auth | FibreFlow JWT (email + password, one-time login per device, session persists) |
| Site lookup | Tech types or scans DR number (Activations) or Pole number (Civils) |
| Connectivity | Online assumed — photo submitted, waits for VLM response |
| Step flow | Strict sequential — no skipping, no reordering |
| Fraud prevention | Force camera only, EXIF date ±2h, GPS within 500m, SHA-256 hash dedup, VLM photo-of-photo detection |
| Failed photos | 3 retries → supervisor escalation (logged in FibreFlow Action Centre) |
| Fail feedback | VLM returns `reasons[]` + `corrections[]` — plain language shown to tech immediately |
| Activations export | Photos renamed `DR-XXXX_stepN_label.jpg` → downloaded to device → auto-upload to FibreFlow → tech manually uploads to OneMap |
| Civils export | Direct upload to FibreFlow Field Ops — no OneMap, no download |
| QField | Deferred — v2 |
| WhatsApp replacement | Not in scope — PWA runs alongside WhatsApp for now |
| Escalation location | FibreFlow Action Centre (new section) |
| Download method | `<a href download>` — saves to device Downloads/DCIM |

---

## What's Next (tomorrow's session)

### Step 1 — Define missing step criteria (do this FIRST)
Before writing the implementation plan, Zander needs to define pass/fail criteria for:

| Step | Label | Status |
|---|---|---|
| 1 | House Photo | ❌ Criteria not defined |
| 2 | Cable from Pole | ❌ Criteria not defined |
| 3 | Entry Outside | ❌ Criteria not defined |
| 4 | Entry Inside | ❌ Criteria not defined |
| 5 | Wall | ❌ Criteria not defined |
| 6 | ONT Back After Install | ✅ Defined in `qaPhotoCriteria.ts` |
| 7 | Power Meter | ❌ Only dBm range defined (-18 to -24) — visual criteria missing |
| 8 | Final Installation | ✅ Defined in `qaPhotoCriteria.ts` |
| 9 | Green Lights | ✅ Defined in `qaPhotoCriteria.ts` |
| 10 | Signature | ❌ Criteria not defined |

**Action:** Go through each undefined step together. For each one: what makes the photo pass? What makes it fail? Provide specific, visual, unambiguous rules like the ones in `qaPhotoCriteria.ts` for steps 6, 8, 9.

### Step 2 — Answer open questions
From `docs/superpowers/specs/2026-05-25-photo-guide-pwa-design.md` Section 11:

1. **GPS fallback**: If device has no GPS in EXIF — warn tech only, or skip check? *(Recommend: warn only, don't block)*
2. **Retry count**: 3 retries confirmed — does Hein need to approve this number?
3. **Supervisor notification**: How does supervisor learn of an escalation? Email? WhatsApp? FibreFlow notification bell?
4. **PWA domain**: Where does this deploy? (Suggest: `field.fibreflow.app`)
5. **Civils step criteria**: Same process as Activations — civil step pass/fail rules need to be defined too

### Step 3 — Write the implementation plan
Once criteria are defined and open questions answered, run `/plan` or invoke `superpowers:writing-plans` to generate the full task-by-task implementation plan.

The plan will cover two sub-projects (suggest separate plans):
- **Sub-project A:** FibreFlow additions (API endpoints, comparison view, escalation view, DB migrations)
- **Sub-project B:** PhotoGuide PWA (new repo, all screens, VLM integration, camera, download, upload)

Sub-project A should be built first — the PWA depends on the FibreFlow API existing.

---

## Key Files to Know

### Existing FibreFlow files (relevant to this build)
| File | Why it matters |
|---|---|
| `src/modules/activate/services/qaPhotoCriteria.ts` | Existing pass/fail rules for steps 6, 8, 9 — use as template for remaining steps |
| `src/modules/activate/services/vlmPrompts.ts` | Existing VLM prompt templates — extend for PWA validation endpoint |
| `src/modules/activate/services/vlmExtractionService.ts` | VLM client — reuse for new `/api/photo-guide/validate` endpoint |
| `src/modules/activate/services/photoHashService.ts` | SHA-256 hash dedup — reuse directly |
| `src/modules/activate/services/photoDateValidator.ts` | EXIF date validation — reuse directly |
| `src/modules/activate/services/oneMapIntegrationService.ts` | OneMap API — for fetching photos for comparison view |
| `src/modules/field-ops/.claude.md` | Full Field Ops module context — Civils upload target |
| `src/modules/activate/services/vlmQaValidationService.ts` | Existing QA validation — reference for new endpoint structure |

### New files that will be created
- **New repo:** `PhotoGuide PWA` (suggest: `~/Workspace/PhotoGuide/`)
- **FibreFlow:** `src/app/api/photo-guide/validate/route.ts`
- **FibreFlow:** `src/app/api/photo-guide/upload/route.ts`
- **FibreFlow:** `src/app/api/photo-guide/site/[id]/route.ts`
- **FibreFlow:** `src/app/api/photo-guide/escalate/route.ts`
- **FibreFlow:** `src/modules/activate/components/PwaComparisonTab.tsx`
- **FibreFlow:** `src/modules/action-centre/components/PwaEscalationView.tsx`
- **FibreFlow:** `migrations/XXXX_add_pwa_columns.sql`

---

## Context for the AI Starting Tomorrow's Session

> **To the AI reading this:** Start by reading `docs/superpowers/specs/2026-05-25-photo-guide-pwa-design.md` in full. All major design decisions are locked — do not re-open them. The immediate task is:
> 
> 1. Help Zander define pass/fail criteria for the 7 undefined activation steps (Steps 1, 2, 3, 4, 5, 7, 10) and the civil steps
> 2. Resolve the 5 open questions in spec Section 11
> 3. Then invoke `superpowers:writing-plans` to generate the implementation plan, split into Sub-project A (FibreFlow additions) and Sub-project B (PhotoGuide PWA)
>
> The VLM is Qwen3-VL-8B-Instruct on `http://100.96.203.105:8100`. Existing validation logic lives in `src/modules/activate/services/`. The new FibreFlow API endpoints go under `src/app/api/photo-guide/`. The PWA is a new standalone Next.js repo.
