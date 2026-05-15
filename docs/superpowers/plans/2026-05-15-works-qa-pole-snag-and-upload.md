# Works QA — Pole Verify Snag + Upload Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one PR that (1) adds a "Confirm: is pole planted?" verification snag on every Works QA pole row + detail panel, (2) fixes the click-to-upload bug on empty photo slots, and (3) adds drag-and-drop from Windows Explorer onto photo slots and trays.

**Architecture:** Reuses the existing `snags` table by introducing a new `'verification'` category. The snags API is relaxed *only for this category* to allow `report_id = null` and to auto-generate `snag_number`. The pole list aggregate gains two `EXISTS` flags so the row can render a tri-state flag icon. Upload-click is fixed by swapping programmatic `ref.click()` for a native `<label>`-wrapped file input — the standard, frame-independent pattern. Drag-and-drop is purely additive and routes through the same `/api/works-qa/pole-assign` endpoint.

**Tech Stack:** Next.js 14 (Pages Router), Pages API routes, `pg` Pool via `@neondatabase/serverless` shim, Vitest + @testing-library/react for tests, Tailwind CSS, SWR for data fetching.

**Working dir:** `/home/hein/Workspace/FF_Next.js-pole-snag` (worktree on branch `feat/works-qa-pole-snag-and-upload`)

**Spec:** [`docs/superpowers/specs/2026-05-15-works-qa-pole-snag-and-upload-fix-design.md`](../specs/2026-05-15-works-qa-pole-snag-and-upload-fix-design.md)

---

## File Map (lock decomposition before tasks)

**Modified:**
| File | Why |
|---|---|
| `src/modules/construction-qa/types/snag.types.ts` | Add `'verification'` to `SnagCategory` union |
| `pages/api/snags/index.ts` | `handlePost` accepts null `report_id` + auto-generates `snag_number` for `verification`; skips `total_findings` update when null |
| `pages/api/works-qa/poles.ts` | Two `EXISTS` subselects against `snags` for verification state per pole |
| `src/modules/works-qa/types/works-qa.types.ts` | `PoleSummary` gains `has_open_verification_snag` + `has_verified_planted` |
| `src/modules/works-qa/components/PoleListTable.tsx` | New flag-icon column with tri-state colour + onClick → modal |
| `src/modules/works-qa/components/PoleDetailPanel.tsx` | "Snag pole" button in header, opens same modal |
| `src/modules/works-qa/components/PhotoSlotCard.tsx` | `<label>` swap + drag-drop handlers |
| `src/modules/works-qa/components/TrayBucket.tsx` | `<label>` swap + drag-drop handlers |

**New:**
| File | Why |
|---|---|
| `src/modules/works-qa/components/ConfirmPlantedModal.tsx` | Modal: "Confirm: is pole {label} planted?" with Yes / No / Cancel |
| `src/modules/works-qa/hooks/useVerificationSnag.ts` | SWR hook fetching the current open verification snag (if any) for a given pole |
| `pages/api/snags/__tests__/handlePost.test.ts` | Vitest covering the new null-`report_id` path |

