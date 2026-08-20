# ONT Box Scanning — Phase 1 (Issue Flow) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One scan of a Nokia ONT carton label puts all nine serials into the stores issue flow, so a ten-ONT handout is box + one loose unit + signature.

**Architecture:** A pure parser (`boxScan.ts`) classifies any decoded barcode payload as a box of serials, a package-data code, a single serial, or unrecognised. A pure verdict function (`serialVerdict.ts`) decides valid/invalid for one serial and is shared by the existing single-serial path, the new batch endpoint, and the tests — so the two paths cannot drift. `useScanSerial` expands a box into N chips validated in one round-trip; `ScanSerialsStep` renders them as one collapsible group. Availability at process time trusts the serials for serial-tracked lines and records `stock_quants` disagreement to a drift log instead of refusing the issue.

**Tech Stack:** Next.js 14 Pages Router, TypeScript, `pg.Pool` via `@/lib/db-pool`, vitest + @testing-library/react (jsdom), `zxing-wasm` (already a dependency), Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-20-ont-box-scanning-design.md`

## Global Constraints

- **Branch/worktree:** work in `/home/hein/Workspace/FF_Next.js-ont-box-scan` on branch `feat/ont-box-scanning`. Never edit the main tree, never commit to master.
- **File size:** new files < 300 lines, new components < 200 lines. `pages/api/procurement/field-stock/pickings/[pickingId]/process.ts` is already over the cap — do not add lines to it; put new logic in `_availability.ts` or a new sibling file.
- **Logging:** `import { log } from '@/lib/logger'`. No `console.log`.
- **API shape:** `import { apiResponse } from '@/lib/apiResponse'`; `apiResponse.success(res, data)`, `apiResponse.validationError(res, {...})`, `apiResponse.methodNotAllowed(res, method, ['POST'])`.
- **No conditional tagged-template SQL fragments** — `${cond ? sql\`AND x\` : sql\`\`}` is broken in this repo. Use explicit query branches or `txn.query(text, params)`.
- **Serial shape** (verbatim, used in three files): `/^[A-Z0-9]{8,20}$/`
- **Nokia GPON serial prefix** (verbatim): `/^ALCL[A-Z0-9]{8}$/`
- **Box cap** (verbatim): `MAX_BOX_SERIALS = 50`
- **Soft warning threshold** (verbatim): `SOFT_BATCH_WARN_AT = 10`
- **Serial statuses counted as issuable** (verbatim): `'available'`, `'in_stock'`
- **Next migration number:** `506`. Migrations live in `scripts/migrations/sql/506_*.sql` with a matching `scripts/migrations/sql/rollback_506_*.sql`.
- **Verification per task:** `npx vitest run <test path>` for the task's tests; `npm run lint` before each commit. Run `npm run ci:quick` once before opening the PR.
- **Reference payloads** (decoded from a real carton, used verbatim as fixtures):
  - Box: `ALCLB49486FF;ALCLB4948758;ALCLB4948779;ALCLB49488FC;ALCLB4949054;ALCLB4949388;ALCLB4949DEF;ALCLB4949F2F;ALCLB4949F3C`
  - Package data: `[)>\x1e06\x1d1P3TN01414BA\x1d18VLENOK\x1d2P01\x1d1VOM02\x1dQ9\x1d4LCN\x1d3SM022540C0126A10210\x1e\x04`
  - Single-serial DataMatrix (existing, must keep working): `[)>\x1e06\x1d1P3TN01414BA\x1dSALCLB4923FA8\x1e\x04`

---

### Task 1: `boxScan.ts` — the shared payload parser

**Files:**
- Create: `src/modules/field-stock-pwa/lib/boxScan.ts`
- Test: `src/modules/field-stock-pwa/lib/__tests__/boxScan.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type ScanPayload =
    | { kind: 'box'; serials: string[] }
    | { kind: 'package-data'; partNumber?: string; quantity?: number; packageId?: string }
    | { kind: 'single'; serial: string }
    | { kind: 'unrecognised'; raw: string };
  export function parseScanPayload(raw: string): ScanPayload;
  export const MAX_BOX_SERIALS = 50;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/modules/field-stock-pwa/lib/__tests__/boxScan.test.ts`:

```ts
/**
 * Tests for parseScanPayload — classifies a decoded barcode payload.
 *
 * Fixtures are the real decoded strings from a Nokia G-0126G-A carton
 * (see docs/superpowers/specs/2026-08-20-ont-box-scanning-design.md).
 */
import { describe, it, expect } from 'vitest';
import { parseScanPayload } from '../boxScan';

const BOX =
  'ALCLB49486FF;ALCLB4948758;ALCLB4948779;ALCLB49488FC;ALCLB4949054;' +
  'ALCLB4949388;ALCLB4949DEF;ALCLB4949F2F;ALCLB4949F3C';

const PACKAGE_DATA =
  '[)>\x1e06\x1d1P3TN01414BA\x1d18VLENOK\x1d2P01\x1d1VOM02\x1dQ9\x1d4LCN\x1d3SM022540C0126A10210\x1e\x04';

const SINGLE_DATAMATRIX = '[)>\x1e06\x1d1P3TN01414BA\x1dSALCLB4923FA8\x1e\x04';

describe('parseScanPayload', () => {
  it('reads all nine serials from the carton box code', () => {
    const result = parseScanPayload(BOX);
    expect(result.kind).toBe('box');
    expect(result.kind === 'box' && result.serials).toEqual([
      'ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779', 'ALCLB49488FC', 'ALCLB4949054',
      'ALCLB4949388', 'ALCLB4949DEF', 'ALCLB4949F2F', 'ALCLB4949F3C',
    ]);
  });

  it('reads part number, quantity and package id from the ISO data code', () => {
    const result = parseScanPayload(PACKAGE_DATA);
    expect(result).toEqual({
      kind: 'package-data',
      partNumber: '3TN01414BA',
      quantity: 9,
      packageId: 'M022540C0126A10210',
    });
  });

  it('still reads a single serial from the unit DataMatrix envelope', () => {
    expect(parseScanPayload(SINGLE_DATAMATRIX)).toEqual({
      kind: 'single',
      serial: 'ALCLB4923FA8',
    });
  });

  it('reads a bare 1D serial unchanged', () => {
    expect(parseScanPayload('  alclb4949f3c ')).toEqual({
      kind: 'single',
      serial: 'ALCLB4949F3C',
    });
  });

  it('strips the ISO column S prefix only for a Nokia-shaped serial', () => {
    expect(parseScanPayload('SALCLB49486FF')).toEqual({ kind: 'single', serial: 'ALCLB49486FF' });
    // Not Nokia-shaped: the S is part of the serial, never stripped.
    expect(parseScanPayload('S1234567890')).toEqual({ kind: 'single', serial: 'S1234567890' });
  });

  it('upper-cases and de-duplicates box members, preserving first-seen order', () => {
    const result = parseScanPayload('alclb4948758;ALCLB49486FF;ALCLB4948758');
    expect(result.kind === 'box' && result.serials).toEqual(['ALCLB4948758', 'ALCLB49486FF']);
  });

  it('drops malformed members but keeps the box when two or more survive', () => {
    const result = parseScanPayload('ALCLB49486FF;;xx;ALCLB4948758');
    expect(result.kind === 'box' && result.serials).toEqual(['ALCLB49486FF', 'ALCLB4948758']);
  });

  it('falls back to single when only one member survives', () => {
    expect(parseScanPayload('ALCLB49486FF;xx')).toEqual({ kind: 'single', serial: 'ALCLB49486FF' });
  });

  it('returns unrecognised for empty and junk input rather than guessing', () => {
    expect(parseScanPayload('')).toEqual({ kind: 'unrecognised', raw: '' });
    expect(parseScanPayload('   ')).toEqual({ kind: 'unrecognised', raw: '' });
    expect(parseScanPayload('hello world')).toEqual({ kind: 'unrecognised', raw: 'hello world' });
  });

  it('returns every member of an oversized box — the cap is enforced by callers', () => {
    const many = Array.from({ length: 60 }, (_, i) => `ALCLB4948${String(i).padStart(4, '0')}`);
    const result = parseScanPayload(many.join(';'));
    expect(result.kind === 'box' && result.serials).toHaveLength(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/field-stock-pwa/lib/__tests__/boxScan.test.ts`
Expected: FAIL — cannot resolve `../boxScan`.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/field-stock-pwa/lib/boxScan.ts`:

```ts
/**
 * parseScanPayload — classify a decoded barcode payload from the stores scanner.
 *
 * Nokia ONT cartons carry three kinds of code side by side:
 *
 *  1. A large DataMatrix titled "FULL SERIAL NUMBER LIST IN PACKAGE" holding
 *     every serial in the box, semicolon-separated:
 *       ALCLB49486FF;ALCLB4948758;…      → kind 'box'
 *  2. A small DataMatrix ("ISO ALL DATA") in ISO/IEC 15434 Format 06 carrying
 *     the part number, quantity and package id but NO serials:
 *       [)>{RS}06{GS}1P3TN01414BA{GS}…Q9{GS}3SM022540…{RS}{EOT}
 *                                        → kind 'package-data'
 *  3. Per-unit Code128 barcodes, plain or S-prefixed (the label's ISO column).
 *                                        → kind 'single'
 *
 * The per-unit DataMatrix on an individual ONT wraps its serial in the same
 * ISO envelope under Data Identifier 'S' — that path is preserved verbatim
 * from the previous extractScannedSerial implementation.
 *
 * Unknown formats degrade to 'single' or 'unrecognised'. The parser never
 * invents serials from a payload it does not understand.
 */

// ASC MH10.8.2 / ISO 15434 separators (GS/RS/EOT control chars — intentional).
// eslint-disable-next-line no-control-regex
const SEPARATORS = /[\x1d\x1e\x04]+/;
const FORMAT_ENVELOPE = '[)>';
const SERIAL_SHAPE = /^[A-Z0-9]{8,20}$/;
const NOKIA_SERIAL_SHAPE = /^ALCL[A-Z0-9]{8}$/;

/** Callers cap a box at this many members; the parser itself returns all of them. */
export const MAX_BOX_SERIALS = 50;

export type ScanPayload =
  | { kind: 'box'; serials: string[] }
  | { kind: 'package-data'; partNumber?: string; quantity?: number; packageId?: string }
  | { kind: 'single'; serial: string }
  | { kind: 'unrecognised'; raw: string };

/**
 * Normalise one token to a serial, or null when it is not serial-shaped.
 * A leading 'S' is stripped ONLY when the remainder is a Nokia GPON serial —
 * the label's ISO column prints S-prefixed variants, but a genuine serial that
 * merely starts with S must never be mangled.
 */
function toSerial(token: string): string | null {
  const value = token.trim().toUpperCase();
  if (value.startsWith('S') && NOKIA_SERIAL_SHAPE.test(value.slice(1))) return value.slice(1);
  return SERIAL_SHAPE.test(value) ? value : null;
}

function parseIsoEnvelope(text: string): ScanPayload {
  const fields = text.split(SEPARATORS).map((f) => f.trim()).filter(Boolean);

  // Data Identifier 'S' (bare) carries a unit serial. Multi-character DIs are
  // digit-prefixed (1P, 3S, …), so a field matching /^S[0-9A-Za-z]/ is the
  // serial field and its value is the remainder.
  const serialField = fields.find((f) => /^S[0-9A-Za-z]/.test(f));
  if (serialField) {
    const serial = toSerial(serialField.slice(1));
    if (serial) return { kind: 'single', serial };
  }

  const di = (prefix: string): string | undefined => {
    const field = fields.find((f) => f.startsWith(prefix) && f.length > prefix.length);
    return field?.slice(prefix.length);
  };
  const quantityRaw = di('Q');
  const quantity = quantityRaw !== undefined && /^\d+$/.test(quantityRaw) ? Number(quantityRaw) : undefined;

  return {
    kind: 'package-data',
    partNumber: di('1P'),
    quantity,
    packageId: di('3S'),
  };
}

export function parseScanPayload(raw: string): ScanPayload {
  const text = (raw ?? '').trim();
  if (!text) return { kind: 'unrecognised', raw: '' };

  if (text.includes(FORMAT_ENVELOPE)) return parseIsoEnvelope(text);

  if (text.includes(';')) {
    const serials: string[] = [];
    const seen = new Set<string>();
    for (const token of text.split(';')) {
      const serial = toSerial(token);
      if (serial && !seen.has(serial)) {
        seen.add(serial);
        serials.push(serial);
      }
    }
    if (serials.length >= 2) return { kind: 'box', serials };
    if (serials.length === 1) return { kind: 'single', serial: serials[0]! };
    return { kind: 'unrecognised', raw: text };
  }

  const serial = toSerial(text);
  return serial ? { kind: 'single', serial } : { kind: 'unrecognised', raw: text };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/field-stock-pwa/lib/__tests__/boxScan.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run lint
git add src/modules/field-stock-pwa/lib/boxScan.ts src/modules/field-stock-pwa/lib/__tests__/boxScan.test.ts
git commit -m "feat(field-stock): parse Nokia carton box codes into serial lists"
```

---

### Task 2: Decode regression test against a real carton photo

Guards the Task 1 fixtures against a future `zxing-wasm` upgrade or config change. Without it, the parser is tested only against strings we typed.

**Files:**
- Create: `src/modules/field-stock-pwa/lib/__tests__/cartonDecode.test.ts`
- Fixture (already copied into the worktree, uncommitted): `src/modules/field-stock-pwa/lib/__tests__/fixtures/nokia-ont-carton-label.jpg`

**Interfaces:**
- Consumes: `parseScanPayload` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Confirm the fixture is present**

Run: `ls -l src/modules/field-stock-pwa/lib/__tests__/fixtures/nokia-ont-carton-label.jpg`
Expected: a ~550 KB JPEG. If missing, the photo is at `/home/hein/Downloads/WhatsApp Image 2026-08-20 at 10.59.03.jpeg`.

- [ ] **Step 2: Write the failing test**

Create `src/modules/field-stock-pwa/lib/__tests__/cartonDecode.test.ts`:

```ts
/**
 * End-to-end decode regression: a photograph of a real Nokia G-0126G-A carton
 * label must still yield all nine serials through zxing-wasm + parseScanPayload.
 *
 * This is the guard on the Task 1 fixtures — those are hand-typed strings, this
 * proves they are what the decoder actually produces. Runs in ~2s.
 */
import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { readBarcodesFromImageData } from 'zxing-wasm/reader';
import { parseScanPayload } from '../boxScan';

const FIXTURE = path.join(__dirname, 'fixtures', 'nokia-ont-carton-label.jpg');

const EXPECTED_SERIALS = [
  'ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779', 'ALCLB49488FC', 'ALCLB4949054',
  'ALCLB4949388', 'ALCLB4949DEF', 'ALCLB4949F2F', 'ALCLB4949F3C',
];

describe('Nokia carton label decode', () => {
  it('yields all nine serials from the box DataMatrix', async () => {
    const buf = await readFile(FIXTURE);
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const results = await readBarcodesFromImageData(
      { data: new Uint8ClampedArray(data), width: info.width, height: info.height },
      { tryHarder: true, maxNumberOfSymbols: 40, formats: [] },
    );

    const boxes = results
      .map((r) => parseScanPayload(r.text))
      .filter((p): p is { kind: 'box'; serials: string[] } => p.kind === 'box');

    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.serials).toEqual(EXPECTED_SERIALS);
  }, 30_000);

  it('yields the package-data code with a quantity matching the serial count', async () => {
    const buf = await readFile(FIXTURE);
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const results = await readBarcodesFromImageData(
      { data: new Uint8ClampedArray(data), width: info.width, height: info.height },
      { tryHarder: true, maxNumberOfSymbols: 40, formats: [] },
    );

    const pkg = results
      .map((r) => parseScanPayload(r.text))
      .find((p) => p.kind === 'package-data');

    expect(pkg).toBeDefined();
    expect(pkg!.kind === 'package-data' && pkg!.quantity).toBe(EXPECTED_SERIALS.length);
  }, 30_000);
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/modules/field-stock-pwa/lib/__tests__/cartonDecode.test.ts`
Expected: PASS, 2 tests. If it fails to resolve `zxing-wasm/reader`, check the export path with `node -e "console.log(Object.keys(require('zxing-wasm')))"` and adjust the import — the package is already a dependency (`package.json`, `zxing-wasm ^2.2.4`).

- [ ] **Step 4: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
git add src/modules/field-stock-pwa/lib/__tests__/cartonDecode.test.ts \
        src/modules/field-stock-pwa/lib/__tests__/fixtures/nokia-ont-carton-label.jpg
git commit -m "test(field-stock): decode regression against a real Nokia carton label"
```

---

### Task 3: `serialVerdict.ts` — one shared valid/invalid decision

Today the valid/invalid rules live inline in `useScanSerial`. The batch endpoint must apply identical rules, so they move to a pure function both call. Extracting first, with the existing tests still green, keeps this a refactor rather than a rewrite.

**Files:**
- Create: `src/modules/field-stock-pwa/lib/serialVerdict.ts`
- Test: `src/modules/field-stock-pwa/lib/__tests__/serialVerdict.test.ts`
- Modify: `src/modules/field-stock-pwa/hooks/useScanSerial.ts` (replace the inline if/else chain)

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface SerialRecord {
    serialNumber: string;
    stockItemId: string;
    stockItemName: string | null;
    status: string;
    currentLocationId: string | null;
    currentLocationName: string | null;
  }
  export interface VerdictContext {
    expectedItemId: string;
    expectedItemName: string;
    sourceLocation: { id: string; name: string } | null;
  }
  export type SerialVerdict =
    | { valid: true; stockItemId: string; stockItemName: string }
    | { valid: false; errorMessage: string; stockItemId?: string; stockItemName?: string };
  export function verdictForSerial(record: SerialRecord | null, ctx: VerdictContext): SerialVerdict;
  export const ISSUABLE_STATUSES: readonly string[]; // ['available', 'in_stock']
  ```

- [ ] **Step 1: Write the failing test**

Create `src/modules/field-stock-pwa/lib/__tests__/serialVerdict.test.ts`:

```ts
/**
 * Tests for verdictForSerial — the single source of truth for whether a scanned
 * serial may be issued. Shared by the single-serial scan path and the batch
 * endpoint so the two cannot drift apart.
 *
 * Rule order matters and is asserted: missing → status → wrong item → wrong
 * location. A serial that is both the wrong item AND at the wrong warehouse
 * reports the item, because that is the more fundamental mistake.
 */
import { describe, it, expect } from 'vitest';
import { verdictForSerial } from '../serialVerdict';
import type { SerialRecord, VerdictContext } from '../serialVerdict';

const CTX: VerdictContext = {
  expectedItemId: 'item-ont',
  expectedItemName: 'FT-ONT',
  sourceLocation: { id: 'loc-garst', name: 'Garstfontein DC' },
};

function record(over: Partial<SerialRecord> = {}): SerialRecord {
  return {
    serialNumber: 'ALCLB49486FF',
    stockItemId: 'item-ont',
    stockItemName: 'FT-ONT',
    status: 'in_stock',
    currentLocationId: 'loc-garst',
    currentLocationName: 'Garstfontein DC',
    ...over,
  };
}

describe('verdictForSerial', () => {
  it('accepts an in_stock serial of the right item at the source warehouse', () => {
    expect(verdictForSerial(record(), CTX)).toEqual({
      valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
    });
  });

  it('accepts status "available" as well as "in_stock"', () => {
    expect(verdictForSerial(record({ status: 'available' }), CTX).valid).toBe(true);
  });

  it('rejects a serial the system does not have', () => {
    expect(verdictForSerial(null, CTX)).toEqual({
      valid: false, errorMessage: 'Serial number not found',
    });
  });

  it('rejects a serial that is already issued, naming the status', () => {
    const verdict = verdictForSerial(record({ status: 'issued' }), CTX);
    expect(verdict.valid).toBe(false);
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Serial is not available (status: issued)',
    );
  });

  it('rejects a serial belonging to another stock item, naming both', () => {
    const verdict = verdictForSerial(
      record({ stockItemId: 'item-gizzu', stockItemName: 'FT-GIZZU' }), CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Wrong stock item — scanned FT-GIZZU, expected FT-ONT',
    );
  });

  it('rejects a serial registered at another warehouse, naming both', () => {
    const verdict = verdictForSerial(
      record({ currentLocationId: 'loc-lawley', currentLocationName: 'Lawley' }), CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Serial is at Lawley, not Garstfontein DC',
    );
  });

  it('allows a serial with no recorded location — missing data is not a contradiction', () => {
    expect(verdictForSerial(
      record({ currentLocationId: null, currentLocationName: null }), CTX,
    ).valid).toBe(true);
  });

  it('skips the location check when no source warehouse is selected', () => {
    expect(verdictForSerial(
      record({ currentLocationId: 'loc-lawley', currentLocationName: 'Lawley' }),
      { ...CTX, sourceLocation: null },
    ).valid).toBe(true);
  });

  it('reports the wrong item first when the serial is both wrong item and wrong place', () => {
    const verdict = verdictForSerial(
      record({ stockItemId: 'item-gizzu', stockItemName: 'FT-GIZZU', currentLocationId: 'loc-lawley', currentLocationName: 'Lawley' }),
      CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toContain('Wrong stock item');
  });

  it('falls back to a generic warehouse phrase when the location has no name', () => {
    const verdict = verdictForSerial(
      record({ currentLocationId: 'loc-lawley', currentLocationName: null }), CTX,
    );
    expect(verdict.valid === false && verdict.errorMessage).toBe(
      'Serial is at another warehouse, not Garstfontein DC',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/field-stock-pwa/lib/__tests__/serialVerdict.test.ts`
Expected: FAIL — cannot resolve `../serialVerdict`.

- [ ] **Step 3: Write minimal implementation**

Create `src/modules/field-stock-pwa/lib/serialVerdict.ts`:

```ts
/**
 * verdictForSerial — decides whether one scanned serial may be issued.
 *
 * Extracted from useScanSerial so the single-serial scan path and the batch
 * validation endpoint apply byte-identical rules. Pure: no imports, no I/O,
 * safe on both client and server.
 *
 * Rule order is deliberate and tested: missing → status → wrong item → wrong
 * location. Wrong item outranks wrong location because it is the more
 * fundamental mistake and the more useful message.
 *
 * A serial with no recorded location passes: missing data is not a
 * contradiction, and the process-step stock check still guards quantities.
 */

export const ISSUABLE_STATUSES: readonly string[] = ['available', 'in_stock'];

export interface SerialRecord {
  serialNumber: string;
  stockItemId: string;
  stockItemName: string | null;
  status: string;
  currentLocationId: string | null;
  currentLocationName: string | null;
}

export interface VerdictContext {
  expectedItemId: string;
  expectedItemName: string;
  sourceLocation: { id: string; name: string } | null;
}

export type SerialVerdict =
  | { valid: true; stockItemId: string; stockItemName: string }
  | { valid: false; errorMessage: string; stockItemId?: string; stockItemName?: string };

export function verdictForSerial(record: SerialRecord | null, ctx: VerdictContext): SerialVerdict {
  if (!record) return { valid: false, errorMessage: 'Serial number not found' };

  const stockItemName = record.stockItemName ?? '';

  if (!ISSUABLE_STATUSES.includes(record.status)) {
    return {
      valid: false,
      errorMessage: `Serial is not available (status: ${record.status})`,
      stockItemId: record.stockItemId,
      stockItemName,
    };
  }

  if (record.stockItemId && record.stockItemId !== ctx.expectedItemId) {
    return {
      valid: false,
      errorMessage: `Wrong stock item — scanned ${stockItemName || record.stockItemId}, expected ${ctx.expectedItemName}`,
      stockItemId: record.stockItemId,
      stockItemName,
    };
  }

  if (
    ctx.sourceLocation &&
    record.currentLocationId &&
    record.currentLocationId !== ctx.sourceLocation.id
  ) {
    return {
      valid: false,
      errorMessage: `Serial is at ${record.currentLocationName ?? 'another warehouse'}, not ${ctx.sourceLocation.name}`,
      stockItemId: record.stockItemId,
      stockItemName,
    };
  }

  return {
    valid: true,
    stockItemId: record.stockItemId || ctx.expectedItemId,
    stockItemName: stockItemName || ctx.expectedItemName,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/field-stock-pwa/lib/__tests__/serialVerdict.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Rewire `useScanSerial` to use it**

In `src/modules/field-stock-pwa/hooks/useScanSerial.ts`, add the import:

```ts
import { verdictForSerial } from '@/modules/field-stock-pwa/lib/serialVerdict';
```

Replace the whole `let resolved: PwaScannedSerial; if (!result.valid) { … } else { … }` chain (the four-branch block after `if (!mountedRef.current) return;`) with:

```ts
      const verdict = verdictForSerial(
        result.valid
          ? {
              serialNumber: serial,
              stockItemId: result.stockItemId ?? stockItem.id,
              stockItemName: result.stockItemName ?? null,
              status: 'in_stock', // validateSerial already applied the status gate
              currentLocationId: result.currentLocationId ?? null,
              currentLocationName: result.currentLocationName ?? null,
            }
          : null,
        {
          expectedItemId: stockItem.id,
          expectedItemName: stockItem.name,
          sourceLocation: sourceLocation ?? null,
        },
      );

      const resolved: PwaScannedSerial = verdict.valid
        ? {
            ...optimistic,
            stockItemId: verdict.stockItemId,
            stockItemName: verdict.stockItemName,
            state: 'valid',
          }
        : {
            ...optimistic,
            stockItemId: verdict.stockItemId ?? '',
            stockItemName: verdict.stockItemName ?? '',
            state: 'invalid',
            // validateSerial's own message (404, bad status) is more specific
            // than the generic not-found the verdict produces from a null record.
            errorMessage: result.valid
              ? verdict.errorMessage
              : (result.errorMessage ?? verdict.errorMessage),
          };
```

- [ ] **Step 6: Run the existing hook tests to prove the refactor changed no behaviour**

Run: `npx vitest run src/modules/field-stock-pwa/hooks/__tests__/useScanSerial.test.ts`
Expected: PASS, unchanged. If any assertion fails, the extraction altered behaviour — fix the extraction, do not edit the test.

- [ ] **Step 7: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run lint
git add src/modules/field-stock-pwa/lib/serialVerdict.ts \
        src/modules/field-stock-pwa/lib/__tests__/serialVerdict.test.ts \
        src/modules/field-stock-pwa/hooks/useScanSerial.ts
git commit -m "refactor(field-stock): extract the serial issuable verdict to one shared function"
```

---

### Task 4: `POST /api/my/stores/serials/validate-batch`

Nine serials in one round-trip instead of nine. The handler is thin: one query, then `verdictForSerial` per serial.

**Files:**
- Create: `pages/api/my/stores/serials/validate-batch.ts`
- Create: `pages/api/my/stores/serials/_validateBatchCore.ts` (the testable core — the route file stays a thin auth + parse shell)
- Test: `pages/api/my/stores/serials/__tests__/validateBatchCore.test.ts`

**Interfaces:**
- Consumes: `verdictForSerial`, `SerialRecord`, `VerdictContext` (Task 3); `MAX_BOX_SERIALS` (Task 1).
- Produces:
  ```ts
  // _validateBatchCore.ts
  export interface BatchQuerier { query<T>(text: string, params: unknown[]): Promise<T[]>; }
  export interface BatchResult {
    serialNumber: string;
    valid: boolean;
    errorMessage?: string;
    stockItemId?: string;
    stockItemName?: string;
    currentLocationId?: string | null;
    currentLocationName?: string | null;
  }
  export interface BatchResponse {
    results: BatchResult[];
    quantsWarning?: { serialsInStock: number; quantsOnHand: number };
  }
  export async function runBatchValidation(
    db: BatchQuerier,
    input: { serials: string[]; stockItemId: string; sourceLocationId: string | null },
  ): Promise<BatchResponse>;
  ```

- [ ] **Step 1: Write the failing test**

Create `pages/api/my/stores/serials/__tests__/validateBatchCore.test.ts`:

```ts
/**
 * Tests for runBatchValidation — the core of POST /my/stores/serials/validate-batch.
 *
 * A fake querier stands in for pg. What matters:
 *  - a serial the query does not return is reported not-found, not silently dropped
 *  - results come back in the order the client scanned them
 *  - the quants comparison reports drift without failing any serial
 */
import { describe, it, expect, vi } from 'vitest';
import { runBatchValidation } from '../_validateBatchCore';
import type { BatchQuerier } from '../_validateBatchCore';

const SOURCE_ID = 'loc-garst';

function querier(serialRows: unknown[], quantRows: unknown[] = [], locationRows: unknown[] = [{ name: 'Garstfontein DC' }]): BatchQuerier {
  const query = vi.fn(async (text: string) => {
    if (text.includes('FROM stock_serials')) return serialRows;
    if (text.includes('FROM stock_quants')) return quantRows;
    return locationRows;
  });
  return { query } as unknown as BatchQuerier;
}

function row(over: Record<string, unknown> = {}) {
  return {
    serial_number: 'ALCLB49486FF',
    stock_item_id: 'item-ont',
    stock_item_name: 'FT-ONT',
    status: 'in_stock',
    current_location_id: SOURCE_ID,
    current_location_name: 'Garstfontein DC',
    ...over,
  };
}

describe('runBatchValidation', () => {
  it('accepts every serial in a clean box', async () => {
    const serials = ['ALCLB49486FF', 'ALCLB4948758'];
    const db = querier([row(), row({ serial_number: 'ALCLB4948758' })]);
    const res = await runBatchValidation(db, { serials, stockItemId: 'item-ont', sourceLocationId: SOURCE_ID });
    expect(res.results.map((r) => r.valid)).toEqual([true, true]);
  });

  it('reports a serial missing from the database as not found', async () => {
    const db = querier([row()]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB0000MISSING'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results[1]).toMatchObject({
      serialNumber: 'ALCLB0000MISSING', valid: false, errorMessage: 'Serial number not found',
    });
  });

  it('issues the good members and flags the bad ones in a partial box', async () => {
    const db = querier([
      row(),
      row({ serial_number: 'ALCLB4948758', status: 'issued' }),
      row({ serial_number: 'ALCLB4948779', current_location_id: 'loc-lawley', current_location_name: 'Lawley' }),
    ]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results.map((r) => r.valid)).toEqual([true, false, false]);
    expect(res.results[1]!.errorMessage).toContain('status: issued');
    expect(res.results[2]!.errorMessage).toContain('Lawley');
  });

  it('returns results in the scanned order, not the database order', async () => {
    const db = querier([row({ serial_number: 'ALCLB4948758' }), row()]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results.map((r) => r.serialNumber)).toEqual(['ALCLB49486FF', 'ALCLB4948758']);
  });

  it('reports quants drift without failing any serial', async () => {
    const db = querier([row(), row({ serial_number: 'ALCLB4948758' })], [{ quantity: 0 }]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.results.every((r) => r.valid)).toBe(true);
    expect(res.quantsWarning).toEqual({ serialsInStock: 2, quantsOnHand: 0 });
  });

  it('omits the quants warning when the ledgers agree', async () => {
    const db = querier([row(), row({ serial_number: 'ALCLB4948758' })], [{ quantity: 2 }]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    expect(res.quantsWarning).toBeUndefined();
  });

  it('skips the quants query entirely when no source warehouse is given', async () => {
    const db = querier([row()]);
    const res = await runBatchValidation(db, {
      serials: ['ALCLB49486FF'], stockItemId: 'item-ont', sourceLocationId: null,
    });
    expect(res.quantsWarning).toBeUndefined();
    const texts = (db.query as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[0]!);
    expect(texts.some((t) => t.includes('FROM stock_quants'))).toBe(false);
  });

  it('passes serials as a single parameterised array, never interpolated', async () => {
    const db = querier([row()]);
    await runBatchValidation(db, {
      serials: ["ALCLB49486FF'; DROP TABLE stock_serials;--"],
      stockItemId: 'item-ont',
      sourceLocationId: SOURCE_ID,
    });
    const call = (db.query as unknown as { mock: { calls: [string, unknown[]][] } }).mock.calls[0]!;
    expect(call[0]).not.toContain('DROP TABLE');
    expect(call[1][0]).toEqual(["ALCLB49486FF'; DROP TABLE stock_serials;--"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/my/stores/serials/__tests__/validateBatchCore.test.ts`
Expected: FAIL — cannot resolve `../_validateBatchCore`.

- [ ] **Step 3: Write the core**

Create `pages/api/my/stores/serials/_validateBatchCore.ts`:

```ts
/**
 * runBatchValidation — validate every serial in one carton in a single round-trip.
 *
 * The stores PWA scans a Nokia carton code and gets nine serials at once;
 * nine sequential lookups would be nine HTTP requests on a warehouse phone.
 *
 * Verdicts come from the shared verdictForSerial so this endpoint and the
 * single-serial scan path can never disagree.
 *
 * The stock_quants comparison implements the "check both, warn on mismatch"
 * decision: serials decide issuability, quants disagreement is reported so the
 * drift stays visible until Phase 2 receiving lands.
 */

import { verdictForSerial } from '@/modules/field-stock-pwa/lib/serialVerdict';
import type { SerialRecord } from '@/modules/field-stock-pwa/lib/serialVerdict';

export interface BatchQuerier {
  query<T>(text: string, params: unknown[]): Promise<T[]>;
}

export interface BatchResult {
  serialNumber: string;
  valid: boolean;
  errorMessage?: string;
  stockItemId?: string;
  stockItemName?: string;
  currentLocationId?: string | null;
  currentLocationName?: string | null;
}

export interface BatchResponse {
  results: BatchResult[];
  quantsWarning?: { serialsInStock: number; quantsOnHand: number };
}

interface SerialQueryRow extends Record<string, unknown> {
  serial_number: string;
  stock_item_id: string;
  stock_item_name: string | null;
  status: string;
  current_location_id: string | null;
  current_location_name: string | null;
}

export async function runBatchValidation(
  db: BatchQuerier,
  input: { serials: string[]; stockItemId: string; sourceLocationId: string | null },
): Promise<BatchResponse> {
  const { serials, stockItemId, sourceLocationId } = input;

  const rows = await db.query<SerialQueryRow>(
    `SELECT s.serial_number,
            s.stock_item_id,
            i.name        AS stock_item_name,
            s.status,
            s.current_location_id,
            l.name        AS current_location_name
       FROM stock_serials s
       LEFT JOIN stock_items     i ON i.id = s.stock_item_id
       LEFT JOIN stock_locations l ON l.id = s.current_location_id
      WHERE UPPER(TRIM(s.serial_number)) = ANY($1::text[])`,
    [serials],
  );

  const byNumber = new Map<string, SerialQueryRow>();
  for (const row of rows) byNumber.set(row.serial_number.trim().toUpperCase(), row);

  let sourceLocationName = '';
  if (sourceLocationId) {
    const locRows = await db.query<{ name: string | null }>(
      `SELECT name FROM stock_locations WHERE id = $1`,
      [sourceLocationId],
    );
    // || not ??: an empty-string name must fall back too, not render blank.
    sourceLocationName = locRows[0]?.name || sourceLocationId;
  }

  let expectedItemName = '';
  for (const row of rows) {
    if (row.stock_item_id === stockItemId && row.stock_item_name) {
      expectedItemName = row.stock_item_name;
      break;
    }
  }

  const ctx = {
    expectedItemId: stockItemId,
    expectedItemName: expectedItemName || stockItemId,
    sourceLocation: sourceLocationId ? { id: sourceLocationId, name: sourceLocationName } : null,
  };

  const results: BatchResult[] = serials.map((serialNumber) => {
    const row = byNumber.get(serialNumber);
    const record: SerialRecord | null = row
      ? {
          serialNumber: row.serial_number,
          stockItemId: row.stock_item_id,
          stockItemName: row.stock_item_name,
          status: row.status,
          currentLocationId: row.current_location_id,
          currentLocationName: row.current_location_name,
        }
      : null;

    const verdict = verdictForSerial(record, ctx);
    return {
      serialNumber,
      valid: verdict.valid,
      ...(verdict.valid ? {} : { errorMessage: verdict.errorMessage }),
      stockItemId: verdict.stockItemId,
      stockItemName: verdict.stockItemName,
      currentLocationId: row?.current_location_id ?? null,
      currentLocationName: row?.current_location_name ?? null,
    };
  });

  if (!sourceLocationId) return { results };

  const serialsInStock = results.filter((r) => r.valid).length;
  const quantRows = await db.query<{ quantity: number }>(
    `SELECT quantity FROM stock_quants
      WHERE stock_item_id = $1 AND location_id = $2 AND COALESCE(lot_number, '') = ''`,
    [stockItemId, sourceLocationId],
  );
  const quantsOnHand = Number(quantRows[0]?.quantity ?? 0);

  return quantsOnHand === serialsInStock
    ? { results }
    : { results, quantsWarning: { serialsInStock, quantsOnHand } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run pages/api/my/stores/serials/__tests__/validateBatchCore.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the route shell**

Create `pages/api/my/stores/serials/validate-batch.ts`:

```ts
/**
 * POST /api/my/stores/serials/validate-batch — validate a scanned carton's
 * serials in one round-trip.
 *
 * Body: { serials: string[], stockItemId: string, sourceLocationId?: string }
 * Data: { results: BatchResult[], quantsWarning?: { serialsInStock, quantsOnHand } }
 *
 * Read-only. Status writes go through the domain endpoints (pickings, returns).
 * Gated to stores roles via requireStoresActor, same as the single-serial route.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getPool } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';
import { MAX_BOX_SERIALS } from '@/modules/field-stock-pwa/lib/boxScan';
import { runBatchValidation } from './_validateBatchCore';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERIAL_SHAPE = /^[A-Z0-9]{8,20}$/;

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  const body = (req.body ?? {}) as {
    serials?: unknown;
    stockItemId?: unknown;
    sourceLocationId?: unknown;
  };

  if (!Array.isArray(body.serials) || body.serials.length === 0) {
    return apiResponse.validationError(res, { serials: 'At least one serial is required' });
  }
  if (body.serials.length > MAX_BOX_SERIALS) {
    return apiResponse.validationError(res, {
      serials: `At most ${MAX_BOX_SERIALS} serials per request`,
    });
  }
  const serials = body.serials.map((s) => String(s).trim().toUpperCase());
  if (!serials.every((s) => SERIAL_SHAPE.test(s))) {
    return apiResponse.validationError(res, { serials: 'One or more serials are malformed' });
  }
  if (typeof body.stockItemId !== 'string' || !UUID.test(body.stockItemId)) {
    return apiResponse.validationError(res, { stockItemId: 'A valid stock item id is required' });
  }
  const sourceLocationId =
    typeof body.sourceLocationId === 'string' && UUID.test(body.sourceLocationId)
      ? body.sourceLocationId
      : null;

  try {
    const data = await runBatchValidation(getPool(), {
      serials,
      stockItemId: body.stockItemId,
      sourceLocationId,
    });
    return apiResponse.success(res, data);
  } catch (error) {
    log.error('validate-batch failed', { error }, 'my/stores/serials/validate-batch');
    return apiResponse.internalError(res, error);
  }
});
```

- [ ] **Step 6: Confirm the pool import name**

Run: `grep -n "export" src/lib/db-pool.ts | head -20`
Expected: a `getPool` export whose returned object has `.query(text, params)`. If the export is named differently (e.g. `pool`), adjust the import in the route only — `_validateBatchCore.ts` takes the querier as a parameter and needs no change.

- [ ] **Step 7: Typecheck and commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npx tsc --noEmit
npm run lint
git add pages/api/my/stores/serials/validate-batch.ts \
        pages/api/my/stores/serials/_validateBatchCore.ts \
        pages/api/my/stores/serials/__tests__/validateBatchCore.test.ts
git commit -m "feat(field-stock): batch serial validation endpoint for carton scans"
```

---

### Task 5: Client helper `validateSerialBatch`

**Files:**
- Modify: `src/modules/field-stock-pwa/api/serials.ts` (append; keep `validateSerial` untouched)
- Modify: `src/modules/field-stock-pwa/api/index.ts` (export the new helper — check the existing barrel style first)
- Test: `src/modules/field-stock-pwa/api/__tests__/serials.batch.test.ts`

**Interfaces:**
- Consumes: the endpoint from Task 4.
- Produces:
  ```ts
  export interface BatchSerialResult {
    serialNumber: string;
    valid: boolean;
    errorMessage?: string;
    stockItemId?: string;
    stockItemName?: string;
    currentLocationId?: string | null;
    currentLocationName?: string | null;
  }
  export async function validateSerialBatch(input: {
    serials: string[]; stockItemId: string; sourceLocationId?: string | null;
  }): Promise<{ results: BatchSerialResult[]; quantsWarning?: { serialsInStock: number; quantsOnHand: number } }>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/modules/field-stock-pwa/api/__tests__/serials.batch.test.ts`:

```ts
/**
 * validateSerialBatch — client helper for POST /my/stores/serials/validate-batch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../request', () => ({
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
    }
  },
}));

import { validateSerialBatch } from '../serials';
import { request } from '../request';
const requestMock = vi.mocked(request);

describe('validateSerialBatch', () => {
  beforeEach(() => { requestMock.mockReset(); });

  it('posts the serials and returns the per-serial results', async () => {
    requestMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true },
        { serialNumber: 'ALCLB4948758', valid: false, errorMessage: 'Serial number not found' },
      ],
    });

    const res = await validateSerialBatch({
      serials: ['ALCLB49486FF', 'ALCLB4948758'],
      stockItemId: 'item-ont',
      sourceLocationId: 'loc-garst',
    });

    expect(requestMock).toHaveBeenCalledWith('/api/my/stores/serials/validate-batch', {
      method: 'POST',
      body: {
        serials: ['ALCLB49486FF', 'ALCLB4948758'],
        stockItemId: 'item-ont',
        sourceLocationId: 'loc-garst',
      },
    });
    expect(res.results).toHaveLength(2);
    expect(res.results[1]!.valid).toBe(false);
  });

  it('surfaces the quants warning when the server sends one', async () => {
    requestMock.mockResolvedValueOnce({
      results: [{ serialNumber: 'ALCLB49486FF', valid: true }],
      quantsWarning: { serialsInStock: 1, quantsOnHand: 0 },
    });
    const res = await validateSerialBatch({ serials: ['ALCLB49486FF'], stockItemId: 'item-ont' });
    expect(res.quantsWarning).toEqual({ serialsInStock: 1, quantsOnHand: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/field-stock-pwa/api/__tests__/serials.batch.test.ts`
Expected: FAIL — `validateSerialBatch` is not exported from `../serials`.

- [ ] **Step 3: Check the `request` helper's call signature**

Run: `sed -n 1,60p src/modules/field-stock-pwa/api/request.ts`
Note the exact shape for a POST (`{ method, body }` vs `{ method, json }`). If it differs from the test above, fix **the test and the implementation together** to match the real helper — the helper is the source of truth.

- [ ] **Step 4: Implement**

Append to `src/modules/field-stock-pwa/api/serials.ts`:

```ts
// =============================================================================
// Batch validation (carton scans)
// =============================================================================

export interface BatchSerialResult {
  serialNumber: string;
  valid: boolean;
  errorMessage?: string;
  stockItemId?: string;
  stockItemName?: string;
  currentLocationId?: string | null;
  currentLocationName?: string | null;
}

export interface BatchSerialResponse {
  results: BatchSerialResult[];
  quantsWarning?: { serialsInStock: number; quantsOnHand: number };
}

/**
 * Validate every serial from one carton scan in a single round-trip.
 *
 * Unlike validateSerial, this never throws on a per-serial problem — an unknown
 * or misplaced serial comes back as a result with valid=false, so a partial box
 * still yields its good members. Transport errors still throw.
 */
export async function validateSerialBatch(input: {
  serials: string[];
  stockItemId: string;
  sourceLocationId?: string | null;
}): Promise<BatchSerialResponse> {
  return request<BatchSerialResponse>('/api/my/stores/serials/validate-batch', {
    method: 'POST',
    body: {
      serials: input.serials,
      stockItemId: input.stockItemId,
      sourceLocationId: input.sourceLocationId ?? null,
    },
  });
}
```

Then export it from the barrel — open `src/modules/field-stock-pwa/api/index.ts`, find the line re-exporting from `./serials`, and add `validateSerialBatch` (and the two types) alongside `validateSerial`, following whatever style that file already uses.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/modules/field-stock-pwa/api/__tests__/serials.batch.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run lint
git add src/modules/field-stock-pwa/api/serials.ts src/modules/field-stock-pwa/api/index.ts \
        src/modules/field-stock-pwa/api/__tests__/serials.batch.test.ts
git commit -m "feat(field-stock): client helper for batch serial validation"
```

---

### Task 6: `useScanSerial` expands a box scan into a group

**Files:**
- Modify: `src/modules/field-stock-pwa/types.ts` (two optional fields on `PwaScannedSerial`)
- Modify: `src/modules/field-stock-pwa/hooks/useScanSerial.ts`
- Test: `src/modules/field-stock-pwa/hooks/__tests__/useScanSerial.box.test.ts`

**Interfaces:**
- Consumes: `parseScanPayload` (Task 1), `verdictForSerial` (Task 3), `validateSerialBatch` client helper (Task 5).
- Produces:
  ```ts
  // types.ts — PwaScannedSerial gains:
  groupId?: string;     // shared by every member of one carton scan
  groupLabel?: string;  // e.g. 'Box · 9 serials'
  // useScanSerial returns, in addition to handleRawSerial and handleRemove:
  handleRemoveGroup: (groupId: string) => void;
  scanNotice: string | null;   // wrong-code hint, short-read warning, or ledger drift; null when clear
  clearScanNotice: () => void;
  ```

- [ ] **Step 1: Add the type fields**

In `src/modules/field-stock-pwa/types.ts`, extend `PwaScannedSerial`:

```ts
export interface PwaScannedSerial {
  serialNumber: string;
  stockItemId: string;
  stockItemName: string;
  scannedAt: number; // epoch ms; used for sort + audit
  state: 'pending-validation' | 'valid' | 'invalid';
  errorMessage?: string;
  /** Set on every member of one carton scan; absent for individually scanned units. */
  groupId?: string;
  /** Human label for the group header, e.g. 'Box · 9 serials'. Set on every member. */
  groupLabel?: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/field-stock-pwa/hooks/__tests__/useScanSerial.box.test.ts`:

```ts
/**
 * Tests for useScanSerial's carton-scan path.
 *
 * One scan of a Nokia box code must expand into N grouped chips validated in a
 * single batch call. A partial box keeps its good members — a data problem must
 * never block the handout.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useScanSerial } from '../useScanSerial';
import type { PwaScannedSerial } from '../../types';

vi.mock('@/modules/field-stock-pwa/api', () => ({
  validateSerial: vi.fn(),
  validateSerialBatch: vi.fn(),
}));

import { validateSerial, validateSerialBatch } from '@/modules/field-stock-pwa/api';
const validateSerialMock = vi.mocked(validateSerial);
const validateSerialBatchMock = vi.mocked(validateSerialBatch);

const STOCK_ITEM = { id: 'item-ont', name: 'FT-ONT' };
const GARSTFONTEIN = { id: 'loc-garst', name: 'Garstfontein DC' };
const BOX = 'ALCLB49486FF;ALCLB4948758;ALCLB4948779';
const PACKAGE_DATA = '[)>\x1e06\x1d1P3TN01414BA\x1dQ9\x1d3SM022540C0126A10210\x1e\x04';

function lastChange(onChange: ReturnType<typeof vi.fn>): PwaScannedSerial[] {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1]![0] as PwaScannedSerial[];
}

describe('useScanSerial carton scans', () => {
  beforeEach(() => {
    validateSerialMock.mockReset();
    validateSerialBatchMock.mockReset();
  });

  it('expands a box code into one chip per serial in a single batch call', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948779', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
      ],
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(BOX); });

    expect(validateSerialBatchMock).toHaveBeenCalledTimes(1);
    expect(validateSerialMock).not.toHaveBeenCalled();
    const rows = lastChange(onChange);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === 'valid')).toBe(true);
    const groupIds = new Set(rows.map((r) => r.groupId));
    expect(groupIds.size).toBe(1);
    expect(rows[0]!.groupLabel).toBe('Box · 3 serials');
  });

  it('keeps the good members of a partial box and flags the rest', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948758', valid: false, errorMessage: 'Serial is not available (status: issued)' },
        { serialNumber: 'ALCLB4948779', valid: false, errorMessage: 'Serial is at Lawley, not Garstfontein DC' },
      ],
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(BOX); });

    const rows = lastChange(onChange);
    expect(rows.filter((r) => r.state === 'valid')).toHaveLength(1);
    expect(rows.filter((r) => r.state === 'invalid')).toHaveLength(2);
    expect(rows[1]!.errorMessage).toContain('status: issued');
  });

  it('marks every member invalid when the batch call fails outright', async () => {
    validateSerialBatchMock.mockRejectedValueOnce(new Error('Network down'));
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(BOX); });

    const rows = lastChange(onChange);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === 'invalid')).toBe(true);
    expect(rows[0]!.errorMessage).toBe('Network down');
  });

  it('skips serials already scanned, batching only the new ones', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [{ serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' }],
    });
    const existing: PwaScannedSerial[] = [{
      serialNumber: 'ALCLB49486FF', stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      scannedAt: 1, state: 'valid',
    }];
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: existing, onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial('ALCLB49486FF;ALCLB4948758'); });

    expect(validateSerialBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({ serials: ['ALCLB4948758'] }),
    );
    expect(lastChange(onChange)).toHaveLength(2);
  });

  it('tells the storeman which square to scan when he scans the data code', async () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(PACKAGE_DATA); });

    await waitFor(() => {
      expect(result.current.scanNotice).toBe(
        "That's the data code. Scan the large square marked FULL SERIAL NUMBER LIST.",
      );
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(validateSerialBatchMock).not.toHaveBeenCalled();
  });

  it('warns when the box read is short of the quantity the label declares', async () => {
    validateSerialBatchMock.mockResolvedValueOnce({
      results: [
        { serialNumber: 'ALCLB49486FF', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948758', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
        { serialNumber: 'ALCLB4948779', valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT' },
      ],
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    // The storeman scans the small data square first (Q9), then the box code,
    // which only yields three serials — a short read the label can prove.
    await act(async () => { await result.current.handleRawSerial(PACKAGE_DATA); });
    await act(async () => { await result.current.handleRawSerial(BOX); });

    await waitFor(() => {
      expect(result.current.scanNotice).toBe('Label says 9, read 3 — rescan the box.');
    });
  });

  it('stays quiet when the box read matches the declared quantity', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => `ALCLB4948${String(i).padStart(3, '0')}A`);
    validateSerialBatchMock.mockResolvedValueOnce({
      results: nine.map((serialNumber) => ({
        serialNumber, valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      })),
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(PACKAGE_DATA); });
    await act(async () => { await result.current.handleRawSerial(nine.join(';')); });

    expect(result.current.scanNotice).toBeNull();
  });

  it('refuses a box larger than the cap instead of firing a huge request', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `ALCLB4948${String(i).padStart(4, '0')}`).join(';');
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial(many); });

    await waitFor(() => { expect(result.current.scanNotice).toContain('60 serials'); });
    expect(validateSerialBatchMock).not.toHaveBeenCalled();
  });

  it('removes every member of a group at once', async () => {
    const rows: PwaScannedSerial[] = [
      { serialNumber: 'A1', stockItemId: 'i', stockItemName: 'n', scannedAt: 1, state: 'valid', groupId: 'g1', groupLabel: 'Box · 2 serials' },
      { serialNumber: 'A2', stockItemId: 'i', stockItemName: 'n', scannedAt: 1, state: 'valid', groupId: 'g1', groupLabel: 'Box · 2 serials' },
      { serialNumber: 'B1', stockItemId: 'i', stockItemName: 'n', scannedAt: 2, state: 'valid' },
    ];
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: rows, onChange, sourceLocation: GARSTFONTEIN }),
    );

    act(() => { result.current.handleRemoveGroup('g1'); });

    expect(onChange).toHaveBeenCalledWith([rows[2]]);
  });

  it('still validates a single serial one at a time', async () => {
    validateSerialMock.mockResolvedValueOnce({
      valid: true, stockItemId: 'item-ont', stockItemName: 'FT-ONT',
      currentLocationId: 'loc-garst', currentLocationName: 'Garstfontein DC',
    });
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useScanSerial({ stockItem: STOCK_ITEM, scanned: [], onChange, sourceLocation: GARSTFONTEIN }),
    );

    await act(async () => { await result.current.handleRawSerial('ALCLB4949F3C'); });

    expect(validateSerialMock).toHaveBeenCalledTimes(1);
    expect(validateSerialBatchMock).not.toHaveBeenCalled();
    expect(lastChange(onChange)[0]!.groupId).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/modules/field-stock-pwa/hooks/__tests__/useScanSerial.box.test.ts`
Expected: FAIL — `handleRemoveGroup` and `scanNotice` are not returned by the hook.

- [ ] **Step 4: Implement**

In `src/modules/field-stock-pwa/hooks/useScanSerial.ts`:

Replace the import of `extractScannedSerial` with:

```ts
import { useCallback, useRef, useEffect, useState } from 'react';
import { validateSerial, validateSerialBatch } from '@/modules/field-stock-pwa/api';
import { parseScanPayload, MAX_BOX_SERIALS } from '@/modules/field-stock-pwa/lib/boxScan';
import { verdictForSerial } from '@/modules/field-stock-pwa/lib/serialVerdict';
```

Add inside the hook body, above `handleRawSerial`:

```ts
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const clearScanNotice = useCallback(() => setScanNotice(null), []);
  const groupSeq = useRef(0);
  /** Quantity declared by the carton's ISO data code, when the storeman scanned it. */
  const declaredQuantity = useRef<number | null>(null);

  const vibrate = (ms: number) => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(ms);
  };

  /** Expand one carton scan into grouped, batch-validated chips. */
  const handleBoxScan = useCallback(
    async (serials: string[]) => {
      const fresh = serials.filter((s) => !scannedSet.has(s));
      if (fresh.length === 0) { vibrate(30); return; }
      vibrate(50);

      groupSeq.current += 1;
      const groupId = `box-${Date.now()}-${groupSeq.current}`;
      const groupLabel = `Box · ${fresh.length} serial${fresh.length === 1 ? '' : 's'}`;
      const scannedAt = Date.now();

      const pending: PwaScannedSerial[] = fresh.map((serialNumber) => ({
        serialNumber, stockItemId: '', stockItemName: '', scannedAt,
        state: 'pending-validation', groupId, groupLabel,
      }));
      onChange([...scanned, ...pending]);

      let response: Awaited<ReturnType<typeof validateSerialBatch>>;
      try {
        response = await validateSerialBatch({
          serials: fresh,
          stockItemId: stockItem.id,
          sourceLocationId: sourceLocation?.id ?? null,
        });
      } catch (err) {
        if (!mountedRef.current) return;
        const msg = err instanceof Error ? err.message : 'Validation request failed';
        onChange([
          ...scanned,
          ...pending.map((p) => ({ ...p, state: 'invalid' as const, errorMessage: msg })),
        ]);
        return;
      }

      if (!mountedRef.current) return;

      const byNumber = new Map(response.results.map((r) => [r.serialNumber, r]));
      const resolved: PwaScannedSerial[] = pending.map((p) => {
        const result = byNumber.get(p.serialNumber);
        if (!result) {
          return { ...p, state: 'invalid' as const, errorMessage: 'Serial number not found' };
        }
        return result.valid
          ? {
              ...p,
              stockItemId: result.stockItemId ?? stockItem.id,
              stockItemName: result.stockItemName ?? stockItem.name,
              state: 'valid' as const,
            }
          : {
              ...p,
              stockItemId: result.stockItemId ?? '',
              stockItemName: result.stockItemName ?? '',
              state: 'invalid' as const,
              errorMessage: result.errorMessage ?? 'Serial is not available',
            };
      });

      if (response.quantsWarning) {
        const drift =
          `Stock ledger disagrees here — ${response.quantsWarning.serialsInStock} serials on the shelf, ` +
          `${response.quantsWarning.quantsOnHand} on the books. Issue is still allowed.`;
        // Append rather than replace: a short-read warning set by the caller is
        // the more urgent message and must not be silently overwritten.
        setScanNotice((prev) => (prev ? `${prev} ${drift}` : drift));
      }

      onChange([...scanned, ...resolved]);
    },
    [scanned, scannedSet, stockItem, onChange, sourceLocation],
  );
```

Then rewrite the top of `handleRawSerial` so it routes on the parsed payload. Replace these lines:

```ts
      const serial = extractScannedSerial(rawSerial).toUpperCase();
      if (!serial) return;
```

with:

```ts
      const payload = parseScanPayload(rawSerial);

      if (payload.kind === 'package-data') {
        // No serials here — but the declared quantity is worth keeping: if the
        // box code then reads short (a partial decode), we can prove it.
        declaredQuantity.current = payload.quantity ?? null;
        setScanNotice("That's the data code. Scan the large square marked FULL SERIAL NUMBER LIST.");
        return;
      }
      if (payload.kind === 'unrecognised') {
        setScanNotice('That barcode is not a serial or a carton label.');
        return;
      }
      if (payload.kind === 'box') {
        if (payload.serials.length > MAX_BOX_SERIALS) {
          setScanNotice(
            `That code holds ${payload.serials.length} serials — more than the ${MAX_BOX_SERIALS} allowed in one scan.`,
          );
          return;
        }
        const declared = declaredQuantity.current;
        setScanNotice(
          declared !== null && declared !== payload.serials.length
            ? `Label says ${declared}, read ${payload.serials.length} — rescan the box.`
            : null,
        );
        await handleBoxScan(payload.serials);
        return;
      }

      setScanNotice(null);
      const serial = payload.serial;
```

Add `handleBoxScan` to `handleRawSerial`'s dependency array. Add the group remover below `handleRemove`:

```ts
  const handleRemoveGroup = useCallback(
    (groupId: string) => onChange(scanned.filter((s) => s.groupId !== groupId)),
    [scanned, onChange],
  );
```

Change the return to:

```ts
  return { handleRawSerial, handleRemove, handleRemoveGroup, scanNotice, clearScanNotice };
```

- [ ] **Step 5: Run both hook test files**

Run: `npx vitest run src/modules/field-stock-pwa/hooks/__tests__/`
Expected: PASS — the new box tests and the pre-existing `useScanSerial.test.ts` location tests.

- [ ] **Step 6: Leave `extractScannedSerial` in place for now**

Run: `grep -rn "extractScannedSerial" --include=*.ts --include=*.tsx src pages`

Expected hits: `lib/scannedSerial.ts`, its test, and **`pages/api/my/stores/serials/_extractCore.ts`**. That last caller is the photo-fallback decode path, which Task 10 moves onto `parseScanPayload`. Do **not** delete the old parser here — Task 10 removes the last caller and deletes it. Deleting now breaks the extract endpoint.

- [ ] **Step 7: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run lint
git add -A src/modules/field-stock-pwa
git commit -m "feat(field-stock): expand a carton scan into a validated serial group"
```

---

### Task 7: `BoxGroupChip` and grouped rendering in `ScanSerialsStep`

**Files:**
- Create: `src/modules/field-stock-pwa/components/BoxGroupChip.tsx`
- Modify: `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx`
- Modify: `src/modules/field-stock-pwa/components/index.ts` (barrel)
- Test: `src/modules/field-stock-pwa/components/__tests__/BoxGroupChip.test.tsx`

**Interfaces:**
- Consumes: `PwaScannedSerial` with `groupId`/`groupLabel` (Task 6); `SerialChip` (existing).
- Produces:
  ```ts
  export interface BoxGroupChipProps {
    groupId: string;
    label: string;
    members: PwaScannedSerial[];
    onRemoveGroup: (groupId: string) => void;
    onRemoveMember: (serialNumber: string) => void;
  }
  export function BoxGroupChip(props: BoxGroupChipProps): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/modules/field-stock-pwa/components/__tests__/BoxGroupChip.test.tsx`:

```tsx
/**
 * BoxGroupChip — one collapsible row standing for a whole scanned carton.
 *
 * The storeman must see at a glance how many of the box's serials are usable,
 * and be able to drop the whole box or one bad member.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BoxGroupChip } from '../BoxGroupChip';
import type { PwaScannedSerial } from '../../types';

function member(over: Partial<PwaScannedSerial>): PwaScannedSerial {
  return {
    serialNumber: 'ALCLB49486FF', stockItemId: 'i', stockItemName: 'FT-ONT',
    scannedAt: 1, state: 'valid', groupId: 'g1', groupLabel: 'Box · 3 serials', ...over,
  };
}

const MEMBERS = [
  member({ serialNumber: 'ALCLB49486FF' }),
  member({ serialNumber: 'ALCLB4948758', state: 'invalid', errorMessage: 'Serial is not available (status: issued)' }),
  member({ serialNumber: 'ALCLB4948779' }),
];

describe('BoxGroupChip', () => {
  it('summarises valid and rejected counts without expanding', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    expect(screen.getByText('Box · 3 serials')).toBeInTheDocument();
    expect(screen.getByText(/2 valid/)).toBeInTheDocument();
    expect(screen.getByText(/1 rejected/)).toBeInTheDocument();
    expect(screen.queryByText('ALCLB49486FF')).not.toBeInTheDocument();
  });

  it('omits the rejected count when the whole box is clean', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 2 serials"
        members={[MEMBERS[0]!, MEMBERS[2]!]} onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    expect(screen.queryByText(/rejected/)).not.toBeInTheDocument();
  });

  it('lists the members once expanded', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Box · 3 serials/ }));
    expect(screen.getByText('ALCLB49486FF')).toBeInTheDocument();
    expect(screen.getByText('Serial is not available (status: issued)')).toBeInTheDocument();
  });

  it('removes the whole box', () => {
    const onRemoveGroup = vi.fn();
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={onRemoveGroup} onRemoveMember={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove this box' }));
    expect(onRemoveGroup).toHaveBeenCalledWith('g1');
  });

  it('removes one bad member without touching the rest', () => {
    const onRemoveMember = vi.fn();
    render(
      <BoxGroupChip groupId="g1" label="Box · 3 serials" members={MEMBERS}
        onRemoveGroup={vi.fn()} onRemoveMember={onRemoveMember} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Box · 3 serials/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove ALCLB4948758' }));
    expect(onRemoveMember).toHaveBeenCalledWith('ALCLB4948758');
  });

  it('shows a pending count while the batch call is in flight', () => {
    render(
      <BoxGroupChip groupId="g1" label="Box · 2 serials"
        members={[member({ state: 'pending-validation' }), member({ serialNumber: 'X2', state: 'pending-validation' })]}
        onRemoveGroup={vi.fn()} onRemoveMember={vi.fn()} />,
    );
    expect(screen.getByText(/checking/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/field-stock-pwa/components/__tests__/BoxGroupChip.test.tsx`
Expected: FAIL — cannot resolve `../BoxGroupChip`.

- [ ] **Step 3: Implement the component**

Create `src/modules/field-stock-pwa/components/BoxGroupChip.tsx`:

```tsx
'use client';

/**
 * BoxGroupChip — one row standing for a whole scanned carton.
 *
 * A nine-serial box would otherwise flood the scan list and bury the loose
 * units the storeman still has to add. Collapsed by default: the summary is
 * what he checks ("9 valid"), the member list is what he opens when it isn't.
 *
 * Rejected members stay visible inside the group rather than disappearing —
 * the box is issued without them, and he needs to know which ones to set aside.
 */

import { useState } from 'react';
import { ChevronDown, Package, Trash2 } from 'lucide-react';
import { SerialChip } from './SerialChip';
import type { PwaScannedSerial } from '@/modules/field-stock-pwa/types';

export interface BoxGroupChipProps {
  groupId: string;
  label: string;
  members: PwaScannedSerial[];
  onRemoveGroup: (groupId: string) => void;
  onRemoveMember: (serialNumber: string) => void;
}

export function BoxGroupChip({
  groupId, label, members, onRemoveGroup, onRemoveMember,
}: BoxGroupChipProps) {
  const [open, setOpen] = useState(false);

  const valid = members.filter((m) => m.state === 'valid').length;
  const invalid = members.filter((m) => m.state === 'invalid').length;
  const pending = members.filter((m) => m.state === 'pending-validation').length;

  const border = invalid > 0 ? 'border-amber-800 bg-amber-950/20' : 'border-emerald-800 bg-emerald-950/20';

  return (
    <li className={`rounded-lg border ${border}`}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <Package className="w-4 h-4 text-neutral-300 flex-shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="text-xs text-neutral-400 mt-0.5">
            {pending > 0
              ? `Checking ${pending}…`
              : `${valid} valid${invalid > 0 ? ` · ${invalid} rejected` : ''}`}
          </div>
        </button>
        <ChevronDown
          className={`w-4 h-4 text-neutral-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
        <button
          type="button"
          onClick={() => onRemoveGroup(groupId)}
          aria-label="Remove this box"
          className="text-neutral-500 hover:text-rose-300 flex-shrink-0 p-0.5"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <ul className="space-y-1.5 px-2 pb-2">
          {members.map((m) => (
            <SerialChip key={m.serialNumber} serial={m} onRemove={onRemoveMember} />
          ))}
        </ul>
      )}
    </li>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/field-stock-pwa/components/__tests__/BoxGroupChip.test.tsx`
Expected: PASS, 6 tests. The accessible name of the expander button includes the label text, which is what the `getByRole('button', { name: /Box · 3 serials/ })` query matches.

- [ ] **Step 5: Render groups in `ScanSerialsStep`**

In `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx`:

Add the import:

```ts
import { BoxGroupChip } from '@/modules/field-stock-pwa/components/BoxGroupChip';
```

Take the new hook returns:

```ts
  const { handleRawSerial, handleRemove, handleRemoveGroup, scanNotice, clearScanNotice } =
    useScanSerial({ stockItem, scanned, onChange, sourceLocation });
```

Above the return, build the render order — groups keep their scan position, so a box scanned first stays first:

```ts
  // Render newest-first (matching the previous [...scanned].reverse()), with each
  // carton collapsed into a single row at the position of its first member.
  const renderRows = (() => {
    const seenGroups = new Set<string>();
    const rows: Array<
      | { type: 'single'; serial: PwaScannedSerial }
      | { type: 'group'; groupId: string; label: string; members: PwaScannedSerial[] }
    > = [];
    for (const serial of scanned) {
      if (!serial.groupId) {
        rows.push({ type: 'single', serial });
        continue;
      }
      if (seenGroups.has(serial.groupId)) continue;
      seenGroups.add(serial.groupId);
      rows.push({
        type: 'group',
        groupId: serial.groupId,
        label: serial.groupLabel ?? 'Box',
        members: scanned.filter((s) => s.groupId === serial.groupId),
      });
    }
    return rows.reverse();
  })();
```

Replace the scanned-list block:

```tsx
      {/* Scanned list */}
      {scanned.length > 0 && (
        <ul className="space-y-1.5">
          {[...scanned].reverse().map((row) => (
            <SerialChip key={row.serialNumber} serial={row} onRemove={handleRemove} />
          ))}
        </ul>
      )}
```

with:

```tsx
      {/* Scan notice — wrong code scanned, oversized box, or ledger drift */}
      {scanNotice && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800">
          <p className="flex-1 text-xs text-amber-200">{scanNotice}</p>
          <button
            type="button"
            onClick={clearScanNotice}
            aria-label="Dismiss"
            className="text-amber-400 hover:text-amber-200 text-xs"
          >
            ✕
          </button>
        </div>
      )}

      {/* Scanned list — cartons collapse to one row, loose units render as before */}
      {scanned.length > 0 && (
        <ul className="space-y-1.5">
          {renderRows.map((row) =>
            row.type === 'group' ? (
              <BoxGroupChip
                key={row.groupId}
                groupId={row.groupId}
                label={row.label}
                members={row.members}
                onRemoveGroup={handleRemoveGroup}
                onRemoveMember={handleRemove}
              />
            ) : (
              <SerialChip key={row.serial.serialNumber} serial={row.serial} onRemove={handleRemove} />
            ),
          )}
        </ul>
      )}
```

Export `BoxGroupChip` from `src/modules/field-stock-pwa/components/index.ts` in the style that file already uses.

- [ ] **Step 6: Check the file-size cap**

Run: `wc -l src/modules/field-stock-pwa/components/ScanSerialsStep.tsx src/modules/field-stock-pwa/components/BoxGroupChip.tsx`
Expected: both under 200 lines. If `ScanSerialsStep` crosses it, lift the `renderRows` builder into `src/modules/field-stock-pwa/lib/scanRows.ts` as a pure exported function and import it — that keeps the component thin and the ordering logic unit-testable.

- [ ] **Step 7: Run the module's whole suite and commit**

Run: `npx vitest run src/modules/field-stock-pwa/`
Expected: PASS.

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run lint
git add src/modules/field-stock-pwa
git commit -m "feat(field-stock): collapse a scanned carton into one group row"
```

---

### Task 8: Soft warning above ten units

**Files:**
- Create: `src/modules/field-stock-pwa/lib/batchWarning.ts`
- Test: `src/modules/field-stock-pwa/lib/__tests__/batchWarning.test.ts`
- Modify: `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx`

**Interfaces:**
- Consumes: `PwaScannedSerial` (Task 6).
- Produces:
  ```ts
  export const SOFT_BATCH_WARN_AT = 10;
  export function batchWarning(validCount: number): string | null;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/modules/field-stock-pwa/lib/__tests__/batchWarning.test.ts`:

```ts
/**
 * batchWarning — a nudge, never a block.
 *
 * Ten units is a normal day. More than ten is usually a double-scan, but a
 * crew kit-out is legitimate, so the storeman can always proceed.
 */
import { describe, it, expect } from 'vitest';
import { batchWarning, SOFT_BATCH_WARN_AT } from '../batchWarning';

describe('batchWarning', () => {
  it('stays quiet at or below the threshold', () => {
    expect(batchWarning(0)).toBeNull();
    expect(batchWarning(1)).toBeNull();
    expect(batchWarning(SOFT_BATCH_WARN_AT)).toBeNull();
  });

  it('warns above the threshold, naming the count', () => {
    expect(batchWarning(11)).toBe(
      "That's 11 units in one issue — more than the usual 10. Double-scanned?",
    );
  });

  it('keeps warning as the count climbs', () => {
    expect(batchWarning(25)).toContain('25 units');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/field-stock-pwa/lib/__tests__/batchWarning.test.ts`
Expected: FAIL — cannot resolve `../batchWarning`.

- [ ] **Step 3: Implement**

Create `src/modules/field-stock-pwa/lib/batchWarning.ts`:

```ts
/**
 * batchWarning — soft guard on issue size.
 *
 * A ten-unit handout (one carton of nine plus a loose unit) is the normal day.
 * Beyond that is usually a double-scan, but kitting out a crew is legitimate —
 * so this returns a message to show, never a reason to disable submit.
 */

export const SOFT_BATCH_WARN_AT = 10;

export function batchWarning(validCount: number): string | null {
  if (validCount <= SOFT_BATCH_WARN_AT) return null;
  return `That's ${validCount} units in one issue — more than the usual ${SOFT_BATCH_WARN_AT}. Double-scanned?`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/field-stock-pwa/lib/__tests__/batchWarning.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Show it in `ScanSerialsStep`**

Add the import:

```ts
import { batchWarning } from '@/modules/field-stock-pwa/lib/batchWarning';
```

Below the existing `const canDone = …` line add:

```ts
  const overBatchWarning = batchWarning(validCount);
```

Insert directly above the Done button:

```tsx
      {overBatchWarning && (
        <p className="text-xs text-amber-400 px-1">{overBatchWarning}</p>
      )}
```

The Done button's `disabled={!canDone}` is unchanged — the warning informs, it does not gate.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run src/modules/field-stock-pwa/`
Expected: PASS.

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run lint
git add src/modules/field-stock-pwa
git commit -m "feat(field-stock): warn above ten units per issue without blocking"
```

---

### Task 9: Serial-first availability with a quants drift log

The July 2026 failure was a signed picking refused at `process` because `stock_quants` had no row, while the serials were physically on the shelf. For serial-tracked lines the serials now decide, and the quants disagreement is recorded instead of thrown.

**Files:**
- Create: `scripts/migrations/sql/506_stock_quant_drift_log.sql`
- Create: `scripts/migrations/sql/rollback_506_stock_quant_drift_log.sql`
- Modify: `pages/api/procurement/field-stock/pickings/[pickingId]/_availability.ts`
- Test: `pages/api/procurement/field-stock/pickings/__tests__/process.availability.test.ts` (extend; do not rewrite the existing cases)

**Interfaces:**
- Consumes: `PickingLine` (existing, in `_availability.ts`).
- Produces: `validateStockAvailability` keeps its exact signature and return type. New behaviour only.

- [ ] **Step 1: Confirm 506 is free**

Run:

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
ls scripts/migrations/sql | grep -E '^(506|rollback_506)' || echo "506 is free"
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow -tA \
  -c "select filename from schema_migrations order by filename desc limit 3;"
```

(Connection details: `.claude/credentials.local.md`.) Expected: no 506 file, and no 506 row applied. If 506 is taken, use the next free number consistently across both files.

- [ ] **Step 2: Write the migration**

Create `scripts/migrations/sql/506_stock_quant_drift_log.sql`:

```sql
-- 506: append-only record of stock_quants disagreeing with the serial ledger.
--
-- Serial-tracked issues now trust the scanned serials, because stock_quants is
-- a 26-May-2026 Odoo opening-balance snapshot with no consumption postings —
-- it refused genuine handouts through 2026-07 and the flow lost its users.
--
-- Every disagreement is written here rather than raised, so the drift stays
-- measurable and can be watched shrinking once PWA receiving (Phase 2) starts
-- recording physical moves. Nothing reads this table at issue time.

CREATE TABLE IF NOT EXISTS stock_quant_drift_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  picking_id      UUID        NOT NULL,
  stock_item_id   UUID        NOT NULL,
  location_id     UUID        NOT NULL,
  serials_counted INTEGER     NOT NULL,
  quants_on_hand  NUMERIC     NOT NULL,
  observed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_quant_drift_log_item_location
  ON stock_quant_drift_log (stock_item_id, location_id, observed_at DESC);
```

Create `scripts/migrations/sql/rollback_506_stock_quant_drift_log.sql`:

```sql
-- Rollback 506. The table is append-only diagnostics; dropping it loses the
-- drift history but affects no issue, return or accountability path.
DROP INDEX IF EXISTS idx_stock_quant_drift_log_item_location;
DROP TABLE IF EXISTS stock_quant_drift_log;
```

- [ ] **Step 3: Write the failing tests**

Append to `pages/api/procurement/field-stock/pickings/__tests__/process.availability.test.ts` (keep every existing case — they cover the bulk path, which must not change):

```ts
describe('validateStockAvailability — serial-tracked lines', () => {
  const SOURCE_ID = 'loc-garst';

  function txnFor(handlers: {
    serials?: unknown[];
    quants?: unknown[];
    onInsert?: (text: string, params: unknown[]) => void;
  }) {
    const query = vi.fn(async (text: string, params: unknown[]) => {
      if (text.includes('INSERT INTO stock_quant_drift_log')) {
        handlers.onInsert?.(text, params);
        return [];
      }
      if (text.includes('FROM stock_serials')) return handlers.serials ?? [];
      if (text.includes('FROM stock_quants')) return handlers.quants ?? [];
      if (text.includes('FROM stock_locations')) return [{ name: 'Garstfontein DC' }];
      if (text.includes('FROM stock_items')) return [{ item_code: 'FT-ONT', name: 'ONT' }];
      return [];
    });
    return { query } as unknown as Parameters<typeof validateStockAvailability>[0];
  }

  const SERIAL_LINE = {
    id: 'line-1',
    stock_item_id: 'item-ont',
    planned_quantity: 9,
    serial_ids: Array.from({ length: 9 }, (_, i) => `serial-${i}`),
  };

  it('passes when every serial is in stock at the source, even with no quants row', async () => {
    const txn = txnFor({
      serials: SERIAL_LINE.serial_ids.map((id) => ({ id, status: 'in_stock', current_location_id: SOURCE_ID })),
      quants: [],
    });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(true);
  });

  it('records the drift when quants disagree, without failing the issue', async () => {
    const onInsert = vi.fn();
    const txn = txnFor({
      serials: SERIAL_LINE.serial_ids.map((id) => ({ id, status: 'in_stock', current_location_id: SOURCE_ID })),
      quants: [{ quantity: 0 }],
      onInsert,
    });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(true);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0]![1]).toEqual(
      expect.arrayContaining(['item-ont', SOURCE_ID, 9, 0]),
    );
  });

  it('fails when a serial is not in stock, naming how many', async () => {
    const txn = txnFor({
      serials: [
        ...SERIAL_LINE.serial_ids.slice(0, 8).map((id) => ({ id, status: 'in_stock', current_location_id: SOURCE_ID })),
        { id: 'serial-8', status: 'issued', current_location_id: SOURCE_ID },
      ],
    });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.errors['item-ont']).toContain('1 of 9');
  });

  it('fails when a serial sits at another warehouse', async () => {
    const txn = txnFor({
      serials: [
        ...SERIAL_LINE.serial_ids.slice(0, 8).map((id) => ({ id, status: 'in_stock', current_location_id: SOURCE_ID })),
        { id: 'serial-8', status: 'in_stock', current_location_id: 'loc-lawley' },
      ],
    });
    const result = await validateStockAvailability(txn, [SERIAL_LINE], SOURCE_ID);
    expect(result.valid).toBe(false);
  });

  it('leaves the quants path untouched for a line with no serials', async () => {
    const txn = txnFor({ quants: [{ quantity: 0 }] });
    const result = await validateStockAvailability(
      txn, [{ id: 'l', stock_item_id: 'item-cable', planned_quantity: 5 }], SOURCE_ID,
    );
    expect(result.valid).toBe(false);
  });
});
```

Add `vi` to the file's vitest import if it is not already there.

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run pages/api/procurement/field-stock/pickings/__tests__/process.availability.test.ts`
Expected: the five new cases FAIL (serial lines currently take the quants path); the pre-existing cases PASS.

- [ ] **Step 5: Implement**

In `pages/api/procurement/field-stock/pickings/[pickingId]/_availability.ts`, extend the header comment:

```ts
/**
 * Stock availability validation for picking processing.
 *
 * Extracted from process.ts (already over the 300-line cap). Error messages
 * name the item and warehouse — the stores PWA shows them to field staff, and
 * raw UUIDs are unactionable there. Name lookups run only on failing lines
 * (and are memoized), so the happy path costs no extra queries.
 *
 * Serial-tracked lines are validated against the SERIALS, not stock_quants.
 * stock_quants is a 26-May-2026 Odoo opening-balance snapshot with no
 * consumption postings; requiring a row from it refused genuine handouts
 * through 2026-07. The quants comparison still runs and any disagreement is
 * written to stock_quant_drift_log (migration 506) so the drift stays
 * measurable — but it no longer blocks an issue whose serials are on the shelf.
 */
```

Add inside `validateStockAvailability`, at the top of the `for (const line of lines)` body, immediately after the `if (!line || !line.stock_item_id) continue;` guard:

```ts
    const serialIds = line.serial_ids ?? [];
    if (serialIds.length > 0) {
      const serialRows = await txn.query<{ id: string; status: string; current_location_id: string | null }>(
        `SELECT id, status, current_location_id FROM stock_serials
          WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [serialIds],
      );
      const byId = new Map(serialRows.map((r) => [r.id, r]));
      const unusable = serialIds.filter((id) => {
        const row = byId.get(id);
        if (!row) return true;
        if (row.status !== 'available' && row.status !== 'in_stock') return true;
        return row.current_location_id !== null && row.current_location_id !== sourceLocationId;
      });

      if (unusable.length > 0) {
        errors[line.stock_item_id] =
          `${unusable.length} of ${serialIds.length} ${await itemLabel(line.stock_item_id)} serials are not in stock at ${await locationName()}`;
        continue;
      }

      // Serials decide. The quants comparison is recorded, never enforced.
      const driftQuants = await txn.query<StockQuantRow>(
        `SELECT quantity FROM stock_quants
          WHERE stock_item_id = $1 AND location_id = $2 AND COALESCE(lot_number, '') = COALESCE($3, '')`,
        [line.stock_item_id, sourceLocationId, line.lot_number ?? null],
      );
      const quantsOnHand = Number(driftQuants[0]?.quantity ?? 0);
      if (quantsOnHand < serialIds.length) {
        await txn.query(
          `INSERT INTO stock_quant_drift_log
             (picking_id, stock_item_id, location_id, serials_counted, quants_on_hand)
           VALUES ($1, $2, $3, $4, $5)`,
          [line.id, line.stock_item_id, sourceLocationId, serialIds.length, quantsOnHand],
        );
      }
      continue;
    }
```

Note the `picking_id` column receives `line.id` — the picking line id, which resolves to its picking. If a reviewer prefers the picking id itself, thread it in as a new parameter rather than guessing here.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run pages/api/procurement/field-stock/pickings/__tests__/process.availability.test.ts`
Expected: PASS, all cases old and new.

- [ ] **Step 7: Apply the migration to the shared database**

⚠️ Dev and production share one database — this applies everywhere immediately. The table is additive and read by nothing at issue time, so it is safe, but confirm with Hein before running it.

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow \
  -f scripts/migrations/sql/506_stock_quant_drift_log.sql
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow -tA \
  -c "INSERT INTO schema_migrations (filename) VALUES ('506_stock_quant_drift_log.sql');"
PGPASSWORD="$PGPASSWORD" psql -h 100.96.203.105 -p 5437 -U fibreflow_user -d fibreflow -c "\d stock_quant_drift_log"
```

Expected: the table exists with six columns.

- [ ] **Step 8: Commit**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run lint
git add scripts/migrations/sql/506_stock_quant_drift_log.sql \
        scripts/migrations/sql/rollback_506_stock_quant_drift_log.sql \
        "pages/api/procurement/field-stock/pickings/[pickingId]/_availability.ts" \
        pages/api/procurement/field-stock/pickings/__tests__/process.availability.test.ts
git commit -m "feat(field-stock): trust serials for serial-tracked availability, log quants drift"
```

---

### Task 10: Photo fallback returns every serial in a carton

The camera may not decode a dense carton DataMatrix in live video. The photo path is the fallback, and today `decodeSerialFromImage` returns a single `string | null`.

**Files:**
- Modify: `pages/api/my/stores/serials/_extractCore.ts`
- Modify: `pages/api/my/stores/serials/extract.ts`
- Modify: `src/modules/field-stock-pwa/api/serials.ts` (`SerialExtractResult` gains `serials`)
- Modify: `src/modules/field-stock-pwa/components/PhotoSerialFallback.tsx`
- Modify: `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx`
- Test: extend `pages/api/my/stores/serials/__tests__/_extractCore.test.ts`
- Delete: `src/modules/field-stock-pwa/lib/scannedSerial.ts` and its test (this task removes its last caller)

**Interfaces:**
- Consumes: `parseScanPayload` (Task 1).
- Produces:
  ```ts
  /** Every valid serial the image yielded: nine for a carton, one for a unit label, empty for none. */
  export async function decodeSerialsFromImage(buffer: Buffer): Promise<string[]>;
  /** Unchanged signature — now a thin wrapper over decodeSerialsFromImage. */
  export async function decodeSerialFromImage(buffer: Buffer): Promise<string | null>;
  // client: SerialExtractResult gains `serials: string[]`; `serial` keeps holding the first.
  ```

**Note on the existing tests:** this file mocks nothing — it writes a real barcode with `zxing-wasm`'s writer and decodes it back. Follow that. Also note `PROMPT_EXAMPLE_SERIALS` in `_extractCore.ts` contains `ALCLB4923FA8`, so `validateSerialCandidate` rejects that specific serial as a hallucination guard — do not use it in these tests. The nine carton serials all satisfy `ONT_RE` (`/^ALCLB4[0-9A-F]{6}$/`).

- [ ] **Step 1: Write the failing test**

Append to `pages/api/my/stores/serials/__tests__/_extractCore.test.ts`:

```ts
describe('decodeSerialsFromImage — carton labels', () => {
  const BOX_SERIALS = [
    'ALCLB49486FF', 'ALCLB4948758', 'ALCLB4948779', 'ALCLB49488FC', 'ALCLB4949054',
    'ALCLB4949388', 'ALCLB4949DEF', 'ALCLB4949F2F', 'ALCLB4949F3C',
  ];

  it('returns all nine serials from a carton box DataMatrix', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    const written = await writeBarcode(BOX_SERIALS.join(';'), { format: 'DataMatrix' });
    const buf = await symbolToPng(written.symbol!);
    expect(await decodeSerialsFromImage(buf)).toEqual(BOX_SERIALS);
  });

  it('returns a one-element list for a single-unit ISO envelope', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    const payload = '[)>\x1e06\x1d1P3TN01414BA\x1dSALCLB4918842\x1e\x04';
    const written = await writeBarcode(payload, { format: 'DataMatrix' });
    const buf = await symbolToPng(written.symbol!);
    expect(await decodeSerialsFromImage(buf)).toEqual(['ALCLB4918842']);
  });

  it('returns an empty list when nothing decodes', async () => {
    const blank = await sharp({
      create: { width: 200, height: 200, channels: 3, background: '#888888' },
    }).jpeg().toBuffer();
    expect(await decodeSerialsFromImage(blank)).toEqual([]);
  });

  it('drops carton members that fail the serial-family check', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    // 3TN… is a part number, explicitly rejected by validateSerialCandidate.
    const written = await writeBarcode('ALCLB49486FF;3TN01414BA;ALCLB4948758', { format: 'DataMatrix' });
    const buf = await symbolToPng(written.symbol!);
    expect(await decodeSerialsFromImage(buf)).toEqual(['ALCLB49486FF', 'ALCLB4948758']);
  });

  it('keeps decodeSerialFromImage returning just the first serial', async () => {
    const { writeBarcode } = await import('zxing-wasm/full');
    const written = await writeBarcode(BOX_SERIALS.join(';'), { format: 'DataMatrix' });
    const buf = await symbolToPng(written.symbol!);
    expect(await decodeSerialFromImage(buf)).toBe('ALCLB49486FF');
  });
});
```

Add `decodeSerialsFromImage` to the file's import from `../_extractCore`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/my/stores/serials/__tests__/_extractCore.test.ts`
Expected: the five new cases FAIL — `decodeSerialsFromImage` is not exported. The three pre-existing `decodeSerialFromImage` cases still PASS.

- [ ] **Step 3: Implement in `_extractCore.ts`**

Swap the parser import:

```ts
import { parseScanPayload } from '@/modules/field-stock-pwa/lib/boxScan';
```

(remove `import { extractScannedSerial } from '@/modules/field-stock-pwa/lib/scannedSerial';`)

Rename the existing `decodeSerialFromImage` to `decodeSerialsFromImage`, change its return type to `Promise<string[]>`, and replace its result loop. The whole `for (const r of results) { … } return null;` block plus the `catch` becomes:

```ts
    // zxing-wasm renders ISO 15434 control bytes as Unicode Control Pictures
    // (U+241D/241E/2404) rather than raw bytes. Normalise back so the parser
    // (which splits on \x1d/\x1e/\x04) sees a real envelope.
    const payloads = results.map((r) =>
      parseScanPayload(
        r.text.replace(/␝/g, '\x1d').replace(/␞/g, '\x1e').replace(/␄/g, '\x04'),
      ),
    );

    // A photo of a carton catches the box DataMatrix AND the per-unit Code128s
    // printed below it. The box code is the richer read — prefer it, and fall
    // back to individual serials only when no box code decoded.
    const box = payloads.find((p) => p.kind === 'box');
    if (box && box.kind === 'box') {
      const valid = box.serials.filter((s) => validateSerialCandidate(s) !== null);
      if (valid.length > 0) return valid;
    }

    for (const payload of payloads) {
      if (payload.kind !== 'single') continue;
      const candidate = validateSerialCandidate(payload.serial);
      if (candidate) return [candidate.serial];
    }
    return [];
  } catch (err) {
    log.warn('serial extract: zxing decode failed', { err }, 'my/stores/serials/extract');
    return [];
  }
}

/**
 * Single-serial convenience wrapper — the shape the VLM fallback path and the
 * older callers expect. A carton photo yields its first serial here.
 */
export async function decodeSerialFromImage(buffer: Buffer): Promise<string | null> {
  const serials = await decodeSerialsFromImage(buffer);
  return serials[0] ?? null;
}
```

Update the function's doc comment to say it returns every serial found, a carton giving nine.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run pages/api/my/stores/serials/__tests__/_extractCore.test.ts`
Expected: PASS — all eight cases, old and new.

- [ ] **Step 5: Return the list from the endpoint**

In `pages/api/my/stores/serials/extract.ts`, import `decodeSerialsFromImage` alongside the existing imports and replace the barcode branch (currently lines 107–115):

```ts
    const decodedSerials = await decodeSerialsFromImage(buffer);
    const decodedValid = decodedSerials
      .map((s) => validateSerialCandidate(s))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    if (decodedValid.length > 0) {
      log.info(
        'serial extract: barcode hit',
        { family: decodedValid[0]!.family, count: decodedValid.length },
        'my/stores/serials/extract',
      );
      return apiResponse.success(res, {
        serial: decodedValid[0]!.serial,
        serials: decodedValid.map((c) => c.serial),
        family: decodedValid[0]!.family,
        method: 'barcode',
        confidence: 1,
        photoUrl,
      });
    }
```

In the VLM branch further down and in the no-result branch, add `serials: <the single serial in an array, or []>` so the field is always present in the response.

- [ ] **Step 6: Surface it on the client**

In `src/modules/field-stock-pwa/api/serials.ts`, add to `SerialExtractResult`:

```ts
  /** Every serial the photo yielded. A carton gives nine; a unit label gives one. */
  serials: string[];
```

In `src/modules/field-stock-pwa/components/PhotoSerialFallback.tsx`, add the prop and the branch:

```ts
export interface PhotoSerialFallbackProps {
  onSerial: (serial: string) => void;
  /** Called instead of onSerial when the photo caught a whole carton. */
  onSerials?: (serials: string[]) => void;
  onNoSerial: (message: string) => void;
}
```

and in the result handler, before the existing `onSerial(result.serial)` call:

```ts
        if (result.serials && result.serials.length > 1 && onSerials) {
          onSerials(result.serials);
          return;
        }
```

Add `onSerials` to that callback's dependency array.

In `src/modules/field-stock-pwa/components/ScanSerialsStep.tsx`, wire it:

```tsx
      <PhotoSerialFallback
        onSerial={(serial) => { setFallbackHint(null); setManualOpen(true); setManualInput(serial); }}
        onSerials={(serials) => { setFallbackHint(null); void handleRawSerial(serials.join(';')); }}
        onNoSerial={(msg) => { setFallbackHint(msg); setManualOpen(true); }}
      />
```

Joining with `;` deliberately re-enters through `parseScanPayload`, so the photo path and the camera path share one code path and one set of tests.

- [ ] **Step 7: Delete the superseded parser**

Run: `grep -rn "extractScannedSerial" --include=*.ts --include=*.tsx src pages`

Expected: only `lib/scannedSerial.ts` and its own test. `boxScan.ts` covers every case it did and `boxScan.test.ts` carries the equivalent assertions (bare serial, ISO envelope, S-prefix), so remove both:

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
git rm src/modules/field-stock-pwa/lib/scannedSerial.ts \
       src/modules/field-stock-pwa/lib/__tests__/scannedSerial.test.ts
```

If any other caller appears, leave both files and flag it for the reviewer instead.

- [ ] **Step 8: Run tests and commit**

Run: `npx vitest run pages/api/my/stores/serials/ src/modules/field-stock-pwa/`
Expected: PASS.

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npx tsc --noEmit
npm run lint
git add -A pages/api/my/stores/serials src/modules/field-stock-pwa
git commit -m "feat(field-stock): photo fallback returns every serial in a carton"
```

---

### Task 11: Full verification and PR

- [ ] **Step 1: Full local CI**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
npm run ci:quick
npx tsc --noEmit
npx vitest run src/modules/field-stock-pwa/ pages/api/my/stores/ pages/api/procurement/field-stock/
```

Expected: all green. Fix anything red here — never `--no-verify` past the pre-push hook.

- [ ] **Step 2: Manual walkthrough on a local build**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
cp /home/hein/Workspace/FF_Next.js/.env.local .   # next build needs it in a worktree
PORT=3004 npm run dev
```

With a stores-role session at `http://localhost:3004/my/stores/issue`, walk: warehouse → technician → FT-ONT → open scanner → scan the carton label (or use "Type serial instead" and paste the box payload from Global Constraints) → confirm nine chips appear as one group → add a tenth loose serial → confirm the counter reads 10 → expand the group → remove one member → sign and submit. Note what the process step returns.

- [ ] **Step 3: Device test**

On a real Android phone against a real carton, in warehouse lighting: does the live camera decode the dense box square, and how long does it take? Record the answer in the PR description. If it does not decode reliably, the photo fallback (Task 10) is the shipping path and the PR should say so plainly.

- [ ] **Step 4: Open the PR**

```bash
cd /home/hein/Workspace/FF_Next.js-ont-box-scan
git push -u origin feat/ont-box-scanning
gh pr create --title "feat(field-stock): ONT carton box scanning (Phase 1 — issue flow)" --body "$(cat <<'BODY'
One scan of a Nokia ONT carton label puts all nine serials into the stores issue
flow. A ten-ONT handout becomes box + one loose unit + signature.

Spec: docs/superpowers/specs/2026-08-20-ont-box-scanning-design.md
Plan: docs/superpowers/plans/2026-08-20-ont-box-scanning-phase1.md

- boxScan.ts classifies a decoded payload as box / package-data / single /
  unrecognised, with a decode regression test against a real carton photograph.
- serialVerdict.ts is now the single source of truth for issuable, shared by the
  single-serial scan path and the new batch endpoint.
- POST /my/stores/serials/validate-batch validates a whole carton in one
  round-trip. A partial box issues its good members and flags the rest.
- Serial-tracked availability trusts the serials; stock_quants disagreement is
  recorded to stock_quant_drift_log (migration 506) instead of refusing the
  issue — this is the 2026-07 failure mode.
- Soft warning above ten units; never blocks.

Device test result: <fill in from Step 3>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01A4W2yWDSYFHUqPcTJWsYLp
BODY
)"
```

- [ ] **Step 5: Blind review**

Invoke `/review` on the PR diff. Do not self-review. Report the findings verbatim, fix what is real, push, and only merge once both the blind review approves and CI on the self-hosted runner passes.

---

## Notes for the reviewer

- `stock_quants` is not a live ledger — it is a single Odoo opening-balance load from 26 May 2026 with zero consumption postings, roughly 7x overstated against the 31 May physical count. Task 9 is written in full knowledge of that; trusting it over scanned serials would reproduce the bug this work exists to fix.
- Phase 2 (PWA receiving) is what actually repairs the drift by recording physical moves. Until it lands, `stock_quant_drift_log` is how we measure the problem.
- Gizzu UPS units are deliberately untouched: their cartons carry no serial list, so they stay one scan per unit.
