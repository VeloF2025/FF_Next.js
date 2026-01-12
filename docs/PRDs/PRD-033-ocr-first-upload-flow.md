# PRD-033: OCR-First Document Upload Flow

## Document Information
| Field | Value |
|-------|-------|
| **PRD Number** | PRD-033 |
| **Title** | OCR-First Document Upload Flow |
| **Author** | Claude AI |
| **Created** | 2026-01-11 |
| **Status** | Draft |
| **Priority** | High |
| **Estimated Effort** | 2 weeks |
| **Depends On** | PRD-032 (OCR Document Extraction System) |

---

## 1. Executive Summary

### 1.1 Problem Statement
The current document upload flow requires users to manually enter document metadata BEFORE OCR processing occurs:
- **Manual entry first:** User selects document type, enters name, dates, ID numbers
- **OCR processing second:** Asynchronous webhook extracts same data (disconnected from upload UX)
- **Redundant work:** User types data that OCR will extract anyway
- **Poor UX:** User never sees OCR results during upload, can't verify extracted data
- **Error prone:** Manual typing introduces errors that OCR would avoid

**Example:** Uploading SA ID card requires user to:
1. Select "ID Document" from dropdown (OCR can detect this)
2. Enter document name "SA ID Card" (OCR can generate this)
3. Type ID number "8501015800080" (OCR extracts this with 95%+ confidence)
4. Enter issue/expiry dates (OCR extracts these)
5. Upload file
6. Wait for async OCR to run (never see results)

### 1.2 Proposed Solution
**Invert the flow:** OCR processes FIRST, then user confirms/edits extracted data before saving.

**New Flow:**
1. User uploads file only (no manual fields)
2. OCR processes synchronously (5-10 second wait)
3. System shows extracted: document type, name, all fields
4. User confirms or edits extracted data
5. Save to database + VF Storage

**Benefits:**
- **90% reduction** in manual data entry
- **Zero typing errors** for high-confidence fields
- **Immediate feedback** - user sees what OCR extracted
- **Graceful fallback** - manual form if OCR fails
- **Same data quality** - user still reviews before save

### 1.3 Success Metrics
| Metric | Target |
|--------|--------|
| Manual field entry reduction | > 90% (only confirmations, not typing) |
| Upload completion time | < 30 seconds (including 5-10s OCR wait) |
| OCR preview usage rate | > 80% (vs. manual fallback) |
| User edit rate | < 30% (most users accept OCR data as-is) |
| Classification accuracy | > 70% high confidence (≥80%) |
| Field extraction accuracy | > 85% accepted without edits |

---

## 2. Background & Context

### 2.1 Current State (PRD-032 Implementation)

**Existing OCR Infrastructure:**
- ✅ OCR service deployed at `http://100.96.203.105:8095`
- ✅ 4-tier cascade (Tesseract → PaddleOCR → OCR.space → Gemini)
- ✅ Document classification (28 types)
- ✅ Field extraction with confidence scores
- ✅ SA ID validation (Luhn algorithm)
- ✅ Auto-apply for high-confidence fields (≥95%)

**Current Upload Flow:**
```
pages/api/staff-documents-upload.ts:
1. User submits form with manual fields
2. Save file to VF Storage
3. Create staff_documents record
4. Trigger webhook (async, fire-and-forget)
5. Return 201 success

pages/api/webhooks/document-uploaded.ts:
1. Check OCR eligibility
2. Call /api/documents-process-ocr
3. If confidence ≥95%, auto-apply fields
4. Return 200 OK
```

**Gap:** User and OCR both enter same data, but never see each other's work.

### 2.2 User Experience Analysis

**Current UX Pain Points:**
1. **Redundant work:** User types "8501015800080", OCR extracts "8501015800080" (both do same work)
2. **No feedback:** User never sees if OCR extracted correctly
3. **Trust issues:** User doesn't know if system used OCR or manual data
4. **Error discovery lag:** OCR errors found later, not during upload

**Desired UX:**
1. **Upload first, type later (maybe):** User uploads, sees what OCR found, edits if needed
2. **Immediate validation:** See extraction quality before committing
3. **Transparency:** Clear which fields are OCR-extracted vs. user-entered
4. **Confidence:** Know when to trust OCR vs. verify manually

