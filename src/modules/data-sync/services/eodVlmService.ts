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
  VLM_CHAT_ENDPOINT as VLM_API_ENDPOINT,
  VLM_EXTRACTION_MODEL as VLM_MODEL,
  VLM_TIMEOUT_DEFAULT as VLM_TIMEOUT_MS,
  stripThinkTags,
} from '@/lib/vlm';
import { pool } from '@/lib/db';
import { optimizeForVlm } from '@/modules/activate/services/imagePreprocessService';
import { scanAllBarcodes } from '@/modules/activate/services/enhancedBarcodeService';
import { normalizeSerial } from '@/modules/activate/services/serialExtractor';
import { getVlmFewShotExamples, buildVlmFewShotPrompt } from '@/services/vlmLearningService';
import type { EodVlmExtraction, EodVlmEntry } from '../types';
import { log } from '@/lib/logger';
import sharp from 'sharp';

const EOD_MAX_TOKENS = 4096;
const ONT_PATTERN = /^(SN:)?ALC[LB][A-Z0-9]{5,10}$/i;

// Below this image width, Code-128 barcodes on a 10-row EOD sheet collapse to
// ~1px/bar and zxing cannot decode them. Diagnostic threshold to surface a
// "re-upload at higher resolution" hint when the OCR also failed.
// WhatsApp downsamples to 720x1280; 1200px-wide is a reasonable floor for
// reliable per-barcode bar resolution at the typical 10-row layout.
const EOD_MIN_WIDTH_FOR_BARCODES_PX = 1200;
// Real ONT serials always start ALCLB then hex (e.g. ALCLB48DEC76, ALCLB4E5A300).
// VLM commonly emits ALCL0xxxxx (misreading "B" as "0") — that's NOT a valid serial.
const ONT_STRICT_PATTERN = /^ALCLB[0-9A-F]{5,8}$/i;

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
          const val = bc.value.toUpperCase().replace(/^SN:/, '').replace(/[\s-]/g, '');
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
Read this handwritten Velocity Fibre install form table. Output ONLY what you can
actually see written on the page. Do NOT invent values, do NOT default to common
patterns, do NOT incrementally generate sequential numbers.

HANDWRITING TIPS (apply only when a digit is ambiguous, never as a default):
- A round-shaped "0" inside a digit string is often a handwritten "6".
- A tall "9"-shaped digit at the start of a DR number is often an "8".
- A digit between "1" and the rest of a 5-digit address can be ambiguous — read it as written, do not assume.

COLUMNS (left to right):
1. Row # (printed)
2. ONT Serial — sticker starting "SN:" then letters/digits like ALCLxxxxxxxx
3. Gizzu Serial — starts with GU18W12V25, then a hyphenated suffix
4. DR Number — handwritten alphanumeric, usually starts with "DR" then 6-7 digits
5. PON — 2-3 digit handwritten number
6. Address — handwritten 4-5 digit number, occasionally with a slash for unit/erf
   format (the slash itself is the only signal — never copy any digit string from
   this instruction). Read each row independently from the form.

Read each cell EXACTLY as written. ONT serials, Gizzu serials, DR numbers,
PON numbers and addresses all vary by row — never copy or increment values.
If a cell is blank or unreadable, return null for that field.

Date: top-right DD/MM/YYYY → YYYY-MM-DD.
Designation section at the bottom of the form has TWO rows:
- Row 1 label "Velocity Fibre" (or "VF") → velocity_rep_name + velocity_rep_id
- Row 2 label "Contractor" or "Technician" → technician_name + technician_id
Read both names and IDs in full. If a row is blank, use null.

