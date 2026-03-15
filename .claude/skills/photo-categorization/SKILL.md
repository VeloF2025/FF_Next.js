---
name: photo-categorization
description: Photo categorization reference. Canonical mapping between OneMap photo types and the unified 10-step installation checklist. USE WHEN working on photo type mapping, step mapping, or categorization issues.
user-invocable: false
---

# Photo Categorization Skill

Single source of truth for photo type → step mapping in the Activate module.

## Purpose

Manage the canonical mapping between OneMap photo types (`ph_*`) and the unified 10-step installation checklist. This skill prevents mapping bugs by providing authoritative reference.

## When to Activate

**Trigger phrases**:
- "photo type mapping"
- "step mapping"
- "categorization wrong"
- "wrong step number"
- "ph_ types"
- "stepMapper"
- Editing `stepMapper.ts` or `fetch-photos.ts`

## Canonical Photo Type → Step Mapping

**AUTHORITATIVE REFERENCE** - All code MUST match this table:

| Step | Label | 1Map Types | Description |
|------|-------|------------|-------------|
| 1 | House Photo | `ph_prop` | Photo of Property |
| 2 | Cable from Pole | `ph_pole`, `ph_outs` | Outside cable span: Pole to Pigtail screw |
| 3 | Entry Outside | `ph_entry_out`, `ph_hm_ln` | Home Entry Point: Outside |
| 4 | Entry Inside | `ph_entry_in`, `ph_hm_en` | Home entry point - Inside |
| 5 | Wall | `ph_wall` | Photo Showing Location on the Wall |
| 6 | ONT Back | `ph_ont`, `ph_ont_back`, `ph_drop`, `ph_cbl_r`, `ph_bl` | Fiber cable: entry to ONT |
| 7 | Power Meter | `ph_powm`, `ph_powm1`, `ph_powm2` | Powermeter reading |
| 8 | Final Installation | `ph_after`, `ph_final` | Overall work area after complete install |
| 9 | Green Lights | `ph_lights`, `ph_led` | Photo of Active Broadband Light |
| 10 | Signature | `ph_sign1`, `ph_sign2`, `ph_signature` | Signature of owner/tenant |

### Complete Type Reference

```typescript
// CANONICAL - DO NOT MODIFY WITHOUT UPDATING THIS SKILL
export const PHOTO_TYPE_TO_STEP: Record<string, number> = {
  // Step 1: House Photo
  'ph_prop': 1,

  // Step 2: Cable from Pole
  'ph_pole': 2,
  'ph_outs': 2,

  // Step 3: Cable Entry Outside
  'ph_entry_out': 3,
  'ph_hm_ln': 3,

  // Step 4: Cable Entry Inside
  'ph_entry_in': 4,
  'ph_hm_en': 4,

  // Step 5: Wall for Installation
  'ph_wall': 5,

  // Step 6: ONT Back After Install
  'ph_ont': 6,
  'ph_ont_back': 6,
  'ph_drop': 6,
  'ph_cbl_r': 6,
  'ph_bl': 6,

  // Step 7: Power Meter Reading
  'ph_powm': 7,
  'ph_powm1': 7,
  'ph_powm2': 7,

  // Step 8: Final Installation
  'ph_after': 8,
  'ph_final': 8,

  // Step 9: Green Lights on ONT
  'ph_lights': 9,
  'ph_led': 9,

  // Step 10: Signature
  'ph_sign1': 10,
  'ph_sign2': 10,
  'ph_signature': 10,
};
```

## Photo Rejection Reasons (Jan 2026)

When QA reviewers reject a photo during categorization, they must select a reason:

```typescript
// CANONICAL - Defined in stepMapper.ts
export const PHOTO_REJECTION_REASONS = [
  { code: 'BLURRY', label: 'Blurry/Out of Focus' },
  { code: 'WRONG_ANGLE', label: 'Wrong Angle' },
  { code: 'WRONG_SUBJECT', label: 'Wrong Subject' },
  { code: 'POOR_LIGHTING', label: 'Poor Lighting' },
  { code: 'OBSTRUCTED', label: 'Obstructed View' },
  { code: 'DUPLICATE', label: 'Duplicate Photo' },
  { code: 'NOT_INSTALLATION', label: 'Not Installation Related' },
] as const;
```

**Behavior:**
- Rejected photos (approved=false) are excluded from step coverage counts
- Rejection reason stored in `human_override_reason` field via API
- Step cards display "Step N" prefix above labels

## Critical Files

| File | Purpose | Status |
|------|---------|--------|
| `src/modules/activate/utils/stepMapper.ts` | **SOURCE OF TRUTH** - Mappings + rejection reasons | CANONICAL |
| `pages/api/activate/fetch-photos.ts` | Uses `photoTypeToStep()` from stepMapper | IMPORTS |
| `src/modules/activate/components/wizard/PhotoReviewPhase.tsx` | Photo rejection UI | IMPLEMENTS |

## Important Notes

### Steps 11 & 12: Barcode Data (NOT Photo Steps)

- **Step 11 (ONT Barcode)**: Scanned, stored in `ont_serial_scanned`
- **Step 12 (UPS Serial)**: Scanned, stored in `ups_serial_scanned`

These are NOT photo steps - they are barcodes parsed from `ont_barcode` field.

### ONT Barcode Parsing

Full barcode format:
```
(S)ALCLB46BE62E(23S)E03DA68BD340(20S)M022515ALU00136108(U)userAdmin(P)pass...
```

Extract serial: `/\(S\)([^(]+)/` → `ALCLB46BE62E`

## 3-Phase QA Workflow

### Phase 1: Attribute-Based Categorization (Instant)
- Uses `original_type` from OneMap (confidence: 1.0)
- Fallback: Extract from filename pattern (confidence: 0.9)
- Unknown types flagged for VLM

### Phase 2: VLM Quality Validation
- AI validates photo quality against FiberTime spec
- See `/ai-qa-validation` skill for criteria

### Phase 3: Human Review
- Card grid with approve/reject
- Activity log for audit trail

## Anti-Pattern Warning

**NEVER create duplicate mapping functions!**

```typescript
// ❌ WRONG - Do not create local mappings
function mapPhotoTypeToStep(type: string): number {
  const mapping = { 'ph_prop': 1, 'ph_pole': 2 };  // OUTDATED!
  return mapping[type] || 0;
}

// ✅ CORRECT - Always import from stepMapper
import { photoTypeToStep } from '@/modules/activate/utils/stepMapper';
const step = photoTypeToStep(photo.type);
```

## Validation Commands

```bash
# Check stepMapper.ts matches this skill
grep -E "ph_" src/modules/activate/utils/stepMapper.ts

# Find any duplicate mapping functions
grep -r "mapPhotoTypeToStep\|PHOTO_TYPE_TO_STEP" --include="*.ts" pages/ src/

# Test mapping via API
curl -s -X POST https://vf.fibreflow.app/api/activate/fetch-photos \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR1736721"}' | jq '.data.photos[] | {filename, step, original_type}'
```

## Related Skills

- `/activate` - Main Activate module operations
- `/ai-qa-validation` - VLM quality validation criteria
