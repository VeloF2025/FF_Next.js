---
name: dr
description: Daily Report (DR) management for FibreFlow — check status, find missing DRs, trigger reprocessing, manage VLM categorization
version: 1.0.0
triggers:
  - /dr
  - daily report
  - DR status
  - missing DR
  - which DRs are outstanding
  - DR not submitted
  - acknowledge DR
  - DR acknowledgment
  - retry DR
  - VLM categorization
  - foto_ai_reviews
---

# /dr — Daily Report Agent

Manages the end-to-end DR (Daily Report) workflow: submission via WhatsApp → VLM photo categorization → Activate review → acknowledgment.

## Quick Reference

| Item | Value |
|------|-------|
| **UI** | `/activate` |
| **Monitoring** | `/activate/monitoring` |
| **WA Bridge** | VPS `72.61.197.178:8083` |
| **WA Proxy** | Velocity `100.96.203.105:8092` |
| **VLM** | `http://100.96.203.105:8100` |
| **DB table** | `foto_ai_reviews`, `qa_photo_reviews` |

## DR Workflow

```
Field team submits DR photos → WhatsApp group
  → wa-monitor captures → qa_photo_reviews
  → /api/activate/process-new-dr → foto_ai_reviews
  → VLM categorizes (10-step checklist)
  → Activate dashboard review
  → WhatsApp acknowledgment sent back to team
```

## Common Tasks

### Check Outstanding DRs
```sql
-- DRs pending VLM categorization
SELECT dr_number, project, created_at
FROM foto_ai_reviews
WHERE vlm_status = 'pending'
ORDER BY created_at;

-- DRs failed VLM (need retry)
SELECT dr_number, project, retry_count, vlm_error
FROM foto_ai_reviews
WHERE vlm_status = 'failed'
ORDER BY retry_count, created_at;

-- DRs by project and status today
SELECT project, vlm_status, COUNT(*) as count
FROM foto_ai_reviews
WHERE DATE(created_at) = CURRENT_DATE
GROUP BY project, vlm_status;
```

### Retry Failed Categorizations
```bash
# Via API (preferred)
curl -X POST https://dev.fibreflow.app/api/activate/admin/retry-failed

# Check retry queue first
curl https://dev.fibreflow.app/api/activate/admin/retry-failed

# Via UI
# Navigate to /activate/monitoring → Retry Failed button
```

### Check Service Health
```bash
# Full health check
curl https://dev.fibreflow.app/api/activate/health-check

# VLM directly
curl http://100.96.203.105:8100/health

# WA Bridge on VPS
curl http://72.61.197.178:8083/health
```

### Manually Process a DR
```bash
curl -X POST https://dev.fibreflow.app/api/activate/process-new-dr \
  -H "Content-Type: application/json" \
  -d '{"drNumber": "DR-2026-001", "project": "Lawley"}'
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/activate/health-check` | All service health |
| GET | `/api/activate/admin/retry-failed` | List failed DRs |
| POST | `/api/activate/admin/retry-failed` | Retry all failed |
| POST | `/api/activate/process-new-dr` | Process a DR from WA |
| POST | `/api/activate/categorize-photos` | Trigger VLM on photos |
| POST | `/api/activate/approve-categorization` | Approve AI results |
| POST | `/api/activate/dr-acknowledgment` | Send WA acknowledgment |
| GET | `/api/activate/fetch-photos` | Get photos for a DR |

## VLM 10-Step Checklist

| Step | Field | Description |
|------|-------|-------------|
| 1 | `cable_placement` | Cable correctly placed |
| 2 | `splicing_complete` | Splicing work completed |
| 3 | `enclosure_sealed` | Enclosure properly sealed |
| 4 | `labels_visible` | Labels clearly visible |
| 5 | `fiber_protection` | Fibre protection in place |
| 6 | `nbn_compliance` | NBN compliance met |
| 7 | `documentation` | Documentation complete |
| 8 | `site_cleanup` | Site cleaned up |
| 9 | `safety_measures` | Safety measures followed |
| 10 | `quality_check` | Final quality check passed |

## WhatsApp Group Mapping

| Project | Group ID |
|---------|----------|
| Lawley | `120363418298130331@g.us` |
| Mohadin | `120363421532174586@g.us` |
| Mamelodi | `120363408849234743@g.us` |
| Velo Test | `120363421664266245@g.us` |

## Troubleshooting

### VLM Not Categorizing
```bash
ssh velo@100.96.203.105
sudo systemctl status vllm-qwen.service
# If down:
/home/velo/scripts/vllm/startup.sh
```

### WA Acknowledgments Not Sending
```bash
# Check WA bridge on VPS
ssh root@72.61.197.178 "systemctl status whatsapp-bridge.service"

# Check wa-feedback proxy on Velocity
ssh velo@100.96.203.105 "sudo systemctl status wa-feedback.service"
```

### DR Stuck in 'pending' > 30 min
1. Check VLM health: `curl http://100.96.203.105:8100/health`
2. Force retry: `POST /api/activate/admin/retry-failed`
3. Check `vlm_error` in DB for the specific DR
4. Max 3 retries — after that, manual review in `/activate/[dropNumber]`

## Related
- `.claude/modules/activate.md` — Full Activate module docs
- `.claude/modules/vlm.md` — VLM service details
- `.claude/modules/wa-monitor.md` — WhatsApp source data
- `/vlm` skill — VLM diagnostics and restart
