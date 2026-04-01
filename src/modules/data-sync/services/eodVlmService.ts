/**
 * EOD Install Sheet VLM Extraction Service
 *
 * Four-pass extraction using Activate's proven techniques:
 *   Pass 0: Image preprocessing — EXIF rotate, optimizeForVlm (1280x960), variants for barcode
 *   Pass 1: Multi-barcode scan — scanAllBarcodes on preprocessed variants
 *   Pass 2: VLM extraction — optimized image, domain-grounded prompt
 *   Pass 3: Post-processing — OCR confusion mapping, validation guards, normalization
 */

import {
  VLM_API_ENDPOINT,
  VLM_MODEL,
  VLM_TIMEOUT_MS,
} from '@/modules/activate/services/vlmClient';
import { optimizeForVlm } from '@/modules/activate/services/imagePreprocessService';
import { scanAllBarcodes } from '@/modules/activate/services/enhancedBarcodeService';
import { normalizeSerial } from '@/modules/activate/services/serialExtractor';
import type { EodVlmExtraction, EodVlmEntry } from '../types';
import { log } from '@/lib/logger';
import sharp from 'sharp';

const EOD_MAX_TOKENS = 4096;
const ONT_PATTERN = /^(SN:)?ALC[LB][A-Z0-9]{5,10}$/i;

// Known hallucination values the VLM tends to repeat
const HALLUCINATION_BLOCKLIST = new Set([
  'ALCLB4A00000', 'ALCLBRE400', 'ALCLBMEF7D', 'ALCLB40000',
  'GU18W12V25-0030103', 'GU18W12V25-04C30103',
]);

// ============================================================================
// PASS 0: IMAGE PREPROCESSING
// ============================================================================

async function preprocessEodImage(base64Image: string): Promise<{
  vlmBase64: string;
  barcodeVariants: string[];
}> {
  const raw = Buffer.from(base64Image, 'base64');

  // EXIF auto-rotate first
  const rotated = await sharp(raw).rotate().toBuffer();
  const rotatedBase64 = rotated.toString('base64');

  // VLM: 1280x960 is Qwen3's sweet spot — higher res breaks other field extraction
  const vlmBase64 = await optimizeForVlm(rotatedBase64, {
    maxWidth: 1280,
    maxHeight: 960,
    quality: 90,
    enhanceContrast: true,
  });

  // Barcode variants: multiple preprocessings x rotations
  const variants: string[] = [];
  const presets: Array<{ name: string; fn: (s: sharp.Sharp) => sharp.Sharp }> = [
    { name: 'original', fn: (s) => s },
    { name: 'contrast', fn: (s) => s.normalise().modulate({ brightness: 1.1, saturation: 0 }) },
    { name: 'sharpen', fn: (s) => s.sharpen({ sigma: 2, m1: 1.5, m2: 0.7 }) },
    { name: 'binarize', fn: (s) => s.greyscale().threshold(128) },
    { name: 'clahe', fn: (s) => s.greyscale().normalise().linear(1.5, -0.25 * 255).sharpen({ sigma: 1.5 }) },
  ];

  for (const angle of [0, 90, 180, 270]) {
    for (const preset of presets) {
      try {
        let pipeline = sharp(rotated);
        if (angle !== 0) pipeline = pipeline.rotate(angle);
        pipeline = preset.fn(pipeline);
        const buf = await pipeline.jpeg({ quality: 90 }).toBuffer();
        variants.push(buf.toString('base64'));
      } catch { /* skip */ }
    }
  }

  return { vlmBase64, barcodeVariants: variants };
}

// ============================================================================
// PASS 1: MULTI-BARCODE SCAN
// ============================================================================

