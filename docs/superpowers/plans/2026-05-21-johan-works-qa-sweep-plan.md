# Johan Works QA Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Johan's 3-PR Works QA sweep — ZIP includes unassigned photos, per-pole bulk upload drop zone, AI auto-sort classifier with hybrid confidence tiers.

**Architecture:** Each PR is independent and merges separately. PR 1 modifies one API route. PR 2 adds one component + one API extension. PR 3 adds an endpoint + migration + UI component, calling the existing Qwen3-VL endpoint with a multi-class prompt.

**Tech Stack:** Next.js Pages Router (TypeScript), pg.Pool via `@/lib/db`, JSZip, SWR, hello-pangea/dnd, formidable, VF Storage, Qwen3-VL-30B-A3B.

**Spec:** `docs/superpowers/specs/2026-05-21-johan-works-qa-sweep-design.md`

**Branch:** `feat/works-qa-johan-sweep` off `origin/master abbd4e40c`. Worktree: `~/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep`.

**Working directory:** All file paths in this plan are relative to the worktree root.

---

## Task 0: Spec correction — corrections table

**Why:** Spec §5 says the classifier writes to `works_qa_corrections`, but that table's schema (`vlm_verdict`/`human_verdict`/`slot_key`) is for slot-approval overrides — wrong shape for "I predicted slot X for this photo". The right table is `qa_correction_examples` (already used by `move-photo.ts`); its `vlm_predicted_step` + `vlm_predicted_category` columns match the classifier's prediction shape.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-21-johan-works-qa-sweep-design.md`

- [ ] **Step 1: Open the spec and edit §5 PR 3 tier table**

Replace the line referencing `works_qa_corrections` in §5 with `qa_correction_examples`. Edit both the tier table row for ≥0.95 and the "Training data" subsection.

In §5, change:
```
Auto-place: write slot column, remove from unassigned_photo_keys,
write works_qa_corrections row with decision='auto-placed'
```
to:
```
Auto-place: write slot column, remove from unassigned_photo_keys,
write qa_correction_examples row with correction_reason='auto_sort_placed'
```

In §5 "Training data" subsection, change:
```
Training data: works_qa_corrections table (created in PR #1664, migration 356,
specifically for works-qa VLM correction shape).
```
to:
```
Training data: qa_correction_examples table — same table move-photo.ts already
writes to. Its (vlm_predicted_step, vlm_predicted_category) columns match the
classifier's prediction shape, and workflow_type='works_qa' keeps these rows
distinct from DR-photo corrections. (works_qa_corrections is a separate concept —
slot-approval overrides — and is not the right table here.)
```

- [ ] **Step 2: Commit the spec amendment**

```bash
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep add docs/superpowers/specs/2026-05-21-johan-works-qa-sweep-design.md
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep commit -m "docs(works-qa): spec correction — use qa_correction_examples not works_qa_corrections

The works_qa_corrections schema (vlm_verdict/human_verdict) is for slot-approval
overrides, not slot predictions. The classifier needs the prediction shape that
qa_correction_examples already has (vlm_predicted_step + vlm_predicted_category)."
```

---

## PR 1 — ZIP includes unassigned photos

### Task 1: Failing test for ZIP unassigned/ folder

**Files:**
- Create: `pages/api/works-qa/__tests__/pon-zip-unassigned.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import JSZip from 'jszip';

// Note: pon-zip.ts is currently not unit-tested. Project precedent
// (see pages/api/works-qa/__tests__/photo-snag-api.test.ts) mocks the
// pool import via vi.mock. Follow that pattern.
vi.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

// Stub fetch for photo retrieval — return a tiny PNG buffer.
const tinyPng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
global.fetch = vi.fn(async () => ({
  ok: true,
  arrayBuffer: async () => tinyPng,
  status: 200,
})) as unknown as typeof fetch;

import pool from '@/lib/db';
import handler from '../pon-zip';
import { createMocks } from 'node-mocks-http';

const mockedQuery = pool.query as ReturnType<typeof vi.fn>;

const FIXTURE_POLE = {
  id: 'pole-1',
  project_id: 'proj-1',
  pole_label: 'TEST.P.A001',
  pon_no: 999,
  approved_at: '2026-05-21T00:00:00Z',
  civil_step_01_key: null,
  civil_step_02_key: null,
  civil_step_03_key: null,
  civil_step_04_key: null,
  civil_step_05_key: null,
  civil_step_06_key: null,
  civil_step_07_key: 'works-qa/proj-1/TEST.P.A001/civil/civil_07_1.jpg',
  optical_dome_01_key: null,
  optical_dome_02_key: null,
  optical_dome_03_key: null,
  optical_dome_04_key: null,
  optical_dome_05_key: null,
  optical_dome_06_key: null,
  optical_dome_07_key: null,
  optical_dome_08_key: null,
  main_joint_11_key: null,
  main_joint_12_key: null,
  main_joint_13_key: null,
  main_joint_14_key: null,
  main_joint_15_key: null,
  main_joint_16_key: null,
  main_joint_tray_keys: [],
  unassigned_photo_keys: [
    'works-qa/proj-1/TEST.P.A001/unassigned/u1.jpg',
    'works-qa/proj-1/TEST.P.A001/unassigned/u2.jpg',
  ],
};

describe('pon-zip — unassigned bucket', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue({ rows: [FIXTURE_POLE] });
  });

  it('includes unassigned/ folder when include_unapproved=true', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', pon_no: '999', include_unapproved: 'true' },
    });
    // @ts-expect-error createMocks res isn't fully typed for our handler
    await handler(req, res);

    const buf = res._getBuffer();
    const zip = await JSZip.loadAsync(buf);
    const paths = Object.keys(zip.files);

    expect(paths).toEqual(expect.arrayContaining([
      'PON_999/TEST.P.A001/unassigned/photo_01.jpg',
      'PON_999/TEST.P.A001/unassigned/photo_02.jpg',
    ]));
  });

  it('still excludes in-progress poles by default (backward compat)', async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [] }); // approved_at filter returns nothing
    const { req, res } = createMocks({
      method: 'GET',
      query: { project_id: 'proj-1', pon_no: '999' },
    });
    // @ts-expect-error
    await handler(req, res);
    expect(res._getStatusCode()).toBe(404);

    // Inspect the SQL query for the approved_at clause
    const sql = mockedQuery.mock.calls[0]![0] as string;
    expect(sql).toMatch(/approved_at IS NOT NULL/);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
cd /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep
npx vitest run pages/api/works-qa/__tests__/pon-zip-unassigned.test.ts -t "includes unassigned" 2>&1 | tail -20
```

Expected: FAIL because `pon-zip.ts` doesn't yet write `unassigned/` and doesn't yet honour `include_unapproved`. The query check should also fail because the SQL currently always has `approved_at IS NOT NULL` regardless of param.

### Task 2: Implement include_unapproved + unassigned/ in pon-zip

**Files:**
- Modify: `pages/api/works-qa/pon-zip.ts`

- [ ] **Step 1: Add include_unapproved handling and unassigned write loop**

Find the existing SQL block in `pon-zip.ts` (around line 56-70) and replace:

```typescript
    const params: (string | number)[] = [project_id];
    let ponFilter = '';
    let ponNum: number | undefined;

    if (pon_no && typeof pon_no === 'string') {
      ponNum = parseInt(pon_no, 10);
      if (isNaN(ponNum)) return apiResponse.badRequest(res, 'pon_no must be a number');
      params.push(ponNum);
      ponFilter = `AND pon_no = $${params.length}`;
    }

    const result = await pool.query<PoleQaPhoto>(
      `SELECT * FROM pole_qa_photos
       WHERE project_id = $1::uuid
         AND approved_at IS NOT NULL
         ${ponFilter}
       ORDER BY pole_label ASC`,
      params,
    );
