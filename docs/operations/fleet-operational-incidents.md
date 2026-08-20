# Fleet operational incidents — deployment and verification

PR 6 (`feat/fleet-oversight-pr6-incidents-review`) turns four PR 4 operational
statuses into durable, reviewable incidents, adds a two-cron escalation/summary/
health pipeline, and adds a manager review queue at `/fleet/incidents`. Full
behavioural reference: `.claude/modules/fleet.md` → "Operational Incidents
(migration 510, PR 6)".

**Merging this code does nothing by itself.** Migration 510 is unapplied, and
neither cron entry is in any environment's crontab. Both are deployment actions
requiring separate approval — this document does not authorize either.

**PR 6 requires no driver action.** Only managers and Fleet oversight users
record a reason, comment, or evidence against an incident.

## What this PR adds

| Behaviour | Detail |
|---|---|
| Incident types | 4 auto-detected (`late`, `wrong_site`, `evidence_mismatch`, `left_early`), 4 summary-only (`unassigned`, `unverifiable`, `vehicle_on_site_driver_unconfirmed`, `evidence_gap`), 6 source-event safety/telematics types with no producer wired yet. |
| Lifecycle | `open -> acknowledged -> under_review -> resolved\|dismissed`, enforced by database CHECK constraints and row-locked transitions. |
| Detection delay | Maximum 5 minutes — `fleet-operational-monitor` cron cadence. |
| Daily summary | 08:15 Africa/Johannesburg, at most once per work date, for summary-only conditions whose rule has `includeInMorningSummary`. |
| Scope | Project manager sees only their own project's incidents; `admin`/`super_admin` or an explicit override grant sees cross-project and projectless incidents; a plain `manager` role alone is never enough. |
| Evidence | VF Storage, category `fleet/incidents`, 15 MB / jpeg-png-pdf allowlist, append-only, no delete path. |
| Notification channels | In-app + email by default; WhatsApp is mandatory (in addition to configured channels) only for `severity: 'critical'` incidents produced from an explicit source event. |
| External-monitoring boundary | If the entire scheduler/host stops and neither cron endpoint ever runs, nothing inside the application can detect that — external host/scheduler monitoring is required for that failure mode. |

## Deployment sequence (not part of this PR — record approval for each step)

1. **Approve and apply migration 510** (`scripts/migrations/sql/510_fleet_operational_incidents.sql`) against the shared database. Confirm readback: `SELECT filename FROM schema_migrations WHERE filename = '510_fleet_operational_incidents.sql'`.
2. **Approve and set `CRON_SECRET`** in the target environment's env file if not already present (both new cron endpoints reuse the existing repo-wide secret — no new secret is introduced).
3. **Approve and install both crontab lines**, mirroring the existing Fleet cron pattern (`scripts/cron-fleet-parking-check.sh` as precedent):
   ```cron
   */5 * * * * /home/velo/fibreflow-<env>/scripts/cron-fleet-operational-monitor.sh >> /home/velo/logs/fleet-operational-monitor.log 2>&1
   */5 * * * * /home/velo/fibreflow-<env>/scripts/cron-fleet-incident-actions.sh   >> /home/velo/logs/fleet-incident-actions.log   2>&1
   ```
4. **Register external host/scheduler monitoring** for a total outage of both endpoints — the application-level health check in `fleet-incident-actions` can only detect a stale/missing `status_monitor` run because it is itself still executing; it cannot detect the case where neither cron runs at all.
5. **Verify** using the readback queries below before considering either cron "live" for this deployment.

### Post-install readback

```sql
-- Rules seeded correctly (14 rows, exactly one open version per type):
SELECT incident_type, version, enabled, creates_incident, severity
FROM fleet_operational_incident_rules WHERE effective_to IS NULL ORDER BY incident_type;

-- No incidents exist yet (expected immediately after migration):
SELECT count(*) FROM fleet_operational_incidents;

-- After the first few cron ticks, confirm runs are being recorded:
SELECT run_kind, status, started_at, completed_at, roster_evaluated_count, error_count
FROM fleet_operational_monitor_runs ORDER BY started_at DESC LIMIT 10;
```

Also visible at `/fleet/incidents` once oversight/PM access is granted (via
`role_permissions` seeded by the migration, or an explicit override grant for a
non-admin oversight user added through the settings dialog).

## Rollback

