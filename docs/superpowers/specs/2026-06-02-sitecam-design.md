# SiteCam Design Spec
**Date:** 2026-06-02  
**Branch:** feat/sitecam  
**Scope:** SiteCam PWA pages inside FF_Next.js (`/my/sitecam`) + Civils Photo Gallery tab + supporting infrastructure

---

## Problem

The SiteCam tile in `/my` (MyHub) links to `https://field.fibreflow.app` — a domain that was never configured. Field technicians on mobile get "server not found." SiteCam must be built as pages inside the existing FF_Next.js app so it is immediately accessible.

Additionally:
- The `/api/sitecam/validate` endpoint has a bug: it passes `undefined` for gallery examples, so curated pass/fail photos in `vlm_visual_photo_examples` are never used during VLM validation.
- There are no civil step VLM criteria or civil gallery examples defined anywhere.
- The `vlm_visual_photo_examples` table has no `job_type` column, so it cannot store civils examples.

---

## Architecture

```
pages/my/sitecam/index.tsx           — entry screen (thin page → SiteCamEntry)
pages/my/sitecam/[siteId].tsx        — wizard (thin page → SiteCamWizard)

src/modules/sitecam/
  lib/
    sitecamSteps.ts                  — step definitions for both job types
    civilStepCriteria.ts             — VLM criteria for 8 civil steps
  hooks/
    useSiteCamCapture.ts             — step state, photo data, validate/upload calls
  components/
    SiteCamEntry.tsx                 — DR/pole input + site confirmation card
    SiteCamWizard.tsx                — progress bar + orchestrates StepCapture
    StepCapture.tsx                  — camera input, VLM result, retry/escalate UX

src/modules/activate/components/
  CivilsGalleryTab.tsx               — Civils tab added to existing photo gallery

pages/api/sitecam/validate.ts        — FIX: fetch gallery examples for both job types
```

---

## 1 — Database Migration

### 1a. Extend `vlm_visual_photo_examples`

```sql
-- Add job_type column, seed existing rows as 'activation'
ALTER TABLE vlm_visual_photo_examples
  ADD COLUMN job_type text NOT NULL DEFAULT 'activation';

-- Update constraint to allow civils steps 1–8
ALTER TABLE vlm_visual_photo_examples
  DROP CONSTRAINT vlm_visual_photo_examples_step_number_check;

ALTER TABLE vlm_visual_photo_examples
  ADD CONSTRAINT vlm_visual_photo_examples_step_check CHECK (
    (job_type = 'activation' AND step_number >= 1 AND step_number <= 12)
    OR
    (job_type = 'civils' AND step_number >= 1 AND step_number <= 8)
  );

-- Update existing unique index to include job_type
-- (photo_url remains globally unique — no change needed)
```

### 1b. Seed civils gallery examples

Pull top 6 positive + top 6 negative photos per civil step from reviewed submissions. Source of truth:

- **Positive** (`label = 'positive'`): photos from reviews with `qa_decision = 'PASS'` AND `vlm_valid = true`
- **Negative** (`label = 'negative'`): photos from reviews with `qa_decision = 'RETAKE'` AND `vlm_valid = false`

Canonical `step_label` filters per step (noise excluded):

| Step | Accepted step_label values | Excluded |
|------|---------------------------|---------|
| 1 | `Before Photo`, `1 - Before Photo` | Foundation/Base, Dome on Pole |
| 2 | `During Photo` | Full Pole Visible, Dome Label |
| 3 | `Depth Photo` | Open Dome |
| 4 | `End Plates`, `4 - End Plates` | CCA H4 Tag |
| 5 | `Compaction`, `Compaction / Backfill`, `5 - Compaction / Backfill` | Slack Management |
| 6 | `Level Check` | — |
| 7 | `After Photo`, `7 - After Photo`, `AFTER photo` | — |
| 8 | `Signature` | Pole Label, Pole ID |

**Step 8 caveat:** Only 3 vlm_valid=true Signature photos exist. Gallery seeds what's available; manual curation via the Civils Gallery tab is required to improve accuracy.

Seeding runs as a one-off migration script (`scripts/seed-civils-gallery.ts`). Ordered by `vlm_confidence DESC NULLS LAST`, max 6 per step per label, `ON CONFLICT (photo_url) DO NOTHING`.

---

## 2 — Civil Step Criteria (Code)

New file: `src/modules/sitecam/lib/civilStepCriteria.ts`