```

with:

```typescript
    const params: (string | number)[] = [project_id];
    let ponFilter = '';
    let ponNum: number | undefined;

    if (pon_no && typeof pon_no === 'string') {
      ponNum = parseInt(pon_no, 10);
      if (isNaN(ponNum)) return apiResponse.badRequest(res, 'pon_no must be a number');
      params.push(ponNum);
      ponFilter = `AND pon_no = $${params.length}`;
    }

    // Default ships only approved poles (backward compat). include_unapproved=true
    // lets Johan ZIP a PON mid-sweep so he can re-distribute uncategorised photos.
    const includeUnapproved = req.query.include_unapproved === 'true';
    const approvedFilter = includeUnapproved ? '' : 'AND approved_at IS NOT NULL';

    const result = await pool.query<PoleQaPhoto>(
      `SELECT * FROM pole_qa_photos
       WHERE project_id = $1::uuid
         ${approvedFilter}
         ${ponFilter}
       ORDER BY pole_label ASC`,
      params,
    );
```

Then find the existing per-pole loop (around line 85-117). Add an `unassigned` block alongside the civil/optical/tray promises. After the existing `trayPromises` const, insert:

```typescript
      // Unassigned bucket — photos that came in via QField sync or bulk upload
      // but haven't been placed in a slot yet. Ship them in their own folder.
      const unassignedKeys: string[] = Array.isArray(pole.unassigned_photo_keys)
        ? pole.unassigned_photo_keys
        : [];
      const unassignedFolder = zip.folder(`${ponLabel}/${pole.pole_label}/unassigned`);
      const unassignedPromises = unassignedFolder ? unassignedKeys.map(async (key, i) => {
        const buf = await fetchPhoto(photoUrl(key), cookie);
        if (buf) unassignedFolder.file(`photo_${String(i + 1).padStart(2, '0')}.jpg`, buf);
      }) : [];
```

Then change the `Promise.all` call from:

```typescript
      await Promise.all([...civilPromises, ...opticalPromises, ...trayPromises]);
```

to:

```typescript
      await Promise.all([...civilPromises, ...opticalPromises, ...trayPromises, ...unassignedPromises]);
```

- [ ] **Step 2: Run the test, confirm it passes**

```bash
npx vitest run pages/api/works-qa/__tests__/pon-zip-unassigned.test.ts 2>&1 | tail -10
```

Expected: PASS on both cases.

- [ ] **Step 3: Lint + typecheck**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "pon-zip" | head -10
```

Expected: no errors from `pon-zip.ts` or its test.

### Task 3: Add front-end "Download (including in-progress)" button

**Files:**
- Modify: `src/modules/works-qa/components/WorksQAPage.tsx`

- [ ] **Step 1: Locate the existing ZIP download button**

```bash
grep -n "pon-zip\|Download\|ZIP" src/modules/works-qa/components/WorksQAPage.tsx
```

Note the existing button's surrounding markup so the new one follows the same style.

- [ ] **Step 2: Add the secondary button next to the existing one**

Find the existing button JSX. Adjacent to it, add a second button (use the actual variable names from the file — `selectedProjectId`, `selectedPonNo` are likely names, confirm in the file):

```tsx
{selectedProjectId && (
  <a
    href={`/api/works-qa/pon-zip?project_id=${selectedProjectId}${selectedPonNo != null ? `&pon_no=${selectedPonNo}` : ''}&include_unapproved=true`}
    className="text-xs text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
    title="Download every pole in this PON (including in-progress) plus their unassigned photos"
  >
    Download all (in-progress + unassigned)
  </a>
)}
```

Place it directly after the existing "Download approved" link/button so Johan sees both.

- [ ] **Step 3: Local smoke test in browser**

```bash
PORT=3004 npm run dev &
DEV_PID=$!
sleep 8
echo "Open http://localhost:3004/field-ops/works-qa?project_id=7d8b94d6-8e5a-4dbb-9ede-69ce3884e004 in browser, pick PON 206, click the new link, confirm a ZIP downloads with PON_206/<pole>/unassigned/photo_XX.jpg paths"
echo "Press Enter to kill dev server"
read -r _
kill $DEV_PID
```

(Manual verification per CLAUDE.md "Goal-driven verification" rule.)

- [ ] **Step 4: Commit PR 1**

```bash
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep add \
  pages/api/works-qa/pon-zip.ts \
  pages/api/works-qa/__tests__/pon-zip-unassigned.test.ts \
  src/modules/works-qa/components/WorksQAPage.tsx
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep commit -m "feat(works-qa): pon-zip includes unassigned + include_unapproved opt-in

ZIP now ships unassigned/ folder per pole alongside civil/optical/tray.
New include_unapproved=true query param ships in-progress poles too
(default unchanged for backward compat). Front-end gets a second
download link for in-progress + unassigned exports.

Closes Johan #4 (2026-05-21 WA)."
```

---

## ⏸ Checkpoint 1 — PR 1 review

- [ ] **Push branch**

```bash
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep push -u origin feat/works-qa-johan-sweep
```

- [ ] **Open PR for review**

Use the `commit-commands:commit-push-pr` skill (or `gh pr create`) targeting `master` with title:
`feat(works-qa): ZIP includes unassigned photos + include_unapproved opt-in`

Body should reference the spec at `docs/superpowers/specs/2026-05-21-johan-works-qa-sweep-design.md` and call out: Johan's #4 ask, manual-tested on Thembisa POP 1 PON 206.

- [ ] **Wait for blind review (`/review`) and CI**

Per CLAUDE.md standing rule: invoke `/review` (single sonnet reviewer — this is a small doc+code PR). Wait for `gh run watch` to pass on the self-hosted runner. Address any findings.

- [ ] **Merge with `gh pr merge --merge --delete-branch`**

Only after review APPROVED and CI green. Then deploy to dev: `bash scripts/deploy-local.sh dev`.

- [ ] **Rebase the working branch onto master before starting PR 2**

```bash
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep fetch origin master
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep rebase origin/master
```

---

## PR 2 — Per-pole bulk upload drop zone

### Task 4: Failing test for slot=unassigned in pole-assign

**Files:**
- Create: `pages/api/works-qa/__tests__/pole-assign-unassigned.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
vi.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/services/vfStorageAdapter', () => ({
  vfStorage: {
    uploadFile: vi.fn(async () => ({ path: 'works-qa/proj-1/PA001/unassigned/x.jpg' })),
  },
}));
vi.mock('@/modules/works-qa/services/worksQaVlmService', () => ({
  validatePhotoWithVlm: vi.fn(async () => ({
    valid: true, confidence: 0.9, feedback: 'ok',
  })),
}));

import pool from '@/lib/db';
import handler from '../pole-assign';
import { createMocks } from 'node-mocks-http';
import formidable from 'formidable';
import fs from 'fs';

// Replace formidable.parse to feed canned fields/files
vi.mock('formidable', () => {
  return vi.fn(() => ({
    parse: (_req: unknown, cb: (err: unknown, fields: unknown, files: unknown) => void) => {
      const tmp = '/tmp/_test-upload.jpg';
      fs.writeFileSync(tmp, Buffer.from('fakeimg'));
      cb(null,
        { pole_id: 'pole-1', slot: 'unassigned' },
        { photo: { filepath: tmp } });
    },
  }));
});

const mockedQuery = pool.query as ReturnType<typeof vi.fn>;

describe('pole-assign — slot=unassigned', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    // pole-fetch query
    mockedQuery.mockResolvedValueOnce({
      rows: [{ project_id: 'proj-1', pole_label: 'PA001' }],
    });
    // UPDATE query
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });
  });

  it('appends to unassigned_photo_keys (not main_joint_tray_keys)', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    // @ts-expect-error createMocks res not fully typed
    await handler(req, res);

    // The 2nd query should be an UPDATE on unassigned_photo_keys
    const updateSql = mockedQuery.mock.calls[1]![0] as string;
    expect(updateSql).toMatch(/unassigned_photo_keys = array_append/);
    expect(updateSql).not.toMatch(/main_joint_tray_keys = array_append/);

    expect(res._getStatusCode()).toBe(200);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run pages/api/works-qa/__tests__/pole-assign-unassigned.test.ts 2>&1 | tail -15
```

Expected: FAIL — `pole-assign.ts` returns `badRequest('Unknown slot: unassigned')` because `slot=unassigned` isn't recognised.

### Task 5: Extend pole-assign with slot=unassigned

**Files:**
- Modify: `pages/api/works-qa/pole-assign.ts`

- [ ] **Step 1: Replace the isTray branch with a 3-way switch**

