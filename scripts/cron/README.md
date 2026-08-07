# Cron Jobs

## Overview
This directory contains cron job scripts that run on the production server.

## Files
- `send-daily-reminders.ts` - Sends daily reminder emails to users with pending reminders
- `send-morning-standup.ts` - Sends a per-user morning standup digest of outstanding
  tickets (NOC + H&S + ManCo), Mon–Fri at 08:00 SAST
- `sync-qfield-status.sh` - Nightly wrapper for `../sync-qfield-status-to-ff.py`;
  mirrors QField civil-audit pole `Status` into `poles.field_status` for the Works
  QA PON-overview funnel (~00:45 SAST, on velo). See section below.

## Morning Standup Quick Reference

```bash
# Normal run (send to everyone with at least one open ticket)
npx tsx scripts/cron/send-morning-standup.ts

# Dry-run: log what would be sent, but do not send any emails
npx tsx scripts/cron/send-morning-standup.ts --dry-run

# Send only to a single recipient (useful for testing end-to-end)
npx tsx scripts/cron/send-morning-standup.ts --only=you@velocityfibre.com
```

VPS cron line (08:00 SAST, Monday–Friday):
```cron
0 8 * * 1-5 cd /var/www/fibreflow && /usr/bin/npx tsx scripts/cron/send-morning-standup.ts >> /var/log/morning-standup-cron.log 2>&1
```

---

# Works QA field_status sync (`sync-qfield-status.sh`)

Mirrors the QField civil-audit pole **`Status`** from each project's poles GPKG
(in QFieldCloud/MinIO) into **`poles.field_status`** (added by migration 424), so
the Works QA PON overview can show the field-**planted** stage between *planned*
(`sow_poles`) and *QA'd* (`pole_qa_photos`). Read-only against QFieldCloud
(downloads the GPKG via `mc`; no upload). Idempotent — only rows whose
`field_status` actually changes are written (`IS DISTINCT FROM`).

Runs **on velo** (needs the `qfieldcloud-minio-1` container + the shared Supabase
DB). The wrapper resolves `DATABASE_URL` from the deploy dir's `.env.local` →
`.env.production` → `.env`, so the cron line stays quoting-free.

**Projects** are configured in the `PROJECTS` dict at the top of
`scripts/sync-qfield-status-to-ff.py` (Mohadin, Etwatwa, Lawley, Mamelodi,
Thembisa POP1, Thembisa POP3). Each project's GPKG file / table / label column /
status column **differ and were verified against the live GPKG before adding** —
e.g. Thembisa POP 1's pole-label column is `label_1`, and POP 3's table is lower-case
(POP 3's label column is `label` — it lost the `_1` suffix when the layer was
republished on 2026-08-04). These values EXPIRE on republish; `require_column` fails
loudly rather than silently reading a string literal. The
`qf` id is the live `FT_<site>` QFieldCloud project the crews edit (NOT the stale
`*_Pole_Audit` copies).

**Status vocabulary:** `field_status` stores the **raw** GPKG string. The
planted-vs-removed classification lives ONLY in `pages/api/works-qa/poles.ts`
(`NOT_PLANTED_STATUSES` deny-list): two removal spellings (`Pole Removed/Canceled`
and `Pole Canceled / Removed`) plus a pre-plant marker (`To be Planted`) count as
not-planted; every other (incl. unknown) status defaults to planted.

```bash
# Manual run on velo (all projects)
ssh velo@100.96.203.105
/home/velo/fibreflow-dev/scripts/cron/sync-qfield-status.sh

# Single project / dry-run (read + report, no DB writes)
/home/velo/fibreflow-dev/scripts/cron/sync-qfield-status.sh --project Lawley --dry-run
```

velo crontab line (**00:45 SAST** — after the 23:15 OES→QField sync settles; velo
cron is system-local SAST, so write the SAST hour directly):
```cron
# Works QA field_status sync (QField civil-audit Status → poles.field_status) — 00:45 SAST
45 0 * * * /home/velo/fibreflow-dev/scripts/cron/sync-qfield-status.sh >> /home/velo/logs/sync-qfield-status.log 2>&1
```

Verify: `tail -50 /home/velo/logs/sync-qfield-status.log` (each project prints its
GPKG pole count, Status distribution, and `poles rows updated`).

---

# Daily Reminders Cron Job Setup

## Prerequisites

1. **Resend API Key**: Sign up at [resend.com](https://resend.com) and get your API key
2. **Environment Variables**: Add to `/var/www/fibreflow/.env.production`:
   ```bash
   RESEND_API_KEY=re_xxxxxxxxxxxxx
   DATABASE_URL=postgresql://...
   ```

3. **Database Migration**: Run the migration to create tables:
   ```bash
   psql $DATABASE_URL -f scripts/migrations/create-reminders-tables.sql
   ```

## VPS Cron Setup

### 1. Test the Script Manually
```bash
cd /var/www/fibreflow
npx tsx scripts/cron/send-daily-reminders.ts
```

### 2. Add to Crontab
```bash
crontab -e
```

Add this line (sends reminders at 8 AM daily):
```cron
0 8 * * * cd /var/www/fibreflow && /usr/bin/npx tsx scripts/cron/send-daily-reminders.ts >> /var/log/reminders-cron.log 2>&1
```

### 3. Verify Cron is Running
```bash
# List cron jobs
crontab -l

# Check cron logs
tail -f /var/log/reminders-cron.log
```

## Cron Schedule Examples

```cron
# Every day at 8 AM
0 8 * * * [command]

# Every day at 8 AM and 6 PM
0 8,18 * * * [command]

# Every weekday at 9 AM
0 9 * * 1-5 [command]

# Every hour
0 * * * * [command]
```

## Troubleshooting

### Emails Not Sending
1. Check Resend API key is valid:
   ```bash
   echo $RESEND_API_KEY
   ```

2. Check cron logs:
   ```bash
   tail -100 /var/log/reminders-cron.log
   ```

3. Test manually:
   ```bash
   cd /var/www/fibreflow
   npx tsx scripts/cron/send-daily-reminders.ts
   ```

### Database Connection Issues
1. Verify DATABASE_URL:
   ```bash
   psql $DATABASE_URL -c "SELECT COUNT(*) FROM reminders;"
   ```

2. Check if tables exist:
   ```bash
   psql $DATABASE_URL -c "\dt reminders*"
   ```

### Resend Rate Limits
- Free tier: 3,000 emails/month
- Pro tier: Starting at $20/month for 50,000 emails
- Script includes 100ms delay between emails to respect rate limits

## Monitoring

### Check Last Run
```bash
tail -20 /var/log/reminders-cron.log
```

### Check Cron Service Status
```bash
systemctl status cron
```

### Enable/Disable Cron Job
```bash
# Disable (comment out)
crontab -e
# Add # at the start of the line

# Re-enable (uncomment)
crontab -e
# Remove # from the start of the line
```

## Cost Estimation

With Resend free tier (3,000 emails/month):
- **100 users**: 3,000 days = 8.2 years free
- **500 users**: 6 months free
- **1,000 users**: 3 months free

Consider Pro plan for production with >100 daily users.

## Support

For issues, check:
1. Cron logs: `/var/log/reminders-cron.log`
2. System logs: `journalctl -u cron`
3. Resend dashboard: [resend.com/emails](https://resend.com/emails)
