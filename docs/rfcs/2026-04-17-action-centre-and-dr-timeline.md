# RFC — Unified Action Centre + DR Timeline

| Meta | |
|---|---|
| **Date** | 2026-04-17 |
| **Author** | Hein van Vuuren (via investigation session) |
| **Status** | Draft |
| **Reviewers** | Daisy, Ettiene, NOC lead, Activation lead |
| **Target release** | rolling — 7 phases, each shippable independently |
| **Supersedes** | partial overlap with `non-invoiceables` module design; extends `dr_activity_log` |

---

## 1. Summary

Consolidate the two parallel non-invoiceables systems (Billing + Non-Invoiceables) into a single **Action Centre**, wired into a **unified DR timeline** that spans OES, 1Map, WhatsApp QA, Billing, NOC tickets, and Maintenance. Add a **rule-based auto-close engine** so work doesn't get stranded when the state that created it resolves (e.g., a pre-prov ticket closes itself when the DR goes active on OES). Add a **recon view** so we catch anomalies (stuck deductions, silent 1Map drops, cross-drop serial swaps) before they compound into billing disputes.

---

## 2. Motivation

### 2.1 The pain we've seen this week

- **Week 2026-04-12 Note 4 count = 150**, week 2026-04-05 = 111. Of the 150, **124 (83%)** were previously marked "fixed" on our side. Every one of those fixes silently dropped on 1Map because our account (role 741 Contractors) is read-only on the Home Installation layer. *(Fixed structurally by PR #1334 detection + Ettiene's creds on dev — see §8.)*
- **71 NULL-bucket DRs** had OES activations but no `ph_ont` on 1Map. Of those, only **7** had a Home Installation: Installed prop; the other 64 cannot be fixed from our side until Fibertime transitions the workflow. That's a pattern-not-a-one-off: OES says done, 1Map doesn't, FT deducts, we dispute.
- **60 of 63 blocked DRs have zero NOC tickets.** No one has visibility; nothing drives resolution.
- **Note 3 is silently hidden from the billing summary card** by `WeeklySummaryTab.tsx:178`. Data is live in the DB (16 rows for week 2026-04-12). It was deliberately excluded from exclusions — but unlabelled, so it looks like we're not importing it.

### 2.2 The structural problems

1. **Two UIs, overlapping data.** Billing (`?group=billing`) and Non-Invoiceables (`?group=non_invoiceables`) both read `ft_billing_deductions` but write to it inconsistently and never share a notion of "resolved". Billing reconcile writes to `oes_activations.payment_*`; Non-Invoiceables never reads it. See drift risks in §3.3.
2. **No unified DR timeline.** `dr_activity_log` exists (1.2M events, 20+ types) but events are scattered — OES activation is logged, billing deductions are not, ticket lifecycle is not, maintenance lifecycle is not.
3. **No auto-close.** A ticket raised because a DR was pre-provisioned stays open even after OES activates it. No rule engine watches for these transitions.
4. **No dispute path.** When we fix a serial on 1Map and FT still deducts for it 3 weeks later, there's no workflow to escalate — just eternal N4.

### 2.3 Why a unified timeline matters

Disputes with FT are won or lost on narrative quality. Today, to argue one DR's case we need to open six tabs and cross-reference. The Timeline is the narrative — reverse-chronological story of what happened, who did it, when. A PDF of it ends most disputes without argument.

---

## 3. Current state

### 3.1 Systems and their responsibilities

| System | Role | Writes | Reads |
|---|---|---|---|
| Billing (`?group=billing`) | Weekly PDF + XLSX import, reconciliation to FT's claim | `ft_weekly_billing`, `ft_billing_deductions`, `oes_activations.payment_*` | same |
| Non-Invoiceables (`?group=non_invoiceables`) | Cross-table action centre, 6 categories | *none — read-only aggregator* | `ft_billing_deductions`, `oes_pp_data`, `offline_devices`, `olt_mismatch_records` |
| Activate QA Centre | Per-DR workflow (wizard, photos, QA) | `dr_photo_unified_reviews`, `dr_activity_log`, `serial_change_history` | same + OES + 1Map |
| NOC | Maintenance + incident tickets | `maintenance_tickets`, `hs_ticket_details`, `dev_ticket_details` | same |
| OLT Report | OES ↔ 1Map serial mismatch detection + fix attempts | `olt_mismatch_records`, `serial_change_history`, `dr_activity_log` | same + 1Map API |

### 3.2 Note code semantics

| Code | FT's meaning | Claimable? | Where shown today | Where it *should* be actionable |
|---|---|---|---|---|
| N1 | Lower than −26 dB (signal quality) | Disputable | Billing card | Action Centre → Action items, disputes |
| N2 | No Field App entry | Often our fault | Billing card | Action Centre → NOC ticket auto-created |
| **N3** | **Degraded (monitor only)** | **Not a deduction** | **Hidden** | **Shown with "monitor only" badge** |
| N4 | Serial ≠ Drop on OLT (SN≠DROP) | Disputable once we prove 1Map was updated | Billing card | Action Centre → Disputes if we fixed, NOC ticket otherwise |
| N5 | Fibre break / offline | Disputable after maintenance fixes | Billing card | Action Centre → Maintenance ticket → auto-dispute on resolve |
| PP | Pre-provisioned, not yet activated | Not a deduction (yet) | Billing card | Action Centre → Pre-Prov tab, auto-resolve on OES activation |

### 3.3 Drift risks between Billing and Non-Invoiceables (today)

| # | Risk | Concrete case |
|---|---|---|
| 1 | `oes_activations.payment_status` set by Billing is never read by Non-Invoiceables | DR marked "paid" in Billing still shown as open in Non-Invoiceables |
| 2 | PP Outstanding count computed twice with same logic today, but no single source of truth | If either filter changes, the "775" diverges silently |
| 3 | No `resolution_status` column on `ft_billing_deductions` | Can't express "still open" vs "resolved" vs "disputed" vs "ticketed" |

### 3.4 What already exists that we will reuse

- `dr_activity_log` — event-sourced table, 1.2M+ rows, 20+ event types
- `src/modules/activate/services/activity-log/eventLoggers.ts` — typed logger API
- `maintenance_tickets` — full NOC ticketing with SLA, QA, categories, statuses
- `serial_change_history` — per-prop change log with metadata
- `olt_mismatch_records` — mismatch detection + fix tracking with new `rejected` status (PR #1334)

No new **core** tables are required. Everything is additive.

---

## 4. Goals / non-goals

### Goals
- One page to operate daily (Action Centre)
- Complete per-DR timeline spanning every subsystem
- Auto-close state transitions that resolve work (PP → active, fix landed → dispute opportunity, maintenance resolved → N5 disputable)
- Proactive anomaly detection (persistent N4, fix-but-still-billed, orphan pre-prov, cross-drop serial swaps)
- Dispute workflow with PDF export of the DR timeline
- NOC tickets bridged to deductions (bulk create, auto-close, status back-feed)

### Non-goals
- Replacing the Maintenance module — **Maintenance tab stays as is**; Timeline just emits pointer events
- Replacing NOC ticketing — `maintenance_tickets` is the ticket store; we add category/type values and an FK
- Changing how FT bills us — we still import their weekly PDF + XLSX
- Real-time sync to FT — weekly cycle is fine; our job is to close the loop *within* a week

---

## 5. Proposed design

### 5.1 High-level

```
                  ┌─────────────────────────────────────────────┐
                  │            DR Activity Log (backbone)       │
                  │     1.2M events, indexed by DR + time       │
                  └──────┬─────────┬─────────┬────────┬─────────┘
                         │         │         │        │
         ┌───────────────┴┐   ┌────┴────┐  ┌─┴────┐  ┌┴──────────┐
         │ OES import     │   │ 1Map   │  │ FT   │  │ NOC        │
         │ Pre-Prov       │   │ writes │  │ bill │  │ Maintenance│
         │ WA QA wizard   │   │        │  │ imprt│  │ Tickets    │
         └────────────────┘   └────────┘  └──────┘  └────────────┘

                  Each subsystem emits typed events →
                  Rule engine subscribes & reacts →
                  UI renders per-DR timeline ←─── QA Centre

                  Single Action Centre page reads across all
                  to drive daily operational workflow.
```

### 5.2 Schema additions

All additive, no breaking changes.

```sql
-- Phase 1: make "resolved" expressible on deductions
ALTER TABLE ft_billing_deductions
  ADD COLUMN IF NOT EXISTS resolution_status TEXT DEFAULT 'open'
    CHECK (resolution_status IN ('open','in_progress','ticketed','resolved','disputed','acknowledged','disputing','auto_closed')),
  ADD COLUMN IF NOT EXISTS ticket_id        UUID REFERENCES maintenance_tickets(id),
  ADD COLUMN IF NOT EXISTS resolved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_reason  TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by      TEXT,
  ADD COLUMN IF NOT EXISTS dispute_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_outcome  TEXT;

CREATE INDEX IF NOT EXISTS idx_ft_ded_dr_status
  ON ft_billing_deductions(dr_number, resolution_status, week_ending DESC);
CREATE INDEX IF NOT EXISTS idx_ft_ded_ticket
  ON ft_billing_deductions(ticket_id) WHERE ticket_id IS NOT NULL;

-- Phase 1: timeline query performance
CREATE INDEX IF NOT EXISTS idx_dr_activity_dr_time
  ON dr_activity_log(drop_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_activity_type
  ON dr_activity_log(event_type, created_at DESC);

-- Phase 2: PP lifecycle pointer
ALTER TABLE oes_pp_data
  ADD COLUMN IF NOT EXISTS ticket_id UUID REFERENCES maintenance_tickets(id);

-- Phase 3: link olt_mismatch_records → maintenance_tickets already exists
--          (maintenance_ticket_id column); ensure resolution_type covers
--          new cases.
```

No new tables. Event storage stays in `dr_activity_log`.

### 5.3 New event types to emit

Appended to `eventLoggers.ts`:

| Event | Emitted by | Body (event_data) |
|---|---|---|
| `non_invoiceable_flagged` | billing upload-weekly | `week_ending, note_code, team, project, reason, serial` |
| `non_invoiceable_resolved` | billing reconcile, NOC ticket close | `week_ending, note_code, resolution_reason, actor` |
| `dispute_candidate` | weekly recon cron | `note_code, weeks_persistent, our_fix_date` |
| `pre_prov_added` | oes_pp import | `serial, activation_code, project` |
| `pre_prov_resolved` | oes_pp reconcile | `resolution_reason, activation_date` |
| `ticket_created` | maintenance_tickets INSERT hook | `ticket_id, ticket_uid, category, type, priority, source` |
| `ticket_status_changed` | maintenance_tickets UPDATE hook | `ticket_id, ticket_uid, from_status, to_status, actor` |
| `ticket_auto_closed` | auto-close rule engine | `ticket_id, ticket_uid, triggering_event, rule_name` |
| `maintenance_ticket_created` | maintenance ticket INSERT | same as ticket_created, filtered to maintenance type |
| `maintenance_tech_onsite` | first maintenance_wa_photos for ticket | `ticket_uid, photo_count, team` |
| `maintenance_qa_passed` | maintenance QA approve | `ticket_uid, reviewer` |
| `maintenance_resolved` | maintenance ticket → resolved | `ticket_uid, resolution_note` |
| `maintenance_reopened` | resolved → open within 30 days | `ticket_uid, days_since_resolved` |
| `serial_reconciled` | oneMapApiService post-write read-back | `propId, old, new, matches_oes` |
| `1map_write_rejected` | oneMapApiService detection (PR #1334) | `propId, reason, acl_or_lock` |
| `anomaly_fixed_still_billed` | recon cron | `note_code, weeks_since_fix, fix_date` |
| `anomaly_persistent_note` | recon cron | `note_code, consecutive_weeks` |

### 5.4 Auto-close rule engine

A single Next.js cron (every 5 min) that tails `dr_activity_log` since last checkpoint and applies rules:

| Trigger event | Condition | Action | Safety rail |
|---|---|---|---|
| `oes_activated` | Open tickets w/ `category='pre_prov_unresolved'` for same DR | Resolve tickets with "Activated on OES {date} — auto-closed". Emit `ticket_auto_closed`. | Skip if ticket has notes from last 48h (human actively working) |
| `oes_activated` | `ft_billing_deductions` rows w/ `resolution_status='open'` and `note='note1_pp'` | Mark `resolution_status='auto_closed'`, emit `non_invoiceable_resolved` | — |
| `serial_reconciled` | Open tickets w/ `category='N4_serial_drop_mismatch'` for same DR | Resolve with "1Map serial matched OES on {date} — auto-closed" | Only if reconciled serial equals OES current serial (not stale) |
| `non_invoiceable_flagged` (N4) | Same DR was previously `serial_reconciled` (successful write on our side) | Flag as `dispute_candidate` — emit event | Does NOT auto-resolve — human dispute decision |
| `maintenance_resolved` | Recent N5 deduction for same DR (last 2 weeks) | Flag deduction as `dispute_candidate` | — |
| `non_invoiceable_flagged` for consecutive ≥3 weeks | (no prior fix evidence) | Emit `anomaly_persistent_note` | Signal only, no action |
| `pre_prov_added` >30 days old, no activation | | Emit `anomaly_stale_pp` + auto-create NOC ticket if none exists | Only if no existing ticket |

Rule engine is idempotent — events carry a `rule_run_id` in event_data so re-processing doesn't double-fire.

### 5.5 Unified Action Centre page

Route: `/activate/action-centre` (redirects from `?group=billing` and `?group=non_invoiceables` for 2 weeks).

Tabs (ModuleNav horizontal):

| Tab | Purpose | Key data |
|---|---|---|
| **Overview** | 5 note cards + PP + Recovered + Disputed | same as today's Billing card, but all 5 notes shown (N3 with "monitor only" badge) |
| **Action items** | Flat row list across 6 categories | `ft_billing_deductions` + `oes_pp_data` + `offline_devices` + `olt_mismatch_records` with `resolution_status='open'`, sortable/filterable |
| **Recon** *(new)* | Side-by-side: FT billed ↔ OES ↔ 1Map per DR | Weekly sweep output, anomaly badges |
| **Disputes** *(new)* | DRs flagged `dispute_candidate` or `disputing` | With outcome tracking + PDF export per row |
| **Pre-Prov** | Unchanged functionally, sub-tab of the page | `oes_pp_data` view |
| **Tickets** *(new)* | All NOC tickets tied to action centre items | `maintenance_tickets WHERE source_type IN (...)` |

**Bulk actions:** select N rows → Create tickets (templated by category), Raise dispute, Mark acknowledged, Assign to team.

### 5.6 Timeline tab in QA Centre

New "Timeline" tab on the existing DR detail page (sits next to Overview, Photos, Serial History, Maintenance).

- Reverse-chronological, grouped by day, SAST timestamps
- Icon + one-liner + click-through to source (ticket, maintenance tab, serial history, etc.)
- Filter chips: All | OES | 1Map | WhatsApp QA | Billing | Tickets | Maintenance
- Export → PDF with logo, DR details, full event stream (for disputes)

**Maintenance integration (hybrid):**
Timeline carries *pointer* events (`maintenance_ticket_created`, `maintenance_tech_onsite`, `maintenance_resolved`, …). Clicking one jumps to the Maintenance tab, which holds the actual photos, wizard, materials, notes. Timeline is narrative; Maintenance tab is payload.

### 5.7 Example timeline (DR475330, real)

```
2026-03-01  oes_activated              — activated on OES (ALCLB48E7830, mam2)
2026-03-05  non_invoiceable_flagged    — N4 on week 2026-03-08 (SN≠DROP)
2026-03-12  ticket_created             — VF-20260312-017 (N4, FT-escalation)
2026-04-04  1map_write_rejected        — fix attempt by hein (silent drop)
2026-04-06  serial_reconciled          — (FT's WA bot overwrote with correct)
2026-04-12  non_invoiceable_flagged    — still on N4 week 2026-04-12
2026-04-12  dispute_candidate          — auto-flagged (3 consecutive weeks)
2026-04-15  maintenance_ticket_created — customer reported offline
2026-04-16  maintenance_tech_onsite    — 4 photos uploaded
2026-04-16  maintenance_resolved       — cable replaced
2026-04-19  non_invoiceable_resolved   — N4 dropped from next week's FT billing
```

One screen, full story.

---

## 6. Phased implementation

Each phase is independently shippable and provides value on its own.

### Phase 1 — Quick wins *(this weekend)*
1. Un-hide Note 3 on billing summary card with "Monitor only" badge
2. Add `resolution_status`, `ticket_id`, `resolved_at`, `resolved_reason`, `resolved_by`, `dispute_*` columns to `ft_billing_deductions`; backfill existing rows to `resolution_status='open'`
3. Add indices on `dr_activity_log(drop_number, created_at DESC)` and `(event_type, created_at DESC)`
4. Bulk-create NOC tickets for the 60 untracked blocked DRs from today's audit; set `resolution_status='ticketed'` + `ticket_id` on matching `ft_billing_deductions` rows

**Shipped acceptance:** N3 visible + 60 tickets created + DB ready for phase 2.

### Phase 2 — Event backbone *(next week)*
1. Add typed loggers in `eventLoggers.ts` for every event in §5.3
2. Wire them into existing handlers: `billing/upload-weekly.ts`, `oes_pp import`, `maintenance_tickets CRUD`, `fix-1map.ts` (already emits some), weekly OES import
3. One-off backfill script: reconstruct last 90 days of `non_invoiceable_flagged`, `pre_prov_added`, `ticket_*` from existing tables

**Shipped acceptance:** every new week's billing import emits timeline events; historical backfill complete.

### Phase 3 — Auto-close rule engine *(week after)*
1. `pages/api/cron/action-centre-rules.ts` running every 5 min via Vercel Cron
2. Reads unprocessed events since last checkpoint; applies rules in §5.4
3. Dry-run mode for 1 week (emits proposed actions to a `rules_dry_run_log` table without executing)
4. Flip to live after review

**Shipped acceptance:** PP→active auto-closes at least 1 ticket; N4+prior-reconcile raises at least 1 dispute candidate.

### Phase 4 — Timeline UI in QA Centre
1. New Timeline tab on DR detail page
2. Renders `dr_activity_log` events with type-specific icons/templates
3. Filter chips, deep-links, infinite scroll
4. PDF export endpoint

**Shipped acceptance:** open any DR's QA page, see full timeline, export to PDF.

### Phase 5 — Action Centre page
1. `/activate/action-centre` with 6 tabs (§5.5)
2. Redirects from old URLs
3. Old pages marked deprecated in-UI for 2 weeks, then removed

**Shipped acceptance:** day-to-day operators use only Action Centre; old pages 404 after deprecation.

### Phase 6 — Recon + anomaly rules *(alongside Phase 5)*
1. Weekly sweep cron (Mondays 04:00 SAST) comparing FT billing ↔ OES ↔ 1Map for prior week
2. Writes anomaly events to `dr_activity_log` + updates `ft_billing_deductions.resolution_status='disputing'` where applicable
3. Recon tab in Action Centre surfaces results

**Shipped acceptance:** Monday morning dashboard shows last week's anomalies, each actionable in <2 clicks.

### Phase 7 — Dispute PDF export + FT reply tracking
1. PDF generator pulls Timeline + Recon state → one document per DR
2. `dispute_outcome` field tracking per deduction row
3. Success metric dashboard

**Shipped acceptance:** one-click dispute packet; historical win rate tracked.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 1Map ACL blocks writes for most users | Fix flow silently fails | Ettiene creds on dev already; service account requested from 1Map (§8); PR #1334 detection prevents false-success |
| Auto-close misfires | Tickets closed while human working them | Skip ticket if has notes in last 48h; dry-run phase; rule engine emits `ticket_auto_closed` so a human can reverse |
| 1.2M `dr_activity_log` rows becomes 10M | Query slowness | Indexes in Phase 1; monthly partitioning if >20M |
| Backfill floods Timeline | Users can't see recent events | Backfill marked with `backfill: true` metadata; UI filters it out by default |
| Deduction marked resolved prematurely | We accept a bill we could have disputed | Auto-resolve ONLY when `week_ending+1` no longer shows the deduction (empirical proof), not on state transition alone |
| Dispute outcomes not tracked | Can't measure win rate | Phase 7 adds `dispute_outcome` + metric |
| RFC scope is large | Gets stuck | 7 independent phases; each provides value |

---

## 8. Already shipped (context)

These changes landed during the investigation that produced this RFC:

- **PR #1334** — `oneMapApiService` detects silent-drop writes (tenant ACL, no rows affected), stops falsely marking them as fixed. Adds `fix_status='rejected'` to `olt_mismatch_records`.
- **Ettiene's creds on dev** — `dev.fibreflow.app/.env.local` now uses `ettiene@velocityfibre.co.za` (role 574, write on Home Installation layer). Production pending after-hours deploy with approval.
- **71 NULL-bucket fixes + 84 rollbacks** — initial run wrote to all prop_ids; audit found 84 were on pre-install props; rolled back. 7 legit fixes kept (only those with a Home Installation: Installed prop).
- **79 non-NULL N4 fixes** — 72 wrote, 3 NOOP, 4 blocked (no Installed prop).
- **Full audit Excel** — `~/Downloads/onemap-full-audit-2026-04-17.xlsx` with Summary/Fixed/Blocked/All Writes/Rollbacks/Current State/NOC Tickets sheets, project-tagged.

---

## 9. Open questions

1. **Service account with 1Map** — should we request a dedicated `velocity-sync@velocityfibre.co.za` account instead of using Ettiene's personal creds long-term? *Recommendation: yes, opens a cleaner audit trail.*
2. **FT webhook vs weekly PDF** — is FT open to giving us real-time billing events? Would shorten dispute cycles dramatically. *Action: Hein to ask FT.*
3. **Retention policy** on `dr_activity_log` — 12 months hot, archive older? *Recommendation: 24 months hot given 1.2M row size; revisit at 10M.*
4. **Dispute pricing** — do we have a CPO value per note code so we can quantify dispute value? *Check with finance.*
5. **Maintenance closure → N5 auto-dispute** — should a resolved maintenance ticket automatically open a dispute for any N5 deduction on that DR? *Recommendation: flag as candidate, don't auto-file; keep human in the loop.*
6. **Multi-week claim rollup** — today `ft_billing_deductions` has one row per (week, dr, note). Should rollup happen for dispute packets? *Yes — PDF should show full N4 history, not just latest week.*

---

## 10. Appendix — where to find things

- Activity log table: `dr_activity_log` (1.2M+ rows)
- Typed event loggers: `src/modules/activate/services/activity-log/eventLoggers.ts`
- Billing import: `pages/api/billing/upload-weekly.ts`
- Non-invoiceables overview: `pages/api/activate/non-invoiceables/overview.ts`
- Note 3 suppression: `src/modules/billing/components/WeeklySummaryTab.tsx:178`
- OLT mismatch fix flow: `pages/api/system/olt-report/fix-1map.ts`
- 1Map silent-drop detection: `src/modules/system/services/oneMapApiService.ts` (PR #1334)
- Maintenance tickets: `maintenance_tickets` table + `src/modules/noc/`
- Current deploy rules: `.claude/CLAUDE.md` §Deployment

---
*End of RFC.*