Mirrors the shape of `STEP_CRITERIA` in `stepQualityCriteria.ts`. Criteria derived from `vlmConstructionService.ts` existing descriptions:

| Step | Label | Key requirement | Fail if |
|------|-------|----------------|---------|
| 1 | Before Photo | Ground/area before digging. Intact ground OR chalk markings visible. No hole, no pole. | Hole visible, pole present, or photo is unrelated |
| 2 | During Photo | Open hole with active excavation. Freshly dug earth, spade/pick visible. No pole yet. | Hole filled, pole standing, or no visible excavation |
| 3 | Depth Photo | Measuring tape/ruler inside hole showing depth. Instrument is key visual element. | No measuring instrument visible in the hole |
| 4 | End Plates | Metal end-plates, HDPE strapping, or brackets physically attached to the pole. | No metal hardware on pole visible; ground-only shot |
| 5 | Compaction | Standing pole with hole filled and compacted around base. Surface packed/tamped. | Hole still open, no pole standing, or loose heap visible |
| 6 | Level Check | Spirit/bubble level tool held against upright pole. Yellow/green bubble tool visible. | No spirit level tool visible in frame |
| 7 | After Photo | Wide shot showing full pole from base to top with sky/background. Taken from distance. | Close-up only; pole top or base cut off |
| 8 | Signature | Visible customer signature on form/paper/tablet, recognisable as handwriting. | No signature visible or form blank |

All 8 civil steps receive VLM validation in the SiteCam wizard. No auto-pass steps for civils.

---

## 3 — Validate Endpoint Fix

**File:** `pages/api/sitecam/validate.ts`

### Current bug
`runVlmCheck(step, photoBase64)` calls `buildMessageContent(step, photoBase64, undefined)` — gallery examples are never fetched or used.

### Fix
- Extract `loadGalleryExamplesForStep` from `stepQualityValidationService.ts` into `src/lib/vlmGallery.ts` (shared utility)
- Accept `job_type` parameter in `runVlmCheck`
- Fetch gallery examples from `vlm_visual_photo_examples` filtered by `job_type` before the VLM call
- For civils: use `civilStepCriteria` instead of `STEP_CRITERIA`
- Steps 3, 4 (activation) and step 6 (ONT Back, handled separately): remain as-is

---

## 4 — Civils Photo Gallery Tab

**Location:** Extend existing photo gallery in the Activate module.

The current gallery at `/activate` has a step sidebar + photo grid with good/bad decision buttons. A "Civils" tab is added alongside the existing "Activations" tab.

### Behaviour
- Sidebar shows civil steps 1–8 with photo counts
- Grid shows photos for selected step pre-labelled from seed data
- Same good/bad toggle buttons as activations gallery
- Saving writes to `vlm_visual_photo_examples` with `job_type = 'civils'`
- Deleting removes the row (same as activations)

### Data source
`GET /api/activate/civil-photo-gallery?step=N` — new API route, mirrors existing `photo-gallery.ts`. Fetches from `vlm_visual_photo_examples` where `job_type = 'civils' AND step_number = N`, ordered by `saved_at DESC`.

---

## 5 — SiteCam UI

### 5a. Entry screen — `pages/my/sitecam/index.tsx`

Thin page delegating to `SiteCamEntry`. Pattern: identical to `pages/my/stores/index.tsx`.

**`SiteCamEntry` flow:**
1. Auth check — redirect to `/my` if not technician/supervisor/admin
2. Text input: "Enter DR number or pole number"
3. Tap "Find" → `GET /api/sitecam/site/[id]`
4. Site card shows: job type badge (Activation / Civil), site ID, customer name (if activation), address, project name
5. Tap "Start" → `router.push('/my/sitecam/[siteId]')`

### 5b. Wizard — `pages/my/sitecam/[siteId].tsx`

Thin page delegating to `SiteCamWizard`.

**`useSiteCamCapture` hook:**
- Holds array of step states: `{ stepNumber, label, status: 'pending'|'captured'|'pass'|'fail'|'escalated', photoBase64, attemptNumber }`
- `capturePhoto(file)` — reads file, stores base64
- `validateStep()` — POST `/api/sitecam/validate`, updates step status
- `escalateStep()` — POST `/api/sitecam/escalate`, marks step escalated
- `submitAll()` — POST `/api/sitecam/upload`, returns uploaded URLs

