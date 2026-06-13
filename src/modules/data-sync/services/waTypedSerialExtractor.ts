/**
 * Pure extractor for ONT / UPS serials a technician TYPES into a WhatsApp
 * activation message (`dr_photo_unified_reviews.wa_original_text`).
 *
 * Audit rec #5 (part A). Until now a serial only reached the three-way
 * reconciliation (v_dr_reconciliation_ledger) via the photo SCAN
 * (`ont_serial_scanned`) or the 1Map intake (`onemap_ont_serial`). A serial a
 * tech merely TYPES — e.g. "DR1747382 S/N:ALCLB48E394B 5245 Simelane street" —
 * was captured as raw text but never parsed into a column the recon reads. This
 * module is that parser; `typedSerialPopulator.ts` persists the result and
 * migration 416 surfaces it as the WA leg's fallback in the ledger view.
 *
 * Vendor shapes (matched against real production wa_original_text, 2026-06-13):
 *   Nokia ONT  — ALCL.. / ALCB.. + hex   (e.g. ALCLB48E394B, ALCB47D5A8F)
 *   Huawei ONT — HWTC.. + hex            (e.g. HWTC8B9A1C2D)
 *   Gizzu UPS  — GU<dd><A><dd><A><dd><digits>  (e.g. GU18W12V2509045437)
 *
 * ANTI-FABRICATION RULE (the audit's "do NOT fabricate matches on ambiguous
 * text"): a serial is returned ONLY when the text yields EXACTLY ONE distinct
 * value of that kind. Zero matches → null. Two-or-more distinct → null (we will
 * not guess which one the tech meant). Repeats of the SAME value still resolve.
 *
 * Pure (no I/O, no deps) so it is bundle-safe and unit-testable without a DB.
 *
 * @module data-sync/services/waTypedSerialExtractor
 */

// ── Vendor patterns ──────────────────────────────────────────────────────────
// Anchored with \b so a label glued to the serial (`S/N:ALCLB48E394B`) still
// matches. Hex-only bodies ([A-F0-9]) match the real Nokia/Huawei labels and
// keep false positives low (random uppercase words do not look like serials).

// Nokia (ALCL/ALCB) + Huawei (HWTC) ONT.
const ONT_PATTERN = /\b(ALC[LB][A-F0-9]{6,12}|HWTC[A-F0-9]{6,12})\b/gi;

// Gizzu mini-UPS. Structured GU<2d><A><2d><A><2d><digits>; the production labels
// carry no separator but a legacy hyphen is tolerated.
const UPS_PATTERN = /\bGU\d{2}[A-Z]\d{2}[A-Z]\d{2}-?\d+\b/gi;

/**
 * Normalise a raw match: uppercase and strip any internal hyphen so a hyphenated
 * legacy Gizzu label compares equal to the scanned/1Map value.
 */
function normalise(raw: string): string {
  return raw.toUpperCase().replace(/-/g, '');
}

/**
 * Return the single confident serial of `pattern` in `text`, or null.
 * - 0 matches               → null
 * - 1 distinct value (incl. repeats) → that value (normalised)
 * - ≥2 distinct values      → null (ambiguous; never fabricate)
 */
function extractSingle(text: string | null | undefined, pattern: RegExp): string | null {
  if (!text) return null;
  const matches = text.match(pattern);
  if (!matches) return null;
  const distinct = new Set(matches.map(normalise));
  if (distinct.size !== 1) return null;
  return [...distinct][0] ?? null;
}

/**
 * The single confident TYPED ONT serial (Nokia/Huawei) in the message, or null.
 */
export function extractTypedOntSerial(text: string | null | undefined): string | null {
  return extractSingle(text, ONT_PATTERN);
}

/**
 * The single confident TYPED UPS serial (Gizzu) in the message, or null.
 */
export function extractTypedUpsSerial(text: string | null | undefined): string | null {
  return extractSingle(text, UPS_PATTERN);
}

export interface TypedSerials {
  ont: string | null;
  ups: string | null;
}

/**
 * Both typed serials in one pass — convenience for the populator.
 */
export function extractTypedSerials(text: string | null | undefined): TypedSerials {
  return {
    ont: extractTypedOntSerial(text),
    ups: extractTypedUpsSerial(text),
  };
}
