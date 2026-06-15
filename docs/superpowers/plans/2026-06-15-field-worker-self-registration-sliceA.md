# Field Worker Self-Registration — Slice A (Intake + Capture) Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** A worker self-registers on `/my`, sets a PIN via WhatsApp OTP, clocks in immediately, and is stock-capped at R5k until an admin approves them — built ON the existing `account_status` lifecycle.

**Architecture:** Self-registered worker = a `staff` row created by a new PUBLIC `POST /api/my/register`, mirroring the existing `/api/my/stores/technicians` INSERT but with `source='self_registered'`, `role` ∈ {technician, casual}, `account_status='pending'`, `status='active'`, plus captured `declared_project_id`, `id_number`, `selfie_url`. Approval reuses the existing `/api/field/users/approve.ts` (`pending→active`). Stock cap and hours already work off `account_status`/`staff.id`. NO `status='provisional'` (the discarded v1 mistake).

**Tech stack:** Next.js Pages Router, TS, `sql` from `@/lib/db-pool`, Vitest 0.34, VF Storage, sharp, bcrypt OTP, dark `/my` portal.

**Spec:** `docs/superpowers/specs/2026-06-15-field-worker-self-registration-v2-design.md`

**Out of scope (Slice B):** the ~19-surface HR-hiding (G2). Slice A creates the rows; Slice B hides them from HR. In between, self-registered workers ARE visible in staff lists — acceptable for an internal interim since the rows are real pending field workers.

---

## File Structure
- Create: `scripts/migrations/sql/<next>_field_worker_self_registration.sql` (+ rollback)
- Modify: `src/lib/schemas/domains/staff.ts` OR wherever `StaffRole`/`STAFF_ROLES` live (the spec found them in `src/modules/attendance/portal/types.ts`) — add `'casual'`
- Create: `src/modules/attendance/portal/registrationUtils.ts` (createSelfRegisteredFieldWorker, storeRegistrationSelfie)
- Create: `pages/api/my/register-sites.ts` (public site picker)
- Create: `pages/api/my/register.ts` (public intake)
- Create: `pages/my/register.tsx` (intake page)
- Modify: `src/modules/attendance/portal/client/api.ts` (registerFieldWorker, getRegisterSites; ensure AttendanceProfile has accountStatus)
- Modify: `src/modules/attendance/portal/client/MyLoginScreen.tsx` (Register link)
- Modify: `src/modules/attendance/portal/client/MyHub.tsx` (pending gate)
- Tests alongside each endpoint/util.

---

## Task A1: Migration — capture columns + casual role

**Files:** `scripts/migrations/sql/<next>_field_worker_self_registration.sql` (+ `rollback_<next>_...`).

