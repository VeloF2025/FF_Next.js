# Works QA Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Johan's pole photo QA dashboard — browse PONs, assign/validate photos per slot, VLM-gate approval, download FiberTime-ready ZIP.

**Architecture:** New `works-qa` module independent of `construction-qa`. Single `pole_qa_photos` table with 21 fixed text columns (7 civil + 8 dome + 6 joint) plus a `TEXT[]` array for variable tray photos. VLM runs on every photo assignment; Johan's overrides write to `qa_correction_examples` for few-shot learning.

**Tech Stack:** Next.js Pages Router, pg.Pool (`@/lib/db`), Vitest, VF Storage (`@/services/vfStorageAdapter`), Qwen3-VL via `VLM_CHAT_ENDPOINT`, `jszip`, `formidable`, SWR, Tailwind CSS, ModuleNav.

**Worktree:** `/home/hein/Workspace/FF_Next.js-works-qa` (branch `feat/works-qa-dashboard`)

---

## File Map

**New files:**
```
scripts/migrations/246_pole_qa_photos.sql
src/modules/works-qa/types/works-qa.types.ts
src/modules/works-qa/utils/slot-keys.ts
src/modules/works-qa/utils/approval-gates.ts
src/modules/works-qa/__tests__/approval-gates.test.ts
src/modules/works-qa/services/worksQaVlmService.ts
src/modules/works-qa/hooks/usePoleList.ts
src/modules/works-qa/hooks/usePoleDetail.ts
src/modules/works-qa/components/WorksQANav.tsx
src/modules/works-qa/components/worksQaNavConfig.ts
src/modules/works-qa/components/PhotoSlotCard.tsx
src/modules/works-qa/components/TrayBucket.tsx
src/modules/works-qa/components/PoleDetailPanel.tsx
src/modules/works-qa/components/PoleListTable.tsx
src/modules/works-qa/components/ApprovePoleButton.tsx
src/modules/works-qa/components/WorksQAPage.tsx
pages/field-ops/works-qa.tsx
pages/api/works-qa/poles.ts
pages/api/works-qa/pole-detail.ts
pages/api/works-qa/pole-assign.ts
pages/api/works-qa/pole-override.ts
pages/api/works-qa/pole-approve.ts
pages/api/works-qa/sync-qfield.ts
pages/api/works-qa/pon-zip.ts
```

---

## Task 1: DB Migration

**Files:**
- Create: `scripts/migrations/246_pole_qa_photos.sql`

- [ ] **Step 1.1: Write the migration SQL**

```sql
-- scripts/migrations/246_pole_qa_photos.sql
-- Works QA Dashboard: pole photo slot storage for Johan's sweep workflow.
-- One row per pole per project. Fixed text-key columns for 21 checklist slots
-- plus a TEXT[] for variable tray photos.

CREATE TABLE IF NOT EXISTS pole_qa_photos (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pole_label                TEXT NOT NULL,
  zone_no                   INTEGER,
  pon_no                    INTEGER,

  -- Civil (CIVIL_CHECKLIST steps 1-7)
  civil_step_01_key         TEXT,
  civil_step_02_key         TEXT,
  civil_step_03_key         TEXT,
  civil_step_04_key         TEXT,
  civil_step_05_key         TEXT,
  civil_step_06_key         TEXT,
  civil_step_07_key         TEXT,

  -- Optical Dome (OPTICAL_DOME_CHECKLIST steps 1-8)
  optical_dome_01_key       TEXT,
  optical_dome_02_key       TEXT,
  optical_dome_03_key       TEXT,
  optical_dome_04_key       TEXT,
  optical_dome_05_key       TEXT,
  optical_dome_06_key       TEXT,
  optical_dome_07_key       TEXT,
  optical_dome_08_key       TEXT,

  -- Optical Joint (OPTICAL_JOINT_CHECKLIST steps 11-16)
  optical_joint_11_key      TEXT,
  optical_joint_12_key      TEXT,
  optical_joint_13_key      TEXT,
  optical_joint_14_key      TEXT,
  optical_joint_15_key      TEXT,
  optical_joint_16_key      TEXT,

  -- Variable tray photos (flat bucket)
  optical_joint_tray_keys   TEXT[]  DEFAULT '{}',

  -- VLM results per slot: { "civil_01": { valid, confidence, feedback }, ... }
  vlm_results               JSONB   DEFAULT '{}',

  -- Per-discipline approval flags
  civil_approved            BOOLEAN DEFAULT FALSE,
  dome_approved             BOOLEAN DEFAULT FALSE,
  joint_approved            BOOLEAN DEFAULT FALSE,
  approved_by               TEXT,
  approved_at               TIMESTAMPTZ,

  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (project_id, pole_label)
);

CREATE INDEX IF NOT EXISTS idx_pole_qa_photos_project
  ON pole_qa_photos(project_id);
CREATE INDEX IF NOT EXISTS idx_pole_qa_photos_pon
  ON pole_qa_photos(project_id, pon_no);
CREATE INDEX IF NOT EXISTS idx_pole_qa_photos_approved
  ON pole_qa_photos(project_id, approved_at)
  WHERE approved_at IS NOT NULL;
```

- [ ] **Step 1.2: Run the migration against the shared Supabase DB**

```bash
cd /home/hein/Workspace/FF_Next.js-works-qa
psql "$(grep DATABASE_URL .env.local | cut -d= -f2-)" -f scripts/migrations/246_pole_qa_photos.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX` (×3), no errors.

- [ ] **Step 1.3: Verify table exists**

```bash
psql "$(grep DATABASE_URL .env.local | cut -d= -f2-)" -c "\d pole_qa_photos"
```

Expected: 30+ columns shown, `project_id + pole_label` unique constraint visible.

- [ ] **Step 1.4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-works-qa
git add scripts/migrations/246_pole_qa_photos.sql
git commit -m "feat(works-qa): add pole_qa_photos migration (#246)"
```

---

## Task 2: Types + Slot Metadata + Approval Gates

**Files:**
- Create: `src/modules/works-qa/types/works-qa.types.ts`
- Create: `src/modules/works-qa/utils/slot-keys.ts`
- Create: `src/modules/works-qa/utils/approval-gates.ts`
- Create: `src/modules/works-qa/__tests__/approval-gates.test.ts`

- [ ] **Step 2.1: Write the failing test for approval-gates**

```typescript
// src/modules/works-qa/__tests__/approval-gates.test.ts
import { describe, it, expect } from 'vitest';
import { allGatesPass } from '../utils/approval-gates';
import type { PoleQaPhoto } from '../types/works-qa.types';