### 2.3 Related Systems
| System | Relationship |
|--------|-------------|
| PRD-032 OCR System | Foundation - provides classification + extraction |
| VF Storage (8091) | File storage (pre-upload or streaming) |
| StaffDocumentUploadForm.tsx | Current upload form (to be replaced) |
| StaffDocumentList.tsx | Parent component (triggers upload wizard) |

---

## 3. Requirements

### 3.1 Functional Requirements

#### FR-001: Simplified Upload Entry
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-001.1 | User SHALL upload file without selecting document type | Must |
| FR-001.2 | User SHALL upload file without entering document name | Must |
| FR-001.3 | User SHALL upload file without entering ID numbers/dates | Must |
| FR-001.4 | File picker SHALL support drag-and-drop | Should |
| FR-001.5 | System SHALL validate file type/size before OCR | Must |

#### FR-002: Synchronous OCR Processing
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-002.1 | OCR SHALL process BEFORE saving to database | Must |
| FR-002.2 | OCR processing SHALL complete within 30 seconds | Must |
| FR-002.3 | System SHALL show progress indicator during OCR | Must |
| FR-002.4 | System SHALL timeout gracefully after 30s | Must |
| FR-002.5 | System SHALL call `/api/documents-ocr-preview` endpoint | Must |

#### FR-003: Classification Presentation
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-003.1 | System SHALL show detected document type with confidence | Must |
| FR-003.2 | System SHALL show top 3 classification guesses if confidence < 80% | Must |
| FR-003.3 | User SHALL be able to select from top 3 guesses | Must |
| FR-003.4 | System SHALL fall back to manual type selection if confidence < 50% | Must |
| FR-003.5 | System SHALL generate document name based on type + date/ID | Should |

#### FR-004: Field Extraction Preview
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-004.1 | System SHALL show all extracted fields for user review | Must |
| FR-004.2 | Each field SHALL display confidence score | Must |
| FR-004.3 | Fields SHALL be editable before saving | Must |
| FR-004.4 | System SHALL color-code fields by confidence (green/yellow/red) | Should |
| FR-004.5 | System SHALL show validation warnings (e.g., invalid SA ID) | Must |

#### FR-005: User Confirmation Flow
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-005.1 | User SHALL review extracted data before saving | Must |
| FR-005.2 | User SHALL be able to edit any extracted field | Must |
| FR-005.3 | User SHALL be able to switch to manual entry at any point | Must |
| FR-005.4 | System SHALL track which fields were OCR-extracted vs. manually edited | Should |
| FR-005.5 | System SHALL save OCR result with status='confirmed' after user approval | Must |

#### FR-006: Fallback Mechanisms
| ID | Requirement | Priority |
|----|-------------|----------|
| FR-006.1 | System SHALL fall back to manual form if OCR service unavailable | Must |
| FR-006.2 | System SHALL fall back to manual form if OCR times out | Must |
| FR-006.3 | System SHALL fall back to manual form if classification confidence < 50% | Must |
| FR-006.4 | System SHALL show clear error messages for fallback triggers | Must |
| FR-006.5 | Manual fallback form SHALL match current upload form fields | Must |

### 3.2 Non-Functional Requirements

#### NFR-001: Performance
| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001.1 | OCR processing time | 3-10 seconds average |
| NFR-001.2 | UI step transitions | < 100ms |
| NFR-001.3 | File upload to VF Storage | < 3 seconds |
| NFR-001.4 | Total upload completion | < 30 seconds |

#### NFR-002: Reliability
| ID | Requirement | Target |
|----|-------------|--------|
| NFR-002.1 | OCR service uptime | > 95% |
| NFR-002.2 | Fallback activation rate | < 20% of uploads |
| NFR-002.3 | Classification accuracy (high confidence) | > 70% |
| NFR-002.4 | Field extraction accuracy | > 85% |

#### NFR-003: Usability
| ID | Requirement | Target |
|----|-------------|--------|
| NFR-003.1 | Task completion rate | > 95% |
| NFR-003.2 | User edit rate (accepting OCR data) | > 70% |
| NFR-003.3 | Error recovery rate | > 90% |