- [ ] **Step 1: Find the next free version.** Run `cd /home/hein/Workspace/FF_Next.js-field-worker-selfreg && ls scripts/migrations/sql/ | grep -oE '^[0-9]{3}' | sort -n | tail -1`. Use MAX+1 (expected 420 — confirm it's free; if a `420_*` exists, use the next free number). Use that number `NNN` in both filenames and the header comment.

- [ ] **Step 2: Write the migration** `scripts/migrations/sql/NNN_field_worker_self_registration.sql`:

```sql
-- Migration NNN: self-registration capture columns + 'casual' role
--
-- Builds on migration 346 (staff.role, staff.account_status). Adds the fields a
-- self-registered field worker captures at sign-up, and extends the role CHECK
-- to allow 'casual'. A self-registered worker is a normal staff row with
-- account_status='pending' (existing lifecycle) — NO new status value.
--
-- Idempotent: safe to re-run.

ALTER TABLE staff
  ADD COLUMN IF NOT EXISTS source              varchar(32) NOT NULL DEFAULT 'hr',
  ADD COLUMN IF NOT EXISTS declared_project_id uuid,
  ADD COLUMN IF NOT EXISTS id_number           varchar(32),
  ADD COLUMN IF NOT EXISTS selfie_url          text;

COMMENT ON COLUMN staff.source IS
  'Origin of the row: ''hr'' (default), ''self_registered'' (/my/register), or '
  '''stores'' (storeman-added technician). Drives HR-hiding (Slice B).';

-- Allow role='casual' alongside the existing field roles (migration 346 set the
-- original CHECK). Drop + re-add; named constraint is idempotent via IF EXISTS.
ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IS NULL OR role IN ('technician','casual','stores','supervisor','admin','driver','office'));
```

> Before writing, confirm the real constraint name: `cd /home/hein/Workspace/FF_Next.js-field-worker-selfreg && grep -rn "role_check\|role IN" scripts/migrations/sql/346_staff_role_account_status.sql`. Migration 346 used `ADD COLUMN ... CHECK (...)` inline, which Postgres auto-names `staff_role_check`. If the auto-name differs, use the real name in DROP CONSTRAINT. (Verify with `\d staff` at apply time.)

- [ ] **Step 3: Write the rollback** `scripts/migrations/sql/rollback_NNN_field_worker_self_registration.sql`:

```sql
-- Rollback for migration NNN.
-- Restores the 346-era role CHECK (without 'casual') and drops the capture columns.
-- Safe only when no role='casual' rows exist (the re-added CHECK would reject them).

ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_role_check;
ALTER TABLE staff ADD CONSTRAINT staff_role_check
  CHECK (role IS NULL OR role IN ('technician','stores','supervisor','admin','driver','office'));

ALTER TABLE staff
  DROP COLUMN IF EXISTS selfie_url,
  DROP COLUMN IF EXISTS id_number,
  DROP COLUMN IF EXISTS declared_project_id,
  DROP COLUMN IF EXISTS source;
```

- [ ] **Step 4: Do NOT apply.** Applying to the shared DB is a controller/Hein checkpoint. Unit tests mock `sql`. Confirm files exist.

- [ ] **Step 5: Commit** (`cd … && git add scripts/migrations/sql/NNN_field_worker_self_registration.sql scripts/migrations/sql/rollback_NNN_field_worker_self_registration.sql && git commit -m "feat(staff): migration NNN — self-registration capture columns + casual role"`).

---

## Task A2: Add `'casual'` to StaffRole

**Files:** the file defining `StaffRole` + `STAFF_ROLES` (spec found them in `src/modules/attendance/portal/types.ts`; verify with `grep -rn "STAFF_ROLES\|type StaffRole" src/modules/attendance/portal/types.ts src/lib`).
**Test:** none (type-only) — verified via `tsc`.

- [ ] **Step 1:** In the file with `StaffRole`, add `'casual'`:
  - `export type StaffRole = 'technician' | 'casual' | 'stores' | 'supervisor' | 'admin' | 'driver' | 'office';`
  - `export const STAFF_ROLES: readonly StaffRole[] = ['technician', 'casual', 'stores', 'supervisor', 'admin', 'driver', 'office'];`
  Match the existing exact ordering/style; only insert `'casual'`.

- [ ] **Step 2:** `npx tsc --noEmit` — confirm no new errors from the union change (any exhaustive `switch (role)` will surface; handle 'casual' like 'technician' there).

- [ ] **Step 3: Commit** (`… && git add <file> && git commit -m "feat(staff): add 'casual' to StaffRole"`).

---

## Task A3: registrationUtils — create self-registered worker + selfie

**Files:** Create `src/modules/attendance/portal/registrationUtils.ts`; Test `src/modules/attendance/portal/__tests__/registrationUtils.test.ts`.

Reuse the existing dedup helper `findExistingStaffForRegistration(phone, firstName, lastName)` from `@/services/staff/staffPhoneDedup` (do NOT reimplement phone matching). Mirror the INSERT in `pages/api/my/stores/technicians.ts` (read it first), adding the new columns.

- [ ] **Step 1: Failing test** `registrationUtils.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import { createSelfRegisteredFieldWorker } from '../registrationUtils';

beforeEach(() => { vi.clearAllMocks(); });

describe('createSelfRegisteredFieldWorker', () => {
  it('inserts a pending self_registered worker and returns the id', async () => {
    mocks.sql.mockResolvedValue([{ id: 'fw-1' }]);
    const id = await createSelfRegisteredFieldWorker({
      firstName: 'Thabo', lastName: 'M', phone: '+27821234567',
      role: 'technician', declaredProjectId: 'p1', idNumber: '9001015800087',
      selfieUrl: '/storage/registrations/x/selfie.jpg',
    });
    expect(id).toBe('fw-1');
    expect(mocks.sql).toHaveBeenCalledTimes(1);
  });
  it('throws if insert returns no id', async () => {
    mocks.sql.mockResolvedValue([]);
    await expect(createSelfRegisteredFieldWorker({
      firstName: 'A', lastName: 'B', phone: '+27820000000', role: 'casual',
      declaredProjectId: 'p1', idNumber: null, selfieUrl: null,
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 2:** Run it — FAIL (module missing).

- [ ] **Step 3: Implement** `src/modules/attendance/portal/registrationUtils.ts`:

```ts
/**
 * /my self-registration helpers (Slice A). A self-registered field worker is a
 * normal staff row with account_status='pending' (existing lifecycle) and
 * source='self_registered'. Mirrors the INSERT in pages/api/my/stores/technicians.ts,
 * adding the captured columns. Dedup is delegated to staffPhoneDedup.
 */
import sharp from 'sharp';

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { VFStorageService } from '@/services/vfStorageAdapter';

export interface SelfRegisteredWorkerInput {
  firstName: string;
  lastName: string;
  phone: string;                 // normalised, e.g. local '08…' or '+27…' as the stores route stores it
  role: 'technician' | 'casual';
  declaredProjectId: string;
  idNumber: string | null;
  selfieUrl: string | null;
}

/** INSERT a pending, self-registered field worker. Returns the new staff id. */
export async function createSelfRegisteredFieldWorker(input: SelfRegisteredWorkerInput): Promise<string> {
  const prefix = input.role === 'casual' ? 'CASL' : 'TECH';
  const employeeId = `${prefix}-${String(Date.now()).slice(-8)}`;
  const resolvedEmail = `${input.phone}@phone.local`;
  const department = input.role === 'casual' ? 'Field (casual)' : 'Field Operations';
  const position = input.role === 'casual' ? 'Casual' : 'Technician';

  const rows = await sql<{ id: string }>`
    INSERT INTO staff (
      employee_id, first_name, last_name, email, phone, status,
      department, position, contract_type,
      role, account_status, source,
      declared_project_id, id_number, selfie_url
    ) VALUES (
      ${employeeId}, ${input.firstName.trim()}, ${input.lastName.trim()},
      ${resolvedEmail}, ${input.phone}, 'active',
      ${department}, ${position}, 'contractor',
      ${input.role}, 'pending', 'self_registered',
      ${input.declaredProjectId}, ${input.idNumber}, ${input.selfieUrl}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error('createSelfRegisteredFieldWorker: insert returned no id');
  return id;
}

/**
 * Resize a base64 selfie and upload to VF Storage at registrations/<staffId>/selfie.jpg.
 * Returns the relative /storage/... URL. `base64` may be bare or a data URL.
 */
export async function storeRegistrationSelfie(params: { base64: string; staffId: string }): Promise<string> {
  const commaIdx = params.base64.indexOf(',');
  const raw = commaIdx >= 0 ? params.base64.slice(commaIdx + 1) : params.base64;
  const input = Buffer.from(raw, 'base64');
  if (input.length === 0) throw new Error('storeRegistrationSelfie: empty selfie buffer');
  const resized = await sharp(input)
    .rotate()
    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer();
  const storage = new VFStorageService();
  const result = await storage.uploadFile(resized, 'registrations', params.staffId, 'selfie.jpg');
  if (!result.success) throw new Error('VF Storage upload reported non-success for registration selfie');
  log.info('[my-register] selfie stored', { staffId: params.staffId, size: result.size });
  return result.url;
}
```

> Read `pages/api/my/stores/technicians.ts` first and match its INSERT column list/types exactly (status='active', contract_type='contractor', synthetic email). Confirm `VFStorageService.uploadFile(file,type,category,fileName)` → `{success,url,size}` in `src/services/vfStorageAdapter.ts`.

- [ ] **Step 4:** Run the test — PASS (2). (Selfie fn not unit-tested — integration; do not add a brittle sharp mock.)

- [ ] **Step 5: Commit** (`… && git add src/modules/attendance/portal/registrationUtils.ts src/modules/attendance/portal/__tests__/registrationUtils.test.ts && git commit -m "feat(my-portal): self-registered field worker insert + selfie helper"`).

---

## Task A4: Public site-list endpoint

**Files:** Create `pages/api/my/register-sites.ts`; Test `src/modules/attendance/__tests__/api/register-sites.test.ts`.

- [ ] **Step 1: Failing test** `register-sites.test.ts`:

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ sql: vi.fn() }));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/db-pool', () => ({ sql: mocks.sql }));

