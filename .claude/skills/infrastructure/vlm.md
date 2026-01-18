# VLM Infrastructure Skill

## Overview
Qwen3-VL-8B-Instruct running on Velocity Server for image analysis.

**Primary Use Case:** Fibre site photo categorization and QA (Activate module)
**Secondary Use Cases:** Fleet check-in (odometer/fuel), license plates, document OCR

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

### 32B Model Experiment (Jan 2026)
**Result:** Does NOT fit in 32GB VRAM

Attempted upgrade to `Qwen3-VL-32B-Instruct-FP8` for potentially better accuracy:
- Model downloaded: ~34GB (FP8 quantized)
- Model weights alone: 30.6GB
- **Problem:** No room left for KV cache
- **Error:** `torch.OutOfMemoryError: CUDA out of memory`
- Even with `--max-model-len 4096` and `--max-num-seqs 1`: still OOM

**Conclusion:** 8B model is the maximum for RTX 5090. Performance is excellent anyway (89-97% confidence on categorization).

**Backup config:** `/etc/systemd/system/vllm-qwen.service.8b-backup`

## Model Benchmark Comparison (Jan 2026)

### Qwen3-VL-8B-Instruct Scores
| Benchmark | Score | Notes |
|-----------|-------|-------|
| **DocVQA** | 96.1% | Excellent for document/photo understanding |
| **OCRBench** | 896 | Top-tier OCR capability |
| **MMBench v1.1** | 85.0% | Strong general vision understanding |
| **MathVista** | 77.2% | Visual math reasoning |
| **MMMU** | 69.6% | Multimodal reasoning |
| **MMStar** | 70.9% | Multi-modal star benchmark |
| **AI2D** | 85.7% | Diagram understanding |

### Comparison with Alternatives (~8B class)
| Benchmark | Qwen3-VL-8B | InternVL3.5-8B | MiniCPM-V 4.5 | Qwen2.5-VL-7B |
|-----------|-------------|----------------|---------------|---------------|
| **MMMU** | 69.6% | 60.3% | ~70% | 58.6% |
| **MMBench** | **85.0%** | ~80% | ~82% | - |
| **MMStar** | **70.9%** | 65.0% | 59.0% | - |
| **DocVQA** | **96.1%** | - | - | 95.7% |
| **MathVista** | **77.2%** | - | - | 68.2% |

### Verdict
**Qwen3-VL-8B is one of the best performing models in its class** for:
- Document/photo understanding (96.1% DocVQA)
- OCR tasks (896 OCRBench)
- General vision (85% MMBench)

### Alternative Models Considered
| Model | Params | VRAM | vLLM | Verdict |
|-------|--------|------|------|---------|
| **MiniCPM-V 4.5** | 8B | ~20-28GB | ✅ v0.10.2+ | Similar performance, potentially faster |
| **InternVL3.5-8B** | 8B | ~24GB | ✅ | Better on MMVet (76.6%) |
| **Qwen2.5-VL-7B** | 7B | ~18GB | ✅ | Faster inference than Qwen3-VL |
| **Kimi-VL-A3B** | 2.8B active | ~16GB | ⚠️ | MoE - most efficient |

### When to Consider Switching
- **MiniCPM-V 4.5**: If inference speed becomes critical
- **Qwen2.5-VL-7B**: If Qwen3-VL inference is too slow
- **InternVL3.5-8B**: If visual reasoning needs improvement

**Current recommendation:** Stay with Qwen3-VL-8B - excellent benchmarks and 100% success rate on photo categorization.

## Token Limits
| Parallel Seqs | Max Tokens | Use Case |
|---------------|------------|----------|
| 4 | ~20,000 | High throughput |
| 2 | ~40,000 | Larger docs |
| 1 | ~80,000 | Maximum context |

## Image Size Limits
**CRITICAL:** Resize images before sending to VLM - 4K images cause misreads!

### The Problem (Jan 2026)
4K smartphone images (4032×3024, ~1.3MB) cause VLM to:
- **Drop digits:** Odometer 167,443 → reads as 47,457 (missing leading digits)
- **Misread gauges:** Fuel at 75% → reads as 25%
- **Exceed token limits:** 400 errors with "decoder prompt is longer than maximum model length"

