# Velocity GHL review export runbook

## Purpose and safety boundary

This runbook operates the FibreFlow-to-GoHighLevel (GHL) Velocity installation-review export. FibreFlow discovers eligible delivery records, persists consent and export ledgers, and uses a transient tag handshake. GHL owns WhatsApp delivery, replies, assignment, and review-request messages.

Do not apply migration 478, publish a workflow, install the scheduler, enable automation or pilot mode, or test with any contact without the separately named approval. Never import a CSV for this flow. Never clear GHL DND/STOP state or overwrite authoritative contact data. Workflow acknowledgement, WhatsApp delivery, and customer response are three separate states.

### Current position (2026-08-03 SAST)

Several gates in this runbook are already open. Read this before assuming the system is inert.

| Gate | State |
| --- | --- |
| Migration 478 | **Applied** 2026-08-02 21:19 SAST to the shared dev/production database |
| Deployment | **dev and production both on `d288a14c9`** — production deployed 08:36 SAST with `--force`, approved by Hein |
| `velocity_review_control` | **`automation_enabled=TRUE`, `go_live_date=2026-08-01`**, set 07:54 SAST, approved by Hein after per-date volume disclosure |
| Ledgers | runs `0`, candidates `0`, exports `0` — nothing has ever run |
| GHL credentials | **0 of 8 set** on dev and production |
| Scheduler | not installed |
| GHL workflows | all three **Draft**, 0 enrolled |

**The eight environment variables are the last gate, not a configuration step.** Everything upstream
of them is already open, so writing them is the go-live moment. `loadVelocityReviewGhlConfig` throws
in `defaultDependencies` before the run lock is taken, so a live request today creates no run row and
cannot advance the watermark — that is the only thing currently preventing a send.

**Publish the GHL workflows before writing credentials, never after.** `velocity_review_exports`
carries a permanent `UNIQUE (dr_number, phone_e164)` and the row is inserted in state `ready` at
export creation, before the tag handshake, with `ON CONFLICT DO NOTHING`. A run against Draft
workflows would upsert every contact, apply `velocity-review-ready`, and burn the permanent ledger
row while no message is ever sent — permanently barring those customers from re-contact for that DR
without a manual database edit.

**Discovery currently runs on four of six sources.** `drops_installed` and `stock_installed` cannot
contribute: `drops.installed_at` is NULL in all 180,274 rows and `installation_date` is set in 2 rows
(both 2025-11-17), while `stock_serials.installed_date` stops at 2026-06-17. Candidates come only
from `dr_submitted`, `oes_activated`, `pp_activated` and `olt_mismatch_created`. This is a coverage
gap, not an over-contact risk, but do not read a per-source zero as a query defect.

## GHL location and objects

Before every change, use the GHL account switcher and confirm the visible sub-account is **Velocity Fibre** in Gqeberha, Eastern Cape. Do not rely on a remembered location identifier.

Generated GHL identifiers are stored only in deployment environment configuration; they must not appear in source, tickets, screenshots, logs, or this runbook.

### Custom fields

All are Contact fields in `Additional Info`:

| Field | Type |
| --- | --- |
| `velocity_dr_number` | Single line |
| `velocity_dr_event_date` | Date picker |
| `velocity_dr_sources` | Single line |
| `velocity_review_export_key` | Single line |

### Tags

- `velocity-review-ready`
- `velocity-review-enrolled`
- `velocity-review-happy-connected`
- `velocity-review-installation-issue`
- `velocity-review-not-connected`
- `velocity-review-suppress`

Plus `issue-resolved`, which gates the post-resolution review ask.

**Verify a tag exists by searching, never by reading the paginated list.** On 2026-08-03 the
unfiltered Tags settings list displayed only three of the six tags and reported a total of 24;
searching `velocity-review` returned all six (`1 - 6 of 6`). The unfiltered list silently omits rows
and its total is unreliable, so reading it will produce false "tag missing" conclusions.

### Pipelines

