---
name: vlm-accuracy
description: VLM extraction accuracy improvement — autoresearch loop for all VLM-extracted data (serials, power meter, plates, odometer, fuel, categorization, QA)
version: 2.0.0
triggers:
  - /vlm-accuracy
  - vlm accuracy
  - autoresearch
  - vlm autoresearch
  - improve VLM
  - improve extraction
  - serial accuracy
  - ONT serial accuracy
  - UPS serial
  - power meter accuracy
  - odometer accuracy
  - plate reading accuracy
  - fuel gauge accuracy
  - categorization accuracy
  - VLM errors
  - VLM confusion
  - VLM corrections
  - fix extraction
  - retest VLM
---

# /vlm-accuracy — VLM Extraction Accuracy

Systematic accuracy improvement loop for ALL VLM-extracted data across FibreFlow modules. Uses ground truth sources (OES, vehicle records, human QA) to measure, diagnose, and improve extraction accuracy.

USE WHEN user says "improve VLM accuracy", "autoresearch", "serial extraction errors", "retest VLM", "analyze confusion patterns", OR wants to measure, diagnose, or improve any VLM extraction type.

## Quick Reference

| Item | Value |
|------|-------|
| **VLM Service** | `http://100.96.203.105:8100` (Qwen3-VL-8B-Instruct) |
| **Learning Service** | `src/services/vlmLearningService.ts` |
| **Corrections Table** | `vlm_corrections` (all modules) |
| **Metrics Table** | `vlm_metrics` (daily aggregation) |

## Slash Commands

```
/vlm-accuracy                       # Show accuracy stats across all extraction types
/vlm-accuracy autoresearch [type]   # Run full autoresearch loop for a type
/vlm-accuracy retest [type]         # Re-test mismatches with current prompts
/vlm-accuracy analyze [type]        # Analyze confusion patterns
/vlm-accuracy stats                 # DB accuracy stats
```

Where `[type]` = `serial` | `power` | `odometer` | `plate` | `fuel` | `categorization` | `all`

---

## All VLM Extraction Types

### Activate Module

| Type | Data | Photo | Service File | Prompt Constant | Ground Truth |
|------|------|-------|-------------|-----------------|--------------|
| **ONT Serial (Step 6)** | 12-char `ALCLB4...` | ONT back label | `vlmExtractionService.ts` | `ONT_SERIAL_BACK_PROMPT` | OES import (auto) |
| **ONT Serial (Step 9)** | 12-char `ALCLB4...` | ONT front sticker | `vlmExtractionService.ts` | `STEP9_FRONT_PROMPT` | OES import (auto) |
| **ONT Serial (WA)** | 12-char `ALCLB4...` | WhatsApp photo | `vlmExtractionService.ts` | `WA_PHOTO_SERIAL_PROMPT` | OES import (auto) |
| **UPS Serial (WA)** | `GU18W...` 13-15 chars | WhatsApp photo | `vlmExtractionService.ts` | `WA_PHOTO_SERIAL_PROMPT` | Manual (none) |
| **Power Meter** | dBm value (-5 to -35) | Step 7 display | `vlmExtractionService.ts` | `POWER_METER_PROMPT` | OES/manual |
| **DR Number** | `DR` + 6-7 digits | Step 9 label | `vlmExtractionService.ts` | `STEP9_FRONT_PROMPT` | DR submission |
| **Green Lights** | boolean | Step 9 front | `vlmExtractionService.ts` | `STEP9_FRONT_PROMPT` | Manual review |
| **Photo Categorization** | Step 1-10 | Any DR photo | `categorizationVlmService.ts` | `buildCategorizationPrompt()` | Human override |
| **Serial Confirmation** | Verify known serial | Any step | `vlmExtractionService.ts` | `buildSerialConfirmationPrompt()` | OES serial |

### Fleet Module