### The Solution
Resize to max **1280×960** before VLM processing:
```typescript
import sharp from 'sharp';

const VLM_MAX_WIDTH = 1280;
const VLM_MAX_HEIGHT = 960;
const VLM_JPEG_QUALITY = 85;

async function resizeImageForVlm(base64Image: string): Promise<string> {
  const inputBuffer = Buffer.from(base64Image, 'base64');
  const metadata = await sharp(inputBuffer).metadata();

  // Skip if already small enough
  if ((metadata.width || 0) <= VLM_MAX_WIDTH && (metadata.height || 0) <= VLM_MAX_HEIGHT) {
    return base64Image;
  }

  const resizedBuffer = await sharp(inputBuffer)
    .resize(VLM_MAX_WIDTH, VLM_MAX_HEIGHT, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: VLM_JPEG_QUALITY })
    .toBuffer();

  return resizedBuffer.toString('base64');
}
```

### Results After Fix
| Image | Original | Resized | Size Reduction |
|-------|----------|---------|----------------|
| Dashboard | 4032×3024 (1296KB) | 1280×960 (140KB) | 89% smaller |
| Fuel | 4032×3024 (905KB) | 1280×960 (139KB) | 85% smaller |

| Reading | 4K Result | Resized Result |
|---------|-----------|----------------|
| Odometer | 47,457 ❌ | 157,467 ✅ |
| Fuel | 25% ❌ | 85% ✅ |

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
- **Activate Module:** Photo categorization (`/api/activate/categorize-photos`) - PRIMARY
- **Fleet Check-In:** Odometer/fuel gauge reading (`/api/fleet/check-in/process-vlm`)
  - Service: `src/modules/fleet/services/fleetVlmService.ts` (has auto-resize)
  - Hook: `src/modules/fleet/check-in/hooks/useCheckIn.ts`
- **Fleet Portal:** License plate verification (`/api/fleet/portal/verify-plate`)
- **Staff Documents:** ID/License OCR (`/api/documents-ocr-preview`)

## Photo Categorization Performance (Jan 2026)
**Primary use case for the VLM - categorizing fibre installation photos.**

### Performance Stats (Jan 18, 2026)
| Metric | Value |
|--------|-------|
| Success Rate | **100%** |
| Average Confidence | **89-97%** |
| Photos Processed | 76 across 4 DRs |
| Categories | 10 installation steps |

### 10-Step Installation Categories
| Step | Category | Description |
|------|----------|-------------|
| 1 | House Photo | Wide shot of property exterior |
| 2 | Cable from Pole | Aerial cable run from pole to house |
| 3 | Cable Entry Outside | Where cable enters building exterior |
| 4 | Cable Entry Inside | Where cable comes through wall inside |
| 5 | Wall for Installation | Wall area prepared for ONT mounting |
| 6 | ONT Back After Install | Back of ONT showing connections |
| 7 | Power Meter Reading | Optical power meter display |
| 8 | Final Installation | Wide shot of complete setup |
| 9 | Green Lights on ONT | Front panel showing illuminated LEDs |
| 10 | Signature | Customer signature confirmation |

### VLM Response Structure
```json
{
  "vlm_predicted_step": 8,
  "vlm_predicted_category": "Final Installation",
  "vlm_confidence": 0.98,
  "vlm_identified_as": "Wide shot showing complete fiber installation...",
  "vlm_reasoning": "This matches Step 8: Wide shot of complete setup..."
}
```

### Database Storage
- **Table:** `dr_photo_unified_reviews`
- **Column:** `vlm_categorization_results` (JSONB array)
- **Status Column:** `vlm_categorization_status` (pending/categorized/approved)

### Service Location
- `src/modules/activate/services/categorizationVlmService.ts`
- Batches photos (max 6 per VLM call)
- Uses few-shot examples from human corrections (HITL learning)

### Historical Note
Jan 16 showed 238 errors (100% failure) due to URL parsing bug, not VLM capability.
After fix on Jan 18: 100% success rate with 89-97% confidence.

## Fleet Check-In VLM Flow
1. User takes photo → `processPhotoWithVlm()` called with temp IDs (preview mode)
2. VLM extracts value with auto-resize → form auto-filled
3. User submits → Record created with real ID
4. Photo uploaded → VLM re-called with real IDs to persist results
5. Results stored in `fleet_photo_vlm_results` and `fleet_odometer_history`

**Note:** Preview mode (`photoId.startsWith('temp-')`) skips DB persistence for instant feedback.

## Fleet Portal VLM Flow (Jan 2026)
**Page:** `/fleet/portal` - Mobile-first driver portal
**API:** `/api/fleet/portal/verify-plate`

### Verification Flow
1. Driver scans license plate photo
2. Image resized to 1024×768 (VLM token limit)
3. VLM extracts plate text with confidence score
4. Database lookup (exact match, then partial 6-char match)
5. Returns vehicle details + driver info + last readings + last check-in

