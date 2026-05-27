# VLM Photo Gallery — Move + Save to VLM Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Photo Criteria Review Gallery from `/activate/photo-gallery` to `/system/vlm-learning/photo-gallery`, fix step count to 1–12, and add a Save button that persists good/bad decisions into the VLM learning pipeline.

**Architecture:** A new `save-decisions` API writes to `vlm_corrections` (text few-shot) and a new `vlm_visual_photo_examples` table (visual few-shot). Both are read by `categorizationVlmService` and `stepQualityValidationService`, closing the loop so gallery decisions improve auto-QA accuracy and PWA photo judgements. The gallery is relocated via a new Pages Router page under the System section and a nav dropdown entry.

**Tech Stack:** Next.js Pages Router, PostgreSQL via `pg.Pool` (`@/lib/db`), TypeScript, React, Tailwind CSS, Lucide icons

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `scripts/migrations/165_vlm_visual_photo_examples.sql` | New table for gallery-curated visual few-shot |
| **Rename** | `pages/api/activate/photo-gallery.ts` → `pages/api/activate/photo-gallery/index.ts` | Must become a directory to allow sub-routes |
| Create | `pages/api/activate/photo-gallery/save-decisions.ts` | POST: persist good/bad decisions to VLM tables |
| Create | `pages/system/vlm-learning/photo-gallery.tsx` | New page at VLM Learning URL |
| Modify | `pages/api/activate/photo-gallery/index.ts` | Fix step range 1–10 → 1–12 |
| Modify | `src/modules/activate/components/PhotoGalleryPage.tsx` | Add steps 11–12, save button, saved indicators |
| Modify | `src/components/system/systemNavConfig.ts` | Convert VLM tab to dropdown with Photo Gallery |
| Modify | `src/app/activate/photo-gallery/page.tsx` | Redirect to new URL |
| Modify | `src/modules/activate/services/categorizationVlmService.ts` | Supplement few-shot with vlm_corrections gallery rows |
| Modify | `src/modules/activate/services/stepQualityValidationService.ts` | Load vlm_visual_photo_examples as visual references |

---

### Task 1: DB Migration — vlm_visual_photo_examples

**Files:**
- Create: `scripts/migrations/165_vlm_visual_photo_examples.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Migration 165: VLM Visual Photo Examples
-- Stores gallery-curated good/bad photo URLs as visual few-shot examples
-- for stepQualityValidationService (auto-QA and PWA).

CREATE TABLE IF NOT EXISTS vlm_visual_photo_examples (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 12),
  photo_url   TEXT NOT NULL,
  label       TEXT NOT NULL CHECK (label IN ('positive', 'negative')),
  dr_number   TEXT,
  filename    TEXT,
  confidence  NUMERIC(4,3),
  saved_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(photo_url)
);

CREATE INDEX idx_vlm_visual_examples_step
  ON vlm_visual_photo_examples (step_number, label);
```

- [ ] **Step 2: Run migration on the shared DB via Velocity**

```bash
ssh velo@100.96.203.105
docker exec -i supabase-db psql -U fibreflow_user -d fibreflow \
  < /home/hein/Workspace/FF_Next.js/scripts/migrations/165_vlm_visual_photo_examples.sql
```

Expected output: `CREATE TABLE` then `CREATE INDEX`

- [ ] **Step 3: Verify**

```bash
docker exec -i supabase-db psql -U fibreflow_user -d fibreflow \
  -c "\d vlm_visual_photo_examples"
```

