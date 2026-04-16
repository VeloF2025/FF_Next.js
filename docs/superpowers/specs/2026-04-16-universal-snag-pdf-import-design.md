# Universal Snag PDF Import — Design Spec

**Date:** 2026-04-16  
**Status:** Approved  
**Scope:** Extend the existing TQR PDF import to auto-detect and import "field report" PDFs (simple 3-column table format), without breaking the TQR flow.

---

## Problem

The existing snag import only handles Tera Fibre Quality Report (TQR) PDFs. Field teams produce a different format — a simple 3-column table (Photo | Location | Snag description) with GPS links and embedded photos. These need to be imported without requiring the user to choose which format they're uploading.

---

## PDF Format Comparison

| Attribute | TQR Audit | Field Report (new) |
|---|---|---|
| Structure | Cover page + numbered findings + photo grid | 3-column table per page |
| Columns | Per-category findings | Photo \| Location \| Snag |
| GPS | Grid text (decimal) | Google Maps URL or DMS |
| Report number | Explicit (TQR 0012/2026) | None — auto-generated |
| Categories | quality/safety/health/env/traffic | All default to `quality` |
| Severity | Not in PDF — manually set | Auto-inferred from description |
| Audit scores | Yes | None (all zeros) |
| Photos per finding | 1 (sometimes more) | Exactly 1 |

### Field Report GPS Formats

Two formats seen in the wild:

- **URL**: `https://maps.google.com/maps?q=-26.1270374%2C28.473881&z=17&hl=en`  
  → Extract `q` param → decimal lat/lng directly

- **DMS text**: `26°07'41.2"S 28°28'29.6"E`  
  → Convert: `lat = -(deg + min/60 + sec/3600)`, `lng = deg + min/60 + sec/3600`

---

## Architecture

### New Files

| File | Purpose |
|---|---|
| `src/modules/construction-qa/services/detect-pdf-format.ts` | Detect `'tqr'` vs `'field_report'` from pdftotext output |
| `src/modules/construction-qa/services/field-report-pdf-parser.ts` | Parse 3-column table → ordered snag rows with GPS |

### Modified Files

| File | Change |
|---|---|
| `pages/api/snags/preview-pdf.ts` | Format detection → route to appropriate parser; return `format` field |
| `pages/api/snags/import-pdf.ts` | Format detection → route to appropriate import path |
| `src/modules/construction-qa/types/snag.types.ts` | Add `'field_report'` to `SnagPhotoSource` union |
| `src/modules/construction-qa/services/tqr-image-extractor.ts` | Add `filterFieldReportPhotos()` (no page filter, width > 150px) |
| `src/modules/construction-qa/components/snags/SnagImportDialog.tsx` | Format badge; hide audit scores for field reports |

---

## Module Designs

### 1. `detect-pdf-format.ts`

```typescript
export type PdfSnagFormat = 'tqr' | 'field_report' | 'unknown';

export function detectPdfFormat(pdfText: string): PdfSnagFormat {
  const isTqr =
    /Report\s+Document\s+No/i.test(pdfText) &&
    /Finding:/i.test(pdfText);
  if (isTqr) return 'tqr';

  const isFieldReport =
    /maps\.google\.com/i.test(pdfText) &&
    /\bSnag\b/i.test(pdfText);
  if (isFieldReport) return 'field_report';

  return 'unknown';
}
```

---

### 2. `field-report-pdf-parser.ts`

**Output types:**

```typescript
export interface FieldSnagRow {
  rowIndex: number;          // 0-based — used to map to photo
  description: string;       // raw snag text
  latitude: number | null;
  longitude: number | null;
  gpsRaw: string | null;     // original string for logging
  severity: SnagSeverity;    // auto-inferred
  category: SnagCategory;    // always 'quality'
}

export interface FieldReportParseResult {
  format: 'field_report';
  rows: FieldSnagRow[];
  suggestedName: string;     // from filename hint passed in, or 'Field Report'
}
```

**GPS parsing:**

```typescript
// URL format
function parseGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
  const match = url.match(/[?&]q=(-?\d+\.?\d+)%2C(\d+\.?\d+)/i);
  if (!match) return null;
  return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
}

// DMS format: "26°07'41.2"S 28°28'29.6"E"
function parseDms(dms: string): { lat: number; lng: number } | null {
  const m = dms.match(
    /(\d+)°(\d+)'([\d.]+)"([NS])\s+(\d+)°(\d+)'([\d.]+)"([EW])/
  );
  if (!m) return null;
  const lat = (parseInt(m[1]) + parseInt(m[2]) / 60 + parseFloat(m[3]) / 3600)
    * (m[4] === 'S' ? -1 : 1);
  const lng = (parseInt(m[5]) + parseInt(m[6]) / 60 + parseFloat(m[7]) / 3600)
    * (m[8] === 'W' ? -1 : 1);
  return { lat, lng };
}
```

**Severity inference:**

