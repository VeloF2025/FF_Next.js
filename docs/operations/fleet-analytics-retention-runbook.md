# Fleet operational analytics and retention — runbook

Stage 8 of Fleet Driver Oversight: anonymous monthly trends that outlive the
detail they came from, and a purge that removes identifiable programme data
after twelve months unless something is holding it.

Full behavioural reference: `.claude/modules/fleet.md`. **Before touching the
aggregate read path, read `.claude/modules/fleet-analytics-disclosure.md`** —
it records what the anonymity guarantee does and does not cover, and several of
its weaker items are still open.

## Read this first: the pipeline is currently producing nothing

Measured on the shared database 2026-08-25:

| Table | Rows |
|---|---|
| `fleet_operational_monitor_runs` | 2153, and still running every few minutes |
| `fleet_operational_incidents` | **0, all time** |
| `fleet_operational_monthly_aggregates` | **0** |
| `fleet_operational_assignments` | **0** |
| `fleet_project_operational_sites` | **0** |
| `fleet_authorized_locations` | **0** |

`roster_evaluated_count` is `0` on every successful monitor run. Nothing is
broken: the detector evaluates the operational roster, the roster is built from
assignments, assignments require an operational site, and no site has ever been
created. Everything downstream is correctly empty.

**Consequence for this runbook:** the aggregation job succeeds nightly and
writes nothing, and the retention job has nothing to purge. Neither can be
verified against real output until a roster exists. Creating one is data entry
(`/fleet/assignments` → select a project → *Operational sites* → pick a
reviewed source → **Add site**), and it is not a step this document authorizes:
the moment a roster exists, ten enabled rules begin evaluating named staff and
notifying oversight members.

## What stage 8 adds

| Behaviour | Detail |
|---|---|
| Monthly aggregates | One row per (metric, month, dimension) in `fleet_operational_monthly_aggregates`. Retained **indefinitely** — they are what survives the purge. |
| Metric set | Presence (4), incidents by type (14), review outcomes (8), workflow timing (4), driver input (3), reliability (6). Closed set, in `analytics/aggregateSchema.ts`, mirrored by CHECK constraints in migration 518. |
| Anonymity | A group below the configured threshold (default 5 distinct contributing staff) is generalized to its parent level or withheld. Partition-aware: withholding one metric while publishing its siblings and their shared denominator would recover it by subtraction, so a partition is released as a unit. |
| Published surface | `fleet_operational_monthly_aggregates_published` (migration 527) — organisation and project rows only, no `contributor_count`, no histogram columns, no checksum. Site rows are computed, stored, and never published. |
| Detail retention | 12 months by default, effective-dated in `fleet_operational_analytics_settings`. Purge removes programme-owned PR4–7 incident data and its attachments only. |
| Never purged | Active incidents, anything under an active hold, and all source data — Attendance, GPS/telematics, H&S, project/site/vehicle/staff master records. |
| Coverage gate | An incident's month must have been aggregated before its detail may be deleted. |
| Holds | Six categories, an owner who answers for it, a mandatory next-review date, and a maximum review interval (default 90 days) with a reminder lead (default 14). |
| Retention default | **Dry run.** `live_retention_enabled` is `false`, and the cron wrapper has no switch to send anything else. |
| External-monitoring boundary | If the scheduler or host stops entirely and neither endpoint runs, nothing inside the application can detect it. External host/scheduler monitoring is required for that failure mode — same boundary as the incident crons. |

## Migration state

| Migration | Purpose | Applied on shared DB |
|---|---|---|
| 518 | Aggregates, runs, settings, holds, retention items | ✅ |
| 521 | Delete grants the purge needs to execute as `fibreflow_user` | ✅ |
| 527 | `…_published` view — the only relation a read path may use | ✅ |
| **530** | `fleet_operational_aggregate_month_coverage` | ❌ **not applied** |

### ⚠️ Migration 530 must be applied BEFORE the code that reads it deploys

The retention cron is live (5 runs, most recent 2026-08-25 03:30 SAST). Once
the coverage-gate change deploys, `hasCompleteAggregateCoverage` queries
`fleet_operational_aggregate_month_coverage`. If the migration has not been
applied, the nightly retention run fails with `relation … does not exist`.

It fails **closed** — nothing is deleted — but it fails loudly every night
until the migration lands. Apply 530, then deploy.

Why the gate changed: the previous one inferred coverage from the presence of
aggregate rows, and a month can be aggregated fully and correctly while
publishing **zero** rows (the release rule withholds a metric whose support is
empty rather than storing a roster-sized zero). Those months reported no
coverage forever and their detail could never be purged.

## Scheduled jobs

Both endpoints authenticate with the repo-wide cron secret. The wrappers read
it from the environment or the deploy directory's env file — never pass it on a
command line, and never write it into a tracked file. See
`.claude/credentials.local.md` for where the value lives.