Expected: table with columns id, step_number, photo_url, label, dr_number, filename, confidence, saved_at

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/165_vlm_visual_photo_examples.sql
git commit -m "feat(vlm): add vlm_visual_photo_examples table for gallery-curated visual few-shot"
```

---

### Task 2: Rename API File + Fix Step Range

**Files:**
- Rename: `pages/api/activate/photo-gallery.ts` → `pages/api/activate/photo-gallery/index.ts`
- Modify: `pages/api/activate/photo-gallery/index.ts`

> **Why the rename:** Next.js Pages Router cannot have both a file `photo-gallery.ts` and a directory `photo-gallery/` at the same level. Moving to `index.ts` preserves the `/api/activate/photo-gallery` URL while allowing `save-decisions.ts` to live in the same folder.

- [ ] **Step 1: Move the file**

```bash
mkdir pages/api/activate/photo-gallery
git mv pages/api/activate/photo-gallery.ts pages/api/activate/photo-gallery/index.ts
```

- [ ] **Step 2: Fix the step range — two changes in the same file**

In `pages/api/activate/photo-gallery/index.ts`:

**Change A** — count query (the `allSteps` branch), change `BETWEEN 1 AND 10` to `BETWEEN 1 AND 12`:
```sql
WHERE (photo_result->>'vlm_predicted_step')::int BETWEEN 1 AND 12
```

**Change B** — step validation, change the guard and error message:
```typescript
// Before:
if (isNaN(step) || step < 1 || step > 10) {
  return apiResponse.error(res, 'VALIDATION_ERROR' as never, 'Step must be between 1 and 10');
}