const FULL_POLE: PoleQaPhoto = {
  id: 'test-id',
  project_id: 'proj-id',
  pole_label: 'A673',
  zone_no: 1,
  pon_no: 1,
  civil_step_01_key: 'works-qa/proj/A673/civil/01.jpg',
  civil_step_02_key: 'works-qa/proj/A673/civil/02.jpg',
  civil_step_03_key: 'works-qa/proj/A673/civil/03.jpg',
  civil_step_04_key: 'works-qa/proj/A673/civil/04.jpg',
  civil_step_05_key: 'works-qa/proj/A673/civil/05.jpg',
  civil_step_06_key: 'works-qa/proj/A673/civil/06.jpg',
  civil_step_07_key: 'works-qa/proj/A673/civil/07.jpg',
  optical_dome_01_key: 'works-qa/proj/A673/optical/dome_01.jpg',
  optical_dome_02_key: 'works-qa/proj/A673/optical/dome_02.jpg',
  optical_dome_03_key: 'works-qa/proj/A673/optical/dome_03.jpg',
  optical_dome_04_key: 'works-qa/proj/A673/optical/dome_04.jpg',
  optical_dome_05_key: 'works-qa/proj/A673/optical/dome_05.jpg',
  optical_dome_06_key: 'works-qa/proj/A673/optical/dome_06.jpg',
  optical_dome_07_key: 'works-qa/proj/A673/optical/dome_07.jpg',
  optical_dome_08_key: 'works-qa/proj/A673/optical/dome_08.jpg',
  optical_joint_11_key: 'works-qa/proj/A673/optical/joint_11.jpg',
  optical_joint_12_key: 'works-qa/proj/A673/optical/joint_12.jpg',
  optical_joint_13_key: 'works-qa/proj/A673/optical/joint_13.jpg',
  optical_joint_14_key: 'works-qa/proj/A673/optical/joint_14.jpg',
  optical_joint_15_key: 'works-qa/proj/A673/optical/joint_15.jpg',
  optical_joint_16_key: 'works-qa/proj/A673/optical/joint_16.jpg',
  optical_joint_tray_keys: ['works-qa/proj/A673/optical/tray_01.jpg'],
  vlm_results: {
    civil_01: { valid: true, confidence: 0.92, feedback: 'OK' },
    civil_02: { valid: true, confidence: 0.88, feedback: 'OK' },
    civil_03: { valid: true, confidence: 0.91, feedback: 'OK' },
    civil_04: { valid: true, confidence: 0.85, feedback: 'OK' },
    civil_05: { valid: true, confidence: 0.90, feedback: 'OK' },
    civil_06: { valid: true, confidence: 0.87, feedback: 'OK' },
    civil_07: { valid: true, confidence: 0.93, feedback: 'OK' },
    dome_01: { valid: true, confidence: 0.89, feedback: 'OK' },
    dome_02: { valid: true, confidence: 0.91, feedback: 'OK' },
    dome_03: { valid: true, confidence: 0.88, feedback: 'OK' },
    dome_04: { valid: true, confidence: 0.90, feedback: 'OK' },
    dome_05: { valid: true, confidence: 0.87, feedback: 'OK' },
    dome_06: { valid: true, confidence: 0.92, feedback: 'OK' },
    dome_07: { valid: true, confidence: 0.86, feedback: 'OK' },
    dome_08: { valid: true, confidence: 0.94, feedback: 'OK' },
    joint_11: { valid: true, confidence: 0.88, feedback: 'OK' },
    joint_12: { valid: true, confidence: 0.89, feedback: 'OK' },
    joint_13: { valid: true, confidence: 0.91, feedback: 'OK' },
    joint_14: { valid: true, confidence: 0.87, feedback: 'OK' },
    joint_15: { valid: true, confidence: 0.90, feedback: 'OK' },
    joint_16: { valid: true, confidence: 0.88, feedback: 'OK' },
  },
  civil_approved: false,
  dome_approved: false,
  joint_approved: false,
  approved_by: null,
  approved_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('allGatesPass', () => {
  it('passes when all 21 slots filled, all VLM valid, ≥1 tray photo', () => {
    const result = allGatesPass(FULL_POLE);
    expect(result.pass).toBe(true);
    expect(result.blocking).toHaveLength(0);
  });

  it('blocks when a fixed slot is missing', () => {
    const pole = { ...FULL_POLE, civil_step_03_key: null };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('civil_03');
  });

  it('blocks when VLM failed and no override', () => {
    const pole = {
      ...FULL_POLE,
      vlm_results: {
        ...FULL_POLE.vlm_results,
        dome_02: { valid: false, confidence: 0.31, feedback: 'Not a dome label' },
      },
    };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('dome_02');
  });

  it('allows overridden VLM failure', () => {
    const pole = {
      ...FULL_POLE,
      vlm_results: {
        ...FULL_POLE.vlm_results,
        dome_02: { valid: false, confidence: 0.31, feedback: 'Not a dome label', overridden_by: 'Johan' },
      },
    };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(true);
  });

  it('blocks when no tray photos', () => {
    const pole = { ...FULL_POLE, optical_joint_tray_keys: [] };
    const result = allGatesPass(pole);
    expect(result.pass).toBe(false);
    expect(result.blocking).toContain('tray_photos');
  });
});
```

- [ ] **Step 2.2: Run test — expect failure (modules don't exist yet)**

```bash
cd /home/hein/Workspace/FF_Next.js-works-qa
npx vitest run src/modules/works-qa/__tests__/approval-gates.test.ts 2>&1 | tail -10
```

Expected: Error — `Cannot find module '../utils/approval-gates'`.

- [ ] **Step 2.3: Write the types**

```typescript
// src/modules/works-qa/types/works-qa.types.ts

export interface VlmSlotResult {
  valid: boolean;
  confidence: number;
  feedback: string;
  overridden_by?: string;
  override_reason?: string;
}

export interface PoleQaPhoto {
  id: string;
  project_id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;

  // Civil
  civil_step_01_key: string | null;
  civil_step_02_key: string | null;
  civil_step_03_key: string | null;
  civil_step_04_key: string | null;
  civil_step_05_key: string | null;
  civil_step_06_key: string | null;
  civil_step_07_key: string | null;

  // Optical Dome
  optical_dome_01_key: string | null;
  optical_dome_02_key: string | null;
  optical_dome_03_key: string | null;
  optical_dome_04_key: string | null;
  optical_dome_05_key: string | null;
  optical_dome_06_key: string | null;
  optical_dome_07_key: string | null;
  optical_dome_08_key: string | null;

  // Optical Joint
  optical_joint_11_key: string | null;
  optical_joint_12_key: string | null;
  optical_joint_13_key: string | null;
  optical_joint_14_key: string | null;
  optical_joint_15_key: string | null;
  optical_joint_16_key: string | null;

  optical_joint_tray_keys: string[];
  vlm_results: Record<string, VlmSlotResult>;

  civil_approved: boolean;
  dome_approved: boolean;
  joint_approved: boolean;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PoleSummary {
  id: string;
  pole_label: string;
  zone_no: number | null;
  pon_no: number | null;
  civil_filled: number;     // 0-7
  dome_filled: number;      // 0-8
  joint_filled: number;     // 0-6
  tray_count: number;
  vlm_failures: number;
  status: 'empty' | 'in_progress' | 'ready' | 'approved';
  approved_at: string | null;
}

export type SlotKey =
  | 'civil_01' | 'civil_02' | 'civil_03' | 'civil_04' | 'civil_05' | 'civil_06' | 'civil_07'
  | 'dome_01' | 'dome_02' | 'dome_03' | 'dome_04' | 'dome_05' | 'dome_06' | 'dome_07' | 'dome_08'
  | 'joint_11' | 'joint_12' | 'joint_13' | 'joint_14' | 'joint_15' | 'joint_16'
  | 'tray_photos';
```

- [ ] **Step 2.4: Write slot-keys.ts**

```typescript
// src/modules/works-qa/utils/slot-keys.ts

export interface SlotMeta {
  key: string;             // e.g. "civil_01"
  dbColumn: string;        // e.g. "civil_step_01_key"
  label: string;           // e.g. "Before Photo"
  discipline: 'civil' | 'dome' | 'joint';
  stepNumber: number;
  vlmCheck: string;
}

export const SLOT_META: SlotMeta[] = [
  // Civil
  { key: 'civil_01', dbColumn: 'civil_step_01_key', label: 'Before Photo',       discipline: 'civil', stepNumber: 1, vlmCheck: 'Undisturbed ground with chalk/spray paint markings. NO hole visible yet.' },
  { key: 'civil_02', dbColumn: 'civil_step_02_key', label: 'During Photo',        discipline: 'civil', stepNumber: 2, vlmCheck: 'Active excavation in progress: open hole, workers digging. NO pole installed yet.' },
  { key: 'civil_03', dbColumn: 'civil_step_03_key', label: 'Depth Photo',         discipline: 'civil', stepNumber: 3, vlmCheck: 'Measuring tape or ruler in hole showing depth measurement.' },
  { key: 'civil_04', dbColumn: 'civil_step_04_key', label: 'End Plates',          discipline: 'civil', stepNumber: 4, vlmCheck: 'Close-up of metal end-plates, HDPE strapping, or brackets on the pole.' },
  { key: 'civil_05', dbColumn: 'civil_step_05_key', label: 'Compaction/Backfill', discipline: 'civil', stepNumber: 5, vlmCheck: 'Pole STANDING, hole FILLED and packed with sand+cement. Compacted surface.' },
  { key: 'civil_06', dbColumn: 'civil_step_06_key', label: 'Level Check',         discipline: 'civil', stepNumber: 6, vlmCheck: 'Spirit level (yellow/green bubble level tool) held against an upright pole.' },
  { key: 'civil_07', dbColumn: 'civil_step_07_key', label: 'After Photo',         discipline: 'civil', stepNumber: 7, vlmCheck: 'Full pole standing upright, wide shot from distance.' },
  // Dome
  { key: 'dome_01', dbColumn: 'optical_dome_01_key', label: 'Dome on Pole',       discipline: 'dome', stepNumber: 1, vlmCheck: 'Wide shot of splice dome installed on pole.' },
  { key: 'dome_02', dbColumn: 'optical_dome_02_key', label: 'Dome Label',         discipline: 'dome', stepNumber: 2, vlmCheck: 'Dome label with Pole ID / Fibre ID clearly readable.' },
  { key: 'dome_03', dbColumn: 'optical_dome_03_key', label: 'Open Dome',          discipline: 'dome', stepNumber: 3, vlmCheck: 'Fibre routing and tray layout visible inside open dome.' },
  { key: 'dome_04', dbColumn: 'optical_dome_04_key', label: 'Splice Protectors',  discipline: 'dome', stepNumber: 4, vlmCheck: 'Splice protectors fitted correctly over fibre splices.' },
  { key: 'dome_05', dbColumn: 'optical_dome_05_key', label: 'Slack Management',   discipline: 'dome', stepNumber: 5, vlmCheck: 'Neat fibre loops and cable organization within dome.' },
  { key: 'dome_06', dbColumn: 'optical_dome_06_key', label: 'Strength Members',   discipline: 'dome', stepNumber: 6, vlmCheck: 'Strength members (aramid/steel) secured inside dome.' },
  { key: 'dome_07', dbColumn: 'optical_dome_07_key', label: 'Seals & Dust Caps',  discipline: 'dome', stepNumber: 7, vlmCheck: 'Dome seals tightened, dust caps on unused ports.' },
  { key: 'dome_08', dbColumn: 'optical_dome_08_key', label: 'Pole ID',            discipline: 'dome', stepNumber: 8, vlmCheck: 'Pole ID label/tag attached to pole near dome.' },
  // Joint
  { key: 'joint_11', dbColumn: 'optical_joint_11_key', label: 'Cable Entries',     discipline: 'joint', stepNumber: 11, vlmCheck: 'Labelled cable entries into main joint closure.' },
  { key: 'joint_12', dbColumn: 'optical_joint_12_key', label: 'Strength Members',  discipline: 'joint', stepNumber: 12, vlmCheck: 'Strength members properly secured within closure.' },
  { key: 'joint_13', dbColumn: 'optical_joint_13_key', label: 'Tube Routing',      discipline: 'joint', stepNumber: 13, vlmCheck: 'Fibre tubes routed neatly from entry to splice tray.' },
  { key: 'joint_14', dbColumn: 'optical_joint_14_key', label: 'Tray Entries',      discipline: 'joint', stepNumber: 14, vlmCheck: 'Fibre entering splice trays in organised manner.' },
  { key: 'joint_15', dbColumn: 'optical_joint_15_key', label: 'Coiling & Protectors', discipline: 'joint', stepNumber: 15, vlmCheck: 'Fibre coiling loops and visible splice protectors.' },
  { key: 'joint_16', dbColumn: 'optical_joint_16_key', label: 'Readable Labels',   discipline: 'joint', stepNumber: 16, vlmCheck: 'Clear readable labels on cables, tubes, or closure.' },
];

export const SLOT_KEYS = SLOT_META.map(s => s.key);

export function getSlotMeta(key: string): SlotMeta | undefined {
  return SLOT_META.find(s => s.key === key);
}

export function getDbColumn(key: string): string {
  const meta = getSlotMeta(key);
  if (!meta) throw new Error(`Unknown slot key: ${key}`);
  return meta.dbColumn;
}
```

- [ ] **Step 2.5: Write approval-gates.ts**

```typescript
// src/modules/works-qa/utils/approval-gates.ts

import { SLOT_META } from './slot-keys';
import type { PoleQaPhoto, VlmSlotResult } from '../types/works-qa.types';

export interface GateResult {
  pass: boolean;
  blocking: string[];
}

export function allGatesPass(pole: PoleQaPhoto): GateResult {
  const blocking: string[] = [];

  for (const slot of SLOT_META) {
    const photoKey = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
    if (!photoKey) {
      blocking.push(slot.key);
      continue;
    }
    const vlm = pole.vlm_results[slot.key] as VlmSlotResult | undefined;
    if (!vlm) {
      blocking.push(slot.key);
      continue;
    }
    if (!vlm.valid && !vlm.overridden_by) {
      blocking.push(slot.key);
    }
  }

  if (pole.optical_joint_tray_keys.length === 0) {
    blocking.push('tray_photos');
  }

  return { pass: blocking.length === 0, blocking };
}
```

- [ ] **Step 2.6: Run tests — expect pass**

```bash
cd /home/hein/Workspace/FF_Next.js-works-qa
npx vitest run src/modules/works-qa/__tests__/approval-gates.test.ts 2>&1 | tail -15
```

Expected: `5 tests | 5 passed`.

- [ ] **Step 2.7: Commit**

```bash
git add src/modules/works-qa/
git commit -m "feat(works-qa): types, slot-keys, approval-gates + tests"
```

---

## Task 3: VLM Service for Works QA

**Files:**
- Create: `src/modules/works-qa/services/worksQaVlmService.ts`

- [ ] **Step 3.1: Write the VLM service**

```typescript
// src/modules/works-qa/services/worksQaVlmService.ts

import { VLM_CHAT_ENDPOINT, VLM_MODEL, VLM_MAX_TOKENS_QA, VLM_TIMEOUT_QA, VLM_TEMPERATURE, stripThinkTags } from '@/lib/vlm';
import { log } from '@/lib/logger';
import type { VlmSlotResult } from '../types/works-qa.types';

const MODULE = 'works-qa-vlm';

interface ValidatePhotoOptions {
  photoUrl: string;   // Full URL accessible from server (VF Storage proxy)
  slotKey: string;    // e.g. "civil_01"
  stepLabel: string;  // e.g. "Before Photo"
  vlmCheck: string;   // Full check description from SLOT_META
}

export async function validatePhotoForSlot(opts: ValidatePhotoOptions): Promise<VlmSlotResult> {
  const { photoUrl, slotKey, stepLabel, vlmCheck } = opts;

  const prompt = `You are a fibre network construction QA inspector. 
Evaluate whether this photo correctly shows: ${stepLabel}.

What to check: ${vlmCheck}

Respond with ONLY valid JSON (no markdown):
{"valid": true/false, "confidence": 0.0-1.0, "feedback": "brief reason"}`;

  try {
    const response = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: photoUrl } },
          ],
        }],
        max_tokens: VLM_MAX_TOKENS_QA,
        temperature: VLM_TEMPERATURE,
      }),
      signal: AbortSignal.timeout(VLM_TIMEOUT_QA),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`VLM HTTP ${response.status}: ${err}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = stripThinkTags(data.choices?.[0]?.message?.content ?? '');

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`No JSON in VLM response: ${raw}`);

    const parsed = JSON.parse(jsonMatch[0]) as { valid?: boolean; confidence?: number; feedback?: string };
    return {
      valid: Boolean(parsed.valid),
      confidence: Number(parsed.confidence ?? 0),
      feedback: String(parsed.feedback ?? ''),
    };
  } catch (err) {
    log.error(MODULE, { slotKey, error: err instanceof Error ? err.message : String(err) }, 'VLM validation failed');
    return { valid: false, confidence: 0, feedback: 'VLM validation failed — manual review required' };
  }
}
```

