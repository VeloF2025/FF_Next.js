# SiteCam Auto-Appeals VLM — Phase 1 (Schema + Service) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shadow-mode data model and a dedicated `appealsVlmService` (photo-appeal + serial-appeal modes) that turns a SiteCam appeal into an *advisory* VLM recommendation — with unit tests, no cron or UI wiring yet.

**Architecture:** A pure service (`evaluateAppeal(input) → AppealEvaluation`) that reuses the existing SiteCam step-VLM plumbing (criteria, gallery few-shot, image optimisation, VLM client, barcode reader) but adds appeal-specific checks the strict gate never runs. A new appeal prompt builder wraps the *authoritative* `STEP_CRITERIA`/`CIVIL_STEP_CRITERIA` without editing them. A migration adds advisory `vlm_*` columns to `sitecam_appeals` that never mutate `status`. Everything fails **open → `uncertain`** (never a silent approve), the opposite of the tech-facing gate.

**Tech Stack:** TypeScript, Next.js API/services, Vitest + node-mocks-http, PostgreSQL (self-hosted Supabase), the on-prem Qwen3-VL endpoint.

**Source spec:** `docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md` (§5.2, §5.3, §5.8, §5.9; roadmap P1). Open questions resolved for P1: **5.2a → columns now**, **5.3a → new prompt builder**, **5.4b → add `'vlm'` to `decided_via` now**.

## Global Constraints

- Migrations MUST live in `scripts/migrations/sql/` (top-level `scripts/migrations/` is silently ignored). Next free number is **436** (latest on disk is `435`). Ship a matching `rollback_436_*.sql`.
- Never edit `STEP_CRITERIA` / `CIVIL_STEP_CRITERIA` step-membership — they stay authoritative. The appeal builder only *adds* an appeal section and *overrides* the output shape.
- Fail-open policy for appeals = record `uncertain` + a `skipReason`, **never** a silent `approve`.
- No `console.log` — use `log` from `@/lib/logger`. No empty catch blocks. 100% type coverage. Files < 300 lines.
- No DGTS: real assertions, no `assert true`, no tautological tests, no mocks masquerading as implementations.
- All work on a feature branch off fresh `origin/master`. Gate on `npm run ci:quick` before the PR. **Stop at "PR opened" — do not merge or deploy** (wait for Hein).
- Shadow-mode invariant: nothing in Phase 1 reads or writes `sitecam_appeals.status`.

---

### Task 1: Migration — advisory `vlm_*` columns on `sitecam_appeals`

**Files:**
- Create: `scripts/migrations/sql/436_sitecam_appeals_vlm.sql`
- Create: `scripts/migrations/sql/rollback_436_sitecam_appeals_vlm.sql`

**Interfaces:**
- Consumes: existing `sitecam_appeals` table (migration `402_sitecam_serial_appeals.sql`), including its inline `sitecam_appeals_decided_via_check` constraint (`decided_via IN ('whatsapp','in_app')`).
- Produces: columns `vlm_recommendation`, `vlm_confidence`, `vlm_reasoning`, `vlm_checks (jsonb)`, `vlm_serial_read`, `vlm_model`, `vlm_evaluated_at`, `vlm_attempts`, `vlm_skip_reason`, `human_agreed_with_vlm`; partial index `sitecam_appeals_vlm_pending`; widened `decided_via` CHECK allowing `'vlm'`. These are the storage target for Task 3/4's `AppealEvaluation` (wired by the Phase 2 cron).

- [ ] **Step 1: Write the forward migration**

`scripts/migrations/sql/436_sitecam_appeals_vlm.sql`:

```sql
-- scripts/migrations/sql/436_sitecam_appeals_vlm.sql
-- Auto-Appeals VLM, Phase 1 (shadow mode). Adds ADVISORY recommendation columns
-- to sitecam_appeals. These columns NEVER change `status` — a later go-live
-- migration/flag introduces auto-decisioning. See
-- docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md §5.2.

ALTER TABLE sitecam_appeals
  ADD COLUMN IF NOT EXISTS vlm_recommendation    text
      CHECK (vlm_recommendation IN ('approve','deny','uncertain')),
  ADD COLUMN IF NOT EXISTS vlm_confidence        real,     -- 0..1
  ADD COLUMN IF NOT EXISTS vlm_reasoning         text,     -- free-text "why"
  ADD COLUMN IF NOT EXISTS vlm_checks            jsonb,    -- per-check verdict + evidence
  ADD COLUMN IF NOT EXISTS vlm_serial_read       text,     -- serial mode: serial read off the photo
  ADD COLUMN IF NOT EXISTS vlm_model             text,     -- model id + prompt version (audit)
  ADD COLUMN IF NOT EXISTS vlm_evaluated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS vlm_attempts          smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vlm_skip_reason       text,     -- 'no_photo','vlm_unavailable','unsupported_step','unreadable_image'
  ADD COLUMN IF NOT EXISTS human_agreed_with_vlm boolean;  -- set at human decision time (HITL signal, Phase 3/4)

-- Forward-compat for go-live (spec §5.4b): allow decided_via = 'vlm' now so the
-- later auto-decide cron needs no schema change. Cheap; avoids a future ALTER.
ALTER TABLE sitecam_appeals DROP CONSTRAINT IF EXISTS sitecam_appeals_decided_via_check;
ALTER TABLE sitecam_appeals
  ADD CONSTRAINT sitecam_appeals_decided_via_check
  CHECK (decided_via IN ('whatsapp','in_app','vlm'));

-- Idempotency for the Phase 2 cron: it only scores pending, not-yet-evaluated rows.
CREATE INDEX IF NOT EXISTS sitecam_appeals_vlm_pending
  ON sitecam_appeals(status) WHERE status = 'pending' AND vlm_evaluated_at IS NULL;
```