// After:
if (isNaN(step) || step < 1 || step > 12) {
  return apiResponse.error(res, 'VALIDATION_ERROR' as never, 'Step must be between 1 and 12');
}
```

- [ ] **Step 3: Verify no import paths broke**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 0 errors (the file has no cross-imports that would break from the rename)

- [ ] **Step 4: Commit**

```bash
git add pages/api/activate/photo-gallery/
git commit -m "fix(activate): rename photo-gallery API to index.ts and extend step range to 1-12"
```

---

### Task 3: Save-Decisions API

**Files:**
- Create: `pages/api/activate/photo-gallery/save-decisions.ts`

- [ ] **Step 1: Create the file**

```typescript
/**
 * API Route: POST /api/activate/photo-gallery/save-decisions
 *
 * Persists gallery good/bad decisions into the VLM learning pipeline:
 *   - vlm_corrections       → text few-shot for categorizationVlmService
 *   - vlm_visual_photo_examples → visual few-shot for stepQualityValidationService
 *
 * Good photos: is_canonical=true, priority=95, corrected_value=step_N
 * Bad photos:  is_canonical=false, priority=10, corrected_value='reject', error_pattern='poor_quality_example'
 *
 * Duplicate guard: same source_id + module + analysis_type is a silent no-op.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { pool } from '@/lib/db';
import { log } from '@/lib/logger';

interface DecisionInput {
  drNumber: string;
  filename: string;
  url: string;
  stepNumber: number;
  stepName: string;
  decision: 'good' | 'bad';
  confidence: number;
}

interface SaveResult {
  saved: number;
  skipped: number;
  good: number;
  bad: number;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const decisions = req.body?.decisions as DecisionInput[] | undefined;
  if (!Array.isArray(decisions) || decisions.length === 0) {
    return apiResponse.error(res, 'VALIDATION_ERROR' as never, 'decisions must be a non-empty array');
  }

  const result: SaveResult = { saved: 0, skipped: 0, good: 0, bad: 0 };

  for (const d of decisions) {
    if (!d.drNumber || !d.filename || !d.url || !d.stepNumber || !d.decision) continue;
    if (d.stepNumber < 1 || d.stepNumber > 12) continue;
    if (d.decision !== 'good' && d.decision !== 'bad') continue;

    const sourceId = `gallery/${d.drNumber}/${d.filename}`;
    const isGood = d.decision === 'good';

    try {
      // Duplicate guard
      const existing = await pool.query(
        `SELECT id FROM vlm_corrections
         WHERE source_id = $1
           AND module = 'activate'
           AND analysis_type = 'photo_categorization'
         LIMIT 1`,
        [sourceId]
      );
      if ((existing.rowCount ?? 0) > 0) {
        result.skipped++;
        continue;
      }

      // Write to vlm_corrections (text few-shot pipeline)
      await pool.query(
        `INSERT INTO vlm_corrections (
          module, analysis_type, source_id, photo_url,
          vlm_extracted_value, corrected_value, error_pattern, correction_notes,
          context_json, is_canonical, priority
        ) VALUES (
          'activate', 'photo_categorization', $1, $2,
          $3, $4, $5, $6,
          $7::jsonb, $8, $9
        )`,
        [
          sourceId,
          d.url,
          `step_${d.stepNumber}`,
          isGood ? `step_${d.stepNumber}` : 'reject',
          isGood ? null : 'poor_quality_example',
          isGood
            ? `Gallery: confirmed good example — step ${d.stepNumber} (${d.stepName})`
            : `Gallery: bad/reject example — step ${d.stepNumber} (${d.stepName})`,
          JSON.stringify({ stepNumber: d.stepNumber, stepName: d.stepName }),
          isGood,          // is_canonical
          isGood ? 95 : 10, // priority
        ]
      );

      // Write to vlm_visual_photo_examples (visual few-shot pipeline)
      await pool.query(
        `INSERT INTO vlm_visual_photo_examples
           (step_number, photo_url, label, dr_number, filename, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (photo_url) DO NOTHING`,
        [d.stepNumber, d.url, isGood ? 'positive' : 'negative', d.drNumber, d.filename, d.confidence]
      );

      result.saved++;
      if (isGood) result.good++;
      else result.bad++;
    } catch (err) {
      log.error('[SaveDecisions] Error saving decision', { sourceId, err });
      // Continue processing remaining decisions — partial success is fine
    }
  }

  log.info(
    `[SaveDecisions] Saved ${result.saved}, skipped ${result.skipped}`,
    undefined,
    'PhotoGallery'
  );
  return apiResponse.success(res, result);
}

export default withAuth(handler);
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep save-decisions
```

Expected: no output (zero errors in this file)

- [ ] **Step 3: Commit**

```bash
git add pages/api/activate/photo-gallery/save-decisions.ts
git commit -m "feat(activate): add save-decisions API — persists gallery decisions to VLM pipeline"
```

---

### Task 4: Update PhotoGalleryPage — Steps 1–12 + Save Button

**Files:**
- Modify: `src/modules/activate/components/PhotoGalleryPage.tsx`

- [ ] **Step 1: Add steps 11 and 12 to STEP_LABELS**

Replace the existing `STEP_LABELS` const (currently ends at step 10):

```typescript
const STEP_LABELS: Record<number, string> = {
  1: 'House Photo',
  2: 'Cable from Pole',
  3: 'Entry Outside',
  4: 'Entry Inside',
  5: 'Wall (ONT Mount)',
  6: 'ONT Back After Install',
  7: 'Power Meter',
  8: 'Final Installation',
  9: 'Green Lights',
  10: 'Signature',
  11: 'Dome Joint Open',
  12: 'Dome Joint Closed',
};
```

- [ ] **Step 2: Update the import to include Save icon**

Replace the Lucide import line:

```typescript
import {
  CheckCircle2, XCircle, ChevronLeft, ChevronRight,
  Loader2, RefreshCw, Save,
} from 'lucide-react';
```

- [ ] **Step 3: Add save state variables inside PhotoGalleryPage()**

Add after the existing `const [imageErrors, ...]` line:

```typescript
const [saving, setSaving] = useState(false);
const [savedPhotoIds, setSavedPhotoIds] = useState<Set<string>>(new Set());
const [showConfirmModal, setShowConfirmModal] = useState(false);
const [saveResult, setSaveResult] = useState<{ saved: number; good: number; bad: number } | null>(null);
```

- [ ] **Step 4: Add computed unsaved counts**

Add after the existing `const undecidedCount` line:

```typescript
const unsavedGoodCount = photos.filter(
  (p) => decisions[photoKey(p)] === 'good' && !savedPhotoIds.has(photoKey(p))
).length;
const unsavedBadCount = photos.filter(
  (p) => decisions[photoKey(p)] === 'bad' && !savedPhotoIds.has(photoKey(p))
).length;
const unsavedDecisionCount = unsavedGoodCount + unsavedBadCount;
```

- [ ] **Step 5: Add handleSave function**

Add after the existing `copyResults` function:

```typescript
const handleSave = async () => {
  const decisionsToSave = photos
    .filter((p) => decisions[photoKey(p)] !== null && !savedPhotoIds.has(photoKey(p)))
    .map((p) => ({
      drNumber: p.drNumber,
      filename: p.filename,
      url: p.url,
      stepNumber: activeStep,
      stepName: STEP_LABELS[activeStep] ?? `Step ${activeStep}`,
      decision: decisions[photoKey(p)] as 'good' | 'bad',
      confidence: p.confidence,
    }));

  if (decisionsToSave.length === 0) return;

  setSaving(true);
  setShowConfirmModal(false);
  try {
    const res = await fetch('/api/activate/photo-gallery/save-decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decisions: decisionsToSave }),
    });
    const data = await res.json() as {
      success: boolean;
      data?: { saved: number; skipped: number; good: number; bad: number };
    };
    if (data.success && data.data) {
      const { saved, good, bad } = data.data;
      setSavedPhotoIds((prev) => {
        const next = new Set(prev);
        decisionsToSave.forEach((d) => next.add(`${d.drNumber}__${d.filename}`));
        return next;
      });
      setSaveResult({ saved, good, bad });
      setTimeout(() => setSaveResult(null), 5000);
    }
  } catch {
    // silent — user can retry
  } finally {
    setSaving(false);
  }
};
```

- [ ] **Step 6: Replace Copy Results button with Save button in the header**

Replace the existing `{(goodCount > 0 || badCount > 0) && ...}` button block with:

```tsx
{/* Save to VLM Learning */}
{unsavedDecisionCount > 0 && (
  <button
    onClick={() => setShowConfirmModal(true)}
    disabled={saving}
    className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
  >
    {saving ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
    ) : (
      <Save className="h-3.5 w-3.5" />
    )}
    Save {unsavedDecisionCount} decision{unsavedDecisionCount !== 1 ? 's' : ''}
  </button>
)}
{saveResult && (
  <span className="text-sm text-green-400 animate-pulse">
    ✓ Saved {saveResult.saved} ({saveResult.good}✅ {saveResult.bad}❌)
  </span>
)}
```

- [ ] **Step 7: Add "already saved" indicator on grid cards**

In the grid view, inside the card `<div>`, add after the `{/* Decision badge */}` block:

```tsx
{/* Saved indicator */}
{savedPhotoIds.has(key) && (
  <div className="absolute top-1 left-1 rounded-full bg-blue-700/90 p-0.5">
    <Save className="h-3 w-3 text-white" />
  </div>
)}
```

- [ ] **Step 8: Add confirmation modal**

Add before the final closing `</div>` of the component return:

```tsx
{/* Save confirmation modal */}
{showConfirmModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
    <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-xl">
      <h3 className="mb-2 text-base font-semibold text-white">
        Save to VLM Learning
      </h3>
      <p className="mb-4 text-sm text-gray-400">
        Save {unsavedDecisionCount} decision{unsavedDecisionCount !== 1 ? 's' : ''} for{' '}
        <span className="text-white">Step {activeStep} — {STEP_LABELS[activeStep]}</span>?
        <br />
        <span className="text-green-400">{unsavedGoodCount} good</span>
        {' · '}
        <span className="text-red-400">{unsavedBadCount} bad</span>
        {' examples will train the VLM for auto-QA and PWA.'}
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => setShowConfirmModal(false)}
          className="flex-1 rounded-lg border border-gray-700 py-2 text-sm text-gray-400 hover:text-white"
        >
          Cancel
        </button>
        <button
          onClick={() => void handleSave()}
          className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Save Examples
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/activate/components/PhotoGalleryPage.tsx
git commit -m "feat(activate): add steps 11-12 (dome joint) + save button for VLM training"
```

---

### Task 5: Create System VLM Learning Photo Gallery Page

**Files:**
- Create: `pages/system/vlm-learning/photo-gallery.tsx`

> The `pages/system/vlm-learning/` directory may not yet exist — create it first.

- [ ] **Step 1: Create directory and file**

```typescript
/**
 * System > VLM Learning > Photo Gallery
 * URL: /system/vlm-learning/photo-gallery
 *
 * Relocated from /activate/photo-gallery.
 * Renders the same PhotoGalleryPage component.
 */