**Total diff target:** ~250 lines (slightly higher than the spec's ~170 estimate after adding the SWR hook + test file).

---

## Task 1: Extend SnagCategory union

**Files:**
- Modify: `src/modules/construction-qa/types/snag.types.ts` (around line 25-30)

- [ ] **Step 1: Edit the union**

```ts
export type SnagCategory =
  | 'quality'
  | 'health'
  | 'safety'
  | 'environment'
  | 'traffic'
  | 'verification';   // NEW — for pole-presence confirmation snags created from Works QA
```

- [ ] **Step 2: Type check passes**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "snag\.types|SnagCategory" | head -10`
Expected: no errors mentioning `SnagCategory`.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/construction-qa/types/snag.types.ts
git -c commit.gpgsign=false commit -m "feat(works-qa): add 'verification' to SnagCategory union"
```

---

## Task 2: Snags API — accept null `report_id` and auto-generate `snag_number` for verification

**Files:**
- Modify: `pages/api/snags/index.ts:152-198` (handlePost function)
- Test: `pages/api/snags/__tests__/handlePost.test.ts` (new)

- [ ] **Step 1: Write failing test**

Create `pages/api/snags/__tests__/handlePost.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock the neon client BEFORE importing the handler
const mockSql = vi.fn();
vi.mock('@neondatabase/serverless', () => ({
  neon: () => mockSql,
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/modules/noc/services/ticketService', () => ({
  updateTicket: vi.fn(),
}));

import handler from '../index';

function makeRes() {
  const res: Partial<NextApiResponse> & { jsonData?: unknown; statusCode?: number } = {};
  res.status = vi.fn((code: number) => { res.statusCode = code; return res as NextApiResponse; });
  res.json = vi.fn((data: unknown) => { res.jsonData = data; return res as NextApiResponse; });
  return res as NextApiResponse & { jsonData?: unknown; statusCode?: number };
}

describe('POST /api/snags — verification category', () => {
  beforeEach(() => {
    mockSql.mockReset();
  });

  it('creates a verification snag without report_id and auto-generates snag_number', async () => {
    // First call = SELECT next snag_number; second call = INSERT
    mockSql
      .mockResolvedValueOnce([{ next_num: 42 }])
      .mockResolvedValueOnce([{ id: 'snag-uuid', snag_number: 42, category: 'verification', status: 'open' }]);

    const req = {
      method: 'POST',
      body: {
        project_id: 'proj-uuid',
        category: 'verification',
        description: 'Confirm if pole is planted on site',
        pole_references: ['MOA.P.D134'],
        pole_qa_photo_id: 'pole-uuid',
        severity: 'minor',
        // no report_id, no snag_number
      },
    } as unknown as NextApiRequest;
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(mockSql).toHaveBeenCalledTimes(2);  // SELECT next_num + INSERT — no total_findings UPDATE
  });

  it('still rejects non-verification snags missing report_id', async () => {
    const req = {
      method: 'POST',
      body: {
        project_id: 'proj-uuid',
        category: 'quality',
        description: 'Bad weld',
        pole_references: ['MOA.P.D134'],
      },
    } as unknown as NextApiRequest;
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx vitest run pages/api/snags/__tests__/handlePost.test.ts 2>&1 | tail -20`
Expected: FAIL — both tests fail (current handler requires `report_id` and `snag_number` unconditionally).

- [ ] **Step 3: Modify `pages/api/snags/index.ts`**

Replace the validation block (currently lines 152-159) and the INSERT block (currently lines 164-194) with:

```ts
async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  const body = req.body as CreateSnagRequest;

  if (!body.project_id) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'project_id is required');
  }
  if (!body.category) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'category is required');
  }
  if (!body.description || !body.description.trim()) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'description is required');
  }

  const isVerification = body.category === 'verification';

  // PDF-imported snags must carry a report_id + snag_number. Verification snags
  // are created from the Works QA pole list without a parent report, so we
  // relax the requirement only for that category and auto-generate snag_number.
  if (!isVerification) {
    if (!body.report_id) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'report_id is required');
    }
    if (!body.snag_number) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'snag_number is required');
    }
  }

  let snagNumber = body.snag_number;
  if (isVerification) {
    const rows = await sql`
      SELECT COALESCE(MAX(snag_number), 0) + 1 AS next_num
      FROM snags
      WHERE project_id = ${body.project_id} AND report_id IS NULL
    ` as Array<{ next_num: number }>;
    snagNumber = rows[0]?.next_num ?? 1;
  }

  const rows = await sql`
    INSERT INTO snags (
      report_id, project_id, snag_number,
      category, severity, description,
      pole_references, pole_qa_photo_id, source,
      status, verification_notes
    ) VALUES (
      ${body.report_id ?? null},
      ${body.project_id},
      ${snagNumber},
      ${body.category},
      ${body.severity ?? (isVerification ? 'minor' : 'major')},
      ${body.description.trim()},
      ${body.pole_references ?? null},
      ${body.pole_qa_photo_id ?? null},
      ${isVerification ? 'works_qa' : null},
      'open',
      ${body.verification_notes ?? null}
    )
    RETURNING *
  ` as Snag[];

  if (!rows[0]) {
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to create snag');
  }

  // Only PDF-imported snags update the report's running total.
  if (body.report_id) {
    await sql`
      UPDATE snag_reports
      SET total_findings = (
        SELECT COUNT(*) FROM snags WHERE report_id = ${body.report_id}
      ),
      updated_at = NOW()
      WHERE id = ${body.report_id}
    `;
  }

  log.info('Snag created', { snagId: rows[0].id, reportId: body.report_id ?? null, category: body.category });
  return apiResponse.created(res, rows[0]);
}
```

Also extend `CreateSnagRequest` in `src/modules/construction-qa/types/snag.types.ts` to make `report_id` and `snag_number` optional (find the interface around line 270-310) and add `verification_notes?: string`:

```ts
export interface CreateSnagRequest {
  report_id?: string | null;        // CHANGED — optional for verification snags
  project_id: string;
  snag_number?: number;             // CHANGED — auto-generated for verification snags
  category: SnagCategory;
  severity?: SnagSeverity;
  description: string;
  pole_references?: string[] | null;
  pole_qa_photo_id?: string | null; // NEW — links Works QA snags back to the pole_qa_photos row
  verification_notes?: string;      // NEW — auto-filled by ConfirmPlantedModal
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx vitest run pages/api/snags/__tests__/handlePost.test.ts 2>&1 | tail -20`
Expected: PASS — 2/2.

- [ ] **Step 5: Type check**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "snags/index|snag\.types" | head -10`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add pages/api/snags/index.ts pages/api/snags/__tests__/handlePost.test.ts src/modules/construction-qa/types/snag.types.ts
git -c commit.gpgsign=false commit -m "feat(snags): allow null report_id + auto snag_number for verification category"
```

---

## Task 3: Pole list API — surface verification state per pole

**Files:**
- Modify: `pages/api/works-qa/poles.ts` (the SELECT inside `handler`, around lines 24-90)
- Modify: `src/modules/works-qa/types/works-qa.types.ts` (`PoleSummary` interface around line 77-90)

- [ ] **Step 1: Extend `PoleSummary` type**

Edit `src/modules/works-qa/types/works-qa.types.ts`, add two fields at the end of `PoleSummary`:

```ts
export interface PoleSummary {
  id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;
  civil_filled: number;
  dome_filled: number;
  joint_filled: number;
  tray_count: number;
  vlm_failures: number;
  status: 'empty' | 'in_progress' | 'ready' | 'approved';
  approved_at: string | null;
  outstanding_snag_count: number;
  has_open_verification_snag: boolean;    // NEW — at least one open category='verification' snag references this pole
  has_verified_planted: boolean;          // NEW — at least one verified category='verification' snag (the "Yes — planted" terminal state)
}
```

- [ ] **Step 2: Edit the SELECT in `pages/api/works-qa/poles.ts`**

Insert two new columns into the SELECT (after `outstanding_snag_count`, before `FROM pole_qa_photos`). The two `EXISTS` clauses join via `pole_qa_photo_id` (existing column on `snags` for Works QA snags) — *not* `pole_references` — to keep parity with the existing `outstanding_snag_count` aggregate at line 65.

```sql
        COALESCE((
          SELECT COUNT(*)::int
            FROM snags s
           WHERE s.pole_qa_photo_id = pole_qa_photos.id
             AND s.source = 'works_qa'
             AND s.status NOT IN ('verified','closed')
        ), 0) AS outstanding_snag_count,
        EXISTS (
          SELECT 1 FROM snags s
          WHERE s.pole_qa_photo_id = pole_qa_photos.id
            AND s.category = 'verification'
            AND s.status = 'open'
        ) AS has_open_verification_snag,
        EXISTS (
          SELECT 1 FROM snags s
          WHERE s.pole_qa_photo_id = pole_qa_photos.id
            AND s.category = 'verification'
            AND s.status = 'verified'
        ) AS has_verified_planted
      FROM pole_qa_photos
```

- [ ] **Step 3: Type check + lint**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "works-qa|poles" | head -10`
Expected: no errors.

- [ ] **Step 4: Manual API smoke**

Hein will run the dev server and curl: `curl -s "http://localhost:3004/api/works-qa/poles?project_id=<mawadien-uuid>&pon_no=134" | jq '.[0]'` — should show `has_open_verification_snag: false, has_verified_planted: false` on Pole 128.

(This step is documentation only — no automated assertion. Hein verifies once dev is up.)

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add pages/api/works-qa/poles.ts src/modules/works-qa/types/works-qa.types.ts
git -c commit.gpgsign=false commit -m "feat(works-qa): surface verification snag state in poles list API"
```

---

## Task 4: `useVerificationSnag` SWR hook

**Files:**
- Create: `src/modules/works-qa/hooks/useVerificationSnag.ts`

- [ ] **Step 1: Create the file**

```ts
import useSWR from 'swr';
import type { Snag } from '@/modules/construction-qa/types/snag.types';

interface ApiEnvelope<T> { success?: boolean; data?: T }

async function fetcher(url: string): Promise<Snag | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const body = (await res.json()) as ApiEnvelope<Snag[]> | Snag[];
  const list = Array.isArray(body) ? body : body.data ?? [];
  // Prefer open over verified for display purposes
  const open = list.find(s => s.status === 'open');
  if (open) return open;
  return list[0] ?? null;
}

/**
 * Returns the most relevant verification snag for the given pole, if any.
 * `null` while loading or when none exists.
 */
export function useVerificationSnag(projectId: string | null, poleLabel: string | null) {
  const key = projectId && poleLabel
    ? `/api/snags?projectId=${encodeURIComponent(projectId)}&category=verification&search=${encodeURIComponent(poleLabel)}`
    : null;
  const { data, isLoading, mutate } = useSWR<Snag | null>(key, fetcher);
  return { snag: data ?? null, isLoading, mutate };
}
```

Note: the existing `GET /api/snags` supports `projectId` + `category` + `search` query params (`search` matches pole references). We narrow client-side because the API doesn't expose a direct `pole_label=` filter and adding one would be scope creep.

- [ ] **Step 2: Type check**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep useVerificationSnag | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/works-qa/hooks/useVerificationSnag.ts
git -c commit.gpgsign=false commit -m "feat(works-qa): add useVerificationSnag SWR hook"
```

---

## Task 5: `ConfirmPlantedModal` component

**Files:**
- Create: `src/modules/works-qa/components/ConfirmPlantedModal.tsx`

- [ ] **Step 1: Create the file**

```tsx
import { useState } from 'react';
import { useVerificationSnag } from '../hooks/useVerificationSnag';
import { log } from '@/lib/logger';
import type { CreateSnagRequest } from '@/modules/construction-qa/types/snag.types';

interface ConfirmPlantedModalProps {
  open: boolean;
  projectId: string;
  poleQaPhotoId: string;
  poleLabel: string;
  onClose: () => void;
  onChanged: () => void;   // parent revalidates pole list after Yes/No
}

export function ConfirmPlantedModal({ open, projectId, poleQaPhotoId, poleLabel, onClose, onChanged }: ConfirmPlantedModalProps) {
  const { snag, isLoading, mutate } = useVerificationSnag(open ? projectId : null, open ? poleLabel : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function answer(planted: boolean) {
    setBusy(true);
    setError(null);
    const stamp = new Date().toISOString();
    const note = `${planted ? 'Confirmed PLANTED' : 'Confirmed NOT PLANTED'} at ${stamp}`;

    try {
      let snagId = snag?.id;
      if (!snagId) {
        const createBody: CreateSnagRequest = {
          project_id: projectId,
          category: 'verification',
          severity: 'minor',
          description: 'Confirm if pole is planted on site',
          pole_references: [poleLabel],
          pole_qa_photo_id: poleQaPhotoId,
          verification_notes: note,
        };
        const createRes = await fetch('/api/snags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createBody),
        });
        if (!createRes.ok) throw new Error(`Create failed: ${createRes.status}`);
        const created = await createRes.json() as { data?: { id: string } };
        snagId = created.data?.id;
      }

      if (planted && snagId) {
        const patchRes = await fetch('/api/snags', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: snagId, status: 'verified', verification_notes: note }),
        });
        if (!patchRes.ok) throw new Error(`Verify failed: ${patchRes.status}`);
      } else if (!planted && snag) {
        // Existing open snag — append a fresh "still not planted" note.
        const merged = (snag.verification_notes ? snag.verification_notes + '\n' : '') + note;
        const patchRes = await fetch('/api/snags', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: snagId, verification_notes: merged }),
        });
        if (!patchRes.ok) throw new Error(`Note update failed: ${patchRes.status}`);
      }

      await mutate();
      onChanged();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error('works-qa: confirm planted failed', { error: msg, poleLabel });
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md p-5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-zinc-100 font-semibold">Confirm: Is pole {poleLabel} planted on site?</h2>

        {isLoading ? (
          <p className="text-sm text-zinc-500">Checking existing snag…</p>
        ) : snag ? (
          <div className="text-xs text-zinc-400 border border-zinc-800 rounded p-2 max-h-32 overflow-y-auto whitespace-pre-wrap">
            <div className="text-zinc-500 mb-1">Existing snag ({snag.status}):</div>
            {snag.verification_notes ?? snag.description}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No existing verification snag for this pole.</p>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={() => void answer(false)}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white text-xs font-medium disabled:opacity-40"
          >
            No — not planted
          </button>
          <button
            onClick={() => void answer(true)}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 text-white text-xs font-medium disabled:opacity-40"
          >
            Yes — planted
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type check**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep ConfirmPlantedModal | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/works-qa/components/ConfirmPlantedModal.tsx
git -c commit.gpgsign=false commit -m "feat(works-qa): add ConfirmPlantedModal for whole-pole verification"
```

---

## Task 6: Wire flag column into `PoleListTable`

**Files:**
- Modify: `src/modules/works-qa/components/PoleListTable.tsx`

- [ ] **Step 1: Edit the file**

Add an `onSnagPole` prop, render a new column right of the Status pill. The cell renders three icons based on flags: red ⚠ when `has_open_verification_snag`, green ✓ when `has_verified_planted`, neutral 🚩 otherwise. Clicking the cell `stopPropagation()`s so it doesn't open the detail panel.

Replace the file contents with:

```tsx
import type { PoleSummary } from '../types/works-qa.types';

interface PoleListTableProps {
  poles: PoleSummary[];
  selectedPoleId: string | null;
  onSelect: (id: string) => void;
  onSnagPole: (pole: PoleSummary) => void;
}

function PixelStrip({ filled, total, hasFailures }: { filled: number; total: number; hasFailures: boolean }) {
  return (
    <div className="flex gap-[2px] items-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-[10px] w-[10px] rounded-[2px] ${
            i < filled
              ? hasFailures
                ? 'bg-red-500/50'
                : 'bg-green-500/30'
              : 'bg-zinc-800'
          }`}
        />
      ))}
    </div>
  );
}

const STATUS_BADGE: Record<PoleSummary['status'], string> = {
  empty:       'bg-zinc-800 text-zinc-500',
  in_progress: 'bg-amber-500/20 text-amber-400',
  ready:       'bg-blue-500/20 text-blue-400',
  approved:    'bg-green-500/20 text-green-400',
};

const STATUS_LABEL: Record<PoleSummary['status'], string> = {
  empty:       'Empty',
  in_progress: 'In Progress',
  ready:       'Ready ▶',
  approved:    '✓ Approved',
};

function VerifyFlag({ pole, onClick }: { pole: PoleSummary; onClick: (e: React.MouseEvent) => void }) {
  let icon = '🚩';
  let cls = 'text-zinc-500 hover:text-zinc-300';
  let title = 'Confirm pole planted';
  if (pole.has_open_verification_snag) { icon = '⚠'; cls = 'text-red-400 hover:text-red-300'; title = 'Reported NOT planted — click to revisit'; }
  else if (pole.has_verified_planted) { icon = '✓'; cls = 'text-green-400 hover:text-green-300'; title = 'Confirmed planted — click to revisit'; }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-base ${cls} px-1`}
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  );
}

