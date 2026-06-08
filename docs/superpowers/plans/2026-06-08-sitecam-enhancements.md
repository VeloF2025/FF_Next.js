# SiteCam Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add serial barcode scanning (ONT + UPS with format validation + async cross-reference), an enhanced SiteCam photos tab in FibreFlow, and a step appeal system (WhatsApp group + in-app queue) to the SiteCam PWA.

**Architecture:** Format-only serial validation at scan time (ALCL prefix = ONT, GU prefix = UPS). Serial saved as `pending` — actual cross-reference against 1Map + OES happens async in FibreFlow (future sprint, stubbed here). Appeal system handles both VLM photo rejections and future serial cross-reference failures. All data on `dr_photo_unified_reviews`; appeals in new `sitecam_appeals` table.

**Tech Stack:** Next.js (Pages Router), TypeScript, PostgreSQL (`pg.Pool` via `@/lib/db`), `html5-qrcode` (via existing `useBarcodeScanner` hook), `sendWhatsAppGroupImage` from `@/modules/notifications/services/whatsappDelivery`, `withMySession` for PWA API routes, `withAuth` for FibreFlow API routes.

---

## Branch Setup

- [ ] **Create branch from master**

```bash
git checkout origin/master -b feat/sitecam-serial-appeals
```

---

## Phase A — Foundation

### Task 1: DB Migration

**Files:**
- Create: `scripts/migrations/sql/402_sitecam_serial_appeals.sql`
- Create: `scripts/migrations/sql/rollback_402_sitecam_serial_appeals.sql`

- [ ] **Step 1: Write the migration**

```sql
-- scripts/migrations/sql/402_sitecam_serial_appeals.sql
-- Adds serial scan tracking columns to dr_photo_unified_reviews.
-- ont_serial_scanned / ups_serial_scanned already exist (migration 364/365).
-- We add attempt counters and status for the PWA scan flow.

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS ont_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ont_serial_status    text CHECK (ont_serial_status IN ('pending','pass','fail','locked')),
  ADD COLUMN IF NOT EXISTS ups_serial_attempts  smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ups_serial_status    text CHECK (ups_serial_status IN ('pending','pass','fail','locked'));

-- Appeal records: one row per appeal submission from a technician.
CREATE TABLE IF NOT EXISTS sitecam_appeals (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  dr_number        text        NOT NULL,
  step_number      smallint    NOT NULL,
  technician_id    uuid        NOT NULL REFERENCES users(id),
  appeal_text      text        NOT NULL,
  photo_url        text        NOT NULL,
  serial_scanned   text,
  serial_expected  text,
  attempt_number   smallint    NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','denied')),
  decided_by       uuid        REFERENCES users(id),
  decided_via      text        CHECK (decided_via IN ('whatsapp','in_app')),
  decided_at       timestamptz,
  denial_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sitecam_appeals_dr_step
  ON sitecam_appeals(dr_number, step_number);
CREATE INDEX IF NOT EXISTS sitecam_appeals_pending
  ON sitecam_appeals(status) WHERE status = 'pending';
```

- [ ] **Step 2: Write the rollback**

```sql
-- scripts/migrations/sql/rollback_402_sitecam_serial_appeals.sql
DROP TABLE IF EXISTS sitecam_appeals;

ALTER TABLE dr_photo_unified_reviews
  DROP COLUMN IF EXISTS ont_serial_attempts,
  DROP COLUMN IF EXISTS ont_serial_status,
  DROP COLUMN IF EXISTS ups_serial_attempts,
  DROP COLUMN IF EXISTS ups_serial_status;
```

- [ ] **Step 3: Run migration on dev DB**

```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow \
  -f scripts/migrations/sql/402_sitecam_serial_appeals.sql
# see .claude/credentials.local.md for PGPASSWORD
```

Expected: `ALTER TABLE`, `CREATE TABLE`, `CREATE INDEX` — no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/sql/402_sitecam_serial_appeals.sql \
        scripts/migrations/sql/rollback_402_sitecam_serial_appeals.sql
git commit -m "feat(sitecam): migration 402 — serial attempt columns + sitecam_appeals table"
```

---

### Task 2: Site API Helper Tests

**Files:**
- Create: `pages/api/sitecam/__tests__/site.test.ts`

The site API (`pages/api/sitecam/site/[id].ts`) does NOT need to return serial data — there is no expected serial at scan time. This task just adds tests that document the existing helper function contracts.

- [ ] **Step 1: Create the test file**

```typescript
// pages/api/sitecam/__tests__/site.test.ts
import { dropNumberCandidates, toDrSiteId, toSiteGeo } from '../[id]';

describe('site API helpers', () => {
  test('dropNumberCandidates returns both forms', () => {
    expect(dropNumberCandidates('DR1234')).toEqual(['DR1234', '1234']);
    expect(dropNumberCandidates('1234')).toEqual(['DR1234', '1234']);
    expect(dropNumberCandidates('DR-1234')).toEqual(['DR1234', '1234']);
  });

  test('toDrSiteId prefixes bare digits', () => {
    expect(toDrSiteId('50')).toBe('DR50');
    expect(toDrSiteId('DR50')).toBe('DR50');
  });

  test('toSiteGeo coerces strings to numbers', () => {
    expect(toSiteGeo({ latitude: '1.23', longitude: '4.56', pon_no: '7', zone_no: '8' }))
      .toEqual({ plannedLat: 1.23, plannedLon: 4.56, pon: 7, zone: 8 });
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run pages/api/sitecam/__tests__/site.test.ts
```

Expected: all PASS (helpers already exist — test documents the contract).

- [ ] **Step 3: Commit**

```bash
git add pages/api/sitecam/__tests__/site.test.ts
git commit -m "test(sitecam): document site API helper contracts"
```

---

### Task 3: Serial Format Validation Logic + Verify-Serial API

**Files:**
- Create: `src/modules/sitecam/lib/verifySerial.ts`
- Create: `src/modules/sitecam/lib/__tests__/verifySerial.test.ts`
- Create: `pages/api/my/sitecam/verify-serial.ts`

At scan time, the only validation is format (correct device prefix). The serial is saved with status `pending` — no Levenshtein comparison (nothing to compare against until 1Map/OES cross-ref, which is async).

Serial prefixes:
- ONT (Nokia): must start with `ALCL`
- UPS (Gizzu): must start with `GU`

- [ ] **Step 1: Write the format validation logic**

Create `src/modules/sitecam/lib/verifySerial.ts`:

```typescript
export const ONT_SERIAL_PREFIX = 'ALCL';
export const UPS_SERIAL_PREFIX = 'GU';

export type SerialDevice = 'ont' | 'ups';

export interface FormatValidationResult {
  valid: boolean;
  normalised: string;   // trimmed + uppercased
  message: string;
}

/**
 * Validates the serial format for the given device at scan time.
 * ONT serials must start with ALCL (Nokia).
 * UPS serials must start with GU (Gizzu).
 */
export function validateSerialFormat(
  raw: string,
  device: SerialDevice,
): FormatValidationResult {
  const normalised = raw.trim().toUpperCase();
  const prefix = device === 'ont' ? ONT_SERIAL_PREFIX : UPS_SERIAL_PREFIX;

  if (!normalised.startsWith(prefix)) {
    return {
      valid: false,
      normalised,
      message:
        device === 'ont'
          ? `ONT serials must start with ${ONT_SERIAL_PREFIX} (scanned: ${normalised})`
          : `UPS serials must start with ${UPS_SERIAL_PREFIX} (scanned: ${normalised})`,
    };
  }

  return { valid: true, normalised, message: 'Serial format valid' };
}

// ---------------------------------------------------------------------------
// Levenshtein distance — reserved for future async 1Map/OES cross-reference.
// Not used in the scan-time API route; kept here so the cross-ref logic can
// reuse it without introducing a new dep.
// ---------------------------------------------------------------------------

function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i, ...Array(n).fill(0) as number[]];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]!
        : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    prev = curr;
  }
  return prev[n]!;
}

