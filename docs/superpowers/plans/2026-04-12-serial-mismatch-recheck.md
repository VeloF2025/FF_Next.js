# Serial Mismatch Auto-Recheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When WA monitor QA feedback is sent with a serial mismatch, automatically re-analyse the photo with VLM, send a follow-up WhatsApp message (correction or verify), and log to VLM learning.

**Architecture:** New `recheck-serial-mismatch` API endpoint owns the full flow; `send-feedback` fires it after detecting a mismatch; `SerialRecheckPanel` component provides the manual trigger in the UnifiedReviewCard Feedback tab. Core recheck logic lives in `serialRecheckService.ts`.

**Tech Stack:** Next.js API routes, Neon PostgreSQL (`neon()` tagged template), VLM via `callVlmExtraction`, WA bridge via `WA_FEEDBACK_URL` (port 8092), TailwindCSS, Lucide icons.

**Worktree:** All work happens in `/home/hein/Workspace/FF_Next.js-serial-recheck` on branch `feature/serial-mismatch-recheck`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `neon/migrations/20260412_create_serial_recheck_log.sql` | Create | DB table for recheck audit log |
| `src/types/vlm-learning.ts` | Modify | Add `'wa_serial_recheck'` analysis type |
| `src/modules/activate/services/waPhotoExtraction.ts` | Modify | Export targeted second-pass extraction function |
| `src/modules/activate/services/serialRecheckService.ts` | Create | Core recheck orchestration (fetch → VLM → threshold → learn → WA send) |
| `pages/api/activate/recheck-serial-mismatch.ts` | Create | Auth-protected API endpoint calling the service |
| `pages/api/activate/send-feedback.ts` | Modify | Fire-and-forget recheck trigger after mismatch detected |
| `src/modules/activate/components/SerialRecheckPanel.tsx` | Create | UI: Re-analyse button + result card |
| `src/modules/activate/components/UnifiedReviewCard.tsx` | Modify | Mount SerialRecheckPanel in Feedback tab |
| `tests/api/activate/recheck-serial-mismatch.test.ts` | Create | Unit tests for threshold logic |

---

## Task 1: Database Migration

**Files:**
- Create: `neon/migrations/20260412_create_serial_recheck_log.sql`

- [ ] **Step 1.1: Write migration file**

```sql
-- Migration: 20260412_create_serial_recheck_log
-- Creates audit log table for serial mismatch recheck operations

CREATE TABLE IF NOT EXISTS serial_recheck_log (
  id                      SERIAL PRIMARY KEY,
  drop_number             TEXT NOT NULL,
  triggered_by            TEXT NOT NULL CHECK (triggered_by IN ('auto', 'manual')),
  rechecker_user_id       TEXT,
  recheck_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  serial_type             TEXT NOT NULL CHECK (serial_type IN ('ups', 'ont', 'both')),
  first_pass_serial       TEXT,
  second_pass_serial      TEXT,
  second_pass_confidence  NUMERIC(4,3),
  outcome                 TEXT NOT NULL CHECK (outcome IN ('correction', 'verify', 'unclear')),
  onemap_serial           TEXT,
  wa_message_sent         BOOLEAN NOT NULL DEFAULT FALSE,
  wa_message_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS serial_recheck_log_drop_number_idx
  ON serial_recheck_log (drop_number);

CREATE INDEX IF NOT EXISTS serial_recheck_log_recheck_at_idx
  ON serial_recheck_log (recheck_at DESC);
```

- [ ] **Step 1.2: Run migration against Neon**

```bash
cd /home/hein/Workspace/FF_Next.js-serial-recheck
psql "$DATABASE_URL" -f neon/migrations/20260412_create_serial_recheck_log.sql
```

Expected: `CREATE TABLE`, `CREATE INDEX`, `CREATE INDEX`

- [ ] **Step 1.3: Verify table exists**

```bash
psql "$DATABASE_URL" -c "\d serial_recheck_log"
```

Expected: table definition with all 13 columns shown.

- [ ] **Step 1.4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-serial-recheck
git add neon/migrations/20260412_create_serial_recheck_log.sql
git commit -m "feat(db): add serial_recheck_log migration"
```

---

## Task 2: Add VLM Analysis Type

**Files:**
- Modify: `src/types/vlm-learning.ts:22-51`

- [ ] **Step 2.1: Write failing test**

Create `tests/types/vlm-learning.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { VlmAnalysisType } from '@/types/vlm-learning';