- [ ] **Step 3.2: Commit**

```bash
git add src/modules/works-qa/services/worksQaVlmService.ts
git commit -m "feat(works-qa): VLM photo validation service"
```

---

## Task 4: API — `GET /works-qa/poles`

**Files:**
- Create: `pages/api/works-qa/poles.ts`

- [ ] **Step 4.1: Write the route**

```typescript
// pages/api/works-qa/poles.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { project_id, pon_no } = req.query;
  if (!project_id || typeof project_id !== 'string') return apiResponse.badRequest(res, 'project_id required');

  try {
    const params: (string | number)[] = [project_id];
    let ponFilter = '';
    if (pon_no) {
      params.push(Number(pon_no));
      ponFilter = `AND pon_no = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT
        id, pole_label, zone_no, pon_no,
        (civil_step_01_key IS NOT NULL)::int + (civil_step_02_key IS NOT NULL)::int +
        (civil_step_03_key IS NOT NULL)::int + (civil_step_04_key IS NOT NULL)::int +
        (civil_step_05_key IS NOT NULL)::int + (civil_step_06_key IS NOT NULL)::int +
        (civil_step_07_key IS NOT NULL)::int AS civil_filled,
        (optical_dome_01_key IS NOT NULL)::int + (optical_dome_02_key IS NOT NULL)::int +
        (optical_dome_03_key IS NOT NULL)::int + (optical_dome_04_key IS NOT NULL)::int +
        (optical_dome_05_key IS NOT NULL)::int + (optical_dome_06_key IS NOT NULL)::int +
        (optical_dome_07_key IS NOT NULL)::int + (optical_dome_08_key IS NOT NULL)::int AS dome_filled,
        (optical_joint_11_key IS NOT NULL)::int + (optical_joint_12_key IS NOT NULL)::int +
        (optical_joint_13_key IS NOT NULL)::int + (optical_joint_14_key IS NOT NULL)::int +
        (optical_joint_15_key IS NOT NULL)::int + (optical_joint_16_key IS NOT NULL)::int AS joint_filled,
        array_length(optical_joint_tray_keys, 1) AS tray_count,
        (SELECT count(*) FROM jsonb_each(vlm_results) WHERE (value->>'valid')::boolean = false AND value->>'overridden_by' IS NULL) AS vlm_failures,
        CASE
          WHEN approved_at IS NOT NULL THEN 'approved'
          WHEN civil_step_01_key IS NOT NULL OR optical_dome_01_key IS NOT NULL THEN
            CASE WHEN (
              civil_step_01_key IS NOT NULL AND civil_step_02_key IS NOT NULL AND
              civil_step_03_key IS NOT NULL AND civil_step_04_key IS NOT NULL AND
              civil_step_05_key IS NOT NULL AND civil_step_06_key IS NOT NULL AND
              civil_step_07_key IS NOT NULL AND
              optical_dome_01_key IS NOT NULL AND optical_dome_02_key IS NOT NULL AND
              optical_dome_03_key IS NOT NULL AND optical_dome_04_key IS NOT NULL AND
              optical_dome_05_key IS NOT NULL AND optical_dome_06_key IS NOT NULL AND
              optical_dome_07_key IS NOT NULL AND optical_dome_08_key IS NOT NULL AND
              optical_joint_11_key IS NOT NULL AND optical_joint_12_key IS NOT NULL AND
              optical_joint_13_key IS NOT NULL AND optical_joint_14_key IS NOT NULL AND
              optical_joint_15_key IS NOT NULL AND optical_joint_16_key IS NOT NULL AND
              array_length(optical_joint_tray_keys, 1) >= 1
            ) THEN 'ready' ELSE 'in_progress' END
          ELSE 'empty'
        END AS status,
        approved_at
      FROM pole_qa_photos
      WHERE project_id = $1::uuid ${ponFilter}
      ORDER BY pon_no ASC NULLS LAST, pole_label ASC
    `, params);

    return apiResponse.success(res, result.rows);
  } catch (err) {
    log.error('works-qa/poles', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
```

