/**
 * EOD Install Sheet VLM Extraction Service
 *
 * Three-pass extraction:
 *   Pass 0: Image preprocessing — auto-rotate (EXIF), enhance, create variants
 *   Pass 1: Multi-barcode scan — scanAllBarcodes on each preprocessed variant
 *   Pass 2: VLM row-by-row extraction with barcode hints and strict prompting
 */

import {
  VLM_API_ENDPOINT,
  VLM_MODEL,
  VLM_TIMEOUT_MS,
} from '@/modules/activate/services/vlmClient';
import { scanAllBarcodes } from '@/modules/activate/services/enhancedBarcodeService';
import type { EodVlmExtraction } from '../types';
import { log } from '@/lib/logger';
import sharp from 'sharp';

const EOD_MAX_TOKENS = 4096;
const ONT_PATTERN = /^(SN:)?ALC[LB][A-Z0-9]{5,10}$/i;

/**
 * Preprocess image: auto-rotate, create multiple enhanced variants for barcode scanning.
 */
async function preprocessEodImage(base64Image: string): Promise<{
  vlmBase64: string;
  barcodeVariants: string[];
}> {
  const raw = Buffer.from(base64Image, 'base64');

  // Auto-rotate from EXIF — critical for sideways phone photos
  const rotated = await sharp(raw).rotate().toBuffer();

  // VLM version: full resolution, light enhance only
  const vlmBuf = await sharp(rotated)
    .normalise()
    .sharpen({ sigma: 1 })
    .jpeg({ quality: 95 })
    .toBuffer();

  // Barcode variants: multiple preprocessing strategies at multiple rotations
  const variants: string[] = [];

  const presets: Array<(s: sharp.Sharp) => sharp.Sharp> = [
    (s) => s, // original
    (s) => s.normalise().modulate({ brightness: 1.1, saturation: 0 }), // contrast
    (s) => s.sharpen({ sigma: 2, m1: 1.5, m2: 0.7 }), // sharpen
    (s) => s.greyscale().threshold(128), // binarize
    (s) => s.greyscale().normalise().linear(1.5, -0.25 * 255).sharpen({ sigma: 1.5 }), // clahe-sim
  ];

  for (const angle of [0, 90, 180, 270]) {
    for (const preset of presets) {
      try {
        let pipeline = sharp(rotated);
        if (angle !== 0) pipeline = pipeline.rotate(angle);
        pipeline = preset(pipeline);
        const buf = await pipeline.jpeg({ quality: 90 }).toBuffer();
        variants.push(buf.toString('base64'));
      } catch {
        // skip failed variant
      }
    }
  }

  return { vlmBase64: vlmBuf.toString('base64'), barcodeVariants: variants };
}

/**
 * Scan ALL barcode variants and collect unique ONT serials.
 */
async function findAllBarcodes(variants: string[]): Promise<string[]> {
  const found = new Set<string>();

  for (let i = 0; i < variants.length; i++) {
    try {
      const result = await scanAllBarcodes(variants[i]!);
      if (result.success) {
        for (const bc of result.barcodes) {
          const val = bc.value.toUpperCase().replace(/^SN:/, '');
          if (ONT_PATTERN.test(val) || ONT_PATTERN.test(`SN:${val}`)) {
            found.add(val);
          }
        }
      }
    } catch {
      // continue
    }
    // Early exit if we found 10+ unique serials
    if (found.size >= 10) break;
  }

  return Array.from(found);
}

