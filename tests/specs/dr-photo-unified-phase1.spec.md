# DR Photo Unified - Phase 1 Test Specification

**Feature Branch**: `feature/activate`
**Phase**: 1 - Foundation & Database (Week 1)
**Date**: 2026-01-14
**Status**: Test Specification (BEFORE Implementation)

---

## Overview

This test specification defines the behavioral requirements for Phase 1, Week 1 of the DR Photo Unified project. Following TDD principles, this document is created BEFORE any implementation code.

**Deliverables**:
1. Step Mapping Utility - Bidirectional mapping between photo types and unified 12 steps
2. Multi-Source Photo Fetching - Intelligent fallback system (OneMap → BOSS → Local)
3. TypeScript Type Definitions - Interfaces for unified system
4. Photo Source Resolver - Logic for source selection

---

## Feature 1: Step Mapping Utility

**Purpose**: Provide bidirectional mapping between photo types (port 8003) and unified 12-step system

**Files to Create**:
- `src/modules/activate/utils/stepMapper.ts`
- `tests/unit/modules/activate/stepMapper.test.ts`

### Test Cases

#### TC1.1: Photo Type to Step Mapping (Basic)
**Given** a valid photo type from port 8003
**When** I call `photoTypeToStep(photoType)`
**Then** it should return the correct unified step number

| Input Photo Type | Expected Step | Description |
|------------------|---------------|-------------|
| `'ph_prop'` | `1` | House Photo |
| `'ph_sign1'` | `1` | House Photo (alternate) |
| `'ph_pole'` | `2` | Cable from Pole |
| `'ph_cbl_r'` | `2` | Cable from Pole (alternate) |
| `'ph_entry_out'` | `3` | Cable Entry Outside |
| `'ph_hm_ln'` | `3` | Cable Entry Outside (alternate) |
| `'ph_entry_in'` | `4` | Cable Entry Inside |
| `'ph_hm_en'` | `4` | Cable Entry Inside (alternate) |
| `'ph_wall'` | `5` | Wall for Installation |
| `'ph_ont'` | `6` | ONT Back After Install |
| `'ph_ont_back'` | `6` | ONT Back (alternate) |
| `'ph_powm'` | `7` | Power Meter Reading |
| `'ph_powm2'` | `7` | Power Meter (alternate) |
| `'ph_bl'` | `8` | ONT Barcode |
| `'ph_barcode'` | `8` | ONT Barcode (alternate) |
| `'ph_ups'` | `9` | UPS Serial Number |
| `'ph_after'` | `10` | Final Installation |
| `'ph_final'` | `10` | Final Installation (alternate) |
| `'ph_lights'` | `11` | Green Lights on ONT |
| `'ph_led'` | `11` | Green Lights (alternate) |

**Acceptance Criteria**:
- ✅ All 20 photo types map to correct steps
- ✅ Case-sensitive matching
- ✅ Returns consistent results for same input

#### TC1.2: Invalid Photo Type Handling
**Given** an invalid or unknown photo type
**When** I call `photoTypeToStep(invalidType)`
**Then** it should return `null`

| Input Photo Type | Expected Result | Reason |
|------------------|-----------------|--------|
| `'invalid_type'` | `null` | Unknown type |
| `'ph_unknown'` | `null` | Not in mapping |
| `''` | `null` | Empty string |
| `null` | `null` | Null input |
| `undefined` | `null` | Undefined input |

**Acceptance Criteria**:
- ✅ Returns `null` for any unmapped type
- ✅ Does not throw errors
- ✅ Handles edge cases gracefully

#### TC1.3: Step to Photo Types Mapping (Reverse)
**Given** a valid unified step number (1-12)
**When** I call `stepToPhotoTypes(stepNumber)`
**Then** it should return an array of all photo types for that step