import handler from '../../../../../pages/api/my/register-sites';

function makeReq(method = 'GET'): NextApiRequest {
  return { method, query: {}, headers: {}, socket: { remoteAddress: '127.0.0.1' } } as unknown as NextApiRequest;
}
function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = { status(c: number) { captured.statusCode = c; return this; }, json(d: unknown) { captured.body = d; return this; }, setHeader() {}, getHeader() {} };
  return { res: res as unknown as NextApiResponse, captured };
}
beforeEach(() => { vi.clearAllMocks(); });

describe('GET /api/my/register-sites', () => {
  it('405s on non-GET', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq('POST'), res);
    expect(captured.statusCode).toBe(405);
  });
  it('returns id+name sites', async () => {
    mocks.sql.mockResolvedValue([{ id: 'p1', name: 'Lawley' }]);
    const { res, captured } = makeRes();
    await handler(makeReq('GET'), res);
    expect(captured.statusCode).toBe(200);
    const body = captured.body as { success: true; data: { sites: { id: string; name: string }[] } };
    expect(body.data.sites[0]).toEqual({ id: 'p1', name: 'Lawley' });
  });
});
```

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3: Implement** `pages/api/my/register-sites.ts`:

```ts
/**
 * GET /api/my/register-sites — PUBLIC, unauthenticated.
 * Minimal { id, name } project list for the self-registration site picker
 * (the page has no session yet). Only id + name exposed — low sensitivity.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  try {
    const rows = await sql<{ id: string; name: string }>`
      SELECT id, project_name AS name
      FROM projects
      WHERE project_name IS NOT NULL
        AND LOWER(COALESCE(status, '')) NOT IN ('closed', 'archived', 'completed', 'cancelled')
      ORDER BY project_name
      LIMIT 500
    `;
    return apiResponse.success(res, { sites: rows });
  } catch (err) {
    log.error('[my-register-sites] query failed', { error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}
```

> Confirm `apiResponse.methodNotAllowed/success/internalError` signatures against `pages/api/my/session.ts`. Confirm `projects.project_name`/`status` columns via `pages/api/projects/search-for-linking.ts`.

- [ ] **Step 4:** Run — PASS (2).
- [ ] **Step 5: Commit** (`… && git add pages/api/my/register-sites.ts src/modules/attendance/__tests__/api/register-sites.test.ts && git commit -m "feat(my-portal): public site list for self-registration"`).

---

## Task A5: Public registration endpoint

**Files:** Create `pages/api/my/register.ts`; Test `src/modules/attendance/__tests__/api/register.test.ts`.

- [ ] **Step 1: Failing test** `register.test.ts`:

```ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  findExistingStaffForRegistration: vi.fn(),
  createSelfRegisteredFieldWorker: vi.fn(),
  storeRegistrationSelfie: vi.fn(),
  generateOtp: vi.fn(() => '123456'),
  hashOtp: vi.fn(async () => 'h'),
  upsertPendingOtp: vi.fn(async () => ({ sent: true, cooldownMs: 0 })),
  sendOtpViaWhatsApp: vi.fn(async () => undefined),
}));
vi.mock('@/lib/logger', () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
vi.mock('@/services/staff/staffPhoneDedup', () => ({ findExistingStaffForRegistration: mocks.findExistingStaffForRegistration }));
vi.mock('@/modules/attendance/portal/registrationUtils', () => ({
  createSelfRegisteredFieldWorker: mocks.createSelfRegisteredFieldWorker,
  storeRegistrationSelfie: mocks.storeRegistrationSelfie,
}));
vi.mock('@/modules/attendance/portal/otpUtils', () => ({
  generateOtp: mocks.generateOtp, hashOtp: mocks.hashOtp, upsertPendingOtp: mocks.upsertPendingOtp,
  sendOtpViaWhatsApp: mocks.sendOtpViaWhatsApp,
  normaliseSaPhone: (s: string) => (/^0\d{9}$/.test(s) ? '+27' + s.slice(1) : null),
}));

import handler from '../../../../../pages/api/my/register';

function makeReq(body: unknown, method = 'POST'): NextApiRequest {
  return { method, body, headers: { 'user-agent': 't' }, socket: { remoteAddress: '127.0.0.1' }, query: {} } as unknown as NextApiRequest;
}
function makeRes() {
  const captured: { statusCode: number; body?: unknown } = { statusCode: 200 };
  const res = { status(c: number) { captured.statusCode = c; return this; }, json(d: unknown) { captured.body = d; return this; }, setHeader() {}, getHeader() {} };
  return { res: res as unknown as NextApiResponse, captured };
}
const VALID = { firstName: 'Thabo', lastName: 'M', phone: '0821234567', projectId: 'p1', role: 'technician', idNumber: '9001015800087', selfieBase64: 'AAAA' };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.upsertPendingOtp.mockResolvedValue({ sent: true, cooldownMs: 0 });
  mocks.createSelfRegisteredFieldWorker.mockResolvedValue('fw-1');
  mocks.storeRegistrationSelfie.mockResolvedValue('/storage/registrations/fw-1/selfie.jpg');
});

describe('POST /api/my/register', () => {
  it('405s on non-POST', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq(VALID, 'GET'), res);
    expect(captured.statusCode).toBe(405);
  });
  it('400s on missing fields', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ firstName: 'A' }), res);
    expect(captured.statusCode).toBe(400);
    expect(mocks.createSelfRegisteredFieldWorker).not.toHaveBeenCalled();
  });
  it('400s on malformed phone', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID, phone: 'xyz' }), res);
    expect(captured.statusCode).toBe(400);
  });
  it('400s on bad role', async () => {
    const { res, captured } = makeRes();
    await handler(makeReq({ ...VALID, role: 'admin' }), res);
    expect(captured.statusCode).toBe(400);
  });
  it('new phone → creates worker, stores selfie, sends OTP, 200', async () => {
    mocks.findExistingStaffForRegistration.mockResolvedValue(null);
    const { res, captured } = makeRes();
    await handler(makeReq(VALID), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.createSelfRegisteredFieldWorker).toHaveBeenCalledTimes(1);
    expect(mocks.storeRegistrationSelfie).toHaveBeenCalledWith({ base64: 'AAAA', staffId: 'fw-1' });
    expect(mocks.sendOtpViaWhatsApp).toHaveBeenCalledTimes(1);
  });
  it('existing phone → no create, still sends OTP, 200', async () => {
    mocks.findExistingStaffForRegistration.mockResolvedValue({ id: 'staff-x' });
    const { res, captured } = makeRes();
    await handler(makeReq(VALID), res);
    expect(captured.statusCode).toBe(200);
    expect(mocks.createSelfRegisteredFieldWorker).not.toHaveBeenCalled();
    expect(mocks.upsertPendingOtp).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'staff-x' }));
  });
});
```

- [ ] **Step 2:** Run — FAIL.

- [ ] **Step 3: Implement** `pages/api/my/register.ts`:

```ts
/**
 * POST /api/my/register — PUBLIC self-registration for field workers (Slice A).
 * Body: { firstName, lastName, phone, projectId, role: 'technician'|'casual', idNumber?, selfieBase64? }
 *
 * Creates a PENDING self-registered field worker (account_status='pending',
 * source='self_registered'), then sends a WhatsApp OTP. Step 2 (OTP+PIN) reuses
 * /api/my/login/verify-otp. Always 200 once inputs are valid — never reveals
 * whether the phone already existed (anti-enumeration). 400 only for
 * missing/malformed inputs (user-fixable).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { findExistingStaffForRegistration } from '@/services/staff/staffPhoneDedup';
import { createSelfRegisteredFieldWorker, storeRegistrationSelfie } from '@/modules/attendance/portal/registrationUtils';
import { generateOtp, hashOtp, normaliseSaPhone, sendOtpViaWhatsApp, upsertPendingOtp } from '@/modules/attendance/portal/otpUtils';

export const config = { api: { bodyParser: { sizeLimit: '2mb' } } };

const ALLOWED_ROLES = new Set(['technician', 'casual']);

interface RegisterBody {
  firstName?: string; lastName?: string; phone?: string; projectId?: string;
  role?: string; idNumber?: string; selfieBase64?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const b = (req.body ?? {}) as RegisterBody;
  const firstName = typeof b.firstName === 'string' ? b.firstName.trim() : '';
  const lastName = typeof b.lastName === 'string' ? b.lastName.trim() : '';
  const projectId = typeof b.projectId === 'string' ? b.projectId.trim() : '';
  const role = typeof b.role === 'string' ? b.role.trim() : '';
  const idNumber = typeof b.idNumber === 'string' && b.idNumber.trim() ? b.idNumber.trim() : null;
  const selfieBase64 = typeof b.selfieBase64 === 'string' && b.selfieBase64 ? b.selfieBase64 : null;
  const rawPhone = typeof b.phone === 'string' ? b.phone.trim() : '';

  if (!firstName || !lastName || !projectId) return apiResponse.badRequest(res, 'firstName, lastName and projectId are required');
  if (!ALLOWED_ROLES.has(role)) return apiResponse.badRequest(res, "role must be 'technician' or 'casual'");
  const normalised = normaliseSaPhone(rawPhone);
  if (!normalised) return apiResponse.badRequest(res, 'A valid South African phone number is required');

  let stage = 'dedup';
  try {
    let staffId: string;
    const existing = await findExistingStaffForRegistration(normalised, firstName, lastName);
    if (existing) {
      staffId = existing.id; // known phone — reuse, never reveal which
    } else {
      stage = 'create';
      staffId = await createSelfRegisteredFieldWorker({
        firstName, lastName, phone: normalised, role: role as 'technician' | 'casual',
        declaredProjectId: projectId, idNumber, selfieUrl: null,
      });
      if (selfieBase64) {
        stage = 'selfie';
        try {
          const url = await storeRegistrationSelfie({ base64: selfieBase64, staffId });
          await (await import('@/lib/db-pool')).sql`UPDATE staff SET selfie_url = ${url} WHERE id = ${staffId}`;
        } catch (selfieErr) {
          log.error('[my-register] selfie store failed (continuing)', { staffId, error: selfieErr instanceof Error ? selfieErr.message : String(selfieErr) });
        }
      }
    }

    stage = 'otp';
    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const { sent } = await upsertPendingOtp({ staffId, otpHash });
    if (sent) {
      stage = 'wa_send';
      try {
        await sendOtpViaWhatsApp({ phone: normalised, otp, staffName: `${firstName} ${lastName}`.trim() });
      } catch (sendErr) {
        log.error('[my-register] WA send failed', { staffId, error: sendErr instanceof Error ? sendErr.message : String(sendErr) });
        process.stderr.write(JSON.stringify({ level: 'ERROR', component: 'attendance-register', event: 'wa_send_failed', staffId, error: sendErr instanceof Error ? sendErr.message : String(sendErr), timestamp: new Date().toISOString() }) + '\n');
      }
    }
    return apiResponse.success(res, { ok: true });
  } catch (err) {
    log.error('[my-register] unexpected error', { stage, error: err instanceof Error ? err.message : String(err) });
    return apiResponse.internalError(res, err);
  }
}
```

> Confirm `findExistingStaffForRegistration` signature/return (`{ id, ... } | null`) in `src/services/staff/staffPhoneDedup.ts`. Confirm `otpUtils` exports `generateOtp/hashOtp/upsertPendingOtp/sendOtpViaWhatsApp/normaliseSaPhone` (request-otp.ts imports them). `upsertPendingOtp({staffId, otpHash})` — match its real param shape.

- [ ] **Step 4:** Run — PASS (6).
- [ ] **Step 5: Commit** (`… && git add pages/api/my/register.ts src/modules/attendance/__tests__/api/register.test.ts && git commit -m "feat(my-portal): public field-worker self-registration endpoint"`).

---

## Task A6: Registration page + client helpers

**Files:** Modify `src/modules/attendance/portal/client/api.ts`; Create `pages/my/register.tsx`.

- [ ] **Step 1: Client helpers** — in `client/api.ts`, near `requestOtp`/`verifyOtp`, add:

```ts
export interface RegisterSite { id: string; name: string; }
export function getRegisterSites(): Promise<{ sites: RegisterSite[] }> {
  return request<{ sites: RegisterSite[] }>('/api/my/register-sites', { method: 'GET' });
}
export interface RegisterFieldWorkerPayload {
  firstName: string; lastName: string; phone: string; projectId: string;
  role: 'technician' | 'casual'; idNumber?: string; selfieBase64?: string;
}
export function registerFieldWorker(p: RegisterFieldWorkerPayload): Promise<{ ok: true }> {
  return request<{ ok: true }>('/api/my/register', { method: 'POST', body: JSON.stringify(p) });
}
```

> Match the existing `request<T>(path, init)` helper (it already JSON-encodes headers + unwraps the envelope — see `requestOtp`).

- [ ] **Step 2: Page** `pages/my/register.tsx` — model on `pages/my/onboard.tsx` (two-step: profile → verify). Step 1 collects firstName, lastName, phone, site `<select>` (from `getRegisterSites`), worker-type `<select>` (Technician/Casual), ID number, and a live selfie (hidden `<input type="file" accept="image/*" capture="user">` + `fileToResizedBase64(file,{maxDimension:800,quality:0.7})` from `@/modules/attendance/portal/client/imageUtils`; preview via `SelfieStep`-style markup). Submit → `registerFieldWorker(...)`. Step 2 = OTP + 6-digit PIN → `verifyOtp({phone, otp, newPin, deviceFingerprint})` → on `sessionIssued` `router.push('/my/attendance')`, else show "PIN saved, sign in". Use `MyPortalShell`, dark-theme classes matching `onboard.tsx`. Set `MyRegisterPage.getLayout = (page) => page`.

  (Full reference markup: copy the structure of `pages/my/onboard.tsx` step UI; add the extra step-1 fields. Keep <300 lines; if larger, extract the form into a component under `src/modules/attendance/portal/client/`.)

- [ ] **Step 3:** `npx tsc --noEmit` — no new errors. Manual render verified in Task A8 (browser).
- [ ] **Step 4: Commit** (`… && git add src/modules/attendance/portal/client/api.ts pages/my/register.tsx && git commit -m "feat(my-portal): self-registration page + client helpers"`).

---

## Task A7: Login link + hub pending gate

**Files:** Modify `src/modules/attendance/portal/client/MyLoginScreen.tsx`, `src/modules/attendance/portal/client/MyHub.tsx`, and `src/modules/attendance/portal/client/api.ts` (ensure `AttendanceProfile.accountStatus`).

- [ ] **Step 1: Confirm client profile has accountStatus.** In `client/api.ts`, check `interface AttendanceProfile`. If it lacks `accountStatus`, add `accountStatus: 'pending' | 'active' | 'suspended';` (the server `/api/my/session` already returns it; `MyHub` already reads `profile.role`, so the shape is parallel to the server type).

- [ ] **Step 2: Login link** — in `MyLoginScreen.tsx`, after the existing `/my/onboard` "First time signing in?" `<Link>` block, add:

```tsx
      <Link href="/my/register" className="mt-3 block text-center text-sm text-blue-400 hover:text-blue-300">
        New field worker? Register here
      </Link>
```

- [ ] **Step 3: Hub pending gate** — in `MyHub.tsx`, at the top of the returned content (after the error alert blocks, before the tile grid), add a branch:

```tsx
      {profile.accountStatus === 'pending' && (
        <div className="mb-4 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          Your registration is pending approval by an admin. You can clock in now —
          stock issued to you is limited to R5,000 until you’re approved.
        </div>
      )}
```

And restrict the tile grid for pending workers to Clock + History only (mirror the structure: when `profile.accountStatus === 'pending'`, render only `<ClockTile>` in a single-column grid; keep the History button for everyone). Do NOT change the active-worker grid.

- [ ] **Step 4:** `npx tsc --noEmit` — no new errors (a newly-required `accountStatus` on `AttendanceProfile` will flag any profile-literal fixtures; update them to include `accountStatus: 'active'`).
- [ ] **Step 5: Commit** (`… && git add src/modules/attendance/portal/client/api.ts src/modules/attendance/portal/client/MyLoginScreen.tsx src/modules/attendance/portal/client/MyHub.tsx && git commit -m "feat(my-portal): register link + pending-worker hub gate"`).

---

## Task A8: Verification + PR

**Files:** none.

- [ ] **Step 1:** `npx vitest run src/modules/attendance` — all new + existing attendance tests pass.
- [ ] **Step 2:** `npm run ci:quick` — lint + typecheck green (fix anything; never `--no-verify`).
- [ ] **Step 3: Migration apply + dev deploy (CONTROLLER/Hein checkpoint, not the subagent).** Apply migration NNN to the shared DB (Hein's go-ahead) and deploy to dev via `bash scripts/deploy-local.sh dev`.
- [ ] **Step 4: Browser E2E (Claude-in-Chrome) on dev:** `/my` → "New field worker? Register here" → fill form + live selfie + pick Technician/Casual + site → submit → OTP arrives on WhatsApp → enter OTP+PIN → lands on `/my/attendance`. Back at `/my`: amber pending banner + Clock + History only. Confirm the worker can clock in. Confirm an admin can approve via `POST /api/field/users/approve?userId=<id>` and the banner clears + R5k cap lifts on next stock issue.
- [ ] **Step 5: PR** — push branch, `gh pr create`, then follow the standing review-and-merge rule (blind `/review` + CI on self-hosted runner; merge only after both pass).

---

## Self-review notes
- **Spec coverage:** G1 → A5/A6; G4 (site/selfie/ID) → A1/A3/A5/A6; G3 (casual role) → A1/A2/A5; pending hub gate → A7. G2 (HR-hiding) intentionally deferred to Slice B.
- **Reuse, not rebuild:** approval = existing `approve.ts`; dedup = existing `findExistingStaffForRegistration`; INSERT pattern mirrors `/api/my/stores/technicians.ts`; OTP/PIN = existing `/my/onboard` + verify-otp; stock cap + hours already work off `account_status`/`staff.id`.
- **No `status='provisional'`** anywhere (the v1 mistake).
- **Verify-before-trust callouts** inline: migration constraint name, projects columns, apiResponse signatures, findExistingStaffForRegistration shape, otpUtils export shapes, client AttendanceProfile.accountStatus presence.