`scripts/migrations/sql/rollback_510_fleet_operational_incidents.sql` drops all
seven tables and the two `fleet.incidents*` permissions. **This deletes incident
and audit evidence — execute only with the same approval level as the forward
migration**, and only after removing both crontab lines first (a still-scheduled
cron hitting a dropped table fails loudly, which is the safer failure mode, but
remove the schedule anyway before rolling back).

## Verification already completed (this PR)

- Focused and module test suites pass — see the PR description / CI run for
  exact counts.
- `npm run agents:mirror` / `npm run agents:check` — mirrors regenerated and
  verified.
- `git diff --check` — no whitespace conflicts.
- Diff scanned for `TODO`/`PLACEHOLDER`/hardcoded personal email addresses —
  none found.
- Logging and notification payload sites inspected for coordinates, secrets,
  raw provider payloads, and base64 — none found (see the PR description for
  the exact call sites checked).
- `bash scripts/secret-scan.sh` — run with no bypasses.

## Outstanding gates (not completed by this PR)

- [ ] **Migration 510 applied** to the shared database.
- [ ] **Both cron entries installed** in a target environment's crontab.
- [ ] **External host/scheduler monitoring registered** for a total outage of
      both endpoints.
- [ ] **`npm run ci:quick` run on the GitHub Actions self-hosted runner** — the
      local Windows workstation used for this task cannot run it directly
      (`npm` resolves its `bash` step through WSL, which is unavailable here,
      and `python3` is not installed). Pending the GHA run on the PR.
- [ ] **Browser verification (below)** — not attempted in this environment (no
      browser automation, no `.env.local`, `npm run dev` not started). A human
      with database and browser access must execute the eight scenarios below
      before merge, per the repository's UI-change verification rule.

## Browser verification checklist (to be executed by a human before merge)

Run `PORT=3004 npm run dev` against a database that has migration 510 applied
and at least one active project, one project manager account, and one Fleet
oversight override grant, with `CRON_SECRET` set so the two cron endpoints can
be invoked manually with `curl -H "Authorization: Bearer $CRON_SECRET"` (do
**not** install the crontab entries for this — invoke the endpoints directly,
once, to produce test incidents). Do not send real WhatsApp/email notifications
to a shared distribution list during this pass — use test accounts.

1. **PM scope.** Sign in as a project manager with at least one open incident on
   their own project and at least one on a different project (or projectless).
   Confirm `/fleet/incidents` shows only the owned-project incident — the other
   PM's incident and any projectless incident are absent from both the list and
   direct-ID lookups.
2. **Oversight scope.** Sign in as a user with an active
   `fleet_operational_oversight_members` row (or `admin`/`super_admin`).
   Confirm the same queue now shows cross-project incidents and any projectless
   incident.
3. **Filters and deep links.** From the Fleet Dashboard/Map attention list,
   click "View incidents"/"Incidents" on a `late`/`wrong_site`/
   `evidence_mismatch`/`left_early` row; confirm `/fleet/incidents` opens
   pre-filtered by `incidentType`/`projectId`/`staffId` and the URL reflects
   those filters (reload preserves them). Confirm summary-only statuses
   (`unassigned`, `unverifiable`, `vehicle_on_site_driver_unconfirmed`) show no
   such link.
4. **Lifecycle actions wait for the server.** Acknowledge, start review, add a
   comment, upload evidence, resolve, and dismiss an incident one at a time.
   Confirm each button shows a pending/disabled state and the UI only reflects
   success after its API call returns — never optimistically before that.
5. **Validation enforcement.** Attempt to resolve/dismiss without a note (400),
   without a required outcome (400), with an outcome requiring evidence but
   none attached (400, and confirm this never blocks *acknowledgement* of the
   same incident), and with a `duplicate` outcome pointing at a non-existent or
   self-referencing incident reference (400).
6. **Settings.** As a settings-authorized user, open the compact settings
   dialog from the queue: create a new effective-dated rule version and confirm
   the prior version now shows a closed `effective_to`; search for and add an
   active FibreFlow user to oversight, confirm they appear with a resolved
   display name (never a raw UUID); end a membership and confirm it requires a
   reason and moves to history rather than disappearing. Confirm a
   non-settings-authorized user never sees these controls.
