# Meetings Auto-Sync Cron Job Setup

## Overview
Automated sync of Fireflies meeting transcripts to Neon database **daily at 8:00 PM SAST** (18:00 UTC).

The sync job sends email notifications to `ai@velocityfibre.co.za` after each run with success/failure status.

## Prerequisites
1. VPS server running (72.60.17.245)
2. `CRON_SECRET` environment variable configured in `/var/www/fibreflow/.env.production`
3. `FIREFLIES_API_KEY` environment variable configured in `/var/www/fibreflow/.env.production`

**⚠️ IMPORTANT**: `.env.production` on VPS is separate from `.env.local` in repo!
- Local development uses: `.env.local` (in repo, not committed)
- VPS production uses: `/var/www/fibreflow/.env.production` (on server, must be manually configured)

## Setup Instructions

### 1. Set Environment Variables

SSH into the VPS and add/verify these variables in `/var/www/fibreflow/.env.production`:

```bash
# SSH into VPS
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245

# Edit environment file
nano /var/www/fibreflow/.env.production
```

Add these lines (generate a strong random secret):
```bash
CRON_SECRET=your-secure-random-secret-here
FIREFLIES_API_KEY=your-fireflies-api-key-here
```

**Generate secure CRON_SECRET:**
```bash
openssl rand -base64 32
```

### 2. Install Cron Job

The cron job is **already installed** on the VPS. To verify or modify:

```bash
crontab -l | grep meetings
```

You should see:

```bash
# Sync Fireflies meetings at 8pm SAST (18:00 UTC)
0 18 * * * cd /var/www/fibreflow && /usr/bin/npx tsx scripts/cron/sync-meetings-fireflies.ts >> /var/log/meetings-sync.log 2>&1
```

### 3. Verify Cron Job

Check cron is scheduled:
```bash
crontab -l
```

Check log file exists:
```bash
touch /var/log/meetings-sync.log
chmod 644 /var/log/meetings-sync.log
```

### 4. Test the Script

Manual test from VPS:
```bash
ssh root@72.60.17.245
cd /var/www/fibreflow
npx tsx scripts/cron/sync-meetings-fireflies.ts
```

Expected output:
```
🚀 Starting Fireflies meetings sync cron job...
📅 Date: 2025-11-14T06:39:32.736Z
🔄 Syncing meetings from Fireflies...
✅ Successfully synced 50 meetings
📧 Sending email notification...
✅ Email notification sent (ID: ...)
```

An email will be sent to `ai@velocityfibre.co.za` with the sync results.

## Monitoring

### View Sync Logs
```bash
tail -f /var/log/meetings-sync.log
```

### Check Last Sync Time
```bash
ls -lh /var/log/meetings-sync.log
```

### Manual Sync (Ad-hoc)
Users can trigger manual sync from the Meetings dashboard "Sync from Fireflies" button.

## Troubleshooting

### Cron not running
```bash
# Check cron service status
systemctl status cron

# Restart cron service
systemctl restart cron
```

### 401 Unauthorized Error
- Verify `CRON_SECRET` matches between `.env.production` and crontab
- Check environment variable is loaded (restart PM2 after .env changes):
  ```bash
  pm2 restart fibreflow
  ```

### 500 Server Error - "FIREFLIES_API_KEY not configured"
**Most Common Issue**: API key exists in `.env.local` but missing from VPS `.env.production`

**Fix**:
```bash
# SSH and add missing API key
ssh root@72.60.17.245
nano /var/www/fibreflow/.env.production

# Add:
FIREFLIES_API_KEY=894886b5-b232-4319-95c7-1296782e9ea6

# Restart
pm2 restart fibreflow-prod

# Verify
curl -s "https://app.fibreflow.app/api/meetings?action=sync" -X POST
```

**Other Checks**:
- Review PM2 logs: `pm2 logs fibreflow-prod`
- Check Neon database connection
- Verify API key is valid on Fireflies.ai

### No meetings synced
- Verify Fireflies API key is valid
- Check Fireflies account has recent meetings
- Review API response in logs

## API Endpoint Details

**Endpoint:** `/api/meetings-sync-cron`
**Method:** `POST`
**Authentication:** Bearer token via `Authorization` header
**Rate Limit:** None (internal cron only)

**Security Features:**
- Protected by secret token
- Logs unauthorized attempts
- Only accepts POST requests
- Returns structured JSON responses

## Timezone Reference
- **SAST** (South Africa Standard Time) = UTC+2
- No daylight saving time adjustments needed
- Cron uses UTC times (always subtract 2 hours from SAST)

## File Locations

- **Cron Script:** `/scripts/cron/sync-meetings-fireflies.ts`
- **Service Logic:** `/src/services/fireflies/firefliesService.ts`
- **Environment Vars:** `/var/www/fibreflow/.env.production`
- **Cron Logs:** `/var/log/meetings-sync.log`
- **PM2 Logs:** `pm2 logs fibreflow-prod`

## Email Notifications

After each sync, an email is sent to the admin address (`ai@velocityfibre.co.za`) with:

**Success Email:**
- ✅ Number of meetings synced
- Timestamp of sync
- Link to meetings dashboard

**Failure Email:**
- ❌ Error details
- Troubleshooting steps
- Link to meetings dashboard

The email sender is `meetings@fibreflow.app` (requires Resend domain verification).

## Maintenance

### Restart After Code Changes
```bash
cd /var/www/fibreflow
git pull
npm run build
pm2 restart fibreflow
```

### Change Sync Time
Edit crontab and change the hour value:
```bash
crontab -e
# Current: 0 18 * * * (6pm UTC = 8pm SAST)
# For different time: 0 HH * * * (where HH = SAST_hour - 2)
```

### Disable Auto-Sync
```bash
crontab -e
# Comment out the lines with #
```
