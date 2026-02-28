# VLM Bulk Processing — Operational Playbook

> How to run bulk VLM categorization/extraction for DR photo backlogs.

## Architecture

```
Cron (*/5 min) ──┐
                 ├──> process-vlm-queue.ts ──> VLM Server (Qwen3-VL-8B)
Burst script ────┘       │                        :8100
                         ├── Categorize photos (steps 1-10)
                         └── Extract data (power meter, ONT serial, DR number)
```

## Key File

`pages/api/cron/process-vlm-queue.ts`

**Parameters (query string):**
- `limit` — DRs per call (default: 20)
- `concurrency` — Parallel batch size (default: 3)

**Auth:** `Authorization: Bearer {CRON_SECRET}`

## Processing Pipeline Per DR

1. Fetch photos from Firebase Storage
2. Send each photo to VLM for step categorization (1-10)
3. If step 6/7/9 photos found → extract power meter dBm, ONT serial, DR number
4. If no step 6/7/9 photos → mark `data_validation_completed=true`, `vlm_power_meter_status='no_photo'`
5. Update `dr_photo_unified_reviews` with results

## Burst Script Template

For clearing large backlogs (thousands of DRs), use a continuous burst script:

```bash
#!/bin/bash
CRON_SECRET="<secret>"
URL="http://100.96.203.105:3005/api/cron/process-vlm-queue?limit=6&concurrency=3"
LOG="/tmp/vlm-burst.log"
ROUND=0; TOTAL=0; ZERO_COUNT=0; MAX_RETRIES=5

echo "$(date) - VLM burst started" > "$LOG"
while true; do
  ROUND=$((ROUND + 1))
  R=$(curl -s -X POST "$URL" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    --max-time 300 2>/dev/null)
  P=$(echo "$R" | node -p "JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).processed" 2>/dev/null || echo "0")
  S=$(echo "$R" | node -p "JSON.parse(require(\"fs\").readFileSync(\"/dev/stdin\",\"utf8\")).succeeded" 2>/dev/null || echo "0")
  TOTAL=$((TOTAL + S))
  echo "$(date) - Round $ROUND: +$S (total: $TOTAL)" >> "$LOG"
  if [ "$P" = "0" ]; then
    ZERO_COUNT=$((ZERO_COUNT + 1))
    echo "$(date) - Zero result ($ZERO_COUNT/$MAX_RETRIES), retrying in 30s..." >> "$LOG"
    if [ "$ZERO_COUNT" -ge "$MAX_RETRIES" ]; then
      echo "$(date) - DONE ($TOTAL total)" >> "$LOG"
      break
    fi
    sleep 30
  else
    ZERO_COUNT=0
    sleep 5
  fi
done
```

**Run:** `bash /tmp/vlm-burst.sh &` (background)
**Monitor:** `tail -f /tmp/vlm-burst.log`

## VLM Server Tuning

Service: `/etc/systemd/system/vllm-qwen.service`

Key parameter: `--max-num-seqs` (concurrent inference sequences)
- Default: 4
- Burst mode: 8 (matches concurrency=3 from burst + cron overlap)
- Higher values use more VRAM (RTX 5090 = 32GB)

```bash
# Change max-num-seqs (run locally on Velocity)
sudo sed -i 's/--max-num-seqs [0-9]*/--max-num-seqs 8/' /etc/systemd/system/vllm-qwen.service && \
  sudo systemctl daemon-reload && sudo systemctl restart vllm-qwen
```

## Common Issues

### Infinite Reprocessing Loop
**Symptom:** Same DRs processed thousands of times, no progress.
**Cause:** DRs categorized but without step 6/7/9 photos left extraction columns NULL, cron re-queued them.
**Fix:** Else branch marks these as `data_validation_completed=true` with `vlm_power_meter_status='no_photo'`.

### Burst Script Dies on Timeout
**Symptom:** Script exits with "DONE" but thousands of DRs remain.
**Cause:** curl timeout → empty response → JSON parse returns "0" → script thinks processing complete.
**Fix:** Resilient mode — require 5 consecutive zeros before stopping, 30s retry between each.

### varchar Overflow on overall_status
**Symptom:** `value too long for type character varying(10)`
**Cause:** New status values like `NEEDS_REVIEW` (12 chars) exceed varchar(10).
**Fix:** Widen column: `ALTER TABLE dr_photo_unified_reviews ALTER COLUMN overall_status TYPE varchar(30)`. Must drop/recreate dependent views first (`v_dr_installation_status`, `v_foto_ai_reviews`).

### "No photos available" Failures
**Symptom:** DR has `photo_count > 0` but VLM reports "No photos available".
**Cause:** Photos deleted from Firebase Storage or invalid paths. Record is stale.
**Fix:** Mark as `vlm_categorization_status='failed'`, `data_validation_completed=true` for manual review.

## Progress Query

```sql
SELECT
  COUNT(*) FILTER (WHERE photo_count > 0) as with_photos,
  COUNT(*) FILTER (WHERE vlm_categorization_status IN ('categorized','approved')) as done,
  COUNT(*) FILTER (WHERE vlm_categorization_status = 'failed') as failed,
  COUNT(*) FILTER (WHERE photo_count > 0 AND (vlm_categorization_status IS NULL OR vlm_categorization_status = 'pending')) as remaining
FROM dr_photo_unified_reviews;
```

## Performance Benchmarks (RTX 5090, max-num-seqs=8)

| Scenario | Rate |
|----------|------|
| Sequential (old) | ~53 DRs/hour |
| Parallel burst (concurrency=3) | ~150-200 DRs/hour |
| Full backlog (7,638 DRs) | ~12 hours overnight |
