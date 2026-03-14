# Projects Module Documentation

**Module**: Projects Management
**Status**: Active Development
**Last Updated**: 2026-03-10

---

## 🎯 Module Overview

The Projects module manages fiber network project lifecycle, including:

- **Project CRUD**: Create, read, update, delete project records
- **Client POs**: Upload and manage client Purchase Orders
- **Building Specification Sheets (BSS)**: Track building survey data
- **Material Specification Sheets (MSS)**: Manage material requirements
- **Document Cross-Validation**: Automatic VLM-powered validation of PO/BSS/MSS consistency
- **Activation Gate**: Require all 3 documents + passing validation before project activation

---

## 📊 Key Features

### Document Cross-Validation (PRIORITY: High)
**Commit**: `622c6060` (2026-03-09)

Automated validation system that ensures PO, BSS, and MSS documents are consistent:

- **VLM Extraction**: Uses Qwen3-VL to extract structured data from BSS/MSS PDFs
  - Drop counts
  - Pricing information
  - Material specifications
  
- **Comparison Logic**: Cross-validates extracted data against PO
  - 5% tolerance on numeric comparisons
  - Reports errors vs warnings
  - Generates discrepancy report
  
- **Triggers**: Non-blocking, auto-triggers on:
  - BSS upload
  - MSS upload  
  - PO creation/update
  
- **Manual Re-validation**: GET/POST endpoints allow manual trigger
  
- **Activation Gate**: Project activation now requires:
  - All 3 documents (PO, BSS, MSS) uploaded
  - Cross-validation status = passed

---

## 🏗️ Architecture

### Database
- **Migration 226**: `document_cross_validations` table
  - Stores validation results with confidence scores
  - Tracks extraction columns for debugging
  - Links to projects, POs, BSS, MSS

### Services
- **documentCrossValidationService.ts**
  - `runCrossValidationIfReady()` - Async trigger on document upload
  - `getLatestValidation()` - Fetch last validation result
  - VLM extraction and comparison logic

### API Endpoints
- `GET /api/projects/[projectId]/cross-validation` - Get latest result
- `POST /api/projects/[projectId]/cross-validation` - Trigger re-validation
- Auto-trigger hooks in:
  - `POST /api/projects/[projectId]/client-pos`
  - `POST /api/projects/[projectId]/documents`

---

## 🔧 Main Files

| File | Purpose |
|------|---------|
| `pages/api/projects/[projectId]/cross-validation.ts` | Cross-validation API (GET/POST) |
| `pages/api/projects/[projectId]/client-pos/index.ts` | PO CRUD + validation triggers |
| `pages/api/projects/[projectId]/documents/index.ts` | BSS/MSS CRUD + validation triggers |
| `src/modules/projects/services/documentCrossValidationService.ts` | Core validation logic |
| `scripts/migrations/226_document_cross_validation.sql` | DB schema for validation |

---

## 🚀 Workflow

### Typical Project Activation Flow

1. **Create Project** → Project created in draft state
2. **Upload PO** → Validation service checks for BSS/MSS (none yet, waits)
3. **Upload BSS** → VLM extracts data, compares with PO (if PO exists)
4. **Upload MSS** → VLM extracts data, validates all 3 documents
5. **Get Result** → GET `/cross-validation` returns status + any discrepancies
6. **Activate Project** → Only if validation.status = 'passed' ✅

### Handling Validation Failures

If validation fails:
1. Download discrepancy report via API
2. Correct the problematic document (PO/BSS/MSS)
3. Re-upload the fixed version
4. POST `/cross-validation` to re-validate
5. Check result again

---

## 📝 Important Notes

### VLM Limitations
- Confidence scores < 0.85 should be manually reviewed
- Scanned PDFs with poor OCR may fail extraction
- Math errors in documents are caught (pricing doesn't match drop counts)

### Performance
- Extraction happens async, non-blocking
- Large PDFs (>50MB) may timeout — chunk and retry
- Caching: Don't re-process same PDF twice (check extraction_hash)

### Testing
- Test cross-validation with sample PO + BSS + MSS PDFs
- Verify 5% tolerance on numeric mismatches
- Ensure activation gate blocks incomplete projects

---

## 📚 Related Documentation

- **[CHANGELOG.md](./CHANGELOG.md)** — Commit history and changes
- **[Field-Ops Module](../field-ops/README.md)** — Construction QA and photo management
- **[Pipeline Module](../pipeline/README.md)** — Deal approval workflows

---

**Owner**: velo:velo
**Last Updated**: 2026-03-10