7. **State distinguishability.** Verify, as visually distinct states: initial
   loading, an injected API error (showing stale data is still visible if
   previously loaded), zero incidents with no filters ("no incidents right
   now"), zero incidents with filters applied ("no incidents match"), a
   simulated notification-delivery failure (empty recipient set — visible via
   the incident detail's delivery summary, not just server logs), a cleared
   condition (`condition_cleared_at` set but incident still open), and an
   overdue/escalated incident (past its acknowledgement target, escalation
   level > 0).
8. **Dashboard/Map untouched.** Confirm the existing Fleet Dashboard and Map
   pages load and behave exactly as before this PR — no new tab, no replaced
   page, no change to their existing cards/markers beyond the deep links added
   in step 3.

Record screenshots or a trace for each scenario. Do not invoke production cron,
install scheduler entries, send real notifications, or apply migration 510
during this pass.

---

# PR 7 addendum — optional driver incident input

PR 7 (`feat/fleet-oversight-pr7-driver-input`) extends the PR 6 incident domain
with optional, driver-transparent access to a driver's own incidents at
`/my/fleet/incidents`, append-only explanations/evidence/concerns, and links to
existing Attendance corrections. Full behavioural reference:
`.claude/modules/fleet.md` → "Driver Incident Input (migration 511, PR 7)".

**Merging this code does nothing by itself.** Migration 511 is unapplied. **PR 7
requires no driver action** — monitoring, incident creation, escalation, and
manager review all continue exactly as PR 6 without a single driver response.

## What this PR adds

| Behaviour | Detail |
|---|---|
| Driver visibility | `/my/fleet/incidents` shows the authenticated driver's non-terminal incidents, terminal incidents closed in the last 90 days (configurable), and a `View history` control up to a configurable 12-month maximum. Server-side redaction — no coordinates, provider payloads, recipient data, internal notes, or other staff identities ever leave the API. |
| Manager request | `POST /api/fleet/incidents/[incidentId]/request-driver-input` — optional guidance, default respond-by = end of the driver's 2nd scheduled workday (SAST, Attendance-schedule-aware, Mon–Fri fallback), idempotent, supersedes rather than overwrites a prior open request. |
| Driver submissions | Free-text explanation, zero or more evidence files, one structured concern category, append-only, idempotent by `(incident_id, staff_id, idempotency_key)`. Never changes lifecycle, outcome, or acknowledgement. |
| Evidence | Reuses PR 6's VF Storage category and byte-signature MIME verification; upload-then-DB-insert transaction; PR 6's orphan-cleanup path covers a post-upload DB failure. No delete route. |
| Visibility classes | `internal` / `shared_with_driver` / `driver_submitted` on evidence and actions; every existing and future manager-authored row defaults to `internal`. |
| Attendance linking | Maps incident staff/work-date to an **existing** Attendance required-day exception only — never creates a generic correction. Fleet stores a reference and displays Attendance's canonical state; Attendance stays the source of truth. |
| Notifications | `fleet.driver_input_requested`, `fleet.driver_response_received` — driver notified only after a manager's request, never on incident open. |
| Manager queue | Driver-submitted content renders in the existing PR 6 evidence/action timeline with a visibility badge (commit `caf1d18a9`). Filtering the queue by driver-input/correction state is **not implemented** — do not assume it exists. |

## Deployment sequence (not part of this PR — record approval for each step)

1. **Approve and apply migration 511**
   (`scripts/migrations/sql/511_fleet_incident_driver_input.sql`) against the
   shared database. Confirm readback:
   `SELECT filename FROM schema_migrations WHERE filename = '511_fleet_incident_driver_input.sql'`.
2. **Re-verify the next free migration number before any further Fleet
   migration.** This PR's number moved 490 → 496 → 499 → 503 while in
   flight, as master consumed intervening numbers for unrelated work — do not
   assume the integer after 503 is free without checking
   `scripts/migrations/sql/` first.
3. **No new cron entries.** PR 7 adds no scheduled job; existing PR 6 crons are
   unaffected.
4. **Verify** using the readback queries below before treating driver input as
   "live" in an environment.

### Post-install readback

```sql
-- Exactly one open settings version, seeded values as expected:
SELECT version, response_window_workdays, recent_window_days, history_window_days,
       enabled_concern_categories, evidence_allowed_mime_types, evidence_max_bytes
FROM fleet_incident_driver_input_settings WHERE effective_to IS NULL;

-- No requests/submissions/links exist yet (expected immediately after migration):
SELECT count(*) FROM fleet_incident_driver_input_requests;
SELECT count(*) FROM fleet_incident_driver_submissions;
SELECT count(*) FROM fleet_incident_attendance_correction_links;

-- Every existing PR 6 evidence/action row still defaults to internal:
SELECT visibility, count(*) FROM fleet_operational_incident_evidence GROUP BY visibility;
SELECT visibility, count(*) FROM fleet_operational_incident_actions GROUP BY visibility;
```

## Rollback

`scripts/migrations/sql/rollback_511_fleet_incident_driver_input.sql` drops the
four new tables and reverts the PR 6 evidence/action column additions. **This
deletes any driver-submitted explanations, evidence references, and correction
links captured since deployment — execute only with the same approval level as
the forward migration.**

## Verification already completed (this PR)

- Focused test suites pass — see the PR description / CI run for exact counts.
- `npm run agents:mirror` / `npm run agents:check` — mirrors regenerated and
  verified.
- `git diff --check` — no whitespace conflicts.
- `node scripts/check-migration-versions.mjs` — no reused migration numbers.
- Diff scanned for `TODO`/`PLACEHOLDER`/hardcoded personal email addresses —
  see the PR description for the exact scan command and result.
- `bash scripts/secret-scan.sh` — run with no bypasses.

## Outstanding gates (not completed by this PR)

- [ ] **Migration 511 applied** to the shared database.
- [ ] **`npm run ci:quick` run on the GitHub Actions self-hosted runner** — the
      local Windows workstation used for this task cannot run it directly (its
      `bash` step is unavailable on this box). Pending the GHA run on the PR.
- [ ] **Browser verification (below)** — not attempted in this environment (no
      `DATABASE_URL`, no browser automation available). A human with database
      and browser access must execute the scenarios below before merge, per
      the repository's UI-change verification rule.

## Browser verification checklist (to be executed by a human before merge)

Run `PORT=3004 npm run dev` against a database that has migrations 502 and 503
applied, at least one active project, one project manager account, one Fleet
oversight override grant, and at least one driver test account with a linked
`/my` session. Do not send real WhatsApp/email notifications to a shared
distribution list during this pass — use test accounts.

1. **Driver scope.** Sign in as a driver with at least one active incident.
   Confirm `/my/fleet/incidents` shows only that driver's incidents and the
   network response contains no coordinates, provider payloads, recipient
   data, internal notes, or other staff identities.
2. **IDOR check.** As a different driver, attempt to load the first driver's
   incident detail by ID directly. Confirm a 404, not a 403 or a partial
   record — indistinguishable from a genuinely missing incident.
3. **No incident-opened notification.** Confirm a newly opened incident
   produces no driver notification and is still visible in `/my` without one.
4. **Manager request.** As a PM/oversight user with edit permission, call
   `Request driver input` with optional guidance. Confirm exactly one driver
   notification is sent, the due-date copy is neutral, and re-requesting
   supersedes rather than duplicates the prior request.
5. **Response and follow-up.** As the driver, submit a voluntary response
   before any request, then a requested response, then an append-only
   follow-up. Confirm each appears in the manager's evidence/action timeline
   with the driver's explanation text visible and a `driver_submitted`
   visibility badge, and that a scoped manager receives a notification.
6. **Evidence retry.** Submit explanation text with a file that fails to
   upload (e.g. disallowed MIME). Confirm the text is still accepted and the
   file can be retried without re-entering or losing the explanation.
7. **Attendance correction.** Confirm `Correct attendance` appears only when
   an existing required-day exception is eligible, opens
   `/my/attendance/corrections/new` with incident context, and — after a
   successful Attendance submission — links the canonical adjustment without
   auto-closing the incident.
8. **Races and limits.** Confirm a response submitted as an incident closes is
   resolved by row-lock (first committed state wins), an expired request
   becomes read-only with neutral copy, the 90-day recent view and 12-month
   history limit behave as configured, and idempotent retry with the same key
   returns the original record rather than creating a duplicate.
9. **Regression.** Confirm the existing `/my` hub, Attendance correction flow,
   Fleet review queue, Dashboard, and Map are all unaffected.
10. **No driver action required.** Confirm monitoring, incident creation, and
    manager workflows all function with zero driver responses.

Record screenshots or a trace for each scenario. Do not apply migration 511,
send production notifications, or deploy during this pass.