| Pipeline | Stages |
| --- | --- |
| `Service Issues` | New Issue, Diagnosing, Awaiting ISP / Network, Site Visit Scheduled, **Resolved** |

Moving an opportunity into `Resolved` is what applies `issue-resolved`. See the
`Velocity - Service Issue Resolved - tag` workflow below and the manual step it depends on.

### Smart Lists

Smart Lists are live views, not import destinations:

| Smart List | Required filter |
| --- | --- |
| `Velocity - Happy & Connected` | Tag is `velocity-review-happy-connected` |
| `Velocity - Installation Issue` | Tag is `velocity-review-installation-issue` |
| `Velocity - Not Connected` | Tag is `velocity-review-not-connected` |

### WhatsApp templates

`velocity_experience_check_v2` uses category Utility, language English (US), no header, and body:

> Hi {{1}}, it's Velo from Velocity Fibre. Our team recently completed the fibre installation at your property. How did the installation go, and is your fibre connection working?

Use `there` as the sample and as FibreFlow's value for `{{1}}` when first name is missing. Quick replies, in order:

1. `Happy & connected`
2. `Installation issue`
3. `Not connected`

The review request action uses the separately approved active template `velocity_review_request_v1`.

### Workflow: `Velocity - Installation Experience - Velo`

Keep this workflow **Draft** outside a separately approved internal-test publication window and an independently approved production publication. Its configuration may be completed and verified while Draft; neither template activation nor a saved Draft is authorization to publish, test, enroll a contact, or send a message.

1. Contact Tag trigger: tag added `velocity-review-ready`; allow multiple entries.
2. Add `velocity-review-enrolled`.
3. Remove `velocity-review-ready`.
4. Send active WhatsApp template `velocity_experience_check_v2` with Contact → First Name mapped to `{{1}}`.
5. Branch on the three quick replies.
6. **Happy & connected:** add `velocity-review-happy-connected`; remove `velocity-review-suppress`, `velocity-review-installation-issue`, and `velocity-review-not-connected`; send `velocity_review_request_v1`.
7. **Installation issue:** add `velocity-review-suppress` and `velocity-review-installation-issue`; assign the conversation to Chantall; notify Chantall immediately in GHL with Conversation redirect. Do not send a review request.
8. **Not connected:** add `velocity-review-suppress` and `velocity-review-not-connected`; assign the conversation to Chantall; notify Chantall immediately in GHL with Conversation redirect. Do not send a review request.
9. **Unmatched reply:** end without a review request and leave the conversation visible for manual GHL triage.
10. **Undelivered** and **Time Out:** end without a review request.

### Workflow: `Velocity - Review Ask - Post Resolution`

Keep this workflow **Draft** outside a separately approved internal-test publication window and an independently approved production publication. Its Contact Tag trigger is tag added `issue-resolved`. It must send the approved review request only after the issue is resolved and must not run while `velocity-review-suppress` remains.

`issue-resolved` is applied by exactly one automation — `Velocity - Service Issue Resolved - tag`
below — driven by Chantall moving the opportunity to `Resolved`. No other workflow may apply it, and
nothing may apply it on a timer or in bulk.

### Workflow: `Velocity - Service Issue Resolved - tag`

Keep this workflow **Draft** under the same conditions as the other two. It is the bridge between a
reported problem and the post-resolution review ask:

1. Pipeline Stage Changed trigger: pipeline is `Service Issues`, stage is `Resolved`.
2. Add `issue-resolved`.
3. END.

**This workflow is the reason a review ask is not automatic.** It fires only on a pipeline stage
move, which is a deliberate human judgement that the issue is genuinely fixed. Two consequences that
must be honoured:

- **Nothing may move opportunities into `Resolved` in bulk or automatically.** A bulk stage move
  would apply `issue-resolved` to every affected contact at once and send review requests to
  customers whose problems are still open. Treat the `Resolved` stage as a one-at-a-time human action.
