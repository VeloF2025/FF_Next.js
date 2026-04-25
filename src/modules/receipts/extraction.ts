/**
 * Receipt VLM extraction — prompt + response parser.
 *
 * Mirrors the fuel-receipt extractor (src/modules/fleet/services/fuelExtractor.ts)
 * but generalised for any out-of-pocket / company-card receipt — coffee,
 * tools, accommodation, parking, etc. The VLM is given the closed
 * RECEIPT_CATEGORIES taxonomy and asked to pick one based on line
 * items + vendor name (ISAFlow bank-allocation pattern). The dropdown
 * pre-selects to that guess; staff can override.
 */

import { RECEIPT_CATEGORIES, coerceReceiptCategory, type ReceiptCategory } from './categories';

export const RECEIPT_PROMPT = `You are analysing a South African receipt or invoice photo for an expense-tracking app.

TASK: Extract the receipt header + classify the spend.

INSTRUCTIONS:
1. Find the vendor / merchant name (top of slip, often largest text or in a logo).
2. Find the total amount paid (in Rand / ZAR) — format: R1,234.56 or ZAR 1234.56.
3. Find the VAT amount if shown separately. Many slips show "VAT" or "BTW" or "15% VAT".
4. Find the transaction date (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, or written like "14 Jan 2026").
5. Read up to 5 line items if legible (item description + amount). Skip subtotals, VAT lines, tip prompts, change due.
6. Pick a single category from the closed list below based on what was bought.

CATEGORY TAXONOMY — pick exactly ONE from this list:
- fuel              — petrol / diesel / fuel station purchase
- tools             — hand tools, drill bits, hammer, etc.
- equipment         — power tools, ladders, generators, larger equipment
- materials         — cable, conduit, fasteners, brackets, fibre splice trays
- food              — meals, drinks, coffee, restaurants, takeaways
- accommodation     — hotels, guest houses, B&B, Airbnb
- parking           — parking-lot / parking-garage receipts
- tolls             — toll-gate receipts (e-toll, SANRAL)
- office_supplies   — stationery, printer toner, office consumables
- courier           — courier / postage / delivery slips
- other             — anything that doesn't fit

If you cannot determine confidently, return "other".

SOUTH AFRICAN CONTEXT:
- Currency: ZAR (Rand), written as "R" prefix, e.g. R850.50 or R1,234.56.
- Thousands separator is comma, decimal is period: R1,234.56.
- VAT is 15%. Often shown as "VAT @ 15%" or "BTW @ 15%".
- Common vendors: Shell, Engen, Sasol, BP, Caltex/Astron (fuel); Builders Warehouse, Cashbuild, Makro (materials/tools); Wimpy, Mugg & Bean, Vida e Caffè (food); Total parking, City Parking (parking).

THERMAL RECEIPT OCR CHALLENGES:
- Thermal paper fades — read faint/partial text carefully.
- "R" prefix may be faint or cut off — infer currency from context.
- Decimal points may be barely visible — if a total looks 100x too large, the decimal is probably missing.
- "1" and "l" (lowercase L) are commonly confused.
- "0" and "O" are commonly swapped.

RESPONSE FORMAT (JSON only, no other text):
{
  "vendor": "Engen Pretoria North",
  "total_rand": 412.50,
  "vat_rand": 53.80,
  "date": "2026-04-23",
  "category_guess": "fuel",
  "line_items": [
    {"description": "Diesel 50ppm", "amount_rand": 412.50}
  ],
  "confidence": 0.92
}

If receipt is unreadable or clearly not a receipt:
{
  "vendor": null,
  "total_rand": null,
  "vat_rand": null,
  "date": null,
  "category_guess": "other",
  "line_items": [],
  "confidence": 0
}`;

export interface ReceiptLineItem {
  description: string;
  amountCents: number | null;
}

export interface ReceiptExtraction {
  vendor: string | null;
  totalCents: number | null;
  vatCents: number | null;
  /** ISO date YYYY-MM-DD if VLM produced a recognisable date; else null. */
  date: string | null;
  categoryGuess: ReceiptCategory;
  lineItems: ReceiptLineItem[];
  confidence: number;
  /** Original VLM JSON, retained for the detail view + future re-extraction. */
  raw: Record<string, unknown>;
}

/**
 * Parse the VLM's JSON response into typed receipt extraction.
 * Lenient — bad fields become null rather than throwing, so the staff
 * review step always renders and the user can correct.
 */
export function parseReceiptVlmResponse(raw: unknown): ReceiptExtraction {
  const obj = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {});

  const vendor = typeof obj.vendor === 'string' && obj.vendor.trim() ? obj.vendor.trim() : null;
  const totalCents = randToCents(obj.total_rand);
  const vatCents = randToCents(obj.vat_rand);
  const date = normaliseDate(obj.date);
  const categoryGuess = coerceReceiptCategory(obj.category_guess);

  const lineItems: ReceiptLineItem[] = Array.isArray(obj.line_items)
    ? obj.line_items
        .map((item) => {
          if (typeof item !== 'object' || item === null) return null;
          const li = item as Record<string, unknown>;
          const description = typeof li.description === 'string' ? li.description.trim() : '';
          if (!description) return null;
          return {
            description,
            amountCents: randToCents(li.amount_rand),
          } satisfies ReceiptLineItem;
        })
        .filter((x): x is ReceiptLineItem => x !== null)
        .slice(0, 10)
    : [];

  const confidence = clamp01(toNumberOrNull(obj.confidence) ?? 0);

  return {
    vendor,
    totalCents,
    vatCents,
    date,
    categoryGuess,
    lineItems,
    confidence,
    raw: obj,
  };
}

function randToCents(value: unknown): number | null {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  if (n < 0) return null;
  return Math.round(n * 100);
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[Rr\s]/g, '').replace(/,/g, '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Convert assorted date strings to YYYY-MM-DD. Handles:
 *   - 2026-04-23, 2026/04/23
 *   - 23/04/2026, 23-04-2026  (DD-MM-YYYY, SA convention)
 *   - 23 Apr 2026, 23 April 2026 (English month names)
 * Returns null on anything unparseable so the review step shows blank
 * and forces the user to set the date explicitly.
 */
function normaliseDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const slashIso = s.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (slashIso) return `${slashIso[1]}-${slashIso[2]}-${slashIso[3]}`;

  const ddmmyyyy = s.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;

  const months: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', sept: '09', september: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };
  const dmy = s.toLowerCase().match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (dmy && months[dmy[2]!]) {
    const day = dmy[1]!.padStart(2, '0');
    return `${dmy[3]}-${months[dmy[2]!]}-${day}`;
  }

  return null;
}

/** Re-export the closed taxonomy for callers (keeps imports concise). */
export { RECEIPT_CATEGORIES };