/**
 * Fuzzy serial comparison for async cross-reference (1Map / OES).
 * Allows ≤2 character differences to absorb OCR/barcode read noise.
 */
export function serialsMatch(a: string, b: string): boolean {
  const na = a.trim().toUpperCase();
  const nb = b.trim().toUpperCase();
  if (na === nb) return true;
  return levenshteinDistance(na, nb) <= 2;
}
```

- [ ] **Step 2: Write failing tests**

Create `src/modules/sitecam/lib/__tests__/verifySerial.test.ts`:

```typescript
import { validateSerialFormat, serialsMatch } from '../verifySerial';

describe('validateSerialFormat — ONT', () => {
  test('valid ALCL serial passes', () => {
    expect(validateSerialFormat('ALCLB4ABC123', 'ont').valid).toBe(true);
  });
  test('lowercase normalised — passes', () => {
    expect(validateSerialFormat('alclb4abc123', 'ont').valid).toBe(true);
  });
  test('GU serial fails for ONT', () => {
    const r = validateSerialFormat('GU18WXXXXXX', 'ont');
    expect(r.valid).toBe(false);
    expect(r.message).toContain('ALCL');
  });
  test('random serial fails', () => {
    expect(validateSerialFormat('RANDOMSERIAL', 'ont').valid).toBe(false);
  });
  test('normalised is uppercased', () => {
    expect(validateSerialFormat('alclb4abc123', 'ont').normalised).toBe('ALCLB4ABC123');
  });
});

describe('validateSerialFormat — UPS', () => {
  test('valid GU serial passes', () => {
    expect(validateSerialFormat('GU18WXXXXXX', 'ups').valid).toBe(true);
  });
  test('ALCL serial fails for UPS', () => {
    const r = validateSerialFormat('ALCLB4ABC123', 'ups');
    expect(r.valid).toBe(false);
    expect(r.message).toContain('GU');
  });
});

describe('serialsMatch (cross-reference, fuzzy)', () => {
  test('exact match', () => {
    expect(serialsMatch('ALCLB4ABC123', 'ALCLB4ABC123')).toBe(true);
  });
  test('1 char difference — pass', () => {
    expect(serialsMatch('ALCLB4ABC124', 'ALCLB4ABC123')).toBe(true);
  });
  test('2 char difference — pass', () => {
    expect(serialsMatch('ALCLB4ABX124', 'ALCLB4ABC123')).toBe(true);
  });
  test('3 char difference — fail', () => {
    expect(serialsMatch('ALCLB4AXX124', 'ALCLB4ABC123')).toBe(false);
  });
});
```

- [ ] **Step 3: Run tests (should fail — file doesn't exist yet)**

```bash
npx vitest run src/modules/sitecam/lib/__tests__/verifySerial.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Run tests (should pass now)**

```bash
npx vitest run src/modules/sitecam/lib/__tests__/verifySerial.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Write the API route**

Create `pages/api/my/sitecam/verify-serial.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { validateSerialFormat, type SerialDevice } from '@/modules/sitecam/lib/verifySerial';
import { log } from '@/lib/logger';

const MODULE = 'verify-serial';

interface VerifySerialBody {
  drNumber: string;
  step: number;           // 6 = ONT, 8 = UPS
  scannedSerial: string;
  attemptNumber: number;  // counts invalid-format retries, not comparison failures
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  _session: AttendanceSession,
): Promise<void> {
  if (req.method !== 'POST')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { drNumber, step, scannedSerial, attemptNumber } = req.body as VerifySerialBody;

  if (!drNumber || !step || !scannedSerial || !attemptNumber)
    return apiResponse.badRequest(res, 'drNumber, step, scannedSerial, attemptNumber required');

  const isOnt = step === 6;
  const isUps = step === 8;
  if (!isOnt && !isUps)
    return apiResponse.badRequest(res, 'step must be 6 (ONT) or 8 (UPS)');

  const device: SerialDevice = isOnt ? 'ont' : 'ups';
  const validation = validateSerialFormat(scannedSerial, device);

  if (!validation.valid) {
    return apiResponse.success(res, {
      result: 'invalid_format',
      serial: validation.normalised,
      message: validation.message,
    });
  }

  // Valid format — save to DB as pending (no comparison at scan time)
  const attemptsCol = isOnt ? 'ont_serial_attempts' : 'ups_serial_attempts';
  const statusCol   = isOnt ? 'ont_serial_status'   : 'ups_serial_status';
  const scannedCol  = isOnt ? 'ont_serial_scanned'  : 'ups_serial_scanned';

  await pool.query(
    `INSERT INTO dr_photo_unified_reviews (drop_number, ${attemptsCol}, ${statusCol}, ${scannedCol})
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (drop_number)
     DO UPDATE SET
       ${attemptsCol} = $2,
       ${statusCol}   = 'pending',
       ${scannedCol}  = $3`,
    [drNumber, attemptNumber, validation.normalised],
  );

  log.info('Serial scan saved as pending', {
    drNumber, step, serial: validation.normalised, attemptNumber,
  }, MODULE);

  return apiResponse.success(res, {
    result: 'saved',
    serial: validation.normalised,
    message: 'Serial saved — cross-reference pending (1Map + OES)',
  });
}

export default withMySession(handler);
```

- [ ] **Step 6: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sitecam/lib/verifySerial.ts \
        src/modules/sitecam/lib/__tests__/verifySerial.test.ts \
        pages/api/my/sitecam/verify-serial.ts
git commit -m "feat(sitecam): serial format validation logic + verify-serial API (save as pending)"
```

---

## Phase B — PWA Serial Scan

### Task 4: Extend Step Types for Serial Scan