import { AppLayout } from '@/components/layout';
import PhotoGalleryPage from '@/modules/activate/components/PhotoGalleryPage';

export default function VlmPhotoGalleryRoute() {
  return (
    <AppLayout>
      <PhotoGalleryPage />
    </AppLayout>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add pages/system/vlm-learning/photo-gallery.tsx
git commit -m "feat(system): Photo Gallery page at /system/vlm-learning/photo-gallery"
```

---

### Task 6: Redirect Old Route

**Files:**
- Modify: `src/app/activate/photo-gallery/page.tsx`

- [ ] **Step 1: Replace page with a client-side redirect**

```typescript
/**
 * /activate/photo-gallery → redirect to VLM Learning section
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PhotoGalleryRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/system/vlm-learning/photo-gallery');
  }, [router]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">
      Redirecting to VLM Learning…
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/activate/photo-gallery/page.tsx
git commit -m "refactor(activate): redirect /activate/photo-gallery → /system/vlm-learning/photo-gallery"
```

---

### Task 7: Update System Navigation Dropdown

**Files:**
- Modify: `src/components/system/systemNavConfig.ts`

- [ ] **Step 1: Convert the VLM tab from a link to a dropdown**

In the `TABS` array, replace:
```typescript
{ id: 'vlm', label: 'VLM Learning', href: '/system/vlm-learning' },
```

With:
```typescript
{
  id: 'vlm',
  label: 'VLM Learning',
  items: [
    { label: 'Dashboard',     href: '/system/vlm-learning' },
    { label: 'Photo Gallery', href: '/system/vlm-learning/photo-gallery' },
  ],
},
```

The `getActiveTabId` function already returns `'vlm'` for any path starting with `/system/vlm-learning/` (line 39), so no changes needed there.

- [ ] **Step 2: Commit**

```bash
git add src/components/system/systemNavConfig.ts
git commit -m "feat(system): VLM Learning nav → dropdown with Dashboard + Photo Gallery"
```

---

### Task 8: Pipeline Hook — categorizationVlmService

**Files:**
- Modify: `src/modules/activate/services/categorizationVlmService.ts`

- [ ] **Step 1: Read the full file**

Read `src/modules/activate/services/categorizationVlmService.ts`. Find:
1. The import section at the top
2. The `categorizePhotos()` function — specifically where `getRelevantExamples()` and `getPositiveExamples()` are called (around lines 382–425 per the exploration)
3. How the prompt string is assembled — where the few-shot section is injected (around lines 131–138)
4. The `buildCategorizationPrompt()` function signature

- [ ] **Step 2: Add pool import (if not already imported)**

At the top of the file, add if missing:
```typescript
import { pool } from '@/lib/db';
```

- [ ] **Step 3: Fetch gallery corrections inside categorizePhotos()**

After the existing `getPositiveExamples()` call (but still inside `categorizePhotos()` before the VLM call), add:

```typescript
// Supplement with gallery-curated corrections from vlm_corrections
let gallerySectionText = '';
try {
  const { rows: galleryRows } = await pool.query<{
    vlm_extracted_value: string;
    corrected_value: string;
    correction_notes: string | null;
    is_canonical: boolean;
  }>(
    `SELECT vlm_extracted_value, corrected_value, correction_notes, is_canonical
     FROM vlm_corrections
     WHERE module = 'activate'
       AND analysis_type = 'photo_categorization'
     ORDER BY is_canonical DESC, priority DESC, created_at DESC
     LIMIT 8`
  );

  if (galleryRows.length > 0) {
    const goodRows = galleryRows.filter((r) => r.corrected_value !== 'reject');
    const badRows  = galleryRows.filter((r) => r.corrected_value === 'reject');
    const lines: string[] = ['\n### GALLERY-CURATED EXAMPLES:'];

    if (goodRows.length > 0) {
      lines.push('\nConfirmed ACCEPTABLE photos (prioritise accepting these):');
      goodRows.slice(0, 4).forEach((r) => {
        lines.push(`✅ ACCEPT photos for ${r.vlm_extracted_value}`);
        if (r.correction_notes) lines.push(`   (${r.correction_notes})`);
      });
    }
    if (badRows.length > 0) {
      lines.push('\nConfirmed REJECT photos (do not accept these):');
      badRows.slice(0, 4).forEach((r) => {
        lines.push(`❌ REJECT photos for ${r.vlm_extracted_value}`);
        if (r.correction_notes) lines.push(`   (${r.correction_notes})`);
      });
    }
    gallerySectionText = lines.join('\n');
  }
} catch (err) {
  log.warn('[CategorizationVlm] Failed to load gallery corrections — continuing without them', { err });
}
```

- [ ] **Step 4: Inject gallerySectionText into the prompt**

Find where `buildCategorizationPrompt()` assembles the final prompt string. Append `gallerySectionText` to the prompt just before the output format specification. The exact location depends on the function's internals — look for the line that adds the output format section and insert before it:

```typescript
// Existing (approximate):
let prompt = basePrompt + qaCriteriaSection + fewShotSection + positiveSection + outputFormatSection;

// Updated:
let prompt = basePrompt + qaCriteriaSection + fewShotSection + positiveSection + gallerySectionText + outputFormatSection;
```

If `buildCategorizationPrompt()` takes parameters (rather than closing over variables), add `gallerySectionText` as a new optional parameter `gallerySection?: string` and concatenate it inside the function.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep categorizationVlmService
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/modules/activate/services/categorizationVlmService.ts
git commit -m "feat(vlm): inject gallery vlm_corrections examples into photo categorisation prompts"
```

---

### Task 9: Pipeline Hook — stepQualityValidationService

**Files:**
- Modify: `src/modules/activate/services/stepQualityValidationService.ts`

- [ ] **Step 1: Read the full file**

Read `src/modules/activate/services/stepQualityValidationService.ts`. Find:
1. The import section
2. The `checkOnePhoto()` function — specifically the `buildMessageContent()` call
3. The `buildMessageContent()` function signature (may be in `stepQualityCriteria.ts`) — what parameters it accepts and how it adds image content to the message array

- [ ] **Step 2: Add pool import (if not already present)**

```typescript
import { pool } from '@/lib/db';
```

- [ ] **Step 3: Fetch gallery visual examples inside checkOnePhoto()**

Before the `buildMessageContent()` call, add:

```typescript
// Load gallery-curated visual examples for this step
let galleryPositiveUrls: string[] = [];
let galleryNegativeUrls: string[] = [];
try {
  const { rows } = await pool.query<{ photo_url: string; label: string }>(
    `SELECT photo_url, label
     FROM vlm_visual_photo_examples
     WHERE step_number = $1
     ORDER BY saved_at DESC
     LIMIT 6`,
    [step]
  );
  galleryPositiveUrls = rows.filter((r) => r.label === 'positive').map((r) => r.photo_url);
  galleryNegativeUrls = rows.filter((r) => r.label === 'negative').map((r) => r.photo_url);
} catch (err) {
  log.warn('[StepQualityValidation] Failed to load gallery visual examples', { err });
}
```

- [ ] **Step 4: Pass gallery URLs into buildMessageContent()**

Modify the `buildMessageContent()` call to pass the gallery URLs. If the function currently accepts no extra parameters, add two optional ones:

```typescript
// In buildMessageContent signature:
galleryPositiveUrls?: string[],
galleryNegativeUrls?: string[],
```

Inside `buildMessageContent()`, after the existing reference image injection, add a text label and the gallery URLs using the same pattern used for existing reference images (base64 or URL, whichever the function already uses).

**Pattern to follow (use whichever image content format already exists in the function):**

```typescript
// If gallery URLs are available, append them before the "photo to evaluate" image
if (galleryPositiveUrls && galleryPositiveUrls.length > 0) {
  messageContent.push({ type: 'text', text: '\n**Additional field-verified GOOD examples:**' });
  for (const url of galleryPositiveUrls.slice(0, 3)) {
    // Follow the same image loading pattern already in this function:
    // e.g. fetch + base64, or { type: 'image_url', url } depending on VLM client
    // See how existing reference images are loaded and replicate that pattern exactly.
    messageContent.push(/* same format as existing reference images but loaded from url */);
  }
}
if (galleryNegativeUrls && galleryNegativeUrls.length > 0) {
  messageContent.push({ type: 'text', text: '\n**Field-verified REJECT examples (do not accept photos like these):**' });
  for (const url of galleryNegativeUrls.slice(0, 3)) {
    messageContent.push(/* same format */);
  }
}
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep stepQualityValidation
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add src/modules/activate/services/stepQualityValidationService.ts
git commit -m "feat(vlm): load gallery visual examples into step quality validation prompts"
```

---

### Task 10: QA + PR

- [ ] **Step 1: Full lint and type-check**

```bash
npm run lint && npm run type-check
```

Expected: 0 errors, 0 warnings

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: `✓ Compiled successfully` with no TypeScript errors

- [ ] **Step 3: Open the PR**

```bash
gh pr create \
  --base master \
  --title "feat(vlm): photo gallery → VLM Learning + save good/bad examples to pipeline" \
  --body "## What

