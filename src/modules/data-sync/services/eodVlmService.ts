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

const EOD_MAX_TOKENS = 8192;
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

OUTPUT FORMAT: return COMPACT minified JSON only — no leading whitespace, no
indentation, no trailing newlines, no markdown fences. The entire response must
fit on as few tokens as possible.

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

UNIQUENESS: Within a single sheet, each ONT serial, Gizzu serial and DR
number appears at most ONCE — they are physical device IDs. If you cannot
read a row clearly, return null for that field instead of copying the
value from a neighbouring row. Duplicates in the output are forbidden.

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
      // Main VLM pass doesn't extract column 4 — start null. The per-cell
      // pass `extractGizzuDrNumbers` below populates this field for entries
      // where the col-4 crop produces a valid DR.
      gizzu_dr_number: null,
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

/**
 * Resize to a fixed target width for the focused ONT pass. We want the
 * stickers to occupy enough pixels for the VLM to read individual characters
 * but not so many that the model truncates or rejects the input.
 *
 * 2560px wide ≈ 256px per row on a 10-row form ≈ ~80px tall per sticker —
 * comfortable resolution for handwritten/printed serial reads.
 */
const ONT_PASS_TARGET_WIDTH = 2560;

async function enhanceForOntReading(base64: string): Promise<string> {
  const buf = Buffer.from(base64, 'base64');
  const meta = await sharp(buf).metadata();
  const srcWidth = meta.width || 1280;
  // If source is smaller than target, upscale (clean sticker images
  // benefit from interpolation); if larger, downscale to keep VLM happy.
  const ratio = ONT_PASS_TARGET_WIDTH / srcWidth;
  const targetHeight = Math.round((meta.height || 720) * ratio);
  const resized = await sharp(buf)
    .resize(ONT_PASS_TARGET_WIDTH, targetHeight, { kernel: 'lanczos3' })
    .normalise()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 95 })
    .toBuffer();
  return resized.toString('base64');
}

const ONT_CELL_PROMPT = `/no_think
This image is a single cell from a form, containing one ONT barcode sticker.
The sticker has a barcode with a printed serial line "S/N: ALCL..." BELOW it.

The image may also show the tail end of the previous row's "S/N:" line at the
TOP, and/or the start of the next row's barcode at the BOTTOM. The serial
for THIS cell is the one DIRECTLY BELOW THE BARCODE in the middle of the
image — that is, the LAST "S/N:" line readable in the image.

Output ONLY that serial value (without the "S/N:" prefix), nothing else.
Format: starts with the 5 characters "ALCLB" (A-L-C-L, then capital letter B),
then 6-8 hex characters (0-9, A-F). Examples: ALCLB480E666, ALCLB484F549,
ALCLB484F5EA, ALCLB48DEC76.

The "B" in ALCLB is the letter B, NEVER the digit 0. Do not output "ALCL0...".

If you cannot read the printed text confidently, output "null".`;

/**
 * Generic per-cell column extraction. Crops one row's cell from the specified
 * column, sends the tiny image to the VLM with a single-cell prompt, validates
 * the read against `validate`, and applies within-sheet uniqueness.
 *
 * Used by the ONT, DR, and Gizzu passes — same orchestration shape, only the
 * column / prompt / validation differ.
 */