- **There is a manual step with no system prompt behind it.** Neither issue branch of
  `Velocity - Installation Experience - Velo` contains a Create Opportunity action, so nothing places
  a contact into the `Service Issues` pipeline. Chantall must create the opportunity herself when she
  receives the GHL notification, then work it to `Resolved`. If she does not, the customer is tagged,
  assigned and suppressed, but never receives a follow-up review ask. Brief her on this explicitly
  before go-live, or add a Create Opportunity action to both issue branches under separate approval.

## Configuration snapshot (2026-08-01 SAST, re-verified read-only 2026-08-03)

| Object | State | Evidence / remaining gate |
| --- | --- | --- |
| Four custom fields | CREATED | Read back in Velocity custom fields with the types above; identifiers require approved deployment configuration. |
| Six tags | CREATED | Confirmed 2026-08-03 by **searching** `velocity-review` in Velocity tag settings (`1 - 6 of 6`). The unfiltered list showed only three — do not use it. Audit Logs record all six created 2026-08-01 17:09–17:11 SAST by Hein Van Vuuren, with no deletion entries. |
| Three Smart Lists | CREATED | Read back with one corresponding tag filter each; all three re-confirmed present 2026-08-03. |
| `Service Issues` pipeline | CREATED | Read back 2026-08-03 with the five stages above, 0 opportunities in every stage. Created 2026-08-01 12:06 AM SAST. |
| `velocity_experience_check_v2` | ACTIVE | Read back as Active, last edited 2026-08-01 06:12 PM SAST. Exact body, `there` sample, Contact → First Name mapping for `{{1}}`, and ordered quick replies were read back. No separate template-approval timestamp was visible. Active status is not publication or send approval. |
| `Velocity - Installation Experience - Velo` | CONFIGURED / VERIFIED Draft | Created in Velocity Review System and saved. A hard-reload readback confirmed it remained Draft, Save was disabled with Saved displayed, and Allow re-entry was ON. The persisted graph uses the `velocity-review-ready` tag trigger; adds `velocity-review-enrolled`; removes `velocity-review-ready`; sends active `velocity_experience_check_v2` using Contact → First Name; branches on the three quick replies; ends Undelivered and Time Out; and applies the documented happy, installation-issue, and not-connected outcomes. No publication, test, enrollment, contact change, or send occurred. |
| `Velocity - Review Ask - Post Resolution` | CONFIGURED / VERIFIED Draft | A hard-reload readback confirmed the `issue-resolved` trigger and a `No suppression` If/Else branch where Contact Tags does not include `velocity-review-suppress`. That branch reaches the existing active `velocity_review_request_v1` WhatsApp action and then END; the None/suppression-present branch reaches END without WhatsApp. Save and Undo were disabled after reload, proving the Draft state was persisted with no unsaved edits. Re-confirmed unchanged 2026-08-03. |
| `Velocity - Service Issue Resolved - tag` | CONFIGURED / VERIFIED Draft | Read back 2026-08-03: Pipeline Stage Changed trigger on `Service Issues` / `Resolved`, single `Add tag: issue-resolved` action, then END. Draft with Save disabled and Saved displayed. **Was absent from this runbook until 2026-08-03** — the earlier snapshot documented only two workflows. |
| All six WhatsApp templates | ACTIVE | Read back 2026-08-03: `velocity_experience_check_v1`, `velocity_experience_check_previous_install_v1`, `velocity_sorry_feedback_v1`, `velocity_review_request_v1`, `velocity_review_reminder_v1`, `velocity_experience_check_v2`. Note `velocity_review_request_v1` and `velocity_review_reminder_v1` are category **Marketing**, not Utility, and are therefore subject to Meta marketing-message limits and opt-out handling. |
| Enrollment | NONE | All three workflows show 0 total enrolled and 0 active enrolled. The location holds 6 contacts, all `(Example)` demo records plus a WhatsApp Business entry — no real customer has been exported. |

No workflow was published, tested, or enrolled during the latest verification. No contact or tag was changed, and no message was sent.

