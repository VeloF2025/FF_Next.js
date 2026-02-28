# Module: vlm

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Vision Language Model infrastructure for photo analysis and data extraction |
| **Status** | Production |
| **Complexity** | High |
| **Category** | infrastructure |
| **Server** | Velocity 100.96.203.105:8100 |
| **Model** | Qwen/Qwen3-VL-8B-Instruct |

## Quick Reference
- **URL:** `http://100.96.203.105:8100`
- **Model:** Qwen/Qwen3-VL-8B-Instruct
- **Service:** `vllm-qwen.service`
- **Config:** `/etc/systemd/system/vllm-qwen.service`
- **GPU:** NVIDIA RTX 5090 (compute-only mode)

## VLM Configuration
```bash
# Current stable settings (Jan 2026)
--model Qwen/Qwen3-VL-8B-Instruct
--max-model-len 16384      # Max tokens
--gpu-memory-utilization 0.90
--dtype bfloat16
--max-num-seqs 4           # 4 parallel sequences
--enforce-eager            # REQUIRED: prevents FLASHINFER crashes
```

## Image Size Limits
**CRITICAL:** Large images exceed VLM token limits (16384 max)

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
