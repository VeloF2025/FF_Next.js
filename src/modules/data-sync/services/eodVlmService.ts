/**
 * EOD Install Sheet VLM Extraction Service
 * Two-pass extraction:
 *   Pass 1: zxing barcode scanner finds all ONT serial barcodes
 *   Pass 2: VLM extracts table data with barcode hints for accurate serial matching
 */

import {
  VLM_API_ENDPOINT,
  VLM_MODEL,
  VLM_TEMPERATURE,
  VLM_TIMEOUT_MS,
} from '@/modules/activate/services/vlmClient';
import { scanAllBarcodes } from '@/modules/activate/services/enhancedBarcodeService';
import type { EodVlmExtraction } from '../types';
import { log } from '@/lib/logger';

const EOD_MAX_TOKENS = 4000;

function buildPrompt(barcodeHints: string[]): string {
  const barcodeSection = barcodeHints.length > 0
    ? `\n\nBARCODE SCANNER RESULTS (high-accuracy ONT serials detected in this image):\n${barcodeHints.map((b, i) => `  ${i + 1}. ${b}`).join('\n')}\nAssign these serials to the matching rows based on their visual position in the table. These are MORE accurate than OCR — prefer these values for ont_serial.\n`
    : '\n\nNo barcode stickers were machine-decoded. Try to read ONT serial text manually.\n';

  return `You are extracting data from a physical "Home Drop and Activation - Equipment Allocation Form" used by Velocity Fibre field technicians.

The form is a table with up to 10 numbered rows. Extract ALL rows that have data.

IMPORTANT CONTEXT: DR numbers in this system start with "DR18" (not DR19). The "1" and "8" in handwriting can look like "1" and "9" — always assume DR18xxxxx.

For EACH row, extract:
- row_number: The row number (1-10)
- ont_serial: ONT Serial # from the barcode sticker column. Use the barcode scanner results below if available.
- gizzu_serial: Gizzu Serial Number (UPS device). Format: starts with "GU18W12V25" followed by digits.
- dr_number: DR Number. Format: "DR18" followed by 3-5 digits. ALWAYS starts with DR18.
- pon_number: PON number. Usually 121-128.
- address: Address or stand number (4-5 digit number).

Also extract from the form header/footer:
- date: Install date. Convert from DD/MM/YYYY to YYYY-MM-DD format.
- technician_name: Full name from the bottom of the form (next to "NAME & ID NUMBER").
- technician_id: ID number if visible.
${barcodeSection}
RULES:
- DR numbers MUST start with "DR18". If you read "DR19", it's likely "DR18" misread.
- Read each digit carefully. Handwritten 8 and 9 look similar — default to 8 for DR prefix.
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
      "dr_number": "DR18XXXXX or null",
      "pon_number": "128 or null",
      "address": "string or null",
      "confidence": 0.85
    }
  ],
  "overall_confidence": 0.8
}`;
}

/**
 * Extract data from an EOD install sheet photo.
 * Pass 1: Barcode scan for ONT serials. Pass 2: VLM for all other fields.
 */
export async function extractEodSheet(
  base64Image: string
): Promise<{ success: boolean; data: EodVlmExtraction | null; error?: string }> {
  const startTime = Date.now();

  // Pass 1: Barcode extraction
  let barcodeHints: string[] = [];
  try {
    const barcodeResult = await scanAllBarcodes(base64Image);
    if (barcodeResult.success && barcodeResult.barcodes.length > 0) {
      barcodeHints = barcodeResult.barcodes.map((b) => b.value);
      log.info('[EOD-VLM] Barcode scan found serials', {
        count: barcodeHints.length,
        serials: barcodeHints,
      });
    }
  } catch (err) {
    log.warn('[EOD-VLM] Barcode scan failed, proceeding with VLM only', { error: err });
  }

  // Pass 2: VLM extraction with barcode hints
  try {
    const prompt = buildPrompt(barcodeHints);
    const requestBody = {
      model: VLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
          ],
        },
      ],
      max_tokens: EOD_MAX_TOKENS,
      temperature: VLM_TEMPERATURE,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VLM API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in VLM response');
    }

    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/```\n([\s\S]*?)\n```/) ||
      [null, content];

    const parsed: EodVlmExtraction = JSON.parse(jsonMatch[1] || content);

    // Normalize entries
    parsed.entries = parsed.entries.map((entry) => ({
      ...entry,
      dr_number: normalizeDrNumber(entry.dr_number),
      ont_serial: entry.ont_serial?.toUpperCase() || null,
    }));

    const processingTimeMs = Date.now() - startTime;
    log.info('[EOD-VLM] Extraction complete', {
      entries: parsed.entries.length,
      barcodesFound: barcodeHints.length,
      confidence: parsed.overall_confidence,
      processingTimeMs,
    });

    return { success: true, data: parsed };
  } catch (error: unknown) {
    const processingTimeMs = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown VLM error';
    log.error('[EOD-VLM] Extraction failed', { error: message, processingTimeMs });
    return { success: false, data: null, error: message };
  }
}

function normalizeDrNumber(dr: string | null): string | null {
  if (!dr) return null;
  let cleaned = dr.replace(/\s+/g, '').toUpperCase();
  // Fix common misread: DR19 → DR18
  if (cleaned.startsWith('DR19')) {
    cleaned = 'DR18' + cleaned.slice(4);
  }
  if (cleaned.startsWith('DR')) return cleaned;
  if (/^\d{5,7}$/.test(cleaned)) return `DR${cleaned}`;
  return cleaned;
}