- [ ] **Step 4.2: Commit**

```bash
git add pages/api/works-qa/poles.ts
git commit -m "feat(works-qa): GET /works-qa/poles list endpoint"
```

---

## Task 5: API — `GET /works-qa/pole-detail` and `POST /works-qa/pole-approve`

**Files:**
- Create: `pages/api/works-qa/pole-detail.ts`
- Create: `pages/api/works-qa/pole-approve.ts`

- [ ] **Step 5.1: Write pole-detail.ts**

```typescript
// pages/api/works-qa/pole-detail.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);

  const { pole_id } = req.query;
  if (!pole_id || typeof pole_id !== 'string') return apiResponse.badRequest(res, 'pole_id required');

  try {
    const result = await pool.query(
      'SELECT * FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (result.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);
    return apiResponse.success(res, result.rows[0]);
  } catch (err) {
    log.error('works-qa/pole-detail', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
```

- [ ] **Step 5.2: Write pole-approve.ts**

```typescript
// pages/api/works-qa/pole-approve.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { allGatesPass } from '@/modules/works-qa/utils/approval-gates';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id } = req.body as { pole_id?: string };
  if (!pole_id) return apiResponse.badRequest(res, 'pole_id required');

  const user = (req as AuthenticatedNextApiRequest).user;

  try {
    const fetchResult = await pool.query(
      'SELECT * FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (fetchResult.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    const pole = fetchResult.rows[0] as PoleQaPhoto;
    const { pass, blocking } = allGatesPass(pole);

    if (!pass) {
      return res.status(422).json({ success: false, error: 'Approval gates failed', blocking });
    }

    await pool.query(`
      UPDATE pole_qa_photos
      SET civil_approved = TRUE, dome_approved = TRUE, joint_approved = TRUE,
          approved_by = $1, approved_at = NOW(), updated_at = NOW()
      WHERE id = $2::uuid
    `, [user?.email ?? 'system', pole_id]);

    return apiResponse.success(res, { approved: true });
  } catch (err) {
    log.error('works-qa/pole-approve', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
```

- [ ] **Step 5.3: Commit**

```bash
git add pages/api/works-qa/pole-detail.ts pages/api/works-qa/pole-approve.ts
git commit -m "feat(works-qa): pole-detail + pole-approve endpoints"
```

---

## Task 6: API — `POST /works-qa/pole-assign` (upload + VLM)

**Files:**
- Create: `pages/api/works-qa/pole-assign.ts`

- [ ] **Step 6.1: Write pole-assign.ts**

```typescript
// pages/api/works-qa/pole-assign.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import formidable from 'formidable';
import fs from 'fs';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { vfStorage } from '@/services/vfStorageAdapter';
import { validatePhotoForSlot } from '@/modules/works-qa/services/worksQaVlmService';
import { getSlotMeta, getDbColumn } from '@/modules/works-qa/utils/slot-keys';

export const config = { api: { bodyParser: false } };

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  let tempPath: string | null = null;

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024 });
    const [fields, files] = await form.parse(req);

    const pole_id = Array.isArray(fields.pole_id) ? fields.pole_id[0] : fields.pole_id;
    const slot = Array.isArray(fields.slot) ? fields.slot[0] : fields.slot;
    const source = (Array.isArray(fields.source) ? fields.source[0] : fields.source) ?? 'upload';

    if (!pole_id || !slot) return apiResponse.badRequest(res, 'pole_id and slot required');

    const slotMeta = getSlotMeta(slot);
    if (!slotMeta) return apiResponse.badRequest(res, `Unknown slot: ${slot}`);

    const file = Array.isArray(files.photo) ? files.photo[0] : files.photo;
    if (!file) return apiResponse.badRequest(res, 'photo file required');
    tempPath = file.filepath;

    // Fetch pole to get project_id and pole_label for storage path
    const poleResult = await pool.query(
      'SELECT project_id, pole_label FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id]
    );
    if (poleResult.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);
    const { project_id, pole_label } = poleResult.rows[0] as { project_id: string; pole_label: string };

    const discipline = slotMeta.discipline === 'civil' ? 'civil' : 'optical';
    const filename = `${slotMeta.key}_${Date.now()}.jpg`;
    const buffer = fs.readFileSync(tempPath);

    const uploaded = await vfStorage.uploadFile(
      buffer,
      'works-qa',
      `${project_id}/${pole_label}/${discipline}`,
      filename
    );

    const photoKey = uploaded.path;
    const photoUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fibreflow.app'}${uploaded.url}`;

    // Run VLM validation
    const vlmResult = await validatePhotoForSlot({
      photoUrl,
      slotKey: slot,
      stepLabel: slotMeta.label,
      vlmCheck: slotMeta.vlmCheck,
    });

    // Update the pole record
    const dbColumn = getDbColumn(slot);
    await pool.query(`
      UPDATE pole_qa_photos
      SET ${dbColumn} = $1,
          vlm_results = vlm_results || $2::jsonb,
          updated_at = NOW()
      WHERE id = $3::uuid
    `, [
      photoKey,
      JSON.stringify({ [slot]: vlmResult }),
      pole_id,
    ]);

    return apiResponse.success(res, { photo_key: photoKey, vlm: vlmResult });
  } catch (err) {
    log.error('works-qa/pole-assign', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    }
  }
}