The 2026-08-03 re-verification was read-only throughout: navigation, snapshots, one tag search, one
pipeline-selector change and two canvas fit-to-screen clicks. No workflow was saved (`Ctrl+S` was
never pressed), no publish toggle was touched, and every workflow still reported Saved with Undo
disabled afterwards.

## Required deployment environment variables

Names only; values belong in the approved deployment environment:

```text
DATABASE_URL
DATABASE_URL_MIGRATIONS
CRON_SECRET
VELOCITY_GHL_PRIVATE_INTEGRATION_TOKEN
VELOCITY_GHL_LOCATION_ID
VELOCITY_GHL_FIELD_DR_NUMBER_ID
VELOCITY_GHL_FIELD_EVENT_DATE_ID
VELOCITY_GHL_FIELD_SOURCES_ID
VELOCITY_GHL_FIELD_EXPORT_KEY_ID
VELOCITY_REVIEW_PHONE_HMAC_SECRET
VELOCITY_REVIEW_SUMMARY_TO
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
```

`VELOCITY_REVIEW_SUMMARY_TO` must resolve to Chantall, Hein, and Michael. Verify the three intended recipients by name with Hein immediately before activation; do not copy addresses into tracked evidence.

## Read-only checks

### Migration preflight

This is read-only. It does not authorize the migration:

```bash
PGPASSWORD="$PGPASSWORD" psql "$DATABASE_URL" \
  -f scripts/migrations/sql/preflight_478_velocity_review_export.sql
```

Require migration 469, the consent table, and no conflicting Velocity-review rows. Redact connection details and any row-level identifiers from evidence. Applying migration 478 to the shared dev/production database requires explicit approval naming migration 478.

### API dry run

Use an approved date placeholder and the environment-held secret:

```bash
curl -sS -X POST https://dev.fibreflow.app/api/cron/velocity-review-export \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  --data '{"dryRun":true,"targetDate":"<YYYY-MM-DD>"}'
```

The response may contain dates and aggregate counts only. Confirm that no GHL contact/tag write and no ledger write occurred.

## Approval-gated migration and control SQL

After fresh preflight and explicit shared-database approval:

```bash
npm run db:migrate
```

Read back migration 478 and the disabled singleton control row before continuing. Do not use the migration command as approval to deploy or activate.

### Supervised pilot

After approval names the pilot date and limit, set all pilot controls atomically while autonomous mode remains off:

```sql
BEGIN;
UPDATE velocity_review_control
SET automation_enabled = FALSE,
    go_live_date = NULL,
    pilot_enabled = TRUE,
    pilot_target_date = DATE '<APPROVED-PILOT-DATE>',
    pilot_limit = <APPROVED-LIMIT-1-TO-50>,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING automation_enabled, go_live_date, pilot_enabled,
          pilot_target_date, pilot_limit;
COMMIT;
```

Stop on a duplicate, wrong recipient, consent/DND breach, unexpected enrollment, delivery ambiguity, or failed assignment. Disable pilot mode after reconciliation.

### Autonomous go-live

Only after accepted pilot evidence and explicit approval of the first operational date:

```sql
BEGIN;
UPDATE velocity_review_control
SET automation_enabled = TRUE,
    go_live_date = DATE '<APPROVED-GO-LIVE-DATE>',
    pilot_enabled = FALSE,
    pilot_target_date = NULL,
    pilot_limit = NULL,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING automation_enabled, go_live_date, pilot_enabled,
          pilot_target_date, pilot_limit;
COMMIT;
```

Verify the returned row before scheduler installation.

## Internal-contact test procedure

There is no verified supported GHL Draft test button for this workflow set. Do not assume a Draft workflow can execute. Testing therefore requires this exact controlled sequence:

1. Confirm `velocity_experience_check_v2` remains Active; record its visible status and any approval timestamp if GHL displays one.
2. Obtain a separate named **internal-test publication approval** that identifies both workflows, the nominated internal contact(s), the permitted trigger-tag changes, and the test window. This approval is not production-publication approval.
3. Fully configure both workflows as Draft, reopen them, and verify every trigger, action, branch, template, multiple-entry setting, suppression gate, assignee, and notification target.
4. At the start of the approved window, publish both workflows temporarily. Apply trigger tags only to the nominated internal contact(s), and execute the tests below.
5. On completion or any failure, immediately unpublish both workflows and read back their Draft status.
6. Remove only the tags added by this test. Preserve all pre-existing tags, contact fields, DND/STOP state, and consent evidence.
7. Production publication requires a new, separate approval after test reconciliation; internal-test publication never carries forward.

Do not use a customer or merely assume a contact is internal.

### Branch checks during the approved window

For each test, first record the contact's existing name, tags, DND/STOP state, and custom fields. Confirm the upsert preserves them. Use a distinct test DR/export key per repeat-entry test.

1. Apply `velocity-review-ready`; confirm the workflow adds `velocity-review-enrolled` and removes `velocity-review-ready`.
2. Read the contact back through the GHL API and confirm the unchanged opaque export key plus `velocity-review-enrolled`. Record this as **workflow acknowledgement only**.
3. Separately inspect GHL conversation/message status for accepted, sent, delivered, failed, or replied. Do not infer delivery from the acknowledgement tag.
4. **Happy branch:** press `Happy & connected`; verify the happy tag, removal of all suppression/problem tags, and the approved review-request action.
5. **Installation issue branch:** press `Installation issue`; verify suppression and issue tags, Chantall assignment, immediate GHL notification, the Installation Issue Smart List, and no review request.
6. **Not connected branch:** press `Not connected`; verify suppression and not-connected tags, Chantall assignment, immediate GHL notification, the Not Connected Smart List, and no review request.
7. **Unmatched branch:** send a non-button reply; verify no review request and visibility for manual triage.
8. **Resolution path:** after Chantall resolves the internal test issue, have Chantall apply `issue-resolved`; verify the Draft post-resolution workflow removes or gates suppression as designed and sends the approved review request only once.
9. Verify repeat entry only after the first export's acknowledgement tag is cleared. Stop if any contact-level tag represents another in-flight export.
10. Reconcile candidate, consent evidence, contact upsert, acknowledgement, actual delivery, reply branch, assignment, and notification. Remove only test tags added by the procedure; preserve DND and consent history.

There is no summary-only API or test mode. A `dryRun:true` request returns aggregate HTTP data and sends no summary. Verify synthetic text/HTML rendering and redaction through the focused summary unit tests. Actual SMTP delivery and Chantall/Hein/Michael mailbox receipt are verified only during the separately approved supervised pilot: the approval must name the live pilot, and the received aggregate summary must be reconciled without phone, email, contact ID, or raw export key.

## Scheduler installation

Only after both workflows are published under activation approval and the control row readback is correct:

```bash
(
  set -eu
  umask 077

  velocity_cron_entry='0 9 * * * /home/velo/fibreflow-dev/scripts/cron-velocity-review-export.sh >> /home/velo/logs/velocity-review-export.log 2>&1'
  velocity_crontab_tmp="$(mktemp)"
  trap 'rm -f "$velocity_crontab_tmp"' EXIT

  crontab -l 2>/dev/null |
    awk -v entry="$velocity_cron_entry" '$0 != entry' > "$velocity_crontab_tmp"
  printf '%s\n' "$velocity_cron_entry" >> "$velocity_crontab_tmp"
  crontab "$velocity_crontab_tmp"

  velocity_cron_count="$(
    crontab -l |
      awk -v entry="$velocity_cron_entry" '
        $0 == entry { count++ }
        END { print count + 0 }
      '
  )"
  if [ "$velocity_cron_count" -ne 1 ]; then
    printf 'Velocity cron verification failed: expected 1 exact entry, found %s\n' \
      "$velocity_cron_count" >&2
    exit 1
  fi

  printf 'Verified exactly one Velocity cron entry:\n%s\n' "$velocity_cron_entry"
)
```

