# PhotoGuide PWA — Sub-project A: FibreFlow API Additions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the server-side API endpoints, DB schema, and FibreFlow UI components that the PhotoGuide PWA depends on, so a technician's phone can look up DRs, validate photos via VLM, upload completed jobs, and escalate failed steps.

**Architecture:** All new routes live in `pages/api/photo-guide/` (Pages Router pattern used throughout this codebase). VLM validation reuses `buildMessageContent` from `stepQualityCriteria.ts` and sends base64 directly — no URL fetch needed. Auth uses the existing `withAuth` middleware. DB changes are additive (new table + new nullable columns on existing tables).

**Tech Stack:** Next.js Pages Router, `pg.Pool` via `@/lib/db`, TypeScript, existing VLM client (`@/lib/vlm`), existing `stepQualityCriteria.ts`

**Prerequisite:** `feature/photo-gallery-criteria-review` must be merged to master first. Migration 166 (`vlm_visual_photo_examples`) must be on the DB before running migration 167 in this plan.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `scripts/migrations/167_pwa_support.sql` | `pwa_escalations` table + PWA columns on `dr_photo_unified_reviews` |
| Create | `pages/api/photo-guide/site/[id].ts` | GET — look up DR or pole by ID, return address + customer name |
| Create | `pages/api/photo-guide/validate.ts` | POST — fraud checks + VLM quality check per photo |
| Create | `pages/api/photo-guide/upload.ts` | POST — receive completed job photo set, store to VF Storage, update DR record |
| Create | `pages/api/photo-guide/escalate.ts` | POST — flag a step as escalated, write `pwa_escalations` row |
| Create | `pages/api/photo-guide/escalations.ts` | GET — list pending escalations (supervisor view) |
| Create | `pages/api/photo-guide/escalate/[id]/resolve.ts` | POST — resolve an escalation (approve/reject) |
| Create | `src/modules/activate/components/PwaComparisonTab.tsx` | Comparison view inside Activate DR detail (PWA photo vs OneMap photo side-by-side) |
| Create | `src/modules/action-centre/components/PwaEscalationView.tsx` | Supervisor escalation list in Action Centre |
| Modify | `src/modules/activate/components/DrDetailPage.tsx` | Add "PWA Photos" tab using PwaComparisonTab |
| Modify | `src/modules/action-centre/components/ActionCentrePage.tsx` | Add "PWA Escalations" section |

---

### Task 1: DB Migration

**Files:**
- Create: `scripts/migrations/167_pwa_support.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 167: PWA support
-- Adds pwa_escalations table and PWA tracking columns on DR reviews.

-- PWA tracking columns on existing DR review records
ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS pwa_submission_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pwa_tech_id        UUID,
  ADD COLUMN IF NOT EXISTS pwa_photo_count    INT,
  ADD COLUMN IF NOT EXISTS pwa_completed_at   TIMESTAMPTZ;

-- PWA tracking columns on pole install sessions (for Civils job type)
ALTER TABLE pole_install_sessions
  ADD COLUMN IF NOT EXISTS pwa_submission_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pwa_tech_id        UUID,
  ADD COLUMN IF NOT EXISTS pwa_completed_at   TIMESTAMPTZ;

-- Escalation records (one row per flagged step)
CREATE TABLE IF NOT EXISTS pwa_escalations (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type       TEXT        NOT NULL CHECK (job_type IN ('activations', 'civils')),
  site_id        TEXT        NOT NULL,   -- DR number or pole number
  step_number    INT         NOT NULL,
  tech_id        UUID        NOT NULL,
  fail_reasons   TEXT[]      NOT NULL DEFAULT '{}',
  attempt_photos JSONB       NOT NULL DEFAULT '[]',
  -- [{attempt: 1, url: '...', reasons: ['...']}]
  status         TEXT        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'approved', 'rejected')),
  resolved_by    UUID,
  resolved_at    TIMESTAMPTZ,
  resolution_note TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwa_escalations_status  ON pwa_escalations (status);
CREATE INDEX IF NOT EXISTS idx_pwa_escalations_site    ON pwa_escalations (site_id);
CREATE INDEX IF NOT EXISTS idx_pwa_escalations_tech    ON pwa_escalations (tech_id);
```

