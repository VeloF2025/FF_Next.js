# Action Centre Module

## Overview

| Property | Value |
|----------|-------|
| **Purpose** | Unified view + workflow across non-invoiceables, pre-provisioned, tickets, disputes, anomalies |
| **Status** | In rollout (Apr 2026 — RFC shipped across 20 PRs) |
| **Complexity** | High — spans billing, OES, 1Map, NOC, maintenance |
| **Category** | operational |
| **RFC** | `docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md` |
| **UI route** | `/activate/action-centre` |

Replaces the parallel "Billing summary" + "Non-Invoiceables" flows that existed before Apr 2026. Aggregates state from four underlying tables and adds event-sourced audit + automation.

## Sub-tabs (6)

| Tab | Route | What it shows |
|-----|-------|---------------|
| **Overview** | `?tab=overview` | Headline counts (open deductions, PP outstanding, open tickets, resolved this month) + per-note N1-N5 breakdown + anomalies (7d) + last rule-engine run |
| **Action items** | `?tab=items` | Flat list across 4 sources: deductions, pre-prov, OLT mismatches, offline devices. Filter chips by source + note + search |
| **Recon** | `?tab=recon` | Weekly side-by-side: FT billed ↔ OES ↔ last 1Map fix. 5-way classification (`already_fixed_still_billed`, `actionable`, `blocked_no_installed`, `no_oes`, `unknown`) |
| **Disputes** | `?tab=disputes` | Deductions with `resolution_status IN ('disputing','disputed','acknowledged')`. Per-row outcome actions (won/lost/partial/withdraw). Live win-rate % card |
| **Tickets** | `?tab=tickets` | NOC tickets bound to Action Centre flows (deduction / pre-prov / OLT). Status + source filters + search |
| **Automation** | `?tab=automation` | Rule engine + recon cron observability. Last 24h totals, per-rule watermarks, recent runs with errors |

## Data model