Find the existing isTray block in `pole-assign.ts` (around lines 84-90 and 149-159). Replace the isTray detection and persistence logic.

Find:

```typescript
    // 3. Resolve slot metadata (tray is a special case — no fixed column)
    const isTray = slot === 'tray';
    const slotMeta = isTray ? null : getSlotMeta(slot);

    if (!isTray && !slotMeta) {
      return apiResponse.badRequest(res, `Unknown slot: ${slot}`);
    }
```

Replace with:

```typescript
    // 3. Resolve slot metadata. Three kinds of slot:
    //    - 'tray'       → main_joint_tray_keys (splice tray photos)
    //    - 'unassigned' → unassigned_photo_keys (no categorisation yet)
    //    - civil_*/dome_*/main_joint_* → fixed slot column
    const isTray = slot === 'tray';
    const isUnassigned = slot === 'unassigned';
    const slotMeta = isTray || isUnassigned ? null : getSlotMeta(slot);

    if (!isTray && !isUnassigned && !slotMeta) {
      return apiResponse.badRequest(res, `Unknown slot: ${slot}`);
    }
```

Find the discipline derivation block:

```typescript
    const discipline =
      isTray
        ? 'optical'
        : slotMeta!.discipline === 'civil'
          ? 'civil'
          : 'optical';
```

Replace with:

```typescript
    const discipline =
      isTray || isUnassigned
        ? 'optical'
        : slotMeta!.discipline === 'civil'
          ? 'civil'
          : 'optical';
```

Find the VLM label/check block:

```typescript
    const vlmLabel = isTray ? 'Optical Joint Tray' : slotMeta!.label;
    const vlmCheck = isTray
      ? 'Splice tray with fibre routing and splice protectors visible.'
      : slotMeta!.vlmCheck;
```

Replace with:

```typescript
    const vlmLabel = isTray
      ? 'Optical Joint Tray'
      : isUnassigned
        ? 'Unassigned pole photo'
        : slotMeta!.label;
    const vlmCheck = isTray
      ? 'Splice tray with fibre routing and splice protectors visible.'
      : isUnassigned
        ? 'Any photo related to fibre pole installation, optical dome, or splice work.'
        : slotMeta!.vlmCheck;
```

Find the persistence block:

```typescript
    if (isTray) {
      // Tray: append photo key to array, store VLM under timestamped key
      const vlmKey = `tray_${crypto.randomUUID()}`;
      await pool.query(
        `UPDATE pole_qa_photos
         SET main_joint_tray_keys = array_append(main_joint_tray_keys, $1),
             vlm_results = vlm_results || jsonb_build_object($2, $3::jsonb),
             updated_at = NOW()
         WHERE id = $4::uuid`,
        [photoKey, vlmKey, JSON.stringify(vlmResult), poleId]
      );
    } else {
```

Replace with:

```typescript
    if (isTray) {
      const vlmKey = `tray_${crypto.randomUUID()}`;
      await pool.query(
        `UPDATE pole_qa_photos
         SET main_joint_tray_keys = array_append(main_joint_tray_keys, $1),
             vlm_results = vlm_results || jsonb_build_object($2, $3::jsonb),
             updated_at = NOW()
         WHERE id = $4::uuid`,
        [photoKey, vlmKey, JSON.stringify(vlmResult), poleId]
      );
    } else if (isUnassigned) {
      const vlmKey = `unassigned_${crypto.randomUUID()}`;
      await pool.query(
        `UPDATE pole_qa_photos
         SET unassigned_photo_keys = array_append(COALESCE(unassigned_photo_keys, '{}'::text[]), $1),
             vlm_results = vlm_results || jsonb_build_object($2, $3::jsonb),
             updated_at = NOW()
         WHERE id = $4::uuid`,
        [photoKey, vlmKey, JSON.stringify(vlmResult), poleId]
      );
    } else {
```

- [ ] **Step 2: Run the test, confirm it passes**

```bash
npx vitest run pages/api/works-qa/__tests__/pole-assign-unassigned.test.ts 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 3: Verify the existing slot=tray test still passes (regression check)**

```bash
npx vitest run pages/api/works-qa/__tests__/ 2>&1 | tail -15
```

Expected: all green.

### Task 6: Create BulkUnassignedUpload component

**Files:**
- Create: `src/modules/works-qa/components/BulkUnassignedUpload.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface BulkUnassignedUploadProps {
  poleId: string;
  onUploaded: () => void | Promise<void>;
  disabled?: boolean;
}

interface UploadChip {
  name: string;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

async function uploadOne(poleId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append('pole_id', poleId);
  form.append('slot', 'unassigned');
  form.append('photo', file);
  form.append('source', 'bulk-upload');
  const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

/**
 * Bulk-upload manual photos into a pole's unassigned bucket. Multi-select via
 * file picker (no folder picker — browsers don't expose paths reliably). Each
 * upload runs the standard VLM validation pipeline server-side.
 */
export function BulkUnassignedUpload({ poleId, onUploaded, disabled }: BulkUnassignedUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [chips, setChips] = useState<UploadChip[]>([]);
  const [running, setRunning] = useState(false);

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    const imageFiles = files.filter(f => f.type.startsWith('image/'));
    if (!imageFiles.length) return;

    setRunning(true);
    setChips(imageFiles.map(f => ({ name: f.name, status: 'uploading' })));

    await Promise.all(imageFiles.map(async (file, idx) => {
      try {
        await uploadOne(poleId, file);
        setChips(prev => prev.map((c, i) => i === idx ? { ...c, status: 'done' } : c));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('works-qa: bulk-upload failed', { error: msg, name: file.name });
        setChips(prev => prev.map((c, i) => i === idx ? { ...c, status: 'error', error: msg } : c));
      }
    }));

    await onUploaded();
    setRunning(false);
    // Clear chips after a short delay so the user sees the green ticks
    setTimeout(() => setChips([]), 2500);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || running}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-700/50 disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Bulk upload photos to unassigned bucket"
      >
        {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        {running ? 'Uploading…' : '+ Bulk upload'}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          void handleFiles(files);
          // Reset so picking the same files again retriggers change.
          e.target.value = '';
        }}
      />

