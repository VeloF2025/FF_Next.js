# Attendance workforce phase 1 rollout

Status on 2026-08-01: **code evidence only**. Migrations 475/476, database probes,
shadow execution, pilot enablement, cron installation, payroll enablement, DEV
deployment and production deployment have not been run. Each gate below needs a
new, recorded approval; completing one gate does not approve the next.

## Roles and evidence

- Hein approves every shared-database change, DEV pilot action and production
  deploy separately. HR signs the shadow reconciliation and parallel payroll.
- Use fixed Africa/Johannesburg dates. Save commands, exit codes, row counts and
  checksums without copying worker evidence into tickets.
- Controlled browser fixtures and unit tests are not PostgreSQL readback.
- Stop if the target, backup location, pilot crew IDs or approver is ambiguous.

## 1. Backup and migrations 475/476

After Hein approves the named DEV/shared database window, set these only in the
operator shell; never paste their values into logs:

```bash
export MIGRATION_DATABASE_URL='<approved direct PostgreSQL URL>'
export DATABASE_URL='<approved application-role PostgreSQL URL>'
export BACKUP_PATH='/approved/backup/attendance-before-474-475.dump'
pg_dump --format=custom --file="$BACKUP_PATH" "$MIGRATION_DATABASE_URL"
pg_restore --list "$BACKUP_PATH" >/dev/null
```

Confirm the pending set contains both files and no unreviewed migration. The
canonical runner applies every pending migration, so stop if the list is wider
than the approved set.

```bash
PGURL="$MIGRATION_DATABASE_URL"
psql "$PGURL" -Atc "SELECT filename FROM schema_migrations ORDER BY filename" > /tmp/attendance-applied.txt
comm -23 \
  <(find scripts/migrations/sql -maxdepth 1 -type f -name '*.sql' ! -name 'rollback_*' -printf '%f\n' | sort) \
  <(sort /tmp/attendance-applied.txt)
MIGRATION_URL="$MIGRATION_DATABASE_URL" bash scripts/run-pending-migrations.sh
psql "$PGURL" -Atc "SELECT filename FROM schema_migrations WHERE filename IN ('475_attendance_policy_workflow.sql','476_attendance_lock_hr_authority.sql') ORDER BY filename"
```

Expected readback is exactly the two filenames. Migration 475 seeds the fixed-hours
policy from 2026-08-03 SAST and aborts unless exactly one default overtime rule
exists. Restore is an incident action,
not routine rollback: stop writes, preserve evidence, and use the approved dump.
The additive down scripts are `rollback_476_attendance_lock_hr_authority.sql`
then `rollback_475_attendance_policy_workflow.sql`; do not run them after payroll
artifacts have been handed off without a separate data-retention decision.

## 2. PostgreSQL probe

With separate approval for the prepared test/DEV database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f scripts/probes/verify-attendance-policy-workflow.sql
```

The probe must show the active fixed-hours policy, all expected result columns,
and the controlled invalid-cap rejection. It wraps its negative insert in a
rollback. Archive the output with the database identity redacted.

## 3. Read-only shadow and reconciliation sign-off

```bash
mkdir -p evidence/attendance-shadow
DATABASE_URL="$DATABASE_URL" npx tsx scripts/audit/attendance-policy-shadow.ts \
  --from=2026-08-03 --to=2026-08-09 --format=json \
  > evidence/attendance-shadow/2026-08-03_2026-08-09.json
DATABASE_URL="$DATABASE_URL" npx tsx scripts/audit/attendance-policy-shadow.ts \
  --from=2026-08-03 --to=2026-08-09 --format=csv \
  > evidence/attendance-shadow/2026-08-03_2026-08-09.csv
sha256sum evidence/attendance-shadow/2026-08-03_2026-08-09.*
```

The command issues SELECT statements only and contains no rates or money. HR
must disposition every reason code, reconcile approved daily hours to weekly UI
and export rows, and record a signed clean/accepted variance decision.

## 4. Pilot crew and rollback flag

**STOP — implementation prerequisite:** the approved design requires an
allowlisted pilot flag that returns reads to legacy summaries and disables new
workflow commands. No such consuming flag exists in this Task 14 head. Do not
simulate enablement with an unused environment variable or broad database edit.

Before pilot approval, a follow-up change must provide and test:

```text
ATTENDANCE_WORKFORCE_PHASE1=off
ATTENDANCE_WORKFORCE_PHASE1=pilot:<approved-crew-id>
```

The operational rollback is the exact transition back to `off`, followed by
readback proving legacy summaries are served and new correction/decision/lock
commands reject safely while clock evidence and audit history remain intact.
Only then may Hein approve one named crew/site and authorised worker,
supervisor and HR walkthrough accounts.

## 5. Cron installation

After pilot acceptance and separate cron approval, save the current `velo`
crontab, review the four SAST-to-UTC times, and install only reviewed lines:

```bash
sudo -u velo crontab -l > /tmp/attendance-crontab.before
sudo -u velo crontab -e
```

The first three UTC schedules below implement the approved SAST worker times.
Digest and weekly clock times were not fixed in the design; record those two
five-field UTC schedules before editing and do not install placeholders.

```cron
15 6 * * 1-6 FF_ATTENDANCE_DEPLOY_ENV=dev /home/velo/fibreflow-dev/scripts/cron-attendance-notifications.sh morning
0 15 * * 1-5 FF_ATTENDANCE_DEPLOY_ENV=dev /home/velo/fibreflow-dev/scripts/cron-attendance-notifications.sh clockout
0 11 * * 6 FF_ATTENDANCE_DEPLOY_ENV=dev /home/velo/fibreflow-dev/scripts/cron-attendance-notifications.sh clockout
<approved-digest-UTC-schedule> FF_ATTENDANCE_DEPLOY_ENV=dev /home/velo/fibreflow-dev/scripts/cron-attendance-notifications.sh digest
<approved-weekly-UTC-schedule> FF_ATTENDANCE_DEPLOY_ENV=dev /home/velo/fibreflow-dev/scripts/cron-attendance-notifications.sh weekly
```

Read back with `sudo -u velo crontab -l`; delivery requires persisted dispatch
readback, not process exit alone. Restore with
`sudo -u velo crontab /tmp/attendance-crontab.before` after rollback approval.

## 6. Payroll and deploy gates

Payroll export stays unavailable until the pilot flag exists, shadow is signed,
and one clean parallel payroll proves daily = weekly = readiness = export hours.
HR then approves one locked week/version; compare repeated CSV/XLSX checksums and
record the immutable export row before handing any artifact to payroll.

After separate Hein approval, DEV deploy uses only:

```bash
bash scripts/deploy-local.sh dev
```

Verify health, commit identity, the pilot journeys and persisted readback. DEV
success does not approve production. Production is blocked 08:00–17:00 SAST on
weekdays and always needs Hein's fresh personal approval. In an allowed window:

```bash
bash scripts/deploy-local.sh production
```

Rollback first sets the tested flag to `off`, confirms command denial and legacy
reads, then uses the deployment script to promote the approved rollback commit.
Never delete raw entries, decision events, lock history or delivered exports.
