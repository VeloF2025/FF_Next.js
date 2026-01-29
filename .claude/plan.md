# OCR Quote Scanning & RFQ Matching Feature

## Overview
Add ability to scan supplier quote documents (PDF/images) using VLM/OCR and automatically match extracted line items to the RFQ items, pre-populating the quote submission form.

## User Story
As a procurement officer, I want to upload a supplier's PDF/paper quote and have the system automatically extract line items, prices, and terms, then match them to my RFQ items so I can quickly create quotes without manual data entry.

---

## Architecture

### Existing Services to Leverage

| Service | Location | Purpose |
|---------|----------|---------|
| VLM Service | `100.96.203.105:8100` | Qwen3-VL-8B for document understanding |
| OCR Service | `100.96.203.105:8093` | 4-tier cascade (Tesseract → PaddleOCR → OCR.Space → Gemini) |
| VF Storage | `100.96.203.105:8091` | File storage for uploaded quotes |
| Barcode Service | `barcodeExtractionService.ts` | Extract product codes from labels |

### New Components

```
src/
├── modules/procurement/quote-scanner/
│   ├── components/
│   │   ├── QuoteScannerModal.tsx      # Upload & preview modal
│   │   ├── QuoteExtractionResults.tsx # Show extracted data
│   │   └── QuoteMatchingReview.tsx    # Confirm RFQ item matching
│   ├── services/
│   │   └── quoteExtractionService.ts  # VLM extraction logic
│   └── types/
│       └── extraction.types.ts        # Type definitions
└── pages/api/procurement/quotes/
    └── extract-from-document.ts       # API endpoint
```

---

## Implementation Plan

### Phase 1: Quote Extraction Service

**File:** `src/modules/procurement/quote-scanner/services/quoteExtractionService.ts`

**Capabilities:**
1. **Document Upload & Processing**
   - Accept PDF, JPG, PNG documents
   - Convert PDF pages to images for VLM processing
   - Resize images to VLM limits (1280x960)

2. **VLM Extraction Prompt**
   ```
   Extract the following from this supplier quote document:
   - Supplier company name
   - Quote/reference number
   - Quote date
   - Validity period
   - Payment terms
   - Delivery terms
   - Line items with: description, quantity, unit, unit price, total
   - VAT/tax amount
   - Total amount

   Return as JSON with confidence scores.
   ```

3. **OCR Fallback**
   - If VLM extraction fails, use OCR service
   - Pattern-based extraction for common quote formats

4. **Data Normalization**
   - Currency detection (ZAR, USD, EUR)
   - Unit standardization (each, m, kg, etc.)
   - Number parsing (handle comma/period decimals)

### Phase 2: RFQ Item Matching Algorithm

**File:** `src/modules/procurement/quote-scanner/services/quoteMatchingService.ts`

**Matching Logic:**
1. **Exact Code Match** (highest confidence)
   - Match extracted item codes to RFQ item codes/SKUs

2. **Fuzzy Description Match**
   - Use Levenshtein distance or similar
   - Threshold: 80% similarity
   - Consider: synonyms, abbreviations

3. **Quantity + Unit Match**
   - Validate quantities align with RFQ requirements
   - Flag discrepancies (e.g., quote for 100m, RFQ for 500m)

4. **Manual Override**
   - Allow user to manually link unmatched items
   - Learn from corrections for future matching

### Phase 3: API Endpoint

**File:** `pages/api/procurement/quotes/extract-from-document.ts`