| Type | Data | Photo | Service File | Prompt Constant | Ground Truth |
|------|------|-------|-------------|-----------------|--------------|
| **License Plate** | SA plate text | Front/rear photo | `fleetVlmService.ts` | `LICENSE_PLATE_PROMPT` | Vehicle registration |
| **Odometer** | km reading (5-6 digits) | Dashboard photo | `fleetVlmService.ts` | `ODOMETER_PROMPT` | Previous reading + calibration |
| **Fuel Gauge** | 0-100% level | Gauge photo | `fleetVlmService.ts` | `FUEL_GAUGE_PROMPT` | Receipt reconciliation |
| **Fuel Receipt** | ZAR, litres, date, station | Receipt photo | `fleetVlmService.ts` | `FUEL_RECEIPT_PROMPT` | Accounting ledger |
| **License Disk** | VIN, expiry, make, etc. | Disk photo | `fleetVlmService.ts` | `LICENSE_DISK_PROMPT` | Vehicle record |

### Construction QA Module

| Type | Data | Photo | Service File | Prompt Constant | Ground Truth |
|------|------|-------|-------------|-----------------|--------------|
| **Construction QA** | Pass/fail + issues | Checklist step | `vlmConstructionService.ts` | `buildPhotoPrompt()` | Human QA reviewer |

### NOC Module

| Type | Data | Photo | Service File | Prompt Constant | Ground Truth |
|------|------|-------|-------------|-----------------|--------------|
| **DevOps Screenshot** | Error metadata, module, URL | Bug screenshot | `pages/api/noc/devops-vlm-analyse.ts` | `ANALYSIS_PROMPT` | Manual ticket review |

---

## Autoresearch Methodology

The same 6-step loop applies to ANY extraction type. Swap the ground truth source and query for each type.

### Step 1: Measure — Get Current Accuracy

Pick the extraction type and run the appropriate accuracy query.

**ONT Serials (vs OES):**
```bash
npx tsx -e "
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  const rows = await sql.query(\`
    SELECT
      COUNT(*) FILTER (WHERE UPPER(TRIM(r.vlm_ont_serial_step6)) = UPPER(TRIM(r.oes_serial))) as s6_match,
      COUNT(*) FILTER (WHERE r.vlm_ont_serial_step6 IS NOT NULL) as s6_total,
      COUNT(*) FILTER (WHERE UPPER(TRIM(r.vlm_ont_serial_step9)) = UPPER(TRIM(r.oes_serial))) as s9_match,
      COUNT(*) FILTER (WHERE r.vlm_ont_serial_step9 IS NOT NULL) as s9_total
    FROM dr_photo_unified_reviews r
    JOIN oes_activations o ON o.drop_number = r.drop_number
    WHERE o.created_at >= (NOW() - INTERVAL '14 days')
      AND r.oes_serial IS NOT NULL AND r.oes_serial <> ''
  \`);
  const r = rows[0];
  console.log('Step 6: ' + r.s6_match + '/' + r.s6_total + ' = ' + ((r.s6_match/r.s6_total)*100).toFixed(1) + '%');
  console.log('Step 9: ' + r.s9_match + '/' + r.s9_total + ' = ' + ((r.s9_match/r.s9_total)*100).toFixed(1) + '%');

  const wa = await sql.query(\`
    WITH wa_best AS (
      SELECT DISTINCT ON (drop_number) drop_number, vlm_ont_serial
      FROM wa_photos WHERE purpose = 'activation' AND vlm_processed = true AND vlm_ont_serial IS NOT NULL
        AND message_timestamp >= (NOW() - INTERVAL '14 days')
      ORDER BY drop_number, vlm_confidence DESC NULLS LAST
    )
    SELECT COUNT(*) as total,
      COUNT(*) FILTER (WHERE UPPER(TRIM(w.vlm_ont_serial)) = UPPER(TRIM(o.serial_number))) as matched
    FROM wa_best w JOIN oes_activations o ON o.drop_number = w.drop_number
    WHERE o.created_at >= (NOW() - INTERVAL '14 days')
  \`);
  console.log('WA: ' + wa[0].matched + '/' + wa[0].total + ' = ' + ((wa[0].matched/wa[0].total)*100).toFixed(1) + '%');
}
main().catch(console.error);
"
```