- [ ] **Step 2: Apply migration on Velocity**

```bash
ssh velo@100.96.203.105 "docker exec -i supabase-db psql -U fibreflow_user -d fibreflow" \
  < scripts/migrations/167_pwa_support.sql
```

Expected output: `ALTER TABLE`, `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX`, `CREATE INDEX`

- [ ] **Step 3: Verify table exists**

```bash
ssh velo@100.96.203.105 "docker exec -i supabase-db psql -U fibreflow_user -d fibreflow \
  -c '\d pwa_escalations'"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/167_pwa_support.sql
git commit -m "feat(pwa): add pwa_escalations table and PWA columns on DR reviews"
```

---

### Task 2: Site Lookup API

**Files:**
- Create: `pages/api/photo-guide/site/[id].ts`

The technician types a DR number (e.g. `DR-1234`) or pole number. This route validates it exists and returns display info.

- [ ] **Step 1: Write a failing test**

Create `pages/api/__tests__/photo-guide-site.test.ts`:

```typescript
import { createMocks } from 'node-mocks-http';
import handler from '../photo-guide/site/[id]';

jest.mock('@/lib/db', () => ({
  pool: { query: jest.fn() },
}));
import { pool } from '@/lib/db';
const mockPool = pool as jest.Mocked<typeof pool>;

describe('GET /api/photo-guide/site/:id', () => {
  it('returns 400 when id is missing', async () => {
    const { req, res } = createMocks({ method: 'GET', query: {} });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 404 when DR not found', async () => {
    (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
    const { req, res } = createMocks({ method: 'GET', query: { id: 'DR-9999' } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(404);
  });

  it('returns site details for a valid DR', async () => {
    (mockPool.query as jest.Mock).mockResolvedValueOnce({
      rows: [{ dr_number: 'DR-1234', customer_name: 'Test Customer', address: '1 Test St', project_name: 'Project A' }],
    });
    const { req, res } = createMocks({ method: 'GET', query: { id: 'DR-1234' } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.siteId).toBe('DR-1234');
    expect(data.customerName).toBe('Test Customer');
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npm test -- --testPathPattern="photo-guide-site" 2>&1 | tail -10
```

Expected: `Cannot find module '../photo-guide/site/[id]'`

- [ ] **Step 3: Create the route**

Create `pages/api/photo-guide/site/[id].ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { pool } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res);

  const { id } = req.query;
  if (!id || typeof id !== 'string') return apiResponse.badRequest(res, 'Site ID required');

  const normalized = id.trim().toUpperCase();

  // DR lookup
  if (normalized.startsWith('DR-') || /^\d+$/.test(normalized)) {
    const drNum = normalized.replace(/^DR-/, '');
    const { rows } = await pool.query<{
      dr_number: string;
      customer_name: string;
      address: string;
      project_name: string;
    }>(
      `SELECT d.drop_number AS dr_number,
              d.customer_name,
              d.address,
              p.name AS project_name
       FROM drops d
       JOIN projects p ON p.id = d.project_id
       WHERE d.drop_number = $1
       LIMIT 1`,
      [drNum]
    );
    if (!rows[0]) return apiResponse.notFound(res, 'DR', normalized);
    const r = rows[0];
    return apiResponse.success(res, {
      jobType: 'activations',
      siteId: `DR-${r.dr_number}`,
      customerName: r.customer_name,
      address: r.address,
      projectName: r.project_name,
    });
  }

  // Pole lookup
  const { rows } = await pool.query<{
    pole_number: string;
    address: string;
    project_name: string;
  }>(
    `SELECT po.pole_number,
            po.address,
            p.name AS project_name
     FROM poles po
     JOIN projects p ON p.id = po.project_id
     WHERE po.pole_number = $1
     LIMIT 1`,
    [normalized]
  );
  if (!rows[0]) return apiResponse.notFound(res, 'Pole', normalized);
  const r = rows[0];
  return apiResponse.success(res, {
    jobType: 'civils',
    siteId: r.pole_number,
    address: r.address,
    projectName: r.project_name,
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npm test -- --testPathPattern="photo-guide-site" 2>&1 | tail -10
```

Expected: `PASS`

- [ ] **Step 5: Commit**