### Portal Features After Verification
- **Vehicle Card:** Registration, make/model/year, color
- **Last Readings Card:** ODO (from history or check-in fallback), fuel level
- **Registered Driver Card:** Name, ID number, phone
- **Last Check-In Card:** Type, status, date, completed by
- **Check-In History Link:** `/fleet/vehicles/[id]/check-in-history`
- **Action Buttons:** Fuel Fill-up, Daily Check-In, Weekly Check-In

### ODO Reading Fallback (Jan 2026)
If `fleet_odometer_history` is empty, falls back to `fleet_check_records`:
```sql
SELECT odometer_reading, check_date
FROM fleet_check_records
WHERE vehicle_id = $1 AND odometer_reading IS NOT NULL
ORDER BY check_date DESC, created_at DESC
LIMIT 1
```

## Odometer Anomaly Detection
**Location:** `src/modules/fleet/check-in/hooks/useCheckIn.ts`

### Detection Rules
| Condition | Severity | Action |
|-----------|----------|--------|
| ODO decreased (e.g., 167k → 157k) | HIGH | Block submit until confirmed |
| ODO jump > 10,000 km | HIGH | Block submit until confirmed |
| ODO jump > 5,000 km | MEDIUM | Warning shown |

### How It Works
```typescript
const odometerAnomaly = useMemo((): ReadingAnomaly | null => {
  const difference = currentValue - lastOdometer.value;

  if (difference < 0) {
    return { severity: 'high', warning: `Decreased by ${Math.abs(difference)} km` };
  }
  if (difference > 10000) {
    return { severity: 'high', warning: `Increased by ${difference} km - suspicious` };
  }
  if (difference > 5000) {
    return { severity: 'medium', warning: `Large increase of ${difference} km` };
  }
  return null;
}, [formState.odometerReading, lastOdometer]);
```

### User Override Flow
1. Anomaly detected → Warning shown, submit blocked
2. User clicks "Confirm Override" → `confirmOdometerOverride()` called
3. `odometerOverrideConfirmed = true` → Submit allowed
4. Override logged with check-in record for audit

### Known VLM Misreading Pattern
**Problem:** VLM drops leading digits on 4K images
- Actual: 167,443 → VLM reads: 47,457 or 157,457
- **Cause:** Image too large, token truncation
- **Fix:** Resize to 1280×960 before VLM processing

## Fuel Gauge Reading (Jan 2026)
**Location:** `src/modules/fleet/services/fleetVlmService.ts`

### Improved Prompt Design
The fuel gauge prompt uses **categorical levels** for better accuracy:
- `empty` = 0%
- `1/4` = 25%
- `1/2` = 50%
- `3/4` = 75%
- `full` = 100%

### Key Prompt Elements
1. **Gauge identification:** Look for E/F markings + fuel pump icon
2. **Direction clarity:** E (Empty) on LEFT, F (Full) on RIGHT
3. **Needle focus:** Read where needle TIP points
4. **Categorical response:** Pick closest level from 5 options

### Response Format
```json
{
  "level_category": "1/4",
  "level": 25,
  "confidence": 0.85,
  "description": "needle between E and first mark"
}
```

### Benchmark Performance
| Test | Expected | Typical Result | Time |
|------|----------|----------------|------|
| image_fuel | 1/4 | 1/4 ✅ | ~90ms |

### Troubleshooting Fuel Misreads
1. **Image too large:** Resize to max 800×600 (benchmark uses this)
2. **Wrong gauge selected:** VLM may confuse with speedometer/temp gauge
3. **Inverted reading:** If reading E as F or vice versa, prompt needs clearer E-F orientation

## Related Files

### Activate Module (Photo Categorization)
- `src/modules/activate/services/categorizationVlmService.ts` - VLM categorization service
- `pages/api/activate/categorize-photos.ts` - Categorization API endpoint
- `pages/api/activate/approve-categorization.ts` - Human approval API
- `pages/activate/[dropNumber].tsx` - DR review page

### Fleet Module
- `pages/fleet/portal.tsx` - Driver portal page
- `pages/api/fleet/portal/verify-plate.ts` - Plate verification API
- `pages/fleet/vehicles/[id]/check-in-history.tsx` - Vehicle check-in history
- `pages/api/fleet/vehicles/[id]/check-records.ts` - Vehicle check records API
- `src/modules/fleet/services/fleetVlmService.ts` - VLM service with resize
- `src/modules/fleet/check-in/hooks/useCheckIn.ts` - Check-in with anomaly detection