describe('VlmAnalysisType', () => {
  it('includes wa_serial_recheck', () => {
    // Type-level test: if this compiles, the type exists
    const type: VlmAnalysisType = 'wa_serial_recheck';
    expect(type).toBe('wa_serial_recheck');
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
cd /home/hein/Workspace/FF_Next.js-serial-recheck
npm test tests/types/vlm-learning.test.ts 2>&1 | tail -20
```

Expected: TypeScript compile error — `'wa_serial_recheck'` is not assignable.

- [ ] **Step 2.3: Add the type**

In `src/types/vlm-learning.ts`, find the `VlmAnalysisType` union (line ~31) and add `'wa_serial_recheck'` after `'wa_photo_serial'`:

```typescript
export type VlmAnalysisType =
  // Activate module
  | 'photo_categorization'
  | 'power_meter_dbm'
  | 'ont_serial_back'
  | 'ont_serial_front'
  | 'dr_number'
  | 'dr_qa_validation'
  | 'green_lights_check'
  | 'wa_photo_serial'
  | 'wa_serial_recheck'       // ← add this line
  // Fleet module
  // ... rest unchanged
```

Also add `'wa_serial_recheck'` to `ANALYSIS_TYPES_BY_MODULE` under `activate`:

```typescript
export const ANALYSIS_TYPES_BY_MODULE: Record<VlmModule, VlmAnalysisType[]> = {
  activate: [
    'photo_categorization',
    'power_meter_dbm',
    'ont_serial_back',
    'ont_serial_front',
    'dr_number',
    'dr_qa_validation',
    'green_lights_check',
    'wa_photo_serial',
    'wa_serial_recheck',   // ← add this line
  ],
  // ... rest unchanged
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
npm test tests/types/vlm-learning.test.ts 2>&1 | tail -10
```

Expected: `✓ includes wa_serial_recheck`

- [ ] **Step 2.5: Commit**

```bash
git add src/types/vlm-learning.ts tests/types/vlm-learning.test.ts
git commit -m "feat(types): add wa_serial_recheck VLM analysis type"
```

---

## Task 3: Second-Pass VLM Extraction Function

**Files:**
- Modify: `src/modules/activate/services/waPhotoExtraction.ts`

- [ ] **Step 3.1: Write failing test**

Create `tests/activate/services/waPhotoExtraction.recheck.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock VLM call
vi.mock('@/modules/activate/services/vlmClient', () => ({
  callVlmExtraction: vi.fn(),
  preprocessForVlm: vi.fn(async (b64: string) => ({ base64: b64 })),
  vlmLogger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  ENABLE_BARCODE_EXTRACTION: false,
}));

vi.mock('@/modules/activate/services/photoFetchService', () => ({
  fetchPhotoAsBase64: vi.fn(async () => 'base64data'),
}));

import { callVlmExtraction } from '@/modules/activate/services/vlmClient';
import { extractUpsSerialRecheck, extractOntSerialRecheck } from '@/modules/activate/services/waPhotoExtraction';

describe('extractUpsSerialRecheck', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns serial and confidence when VLM succeeds above threshold', async () => {
    vi.mocked(callVlmExtraction).mockResolvedValueOnce({
      success: true,
      data: { upsSerial: { found: true, serial: 'GU18W12V2511020289', confidence: 0.92 } },
    });

    const result = await extractUpsSerialRecheck('http://example.com/photo.jpg');
    expect(result.serial).toBe('GU18W12V2511020289');
    expect(result.confidence).toBeCloseTo(0.92);
    expect(result.success).toBe(true);
  });

  it('returns null serial when VLM confidence is below floor', async () => {
    vi.mocked(callVlmExtraction).mockResolvedValueOnce({
      success: true,
      data: { upsSerial: { found: true, serial: 'GU18W12V2511020289', confidence: 0.5 } },
    });

    const result = await extractUpsSerialRecheck('http://example.com/photo.jpg');
    expect(result.serial).toBeNull();
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npm test tests/activate/services/waPhotoExtraction.recheck.test.ts 2>&1 | tail -20
```

Expected: FAIL — `extractUpsSerialRecheck is not a function`

- [ ] **Step 3.3: Add targeted extraction functions**

At the bottom of `src/modules/activate/services/waPhotoExtraction.ts`, add:

```typescript
// ============================================================================
// RECHECK-MODE EXTRACTION (targeted second-pass prompts)
// ============================================================================

const UPS_RECHECK_PROMPT = `Second look at a Gizzu UPS sticker photo.

A previous read may have misidentified the UPS serial. Look very carefully.

The REAL serial is the long string printed BELOW the barcode on the Gizzu sticker.
Format: GU18W12V + exactly 10 numeric digits = 18 characters total.

Rules:
- The small "GU18W12V" text ABOVE the barcode is the MODEL CODE, not the serial.
- The sticker is OFTEN ROTATED — rotate mentally before reading.
- Do NOT pad with zeros. Do NOT invent digits. null is correct when uncertain.
- If a digit is ambiguous, describe what you see (e.g. "looks like 2 or Z").

Respond ONLY in JSON:
{"upsSerial":{"found":true,"serial":"GU18W12V##########","confidence":0.95}}
or
{"upsSerial":{"found":false,"serial":null,"confidence":0.0}}`;

const ONT_RECHECK_PROMPT = `Second look at an ONT barcode/sticker photo.

A previous read may have misidentified the ONT serial. Look very carefully.

Format: ALCLB4 + 6 hex characters = exactly 12 characters.
- Only hex digits after ALCLB4 (0-9, A-F only — no M, N, P, R, S, Y, Z).
- Never read an SSID (starts with ALHN-) or model number (starts with STN).

Respond ONLY in JSON:
{"ontSerial":{"found":true,"serial":"ALCLB4######","confidence":0.95}}
or
{"ontSerial":{"found":false,"serial":null,"confidence":0.0}}`;

export interface RecheckExtractionResult {
  success: boolean;
  serial: string | null;
  confidence: number;
  error?: string;
}

/**
 * Run a targeted second-pass VLM extraction for UPS serial specifically.
 * Used by the serial recheck system when a mismatch is detected.
 */
export async function extractUpsSerialRecheck(
  photoUrl: string
): Promise<RecheckExtractionResult> {
  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);
    const preprocessed = await preprocessForVlm(base64, 'UPS recheck');
    base64 = preprocessed.base64;

    const result = await callVlmExtraction<{
      upsSerial: { found: boolean; serial: string | null; confidence: number };
    }>(base64, UPS_RECHECK_PROMPT, 'UPS serial recheck');

    if (!result.success || !result.data) {
      return { success: false, serial: null, confidence: 0, error: result.error };
    }

    const { upsSerial } = result.data;
    if (!upsSerial.found || !upsSerial.serial) {
      return { success: false, serial: null, confidence: upsSerial.confidence };
    }

    if (upsSerial.confidence < VLM_CONFIDENCE_FLOOR) {
      vlmLogger.warn(`UPS recheck below floor (${upsSerial.confidence.toFixed(2)}): ${upsSerial.serial}`);
      return { success: false, serial: null, confidence: upsSerial.confidence };
    }

    const normalized = upsSerial.serial.trim().toUpperCase().replace(/[\s-]/g, '');
    if (!isValidUpsSerial(normalized)) {
      vlmLogger.warn(`UPS recheck invalid serial: ${upsSerial.serial}`);
      return { success: false, serial: null, confidence: upsSerial.confidence };
    }

    return { success: true, serial: normalized, confidence: upsSerial.confidence };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, serial: null, confidence: 0, error: msg };
  }
}

/**
 * Run a targeted second-pass VLM extraction for ONT serial specifically.
 * Used by the serial recheck system when a mismatch is detected.
 */
export async function extractOntSerialRecheck(
  photoUrl: string
): Promise<RecheckExtractionResult> {
  try {
    let base64 = await fetchPhotoAsBase64(photoUrl);
    const preprocessed = await preprocessForVlm(base64, 'ONT recheck');
    base64 = preprocessed.base64;

    const result = await callVlmExtraction<{
      ontSerial: { found: boolean; serial: string | null; confidence: number };
    }>(base64, ONT_RECHECK_PROMPT, 'ONT serial recheck');

    if (!result.success || !result.data) {
      return { success: false, serial: null, confidence: 0, error: result.error };
    }

    const { ontSerial } = result.data;
    if (!ontSerial.found || !ontSerial.serial) {
      return { success: false, serial: null, confidence: ontSerial.confidence };
    }

    if (ontSerial.confidence < VLM_CONFIDENCE_FLOOR) {
      vlmLogger.warn(`ONT recheck below floor (${ontSerial.confidence.toFixed(2)}): ${ontSerial.serial}`);
      return { success: false, serial: null, confidence: ontSerial.confidence };
    }

    const normalized = normalizeSerial(ontSerial.serial);
    if (!isValidOntSerial(normalized)) {
      vlmLogger.warn(`ONT recheck invalid serial: ${ontSerial.serial}`);
      return { success: false, serial: null, confidence: ontSerial.confidence };
    }

    return { success: true, serial: normalized, confidence: ontSerial.confidence };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, serial: null, confidence: 0, error: msg };
  }
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
npm test tests/activate/services/waPhotoExtraction.recheck.test.ts 2>&1 | tail -15
```

Expected: `✓ returns serial and confidence when VLM succeeds above threshold`, `✓ returns null serial when VLM confidence is below floor`

- [ ] **Step 3.5: Commit**

```bash
git add src/modules/activate/services/waPhotoExtraction.ts \
        tests/activate/services/waPhotoExtraction.recheck.test.ts
git commit -m "feat(vlm): add targeted UPS/ONT recheck extraction functions"
```

---

## Task 4: Recheck Service (Core Logic)

**Files:**
- Create: `src/modules/activate/services/serialRecheckService.ts`

- [ ] **Step 4.1: Write failing tests**

Create `tests/activate/services/serialRecheckService.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db-neon', () => ({
  neon: vi.fn(() => vi.fn()),
}));

