# VLM Learning Module

## Overview
Enterprise-wide VLM learning system that uses HITL (Human-in-the-Loop) corrections to improve VLM accuracy through few-shot prompting.

**Status**: WORKING - Phase 1 Complete
**Created**: 2026-02-04

## Key Features

1. **Correction Recording**: Automatically captures user corrections when VLM readings are overridden
2. **Few-Shot Learning**: Injects relevant past corrections into VLM prompts to prevent repeat mistakes
3. **Metrics Tracking**: Records extraction accuracy per module/analysis type
4. **Admin Dashboard**: Browse corrections, curate canonical examples, view accuracy trends

## Database Tables

### `vlm_corrections`
Stores all HITL corrections across modules.

| Column | Type | Description |
|--------|------|-------------|
| module | VARCHAR(50) | 'activate', 'fleet', 'procurement', 'assets', 'staff' |
| analysis_type | VARCHAR(100) | 'odometer', 'ont_serial_back', 'power_meter', etc. |
| vlm_extracted_value | TEXT | What VLM extracted (incorrect) |
| corrected_value | TEXT | Human-corrected value (ground truth) |
| error_pattern | VARCHAR(50) | Classified error type (digit_1_6, ssid_not_serial, etc.) |
| is_canonical | BOOLEAN | High-quality example for few-shot priority |
| context_json | JSONB | Module-specific context for similarity matching |

### `vlm_metrics`
Daily aggregated metrics for accuracy tracking.

| Column | Type | Description |
|--------|------|-------------|
| metric_date | DATE | Date of metrics |
| module | VARCHAR(50) | Module name |
| analysis_type | VARCHAR(100) | Analysis type |
| total_extractions | INTEGER | Total attempts |
| correct_extractions | INTEGER | Correct without correction |
| corrected_extractions | INTEGER | Corrected by human |

## Analysis Types by Module

### Activate
- `photo_categorization` - Installation step assignment
- `power_meter_dbm` - Power meter reading extraction
- `ont_serial_back` - Serial from ONT back label
- `ont_serial_front` - Serial from ONT front label
- `dr_number` - DR number extraction

### Fleet
- `odometer` - Odometer reading
- `license_plate` - License plate verification
- `fuel_gauge` - Fuel level reading
- `fuel_receipt` - Receipt data extraction
- `license_disk` - License disk details

### Procurement
- `quote_supplier` - Supplier information
- `quote_line_item` - Line item extraction
- `quote_totals` - Totals extraction
- `po_header` - PO number, reference, date
- `po_quantity` - Quantity/drops extraction
- `po_pricing` - Unit price, subtotal, VAT, total

## Integration Points

### Fleet Module
```typescript
// In fleetVlmService.ts - extractOdometerReading()
// Automatically:
// 1. Gets few-shot examples before extraction
// 2. Injects examples into VLM prompt
// 3. Records successful extraction metrics
```

### Photos API (Fleet)
```typescript
// In pages/api/fleet/check-in/photos.ts
// When photoType === 'odometer_override':
// Records correction to vlm_corrections table
```

### Activate Module
```typescript
// In vlmExtractionService.ts
// extractPowerMeterReading() and extractOntSerialFromBackViaVlm()
// Use few-shot learning + metrics recording
```

### Procurement Module
```typescript
// In quoteExtractionService.ts
// extractQuoteFromImage() uses few-shot learning

// In poExtractionService.ts
// extractPOFromImage() uses few-shot learning for:
// - po_header: PO number, reference, date
// - po_quantity: Quantity/drops extraction
// - po_pricing: Unit price, totals
//
// recordPOFormCorrections() records user corrections for learning
```

## API Endpoints

### GET /api/system/vlm/corrections
List corrections with filtering.

Query params:
- `module` - Filter by module
- `analysisType` - Filter by analysis type
- `errorPattern` - Filter by error pattern
- `isCanonical` - Filter canonical only
- `limit`, `offset` - Pagination

### POST /api/system/vlm/corrections
Record a new correction.

Body:
```json
{
  "module": "fleet",
  "analysisType": "odometer",
  "vlmExtractedValue": "163245",
  "correctedValue": "168245",
  "correctionReason": "digit_confusion"
}
```

### PATCH /api/system/vlm/corrections
Update correction (mark canonical, etc.).

Body:
```json
{
  "id": "uuid",
  "isCanonical": true,
  "priority": 90
}
```

### GET /api/system/vlm/metrics
Get accuracy metrics.

Query params:
- `summary=modules` - Get module-level summaries
- `module`, `analysisType` - Filter
- `dateFrom`, `dateTo` - Date range

## Admin UI

**URL**: `/system/vlm-learning`

### Overview Tab
- Overall stats (extractions, correct, corrected, failed)
- Module accuracy cards with trend indicators
- **Accuracy trend chart** (30-day line chart using recharts)
- Common error patterns table

### Corrections Tab
- Filterable list of all corrections
- Actions: Mark canonical, Delete

### Canonical Tab
- Curated high-quality examples
- These are prioritized in few-shot prompts

## Error Patterns

| Pattern | Description | Example |
|---------|-------------|---------|
| `digit_1_6` | 1↔6 confusion | 163245 vs 168245 |
| `digit_1_7` | 1↔7 confusion | 174582 vs 114582 |
| `digit_6_8` | 6↔8 confusion | Similar shapes |
| `ssid_not_serial` | SSID extracted instead of serial | ALHN-C397 vs ALCLB6A9C97 |
| `gauge_reversed` | Fuel gauge read backwards | 75% vs 25% |

## Usage in Code

### Record a correction
```typescript
import { recordVlmCorrection } from '@/services/vlmLearningService';

await recordVlmCorrection({
  module: 'fleet',
  analysisType: 'odometer',
  vlmExtractedValue: '163245',
  correctedValue: '168245',
  correctionReason: 'digit_confusion',
  context: { vehicleId, recordId },
  correctedByName: driverName,
});
```

### Get few-shot examples
```typescript
import { getVlmFewShotExamples, buildVlmFewShotPrompt } from '@/services/vlmLearningService';

const examples = await getVlmFewShotExamples({
  module: 'fleet',
  analysisType: 'odometer',
  maxExamples: 3,
  prioritizeCanonical: true,
});

const fewShotSection = buildVlmFewShotPrompt(examples);
const enhancedPrompt = `${BASE_PROMPT}\n\n${fewShotSection}`;
```

### Record successful extraction
```typescript
import { recordCorrectExtraction } from '@/services/vlmLearningService';

if (result.confidence >= 0.7) {
  recordCorrectExtraction('fleet', 'odometer', result.confidence).catch(() => {});
}
```

## Files

| File | Purpose |
|------|---------|
| `scripts/migrations/160_vlm_learning_system.sql` | Database schema |
| `src/types/vlm-learning.ts` | TypeScript types |
| `src/services/vlmLearningService.ts` | Core service |
| `pages/api/system/vlm/corrections.ts` | Corrections API |
| `pages/api/system/vlm/metrics.ts` | Metrics API |
| `pages/system/vlm-learning.tsx` | Admin UI |
