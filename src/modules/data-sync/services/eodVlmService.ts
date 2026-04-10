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
import { getVlmFewShotExamples, buildVlmFewShotPrompt } from '@/services/vlmLearningService';
import type { EodVlmExtraction, EodVlmEntry } from '../types';
import { log } from '@/lib/logger';
import sharp from 'sharp';

const EOD_MAX_TOKENS = 4096;
const ONT_PATTERN = /^(SN:)?ALC[LB][A-Z0-9]{5,10}$/i;

// Known hallucination values the VLM tends to repeat
const HALLUCINATION_BLOCKLIST = new Set([
  'ALCLB4A00000', 'ALCLBRE400', 'ALCLBMEF7D', 'ALCLB40000',
  'ALCLBREAFAD0', 'ALCLBREAFA00', 'ALCLB4E5A300',
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
          const val = bc.value.toUpperCase().replace(/^SN:/, '').replace(/[\s\-]/g, '');
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

async function buildPrompt(barcodeHints: string[]): Promise<string> {
  const barcodeSection = barcodeHints.length > 0
    ? `\nBarcodes decoded: ${barcodeHints.join(', ')}\n`
    : '';

  // Fetch few-shot corrections from VLM Learning system
  let fewShotSection = '';
  try {
    const drExamples = await getVlmFewShotExamples({ module: 'data-sync', analysisType: 'eod_sheet_dr', maxExamples: 3 });
    const addrExamples = await getVlmFewShotExamples({ module: 'data-sync', analysisType: 'eod_sheet_address', maxExamples: 2 });
    const allExamples = [...drExamples, ...addrExamples];
    if (allExamples.length > 0) {
      fewShotSection = `\nPAST CORRECTION EXAMPLES (learn from these):\n${buildVlmFewShotPrompt(allExamples)}\n`;
      log.info(`[EOD-VLM] Injecting ${allExamples.length} few-shot examples`);
    }
  } catch {
    // Non-blocking — continue without few-shot
  }

  return `/no_think
Read this handwritten Velocity Fibre install form table.

HANDWRITING GUIDE for this writer:
- "6" written as round "0" shape → when you see "0" in DR numbers or addresses, it's "6"
- "8" written tall like "9" → in DR prefix, always "8" (DR186XXXX)
- "4" can look like "1" or "9" → in addresses starting with "14", second digit is always "4"

COLUMNS: Row# | ONT Serial (sticker "SN:ALCL...") | Gizzu (GU18W12V25-XXX-XXXXX) | DR (DR186XXXX) | PON | Address

DR Numbers: ALL start with DR186. The last 3-4 digits vary per row — read each carefully.
Addresses: ALL start with "14" followed by 3 unique digits. Examples from this area: 14643, 14627, 14813, 14814, 14897, 14898, 14846, 14812, 14832, 14825.
Gizzu suffixes: format is 3chars-5digits (like 090-30991 or 04C-31000). The suffix is different per row.
PON: one of 128, 127, or 121 — read the actual handwritten digits.

Date: top-right DD/MM/YYYY → YYYY-MM-DD. Technician: bottom of form — read FULL name.

Each row is UNIQUE. Do NOT increment or copy values.
${fewShotSection}${barcodeSection}
JSON only:
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
  const s = serial.toUpperCase().replace(/^SN:/, '').replace(/[\s\-]/g, '');
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
// ONT SERIAL FOCUSED EXTRACTION (Pass 2b)
// ============================================================================

const ONT_SERIAL_PROMPT = `/no_think
This form has barcode stickers with small printed text "SN: ALCL..." below each barcode.
Read the printed serial text from each sticker, row 1-10. Format: ALCLB4 or ALCLB48 followed by hex chars.
Each is UNIQUE. Do NOT increment — if you can't read a sticker, output null for that row.
JSON array only:
[{"row":1,"serial":"ALCLB4E5A300"},{"row":2,"serial":"ALCLB48EEEE"},{"row":3,"serial":null}]`;

const NAFNET_URL = process.env.NAFNET_URL || 'http://100.96.203.105:8101';

/** Deblur image using NAFNet, then upscale 2x for better VLM text reading */
async function enhanceForOntReading(base64: string): Promise<string> {
  let enhanced = base64;

  // NAFNet deblur (non-blocking — fall back to original if unavailable)
  try {
    const res = await fetch(`${NAFNET_URL}/deblur`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.image) {
        enhanced = data.image;
        log.info('[EOD-ONT] NAFNet deblur applied');
      }
    }
  } catch {
    log.warn('[EOD-ONT] NAFNet unavailable, using original');
  }

  // Upscale 2x + sharpen for small text readability
  const buf = Buffer.from(enhanced, 'base64');
  const meta = await sharp(buf).metadata();
  const upscaled = await sharp(buf)
    .resize((meta.width || 1280) * 2, (meta.height || 720) * 2, { kernel: 'lanczos3' })
    .normalise()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 95 })
    .toBuffer();

  return upscaled.toString('base64');
}

async function extractOntSerials(fullResBase64: string, rowCount: number): Promise<Map<number, string>> {
  const result = new Map<number, string>();

  try {
    // Enhance image: NAFNet deblur + 2x upscale for small sticker text
    const enhancedBase64 = await enhanceForOntReading(fullResBase64);

    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: ONT_SERIAL_PROMPT },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${enhancedBase64}` } },
          ],
        }],
        max_tokens: 1024,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
    });

    if (!response.ok) return result;

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';

    // Parse
    const block = content.match(/```(?:json)?\n([\s\S]*?)\n```/);
    if (block) content = block[1];
    const thinkEnd = content.indexOf('</think>');
    if (thinkEnd !== -1) content = content.slice(thinkEnd + 8).trim();

    const serials: Array<{ row: number; serial: string }> = JSON.parse(content);

    for (const s of serials) {
      if (s.serial && s.row >= 1 && s.row <= rowCount) {
        const cleaned = cleanOntSerial(s.serial);
        if (cleaned) result.set(s.row, cleaned);
      }
    }

    // Detect sequential hex suffix — keep only before the run starts
    const candidates = Array.from(result.entries()).sort((a, b) => a[0] - b[0]);
    let seqStart = candidates.length;
    for (let i = 1; i < candidates.length; i++) {
      const prevSuffix = parseInt(candidates[i - 1]![1].slice(-3), 16);
      const currSuffix = parseInt(candidates[i]![1].slice(-3), 16);
      if (!isNaN(prevSuffix) && !isNaN(currSuffix) && currSuffix === prevSuffix + 1) {
        if (i < seqStart) seqStart = i;
      }
    }
    if (seqStart < candidates.length) {
      log.warn('[EOD-ONT] Sequential at index ' + seqStart + ' — trimming');
      for (let i = seqStart; i < candidates.length; i++) result.delete(candidates[i]![0]);
    }

    // Also reject duplicates
    const counts = new Map<string, number>();
    for (const [, val] of result) counts.set(val, (counts.get(val) || 0) + 1);
    for (const [serial, count] of counts) {
      if (count > 1) { for (const [row, val] of result) if (val === serial) result.delete(row); }
    }

    log.info('[EOD-ONT] Focused extraction', { total: candidates.length, kept: result.size, seqStart });
  } catch (err) {
    log.warn('[EOD-ONT] Focused extraction failed', { error: err });
  }

  return result;
}