**`SiteCamWizard` layout:**
- Top: progress bar (`Step N of M`) + site header (siteId + job type)
- Body: `StepCapture` for current step
- No manual next/back — progression is driven by pass/escalate only

**`StepCapture` per-step cycle:**
1. Step number + label displayed prominently
2. Brief instruction text (from criteria)
3. Camera button → `<input type="file" accept="image/*" capture="environment" />`
4. On capture: spinner → POST validate
5. **Pass** → green tick animation → auto-advance to next step after 1.5 s
6. **Fail (attempt < 3)** → red card with reasons + corrections + "Retake" button
7. **Fail (3rd attempt)** → escalate → amber "Escalated — moving on" → auto-advance
8. **All steps done** → POST upload → success screen with count of passed / escalated steps

### 5c. MyHub tile fix

`src/modules/attendance/portal/client/MyHub.tsx`:
- `SITECAM_URL` constant removed
- `SiteCamTile` uses `router.push('/my/sitecam')` instead of `window.location.assign`

---

## 6 — Step Definitions

`src/modules/sitecam/lib/sitecamSteps.ts`

```typescript
export const ACTIVATION_STEPS = [
  { number: 1,  label: 'House / Property Photo',   hasVlm: true  },
  { number: 2,  label: 'Cable from Pole',           hasVlm: true  },
  { number: 3,  label: 'Entry Outside',             hasVlm: false },
  { number: 4,  label: 'Entry Inside',              hasVlm: false },
  { number: 5,  label: 'Wall (ONT Mount)',          hasVlm: true  },
  { number: 6,  label: 'ONT Back After Install',    hasVlm: false }, // separate ONT check — no standard VLM
  { number: 7,  label: 'Power Meter',               hasVlm: true  },
  { number: 8,  label: 'Final Installation',        hasVlm: true  },
  { number: 9,  label: 'Green Lights on ONT',       hasVlm: true  },
  { number: 10, label: 'Signature',                 hasVlm: true  },
  { number: 11, label: 'Dome Joint Open',           hasVlm: true  },
  { number: 12, label: 'Dome Joint Closed',         hasVlm: true  },
] as const;

export const CIVIL_STEPS = [
  { number: 1, label: 'Before Photo',    hasVlm: true },
  { number: 2, label: 'During Photo',    hasVlm: true },
  { number: 3, label: 'Depth Photo',     hasVlm: true },
  { number: 4, label: 'End Plates',      hasVlm: true },
  { number: 5, label: 'Compaction',      hasVlm: true },
  { number: 6, label: 'Level Check',     hasVlm: true },
  { number: 7, label: 'After Photo',     hasVlm: true },
  { number: 8, label: 'Signature',       hasVlm: true },
] as const;
```

---

## 7 — Shared Library Extract

`src/lib/vlmGallery.ts` — extracted from `stepQualityValidationService.ts`:

```typescript
export async function loadGalleryExamples(
  step: number,
  jobType: 'activation' | 'civils'
): Promise<GalleryExamples | undefined>
```

Used by both the existing `stepQualityValidationService.ts` and the new `validate.ts` endpoint. No duplication.

---

## 8 — API Routes Summary

| Route | Change |
|-------|--------|
| `GET /api/sitecam/site/[id]` | Existing — no change |
| `POST /api/sitecam/validate` | Fix gallery fetch bug; add civils criteria + job_type branching |
| `POST /api/sitecam/escalate` | Existing — no change |
| `POST /api/sitecam/upload` | Existing — no change |
| `GET /api/activate/civil-photo-gallery` | New — mirrors photo-gallery.ts for civils |
| `POST /api/activate/civil-photo-gallery` | New — save/delete civils gallery decisions |

---

## 9 — PR Plan

All changes ship in a single PR on `feat/sitecam`:

1. DB migration + seed script
2. `civilStepCriteria.ts` + `sitecamSteps.ts`
3. `vlmGallery.ts` extract + `validate.ts` fix
4. Civils Gallery tab (API route + UI component)
5. SiteCam pages + module components
6. MyHub tile fix

---

## Out of Scope

- `field.fibreflow.app` domain setup — not needed (solved by routing into the existing app)
- `__pwa_task10/` standalone PWA — abandoned in favour of this approach
- Activation step 6 (ONT Back) special VLM — existing `validateOntBackCables` path unchanged
- Civils step 8 (Signature) VLM accuracy — flagged; requires manual gallery curation after launch
