# QContact Sync Background Job

🟢 WORKING: Production-ready automatic periodic sync for QContact integration

## Overview

The QContact sync job automatically synchronizes ticket data between FibreFlow and QContact on a regular schedule. It tracks all executions in the database for monitoring and debugging.

## Features

- ✅ Automatic bidirectional sync (QContact ↔ FibreFlow)
- ✅ Job execution tracking in database
- ✅ Comprehensive error handling
- ✅ Status tracking (success, failed, partial)
- ✅ Execution history and reporting
- ✅ Configurable sync options
- ✅ Security with optional CRON_SECRET

## Architecture

### Components

1. **Job Module** (`qcontactSync.ts`)
   - Core job execution logic
   - Database tracking
   - History retrieval functions

2. **API Route** (`/api/ticketing/cron/sync-qcontact`)
   - HTTP endpoint for triggering jobs
   - Authorization verification
   - Response formatting

3. **Database Table** (`sync_job_history`)
   - Tracks all job executions
   - Stores sync statistics
   - Error logging

## Deployment Options

### Option 1: Vercel Cron (Recommended for Vercel)

Add to your `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/ticketing/cron/sync-qcontact",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

**Schedules:**
- `0 * * * *` - Every hour
- `0 */6 * * *` - Every 6 hours (recommended)
- `0 0 * * *` - Daily at midnight
- `*/30 * * * *` - Every 30 minutes

### Option 2: External Cron Service

Use any external cron service (cron-job.org, EasyCron, etc.):

```bash
# Example: Call API every 6 hours
curl -X POST https://your-domain.com/api/ticketing/cron/sync-qcontact \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### Option 3: GitHub Actions

Create `.github/workflows/qcontact-sync.yml`:

```yaml
name: QContact Sync

on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:  # Allow manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger QContact Sync
        run: |
          curl -X POST ${{ secrets.APP_URL }}/api/ticketing/cron/sync-qcontact \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"
```

### Option 4: AWS CloudWatch Events

Use AWS EventBridge/CloudWatch to trigger the API endpoint on a schedule.

### Option 5: Manual Trigger

For testing or ad-hoc syncs:

```bash
curl -X POST http://localhost:3000/api/ticketing/cron/sync-qcontact \
  -H "Authorization: Bearer your-secret-here"
```

## Configuration

### Environment Variables

```bash
# Optional: Secret for cron job authentication
CRON_SECRET=your-random-secret-here

# QContact API credentials (required)
QCONTACT_API_URL=https://api.qcontact.com
QCONTACT_API_KEY=your-api-key
```

**Generating a secure CRON_SECRET:**

```bash
# Using openssl
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Security Best Practices

1. **Always set CRON_SECRET in production**
   - Prevents unauthorized job triggers
   - Use a long, random string
   - Store in environment variables, not code

2. **Use HTTPS in production**
   - Protects the secret in transit
   - Vercel provides HTTPS by default

3. **Monitor job executions**
   - Check `sync_job_history` table regularly
   - Set up alerts for failed jobs
   - Review partial failures

## Usage

### Programmatic Usage

```typescript
import { runSyncJob, getSyncJobHistory, getLastSyncJobRun } from '@/modules/ticketing/jobs/qcontactSync';

// Run a sync job
const result = await runSyncJob();
console.log('Job ID:', result.job_id);
console.log('Status:', result.status);
console.log('Duration:', result.duration_seconds, 'seconds');

// Run with custom options
const customResult = await runSyncJob({
  start_date: new Date('2024-01-01'),
  end_date: new Date('2024-01-31'),
});

// Get job history
const history = await getSyncJobHistory({ limit: 10 });
console.log('Recent jobs:', history.length);

// Get last job run
const lastRun = await getLastSyncJobRun();
if (lastRun) {
  console.log('Last sync:', lastRun.started_at);
  console.log('Status:', lastRun.status);
  console.log('Success rate:', lastRun.success_rate);
}
```

### API Usage

**Trigger sync job:**

```bash
POST /api/ticketing/cron/sync-qcontact
Authorization: Bearer YOUR_CRON_SECRET

Response:
{
  "success": true,
  "data": {
    "job_id": "uuid-here",
    "status": "success",
    "started_at": "2024-01-15T10:00:00Z",
    "completed_at": "2024-01-15T10:05:00Z",
    "duration_seconds": 300,
    "summary": {
      "total_processed": 70,
      "total_success": 65,
      "total_failed": 5,
      "success_rate": 0.93,
      "inbound": { ... },
      "outbound": { ... }
    }
  }
}
```

**Query job history (via database):**

```sql
-- Get recent job runs
SELECT
  id,
  started_at,
  status,
  total_processed,
  total_success,
  total_failed,
  success_rate,
  duration_seconds
