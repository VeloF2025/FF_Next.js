# Billing note2/note4 drop-off → auto-clear OLT investigate records

**Date:** 2026-06-24
**Status:** Approved design — pending implementation plan
**Author:** Hein (via Claude)

## Problem

The OLT reports **Investigate** view (`/activate/data-sync?group=olt&tab=investigate`) lists
DRs whose OES/OLT serial cannot be reconciled against 1Map. FiberTime's weekly billing
**notes** flag the same kind of problem as deductions:

- **note2** — "No entry/submission on Field App" (missing DR)
- **note4** — "Inaccurate: Drop# & ONT SN does not match" (serial mismatch on the OLT)

When FiberTime stops listing a DR under note2/note4 in a later week, FT considers that issue
resolved. Today nothing connects that signal to the OLT Investigate view, so:

- The DR stays in the Investigate view indefinitely.
- Any linked NOC ticket stays open.
- Operators chase issues FiberTime has already cleared.

**Goal:** when a previously-flagged DR drops off the note2/note4 list, automatically clear it
from the Investigate view, close its linked NOC ticket, and leave an audit trail in three places.

## Decisions (locked with Hein, 2026-06-24)

1. **Trust model — trust FT, auto-close.** When FT drops a note2/note4 for a DR still open in
   Investigate, treat FT's signal as authoritative even when our side never independently
   confirmed a fix. (Mitigated by the self-healing guard below.)
2. **Scope — ticketed *and* unticketed.** Ticketed records close via the ticket cascade;
   unticketed open records are resolved directly. The whole view is cleaned, not just ticketed rows.
3. **Timing — immediate.** Act the first week a DR is absent from its project's freshly-uploaded
   notes. No grace period.
4. **Safety invariant (non-negotiable).** Only act on projects whose notes XLSX was actually in
   this upload. A missing notes file is never interpreted as "everything dropped off."

## What already exists (this is mostly a wiring job)

- **Drop-off detection precedent:** `processExpectedRecoveries.ts` already runs on every notes
  import (`upload-weekly-bundle.ts:536`) and compares this week vs prior weeks per project. We do
  **not** reuse its `recovered` set — that set requires our own fix signal (temporal guard), which
  by definition excludes records still open in Investigate. We compute a separate, broader set
  (see below).
- **Ticket close already cascades to the view:** `applyTicketResolvedSideEffects()`
  (`src/modules/noc/services/ticketResolutionService.ts`) already (a) inserts a `maintenance_notes`
  system note, (b) logs a `maintenance_activities` row, and (c) calls `markLinkedDataSyncResolved()`
  which flips the linked `olt_mismatch_records` row to `resolved` → removing it from Investigate.
- **DR history loggers exist:** `logNonInvoiceableResolved()` and `logTicketAutoClosed()` in
  `src/modules/activate/services/activity-log/eventLoggers.ts`.

## Core definition (the precise population)

On each notes **import**, per project that was in the upload, the target set is:

> open `olt_mismatch_records` for that project, whose `drop_number`
> **was previously flagged note2/note4** (a `ft_billing_deductions` row for this project in a week
> earlier than the one just imported) **and** is **absent from this week's note2/note4** rows.

Set math per project (join key is always `drop_number`):

```
priorFlagged   = DISTINCT dr_number FROM ft_billing_deductions
                 WHERE project = $project
                   AND deduction_note IN ('note2','note4')
                   AND week_ending < $thisWeekEnding
currentFlagged = DISTINCT dr_number FROM ft_billing_deductions
                 WHERE billing_week_id = $thisBillingWeekId
                   AND deduction_note IN ('note2','note4')
droppedOff     = priorFlagged − currentFlagged
targets        = open olt_mismatch_records for $project WHERE drop_number ∈ droppedOff
```

"Open" = `fix_status IN ('not_found','needs_investigation','needs_reinvestigation',
'empty_serial','rejected','serial_other_dr')` OR `olt_serial IS NULL` (the same predicate the
Investigate API uses).

Notes:
- The join key is `drop_number`, so note2 and note4 are handled uniformly regardless of how each
  maps to a `fix_status`.
- We key on note2/note4 presence specifically, not overall presence — if note4 drops but the DR
  still carries note1 this week, the serial mismatch is still considered resolved.
- Forward-looking only: DRs flagged before the billing system existed have no
  `ft_billing_deductions` history and are never eligible. (Consistent with prior backfill policy.)

## Action per matched record

For each target `olt_mismatch_record`:

- **If linked to an open ticket** (`maintenance_ticket_id` → a non-terminal `maintenance_tickets`
  row): close it via `updateTicket(id, { status: RESOLVED, resolved_at })` +
  `applyTicketResolvedSideEffects(ticket, { actingUser: system, note, noteVisibility: 'public' })`.
  The cascade writes the ticket note and resolves the linked record (removes from view).
- **Else (unticketed):** directly `UPDATE olt_mismatch_records SET fix_status='resolved',
  resolution_type='closed_ft_recovered', resolution_notes=$note, resolved_by='system',
  resolved_at=NOW()`.
- **Both cases:** append DR history via `logNonInvoiceableResolved(...)`, plus
  `logTicketAutoClosed(...)` when a ticket was closed. Actor = `system`.