async function findAllBarcodes(variants: string[]): Promise<string[]> {
  const found = new Set<string>();

  for (let i = 0; i < variants.length; i++) {
    try {
      const result = await scanAllBarcodes(variants[i]!);
      if (result.success) {
        for (const bc of result.barcodes) {
          let val = bc.value.toUpperCase().replace(/^SN:/, '').replace(/[\s\-]/g, '');
          if (ONT_PATTERN.test(val) || ONT_PATTERN.test(`SN:${val}`)) {
            const normalized = normalizeSerial(val);
            if (normalized && !HALLUCINATION_BLOCKLIST.has(normalized)) {
              found.add(normalized);
            }
          }
        }
      }
    } catch { /* continue */ }
    if (found.size >= 10) break;
  }

  return Array.from(found);
}

// ============================================================================
// PASS 2: VLM EXTRACTION
// ============================================================================

function buildPrompt(barcodeHints: string[]): string {
  const barcodeSection = barcodeHints.length > 0
    ? `\nBarcodes decoded: ${barcodeHints.join(', ')}\n`
    : '';

  return `/no_think
Read this Velocity Fibre install form. Extract each row from the table individually.

Columns left to right: Row# | ONT Serial (printed "SN: ALCL..." text on sticker) | Gizzu Serial (GU18W12V25...) | DR Number (DR18...) | PON (121-128) | Address (4-5 digits)

Header: Date top-right (DD/MM/YYYY→YYYY-MM-DD), Technician name+ID at bottom.

IMPORTANT: Values are NOT sequential. Do NOT increment numbers across rows. Read each cell from the actual handwriting/print on the form. DR numbers, addresses, gizzu suffixes, and PON values vary independently across rows.

Field hints: DR prefix is always DR18 (not DR19). ONT serials: read the small printed text below each barcode sticker.
${barcodeSection}
Return JSON only:
{"date":"YYYY-MM-DD","technician_name":"string","technician_id":"string or null","entries":[{"row_number":1,"ont_serial":"string or null","gizzu_serial":"string or null","dr_number":"string","pon_number":"string","address":"string","confidence":0.8}],"overall_confidence":0.8}`;
}

// ============================================================================
// PASS 3: POST-PROCESSING
// ============================================================================

function postProcessEntries(entries: EodVlmEntry[]): EodVlmEntry[] {
  return entries.map((entry) => ({
    ...entry,
    dr_number: normalizeDrNumber(entry.dr_number),
    ont_serial: cleanOntSerial(entry.ont_serial),
    gizzu_serial: cleanGizzuSerial(entry.gizzu_serial),
    pon_number: validatePon(entry.pon_number),
    address: entry.address?.replace(/[^0-9]/g, '') || null,
  }));
}

function normalizeDrNumber(dr: string | null): string | null {
  if (!dr) return null;
  let c = dr.replace(/\s+/g, '').toUpperCase();
  c = c.replace(/[O]/g, '0').replace(/[I]/g, '1').replace(/[S]/g, '5');
  if (c.startsWith('DR19')) c = 'DR18' + c.slice(4);
  if (c.startsWith('DR')) return c;
  if (/^\d{5,7}$/.test(c)) return `DR${c}`;
  return c;
}

function cleanOntSerial(serial: string | null): string | null {
  if (!serial) return null;
  let s = serial.toUpperCase().replace(/^SN:/, '').replace(/[\s\-]/g, '');
  if (HALLUCINATION_BLOCKLIST.has(s)) return null;
  return normalizeSerial(s);
}

function cleanGizzuSerial(serial: string | null): string | null {
  if (!serial) return null;
  const s = serial.toUpperCase().replace(/[\s]/g, '');
  if (HALLUCINATION_BLOCKLIST.has(s)) return null;
  if (!s.startsWith('GU')) return null;
  return s;
}

function validatePon(pon: string | null): string | null {
  if (!pon) return null;
  const num = parseInt(pon.replace(/[^0-9]/g, ''), 10);
  if (num >= 100 && num <= 200) return num.toString();
  return pon;
}