      {chips.length > 0 && (
        <ul role="status" aria-live="polite" className="flex flex-wrap gap-1">
          {chips.map((chip, i) => (
            <li
              key={i}
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                chip.status === 'uploading' ? 'bg-zinc-800 border-zinc-700 text-zinc-400'
                : chip.status === 'done' ? 'bg-green-900/40 border-green-700/50 text-green-300'
                : 'bg-red-900/40 border-red-700/50 text-red-300'
              }`}
              title={chip.error}
            >
              {chip.status === 'uploading' ? '…' : chip.status === 'done' ? '✓' : '×'} {chip.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sibling helper: wires onDrop on an existing element. Use from
 * UnassignedBucket so dragging files onto the bucket also uploads.
 */
export async function handleBulkDrop(
  poleId: string,
  e: React.DragEvent,
  onUploaded: () => void | Promise<void>,
): Promise<void> {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;

  await Promise.all(files.map(async file => {
    try {
      await uploadOne(poleId, file);
    } catch (err: unknown) {
      log.error('works-qa: bulk-drop upload failed', {
        error: err instanceof Error ? err.message : String(err),
        name: file.name,
      });
    }
  }));
  await onUploaded();
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "BulkUnassignedUpload" | head
```

Expected: no errors.

### Task 7: Wire BulkUnassignedUpload into UnassignedBucket

**Files:**
- Modify: `src/modules/works-qa/components/UnassignedBucket.tsx`
- Modify: `src/modules/works-qa/components/PoleDetailPanel.tsx`

- [ ] **Step 1: Update UnassignedBucket signature + JSX**

Replace the entire contents of `src/modules/works-qa/components/UnassignedBucket.tsx` (current 92 lines) with:

```typescript
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical } from 'lucide-react';
import { photoUrl } from '../utils/photo-url';
import { BulkUnassignedUpload, handleBulkDrop } from './BulkUnassignedUpload';

interface UnassignedBucketProps {
  poleId: string;
  photoKeys: string[];
  onView?: (index: number) => void;
  onUploaded: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Bottom-of-panel bucket for photos linked to the pole but not yet assigned to
 * a slot. Photos can be dragged in (delete from slot) or out (place into the
 * right slot). Each move goes through /api/works-qa/move-photo which records a
 * row in qa_correction_examples so the VLM model learns the categorisation.
 *
 * Also accepts bulk uploads — multi-select via the [+ Bulk upload] button OR
 * drag-drop of image files anywhere onto the bucket. Uploaded files land in
 * unassigned_photo_keys via /api/works-qa/pole-assign with slot='unassigned'.
 */
export function UnassignedBucket({ poleId, photoKeys, onView, onUploaded, disabled }: UnassignedBucketProps) {
  return (
    <section
      onDrop={disabled ? undefined : e => void handleBulkDrop(poleId, e, onUploaded)}
      onDragOver={disabled ? undefined : e => e.preventDefault()}
      className="border border-dashed border-zinc-700 rounded-lg p-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
          Unassigned Photos ({photoKeys.length})
        </h3>
        <div className="flex items-center gap-2">
          {!disabled && <BulkUnassignedUpload poleId={poleId} onUploaded={onUploaded} />}
          <span className="text-[10px] text-zinc-500">drag to slot →</span>
        </div>
      </div>

      <Droppable droppableId="unassigned" direction="horizontal" isDropDisabled={disabled}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`min-h-20 rounded transition-colors ${
              snapshot.isDraggingOver ? 'bg-teal-500/10 ring-1 ring-teal-500/40' : ''
            }`}
          >
            {photoKeys.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">
                {snapshot.isDraggingOver
                  ? 'Drop here to send back for re-categorisation'
                  : 'No unassigned photos for this pole. Use [+ Bulk upload] or drop image files here.'}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {photoKeys.map((key, i) => (
                  <Draggable key={key} draggableId={`unassigned:${key}`} index={i} isDragDisabled={disabled}>
                    {(dragProvided, dragSnap) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`relative rounded overflow-hidden group ${
                          dragSnap.isDragging ? 'ring-2 ring-teal-400 shadow-lg shadow-teal-500/30 z-50' : ''
                        }`}
                      >
                        {!disabled && (
                          <div
                            {...dragProvided.dragHandleProps}
                            aria-label="Drag to slot"
                            className="absolute top-1 left-1 z-10 p-0.5 rounded bg-black/60 text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                          >
                            <GripVertical className="w-3 h-3" aria-hidden="true" />
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => onView?.(i)}
                          disabled={!onView}
                          className="block w-full h-16 focus:outline-none focus:ring-2 focus:ring-teal-500"
                          aria-label="Open unassigned photo"
                        >
                          <img
                            src={photoUrl(key)}
                            alt={`Unassigned ${i + 1}`}
                            className="w-full h-full object-cover"
                            draggable={false}
                          />
                        </button>
                      </div>
                    )}
                  </Draggable>
                ))}
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </section>
  );
}
```

- [ ] **Step 2: Pass poleId + onUploaded from PoleDetailPanel**

Find the existing `<UnassignedBucket ...>` usage in `src/modules/works-qa/components/PoleDetailPanel.tsx` (around line 314):

```typescript
                <UnassignedBucket
                  photoKeys={pole.unassigned_photo_keys ?? []}
                  onView={i => { const idx = unassignedIndex[i]; if (idx !== undefined) setLightboxIndex(idx); }}
                  disabled={!!pole.approved_at}
                />
```

Replace with:

```typescript
                <UnassignedBucket
                  poleId={pole.id}
                  photoKeys={pole.unassigned_photo_keys ?? []}
                  onView={i => { const idx = unassignedIndex[i]; if (idx !== undefined) setLightboxIndex(idx); }}
                  onUploaded={() => mutate()}
                  disabled={!!pole.approved_at}
                />
```

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "UnassignedBucket|PoleDetailPanel|BulkUnassignedUpload" | head -10
npx eslint src/modules/works-qa/components/UnassignedBucket.tsx src/modules/works-qa/components/BulkUnassignedUpload.tsx 2>&1 | tail
```

Expected: clean.

### Task 8: Browser-verify PR 2 + commit

- [ ] **Step 1: Run dev and manually exercise upload + drag-drop**

```bash
PORT=3004 npm run dev &
DEV_PID=$!
sleep 8
echo "Open Thembisa POP 1 (project 7d8b94d6-...), PON 206, pole TEM.P.C200."
echo "1. Click [+ Bulk upload], pick 3 image files. Confirm chips show uploading→done."
echo "2. Drop 2 more image files onto the bucket. Confirm both appear."
echo "3. Verify all 5 photos are in the unassigned bucket."
echo "Press Enter to kill dev."
read -r _
kill $DEV_PID
```

- [ ] **Step 2: Commit PR 2**

```bash
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep add \
  pages/api/works-qa/pole-assign.ts \
  pages/api/works-qa/__tests__/pole-assign-unassigned.test.ts \
  src/modules/works-qa/components/BulkUnassignedUpload.tsx \
  src/modules/works-qa/components/UnassignedBucket.tsx \
  src/modules/works-qa/components/PoleDetailPanel.tsx
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep commit -m "feat(works-qa): per-pole bulk upload into unassigned bucket

Johan #3 (2026-05-21 WA) — bulk-uploading non-QField photos. Adds:

- pole-assign accepts slot='unassigned' (appends to unassigned_photo_keys,
  same VLM-validate path as slot='tray').
- BulkUnassignedUpload component: multi-file picker with per-file chips.
- UnassignedBucket: drag-drop image files anywhere onto the bucket also
  uploads via the same path.

Photos land in the unassigned bucket; PR 3 will add AI auto-sort."
```

---

## ⏸ Checkpoint 2 — PR 2 review

- [ ] Push, open PR, run `/review`, wait for CI, merge, deploy to dev.
- [ ] Confirm Johan can run a small bulk upload on dev before starting PR 3.
- [ ] Rebase the working branch: `git -C ... fetch origin master && git -C ... rebase origin/master`.

---

## PR 3 — AI auto-sort classifier

### Task 9: Re-check migration version and write migration

**Files:**
- Create: `scripts/migrations/sql/<NEXT>_works_qa_unassigned_suggestions.sql`
- Create: `scripts/migrations/sql/rollback_<NEXT>_works_qa_unassigned_suggestions.sql`

- [ ] **Step 1: Query DB for the next migration version**

```bash
ssh velo@100.96.203.105 'docker exec -i supabase-db psql -U postgres -d fibreflow -tA -c "SELECT MAX(version) FROM migrations;"'
```

Expected: a number (e.g. 367). Use NEXT = (that number + 1). Substitute `<NEXT>` everywhere below with the actual number.

Per `feedback_migration_version_collision`: if another branch lands a migration before this PR merges, re-run this step and bump `<NEXT>`.

- [ ] **Step 2: Write the migration SQL**

Create `scripts/migrations/sql/<NEXT>_works_qa_unassigned_suggestions.sql`:

```sql
-- works-qa AI auto-sort: per-photo slot suggestions for items in the
-- per-pole unassigned bucket. Populated by /api/works-qa/auto-sort; UI
-- renders a "→ slot · confidence%" badge on each thumbnail.
--
-- Shape:
--   { "<photo_key>": {
--       "suggested_slot": "civil_03",
--       "confidence": 0.87,
--       "generated_at": "2026-05-21T19:30:00Z"
--   } }

ALTER TABLE pole_qa_photos
  ADD COLUMN unassigned_suggestions JSONB NOT NULL DEFAULT '{}';

-- Defensive index for future "show me suggestions across the project"
-- queries; cheap to drop if unused.
CREATE INDEX idx_pole_qa_photos_unassigned_suggestions
  ON pole_qa_photos USING GIN (unassigned_suggestions);

INSERT INTO migrations (version, name, applied_at)
VALUES (<NEXT>, '<NEXT>_works_qa_unassigned_suggestions', NOW());
```

Create `scripts/migrations/sql/rollback_<NEXT>_works_qa_unassigned_suggestions.sql`:

```sql
DROP INDEX IF EXISTS idx_pole_qa_photos_unassigned_suggestions;
ALTER TABLE pole_qa_photos DROP COLUMN IF EXISTS unassigned_suggestions;
DELETE FROM migrations WHERE version = <NEXT>;
```

- [ ] **Step 3: Apply migration to dev DB and confirm**

```bash
NEXT=<NEXT>  # replace with the actual number
ssh velo@100.96.203.105 "docker exec -i supabase-db psql -U postgres -d fibreflow -f -" \
  < /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep/scripts/migrations/sql/${NEXT}_works_qa_unassigned_suggestions.sql

ssh velo@100.96.203.105 'docker exec -i supabase-db psql -U postgres -d fibreflow -c "
SELECT column_name FROM information_schema.columns
WHERE table_name=\"pole_qa_photos\" AND column_name=\"unassigned_suggestions\";"'
```

Expected: one row showing the new column.

(DB is shared between dev + prod per `project_db_supabase.md`; the column is non-breaking — defaults to '{}' so existing code doesn't see it.)

### Task 10: Add classifyPhotoToSlot to worksQaVlmService

**Files:**
- Modify: `src/modules/works-qa/services/worksQaVlmService.ts`

- [ ] **Step 1: Add the classifier function**

Append to `src/modules/works-qa/services/worksQaVlmService.ts`:

```typescript
import { SLOT_META } from '../utils/slot-keys';

export interface VlmClassifyResult {
  slot_key: string | null;
  confidence: number;
  reasoning: string;
}

const CLASSIFY_FALLBACK: VlmClassifyResult = {
  slot_key: null,
  confidence: 0,
  reasoning: 'VLM classification failed — photo stays unassigned',
};

const SLOT_KEY_SET = new Set(SLOT_META.map(s => s.key));

function buildClassifyPrompt(): string {
  const list = SLOT_META
    .map(s => `- ${s.key} (${s.label}): ${s.vlmCheck}`)
    .join('\n');
  return `You are a fibre network construction QA inspector.
A field worker uploaded a photo for a pole installation. Decide which
of the following slots it belongs to. Pick exactly one slot key.

Available slots:
${list}

If the photo doesn't clearly fit any slot, return slot_key: null.

Respond with ONLY valid JSON (no markdown):
{"slot_key": "<one of the keys above or null>", "confidence": 0.0-1.0, "reasoning": "brief reason"}`;
}

/**
 * Multi-class slot classifier for the works-qa auto-sort feature. Single VLM
 * call returns the most-likely slot for the photo plus a confidence in [0,1].
 * On any error/parse failure returns a low-confidence fallback so the caller
 * can leave the photo unassigned.
 */
export async function classifyPhotoToSlot(photoUrl: string): Promise<VlmClassifyResult> {
  const prompt = buildClassifyPrompt();

  const body = {
    model: VLM_QA_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: photoUrl } },
        ],
      },
    ],
    max_tokens: VLM_MAX_TOKENS_QA,
    temperature: VLM_TEMPERATURE,
  };

