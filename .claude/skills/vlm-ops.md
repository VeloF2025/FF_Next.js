---
name: vlm-ops
description: VLM (Qwen3 Vision Language Model) operations — restart, benchmark, diagnose failures, check GPU, reprocess photos
version: 1.0.0
triggers:
  - /vlm
  - VLM down
  - VLM not responding
  - vision model
  - photo processing
  - categorization failing
  - GPU issues
  - Qwen3
  - vllm-qwen
  - restart VLM
  - benchmark VLM
  - VLM slow
  - token limit
---

# /vlm — VLM Operations

Manages the Qwen3-VL-8B-Instruct Vision Language Model on Velocity. Used for DR photo categorization and fleet data extraction.

## Quick Reference

| Item | Value |
|------|-------|
| **Service** | `vllm-qwen.service` |
| **Endpoint** | `http://100.96.203.105:8100` |
| **Model** | `Qwen/Qwen3-VL-8B-Instruct` |
| **GPU** | RTX 5090 (compute-only mode) |
| **Server** | `ssh velo@100.96.203.105` |
| **Benchmark script** | `/home/velo/scripts/vllm/benchmark.sh` |
| **Startup script** | `/home/velo/scripts/vllm/startup.sh` |

## Service Management

```bash
ssh velo@100.96.203.105

# Check status
sudo systemctl status vllm-qwen.service

# Full restart (preferred — uses startup script)
/home/velo/scripts/vllm/startup.sh

# Emergency restart via systemd
sudo systemctl restart vllm-qwen.service

# View live logs
sudo journalctl -u vllm-qwen.service -f

# View last 50 lines
sudo journalctl -u vllm-qwen.service -n 50
```

## Health Check

```bash
# Quick health (from anywhere with Tailscale)
curl http://100.96.203.105:8100/health

# From FibreFlow API
curl https://dev.fibreflow.app/api/activate/health-check

# Test simple inference
curl http://100.96.203.105:8100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-VL-8B-Instruct",
    "messages": [{"role": "user", "content": "Say hello"}],
    "max_tokens": 50
  }'
```

## Benchmarks

```bash
# Run all 7 benchmark tests
/home/velo/scripts/vllm/benchmark.sh

# View latest results
cat /home/velo/scripts/vllm/benchmarks/latest_results.json

# View benchmark log
tail -f /var/log/vllm-benchmark.log

# Historical results
ls /home/velo/scripts/vllm/benchmarks/results_*.json
```

### Expected Benchmark Results

| Test | Type | Expected Result | Target Time |
|------|------|-----------------|-------------|
| `text_math` | Text | "4" | < 100ms |
| `text_plate_format` | Text | "Gauteng" | < 100ms |
| `image_plate` | Image | "KR27FNGP" | < 200ms |
| `image_odometer` | Image | "167443" | < 200ms |
| `image_fuel` | Image | "1/4" | < 150ms |
| `image_sa_id` | Image | "7802035087081" | < 300ms |
| `image_license_id` | Image | "7802035087081" | < 300ms |

## GPU Check

```bash
# Check GPU status
nvidia-smi

# GPU memory usage
nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv

# Expected: ~7-8GB used for model weights, plenty free
```

## Image Size Requirements

**CRITICAL:** Images exceeding 1024x768 cause token limit errors.

| Use Case | Max Dimensions |
|----------|---------------|
| DR Photos | 1024×768 |
| License Plates | 1024×768 |
| Fleet Odometers | 1024×768 |
| Documents / OCR | 1280×960 |

```typescript
// Resize before sending (use sharp)
import sharp from 'sharp';
const resized = await sharp(buffer)
  .resize(1024, 768, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer();
```

## VLM Configuration

Current stable settings (Jan 2026):
```
--model Qwen/Qwen3-VL-8B-Instruct
--max-model-len 16384
--gpu-memory-utilization 0.90
--dtype bfloat16
--max-num-seqs 4
--enforce-eager          # REQUIRED: prevents FLASHINFER crashes
```

**`--enforce-eager` is mandatory** — removing it causes CUDA kernel crashes.

## Scheduled Maintenance

| Schedule | Task |
|----------|------|
| 3:00 AM daily | VLM service restart (cron) |
| Every 5 min | Health check + auto-restart if down |
| 6am, 12pm, 6pm, 11pm | Benchmark runs (4× daily) |

## Troubleshooting

### Service Not Responding
```bash
ssh velo@100.96.203.105
nvidia-smi                          # 1. Check GPU is visible
sudo systemctl status vllm-qwen.service  # 2. Check service state
sudo journalctl -u vllm-qwen.service -n 50  # 3. Check errors
/home/velo/scripts/vllm/startup.sh  # 4. Clean restart
```

### Token Limit Error (HTTP 400)
- **Symptom:** `"decoder prompt is longer than maximum model length"`
- **Cause:** Image is too large
- **Fix:** Resize to max 1024×768 before sending

### VLM Returns Garbage Output
- **Likely cause:** Prompt format issue
- **Check:** `vlmExtractionService.ts` prompt structure
- **Test:** Run benchmark to verify model is healthy

### GPU OOM (Out of Memory)
```bash
# Check what's using GPU memory
nvidia-smi
# Kill any orphaned processes if needed
# Then restart VLM service
/home/velo/scripts/vllm/startup.sh
```

### FLASHINFER Crashes
- **Fix:** Ensure `--enforce-eager` is in service config
- Check `/etc/systemd/system/vllm-qwen.service` for the flag

## Reprocess Failed DR Photos

```bash
# Via FibreFlow API
curl -X POST https://dev.fibreflow.app/api/activate/admin/retry-failed

# Check what failed
curl https://dev.fibreflow.app/api/activate/admin/retry-failed

# SQL: Find stuck DRs
ssh velo@100.96.203.105 "psql \$DATABASE_URL -c \"
SELECT dr_number, vlm_status, retry_count, vlm_error
FROM foto_ai_reviews
WHERE vlm_status IN ('failed', 'pending')
  AND created_at < NOW() - INTERVAL '30 minutes'
ORDER BY created_at;\""
```

## VLM Consumers in FibreFlow

| Module | File | Use Case |
|--------|------|----------|
| Activate | `vlmExtractionService.ts` | DR photo categorization (10-step) |
| Fleet | `fleetVlmService.ts` | License plates, odometer, fuel gauge |

## Related
- `.claude/modules/vlm.md` — Full VLM module doc
- `.claude/modules/activate.md` — DR photo workflow
- `/dr` skill — DR management (uses VLM)