- [ ] **Step 2: Write the rollback migration**

`scripts/migrations/sql/rollback_436_sitecam_appeals_vlm.sql`:

```sql
-- Rollback for 436_sitecam_appeals_vlm.sql
DROP INDEX IF EXISTS sitecam_appeals_vlm_pending;

ALTER TABLE sitecam_appeals DROP CONSTRAINT IF EXISTS sitecam_appeals_decided_via_check;
ALTER TABLE sitecam_appeals
  ADD CONSTRAINT sitecam_appeals_decided_via_check
  CHECK (decided_via IN ('whatsapp','in_app'));

ALTER TABLE sitecam_appeals
  DROP COLUMN IF EXISTS vlm_recommendation,
  DROP COLUMN IF EXISTS vlm_confidence,
  DROP COLUMN IF EXISTS vlm_reasoning,
  DROP COLUMN IF EXISTS vlm_checks,
  DROP COLUMN IF EXISTS vlm_serial_read,
  DROP COLUMN IF EXISTS vlm_model,
  DROP COLUMN IF EXISTS vlm_evaluated_at,
  DROP COLUMN IF EXISTS vlm_attempts,
  DROP COLUMN IF EXISTS vlm_skip_reason,
  DROP COLUMN IF EXISTS human_agreed_with_vlm;
```

- [ ] **Step 3: Verify idempotency by inspection**

Confirm every `ADD COLUMN` uses `IF NOT EXISTS`, the index uses `IF NOT EXISTS`, and the constraint swap uses `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`. Re-running the file must be a no-op (no error). No command needed — this is a read check.

> **Apply note (ops, not part of the code PR):** the shared dev/prod DB is one instance (Hard Rule 10 — schema migrations require confirmation). Do **not** hand-run this against the shared DB during development. It is applied via the project migration runner against **dev first**, coordinated with Hein. If you need to smoke-test locally, use a throwaway Postgres, referencing connection details only from `.claude/credentials.local.md` (never inline).

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/sql/436_sitecam_appeals_vlm.sql scripts/migrations/sql/rollback_436_sitecam_appeals_vlm.sql
git commit -m "feat(sitecam): migration 436 — advisory VLM columns on sitecam_appeals (shadow mode)"
```

---

### Task 2: Appeal prompt builder

**Files:**
- Create: `src/modules/sitecam/lib/appealStepCriteria.ts`
- Test: `src/modules/sitecam/lib/__tests__/appealStepCriteria.test.ts`

**Interfaces:**
- Consumes (exact, verified in source):
  - `@/modules/activate/services/stepQualityCriteria` → `buildMessageContent(step: QualityCheckStep, newPhotoBase64: string, galleryExamples?: GalleryExamples, opts?: { crossStepClassification?: boolean }): BuiltPrompt`; types `QualityCheckStep`, `VlmContentPart` (`{ type:'text'; text:string } | { type:'image_url'; image_url:{ url:string } }`), `GalleryExamples` (`{ positiveBase64: string[]; negativeBase64: string[] }`).
  - `@/modules/sitecam/lib/civilStepCriteria` → `buildCivilMessageContent(step: CivilStep, newPhotoBase64: string, galleryExamples?: GalleryExamples, opts?: { crossStepClassification?: boolean }): { content: VlmContentPart[] }`; type `CivilStep`.
  - `@/modules/sitecam/lib/sitecamSteps` → type `SiteCamJobType = 'activations' | 'civils'`.
- Produces: `APPEAL_PHOTO_JSON_SHAPE: string`; `buildAppealPhotoContent(jobType, step, photoBase64, appealText, galleryExamples?): VlmContentPart[]` — consumed by Task 3.

- [ ] **Step 1: Write the failing test**

`src/modules/sitecam/lib/__tests__/appealStepCriteria.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// Stub the two heavy criteria builders so we test the APPEAL wrapper in isolation:
// the wrapper must reuse their output verbatim and then add its own section.
vi.mock('@/modules/activate/services/stepQualityCriteria', () => ({
  buildMessageContent: vi.fn(() => ({
    content: [{ type: 'text', text: 'ACTIVATIONS-BASE' }],
    usedFewShot: false,
  })),
}));
vi.mock('@/modules/sitecam/lib/civilStepCriteria', () => ({
  buildCivilMessageContent: vi.fn(() => ({
    content: [{ type: 'text', text: 'CIVILS-BASE' }],
  })),
}));

import { buildAppealPhotoContent, APPEAL_PHOTO_JSON_SHAPE } from '../appealStepCriteria';

function joinText(parts: Array<{ type: string; text?: string }>): string {
  return parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
}

