# SharePoint Sync - Quick Reference

**Status**: ✅ Fully Working (as of Nov 12, 2025)

## What It Does
Syncs daily WA Monitor drop counts to SharePoint Excel file every night at 8pm SAST.

## Quick Links
- 📊 **SharePoint File**: [VF_Project_Tracker_Mohadin.xlsx](https://blitzfibre.sharepoint.com/:x:/s/Velocity_Manco/EYm7g0w6Y1dFgGB_m4YlBxgBeVJpoDXAYjdvK-ZfgHoOqA) → NeonDbase sheet
- 📈 **Dashboard**: https://app.fibreflow.app/wa-monitor
- 📖 **Full Documentation**: `/docs/wa-monitor/WA_MONITOR_SHAREPOINT_SYNC.md`

## Quick Commands

### Check if sync is running
```bash
ssh root@72.60.17.245
tail -50 /var/log/wa-monitor-sharepoint-sync.log
```

### Test sync manually
```bash
ssh root@72.60.17.245
cd /var/www/fibreflow && node scripts/sync-wa-monitor-sharepoint.js
```

### Check cron jobs
```bash
ssh root@72.60.17.245
crontab -l | grep sharepoint
```

### View environment variables
```bash
ssh root@72.60.17.245
grep SHAREPOINT /var/www/fibreflow/.env.production
```

## Schedule
- **Main Sync**: Daily at 8pm SAST (18:00 UTC)
- **Watchdog**: Daily at 8:30pm SAST (checks if sync completed)

## Email Notifications
Success/failure emails sent to:
- ai@velocityfibre.co.za

## Troubleshooting

### Problem: Not syncing
```bash
# 1. Check cron jobs exist
crontab -l | grep sharepoint

# 2. Check logs
tail -100 /var/log/wa-monitor-sharepoint-sync.log

# 3. Check environment variables
grep SHAREPOINT /var/www/fibreflow/.env.production
```

### Problem: Validation failed error
**Solution**: Missing environment variables. Add them:
```bash
nano /var/www/fibreflow/.env.production
# Add SharePoint variables (see full documentation)
pm2 restart fibreflow-prod
```

## Full Documentation
For complete setup instructions, configuration details, and troubleshooting:
👉 **See**: `/docs/wa-monitor/WA_MONITOR_SHAREPOINT_SYNC.md`

---

**Last Updated**: November 12, 2025