**License Plates (vs vehicle registration):**
```sql
SELECT COUNT(*) FILTER (WHERE plate_matches_vehicle = true) as matched,
       COUNT(*) as total
FROM fleet_photo_vlm_results
WHERE extraction_type = 'license_plate'
  AND created_at >= NOW() - INTERVAL '14 days';
```

**Odometer (vs previous + calibration):**
```sql
SELECT COUNT(*) FILTER (WHERE confidence >= 0.8) as high_conf,
       COUNT(*) FILTER (WHERE flagged_anomaly = true) as anomalies,
       COUNT(*) as total
FROM fleet_odometer_history
WHERE created_at >= NOW() - INTERVAL '14 days';
```

**Photo Categorization:**
```sql
SELECT COUNT(*) FILTER (WHERE human_override_step IS NOT NULL AND human_override_step = vlm_predicted_step) as correct,
       COUNT(*) FILTER (WHERE human_override_step IS NOT NULL) as reviewed,
       COUNT(*) as total
FROM (
  SELECT (jsonb_array_elements(vlm_categorization_results)->>'vlm_predicted_step')::int as vlm_predicted_step,
         (jsonb_array_elements(vlm_categorization_results)->>'human_override_step')::int as human_override_step
  FROM dr_photo_unified_reviews
  WHERE vlm_categorization_results IS NOT NULL
    AND created_at >= NOW() - INTERVAL '14 days'
) sub;
```

### Step 2: Retest — Re-run VLM on Mismatches

**Serials:**
```bash
npx tsx scripts/retest-vlm-serials.ts --limit 50 --step both --since $(date -d '14 days ago' +%Y-%m-%d)
```

**Other types:** Create a retest script following the same pattern:
1. Query mismatches from DB (VLM value ≠ ground truth)
2. Fetch the original photo
3. Re-run VLM with current prompt
4. Compare old vs new vs ground truth
5. Report: fixed, still wrong, now null, auto-fix impact

### Step 3: Analyze — Build Confusion Matrix

**Serials:**
```bash
npx tsx scripts/analyze-confusion-patterns.ts
```

**Other types:** Query `vlm_corrections` for the relevant `analysis_type`:
```sql
SELECT error_pattern, COUNT(*) FROM vlm_corrections
WHERE module = 'activate' AND analysis_type = 'power_meter_dbm'
GROUP BY error_pattern ORDER BY 2 DESC;
```

### Step 4: Diagnose — Identify Root Causes

Common error categories across ALL extraction types:

| Category | Description | Fix Strategy |
|----------|-------------|-------------|
| **Wrong stats in prompt** | Prompt claims distribution that doesn't match reality | Query ground truth, update prompt |
| **Hallucinated defaults** | VLM outputs same wrong value when unreadable | Add to blocklist |
| **Wrong photo** | User uploaded wrong photo for this step | Cross-reference with DR/expected data |
| **Genuine OCR ambiguity** | Chars look identical at photo resolution | Accept limit, ground truth corrects |
| **Character dropping** | VLM returns shorter string than expected | Normalize function recovery |
| **Non-valid chars** | VLM reads decorative/noise chars | OCR correction in normalize |
| **Display format confusion** | VLM misinterprets display layout | Better prompt with display examples |

### Step 5: Apply — Edit Prompts, Validation, Learning

For each extraction type, the improvement targets are:

| Target | File | What to Change |
|--------|------|---------------|
| **Prompt** | Service file (see table above) | Statistical hints, anti-patterns, validation checklist |
| **Normalize** | Same service file | Post-extraction cleanup, OCR corrections |
| **Validate** | Same service file | Format checks, hallucination blocklist |
| **Few-shot** | `vlmLearningService.ts` | Error pattern classification, example injection |

### Step 6: Iterate — Re-test, Commit, Deploy

```bash
# Re-test after changes (dry run)
npx tsx scripts/retest-vlm-serials.ts --limit 50 --step both

# If improved: commit → PR → merge → deploy dev
# Monitor 1-2 days, then promote to production
```