describe('buildAppealPhotoContent', () => {
  it('reuses the activations base prompt and appends the appeal section', () => {
    const parts = buildAppealPhotoContent('activations', 4, 'PHOTO', 'the glare hides it but the ONT is there');
    const text = joinText(parts);
    expect(text).toContain('ACTIVATIONS-BASE');           // base criteria reused
    expect(text).toContain('the glare hides it');          // technician reason injected
    expect(text).toContain('reason_photo_consistency');    // the three appeal checks
    expect(text).toContain('context_aware_rejudge');
    expect(text).toContain('overturn_justification');
    expect(text).toContain('IGNORE');                      // overrides the base JSON shape
  });

  it('uses the civils base prompt for civils job type', () => {
    const parts = buildAppealPhotoContent('civils', 3, 'PHOTO', 'depth is visible on the tape');
    expect(joinText(parts)).toContain('CIVILS-BASE');
  });

  it('truncates an over-long appeal reason to keep the prompt bounded', () => {
    const long = 'x'.repeat(5000);
    const parts = buildAppealPhotoContent('activations', 4, 'PHOTO', long);
    const injected = joinText(parts);
    // 1000-char cap from the builder — the full 5000 must not appear.
    expect(injected).not.toContain('x'.repeat(1001));
  });

  it('exports a JSON shape describing the three checks', () => {
    expect(APPEAL_PHOTO_JSON_SHAPE).toContain('recommendation');
    expect(APPEAL_PHOTO_JSON_SHAPE).toContain('checks');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/lib/__tests__/appealStepCriteria.test.ts`
Expected: FAIL — `Cannot find module '../appealStepCriteria'`.

- [ ] **Step 3: Write the implementation**

`src/modules/sitecam/lib/appealStepCriteria.ts`:

```ts
/**
 * Appeal-specific VLM prompt builder.
 *
 * Wraps the AUTHORITATIVE per-step criteria (STEP_CRITERIA / CIVIL_STEP_CRITERIA)
 * — reused verbatim via the existing builders so step-membership rules are never
 * duplicated or altered — and adds an APPEAL section: the technician's written
 * reason plus three checks the strict gate never performs, then overrides the
 * output shape. See spec §5.3.
 */
import {
  buildMessageContent,
  type QualityCheckStep,
  type VlmContentPart,
  type GalleryExamples,
} from '@/modules/activate/services/stepQualityCriteria';
import {
  buildCivilMessageContent,
  type CivilStep,
} from '@/modules/sitecam/lib/civilStepCriteria';
import type { SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';

/** Max characters of technician reason injected into the prompt (bounds context). */
const MAX_REASON_CHARS = 1000;

/** The JSON the appeals VLM must return for a photo appeal. */
export const APPEAL_PHOTO_JSON_SHAPE = `{
  "recommendation": "approve" | "deny" | "uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "<one or two sentences a reviewer and technician can read>",
  "checks": [
    { "name": "reason_photo_consistency", "verdict": "pass|fail|uncertain", "evidence": "<what in the photo supports or contradicts the reason>" },
    { "name": "context_aware_rejudge",    "verdict": "pass|fail|uncertain", "evidence": "<the specific required evidence you can or cannot see>" },
    { "name": "overturn_justification",   "verdict": "pass|fail|uncertain", "evidence": "<why you uphold or overturn the original rejection>" }
  ]
}`;

/**
 * Build the VLM message content for a photo appeal.
 * @param galleryExamples pHash-ranked approved/rejected examples for the step.
 */
export function buildAppealPhotoContent(
  jobType: SiteCamJobType,
  step: number,
  photoBase64: string,
  appealText: string,
  galleryExamples?: GalleryExamples
): VlmContentPart[] {
  // Reuse the strict-gate builders exactly (crossStepClassification off — the
  // appeal instruction below supplies its own judgement framing).
  const base: VlmContentPart[] =
    jobType === 'civils'
      ? buildCivilMessageContent(step as CivilStep, photoBase64, galleryExamples, {
          crossStepClassification: false,
        }).content
      : buildMessageContent(step as QualityCheckStep, photoBase64, galleryExamples, {
          crossStepClassification: false,
        }).content;

  const reason = appealText.slice(0, MAX_REASON_CHARS);

  const appealSection: VlmContentPart = {
    type: 'text',
    text: `APPEAL REVIEW — This photo was already REJECTED by the automated check. A technician has appealed with the written reason below. Judge the APPEAL, not just the raw photo.

TECHNICIAN'S APPEAL REASON:
"""${reason}"""

Perform THREE checks and report each in "checks":
1. reason_photo_consistency — does the image actually support the technician's written claim? Flag fabricated, irrelevant, or copy-paste reasons.
2. context_aware_rejudge — apply the step's INTENT. Allow legitimate edge cases the strict gate over-rejects (glare, angle, partial occlusion) ONLY when the required evidence is still visibly present. Cite the specific evidence; never grant blanket leniency.
3. overturn_justification — state plainly why you uphold or overturn the original rejection.

Recommend "approve" ONLY if the required evidence is present AND the reason is truthful. Recommend "deny" if the photo still lacks the required evidence or the reason is false. Recommend "uncertain" if you genuinely cannot tell.

IGNORE any earlier instruction about the response format. Respond with ONLY this JSON (no prose, no markdown):
${APPEAL_PHOTO_JSON_SHAPE}`,
  };

  return [...base, appealSection];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/sitecam/lib/__tests__/appealStepCriteria.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/lib/appealStepCriteria.ts src/modules/sitecam/lib/__tests__/appealStepCriteria.test.ts
git commit -m "feat(sitecam): appeal VLM prompt builder (wraps authoritative step criteria)"
```

---

### Task 3: `appealsVlmService` — photo-appeal mode + dispatcher

**Files:**
- Create: `src/modules/sitecam/services/appealsVlmService.ts`
- Test: `src/modules/sitecam/services/__tests__/appealsVlmService.photo.test.ts`

**Interfaces:**
- Consumes:
  - `@/lib/vlmGallery` → `loadGalleryExamples(step: number, jobType, rawPhotoBase64: string): Promise<GalleryExamples>`.
  - `@/modules/activate/services/imagePreprocessService` → `optimizeForVlm(base64: string, opts: { maxWidth: number; maxHeight: number }): Promise<string>`.
  - `@/modules/sitecam/lib/sitecamSteps` → `toGalleryJobType(jobType)`, type `SiteCamJobType`.
  - `@/lib/vlm` → `VLM_CHAT_ENDPOINT`, `VLM_CATEGORIZATION_MODEL`, `VLM_TIMEOUT_REALTIME`, `VLM_MAX_TOKENS_QUICK`, `VLM_TEMPERATURE`, `VLM_MAX_IMAGE_WIDTH`, `VLM_MAX_IMAGE_HEIGHT`, `stripThinkTags`.
  - `@/modules/activate/services/stepQualityCriteria` → `QUALITY_CHECK_STEPS`.
  - `@/modules/sitecam/lib/civilStepCriteria` → `CIVIL_QUALITY_STEPS`.
  - `@/modules/sitecam/lib/appealStepCriteria` → `buildAppealPhotoContent` (Task 2).
  - `@/lib/logger` → `log`.
- Produces (consumed by Task 4 and the Phase 2 cron): exported types `AppealRecommendation`, `AppealSkipReason`, `AppealCheck`, `AppealEvaluation`, `AppealInput`; constant `APPEAL_PROMPT_VERSION`; internal helpers `callVlm`, `parseAppealJson`, `uncertain`; and `evaluateAppeal(input: AppealInput): Promise<AppealEvaluation>` dispatching to photo mode (serial mode stubbed here, implemented in Task 4).

- [ ] **Step 1: Write the failing test**

`src/modules/sitecam/services/__tests__/appealsVlmService.photo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ optimizeForVlm: vi.fn(), loadGallery: vi.fn(), fetchFn: vi.fn() }));

vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/vlmGallery', () => ({ loadGalleryExamples: h.loadGallery }));
vi.mock('@/modules/activate/services/imagePreprocessService', () => ({ optimizeForVlm: h.optimizeForVlm }));
vi.mock('@/modules/sitecam/lib/appealStepCriteria', () => ({
  buildAppealPhotoContent: () => [{ type: 'text', text: 'APPEAL-PROMPT' }],
  APPEAL_PHOTO_JSON_SHAPE: '{}',
}));

import { evaluateAppeal } from '../appealsVlmService';

function mockVlm(content: string) {
  h.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
}

const photoInput = { jobType: 'activations' as const, stepNumber: 4, photoBase64: 'RAW', appealText: 'ONT is visible' };

beforeEach(() => {
  vi.clearAllMocks();
  h.optimizeForVlm.mockResolvedValue('small-b64');
  h.loadGallery.mockResolvedValue({ positiveBase64: [], negativeBase64: [] });
  vi.stubGlobal('fetch', h.fetchFn);
});

describe('evaluateAppeal — photo mode', () => {
  it('returns the VLM recommendation with clamped confidence and checks', async () => {
    mockVlm('{"recommendation":"approve","confidence":0.86,"reasoning":"ONT clearly visible","checks":[{"name":"reason_photo_consistency","verdict":"pass","evidence":"ONT body visible"}]}');
    const r = await evaluateAppeal(photoInput);
    expect(r.recommendation).toBe('approve');
    expect(r.confidence).toBe(0.86);
    expect(r.checks).toHaveLength(1);
    expect(r.skipReason).toBeNull();
    expect(r.model).toContain('appeal-v1');
  });

  it('clamps out-of-range confidence into 0..1', async () => {
    mockVlm('{"recommendation":"deny","confidence":9,"reasoning":"no ONT","checks":[]}');
    const r = await evaluateAppeal(photoInput);
    expect(r.confidence).toBe(1);
  });

  it('fails OPEN to uncertain (never approve) when the VLM is unreachable', async () => {
    h.fetchFn.mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await evaluateAppeal(photoInput);
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('vlm_unavailable');
  });

  it('returns uncertain when the VLM response has no parsable recommendation', async () => {
    mockVlm('the appeal looks fine to me');
    const r = await evaluateAppeal(photoInput);
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('vlm_unavailable');
  });

  it('skips with no_photo when the appeal has no image', async () => {
    const r = await evaluateAppeal({ ...photoInput, photoBase64: '' });
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('no_photo');
    expect(h.fetchFn).not.toHaveBeenCalled();
  });

  it('skips with unsupported_step for a step with no criteria', async () => {
    const r = await evaluateAppeal({ ...photoInput, stepNumber: 99 });
    expect(r.skipReason).toBe('unsupported_step');
    expect(h.fetchFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/services/__tests__/appealsVlmService.photo.test.ts`
Expected: FAIL — `Cannot find module '../appealsVlmService'`.

- [ ] **Step 3: Write the implementation**

`src/modules/sitecam/services/appealsVlmService.ts`:

```ts
/**
 * Appeals VLM service (shadow mode). Turns a SiteCam appeal into an ADVISORY
 * recommendation. Two modes behind one `evaluateAppeal` entry point:
 *   - photo mode  → reason↔photo consistency + context-aware re-judge
 *   - serial mode → barcode-first read, VLM OCR fallback (Task 4)
 *
 * Fail-open policy is DELIBERATELY the opposite of /api/sitecam/validate: an
 * unavailable/garbled VLM records `uncertain` + a skipReason, NEVER a silent
 * approve. See spec §5.3 / §5.8.
 */
import { log } from '@/lib/logger';
import { loadGalleryExamples } from '@/lib/vlmGallery';
import { optimizeForVlm } from '@/modules/activate/services/imagePreprocessService';
import { toGalleryJobType, type SiteCamJobType } from '@/modules/sitecam/lib/sitecamSteps';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_REALTIME,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  VLM_MAX_IMAGE_WIDTH,
  VLM_MAX_IMAGE_HEIGHT,
  stripThinkTags,
} from '@/lib/vlm';
import type { VlmContentPart } from '@/modules/activate/services/stepQualityCriteria';
import { QUALITY_CHECK_STEPS } from '@/modules/activate/services/stepQualityCriteria';
import { CIVIL_QUALITY_STEPS } from '@/modules/sitecam/lib/civilStepCriteria';
import { buildAppealPhotoContent } from '@/modules/sitecam/lib/appealStepCriteria';

const MODULE = 'AppealsVlm';
/** Bump whenever the appeal prompt changes — recorded in `model` for audit. */
export const APPEAL_PROMPT_VERSION = 'appeal-v1';
const MODEL_TAG = `${VLM_CATEGORIZATION_MODEL}/${APPEAL_PROMPT_VERSION}`;

export type AppealRecommendation = 'approve' | 'deny' | 'uncertain';
export type AppealSkipReason =
  | 'no_photo'
  | 'vlm_unavailable'
  | 'unsupported_step'
  | 'unreadable_image';

export interface AppealCheck {
  name: string;
  verdict: 'pass' | 'fail' | 'uncertain';
  evidence: string;
}

export interface AppealEvaluation {
  recommendation: AppealRecommendation;
  confidence: number; // 0..1
  reasoning: string;
  checks: AppealCheck[];
  serialRead?: string | null; // serial mode only
  model: string;
  skipReason: AppealSkipReason | null;
}

export interface AppealInput {
  jobType: SiteCamJobType;
  stepNumber: number;
  /** Raw base64 (no `data:` prefix) — the cron strips the prefix before calling. */
  photoBase64: string;
  appealText: string;
  serialScanned?: string | null;
  serialExpected?: string | null;
}

/** Advisory "we couldn't decide" result — the only fail path (never approve). */
export function uncertain(reason: string, skip: AppealSkipReason, serialRead?: string | null): AppealEvaluation {
  return {
    recommendation: 'uncertain',
    confidence: 0,
    reasoning: reason,
    checks: [],
    serialRead: serialRead ?? null,
    model: MODEL_TAG,
    skipReason: skip,
  };
}

/** POST content parts to the VLM; return raw (think-tag-stripped) text or null on failure. */
export async function callVlm(content: VlmContentPart[]): Promise<string | null> {
  const body = {
    model: VLM_CATEGORIZATION_MODEL,
    messages: [{ role: 'user', content }],
    max_tokens: VLM_MAX_TOKENS_QUICK,
    temperature: VLM_TEMPERATURE,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VLM_TIMEOUT_REALTIME);
  try {
    const resp = await fetch(VLM_CHAT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`VLM HTTP ${resp.status}`);
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return stripThinkTags(json.choices?.[0]?.message?.content ?? '');
  } catch (err) {
    clearTimeout(timeout);
    log.error('Appeals VLM call failed', { error: String(err) }, MODULE);
    return null;
  }
}

interface RawAppealJson {
  recommendation?: unknown;
  confidence?: unknown;
  reasoning?: unknown;
  checks?: unknown;
}

/** Extract the first JSON object from raw VLM text. */
export function parseAppealJson(raw: string): RawAppealJson | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as RawAppealJson;
  } catch {
    return null;
  }
}

function isRecommendation(v: unknown): v is AppealRecommendation {
  return v === 'approve' || v === 'deny' || v === 'uncertain';
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

function isAppealCheck(v: unknown): v is AppealCheck {
  const c = v as AppealCheck;
  return (
    !!c &&
    typeof c.name === 'string' &&
    (c.verdict === 'pass' || c.verdict === 'fail' || c.verdict === 'uncertain') &&
    typeof c.evidence === 'string'
  );
}

function stepHasCriteria(jobType: SiteCamJobType, step: number): boolean {
  const steps = jobType === 'civils' ? CIVIL_QUALITY_STEPS : QUALITY_CHECK_STEPS;
  return (steps as readonly number[]).includes(step);
}

async function evaluatePhotoAppeal(input: AppealInput): Promise<AppealEvaluation> {
  if (!stepHasCriteria(input.jobType, input.stepNumber)) {
    return uncertain(`Step ${input.stepNumber} has no appeal criteria for ${input.jobType}`, 'unsupported_step');
  }

  // Rank gallery examples by visual similarity to the appealed photo, then give
  // the judged photo the larger budget (small edge-case features must survive).
  const gallery = await loadGalleryExamples(input.stepNumber, toGalleryJobType(input.jobType), input.photoBase64);
  const optimized = await optimizeForVlm(input.photoBase64, {
    maxWidth: VLM_MAX_IMAGE_WIDTH,
    maxHeight: VLM_MAX_IMAGE_HEIGHT,
  });

  const content = buildAppealPhotoContent(input.jobType, input.stepNumber, optimized, input.appealText, gallery);
  const raw = await callVlm(content);
  if (raw === null) return uncertain('Appeals VLM unavailable', 'vlm_unavailable');

  const parsed = parseAppealJson(raw);
  if (!parsed || !isRecommendation(parsed.recommendation)) {
    log.error('Appeals VLM returned no parsable recommendation', { raw: raw.slice(0, 200) }, MODULE);
    return uncertain('Appeals VLM returned an unparsable response', 'vlm_unavailable');
  }

  return {
    recommendation: parsed.recommendation,
    confidence: clampConfidence(parsed.confidence),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '',
    checks: Array.isArray(parsed.checks) ? (parsed.checks.filter(isAppealCheck) as AppealCheck[]) : [],
    serialRead: null,
    model: MODEL_TAG,
    skipReason: null,
  };
}

// Placeholder — real serial-appeal logic lands in Task 4 (which renames the
// param to `input` and uses it). Underscore avoids an unused-param lint error
// in this intermediate commit.
async function evaluateSerialAppeal(_input: AppealInput): Promise<AppealEvaluation> {
  return uncertain('Serial-appeal mode not yet implemented', 'unreadable_image', null);
}

/** Entry point: dispatch to serial mode when the appeal carries serial fields, else photo mode. */
export async function evaluateAppeal(input: AppealInput): Promise<AppealEvaluation> {
  if (!input.photoBase64 || input.photoBase64.trim().length === 0) {
    return uncertain('Appeal has no photo to evaluate', 'no_photo');
  }
  const isSerial = !!(input.serialScanned || input.serialExpected);
  return isSerial ? evaluateSerialAppeal(input) : evaluatePhotoAppeal(input);
}
```

> Note: `evaluateSerialAppeal` is intentionally a stub here so Task 3 ships a green, self-contained photo evaluator. Task 4 replaces the stub body and un-suppresses its `input` param.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/sitecam/services/__tests__/appealsVlmService.photo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/services/appealsVlmService.ts src/modules/sitecam/services/__tests__/appealsVlmService.photo.test.ts
git commit -m "feat(sitecam): appealsVlmService photo-appeal evaluator + dispatcher (fail-open→uncertain)"
```

---

### Task 4: `appealsVlmService` — serial-appeal mode

**Files:**
- Modify: `src/modules/sitecam/services/appealsVlmService.ts` (replace the `evaluateSerialAppeal` stub; add a VLM-OCR fallback helper)
- Test: `src/modules/sitecam/services/__tests__/appealsVlmService.serial.test.ts`

**Interfaces:**
- Consumes: `@/modules/activate/services/enhancedBarcodeService` → `extractOntSerialEnhanced(base64Image: string): Promise<{ success: boolean; serial: string | null; format; confidence: number; method: string; processingTimeMs: number }>`; plus `callVlm`, `optimizeForVlm`, `uncertain` from Task 3.
- Produces: a real `evaluateSerialAppeal` that populates `serialRead` and returns `approve`/`deny`/`uncertain`.

- [ ] **Step 1: Write the failing test**

`src/modules/sitecam/services/__tests__/appealsVlmService.serial.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ optimizeForVlm: vi.fn(), barcode: vi.fn(), fetchFn: vi.fn() }));

vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/vlmGallery', () => ({ loadGalleryExamples: vi.fn() }));
vi.mock('@/modules/activate/services/imagePreprocessService', () => ({ optimizeForVlm: h.optimizeForVlm }));
vi.mock('@/modules/activate/services/enhancedBarcodeService', () => ({ extractOntSerialEnhanced: h.barcode }));
vi.mock('@/modules/sitecam/lib/appealStepCriteria', () => ({
  buildAppealPhotoContent: () => [], APPEAL_PHOTO_JSON_SHAPE: '{}',
}));

import { evaluateAppeal } from '../appealsVlmService';

function mockVlm(content: string) {
  h.fetchFn.mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) });
}

const base = {
  jobType: 'activations' as const,
  stepNumber: 8,
  photoBase64: 'RAW',
  appealText: 'scanner mis-read, serial on device is correct',
  serialScanned: 'ALCLB1234567',
  serialExpected: 'ALCLB9999999',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.optimizeForVlm.mockResolvedValue('small-b64');
  vi.stubGlobal('fetch', h.fetchFn);
});

describe('evaluateAppeal — serial mode', () => {
  it('approves when the barcode-read serial matches the scanned value', async () => {
    h.barcode.mockResolvedValue({ success: true, serial: 'ALCLB1234567', confidence: 0.99, method: 'barcode', format: null, processingTimeMs: 5 });
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('approve');
    expect(r.serialRead).toBe('ALCLB1234567');
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(h.fetchFn).not.toHaveBeenCalled(); // barcode hit → no VLM OCR
  });

  it('denies when the photo shows a different serial than the tech scanned', async () => {
    h.barcode.mockResolvedValue({ success: true, serial: 'ALCLB7654321', confidence: 0.99, method: 'barcode', format: null, processingTimeMs: 5 });
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('deny');
    expect(r.serialRead).toBe('ALCLB7654321');
  });

  it('falls back to VLM OCR when the barcode scan fails', async () => {
    h.barcode.mockResolvedValue({ success: false, serial: null, confidence: 0, method: 'none', format: null, processingTimeMs: 5 });
    mockVlm('{"serial":"ALCLB1234567"}');
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('approve');
    expect(r.serialRead).toBe('ALCLB1234567');
    expect(r.confidence).toBeLessThan(0.9); // OCR is lower-confidence than a barcode read
  });

  it('is uncertain + unreadable_image when neither barcode nor OCR can read a serial', async () => {
    h.barcode.mockResolvedValue({ success: false, serial: null, confidence: 0, method: 'none', format: null, processingTimeMs: 5 });
    mockVlm('{"serial":null}');
    const r = await evaluateAppeal(base);
    expect(r.recommendation).toBe('uncertain');
    expect(r.skipReason).toBe('unreadable_image');
    expect(r.serialRead).toBeNull();
  });

  it('treats a barcode-service throw as a failed read and falls back to OCR', async () => {
    h.barcode.mockRejectedValue(new Error('wasm boom'));
    mockVlm('{"serial":"ALCLB1234567"}');
    const r = await evaluateAppeal(base);
    expect(r.serialRead).toBe('ALCLB1234567');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/services/__tests__/appealsVlmService.serial.test.ts`
Expected: FAIL — the stub returns `uncertain`/`unreadable_image` for every case, so the approve/deny/OCR assertions fail.

- [ ] **Step 3: Add the import and OCR helper**

In `src/modules/sitecam/services/appealsVlmService.ts`, add the import near the other service imports:

```ts
import { extractOntSerialEnhanced } from '@/modules/activate/services/enhancedBarcodeService';
```

Add this helper above `evaluateSerialAppeal`:

```ts
interface RawSerialJson {
  serial?: unknown;
}

/** VLM OCR fallback: read a serial off the photo when the barcode scan fails. */
async function ocrSerialViaVlm(photoBase64: string): Promise<string | null> {
  const optimized = await optimizeForVlm(photoBase64, {
    maxWidth: VLM_MAX_IMAGE_WIDTH,
    maxHeight: VLM_MAX_IMAGE_HEIGHT,
  });
  const content: VlmContentPart[] = [
    {
      type: 'text',
      text: 'Read the ONT/device serial number printed or barcoded in this photo. Respond with ONLY this JSON: {"serial":"<value>"} or {"serial":null} if you cannot read it clearly.',
    },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${optimized}` } },
  ];
  const raw = await callVlm(content);
  if (raw === null) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as RawSerialJson;
    return typeof parsed.serial === 'string' && parsed.serial.trim().length > 0 ? parsed.serial.trim() : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Replace the `evaluateSerialAppeal` stub**

Replace the placeholder body with:

```ts
async function evaluateSerialAppeal(input: AppealInput): Promise<AppealEvaluation> {
  const scanned = (input.serialScanned ?? '').trim().toUpperCase();
  const expected = (input.serialExpected ?? '').trim().toUpperCase();

  // 1. Barcode-first (Data Matrix / Code128) — highest confidence. A thrown
  //    scanner error is treated as a failed read, not a crash.
  const barcode = await extractOntSerialEnhanced(input.photoBase64).catch((err: unknown) => {
    log.error('Barcode scan threw during serial appeal', { error: String(err) }, MODULE);
    return null;
  });
  let serialRead: string | null = barcode?.success ? barcode.serial : null;
  const viaBarcode = serialRead !== null;

  // 2. VLM OCR fallback.
  if (!serialRead) serialRead = await ocrSerialViaVlm(input.photoBase64);

  if (!serialRead) {
    return uncertain('Serial not legible in the appealed photo (barcode + OCR both failed)', 'unreadable_image', null);
  }

  const readNorm = serialRead.trim().toUpperCase();
  const checks: AppealCheck[] = [
    {
      name: 'photo_matches_scanned',
      verdict: readNorm === scanned ? 'pass' : 'fail',
      evidence: `photo serial ${readNorm} vs scanned ${scanned || '(none)'}`,
    },
    {
      name: 'photo_matches_expected',
      verdict: readNorm === expected ? 'pass' : 'fail',
      evidence: `photo serial ${readNorm} vs expected ${expected || '(none)'}`,
    },
  ];

  // Approve when the photo legibly shows the serial the tech scanned — the
  // mismatch is then against the EXPECTED/SOW value (an upstream data issue,
  // not a tech error). Deny when the photo shows a different serial.
  const recommendation: AppealRecommendation = readNorm === scanned ? 'approve' : 'deny';
  const reasoning =
    recommendation === 'approve'
      ? `Photo serial ${readNorm} matches the scanned value; mismatch is against the expected/SOW serial ${expected || '(none)'}.`
      : `Photo serial ${readNorm} does not match the scanned value ${scanned || '(none)'}.`;

  return {
    recommendation,
    confidence: viaBarcode ? 0.95 : 0.7,
    reasoning,
    checks,
    serialRead: readNorm,
    model: MODEL_TAG,
    skipReason: null,
  };
}
```

- [ ] **Step 5: Run both service test files to verify they pass**

Run: `npx vitest run src/modules/sitecam/services/__tests__/appealsVlmService.serial.test.ts src/modules/sitecam/services/__tests__/appealsVlmService.photo.test.ts`
Expected: PASS (5 + 6 tests). Confirms Task 4 didn't regress the photo evaluator.

- [ ] **Step 6: Commit**

```bash
git add src/modules/sitecam/services/appealsVlmService.ts src/modules/sitecam/services/__tests__/appealsVlmService.serial.test.ts
git commit -m "feat(sitecam): appealsVlmService serial-appeal evaluator (barcode-first, VLM OCR fallback)"
```

---

### Task 5: Phase-1 gate + PR

**Files:** none (verification + PR only).

- [ ] **Step 1: Run the full new-code test set**

Run: `npx vitest run src/modules/sitecam/lib/__tests__/appealStepCriteria.test.ts src/modules/sitecam/services/__tests__/appealsVlmService.photo.test.ts src/modules/sitecam/services/__tests__/appealsVlmService.serial.test.ts`
Expected: PASS (15 tests total).

- [ ] **Step 2: Run the project CI gate**

Run: `npm run ci:quick`
Expected: lint + type-check + affected tests pass. Fix any failure before proceeding — never `--no-verify`.

- [ ] **Step 3: Open the PR (then stop)**

```bash
git push -u origin feature/sitecam-appeals-vlm-phase1
gh pr create --base master --title "feat(sitecam): auto-appeals VLM Phase 1 — schema + service (shadow mode)" \
  --body "Phase 1 of docs/superpowers/specs/2026-07-01-sitecam-appeals-vlm-design.md. Adds advisory vlm_* columns (migration 436) and appealsVlmService (photo + serial modes), advisory-only. No cron/UI wiring; nothing reads or writes appeal status. Shadow-mode invariant preserved."
```

Then **stop** — await Hein's review/merge and coordinate the migration apply on dev. Do not merge or deploy.

---

## Self-Review

**1. Spec coverage (P1 scope only):**
- §5.2 advisory columns + partial index → Task 1. ✅ ([OPEN 5.2a] resolved: columns now.)
- §5.4b `'vlm'` in `decided_via` now → Task 1. ✅
- §5.3 photo-appeal three checks (reason↔photo, context-aware re-judge, overturn justification) → Task 2 prompt + Task 3 evaluator. ✅
- §5.3 serial-appeal (barcode-first, VLM OCR fallback, scanned/expected compare) → Task 4. ✅
- §5.3 new appeal prompt builder, criteria untouched → Task 2. ✅ ([OPEN 5.3a] resolved: new builder.)
- §5.8 fail-open→uncertain (never silent approve) → `uncertain()` + Task 3 tests. ✅
- §5.9 unit tests (pass/deny/uncertain, reason-inconsistency surface, serial match/mismatch/illegible), no DGTS → Tasks 2–4. ✅
- Out of P1 scope by design: cron (P2), reviewer UI (P3), HITL loop (P4), go-live flag (P5), bench (P6) — not planned here.

**2. Placeholder scan:** No `TODO`/`TBD`. The one intentional stub (`evaluateSerialAppeal` in Task 3) is explicitly replaced in Task 4 with full code and called out in prose — not a hidden placeholder.

**3. Type consistency:** `AppealEvaluation` shape (`recommendation`/`confidence`/`reasoning`/`checks`/`serialRead`/`model`/`skipReason`) is identical across `uncertain()`, `evaluatePhotoAppeal`, `evaluateSerialAppeal`. `AppealSkipReason` union matches the migration's `vlm_skip_reason` comment values. `MODEL_TAG`/`APPEAL_PROMPT_VERSION` (`appeal-v1`) referenced consistently and asserted in tests. Builder returns `VlmContentPart[]`; service imports the same `VlmContentPart` type. `extractOntSerialEnhanced` return shape in the serial test matches the verified source signature.

## Open items to confirm with Hein before/at later phases (not blocking P1)
- How the Phase 2 cron derives `jobType` for a `sitecam_appeals` row (the table has `step_number`/`dr_number` but no `job_type`; serial appeals are activations, photo appeals need the DR's discipline). **This is a P2 concern** — the P1 service takes `jobType` explicitly.
- [OPEN 6a] target agreement rate + minimum sample size before trusting go-live.
- [OPEN 7a] cron interval + batch size (P2).

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-02-sitecam-appeals-vlm-phase1.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