async function extractColumnPerCell(
  fullResBase64: string,
  rowCount: number,
  col: keyof typeof COL_X_FRAC,
  prompt: string,
  validate: (raw: string) => string | null,
  tag: string,
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  try {
    const raw = Buffer.from(fullResBase64, 'base64');
    const rotated = await sharp(raw).rotate().toBuffer();
    const meta = await sharp(rotated).metadata();
    const W = meta.width || 0;
    const H = meta.height || 0;
    if (W < 100 || H < 100) {
      log.warn(`[${tag}] Image too small for per-cell extraction`, { W, H });
      return result;
    }

    // Layout sanity check — per-cell crop fractions are calibrated for the
    // A4 portrait Velocity install form. Reject geometries that clearly are
    // not portrait-A4 (e.g. landscape phone photo, square crop). Crops on
    // mis-shaped images would target wrong locations and read garbage.
    const aspect = H / W;
    if (aspect < EXPECTED_ASPECT_MIN || aspect > EXPECTED_ASPECT_MAX) {
      log.warn(`[${tag}] Image aspect ratio outside A4 portrait range — skipping per-cell extraction`, {
        W, H, aspect: aspect.toFixed(3),
        expected: `${EXPECTED_ASPECT_MIN}-${EXPECTED_ASPECT_MAX}`,
      });
      return result;
    }

    const reads = await Promise.all(
      Array.from({ length: rowCount }, async (_, idx) => {
        try {
          const cell = await cropCell(rotated, W, H, idx, rowCount, col);
          const rawRead = await readCellWithVlm(cell, prompt);
          return { row: idx + 1, value: rawRead ? validate(rawRead) : null };
        } catch (cellErr) {
          log.warn(`[${tag}] Cell read failed`, { row: idx + 1, error: cellErr instanceof Error ? cellErr.message : String(cellErr) });
          return { row: idx + 1, value: null };
        }
      })
    );

    log.info(`[${tag}] Per-cell reads`, {
      total: reads.length,
      hits: reads.filter((r) => r.value).length,
      values: reads.map((r) => `${r.row}:${r.value || '—'}`),
    });

    for (const r of reads) if (r.value) result.set(r.row, r.value);

    // Within-sheet uniqueness — each cell value (ONT/DR/Gizzu) is a unique
    // physical identifier. If two cells read the same value, null both —
    // we cannot tell which is correct.
    const counts = new Map<string, number>();
    for (const v of result.values()) counts.set(v, (counts.get(v) || 0) + 1);
    for (const [v, c] of counts) {
      if (c >= 2) {
        log.warn(`[${tag}] Duplicate value across cells — nulling all instances`, { value: v, count: c });
        for (const [row, val] of result) if (val === v) result.delete(row);
      }
    }

    log.info(`[${tag}] Per-cell extraction done`, { kept: result.size });
  } catch (err) {
    log.warn(`[${tag}] Per-cell extraction failed`, { error: err instanceof Error ? err.message : String(err) });
  }
  return result;
}