vi.mock('@/modules/activate/services/waPhotoExtraction', () => ({
  extractUpsSerialRecheck: vi.fn(),
  extractOntSerialRecheck: vi.fn(),
}));

vi.mock('@/services/vlmLearningService', () => ({
  recordVlmCorrection: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { determineRecheckOutcome } from '@/modules/activate/services/serialRecheckService';

describe('determineRecheckOutcome', () => {
  it('returns correction when confidence > 0.85 and matches 1Map', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.9,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('correction');
  });

  it('returns verify when confidence > 0.85 but does NOT match 1Map', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: 'GU18W12V9999999999',
      confidence: 0.9,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('verify');
  });

  it('returns verify when confidence between 0.65 and 0.85', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.75,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('verify');
  });

  it('returns unclear when confidence is below 0.65', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: null,
      confidence: 0.4,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('unclear');
  });

  it('returns unclear when second pass serial is null', () => {
    const result = determineRecheckOutcome({
      secondPassSerial: null,
      confidence: 0,
      onemapSerial: 'GU18W12V2511020289',
    });
    expect(result).toBe('unclear');
  });
});

describe('buildRecheckWaMessage', () => {
  it('formats correction message correctly', async () => {
    const { buildRecheckWaMessage } = await import('@/modules/activate/services/serialRecheckService');
    const msg = buildRecheckWaMessage({
      dropNumber: 'DR474849',
      serialType: 'ups',
      outcome: 'correction',
      onemapSerial: 'GU18W12V2511020289',
      firstPassSerial: 'GUJ8W12V12511020289',
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.92,
    });
    expect(msg).toContain('DR474849');
    expect(msg).toContain('1Map serial confirmed');
    expect(msg).toContain('GU18W12V2511020289');
    expect(msg).toContain('No action needed');
  });

  it('formats verify message with confidence percent', async () => {
    const { buildRecheckWaMessage } = await import('@/modules/activate/services/serialRecheckService');
    const msg = buildRecheckWaMessage({
      dropNumber: 'DR474849',
      serialType: 'ups',
      outcome: 'verify',
      onemapSerial: 'GU18W12V2511020289',
      firstPassSerial: 'GUJ8W12V12511020289',
      secondPassSerial: 'GUJ8W12V12511020289',
      confidence: 0.72,
    });
    expect(msg).toContain('72%');
    expect(msg).toContain('Please verify');
  });

  it('formats unclear message', async () => {
    const { buildRecheckWaMessage } = await import('@/modules/activate/services/serialRecheckService');
    const msg = buildRecheckWaMessage({
      dropNumber: 'DR474849',
      serialType: 'ups',
      outcome: 'unclear',
      onemapSerial: 'GU18W12V2511020289',
      firstPassSerial: 'GUJ8W12V12511020289',
      secondPassSerial: null,
      confidence: 0,
    });
    expect(msg).toContain("couldn't read");
    expect(msg).toContain('1Map: GU18W12V2511020289');
  });
});
```

- [ ] **Step 4.2: Run tests to verify they fail**

```bash
npm test tests/activate/services/serialRecheckService.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '...serialRecheckService'`

- [ ] **Step 4.3: Create the service**

Create `src/modules/activate/services/serialRecheckService.ts`:

```typescript
/**
 * Serial Recheck Service
 *
 * Orchestrates second-pass VLM re-analysis for serial mismatches.
 * Called by the recheck-serial-mismatch API route.
 *
 * Status: WORKING
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { recordVlmCorrection } from '@/services/vlmLearningService';
import { extractUpsSerialRecheck, extractOntSerialRecheck } from './waPhotoExtraction';

const sql = neon(process.env.DATABASE_URL!);

// WA feedback service — same port as send-feedback.ts
const WA_FEEDBACK_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';

// ============================================================================
// TYPES
// ============================================================================

export type RecheckOutcome = 'correction' | 'verify' | 'unclear';
export type RecheckSerialType = 'ups' | 'ont' | 'both';

export interface RecheckResult {
  outcome: RecheckOutcome;
  serialType: RecheckSerialType;
  secondPassSerial: string | null;
  confidence: number | null;
  waMessageSent: boolean;
  learningLogged: boolean;
}

export interface OutcomeInput {
  secondPassSerial: string | null;
  confidence: number;
  onemapSerial: string | null;
}

export interface WaMessageInput {
  dropNumber: string;
  serialType: RecheckSerialType;
  outcome: RecheckOutcome;
  onemapSerial: string | null;
  firstPassSerial: string | null;
  secondPassSerial: string | null;
  confidence: number;
}

// ============================================================================
// THRESHOLD LOGIC (exported for testing)
// ============================================================================

export function determineRecheckOutcome(input: OutcomeInput): RecheckOutcome {
  const { secondPassSerial, confidence, onemapSerial } = input;

  if (!secondPassSerial || confidence < 0.65) {
    return 'unclear';
  }

  if (
    confidence > 0.85 &&
    onemapSerial &&
    secondPassSerial.toUpperCase() === onemapSerial.toUpperCase()
  ) {
    return 'correction';
  }

  return 'verify';
}

// ============================================================================
// WA MESSAGE BUILDER (exported for testing)
// ============================================================================

export function buildRecheckWaMessage(input: WaMessageInput): string {
  const { dropNumber, serialType, outcome, onemapSerial, firstPassSerial, secondPassSerial, confidence } = input;
  const typeLabel = serialType === 'ups' ? 'UPS' : serialType === 'ont' ? 'ONT' : 'UPS & ONT';

  let message = `🔍 Second Look — ${dropNumber}\n\n`;

  if (outcome === 'correction') {
    message += `We re-analysed the ${typeLabel} serial photo.\n`;
    message += `✅ 1Map serial confirmed: ${onemapSerial}\n`;
    message += `❌ Our first read was incorrect: ${firstPassSerial}\n\n`;
    message += `No action needed — 1Map is correct.`;
  } else if (outcome === 'verify') {
    const pct = Math.round(confidence * 100);
    message += `We re-analysed the ${typeLabel} serial photo (${pct}% confidence).\n`;
    message += `⚠️ Please verify the serial on the physical box vs 1Map.\n\n`;
    message += `📦 1Map: ${onemapSerial}\n`;
    message += `📸 We read: ${secondPassSerial || firstPassSerial}`;
  } else {
    // unclear
    message += `⚠️ We couldn't read the ${typeLabel} serial clearly.\n`;
    message += `Please verify the physical box serial against 1Map.\n\n`;
    message += `📦 1Map: ${onemapSerial}`;
  }

  return message;
}

// ============================================================================
// CORE ORCHESTRATION
// ============================================================================

interface WaPhotoRow {
  id: number;
  local_path: string;
  original_filename: string | null;
  vlm_ups_serial: string | null;
  vlm_ont_serial: string | null;
}

interface ReviewRow {
  ont_serial_scanned: string | null;
  ups_serial_scanned: string | null;
  wa_group_jid: string | null;
  project: string | null;
}

const VPS_PHOTO_BASE = process.env.VPS_PHOTO_BASE || 'http://72.61.197.178';

/**
 * Run the full serial mismatch recheck flow for a drop.
 * Fetches photos, runs second-pass VLM, applies threshold, logs learning, sends WA.
 */