```typescript
const MAJOR_KEYWORDS = [
  'hanging', 'on the ground', 'incorrectly', 'broken',
  'no is working', 'not working', 'fallen', 'damaged',
];

function inferSeverity(description: string): SnagSeverity {
  const lower = description.toLowerCase();
  for (const kw of MAJOR_KEYWORDS) {
    if (lower.includes(kw)) return 'major';
  }
  return 'minor';
}
```

**Row extraction strategy:**

The pdftotext `-layout` output for this format has three columns of text. The parser:
1. Scans for lines containing Google Maps URLs or DMS coordinates → marks GPS
2. Captures text in the rightmost column (snag description) aligned with each GPS line
3. Groups consecutive GPS + description pairs as rows
4. Uses `rowIndex` (0-based, document order) to map to extracted photos

---

### 3. `tqr-image-extractor.ts` — new export

```typescript
/**
 * Filter images for field report format:
 * - No page restriction (whole doc is the table)
 * - Width > 150px to exclude any decorative elements
 * - Sorted by page → index (document reading order)
 */
export function filterFieldReportPhotos(images: ImageListEntry[]): ImageListEntry[] {
  return images
    .filter(img => img.width > 150)
    .sort((a, b) => a.page !== b.page ? a.page - b.page : a.index - b.index);
}
```

---

### 4. Preview API (`preview-pdf.ts`)

New flow after `pdftotext`:

```
detectPdfFormat(text)
  → 'tqr'          → existing parseTqrText() path (unchanged)
  → 'field_report' → parseFieldReport(text, filename)
  → 'unknown'      → 400 "Unrecognised PDF format"
```

Field report preview response adds `format: 'field_report'` to the result and populates:
- `metadata.reportNumber`: `FIELD-{slug}-{YYYY-MM-DD}` (slug from filename)
- `metadata.auditDate`: today's date
- `metadata.siteName`: original filename (stripped of `.pdf`)
- `findings`: one entry per `FieldSnagRow` (`number` = rowIndex+1, `description`, `category: 'quality'`)
- `auditScores`: all zeros
- `photoCount`: from `filterFieldReportPhotos()`

The existing `isDuplicate` check uses `report_number` — auto-generated field report numbers are unique by date+slug, so duplicates are unlikely but still checked.

---

### 5. Import API (`import-pdf.ts`)

Field report import path (after format detection):

1. `parseFieldReport(text, filename)` → rows
2. `listPdfImages(pdfPath)` → `filterFieldReportPhotos()` → extract JPEGs
3. `uploadSnagPhotos()` → VF Storage URLs (existing function, reused as-is)
4. `uploadSourcePdf()` → VF Storage
5. Insert `snag_report` (zeros for audit scores, today for `audit_date`)
6. For each row `i`:
   - Insert `snag` (`category: 'quality'`, `severity: rows[i].severity`, `description: rows[i].description`)
   - If `photos[i]` exists: insert `snag_photo` (`source: 'field_report'`, `latitude`, `longitude`, `phase: 'before'`)
7. **No pole auto-resolution** — field reports have no pole references
8. **Repeat detection runs** — same `detectRepeats()` call as TQR path

Photo-to-snag mapping: `photos[i] → snag at rowIndex i`. If photo count < row count, remaining snags get no photo. If photo count > row count, extras are discarded with a warning log.

---

### 6. `snag.types.ts`

```typescript
export type SnagPhotoSource =
  | 'tqr_import'
  | 'noc_upload'
  | 'manual'
  | 'whatsapp'
  | 'field_report';   // ← new
```

---

### 7. UI — `SnagImportDialog.tsx`

- **Format badge** on preview card: `TQR Audit` (blue) vs `Field Report` (orange)
- **Field report preview**: hide the audit scores chart section; show snag table with GPS coordinates column
- **TQR preview**: unchanged

No new wizard steps. One upload zone, one confirm button, for all formats.

---

## Data Model Impact

No schema changes required. All fields used are already present:

- `snag_photos.latitude` / `.longitude` — already exist (populated by TQR GPS too)
- `snag_photos.source` — adding new enum value `'field_report'` (application-level only, not a DB constraint)
- `snag_reports.import_notes` — used to record `"field_report"` format tag

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Unknown PDF format | 400 — "Unrecognised PDF format. Supported: TQR, Field Report" |
| GPS not found for a row | Row still imported, lat/lng null, warning logged |
| Photo count mismatch | Import continues, warning logged per unmatched row |
| Zero rows parsed | 400 — "No snag rows found in PDF" |
| Duplicate report number | Preview flags it, user can override |

---

## Out of Scope

- Multi-photo rows (each field report row has exactly 1 photo)
- Manual category override per snag at import time (can be edited post-import)
- Support for other field report formats (Excel, Word) — PDF only

---

## Success Criteria

1. Upload "Etwatwa 2 Snag Report.pdf" → format auto-detected as `field_report`
2. Preview shows N snags with descriptions and GPS coords
3. Import creates one snag per row, each with one photo linked at correct GPS
4. Existing TQR import flow unaffected
5. No new upload buttons or format-selection UI required
