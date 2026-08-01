# Velocity GHL review export runbook

## Purpose and safety boundary

This runbook operates the FibreFlow-to-GoHighLevel (GHL) Velocity installation-review export. FibreFlow discovers eligible delivery records, persists consent and export ledgers, and uses a transient tag handshake. GHL owns WhatsApp delivery, replies, assignment, and review-request messages.

Do not apply migration 472, publish a workflow, install the scheduler, enable automation or pilot mode, or test with any contact without the separately named approval. Never import a CSV for this flow. Never clear GHL DND/STOP state or overwrite authoritative contact data. Workflow acknowledgement, WhatsApp delivery, and customer response are three separate states.

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

Keep this workflow **Draft** outside a separately approved internal-test publication window and an independently approved production publication. Do not finish configuring it until Meta has approved the template and the named internal-test publication approval has been recorded.

1. Contact Tag trigger: tag added `velocity-review-ready`; allow multiple entries.
2. Add `velocity-review-enrolled`.
3. Remove `velocity-review-ready`.
4. Send WhatsApp template `velocity_experience_check_v2`.
5. Branch on the three quick replies.
6. **Happy & connected:** add `velocity-review-happy-connected`; remove `velocity-review-suppress`, `velocity-review-installation-issue`, and `velocity-review-not-connected`; send `velocity_review_request_v1`.
7. **Installation issue:** add `velocity-review-suppress` and `velocity-review-installation-issue`; assign the conversation to Chantall; notify Chantall immediately in GHL. Do not send a review request.
8. **Not connected:** add `velocity-review-suppress` and `velocity-review-not-connected`; assign the conversation to Chantall; notify Chantall immediately in GHL. Do not send a review request.
9. **Unmatched reply:** end without a review request and leave the conversation visible for manual GHL triage.

### Workflow: `Velocity - Review Ask - Post Resolution`

Keep this workflow **Draft** outside a separately approved internal-test publication window and an independently approved production publication. Its Contact Tag trigger is tag added `issue-resolved`. It must send the approved review request only after the issue is resolved and must not run while `velocity-review-suppress` remains. Chantall is the operator who explicitly applies `issue-resolved`; no other workflow should apply it.

## Configuration snapshot (2026-08-01 SAST)

| Object | State | Evidence / remaining gate |
| --- | --- | --- |
| Four custom fields | CREATED | Read back in Velocity custom fields with the types above; identifiers require approved deployment configuration. |
| Six tags | CREATED | Read back in Velocity tag settings. |
| Three Smart Lists | CREATED | Read back with one corresponding tag filter each. |
| `velocity_experience_check_v2` | SUBMITTED / Pending | Exact body, `there` sample, Contact → First Name mapping for `{{1}}`, and ordered quick replies were read back. The earlier disabled Create control was caused by the missing Contact → First Name association. Meta status: Pending. Approval date: none yet. |
| `Velocity - Installation Experience - Velo` | BLOCKED / not created | The normal WhatsApp workflow-action picker lists approved, mapped templates and omits the Pending `velocity_experience_check_v2`. Creation stopped before any incomplete workflow was created or saved. |
| `Velocity - Review Ask - Post Resolution` | EXISTING / Draft, incomplete | Readback confirmed the `issue-resolved` tag trigger and selected active `velocity_review_request_v1` WhatsApp action. The graph still routes directly to that action: the required `velocity-review-suppress` If/Else gate is absent. A correction attempt was cancelled before save because the normal builder did not expose a reliable `Includes` operator selection; do not publish or test this workflow until the exact gate is saved and read back. |

No workflow was created, saved, or published during the Pending-template follow-up. No contact was enrolled or changed, and no message was sent.

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
  -f scripts/migrations/sql/preflight_472_velocity_review_export.sql
```

Require migration 469, the consent table, and no conflicting Velocity-review rows. Redact connection details and any row-level identifiers from evidence. Applying migration 472 to the shared dev/production database requires explicit approval naming migration 472.

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

Read back migration 472 and the disabled singleton control row before continuing. Do not use the migration command as approval to deploy or activate.

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

1. Wait until Meta shows `velocity_experience_check_v2` as approved and record the approval date.
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
(crontab -l 2>/dev/null; \
  echo '0 9 * * * /home/velo/fibreflow-dev/scripts/cron-velocity-review-export.sh >> /home/velo/logs/velocity-review-export.log 2>&1') | crontab -
crontab -l
```

The readback must contain exactly one Velocity entry. Observe the next 09:00 SAST run and reconcile its aggregate summary; HTTP success alone is not acceptance.

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

Rollback is destructive to the Velocity run/candidate/export tables and requires explicit approval after evidence export and reconciliation:

```bash
npm run db:migrate -- rollback 472
```

The supported runner opens one transaction, executes `rollback_472_velocity_review_export.sql`, clears legacy migration tracking, and commits only if every step succeeds; the SQL file deliberately has no top-level transaction control. The guarded rollback reclassifies the two OneMap evidence-source labels to `import` before removing Velocity tables and migration tracking. It does **not** delete `wa_subscriber_consent` rows: granted and withdrawn status, audit timestamps, and withdrawal evidence must survive so a rollback cannot resurrect consent or make a withdrawn recipient eligible.