### Core tables (existed before RFC)
- `ft_billing_deductions` — per-DR per-week per-note Fibertime deductions (N1..N5). **Extended by #1337** with `resolution_status`, `ticket_id`, `resolved_at/by/reason`, `dispute_*` columns
- `oes_pp_data` — pre-provisioned ONTs with `resolution_status` + `resolved_drop_number`. Extended with `ticket_id` FK
- `olt_mismatch_records` — OLT report mismatches with `fix_status` + `rejected` state (from PR #1334)
- `offline_devices` — field-detected offline ONTs with `mismatch_status`
- `maintenance_tickets` — NOC tickets (pre-existing, no changes)

### New tables (migration 306)
- `action_centre_rule_runs` — per-invocation audit. `(id, started_at, completed_at, dry_run, events_processed, actions_taken, rules_summary jsonb, errors jsonb)`
- `action_centre_rule_checkpoints` — per-rule watermark. `(rule_name PK, last_event_id, last_event_at, updated_at)`

### Event table (extended, not created)
- `dr_activity_log` is the backbone. The Action Centre adds 13 new `event_type` values — see §"Events" below.

## Events (13 new types)

Registered in `src/modules/activate/services/activity-log/_shared.ts` `ActivityEventType` + `EVENT_METADATA`.

| Event | Emitted by | Shape |
|---|---|---|
| `non_invoiceable_flagged` | `pages/api/billing/upload-weekly*.ts` | `{ weekEnding, noteCode, team, project, reason, serial }` |
| `non_invoiceable_resolved` | Disputes tab (on "won") | `{ weekEnding, noteCode, resolutionReason, disputeOutcome }` |
| `pre_prov_added` | `oesImportService.importPPData` (via `RETURNING`) | `{ serial, activationCode?, project? }` |
| `pre_prov_resolved` | `oesPostImportService.triggerPpActivationCheck` | `{ resolutionReason, activationDate }` |
| `ticket_created` | `ticketService.createTicket` | `{ ticketId, ticketUid, category, type, priority, source, sourceType }` |
| `ticket_status_changed` | `ticketService.updateTicket` (diff) | `{ ticketId, ticketUid, fromStatus, toStatus }` |
| `ticket_auto_closed` | Rule engine | `{ ticketId, ticketUid, triggeringEvent, ruleName }` |
| `serial_reconciled` | `fix-1map.ts` on successful write | `{ propId, oldValue, newValue, matchesOes }` |
| `1map_write_rejected` | `fix-1map.ts` on silent-drop (PR #1334) | `{ propId, attemptedValue, reason }` |
| `anomaly_fixed_still_billed` | Rule engine rule 3 | `{ noteCode, weekEnding, ourFixDate, weeksSinceFix }` |
| `anomaly_persistent_note` | `persistentNoteScanner` | `{ noteCode, consecutiveWeeks, firstWeek, latestWeek }` |
| `anomaly_stale_pp` | `stalePpScanner` | `{ serial, ageDays, resolutionStatus, project }` |
| `maintenance_reopened` | `maintenanceReopenScanner` | `{ ticketId, ticketUid, daysSinceResolved, previousStatus, newStatus }` |
| `maintenance_tech_onsite` | `maintenanceTechOnsiteScanner` | `{ ticketId, ticketUid, photoCount, firstPhotoAt }` |

## Automation

### Rule engine (every 5 min)
`pages/api/cron/action-centre-rules.ts` → `runActionCentreRules(dryRun?)` in `src/modules/activate/services/action-centre-rules/ruleEngine.ts`.

3 rules:

| Rule | Trigger event | Action |
|---|---|---|
| `pre_prov_activated_close_tickets` | `pre_prov_resolved` | Resolve open tickets with source_type in (pp_unresolved, pp_investigation) for same DR |
| `serial_reconciled_close_tickets` | `serial_reconciled` (matchesOes=true) | Resolve open tickets with source_type in (n4_unresolved, olt_mismatch) for same DR |
| `n4_after_fix_dispute_candidate` | `non_invoiceable_flagged` (note4) | If a prior `serial_reconciled` exists: emit `anomaly_fixed_still_billed` + flip deduction to `resolution_status='disputing'` with dispute_reason populated |

Safety rails:
- 48h `updated_at` cutoff — skip tickets humans are actively working
- Per-rule watermark so reruns are idempotent
- Dry-run mode (`?dryRun=true`) mutates nothing

### Weekly recon (Mon 04:00 UTC)
`pages/api/cron/action-centre-weekly-recon.ts` runs 4 scanners in parallel:

| Scanner | Emits |
|---|---|
| `persistentNoteScanner` | `anomaly_persistent_note` for DR+note on 3+ consecutive weeks (gap-and-islands query) |
| `stalePpScanner` | `anomaly_stale_pp` for PP rows > 30 days unresolved |
| `maintenanceReopenScanner` | `maintenance_reopened` for resolved→open transitions within 30d |
| `maintenanceTechOnsiteScanner` | `maintenance_tech_onsite` when first maint photo arrives after ticket open |

All scanners are idempotent (7-30 day window check on existing events).

## Credentials for 1Map writes

**Never use Hein's account for 1Map writes** — role 741 (Contractors) is read-only on layer 5121. Every write silently drops (1Map returns `success:true` with empty `items[]`).

Use Ettiene (`ettiene@velocityfibre.co.za`, role 574) — already set in dev `.env.local`. Long-term: a dedicated service account.

Silent-drop detection lives in `oneMapApiService.parseWriteResponse()` (PR #1334). If `items.length === 0` on a `success:true` response, treat as rejected.

## Quick operator queries

```sql
-- Action Centre health: what the rule engine did in the last 24h
SELECT started_at, dry_run, events_processed, actions_taken, rules_summary
  FROM action_centre_rule_runs
 WHERE started_at > NOW() - INTERVAL '24 hours'
 ORDER BY started_at DESC LIMIT 20;

-- Per-rule watermark
SELECT * FROM action_centre_rule_checkpoints ORDER BY rule_name;

-- Auto-closed tickets today
SELECT t.ticket_uid, t.status, t.assessment_comment
  FROM maintenance_tickets t
 WHERE t.assessment_comment LIKE '%[auto-closed by%'
   AND t.updated_at > NOW() - INTERVAL '24 hours';

-- Dispute candidates this week
SELECT dr_number, week_ending, dispute_reason, dispute_opened_at, ticket_id
  FROM ft_billing_deductions
 WHERE resolution_status = 'disputing'
   AND week_ending = (SELECT MAX(week_ending) FROM ft_billing_deductions);

-- DR Timeline for a single DR
SELECT created_at, event_type, event_data, actor
  FROM dr_activity_log
 WHERE drop_number = 'DR1734757'
 ORDER BY created_at DESC;
```

## Where to look when things break

| Symptom | Likely cause | Where to check |
|---|---|---|
| Timeline empty on a DR with activity | Event wire-up not firing | `dr_activity_log` query by drop_number; verify `@/modules/activate/services/activity-log/eventLoggers` imports in the emitter file |
| Tickets in Automation tab "behind" the checkpoint time | Rule engine cron dead | `/api/cron/action-centre-rules` logs; `action_centre_rule_runs` recent rows |
| Fix button marks "fixed" but serial didn't update on 1Map | Silent-drop undetected | Check `parseWriteResponse` output in logs; verify Ettiene creds active |
| Deduction disputed but not in Disputes tab | `resolution_status` not flipped | Check `ft_billing_deductions.resolution_status` for that row |
| PDF export button disabled | Timeline has 0 events | Verify `dr_activity_log` has rows for the DR |
| Action Centre Overview all zeroes | API failure in one of the parallel counts | `/api/activate/action-centre/overview` response body; `safeQuery` log lines |

## Known gaps / deferred

- **Bulk actions** (raise N disputes, create N tickets) — blocked by NOC team-assignment deploy (see memory `feedback_no_bulk_tickets_until_teams_deployed`)
- **Test coverage** — no vitest/unit tests landed for the rule engine or scanners. Next pickup.
- **`?week=` param on WeeklySummaryTab** — shipped in #1354 but only auto-expands+scrolls; no separate per-week route.

## PRs shipped (Apr 17-18 2026)

20 PRs across RFC Phase 1→7 + polish. See `docs/rfcs/2026-04-17-action-centre-and-dr-timeline.md` for the merge order and dependencies.

Mergeable in strict order (each depends on the one above):
1. #1337 Phase 1 schema (merged)
2. #1339 Phase 2 event vocabulary (merged)
3. #1342, #1343 (wire-ups + Timeline) — merge together
4. #1345 (rule engine)
5. #1346, #1347, #1349, #1350, #1351, #1352, #1353, #1354 (UI + crons)
6. #1355, #1356, #1357, #1358, #1359, #1360 (scanners + remaining tabs + polish)

Or merge in the reverse order of numeric dependencies; the squash-merges rebase onto master cleanly because each branch was built on the previous.
