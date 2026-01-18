# VLM Infrastructure Skill

## Overview
Qwen3-VL-8B-Instruct running on Velocity Server for image analysis (plates, documents, photos).

## Quick Reference
- **URL:** `http://100.96.203.105:8100`
- **Model:** Qwen/Qwen3-VL-8B-Instruct
- **Service:** `vllm-qwen.service`
- **Config:** `/etc/systemd/system/vllm-qwen.service`

## Current Configuration (Jan 2026)
```bash
--model Qwen/Qwen3-VL-8B-Instruct
--max-model-len 16384      # Max tokens
--gpu-memory-utilization 0.90
--dtype bfloat16
--max-num-seqs 4           # 4 parallel sequences
--enforce-eager            # REQUIRED: prevents FLASHINFER backend crashes
```

## GPU Setup
- **GPU:** NVIDIA RTX 5090 (32GB VRAM)
- **Mode:** Exclusive_Process (compute-only)
- **Display:** AMD integrated GPU handles all GUI
- **Config:** `/etc/X11/xorg.conf.d/10-amd-primary.conf`

To set compute-only mode:
```bash
sudo nvidia-smi -c 3  # Exclusive_Process
```

## Token Limits
| Parallel Seqs | Max Tokens | Use Case |
|---------------|------------|----------|
| 4 | ~20,000 | High throughput |
| 2 | ~40,000 | Larger docs |
| 1 | ~80,000 | Maximum context |

## Image Size Limits
**CRITICAL:** Resize images before sending to VLM
- Max: 1024x768 for plates, 1280x960 for documents
- Use `sharp` library:
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

### Manual Commands
```bash
ssh velo@100.96.203.105  # Password: velo2026

# Run benchmark
/home/velo/scripts/vllm/benchmark.sh

# Check results
cat /home/velo/scripts/vllm/benchmarks/latest_results.json

# View logs
tail -f /var/log/vllm-benchmark.log
tail -f /var/log/vllm-maintenance.log
```

## Service Management
```bash
ssh velo@100.96.203.105

# Check status
echo 'velo2026' | sudo -S systemctl status vllm-qwen.service

# Restart
echo 'velo2026' | sudo -S systemctl restart vllm-qwen.service

# View logs
echo 'velo2026' | sudo -S journalctl -u vllm-qwen.service -n 50

# Clean restart script
/home/velo/scripts/vllm/startup.sh
```

## Troubleshooting

### Service not starting
```bash
# Check GPU memory
nvidia-smi

# Check logs
echo 'velo2026' | sudo -S journalctl -u vllm-qwen.service -n 50

# Clean restart
/home/velo/scripts/vllm/startup.sh
```

### Token limit errors (400 response)
- **Cause:** Image too large
- **Error:** "decoder prompt is longer than maximum model length"
- **Fix:** Resize to max 1024x768

### FLASHINFER backend crash
- **Error:** "Qwen3-VL does not support AttentionBackendEnum.FLASHINFER"
- **Fix:** Add `--enforce-eager` to service config (already done)

### Benchmark failures
```bash
# Check log
cat /var/log/vllm-benchmark.log

# Verify test images exist
ls -la /home/velo/scripts/vllm/benchmarks/test-images/

# Run manually
/home/velo/scripts/vllm/benchmark.sh
```

## Used By
- **Fleet Portal:** License plate verification (`/api/fleet/portal/verify-plate`)
- **Activate Module:** Photo categorization (`/api/activate/categorize-photos`)
- **Staff Documents:** ID/License OCR (`/api/documents-ocr-preview`)