export function PoleListTable({ poles, selectedPoleId, onSelect, onSnagPole }: PoleListTableProps) {
  if (poles.length === 0) {
    return (
      <div className="text-sm text-zinc-500 text-center py-12">
        No poles found. Select a PON or run QField sync.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-24">Pole</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Civil</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Dome</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Main Joint + Trays</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-28">Status</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-12">Verify</th>
          </tr>
        </thead>
        <tbody>
          {poles.map(pole => (
            <tr
              key={pole.id}
              onClick={() => onSelect(pole.id)}
              className={`border-b border-zinc-900 cursor-pointer transition-colors hover:bg-zinc-800/50 ${
                selectedPoleId === pole.id ? 'bg-zinc-800/70' : ''
              } ${pole.status === 'approved' ? 'bg-green-500/5' : ''} ${pole.has_open_verification_snag ? 'ring-1 ring-red-500/30' : ''}`}
            >
              <td className="py-2 px-3 font-semibold text-zinc-100">{pole.pole_label}</td>
              <td className="py-2 px-3">
                <PixelStrip filled={pole.civil_filled} total={7} hasFailures={pole.status !== 'approved' && pole.vlm_failures > 0} />
              </td>
              <td className="py-2 px-3">
                <PixelStrip filled={pole.dome_filled} total={8} hasFailures={pole.status !== 'approved' && pole.vlm_failures > 0} />
              </td>
              <td className="py-2 px-3">
                <div className="flex items-center gap-2">
                  <PixelStrip filled={pole.joint_filled} total={6} hasFailures={false} />
                  {(pole.tray_count ?? 0) > 0 && (
                    <span className="text-xs text-zinc-500">+{pole.tray_count}t</span>
                  )}
                </div>
              </td>
              <td className="py-2 px-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_BADGE[pole.status]}`}>
                  {STATUS_LABEL[pole.status]}
                </span>
              </td>
              <td className="py-2 px-3">
                <VerifyFlag pole={pole} onClick={(e) => { e.stopPropagation(); onSnagPole(pole); }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Wire the prop in `WorksQAPage.tsx`**

Edit `src/modules/works-qa/components/WorksQAPage.tsx` around the existing `<PoleListTable poles={poles} …/>` usage (search for `<PoleListTable`). Add state for the modal:

```tsx
import { ConfirmPlantedModal } from './ConfirmPlantedModal';
// ...inside the component, near other useState calls
const [snagPole, setSnagPole] = useState<{ id: string; pole_label: string } | null>(null);
```

Pass the new prop:

```tsx
<PoleListTable
  poles={poles}
  selectedPoleId={selectedPoleId}
  onSelect={setSelectedPoleId}
  onSnagPole={(p) => setSnagPole({ id: p.id, pole_label: p.pole_label })}
/>
```

And render the modal at the bottom of the JSX (sibling to the existing PoleDetailPanel):

```tsx
{projectId && snagPole && (
  <ConfirmPlantedModal
    open
    projectId={projectId}
    poleQaPhotoId={snagPole.id}
    poleLabel={snagPole.pole_label}
    onClose={() => setSnagPole(null)}
    onChanged={() => { void mutatePoles(); }}
  />
)}
```

- [ ] **Step 3: Type check**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "PoleListTable|WorksQAPage" | head -10`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/works-qa/components/PoleListTable.tsx src/modules/works-qa/components/WorksQAPage.tsx
git -c commit.gpgsign=false commit -m "feat(works-qa): verify flag column in pole list + modal wiring"
```

---

## Task 7: "Snag pole" button in `PoleDetailPanel` header

**Files:**
- Modify: `src/modules/works-qa/components/PoleDetailPanel.tsx`

- [ ] **Step 1: Add modal state + button**

In `PoleDetailPanel.tsx`, at the top of the component (near the existing `useState` for `lightboxIndex`), add:

```tsx
const [showSnagModal, setShowSnagModal] = useState(false);
```

Replace the header `<div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">…</div>` block (around line 147-160) with a version that includes a "Snag pole" button between the title and the × close button:

```tsx
<div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
  <div className="flex flex-col gap-0.5">
    <span className="font-semibold text-zinc-100">
      {pole ? `Pole ${pole.pole_label}` : 'Loading…'}
    </span>
    {pole?.approved_at && (
      <span className="text-xs text-green-400">
        ✓ All approved — {new Date(pole.approved_at).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}
      </span>
    )}
  </div>
  <div className="flex items-center gap-2">
    {pole && (
      <button
        type="button"
        onClick={() => setShowSnagModal(true)}
        className="px-2 py-1 rounded text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
        title="Confirm: is this pole planted?"
      >
        🚩 Snag pole
      </button>
    )}
    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
  </div>
</div>
```

At the bottom of the component (after `{lightboxIndex !== null && …}`), render the modal:

```tsx
{pole && showSnagModal && (
  <ConfirmPlantedModal
    open
    projectId={pole.project_id}
    poleQaPhotoId={pole.id}
    poleLabel={pole.pole_label}
    onClose={() => setShowSnagModal(false)}
    onChanged={() => { void mutate(); }}
  />
)}
```

Add the import at the top:

```tsx
import { ConfirmPlantedModal } from './ConfirmPlantedModal';
```

- [ ] **Step 2: Type check**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep PoleDetailPanel | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/works-qa/components/PoleDetailPanel.tsx
git -c commit.gpgsign=false commit -m "feat(works-qa): 'Snag pole' button in PoleDetailPanel header"
```

---

## Task 8: Fix click upload — `<label>` swap in `PhotoSlotCard`

**Files:**
- Modify: `src/modules/works-qa/components/PhotoSlotCard.tsx`

- [ ] **Step 1: Replace the empty-slot section**

In `PhotoSlotCard.tsx`, replace lines 49-79 (the `{photoKey ? … : …}` block plus the trailing hidden `<input>`) with:

```tsx
{photoKey ? (
  <button
    type="button"
    onClick={onView}
    disabled={!onView}
    className="w-full h-28 rounded overflow-hidden focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-default"
    aria-label={`Open ${label}`}
  >
    <img
      src={photoUrl(photoKey)}
      alt={label}
      className="w-full h-full object-cover transition-transform hover:scale-[1.02]"
    />
  </button>
) : (
  <label
    className={`w-full h-28 flex items-center justify-center text-xs rounded transition-colors ${
      disabled
        ? 'opacity-50 cursor-not-allowed text-zinc-600'
        : isDragOver
          ? 'bg-teal-500/10 border border-teal-500 border-solid text-teal-300 cursor-copy'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 cursor-pointer'
    }`}
  >
    + Upload
    <input
      type="file"
      accept="image/*"
      className="hidden"
      disabled={disabled}
      onChange={e => {
        const f = e.target.files?.[0];
        log.debug('works-qa: slot file picked', { hasFile: Boolean(f) });
        if (f) onUpload(f);
        // Reset input so re-selecting the same file refires onChange
        e.target.value = '';
      }}
    />
  </label>
)}
```

Remove the `fileInputRef` declaration entirely (line 19) — no longer needed:

```tsx
// DELETE: const fileInputRef = useRef<HTMLInputElement>(null);
// DELETE: import { useRef } at top
```

Update the import line at top from `import { useState, useRef } from 'react';` to `import { useState } from 'react';`.

Add `import { log } from '@/lib/logger';` at the top.

- [ ] **Step 2: Add `isDragOver` state**

Inside the component body, replace the existing `const [showOverride, …]` line group with:

```tsx
const [showOverride, setShowOverride] = useState(false);
const [overrideReason, setOverrideReason] = useState('');
const [isDragOver, setIsDragOver] = useState(false);
```

- [ ] **Step 3: Type check + lint**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep PhotoSlotCard | head -5`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/works-qa/components/PhotoSlotCard.tsx
git -c commit.gpgsign=false commit -m "fix(works-qa): use <label> for slot upload instead of programmatic input.click()"
```

---

## Task 9: Drag-and-drop on `PhotoSlotCard`

**Files:**
- Modify: `src/modules/works-qa/components/PhotoSlotCard.tsx`

- [ ] **Step 1: Wrap the outer card div with drag handlers**

Find the outermost `<div className={`rounded-lg border ${borderColor} ${bgColor} p-3 flex flex-col gap-2`}>` (line 41) and replace with:

```tsx
<div
  className={`rounded-lg border ${borderColor} ${bgColor} p-3 flex flex-col gap-2 transition-colors ${
    isDragOver ? 'ring-2 ring-teal-500/60 bg-teal-500/5' : ''
  }`}
  onDragOver={e => {
    if (disabled || photoKey) return;
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  }}
  onDragLeave={() => setIsDragOver(false)}
  onDrop={e => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled || photoKey) return;
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    if (files[0]) onUpload(files[0]);
    log.debug('works-qa: slot drop', { slotKey: _slotKey, droppedCount: files.length });
  }}
>
```

(The `_slotKey` parameter is already destructured at line 16 — keep it; just remove the underscore prefix so it can be referenced in the log call, or leave the underscore and reference it as `_slotKey`. Both work; prefer keeping the underscore for ESLint `no-unused-vars` happiness — it's already referenced now via the log.)

- [ ] **Step 2: Type check**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep PhotoSlotCard | head -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/works-qa/components/PhotoSlotCard.tsx
git -c commit.gpgsign=false commit -m "feat(works-qa): drag-and-drop onto photo slots"
```

---

## Task 10: `<label>` swap + drag-drop on `TrayBucket`

**Files:**
- Modify: `src/modules/works-qa/components/TrayBucket.tsx`

- [ ] **Step 1: Read current contents**

```bash
cat /home/hein/Workspace/FF_Next.js-pole-snag/src/modules/works-qa/components/TrayBucket.tsx
```

The existing file (~77 lines) is structurally similar to `PhotoSlotCard`: a hidden `<input ref>` triggered by an "+ Upload" button. Apply the same two changes.

- [ ] **Step 2: Replace the upload button with `<label>` + add drag handlers**

Find the `<button onClick={() => fileInputRef.current?.click()}>` block. Replace the button + hidden input with a `<label>`-wrapped multi-file input:

```tsx
<label
  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
    disabled
      ? 'opacity-50 cursor-not-allowed text-zinc-600 border-zinc-800'
      : isDragOver
        ? 'bg-teal-500/10 border-teal-500 text-teal-300 cursor-copy'
        : 'bg-zinc-800 hover:bg-zinc-700 border-zinc-700 text-zinc-200 cursor-pointer'
  }`}
>
  + Upload tray photos
  <input
    type="file"
    accept="image/*"
    multiple
    className="hidden"
    disabled={disabled}
    onChange={e => {
      const files = Array.from(e.target.files ?? []);
      if (files.length > 0) onUpload(files);
      e.target.value = '';
    }}
  />
</label>
```

Remove `fileInputRef` and the `useRef` import; add `useState` if not already imported, and add a local `isDragOver` state.

Wrap the outer tray container `<div>` with `onDragOver` / `onDragLeave` / `onDrop` analogous to Task 9, but routing **all** image files (not just the first):

```tsx
<div
  className={`... ${isDragOver ? 'ring-2 ring-teal-500/60 bg-teal-500/5' : ''}`}
  onDragOver={e => { if (disabled) return; e.preventDefault(); if (!isDragOver) setIsDragOver(true); }}
  onDragLeave={() => setIsDragOver(false)}
  onDrop={e => {
    e.preventDefault();
    setIsDragOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) onUpload(files);
  }}
>
```

- [ ] **Step 3: Type check**

Run: `cd /home/hein/Workspace/FF_Next.js-pole-snag && npx tsc --noEmit -p tsconfig.json 2>&1 | grep TrayBucket | head -5`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag
git add src/modules/works-qa/components/TrayBucket.tsx
git -c commit.gpgsign=false commit -m "fix(works-qa): TrayBucket label-based upload + drag-and-drop"
```

---

## Task 11: Local CI gate

- [ ] **Step 1: Run `npm run ci:quick`**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag && npm run ci:quick 2>&1 | tail -40
```

Expected: passes the lint ratchets (77 errors / ~1833 warnings / 94 catches baseline — neither newly introduced errors nor catch increases). If any new error appears, fix it in the relevant file and commit before continuing.

- [ ] **Step 2: Run the new vitest test**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag && npx vitest run pages/api/snags/__tests__/handlePost.test.ts 2>&1 | tail -15
```

Expected: 2/2 pass.

- [ ] **Step 3: Run antihall check**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag && npm run antihall 2>&1 | tail -10
```

Expected: passes (no hallucinated symbols referenced in the diff).

---

## Task 12: Push branch, open PR, request blind review

- [ ] **Step 1: Push branch**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag && git push -u origin feat/works-qa-pole-snag-and-upload 2>&1 | tail -10
```

- [ ] **Step 2: Open PR via gh**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag && gh pr create --title "feat(works-qa): pole verify snag + upload fixes" --body "$(cat <<'EOF'
## Summary
- Whole-pole "Confirm: is this pole planted?" snag — new `'verification'` `SnagCategory`, modal accessible from every pole row + detail panel header.
- Fix: empty `+ Upload` slot now uses native `<label>`-wrapped file input — opens the file picker reliably; replaces the fragile programmatic `ref.click()`.
- New: drag-and-drop from Windows Explorer onto photo slots and trays.

## Spec
`docs/superpowers/specs/2026-05-15-works-qa-pole-snag-and-upload-fix-design.md`

## Test plan
- [ ] `npm run ci:quick` passes (no lint ratchet regression)
- [ ] `npx vitest run pages/api/snags/__tests__/handlePost.test.ts` passes
- [ ] Deploy to dev: `bash scripts/deploy-local.sh dev`
- [ ] Browser smoke on `dev.fibreflow.app`:
  - [ ] Mawadien → PON 134 → Pole D129 → Optical Dome → Dome Label → click `+ Upload` opens file picker
  - [ ] Same slot — drag a JPG from desktop, teal highlight, drop, photo uploads
  - [ ] PON 134 list → click 🚩 on a clean pole → modal opens → "Yes — planted" → row shows green ✓
  - [ ] Another pole → 🚩 → "No — not planted" → row shows red ⚠ badge, snag visible at `/snags`
  - [ ] Detail panel "Snag pole" button opens the same modal
  - [ ] Approve Civil discipline → all civil slots reject click + drop
- [ ] DB sanity: `SELECT id, snag_number, category, status, pole_references, verified_at, verification_notes FROM snags WHERE category='verification' ORDER BY created_at DESC LIMIT 5;`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" 2>&1 | tail -5
```

- [ ] **Step 3: Trigger blind review**

Tell Hein in chat: *"PR opened at <URL>. Triggering `/review` now."*
Then invoke `/review` skill against the PR.

---

## Task 13: Browser smoke on dev (Hein-supervised)

After review APPROVED + CI green + merge:

- [ ] **Step 1: Deploy to dev**

```bash
cd /home/hein/Workspace/FF_Next.js-pole-snag && bash scripts/deploy-local.sh dev 2>&1 | tail -30
```

- [ ] **Step 2: Run the browser smoke via Claude-in-Chrome**

Using the `browser` skill: navigate to `https://dev.fibreflow.app/field-ops/works-qa`, select Mawadien → PON 134 → Pole D129 → Optical Dome. Walk through each item in the PR's Test Plan, take screenshots at each step.

- [ ] **Step 3: Report**

Post screenshots + pass/fail verdict per smoke item. If any step fails: roll back to a fix commit on the same branch, re-deploy dev, re-test. Production deploy stays gated on Hein's explicit approval (after-hours rule).

- [ ] **Step 4: Worktree cleanup after merge**

```bash
cd /home/hein/Workspace/FF_Next.js
git worktree remove /home/hein/Workspace/FF_Next.js-pole-snag --force
git branch -D feat/works-qa-pole-snag-and-upload  # local only — remote was deleted by merge
```

---

## Self-review notes

- **Spec coverage:** all spec sections map to a task — `'verification'` category (Task 1), null-`report_id` API path (Task 2), pole list flags via `pole_qa_photo_id` join (Task 3), modal (Task 5), row + detail entry points (Tasks 6 & 7), click fix (Task 8), drag-drop on slots and trays (Tasks 9 & 10). CI + browser smoke gates in Tasks 11–13.
- **`pole_qa_photo_id` link:** snags created from the modal carry `pole_qa_photo_id` + `source='works_qa'` so the `EXISTS` join in Task 3 matches. Modal accepts `poleQaPhotoId` prop (the `PoleSummary.id` / `PoleQaPhoto.id` UUID).
- **Placeholder scan:** none. All code blocks are complete and self-contained.
- **Type consistency:** `CreateSnagRequest.report_id` and `snag_number` made optional in Task 2; modal sends `pole_qa_photo_id` (also optional on the type) plus `verification_notes` (new field). `PoleSummary` extension in Task 3 matches what the API SELECT returns and what `PoleListTable` reads in Task 6.