export default withAuth(handler);
```

- [ ] **Step 6.2: Commit**

```bash
git add pages/api/works-qa/pole-assign.ts
git commit -m "feat(works-qa): pole-assign endpoint with VF Storage upload + VLM"
```

---

## Task 7: API — `POST /works-qa/pole-override` and `POST /works-qa/sync-qfield`

**Files:**
- Create: `pages/api/works-qa/pole-override.ts`
- Create: `pages/api/works-qa/sync-qfield.ts`

- [ ] **Step 7.1: Write pole-override.ts**

```typescript
// pages/api/works-qa/pole-override.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { pole_id, slot, decision, reason } = req.body as {
    pole_id?: string; slot?: string; decision?: 'pass' | 'fail'; reason?: string;
  };

  if (!pole_id || !slot || !decision) return apiResponse.badRequest(res, 'pole_id, slot, decision required');
  if (!['pass', 'fail'].includes(decision)) return apiResponse.badRequest(res, 'decision must be pass or fail');

  const slotMeta = getSlotMeta(slot);
  if (!slotMeta) return apiResponse.badRequest(res, `Unknown slot: ${slot}`);

  const user = (req as AuthenticatedNextApiRequest).user;

  try {
    // Get current VLM result to log what was overridden
    const poleResult = await pool.query(
      'SELECT vlm_results, $2::text AS slot_col FROM pole_qa_photos WHERE id = $1::uuid',
      [pole_id, slotMeta.dbColumn]
    );
    if (poleResult.rows.length === 0) return apiResponse.notFound(res, 'Pole', pole_id);

    const existingVlm = (poleResult.rows[0].vlm_results?.[slot] ?? {}) as {
      valid?: boolean; confidence?: number; feedback?: string;
    };

    // Write correction example for few-shot learning
    await pool.query(`
      INSERT INTO qa_correction_examples
        (workflow_type, photo_filename, vlm_predicted_step, vlm_predicted_category,
         vlm_confidence, correction_reason, correct_step, correct_category, corrected_by)
      VALUES ('works_qa', $1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      slot,
      slotMeta.stepNumber,
      existingVlm.feedback ?? '',
      existingVlm.confidence ?? 0,
      reason ?? '',
      slotMeta.stepNumber,
      slotMeta.label,
      user?.email ?? 'system',
    ]);

    // Update vlm_results with override marker
    const overriddenResult = {
      ...existingVlm,
      valid: decision === 'pass',
      overridden_by: user?.email ?? 'system',
      override_reason: reason ?? '',
    };

    await pool.query(`
      UPDATE pole_qa_photos
      SET vlm_results = vlm_results || $1::jsonb, updated_at = NOW()
      WHERE id = $2::uuid
    `, [JSON.stringify({ [slot]: overriddenResult }), pole_id]);

    return apiResponse.success(res, { overridden: true, slot, decision });
  } catch (err) {
    log.error('works-qa/pole-override', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
```

- [ ] **Step 7.2: Write sync-qfield.ts**

```typescript
// pages/api/works-qa/sync-qfield.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getSlotMeta } from '@/modules/works-qa/utils/slot-keys';

// Maps QField checklist_step numbers to works-qa slot keys
const QFIELD_STEP_TO_SLOT: Record<number, string> = {
  1: 'civil_01', 2: 'civil_02', 3: 'civil_03', 4: 'civil_04',
  5: 'civil_05', 6: 'civil_06', 7: 'civil_07',
  // Optical dome (QField uses 1-8 for dome steps)
  // Note: QField optical photos are disambiguated by work_type
};

const QFIELD_OPTICAL_STEP_TO_SLOT: Record<number, string> = {
  1: 'dome_01', 2: 'dome_02', 3: 'dome_03', 4: 'dome_04',
  5: 'dome_05', 6: 'dome_06', 7: 'dome_07', 8: 'dome_08',
  11: 'joint_11', 12: 'joint_12', 13: 'joint_13',
  14: 'joint_14', 15: 'joint_15', 16: 'joint_16',
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const { project_id, pole_label } = req.body as { project_id?: string; pole_label?: string };
  if (!project_id) return apiResponse.badRequest(res, 'project_id required');

  try {
    let poleFilter = '';
    const params: string[] = [project_id];
    if (pole_label) {
      params.push(pole_label);
      poleFilter = `AND v.feature_id = $${params.length}`;
    }

    // Fetch QField validations for this project
    const validations = await pool.query(`
      SELECT v.feature_id, v.photo_key, v.checklist_step, v.work_type,
             v.vlm_confidence, v.vlm_feedback
      FROM qfield_photo_validations v
      WHERE v.project_id = $1::uuid
        AND v.feature_type = 'pole'
        AND v.photo_key IS NOT NULL
        ${poleFilter}
    `, params);

    let synced = 0;
    let skipped = 0;

    for (const row of validations.rows as Array<{
      feature_id: string; photo_key: string; checklist_step: number | null;
      work_type: string; vlm_confidence: number; vlm_feedback: string;
    }>) {
      const { feature_id, photo_key, checklist_step, work_type, vlm_confidence, vlm_feedback } = row;
      if (!checklist_step) { skipped++; continue; }

      const isOptical = work_type === 'dome_joint' || work_type === 'optical';
      const stepMap = isOptical ? QFIELD_OPTICAL_STEP_TO_SLOT : QFIELD_STEP_TO_SLOT;
      const slot = stepMap[checklist_step];
      if (!slot) { skipped++; continue; }

      const slotMeta = getSlotMeta(slot);
      if (!slotMeta) { skipped++; continue; }

      // Upsert the pole record
      await pool.query(`
        INSERT INTO pole_qa_photos (project_id, pole_label)
        VALUES ($1::uuid, $2)
        ON CONFLICT (project_id, pole_label) DO NOTHING
      `, [project_id, feature_id]);

      const vlmResult = {
        valid: (vlm_confidence ?? 0) >= 0.6,
        confidence: vlm_confidence ?? 0,
        feedback: vlm_feedback ?? 'Synced from QField',
      };

      await pool.query(`
        UPDATE pole_qa_photos
        SET ${slotMeta.dbColumn} = $1,
            vlm_results = vlm_results || $2::jsonb,
            updated_at = NOW()
        WHERE project_id = $3::uuid AND pole_label = $4
          AND ${slotMeta.dbColumn} IS NULL
      `, [photo_key, JSON.stringify({ [slot]: vlmResult }), project_id, feature_id]);

      synced++;
    }

    return apiResponse.success(res, { synced, skipped });
  } catch (err) {
    log.error('works-qa/sync-qfield', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(handler);
```

- [ ] **Step 7.3: Commit**

```bash
git add pages/api/works-qa/pole-override.ts pages/api/works-qa/sync-qfield.ts
git commit -m "feat(works-qa): pole-override + sync-qfield endpoints"
```

---

## Task 8: API — `GET /works-qa/pon-zip`

**Files:**
- Create: `pages/api/works-qa/pon-zip.ts`

- [ ] **Step 8.1: Write pon-zip.ts**

```typescript
// pages/api/works-qa/pon-zip.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import JSZip from 'jszip';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { SLOT_META } from '@/modules/works-qa/utils/slot-keys';
import type { PoleQaPhoto } from '@/modules/works-qa/types/works-qa.types';

const STORAGE_BASE = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.fibreflow.app';

async function fetchPhoto(storagePath: string): Promise<Buffer | null> {
  try {
    const url = `${STORAGE_BASE}/storage/${storagePath}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { project_id, pon_no } = req.query;
  if (!project_id || typeof project_id !== 'string') {
    res.status(400).json({ error: 'project_id required' }); return;
  }

  try {
    const params: (string | number)[] = [project_id];
    let ponFilter = '';
    if (pon_no) {
      params.push(Number(pon_no));
      ponFilter = `AND pon_no = $${params.length}`;
    }

    const result = await pool.query(`
      SELECT * FROM pole_qa_photos
      WHERE project_id = $1::uuid AND approved_at IS NOT NULL ${ponFilter}
      ORDER BY pole_label ASC
    `, params);

    const poles = result.rows as PoleQaPhoto[];
    if (poles.length === 0) {
      res.status(404).json({ error: 'No approved poles found for this PON' }); return;
    }

    const zip = new JSZip();
    const ponLabel = pon_no ? `PON_${pon_no}` : 'works-qa';

    for (const pole of poles) {
      const poleFolder = zip.folder(`${ponLabel}/${pole.pole_label}`);
      if (!poleFolder) continue;

      const civilFolder = poleFolder.folder('civil');
      const opticalFolder = poleFolder.folder('optical');

      // Add fixed civil slots
      for (const slot of SLOT_META.filter(s => s.discipline === 'civil')) {
        const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
        if (!key) continue;
        const buf = await fetchPhoto(key);
        if (buf) {
          const filename = `${String(slot.stepNumber).padStart(2, '0')}_${slot.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.jpg`;
          civilFolder?.file(filename, buf);
        }
      }

      // Add fixed dome + joint slots
      for (const slot of SLOT_META.filter(s => s.discipline === 'dome' || s.discipline === 'joint')) {
        const key = pole[slot.dbColumn as keyof PoleQaPhoto] as string | null;
        if (!key) continue;
        const buf = await fetchPhoto(key);
        if (buf) {
          const filename = `${String(slot.stepNumber).padStart(2, '0')}_${slot.label.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.jpg`;
          opticalFolder?.file(filename, buf);
        }
      }

      // Add tray photos
      pole.optical_joint_tray_keys.forEach((key, i) => {
        fetchPhoto(key).then(buf => {
          if (buf) opticalFolder?.file(`tray_${String(i + 1).padStart(2, '0')}.jpg`, buf);
        });
      });
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ponLabel}_approved.zip"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (err) {
    log.error('works-qa/pon-zip', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: 'ZIP generation failed' });
  }
}

