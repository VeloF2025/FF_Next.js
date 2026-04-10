/**
 * Re-test VLM serial extraction on this week's mismatched DRs.
 *
 * Fetches DRs where VLM ≠ OES, re-runs extraction with improved
 * prompts/validation, and compares old vs new accuracy.
 *
 * Usage:
 *   npx tsx scripts/retest-vlm-serials.ts [--limit N] [--step 6|9|both] [--update]
 *
 * Options:
 *   --limit N    Process at most N DRs (default: 50)
 *   --step 6|9   Only test step 6 or step 9 (default: both)
 *   --update     Write new serials back to DB (default: dry run)
 *   --since DATE Only DRs with OES imported after DATE (default: 7 days ago)
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Must set these before importing services that use them
const ONEMAP_HOST = process.env.ONEMAP_INTERNAL_URL || 'http://100.96.203.105:8003';

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

// Parse args
const args = process.argv.slice(2);
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '50', 10);
const STEP_FILTER = args.find((_, i, a) => a[i - 1] === '--step') || 'both';
const UPDATE_DB = args.includes('--update');
const sinceArg = args.find((_, i, a) => a[i - 1] === '--since');
const SINCE = sinceArg || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

// VLM config
const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_EXTRACTION_MODEL || 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ';

// Import the prompts and helpers inline (can't import from TS modules easily in scripts)
// We'll call the VLM directly with the same prompts from vlmExtractionService.ts

// ============================================================================
// PROMPTS (copy from vlmExtractionService.ts — kept in sync)
// ============================================================================

const ONT_SERIAL_BACK_PROMPT = `You are extracting the ONT serial number from the BACK of a Nokia/Alcatel device.

THE SERIAL FORMAT (memorize this):
- Pattern: ALCLB4 + two hex chars + four hex chars = exactly 12 characters
- The 7th character is "8" (64%), "7" (26%), or "6" (10%) — read it carefully, do NOT assume "8"
- Hex chars only: 0-9 and A-F. Never letters like M, N, P, R, S, Y, Z.
- Top patterns: ALCLB48D (20%), ALCLB477 (15%), ALCLB48C (12%), ALCLB48A (9%), ALCLB48F (6%)

WHERE TO FIND IT:
- Look for the "S/N:" field on the white product label
- Below the MAC ID line, above or near the barcode
- The barcode encodes this same serial

❌ DO NOT EXTRACT THESE (common mistakes):
- SSID: starts with "ALHN-" (WiFi name)
- Part number: starts with "STN" (model number)
- MAC: 12 hex chars without "ALCLB4" prefix
- IP address: 192.168.x.x
- DR number: DR followed by digits

⚠️ CRITICAL VALIDATION — check your answer:
1. Is it exactly 12 characters? If not, re-read. You likely dropped a character.
2. Does it start with ALCLB4? If not, you're reading the wrong field.
3. Is the 7th char "8", "7", or "6"? Read the actual character — don't guess.
4. Are all characters hex (0-9, A-F)? Letters like M, N, P, R, Y mean OCR error.
5. Does it look like "ALCL" + digits only (no "B4")? You're reading something else.

Respond in this exact JSON format:
{
  "found": true/false,
  "serial": "<12-char serial starting with ALCLB4, or null>",
  "rawText": "<exact text you read from the S/N field>",
  "confidence": <0.0 to 1.0>
}

If you cannot confidently read a 12-character serial starting with ALCLB4, return found: false.
Returning null is ALWAYS better than guessing.`;

const STEP9_FRONT_PROMPT = `You are analyzing the FRONT of a Nokia/Alcatel ONT device with installation labels.

Look for THREE items:

1. GREEN STATUS LIGHTS - Are LEDs illuminated (POWER, PON, LAN, WLAN)?

2. ONT SERIAL NUMBER - on a small white sticker attached to the front:
   FORMAT: ALCLB4 + 6 hex characters = exactly 12 characters total
   - The 7th char is "8" (64%), "7" (26%), or "6" (10%) — read it carefully, do NOT assume "8"
   - Top patterns: ALCLB48D (20%), ALCLB477 (15%), ALCLB48C (12%), ALCLB48A (9%), ALCLB48F (6%)
   - Only hex chars after ALCLB4: digits 0-9 and letters A-F
   - NEVER letters like M, N, P, R, S, Y, Z — those mean you misread

   ⚠️ THESE ARE NOT THE SERIAL (frequently confused):
   - DR numbers (DR1736721) — this is the drop reference, NOT the serial
   - Model numbers (840F, 8408) — these are Nokia product codes
   - SSID (ALHN-C397) — this is a WiFi network name
   - Any number without the "ALCLB4" prefix

   ⚠️ VALIDATION CHECKLIST (check before answering):
   - Exactly 12 characters? If 11, you dropped a char (usually at position 7)
   - Starts with ALCLB4? If "ALCL" + random chars, you read the wrong label
   - Only hex after ALCLB4? M/N/P/R/Y = misread
   - Looks like a phone number or DR number? WRONG field

3. DR NUMBER - handwritten/printed label: "DR" + 6-7 digits (e.g., DR1736721)

Respond in this exact JSON format:
{
  "greenLightsVisible": true/false,
  "ontSerial": {
    "found": true/false,
    "serial": "<12-char serial starting with ALCLB4, or null>",
    "rawText": "<exact text you read from the sticker>",
    "confidence": <0.0 to 1.0>
  },
  "drNumber": {
    "found": true/false,
    "drNumber": "<DR number like DR1234567, or null>",
    "rawText": "<exact text from label>",
    "confidence": <0.0 to 1.0>
  }
}

CRITICAL: If you cannot read a clear 12-char serial starting with ALCLB4, return found: false.
Returning null is ALWAYS better than guessing. Do NOT invent or fabricate serial numbers.`;

// ============================================================================
// HELPERS
// ============================================================================

const HALLUCINATED_SERIALS = new Set([
  'ALCLB6A9C97', 'ALCLB48CC3CA', 'ALCLB48F2939',
  'ALCL12345678', 'ALCLM1234567', 'ALCL8400821',
  'ALCL6400821', 'ALCL8408021', 'ALCL84080311',
]);

function normalizeSerial(serial: string | null): string | null {
  if (!serial) return null;
  let s = serial.trim().toUpperCase().replace(/[\s\-,]/g, '');

  // Fix non-hex chars in suffix
  if (s.startsWith('ALCLB4') && s.length >= 7) {
    const prefix = s.substring(0, 6);
    let suffix = s.substring(6);
    suffix = suffix.replace(/[GI]/g, '6');
    suffix = suffix.replace(/[O]/g, '0');
    suffix = suffix.replace(/[S]/g, '5');
    suffix = suffix.replace(/[Z]/g, '2');
    suffix = suffix.replace(/[^0-9A-F]/g, '');
    s = prefix + suffix;
  }

  // Auto-fix: If 11 chars and 7th char doesn't look like a position-7 value (8/7/6),
  // insert '8' (most common). Otherwise leave as-is.
  if (s.length === 11 && s.startsWith('ALCLB4')) {
    const c7 = s[6];
    if (c7 !== '8' && c7 !== '7' && c7 !== '6') {
      s = s.substring(0, 6) + '8' + s.substring(6);
    }
  }

  return s;
}

function isValidOntSerial(serial: string | null): boolean {
  if (!serial) return false;
  const s = serial.trim().toUpperCase();
  if (HALLUCINATED_SERIALS.has(s)) return false;
  if (s.startsWith('ALHN') || s.includes('-')) return false;
  if (!s.startsWith('ALCLB4')) return false;
  if (s.length !== 12) return false;
  if (!/^[0-9A-F]{6}$/.test(s.substring(6))) return false;
  return true;
}

async function fetchImageAsBase64(url: string): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${url}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
}

async function callVlm(base64: string, prompt: string): Promise<Record<string, unknown> | null> {
  const body = {
    model: VLM_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
      ],
    }],
    max_tokens: 2000,
    temperature: 0.1,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const resp = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/) ||
                      content.match(/```\n([\s\S]*?)\n```/) ||
                      [null, content];
    return JSON.parse(jsonMatch[1] || content);
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ============================================================================
// MAIN
// ============================================================================

interface TestResult {
  dropNumber: string;
  step: 6 | 9;
  oesSerial: string;
  oldVlm: string;
  newRawVlm: string | null;
  newNormalized: string | null;
  newValid: boolean;
  oldCorrect: boolean;
  newCorrect: boolean;
  photoUrl: string;
}

async function main() {
  console.log(`\n=== VLM Serial Re-Extraction Test ===`);
  console.log(`Since: ${SINCE} | Limit: ${LIMIT} | Steps: ${STEP_FILTER} | Update: ${UPDATE_DB}`);

  // Get mismatched DRs with their photo metadata
  const rows = await sql.query(`
    SELECT r.drop_number, r.oes_serial,
           r.vlm_ont_serial_step6, r.vlm_ont_serial_step9,
           r.serial_extraction_method_step6, r.serial_extraction_method_step9,
           r.vlm_categorization_results,
           r.photos_metadata
    FROM dr_photo_unified_reviews r
    JOIN oes_activations o ON o.drop_number = r.drop_number
    WHERE o.created_at >= '${SINCE}'
      AND r.oes_serial IS NOT NULL AND r.oes_serial <> ''
      AND (r.vlm_ont_serial_step6 IS NOT NULL OR r.vlm_ont_serial_step9 IS NOT NULL)
    LIMIT ${LIMIT * 3}
  `);

  console.log(`Found ${rows.length} DRs with OES + VLM data\n`);

  // Filter to mismatches only
  const mismatches: Array<{
    dropNumber: string;
    oesSerial: string;
    step: 6 | 9;
    oldVlm: string;
    photos: Array<{ filename: string; step: number | null }>;
  }> = [];

  for (const row of rows) {
    const oes = row.oes_serial.trim().toUpperCase();
    const photos = row.photos_metadata || [];
    const cats = row.vlm_categorization_results
      ? (typeof row.vlm_categorization_results === 'string'
        ? JSON.parse(row.vlm_categorization_results)
        : row.vlm_categorization_results)
      : [];

    // Build photo→step mapping from categorization
    const photoSteps = photos.map((p: { filename: string; step?: number }) => {
      const cat = cats.find((c: { photo_filename: string; vlm_predicted_step?: number; human_override_step?: number }) =>
        c.photo_filename === p.filename);
      return {
        filename: p.filename,
        step: cat?.human_override_step ?? cat?.vlm_predicted_step ?? p.step ?? null,
      };
    });

    // Step 6 mismatch
    if ((STEP_FILTER === 'both' || STEP_FILTER === '6') &&
        row.vlm_ont_serial_step6 &&
        row.serial_extraction_method_step6 === 'vlm' &&
        row.vlm_ont_serial_step6.trim().toUpperCase() !== oes) {
      mismatches.push({
        dropNumber: row.drop_number, oesSerial: oes, step: 6,
        oldVlm: row.vlm_ont_serial_step6.trim().toUpperCase(),
        photos: photoSteps.filter((p: { step: number | null }) => p.step === 6),
      });
    }

    // Step 9 mismatch
    if ((STEP_FILTER === 'both' || STEP_FILTER === '9') &&
        row.vlm_ont_serial_step9 &&
        row.vlm_ont_serial_step9.trim().toUpperCase() !== oes) {
      mismatches.push({
        dropNumber: row.drop_number, oesSerial: oes, step: 9,
        oldVlm: row.vlm_ont_serial_step9.trim().toUpperCase(),
        photos: photoSteps.filter((p: { step: number | null }) => p.step === 9),
      });
    }
  }

  // Trim to limit
  const toProcess = mismatches.slice(0, LIMIT);
  console.log(`Processing ${toProcess.length} mismatches (of ${mismatches.length} total)\n`);

  const results: TestResult[] = [];
  let processed = 0;

  for (const m of toProcess) {
    processed++;
    if (processed % 10 === 0) {
      console.log(`  Progress: ${processed}/${toProcess.length}...`);
    }

    // Try each photo for this step
    let bestResult: TestResult | null = null;

    // If no categorized photos for this step, try all photos
    const photosToTry = m.photos.length > 0
      ? m.photos
      : []; // Skip if no photos mapped to this step

    if (photosToTry.length === 0) {
      results.push({
        dropNumber: m.dropNumber, step: m.step, oesSerial: m.oesSerial,
        oldVlm: m.oldVlm, newRawVlm: null, newNormalized: null,
        newValid: false, oldCorrect: false, newCorrect: false,
        photoUrl: 'no_photo_for_step',
      });
      continue;
    }

    for (const photo of photosToTry) {
      const photoUrl = `${ONEMAP_HOST}/api/photo/${m.dropNumber}/${photo.filename}`;

      try {
        const base64 = await fetchImageAsBase64(photoUrl);

        let rawSerial: string | null = null;

        if (m.step === 6) {
          const resp = await callVlm(base64, ONT_SERIAL_BACK_PROMPT);
          rawSerial = (resp?.serial as string) || null;
        } else {
          const resp = await callVlm(base64, STEP9_FRONT_PROMPT);
          const ontData = resp?.ontSerial as { found?: boolean; serial?: string } | undefined;
          rawSerial = ontData?.serial || null;
        }

        const normalized = normalizeSerial(rawSerial);
        const valid = isValidOntSerial(normalized);
        const correct = valid && normalized === m.oesSerial;

        const result: TestResult = {
          dropNumber: m.dropNumber, step: m.step, oesSerial: m.oesSerial,
          oldVlm: m.oldVlm, newRawVlm: rawSerial, newNormalized: normalized,
          newValid: valid, oldCorrect: false, newCorrect: correct,
          photoUrl: photo.filename,
        };

        // Keep best result (prefer correct, then valid, then any)
        if (!bestResult || (correct && !bestResult.newCorrect) ||
            (valid && !bestResult.newValid && !bestResult.newCorrect)) {
          bestResult = result;
        }

        if (correct) break; // Got it right, no need to try more photos
      } catch (err) {
        // Photo fetch or VLM failed, try next
        continue;
      }
    }

    if (bestResult) {
      results.push(bestResult);
    }
  }

  // ============================================================================
  // REPORT
  // ============================================================================

  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESULTS: ${results.length} extractions tested`);
  console.log(`${'='.repeat(70)}\n`);

  const noPhoto = results.filter(r => r.photoUrl === 'no_photo_for_step');
  const tested = results.filter(r => r.photoUrl !== 'no_photo_for_step');

  const oldCorrect = tested.filter(r => r.oldCorrect).length;
  const newCorrect = tested.filter(r => r.newCorrect).length;
  const newValid = tested.filter(r => r.newValid).length;
  const newNull = tested.filter(r => r.newNormalized === null).length;

  console.log(`Tested:      ${tested.length} (${noPhoto.length} skipped - no photo for step)`);
  console.log(`Old correct: ${oldCorrect} (0% — all were mismatches by definition)`);
  console.log(`New correct: ${newCorrect} / ${tested.length} = ${tested.length > 0 ? ((newCorrect / tested.length) * 100).toFixed(1) : 0}%`);
  console.log(`New valid:   ${newValid} / ${tested.length} = ${tested.length > 0 ? ((newValid / tested.length) * 100).toFixed(1) : 0}%`);
  console.log(`New null:    ${newNull} (returned null instead of guessing)`);

  // Break down by step
  for (const step of [6, 9] as const) {
    const stepResults = tested.filter(r => r.step === step);
    if (stepResults.length === 0) continue;
    const sc = stepResults.filter(r => r.newCorrect).length;
    const sv = stepResults.filter(r => r.newValid).length;
    const sn = stepResults.filter(r => r.newNormalized === null).length;
    console.log(`\n  Step ${step}: ${sc}/${stepResults.length} correct (${((sc / stepResults.length) * 100).toFixed(1)}%), ${sv} valid, ${sn} null`);
  }

  // Show improvement categories
  const fixed = tested.filter(r => r.newCorrect);
  const stillWrong = tested.filter(r => r.newValid && !r.newCorrect);
  const nowNull = tested.filter(r => !r.newValid && r.newNormalized === null);
  const nowInvalid = tested.filter(r => !r.newValid && r.newNormalized !== null);

  console.log(`\n  Fixed (now correct):     ${fixed.length}`);
  console.log(`  Still wrong (valid):     ${stillWrong.length}`);
  console.log(`  Now null (better):       ${nowNull.length}`);
  console.log(`  Rejected (invalid):      ${nowInvalid.length}`);

  // Show sample corrections
  if (fixed.length > 0) {
    console.log(`\n  Sample FIXED:`);
    for (const r of fixed.slice(0, 10)) {
      console.log(`    ${r.dropNumber} step${r.step}: old="${r.oldVlm}" → new="${r.newNormalized}" = OES ✓`);
    }
  }

  // Show sample still-wrong
  if (stillWrong.length > 0) {
    console.log(`\n  Sample STILL WRONG:`);
    for (const r of stillWrong.slice(0, 10)) {
      console.log(`    ${r.dropNumber} step${r.step}: raw="${r.newRawVlm}" norm="${r.newNormalized}" oes="${r.oesSerial}"`);
    }
  }

  // Show auto-fix impact
  const autoFixed = tested.filter(r => r.newRawVlm && r.newNormalized &&
    r.newRawVlm.trim().toUpperCase() !== r.newNormalized &&
    r.newCorrect);
  if (autoFixed.length > 0) {
    console.log(`\n  Auto-fix corrections (normalization fixed these):`);
    for (const r of autoFixed.slice(0, 10)) {
      console.log(`    ${r.dropNumber}: raw="${r.newRawVlm}" → norm="${r.newNormalized}" = OES ✓`);
    }
  }

  // ============================================================================
  // WA PHOTO RE-TEST
  // ============================================================================

  if (STEP_FILTER === 'both' || STEP_FILTER === 'wa') {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`WA PHOTO RE-TEST`);
    console.log(`${'='.repeat(70)}\n`);

    const VPS_PHOTO_BASE = process.env.VPS_PHOTO_URL || 'http://72.61.197.178:8866';

    const WA_SERIAL_PROMPT = `You are extracting device serial numbers from a WhatsApp-submitted installation photo.

This photo shows a printed sticker with TWO serial numbers:

1. ONT SERIAL NUMBER:
   FORMAT: ALCLB4 + 6 hex characters = exactly 12 characters
   - The 7th char is "8" (64%), "7" (26%), or "6" (10%) — read carefully, don't assume
   - Top patterns: ALCLB48D (20%), ALCLB477 (15%), ALCLB48C (12%), ALCLB48A (9%)
   - Only hex chars (0-9, A-F) after the ALCLB4 prefix
   - NEVER letters M, N, P, R, S, Y, Z — those mean you misread
   - Usually labeled "S/N:" or "ONT Serial"

2. UPS SERIAL NUMBER:
   - Starts with "GU18W" followed by 8-10 alphanumeric characters
   - 13-15 characters total

⚠️ VALIDATION: ONT must be exactly 12 chars starting with ALCLB4. If 11, you dropped the "8" at pos 7.

Respond in JSON: {"ontSerial":{"found":true/false,"serial":"<12-char or null>","confidence":0.0-1.0},"upsSerial":{"found":true/false,"serial":"<or null>","confidence":0.0-1.0}}

null is better than wrong.`;

    const waRows = await sql.query(`
      WITH wa_best AS (
        SELECT DISTINCT ON (drop_number)
          drop_number, vlm_ont_serial, vlm_confidence, local_path, id
        FROM wa_photos
        WHERE purpose = 'activation' AND vlm_processed = true
          AND vlm_ont_serial IS NOT NULL
          AND message_timestamp >= '${SINCE}'
        ORDER BY drop_number, vlm_confidence DESC NULLS LAST
      )
      SELECT w.drop_number, w.vlm_ont_serial as old_vlm, w.local_path, w.id as photo_id,
             o.serial_number as oes_serial
      FROM wa_best w
      JOIN oes_activations o ON o.drop_number = w.drop_number
      WHERE o.created_at >= '${SINCE}'
        AND UPPER(TRIM(w.vlm_ont_serial)) <> UPPER(TRIM(o.serial_number))
      LIMIT ${LIMIT}
    `);

    console.log(`Found ${waRows.length} WA photo mismatches\n`);

    const waResults: TestResult[] = [];
    let waProcessed = 0;

    for (const row of waRows) {
      waProcessed++;
      if (waProcessed % 5 === 0) console.log(`  WA progress: ${waProcessed}/${waRows.length}...`);

      const oes = row.oes_serial.trim().toUpperCase();
      const oldVlm = row.old_vlm.trim().toUpperCase();

      // Convert local_path to URL
      const urlPath = row.local_path.replace(
        '/var/lib/docker/volumes/boss-vps_dr_photos/_data/',
        '/photos/'
      );
      const photoUrl = `${VPS_PHOTO_BASE}${urlPath}`;

      try {
        const base64 = await fetchImageAsBase64(photoUrl);
        const resp = await callVlm(base64, WA_SERIAL_PROMPT);
        const ontData = resp?.ontSerial as { found?: boolean; serial?: string } | undefined;
        const rawSerial = ontData?.serial || null;

        const normalized = normalizeSerial(rawSerial);
        const valid = isValidOntSerial(normalized);
        const correct = valid && normalized === oes;

        waResults.push({
          dropNumber: row.drop_number, step: 9, oesSerial: oes,
          oldVlm, newRawVlm: rawSerial, newNormalized: normalized,
          newValid: valid, oldCorrect: false, newCorrect: correct,
          photoUrl: row.local_path,
        });
      } catch (err) {
        waResults.push({
          dropNumber: row.drop_number, step: 9, oesSerial: oes,
          oldVlm, newRawVlm: null, newNormalized: null,
          newValid: false, oldCorrect: false, newCorrect: false,
          photoUrl: 'fetch_failed',
        });
      }
    }

    const waFixed = waResults.filter(r => r.newCorrect);
    const waStillWrong = waResults.filter(r => r.newValid && !r.newCorrect);
    const waNowNull = waResults.filter(r => r.newNormalized === null);
    const waTested = waResults.filter(r => r.photoUrl !== 'fetch_failed');

    console.log(`\n  WA Tested:      ${waTested.length}`);
    console.log(`  WA Fixed:       ${waFixed.length} / ${waTested.length} = ${waTested.length > 0 ? ((waFixed.length / waTested.length) * 100).toFixed(1) : 0}%`);
    console.log(`  WA Still wrong: ${waStillWrong.length}`);
    console.log(`  WA Now null:    ${waNowNull.length}`);

    if (waFixed.length > 0) {
      console.log(`\n  WA FIXED:`);
      for (const r of waFixed.slice(0, 10)) {
        console.log(`    ${r.dropNumber}: old="${r.oldVlm}" → new="${r.newNormalized}" = OES ✓`);
      }
    }

    if (waStillWrong.length > 0) {
      console.log(`\n  WA STILL WRONG:`);
      for (const r of waStillWrong.slice(0, 10)) {
        console.log(`    ${r.dropNumber}: raw="${r.newRawVlm}" norm="${r.newNormalized}" oes="${r.oesSerial}"`);
      }
    }

    // Check for serial swaps (VLM reads correct serial but for wrong DR)
    const allWaSerials = waResults.map(r => ({ dr: r.dropNumber, vlm: r.newNormalized, oes: r.oesSerial }));
    const swaps: string[] = [];
    for (const a of allWaSerials) {
      for (const b of allWaSerials) {
        if (a.dr !== b.dr && a.vlm === b.oes && b.vlm === a.oes) {
          const key = [a.dr, b.dr].sort().join('-');
          if (!swaps.includes(key)) swaps.push(key);
        }
      }
    }
    if (swaps.length > 0) {
      console.log(`\n  ⚠️ Possible serial SWAPS (tech photographed wrong ONT): ${swaps.length}`);
      for (const s of swaps) console.log(`    ${s}`);
    }
  }

  // Update DB if requested
  if (UPDATE_DB && fixed.length > 0) {
    console.log(`\n  Updating ${fixed.length} corrected serials in DB...`);
    for (const r of fixed) {
      const col = r.step === 6 ? 'vlm_ont_serial_step6' : 'vlm_ont_serial_step9';
      await sql.query(
        `UPDATE dr_photo_unified_reviews SET ${col} = $1, updated_at = NOW() WHERE drop_number = $2`,
        [r.newNormalized, r.dropNumber]
      );
    }
    console.log(`  Done — ${fixed.length} records updated.`);
  }

  console.log(`\n${'='.repeat(70)}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