/** Per-cell ONT extraction. Validates ALCLB-prefixed serial format. */
function extractOntSerialsPerCell(fullResBase64: string, rowCount: number): Promise<Map<number, string>> {
  return extractColumnPerCell(
    fullResBase64,
    rowCount,
    'ont',
    ONT_CELL_PROMPT,
    (raw) => cleanOntSerial(raw),
    'EOD-ONT-PC',
  );
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
// PER-CELL FOCUSED EXTRACTION (Pass 2c / 2e)
//
// The full-image focused pass works for ONT serial because the ONT sticker
// has a printed serial below the barcode — the VLM can locate it by feature.
// Handwritten DR / Gizzu cells have no such printed anchor, and on a multi-row
// form the main pass commonly shuffles which value belongs to which row.
//
// The fix is to crop each (row, column) cell out of the full-resolution image
// individually and send a tiny single-cell image to the VLM. Row alignment is
// then guaranteed by construction — the VLM has no way to confuse rows when
// it's only looking at one cell at a time.
// ============================================================================

const DR_STRICT_PATTERN = /^DR\d{7}$/;
const GIZZU_STRICT_PATTERN = /^GU18W12V25-\d{6}$/;

// The Velocity install form always has exactly 10 data rows.
// Per-cell crops use this constant rather than `entries.length`, because the
// main VLM pass occasionally hallucinates an extra row — slicing the table
// band into the wrong number of cells would misalign every crop.
const PHYSICAL_FORM_ROWS = 10;

// Empirical column boundaries for the standard Velocity install form
// (A4 portrait, 4 data columns + ONT sticker column on left).
// Values are fractions of total image width.
const COL_X_FRAC: Record<'ont' | 'dr' | 'gizzu' | 'dr2', [number, number]> = {
  ont:   [0.00, 0.26],
  dr:    [0.26, 0.44],
  gizzu: [0.44, 0.74],
  dr2:   [0.74, 1.00],
};

// Vertical fractions of the data-row band (first row top to last row bottom).
const TABLE_TOP_FRAC = 0.290;
const TABLE_BOTTOM_FRAC = 0.532;
// Padding added to each row crop so that minor calibration drift doesn't clip text.
const ROW_PAD_FRAC = 0.005;

// Target upscaled width for each cell crop — large enough for the VLM to read
// individual handwritten digits clearly.
const CELL_CROP_TARGET_WIDTH = 800;

// Expected aspect ratio (height/width) for the A4 portrait Velocity form.
// Real A4 is √2 ≈ 1.414. We allow ±15% to accommodate camera-angle scans.
// Crops calibrated for this geometry; landscape or square images would
// produce cells in the wrong location.
const EXPECTED_ASPECT_MIN = 1.2;
const EXPECTED_ASPECT_MAX = 1.65;

async function cropCell(
  rotatedJpegBuffer: Buffer,
  imgWidth: number,
  imgHeight: number,
  rowIdx: number,
  rowCount: number,
  colName: keyof typeof COL_X_FRAC,
): Promise<string> {
  const [xLeftFrac, xRightFrac] = COL_X_FRAC[colName];
  const rowHeightFrac = (TABLE_BOTTOM_FRAC - TABLE_TOP_FRAC) / rowCount;
  const xLeft = Math.max(0, Math.floor(imgWidth * xLeftFrac));
  const xRight = Math.min(imgWidth, Math.floor(imgWidth * xRightFrac));
  const yTop = Math.max(0, Math.floor(imgHeight * (TABLE_TOP_FRAC + rowIdx * rowHeightFrac - ROW_PAD_FRAC)));
  const yBot = Math.min(imgHeight, Math.floor(imgHeight * (TABLE_TOP_FRAC + (rowIdx + 1) * rowHeightFrac + ROW_PAD_FRAC)));
  const width = xRight - xLeft;
  const height = yBot - yTop;

  const cropped = await sharp(rotatedJpegBuffer)
    .extract({ left: xLeft, top: yTop, width, height })
    .resize({ width: CELL_CROP_TARGET_WIDTH, kernel: 'lanczos3', fit: 'inside' })
    .normalise()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 95 })
    .toBuffer();
  return cropped.toString('base64');
}

