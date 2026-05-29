# Sprint E — Bugsink alert rule (serial lifecycle violations)

**Status:** config doc. Hein configures the rule in the Bugsink UI **before the
cutover window** (operational step — not automated by deploy).

## Why a dedicated rule

Migration 387 installs two BEFORE-row triggers on `stock_serials` that abort the
transaction with **custom SQLSTATEs** rather than the generic `23514`
`check_violation`. Verified in `scripts/migrations/sql/387_serial_lifecycle_state_machine.sql`:

| SQLSTATE | Raised by | Meaning |
|----------|-----------|---------|
| `FF001`  | `trg_stock_serial_status_validate()` — `RAISE EXCEPTION ... USING ERRCODE = 'FF001'` | `lifecycle_violation`: a `status` change that isn't in the transition matrix (a direct write that bypassed `promoteSerial`, or set `ff.bypass_validation=true`). |
| `FF002`  | `trg_stock_serial_holder_validate()` — `RAISE EXCEPTION ... USING ERRCODE = 'FF002'` | `holder_mismatch`: a `(status, holder_type)` pair not allowed by `stock_serial_status_holder_pairs`. |

Filtering on these custom codes isolates **real lifecycle regressions** from the
generic `23514` CHECK-constraint noise raised elsewhere in the codebase.

## Alert rule

- **Project:** FibreFlow (Bugsink project `2`).
- **Filter:** `tags.sqlstate IN ('FF001','FF002')`
  - If the SQLSTATE is not surfaced as a tag automatically, match the exception
    message prefix instead: `lifecycle_violation:` OR `holder_mismatch:`.
- **Threshold:** 1 event in 5 minutes (these should be **zero** in steady state —
  any occurrence is actionable).
- **Channel:** the existing FibreFlow paging Slack/email channel.

## Triage when it fires

1. Open the event; read the `serial` id, the attempted `from → to` status (FF001)
   or `status / holder_type` (FF002) from the message.
2. Identify the call site — the writer skipped `promoteSerial`. Check recently
   deployed code paths that `UPDATE stock_serials SET status = ...` directly.
   The Track-3 ESLint rule `local/no-direct-serial-status-write` (flipped to
   `error` at cutover) should prevent these landing — a fired alert means either
   a pre-existing path or an allow-listed helper misbehaving.
3. Run the reconcile gate to see whether the violation left drift:
   `npm run reconcile:serials` (or the cron'd `scripts/cron-serial-reconcile.sh`).
4. If drift is confirmed and growing, follow `docs/runbooks/sprint-e-rollback.md`.

## Related

- `docs/runbooks/sprint-e-cutover.md` — when this rule must be live.
- `docs/runbooks/sprint-e-rollback.md` — abort path if violations cascade.
- `scripts/cron-serial-reconcile.sh` — the standing detection complement to this alert.