---

## 4. Technical Design

### 4.1 System Architecture

```
┌─────────────┐
│   User      │
└──────┬──────┘
       │ 1. Upload file
       ▼
┌──────────────────────────────────┐
│ StaffDocumentUploadWizard        │
│ (Multi-step state machine)       │
│                                   │
│  Steps:                           │
│  1. FileUploadStep                │
│  2. OcrProcessingStep  ◄──┐       │
│  3. OcrPreviewStep        │       │
│  4. ManualEntryStep       │       │
│  5. ConfirmationStep      │       │
│  6. SavingStep            │       │
└────────┬──────────────────┘       │
         │ 2. POST /api/documents-ocr-preview
         ▼                          │
┌────────────────────────────────┐  │
│ /api/documents-ocr-preview     │  │
│ (NEW Endpoint)                 │  │
│  - Upload to temp/stream       │  │
│  - Call ocrService.extract()   │  │
│  - Build top 3 guesses         │  │
│  - Return preview data         │  │
│  - NO database save            │  │
└────────┬───────────────────────┘  │
         │ 3. Extract fields         │
         ▼                           │
┌────────────────────────────────┐  │
│ OCR Service (100.96.203.105)  │  │
│  - 4-tier cascade              │  │
│  - Tesseract → Paddle →        │  │
│    OCR.space → Gemini          │  │
│  - Returns: classification +   │  │
│    extracted fields            │  │
└────────┬───────────────────────┘  │
         │ 4. OCR results            │
         ▼                           │
┌────────────────────────────────┐  │
│ OcrPreviewStep                 │  │
│  - Show document type          │  │
│  - Show extracted fields       │  │
│  - Allow edits                 │  │
│  - User confirms               │  │
└────────┬───────────────────────┘  │
         │ 5. Confirmed data         │
         ▼                           │
┌────────────────────────────────┐  │
│ /api/staff-documents-upload    │  │
│ (MODIFIED Endpoint)            │  │
│  - Save to VF Storage          │  │
│  - Create staff_documents      │  │
│  - Store OCR result (status=   │  │
│    'confirmed')                │  │
│  - Apply extracted fields      │  │
│  - Skip webhook (already done) │  │
└────────────────────────────────┘  │
                                    │
         Timeout (>30s)             │
         or Error ─────────────────┘
         (Falls back to manual entry)
```

### 4.2 Component Structure

```
src/components/staff/
├── StaffDocumentUploadWizard.tsx          (NEW - 250 lines)
│   ├── State machine orchestration
│   ├── Step navigation logic
│   ├── OCR processing coordination
│   └── Final submission handler
│
└── documents/                             (NEW folder)
    ├── FileUploadStep.tsx                 (NEW - 100 lines)
    │   ├── File picker with drag-drop
    │   ├── File validation (type, size)
    │   └── Auto-advance to OCR
    │
    ├── OcrProcessingStep.tsx              (NEW - 80 lines)
    │   ├── Loading spinner
    │   ├── Progress estimation
    │   └── Timeout warning
    │
    ├── OcrPreviewStep.tsx                 (NEW - 200 lines)
    │   ├── Classification display
    │   ├── Top 3 guesses (if medium confidence)
    │   ├── Extracted fields form
    │   ├── Confidence badges
    │   └── Edit tracking
    │
    ├── ManualEntryStep.tsx                (NEW - 150 lines)
    │   ├── Traditional upload form
    │   ├── OCR error message display
    │   └── Reuse existing form fields
    │
    ├── ConfirmationStep.tsx               (NEW - 100 lines)
    │   ├── Final summary
    │   ├── Document type + name
    │   └── Key fields preview
    │
    └── ConfidenceBadge.tsx                (NEW - 50 lines)
        ├── Color-coded badges
        ├── Confidence percentage
        └── Validation status icon
```

### 4.3 API Specifications

#### NEW: POST `/api/documents-ocr-preview`

**Purpose:** Synchronous OCR processing without database save