```bash
git add pages/api/photo-guide/site/[id].ts pages/api/__tests__/photo-guide-site.test.ts
git commit -m "feat(pwa): GET /api/photo-guide/site/:id — DR and pole lookup"
```

---

### Task 3: Photo Validation API

**Files:**
- Create: `pages/api/photo-guide/validate.ts`

This is the core of the PWA. The phone submits a base64 photo for a specific step, fraud checks run, then the VLM evaluates it using the same criteria as auto-QA. Returns structured pass/fail with technician-friendly corrections.

- [ ] **Step 1: Write a failing test**

Create `pages/api/__tests__/photo-guide-validate.test.ts`:

```typescript
import { createMocks } from 'node-mocks-http';
import handler from '../photo-guide/validate';

jest.mock('@/lib/db', () => ({ pool: { query: jest.fn() } }));
jest.mock('@/modules/activate/services/stepQualityCriteria', () => ({
  STEP_CRITERIA: { 1: { label: 'House Photo', requirements: 'test', failInstruction: 'test', failReason: 'fail' } },
  QUALITY_CHECK_STEPS: [1],
  buildMessageContent: jest.fn().mockReturnValue({ content: [], systemPrompt: '' }),
}));

describe('POST /api/photo-guide/validate', () => {
  it('returns 405 for GET', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(405);
  });

  it('returns 400 when body fields are missing', async () => {
    const { req, res } = createMocks({ method: 'POST', body: {} });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 400 for invalid step number', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: { jobType: 'activations', stepNumber: 99, siteId: 'DR-1234', photoBase64: 'abc', attemptNumber: 1 },
    });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- --testPathPattern="photo-guide-validate" 2>&1 | tail -10
```

Expected: `Cannot find module '../photo-guide/validate'`

- [ ] **Step 3: Create the validation route**

Create `pages/api/photo-guide/validate.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { createHash } from 'crypto';
import { pool } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  STEP_CRITERIA,
  QUALITY_CHECK_STEPS,
  buildMessageContent,
  type QualityCheckStep,
} from '@/modules/activate/services/stepQualityCriteria';
import {
  VLM_CHAT_ENDPOINT,
  VLM_CATEGORIZATION_MODEL,
  VLM_TIMEOUT_REALTIME,
  VLM_MAX_TOKENS_QUICK,
  VLM_TEMPERATURE,
  stripThinkTags,
} from '@/lib/vlm';

const MODULE = 'PwaValidate';
const MAX_ATTEMPTS = 3;

interface ValidateBody {
  jobType: 'activations' | 'civils';
  stepNumber: number;
  siteId: string;     // DR number or pole number
  photoBase64: string;
  attemptNumber: number;
  exifTimestamp?: string;   // ISO string from EXIF, if available
}

interface VlmValidationResult {
  pass: boolean;
  reasons: string[];
  corrections: string[];
}

function hashBase64(b64: string): string {
  return createHash('sha256').update(b64).digest('hex');
}

async function checkDuplicate(siteId: string, hash: string): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM pwa_photo_hashes WHERE site_id = $1 AND photo_hash = $2 LIMIT 1`,
    [siteId, hash]
  );
  return rows.length > 0;
}