/** Detect if numbers form a sequential pattern (incrementing by 1) */
function isSequential(nums: number[]): boolean {
  if (nums.length < 3) return false;
  let seqCount = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] === nums[i - 1] + 1) seqCount++;
  }
  // If >60% of transitions are +1, it's sequential
  return seqCount / (nums.length - 1) > 0.6;
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================

export async function extractEodSheet(
  base64Image: string
): Promise<{ success: boolean; data: EodVlmExtraction | null; error?: string }> {
  const startTime = Date.now();

  let vlmBase64 = base64Image;
  let barcodeHints: string[] = [];

  // Pass 0 + 1: Preprocess + Barcode scan
  try {
    const { vlmBase64: processed, barcodeVariants } = await preprocessEodImage(base64Image);
    vlmBase64 = processed;
    barcodeHints = await findAllBarcodes(barcodeVariants);
    log.info('[EOD] Pass 0+1', { barcodes: barcodeHints.length, serials: barcodeHints, ms: Date.now() - startTime });
  } catch (err) {
    log.warn('[EOD] Preprocess failed', { error: err });
  }

  // Pass 2: VLM
  try {
    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildPrompt(barcodeHints) },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${vlmBase64}` } },
          ],
        }],
        max_tokens: EOD_MAX_TOKENS,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS * 2),
    });

    if (!response.ok) throw new Error(`VLM ${response.status}: ${await response.text()}`);

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No VLM content');

    // Parse — handle code blocks and think blocks
    let jsonStr = content;
    const codeBlock = jsonStr.match(/```(?:json)?\n([\s\S]*?)\n```/);
    if (codeBlock) jsonStr = codeBlock[1];
    const thinkEnd = jsonStr.indexOf('</think>');
    if (thinkEnd !== -1) jsonStr = jsonStr.slice(thinkEnd + 8).trim();

    const parsed: EodVlmExtraction = JSON.parse(jsonStr);

    // Pass 3: Post-process
    parsed.entries = postProcessEntries(parsed.entries);

    // Hallucination guards
    if (parsed.entries.length > 1) {
      // Duplicate detection
      const drSet = new Set(parsed.entries.map((e) => e.dr_number).filter(Boolean));
      if (drSet.size === 1) {
        log.warn('[EOD] All DRs identical — hallucination');
        parsed.entries = parsed.entries.map((e) => ({ ...e, dr_number: null, confidence: 0.3 }));
        parsed.overall_confidence = 0.3;
      }
      const gzSet = new Set(parsed.entries.map((e) => e.gizzu_serial).filter(Boolean));
      if (gzSet.size === 1) {
        log.warn('[EOD] All Gizzu identical — hallucination');
        parsed.entries = parsed.entries.map((e) => ({ ...e, gizzu_serial: null }));
      }

      // Sequential pattern detection — if values increment by 1, it's hallucination
      const drNums = parsed.entries.map((e) => e.dr_number ? parseInt(e.dr_number.replace(/\D/g, '')) : NaN).filter((n) => !isNaN(n));
      if (drNums.length >= 3 && isSequential(drNums)) {
        log.warn('[EOD] Sequential DRs detected — hallucination');
        parsed.entries = parsed.entries.map((e) => ({ ...e, dr_number: null, confidence: 0.3 }));
        parsed.overall_confidence = 0.3;
      }

      const addrs = parsed.entries.map((e) => e.address ? parseInt(e.address) : NaN).filter((n) => !isNaN(n));
      if (addrs.length >= 3 && isSequential(addrs)) {
        log.warn('[EOD] Sequential addresses detected — hallucination');
        parsed.entries = parsed.entries.map((e) => ({ ...e, address: null }));
      }
    }

    log.info('[EOD] Done', {
      entries: parsed.entries.length, barcodes: barcodeHints.length,
      confidence: parsed.overall_confidence, ms: Date.now() - startTime,
    });

    return { success: true, data: parsed };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error('[EOD] Failed', { error: msg, ms: Date.now() - startTime });
    return { success: false, data: null, error: msg };
  }
}