// ============================================================================
// MAIN EXTRACTION
// ============================================================================

export async function extractEodSheet(
  base64Image: string
): Promise<{ success: boolean; data: EodVlmExtraction | null; error?: string }> {
  const startTime = Date.now();

  let vlmBase64 = base64Image;
  let fullResBase64 = base64Image;
  let barcodeHints: string[] = [];

  // Pass 0 + 1: Preprocess + Barcode scan
  try {
    const { vlmBase64: processed, barcodeVariants } = await preprocessEodImage(base64Image);
    vlmBase64 = processed;
    // Keep full-res version for ONT serial focused extraction
    const raw = Buffer.from(base64Image, 'base64');
    const rotated = await sharp(raw).rotate().normalise().jpeg({ quality: 92 }).toBuffer();
    fullResBase64 = rotated.toString('base64');

    barcodeHints = await findAllBarcodes(barcodeVariants);
    log.info('[EOD] Pass 0+1', { barcodes: barcodeHints.length, serials: barcodeHints, ms: Date.now() - startTime });
  } catch (err) {
    log.warn('[EOD] Preprocess failed', { error: err });
  }

  // Pass 2a: VLM main extraction (table data at 1280x960)
  try {
    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: await buildPrompt(barcodeHints) },
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

      // ONT serials: only clear if ALL identical AND in blocklist (let partial reads through)
      const ontSet = new Set(parsed.entries.map((e) => e.ont_serial).filter(Boolean));
      if (ontSet.size === 1 && parsed.entries.length > 1) {
        const singleValue = [...ontSet][0]!;
        if (HALLUCINATION_BLOCKLIST.has(singleValue)) {
          log.warn(`[EOD] All ONT serials are blocklisted value "${singleValue}" — clearing`);
          parsed.entries = parsed.entries.map((e) => ({ ...e, ont_serial: null }));
        }
        // Otherwise keep them — VLM's best effort, user can scan individually to correct
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

    // Pass 2b: Focused ONT serial extraction at full resolution
    // Only run if ONT serials are mostly null (main extraction failed to read stickers)
    const ontNulls = parsed.entries.filter((e) => !e.ont_serial).length;
    if (ontNulls > parsed.entries.length * 0.5) {
      log.info('[EOD] Most ONT serials null — running focused extraction at full res');
      const ontMap = await extractOntSerials(fullResBase64, parsed.entries.length);
      if (ontMap.size > 0) {
        parsed.entries = parsed.entries.map((e) => {
          const focused = ontMap.get(e.row_number);
          if (focused && !e.ont_serial) return { ...e, ont_serial: focused };
          return e;
        });
        log.info(`[EOD] ONT focused pass filled ${ontMap.size} serials`);
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