| Input Step | Expected Photo Types | Description |
|------------|---------------------|-------------|
| `1` | `['ph_prop', 'ph_sign1']` | House Photo |
| `2` | `['ph_pole', 'ph_cbl_r']` | Cable from Pole |
| `3` | `['ph_entry_out', 'ph_hm_ln']` | Entry Outside |
| `4` | `['ph_entry_in', 'ph_hm_en']` | Entry Inside |
| `5` | `['ph_wall']` | Wall |
| `6` | `['ph_ont', 'ph_ont_back']` | ONT Back |
| `7` | `['ph_powm', 'ph_powm2']` | Power Meter |
| `8` | `['ph_bl', 'ph_barcode']` | ONT Barcode |
| `9` | `['ph_ups']` | UPS |
| `10` | `['ph_after', 'ph_final']` | Final |
| `11` | `['ph_lights', 'ph_led']` | Lights |
| `12` | `[]` | Signature (no photo type) |

**Acceptance Criteria**:
- ✅ All 12 steps return correct photo type arrays
- ✅ Step 12 returns empty array (signature has no photo)
- ✅ Array order is consistent

#### TC1.4: Invalid Step Handling
**Given** an invalid step number
**When** I call `stepToPhotoTypes(invalidStep)`
**Then** it should return an empty array

| Input Step | Expected Result | Reason |
|------------|-----------------|--------|
| `0` | `[]` | Below range |
| `13` | `[]` | Above range |
| `-1` | `[]` | Negative |
| `999` | `[]` | Invalid |
| `null` | `[]` | Null input |
| `undefined` | `[]` | Undefined input |

**Acceptance Criteria**:
- ✅ Returns empty array for invalid steps
- ✅ Does not throw errors
- ✅ Handles edge cases gracefully

#### TC1.5: Bidirectional Consistency
**Given** a photo type and its mapped step
**When** I map forward and backward
**Then** the mappings should be consistent

**Test Logic**:
```typescript
const photoType = 'ph_prop';
const step = photoTypeToStep(photoType); // Should be 1
const photoTypes = stepToPhotoTypes(step); // Should include 'ph_prop'
expect(photoTypes).toContain(photoType); // ✅ Consistency verified
```

**Acceptance Criteria**:
- ✅ Every photo type maps to a step that maps back to that photo type
- ✅ No orphaned mappings
- ✅ Symmetrical relationship

---

## Feature 2: Multi-Source Photo Fetching

**Purpose**: Fetch photos with intelligent fallback across multiple sources

**Files to Create**:
- `src/modules/activate/services/unifiedPhotoService.ts`
- `src/modules/activate/services/oneMapIntegrationService.ts`
- `tests/unit/modules/activate/unifiedPhotoService.test.ts`

### Test Cases

#### TC2.1: Primary Source Success (OneMap)
**Given** OneMap service is available
**When** I call `fetchPhotosWithFallback('DR1730550')`
**Then** it should fetch from OneMap and return photos

**Expected Response**:
```typescript
{
  source: 'onemap',
  count: 16,
  photos: [
    {
      filename: 'DR1730550_ph_prop_001.jpg',
      step: 1,
      url: 'http://100.96.203.105:8003/api/photo/DR1730550/DR1730550_ph_prop_001.jpg',
      size: 123456,
      modified: 1736819847.0
    },
    // ... more photos
  ]
}
```

**Acceptance Criteria**:
- ✅ Calls `fetchFromOneMap('DR1730550')`
- ✅ Does NOT call BOSS API or local cache
- ✅ Returns source='onemap'
- ✅ Photo count matches actual photos
- ✅ All photos have required fields (filename, step, url)

#### TC2.2: Fallback to BOSS API (OneMap Fails)
**Given** OneMap service is unavailable (timeout/error)
**And** BOSS API is available
**When** I call `fetchPhotosWithFallback('DR1730550')`
**Then** it should fallback to BOSS API

**Mock Behavior**:
```typescript
fetchFromOneMap() → throws Error('Timeout')
fetchFromBossApi() → returns photos
```

**Expected Response**:
```typescript
{
  source: 'boss',
  count: 16,
  photos: [/* photos from BOSS API */]
}
```