**Files:**
- Modify: `src/modules/sitecam/lib/sitecamSteps.ts`
- Modify: `src/modules/sitecam/hooks/useSiteCamCapture.ts`

- [ ] **Step 1: Add `hasSerialScan` to SiteCamStep**

In `src/modules/sitecam/lib/sitecamSteps.ts`, update the interface and activation steps:

```typescript
export interface SiteCamStep {
  number: number;
  label: string;
  hasVlm: boolean;
  hasSerialScan: boolean;   // add
  serialLabel?: string;     // add — human label for the serial being scanned
  serialDevice?: 'ont' | 'ups';  // add — for format validation
}

export const ACTIVATION_STEPS: readonly SiteCamStep[] = [
  { number: 1,  label: 'House / Property Photo',   hasVlm: true,  hasSerialScan: false },
  { number: 2,  label: 'Cable from Pole',           hasVlm: true,  hasSerialScan: false },
  { number: 3,  label: 'Entry Outside',             hasVlm: false, hasSerialScan: false },
  { number: 4,  label: 'Entry Inside',              hasVlm: false, hasSerialScan: false },
  { number: 5,  label: 'Wall (ONT Mount)',          hasVlm: true,  hasSerialScan: false },
  { number: 6,  label: 'ONT Back After Install',    hasVlm: false, hasSerialScan: true,  serialLabel: 'ONT Serial',  serialDevice: 'ont' },
  { number: 7,  label: 'Power Meter',               hasVlm: true,  hasSerialScan: false },
  { number: 8,  label: 'Final Installation',        hasVlm: true,  hasSerialScan: true,  serialLabel: 'UPS Serial',  serialDevice: 'ups' },
  { number: 9,  label: 'Green Lights on ONT',       hasVlm: true,  hasSerialScan: false },
  { number: 10, label: 'Signature',                 hasVlm: true,  hasSerialScan: false },
  { number: 11, label: 'Dome Joint Open',           hasVlm: true,  hasSerialScan: false },
  { number: 12, label: 'Dome Joint Closed',         hasVlm: true,  hasSerialScan: false },
];

export const CIVIL_STEPS: readonly SiteCamStep[] = [
  { number: 1, label: 'Before Photo',           hasVlm: true, hasSerialScan: false },
  { number: 2, label: 'During Photo',           hasVlm: true, hasSerialScan: false },
  { number: 3, label: 'Depth Photo',            hasVlm: true, hasSerialScan: false },
  { number: 4, label: 'End Plates',             hasVlm: true, hasSerialScan: false },
  { number: 5, label: 'Compaction / Backfill',  hasVlm: true, hasSerialScan: false },
  { number: 6, label: 'Level Check',            hasVlm: true, hasSerialScan: false },
  { number: 7, label: 'After Photo',            hasVlm: true, hasSerialScan: false },
  { number: 8, label: 'Pole Label',             hasVlm: true, hasSerialScan: false },
];
```

- [ ] **Step 2: Extend `StepState` and `StepStatus` in `useSiteCamCapture.ts`**

```typescript
export type StepStatus =
  | 'pending'
  | 'validating'
  | 'pass'
  | 'fail'
  | 'escalated'
  | 'serial_scan'     // photo passed, waiting for barcode scan
  | 'serial_pending'; // barcode scanned + format valid, saved as pending (cross-ref async)

export interface StepState {
  stepNumber: number;
  label: string;
  hasVlm: boolean;
  hasSerialScan: boolean;         // add
  serialLabel: string;            // add — e.g. 'ONT Serial'
  serialDevice: 'ont' | 'ups' | null;  // add — for format validation
  serialAttempts: number;         // add — counts invalid-format retries
  serialScanned: string | null;   // add — the saved serial (normalised)
  status: StepStatus;
  photoBase64: string | null;
  attemptNumber: number;
  failReasons: string[];
  corrections: string[];
  needsManualReview: boolean;
}
```

- [ ] **Step 3: Update `initStepStates` to populate serial fields**

Replace `initStepStates` in `useSiteCamCapture.ts`:

```typescript
function initStepStates(
  steps: readonly SiteCamStep[],
): StepState[] {
  return steps.map((s) => ({
    stepNumber: s.number,
    label: s.label,
    hasVlm: s.hasVlm,
    hasSerialScan: s.hasSerialScan,
    serialLabel: s.serialLabel ?? '',
    serialDevice: s.serialDevice ?? null,
    serialAttempts: 0,
    serialScanned: null,
    status: 'pending',
    photoBase64: null,
    attemptNumber: 0,
    failReasons: [],
    corrections: [],
    needsManualReview: false,
  }));
}
```

