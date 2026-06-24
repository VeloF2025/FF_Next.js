# note2/note4 drop-off → auto-clear OLT investigate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On each weekly notes import, auto-clear OLT Investigate records (and close their linked NOC tickets) for DRs that were previously flagged note2/note4 but have now dropped off FiberTime's notes — with an audit trail in the ticket note, the DR history, and the record itself.

**Architecture:** A new server-only billing service `processOltDropoffClosures` computes the drop-off set (prior note2/note4 DRs − this week's note2/note4 DRs), intersects it with currently-open `olt_mismatch_records`, and for each match either closes the linked ticket via the existing `applyTicketResolvedSideEffects` cascade (which already removes the record from the view) or resolves the unticketed record directly. It is wired into `upload-weekly-bundle.ts` as a best-effort step on import and as a read-only dry-run on preview.

**Tech Stack:** TypeScript, Next.js Pages API, `pg` via `@/lib/db`, vitest.

## Global Constraints

- Files <300 lines; components <200 lines. No `console.log` — use `@/lib/logger`. 100% type coverage (no `any` leaks).
- **Best-effort:** the new step must NEVER fail or roll back the billing import (mirror the existing reconcile/verdict/recovery steps' try/catch).
- **No migration required:** `olt_mismatch_records.resolution_type` is free-text (no CHECK constraint) — verified on the live DB 2026-06-24. New value `'ft_note_dropoff'` just works.
- `olt_mismatch_records.resolved_by` is a **`uuid`** column. Use the system user UUID `81abd560-48ae-414e-ad31-9d82f1a9ed49` (env override `WA_BRIDGE_SYSTEM_USER_ID`), never the string `'system'`.
- `fix_status='resolved'` is a valid CHECK value.
- Reuse existing DR-history event types (`non_invoiceable_resolved`, `ticket_auto_closed`) — do not add new ones.
- Safety invariant: only act when the project's notes XLSX was actually in this upload (`notesPresent`). PDF-only uploads are a no-op.
- Idempotent: only touch *open* records / *non-terminal* tickets.
- Run `npm run ci:quick` before the PR. Never `git add -A` in the worktree (the `node_modules` symlink is tracked — add by explicit path).
- Worktree: `/home/hein/Workspace/FF_Next.js-billing-note-dropoff` (branch `ffnext/billing-note-dropoff-olt-autoclose`). All git writes via `git -C <worktree> …` or `cd <worktree> && git …`.

---

## File Structure

- **Create** `src/modules/billing/services/processOltDropoffClosures.ts` — the new service: pure `computeDropOffClosures` core + DB orchestrator. (<200 lines.)
- **Create** `src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts` — vitest unit + mocked-DB tests.
- **Modify** `pages/api/billing/upload-weekly-bundle.ts` — call the service on import (best-effort) and on preview (dry-run); extend `ProjectResponsePreview`.
- **Modify** `src/modules/billing/components/BillingUploadTab.tsx` — add `autoClose` to the preview type and render the count on each project card.

---

## Reference signatures (verified in code — do not re-derive)

```ts
// src/modules/noc/services/ticketService.ts:611
export async function updateTicket(id: string, payload: UpdateTicketPayload): Promise<Ticket>

// src/modules/noc/services/ticketResolutionService.ts:55
export async function applyTicketResolvedSideEffects(
  ticket: Ticket,
  options?: { actingUser?: { id?: string; name?: string; email?: string };
              note?: string; noteVisibility?: 'public' | 'private'; isTransition?: boolean },
): Promise<void>
// ^ already inserts the ticket system note AND calls markLinkedDataSyncResolved(ticket.id),
//   which sets the linked olt_mismatch_records row to fix_status='resolved',
//   resolution_type='ticket_closed' (removing it from Investigate).

// src/modules/activate/services/activity-log/eventLoggers.ts:254
export async function logNonInvoiceableResolved(
  drNumber: string,
  payload: { weekEnding: string; noteCode: NoteCode; resolutionReason: string; disputeOutcome?: string | null },
  actor: string,
): Promise<string>
// :343
export async function logTicketAutoClosed(
  drNumber: string,
  payload: { ticketId: string; ticketUid: string; triggeringEvent: string; ruleName: string },
  actor?: string,
): Promise<string>
// :230  export type NoteCode = 'note1' | 'note2' | 'note3' | 'note4' | 'note5';

// src/modules/noc/constants/ticketStatus.ts  (isTerminalStatus → true for resolved/cancelled)
export function isTerminalStatus(status: TicketStatus): boolean
// src/modules/noc/types/ticket.ts            TicketStatus.RESOLVED = 'resolved'

// Investigate "open" predicate (pages/api/system/olt-report/records.ts:47), verbatim:
//   (r.fix_status IN ('not_found','needs_investigation','needs_reinvestigation',
//    'empty_serial','rejected','serial_other_dr') OR r.olt_serial IS NULL)

// ParsedDeduction fields used: d.drNumber, d.note  (note ∈ 'note1'..'note5')
```

---

## Task 1: Pure drop-off core + types

**Files:**
- Create: `src/modules/billing/services/processOltDropoffClosures.ts`
- Test: `src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts`

**Interfaces:**
- Produces: `interface OpenMismatchRecord { id: string; dropNumber: string; maintenanceTicketId: string | null; ticketUid: string | null; ticketStatus: string | null }` and `computeDropOffClosures(priorFlaggedDrs: Set<string>, currentFlaggedDrs: Set<string>, openRecords: OpenMismatchRecord[]): OpenMismatchRecord[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts
import { describe, it, expect } from 'vitest';
import { computeDropOffClosures, type OpenMismatchRecord } from '../processOltDropoffClosures';

const rec = (dropNumber: string, ticket?: Partial<OpenMismatchRecord>): OpenMismatchRecord => ({
  id: `id-${dropNumber}`,
  dropNumber,
  maintenanceTicketId: ticket?.maintenanceTicketId ?? null,
  ticketUid: ticket?.ticketUid ?? null,
  ticketStatus: ticket?.ticketStatus ?? null,
});

describe('computeDropOffClosures', () => {
  it('returns records whose DR was flagged before but is absent this week', () => {
    const prior = new Set(['DR1', 'DR2', 'DR3']);
    const current = new Set(['DR2']); // DR2 still flagged
    const open = [rec('DR1'), rec('DR2'), rec('DR3')];
    const out = computeDropOffClosures(prior, current, open);
    expect(out.map((r) => r.dropNumber).sort()).toEqual(['DR1', 'DR3']);
  });

  it('ignores open records never flagged note2/note4 (not FT-driven)', () => {
    const prior = new Set(['DR1']);
    const current = new Set<string>();
    const open = [rec('DR1'), rec('DR_AUTODETECT_ONLY')];
    expect(computeDropOffClosures(prior, current, open).map((r) => r.dropNumber)).toEqual(['DR1']);
  });

  it('a clean week (empty current) drops off every prior-flagged open record', () => {
    const prior = new Set(['DR1', 'DR2']);
    const out = computeDropOffClosures(prior, new Set(), [rec('DR1'), rec('DR2')]);
    expect(out).toHaveLength(2);
  });

  it('no prior flags → nothing dropped off', () => {
    expect(computeDropOffClosures(new Set(), new Set(['DR1']), [rec('DR1')])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx vitest run src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts`
Expected: FAIL — `computeDropOffClosures` is not exported / module not found.

- [ ] **Step 3: Write the minimal implementation (types + pure core)**

```ts
// src/modules/billing/services/processOltDropoffClosures.ts
/**
 * Auto-clear OLT Investigate records when a previously note2/note4-flagged DR
 * drops off FiberTime's weekly notes.
 *
 * Called best-effort from the weekly billing bundle import (and as a read-only
 * dry-run on preview). For one project + week it:
 *   1. finds DRs flagged note2/note4 in PRIOR weeks (priorFlagged),
 *   2. subtracts this week's note2/note4 DRs (currentFlagged) → droppedOff,
 *   3. intersects droppedOff with currently-OPEN olt_mismatch_records,
 *   4. closes the linked NOC ticket (cascade removes the record) or resolves
 *      the unticketed record directly, and writes the DR-history audit.
 *
 * Trust model: FT dropping the note is treated as authoritative (decided
 * 2026-06-24). Self-healing: a later re-deduction is re-detected by the OLT
 * report import and flagged not_returned by processExpectedRecoveries.
 */

export interface OpenMismatchRecord {
  id: string;
  dropNumber: string;
  maintenanceTicketId: string | null;
  ticketUid: string | null;
  ticketStatus: string | null;
}

/**
 * Pure drop-off filter: open records whose DR was flagged note2/note4 before
 * (`priorFlaggedDrs`) and is NOT flagged note2/note4 this week
 * (`currentFlaggedDrs`). The prior gate ensures we never touch records that are
 * open purely from auto-detection (never FT-flagged).
 */
export function computeDropOffClosures(
  priorFlaggedDrs: Set<string>,
  currentFlaggedDrs: Set<string>,
  openRecords: OpenMismatchRecord[],
): OpenMismatchRecord[] {
  return openRecords.filter(
    (r) => priorFlaggedDrs.has(r.dropNumber) && !currentFlaggedDrs.has(r.dropNumber),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx vitest run src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff add \
  src/modules/billing/services/processOltDropoffClosures.ts \
  src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff commit -m "feat(billing): pure drop-off core for OLT note2/note4 auto-clear"
```

---

## Task 2: DB orchestrator (`processOltDropoffClosures`)

**Files:**
- Modify: `src/modules/billing/services/processOltDropoffClosures.ts`
- Test: `src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts`

**Interfaces:**
- Consumes (from Task 1): `computeDropOffClosures`, `OpenMismatchRecord`.
- Consumes (existing): `updateTicket`, `applyTicketResolvedSideEffects`, `isTerminalStatus`, `TicketStatus`, `logNonInvoiceableResolved`, `logTicketAutoClosed`, `NoteCode`, `pool`.
- Produces: `processOltDropoffClosures(input: OltDropoffInput): Promise<OltDropoffOutcome>` where
  `interface OltDropoffInput { project: string; weekEnding: string; currentNote2or4Drs: Set<string>; notesPresent: boolean; dryRun: boolean }`
  and `interface OltDropoffOutcome { evaluated: boolean; candidates: { dropNumber: string; ticketUid: string | null }[]; closedTickets: number; resolvedRecords: number }`.

**Query call order (fixed, so the mocked test can sequence responses):**
1. `pool.query` — prior note2/note4 rows for the project.
2. `pool.query` — open mismatch records for the droppedOff DRs (skipped if droppedOff empty).
3+. (import only) per-record: direct `UPDATE` (unticketed) — ticketed path uses `updateTicket`/cascade, not `pool` directly.

- [ ] **Step 1: Add the failing orchestrator tests**

Append to `src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts`:

```ts
import { vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('@/lib/db', () => ({ default: { query: (...a: unknown[]) => query(...a) } }));

const updateTicket = vi.fn();
vi.mock('@/modules/noc/services/ticketService', () => ({ updateTicket: (...a: unknown[]) => updateTicket(...a) }));

const applyTicketResolvedSideEffects = vi.fn();
vi.mock('@/modules/noc/services/ticketResolutionService', () => ({
  applyTicketResolvedSideEffects: (...a: unknown[]) => applyTicketResolvedSideEffects(...a),
}));

const logNonInvoiceableResolved = vi.fn();
const logTicketAutoClosed = vi.fn();
vi.mock('@/modules/activate/services/activity-log/eventLoggers', () => ({
  logNonInvoiceableResolved: (...a: unknown[]) => logNonInvoiceableResolved(...a),
  logTicketAutoClosed: (...a: unknown[]) => logTicketAutoClosed(...a),
}));

// Import AFTER mocks are registered.
const { processOltDropoffClosures } = await import('../processOltDropoffClosures');

beforeEach(() => {
  query.mockReset();
  updateTicket.mockReset();
  applyTicketResolvedSideEffects.mockReset();
  logNonInvoiceableResolved.mockReset();
  logTicketAutoClosed.mockReset();
});

describe('processOltDropoffClosures — guards', () => {
  it('is a no-op when notesPresent is false', async () => {
    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: false, dryRun: false,
    });
    expect(out.evaluated).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('processOltDropoffClosures — dryRun', () => {
  it('returns candidates and mutates nothing', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ dr_number: 'DR1', deduction_note: 'note4' }] }) // prior
      .mockResolvedValueOnce({ rows: [{ id: 'rec1', drop_number: 'DR1', maintenance_ticket_id: null, ticket_uid: null, ticket_status: null }] }); // open
    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: true, dryRun: true,
    });
    expect(out.candidates.map((c) => c.dropNumber)).toEqual(['DR1']);
    expect(updateTicket).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2); // prior + open only, no UPDATE
  });
});

describe('processOltDropoffClosures — import', () => {
  it('closes the ticket via cascade for a ticketed record', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ dr_number: 'DR1', deduction_note: 'note4' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rec1', drop_number: 'DR1', maintenance_ticket_id: 'tk1', ticket_uid: 'NOC-1', ticket_status: 'open' }] })
      .mockResolvedValue({ rows: [], rowCount: 1 }); // any follow-up UPDATE
    updateTicket.mockResolvedValue({ id: 'tk1', ticket_uid: 'NOC-1', status: 'resolved', dr_number: 'DR1' });

    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: true, dryRun: false,
    });

    expect(updateTicket).toHaveBeenCalledWith('tk1', expect.objectContaining({ status: 'resolved' }));
    expect(applyTicketResolvedSideEffects).toHaveBeenCalledTimes(1);
    expect(logTicketAutoClosed).toHaveBeenCalledTimes(1);
    expect(logNonInvoiceableResolved).toHaveBeenCalledWith('DR1', expect.objectContaining({ noteCode: 'note4' }), expect.any(String));
    expect(out.closedTickets).toBe(1);
  });

  it('resolves an unticketed record directly', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ dr_number: 'DR9', deduction_note: 'note2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'rec9', drop_number: 'DR9', maintenance_ticket_id: null, ticket_uid: null, ticket_status: null }] })
      .mockResolvedValue({ rows: [], rowCount: 1 }); // the direct UPDATE
    const out = await processOltDropoffClosures({
      project: 'Lawley', weekEnding: '2026-06-21',
      currentNote2or4Drs: new Set(), notesPresent: true, dryRun: false,
    });
    expect(updateTicket).not.toHaveBeenCalled();
    expect(out.resolvedRecords).toBe(1);
    // Third query is the resolving UPDATE on olt_mismatch_records.
    const updateCall = query.mock.calls[2]?.[0] as string;
    expect(updateCall).toMatch(/UPDATE olt_mismatch_records/i);
    expect(updateCall).toMatch(/fix_status\s*=\s*'resolved'/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx vitest run src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts`
Expected: FAIL — `processOltDropoffClosures` not exported.

- [ ] **Step 3: Implement the orchestrator**

Append to `src/modules/billing/services/processOltDropoffClosures.ts`:

```ts
import { createLogger } from '@/lib/logger';
import pool from '@/lib/db';
import { updateTicket } from '@/modules/noc/services/ticketService';
import { applyTicketResolvedSideEffects } from '@/modules/noc/services/ticketResolutionService';
import { isTerminalStatus } from '@/modules/noc/constants/ticketStatus';
import { TicketStatus } from '@/modules/noc/types/ticket';
import {
  logNonInvoiceableResolved,
  logTicketAutoClosed,
  type NoteCode,
} from '@/modules/activate/services/activity-log/eventLoggers';

const logger = createLogger('billing:oltDropoffClosure');

const SYSTEM_USER_ID =
  process.env.WA_BRIDGE_SYSTEM_USER_ID ?? '81abd560-48ae-414e-ad31-9d82f1a9ed49';
const SYSTEM_ACTOR = { id: SYSTEM_USER_ID, name: 'FibreFlow System', email: 'system@fibreflow.app' };
const DR_HISTORY_ACTOR = 'billing-import';
const RESOLUTION_TYPE = 'ft_note_dropoff';

// Verbatim from pages/api/system/olt-report/records.ts:47 — the Investigate "open" set.
const OPEN_STATUS_PREDICATE =
  `(r.fix_status IN ('not_found','needs_investigation','needs_reinvestigation',` +
  `'empty_serial','rejected','serial_other_dr') OR r.olt_serial IS NULL)`;

export interface OltDropoffInput {
  project: string;
  weekEnding: string; // 'YYYY-MM-DD'
  currentNote2or4Drs: Set<string>;
  notesPresent: boolean;
  dryRun: boolean;
}

export interface OltDropoffOutcome {
  evaluated: boolean;
  candidates: { dropNumber: string; ticketUid: string | null }[];
  closedTickets: number;
  resolvedRecords: number;
}

function auditMessage(project: string, weekEnding: string): string {
  return (
    `Auto-cleared: FibreFlow weekly notes for ${project} WE${weekEnding} no longer list ` +
    `this DR under note2/note4 — FiberTime considers the issue resolved. ` +
    `Cleared automatically on notes import.`
  );
}

export async function processOltDropoffClosures(
  input: OltDropoffInput,
): Promise<OltDropoffOutcome> {
  const { project, weekEnding, currentNote2or4Drs, notesPresent, dryRun } = input;
  const empty: OltDropoffOutcome = { evaluated: false, candidates: [], closedTickets: 0, resolvedRecords: 0 };

  // Safety invariant: no authority to declare drop-offs without a notes XLSX.
  if (!notesPresent) return empty;

  // 1. DRs flagged note2/note4 in PRIOR weeks for this project (+ which notes).
  const priorRes = await pool.query<{ dr_number: string; deduction_note: NoteCode }>(
    `SELECT DISTINCT dr_number, deduction_note
       FROM ft_billing_deductions
      WHERE project = $1
        AND deduction_note IN ('note2','note4')
        AND week_ending < $2::date`,
    [project, weekEnding],
  );
  const priorDrs = new Set<string>();
  const priorNotesByDr = new Map<string, NoteCode[]>();
  for (const row of priorRes.rows) {
    priorDrs.add(row.dr_number);
    const notes = priorNotesByDr.get(row.dr_number) ?? [];
    if (!notes.includes(row.deduction_note)) notes.push(row.deduction_note);
    priorNotesByDr.set(row.dr_number, notes);
  }

  const droppedOff = [...priorDrs].filter((dr) => !currentNote2or4Drs.has(dr));
  if (droppedOff.length === 0) return { ...empty, evaluated: true };

  // 2. Currently-OPEN mismatch records among the dropped-off DRs.
  const openRes = await pool.query<{
    id: string; drop_number: string; maintenance_ticket_id: string | null;
    ticket_uid: string | null; ticket_status: string | null;
  }>(
    `SELECT r.id, r.drop_number, r.maintenance_ticket_id,
            mt.ticket_uid, mt.status AS ticket_status
       FROM olt_mismatch_records r
       LEFT JOIN maintenance_tickets mt ON r.maintenance_ticket_id = mt.id
      WHERE r.drop_number = ANY($1::varchar[])
        AND ${OPEN_STATUS_PREDICATE}`,
    [droppedOff],
  );
  const openRecords = openRes.rows.map((row) => ({
    id: row.id,
    dropNumber: row.drop_number,
    maintenanceTicketId: row.maintenance_ticket_id,
    ticketUid: row.ticket_uid,
    ticketStatus: row.ticket_status,
  }));

  const targets = computeDropOffClosures(priorDrs, currentNote2or4Drs, openRecords);

  const outcome: OltDropoffOutcome = {
    evaluated: true,
    candidates: targets.map((t) => ({ dropNumber: t.dropNumber, ticketUid: t.ticketUid })),
    closedTickets: 0,
    resolvedRecords: 0,
  };
  if (dryRun) return outcome;

  const note = auditMessage(project, weekEnding);
  for (const t of targets) {
    try {
      const hasOpenTicket =
        t.maintenanceTicketId != null &&
        t.ticketStatus != null &&
        !isTerminalStatus(t.ticketStatus as TicketStatus);

      if (hasOpenTicket) {
        // Close the ticket → cascade writes the ticket note AND resolves the
        // linked record (markLinkedDataSyncResolved). Then stamp the record's
        // resolution_type/notes with the FT-specific reason (cascade sets a
        // generic 'ticket_closed').
        const updated = await updateTicket(t.maintenanceTicketId!, {
          status: TicketStatus.RESOLVED,
          resolved_at: new Date().toISOString(),
        });
        await applyTicketResolvedSideEffects(updated, {
          actingUser: SYSTEM_ACTOR,
          note,
          noteVisibility: 'public',
        });
        await pool.query(
          `UPDATE olt_mismatch_records
              SET resolution_type = $2, resolution_notes = $3
            WHERE id = $1`,
          [t.id, RESOLUTION_TYPE, note],
        );
        await logTicketAutoClosed(
          t.dropNumber,
          {
            ticketId: updated.id,
            ticketUid: updated.ticket_uid ?? t.ticketUid ?? '',
            triggeringEvent: 'ft_note_dropoff',
            ruleName: 'note2note4_dropoff_autoclose',
          },
          DR_HISTORY_ACTOR,
        );
        outcome.closedTickets += 1;
      } else {
        // Unticketed (or ticket already terminal) → resolve the record directly.
        await pool.query(
          `UPDATE olt_mismatch_records
              SET fix_status = 'resolved', resolution_type = $2,
                  resolution_notes = $3, resolved_by = $4::uuid, resolved_at = NOW()
            WHERE id = $1 AND fix_status NOT IN ('fixed','resolved')`,
          [t.id, RESOLUTION_TYPE, note, SYSTEM_USER_ID],
        );
        outcome.resolvedRecords += 1;
      }

      // DR history — one entry per prior note2/note4 the DR carried.
      for (const noteCode of priorNotesByDr.get(t.dropNumber) ?? []) {
        await logNonInvoiceableResolved(
          t.dropNumber,
          { weekEnding, noteCode, resolutionReason: 'ft_note_dropoff' },
          DR_HISTORY_ACTOR,
        );
      }
    } catch (err) {
      logger.warn('OLT drop-off close failed for one record (continuing)', {
        recordId: t.id, dropNumber: t.dropNumber,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return outcome;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx vitest run src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Type-check the new file (vitest does not run tsc)**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx tsc --noEmit -p tsconfig.json 2>&1 | grep processOltDropoffClosures || echo "no type errors in new file"`
Expected: `no type errors in new file`.

- [ ] **Step 6: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff add \
  src/modules/billing/services/processOltDropoffClosures.ts \
  src/modules/billing/services/__tests__/processOltDropoffClosures.test.ts
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff commit -m "feat(billing): OLT note2/note4 drop-off auto-clear orchestrator"
```

---

## Task 3: Wire into the import path (best-effort step 5)

**Files:**
- Modify: `pages/api/billing/upload-weekly-bundle.ts` (inside `importProjectResult`, after the expected-recovery block ~line 551, before the final `return { ...base, ... status:'imported' }`).

**Interfaces:**
- Consumes: `processOltDropoffClosures` (Task 2). `r.deductions` (ParsedDeduction[]), `notesFilename`, `canonicalName`, `summary.weekEnding` are all already in scope in `importProjectResult`.

- [ ] **Step 1: Add the import**

At the top of `pages/api/billing/upload-weekly-bundle.ts`, after the existing billing-service imports (near line 40):

```ts
import { processOltDropoffClosures } from '@/modules/billing/services/processOltDropoffClosures';
```

- [ ] **Step 2: Add the best-effort step**

Immediately after the `processExpectedRecoveries` try/catch block (the one ending ~line 551) and before `return { ...base, ... status: 'imported' ... }`:

```ts
    // ── Auto-clear OLT investigate records for note2/note4 drop-offs ─────────
    // When FT stops flagging a DR under note2/note4, clear it from the OLT
    // Investigate view + close its linked NOC ticket. Best-effort — a failure
    // here never fails the import (the row is already persisted).
    try {
      const currentNote2or4Drs = new Set(
        r.deductions
          .filter((d) => d.note === 'note2' || d.note === 'note4')
          .map((d) => d.drNumber),
      );
      const dropoff = await processOltDropoffClosures({
        project: canonicalName,
        weekEnding: summary.weekEnding,
        currentNote2or4Drs,
        notesPresent: notesFilename != null,
        dryRun: false,
      });
      logger.info('OLT note-dropoff auto-clear complete', {
        project: canonicalName,
        weekEnding: summary.weekEnding,
        closedTickets: dropoff.closedTickets,
        resolvedRecords: dropoff.resolvedRecords,
      });
    } catch (err) {
      logger.warn('OLT note-dropoff auto-clear failed (row still imported)', {
        project: canonicalName,
        weekEnding: summary.weekEnding,
        error: err instanceof Error ? err.message : String(err),
      });
    }
```

- [ ] **Step 3: Verify it compiles and existing bundle tests still pass**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx tsc --noEmit -p tsconfig.json 2>&1 | grep upload-weekly-bundle || echo "ok"`
Expected: `ok`.
Run: `npx vitest run src/modules/billing/services/__tests__/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff add pages/api/billing/upload-weekly-bundle.ts
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff commit -m "feat(billing): run OLT drop-off auto-clear on weekly notes import"
```

---

## Task 4: Wire into preview (dry-run) + extend response type

**Files:**
- Modify: `pages/api/billing/upload-weekly-bundle.ts` (the `ProjectResponsePreview` interface ~line 88; the `action === 'preview'` block ~line 180).

**Interfaces:**
- Produces: `ProjectResponsePreview.autoClose: { count: number; drs: string[] }` (consumed by Task 5).

- [ ] **Step 1: Extend the preview response interface**

In `ProjectResponsePreview` (after `fatalError: string | null;`):

```ts
  autoClose: { count: number; drs: string[] };
```

- [ ] **Step 2: Compute the dry-run in the preview block**

Replace the body of the `if (action === 'preview') { … }` block with:

```ts
    if (action === 'preview') {
      const previewRes: ProjectResponsePreview[] = [];
      for (const r of results) {
        const base = toPreviewResponse(r);
        let autoClose = { count: 0, drs: [] as string[] };
        if (r.resolution.matched && r.resolution.project && r.summary) {
          try {
            const currentNote2or4Drs = new Set(
              r.deductions
                .filter((d) => d.note === 'note2' || d.note === 'note4')
                .map((d) => d.drNumber),
            );
            const dry = await processOltDropoffClosures({
              project: r.resolution.project.name,
              weekEnding: r.summary.weekEnding,
              currentNote2or4Drs,
              notesPresent: r.files.some((f) => f.kind === 'notes-xlsx'),
              dryRun: true,
            });
            autoClose = { count: dry.candidates.length, drs: dry.candidates.map((c) => c.dropNumber) };
          } catch (err) {
            logger.warn('OLT drop-off dry-run failed (preview continues)', {
              project: r.resolution.project.name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        previewRes.push({ ...base, autoClose });
      }
      cleanupFiles(bundleFiles);
      return res.status(200).json({ success: true, action: 'preview', projects: previewRes });
    }
```

- [ ] **Step 3: Make the import response satisfy the type**

`toPreviewResponse` now omits `autoClose`. Add a default in `toPreviewResponse` so both paths type-check — change its return object to include:

```ts
    autoClose: { count: 0, drs: [] },
```

(Import path doesn't surface a preview count; it reports via logs. The field exists only to satisfy the shared type. Place it last in the returned object.)

- [ ] **Step 4: Verify compile + lint**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx tsc --noEmit -p tsconfig.json 2>&1 | grep upload-weekly-bundle || echo "ok"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff add pages/api/billing/upload-weekly-bundle.ts
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff commit -m "feat(billing): surface OLT drop-off dry-run count on bundle preview"
```

---

## Task 5: Render the auto-clear count on each project card

**Files:**
- Modify: `src/modules/billing/components/BillingUploadTab.tsx` (the `ProjectBundlePreview` interface ~line 69; `ProjectResultCard` ~line 438).

- [ ] **Step 1: Add `autoClose` to the client preview interface**

In `interface ProjectBundlePreview` (after `fatalError: string | null;`):

```ts
  autoClose?: { count: number; drs: string[] };
```

- [ ] **Step 2: Render it in `ProjectResultCard`**

Inside `ProjectResultCard`, after the `{/* Reconcile */}` block and before `{/* Fatal error */}`, add:

```tsx
      {/* OLT investigate auto-clear (note2/note4 drop-off) */}
      {row.autoClose && row.autoClose.count > 0 && (
        <details className="text-xs">
          <summary className="text-teal-300 cursor-pointer hover:text-teal-200 flex items-center gap-2">
            <CheckCircle className="w-3.5 h-3.5" />
            {row.autoClose.count} OLT investigate record{row.autoClose.count === 1 ? '' : 's'} will be
            auto-cleared on import
          </summary>
          <ul className="mt-1 space-y-0.5 pl-4">
            {row.autoClose.drs.map((dr) => (
              <li key={dr} className="font-mono text-[var(--ff-text-tertiary)]">{dr}</li>
            ))}
          </ul>
        </details>
      )}
```

(`CheckCircle` is already imported in this file.)

- [ ] **Step 3: Verify compile + lint**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npx tsc --noEmit -p tsconfig.json 2>&1 | grep BillingUploadTab || echo "ok"`
Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff add src/modules/billing/components/BillingUploadTab.tsx
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff commit -m "feat(billing): show OLT auto-clear count on weekly bundle preview cards"
```

---

## Task 6: Full verification + browser check

**Files:** none (verification only).

- [ ] **Step 1: Run the local CI gates**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npm run ci:quick`
Expected: all gates pass (lint ratchet, no-silent-catch, secret-scan). Fix any regression — never `--no-verify`.

- [ ] **Step 2: antihall — referenced symbols exist**

Run: `cd /home/hein/Workspace/FF_Next.js-billing-note-dropoff && npm run antihall`
Expected: no missing-symbol errors for the new service / imports.

- [ ] **Step 3: Browser verification (UI change requires it — CLAUDE.md rule 4)**

Using a notes bundle where at least one DR previously flagged note2/note4 is absent this week:
1. Open `dev.fibreflow.app/activate/data-sync?group=billing&tab=upload`, drop the folder, **Preview**.
2. Confirm a project card shows "N OLT investigate record(s) will be auto-cleared on import" with the expected DR list.
3. Note the OLT Investigate count for that project at `?group=olt&tab=investigate`.
4. **Import**, then re-open the Investigate tab — confirm the dropped-off DRs are gone (count reduced by N).
5. Open one cleared DR's NOC ticket → confirm the system resolution note; open the DR timeline → confirm the `non_invoiceable_resolved` (+ `ticket_auto_closed`) events.

- [ ] **Step 4: Push branch + open PR**

```bash
git -C /home/hein/Workspace/FF_Next.js-billing-note-dropoff push -u origin ffnext/billing-note-dropoff-olt-autoclose
gh pr create --repo VelocityFibre/FF_Next.js --base master \
  --head ffnext/billing-note-dropoff-olt-autoclose \
  --title "feat(billing): auto-clear OLT investigate on note2/note4 drop-off" \
  --body "Implements docs/superpowers/specs/2026-06-24-billing-note-dropoff-olt-autoclose-design.md"
```

---

## Self-review (completed against the spec)

- **Spec coverage:** core population → Task 1/2; trust-FT auto-close → Task 2; ticketed+unticketed scope → Task 2 (cascade vs direct UPDATE); immediate timing → no grace logic added; three audit surfaces → Task 2 (ticket note via cascade, DR history via loggers, record resolution_notes); notes-present guard → Task 2 + Tasks 3/4 inputs; preview dry-run → Task 4; UI count → Task 5; testing → Tasks 1/2/6.
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `computeDropOffClosures`/`OpenMismatchRecord`/`processOltDropoffClosures`/`OltDropoffInput`/`OltDropoffOutcome`/`autoClose` names are identical across all tasks.
- **No-migration** confirmed (free-text `resolution_type`); `resolved_by` uuid handled with `SYSTEM_USER_ID`.