---

## ONT Serial Deep-Dive

The most actively researched extraction type. Full reference below.

### Serial Format (OES-Confirmed from 12,575 serials)

All Nokia ONT serials: `ALCLB4` + 6 hex chars = exactly 12 characters.

**Position 7**: `8` = 64.3%, `7` = 25.9%, `6` = 9.7%

**Top 2-char patterns** (positions 7-8):
`8D` = 19.8%, `77` = 15.1%, `8C` = 11.9%, `8A` = 8.9%, `80` = 6.6%, `8F` = 6.0%

**CRITICAL**: Never claim position 7 is "always 8" — this caused 755+ errors.

### Key Files

| Section | File | Purpose |
|---------|------|---------|
| `ONT_SERIAL_BACK_PROMPT` | `vlmExtractionService.ts` ~173 | Step 6 prompt |
| `STEP9_FRONT_PROMPT` | `vlmExtractionService.ts` ~217 | Step 9 prompt |
| `WA_PHOTO_SERIAL_PROMPT` | `vlmExtractionService.ts` ~1391 | WA photo prompt |
| `normalizeSerial()` | `vlmExtractionService.ts` ~344 | OCR correction + auto-insert |
| `isValidOntSerial()` | `vlmExtractionService.ts` ~305 | Format validation + blocklist |
| `PROMPT_EXAMPLE_SERIALS` | `vlmExtractionService.ts` ~1432 | Hallucination blocklist |
| `recordVlmCorrectionsFromOes()` | `import-oes.ts` | Auto-correction on OES import |

### Retest Scripts

| Script | Purpose |
|--------|---------|
| `scripts/retest-vlm-serials.ts` | Re-test mismatches with current prompts |
| `scripts/analyze-confusion-patterns.ts` | Build confusion matrix from corrections |
| `scripts/test-confirmation-pass.ts` | Test two-pass approach (proven NOT to help) |
| `scripts/backfill-vlm-corrections-from-oes.ts` | One-time backfill of historical corrections |

### Refreshing Statistics

Always derive from OES ground truth before updating prompts:
```bash
npx tsx -e "
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local' });
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  const rows = await sql\`
    SELECT oes_serial FROM dr_photo_unified_reviews
    WHERE oes_serial IS NOT NULL AND oes_serial <> ''
      AND LENGTH(TRIM(oes_serial)) = 12 AND UPPER(LEFT(TRIM(oes_serial), 6)) = 'ALCLB4'
  \`;
  const c7: Record<string, number> = {};
  const c78: Record<string, number> = {};
  for (const r of rows) {
    const s = r.oes_serial.trim().toUpperCase();
    c7[s[6]] = (c7[s[6]] || 0) + 1;
    c78[s[6]+s[7]] = (c78[s[6]+s[7]] || 0) + 1;
  }
  const total = rows.length;
  console.log('Pos 7: ' + Object.entries(c7).sort((a,b)=>b[1]-a[1]).map(([c,n])=>c+'='+((n/total)*100).toFixed(1)+'%').join(', '));
  console.log('Pos 7+8: ' + Object.entries(c78).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([c,n])=>c+'='+((n/total)*100).toFixed(1)+'%').join(', '));
  console.log('Total: ' + total);
}
main().catch(console.error);
"
```

---

## Fleet VLM Deep-Dive

### Odometer — Multi-Pass Verification

Fleet odometer uses a unique **two-pass approach** that DOES work (unlike serial confirmation):
1. Pass 1: Standard extraction
2. Pass 2: Re-extract with slightly different prompt angle
3. Compare: if passes disagree by >1%, flag as low confidence

This works because odometer digits (0-9 on a fixed display) have less ambiguity than serial labels.

### License Plate — Expected Plate Context

Plate extraction benefits from **confirmation mode**: the vehicle's registered plate is known, so the VLM just needs to verify it matches (or flag if different vehicle is in photo).

### Fuel Gauge — Categorical Not Numeric