**Ticket closure is scoped only to tickets linked to these records** (via `maintenance_ticket_id`).
We deliberately do **not** use `findOpenTicketsByDR`, so an unrelated ticket on the same DR is never
collaterally closed.

### The three audit surfaces

| # | Surface | Mechanism |
|---|---------|-----------|
| ① | NOC notes / ticket comment (same thing — `maintenance_notes`) | `applyTicketResolvedSideEffects` system note |
| ② | DR history (`dr_activity_log`) | `logNonInvoiceableResolved` + `logTicketAutoClosed` |
| ③ | Record removal audit (`olt_mismatch_records.resolution_notes`) | cascade (ticketed) or direct UPDATE (unticketed) |

Audit message (consistent wording across surfaces), e.g.:

> Auto-cleared: FibreFlow weekly notes for {project} WE{week} no longer list this DR under
> note2/note4 — FiberTime considers the issue resolved. Cleared automatically on notes import
> {date}.

> **Note:** "NOC notes" and "ticket comments" are the same `maintenance_notes` row in this codebase
> — there is no separate NOC-notes field. Surfaces ① and ③ are therefore the two distinct *places*,
> plus DR history ②.

## Safety guards & idempotency

- **No notes XLSX in the bundle → no-op.** A PDF-only upload has no authority to declare drop-offs.
  Guard on `notesFilename != null` and no fatal parse error for that project.
- **Only uploaded projects evaluated** — automatic, since we iterate per imported `billing_week_id`.
- **A legitimately clean week (notes file present, zero note2/note4) closes all prior-flagged DRs**
  — this is correct behaviour (FT cleared them). The XLSX-present guard is what protects against the
  failure mode (forgotten file / parser regression). Every closure is logged and counted; a large
  closure count in one project/week is surfaced in the import summary for eyeballing.
- **Idempotent:** only touches *open* records / *open* tickets. Re-importing the same week is a no-op.
- **Self-healing:** if FT re-deducts later, the next OLT report import re-detects the mismatch and
  resurfaces the record; the existing `not_returned` recovery logic flags the re-bill as a dispute
  candidate.

## Preview surfacing (dry-run)

The existing **Preview** step (before Import) runs the same computation read-only and returns, per
project, the list of records that *would* be auto-cleared. `BillingUploadTab.tsx` renders a count on
each project card ("N investigate records will be auto-cleared on import"). No mutation on preview.

## Code shape

- **New service** `src/modules/billing/services/processOltDropoffClosures.ts`
  (mirrors `processExpectedRecoveries.ts`, target <300 lines). Exposes:
  - a **pure** `computeDropOffs(prior: Set, current: Set, openRecords: Rec[]): Rec[]` core that is
    unit-testable with no DB; and
  - an orchestrator `processOltDropoffClosures(client, billingWeekId, { dryRun }): DropOffResult`
    that loads sets, computes targets, and (unless `dryRun`) performs closures + audit.
- **Wiring:** call it from `upload-weekly-bundle.ts`:
  - in `importProjectResult` as a best-effort step #5 (failure never fails the import — same pattern
    as reconcile / verdicts / recovery), guarded by the notes-XLSX present check;
  - in the **preview** path with `dryRun: true`, threading the result into the per-project preview
    response.
- **UI:** `BillingUploadTab.tsx` + the bundle response types gain an `autoCloseCount` /
  `autoCloseDrs` field rendered on the card.
- Cross-module imports (billing → noc services, billing → activate activity-log) follow the existing
  pattern (`upload-weekly-bundle.ts` already imports from `activate` eventLoggers).

## Implementation flags to confirm during planning

- **`resolution_type='closed_ft_recovered'`** — verify against the live `olt_mismatch_records`
  schema whether `resolution_type` has a CHECK constraint. If so, add a migration extending it
  (`sql/` with a `rollback_` counterpart, version = MAX+1, per project migration policy). If the
  column is free-text, no migration needed.
- **DR-history event types** — prefer reusing the existing `non_invoiceable_resolved` and
  `ticket_auto_closed` event types rather than adding new ones.
- **System actor** — reuse the established `system@fibreflow.app` `SYSTEM_USER_ID` pattern for
  `applyTicketResolvedSideEffects` `actingUser`.

## Testing

- **Unit (pure):** `computeDropOffs` — prior−current set math, open/closed filtering, empty-current
  (clean week) closes all prior, no-prior is a no-op.
- **Service-level (mocked DB):** ticketed record → ticket-close path invoked; unticketed → direct
  UPDATE; both → DR-history loggers called; `dryRun` performs no mutation.
- **Guard tests:** no notes XLSX → no-op; project not in upload → never evaluated; re-run same week →
  idempotent no-op.
- Follow project vitest conventions (new lib alias if needed; remember vitest does not run `tsc`, so
  also pass `npm run ci:quick`).

## Out of scope

- Auto-**reopening** tickets when FT re-deducts (handled by existing OLT re-detection + `not_returned`).
- note1/note3/note5 (note3 is monitor-only; note1/note5 have no Investigate-view linkage).
- Backfilling historical drop-offs from before this feature ships (forward-looking only).