export default withAuth(handler);
```

- [ ] **Step 8.2: Commit**

```bash
git add pages/api/works-qa/pon-zip.ts
git commit -m "feat(works-qa): pon-zip endpoint for FiberTime-ready ZIP download"
```

---

## Task 9: Navigation

**Files:**
- Create: `src/modules/works-qa/components/worksQaNavConfig.ts`
- Create: `src/modules/works-qa/components/WorksQANav.tsx`

- [ ] **Step 9.1: Write nav config**

```typescript
// src/modules/works-qa/components/worksQaNavConfig.ts
import type { Tab } from '@/components/accounting/accountingNavConfig';
export type { Tab };
export { isFlyout, isLinkActive } from '@/components/accounting/accountingNavConfig';

export const TABS: Tab[] = [
  { id: 'dashboard', label: 'Overview',  href: '/field-ops/works-qa' },
];

export function getActiveTabId(pathname: string): string {
  if (pathname.startsWith('/field-ops/works-qa')) return 'dashboard';
  return '';
}
```

- [ ] **Step 9.2: Write WorksQANav component**

```typescript
// src/modules/works-qa/components/WorksQANav.tsx
import { ModuleNav } from '@/components/layout/ModuleNav';
import { TABS, getActiveTabId } from './worksQaNavConfig';

export function WorksQANav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="teal" />;
}
```

- [ ] **Step 9.3: Commit**

```bash
git add src/modules/works-qa/components/WorksQANav.tsx src/modules/works-qa/components/worksQaNavConfig.ts
git commit -m "feat(works-qa): navigation config and WorksQANav component"
```

---

## Task 10: SWR Hooks

**Files:**
- Create: `src/modules/works-qa/hooks/usePoleList.ts`
- Create: `src/modules/works-qa/hooks/usePoleDetail.ts`

- [ ] **Step 10.1: Write usePoleList.ts**

```typescript
// src/modules/works-qa/hooks/usePoleList.ts
import useSWR from 'swr';
import type { PoleSummary } from '../types/works-qa.types';

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data ?? r);

export function usePoleList(projectId: string | null, ponNo: number | null) {
  const params = new URLSearchParams();
  if (projectId) params.set('project_id', projectId);
  if (ponNo != null) params.set('pon_no', String(ponNo));

  const { data, error, mutate, isLoading } = useSWR<PoleSummary[]>(
    projectId ? `/api/works-qa/poles?${params}` : null,
    fetcher,
    { refreshInterval: 30_000 }
  );

  return { poles: data ?? [], error, isLoading, mutate };
}
```

- [ ] **Step 10.2: Write usePoleDetail.ts**

```typescript
// src/modules/works-qa/hooks/usePoleDetail.ts
import useSWR from 'swr';
import type { PoleQaPhoto } from '../types/works-qa.types';

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => r.data ?? r);

export function usePoleDetail(poleId: string | null) {
  const { data, error, mutate, isLoading } = useSWR<PoleQaPhoto>(
    poleId ? `/api/works-qa/pole-detail?pole_id=${poleId}` : null,
    fetcher
  );
  return { pole: data ?? null, error, isLoading, mutate };
}
```

- [ ] **Step 10.3: Commit**

```bash
git add src/modules/works-qa/hooks/
git commit -m "feat(works-qa): SWR hooks usePoleList + usePoleDetail"
```

---

## Task 11: `PhotoSlotCard` + `TrayBucket` Components

**Files:**
- Create: `src/modules/works-qa/components/PhotoSlotCard.tsx`
- Create: `src/modules/works-qa/components/TrayBucket.tsx`

- [ ] **Step 11.1: Write PhotoSlotCard.tsx**

```tsx
// src/modules/works-qa/components/PhotoSlotCard.tsx
import { useState, useRef } from 'react';
import type { VlmSlotResult } from '../types/works-qa.types';

interface PhotoSlotCardProps {
  slotKey: string;
  label: string;
  photoKey: string | null;
  vlm: VlmSlotResult | undefined;
  onUpload: (file: File) => void;
  onOverride: (decision: 'pass' | 'fail', reason: string) => void;
  disabled?: boolean;
}