  let raw: string;
  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(VLM_TIMEOUT_QA),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => response.statusText);
      throw new Error(`VLM HTTP ${response.status}: ${errText}`);
    }
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    raw = json.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    log.error('worksQaVlmService.classify: fetch failed', { err });
    return CLASSIFY_FALLBACK;
  }

  const cleaned = stripThinkTags(raw);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    log.error('worksQaVlmService.classify: no JSON in VLM response', {
      raw: cleaned.slice(0, 300),
    });
    return CLASSIFY_FALLBACK;
  }

  try {
    const parsed = JSON.parse(match[0]) as {
      slot_key?: unknown;
      confidence?: unknown;
      reasoning?: unknown;
    };
    const slotRaw = parsed.slot_key;
    const slot_key =
      typeof slotRaw === 'string' && SLOT_KEY_SET.has(slotRaw) ? slotRaw : null;
    const confidence =
      typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0;
    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'no reasoning provided';
    // If model returned a slot we don't recognise, treat as no-match.
    return { slot_key, confidence: slot_key ? confidence : 0, reasoning };
  } catch (err) {
    log.error('worksQaVlmService.classify: JSON parse failed', {
      match: match[0].slice(0, 300),
      err,
    });
    return CLASSIFY_FALLBACK;
  }
}
```

- [ ] **Step 2: Unit test for the parser**

Create `src/modules/works-qa/services/__tests__/worksQaVlmService.classify.test.ts`:

```typescript
// Isolate from network — mock fetch to return controlled VLM JSON.
const originalFetch = global.fetch;

import { classifyPhotoToSlot } from '../worksQaVlmService';

afterAll(() => { global.fetch = originalFetch; });

function mockVlm(content: string) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => content,
  })) as unknown as typeof fetch;
}