**Request:**
```typescript
POST /api/documents-ocr-preview
Content-Type: multipart/form-data

{
  file: File,              // Required
  staffId: string,         // Required
  entityType: 'staff'      // Required
}
```

**Response (Success):**
```typescript
{
  success: true,
  classification: {
    documentType: 'id_document',           // Best guess
    confidence: 0.95,                       // 0.0 - 1.0
    displayName: 'SA ID Document',
    topGuesses: [
      { documentType: 'id_document', confidence: 0.95, displayName: 'SA ID Document' },
      { documentType: 'drivers_license', confidence: 0.55, displayName: "Driver's License" },
      { documentType: 'passport', confidence: 0.32, displayName: 'Passport' }
    ]
  },
  extractedFields: {
    idNumber: {
      value: '8501015800080',
      confidence: 0.95,
      validated: true,
      validationMessage: null
    },
    firstName: {
      value: 'JOHN',
      confidence: 0.92,
      validated: true
    },
    lastName: {
      value: 'SMITH',
      confidence: 0.95,
      validated: true
    },
    dateOfBirth: {
      value: '1985-01-01',
      confidence: 0.99,
      validated: true
    },
    gender: {
      value: 'Male',
      confidence: 0.99,
      validated: true
    }
  },
  suggestedDocumentName: 'SA ID - SMITH, JOHN - 8501015800080',
  rawText: '...',
  tierUsed: 'tesseract',
  processingTimeMs: 4237
}
```

**Response (Error):**
```typescript
{
  success: false,
  error: 'OCR_TIMEOUT' | 'SERVICE_UNAVAILABLE' | 'INVALID_FILE',
  message: 'OCR processing timed out after 30 seconds'
}
```

**Implementation Notes:**
- Timeout: 30 seconds hard limit
- File handling: Upload to temp location or stream directly to OCR
- No database writes
- Returns full OCR results for preview

#### MODIFIED: POST `/api/staff-documents-upload`

**New Parameters:**
```typescript
{
  // Existing parameters
  staffId: string,
  file: File,
  documentType: DocumentType,
  documentName: string,
  documentNumber?: string,
  issuedDate?: string,
  expiryDate?: string,
  issuingAuthority?: string,

  // NEW PARAMETERS
  ocrConfirmed: boolean,              // true if user reviewed OCR preview
  ocrResultPreview?: {                // OCR data from preview endpoint
    classification: {
      documentType: string,
      confidence: number,
      topGuesses: ClassificationGuess[]
    },
    extractedFields: ExtractedFields,
    rawText: string,
    tierUsed: OcrTier,
    processingTimeMs: number
  }
}
```

**Changes:**
1. Accept `ocrConfirmed` flag
2. If `ocrConfirmed=true`:
   - Store OCR result in `document_ocr_results` with `status='confirmed'`
   - Record `applied_fields` audit trail
   - Skip async webhook (OCR already processed)
3. If `ocrConfirmed=false`:
   - Traditional flow (save + trigger webhook)

### 4.4 State Machine

```typescript
type WizardStep =
  | 'file_upload'       // Initial state
  | 'ocr_processing'    // OCR in progress
  | 'ocr_preview'       // Show extracted data (if confidence >= 50%)
  | 'manual_entry'      // Fallback form (if confidence < 50% or error)
  | 'confirmation'      // Final review
  | 'saving'            // Submitting to API
  | 'complete';         // Success

interface WizardState {
  currentStep: WizardStep;
  file: File | null;

  // OCR results
  ocrResult: OcrPreviewResponse | null;
  ocrError: string | null;

  // User selections
  selectedDocumentType: DocumentType | null;
  documentName: string;
  extractedFields: ExtractedFields;
  fieldOverrides: Record<string, any>;

  // Flags
  ocrConfirmed: boolean;
  useManualEntry: boolean;
}
```

**Transition Rules:**
```
file_upload
  └─> file selected → ocr_processing

ocr_processing
  ├─> success (confidence >= 50%) → ocr_preview
  ├─> success (confidence < 50%) → manual_entry
  ├─> timeout → manual_entry
  └─> error → manual_entry

ocr_preview
  ├─> confirm → confirmation
  └─> "enter manually" clicked → manual_entry

manual_entry
  └─> confirm → confirmation

confirmation
  ├─> save → saving
  └─> back → ocr_preview | manual_entry

saving
  ├─> success → complete
  └─> error → ocr_preview | manual_entry

complete
  └─> close wizard
```