Inventing plausible-looking serials, DR numbers, PONs, or addresses is forbidden.
If you cannot read a value, return null. Low confidence is better than fabrication.
${fewShotSection}${barcodeSection}
Return JSON matching this schema. Replace every <PLACEHOLDER> token with the actual
value you read from the form, or null if illegible. Do NOT echo the placeholder
strings literally and do NOT use the field-name hints (e.g. "ALCL", "GU18W12V25",
"DR") as fallback content — only as a clue to which cell you are reading.
{"date":"<YYYY-MM-DD>","velocity_rep_name":"<NAME_OR_NULL>","velocity_rep_id":"<ID_OR_NULL>","technician_name":"<NAME_OR_NULL>","technician_id":"<ID_OR_NULL>","entries":[{"row_number":<INT_FROM_1>,"ont_serial":"<ONT_AS_READ_OR_NULL>","gizzu_serial":"<GIZZU_AS_READ_OR_NULL>","dr_number":"<DR_AS_READ_OR_NULL>","pon_number":"<PON_AS_READ_OR_NULL>","address":"<ADDRESS_AS_READ_OR_NULL>","confidence":<0_TO_1>}],"overall_confidence":<0_TO_1>}`;
}

// ============================================================================
// PASS 3: POST-PROCESSING
// ============================================================================

/** Coerce VLM output to string. VLMs sometimes return numbers for typed-string fields
 * (e.g. pon_number: 121 instead of "121"), which used to throw `.replace is not a function`. */
function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function postProcessEntries(entries: EodVlmEntry[]): EodVlmEntry[] {
  return entries.map((entry) => {
    const addrStr = toStringOrNull(entry.address);
    return {
      ...entry,
      dr_number: normalizeDrNumber(toStringOrNull(entry.dr_number)),
      ont_serial: cleanOntSerial(toStringOrNull(entry.ont_serial)),
      gizzu_serial: cleanGizzuSerial(toStringOrNull(entry.gizzu_serial)),
      pon_number: validatePon(toStringOrNull(entry.pon_number)),
      address: addrStr ? (addrStr.replace(/[^0-9]/g, '') || null) : null,
    };
  });
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
  const s = serial.toUpperCase().replace(/^SN:/, '').replace(/[\s-]/g, '');
  if (HALLUCINATION_BLOCKLIST.has(s)) return null;
  // Reject misreads that don't have the ALCLB prefix. The main VLM pass at 1280x960
  // commonly drops the "B" (emits ALCL0xxxxx). Nulling these triggers the focused
  // full-resolution ONT pass below, which reads the actual sticker text.
  if (!ONT_STRICT_PATTERN.test(s)) return null;
  return normalizeSerial(s);
}

function cleanGizzuSerial(serial: string | null): string | null {
  if (!serial) return null;
  const s = serial.toUpperCase().replace(/[\s]/g, '');
  if (HALLUCINATION_BLOCKLIST.has(s)) return null;
  if (s.startsWith('GU')) return s;
  // Accept numeric suffix-only values (e.g. "-0923246" or "0923246") — technicians often
  // write the full serial only on row 1 and abbreviate subsequent rows with the suffix.
  // reconstructGizzuSerials will prepend the prefix; if no full serial is found it nulls them.
  if (/^-?\d{4,}$/.test(s)) return s;
  return null;
}

// Full Gizzu serial includes the per-row suffix (GU18W12V25-XXX-XXXXX ≈ 20 chars).
// Readings shorter than this are just the shared prefix — not hallucinated, just partial.
const GIZZU_FULL_SERIAL_MIN_LEN = 15;

// 99.6% of devices in the DB use this prefix (3,965 / 3,979).
// Used as fallback when no full serial appears on the sheet.
const GIZZU_DEFAULT_PREFIX = 'GU18W12V25-';

/**
 * Reconstruct abbreviated Gizzu serials.
 * Technicians write the full serial on row 1 ("GU18W12V25-0923242") and only the
 * suffix on subsequent rows ("-0923246", "09023249", …). When no full serial exists
 * on the sheet at all, GIZZU_DEFAULT_PREFIX is used as the fallback.
 */
function reconstructGizzuSerials(entries: EodVlmEntry[]): EodVlmEntry[] {
  // Prefer the prefix from any full serial written on the sheet; fall back to default
  const fullSerial = entries
    .map((e) => e.gizzu_serial)
    .find((s) => s && s.startsWith('GU') && s.length >= GIZZU_FULL_SERIAL_MIN_LEN);

  const prefixMatch = fullSerial?.match(/^(GU[A-Z0-9]+-)/i);
  const prefix = prefixMatch ? prefixMatch[1]! : GIZZU_DEFAULT_PREFIX;

  let count = 0;
  const result = entries.map((e) => {
    if (!e.gizzu_serial || e.gizzu_serial.startsWith('GU')) return e;
    // Strip optional leading dash — suffix is digits-only from cleanGizzuSerial
    const suffix = e.gizzu_serial.replace(/^-/, '');
    count++;
    return { ...e, gizzu_serial: `${prefix}${suffix}` };
  });

  if (count > 0) {
    const usedDefault = !prefixMatch;
    (usedDefault ? log.warn : log.info)('[EOD] Gizzu reconstruction', { prefix, count, usedDefault });
  }
  return result;
}

// PONs in this network are <= 900 (current data: 1-852, 852 distinct values).
// Anything outside that range (e.g. an address like 14643 read from the wrong column)
// is silently discarded; the HLD fallback below fills it in from the drops table.
function validatePon(pon: string | null): string | null {
  if (!pon) return null;
  const num = parseInt(pon.replace(/[^0-9]/g, ''), 10);
  if (Number.isFinite(num) && num >= 1 && num <= 900) return num.toString();
  return null;
}

/** Look up pon_no from HLD drops table for entries missing a PON */
async function enrichWithHldPon(entries: EodVlmEntry[]): Promise<EodVlmEntry[]> {
  const needsPon = entries.filter((e) => !e.pon_number && e.dr_number);
  if (needsPon.length === 0) return entries;

  const drNumbers = Array.from(new Set(needsPon.map((e) => e.dr_number!)));

  try {
    const result = await pool.query<{ drop_number: string; pon_no: number }>(
      'SELECT drop_number, pon_no FROM drops WHERE drop_number = ANY($1) AND pon_no IS NOT NULL',
      [drNumbers],
    );
    const rows = result.rows;

    const ponMap = new Map<string, string>();
    for (const row of rows) {
      const validated = validatePon(row.pon_no.toString());
      if (validated) ponMap.set(row.drop_number, validated);
    }

    log.info('[EOD-HLD] PON lookup', { queried: drNumbers.length, found: ponMap.size });

    return entries.map((e) => {
      if (!e.pon_number && e.dr_number && ponMap.has(e.dr_number)) {
        return { ...e, pon_number: ponMap.get(e.dr_number)! };
      }
      return e;
    });
  } catch (err) {
    log.warn('[EOD-HLD] PON lookup failed', { error: err instanceof Error ? err.message : String(err) });
    return entries;
  }
}

/** Detect if numbers form a sequential pattern (incrementing by 1) */
function isSequential(nums: number[]): boolean {
  if (nums.length < 3) return false;
  let seqCount = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i]! === nums[i - 1]! + 1) seqCount++;
  }
  // If >60% of transitions are +1, it's sequential
  return seqCount / (nums.length - 1) > 0.6;
}

// ============================================================================
// ONT SERIAL FOCUSED EXTRACTION (Pass 2b)
// ============================================================================

const ONT_SERIAL_PROMPT = `/no_think
This form has barcode stickers with small printed text "SN: ALCL..." below each barcode.
Read the printed serial text from each sticker, row 1-10.

