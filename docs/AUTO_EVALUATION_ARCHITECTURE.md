# Auto-Evaluation Architecture for WA Monitor Drops

**Date:** 2025-12-24
**Status:** Design Document
**Purpose:** Automatically evaluate and send feedback for new drops from wa-monitor

---

## 📋 Current State Analysis

### Where Drop Numbers Come From

**Two Parallel Systems:**

1. **WA Monitor System** (`qa_photo_reviews` table)
   - Source: WhatsApp groups (Lawley, Mohadin, Mamelodi, Velo Test)
   - Python service on VPS: `/opt/wa-monitor/prod/realtime_drop_monitor.py`
   - Monitors WhatsApp messages → Extracts DR numbers → Stores in database
   - Table: `qa_photo_reviews`
   - Dashboard: https://app.fibreflow.app/wa-monitor

2. **Foto Review System** (BOSS VPS API)
   - Source: 1Map GIS → BOSS VPS scraper → FibreFlow
   - Photos stored on: 100.96.203.105:8001
   - API: `GET /api/photos` (lists all DRs with photos)
   - API: `GET /api/photo/{dr}/{filename}` (serve photo)
   - Dashboard: https://app.fibreflow.app/foto-review

### Current Flow (Manual)

```
1. Field technician submits DR via WhatsApp
     ↓
2. WA Monitor Python service captures message
     ↓
3. Stored in qa_photo_reviews table
     ↓
4. Human agent goes to /wa-monitor dashboard
     ↓
5. Manually reviews photos, marks incorrect steps
     ↓
6. Clicks "Send Feedback" → WhatsApp message sent
```

**Problem:** Manual process, slow feedback loop

---

## 🎯 Desired Automated Flow

```
1. Field technician submits DR via WhatsApp
     ↓
2. WA Monitor Python service captures message
     ↓
3. Stored in qa_photo_reviews table
     ↓
4. 🤖 AUTO-DETECT: New drop detected (polling/webhook)
     ↓
5. 🤖 AUTO-FETCH: Fetch photos from BOSS VPS API
     ↓
6. 🤖 AUTO-EVALUATE: Run AI evaluation (10x fast batch)
     ↓
7. 🤖 AUTO-FEEDBACK: Send results to WhatsApp @mention
     ↓
8. ✅ Human agent reviews results in dashboard (optional override)
```

**Benefit:** Instant AI feedback, human oversight for edge cases

---

## 🏗️ Architecture Options

### Option A: Database Trigger (PostgreSQL)

**How It Works:**
```sql
CREATE TRIGGER auto_evaluate_new_drop
  AFTER INSERT ON qa_photo_reviews
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_drop();
```

**Pros:**
- ✅ Real-time (instant detection)
- ✅ No polling overhead
- ✅ Event-driven architecture

**Cons:**
- ❌ Requires PostgreSQL LISTEN/NOTIFY setup
- ❌ Needs persistent Node.js listener process
- ❌ Complex error handling

**Verdict:** ⚠️ Too complex for initial implementation

---

### Option B: Polling Service (Cron Job) ✅ RECOMMENDED

**How It Works:**
```
Every 5 minutes:
  1. Query qa_photo_reviews WHERE created_at > last_check
  2. Find new drops (not yet evaluated)
  3. For each new drop:
     - Fetch photos from BOSS API
     - Run VLM evaluation
     - Send WhatsApp feedback
     - Mark as processed
```

**Pros:**
- ✅ Simple to implement
- ✅ Easy to debug
- ✅ Self-healing (retries on next run)
- ✅ No database changes needed
- ✅ Can use existing API endpoints

**Cons:**
- ⚠️ 5-minute delay (acceptable for field work)
- ⚠️ Need to track "last processed"

**Verdict:** ✅ **BEST FOR NOW** - Simple, reliable, maintainable

---

### Option C: Webhook from Python Service

**How It Works:**
```python
# In realtime_drop_monitor.py
def on_new_drop(drop_data):
    save_to_db(drop_data)
    # Call FibreFlow webhook
    requests.post('https://app.fibreflow.app/api/foto/auto-evaluate', {
        'dr_number': drop_data['drop_number']
    })
```

**Pros:**
- ✅ Real-time trigger
- ✅ No polling needed

**Cons:**
- ❌ Requires modifying Python service on VPS
- ❌ Tight coupling between systems
- ❌ Harder to debug failures