**Acceptance Criteria**:
- ✅ Tries OneMap first (fails)
- ✅ Logs warning about OneMap failure
- ✅ Calls BOSS API as fallback
- ✅ Returns source='boss'
- ✅ Photos match BOSS API format

#### TC2.3: Fallback to Local Cache (Both APIs Fail)
**Given** OneMap service is unavailable
**And** BOSS API is unavailable
**And** Local cache has photos for DR
**When** I call `fetchPhotosWithFallback('DR1730550')`
**Then** it should fallback to local cache

**Mock Behavior**:
```typescript
fetchFromOneMap() → throws Error('Timeout')
fetchFromBossApi() → throws Error('404 Not Found')
fetchFromLocalCache() → returns cached photos
```

**Expected Response**:
```typescript
{
  source: 'local',
  count: 16,
  photos: [/* cached photos */]
}
```

**Acceptance Criteria**:
- ✅ Tries OneMap (fails)
- ✅ Tries BOSS API (fails)
- ✅ Logs warnings for both failures
- ✅ Calls local cache as last resort
- ✅ Returns source='local'

#### TC2.4: All Sources Fail
**Given** all photo sources are unavailable
**When** I call `fetchPhotosWithFallback('DR9999999')`
**Then** it should throw a descriptive error

**Mock Behavior**:
```typescript
fetchFromOneMap() → throws Error('Timeout')
fetchFromBossApi() → throws Error('404')
fetchFromLocalCache() → throws Error('Not found')
```

**Expected Error**:
```
Error: All photo sources unavailable for DR9999999
```

**Acceptance Criteria**:
- ✅ Tries all three sources in order
- ✅ Logs all failures
- ✅ Throws error with DR number in message
- ✅ Error is descriptive and actionable

#### TC2.5: Photo Metadata Mapping
**Given** photos fetched from any source
**When** I receive the photo list
**Then** each photo should have step number mapped

**Test Logic**:
```typescript
const result = await fetchPhotosWithFallback('DR1730550');
result.photos.forEach(photo => {
  // Verify step was mapped from filename
  if (photo.filename.includes('ph_prop')) {
    expect(photo.step).toBe(1);
  }
  if (photo.filename.includes('ph_powm')) {
    expect(photo.step).toBe(7);
  }
});
```

**Acceptance Criteria**:
- ✅ All photos have `step` property
- ✅ Step is correctly mapped from photo type in filename
- ✅ Invalid photo types get `step: null`

---

## Feature 3: Photo Source Resolver

**Purpose**: Determine which photo source to use based on availability and configuration

**Files to Create**:
- `src/modules/activate/utils/photoSourceResolver.ts`
- `tests/unit/modules/activate/photoSourceResolver.test.ts`

### Test Cases

#### TC3.1: Source Priority Order
**Given** no source preference specified
**When** I call `getSourcePriority()`
**Then** it should return sources in priority order

**Expected**:
```typescript
['onemap', 'boss', 'local']
```

**Acceptance Criteria**:
- ✅ OneMap is first (most authoritative)
- ✅ BOSS API is second (backup)
- ✅ Local cache is last (offline resilience)

#### TC3.2: Force Specific Source
**Given** a forced source preference
**When** I call `getSourcePriority({ forceSource: 'boss' })`
**Then** it should prioritize that source

**Expected**:
```typescript
['boss', 'onemap', 'local']
```

**Acceptance Criteria**:
- ✅ Forced source is first
- ✅ Other sources still available as fallback
- ✅ Invalid forced source is ignored

---

## Feature 4: TypeScript Type Definitions

**Purpose**: Provide type safety for unified photo review system

**Files to Create**:
- `src/modules/activate/types/unified.types.ts`
- `tests/unit/modules/activate/unified.types.test.ts`

### Test Cases

#### TC4.1: PhotoSource Interface
**Given** the PhotoSource interface
**When** I create a photo source object
**Then** TypeScript should enforce the correct shape