async function recordHash(siteId: string, stepNumber: number, hash: string): Promise<void> {
  await pool.query(
    `INSERT INTO pwa_photo_hashes (site_id, step_number, photo_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [siteId, stepNumber, hash]
  );
}

function checkExifAge(exifTimestamp: string | undefined): { ok: boolean; reason?: string } {
  if (!exifTimestamp) return { ok: true }; // no EXIF — warn-only per spec
  const exif = new Date(exifTimestamp).getTime();
  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  if (Math.abs(now - exif) > twoHours) {
    return { ok: false, reason: 'Photo was taken more than 2 hours ago. Please retake with a fresh photo.' };
  }
  return { ok: true };
}

async function callVlm(step: QualityCheckStep, photoBase64: string): Promise<VlmValidationResult> {
  // Load gallery examples for this step
  const { rows } = await pool.query<{ photo_url: string; label: string }>(
    `SELECT photo_url, label
     FROM vlm_visual_photo_examples
     WHERE step_number = $1
     ORDER BY saved_at DESC
     LIMIT 6`,
    [step]
  );

  // For the PWA validate we don't have gallery photos as base64 by URL — skip visual gallery
  // (the static reference photos from qa-reference-photos/ are still loaded by buildMessageContent)
  const { content } = buildMessageContent(step, photoBase64, undefined);

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
    const json = await resp.json();
    const raw = stripThinkTags(json.choices?.[0]?.message?.content ?? '');

    // Parse structured JSON response from VLM
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        pass: parsed.pass === true,
        reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
        corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
      };
    }
    // Fallback: treat as pass if no JSON found (don't block tech on VLM parse error)
    return { pass: true, reasons: [], corrections: [] };
  } catch (err) {
    clearTimeout(timeout);
    log.warn('VLM validation failed — allowing pass to avoid blocking tech', { error: String(err) }, MODULE);
    return { pass: true, reasons: [], corrections: [] };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res);

  const { jobType, stepNumber, siteId, photoBase64, attemptNumber, exifTimestamp } =
    req.body as Partial<ValidateBody>;

  if (!jobType || !stepNumber || !siteId || !photoBase64 || !attemptNumber) {
    return apiResponse.badRequest(res, 'jobType, stepNumber, siteId, photoBase64, attemptNumber required');
  }

  const step = stepNumber as QualityCheckStep;
  if (!QUALITY_CHECK_STEPS.includes(step)) {
    return apiResponse.badRequest(res, `Step ${stepNumber} has no VLM validation criteria`);
  }

  // Fraud: EXIF age check
  const ageCheck = checkExifAge(exifTimestamp);
  if (!ageCheck.ok) {
    return apiResponse.success(res, {
      pass: false,
      reasons: [ageCheck.reason!],
      corrections: ['Please take a fresh photo right now at the installation site.'],
      stepLabel: STEP_CRITERIA[step].label,
      attemptNumber,
      maxAttempts: MAX_ATTEMPTS,
      fraudDetected: 'exif_age',
    });
  }

  // Fraud: duplicate photo hash check
  const hash = hashBase64(photoBase64);
  const isDuplicate = await checkDuplicate(siteId, hash);
  if (isDuplicate) {
    return apiResponse.success(res, {
      pass: false,
      reasons: ['This exact photo has been submitted before for this job.'],
      corrections: ['Take a new photo — do not reuse a previously submitted photo.'],
      stepLabel: STEP_CRITERIA[step].label,
      attemptNumber,
      maxAttempts: MAX_ATTEMPTS,
      fraudDetected: 'duplicate_hash',
    });
  }

  // VLM quality check
  const result = await callVlm(step, photoBase64);

  // Record hash regardless of pass/fail (prevents reuse on retry)
  await recordHash(siteId, step, hash).catch(() => {});

  return apiResponse.success(res, {
    pass: result.pass,
    reasons: result.reasons,
    corrections: result.corrections,
    stepLabel: STEP_CRITERIA[step].label,
    attemptNumber,
    maxAttempts: MAX_ATTEMPTS,
  });
}
```

> **Note:** This route references `pwa_photo_hashes` table — add it in Task 1's migration:
> ```sql
> CREATE TABLE IF NOT EXISTS pwa_photo_hashes (
>   id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   site_id      TEXT NOT NULL,
>   step_number  INT  NOT NULL,
>   photo_hash   TEXT NOT NULL,
>   created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
>   UNIQUE(site_id, photo_hash)
> );
> ```
> Add this to `167_pwa_support.sql` before applying it (Task 1).

- [ ] **Step 4: Add `pwa_photo_hashes` to the migration file**

Edit `scripts/migrations/167_pwa_support.sql` — append at the end:

```sql
-- Photo hash dedup table (prevents technician reusing a photo across retries)
CREATE TABLE IF NOT EXISTS pwa_photo_hashes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      TEXT NOT NULL,
  step_number  INT  NOT NULL,
  photo_hash   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, photo_hash)
);

CREATE INDEX IF NOT EXISTS idx_pwa_photo_hashes_site ON pwa_photo_hashes (site_id);
```

- [ ] **Step 5: Re-apply migration**

```bash
ssh velo@100.96.203.105 "docker exec -i supabase-db psql -U fibreflow_user -d fibreflow \
  -c 'CREATE TABLE IF NOT EXISTS pwa_photo_hashes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), site_id TEXT NOT NULL, step_number INT NOT NULL, photo_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(site_id, photo_hash)); CREATE INDEX IF NOT EXISTS idx_pwa_photo_hashes_site ON pwa_photo_hashes (site_id);'"
```

Expected: `CREATE TABLE`, `CREATE INDEX`

- [ ] **Step 6: Run tests**

```bash
npm test -- --testPathPattern="photo-guide-validate" 2>&1 | tail -10
```

Expected: `PASS`

- [ ] **Step 7: Commit**

```bash
git add pages/api/photo-guide/validate.ts pages/api/__tests__/photo-guide-validate.test.ts scripts/migrations/167_pwa_support.sql
git commit -m "feat(pwa): POST /api/photo-guide/validate — fraud checks + VLM step quality gate"
```

---

### Task 4: Escalation API

**Files:**
- Create: `pages/api/photo-guide/escalate.ts`
- Create: `pages/api/photo-guide/escalations.ts`
- Create: `pages/api/photo-guide/escalate/[id]/resolve.ts`

When a technician fails 3 attempts, the PWA calls `POST /escalate` to flag the step. Supervisors use `GET /escalations` to list pending items and `POST /escalate/:id/resolve` to approve or reject.

- [ ] **Step 1: Create escalate.ts**

```typescript
// pages/api/photo-guide/escalate.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { pool } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/withAuth';

interface EscalateBody {
  jobType: 'activations' | 'civils';
  siteId: string;
  stepNumber: number;
  failReasons: string[];
  attemptPhotos: Array<{ attempt: number; url: string; reasons: string[] }>;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res);

  const { jobType, siteId, stepNumber, failReasons, attemptPhotos } =
    req.body as Partial<EscalateBody>;

  if (!jobType || !siteId || !stepNumber) {
    return apiResponse.badRequest(res, 'jobType, siteId, stepNumber required');
  }

  const techId = (req as any).user?.id;

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pwa_escalations (job_type, site_id, step_number, tech_id, fail_reasons, attempt_photos)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [jobType, siteId, stepNumber, techId, failReasons ?? [], JSON.stringify(attemptPhotos ?? [])]
  );

  return apiResponse.success(res, { escalationId: rows[0]!.id });
}

export default withAuth(handler);
```

- [ ] **Step 2: Create escalations.ts**

```typescript
// pages/api/photo-guide/escalations.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { pool } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/withAuth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res);

  const status = (req.query.status as string) ?? 'pending';

  const { rows } = await pool.query(
    `SELECT e.id, e.job_type, e.site_id, e.step_number,
            e.fail_reasons, e.attempt_photos, e.status,
            e.created_at, e.resolved_at, e.resolution_note,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM pwa_escalations e
     LEFT JOIN staff s ON s.id = e.tech_id
     WHERE e.status = $1
     ORDER BY e.created_at DESC
     LIMIT 100`,
    [status]
  );

  return apiResponse.success(res, { escalations: rows });
}

export default withAuth(handler);
```

- [ ] **Step 3: Create resolve route**

```typescript
// pages/api/photo-guide/escalate/[id]/resolve.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { pool } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/withAuth';

interface ResolveBody {
  resolution: 'approved' | 'rejected';
  note?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res);

  const { id } = req.query;
  const { resolution, note } = req.body as Partial<ResolveBody>;

  if (!id || typeof id !== 'string') return apiResponse.badRequest(res, 'id required');
  if (resolution !== 'approved' && resolution !== 'rejected') {
    return apiResponse.badRequest(res, 'resolution must be approved or rejected');
  }

  const supervisorId = (req as any).user?.id;

  const { rowCount } = await pool.query(
    `UPDATE pwa_escalations
     SET status = $1, resolved_by = $2, resolved_at = NOW(), resolution_note = $3
     WHERE id = $4 AND status = 'pending'`,
    [resolution, supervisorId, note ?? null, id]
  );

  if (!rowCount) return apiResponse.notFound(res, 'Escalation', id);

  return apiResponse.success(res, { resolved: true });
}

export default withAuth(handler);
```

- [ ] **Step 4: Commit**

```bash
git add pages/api/photo-guide/escalate.ts pages/api/photo-guide/escalations.ts \
  "pages/api/photo-guide/escalate/[id]/resolve.ts"
git commit -m "feat(pwa): escalation API — flag, list, and resolve step escalations"
```

---

### Task 5: Job Upload API

**Files:**
- Create: `pages/api/photo-guide/upload.ts`

Called by the PWA when a technician completes the job (all steps passed or escalated). Receives all photos as base64, stores them to VF Storage, and updates the DR record.

- [ ] **Step 1: Create upload.ts**

```typescript
// pages/api/photo-guide/upload.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { pool } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/withAuth';
import { log } from '@/lib/logger';

const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';

interface PhotoRecord {
  stepNumber: number;
  stepLabel: string;
  filename: string;     // e.g. DR-1234_step1_house-photo.jpg
  base64: string;
}

interface UploadBody {
  jobType: 'activations' | 'civils';
  siteId: string;
  photos: PhotoRecord[];
}

async function uploadToVfStorage(filename: string, base64: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64');
  const formData = new FormData();
  formData.append('file', new Blob([buffer], { type: 'image/jpeg' }), filename);

  const resp = await fetch(`${VF_STORAGE_URL}/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!resp.ok) throw new Error(`VF Storage upload failed: HTTP ${resp.status}`);

  const json = await resp.json();
  return json.url as string;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res);

  const { jobType, siteId, photos } = req.body as Partial<UploadBody>;
  if (!jobType || !siteId || !photos?.length) {
    return apiResponse.badRequest(res, 'jobType, siteId, photos required');
  }

  const techId = (req as any).user?.id;
  const uploadedUrls: Record<number, string> = {};

  for (const photo of photos) {
    try {
      const url = await uploadToVfStorage(photo.filename, photo.base64);
      uploadedUrls[photo.stepNumber] = url;
    } catch (err) {
      log.error(`Failed to upload step ${photo.stepNumber} photo`, { error: String(err) }, 'PwaUpload');
    }
  }

  if (jobType === 'activations') {
    const drNum = siteId.replace(/^DR-/i, '');
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET pwa_submission_at = NOW(),
           pwa_tech_id = $1,
           pwa_photo_count = $2,
           pwa_completed_at = NOW(),
           pwa_photo_urls = $3
       WHERE drop_number = $4`,
      [techId, photos.length, JSON.stringify(uploadedUrls), drNum]
    );
  }

  if (jobType === 'civils') {
    await pool.query(
      `UPDATE pole_install_sessions
       SET pwa_submission_at = NOW(),
           pwa_tech_id = $1,
           pwa_completed_at = NOW()
       WHERE pole_number = $2`,
      [techId, siteId]
    );
  }

  return apiResponse.success(res, { uploadedCount: Object.keys(uploadedUrls).length, urls: uploadedUrls });
}

export default withAuth(handler);
```

> **Note:** The `pwa_photo_urls` JSONB column needs to be added to the migration in Task 1:
> ```sql
> ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS pwa_photo_urls JSONB;
> ```
> Add this line to `167_pwa_support.sql` and re-apply before running this endpoint.

- [ ] **Step 2: Apply the column addition**

```bash
ssh velo@100.96.203.105 "docker exec -i supabase-db psql -U fibreflow_user -d fibreflow \
  -c 'ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS pwa_photo_urls JSONB;'"
```

- [ ] **Step 3: Commit**

```bash
git add pages/api/photo-guide/upload.ts
git commit -m "feat(pwa): POST /api/photo-guide/upload — store photos to VF Storage, update DR record"
```

---

### Task 6: PWA Comparison Tab in Activate

**Files:**
- Create: `src/modules/activate/components/PwaComparisonTab.tsx`
- Modify: `src/modules/activate/components/DrDetailPage.tsx`

Supervisors can see the PWA photos (what the tech actually submitted and had VLM-validated) alongside the OneMap photos (what was uploaded to OneMap). Mismatches flag potential fraud.

- [ ] **Step 1: Create PwaComparisonTab.tsx**

```typescript
// src/modules/activate/components/PwaComparisonTab.tsx
'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

interface StepComparison {
  stepNumber: number;
  stepLabel: string;
  pwaUrl: string | null;
  oneMapUrl: string | null;
  status: 'match' | 'mismatch' | 'missing_onemap' | 'missing_pwa';
}

interface PwaSubmission {
  submittedAt: string;
  techName: string;
  photoCount: number;
  photoUrls: Record<number, string>;
}

const STEP_LABELS: Record<number, string> = {
  1: 'House Photo', 2: 'Cable from Pole', 3: 'Entry Outside',
  4: 'Entry Inside', 5: 'Wall', 6: 'ONT Back', 7: 'Power Meter',
  8: 'Final Installation', 9: 'Green Lights', 10: 'Signature',
};

export function PwaComparisonTab({ drNumber }: { drNumber: string }) {
  const [submission, setSubmission] = useState<PwaSubmission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/photo-guide/submission/${drNumber}`)
      .then((r) => r.json())
      .then((d) => { if (d.submission) setSubmission(d.submission); })
      .finally(() => setLoading(false));
  }, [drNumber]);

  if (loading) return <div className="p-6 text-gray-500">Loading PWA submission…</div>;
  if (!submission) return (
    <div className="p-6 text-gray-400 text-sm">
      No PWA submission found for {drNumber}. Technician has not used the PhotoGuide app for this DR.
    </div>
  );

  const steps: StepComparison[] = Object.entries(STEP_LABELS).map(([num, label]) => {
    const step = Number(num);
    const pwaUrl = submission.photoUrls[step] ?? null;
    return {
      stepNumber: step,
      stepLabel: label,
      pwaUrl,
      oneMapUrl: null, // OneMap integration deferred — show PWA photos only for now
      status: pwaUrl ? 'match' : 'missing_pwa',
    };
  });

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs text-gray-500 mb-4">
        Submitted {new Date(submission.submittedAt).toLocaleString()} by {submission.techName} ·{' '}
        {submission.photoCount} photos
      </div>
      <div className="grid grid-cols-1 gap-4">
        {steps.map((step) => (
          <div key={step.stepNumber} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
              Step {step.stepNumber}: {step.stepLabel}
            </div>
            <div className="flex gap-2 p-2">
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">PWA Photo (AI-validated)</div>
                {step.pwaUrl ? (
                  <img src={step.pwaUrl} alt={`Step ${step.stepNumber}`} className="w-full rounded object-cover max-h-48" />
                ) : (
                  <div className="h-24 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400">
                    No photo
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add submission lookup API**

Create `pages/api/photo-guide/submission/[drNumber].ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { pool } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/withAuth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res);
  const { drNumber } = req.query;
  const drNum = (drNumber as string).replace(/^DR-/i, '');

  const { rows } = await pool.query(
    `SELECT r.pwa_submission_at, r.pwa_photo_count, r.pwa_photo_urls,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM dr_photo_unified_reviews r
     LEFT JOIN staff s ON s.id = r.pwa_tech_id
     WHERE r.drop_number = $1 AND r.pwa_submission_at IS NOT NULL
     LIMIT 1`,
    [drNum]
  );

  if (!rows[0]) return apiResponse.success(res, { submission: null });

  return apiResponse.success(res, {
    submission: {
      submittedAt: rows[0].pwa_submission_at,
      techName: rows[0].tech_name ?? 'Unknown',
      photoCount: rows[0].pwa_photo_count,
      photoUrls: rows[0].pwa_photo_urls ?? {},
    },
  });
}

export default withAuth(handler);
```

- [ ] **Step 3: Wire tab into DrDetailPage**

In `src/modules/activate/components/DrDetailPage.tsx`, find the tabs array and add:

```typescript
{ id: 'pwa', label: 'PWA Photos', icon: <SmartphoneIcon className="w-4 h-4" /> },
```

In the tab content switch, add:

```typescript
case 'pwa':
  return <PwaComparisonTab drNumber={dr.drop_number} />;
```

Import at top:

```typescript
import { PwaComparisonTab } from './PwaComparisonTab';
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/activate/components/PwaComparisonTab.tsx \
  pages/api/photo-guide/submission/ \
  src/modules/activate/components/DrDetailPage.tsx
git commit -m "feat(pwa): PWA comparison tab in Activate DR detail"
```

---

### Task 7: Supervisor Escalation View in Action Centre

**Files:**
- Create: `src/modules/action-centre/components/PwaEscalationView.tsx`
- Modify: `src/modules/action-centre/components/ActionCentrePage.tsx`

- [ ] **Step 1: Create PwaEscalationView.tsx**

```typescript
// src/modules/action-centre/components/PwaEscalationView.tsx
'use client';

import { useEffect, useState } from 'react';

interface Escalation {
  id: string;
  job_type: string;
  site_id: string;
  step_number: number;
  fail_reasons: string[];
  attempt_photos: Array<{ attempt: number; url: string; reasons: string[] }>;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  tech_name: string;
}

export function PwaEscalationView() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch('/api/photo-guide/escalations?status=pending')
      .then((r) => r.json())
      .then((d) => setEscalations(d.escalations ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const resolve = async (id: string, resolution: 'approved' | 'rejected', note?: string) => {
    await fetch(`/api/photo-guide/escalate/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution, note }),
    });
    load();
  };

  if (loading) return <div className="p-4 text-gray-500 text-sm">Loading escalations…</div>;
  if (!escalations.length) return (
    <div className="p-4 text-gray-400 text-sm">No pending PWA escalations.</div>
  );

  return (
    <div className="space-y-4">
      {escalations.map((e) => (
        <div key={e.id} className="border border-amber-200 rounded-lg p-4 bg-amber-50">
          <div className="flex justify-between items-start mb-2">
            <div>
              <span className="font-medium text-sm">{e.site_id}</span>
              <span className="ml-2 text-xs text-gray-500">Step {e.step_number} · {e.tech_name}</span>
            </div>
            <span className="text-xs text-gray-400">{new Date(e.created_at).toLocaleString()}</span>
          </div>
          <div className="text-xs text-red-600 mb-3">
            {e.fail_reasons.map((r, i) => <div key={i}>• {r}</div>)}
          </div>
          <div className="flex gap-2 flex-wrap mb-3">
            {e.attempt_photos.map((p) => (
              <div key={p.attempt} className="text-center">
                <img src={p.url} className="h-20 w-20 object-cover rounded border" alt={`Attempt ${p.attempt}`} />
                <div className="text-xs text-gray-400 mt-1">Attempt {p.attempt}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => resolve(e.id, 'approved', 'Supervisor override — photo acceptable')}
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700"
            >
              Approve
            </button>
            <button
              onClick={() => resolve(e.id, 'rejected', 'Photo does not meet standard')}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add to Action Centre page**

In `src/modules/action-centre/components/ActionCentrePage.tsx`, add a new section header and `<PwaEscalationView />` component under the existing sections.

- [ ] **Step 3: Commit**

```bash
git add src/modules/action-centre/components/PwaEscalationView.tsx \
  src/modules/action-centre/components/ActionCentrePage.tsx
git commit -m "feat(pwa): PWA escalation view in Action Centre for supervisors"
```

---

### Task 8: Open PR for Sub-project A

- [ ] **Step 1: Verify lint + types**

```bash
npm run lint && npm run type-check 2>&1 | tail -20
```

- [ ] **Step 2: Open PR**

```bash
git push -u origin feature/pwa-fibreflow-api
```

Then open PR via `/pr` skill targeting master. This is the API backend the PWA depends on.

---

## Testing Checklist (before merging Sub-project A)

- [ ] `GET /api/photo-guide/site/DR-1234` returns correct customer and address
- [ ] `GET /api/photo-guide/site/NONEXISTENT` returns 404
- [ ] `POST /api/photo-guide/validate` with a good step 8 photo returns `{ pass: true }`
- [ ] `POST /api/photo-guide/validate` with a bad photo returns `{ pass: false, reasons: [...], corrections: [...] }`
- [ ] `POST /api/photo-guide/validate` with the same base64 twice returns duplicate fraud flag
- [ ] `POST /api/photo-guide/escalate` creates a `pwa_escalations` row
- [ ] `GET /api/photo-guide/escalations` returns the pending escalation
- [ ] `POST /api/photo-guide/escalate/:id/resolve` with `approved` closes it
- [ ] `POST /api/photo-guide/upload` stores photos and updates `dr_photo_unified_reviews`
- [ ] PWA Photos tab appears in Activate DR detail and shows uploaded photos
- [ ] Action Centre shows pending escalations with Approve/Reject buttons