export async function runSerialRecheck(
  dropNumber: string,
  source: 'auto' | 'manual',
  userId?: string
): Promise<RecheckResult> {
  log.info('SerialRecheck', `Starting recheck for ${dropNumber} (source=${source})`);

  // 1. Fetch review data (1Map serials + WA group JID)
  const reviewRows = await sql`
    SELECT ont_serial_scanned, ups_serial_scanned, wa_group_jid, project
    FROM dr_photo_unified_reviews
    WHERE drop_number = ${dropNumber}
    LIMIT 1
  ` as ReviewRow[];

  if (reviewRows.length === 0) {
    log.warn('SerialRecheck', `No unified review found for ${dropNumber}`);
    return { outcome: 'unclear', serialType: 'ups', secondPassSerial: null, confidence: null, waMessageSent: false, learningLogged: false };
  }

  const review = reviewRows[0]!;
  const onemapUps = review.ups_serial_scanned;
  const onemapOnt = review.ont_serial_scanned;

  // 2. Fetch WA photos for this drop
  const photos = await sql`
    SELECT id, local_path, original_filename, vlm_ups_serial, vlm_ont_serial
    FROM wa_photos
    WHERE drop_number = ${dropNumber}
      AND vlm_processed = true
    ORDER BY created_at DESC
    LIMIT 5
  ` as WaPhotoRow[];

  if (photos.length === 0) {
    log.warn('SerialRecheck', `No processed WA photos found for ${dropNumber}`);
    return { outcome: 'unclear', serialType: 'ups', secondPassSerial: null, confidence: null, waMessageSent: false, learningLogged: false };
  }

  // 3. Determine which serials mismatch
  const upsMismatches = photos.filter(
    p => p.vlm_ups_serial && onemapUps && p.vlm_ups_serial.toUpperCase() !== onemapUps.toUpperCase()
  );
  const ontMismatches = photos.filter(
    p => p.vlm_ont_serial && onemapOnt && p.vlm_ont_serial.toUpperCase() !== onemapOnt.toUpperCase()
  );

  const hasUpsMismatch = upsMismatches.length > 0;
  const hasOntMismatch = ontMismatches.length > 0;

  if (!hasUpsMismatch && !hasOntMismatch) {
    log.info('SerialRecheck', `No active mismatch found for ${dropNumber} — skipping`);
    return { outcome: 'unclear', serialType: 'ups', secondPassSerial: null, confidence: null, waMessageSent: false, learningLogged: false };
  }

  const serialType: RecheckSerialType = hasUpsMismatch && hasOntMismatch ? 'both' : hasUpsMismatch ? 'ups' : 'ont';

  // 4. Run second-pass VLM on the best mismatch photo
  // Use first photo for UPS, first photo for ONT (may be same photo)
  const targetPhoto = (hasUpsMismatch ? upsMismatches[0] : ontMismatches[0])!;
  const urlPath = targetPhoto.local_path.replace(
    '/var/lib/docker/volumes/boss-vps_dr_photos/_data/',
    '/photos/'
  );
  const photoUrl = `${VPS_PHOTO_BASE}${urlPath}`;

  let secondPassSerial: string | null = null;
  let confidence = 0;
  const firstPassSerial = hasUpsMismatch ? (upsMismatches[0]?.vlm_ups_serial ?? null) : (ontMismatches[0]?.vlm_ont_serial ?? null);
  const onemapSerial = hasUpsMismatch ? onemapUps : onemapOnt;

  try {
    if (hasUpsMismatch) {
      const extraction = await extractUpsSerialRecheck(photoUrl);
      secondPassSerial = extraction.serial;
      confidence = extraction.confidence;
    } else {
      const extraction = await extractOntSerialRecheck(photoUrl);
      secondPassSerial = extraction.serial;
      confidence = extraction.confidence;
    }
  } catch (vlmError) {
    log.error('SerialRecheck', { action: 'vlmRecheck', dropNumber, error: vlmError });
  }

  // 5. Apply threshold
  const outcome = determineRecheckOutcome({ secondPassSerial, confidence, onemapSerial });
  log.info('SerialRecheck', `Outcome for ${dropNumber}: ${outcome} (confidence=${confidence.toFixed(2)}, serial=${secondPassSerial})`);

  // 6. Log to VLM learning
  let learningLogged = false;
  try {
    await recordVlmCorrection({
      module: 'activate',
      analysisType: 'wa_serial_recheck',
      sourceId: dropNumber,
      sourceTable: 'dr_photo_unified_reviews',
      photoUrl,
      vlmExtractedValue: firstPassSerial || '',
      vlmConfidence: confidence,
      correctedValue: outcome === 'correction' ? (onemapSerial || '') : (secondPassSerial || firstPassSerial || ''),
      correctionReason: outcome === 'correction' ? 'vlm_error' : 'low_confidence',
      correctionNotes: `Recheck: outcome=${outcome}, source=${source}`,
      context: { dropNumber, serialType, outcome, onemapSerial, firstPassSerial, secondPassSerial },
    });
    learningLogged = true;
  } catch (learningError) {
    log.warn('SerialRecheck', { action: 'logLearning', dropNumber, error: learningError });
  }

  // 7. Write to serial_recheck_log
  try {
    await sql`
      INSERT INTO serial_recheck_log (
        drop_number, triggered_by, rechecker_user_id, serial_type,
        first_pass_serial, second_pass_serial, second_pass_confidence,
        outcome, onemap_serial
      ) VALUES (
        ${dropNumber}, ${source}, ${userId || null}, ${serialType},
        ${firstPassSerial}, ${secondPassSerial}, ${confidence || null},
        ${outcome}, ${onemapSerial}
      )
    `;
  } catch (dbError) {
    log.error('SerialRecheck', { action: 'logToDb', dropNumber, error: dbError });
  }

  // 8. Build and send WA follow-up message
  let waMessageSent = false;
  const waGroupJid = review.wa_group_jid;

  if (waGroupJid) {
    const message = buildRecheckWaMessage({
      dropNumber,
      serialType,
      outcome,
      onemapSerial,
      firstPassSerial,
      secondPassSerial,
      confidence,
    });

    try {
      const waRes = await fetch(`${WA_FEEDBACK_URL}/send-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: waGroupJid, message }),
        signal: AbortSignal.timeout(30000),
      });

      if (waRes.ok) {
        waMessageSent = true;
        // Update serial_recheck_log with wa_message_sent
        await sql`
          UPDATE serial_recheck_log
          SET wa_message_sent = true, wa_message_at = NOW()
          WHERE drop_number = ${dropNumber}
            AND recheck_at = (
              SELECT MAX(recheck_at) FROM serial_recheck_log WHERE drop_number = ${dropNumber}
            )
        `;
        log.info('SerialRecheck', `WA follow-up sent for ${dropNumber}`);
      } else {
        log.warn('SerialRecheck', `WA send failed for ${dropNumber}: HTTP ${waRes.status}`);
      }
    } catch (waError) {
      log.error('SerialRecheck', { action: 'sendWa', dropNumber, error: waError });
    }
  } else {
    log.warn('SerialRecheck', `No wa_group_jid for ${dropNumber} — cannot send WA message`);
  }

  return { outcome, serialType, secondPassSerial, confidence, waMessageSent, learningLogged };
}
```

- [ ] **Step 4.4: Run tests to verify they pass**

```bash
npm test tests/activate/services/serialRecheckService.test.ts 2>&1 | tail -20
```

Expected: all 8 tests pass (`determineRecheckOutcome` × 5 + `buildRecheckWaMessage` × 3)

- [ ] **Step 4.5: Commit**

```bash
git add src/modules/activate/services/serialRecheckService.ts \
        tests/activate/services/serialRecheckService.test.ts
git commit -m "feat(activate): serial recheck service with VLM second-pass + WA send"
```

---

## Task 5: API Endpoint

**Files:**
- Create: `pages/api/activate/recheck-serial-mismatch.ts`

- [ ] **Step 5.1: Write failing test**

Create `tests/api/activate/recheck-serial-mismatch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMocks } from 'node-mocks-http';

vi.mock('@/lib/auth', () => ({
  withAuth: (handler: Function) => handler,
}));

vi.mock('@/modules/activate/services/serialRecheckService', () => ({
  runSerialRecheck: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import handler from '../../../pages/api/activate/recheck-serial-mismatch';
import { runSerialRecheck } from '@/modules/activate/services/serialRecheckService';

describe('POST /api/activate/recheck-serial-mismatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when dropNumber is missing', async () => {
    const { req, res } = createMocks({ method: 'POST', body: { source: 'manual' } });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(400);
  });

  it('returns 405 for GET requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(405);
  });

  it('calls runSerialRecheck and returns 200 on success', async () => {
    vi.mocked(runSerialRecheck).mockResolvedValueOnce({
      outcome: 'correction',
      serialType: 'ups',
      secondPassSerial: 'GU18W12V2511020289',
      confidence: 0.92,
      waMessageSent: true,
      learningLogged: true,
    });

    const { req, res } = createMocks({
      method: 'POST',
      body: { dropNumber: 'DR474849', source: 'manual' },
    });

    await handler(req as any, res as any);
    expect(res._getStatusCode()).toBe(200);
    const data = JSON.parse(res._getData());
    expect(data.data.outcome).toBe('correction');
    expect(data.data.waMessageSent).toBe(true);
  });
});
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
npm test tests/api/activate/recheck-serial-mismatch.test.ts 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '...recheck-serial-mismatch'`

- [ ] **Step 5.3: Create the API endpoint**

Create `pages/api/activate/recheck-serial-mismatch.ts`:

```typescript
/**
 * POST /api/activate/recheck-serial-mismatch
 *
 * Runs a second-pass VLM analysis on serial mismatch photos.
 * Called automatically by send-feedback (fire-and-forget) and manually
 * via the Re-analyse Serial button in the QA review UI.
 *
 * Auth required. Rate: inherits global Next.js limits.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { runSerialRecheck } from '@/modules/activate/services/serialRecheckService';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
  }

  const { dropNumber, source } = req.body as {
    dropNumber?: string;
    source?: 'auto' | 'manual';
  };

  if (!dropNumber) {
    return apiResponse.error(res, 'BAD_REQUEST', 'dropNumber is required');
  }

  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  const recheckSource = source === 'manual' ? 'manual' : 'auto';

  log.info('RecheckSerialMismatch', `Recheck requested for ${dropNumber} (source=${recheckSource}, userId=${userId})`);

  try {
    const result = await runSerialRecheck(dropNumber, recheckSource, userId);
    return apiResponse.success(res, result);
  } catch (error) {
    log.error('RecheckSerialMismatch', { dropNumber, error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
```

- [ ] **Step 5.4: Run test to verify it passes**

```bash
npm test tests/api/activate/recheck-serial-mismatch.test.ts 2>&1 | tail -15
```

Expected: `✓ returns 400`, `✓ returns 405`, `✓ returns 200 on success` — all 3 pass.

- [ ] **Step 5.5: Commit**

```bash
git add pages/api/activate/recheck-serial-mismatch.ts \
        tests/api/activate/recheck-serial-mismatch.test.ts
git commit -m "feat(api): add recheck-serial-mismatch endpoint"
```

---

## Task 6: Auto-Trigger in send-feedback

**Files:**
- Modify: `pages/api/activate/send-feedback.ts`

The mismatch is detected by comparing `wa_photos.vlm_ups_serial` / `vlm_ont_serial` with `dr_photo_unified_reviews.ups_serial_scanned` / `ont_serial_scanned`. Rather than re-querying, the simplest reliable trigger is: check the message body for the word "MISMATCH" (the field tech already generated the feedback containing this text) OR detect from the feedback body that has `serialValidation`. We'll use the safer database check.

- [ ] **Step 6.1: Add mismatch detection helper and fire-and-forget call**

In `pages/api/activate/send-feedback.ts`, locate the block after step 8c (around line 281, after `saveConfirmedCorrectExamples`). Add:

```typescript
    // 8d. Fire-and-forget serial recheck if mismatch exists
    try {
      const mismatchCheck = await pool.query(
        `SELECT 1 FROM wa_photos p
         JOIN dr_photo_unified_reviews r ON r.drop_number = p.drop_number
         WHERE p.drop_number = $1
           AND p.vlm_processed = true
           AND (
             (p.vlm_ups_serial IS NOT NULL AND r.ups_serial_scanned IS NOT NULL
               AND UPPER(p.vlm_ups_serial) != UPPER(r.ups_serial_scanned))
             OR
             (p.vlm_ont_serial IS NOT NULL AND r.ont_serial_scanned IS NOT NULL
               AND UPPER(p.vlm_ont_serial) != UPPER(r.ont_serial_scanned))
           )
         LIMIT 1`,
        [dropNumber]
      );

      if (mismatchCheck.rows.length > 0) {
        log.info(`SendFeedback: serial mismatch detected for ${dropNumber} — triggering recheck`);
        // Fire-and-forget: do NOT await, does not affect send-feedback response
        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3004';
        fetch(`${baseUrl}/api/activate/recheck-serial-mismatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropNumber, source: 'auto' }),
        }).catch((err) => {
          log.warn('SendFeedback: recheck fire-and-forget failed (non-fatal)', { dropNumber, err });
        });
      }
    } catch (recheckTriggerError) {
      // Non-fatal: log and continue
      log.warn('SendFeedback: failed to check for mismatch (non-fatal)', { dropNumber, recheckTriggerError });
    }