**Type Definition**:
```typescript
export interface PhotoSource {
  source: 'onemap' | 'boss' | 'local';
  count: number;
  photos: Photo[];
}

export interface Photo {
  filename: string;
  step: number | null;
  url: string;
  size?: number;
  modified?: number;
}
```

**Acceptance Criteria**:
- ✅ Source is limited to 'onemap' | 'boss' | 'local'
- ✅ Count is required number
- ✅ Photos is required array
- ✅ Photo has required filename, step, url
- ✅ Photo has optional size, modified

#### TC4.2: UnifiedReview Interface
**Given** the UnifiedReview interface
**When** I create a review object
**Then** it should match the database schema

**Type Definition**:
```typescript
export interface UnifiedReview {
  id: string;
  drop_number: string;
  project: string | null;
  photo_source: 'onemap' | 'boss' | 'local' | null;
  photo_count: number;
  photos_metadata: Photo[];

  // 12 QA steps
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_entry_outside: boolean;
  step_04_entry_inside: boolean;
  step_05_wall: boolean;
  step_06_ont_back: boolean;
  step_07_power_meter: boolean;
  step_08_ont_barcode: boolean;
  step_09_ups_serial: boolean;
  step_10_final_installation: boolean;
  step_11_green_lights: boolean;
  step_12_signature: boolean;

  incorrect_steps: string[];
  incorrect_comments: Record<string, string>;

  ai_evaluation_status: 'pending' | 'processing' | 'completed' | 'failed' | null;
  ai_overall_status: 'PASS' | 'FAIL' | null;
  ai_average_score: number | null;
  ai_step_results: AIStepResult[] | null;
  ai_markdown_report: string | null;

  ont_serial_scanned: string | null;
  ups_serial_scanned: string | null;

  locked_by: string | null;
  locked_at: Date | null;

  feedback_sent: boolean;
  feedback_message: string | null;

  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
```

**Acceptance Criteria**:
- ✅ All database columns have matching TypeScript properties
- ✅ Nullable columns have `| null` union type
- ✅ Boolean steps default to false (enforced at DB level)
- ✅ Dates are Date objects (not strings)

---

## Non-Functional Requirements

### Performance
- Photo fetch with fallback: < 5 seconds total (including retries)
- Step mapping: < 1ms (pure function, no I/O)
- Type compilation: No TypeScript errors

### Error Handling
- All errors logged with context (DR number, source, error message)
- No silent failures
- Descriptive error messages for debugging

### Code Quality
- ✅ NO_CONSOLE_LOG: Use `log` from `@/lib/logger`
- ✅ PROPER_ERROR_HANDLING: All catch blocks log errors
- ✅ TYPE_SAFETY: 100% TypeScript coverage
- ✅ DGTS threshold: 0.35 (tests actually test behavior)
- ✅ NLNH confidence: 0.80 (mark uncertainty)

---

## Verification Commands

After implementation, these commands should all pass:

```bash
# Run unit tests (should FAIL initially in RED phase)
npm test tests/unit/modules/activate/

# Implement code until tests PASS (GREEN phase)
npm test tests/unit/modules/activate/stepMapper.test.ts
npm test tests/unit/modules/activate/unifiedPhotoService.test.ts

# Run full test suite
npm test

# Type check
npm run type-check

# Lint
npm run lint

# PAI validation
npm run antihall
```

---

## Success Criteria

Phase 1, Week 1 is complete when:

- ✅ All test cases pass (GREEN phase)
- ✅ Test coverage ≥ 80% for new code
- ✅ TypeScript compilation succeeds
- ✅ ESLint passes with no errors
- ✅ AntiHall validator confirms all references exist
- ✅ Git commits follow TDD atomic commit strategy
- ✅ Code marked with status comments (WORKING/PARTIAL/UNTESTED)
- ✅ PAI quality gates enforced (DGTS, NLNH, Zero Tolerance)

---

**Document Version**: 1.0
**Created**: 2026-01-14
**Author**: PAI (following Doc-Driven TDD protocol)
**Status**: Test Specification (RED phase ready)