Fuel gauge is better modeled as categories (E, 1/4, 1/2, 3/4, F) than continuous 0-100%. The VLM is more accurate with categorical labels.

---

## The Feedback Loop Architecture

```
  Photos ──→ VLM Extraction ──→ Extracted Value in DB
                   ↑                       │
                   │                       ↓
         Few-shot examples      Ground Truth Arrives
                   ↑              (OES / vehicle reg / human QA)
                   │                       │
                   │                       ↓
         vlm_corrections ←── Compare & Record Mismatch
                   │
                   ↓
         Error pattern analysis
                   │
                   ↓
         Prompt / validation improvements
```

Ground truth sources by module:
- **Activate serials**: OES import (next day, automated)
- **Activate power meter**: OES expected values
- **Fleet plates**: Vehicle registration DB
- **Fleet odometer**: Previous reading + calibration baseline
- **Fleet fuel**: Receipt cross-reference + accounting
- **Construction QA**: Human reviewer corrections
- **Photo categorization**: Human override in UI
- **NOC screenshots**: Manual ticket review

---

## Database

### vlm_corrections (central learning table)

```sql
-- All corrections across modules
SELECT module, analysis_type, error_pattern, COUNT(*)
FROM vlm_corrections
GROUP BY 1, 2, 3 ORDER BY 4 DESC;

-- Recent corrections rate
SELECT DATE(created_at), module, COUNT(*) as corrections
FROM vlm_corrections
WHERE created_at >= NOW() - INTERVAL '14 days'
GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC;
```

### vlm_metrics (daily aggregation)

```sql
SELECT date, module, analysis_type, total_extractions, correct_extractions,
       ROUND(correct_extractions::numeric / NULLIF(total_extractions, 0) * 100, 1) as accuracy
FROM vlm_metrics
WHERE date >= CURRENT_DATE - 14
ORDER BY date DESC, module;
```

---

## Accuracy Targets

| Extraction Type | Current | Target | Ground Truth |
|----------------|---------|--------|-------------|
| ONT Serial Step 6 | ~83% | 90%+ | OES (auto) |
| ONT Serial Step 9 | ~56% | 70%+ | OES (auto) |
| ONT Serial WA | ~97% | 98%+ | OES (auto) |
| Power Meter | ~90% | 95%+ | OES |
| Photo Categorization | ~85% | 90%+ | Human override |
| License Plate | ~95% | 98%+ | Vehicle registration |
| Odometer | ~92% | 95%+ | Previous + calibration |
| Fuel Gauge | ~80% | 85%+ | Receipt cross-ref |
| Construction QA | ~75% | 85%+ | Human QA reviewer |

*Figures approximate — run measurement queries for current values.*

---

## Anti-Patterns (DO NOT)

- **Don't claim statistics without evidence** — always derive from ground truth queries
- **Don't use two-pass confirmation for serials** — proven NOT to help (VLM returns same answer)
- **Don't build statistical post-hoc correctors for serials** — confusion too spread out
- **Don't auto-insert characters blindly** — only when position rules are well-established
- **Don't bias prompts with "almost always X"** — give actual percentages
- **Don't modify prompts without measuring before AND after** — use retest scripts

## Research History

| Date | Type | Change | Impact |
|------|------|--------|--------|
| 2026-03-13 | Serial | Corrected position-7 stats (98%→64%) | Fixed 755+ false corrections |
| 2026-03-13 | Serial | Updated top-pattern stats from OES | Removed ALCLB48F=79% bias |
| 2026-03-13 | Serial | Fixed normalizeSerial() auto-insert | No longer blindly inserts "8" |
| 2026-03-12 | Serial | Added few-shot learning to Step 9 | Improved context |
| 2026-03-12 | Serial | Expanded hallucination blocklist to 10 | Blocks known bad defaults |
| 2026-03-12 | Serial | Closed OES auto-correction loop | Corrections recorded automatically |
| 2026-03-12 | Serial | Backfilled 7,878 historical corrections | Large training set |
