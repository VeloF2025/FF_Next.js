# DR Acknowledgment Race Condition

> Deep reference for the race condition between dr-acknowledgment.ts and process-new-dr.ts

## Problem (2026-01-30)

The Go WhatsApp Bridge calls two endpoints when a DR photo is submitted via WhatsApp:

```
WhatsApp Message → Go Bridge → 1. POST /api/activate/dr-acknowledgment
                              → 2. POST /api/activate/process-new-dr
```

`dr-acknowledgment` creates a bare record in `dr_photo_unified_reviews` with ONLY:
- `drop_number`
- `onemap_status` ('found', 'not_found', 'error')
- `created_at`, `updated_at`

It does NOT set: `project`, `sender_phone`, `submitted_date`, `wa_message_id`, `wa_received_at`, or any contact fields.

## Three Failure Modes

### 1. Idempotency Guard Gap (< 60 seconds)
When `process-new-dr` runs within 60 seconds of record creation:
- The idempotency guard fires (skips resubmission increment)
- But the UPDATE was missing `project` field
- **Fix:** Added `project = COALESCE($3, project)` to idempotency guard UPDATE

### 2. Brand New DR INSERT Gap
When process-new-dr creates a new record (no existing record):
- The INSERT was missing `sender_phone` column
- **Fix:** Added `sender_phone` to INSERT column list

### 3. False Resubmission (> 60 seconds)
When dr-acknowledgment creates a record and the WA submission arrives >60s later:
- Old logic: `if (ageSeconds < 60) { /* guard */ } else { /* resubmission */ }`
- Record was treated as genuine resubmission because it was "old enough"
- **Fix:** Added third code path checking `wa_message_id` and `wa_received_at`

## Fixed Logic (Three Code Paths)

```typescript
if (existingUnified) {
  const ageSeconds = (Date.now() - new Date(existingUnified.created_at).getTime()) / 1000;

  if (ageSeconds < 60) {
    // PATH 1: Idempotency guard — duplicate call within 60s
    // Update fields (project, sender_phone, submitted_date, contact info)
    // Do NOT increment submission_count
  } else if (!existingUnified.wa_message_id && !existingUnified.wa_received_at) {
    // PATH 2: First real WA submission for pre-existing record
    // Created by dr-acknowledgment, ensure-data, or import-oes
    // Update fields, do NOT increment submission_count
  } else {
    // PATH 3: Genuine resubmission — record has WA context from previous submission
    // Increment submission_count, save snapshot to submission_history
  }
}
```

## LEFT JOIN Row Multiplication

The `drops.ts` query joins to `drops`, `projects`, `oes_activations`, and `maintenance_tickets`.

**Duplicate-safe tables (regular LEFT JOIN OK):**
- `oes_activations` — one row per DR

**Duplicate-prone tables (MUST use LATERAL):**
- `drops` — can have multiple rows per DR (different project_ids)
- `maintenance_tickets` — can have multiple tickets per DR (legitimate, multiple issues)

```sql
-- LATERAL pattern for duplicate-prone tables
LEFT JOIN LATERAL (
  SELECT p.project_name FROM drops d
  JOIN projects p ON p.id = d.project_id
  WHERE d.drop_number = u.drop_number
  LIMIT 1
) dp ON true

LEFT JOIN LATERAL (
  SELECT id, ticket_uid FROM maintenance_tickets
  WHERE dr_number = u.drop_number
  ORDER BY created_at DESC LIMIT 1
) mt ON true
```

## Multiple Record Creators

Records in `dr_photo_unified_reviews` can be created by:

| Creator | Fields Set | When |
|---------|-----------|------|
| `dr-acknowledgment.ts` | drop_number, onemap_status | Go Bridge first call |
| `process-new-dr.ts` (new) | All fields | WA submission, no existing record |
| `process-new-dr.ts` (existing) | Updates missing fields | WA submission, existing record |
| `ensure-data.ts` | drop_number | QA Wizard opened |
| `import-oes.ts` | OES fields | OES Excel import |
| `drops.ts:syncMissing` | drop_number | Legacy backfill |

**Rule:** Every INSERT/UPDATE path MUST use `COALESCE` to avoid overwriting data set by another creator.

## Key Files

- `pages/api/activate/process-new-dr.ts` — Three code paths (lines 484-612)
- `pages/api/activate/dr-acknowledgment.ts` — Creates bare records
- `pages/api/activate/drops.ts` — LATERAL JOINs query (lines 264-294)
- `pages/api/activate/ensure-data.ts` — Creates records when QA Wizard opens

## Post-Deployment Stragglers

After deploying the fix, DR1735961 was processed at 14:40 SAST — **3 minutes before** the production deployment completed (~14:43 SAST). It hit the old code and was falsely classified as resubmission #2. Required manual backfill of `submission_count` to 1.

**Lesson:** When deploying fixes for race conditions, always check for DRs processed in the deployment window (between the last commit and the service restart). Query:

```sql
SELECT drop_number, submission_count, created_at, wa_received_at
FROM dr_photo_unified_reviews
WHERE submission_count > 1
  AND created_at > NOW() - INTERVAL '1 hour'
  AND drop_number NOT IN (
    SELECT drop_number FROM wa_monitor_drops
    GROUP BY drop_number HAVING COUNT(*) > 1
  );
```

## Bug: dr-acknowledgment.ts Also Causes False Resubmissions (2026-01-31)