function buildPrompt(barcodeHints: string[]): string {
  const barcodeSection = barcodeHints.length > 0
    ? `\nBARCODE SCANNER found these ONT serials in this image (high accuracy):\n${barcodeHints.map((b, i) => `  Barcode ${i + 1}: ${b}`).join('\n')}\nAssign these to the correct rows by their position in the table (top to bottom = row 1 to 10).\n`
    : '\nBarcode scanner could not decode stickers. Set ont_serial to null for all rows.\n';

  return `/no_think
Extract data from this Velocity Fibre "Home Drop and Activation - Equipment Allocation Form".

This is a table with numbered rows (1-10). Read EACH ROW SEPARATELY — every row has different values.

Columns in order: Row#, ONT Serial (barcode sticker), Gizzu Serial, DR Number, PON, Address.
The date is at top-right. Technician name + ID at bottom.

KNOWN FACTS about this form:
- DR numbers ALWAYS start with "DR18" (never DR19 — handwritten 8 looks like 9)
- Gizzu serials start with "GU18W12V25" then 6-10 more characters that DIFFER per row
- PON values are in range 121-128
- Addresses are 4-5 digit stand numbers, DIFFERENT per row
- Date format on form is DD/MM/YYYY — convert to YYYY-MM-DD
${barcodeSection}
Output ONLY valid JSON, no explanation:
{"date":"YYYY-MM-DD","technician_name":"string","technician_id":"string","entries":[{"row_number":1,"ont_serial":"string or null","gizzu_serial":"string or null","dr_number":"DR18XXXXX","pon_number":"128","address":"14643","confidence":0.8}],"overall_confidence":0.8}`;
}

/**
 * Main extraction function.
 */
export async function extractEodSheet(
  base64Image: string
): Promise<{ success: boolean; data: EodVlmExtraction | null; error?: string }> {
  const startTime = Date.now();

  // Pass 0: Preprocess
  let vlmBase64 = base64Image;
  let barcodeHints: string[] = [];

  try {
    const { vlmBase64: processed, barcodeVariants } = await preprocessEodImage(base64Image);
    vlmBase64 = processed;

    // Pass 1: Multi-barcode scan across all variants
    barcodeHints = await findAllBarcodes(barcodeVariants);
    log.info('[EOD] Pass 0+1 done', {
      barcodesFound: barcodeHints.length,
      serials: barcodeHints,
      variantsScanned: barcodeVariants.length,
      ms: Date.now() - startTime,
    });
  } catch (err) {
    log.warn('[EOD] Preprocess/barcode failed', { error: err });
  }

  // Pass 2: VLM
  try {
    const prompt = buildPrompt(barcodeHints);
    const requestBody = {
      model: VLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${vlmBase64}` } },
          ],
        },
      ],
      max_tokens: EOD_MAX_TOKENS,
      temperature: 0, // zero for deterministic extraction
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS * 2);

    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`VLM API ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in VLM response');

    // Parse JSON — handle markdown wrappers and thinking blocks
    let jsonStr = content;
    const jsonBlock = content.match(/```json\n([\s\S]*?)\n```/) || content.match(/```\n([\s\S]*?)\n```/);
    if (jsonBlock) jsonStr = jsonBlock[1];
    // Also handle Qwen3 thinking output
    const thinkEnd = jsonStr.indexOf('</think>');
    if (thinkEnd !== -1) jsonStr = jsonStr.slice(thinkEnd + 8).trim();

    const parsed: EodVlmExtraction = JSON.parse(jsonStr);

    // Post-process
    parsed.entries = parsed.entries.map((entry) => ({
      ...entry,
      dr_number: normalizeDrNumber(entry.dr_number),
      ont_serial: entry.ont_serial ? entry.ont_serial.toUpperCase().replace(/^SN:/, '') : null,
    }));

    log.info('[EOD] Extraction complete', {
      entries: parsed.entries.length,
      barcodes: barcodeHints.length,
      confidence: parsed.overall_confidence,
      ms: Date.now() - startTime,
    });

    return { success: true, data: parsed };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error('[EOD] VLM failed', { error: msg, ms: Date.now() - startTime });
    return { success: false, data: null, error: msg };
  }
}

function normalizeDrNumber(dr: string | null): string | null {
  if (!dr) return null;
  let c = dr.replace(/\s+/g, '').toUpperCase();
  if (c.startsWith('DR19')) c = 'DR18' + c.slice(4);
  if (c.startsWith('DR')) return c;
  if (/^\d{5,7}$/.test(c)) return `DR${c}`;
  return c;
}
