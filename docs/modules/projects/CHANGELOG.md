# Projects Module CHANGELOG

All notable changes to the Projects module are documented here.

---

## [Unreleased]

### Added
- **Document Cross-Validation via VLM** (2026-03-09, commit `622c6060`)
  - Automatic validation of PO/BSS/MSS document consistency
  - VLM extraction using Qwen3-VL for structured data capture
  - 5% tolerance on numeric comparisons
  - Manual re-validation API endpoint
  - Integration with project activation gate

---

## Commit Details

### 622c6060 — feat(projects): PO + BSS + MSS cross-validation via VLM

**Date**: 2026-03-09 10:41:53 +0200  
**Author**: Claude Sonnet 4.5  
**Co-Author**: Claude Opus 4.6

#### Description

Adds automated document cross-validation system that ensures consistency between Client Purchase Orders (PO), Building Specification Sheets (BSS), and Material Specification Sheets (MSS).

#### Files Changed

1. **pages/api/projects/[projectId]/client-pos/index.ts** (+6 lines)
   - Added trigger to `runCrossValidationIfReady()` when PO is created
   - Non-blocking background execution with error logging

2. **pages/api/projects/[projectId]/cross-validation.ts** (+80 lines, NEW)
   - GET endpoint: Fetch latest validation result
   - POST endpoint: Manually trigger re-validation
   - Handles missing validation state with helpful message
   - Returns validation ID, status, discrepancies, confidence score
   - Transforms DB results to API response format

3. **pages/api/projects/[projectId]/documents/index.ts** (+8 lines)
   - Added trigger to `runCrossValidationIfReady()` when BSS/MSS uploaded
   - Ensures validation runs after document upload

4. **scripts/migrations/226_document_cross_validation.sql** (+67 lines, NEW)
   - Creates `document_cross_validations` table:
     - `id`: UUID primary key
     - `project_id`: Foreign key to projects
     - `status`: pending | processing | passed | failed | warnings
     - `is_valid`: Boolean result
     - `confidence_score`: 0-1 float
     - `discrepancies`: JSONB array of issues found
     - `po_drops`, `bss_drops`, `mss_drops`: Extracted drop counts
     - `po_price_per_drop`, `bss_price_per_drop`: Pricing validation
     - `po_total_value`, `bss_total_value`, `mss_total_value`: Total amounts
     - `created_at`, `updated_at`: Timestamps
     - `extraction_hash`: MD5 of extracted data (prevent reprocessing)

5. **src/modules/projects/services/activationService.ts** (+94 lines modified, -26 lines)
   - Updated activation gate to check cross-validation status
   - Now requires validation.status = 'passed'
   - Includes validation ID in activation payload
   - Improved error messages for incomplete documents

6. **src/modules/projects/services/documentCrossValidationService.ts** (+489 lines, NEW)
   - Core validation logic module
   - `runCrossValidationIfReady(projectId)` - Async trigger function
   - `getLatestValidation(projectId)` - Fetch last result
   - VLM extraction from BSS/MSS PDFs using Qwen3-VL
   - Comparison logic with 5% numeric tolerance
   - Discrepancy reporting (errors vs warnings)
   - Result storage in database
   - Error handling and logging

#### Key Changes

- **VLM Integration**: Qwen3-VL extracts structured data from BSS/MSS
  - Drop counts → Validated against PO
  - Pricing → Checked for consistency (5% tolerance)
  - Material specs → Logged for reference
  
- **Non-Blocking**: Validation runs async after document upload
  - Doesn't block project creation
  - Errors logged but don't prevent activation attempt
  - Manual re-validation available via API
  
- **Activation Gate**: Updated to require:
  - All 3 documents present (PO, BSS, MSS)
  - Latest validation result shows status = 'passed'
  
- **Discrepancy Handling**:
  - Errors: Stop activation, must fix
  - Warnings: Log but allow activation
  - Confidence < 0.85: Flag for manual review

#### Database Migration

```sql
-- Run before deployment
scripts/migrations/226_document_cross_validation.sql
```

This creates the validation tracking table and indices.

#### API Usage Examples

```bash
# Get latest validation result
GET /api/projects/proj-123/cross-validation
Response: { hasValidation: true, validation: { id, status, isValid, discrepancies, ... } }

# Manually trigger re-validation
POST /api/projects/proj-123/cross-validation
Body: {} (empty — uses latest PO/BSS/MSS)
Response: { status: 'processing', validationId: ... }

# Later, poll for result
GET /api/projects/proj-123/cross-validation
Response: { hasValidation: true, validation: { status: 'passed', isValid: true, ... } }
```

#### Testing Checklist

- [ ] Upload PO alone → validation not triggered (waiting for BSS/MSS)
- [ ] Upload BSS → validation triggered, compares with PO
- [ ] Upload MSS → validation complete, all 3 docs validated
- [ ] Validation passes → Project can be activated
- [ ] Validation fails → Activation blocked, discrepancies shown
- [ ] Re-upload corrected document → Re-validation triggered
- [ ] Manual POST to /cross-validation → Works without document upload
- [ ] Confidence < 0.85 → Flagged for manual review

#### Notes

- Non-blocking: Errors in validation don't crash PO/document upload
- Tolerance: 5% numeric tolerance to account for rounding/formatting
- Performance: VLM extraction happens in background, visible via API polling
- Retry: Failed validations can be manually re-triggered via POST

---

**Module Owner**: velo:velo  
**Last Updated**: 2026-03-10  
**Changelog Version**: 1.0