Update the call site (remove `siteInfo` parameter from `initStepStates` — it's no longer needed here):

```typescript
const [stepStates, setStepStates] = useState<StepState[]>(() =>
  initStepStates(steps),
);
```

- [ ] **Step 4: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/lib/sitecamSteps.ts \
        src/modules/sitecam/hooks/useSiteCamCapture.ts
git commit -m "feat(sitecam): add hasSerialScan/serialDevice to step definitions + StepState serial fields"
```

---

### Task 5: SerialScanStep Component

**Files:**
- Create: `src/modules/sitecam/components/SerialScanStep.tsx`

Renders after photo passes for steps 6 and 8. Scans barcode, validates format (ALCL / GU), calls verify-serial API. On format-valid scan: shows "Serial saved — cross-reference pending" and fires `onScanSaved`. On invalid format: shows error, allows retry.

- [ ] **Step 1: Create the component**

```typescript
// src/modules/sitecam/components/SerialScanStep.tsx
import { useState, useId } from 'react';
import { CheckCircle, AlertTriangle, Scan, Clock } from 'lucide-react';
import { useBarcodeScanner } from '@/modules/barcode-scanner/hooks/useBarcodeScanner';
import { log } from '@/lib/logger';

const MODULE = 'SerialScanStep';

interface Props {
  stepNumber: number;
  serialLabel: string;           // 'ONT Serial' or 'UPS Serial'
  serialDevice: 'ont' | 'ups';
  serialAttempts: number;
  drNumber: string;
  onScanSaved: (serial: string) => void;  // called when valid format saved to DB
}

export function SerialScanStep({
  stepNumber,
  serialLabel,
  serialDevice,
  serialAttempts,
  drNumber,
  onScanSaved,
}: Props) {
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savedSerial, setSavedSerial] = useState<string | null>(null);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const scanElementId = useId().replace(/:/g, '-');

  const prefix = serialDevice === 'ont' ? 'ALCL' : 'GU';

  const { start, stop } = useBarcodeScanner({
    elementId: scanElementId,
    config: { facingMode: 'environment', fps: 10, qrboxSize: 300 },
    onScan: async (result) => {
      if (loading) return;
      setLastScanned(result.decodedText);
      await stop();
      setScanning(false);
      await submitScan(result.decodedText);
    },
  });

  async function submitScan(scanned: string) {
    setLoading(true);
    setInvalidMsg(null);
    try {
      const res = await fetch('/api/my/sitecam/verify-serial', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drNumber,
          step: stepNumber,
          scannedSerial: scanned,
          attemptNumber: serialAttempts + 1,
        }),
      });
      const json = (await res.json()) as {
        data: { result: 'saved' | 'invalid_format'; serial: string; message: string };
      };
      const { result, serial, message } = json.data;
      if (result === 'saved') {
        setSavedSerial(serial);
        onScanSaved(serial);
      } else {
        setInvalidMsg(message);
      }
    } catch (err) {
      log.error('Verify serial failed', { err: String(err) }, MODULE);
      setInvalidMsg('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }

  function handleScanClick() {
    setScanning(true);
    setInvalidMsg(null);
    setSavedSerial(null);
    start().catch((e) => {
      log.warn('Scanner start error', { e: String(e) }, MODULE);
      setScanning(false);
    });
  }

  // Once saved, show the pending confirmation
  if (savedSerial) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-sky-800 bg-sky-950/40 py-8 px-4">
        <Clock className="h-8 w-8 text-sky-400" />
        <p className="text-sm font-medium text-sky-300">Serial saved — {savedSerial}</p>
        <p className="text-xs text-neutral-500">Cross-reference pending (1Map + OES)</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-4 space-y-2">
        <p className="text-sm font-medium text-neutral-200">Scan {serialLabel}</p>
        <p className="text-xs text-neutral-500">
          {serialLabel} starts with <span className="font-mono text-neutral-300">{prefix}</span>
        </p>
        {serialAttempts > 0 && (
          <p className="text-xs text-neutral-500">Attempt {serialAttempts + 1}</p>
        )}
      </div>

      {/* Scanner viewfinder */}
      {scanning && (
        <div
          id={scanElementId}
          className="overflow-hidden rounded-xl border border-neutral-700"
          style={{ width: '100%', minHeight: 300 }}
        />
      )}

      {/* Invalid format feedback */}
      {invalidMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-red-800 bg-red-950/40 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-red-400" />
          <div>
            <p className="text-sm text-red-300">{invalidMsg}</p>
            {lastScanned && (
              <p className="text-xs text-neutral-500 mt-0.5">
                Scanned: <span className="font-mono">{lastScanned}</span>
              </p>
            )}
          </div>
        </div>
      )}

      {!scanning && !loading && !savedSerial && (
        <button
          type="button"
          onClick={handleScanClick}
          className="flex w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-600 bg-neutral-900 py-8 hover:border-sky-500 hover:bg-neutral-800 active:bg-neutral-800/60 transition-colors"
        >
          <Scan className="h-8 w-8 text-neutral-400" />
          <span className="text-sm font-medium text-neutral-300">
            {serialAttempts === 0 ? `Scan ${serialLabel}` : `Retry Scan`}
          </span>
        </button>
      )}

      {loading && (
        <div className="flex justify-center py-4">
          <p className="text-sm text-neutral-400">Saving…</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/sitecam/components/SerialScanStep.tsx
git commit -m "feat(sitecam): SerialScanStep component — format validation + save as pending"
```

---

### Task 6: Wire Serial Scan into StepCapture + Hook

**Files:**
- Modify: `src/modules/sitecam/components/StepCapture.tsx`
- Modify: `src/modules/sitecam/hooks/useSiteCamCapture.ts`

- [ ] **Step 1: Replace StepCapture.tsx**

```typescript
import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, Camera, CheckCircle, Loader2 } from 'lucide-react';
import type { StepState } from '../hooks/useSiteCamCapture';
import { SerialScanStep } from './SerialScanStep';

interface Props {
  step: StepState;
  drNumber: string;
  onCapture: (file: File) => void;
  onSerialSaved: (serial: string) => void;  // called when serial saved to DB
  onAppeal: () => void;
}

export function StepCapture({ step, drNumber, onCapture, onSerialSaved, onAppeal }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
      e.target.value = '';
    }
  };

  const showCamera = step.status === 'pending' || step.status === 'fail';
  const showSerialScan = step.status === 'serial_scan';
  const remaining = Math.max(0, 3 - step.attemptNumber);
  const showAppeal =
    (step.status === 'fail' && step.attemptNumber > 0) || step.status === 'escalated';

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-neutral-100">
        Step {step.stepNumber}: {step.label}
      </h2>

      {step.photoBase64 && (
        <div className="relative overflow-hidden rounded-xl border border-neutral-700 bg-black">
          <img
            src={`data:image/jpeg;base64,${step.photoBase64}`}
            alt={`Captured photo for step ${step.stepNumber}: ${step.label}`}
            className="mx-auto max-h-72 w-full object-contain"
          />
          {step.status === 'validating' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
              <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
              <p className="text-sm font-medium text-neutral-200">Checking photo…</p>
            </div>
          )}
        </div>
      )}

      {(step.status === 'pass' || step.status === 'serial_pending') && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-green-800 bg-green-950/40 py-8">
          <CheckCircle className="h-8 w-8 text-green-400" />
          <p className="text-sm font-medium text-green-300">
            {step.status === 'serial_pending' ? 'Step complete' : 'Photo accepted!'}
          </p>
        </div>
      )}

      {step.status === 'escalated' && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-800 bg-amber-950/40 py-8">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="text-sm font-medium text-amber-300">Escalated — moving on</p>
          <p className="text-xs text-neutral-500">A supervisor will review this step.</p>
        </div>
      )}

      {step.status === 'fail' && step.failReasons.length > 0 && (
        <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-4 space-y-3">
          <div className="space-y-1">
            {step.failReasons.map((reason, i) => (
              <p key={i} className="text-sm text-red-300">{reason}</p>
            ))}
          </div>
          {step.corrections.length > 0 && (
            <div className="space-y-1 border-t border-red-900 pt-3">
              {step.corrections.map((correction, i) => (
                <p key={i} className="text-xs italic text-neutral-400">{correction}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-neutral-500">
            Attempt {step.attemptNumber} of 3 — {remaining} remaining
          </p>
        </div>
      )}

      {showSerialScan && step.serialDevice && (
        <SerialScanStep
          stepNumber={step.stepNumber}
          serialLabel={step.serialLabel}
          serialDevice={step.serialDevice}
          serialAttempts={step.serialAttempts}
          drNumber={drNumber}
          onScanSaved={onSerialSaved}
        />
      )}

      {showCamera && (
        <div>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-neutral-600 bg-neutral-900 py-12 hover:border-sky-500 hover:bg-neutral-800 active:bg-neutral-800/60 transition-colors"
          >
            <Camera className="h-10 w-10 text-neutral-400" />
            <span className="text-sm font-medium text-neutral-300">Take Photo</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleInputChange}
          />
        </div>
      )}

      {showAppeal && (
        <button
          type="button"
          onClick={onAppeal}
          className="w-full rounded-xl border border-amber-700 bg-amber-950/30 py-3 text-sm font-medium text-amber-300 hover:bg-amber-950/50 transition-colors"
        >
          Appeal This Step
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add serial scan handler to `useSiteCamCapture`**

After the existing `escalateStep` callback, add:

```typescript
  const handleSerialSaved = useCallback(
    (idx: number, serial: string) => {
      setStepStates((prev) =>
        prev.map((s, i) => {
          if (i !== idx) return s;
          return {
            ...s,
            status: 'serial_pending',
            serialScanned: serial,
            serialAttempts: s.serialAttempts + 1,
          };
        }),
      );
      // serial_pending = tech's job done; advance after brief pause
      advanceStep(1500);
    },
    [advanceStep],
  );
```

Update `captureAndValidate` — after photo passes for a step with `hasSerialScan`, transition to `serial_scan` instead of immediately advancing. This is different for VLM steps (step 8) and non-VLM steps (step 6):

For the non-VLM path (step 6), replace:
```typescript
      if (!step.hasVlm) {
        setStepStates((prev) =>
          prev.map((s, i) => (i === idx ? { ...s, status: 'pass' } : s)),
        );
        advanceStep(1500);
        return;
      }
```
With:
```typescript
      if (!step.hasVlm) {
        if (step.hasSerialScan && siteInfo.jobType === 'activations') {
          setStepStates((prev) =>
            prev.map((s, i) =>
              i === idx ? { ...s, status: 'serial_scan', photoBase64: base64 } : s,
            ),
          );
          return;
        }
        setStepStates((prev) =>
          prev.map((s, i) => (i === idx ? { ...s, status: 'pass' } : s)),
        );
        advanceStep(1500);
        return;
      }
```

For the VLM pass path (step 8), replace:
```typescript
        if (pass) {
          const flagged = needsManualReview === true;
          setStepStates((prev) =>
            prev.map((s, i) => (i === idx ? { ...s, status: 'pass', needsManualReview: flagged } : s)),
          );
          advanceStep(1500);
          return;
        }
```
With:
```typescript
        if (pass) {
          const flagged = needsManualReview === true;
          if (step.hasSerialScan && siteInfo.jobType === 'activations') {
            setStepStates((prev) =>
              prev.map((s, i) =>
                i === idx
                  ? { ...s, status: 'serial_scan', needsManualReview: flagged }
                  : s,
              ),
            );
            return;
          }
          setStepStates((prev) =>
            prev.map((s, i) =>
              i === idx ? { ...s, status: 'pass', needsManualReview: flagged } : s,
            ),
          );
          advanceStep(1500);
          return;
        }
```

Return `handleSerialSaved` (bound to `currentStepIndex`) from the hook:

```typescript
  return {
    stepStates,
    currentStep,
    currentStepIndex,
    allDone,
    captureAndValidate,
    handleSerialSaved: (serial: string) => handleSerialSaved(currentStepIndex, serial),
    submitAll,
    uploading,
    uploadError,
    uploadResult,
    escalateStep,
  };
```

Also update `allDone` to treat `serial_pending` as complete:

```typescript
  const allDone = stepStates.every(
    (s) => s.status === 'pass' || s.status === 'escalated' || s.status === 'serial_pending',
  );
```

- [ ] **Step 3: Find and update StepCapture callers in SiteCamWizard**

```bash
grep -n "StepCapture\|captureAndValidate\|handleSerial" src/modules/sitecam/components/SiteCamWizard.tsx
```

Pass `drNumber={siteInfo.siteId}`, `onSerialSaved={handleSerialSaved}`, and `onAppeal={() => setAppealOpen(true)}` (appeal state wired in Task 9).

- [ ] **Step 4: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/components/StepCapture.tsx \
        src/modules/sitecam/hooks/useSiteCamCapture.ts
git commit -m "feat(sitecam): wire serial scan sub-step into StepCapture + hook (format-only, saves as pending)"
```

---

## Phase C — Appeal System

### Task 7: Appeal API Endpoints

**Files:**
- Create: `pages/api/my/sitecam/appeal.ts`
- Create: `pages/api/my/sitecam/appeal-status/[drNumber]/[step].ts`
- Create: `pages/api/activate/sitecam-appeals.ts`
- Create: `pages/api/activate/sitecam-appeals/[id]/decision.ts`

- [ ] **Step 1: Submit appeal (PWA)**

Create `pages/api/my/sitecam/appeal.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import { sendWhatsAppGroupImage } from '@/modules/notifications/services/whatsappDelivery';
import { log } from '@/lib/logger';

const MODULE = 'sitecam-appeal';
const APPEAL_GROUP_JID = process.env.SITECAM_APPEAL_GROUP_JID ?? '';

interface AppealBody {
  drNumber: string;
  stepNumber: number;
  appealText: string;
  photoUrl: string;
  serialScanned?: string;
  serialExpected?: string;
  attemptNumber: number;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession,
): Promise<void> {
  if (req.method !== 'POST')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const {
    drNumber, stepNumber, appealText, photoUrl,
    serialScanned, serialExpected, attemptNumber,
  } = req.body as AppealBody;

  if (!drNumber || !stepNumber || !appealText || !photoUrl || !attemptNumber)
    return apiResponse.badRequest(res, 'drNumber, stepNumber, appealText, photoUrl, attemptNumber required');

  const { rows: staffRows } = await pool.query<{ first_name: string; last_name: string }>(
    `SELECT first_name, last_name FROM staff WHERE id = $1 LIMIT 1`,
    [session.staffId],
  );
  const techName = staffRows[0]
    ? `${staffRows[0].first_name} ${staffRows[0].last_name}`
    : 'Unknown Technician';

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO sitecam_appeals
       (dr_number, step_number, technician_id, appeal_text, photo_url,
        serial_scanned, serial_expected, attempt_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id`,
    [drNumber, stepNumber, session.staffId, appealText, photoUrl,
     serialScanned ?? null, serialExpected ?? null, attemptNumber],
  );
  const appealId = rows[0]!.id;

  if (APPEAL_GROUP_JID) {
    const waMessage = [
      `🔴 *SiteCam Appeal — ${drNumber}*`,
      `Step ${stepNumber} | Tech: ${techName}`,
      `Reason: "${appealText}"`,
      serialScanned
        ? `Serial scanned: \`${serialScanned}\`\nExpected: \`${serialExpected ?? 'unknown'}\``
        : '',
      `Attempt: ${attemptNumber}`,
      ``,
      `Reply:`,
      `  APPROVE sitecam-appeal-${appealId}`,
      `  DENY sitecam-appeal-${appealId}`,
    ].filter(Boolean).join('\n');

    sendWhatsAppGroupImage(APPEAL_GROUP_JID, waMessage, photoUrl).catch((err: unknown) => {
      log.warn('Appeal WA send failed (non-fatal)', { appealId, err: String(err) }, MODULE);
    });
  }

  log.info('Appeal submitted', { appealId, drNumber, stepNumber }, MODULE);
  return apiResponse.success(res, { appealId });
}

export default withMySession(handler);
```

- [ ] **Step 2: Poll appeal status (PWA)**

Create `pages/api/my/sitecam/appeal-status/[drNumber]/[step].ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  _session: AttendanceSession,
): Promise<void> {
  if (req.method !== 'GET')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const { drNumber, step } = req.query as { drNumber: string; step: string };
  const stepNum = parseInt(step, 10);
  if (!drNumber || isNaN(stepNum)) return apiResponse.badRequest(res, 'drNumber and step required');

  const { rows } = await pool.query<{
    id: string; status: string; denial_reason: string | null;
  }>(
    `SELECT id, status, denial_reason
     FROM sitecam_appeals
     WHERE dr_number = $1 AND step_number = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [drNumber, stepNum],
  );

  if (!rows[0]) return apiResponse.success(res, { status: 'none' });

  return apiResponse.success(res, {
    appealId: rows[0].id,
    status: rows[0].status,
    denialReason: rows[0].denial_reason,
  });
}

export default withMySession(handler);
```

- [ ] **Step 3: List appeals (FibreFlow)**

Create `pages/api/activate/sitecam-appeals.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);

  const statusFilter = (req.query.status as string) || 'pending';

  const { rows } = await pool.query(
    `SELECT a.id, a.dr_number, a.step_number, a.appeal_text, a.photo_url,
            a.serial_scanned, a.serial_expected, a.attempt_number,
            a.status, a.decided_via, a.decided_at, a.denial_reason, a.created_at,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM sitecam_appeals a
     LEFT JOIN staff s ON s.id = a.technician_id
     WHERE a.status = $1
     ORDER BY a.created_at DESC
     LIMIT 100`,
    [statusFilter],
  );

  return apiResponse.success(res, { appeals: rows });
}

export default withAuth(handler);
```

- [ ] **Step 4: Decision endpoint (approve/deny)**

Create `pages/api/activate/sitecam-appeals/[id]/decision.ts`:

```typescript
import type { NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

const MODULE = 'sitecam-appeal-decision';

async function handler(req: AuthenticatedNextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST')
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);

  const { id } = req.query as { id: string };
  const { decision, denialReason } = req.body as { decision: 'approved' | 'denied'; denialReason?: string };

  if (!id) return apiResponse.badRequest(res, 'appeal id required');
  if (decision !== 'approved' && decision !== 'denied')
    return apiResponse.badRequest(res, 'decision must be approved or denied');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query<{ dr_number: string; step_number: number }>(
      `UPDATE sitecam_appeals
       SET status = $1,
           decided_by = $2,
           decided_via = 'in_app',
           decided_at = now(),
           denial_reason = $3
       WHERE id = $4
       RETURNING dr_number, step_number`,
      [decision, req.user.id, denialReason ?? null, id],
    );

    if (!rows[0]) {
      await client.query('ROLLBACK');
      return apiResponse.notFound(res, 'Appeal', id);
    }

    await client.query('COMMIT');
    log.info('Appeal decision recorded', { id, decision }, MODULE);
    return apiResponse.success(res, { ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default withAuth(handler);
```

- [ ] **Step 5: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add pages/api/my/sitecam/appeal.ts \
        "pages/api/my/sitecam/appeal-status/[drNumber]/[step].ts" \
        pages/api/activate/sitecam-appeals.ts \
        "pages/api/activate/sitecam-appeals/[id]/decision.ts"
git commit -m "feat(sitecam): appeal API — submit, poll status, list, approve/deny"
```

---

### Task 8: AppealModal Component

**Files:**
- Create: `src/modules/sitecam/components/AppealModal.tsx`

- [ ] **Step 1: Create the component**

```typescript
// src/modules/sitecam/components/AppealModal.tsx
import { useState } from 'react';
import { X, Send } from 'lucide-react';
import { log } from '@/lib/logger';

const MODULE = 'AppealModal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSubmitted: (appealId: string) => void;
  drNumber: string;
  stepNumber: number;
  stepLabel: string;
  photoUrl: string | null;
  serialScanned?: string;
  serialExpected?: string;
  attemptNumber: number;
}

export function AppealModal({
  isOpen, onClose, onSubmitted,
  drNumber, stepNumber, stepLabel,
  photoUrl, serialScanned, serialExpected, attemptNumber,
}: Props) {
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit() {
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const photo = photoUrl?.startsWith('data:') ? photoUrl : `data:image/jpeg;base64,${photoUrl}`;
      const res = await fetch('/api/my/sitecam/appeal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drNumber,
          stepNumber,
          appealText: text.trim(),
          photoUrl: photo,
          serialScanned,
          serialExpected,
          attemptNumber,
        }),
      });
      const json = (await res.json()) as { data?: { appealId: string }; error?: string };
      if (!res.ok || !json.data?.appealId) {
        setError(json.error ?? 'Failed to submit appeal');
        return;
      }
      onSubmitted(json.data.appealId);
      setText('');
      onClose();
    } catch (err) {
      log.error('Appeal submit failed', { err: String(err) }, MODULE);
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 px-4 pb-6">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-700 bg-neutral-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-100">
            Appeal Step {stepNumber}: {stepLabel}
          </h3>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          Explain why this photo is correct. Your photo will be attached automatically.
        </p>

        {photoUrl && (
          <img
            src={photoUrl.startsWith('data:') ? photoUrl : `data:image/jpeg;base64,${photoUrl}`}
            alt="Step photo"
            className="h-36 w-full rounded-lg object-cover border border-neutral-700"
          />
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Describe why the photo is correct…"
          rows={3}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-sky-500"
        />

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-neutral-700 py-3 text-sm text-neutral-400 hover:bg-neutral-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!text.trim() || submitting}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-sm font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
          >
            <Send className="h-4 w-4" />
            {submitting ? 'Sending…' : 'Send Appeal'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/sitecam/components/AppealModal.tsx
git commit -m "feat(sitecam): AppealModal component for PWA step appeals"
```

---

### Task 9: Wire Appeal into SiteCamWizard

**Files:**
- Modify: `src/modules/sitecam/components/SiteCamWizard.tsx`

- [ ] **Step 1: Find StepCapture usage**

```bash
grep -n "StepCapture\|captureAndValidate\|handleSerial" src/modules/sitecam/components/SiteCamWizard.tsx
```

- [ ] **Step 2: Add appeal state and wire AppealModal**

At the top of the component, add:

```typescript
const [appealOpen, setAppealOpen] = useState(false);
```

Replace the existing `<StepCapture>` usage with:

```tsx
<StepCapture
  step={currentStep}
  drNumber={siteInfo.siteId}
  onCapture={captureAndValidate}
  onSerialSaved={handleSerialSaved}
  onAppeal={() => setAppealOpen(true)}
/>

{currentStep && (
  <AppealModal
    isOpen={appealOpen}
    onClose={() => setAppealOpen(false)}
    onSubmitted={(appealId) => {
      setAppealOpen(false);
      log.info('Appeal submitted', { appealId }, 'SiteCamWizard');
    }}
    drNumber={siteInfo.siteId}
    stepNumber={currentStep.stepNumber}
    stepLabel={currentStep.label}
    photoUrl={currentStep.photoBase64}
    serialScanned={currentStep.serialScanned ?? undefined}
    attemptNumber={
      currentStep.status === 'serial_scan' || currentStep.status === 'serial_pending'
        ? currentStep.serialAttempts
        : currentStep.attemptNumber
    }
  />
)}
```

Add imports at top:

```typescript
import { AppealModal } from './AppealModal';
import { log } from '@/lib/logger';
```

- [ ] **Step 3: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/sitecam/components/SiteCamWizard.tsx
git commit -m "feat(sitecam): wire AppealModal into SiteCamWizard"
```

---

### Task 10: FibreFlow Appeals Queue Page

**Files:**
- Create: `src/modules/activate/components/SiteCamAppealsQueue.tsx`
- Create: `pages/activate/sitecam-appeals.tsx`

- [ ] **Step 1: Create the queue component**

```typescript
// src/modules/activate/components/SiteCamAppealsQueue.tsx
'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { log } from '@/lib/logger';

interface Appeal {
  id: string;
  dr_number: string;
  step_number: number;
  appeal_text: string;
  photo_url: string;
  serial_scanned: string | null;
  serial_expected: string | null;
  attempt_number: number;
  status: 'pending' | 'approved' | 'denied';
  created_at: string;
  tech_name: string | null;
  denial_reason: string | null;
}

const STEP_LABELS: Record<number, string> = {
  1: 'House Photo', 2: 'Cable from Pole', 3: 'Entry Outside',
  4: 'Entry Inside', 5: 'Wall Mount', 6: 'ONT Back After Install',
  7: 'Power Meter', 8: 'Final Installation', 9: 'Green Lights',
  10: 'Signature', 11: 'Dome Joint Open', 12: 'Dome Joint Closed',
};

export function SiteCamAppealsQueue() {
  const [tab, setTab] = useState<'pending' | 'approved' | 'denied'>('pending');
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [denialText, setDenialText] = useState('');

  async function load(status: typeof tab) {
    setLoading(true);
    try {
      const r = await fetch(`/api/activate/sitecam-appeals?status=${status}`, { credentials: 'include' });
      const j = (await r.json()) as { data: { appeals: Appeal[] } };
      setAppeals(j.data.appeals);
    } catch (err) {
      log.error('Load appeals failed', { err: String(err) }, 'SiteCamAppealsQueue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(tab); }, [tab]);

  async function decide(id: string, decision: 'approved' | 'denied') {
    setDeciding(id);
    try {
      await fetch(`/api/activate/sitecam-appeals/${id}/decision`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, denialReason: decision === 'denied' ? denialText : undefined }),
      });
      setDenialText('');
      setExpanded(null);
      await load(tab);
    } catch (err) {
      log.error('Decision failed', { err: String(err) }, 'SiteCamAppealsQueue');
    } finally {
      setDeciding(null);
    }
  }

  const tabs: Array<typeof tab> = ['pending', 'approved', 'denied'];

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-neutral-200 pb-2">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize rounded-t ${
              tab === t ? 'border-b-2 border-sky-600 text-sky-700' : 'text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      )}

      {!loading && appeals.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-400">No {tab} appeals</p>
      )}

      <div className="space-y-2">
        {appeals.map((a) => (
          <div key={a.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setExpanded(expanded === a.id ? null : a.id)}
            >
              <div>
                <span className="font-medium text-neutral-800">{a.dr_number}</span>
                <span className="mx-2 text-neutral-400">·</span>
                <span className="text-sm text-neutral-600">
                  Step {a.step_number}: {STEP_LABELS[a.step_number] ?? ''}
                </span>
                <span className="mx-2 text-neutral-400">·</span>
                <span className="text-xs text-neutral-500">{a.tech_name ?? 'Unknown'}</span>
              </div>
              {expanded === a.id
                ? <ChevronUp className="h-4 w-4 text-neutral-400" />
                : <ChevronDown className="h-4 w-4 text-neutral-400" />}
            </button>

            {expanded === a.id && (
              <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
                <p className="text-sm text-neutral-700">{a.appeal_text}</p>
                {a.serial_scanned && (
                  <div className="text-xs text-neutral-500 space-y-1">
                    <p>Serial scanned: <span className="font-mono">{a.serial_scanned}</span></p>
                    <p>Expected: <span className="font-mono">{a.serial_expected ?? 'unknown'}</span></p>
                  </div>
                )}
                <img
                  src={a.photo_url}
                  alt="Appeal photo"
                  className="h-48 w-full rounded-lg object-contain border border-neutral-200 bg-neutral-50"
                />
                {tab === 'pending' && (
                  <div className="space-y-3">
                    <textarea
                      value={denialText}
                      onChange={(e) => setDenialText(e.target.value)}
                      placeholder="Denial reason (required if denying)…"
                      rows={2}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={deciding === a.id}
                        onClick={() => decide(a.id, 'approved')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={deciding === a.id || !denialText.trim()}
                        onClick={() => decide(a.id, 'denied')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" /> Deny
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the page**

```typescript
// pages/activate/sitecam-appeals.tsx
import AppLayout from '@/components/AppLayout';
import { SiteCamAppealsQueue } from '@/modules/activate/components/SiteCamAppealsQueue';

export default function SiteCamAppealsPage() {
  return (
    <AppLayout title="SiteCam Appeals">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        <h1 className="text-xl font-bold text-neutral-800">SiteCam Appeals</h1>
        <SiteCamAppealsQueue />
      </div>
    </AppLayout>
  );
}
```

- [ ] **Step 3: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/activate/components/SiteCamAppealsQueue.tsx \
        pages/activate/sitecam-appeals.tsx
git commit -m "feat(sitecam): SiteCam Appeals queue page in FibreFlow"
```

---

## Phase D — PwaComparisonTab Enhancement

### Task 11: Enhance PwaComparisonTab

**Files:**
- Modify: `pages/api/sitecam/submission/[drNumber].ts`
- Modify: `src/modules/activate/components/PwaComparisonTab.tsx`

- [ ] **Step 1: Read the current submission API to understand its structure**

```bash
cat pages/api/sitecam/submission/[drNumber].ts
```

- [ ] **Step 2: Extend submission API with serial status**

In `pages/api/sitecam/submission/[drNumber].ts`, extend the query to include serial scan columns and power meter VLM result:

```typescript
  const { rows } = await pool.query(
    `SELECT r.pwa_submission_at,
            r.pwa_photo_count,
            r.pwa_photo_urls,
            r.ont_serial_scanned,
            r.ont_serial_status,
            r.ups_serial_scanned,
            r.ups_serial_status,
            r.vlm_power_meter_dbm,
            r.vlm_power_meter_status,
            s.first_name || ' ' || s.last_name AS tech_name
     FROM dr_photo_unified_reviews r
     LEFT JOIN staff s ON s.id = r.pwa_tech_id
     WHERE r.drop_number = $1
       AND r.pwa_submission_at IS NOT NULL
     LIMIT 1`,
    [drNum]
  );
```

NOTE: `vlm_power_meter_dbm` and `vlm_power_meter_status` may not yet exist on this table — add `IF EXISTS` column checks via `pg_attribute` or use `LEFT JOIN LATERAL` to handle gracefully. Alternatively, check whether these columns exist first:

```bash
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow \
  -c "\d dr_photo_unified_reviews" | grep vlm_power
```

If columns don't exist, omit them from the query for now and add `powerMeterDbm: null, powerMeterStatus: null` in the response.

Update the returned object:

```typescript
  return apiResponse.success(res, {
    submission: {
      submittedAt: row.pwa_submission_at,
      techName: row.tech_name ?? 'Unknown',
      photoCount: row.pwa_photo_count,
      photoUrls: row.pwa_photo_urls ?? {},
      ontSerialScanned: row.ont_serial_scanned ?? null,
      ontSerialStatus: row.ont_serial_status ?? null,
      upsSerialScanned: row.ups_serial_scanned ?? null,
      upsSerialStatus: row.ups_serial_status ?? null,
      powerMeterDbm: row.vlm_power_meter_dbm ?? null,
      powerMeterStatus: row.vlm_power_meter_status ?? null,
    },
  });
```

- [ ] **Step 3: Update `PwaSubmission` interface and render badges in `PwaComparisonTab.tsx`**

Read the current `PwaComparisonTab.tsx` first to understand its structure, then update the `PwaSubmission` interface:

```typescript
interface PwaSubmission {
  submittedAt: string;
  techName: string;
  photoCount: number;
  photoUrls: Record<number, string>;
  ontSerialScanned: string | null;
  ontSerialStatus: string | null;
  upsSerialScanned: string | null;
  upsSerialStatus: string | null;
  powerMeterDbm: number | null;
  powerMeterStatus: string | null;
}
```

Add a `SerialBadge` helper component before the main component:

```typescript
function SerialBadge({ serial, status }: { serial: string | null; status: string | null }) {
  if (!serial) return null;
  const colour =
    status === 'pass'    ? 'text-green-600 bg-green-50' :
    status === 'fail'    ? 'text-red-600 bg-red-50' :
    status === 'pending' ? 'text-amber-600 bg-amber-50' :
    'text-neutral-500 bg-neutral-100';
  const icon =
    status === 'pass' ? '✓' :
    status === 'fail' ? '✗' :
    status === 'pending' ? '⏳' : '?';
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono ${colour}`}>
      {icon} {serial}
    </span>
  );
}
```

Inside the step grid, add serial badge on step 6 and 8, and power meter on step 7, below each tile image:

```tsx
{/* Serial badge for ONT (step 6) */}
{stepNumber === 6 && (
  <div className="px-2 py-1">
    <SerialBadge serial={submission.ontSerialScanned} status={submission.ontSerialStatus} />
  </div>
)}
{/* Serial badge for UPS (step 8) */}
{stepNumber === 8 && (
  <div className="px-2 py-1">
    <SerialBadge serial={submission.upsSerialScanned} status={submission.upsSerialStatus} />
  </div>
)}
{/* Power meter (step 7) */}
{stepNumber === 7 && submission.powerMeterDbm !== null && (
  <div className="px-2 py-1 text-xs text-gray-400">
    {submission.powerMeterDbm} dBm
    {submission.powerMeterStatus === 'pass' ? ' ✓' : ' ✗'}
  </div>
)}
```

- [ ] **Step 4: Run lint + type-check**

```bash
npm run ci:quick
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "pages/api/sitecam/submission/[drNumber].ts" \
        src/modules/activate/components/PwaComparisonTab.tsx
git commit -m "feat(sitecam): enhance PwaComparisonTab with serial status badges + power meter"
```

---

## Final Steps

- [ ] **Run full CI locally**

```bash
npm run ci
```

Expected: all lint, type-check, and tests pass.

- [ ] **Add `SITECAM_APPEAL_GROUP_JID` to `.env.local` (dev testing)**

```
SITECAM_APPEAL_GROUP_JID=<the WhatsApp group JID for the SiteCam approval group>
```

Ask Hein for the group JID.

- [ ] **Create the PR**

```bash
git push -u origin feat/sitecam-serial-appeals
gh pr create \
  --title "feat(sitecam): serial scanning, photos tab, and step appeal system" \
  --body "$(cat <<'EOF'
## Summary
- **Change 1:** ONT + UPS barcode scan on Steps 6 & 8 — format validation at scan time (ALCL prefix = ONT, GU prefix = UPS), serial saved as \`pending\` for async cross-reference against 1Map + OES
- **Change 2:** Enhanced PwaComparisonTab in UnifiedReviewCard with serial status badges (pending/pass/fail) and power meter readings per step
- **Change 3:** Step appeal system — PWA appeal form, WhatsApp approval group notification, FibreFlow in-app queue with approve/deny

## Migration
Migration 402: adds \`ont_serial_attempts\`, \`ont_serial_status\`, \`ups_serial_attempts\`, \`ups_serial_status\` to \`dr_photo_unified_reviews\`; creates \`sitecam_appeals\` table.

## Serial Verification Design
Serials are validated at scan time by prefix only (no comparison — nothing to compare against yet). Status = \`pending\` until FibreFlow cross-references against 1Map and OES (future sprint). Appeal system handles both VLM photo rejections and future serial cross-ref failures.

## Test plan
- [ ] Open a DR in SiteCam, reach Step 6, take photo, scan an ALCL barcode → serial saved as pending, step advances
- [ ] Scan a non-ALCL barcode at Step 6 → error shown, retry prompt
- [ ] Scan a GU barcode at Step 8 → serial saved as pending
- [ ] Submit a photo appeal → appeal appears in /activate/sitecam-appeals
- [ ] Approve appeal → appeal marked approved
- [ ] Open UnifiedReviewCard for a submitted DR → SiteCam Photos tab shows serial pending badges

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Wait for Hein's approval before deploying**