```typescript
POST /api/procurement/quotes/extract-from-document
Content-Type: multipart/form-data

Body:
- document: File (PDF/JPG/PNG, max 20MB)
- rfqId: string (optional - for matching)
- projectId: string

Response:
{
  success: true,
  extraction: {
    supplier: { name, contact, email },
    quoteNumber: string,
    quoteDate: string,
    validUntil: string,
    paymentTerms: string,
    deliveryTerms: string,
    lineItems: [
      {
        description: string,
        itemCode?: string,
        quantity: number,
        unit: string,
        unitPrice: number,
        totalPrice: number,
        confidence: number
      }
    ],
    subtotal: number,
    vatAmount: number,
    totalAmount: number,
    currency: string
  },
  matching?: {
    rfqId: string,
    matchedItems: [
      {
        extractedIndex: number,
        rfqItemId: string,
        rfqItemDescription: string,
        matchConfidence: number,
        matchReason: 'exact_code' | 'fuzzy_description' | 'manual'
      }
    ],
    unmatchedItems: number[]
  },
  documentUrl: string,
  processingTime: number
}
```

### Phase 4: UI Components

#### A. QuoteScannerModal
**Location:** `src/modules/procurement/quote-scanner/components/QuoteScannerModal.tsx`

**Features:**
- Drag-and-drop upload area
- PDF preview (first page)
- Processing indicator with status
- "Extract Quote" button

#### B. QuoteExtractionResults
**Location:** `src/modules/procurement/quote-scanner/components/QuoteExtractionResults.tsx`

**Features:**
- Display extracted supplier info
- Show line items in editable table
- Confidence indicators (green/yellow/red)
- Edit capability for corrections

#### C. QuoteMatchingReview
**Location:** `src/modules/procurement/quote-scanner/components/QuoteMatchingReview.tsx`

**Features:**
- Side-by-side: Extracted items ↔ RFQ items
- Visual match indicators
- Manual linking dropdown for unmatched
- "Create Quote" button to populate form

### Phase 5: Integration Points

1. **RFQ Detail Page**
   - Add "Scan Quote Document" button in Quotes tab
   - Opens QuoteScannerModal

2. **Quote Submission Form**
   - Pre-populate from extraction results
   - Highlight auto-filled fields

3. **Supplier Portal** (optional)
   - Allow suppliers to upload quote PDFs
   - Auto-extract for their submission

---

## Database Changes

### New Table: `quote_extractions`
```sql
CREATE TABLE quote_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfq_id UUID REFERENCES rfqs(id),
  project_id UUID NOT NULL,

  -- Source document
  document_url TEXT NOT NULL,
  document_type VARCHAR(20), -- 'pdf' | 'image'

  -- Extraction results
  extraction_data JSONB NOT NULL,
  confidence_score NUMERIC(3,2),
  processing_time_ms INTEGER,

  -- Matching results
  matching_data JSONB,

  -- Status
  status VARCHAR(20) DEFAULT 'extracted', -- extracted | matched | applied | failed
  applied_to_quote_id UUID REFERENCES quotes(id),

  -- Audit
  created_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_quote_extractions_rfq ON quote_extractions(rfq_id);
CREATE INDEX idx_quote_extractions_project ON quote_extractions(project_id);
```

---

## VLM Prompt Design

```typescript
const QUOTE_EXTRACTION_PROMPT = `
You are analyzing a supplier quote document. Extract all information and return as JSON.

CRITICAL: Extract EXACTLY what you see. Do not infer or calculate values.

Return this JSON structure:
{
  "supplier": {
    "name": "Company name from letterhead",
    "address": "Full address if visible",
    "phone": "Phone number if visible",
    "email": "Email if visible",
    "vatNumber": "VAT number if visible"
  },
  "quoteInfo": {
    "quoteNumber": "Quote/reference number",
    "quoteDate": "Date in YYYY-MM-DD format",
    "validUntil": "Validity date in YYYY-MM-DD format",
    "paymentTerms": "Payment terms text",
    "deliveryTerms": "Delivery terms text",
    "deliveryDays": "Number of days for delivery if specified"
  },
  "lineItems": [
    {
      "lineNumber": 1,
      "itemCode": "Product code/SKU if visible",
      "description": "Full item description",
      "quantity": 100,
      "unit": "m" or "each" or "kg" etc,
      "unitPrice": 125.50,
      "totalPrice": 12550.00,
      "notes": "Any additional notes for this item"
    }
  ],
  "totals": {
    "subtotal": 12550.00,
    "vatRate": 15,
    "vatAmount": 1882.50,
    "total": 14432.50,
    "currency": "ZAR"
  },
  "extractionNotes": "Any issues or uncertainties with the extraction"
}