FROM sync_job_history
ORDER BY started_at DESC
LIMIT 10;

-- Get failed jobs
SELECT * FROM sync_job_history
WHERE status = 'failed'
ORDER BY started_at DESC;

-- Get job statistics
SELECT
  status,
  COUNT(*) as count,
  AVG(duration_seconds) as avg_duration,
  AVG(success_rate) as avg_success_rate
FROM sync_job_history
WHERE started_at >= NOW() - INTERVAL '7 days'
GROUP BY status;
```

## Monitoring

### Database Queries

**Check last sync:**
```sql
SELECT * FROM sync_job_history
ORDER BY started_at DESC
LIMIT 1;
```

**Success rate (last 24 hours):**
```sql
SELECT
  COUNT(*) as total_jobs,
  COUNT(*) FILTER (WHERE status = 'success') as successful,
  COUNT(*) FILTER (WHERE status = 'failed') as failed,
  COUNT(*) FILTER (WHERE status = 'partial') as partial,
  AVG(success_rate) as avg_success_rate
FROM sync_job_history
WHERE started_at >= NOW() - INTERVAL '24 hours';
```

**Recent errors:**
```sql
SELECT
  started_at,
  error_code,
  error_message,
  duration_seconds
FROM sync_job_history
WHERE status = 'failed'
ORDER BY started_at DESC
LIMIT 5;
```

### Recommended Alerts

Set up monitoring alerts for:

1. **Job Failures**
   - Alert if job status = 'failed'
   - Check frequency: Every hour

2. **Low Success Rate**
   - Alert if success_rate < 0.8 (80%)
   - Check frequency: Every sync

3. **No Recent Syncs**
   - Alert if no job in last 12 hours
   - Indicates scheduler issue

4. **Long Duration**
   - Alert if duration_seconds > 600 (10 minutes)
   - May indicate performance issue

## Troubleshooting

### Job Not Running

1. **Check Vercel Cron Configuration**
   ```bash
   vercel env ls
   vercel crons ls
   ```

2. **Verify API Route is Accessible**
   ```bash
   curl -I https://your-domain.com/api/ticketing/cron/sync-qcontact
   ```

3. **Check Logs**
   - Vercel Dashboard → Logs
   - Search for "qcontactSyncJob"

### Job Failing

1. **Check Error in Database**
   ```sql
   SELECT error_message, error_code
   FROM sync_job_history
   WHERE status = 'failed'
   ORDER BY started_at DESC
   LIMIT 1;
   ```

2. **Verify QContact API Credentials**
   ```bash
   echo $QCONTACT_API_KEY
   ```

3. **Test Sync Manually**
   ```bash
   curl -X POST http://localhost:3000/api/ticketing/cron/sync-qcontact
   ```

### Partial Failures

Partial failures are normal (some tickets may fail validation, etc.). Investigate if:
- Success rate < 80%
- Same tickets failing repeatedly
- Specific error patterns

**Check failed tickets:**
```sql
SELECT
  sync_result->'errors' as errors
FROM sync_job_history
WHERE status = 'partial'
ORDER BY started_at DESC
LIMIT 1;
```

## Testing

### Unit Tests

```bash
npm test src/modules/ticketing/__tests__/jobs/qcontactSync.test.ts
```

### Integration Tests

```bash
npm test src/modules/ticketing/__tests__/api/cron-sync-qcontact.test.ts
```

### Manual Test

```bash
# Start development server
npm run dev

# Trigger sync job
curl -X POST http://localhost:3000/api/ticketing/cron/sync-qcontact

# Check results
psql $DATABASE_URL -c "SELECT * FROM sync_job_history ORDER BY started_at DESC LIMIT 1;"
```

## Performance

### Expected Performance

- **Small sync (< 50 tickets):** 1-2 minutes
- **Medium sync (50-200 tickets):** 2-5 minutes
- **Large sync (200+ tickets):** 5-10 minutes

### Optimization Tips

1. **Reduce Sync Frequency**
   - Every 6 hours is usually sufficient
   - Hourly sync may be overkill

2. **Use Date Filtering**
   - Only sync recent changes
   - Example: Last 24 hours only

3. **Monitor API Rate Limits**
   - QContact may have rate limits
   - Add delays if needed

## Migration

Run the migration to create the job history table:

```bash
psql $DATABASE_URL -f src/modules/ticketing/migrations/004_create_sync_job_history.sql
```

## Support

For issues or questions:
1. Check logs in `sync_job_history` table
2. Review QContact sync logs (`qcontact_sync_log` table)
3. Check application logs (Vercel Dashboard or local logs)
4. Contact DevOps team for infrastructure issues