```

- [ ] **Step 6.2: Type-check the file**

```bash
cd /home/hein/Workspace/FF_Next.js-serial-recheck
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "send-feedback" | head -10
```

Expected: no errors for send-feedback.ts

- [ ] **Step 6.3: Lint**

```bash
npm run lint -- --quiet 2>&1 | grep "send-feedback" | head -5
```

Expected: no lint errors

- [ ] **Step 6.4: Commit**

```bash
git add pages/api/activate/send-feedback.ts
git commit -m "feat(activate): fire-and-forget serial recheck after mismatch feedback"
```

---

## Task 7: SerialRecheckPanel UI Component

**Files:**
- Create: `src/modules/activate/components/SerialRecheckPanel.tsx`

- [ ] **Step 7.1: Create the component**

Create `src/modules/activate/components/SerialRecheckPanel.tsx`:

```typescript
/**
 * SerialRecheckPanel
 *
 * Displays the Re-analyse Serial button and result card in the UnifiedReviewCard
 * Feedback tab. Only visible when the drop has a serial mismatch.
 *
 * Status: WORKING
 */

'use client';

import { useState } from 'react';
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { log } from '@/lib/logger';
import type { RecheckOutcome, RecheckSerialType } from '../services/serialRecheckService';

interface RecheckResult {
  outcome: RecheckOutcome;
  serialType: RecheckSerialType;
  secondPassSerial: string | null;
  confidence: number | null;
  waMessageSent: boolean;
  learningLogged: boolean;
}