### 4.5 Database Schema

**No schema changes required!**

Existing tables support this flow:
- `staff_documents` - has all required fields
- `document_ocr_results` - has `status` enum with 'confirmed'
- `applied_fields` - tracks which fields were applied

**Optional enhancement:**
```sql
ALTER TABLE staff_documents
ADD COLUMN ocr_assisted BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN staff_documents.ocr_assisted IS
  'True if document was uploaded using OCR-first flow';
```

---

## 5. User Stories

### US-001: Happy Path - High Confidence OCR
**As a** HR admin
**I want to** upload an SA ID document without typing any fields
**So that** I can onboard staff faster and eliminate typing errors

**Acceptance Criteria:**
1. User clicks "Upload Document" button
2. User selects SA ID PDF file (no dropdown, no text entry)
3. Loading spinner shows "Analyzing document..." for ~5 seconds
4. System displays:
   - "Detected: SA ID Document (95% confidence)"
   - Extracted fields: ID Number, First Name, Last Name, DOB, Gender
   - All fields show green checkmarks (high confidence)
5. User reviews fields, clicks "Confirm & Save"
6. Document saves successfully
7. User sees success message with extracted data summary

**Success Metrics:**
- 95% of SA ID uploads use this flow
- < 20% of users edit extracted fields
- Upload completion time < 20 seconds

### US-002: Medium Confidence - Type Selection
**As a** HR admin
**I want to** see OCR's best guesses when document type is unclear
**So that** I can help the system classify correctly

**Acceptance Criteria:**
1. User uploads unclear document (e.g., bank letter on generic template)
2. OCR returns 65% confidence
3. System shows radio buttons:
   - ⦿ Bank Confirmation Letter (65%)
   - ○ Employment Contract (45%)
   - ○ Other Document (32%)
4. User selects correct type
5. System shows extracted fields for that document type
6. User confirms and saves

**Success Metrics:**
- User picks correct type >90% of the time
- User doesn't abandon upload

### US-003: Fallback to Manual Entry
**As a** HR admin
**I want to** enter document details manually if OCR fails
**So that** I can still complete the upload

**Acceptance Criteria:**
1. User uploads document
2. OCR service unavailable OR confidence < 50%
3. System shows clear message: "Could not classify document automatically"
4. Traditional upload form appears (document type dropdown, name field, etc.)
5. User fills form manually
6. Saves successfully

**Success Metrics:**
- < 15% of uploads use manual fallback
- Fallback form matches current upload UX exactly

### US-004: Field Editing
**As a** HR admin
**I want to** edit OCR-extracted fields before saving
**So that** I can fix any extraction errors

**Acceptance Criteria:**
1. User uploads document, OCR extracts fields
2. User notices ID number has typo: "850101580008O" (O instead of 0)
3. User clicks into ID number field, edits to correct value
4. Field shows "Edited by user" indicator
5. User confirms and saves
6. System tracks that this field was manually overridden

**Success Metrics:**
- Users can edit any field
- Edit tracking works for audit purposes

### US-005: Switch to Manual Mid-Flow
**As a** HR admin
**I want to** switch to manual entry even if OCR succeeds
**So that** I can have full control if needed

**Acceptance Criteria:**
1. User uploads document, sees OCR preview
2. User doesn't trust OCR results
3. User clicks "Enter Manually Instead" button
4. System switches to traditional form
5. User fills manually and saves

**Success Metrics:**
- < 5% of users switch to manual after seeing OCR preview
- Switch is seamless (no data loss)

---

## 6. Edge Cases & Error Handling

### EC-001: OCR Service Timeout
**Scenario:** OCR processing takes > 30 seconds

**Handling:**
1. Show timeout warning at 20 seconds: "Still processing... hang tight"
2. At 30 seconds, abort OCR request
3. Transition to manual_entry step
4. Show message: "Processing timed out. Please enter details manually."