async function readCellWithVlm(cellBase64: string, prompt: string): Promise<string | null> {
  try {
    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VLM_MODEL,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cellBase64}` } },
          ],
        }],
        max_tokens: 64,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(VLM_TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn('[EOD-cell-vlm] non-OK response', { status: response.status });
      return null;
    }
    const data = await response.json();
    let content: string = data.choices?.[0]?.message?.content || '';
    content = stripThinkTags(content).trim();
    // Strip code fences, quotes, leading "DR:" / "Serial:" labels
    content = content.replace(/^```[a-z]*\n?|\n?```$/g, '');
    content = content.replace(/^["'`]+|["'`]+$/g, '');
    if (!content || /^null$/i.test(content)) return null;
    return content.trim();
  } catch (err) {
    log.warn('[EOD-cell-vlm] VLM call failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

const DR_CELL_PROMPT = `/no_think
This image is a single cell from a handwritten install form, containing one
handwritten DR number.

Output ONLY the DR number, nothing else. Format: the letters "DR" followed by
exactly 7 digits, e.g. "DR1858020", "DR1858106", "DR1858123".

If the digits are unclear or you cannot read them confidently, output "null".
Do not invent values, do not pad, do not extrapolate.`;

/** Per-cell DR extraction. Validates "DR" + 7-digit format. */
function extractDrNumbers(fullResBase64: string, rowCount: number): Promise<Map<number, string>> {
  return extractColumnPerCell(
    fullResBase64,
    rowCount,
    'dr',
    DR_CELL_PROMPT,
    (raw) => {
      const cleaned = normalizeDrNumber(raw);
      return cleaned && DR_STRICT_PATTERN.test(cleaned) ? cleaned : null;
    },
    'EOD-DR',
  );
}

/**
 * Per-cell extraction for the SECOND handwritten DR column (col 4 on the form).
 * This is the DR where the Gizzu in that row was installed — typically a
 * different drop than the ONT-DR on the same row, since technicians don't pair
 * ONT and Gizzu installs by drop.
 */
function extractGizzuDrNumbers(fullResBase64: string, rowCount: number): Promise<Map<number, string>> {
  return extractColumnPerCell(
    fullResBase64,
    rowCount,
    'dr2',
    DR_CELL_PROMPT,
    (raw) => {
      const cleaned = normalizeDrNumber(raw);
      return cleaned && DR_STRICT_PATTERN.test(cleaned) ? cleaned : null;
    },
    'EOD-GZ-DR',
  );
}

// ============================================================================
// HLD DR FUZZY MATCH (Pass 2d)
// ============================================================================

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]!
        : 1 + Math.min(prev[j]!, curr[j - 1]!, prev[j - 1]!);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/**
 * Find the longest prefix shared by at least `minQuorum` fraction of strings.
 * Tolerates outliers — a single misread (e.g. "DR2..." among nine "DR1858..."
 * reads) would not collapse the prefix to "DR" if quorum is 0.7+.
 */
function majorityPrefix(strs: string[], minQuorum = 0.7): string {
  if (strs.length === 0) return '';
  const threshold = Math.ceil(strs.length * minQuorum);
  // Find longest L where ≥threshold strings share their first L characters.
  // Start from longest possible and shrink.
  const maxLen = Math.max(...strs.map((s) => s.length));
  for (let len = maxLen; len > 0; len--) {
    const counts = new Map<string, number>();
    for (const s of strs) {
      if (s.length < len) continue;
      const pre = s.slice(0, len);
      counts.set(pre, (counts.get(pre) || 0) + 1);
    }
    for (const [pre, c] of counts) {
      if (c >= threshold) return pre;
    }
  }
  return '';
}

/**
 * Cross-validate VLM-read DRs against the HLD `drops` table.
 * If a DR doesn't exist in the table but a unique near-neighbor does
 * (Levenshtein ≤ 2), replace the VLM value with the legit DR.
 * Single-digit handwriting misreads (0↔6, 3↔8, etc.) get corrected here.
 */
async function correctDrFromHld(entries: EodVlmEntry[]): Promise<EodVlmEntry[]> {
  const readDrs = entries.map((e) => e.dr_number).filter((d): d is string => !!d && DR_STRICT_PATTERN.test(d));
  if (readDrs.length === 0) return entries;

  // Scope the lookup by the prefix shared by at least 70% of valid reads.
  // (e.g. "DR1858" for the test sheet narrows ~3000 candidates to ~500.)
  // Using majority — not strict common — tolerates a single VLM misread that
  // would otherwise collapse the prefix to "DR" and silently skip correction.
  const prefix = majorityPrefix(readDrs, 0.7);
  if (prefix.length < 4 || !prefix.startsWith('DR')) {
    log.warn('[EOD-DR-HLD] No usable majority prefix — skipping fuzzy match', { prefix, readDrs });
    return entries;
  }

  try {
    const { rows } = await pool.query<{ drop_number: string }>(
      'SELECT drop_number FROM drops WHERE drop_number LIKE $1',
      [`${prefix}%`],
    );
    const legit = new Set(rows.map((r) => r.drop_number));
    log.info('[EOD-DR-HLD] HLD lookup', { prefix, candidates: legit.size });
    if (legit.size === 0) return entries;

    // Reserve already-used legit DRs so we don't fuzzy-match two reads to the same target
    const reserved = new Set<string>();
    for (const e of entries) {
      if (e.dr_number && legit.has(e.dr_number)) reserved.add(e.dr_number);
    }

    let corrected = 0;
    const result = entries.map((e) => {
      if (!e.dr_number || legit.has(e.dr_number)) return e;
      let best: { dr: string; dist: number } | null = null;
      let tieCount = 0;
      for (const legitDr of legit) {
        if (reserved.has(legitDr)) continue;
        const d = levenshteinDistance(e.dr_number, legitDr);
        if (d > 2) continue;
        if (!best || d < best.dist) { best = { dr: legitDr, dist: d }; tieCount = 1; }
        else if (d === best.dist) tieCount++;
      }
      if (best && tieCount === 1) {
        log.info('[EOD-DR-HLD] DR corrected', { from: e.dr_number, to: best.dr, dist: best.dist });
        reserved.add(best.dr);
        corrected++;
        return { ...e, dr_number: best.dr };
      }
      return e;
    });
    if (corrected > 0) log.info('[EOD-DR-HLD] DR corrections applied', { corrected });
    return result;
  } catch (err) {
    log.warn('[EOD-DR-HLD] HLD fuzzy match failed', { error: err instanceof Error ? err.message : String(err) });
    return entries;
  }
}

// ============================================================================
// GIZZU SERIAL PER-CELL EXTRACTION (Pass 2e)
// Note: Gizzu serials on this form are HANDWRITTEN, not barcode stickers.
// ============================================================================

const GIZZU_CELL_PROMPT = `/no_think
This image is a single cell from a handwritten install form, containing one
handwritten Gizzu UPS serial.

Output ONLY the serial, nothing else. Format: "GU18W12V25-" followed by
exactly 6 digits, e.g. "GU18W12V25-176688", "GU18W12V25-176581".

Note: the handwritten "1" can look like "I" and "V" can look like "U" — the
canonical prefix is always GU18W12V25- (digit-1, digit-8, W, digit-1, digit-2,
letter-V, digit-2, digit-5, hyphen). Normalise the prefix to that form.

If the suffix digits are unclear, output "null". Do not invent or pad.`;

/** Per-cell Gizzu extraction. Validates GU18W12V25-XXXXXX format + blocklist. */
function extractGizzuSerials(fullResBase64: string, rowCount: number): Promise<Map<number, string>> {
  return extractColumnPerCell(
    fullResBase64,
    rowCount,
    'gizzu',
    GIZZU_CELL_PROMPT,
    (raw) => {
      const cleaned = raw.toUpperCase().replace(/\s/g, '');
      if (HALLUCINATION_BLOCKLIST.has(cleaned)) return null;
      return GIZZU_STRICT_PATTERN.test(cleaned) ? cleaned : null;
    },
    'EOD-GZ',
  );
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
      if (nonNullAddrs.length >= 5 && new Set(nonNullAddrs).size === 1) {
        log.warn('[EOD] All addresses identical across 5+ rows — hallucination, clearing');
        parsed.entries = parsed.entries.map((e) => ({ ...e, address: null }));
      }

      // All-identical PON across 5+ rows = the model filled one value into every row
      // (technicians' handwritten PON is often a small/ambiguous digit so the VLM falls
      // back to the same guess). Null them so enrichWithHldPon below fills from drops.
      const nonNullPons = parsed.entries.map((e) => e.pon_number).filter((p): p is string => Boolean(p));
      if (nonNullPons.length >= 5 && new Set(nonNullPons).size === 1) {
        log.warn('[EOD] All PONs identical across 5+ rows — likely misread, clearing for HLD lookup');
        parsed.entries = parsed.entries.map((e) => ({ ...e, pon_number: null }));
      }
    }

    // Within-sheet uniqueness guard: ONT serial, Gizzu serial and DR number are
    // physical device / drop identifiers and must each appear at most once on a
    // single sheet. When the same value reappears across rows it's a copy-paste
    // hallucination (the VLM duplicated a previous row instead of reading the
    // current cell). Null every duplicate after the first occurrence — the
    // focused-ONT pass and HLD PON enrichment below will re-fill correct values
    // for the nulled cells where possible.
    if (parsed.entries.length > 1) {
      for (const field of ['ont_serial', 'gizzu_serial', 'dr_number'] as const) {
        const seen = new Set<string>();
        let cleared = 0;
        parsed.entries = parsed.entries.map((e) => {
          const v = e[field];
          if (typeof v !== 'string' || !v) return e;
          if (seen.has(v)) { cleared++; return { ...e, [field]: null }; }
          seen.add(v);
          return e;
        });
        if (cleared > 0) {
          log.warn(`[EOD] Cleared ${cleared} duplicate ${field} entries — hallucination`);
        }
      }
    }

    // Pass 2b: Per-cell ONT extraction.
    // Each ONT cell is cropped from the full-resolution image and read in
    // isolation. Row alignment is guaranteed by construction — the previous
    // full-image focused ONT pass occasionally shuffled rows when the main
    // pass also shuffled them. Trust focused values and evict stale main-pass
    // duplicates, same pattern as the DR/Gizzu passes.
    if (parsed.entries.length > 0) {
      const cropRowCount = Math.min(parsed.entries.length, PHYSICAL_FORM_ROWS);
      const ontMap = await extractOntSerialsPerCell(fullResBase64, cropRowCount);
      if (ontMap.size > 0) {
        let overridden = 0;
        parsed.entries = parsed.entries.map((e) => {
          const focused = ontMap.get(e.row_number);
          if (focused && focused !== e.ont_serial) {
            overridden++;
            return { ...e, ont_serial: focused };
          }
          return e;
        });

        // Only evict main-pass duplicates when the per-cell pass produced a
        // COMPLETE map (every row covered). On a partial map we cannot
        // distinguish "main pass duplicated" from "per-cell didn't read this
        // row", so we leave main-pass values alone for non-focused rows.
        if (ontMap.size === cropRowCount) {
          const focusedValues = new Set(ontMap.values());
          let evicted = 0;
          parsed.entries = parsed.entries.map((e) => {
            if (e.ont_serial && !ontMap.has(e.row_number) && focusedValues.has(e.ont_serial)) {
              evicted++;
              return { ...e, ont_serial: null };
            }
            return e;
          });
          log.info(`[EOD] ONT per-cell pass overrode ${overridden} rows; evicted ${evicted} stale main-pass duplicates`);
        } else {
          log.info(`[EOD] ONT per-cell pass overrode ${overridden} rows; eviction skipped (partial map: ${ontMap.size}/${cropRowCount})`);
        }
      }
    }

    // Pass 2b-fallback: if the per-cell pass left any ONT null, fall back to
    // the full-image focused pass which reads the printed serials across all
    // rows in one call. Lower row-alignment confidence but can fill nulls.
    const ontNulls = parsed.entries.filter((e) => !e.ont_serial).length;
    if (ontNulls > 0) {
      log.info(`[EOD] ${ontNulls}/${parsed.entries.length} ONT serials still null after per-cell — running full-image fallback`);
      const ontMap = await extractOntSerials(fullResBase64, parsed.entries.length);
      if (ontMap.size > 0) {
        const alreadySet = new Set(
          parsed.entries.map((e) => e.ont_serial).filter((s): s is string => !!s),
        );
        let filled = 0;
        parsed.entries = parsed.entries.map((e) => {
          const focused = ontMap.get(e.row_number);
          if (focused && !e.ont_serial && !alreadySet.has(focused)) {
            alreadySet.add(focused);
            filled++;
            return { ...e, ont_serial: focused };
          }
          return e;
        });
        log.info(`[EOD] ONT full-image fallback filled ${filled} serials (of ${ontMap.size} returned)`);
      }
    }

    // Pass 2c: Per-cell DR extraction.
    // Each DR cell is cropped from the full-resolution image and read in
    // isolation by the VLM. Row alignment is guaranteed by construction —
    // far more reliable than the multi-field 1280x960 main pass for
    // handwritten digits. Trust focused values unconditionally and evict
    // any main-pass duplicates on other rows.
    //
    // Row count is capped at PHYSICAL_FORM_ROWS (10). The Velocity install
    // form is always 10 rows; if the main pass hallucinated extras, those
    // extra entries simply won't get focused overrides.
    if (parsed.entries.length > 0) {
      const cropRowCount = Math.min(parsed.entries.length, PHYSICAL_FORM_ROWS);
      const drMap = await extractDrNumbers(fullResBase64, cropRowCount);
      if (drMap.size > 0) {
        let overridden = 0;
        parsed.entries = parsed.entries.map((e) => {
          const focused = drMap.get(e.row_number);
          if (focused && focused !== e.dr_number) {
            overridden++;
            return { ...e, dr_number: focused };
          }
          return e;
        });

        // Per-cell extraction's own uniqueness guard already ensured focused
        // values are unique across rows. On a COMPLETE map, any non-focused
        // entry whose main-pass value collides with a focused value is a
        // stale duplicate (main pass put the same value on two rows). Null
        // those. On a PARTIAL map we can't distinguish duplicate-from-main
        // from row-not-read-by-per-cell, so leave non-focused rows alone.
        if (drMap.size === cropRowCount) {
          const focusedValues = new Set(drMap.values());
          let evicted = 0;
          parsed.entries = parsed.entries.map((e) => {
            if (e.dr_number && !drMap.has(e.row_number) && focusedValues.has(e.dr_number)) {
              evicted++;
              return { ...e, dr_number: null };
            }
            return e;
          });
          log.info(`[EOD] DR focused pass overrode ${overridden} rows; evicted ${evicted} stale main-pass duplicates`);
        } else {
          log.info(`[EOD] DR focused pass overrode ${overridden} rows; eviction skipped (partial map: ${drMap.size}/${cropRowCount})`);
        }
      }
    }

    // Pass 2d: HLD fuzzy-match — correct misread DRs against the drops table.
    // Single-digit handwriting misreads (0↔6, 3↔8 etc.) that survive the focused
    // pass get corrected here. Every legit DR for an install must exist in `drops`.
    parsed.entries = await correctDrFromHld(parsed.entries);

    // Pass 2e: Per-cell Gizzu extraction.
    // Mirror of the DR pass — Gizzu serials are HANDWRITTEN on this form,
    // and the main 1280x960 pass commonly misreads suffix digits (e.g.
    // 176688 → 176587). Per-cell crops + isolated reads fix this.
    if (parsed.entries.length > 0) {
      const cropRowCount = Math.min(parsed.entries.length, PHYSICAL_FORM_ROWS);
      const gzMap = await extractGizzuSerials(fullResBase64, cropRowCount);
      if (gzMap.size > 0) {
        let overridden = 0;
        parsed.entries = parsed.entries.map((e) => {
          const focused = gzMap.get(e.row_number);
          if (focused && focused !== e.gizzu_serial) {
            overridden++;
            return { ...e, gizzu_serial: focused };
          }
          return e;
        });

        if (gzMap.size === cropRowCount) {
          const focusedValues = new Set(gzMap.values());
          let evicted = 0;
          parsed.entries = parsed.entries.map((e) => {
            if (e.gizzu_serial && !gzMap.has(e.row_number) && focusedValues.has(e.gizzu_serial)) {
              evicted++;
              return { ...e, gizzu_serial: null };
            }
            return e;
          });
          log.info(`[EOD] Gizzu focused pass overrode ${overridden} rows; evicted ${evicted} stale main-pass duplicates`);
        } else {
          log.info(`[EOD] Gizzu focused pass overrode ${overridden} rows; eviction skipped (partial map: ${gzMap.size}/${cropRowCount})`);
        }
      }
    }

    // Pass 2f: Per-cell extraction of the Gizzu-DR column (form column 4).
    // This is the DR where the Gizzu was installed, which generally differs
    // from the row's `dr_number` (ONT-DR, column 2). Find-it-later metadata —
    // no downstream consumer joins on this today, so we just populate the
    // field with no override-evict gymnastics (the field starts null from the
    // main pass anyway since the main pass prompt doesn't extract column 4).
    if (parsed.entries.length > 0) {
      const cropRowCount = Math.min(parsed.entries.length, PHYSICAL_FORM_ROWS);
      const gzDrMap = await extractGizzuDrNumbers(fullResBase64, cropRowCount);
      if (gzDrMap.size > 0) {
        let filled = 0;
        parsed.entries = parsed.entries.map((e) => {
          const focused = gzDrMap.get(e.row_number);
          if (focused && focused !== e.gizzu_dr_number) {
            filled++;
            return { ...e, gizzu_dr_number: focused };
          }
          return e;
        });
        log.info(`[EOD] Gizzu-DR per-cell pass filled ${filled} rows (of ${gzDrMap.size} returned)`);
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
