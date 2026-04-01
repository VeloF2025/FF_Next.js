/**
 * EOD Install Sheet VLM Extraction Service
 * Extracts data from photographed "Home Drop and Activation - Equipment Allocation Form"
 */

import { callVlmExtraction } from '@/modules/activate/services/vlmClient';
import type { EodVlmExtraction } from '../types';
import { log } from '@/lib/logger';

const EOD_EXTRACT_PROMPT = `You are extracting data from a physical "Home Drop and Activation - Equipment Allocation Form" used by Velocity Fibre field technicians.

The form is a table with up to 10 numbered rows. Extract ALL rows that have data.

For EACH row, extract:
- row_number: The row number (1-10)
- ont_serial: ONT Serial # (barcode sticker). Format: ALCLB4 followed by 6 hex characters (12 chars total). Look for sticker text starting with "ALCL".
- gizzu_serial: Gizzu Serial Number (UPS device). Format: starts with "GU" followed by alphanumeric characters (e.g. GU18W12V25...).
- dr_number: DR Number. Format: "DR" followed by 5-7 digits (e.g. DR1865310). May be handwritten.
- pon_number: PON number. Usually a 2-3 digit number (e.g. 128).
- address: Address or stand number. Could be a numeric stand number (e.g. 14643).

Also extract from the form header/footer:
- date: Install date. Convert from DD/MM/YYYY to YYYY-MM-DD format.
- technician_name: Technician name from the bottom of the form (next to "NAME & ID NUMBER").
- technician_id: Technician ID number if visible.

IMPORTANT:
- Read handwritten text carefully. Set confidence < 0.7 if uncertain.
- ONT serials MUST start with "ALCL". If it doesn't match, set confidence low.
- DR numbers MUST start with "DR". If you see just digits, prepend "DR".
- Skip completely empty rows.
- If a cell is blank or unreadable, set the value to null.

Respond in this exact JSON format:
{
  "date": "YYYY-MM-DD or null",
  "technician_name": "string or null",
  "technician_id": "string or null",
  "entries": [
    {
      "row_number": 1,
      "ont_serial": "ALCLXXXXXXXX or null",
      "gizzu_serial": "GU... or null",
      "dr_number": "DR1234567 or null",
      "pon_number": "128 or null",
      "address": "string or null",
      "confidence": 0.85
    }
  ],
  "overall_confidence": 0.8
}`;

/**
 * Extract data from an EOD install sheet photo using VLM
 */
export async function extractEodSheet(
  base64Image: string
): Promise<{ success: boolean; data: EodVlmExtraction | null; error?: string }> {
  const startTime = Date.now();

  const result = await callVlmExtraction<EodVlmExtraction>(
    base64Image,
    EOD_EXTRACT_PROMPT,
    'eod-sheet-extract'
  );

  const processingTimeMs = Date.now() - startTime;

  if (result.success && result.data) {
    // Normalize DR numbers
    result.data.entries = result.data.entries.map((entry) => ({
      ...entry,
      dr_number: normalizeDrNumber(entry.dr_number),
      ont_serial: entry.ont_serial?.toUpperCase() || null,
    }));

    log.info('[EOD-VLM] Extraction complete', {
      entries: result.data.entries.length,
      confidence: result.data.overall_confidence,
      processingTimeMs,
    });
  } else {
    log.warn('[EOD-VLM] Extraction failed', { error: result.error, processingTimeMs });
  }

  return result;
}

function normalizeDrNumber(dr: string | null): string | null {
  if (!dr) return null;
  const cleaned = dr.replace(/\s+/g, '').toUpperCase();
  if (cleaned.startsWith('DR')) return cleaned;
  if (/^\d{5,7}$/.test(cleaned)) return `DR${cleaned}`;
  return cleaned;
}