### EC-002: OCR Service Unavailable
**Scenario:** OCR service at 100.96.203.105:8095 is down

**Handling:**
1. Detect connection error immediately
2. Transition to manual_entry step
3. Show message: "OCR service unavailable. Please enter details manually."
4. Log error for monitoring

### EC-003: Invalid File Type
**Scenario:** User selects .exe, .zip, or other invalid file

**Handling:**
1. Validate file type before OCR
2. Show error: "Invalid file type. Please upload PDF, JPG, PNG, DOCX, or XLSX."
3. Stay on file_upload step

### EC-004: File Too Large
**Scenario:** User uploads 50MB PDF (limit is 10MB)

**Handling:**
1. Validate file size before upload
2. Show error: "File too large (50MB). Maximum size is 10MB."
3. Stay on file_upload step

### EC-005: Zero Confidence Classification
**Scenario:** OCR cannot classify document type at all

**Handling:**
1. Check if `confidence === 0` or `documentType === 'unknown'`
2. Transition to manual_entry step
3. Show message: "Could not determine document type. Please select manually."

### EC-006: Network Error During Upload
**Scenario:** Upload to VF Storage fails

**Handling:**
1. Catch network error
2. Show error: "Upload failed. Please check your connection and try again."
3. Allow retry from file_upload step

### EC-007: User Closes Wizard Mid-OCR
**Scenario:** User navigates away while OCR processing

**Handling:**
1. Abort OCR request
2. Clean up temp files
3. No database writes (nothing saved)

---

## 7. Implementation Phases

### Phase 1: Core Infrastructure (Week 1)
**Goal:** Build foundational components and API endpoint

**Tasks:**
- [ ] Create `/api/documents-ocr-preview` endpoint
- [ ] Implement `StaffDocumentUploadWizard` state machine
- [ ] Build `FileUploadStep` component
- [ ] Build `OcrProcessingStep` component
- [ ] Add timeout handling (30s)
- [ ] Write unit tests for state transitions

**Deliverables:**
- API endpoint functional
- Wizard can upload file and call OCR
- Loading states work

### Phase 2: OCR Preview & Editing (Week 1)
**Goal:** Show OCR results and allow user editing

**Tasks:**
- [ ] Build `OcrPreviewStep` component
- [ ] Implement classification display (top 3 guesses)
- [ ] Implement extracted fields form
- [ ] Add confidence badges and color-coding
- [ ] Add field edit tracking
- [ ] Build `ConfidenceBadge` component

**Deliverables:**
- User can see OCR results
- User can edit fields
- Confidence indicators visible

### Phase 3: Fallback & Confirmation (Week 2)
**Goal:** Handle errors and complete save flow

**Tasks:**
- [ ] Build `ManualEntryStep` component (reuse existing form)
- [ ] Build `ConfirmationStep` component
- [ ] Implement error handling (timeout, service down)
- [ ] Modify `/api/staff-documents-upload` to accept OCR data
- [ ] Add OCR result storage logic
- [ ] Test all error paths

**Deliverables:**
- Manual fallback works
- Confirmation step works
- Save completes successfully
- Error handling robust

### Phase 4: Integration & Testing (Week 2)
**Goal:** Wire up to existing UI and test thoroughly

**Tasks:**
- [ ] Modify `StaffDocumentList.tsx` to use new wizard
- [ ] Add feature flag for gradual rollout
- [ ] Write integration tests
- [ ] Write E2E tests (Playwright)
- [ ] Performance testing (OCR response times)
- [ ] User acceptance testing

**Deliverables:**
- New wizard integrated
- All tests passing
- Ready for deployment

---

## 8. Testing Strategy

### 8.1 Unit Tests

```typescript
// StaffDocumentUploadWizard.test.tsx
describe('StaffDocumentUploadWizard', () => {
  it('should start at file_upload step');
  it('should transition to ocr_processing after file selection');
  it('should show ocr_preview on high confidence (≥80%)');
  it('should show ocr_preview with top 3 on medium confidence (50-80%)');
  it('should fallback to manual_entry on low confidence (<50%)');
  it('should allow field editing in ocr_preview');
  it('should track field overrides');
  it('should submit with ocrConfirmed=true when OCR used');
  it('should submit with ocrConfirmed=false when manual used');
});

// OcrPreviewStep.test.tsx
describe('OcrPreviewStep', () => {
  it('should display classification with confidence');
  it('should show top 3 guesses as radio buttons when confidence < 80%');
  it('should render all extracted fields');
  it('should color-code fields by confidence');
  it('should allow field editing');
  it('should track which fields were edited');
});
```