Moves the Photo Criteria Review Gallery from \`/activate/photo-gallery\` to \`/system/vlm-learning/photo-gallery\`, fixes the step count to 1–12 (dome joint steps are required), and adds a Save button that persists good/bad decisions into the VLM learning pipeline.

## Changes

### Gallery relocation
- New page: \`/system/vlm-learning/photo-gallery\`
- Old URL \`/activate/photo-gallery\` redirects to new location
- System nav: VLM Learning tab → dropdown (Dashboard + Photo Gallery)

### Step count fix
- Steps 11 (Dome Joint Open) and 12 (Dome Joint Closed) now appear in the gallery sidebar — these are required steps

### Save to VLM Learning
- **Save button** appears when decisions are pending; confirmation modal shows breakdown (X good, Y bad)
- **POST \`/api/activate/photo-gallery/save-decisions\`** writes each decision to two tables:
  - \`vlm_corrections\` — text few-shot (good = canonical priority-95, bad = poor_quality_example)
  - \`vlm_visual_photo_examples\` — visual few-shot (positive / negative labels)
- Duplicate guard: re-saving same photo is a silent no-op
- Saved indicator (blue save icon) overlaid on gallery cards after saving

### Pipeline hooks (cumulative learning)
- \`categorizationVlmService\`: gallery corrections from \`vlm_corrections\` now supplement the qa-learning few-shot examples in the step-assignment prompt
- \`stepQualityValidationService\`: \`vlm_visual_photo_examples\` rows are loaded and injected as additional visual reference images for pass/fail evaluation

### DB migration
- \`scripts/migrations/165_vlm_visual_photo_examples.sql\` — new table with step_number, photo_url, label (positive/negative), dedup unique constraint

## How it improves accuracy
Every gallery session compounds the VLM's knowledge:
1. Good examples → VLM learns what acceptable photos look like per step
2. Bad examples → VLM learns to reject photos like these
3. Both flow into auto-QA (today) and the upcoming PhotoGuide PWA (when built)

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR URL printed to stdout

---

## Spec Self-Review Checklist

- [x] **Gallery move** → Tasks 5, 6, 7
- [x] **Steps 1–12** → Tasks 2, 4
- [x] **Save button UI** → Task 4
- [x] **save-decisions API** → Task 3
- [x] **vlm_visual_photo_examples table** → Task 1
- [x] **API file renamed to index.ts** (critical for sub-routes) → Task 2
- [x] **Duplicate guard** → Task 3 (source_id check before insert)
- [x] **categorizationVlmService hook** → Task 8
- [x] **stepQualityValidationService hook** → Task 9
- [x] **Type consistency** — `DecisionInput` defined in Task 3, used identically in Task 4's `handleSave`
- [x] **pool used throughout new code** — no neon imports in new files
- [x] **No placeholders in Tasks 1–7** — Tasks 8–9 require reading files first (content-dependent changes noted with explicit patterns to follow)
