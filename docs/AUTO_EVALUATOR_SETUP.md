# Auto-Evaluator Setup Instructions

**Purpose:** Automatically evaluate new drops from WA Monitor within 5 minutes and send feedback

**Status:** Ready for Testing

---

## 📋 Prerequisites

1. ✅ Database migration applied
2. ✅ Environment variables set
3. ✅ Cron job configured

---

## 🚀 Setup Steps

### Step 1: Apply Database Migration

```bash
# SSH to VPS
ssh root@72.60.17.245

# Run migration
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
  < /var/www/fibreflow/scripts/db/create-auto-processor-state-table.sql

# Verify table created
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
  -c "SELECT * FROM foto_auto_processor_state;"
```

### Step 2: Configure Environment Variables

Edit `.env.production` on the server:

```bash
# On VPS
nano /var/www/fibreflow/.env.production

# Add these lines:
AUTO_EVALUATOR_ENABLED=true
AUTO_EVALUATOR_DRY_RUN=false  # Set to false for live mode
AUTO_EVALUATOR_SEND_FEEDBACK=false  # Human approval required (safer)
AUTO_EVALUATOR_API_KEY=your-secret-key-here  # Optional security
USE_WHATSAPP_FEEDBACK=true  # Enable WhatsApp sending (for manual feedback)
```

**Note:** `AUTO_EVALUATOR_SEND_FEEDBACK=false` means evaluations are automatic, but feedback requires human approval via UI.

### Step 3: Deploy Code

```bash
# From local machine
git add .
git commit -m "feat: Add auto-evaluator for WA Monitor drops"
git push origin master

# On VPS
ssh root@72.60.17.245
cd /var/www/fibreflow
git pull
npm ci
npm run build
pm2 restart fibreflow-prod
```

### Step 4: Test Manually First

```bash
# Test the endpoint manually (dry run)
curl -X POST https://app.fibreflow.app/api/foto/auto-process \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key-here"

# Check response - should show drops found but not actually process (dry run)
```

### Step 5: Setup Cron Job

```bash
# On VPS
chmod +x /var/www/fibreflow/scripts/auto-evaluator-cron.sh

# Add to crontab
crontab -e

# Add this line (runs every 5 minutes)
*/5 * * * * /var/www/fibreflow/scripts/auto-evaluator-cron.sh

# Or use PM2 (alternative)
pm2 start /var/www/fibreflow/scripts/auto-evaluator-cron.sh \
  --name auto-evaluator \
  --cron "*/5 * * * *" \
  --no-autorestart
```

### Step 6: Monitor Logs

```bash
# Watch auto-evaluator logs
tail -f /var/log/fibreflow/auto-evaluator.log

# Watch PM2 logs
pm2 logs fibreflow-prod --lines 100 | grep AUTO

# Check processing stats
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
  -c "SELECT * FROM foto_auto_processor_state;"
```

### Step 7: Enable Live Mode

Once testing is complete:

```bash
# Remove dry run mode
nano /var/www/fibreflow/.env.production
# Change: AUTO_EVALUATOR_DRY_RUN=false

# Restart
pm2 restart fibreflow-prod
```

---

## 🧪 Testing Checklist

### Manual Test:

1. ✅ Find a recent drop in wa-monitor that hasn't been evaluated
2. ✅ Call auto-process endpoint manually
3. ✅ Check if evaluation was created
4. ✅ Verify feedback was sent (or would be sent in dry run)

### Automated Test:

1. ✅ Submit a test drop to WhatsApp
2. ✅ Wait 5 minutes for cron
3. ✅ Check if auto-evaluated
4. ✅ Verify WhatsApp feedback received

### Monitoring:

```bash
# Check recent evaluations
curl https://app.fibreflow.app/api/foto/auto-process \
  -H "x-api-key: your-secret-key-here" \
  | jq '.stats'

# Database check
psql "postgresql://..." \
  -c "SELECT dr_number, created_at FROM foto_ai_reviews
      WHERE created_at > NOW() - INTERVAL '1 hour'
      ORDER BY created_at DESC;"
```

---

## 🔒 Safety Features

1. **Dry Run Mode:** Test without sending actual feedback
2. **Rate Limiting:** Max 10 drops per run, 3 concurrent evaluations
3. **Duplicate Prevention:** Won't re-evaluate existing drops
4. **24-Hour Window:** Only processes recent drops
5. **Manual Override:** Humans can always re-evaluate

---

## 🚨 Troubleshooting

### No drops being processed:
```bash
# Check if new drops exist
psql "postgresql://..." -c "
  SELECT drop_number, created_at
  FROM qa_photo_reviews
  WHERE created_at > NOW() - INTERVAL '24 hours'
  ORDER BY created_at DESC
  LIMIT 10;"

# Check if already evaluated
psql "postgresql://..." -c "
  SELECT dr_number FROM foto_ai_reviews
  WHERE dr_number IN (SELECT drop_number FROM qa_photo_reviews);"
```

### Photos not found:
```bash
# Check BOSS API
curl http://100.96.203.105:8001/api/photos | jq '.drs[0]'

# Test specific DR
curl http://100.96.203.105:8001/api/photos | jq '.drs[] | select(.dr_number=="DR1730550")'
```

### WhatsApp not sending:
```bash
# Check WhatsApp bridge
systemctl status whatsapp-bridge-prod

# Restart if needed
systemctl restart whatsapp-bridge-prod
```

### Disable auto-evaluator:
```bash
# Quick disable
nano /var/www/fibreflow/.env.production
# Set: AUTO_EVALUATOR_ENABLED=false
pm2 restart fibreflow-prod

# Or remove cron
crontab -e
# Comment out the auto-evaluator line
```

---

## 📊 Performance Expectations

- **Processing Time:** ~30-60 seconds per drop
- **Feedback Delay:** 5-10 minutes from submission
- **Success Rate:** 95%+ (when photos available)
- **Cost:** ~$0.10 per evaluation

---

## 📈 Monitoring Dashboard

View auto-evaluation stats at:
- WA Monitor: https://app.fibreflow.app/wa-monitor
- Foto Review: https://app.fibreflow.app/foto-review

Future enhancement: Add dedicated auto-evaluation stats card to dashboard

---

**Support:** Contact Louis if issues arise