This replaces every existing exact copy of the desired Velocity entry while preserving unrelated crontab lines, installs the complete result from a private temporary file, and verifies exactly one match without printing unrelated entries that may contain sensitive values. Observe the next 09:00 SAST run and reconcile its aggregate summary; HTTP success alone is not acceptance.

## Pause and rollback

### Immediate pause

1. Unpublish `Velocity - Installation Experience - Velo` and `Velocity - Review Ask - Post Resolution` in GHL.
2. Disable autonomous and pilot execution without deleting ledgers:

```sql
UPDATE velocity_review_control
SET automation_enabled = FALSE,
    pilot_enabled = FALSE,
    pilot_target_date = NULL,
    pilot_limit = NULL,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING automation_enabled, pilot_enabled, pilot_target_date, pilot_limit;
```

3. Remove the single Velocity cron entry using an approved, reviewed crontab edit, then run `crontab -l`.
4. Leave run/candidate/export ledgers intact for reconciliation. Do not remove tags from live contacts in bulk.

### Migration rollback

Rollback removes the feature and requires explicit approval after evidence export and reconciliation:

```bash
npm run db:migrate -- rollback 478
```

The supported runner opens one transaction, executes `rollback_478_velocity_review_export.sql`, and commits only if every step succeeds; the SQL file deliberately has no top-level transaction control.

**The rollback is deliberately asymmetric.** It removes the feature, not the record of what the feature already did. Anything that is safety evidence survives, because destroying it would let a later re-apply contact people who have already been contacted.

| Object | Rollback | Why |
|---|---|---|
| `velocity_review_exports` | **kept** | The permanent `(dr_number, phone_e164)` ledger — the entire "never contact the same person about the same DR twice" guarantee. Dropping it and re-applying makes every previously contacted customer eligible again, silently. The forward file uses `CREATE TABLE IF NOT EXISTS`, so a re-apply adopts the surviving table. |
| `velocity_review_runs` | **kept** | `exports.first_run_id` references it, and it is the per-date audit trail. |
| `wa_subscriber_consent` | **untouched** | Status, timestamps, withdrawal evidence *and* `source` all survive. The two OneMap labels are no longer collapsed to `import` — that rewrite destroyed which consent event was captured, irreversibly, on a table shared with the WhatsApp stack. The widened `CHECK` vocabulary is left in place: widening is additive, and pre-478 writers still satisfy it. |
| `velocity_review_control` | **dropped** | Must go. It carries `automation_enabled` / `pilot_enabled`; keeping it would let a re-apply resume in whatever state an operator last set instead of the disabled-by-default the forward file recreates. |
| `velocity_review_candidates` | **dropped** | Per-run discovery rows, no safety value. |

In-flight exports are parked at `permanent_failure` with `error_code` prefixed `migration_rolled_back` (any existing diagnostic is kept, e.g. `migration_rolled_back:stale_transient_tag`). Without that they would hold `ux_velocity_review_one_phone_inflight` forever — permanently blocking those phones from any future DR, with no code left to advance them. The permanent uniqueness constraint still bars a repeat contact for the same DR.

> **Do not read a parked row as "never contacted".** `permanent_failure` here only means the rollback ended the attempt. Rows parked out of `trigger_requested` or `ack_cleanup_pending` had `READY_TAG` applied, so the GHL workflow had already fired and the customer very likely received the message. The rollback coarsens `state`; it does not touch the timestamps. To answer "was this person actually contacted?", use `upserted_at` (contact written), `trigger_requested_at` (tag added, workflow fired — assume messaged) and `workflow_acknowledged_at` (enrolment confirmed). Counting contacts from `state` alone will under-report.

Consequence to plan for: **a rollback followed by a re-apply resumes with history intact and automation disabled.** It is not a clean slate, by design. `tests/migrations/478_velocity_review_export.test.ts` exercises the full cycle and asserts the already-contacted pair is still rejected afterwards.