**Verdict:** ⚠️ Future enhancement (after Option B proven)

---

## 📐 Detailed Design: Option B (Polling Service)

### Components

```
┌─────────────────────────────────────────────────────────┐
│         1. Cron Job (PM2 or system crontab)             │
├─────────────────────────────────────────────────────────┤
│  Every 5 minutes:                                       │
│    curl -X POST https://app.fibreflow.app/api/foto/auto-process
│    OR                                                   │
│    PM2 process: node scripts/auto-evaluator.js         │
└─────────────────────────────────────────────────────────┘
            ↓
┌─────────────────────────────────────────────────────────┐
│    2. Auto-Process API Endpoint                         │
│    POST /api/foto/auto-process                          │
├─────────────────────────────────────────────────────────┤
│  1. Get last_processed_timestamp from database/file     │
│  2. Query new drops:                                    │
│       SELECT * FROM qa_photo_reviews                    │
│       WHERE created_at > last_processed_timestamp       │
│       AND feedback_sent = false                         │
│       ORDER BY created_at ASC                           │
│       LIMIT 10 (process in batches)                    │
│  3. For each drop: → callAutoEvaluator(drop)           │
│  4. Update last_processed_timestamp                     │
└─────────────────────────────────────────────────────────┘
            ↓
┌─────────────────────────────────────────────────────────┐
│    3. Auto-Evaluator Service                            │
│    src/modules/foto-review/services/autoEvaluator.ts   │
├─────────────────────────────────────────────────────────┤
│  async function autoEvaluateDrop(drNumber, project) {  │
│    // 1. Fetch photos from BOSS API                    │
│    const photos = await fetchDrPhotos(drNumber);       │
│                                                         │
│    // 2. Check if photos exist                         │
│    if (photos.length === 0) {                          │
│      console.log('No photos yet, skip');               │
│      return null; // Try again next run                │
│    }                                                    │
│                                                         │
│    // 3. Run VLM evaluation (existing code)            │
│    const evaluation = await executeVlmEvaluation(      │
│      drNumber, photos, QA_STEPS                        │
│    );                                                   │
│                                                         │
│    // 4. Save to database                              │
│    await saveEvaluation(evaluation);                   │
│                                                         │
│    // 5. Send WhatsApp feedback                        │
│    await sendWhatsAppFeedback(drNumber, evaluation);   │
│                                                         │
│    return evaluation;                                  │
│  }                                                      │
└─────────────────────────────────────────────────────────┘
            ↓
┌─────────────────────────────────────────────────────────┐
│    4. WhatsApp Feedback (Existing)                      │
│    POST /api/foto/feedback                              │
├─────────────────────────────────────────────────────────┤
│  - Formats evaluation as WhatsApp message               │
│  - Sends to correct group (Lawley, Mohadin, etc.)     │
│  - Includes @mention of submitter (if phone available) │
│  - Marks feedback_sent = true in database              │
└─────────────────────────────────────────────────────────┘
```

### Database Schema Addition

Add tracking table for auto-processor state:

```sql
CREATE TABLE IF NOT EXISTS foto_auto_processor_state (
  id SERIAL PRIMARY KEY,
  last_processed_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial row
INSERT INTO foto_auto_processor_state (id, last_processed_timestamp)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;
```

### Error Handling Strategy

```typescript
// Retry logic
const MAX_RETRIES = 3;
const RETRY_DELAY = 60000; // 1 minute

async function processDropWithRetry(drop, retryCount = 0) {
  try {
    return await autoEvaluateDrop(drop.drop_number, drop.project);
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.error(`Retry ${retryCount + 1}/${MAX_RETRIES} for ${drop.drop_number}`);
      await sleep(RETRY_DELAY);
      return processDropWithRetry(drop, retryCount + 1);
    }

    // Max retries exceeded - log and skip
    console.error(`Failed after ${MAX_RETRIES} retries: ${drop.drop_number}`, error);
    await logFailedEvaluation(drop.drop_number, error);
    return null;
  }
}
```

---

## 🔧 Implementation Plan

### Phase 1: Core Auto-Evaluator (Day 1)

**Files to Create:**
1. `src/modules/foto-review/services/autoEvaluator.ts` - Main auto-evaluation logic
2. `pages/api/foto/auto-process.ts` - API endpoint for cron job
3. `scripts/db/create-auto-processor-table.sql` - Database schema

