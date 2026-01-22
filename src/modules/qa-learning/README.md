# QA Learning Module

HITL (Human-In-The-Loop) few-shot learning for VLM tasks without fine-tuning.

## Two Learning Systems

### 1. Photo Categorization Learning (Step-Based)
For photo categorization workflows (DR Photo QA, Civil Works, Optical Works).

```
VLM predicted Step X → Human corrected to Step Y → Few-shot examples
```

**Table:** `qa_correction_examples`
**Migration:** `scripts/migrations/084_qa_correction_examples.sql`

### 2. OCR Field Extraction Learning (Field-Based) - NEW
For document OCR across any module (Staff Documents, Fleet Check-in, Activate).

```
VLM extracted "ABC" → Human corrected to "XYZ" → Few-shot examples
```

**Table:** `ocr_field_corrections`
**Migration:** `scripts/migrations/110_ocr_field_corrections.sql`

## Quick Start - Photo Categorization

```typescript
import {
  recordCorrection,
  getRelevantExamples,
  buildFewShotPromptSection,
  hasCorrections,
} from '@/modules/qa-learning';

if (await hasCorrections('dr_photo')) {
  const { examples } = await getRelevantExamples({
    workflowType: 'dr_photo',
    maxExamples: 5,
  });
  const promptSection = buildFewShotPromptSection(examples);
}
```

## Quick Start - OCR Field Extraction

```typescript
import {
  recordOcrCorrection,
  getOcrFewShotExamples,
  buildOcrFewShotPrompt,
} from '@/modules/qa-learning';

// Record a correction when human edits OCR data
await recordOcrCorrection({
  moduleName: 'staff_documents',
  documentType: 'sa_id',
  fieldName: 'saIdNumber',
  vlmExtractedValue: '780203S087081', // VLM's extraction (S vs 5 error)
  correctedValue: '7802035087081',    // Human's correction
  correctedBy: 'user@example.com',
});

// Get few-shot examples for VLM prompt
const examples = await getOcrFewShotExamples('staff_documents', 'sa_id');
const promptSection = buildOcrFewShotPrompt(examples, 'sa_id');
```

## Supported Modules

### Staff Documents (`staff_documents`)
- `sa_id` - SA ID number, full name, DOB
- `passport` - Passport number, expiry, country
- `drivers_license` - License number, codes, expiry
- `bank_confirmation` - Account number, bank name, branch code

### Fleet Check-in (`fleet_checkin`)
- `license_plate` - Vehicle registration
- `odometer` - Odometer reading
- `fuel_gauge` - Fuel level

### Activate (`activate`)
- `power_meter` - dBm readings
- `ont_serial` - ONT serial numbers
- `ups_serial` - UPS serial numbers

## Integration Points

- **Staff Documents:** `pages/api/staff-documents/[documentId]/verify.ts` - Records corrections on approval
- **Fleet Check-in:** `src/modules/fleet/services/fleetVlmService.ts` - Enhances VLM prompts
- **Activate:** `src/modules/activate/services/vlmExtractionService.ts` - Enhances extraction prompts

## Selection Strategy (Photo Categorization)

Priority order:
1. **Canonical** - Curated high-quality examples
2. **Confusion pairs** - Steps 3↔4, 6↔8, 1↔8, 6↔9
3. **High-confidence mistakes** - VLM >80% confident but wrong
4. **Recent** - Last 30 days

## Selection Strategy (OCR Field Extraction)

Priority order:
1. **Canonical** - Curated high-quality examples
2. **High reviewed count** - Multiple reviewers agreed
3. **High confidence mistakes** - VLM confident but wrong
4. **Recent** - Latest corrections

## Files

- `types/learning.types.ts` - Photo categorization types
- `services/correctionService.ts` - Photo correction storage
- `services/fewShotService.ts` - Photo few-shot selection
- `services/ocrLearningService.ts` - **NEW** OCR field extraction learning
- `index.ts` - Public exports