| Job | Endpoint | Wrapper | Default time (SAST) |
|---|---|---|---|
| Aggregation | `/api/cron/fleet-operational-aggregate` | `scripts/cron-fleet-operational-aggregate.sh` | 01:00 |
| Retention (dry run) | `/api/cron/fleet-operational-retention` | `scripts/cron-fleet-operational-retention.sh` | 03:30 |

The times above are the settings-row defaults (`aggregation_run_hour_sast`,
`retention_run_hour_sast`); the crontab entries must be kept consistent with
them by hand — the application does not schedule itself.

```cron
0  1 * * * /home/velo/fibreflow-<env>/scripts/cron-fleet-operational-aggregate.sh  >> /home/velo/logs/fleet-operational-aggregate.log  2>&1
30 3 * * * /home/velo/fibreflow-<env>/scripts/cron-fleet-operational-retention.sh  >> /home/velo/logs/fleet-operational-retention.log  2>&1
```

**The retention wrapper sends `{"dryRun": true}` and has no flag to send
anything else.** That is deliberate: a job that can delete production data
should not be one edit away from doing so. Going live is a separate act — see
below.

## Aggregation behaviour

Every run rebuilds each month in the recalculation window (default 3). A month
is replaced whole, inside one transaction, or not at all; unchanged months are
detected by checksum and rewrite nothing.

- A month whose presence evaluation skipped days is **not written**. A partial
  month stored as complete would satisfy the coverage gate and authorise
  purging incidents against numbers that never included them.
- A failed month leaves its previous generation active and increments
  `months_failed`; the run reports `partial`.
- Coverage is recorded in the same transaction as the rows it attests to, on
  every path — including a month that publishes nothing.

## Going live with retention (separate approval, after hours)

Deletion is irreversible. Each step is its own approval.

1. **Confirm a database backup** covering the incidents and evidence tables.
2. **Apply migration 530** and read it back.
3. **Confirm aggregate coverage** for every month that would be in scope — the
   gate refuses uncovered months, so a gap here means those incidents simply
   are not purged.
4. **Run a dry run and read it.** Counts, held exclusions, coverage-blocked
   exclusions, and storage object totals. Do not proceed on a dry run nobody
   has read.
5. **Approve going live**, then set `live_retention_enabled = true` by opening a
   new settings version through the settings dialog or
   `POST /api/fleet/incidents/settings/retention-analytics`.
6. **Watch the first live run.** Storage deletion happens over HTTP outside any
   transaction; a failure leaves the item staged for retry with the database
   evidence intact, by design.

**Shortening the retention window is its own hazard.** Reducing
`retention_months` makes every terminal incident between the new cutoff and the
old one deletable at the next purge. The settings API refuses it unless
`acknowledgedDryRunId` names a real run with `dry_run = true`.

## Post-install readback

```sql
-- Migrations present
SELECT filename FROM schema_migrations
 WHERE filename LIKE '5%fleet_operational_analytics%'
    OR filename LIKE '5%fleet_aggregate%' ORDER BY filename;

-- Aggregation health
SELECT status, months_requested, months_succeeded, months_failed, rows_written, started_at
  FROM fleet_operational_aggregation_runs ORDER BY started_at DESC LIMIT 5;

-- Coverage actually recorded (after 530)
SELECT metric_version, month_start, row_count, completed_at
  FROM fleet_operational_aggregate_month_coverage ORDER BY month_start DESC LIMIT 12;

-- Retention runs — dry_run must be true until live is approved
SELECT dry_run, status, cutoff_work_date, items_considered, items_claimed,
       items_completed, items_skipped_hold, items_skipped_coverage, started_at
  FROM fleet_operational_retention_runs ORDER BY started_at DESC LIMIT 5;

-- Anything currently held from deletion
SELECT category, status, next_review_at FROM fleet_incident_retention_holds
 WHERE status = 'active' ORDER BY next_review_at;

-- The effective policy
SELECT version, retention_months, anonymity_min_contributors, live_retention_enabled
  FROM fleet_operational_analytics_settings WHERE effective_to IS NULL;
```

## Rollback

| Rolling back | Effect |
|---|---|
| 530 | The coverage gate's table disappears and retention fails loudly rather than falling back. Deliberate: a silent fallback would reintroduce the defect 530 fixes, invisibly. Retention stops; it does not revert. |
| 527 | The published view goes, and every analytics read path breaks loudly. Also deliberate — a read path quietly falling back to the base table would begin returning superseded, pre-tightening generations. |
| 518 | Removes the whole stage-8 schema. Only safe while no aggregates or holds exist that anyone needs. |

No rollback deletes an aggregate row, an incident, or a piece of evidence.

## What is NOT verified

- **No browser evidence exists for the stage-8 UI.** The analytics section, the
  export, the hold panel and the settings section can only render empty states
  against a database with no operational data. They are covered by unit tests
  and by nothing else.
- **The retention purge has never run against real data**, live or dry, with
  anything to purge.
- Section 3 of the disclosure note — cross-month differencing, absence as
  inference, and `generalized_from_level` announcing suppression — remains open
  and documented rather than closed.