**Files to Update:**
1. `src/modules/foto-review/services/fotoVlmService.ts` - Export helper functions
2. `src/modules/foto-review/services/fotoDbService.ts` - Add state management

**Testing:**
```bash
# Manual trigger (test without cron)
curl -X POST https://app.fibreflow.app/api/foto/auto-process

# Check logs
ssh louis@100.96.203.105
pm2 logs fibreflow-prod | grep AUTO
```

### Phase 2: Cron Setup (Day 1)

**Option A: PM2 Cron (Recommended)**
```bash
# On Velocity Server
ssh louis@100.96.203.105

# Create cron script
cat > /var/www/fibreflow/scripts/auto-evaluator-cron.sh << 'EOF'
#!/bin/bash
curl -X POST https://app.fibreflow.app/api/foto/auto-process \
  -H "Content-Type: application/json" \
  >> /var/log/fibreflow/auto-evaluator.log 2>&1
EOF

chmod +x /var/www/fibreflow/scripts/auto-evaluator-cron.sh

# Add to crontab
crontab -e
# Add line:
*/5 * * * * /var/www/fibreflow/scripts/auto-evaluator-cron.sh
```

**Option B: Node.js Worker Process**
```bash
# Run as PM2 process
pm2 start /var/www/fibreflow/scripts/auto-evaluator-worker.js \
  --name fibreflow-auto-evaluator \
  --cron "*/5 * * * *"
```

### Phase 3: Monitoring & Alerts (Day 2)

**Metrics to Track:**
- Drops processed per hour
- Average evaluation time
- Error rate
- Photos missing rate
- Feedback delivery success rate

**Dashboard Addition:**
```typescript
// Add to /wa-monitor dashboard
<div className="stats">
  <StatCard
    title="Auto-Evaluated Today"
    value={autoEvaluatedCount}
    icon={<Sparkles />}
  />
  <StatCard
    title="Avg Response Time"
    value="6.2 min"
    icon={<Clock />}
  />
</div>
```

---

## 🎯 Success Criteria

1. ✅ New drops automatically evaluated within 5 minutes
2. ✅ Feedback sent to WhatsApp with @mention
3. ✅ 95%+ success rate (photos available, evaluation completes)
4. ✅ Error logging for failed evaluations
5. ✅ Human agents can still manually review and override
6. ✅ No duplicate evaluations

---

## 🔒 Safety Measures

### 1. Duplicate Prevention
```sql
-- Check if already evaluated
SELECT COUNT(*) FROM foto_ai_reviews WHERE dr_number = ?
```

### 2. Rate Limiting
```typescript
// Max 10 drops per run (prevent API overload)
const NEW_DROPS_LIMIT = 10;

// Max 20 VLM calls per minute (API quota)
await rateLimiter.wait();
```

### 3. Manual Override
```typescript
// Human agents can always re-evaluate
// UI button: "Re-evaluate with AI" (bypasses auto flag)
```

### 4. Testing Mode
```typescript
// Environment variable
if (process.env.AUTO_EVALUATOR_DRY_RUN === 'true') {
  console.log('[DRY RUN] Would evaluate:', drNumber);
  return; // Don't actually evaluate
}
```

---

## 📊 Expected Performance

**Scenario:** 50 drops/day average

| Metric | Manual | Automated |
|--------|--------|-----------|
| Time to feedback | 2-24 hours | 5-10 minutes |
| Human time required | 50 × 3 min = 2.5 hrs | 50 × 30 sec review = 25 min |
| Accuracy | ✅ Human judgment | ✅ AI + human oversight |
| Scalability | ❌ Limited | ✅ Scales to 1000s/day |

**Cost:**
- VLM API: ~$0.10 per evaluation (3 batch calls)
- 50 drops/day = $5/day = $150/month
- **ROI:** Saves 2 hours/day of human time = 40 hrs/month

---

## 🚀 Next Steps

1. **Review this document** with team
2. **Approve architecture** (Option B: Polling)
3. **Implement Phase 1** (autoEvaluator.ts + API endpoint)
4. **Test on staging** (dev.fibreflow.app)
5. **Deploy to production** with DRY_RUN mode
6. **Monitor for 24 hours**
7. **Enable live mode** (remove DRY_RUN)
8. **Add monitoring dashboard**

---

**Author:** Claude + Louis
**Review Date:** 2025-12-24
**Status:** Ready for Implementation ✅