export function PhotoSlotCard({ slotKey, label, photoKey, vlm, onUpload, onOverride, disabled }: PhotoSlotCardProps) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const status: 'empty' | 'pass' | 'fail' | 'overridden' =
    !photoKey ? 'empty'
    : vlm?.overridden_by ? 'overridden'
    : vlm?.valid ? 'pass'
    : vlm ? 'fail'
    : 'empty';

  const borderColor =
    status === 'pass' ? 'border-green-500/40' :
    status === 'overridden' ? 'border-amber-500/40' :
    status === 'fail' ? 'border-red-500/40' :
    'border-zinc-700 border-dashed';

  const bgColor =
    status === 'pass' ? 'bg-green-500/5' :
    status === 'overridden' ? 'bg-amber-500/5' :
    status === 'fail' ? 'bg-red-500/5' :
    'bg-zinc-900';

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-3 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">{label}</span>
        {status === 'pass' && <span className="text-xs text-green-400">✓ VLM pass</span>}
        {status === 'overridden' && <span className="text-xs text-amber-400">✓ Overridden</span>}
        {status === 'fail' && <span className="text-xs text-red-400">⚠ VLM fail</span>}
      </div>

      {photoKey ? (
        <img
          src={`/storage/${photoKey}`}
          alt={label}
          className="w-full h-28 object-cover rounded"
        />
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="w-full h-28 flex items-center justify-center text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors disabled:opacity-50"
        >
          + Upload
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
      />

      {vlm?.feedback && (
        <p className="text-xs text-zinc-500 leading-tight">{vlm.feedback}</p>
      )}

      {status === 'fail' && !showOverride && (
        <button
          onClick={() => setShowOverride(true)}
          className="text-xs text-amber-400 hover:text-amber-300 underline self-start"
        >
          Override
        </button>
      )}

      {showOverride && (
        <div className="flex flex-col gap-1">
          <input
            type="text"
            placeholder="Override reason…"
            value={overrideReason}
            onChange={e => setOverrideReason(e.target.value)}
            className="text-xs bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-zinc-200"
          />
          <div className="flex gap-1">
            <button
              onClick={() => { onOverride('pass', overrideReason); setShowOverride(false); }}
              className="text-xs bg-amber-600 hover:bg-amber-500 text-white rounded px-2 py-1"
            >
              Mark Pass
            </button>
            <button
              onClick={() => setShowOverride(false)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 11.2: Write TrayBucket.tsx**

```tsx
// src/modules/works-qa/components/TrayBucket.tsx
import { useRef } from 'react';

interface TrayBucketProps {
  trayKeys: string[];
  onUpload: (files: File[]) => void;
  disabled?: boolean;
}

export function TrayBucket({ trayKeys, onUpload, disabled }: TrayBucketProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length > 0) onUpload(files);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Tray Photos ({trayKeys.length})
        </span>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="text-xs text-teal-400 hover:text-teal-300 disabled:opacity-50"
        >
          + Add
        </button>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        className="border border-dashed border-zinc-700 rounded-lg p-3 min-h-16"
      >
        {trayKeys.length === 0 ? (
          <p className="text-xs text-zinc-600 text-center pt-2">Drop tray photos here or click Add</p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {trayKeys.map((key, i) => (
              <img
                key={i}
                src={`/storage/${key}`}
                alt={`Tray ${i + 1}`}
                className="w-full h-16 object-cover rounded"
              />
            ))}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []);
          if (files.length > 0) onUpload(files);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 11.3: Commit**

```bash
git add src/modules/works-qa/components/PhotoSlotCard.tsx src/modules/works-qa/components/TrayBucket.tsx
git commit -m "feat(works-qa): PhotoSlotCard + TrayBucket components"
```

---

## Task 12: `ApprovePoleButton` Component

**Files:**
- Create: `src/modules/works-qa/components/ApprovePoleButton.tsx`

- [ ] **Step 12.1: Write ApprovePoleButton.tsx**

```tsx
// src/modules/works-qa/components/ApprovePoleButton.tsx
import { useState } from 'react';
import { allGatesPass } from '../utils/approval-gates';
import type { PoleQaPhoto } from '../types/works-qa.types';

interface ApprovePoleButtonProps {
  pole: PoleQaPhoto;
  onApproved: () => void;
}

export function ApprovePoleButton({ pole, onApproved }: ApprovePoleButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { pass, blocking } = allGatesPass(pole);

  const handleApprove = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/works-qa/pole-approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: pole.id }),
      });
      const data = await res.json() as { success?: boolean; error?: string; blocking?: string[] };
      if (!res.ok) {
        setError(data.error ?? 'Approval failed');
      } else {
        onApproved();
      }
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  if (pole.approved_at) {
    return (
      <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
        <span>✓ Approved</span>
        <span className="text-zinc-500 text-xs">
          by {pole.approved_by} at {new Date(pole.approved_at).toLocaleString()}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={handleApprove}
        disabled={!pass || loading}
        className="px-4 py-2 rounded bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Approving…' : 'Approve Pole'}
      </button>

      {!pass && (
        <div className="text-xs text-zinc-500">
          Blocked: {blocking.slice(0, 3).join(', ')}{blocking.length > 3 ? ` +${blocking.length - 3} more` : ''}
        </div>
      )}

      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 12.2: Commit**

```bash
git add src/modules/works-qa/components/ApprovePoleButton.tsx
git commit -m "feat(works-qa): ApprovePoleButton with gate enforcement"
```

---

## Task 13: `PoleDetailPanel` Component

**Files:**
- Create: `src/modules/works-qa/components/PoleDetailPanel.tsx`

- [ ] **Step 13.1: Write PoleDetailPanel.tsx**

```tsx
// src/modules/works-qa/components/PoleDetailPanel.tsx
import { usePoleDetail } from '../hooks/usePoleDetail';
import { PhotoSlotCard } from './PhotoSlotCard';
import { TrayBucket } from './TrayBucket';
import { ApprovePoleButton } from './ApprovePoleButton';
import { SLOT_META } from '../utils/slot-keys';

interface PoleDetailPanelProps {
  poleId: string | null;
  onClose: () => void;
}

async function assignPhoto(poleId: string, slot: string, file: File) {
  const form = new FormData();
  form.append('pole_id', poleId);
  form.append('slot', slot);
  form.append('photo', file);
  form.append('source', 'upload');
  const res = await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
}

async function overrideSlot(poleId: string, slot: string, decision: 'pass' | 'fail', reason: string) {
  await fetch('/api/works-qa/pole-override', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pole_id: poleId, slot, decision, reason }),
  });
}

async function uploadTrayPhotos(poleId: string, files: File[]) {
  for (const file of files) {
    const form = new FormData();
    form.append('pole_id', poleId);
    form.append('slot', 'tray');
    form.append('photo', file);
    form.append('source', 'upload');
    await fetch('/api/works-qa/pole-assign', { method: 'POST', body: form });
  }
}

const CIVIL_SLOTS = SLOT_META.filter(s => s.discipline === 'civil');
const DOME_SLOTS = SLOT_META.filter(s => s.discipline === 'dome');
const JOINT_SLOTS = SLOT_META.filter(s => s.discipline === 'joint');

export function PoleDetailPanel({ poleId, onClose }: PoleDetailPanelProps) {
  const { pole, isLoading, mutate } = usePoleDetail(poleId);

  if (!poleId) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <span className="font-semibold text-zinc-100">
          {pole ? `Pole ${pole.pole_label}` : 'Loading…'}
        </span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">Loading…</div>
      )}

      {pole && (
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          {/* Civil Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Civil</h3>
              <span className="text-xs text-zinc-500">
                {CIVIL_SLOTS.filter(s => pole[s.dbColumn as keyof typeof pole]).length}/{CIVIL_SLOTS.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {CIVIL_SLOTS.map(slot => (
                <PhotoSlotCard
                  key={slot.key}
                  slotKey={slot.key}
                  label={slot.label}
                  photoKey={pole[slot.dbColumn as keyof typeof pole] as string | null}
                  vlm={pole.vlm_results[slot.key]}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate())}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate())}
                  disabled={!!pole.approved_at}
                />
              ))}
            </div>
          </section>

          {/* Optical Dome Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Optical Dome</h3>
              <span className="text-xs text-zinc-500">
                {DOME_SLOTS.filter(s => pole[s.dbColumn as keyof typeof pole]).length}/{DOME_SLOTS.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {DOME_SLOTS.map(slot => (
                <PhotoSlotCard
                  key={slot.key}
                  slotKey={slot.key}
                  label={slot.label}
                  photoKey={pole[slot.dbColumn as keyof typeof pole] as string | null}
                  vlm={pole.vlm_results[slot.key]}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate())}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate())}
                  disabled={!!pole.approved_at}
                />
              ))}
            </div>
          </section>

          {/* Optical Joint Section */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Optical Joint</h3>
              <span className="text-xs text-zinc-500">
                {JOINT_SLOTS.filter(s => pole[s.dbColumn as keyof typeof pole]).length}/{JOINT_SLOTS.length}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {JOINT_SLOTS.map(slot => (
                <PhotoSlotCard
                  key={slot.key}
                  slotKey={slot.key}
                  label={slot.label}
                  photoKey={pole[slot.dbColumn as keyof typeof pole] as string | null}
                  vlm={pole.vlm_results[slot.key]}
                  onUpload={file => assignPhoto(pole.id, slot.key, file).then(() => mutate())}
                  onOverride={(d, r) => overrideSlot(pole.id, slot.key, d, r).then(() => mutate())}
                  disabled={!!pole.approved_at}
                />
              ))}
            </div>
            <TrayBucket
              trayKeys={pole.optical_joint_tray_keys}
              onUpload={files => uploadTrayPhotos(pole.id, files).then(() => mutate())}
              disabled={!!pole.approved_at}
            />
          </section>
        </div>
      )}

      {/* Footer */}
      {pole && (
        <div className="px-5 py-4 border-t border-zinc-800 flex items-center justify-between">
          <ApprovePoleButton pole={pole} onApproved={() => mutate()} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 13.2: Commit**

```bash
git add src/modules/works-qa/components/PoleDetailPanel.tsx
git commit -m "feat(works-qa): PoleDetailPanel slide-in with stacked sections"
```

---

## Task 14: `PoleListTable` Component

**Files:**
- Create: `src/modules/works-qa/components/PoleListTable.tsx`

- [ ] **Step 14.1: Write PoleListTable.tsx**

```tsx
// src/modules/works-qa/components/PoleListTable.tsx
import type { PoleSummary } from '../types/works-qa.types';

interface PoleListTableProps {
  poles: PoleSummary[];
  selectedPoleId: string | null;
  onSelect: (id: string) => void;
}

function PixelStrip({ filled, total, hasFailures }: { filled: number; total: number; hasFailures: boolean }) {
  return (
    <div className="flex gap-[2px] items-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`h-[10px] w-[10px] rounded-[2px] ${
            i < filled
              ? hasFailures && i < filled
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

export function PoleListTable({ poles, selectedPoleId, onSelect }: PoleListTableProps) {
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
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3">Joint + Trays</th>
            <th className="text-left text-xs font-medium text-zinc-500 uppercase tracking-wide py-2 px-3 w-28">Status</th>
          </tr>
        </thead>
        <tbody>
          {poles.map(pole => (
            <tr
              key={pole.id}
              onClick={() => onSelect(pole.id)}
              className={`border-b border-zinc-900 cursor-pointer transition-colors hover:bg-zinc-800/50 ${
                selectedPoleId === pole.id ? 'bg-zinc-800/70' : ''
              } ${pole.status === 'approved' ? 'bg-green-500/5' : ''}`}
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 14.2: Commit**

```bash
git add src/modules/works-qa/components/PoleListTable.tsx
git commit -m "feat(works-qa): PoleListTable dense table with pixel progress strips"
```

---

## Task 15: Page Shell + Route

**Files:**
- Create: `src/modules/works-qa/components/WorksQAPage.tsx`
- Create: `pages/field-ops/works-qa.tsx`

- [ ] **Step 15.1: Write WorksQAPage.tsx**

```tsx
// src/modules/works-qa/components/WorksQAPage.tsx
import { useState } from 'react';
import { useRouter } from 'next/router';
import { WorksQANav } from './WorksQANav';
import { PoleListTable } from './PoleListTable';
import { PoleDetailPanel } from './PoleDetailPanel';
import { usePoleList } from '../hooks/usePoleList';

export function WorksQAPage() {
  const router = useRouter();
  const { project_id, pon_no } = router.query;

  const projectId = typeof project_id === 'string' ? project_id : null;
  const ponNo = typeof pon_no === 'string' ? Number(pon_no) : null;

  const { poles, isLoading, mutate } = usePoleList(projectId, ponNo);
  const [selectedPoleId, setSelectedPoleId] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <WorksQANav />

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* PON filter bar */}
        <div className="flex items-center gap-4 mb-6">
          <input
            type="text"
            placeholder="Project ID…"
            defaultValue={projectId ?? ''}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-72"
            onBlur={e => {
              const val = e.target.value.trim();
              if (val) router.push({ query: { ...router.query, project_id: val } });
            }}
          />
          <input
            type="number"
            placeholder="PON No…"
            defaultValue={ponNo ?? ''}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 w-32"
            onBlur={e => {
              const val = e.target.value.trim();
              if (val) router.push({ query: { ...router.query, pon_no: val } });
            }}
          />
          {projectId && (
            <button
              onClick={async () => {
                await fetch('/api/works-qa/sync-qfield', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ project_id: projectId }),
                });
                mutate();
              }}
              className="px-3 py-1.5 text-sm bg-teal-700 hover:bg-teal-600 text-white rounded transition-colors"
            >
              Sync QField
            </button>
          )}
          {projectId && ponNo && (
            <a
              href={`/api/works-qa/pon-zip?project_id=${projectId}&pon_no=${ponNo}`}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded transition-colors"
            >
              ↓ Download ZIP
            </a>
          )}
        </div>

        {/* Summary bar */}
        {!isLoading && poles.length > 0 && (
          <div className="flex gap-4 mb-4 text-xs text-zinc-500">
            <span>{poles.length} poles</span>
            <span>{poles.filter(p => p.status === 'approved').length} approved</span>
            <span>{poles.filter(p => p.status === 'ready').length} ready to approve</span>
            <span>{poles.filter(p => p.status === 'in_progress').length} in progress</span>
          </div>
        )}

        <PoleListTable
          poles={poles}
          selectedPoleId={selectedPoleId}
          onSelect={setSelectedPoleId}
        />

        {!projectId && (
          <div className="text-sm text-zinc-600 text-center py-16">
            Enter a Project ID above to load poles.
          </div>
        )}
      </div>

      <PoleDetailPanel
        poleId={selectedPoleId}
        onClose={() => setSelectedPoleId(null)}
      />
    </div>
  );
}
```

- [ ] **Step 15.2: Write the Next.js page**

```tsx
// pages/field-ops/works-qa.tsx
import type { NextPage } from 'next';
import Head from 'next/head';
import { AppLayout } from '@/components/layout/AppLayout';
import { WorksQAPage } from '@/modules/works-qa/components/WorksQAPage';

const WorksQA: NextPage = () => (
  <AppLayout>
    <Head><title>Works QA | FibreFlow</title></Head>
    <WorksQAPage />
  </AppLayout>
);

export default WorksQA;
```

- [ ] **Step 15.3: Commit**

```bash
git add src/modules/works-qa/components/WorksQAPage.tsx pages/field-ops/works-qa.tsx
git commit -m "feat(works-qa): WorksQAPage + /field-ops/works-qa route"
```

---

## Task 16: `.claude.md` and Lint Gate

**Files:**
- Create: `src/modules/works-qa/.claude.md`

- [ ] **Step 16.1: Write the module quick-reference**

```markdown
<!-- src/modules/works-qa/.claude.md -->
# works-qa module

Works QA Dashboard for Johan's pole photo sweep workflow.

**Page:** `/field-ops/works-qa`
**API routes:** `pages/api/works-qa/` — 7 flat routes (poles, pole-detail, pole-assign, pole-override, pole-approve, sync-qfield, pon-zip)
**DB table:** `pole_qa_photos` — 21 fixed TEXT key columns + `optical_joint_tray_keys TEXT[]`
**VLM:** `worksQaVlmService.ts` — direct call to VLM_CHAT_ENDPOINT, returns `{valid, confidence, feedback}`
**Approvals:** `allGatesPass()` in `approval-gates.ts` — all 21 slots filled + VLM pass or override + ≥1 tray photo
**Learning:** VLM overrides → `qa_correction_examples` with `workflow_type='works_qa'`
**QField sync:** `sync-qfield.ts` pulls from `qfield_photo_validations` — does NOT write back to QField
```

- [ ] **Step 16.2: Run lint gate**

```bash
cd /home/hein/Workspace/FF_Next.js-works-qa
npm run ci:quick 2>&1 | tail -20
```

Expected: Lint error count must not exceed project baseline (77 errors). Fix any TypeScript errors before proceeding.

- [ ] **Step 16.3: Fix any lint errors, then commit**

```bash
git add src/modules/works-qa/.claude.md
git commit -m "docs(works-qa): module quick-reference .claude.md"
```

---

## Task 17: Browser Verification

- [ ] **Step 17.1: Start dev server**

```bash
cd /home/hein/Workspace/FF_Next.js-works-qa
PORT=3004 npm run dev &
```

- [ ] **Step 17.2: Open page and verify navigation renders**

Navigate to `http://localhost:3004/field-ops/works-qa`

Expected:
- Works QA nav bar renders with teal accent
- "Enter a Project ID above" empty state shown
- No console errors

- [ ] **Step 17.3: Test with a real project**

1. Find a project UUID from the DB: `psql ... -c "SELECT id, name FROM projects LIMIT 5"`
2. Navigate to `http://localhost:3004/field-ops/works-qa?project_id=<UUID>&pon_no=1`
3. Click "Sync QField" — verify response in network tab
4. Pole list table should populate (or show empty if no QField data for this PON)
5. Click a pole row — verify the detail panel slides in
6. Try uploading a photo to a slot — verify VLM call fires, result shown

- [ ] **Step 17.4: Push branch and open PR**

```bash
cd /home/hein/Workspace/FF_Next.js-works-qa
git push -u origin feat/works-qa-dashboard
gh pr create \
  --title "feat: Works QA Dashboard (PRD-063)" \
  --body "$(cat <<'EOF'
## Summary
- New `works-qa` module for Johan's pole photo QA sweep workflow
- `pole_qa_photos` table (migration 246): 21 fixed slots + TEXT[] tray array
- 7 flat API routes under /api/works-qa/
- Dense table pole list + stacked slide-in detail panel
- VLM validates each photo on upload; Johan can override to `qa_correction_examples`
- Approve gate: all 21 slots filled + all VLM pass (or overridden) + ≥1 tray photo
- ZIP download for approved poles (FiberTime-ready structure)

## Test plan
- [ ] DB migration runs cleanly on shared Supabase
- [ ] `allGatesPass` unit tests pass (vitest)
- [ ] Lint gate: `npm run ci:quick` does not regress baseline
- [ ] Browser: page loads, nav renders, QField sync populates poles
- [ ] Browser: photo upload → VLM fires → result shown in slot card
- [ ] Browser: override VLM failure → correction written to qa_correction_examples
- [ ] Browser: approve pole → locked state shown
- [ ] Browser: ZIP download produces correct folder structure

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