The `process-new-dr.ts` three-path fix from 2026-01-30 was incomplete. The SAME race condition also exists WITHIN `dr-acknowledgment.ts` itself.

### Root Cause

`dr-acknowledgment.ts` line 476 used a simple null check:
```typescript
const isResubmission = existingSubmission !== null;  // TOO AGGRESSIVE
```

Any record in `dr_photo_unified_reviews` was treated as a "previous submission." But records are created by many sources (see table above). When Go Bridge calls `dr-acknowledgment` and the record already exists (created by `process-new-dr` concurrently, or by `updateOneMapStatus` in a prior `dr-acknowledgment` call), the endpoint falsely calls `markForRework()` which increments `submission_count` and sends "🔄 Resubmitted!" message.

### Impact

114 DRs had falsely inflated `submission_count` (> 1) despite never being through QA review. Fixed by resetting to 1.

### Fix

Changed resubmission detection to require evidence of QA processing:
```typescript
// Only treat as resubmission if DR has been through QA at least once
const isResubmission = existingSubmission !== null && (
  existingSubmission.qa_decision !== null ||
  existingSubmission.feedback_message !== null
);
```

This aligns with the semantic meaning: a "resubmission" means the tech is re-sending photos after receiving QA feedback. Without feedback, it's just a concurrent/duplicate creation.

### Diagnostic Query

```sql
-- Find DRs falsely marked as resubmissions
SELECT drop_number, submission_count, qa_decision, feedback_message, created_at
FROM dr_photo_unified_reviews
WHERE submission_count > 1
  AND qa_decision IS NULL
  AND feedback_message IS NULL;
```

## Failure Mode 4: INSERT Duplicate Key (TOCTOU Race)

When `process-new-dr` SELECT finds no existing unified record, but `dr-acknowledgment` creates one between the SELECT and the INSERT, the plain INSERT crashes with:
```
duplicate key value violates unique constraint "dr_photo_unified_reviews_drop_number_key"
```

This caused 147 bridge 500 errors (Jan 23-31, 2026). Photos were still populated by the `processOrphanedRecordsInBackground()` self-healing function in `drops.ts`.

**Fix:** Changed both INSERT statements (lines 686 and 741) to `INSERT ... ON CONFLICT (drop_number) DO UPDATE SET` (UPSERT) with COALESCE to avoid overwriting existing data.

**Rule:** EVERY INSERT into `dr_photo_unified_reviews` MUST use `ON CONFLICT DO UPDATE` because multiple concurrent creators exist. Plain INSERT will eventually crash.

## Self-Healing: processOrphanedRecordsInBackground()

`drops.ts` (line 811) has a fire-and-forget self-healing function that runs on every QA Centre page load. It:
1. Finds DRs with `photo_count=0`, no `wa_message_id`, created in last 48 hours
2. Fetches photos from BOSS/1Map API
3. Updates `photo_source='onemap'` and `photo_count`

This is why DRs still have photos despite `process-new-dr` returning 500.

## Bridge Architecture (Go WhatsApp Bridge)

The Go Bridge at `/opt/whatsapp-bridge/whatsapp-bridge` on VPS (72.61.197.178) calls **production** (`app.fibreflow.app`) via env var:

```go
var fibreflowBaseURL = getEnvOrDefault("FIBREFLOW_URL", "https://app.fibreflow.app")
var FIBREFLOW_API_URL = fibreflowBaseURL + "/api/activate/process-new-dr"
var FIBREFLOW_ACK_API_URL = fibreflowBaseURL + "/api/activate/dr-acknowledgment"
var MAINTENANCE_WA_API_URL = fibreflowBaseURL + "/api/maintenance/wa-message"
```

The systemd service sets `Environment=FIBREFLOW_URL=https://app.fibreflow.app`.

**Note (2026-01-31):** Previously the URLs were hardcoded `const` pointing to staging (`vf.fibreflow.app`). The env var `FIBREFLOW_URL` existed in systemd but was never read by the Go code. Fixed by replacing consts with vars using `getEnvOrDefault()`.

Bridge also writes directly to Neon DB (`qa_photo_reviews` table) via non-pooler connection.

Both `syncToFibreFlow` and `sendDRAcknowledgment` run as goroutines (fire-and-forget).

### Maintenance Group Routing (2026-01-31)

The bridge routes messages differently by group type:
- **`dr_submission`** groups → `processDropNumbers()` + `sendDRAcknowledgment()` + `syncToFibreFlow()`
- **`maintenance`** groups → `forwardToMaintenanceAPI()` only (skips DR processing)
- **`admin`** groups → Command bot only

`processDropNumbers()` receives a `groupType` parameter and returns early for maintenance groups. This prevents activation-style ack messages from being sent to maintenance groups.

The maintenance API endpoint (`/api/maintenance/wa-message`) uses bridge secret authentication (`fibreflow-bridge-2026`) instead of `withAuth` since the bridge has no user session.

## Commits

- `37e97952` — Add project and sender_phone to all process-new-dr paths
- `b3e9cdf3` — Prevent row duplication from LEFT JOINs in drops query
- `cf8beb04` — Prevent false resubmission when dr-acknowledgment creates record first (process-new-dr)
- `841531b5` — Fix false resubmission in dr-acknowledgment.ts itself (114 DRs fixed)
- `05aac8a8` — Convert process-new-dr INSERTs to UPSERTs (147 bridge 500s)
- `b58ee477` — Replace withAuth with bridge secret for maintenance WA message endpoint