interface SerialRecheckPanelProps {
  dropNumber: string;
  /** Whether a serial mismatch exists for this drop — controls visibility */
  hasMismatch: boolean;
  /** ISO timestamp of last recheck, if any */
  lastRecheckAt?: string | null;
  /** Outcome of last recheck, if any */
  lastRecheckOutcome?: RecheckOutcome | null;
}

const OUTCOME_CONFIG: Record<RecheckOutcome, {
  icon: typeof CheckCircle;
  bg: string;
  border: string;
  text: string;
  label: string;
}> = {
  correction: {
    icon: CheckCircle,
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    text: 'text-green-800 dark:text-green-200',
    label: '1Map serial confirmed. Correction sent to group.',
  },
  verify: {
    icon: AlertTriangle,
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-800 dark:text-amber-200',
    label: "Couldn't confirm. Verify message sent to group.",
  },
  unclear: {
    icon: XCircle,
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-800 dark:text-red-200',
    label: 'Photo unclear. Verify message sent to group.',
  },
};

export function SerialRecheckPanel({
  dropNumber,
  hasMismatch,
  lastRecheckAt,
  lastRecheckOutcome,
}: SerialRecheckPanelProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<RecheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hasMismatch) return null;

  const recentRecheckAt = result ? new Date().toISOString() : lastRecheckAt;
  const recentOutcome = result?.outcome ?? lastRecheckOutcome;

  // Within 24h and has a prior result (either from this session or lastRecheckAt)
  const isRecentlyRechecked =
    recentRecheckAt &&
    Date.now() - new Date(recentRecheckAt).getTime() < 24 * 60 * 60 * 1000;

  const handleRecheck = async (force = false) => {
    if (isLoading) return;
    if (isRecentlyRechecked && !force) return;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/activate/recheck-serial-mismatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropNumber, source: 'manual' }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message || 'Recheck failed');
      }

      const { data } = await res.json();
      setResult(data as RecheckResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      log.error('SerialRecheckPanel', { dropNumber, error: err });
    } finally {
      setIsLoading(false);
    }
  };

  const displayOutcome = result?.outcome ?? (isRecentlyRechecked ? recentOutcome : null);
  const config = displayOutcome ? OUTCOME_CONFIG[displayOutcome] : null;
  const Icon = config?.icon ?? CheckCircle;

  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Serial Re-analysis</h4>
        <span className="text-xs text-muted-foreground">⚠️ Mismatch detected</span>
      </div>

      {/* Result card — show if we have a result or a recent prior recheck */}
      {config && (
        <div className={`flex items-start gap-2 p-3 rounded-md border ${config.bg} ${config.border}`}>
          <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.text}`} />
          <div className="flex-1">
            <p className={`text-sm font-medium ${config.text}`}>{config.label}</p>
            {recentRecheckAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(recentRecheckAt).toLocaleString()}
                {isRecentlyRechecked && !result && (
                  <button
                    onClick={() => { void handleRecheck(true); }}
                    className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
                    disabled={isLoading}
                  >
                    Re-run
                  </button>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Action button — hidden when recently rechecked (result card with Re-run link shows instead) */}
      {!isRecentlyRechecked && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => { void handleRecheck(false); }}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Re-analysing…
            </>
          ) : (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              Re-analyse Serial
            </>
          )}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 7.2: Type-check the component**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep "SerialRecheckPanel" | head -10
```

Expected: no errors

- [ ] **Step 7.3: Commit**

```bash
git add src/modules/activate/components/SerialRecheckPanel.tsx
git commit -m "feat(ui): add SerialRecheckPanel component"
```

---

## Task 8: Wire Panel into UnifiedReviewCard

**Files:**
- Modify: `src/modules/activate/components/UnifiedReviewCard.tsx`

The panel mounts in the `FeedbackTab` (line ~816). We need to:
1. Import `SerialRecheckPanel`
2. Detect mismatch from `review.serial_validation_status` or by checking WA photo data — use a simple prop derived from the existing review data
3. Add panel to FeedbackTab

First, understand mismatch detection in the review object. The `UnifiedReview` type has `serial_validation_status` (type `SerialValidationStatus`). We'll use a simpler check: the feedback message contains "MISMATCH" OR we check `review.serial_validation_status === 'MISMATCH'`.

- [ ] **Step 8.1: Check what SerialValidationStatus looks like**

```bash
grep -n "SerialValidationStatus\|MISMATCH\|serial_validation" \
  /home/hein/Workspace/FF_Next.js-serial-recheck/src/modules/activate/types/unified.types.ts | head -10
```

Note the values — likely `'MATCH' | 'MISMATCH' | 'MISSING' | null`. We check `review.serial_validation_status === 'MISMATCH'`.

- [ ] **Step 8.2: Add import and wire in FeedbackTab**

In `src/modules/activate/components/UnifiedReviewCard.tsx`:

**Import** (add after existing imports at the top of the file):
```typescript
import { SerialRecheckPanel } from './SerialRecheckPanel';
```

**In `FeedbackTab`** (around line 816, inside the `<div className="space-y-6">` of the return):

Add the panel after the "Previously sent notice" block and before the "Just sent" block, or at the top of the space-y-6 div:

```typescript
      {/* Serial Recheck Panel — only shown when mismatch exists */}
      <SerialRecheckPanel
        dropNumber={review.drop_number}
        hasMismatch={review.serial_validation_status === 'MISMATCH'}
        lastRecheckAt={null}
        lastRecheckOutcome={null}
      />
```

Place this as the first element inside `<div className="space-y-6">` in the FeedbackTab return.

- [ ] **Step 8.3: Type-check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -E "UnifiedReviewCard|SerialRecheck" | head -10
```

Expected: no errors

- [ ] **Step 8.4: Run lint**

```bash
npm run lint -- --quiet 2>&1 | grep -E "UnifiedReviewCard|SerialRecheck" | head -5
```

Expected: no lint errors

- [ ] **Step 8.5: Commit**

```bash
git add src/modules/activate/components/UnifiedReviewCard.tsx
git commit -m "feat(ui): mount SerialRecheckPanel in UnifiedReviewCard feedback tab"
```

---

## Task 9: VLM Learning Dashboard Verification

**Files:** None (no code changes needed — auto-discovered from logged data)

The VLM learning dashboard at `/system/vlm-learning` already has an `analysisType` filter dropdown. Once data is logged via `recordVlmCorrection` with `analysisType: 'wa_serial_recheck'` (Task 4), entries appear automatically in the existing corrections table when filtered.

- [ ] **Step 9.1: Verify entries appear after a recheck**

After triggering a recheck (manually or via auto), navigate to `/system/vlm-learning`, set the `analysisType` filter to `wa_serial_recheck`, and confirm the entry appears with the correct fields.

- [ ] **Step 9.2: Commit** *(no code changes — document only)*

```bash
git commit --allow-empty -m "docs: confirm wa_serial_recheck entries visible in VLM learning dashboard"
```

---

## Task 10: Full CI Pass + PR

*(Previously Task 9)*

- [ ] **Step 10.1: Run full test suite**

```bash
cd /home/hein/Workspace/FF_Next.js-serial-recheck
npm test 2>&1 | tail -30
```

Expected: all tests pass, including:
- `tests/types/vlm-learning.test.ts` ✓
- `tests/activate/services/waPhotoExtraction.recheck.test.ts` ✓
- `tests/activate/services/serialRecheckService.test.ts` ✓
- `tests/api/activate/recheck-serial-mismatch.test.ts` ✓

- [ ] **Step 10.2: Type check**

```bash
npx tsc --noEmit 2>&1 | tail -20
```

Expected: 0 errors

- [ ] **Step 10.3: Lint**

```bash
npm run lint -- --quiet 2>&1 | tail -10
```

Expected: 0 errors (or same count as baseline)

- [ ] **Step 10.4: Create PR**

```bash
git push -u origin feature/serial-mismatch-recheck
gh pr create \
  --title "feat(activate): serial mismatch auto-recheck with VLM second pass" \
  --body "$(cat <<'EOF'
## Summary
- New API: POST /api/activate/recheck-serial-mismatch — second-pass VLM on mismatch photos
- Auto-triggered from send-feedback when serial mismatch detected (fire-and-forget)
- Manual Re-analyse Serial button in UnifiedReviewCard Feedback tab
- Three outcome messages sent to WA group: correction / please verify / unclear
- All recheck events logged to serial_recheck_log table + VLM learning (wa_serial_recheck)
- DB migration: serial_recheck_log table

## Test plan
- [ ] Send feedback for a DR with UPS mismatch → check WA group for second look message
- [ ] Navigate to Feedback tab → Re-analyse Serial button visible for mismatch drops
- [ ] Click Re-analyse → result card shows outcome, button disappears for 24h
- [ ] Re-run link in result card triggers force re-run
- [ ] Non-mismatch drop → button not shown
- [ ] DB: confirm serial_recheck_log row created per recheck
- [ ] VLM learning dashboard: filter by wa_serial_recheck → entries appear

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for Implementer

**Database:** Both `neon()` (tagged template, in API routes) and `pool.query()` (pg pool, in send-feedback.ts) are used in this codebase. The new endpoint and service use `neon()` as per the pattern in `process-wa-photo-vlm.ts`. The fire-and-forget in `send-feedback.ts` uses `pool.query()` since that file already imports pool.

**WA group JID:** `dr_photo_unified_reviews.wa_group_jid` stores the WhatsApp group JID for the drop. If null (older drops), the WA message is skipped but the recheck still runs and logs.

**VPS photo URL:** Local paths like `/var/lib/docker/volumes/boss-vps_dr_photos/_data/DR123/file.jpg` transform to `http://72.61.197.178/photos/DR123/file.jpg` — see `process-wa-photo-vlm.ts` line 96 for the pattern.

**NEXTAUTH_URL:** The fire-and-forget call uses `process.env.NEXTAUTH_URL` as base URL. On dev this is `http://localhost:3004`, on production `https://app.fibreflow.app`. This is already set in each environment's `.env`.

**serialType 'both':** When both UPS and ONT mismatch, the second pass runs only on the UPS photo (dominant case). The WA message says "UPS & ONT" but only one VLM call is made. If a more thorough multi-serial recheck is needed later, the service is structured to extend.