If a field is not visible, use null. For amounts, use numeric values without currency symbols.
`;
```

---

## Matching Algorithm Pseudocode

```typescript
function matchExtractedToRfq(
  extractedItems: ExtractedLineItem[],
  rfqItems: RfqItem[]
): MatchResult[] {
  const results: MatchResult[] = [];

  for (const extracted of extractedItems) {
    // 1. Try exact code match
    if (extracted.itemCode) {
      const exactMatch = rfqItems.find(
        r => r.itemCode?.toLowerCase() === extracted.itemCode?.toLowerCase()
      );
      if (exactMatch) {
        results.push({
          extractedIndex: extracted.lineNumber,
          rfqItemId: exactMatch.id,
          confidence: 0.95,
          reason: 'exact_code'
        });
        continue;
      }
    }

    // 2. Try fuzzy description match
    let bestMatch = { rfqItem: null, score: 0 };
    for (const rfqItem of rfqItems) {
      const score = fuzzyMatch(extracted.description, rfqItem.description);
      if (score > bestMatch.score && score > 0.7) {
        bestMatch = { rfqItem, score };
      }
    }

    if (bestMatch.rfqItem) {
      results.push({
        extractedIndex: extracted.lineNumber,
        rfqItemId: bestMatch.rfqItem.id,
        confidence: bestMatch.score,
        reason: 'fuzzy_description'
      });
    } else {
      // Unmatched - requires manual linking
      results.push({
        extractedIndex: extracted.lineNumber,
        rfqItemId: null,
        confidence: 0,
        reason: 'unmatched'
      });
    }
  }

  return results;
}
```

---

## Files to Create/Modify

### New Files
1. `src/modules/procurement/quote-scanner/services/quoteExtractionService.ts`
2. `src/modules/procurement/quote-scanner/services/quoteMatchingService.ts`
3. `src/modules/procurement/quote-scanner/components/QuoteScannerModal.tsx`
4. `src/modules/procurement/quote-scanner/components/QuoteExtractionResults.tsx`
5. `src/modules/procurement/quote-scanner/components/QuoteMatchingReview.tsx`
6. `src/modules/procurement/quote-scanner/types/extraction.types.ts`
7. `pages/api/procurement/quotes/extract-from-document.ts`
8. `scripts/migrations/XXX_quote_extractions.sql`

### Modified Files
1. `src/modules/procurement/rfq/components/RFQDetailPage.tsx` - Add scan button
2. `src/modules/procurement/suppliers/components/quote-modal/QuoteSubmissionModal.tsx` - Accept pre-populated data

---

## Success Criteria

1. **Extraction Accuracy**: >85% accuracy on standard quote PDF formats
2. **Matching Accuracy**: >90% correct matches for items with codes
3. **Processing Time**: <30 seconds for typical 1-2 page quotes
4. **User Flow**: 3 clicks from upload to populated quote form

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Poor OCR on scanned documents | Use VLM (better at understanding context) |
| Non-standard quote formats | Provide manual editing of extracted data |
| Item matching failures | Allow manual linking with dropdown |
| Large PDF files | Limit to first 5 pages, 20MB max |

---

## Implementation Order

1. **Migration** - Create `quote_extractions` table
2. **Types** - Define extraction interfaces
3. **Extraction Service** - VLM integration
4. **API Endpoint** - Document upload + extraction
5. **Matching Service** - RFQ item matching logic
6. **UI Components** - Scanner modal, results, matching review
7. **Integration** - Add to RFQ detail page
8. **Testing** - Test with real supplier quote PDFs
