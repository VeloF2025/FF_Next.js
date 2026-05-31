# Group C — PP/OES Overlap Sync (issue #1861)

**Source:** [`2026-05-30-data-integrity-audit.md`](./2026-05-30-data-integrity-audit.md) Dataset 4 + D1-5 · **Drafted:** 2026-05-31
**Companion:** [`2026-05-30-data-integrity-remediation-plan.md`](./2026-05-30-data-integrity-remediation-plan.md) Group C

Counts re-measured live 2026-05-31. Dev + prod share one DB.

## Root cause (confirmed in code)
`oesPostImportService.triggerPpActivationCheck` promoted PP rows to `activated` **only by serial match** (`pp.serial_number = oa.serial_number`) and never wrote `activated_at` or `drops.oes_confirmed`. So:
- **D4-4** (`activated_at` NULL): the promotion never set it.
- **D4-5** (`drops.oes_confirmed=false`): the flag was never back-propagated.
- **D4-1** (`located_*` not advanced): a located row whose serial differs from OES never matched the serial-keyed UPDATE.

## Forward fix (code — `triggerPpActivationCheck`)
- **Path A** (serial-keyed) now also sets `activated_at = COALESCE(pp.activated_at, oa.activation_datetime)`.
- **Path B** (new, drop-keyed): promotes `located_*` rows whose `resolved_drop_number` is in `oes_activations`, **skipping serial conflicts** (per the #1861 decision — never stamp `activated` over a PP-vs-OES serial disagreement).
- Both paths feed one downstream cascade (serial lifecycle, timeline, ticket auto-resolve) and back-propagate `drops.oes_confirmed` for the drops just activated.

## One-time backfill — `scripts/backfill-ppoes-overlap-sync-1861.ts` (dry-run / `--commit`)
Mutations run in one transaction (dry-run rolls back, so dry-run counts are exact). Dry-run 2026-05-31:

| Step | What | Count |
|------|------|-------|
| D4-4 | fill `activated_at` from OES on activated/oes-sourced rows | **64** |
| D4-5 | back-propagate `drops.oes_confirmed=true` | **53** |
| D4-1 | promote `located_*`→`activated` (no serial conflict) | **3** |

### ⚠️ D4-1 is mostly a serial disagreement, not a sync gap
Of the **248** `located_*` rows whose drop is in `oes_activations`, only **3** have a blank OES serial (cleanly promotable). The other **245 carry a PP serial that conflicts with the OES serial** for that drop — a genuine PP-vs-OES disagreement, the same class as D1-5/D4-2. They are **NOT auto-promoted**; promoting them would stamp `activated` over a serial conflict. The audit's "overlap understated by 245" is really 245 serial-conflict rows awaiting a source-of-truth decision, not 245 missed activations.

## Flagged — NOT fixed (business decision, activations owner)
Surfaced by the backfill's read-only flag report; never auto-changed:
- **D4-1 conflict subset:** 245 `located_*` rows with a PP-vs-OES serial conflict.
- **D1-5:** 172 `activated` rows with a PP-vs-OES drop_number conflict for the same serial.
- **D4-3:** 57 `activated` rows whose drop is absent from `oes_activations` (non-OES-sourced activation claims — backed by 1Map/photo evidence, not OES).

These need a "which source wins (OES vs PP-resolved)" call. Recommend the activations owner review the serial/drop disagreements; do not auto-resolve.

## Verify after commit
D4-4 / D4-5 audit queries → 0; D4-1 clean subset → 0 (245 conflict + 172 + 57 remain by design).
