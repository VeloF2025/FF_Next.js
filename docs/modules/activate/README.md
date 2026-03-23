# Activate Module

The Activate module handles ONT (Optical Network Terminal) serial number extraction and validation through VLM (Vision Language Model) analysis of installation photos. This module powers the activation workflow for FibreFlow installations.

## Overview

The activate module processes two primary data sources:
1. **Installation photos** (Step 6 back-panel, Step 9 front-panel, WhatsApp submissions)
2. **OES ground truth data** (from OES/activation systems)

It validates VLM extractions against OES records and maintains a correction history for continuous improvement.

## Features

### VLM Serial Extraction

The module extracts ONT serial numbers from photos using Vision Language Models. Serial extraction is calibrated against 12,575 OES-confirmed serials with the following characteristics:

#### Serial Format
- **Format:** `ALCLB4` + 6 hex characters = 12 characters total
- **Position 7 distribution** (OES ground truth):
  - "8": 64% of devices
  - "7": 26% of devices  
  - "6": 10% of devices
  
⚠️ **Critical:** Do NOT assume position 7 is always "8". Read the actual character from the device label.

#### Top Serial Patterns
Based on OES analysis of 12,575 devices:
1. ALCLB48D: 20%
2. ALCLB477: 15%
3. ALCLB48C: 12%
4. ALCLB48A: 9%
5. ALCLB48F: 6%

**Previous assumption (INCORRECT):** ALCLB48F represented 79% of devices. This was a VLM bias that caused 755+ extraction errors.

### Extraction Methods

#### Step 6 - Back Panel Extraction
Reads the S/N field from the white product label on the device's back panel.

**Validation Checklist:**
- Exactly 12 characters
- Starts with `ALCLB4`
- Position 7 is "8", "7", or "6" (read carefully)
- All characters after ALCLB4 are hex (0-9, A-F)
- No non-hex letters (M, N, P, R, S, Y, Z indicate OCR errors)

#### Step 9 - Front Panel Extraction
Extracts serial from the front-mounted sticker label.

**Additional information captured:**
- Green status lights visible (POWER, PON, LAN, WLAN)
- DR number (if present)

#### WhatsApp Photo Extraction
Extracts serials from installation photos submitted via WhatsApp, including both:
- ONT serial (primary)
- UPS serial (secondary, format: `GU18W` + 8-10 alphanumeric characters)

### Serial Normalization

The `normalizeSerial()` function applies intelligent corrections:

1. **Character normalization:**
   - G, I → 6 (common OCR confusion)
   - O → 0
   - S → 5
   - Z → 2

2. **Length correction (11→12 chars):**
   - Only inserts "8" if position 7 is NOT already a valid position-7 value (8/7/6)
   - If position 7 is already 8, 7, or 6, does NOT insert (VLM read it correctly, just lost a different char)
   - This prevents double-corrections

3. **Validation:**
   - Rejects hallucinated serials (common model confusions)
   - Rejects SSID-like serials (start with ALHN-)
   - Enforces hex-only suffix

### Correction Tracking

All VLM mismatches are logged in the `vlm_corrections` table with:
- Original VLM extraction
- OES ground truth
- Error pattern identification
- Context (photo filename, DR, timestamp)

This enables post-hoc analysis and continuous model improvement.

## Quality Metrics

### Confusion Matrix Analysis
The module tracks character confusion patterns across all corrections:
- Position-specific confusion rates
- Top confusion pairs (e.g., 8↔B, 0↔D)
- Accuracy by position

### Testing & Validation

Research scripts validate VLM accuracy:
- **retest-vlm-serials.ts:** Re-extracts serials from recent mismatched DRs with improved prompts
- **analyze-confusion-patterns.ts:** Builds confusion matrices by position and character
- **test-confirmation-pass.ts:** Tests two-pass extraction (initial + confirmation for ambiguous characters)

## Recent Changes

### Commit 5f6b2bc - VLM Position-7 Bias Fix

**Problem:** VLM prompts incorrectly claimed position 7 was "8" in 98% of devices, when OES ground truth shows only 64%.

**Solution:** 
- Updated all VLM prompts (Step 6, Step 9, WA) with accurate position-7 statistics
- Fixed `normalizeSerial()` auto-insert logic to only insert "8" when position 7 isn't already 8/7/6
- Removed misleading "don't assume 8" override
- Added accurate top-pattern frequencies

**Impact:**
- Eliminates 755+ errors caused by position-7 bias
- Improves extraction accuracy by reading actual device labels instead of following false statistical assumptions
- Foundation for continuous improvement through confusion matrix analysis

## Database Tables

### vlm_corrections
Tracks all VLM extraction errors and corrections:
- `vlm_extracted_value`: Original VLM output
- `corrected_value`: OES ground truth
- `error_pattern`: Classification (e.g., "position_7_confusion")
- `context_json`: Photo metadata, DR number, timestamp
- `module`: "activate" or other modules

### dr_photo_unified_reviews
Main extraction results:
- `vlm_ont_serial_step6`: Step 6 extracted serial
- `vlm_ont_serial_step9`: Step 9 extracted serial
- `oes_serial`: Ground truth from OES/activation
- `serial_extraction_method_step6/step9`: Method used (vlm, manual, etc.)
- `vlm_categorization_results`: Step classification confidence
- `photos_metadata`: Photo filenames and metadata

## Development Guide

### Adding New Serial Extraction Features

1. Update the relevant VLM prompt (ONT_SERIAL_BACK_PROMPT, STEP9_FRONT_PROMPT, or WA_PHOTO_SERIAL_PROMPT)
2. Add validation logic to `isValidOntSerial()`
3. Test against `vlm_corrections` mismatches using research scripts
4. Log results in `vlm_corrections` table
5. Monitor confusion patterns via `analyze-confusion-patterns.ts`

### Improving Extraction Accuracy

1. **Analyze failures:** Use `analyze-confusion-patterns.ts` to identify systematic errors
2. **Test fixes:** Use `retest-vlm-serials.ts` to validate improvements on real data
3. **Validate impact:** Measure false positive/negative rates before deploying
4. **Document findings:** Update this README with new patterns or correction strategies

## See Also

- VLM Service: `/src/modules/activate/services/vlmExtractionService.ts`
- Research Scripts: `/scripts/` directory
- OES Integration: Activation module integration points
- Photo Processing: DR photo workflow

---

**Last updated:** March 13, 2026 (Commit 5f6b2bc)
