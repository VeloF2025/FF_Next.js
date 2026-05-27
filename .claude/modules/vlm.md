# Module: vlm

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Vision Language Model infrastructure for photo analysis and data extraction |
| **Status** | Production |
| **Complexity** | High |
| **Category** | infrastructure |
| **Server** | Velocity 100.96.203.105:8100 |
| **Model** | QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ |

## Quick Reference
- **URL:** `http://100.96.203.105:8100`
- **Model:** QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ
- **Service:** `vllm-qwen.service`
- **Config:** `/etc/systemd/system/vllm-qwen.service`
- **GPU:** NVIDIA RTX 5090 (compute-only mode)

## VLM Configuration
```bash
# Current stable settings (Apr 2026 — 30B-A3B AWQ migration)
--model QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ
--max-model-len 32768      # Total context: prompt + image tokens + output
--gpu-memory-utilization 0.92
--dtype auto
--max-num-seqs 4           # 4 parallel sequences
--quantization awq
--enforce-eager            # REQUIRED: prevents FLASHINFER crashes
```

## Image Size Limits
**CRITICAL:** Large images eat into the 32768 total-context budget (prompt + image + output)

| Use Case | Max Size | Notes |
|----------|----------|-------|
| License plates | 1024x768 | Standard |
| Documents | 1280x960 | Larger for OCR |
| DR Photos | 1024x768 | Default |

**Resize before sending:**
```typescript
import sharp from 'sharp';
const resized = await sharp(buffer)
  .resize(1024, 768, { fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 85 })
  .toBuffer();
```

## Per-function Token Budgets

All `max_tokens` values live in `src/lib/vlm/config.ts` — **do not hardcode**. Import from `@/lib/vlm`:

| Constant | Value | Use For |
|----------|-------|---------|
| `VLM_MAX_TOKENS_ORIENTATION` | 10 | Orientation probe (single-number reply) |
| `VLM_MAX_TOKENS_QUICK` | 500 | Plate, odometer, fuel, pole-install classifier, fleet |
| `VLM_MAX_TOKENS_DEFAULT` | 1000 | Generic fallback |
| `VLM_MAX_TOKENS_OCR` | 1000 | ID/serial OCR, asset labels, construction QA |
| `VLM_MAX_TOKENS_QA` | 2000 | QA validation, photo evaluation, doc cross-validation |
| `VLM_MAX_TOKENS_ANALYSIS` | 2048 | Screenshot/devops analysis |
| `VLM_MAX_TOKENS_CATEGORIZATION` | 4000 | Batch photo categorization (6 photos/call) |
| `VLM_MAX_TOKENS_DOCUMENT` | 4000 | Quote/PO structured extraction |

```typescript
import { VLM_MAX_TOKENS_OCR, VLM_CHAT_ENDPOINT, VLM_EXTRACTION_MODEL } from '@/lib/vlm';

await fetch(VLM_CHAT_ENDPOINT, {
  method: 'POST',
  body: JSON.stringify({
    model: VLM_EXTRACTION_MODEL,
    messages: [...],
    max_tokens: VLM_MAX_TOKENS_OCR,
  }),
});
```

Note: `src/modules/data-sync/services/eodVlmService.ts` has a local `EOD_MAX_TOKENS = 4096` for the full EOD-table pass — this is larger than `DOCUMENT` (4000) because a single call returns dozens of rows. Keep it file-local unless a second caller needs the same budget.

## Benchmark System
**Location:** `/home/velo/scripts/vllm/`

### Test Images
```
/home/velo/scripts/vllm/benchmarks/test-images/
├── plate.jpg           # Expected: KR 27 FN GP
├── odometer.jpg        # Expected: 167443
├── fuel.jpg            # Expected: 1/4
├── sa_id.jpg           # Expected: 7802035087081
└── drivers_license.jpg # Expected: 7802035087081
```

### 7 Benchmark Tests
| Test | Type | Expected | Typical Time |
|------|------|----------|--------------|
| text_math | Text | "4" | ~35ms |
| text_plate_format | Text | "Gauteng" | ~55ms |
| image_plate | Image | KR27FNGP | ~90ms |
| image_odometer | Image | 167443 | ~90ms |
| image_fuel | Image | 1/4 | ~57ms |
| image_sa_id | Image | 7802035087081 | ~170ms |
| image_license_id | Image | 7802035087081 | ~190ms |

### Cron Schedule
```bash
0 3 * * *           # 3:00 AM - Nightly restart
*/5 * * * *         # Every 5 min - Health check
0 6,12,18,23 * * *  # 6am, 12pm, 6pm, 11pm - Benchmarks (4x daily)
```

### Results
```bash
cat /home/velo/scripts/vllm/benchmarks/latest_results.json   # Latest
ls /home/velo/scripts/vllm/benchmarks/results_*.json         # Historical
```

## Quick Commands

### Service Management (run locally on Velocity)
```bash
# Check status
sudo systemctl status vllm-qwen.service

# Restart
/home/velo/scripts/vllm/startup.sh

# Run benchmark manually
/home/velo/scripts/vllm/benchmark.sh

# View logs
tail -f /var/log/vllm-benchmark.log
tail -f /var/log/vllm-maintenance.log
sudo journalctl -u vllm-qwen.service -n 50
```

## Troubleshooting

### Service not starting
```bash
nvidia-smi                                                  # Check GPU
sudo journalctl -u vllm-qwen.service -n 50
/home/velo/scripts/vllm/startup.sh                          # Clean restart
```

### Token limit errors (400 response)
- **Symptom:** "decoder prompt is longer than maximum model length"
- **Cause:** Image too large
- **Fix:** Resize to max 1024x768 before sending

### Benchmark failures
```bash
cat /var/log/vllm-benchmark.log
ls /home/velo/scripts/vllm/benchmarks/test-images/  # Verify images exist
/home/velo/scripts/vllm/benchmark.sh                 # Run manually
```

## Usage in FibreFlow

### Activate Module Integration
The VLM powers photo categorization and data extraction:
- **Categorization:** Assigns photos to 10-step checklist
- **Extraction:** Reads power meter dBm, ONT serials, DR numbers
- **Service:** `vlmExtractionService.ts`

### Fleet Module Integration
- **License plates:** Vehicle registration extraction
- **Odometer:** Mileage reading
- **Fuel gauge:** Level estimation

## Related
- `.claude/modules/activate.md` - Main VLM consumer
- `src/modules/activate/services/vlmExtractionService.ts` - Extraction service
- `src/modules/fleet/services/fleetVlmService.ts` - Fleet VLM service
