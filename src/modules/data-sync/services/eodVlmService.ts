/**
 * EOD Install Sheet VLM Extraction Service
 * Two-pass extraction:
 *   Pass 0: Image preprocessing (auto-rotate, contrast, sharpen)
 *   Pass 1: Enhanced barcode scanner with multi-strategy preprocessing
 *   Pass 2: VLM extracts table data with barcode hints
 */

import {
  VLM_API_ENDPOINT,
  VLM_MODEL,
  VLM_TEMPERATURE,
  VLM_TIMEOUT_MS,
} from '@/modules/activate/services/vlmClient';
import { scanBarcodeEnhanced } from '@/modules/activate/services/enhancedBarcodeService';
import type { EodVlmExtraction } from '../types';
import { log } from '@/lib/logger';
import sharp from 'sharp';

const EOD_MAX_TOKENS = 4000;

/**
 * Preprocess image for barcode scanning and VLM:
 * - Auto-rotate using EXIF data
 * - Enhance contrast and sharpen
 * - Return both preprocessed buffer and base64
 */
async function preprocessEodImage(base64Image: string): Promise<{
  processedBase64: string;
  rotations: string[];  // base64 images at 0°, 90°, 180°, 270° for barcode scanning
}> {
  const imageBuffer = Buffer.from(base64Image, 'base64');

  // Auto-rotate from EXIF + enhance for VLM
  const processed = await sharp(imageBuffer)
    .rotate() // Auto-rotate based on EXIF orientation
    .normalise()
    .sharpen({ sigma: 1.5 })
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();

  const processedBase64 = processed.toString('base64');

  // Create rotated versions for barcode scanning
  const rotations: string[] = [processedBase64];
  for (const angle of [90, 180, 270] as const) {
    const rotated = await sharp(processed).rotate(angle).jpeg({ quality: 90 }).toBuffer();
    rotations.push(rotated.toString('base64'));
  }

  return { processedBase64, rotations };
}

/**
 * Scan for all ONT serial barcodes across all rotations
 */
async function scanBarcodesMultiRotation(rotations: string[]): Promise<string[]> {
  const found = new Set<string>();
  const ONT_PATTERN = /^ALC[LB][A-Z0-9]{7,9}$/i;

  for (let i = 0; i < rotations.length; i++) {
    try {
      const result = await scanBarcodeEnhanced(rotations[i]!, { maxAttempts: 5 });
      if (result.success && result.value && ONT_PATTERN.test(result.value)) {
        found.add(result.value.toUpperCase());
        log.info(`[EOD-Barcode] Found serial at rotation ${i * 90}°: ${result.value}`);
      }
    } catch {
      // Continue with next rotation
    }
  }

  return Array.from(found);
}

function buildPrompt(barcodeHints: string[]): string {
  const barcodeSection = barcodeHints.length > 0
    ? `\n\nBARCODE SCANNER RESULTS (machine-decoded ONT serials from this image):\n${barcodeHints.map((b, i) => `  ${i + 1}. ${b}`).join('\n')}\nThese are accurate. Assign them to the matching rows. If there are fewer barcodes than rows, some stickers may be unreadable — set those to null.\n`
    : '\n\nNo barcode stickers were machine-decoded. Try to read ONT serial text manually if visible.\n';

  return `You are extracting data from a physical "Home Drop and Activation - Equipment Allocation Form" used by Velocity Fibre field technicians.

The form is a table with up to 10 numbered rows. Extract ALL rows that have data. Each row has DIFFERENT values — do NOT duplicate rows.

CRITICAL: Each row in the table has UNIQUE values. Read each row individually and carefully. Common patterns:
- DR numbers change per row (e.g. DR1865110, DR1864446, DR1865342 — each is different)
- Addresses change per row (e.g. 14643, 14627, 14813 — each is different)
- PON numbers may vary (e.g. 128, 127, 121)
- Gizzu serials change per row (different suffix after GU18W12V25)

For EACH row, extract:
- row_number: The row number (1-10)
- ont_serial: ONT Serial # from barcode sticker. Use barcode scanner results if available.
- gizzu_serial: Gizzu Serial Number. Format: GU18W12V25 followed by varying digits per row.
- dr_number: DR Number. ALWAYS starts with "DR18" followed by 3-5 digits. Each row has a DIFFERENT DR number.
- pon_number: PON number (121-128 range).
- address: Stand number (4-5 digit number). Each row has a DIFFERENT address.

Also extract from the form header/footer:
- date: Install date in YYYY-MM-DD format (convert from DD/MM/YYYY).
- technician_name: Full name from bottom of form.
- technician_id: ID number if visible.
${barcodeSection}
RULES:
- DR numbers MUST start with "DR18". Handwritten 8 often looks like 9 — always use 8.
- EVERY row must have UNIQUE values. If you find yourself repeating values, re-read the form.
- Read each cell position carefully — the handwriting varies per row.
- If a cell is blank or unreadable, set to null.

Respond in this exact JSON format:
{
  "date": "YYYY-MM-DD or null",
  "technician_name": "string or null",
  "technician_id": "string or null",
  "entries": [
    {
      "row_number": 1,
      "ont_serial": "ALCLXXXXXXXX or null",
      "gizzu_serial": "GU18W12V25... or null",
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
 * Pass 0: Preprocess image (auto-rotate, enhance)
 * Pass 1: Multi-rotation barcode scan for ONT serials
 * Pass 2: VLM extraction with barcode hints and domain context
 */
export async function extractEodSheet(
  base64Image: string
): Promise<{ success: boolean; data: EodVlmExtraction | null; error?: string }> {
  const startTime = Date.now();

  // Pass 0: Preprocess
  let processedBase64 = base64Image;
  let barcodeHints: string[] = [];

  try {
    const preprocessed = await preprocessEodImage(base64Image);
    processedBase64 = preprocessed.processedBase64;

    // Pass 1: Barcode scan across all rotations
    barcodeHints = await scanBarcodesMultiRotation(preprocessed.rotations);
    log.info('[EOD] Preprocessing + barcode scan done', {
      barcodesFound: barcodeHints.length,
      serials: barcodeHints,
      preprocessTimeMs: Date.now() - startTime,
    });
  } catch (err) {
    log.warn('[EOD] Preprocessing/barcode scan failed, continuing with VLM only', { error: err });
  }

  // Pass 2: VLM extraction
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
              image_url: { url: `data:image/jpeg;base64,${processedBase64}` },
            },
          ],
        },
      ],
      max_tokens: EOD_MAX_TOKENS,
      temperature: VLM_TEMPERATURE,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS * 2); // 2min for EOD

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
  if (cleaned.startsWith('DR19')) {
    cleaned = 'DR18' + cleaned.slice(4);
  }
  if (cleaned.startsWith('DR')) return cleaned;
  if (/^\d{5,7}$/.test(cleaned)) return `DR${cleaned}`;
  return cleaned;
}