### 8.2 Integration Tests

```typescript
// /api/documents-ocr-preview.test.ts
describe('POST /api/documents-ocr-preview', () => {
  it('should return classification for SA ID document', async () => {
    const file = readFileSync('test/fixtures/sa-id.pdf');
    const response = await POST('/api/documents-ocr-preview', { file, staffId: 'abc' });

    expect(response.success).toBe(true);
    expect(response.classification.documentType).toBe('id_document');
    expect(response.classification.confidence).toBeGreaterThan(0.8);
    expect(response.extractedFields.idNumber).toBeDefined();
  });

  it('should return top 3 guesses for unclear document');
  it('should timeout after 30 seconds');
  it('should handle OCR service unavailable');
  it('should validate file type');
  it('should validate file size');
});
```

### 8.3 E2E Tests

```typescript
// upload-wizard.spec.ts
test('complete OCR-first upload flow with high confidence', async ({ page }) => {
  await page.goto('/staff/john-doe');
  await page.click('text=Documents');
  await page.click('text=Upload Document');

  // File selection
  await page.setInputFiles('input[type=file]', 'test/fixtures/sa-id.pdf');

  // OCR processing
  await page.waitForSelector('text=Analyzing document...');
  await page.waitForSelector('text=Detected: SA ID Document', { timeout: 15000 });

  // Preview step
  await expect(page.locator('[name=idNumber]')).toHaveValue('8501015800080');
  await expect(page.locator('[name=firstName]')).toHaveValue('JOHN');
  await expect(page.locator('[name=lastName]')).toHaveValue('SMITH');

  // Confirmation
  await page.click('text=Confirm & Save');
  await page.waitForSelector('text=Document uploaded successfully');

  // Verify in list
  await expect(page.locator('text=SA ID - SMITH, JOHN')).toBeVisible();
});

test('fallback to manual entry on OCR failure', async ({ page }) => {
  // Mock OCR service unavailable
  await page.route('**/api/documents-ocr-preview', route => route.abort());

  await page.goto('/staff/john-doe');
  await page.click('text=Upload Document');
  await page.setInputFiles('input[type=file]', 'test/fixtures/sa-id.pdf');

  // Should show manual form
  await page.waitForSelector('text=OCR service unavailable');
  await expect(page.locator('select[name=documentType]')).toBeVisible();

  // Fill manually
  await page.selectOption('select[name=documentType]', 'id_document');
  await page.fill('input[name=documentName]', 'SA ID Card');
  await page.click('text=Save');

  await page.waitForSelector('text=Document uploaded successfully');
});
```

---

## 9. Rollout & Monitoring

### 9.1 Feature Flag Strategy

```typescript
// Environment variable
NEXT_PUBLIC_OCR_WIZARD_ENABLED=true

// Component usage
const OCR_WIZARD_ENABLED = process.env.NEXT_PUBLIC_OCR_WIZARD_ENABLED === 'true';

{OCR_WIZARD_ENABLED ? (
  <StaffDocumentUploadWizard {...props} />
) : (
  <StaffDocumentUploadForm {...props} />  // Old form
)}
```

**Rollout Plan:**
1. **Week 1:** Deploy to dev.fibreflow.app (flag=true)
2. **Week 2:** Enable for beta users (10% of staff uploads)
3. **Week 3:** Gradual rollout to 50% of users
4. **Week 4:** Full rollout (100%)

### 9.2 Monitoring Metrics

**Key Metrics to Track:**

| Metric | Dashboard | Alert Threshold |
|--------|-----------|----------------|
| OCR preview usage rate | Grafana | < 70% |
| Manual fallback rate | Grafana | > 25% |
| OCR processing time | Grafana | P95 > 15s |
| OCR service uptime | Grafana | < 95% |
| User edit rate | Grafana | > 40% |
| Upload completion rate | Grafana | < 90% |
| Error rate (all steps) | Grafana | > 5% |

