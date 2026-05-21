/**
 * Extracts DR numbers and ONT serial numbers from free-form WhatsApp text.
 *
 * Serial vendor prefixes covered:
 *   ALCL / ALCB — Nokia
 *   HWTC        — Huawei
 *   GU<dd><A><dd><A><dd>-<digits> — Gizzu (per project_eod_multi_sheet_upload memory)
 *
 * Anything else is intentionally ignored to keep false positives low. New
 * vendors should be added here as a single union with explicit shape.
 *
 * @module noc/services/waReferenceExtractor
 */

// DR<6-8 digits>, optional space or dash separator
const DR_PATTERN = /\bDR[\s-]?(\d{6,8})\b/gi;

// Union of supported ONT serial shapes. The `i` flag normalises case; callers
// uppercase the captured token before comparison.
const SERIAL_PATTERN =
  /\b(ALC[LB][A-F0-9]{6,12}|HWTC[A-F0-9]{6,12}|GU\d{2}[A-Z]\d{2}[A-Z]\d{2}-?\d+)\b/gi;

export function extractDRNumbers(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(DR_PATTERN);
  if (!matches) return [];
  const normalised = matches.map((m) => m.toUpperCase().replace(/[\s-]/g, ''));
  return [...new Set(normalised)];
}

export function extractOntSerials(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(SERIAL_PATTERN);
  if (!matches) return [];
  const normalised = matches.map((m) => m.toUpperCase().replace(/-/g, ''));
  return [...new Set(normalised)];
}
