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

## Commits

- `37e97952` — Add project and sender_phone to all process-new-dr paths
- `b3e9cdf3` — Prevent row duplication from LEFT JOINs in drops query
- `cf8beb04` — Prevent false resubmission when dr-acknowledgment creates record first