**Logging:**
```typescript
logger.info('ocr_wizard_step', {
  staffId,
  step: currentStep,
  documentType: selectedDocumentType,
  ocrConfidence: ocrResult?.classification.confidence,
  fieldsEdited: Object.keys(fieldOverrides).length,
  processingTimeMs: ocrResult?.processingTimeMs
});
```

### 9.3 Success Criteria for Full Rollout

**Required Metrics (All Must Pass):**
- [ ] OCR preview usage > 80%
- [ ] Manual fallback < 20%
- [ ] Average OCR processing time < 8 seconds
- [ ] User edit rate < 35%
- [ ] Upload completion rate > 95%
- [ ] Error rate < 3%

**User Feedback:**
- [ ] Positive feedback from 5+ beta users
- [ ] No critical bugs reported
- [ ] Task completion time improved vs. old form

---

## 10. Documentation & Training

### 10.1 User Documentation

**Create Documentation:**
- [ ] User guide: "How to Upload Documents with OCR"
- [ ] FAQ: "What to do if OCR doesn't detect document type"
- [ ] Video tutorial: "Uploading Staff Documents - The New Way"

**Content:**
1. **Quick Start:** "Just upload the file - we'll do the rest!"
2. **What to Expect:** "OCR takes 5-10 seconds to analyze your document"
3. **Review Fields:** "Check the extracted data and edit if needed"
4. **Trust the System:** "Green checkmarks mean high confidence"
5. **Fallback:** "If OCR fails, you can still enter manually"

### 10.2 Developer Documentation

**Technical Docs:**
- [ ] API reference: `/api/documents-ocr-preview`
- [ ] Component guide: `StaffDocumentUploadWizard` usage
- [ ] State machine diagram
- [ ] Error handling guide
- [ ] Testing guide

---

## 11. Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|-----------|
| OCR service downtime | High - users can't upload | Medium | Automatic fallback to manual form |
| OCR processing too slow | Medium - poor UX | Medium | 30s timeout, show progress, optimize OCR service |
| Low classification accuracy | Medium - manual fallback overused | Low | Improve training data, tune thresholds |
| User abandons during OCR wait | Low - incomplete uploads | Low | Show engaging progress indicator, optimize speed |
| Browser compatibility | Low - wizard doesn't work | Low | Test on all major browsers |
| Mobile UX issues | Medium - difficult on phone | Low | Responsive design, test on mobile |

---

## 12. Open Questions

1. **Q:** Should we pre-upload file to VF Storage before OCR, or stream directly?
   **A:** Pre-upload to VF Storage (more reliable, allows retry)

2. **Q:** What happens to existing uploaded documents without OCR data?
   **A:** They keep existing flow (async webhook). New flow only for new uploads.

3. **Q:** Should we allow users to trigger re-OCR on existing documents?
   **A:** Out of scope for this PRD. Consider for future enhancement.

4. **Q:** Should OCR preview show raw text for debugging?
   **A:** Only for admins (dev mode). Not for regular users.

---

## 13. Appendices

### A. Related Documents
- PRD-032: OCR Document Extraction System (foundation)
- `docs/docs/OCR_DOCUMENT_PROCESSING_PRD.md` - Technical architecture
- `docs/docs/claude-agent-sdk-key-concepts.md` - Agent patterns

### B. Glossary
- **OCR-first:** Process OCR before user input, not after
- **Synchronous OCR:** Wait for OCR to complete (vs. async webhook)
- **Classification confidence:** How certain OCR is about document type
- **Field extraction:** Pulling specific data points from OCR text
- **Fallback flow:** Manual entry when OCR fails
- **High confidence:** ≥80% classification or ≥90% field confidence
- **Medium confidence:** 50-80% classification
- **Low confidence:** <50% classification (triggers manual entry)

### C. Wireframes
*(To be added: Figma designs for each wizard step)*

### D. Performance Benchmarks
*(To be added: OCR processing time tests for each document type)*