describe('classifyPhotoToSlot', () => {
  it('returns parsed slot + confidence for clean JSON', async () => {
    mockVlm('{"slot_key":"civil_03","confidence":0.87,"reasoning":"depth tape visible"}');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBe('civil_03');
    expect(r.confidence).toBeCloseTo(0.87);
    expect(r.reasoning).toBe('depth tape visible');
  });

  it('zeroes confidence when slot_key is unknown', async () => {
    mockVlm('{"slot_key":"banana_99","confidence":0.99,"reasoning":"nope"}');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBeNull();
    expect(r.confidence).toBe(0);
  });

  it('accepts null slot_key and clamps confidence', async () => {
    mockVlm('{"slot_key":null,"confidence":1.5,"reasoning":"unclear"}');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBeNull();
    expect(r.confidence).toBe(0); // null slot → forced zero
  });

  it('falls back when response has no JSON', async () => {
    mockVlm('totally unparseable');
    const r = await classifyPhotoToSlot('http://x/y.jpg');
    expect(r.slot_key).toBeNull();
    expect(r.confidence).toBe(0);
    expect(r.reasoning).toMatch(/failed/);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run src/modules/works-qa/services/__tests__/worksQaVlmService.classify.test.ts 2>&1 | tail -15
```

Expected: 4 PASS.

### Task 11: Seed RBAC permission for auto-sort

This project has a dedicated `/access-control` skill that knows the seed file layout and grant pattern. Use it rather than guessing.

- [ ] **Step 1: Invoke the access-control skill**

Run the `/access-control` skill (Skill tool, name `access-control`) with the brief:

> Add a new permission `construction-qa.works-qa.auto-sort` with action `create`. Grant it to the same roles that currently have `construction-qa.works-qa` (action `create`). Do the audit + seed + dev-DB apply that the skill normally does. The new permission is enforced by `pages/api/works-qa/auto-sort.ts` via `withPermission('construction-qa.works-qa.auto-sort', 'create')`.

The skill should produce a concrete file diff (seed script, migration, or RBAC fixture — whatever the project uses) and apply it to dev DB.

- [ ] **Step 2: Capture the changed files**

After the skill completes, run:

```bash
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep status --porcelain
```

Note the changed file paths — they'll be included in the PR 3 commit (Task 15 Step 6).

- [ ] **Step 3: Verify the permission seeded on dev DB**

```bash
ssh velo@100.96.203.105 'docker exec -i supabase-db psql -U postgres -d fibreflow -c "
SELECT * FROM access_permissions WHERE resource_key = '"'"'construction-qa.works-qa.auto-sort'"'"';"'
```

Expected: at least one row.

### Task 12: Failing test for auto-sort endpoint

**Files:**
- Create: `pages/api/works-qa/__tests__/auto-sort.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
vi.mock('@/lib/db', () => ({
  __esModule: true,
  default: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));
vi.mock('@/modules/works-qa/services/worksQaVlmService', () => ({
  classifyPhotoToSlot: vi.fn(),
  validatePhotoWithVlm: vi.fn(),
}));

import pool from '@/lib/db';
import { classifyPhotoToSlot } from '@/modules/works-qa/services/worksQaVlmService';
import handler from '../auto-sort';
import { createMocks } from 'node-mocks-http';

const mockedQuery = pool.query as ReturnType<typeof vi.fn>;
const mockedClassify = classifyPhotoToSlot as ReturnType<typeof vi.fn>;

describe('auto-sort', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedClassify.mockReset();
  });

  it('auto-places when confidence ≥ 0.95 and slot empty', async () => {
    // Pole fetch
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'pole-1',
        project_id: 'proj-1',
        pole_label: 'TEST.P.A001',
        unassigned_photo_keys: ['works-qa/proj-1/TEST/u1.jpg'],
        civil_step_03_key: null,
      }],
    });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.97, reasoning: 'depth tape visible',
    });
    // The slot UPDATE
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });
    // The qa_correction_examples INSERT
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });

    const { req, res } = createMocks({
      method: 'POST',
      body: { pole_id: 'pole-1' },
    });
    // @ts-expect-error
    await handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    const body = JSON.parse(res._getData());
    expect(body.success).toBe(true);
    expect(body.data.auto_placed).toBe(1);
    expect(body.data.suggested).toBe(0);
    expect(body.data.leftover).toBe(0);
    expect(body.data.results[0]).toMatchObject({
      photo_key: 'works-qa/proj-1/TEST/u1.jpg',
      predicted_slot: 'civil_03',
      action: 'auto-placed',
    });
  });

  it('suggests when confidence in [0.6, 0.95)', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'pole-1',
        project_id: 'proj-1',
        pole_label: 'TEST.P.A001',
        unassigned_photo_keys: ['works-qa/proj-1/TEST/u1.jpg'],
        civil_step_03_key: null,
      }],
    });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.82, reasoning: 'looks like depth',
    });
    // The suggestion UPDATE
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 });

    const { req, res } = createMocks({
      method: 'POST', body: { pole_id: 'pole-1' },
    });
    // @ts-expect-error
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.suggested).toBe(1);
    expect(body.data.auto_placed).toBe(0);
    expect(body.data.results[0].action).toBe('suggested');
  });

  it('leaves alone when confidence < 0.6', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'pole-1', project_id: 'proj-1', pole_label: 'TEST.P.A001',
        unassigned_photo_keys: ['works-qa/proj-1/TEST/u1.jpg'],
        civil_step_03_key: null,
      }],
    });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.4, reasoning: 'unclear',
    });

    const { req, res } = createMocks({
      method: 'POST', body: { pole_id: 'pole-1' },
    });
    // @ts-expect-error
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.leftover).toBe(1);
    expect(body.data.results[0].action).toBe('leftover');
  });

  it('suggests (not auto-places) when ≥0.95 but slot already filled', async () => {
    mockedQuery.mockResolvedValueOnce({
      rows: [{
        id: 'pole-1', project_id: 'proj-1', pole_label: 'TEST.P.A001',
        unassigned_photo_keys: ['works-qa/proj-1/TEST/u1.jpg'],
        civil_step_03_key: 'works-qa/already/here.jpg',
      }],
    });
    mockedClassify.mockResolvedValueOnce({
      slot_key: 'civil_03', confidence: 0.99, reasoning: 'strong match',
    });
    mockedQuery.mockResolvedValueOnce({ rowCount: 1 }); // suggestion UPDATE

    const { req, res } = createMocks({
      method: 'POST', body: { pole_id: 'pole-1' },
    });
    // @ts-expect-error
    await handler(req, res);

    const body = JSON.parse(res._getData());
    expect(body.data.suggested).toBe(1);
    expect(body.data.auto_placed).toBe(0);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails (no handler yet)**

```bash
npx vitest run pages/api/works-qa/__tests__/auto-sort.test.ts 2>&1 | tail -10
```

Expected: FAIL — module not found.

### Task 13: Implement /api/works-qa/auto-sort

**Files:**
- Create: `pages/api/works-qa/auto-sort.ts`

- [ ] **Step 1: Write the handler**

Create `pages/api/works-qa/auto-sort.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META, getSlotMeta, getDbColumn } from '@/modules/works-qa/utils/slot-keys';
import { classifyPhotoToSlot } from '@/modules/works-qa/services/worksQaVlmService';

const ALLOWED_PHOTO_COLUMNS = new Set(SLOT_META.map(s => s.dbColumn));
const AUTO_PLACE_THRESHOLD = 0.95;
const SUGGEST_THRESHOLD = 0.6;

interface AutoSortBody { pole_id?: string }

// Loopback so the VLM call hits localhost-bypass on the photo proxy.
const LOOPBACK_PORT = process.env.PORT ?? '3000';
const LOOPBACK_BASE = `http://127.0.0.1:${LOOPBACK_PORT}`;

function photoUrl(key: string): string {
  if (key.startsWith('works-qa/')) return `${LOOPBACK_BASE}/storage/${key}`;
  const source = key.startsWith('projects/')   ? 'qfield'
              : key.startsWith('sharepoint:') ? 'sharepoint'
              :                                 'local';
  return `${LOOPBACK_BASE}/api/construction-qa/photo-proxy?key=${encodeURIComponent(key)}&source=${source}&vlm=true`;
}

interface PoleRow {
  id: string;
  project_id: string;
  pole_label: string;
  unassigned_photo_keys: string[] | null;
  [k: string]: unknown; // slot columns
}

interface ResultEntry {
  photo_key: string;
  predicted_slot: string | null;
  confidence: number;
  action: 'auto-placed' | 'suggested' | 'leftover';
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id } = (req.body ?? {}) as AutoSortBody;
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');

  try {
    const poleResult = await pool.query<PoleRow>(
      `SELECT * FROM pole_qa_photos WHERE id = $1::uuid`,
      [pole_id],
    );
    const pole = poleResult.rows[0];
    if (!pole) return apiResponse.notFound(res, 'Pole', pole_id);

    const photos = Array.isArray(pole.unassigned_photo_keys) ? pole.unassigned_photo_keys : [];
    const results: ResultEntry[] = [];
    let auto_placed = 0, suggested = 0, leftover = 0;

    // Sequential — single GPU, parallel calls would just queue.
    for (const photo_key of photos) {
      const classification = await classifyPhotoToSlot(photoUrl(photo_key));
      const { slot_key, confidence } = classification;

      if (slot_key && confidence >= AUTO_PLACE_THRESHOLD) {
        const meta = getSlotMeta(slot_key);
        if (!meta) {
          leftover++;
          results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'leftover' });
          continue;
        }
        const colName = meta.dbColumn;
        if (!ALLOWED_PHOTO_COLUMNS.has(colName)) {
          leftover++;
          results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'leftover' });
          continue;
        }
        const currentVal = pole[colName] as string | null;
        if (currentVal) {
          // Slot already filled — surface as suggestion instead of overwriting.
          await pool.query(`
            UPDATE pole_qa_photos
            SET unassigned_suggestions = unassigned_suggestions || jsonb_build_object($1::text, jsonb_build_object(
              'suggested_slot', $2::text,
              'confidence',     $3::numeric,
              'generated_at',   NOW()
            )),
                updated_at = NOW()
            WHERE id = $4::uuid
          `, [photo_key, slot_key, confidence, pole_id]);
          suggested++;
          results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'suggested' });
          continue;
        }

        // Auto-place: write slot column, remove from unassigned bucket.
        // Note: dynamic column name guarded by ALLOWED_PHOTO_COLUMNS above.
        await pool.query(`
          UPDATE pole_qa_photos
          SET ${colName} = $1,
              unassigned_photo_keys = array_remove(unassigned_photo_keys, $1),
              updated_at = NOW()
          WHERE id = $2::uuid AND ${colName} IS NULL
        `, [photo_key, pole_id]);

        // Record prediction as a correction-examples row so the same training
        // corpus that powers manual moves also captures auto-placements.
        await pool.query(`
          INSERT INTO qa_correction_examples
            (workflow_type, photo_filename, vlm_predicted_step, vlm_predicted_category,
             vlm_confidence, vlm_reasoning, correct_step, correct_category,
             correction_reason, corrected_by)
          VALUES ('works_qa', $1, $2, $3, $4, $5, $2, $3, 'auto_sort_placed', NULL)
        `, [photo_key, meta.stepNumber, meta.discipline, confidence, classification.reasoning]);

        // Update the in-memory pole so subsequent photos in this batch see
        // the slot as filled (prevents two photos auto-placing into one slot).
        pole[colName] = photo_key;

        auto_placed++;
        results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'auto-placed' });
      } else if (slot_key && confidence >= SUGGEST_THRESHOLD) {
        await pool.query(`
          UPDATE pole_qa_photos
          SET unassigned_suggestions = unassigned_suggestions || jsonb_build_object($1::text, jsonb_build_object(
            'suggested_slot', $2::text,
            'confidence',     $3::numeric,
            'generated_at',   NOW()
          )),
              updated_at = NOW()
          WHERE id = $4::uuid
        `, [photo_key, slot_key, confidence, pole_id]);
        suggested++;
        results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'suggested' });
      } else {
        // <0.6, or null slot — leave alone.
        leftover++;
        results.push({ photo_key, predicted_slot: slot_key, confidence, action: 'leftover' });
      }
    }

    return apiResponse.success(res, { auto_placed, suggested, leftover, results });
  } catch (err) {
    log.error('works-qa/auto-sort', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa.auto-sort', 'create')(handler));
```

- [ ] **Step 2: Run the test**

```bash
npx vitest run pages/api/works-qa/__tests__/auto-sort.test.ts 2>&1 | tail -15
```

Expected: all 4 PASS.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "auto-sort" | head
```

Expected: clean.

### Task 14: UI — auto-sort button + suggestion badges

**Files:**
- Create: `src/modules/works-qa/components/UnassignedSuggestionBadge.tsx`
- Modify: `src/modules/works-qa/components/UnassignedBucket.tsx`
- Modify: `src/modules/works-qa/components/PoleDetailPanel.tsx` (pass `suggestions` prop)

- [ ] **Step 1: Create the badge component**

Create `src/modules/works-qa/components/UnassignedSuggestionBadge.tsx`:

```typescript
import { getSlotMeta } from '../utils/slot-keys';

export interface UnassignedSuggestion {
  suggested_slot: string;
  confidence: number;
  generated_at: string;
}

interface BadgeProps {
  suggestion: UnassignedSuggestion;
  onAccept: () => void;
  disabled?: boolean;
}

export function UnassignedSuggestionBadge({ suggestion, onAccept, disabled }: BadgeProps) {
  const meta = getSlotMeta(suggestion.suggested_slot);
  const label = meta ? meta.label : suggestion.suggested_slot;
  const pct = Math.round(suggestion.confidence * 100);

  return (
    <div className="absolute inset-x-0 bottom-0 z-10 px-1 py-0.5 bg-gradient-to-t from-black/85 to-transparent flex items-center justify-between gap-1">
      <span className="text-[9px] text-amber-300 truncate" title={`Suggested: ${label} (${pct}%)`}>
        → {label} · {pct}%
      </span>
      <button
        type="button"
        onClick={onAccept}
        disabled={disabled}
        className="text-[9px] px-1 py-0.5 rounded bg-teal-600/80 hover:bg-teal-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={`Accept suggestion: place in ${label}`}
        title="Accept this slot suggestion"
      >
        Accept
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Replace UnassignedBucket with auto-sort + badge version**

Replace `src/modules/works-qa/components/UnassignedBucket.tsx` with (note: keeps it under 200 lines per `feedback_file_size_limit_strict`):

```typescript
import { useState } from 'react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical, Sparkles, Loader2 } from 'lucide-react';
import { photoUrl } from '../utils/photo-url';
import { BulkUnassignedUpload, handleBulkDrop } from './BulkUnassignedUpload';
import { UnassignedSuggestionBadge, type UnassignedSuggestion } from './UnassignedSuggestionBadge';
import { log } from '@/lib/logger';

interface UnassignedBucketProps {
  poleId: string;
  photoKeys: string[];
  suggestions: Record<string, UnassignedSuggestion>;
  onView?: (index: number) => void;
  onUploaded: () => void | Promise<void>;
  onAcceptSuggestion: (photoKey: string, slotKey: string) => Promise<void>;
  disabled?: boolean;
}

interface AutoSortState {
  running: boolean;
  total: number;
  done: number;
  summary?: { auto_placed: number; suggested: number; leftover: number };
}

export function UnassignedBucket({
  poleId, photoKeys, suggestions, onView, onUploaded,
  onAcceptSuggestion, disabled,
}: UnassignedBucketProps) {
  const [autoSort, setAutoSort] = useState<AutoSortState>({ running: false, total: 0, done: 0 });
  const [acceptingAll, setAcceptingAll] = useState(false);

  const suggestionEntries = Object.entries(suggestions).filter(([k]) => photoKeys.includes(k));
  const hasSuggestions = suggestionEntries.length > 0;

  async function handleAutoSort() {
    setAutoSort({ running: true, total: photoKeys.length, done: 0 });
    try {
      const res = await fetch('/api/works-qa/auto-sort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: poleId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data?: { auto_placed: number; suggested: number; leftover: number } };
      setAutoSort({ running: false, total: photoKeys.length, done: photoKeys.length, summary: body.data });
      await onUploaded(); // refresh SWR — slot fills + suggestions appear
    } catch (e: unknown) {
      log.error('works-qa: auto-sort failed', { error: e instanceof Error ? e.message : String(e) });
      setAutoSort({ running: false, total: 0, done: 0 });
    }
  }

  async function handleAcceptAll() {
    setAcceptingAll(true);
    try {
      for (const [photoKey, s] of suggestionEntries) {
        await onAcceptSuggestion(photoKey, s.suggested_slot);
      }
    } finally {
      setAcceptingAll(false);
    }
  }

  return (
    <section
      onDrop={disabled ? undefined : e => void handleBulkDrop(poleId, e, onUploaded)}
      onDragOver={disabled ? undefined : e => e.preventDefault()}
      className="border border-dashed border-zinc-700 rounded-lg p-3 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
          Unassigned Photos ({photoKeys.length})
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {!disabled && photoKeys.length > 0 && (
            <button
              type="button"
              onClick={handleAutoSort}
              disabled={autoSort.running}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-700/50 disabled:opacity-50"
              title="Run AI classifier over unassigned photos — auto-places high-confidence matches, suggests medium-confidence ones"
            >
              {autoSort.running
                ? <><Loader2 className="w-3 h-3 animate-spin" />Sorting {autoSort.done} of {autoSort.total}…</>
                : <><Sparkles className="w-3 h-3" />Auto-sort with AI</>}
            </button>
          )}
          {hasSuggestions && !disabled && (
            <button
              type="button"
              onClick={handleAcceptAll}
              disabled={acceptingAll}
              className="px-2 py-1 rounded text-xs bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 border border-teal-700/50 disabled:opacity-50"
            >
              {acceptingAll ? 'Accepting…' : `Accept all suggestions (${suggestionEntries.length})`}
            </button>
          )}
          {!disabled && <BulkUnassignedUpload poleId={poleId} onUploaded={onUploaded} />}
          <span className="text-[10px] text-zinc-500">drag to slot →</span>
        </div>
      </div>

      {autoSort.summary && (
        <p className="text-[10px] text-zinc-500" role="status" aria-live="polite">
          Auto-sort done: {autoSort.summary.auto_placed} placed · {autoSort.summary.suggested} suggested · {autoSort.summary.leftover} left
        </p>
      )}

      <Droppable droppableId="unassigned" direction="horizontal" isDropDisabled={disabled}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`min-h-20 rounded transition-colors ${
              snapshot.isDraggingOver ? 'bg-teal-500/10 ring-1 ring-teal-500/40' : ''
            }`}
          >
            {photoKeys.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-4">
                {snapshot.isDraggingOver
                  ? 'Drop here to send back for re-categorisation'
                  : 'No unassigned photos for this pole. Use [+ Bulk upload] or drop image files here.'}
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-1">
                {photoKeys.map((key, i) => {
                  const suggestion = suggestions[key];
                  return (
                    <Draggable key={key} draggableId={`unassigned:${key}`} index={i} isDragDisabled={disabled}>
                      {(dragProvided, dragSnap) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={`relative rounded overflow-hidden group ${
                            dragSnap.isDragging ? 'ring-2 ring-teal-400 shadow-lg shadow-teal-500/30 z-50' : ''
                          }`}
                        >
                          {!disabled && (
                            <div
                              {...dragProvided.dragHandleProps}
                              aria-label="Drag to slot"
                              className="absolute top-1 left-1 z-10 p-0.5 rounded bg-black/60 text-zinc-200 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
                            >
                              <GripVertical className="w-3 h-3" aria-hidden="true" />
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => onView?.(i)}
                            disabled={!onView}
                            className="block w-full h-16 focus:outline-none focus:ring-2 focus:ring-teal-500"
                            aria-label="Open unassigned photo"
                          >
                            <img
                              src={photoUrl(key)}
                              alt={`Unassigned ${i + 1}`}
                              className="w-full h-full object-cover"
                              draggable={false}
                            />
                          </button>

                          {suggestion && !disabled && (
                            <UnassignedSuggestionBadge
                              suggestion={suggestion}
                              onAccept={() => void onAcceptSuggestion(key, suggestion.suggested_slot)}
                              disabled={dragSnap.isDragging}
                            />
                          )}
                        </div>
                      )}
                    </Draggable>
                  );
                })}
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </section>
  );
}
```

- [ ] **Step 3: Update PoleDetailPanel to pass suggestions + onAcceptSuggestion**

Find the existing `<UnassignedBucket ...>` call in `PoleDetailPanel.tsx` (PR 2 last-modified state):

```typescript
                <UnassignedBucket
                  poleId={pole.id}
                  photoKeys={pole.unassigned_photo_keys ?? []}
                  onView={i => { const idx = unassignedIndex[i]; if (idx !== undefined) setLightboxIndex(idx); }}
                  onUploaded={() => mutate()}
                  disabled={!!pole.approved_at}
                />
```

Replace with:

```typescript
                <UnassignedBucket
                  poleId={pole.id}
                  photoKeys={pole.unassigned_photo_keys ?? []}
                  suggestions={pole.unassigned_suggestions ?? {}}
                  onView={i => { const idx = unassignedIndex[i]; if (idx !== undefined) setLightboxIndex(idx); }}
                  onUploaded={() => mutate()}
                  onAcceptSuggestion={async (photoKey, slotKey) => {
                    // Use existing move-photo so the correction example is recorded.
                    await movePhoto(pole.id, photoKey, 'unassigned', slotKey);
                    await mutate();
                  }}
                  disabled={!!pole.approved_at}
                />
```

- [ ] **Step 4: Update type for PoleQaPhoto to include the new column**

```bash
grep -n "unassigned_photo_keys\|main_joint_tray_keys" src/modules/works-qa/types/works-qa.types.ts
```

Add `unassigned_suggestions: Record<string, UnassignedSuggestion>;` next to `unassigned_photo_keys` in the `PoleQaPhoto` type. Import the type from `UnassignedSuggestionBadge`.

- [ ] **Step 5: Typecheck + lint**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "Unassigned|auto-sort|works-qa" | head -20
npx eslint src/modules/works-qa/components/UnassignedBucket.tsx src/modules/works-qa/components/UnassignedSuggestionBadge.tsx 2>&1 | tail
```

Expected: clean.

### Task 15: End-to-end manual verification + commit PR 3

- [ ] **Step 1: Pick a test pole with unassigned photos**

Use Thembisa POP 1 PON 206 / TEM.P.C200 (1 unassigned photo confirmed in diagnostics).

- [ ] **Step 2: Run dev**

```bash
PORT=3004 npm run dev &
DEV_PID=$!
sleep 8
```

- [ ] **Step 3: Manual test sequence**

```
1. Open http://localhost:3004/field-ops/works-qa?project_id=7d8b94d6-8e5a-4dbb-9ede-69ce3884e004
2. Pick PON 206, open pole TEM.P.C200.
3. Confirm the Unassigned Photos section shows 1 photo and the [Auto-sort with AI] button is visible.
4. Click [Auto-sort with AI]. Confirm spinner shows "Sorting 1 of 1…".
5. Within ~10s the call completes. Expected outcome (depends on what the photo actually is):
   - If high-confidence civil photo → bucket empties, the slot fills.
   - If medium-confidence → photo stays with a "→ <slot> · <pct>%" badge + Accept button.
   - If low-confidence → photo stays untouched, summary line shows "0 placed · 0 suggested · 1 left".
6. If suggestion appeared, click Accept on the badge — confirm the photo moves into the slot.
7. Drop 3 more photos into the bucket via drag-drop. Click [Auto-sort with AI]. Confirm tier behaviour on the mixed batch.
8. Press Enter when done.
```

- [ ] **Step 4: Kill dev**

```bash
read -r _
kill $DEV_PID
```

- [ ] **Step 5: Run full works-qa test suite for regression**

```bash
npx vitest run src/modules/works-qa/ pages/api/works-qa/ 2>&1 | tail -15
```

Expected: all green.

- [ ] **Step 6: Commit PR 3**

```bash
git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep add \
  scripts/migrations/sql/<NEXT>_works_qa_unassigned_suggestions.sql \
  scripts/migrations/sql/rollback_<NEXT>_works_qa_unassigned_suggestions.sql \
  src/modules/works-qa/services/worksQaVlmService.ts \
  src/modules/works-qa/services/__tests__/worksQaVlmService.classify.test.ts \
  src/modules/works-qa/types/works-qa.types.ts \
  src/modules/works-qa/components/UnassignedSuggestionBadge.tsx \
  src/modules/works-qa/components/UnassignedBucket.tsx \
  src/modules/works-qa/components/PoleDetailPanel.tsx \
  pages/api/works-qa/auto-sort.ts \
  pages/api/works-qa/__tests__/auto-sort.test.ts
# Plus the RBAC seed file(s) produced by Task 11 — list them from
# `git status --porcelain` after the access-control skill ran.

git -C /home/hein/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep commit -m "feat(works-qa): AI auto-sort for unassigned photos (#1, #2, #3)

Johan #1+#2+#3 (2026-05-21 WA) — AI classifies unassigned photos and
auto-places high-confidence matches or suggests slot for medium-confidence.

- Migration <NEXT>: pole_qa_photos.unassigned_suggestions JSONB
- classifyPhotoToSlot() in worksQaVlmService: multi-class VLM prompt
- POST /api/works-qa/auto-sort: tier (>=0.95 place / >=0.6 suggest / else leave)
- UnassignedBucket: [Sparkles Auto-sort with AI] button, badges, Accept-all
- Records auto-placements + accepted suggestions to qa_correction_examples
  with correction_reason='auto_sort_placed' for upstream VLM training

Closes Johan #1/#2/#3 + sets up #4 follow-up (qfield VLM investigation)."
```

---

## ⏸ Checkpoint 3 — PR 3 review + Johan sign-off

- [ ] Push, open PR (use `review-team` skill given this is multi-domain: migration + API + VLM service + UI).
- [ ] After CI + review approval, merge + deploy to dev.
- [ ] WhatsApp Johan (Afrikaans) — ask him to test auto-sort on Lawley. Wait for his sign-off.
- [ ] After sign-off: deploy to production (after-hours, with Hein's approval — per CLAUDE.md production gate).

---

## Post-merge follow-ups

These are out of the writing-plans scope but listed for handoff:

- File PR 4's NOC ticket: "Investigate why `qfield_photo_validations.vlm_confidence` is NULL for Thembisa POP 1 step-7 photos." Reference this epic. Use `/noc-team` skill.
- WhatsApp Johan in Afrikaans about #5 (see spec §7).
- Update memory: `feedback_tonga_qfield.md` → Thembisa = QField (3 POPs linked, 605+ photos in `qfield_photo_validations`).
- Worktree cleanup once branch is merged: `git worktree remove ~/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep` (per `feedback_worktree_cleanup`).

---

## Notes for the executing engineer

- **Run all commands from inside the worktree** (`~/Workspace/FF_Next.js-worktrees/works-qa-johan-sweep`), not from the main tree (`feedback_always_use_worktree` — there's a hook that blocks main-tree writes).
- **Always use `git -C <worktree-path>`** for git commands when your shell's CWD is the main tree, or `cd` into the worktree first.
- **Re-query the migration version (`SELECT MAX(version) FROM migrations`) at PR 3 time** — side branches may have landed migrations between when this plan was written and when PR 3 ships (`feedback_migration_version_collision`).
- **Test command convention**: this project uses `npx vitest run <path>` directly (verify by checking `package.json` — there may be a `test` script that does the same).
- **No `--no-verify` commits.** If pre-commit hooks fail, fix the underlying issue (CLAUDE.md hard rule).
- **Before each PR**, run `npm run ci:quick` as the floor check before pushing.