EXACT FORMAT: starts with the 5 characters "ALCLB" (A-L-C-L-B, with capital B as the 5th
character), then 6-8 hex characters (0-9, A-F). Examples: ALCLB48DEC76, ALCLB48DF68D,
ALCLB48DFA13. The "B" in ALCLB is a letter B, NOT the digit 0 — never output "ALCL0..."
because that is not a valid serial.

Each sticker is UNIQUE. Do NOT increment, do NOT copy values, do NOT make up serials.
If you cannot clearly read a sticker, output null for that row.

JSON array only:
[{"row":1,"serial":"<ALCLB_HEX_OR_NULL>"},{"row":2,"serial":"<ALCLB_HEX_OR_NULL>"}]`;

/** Upscale image 2x for better VLM text reading of small barcode stickers */
async function enhanceForOntReading(base64: string): Promise<string> {
  const buf = Buffer.from(base64, 'base64');
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
        max_tokens: EOD_MAX_TOKENS,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS * 2),
    });

    if (!response.ok) {
      log.warn('[EOD-ONT] VLM request failed', { status: response.status });
      return result;
    }

    const data = await response.json();
    let content = data.choices?.[0]?.message?.content || '';
    log.info('[EOD-ONT] VLM responded', { bytes: content.length });

    const block = content.match(/```(?:json)?\n([\s\S]*?)\n```/);
    if (block) content = block[1];
    content = stripThinkTags(content);

    const serials: Array<{ row: number; serial: string | null }> = JSON.parse(content);
    const parsed = serials.filter((s) => s.serial && s.row >= 1 && s.row <= rowCount);
    log.info('[EOD-ONT] VLM parsed', { total: parsed.length, values: parsed.map((s) => `${s.row}:${s.serial}`) });

    for (const s of parsed) {
      const cleaned = cleanOntSerial(s.serial!);
      if (cleaned) result.set(s.row, cleaned);
    }

    // Guard: only remove a serial if it appears on ≥50% of rows — mass copy-paste hallucination.
    // A threshold of 1 would remove legitimate accidental re-reads; ≥50% is clearly a prompt echo.
    const hallucThreshold = Math.max(2, Math.ceil(rowCount * 0.5));
    const counts = new Map<string, number>();
    for (const [, val] of result) counts.set(val, (counts.get(val) || 0) + 1);
    for (const [serial, count] of counts) {
      if (count >= hallucThreshold) {
        log.warn('[EOD-ONT] Mass duplicate serial — removing', { serial, count, threshold: hallucThreshold });
        for (const [row, val] of result) if (val === serial) result.delete(row);
      }
    }

    // Guard: all-sequential run across ALL candidates = prompt-echo hallucination.
    // Partial sequential runs (adjacent rows from same carton) are legitimate.
    const candidates = Array.from(result.entries()).sort((a, b) => a[0] - b[0]);
    if (candidates.length >= 3) {
      const allSeq = candidates.every((c, i) => {
        if (i === 0) return true;
        const prev = parseInt(candidates[i - 1]![1].slice(-3), 16);
        const curr = parseInt(c[1].slice(-3), 16);
        return !isNaN(prev) && !isNaN(curr) && curr === prev + 1;
      });
      if (allSeq) {
        log.warn('[EOD-ONT] All serials fully sequential — prompt echo hallucination, clearing');
        result.clear();
      }
    }

    log.info('[EOD-ONT] Focused extraction done', { kept: result.size });
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
  let sourceWidth: number | undefined;
  let sourceHeight: number | undefined;

  // Pass 0 + 1: Preprocess + Barcode scan
  try {
    const { vlmBase64: processed, barcodeVariants } = await preprocessEodImage(base64Image);
    vlmBase64 = processed;
    // Keep full-res version for ONT serial focused extraction
    const raw = Buffer.from(base64Image, 'base64');
    const rotatedSharp = sharp(raw).rotate();
    const rotatedMeta = await rotatedSharp.metadata();
    sourceWidth = rotatedMeta.width;
    sourceHeight = rotatedMeta.height;
    const rotated = await rotatedSharp.normalise().jpeg({ quality: 92 }).toBuffer();
    fullResBase64 = rotated.toString('base64');

    barcodeHints = await findAllBarcodes(barcodeVariants);
    log.info('[EOD] Pass 0+1', { barcodes: barcodeHints.length, serials: barcodeHints, source: `${sourceWidth}x${sourceHeight}`, ms: Date.now() - startTime });
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
    jsonStr = stripThinkTags(jsonStr);

    const parsed: EodVlmExtraction = JSON.parse(jsonStr);

    // Pass 3: Post-process
    parsed.entries = postProcessEntries(parsed.entries);
    parsed.entries = reconstructGizzuSerials(parsed.entries);

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
        const singleGz = [...gzSet][0]!;
        // Only clear if it's a full-length serial (has unique suffix) — short prefix reads
        // like "GU18W12V" are legitimate partial reads when technicians abbreviate
        const isFullSerial = singleGz.length >= GIZZU_FULL_SERIAL_MIN_LEN || HALLUCINATION_BLOCKLIST.has(singleGz);
        if (isFullSerial) {
          log.warn('[EOD] All Gizzu identical full serial — hallucination');
          parsed.entries = parsed.entries.map((e) => ({ ...e, gizzu_serial: null }));
        } else {
          log.info('[EOD] All Gizzu share prefix (partial reads) — keeping');
        }
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
      const drsAreSequential = drNums.length >= 3 && isSequential(drNums);
      if (drsAreSequential) {
        log.warn('[EOD] Sequential DRs detected — hallucination');
        parsed.entries = parsed.entries.map((e) => ({ ...e, dr_number: null, confidence: 0.3 }));
        parsed.overall_confidence = 0.3;
      }

      // ONT + Gizzu sequential guard: only fires when the DR column itself is unreliable.
      // Real batch installs from a single carton have sequential Gizzu/ONT serials —
      // those are legitimate. The prompt-echo signal is sequential serials COMBINED with
      // a DR column the VLM couldn't read straight (sequential, all-duplicate, or absent).
      //
      // We read `parsed.entries` AFTER prior DR guards intentionally: if any earlier guard
      // (sequential-DR, all-identical-DR) nulled the column, that IS the signal we want
      // to act on — the VLM is in hallucination mode and the serial-column sequences are
      // almost certainly echoed too. Real installs with varied, valid DRs pass through
      // every prior guard untouched, so `drsColumnUnreliable` stays false and legitimate
      // serial sequences are preserved.
      const drsColumnUnreliable = parsed.entries.every((e) => !e.dr_number);

      if (drsColumnUnreliable) {
        // ONT serials: extract trailing digits (e.g. ALCLB4E5A300 → 300)
        const ontNums = parsed.entries
          .map((e) => {
            if (!e.ont_serial) return NaN;
            const m = e.ont_serial.match(/(\d+)$/);
            return m ? parseInt(m[1]!) : NaN;
          })
          .filter((n) => !isNaN(n));
        if (ontNums.length >= 3 && isSequential(ontNums)) {
          log.warn('[EOD] Sequential ONT serials with bad DRs — prompt echo hallucination');
          parsed.entries = parsed.entries.map((e) => ({ ...e, ont_serial: null, confidence: 0.3 }));
          parsed.overall_confidence = 0.3;
        }

        // Gizzu serials: extract trailing digit run
        const gzNums = parsed.entries
          .map((e) => {
            if (!e.gizzu_serial) return NaN;
            const m = e.gizzu_serial.match(/(\d+)$/);
            return m ? parseInt(m[1]!) : NaN;
          })
          .filter((n) => !isNaN(n));
        if (gzNums.length >= 3 && isSequential(gzNums)) {
          log.warn('[EOD] Sequential Gizzu serials with bad DRs — prompt echo hallucination');
          parsed.entries = parsed.entries.map((e) => ({ ...e, gizzu_serial: null, confidence: 0.3 }));
          parsed.overall_confidence = 0.3;
        }
      }

      const addrs = parsed.entries.map((e) => e.address ? parseInt(e.address) : NaN).filter((n) => !isNaN(n));
      if (addrs.length >= 3 && isSequential(addrs)) {
        log.warn('[EOD] Sequential addresses detected — hallucination');
        parsed.entries = parsed.entries.map((e) => ({ ...e, address: null }));
      }
      // All-identical address across 5+ rows = prompt-echo hallucination (the model
      // copies a single value into every row instead of reading each independently).
      // Threshold of 5 protects small multi-unit complexes (3-4 flats sharing an erf
      // are legitimate; 5+ identical numeric addresses on one daily install sheet are
      // not). Mirrors the existing sequential-address guard above.
      const nonNullAddrs = parsed.entries.map((e) => e.address).filter((a): a is string => Boolean(a));
      const addrSet = new Set(nonNullAddrs);
      if (addrSet.size === 1 && nonNullAddrs.length >= 5) {
        log.warn('[EOD] All addresses identical across 5+ rows — hallucination, clearing');
        parsed.entries = parsed.entries.map((e) => ({ ...e, address: null }));
      }
    }

    // Pass 2b: Focused ONT serial extraction at full resolution
    // Run whenever the main pass left ANY ONT null — cleanOntSerial now nulls reads that
    // fail ONT_STRICT_PATTERN (no ALCLB prefix), so this fires whenever the main 1280x960
    // pass misread the stickers. The focused pass re-extracts from the full-res image with
    // a prompt narrowly scoped to the ONT column.
    const ontNulls = parsed.entries.filter((e) => !e.ont_serial).length;
    if (ontNulls > 0) {
      log.info(`[EOD] ${ontNulls}/${parsed.entries.length} ONT serials null — running focused extraction at full res`);
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

    // Pass 4: HLD PON enrichment — fill missing PON from drops table
    parsed.entries = await enrichWithHldPon(parsed.entries);

    // Diagnostic: flag low-resolution photos where barcodes couldn't decode AND
    // the OCR fallback also had to guess ONT serials. Surfaces an actionable
    // "re-upload at higher resolution" hint to the user.
    parsed.source_width = sourceWidth;
    parsed.source_height = sourceHeight;
    const ontStillMissing = parsed.entries.filter((e) => !e.ont_serial).length;
    parsed.low_resolution_warning =
      sourceWidth !== undefined &&
      sourceWidth < EOD_MIN_WIDTH_FOR_BARCODES_PX &&
      barcodeHints.length === 0 &&
      (ontStillMissing > 0 || parsed.entries.length >= 5);

    log.info('[EOD] Done', {
      entries: parsed.entries.length, barcodes: barcodeHints.length,
      confidence: parsed.overall_confidence,
      source: sourceWidth && sourceHeight ? `${sourceWidth}x${sourceHeight}` : 'unknown',
      lowResWarning: parsed.low_resolution_warning,
      ms: Date.now() - startTime,
    });

    return { success: true, data: parsed };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    log.error('[EOD] Failed', { error: msg, ms: Date.now() - startTime });
    return { success: false, data: null, error: msg };
  }
}
