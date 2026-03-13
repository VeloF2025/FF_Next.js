/**
 * Test two-pass VLM extraction:
 *   Pass 1: Standard serial extraction (current prompts)
 *   Pass 2: Character-by-character confirmation for 8↔B ambiguity
 *
 * Tests against known mismatches where OES and VLM differ by only 1-2 chars
 * (the 8↔B, 0↔D confusion cases that are genuinely hard).
 *
 * Usage:
 *   npx tsx scripts/test-confirmation-pass.ts [--limit N] [--step 6|9|both]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);
const ONEMAP_HOST = process.env.ONEMAP_INTERNAL_URL || 'http://100.96.203.105:8003';
const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_EXTRACTION_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';

const args = process.argv.slice(2);
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '30', 10);
const STEP_FILTER = args.find((_, i, a) => a[i - 1] === '--step') || 'both';

// ============================================================================
// HELPERS (same as retest-vlm-serials.ts)
// ============================================================================

const HALLUCINATED_SERIALS = new Set([
  'ALCLB6A9C97', 'ALCLB48CC3CA', 'ALCLB48F2939',
  'ALCL12345678', 'ALCLM1234567', 'ALCL8400821',
  'ALCL6400821', 'ALCL8408021', 'ALCL84080311',
]);

function normalizeSerial(serial: string | null): string | null {
  if (!serial) return null;
  let s = serial.trim().toUpperCase().replace(/[\s\-,]/g, '');
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
  if (s.length === 11 && s.startsWith('ALCLB4') && !s.startsWith('ALCLB48')) {
    s = s.substring(0, 6) + '8' + s.substring(6);
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

async function callVlmRaw(base64: string, prompt: string): Promise<string | null> {
  const body = {
    model: VLM_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
      ],
    }],
    max_tokens: 200,
    temperature: 0.05, // Even lower for confirmation
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
    return data.choices?.[0]?.message?.content || null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ============================================================================
// CONFIRMATION PASS PROMPT
// ============================================================================

function buildConfirmationPrompt(pass1Serial: string): string {
  // Find ambiguous positions (8↔B, 0↔D confusion)
  const suffix = pass1Serial.substring(6);
  const ambiguous: string[] = [];
  for (let i = 0; i < suffix.length; i++) {
    const c = suffix[i];
    if (c === '8' || c === 'B') ambiguous.push(`Position ${7 + i}: "${c}" — is it "8" or "B"?`);
    if (c === '0' || c === 'D') ambiguous.push(`Position ${7 + i}: "${c}" — is it "0" or "D"?`);
    if (c === '6' || c === '8') {
      if (c === '8' && i > 0) ambiguous.push(`Position ${7 + i}: "${c}" — could it be "6"?`);
    }
  }

  return `I previously read the ONT serial number from this label as: "${pass1Serial}"

Now verify EACH character carefully. The serial format is ALCLB4 + 6 hex chars = 12 chars total.

${ambiguous.length > 0 ? `PAY SPECIAL ATTENTION to these ambiguous characters:
${ambiguous.join('\n')}

At this font size, "8" and "B" look very similar. So do "0" and "D".` : ''}

Look at the S/N field on the label again and return the corrected 12-character serial.
Return ONLY the serial (12 characters, starting with ALCLB4), nothing else.`;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log(`\n=== Two-Pass Confirmation Test ===`);
  console.log(`Limit: ${LIMIT} | Steps: ${STEP_FILTER}\n`);

  // Get single-char mismatches (8↔B, 0↔D cases) — these are the best candidates for confirmation pass
  const rows = await sql.query(`
    SELECT r.drop_number, r.oes_serial,
           r.vlm_ont_serial_step6, r.vlm_ont_serial_step9,
           r.vlm_categorization_results, r.photos_metadata
    FROM dr_photo_unified_reviews r
    JOIN oes_activations o ON o.drop_number = r.drop_number
    WHERE o.created_at >= (NOW() - INTERVAL '14 days')
      AND r.oes_serial IS NOT NULL AND r.oes_serial <> ''
      AND (r.vlm_ont_serial_step6 IS NOT NULL OR r.vlm_ont_serial_step9 IS NOT NULL)
    LIMIT 500
  `);

  console.log(`Loaded ${rows.length} DRs with OES + VLM data\n`);

  // Find close mismatches (1-2 char diff, same length)
  interface Candidate {
    dropNumber: string;
    oesSerial: string;
    vlmSerial: string;
    step: 6 | 9;
    diffPositions: number[];
    photos: Array<{ filename: string; step: number | null }>;
  }

  const candidates: Candidate[] = [];

  for (const row of rows) {
    const oes = row.oes_serial.trim().toUpperCase();
    const photos = row.photos_metadata || [];
    const cats = row.vlm_categorization_results
      ? (typeof row.vlm_categorization_results === 'string'
        ? JSON.parse(row.vlm_categorization_results)
        : row.vlm_categorization_results)
      : [];

    const photoSteps = photos.map((p: { filename: string; step?: number }) => {
      const cat = cats.find((c: { photo_filename: string; vlm_predicted_step?: number; human_override_step?: number }) =>
        c.photo_filename === p.filename);
      return {
        filename: p.filename,
        step: cat?.human_override_step ?? cat?.vlm_predicted_step ?? p.step ?? null,
      };
    });

    for (const [vlmField, step, stepNum] of [
      ['vlm_ont_serial_step6', 6, 6],
      ['vlm_ont_serial_step9', 9, 9],
    ] as const) {
      if (STEP_FILTER !== 'both' && String(step) !== STEP_FILTER) continue;
      const vlm = row[vlmField]?.trim().toUpperCase();
      if (!vlm || vlm === oes) continue;
      if (vlm.length !== oes.length || vlm.length !== 12) continue;
      if (!vlm.startsWith('ALCLB4') || !oes.startsWith('ALCLB4')) continue;

      // Count diffs
      const diffs: number[] = [];
      for (let i = 0; i < vlm.length; i++) {
        if (vlm[i] !== oes[i]) diffs.push(i);
      }

      if (diffs.length >= 1 && diffs.length <= 3) {
        candidates.push({
          dropNumber: row.drop_number,
          oesSerial: oes,
          vlmSerial: vlm,
          step: stepNum as 6 | 9,
          diffPositions: diffs,
          photos: photoSteps.filter((p: { step: number | null }) => p.step === stepNum),
        });
      }
    }
  }

  const toProcess = candidates.slice(0, LIMIT);
  console.log(`Found ${candidates.length} close mismatches (1-3 char diff), testing ${toProcess.length}\n`);

  // Categorize the types of confusion
  const confusionStats: Record<string, number> = {};
  for (const c of candidates) {
    for (const pos of c.diffPositions) {
      const pair = [c.vlmSerial[pos], c.oesSerial[pos]].sort().join('↔');
      confusionStats[pair] = (confusionStats[pair] || 0) + 1;
    }
  }
  console.log('Confusion pairs (across all candidates):');
  for (const [pair, count] of Object.entries(confusionStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pair}: ${count}`);
  }
  console.log();

  // Now test two-pass approach
  let pass1Correct = 0;
  let pass2Correct = 0;
  let pass2Changed = 0;
  let pass2MadeWorse = 0;
  let skipped = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const c = toProcess[i];
    if (i % 5 === 0 && i > 0) console.log(`  Progress: ${i}/${toProcess.length}...`);

    if (c.photos.length === 0) {
      skipped++;
      continue;
    }

    const photo = c.photos[0];
    const photoUrl = `${ONEMAP_HOST}/api/photo/${c.dropNumber}/${photo.filename}`;

    try {
      const base64 = await fetchImageAsBase64(photoUrl);

      // Pass 1: Standard extraction
      let pass1Raw: string | null = null;
      if (c.step === 6) {
        // Use Step 6 prompt (copy from retest)
        const resp = await callVlm(base64, `You are extracting the ONT serial number from the BACK of a Nokia/Alcatel device.

THE SERIAL FORMAT (memorize this):
- Pattern: ALCLB4 + two hex chars + four hex chars = exactly 12 characters
- The 7th character is almost always "8" (e.g., ALCLB4**8**F3528)
- The 8th character is usually F, D, E, or C
- Hex chars only: 0-9 and A-F. Never letters like M, N, P, R, S, Y, Z.
- Most common: ALCLB48F____ (79%), ALCLB48D____ (14%), ALCLB48E____ (3%)

WHERE TO FIND IT:
- Look for the "S/N:" field on the white product label
- Below the MAC ID line, above or near the barcode

❌ DO NOT EXTRACT: SSID (ALHN-), Part number (STN), MAC, IP, DR number

⚠️ VALIDATION:
1. Exactly 12 characters? If not, re-read.
2. Starts with ALCLB4? If not, wrong field.
3. 7th char "8"? Double-check.
4. All hex (0-9, A-F)?

Respond: {"found":true/false,"serial":"<12-char or null>","rawText":"<exact text>","confidence":0.0-1.0}
null is better than guessing.`);
        pass1Raw = (resp?.serial as string) || null;
      } else {
        const resp = await callVlm(base64, `You are analyzing the FRONT of a Nokia/Alcatel ONT device.

Look for the ONT SERIAL NUMBER on a small white sticker:
FORMAT: ALCLB4 + 6 hex characters = exactly 12 characters total
- 7th char almost always "8", 8th usually F/D/E/C
- Most common: ALCLB48F____ (79%), ALCLB48D____ (14%), ALCLB48E____ (3%)
- Only hex chars (0-9, A-F). Never M/N/P/R/S/Y/Z.
- NOT the DR number (DR1736721), NOT model (840F), NOT SSID (ALHN-)

Respond: {"ontSerial":{"found":true/false,"serial":"<12-char or null>","rawText":"<exact>","confidence":0.0-1.0},"drNumber":{"found":true/false,"drNumber":"<or null>"}}
null is better than guessing.`);
        const ontData = resp?.ontSerial as { found?: boolean; serial?: string } | undefined;
        pass1Raw = ontData?.serial || null;
      }

      const pass1Norm = normalizeSerial(pass1Raw);
      const pass1Valid = isValidOntSerial(pass1Norm);
      const pass1IsCorrect = pass1Valid && pass1Norm === c.oesSerial;

      if (pass1IsCorrect) {
        pass1Correct++;
        continue; // Already correct, no need for pass 2
      }

      if (!pass1Valid || !pass1Norm) {
        skipped++;
        continue; // Can't run confirmation on null/invalid
      }

      // Pass 2: Confirmation with ambiguity hints
      const confirmPrompt = buildConfirmationPrompt(pass1Norm);
      const pass2Raw = await callVlmRaw(base64, confirmPrompt);

      if (!pass2Raw) {
        continue;
      }

      // Extract serial from raw response
      const pass2Serial = pass2Raw.match(/ALCLB4[0-9A-Fa-f]{6}/)?.[0]?.toUpperCase() || null;
      const pass2Norm = normalizeSerial(pass2Serial);
      const pass2Valid = isValidOntSerial(pass2Norm);
      const pass2IsCorrect = pass2Valid && pass2Norm === c.oesSerial;

      if (pass2Norm !== pass1Norm) {
        pass2Changed++;
      }

      if (pass2IsCorrect) {
        pass2Correct++;
        console.log(`  ✓ FIXED ${c.dropNumber} step${c.step}: pass1="${pass1Norm}" → pass2="${pass2Norm}" = OES ✓`);
      } else if (pass2Norm !== pass1Norm) {
        pass2MadeWorse++;
        console.log(`  ✗ WORSE ${c.dropNumber} step${c.step}: pass1="${pass1Norm}" → pass2="${pass2Norm}" oes="${c.oesSerial}"`);
      } else {
        // Same as pass 1 — no change
        const diffChars = [];
        for (const pos of c.diffPositions) {
          if (pass1Norm && c.oesSerial) {
            diffChars.push(`pos${pos}: vlm="${pass1Norm[pos]}" oes="${c.oesSerial[pos]}"`);
          }
        }
        console.log(`  = SAME  ${c.dropNumber} step${c.step}: "${pass1Norm}" oes="${c.oesSerial}" (${diffChars.join(', ')})`);
      }

    } catch (err) {
      skipped++;
    }
  }

  // ============================================================================
  // REPORT
  // ============================================================================

  console.log(`\n${'='.repeat(70)}`);
  console.log(`TWO-PASS CONFIRMATION RESULTS`);
  console.log(`${'='.repeat(70)}\n`);

  const tested = toProcess.length - skipped;
  console.log(`Tested:           ${tested} close mismatches (skipped ${skipped})`);
  console.log(`Pass 1 correct:   ${pass1Correct} / ${tested} = ${tested > 0 ? ((pass1Correct / tested) * 100).toFixed(1) : 0}%`);
  console.log(`Pass 2 fixed:     ${pass2Correct} additional (confirmation corrected these)`);
  console.log(`Pass 2 changed:   ${pass2Changed} total (${pass2Correct} better, ${pass2MadeWorse} worse)`);
  console.log(`Combined:         ${pass1Correct + pass2Correct} / ${tested} = ${tested > 0 ? (((pass1Correct + pass2Correct) / tested) * 100).toFixed(1) : 0}%`);

  if (pass2Changed > 0) {
    const changeRate = ((pass2Changed / (tested - pass1Correct)) * 100).toFixed(1);
    const fixRate = pass2Changed > 0 ? ((pass2Correct / pass2Changed) * 100).toFixed(1) : '0';
    console.log(`\nConfirmation pass changed ${changeRate}% of wrong pass-1 results`);
    console.log(`Of those changes: ${fixRate}% were improvements, ${100 - parseFloat(fixRate)}% were worse`);
  }

  console.log(`\nVerdict: ${pass2Correct > pass2MadeWorse
    ? `✓ Confirmation pass helps (+${pass2Correct - pass2MadeWorse} net correct)`
    : pass2Correct === pass2MadeWorse
    ? '= Confirmation pass is neutral'
    : `✗ Confirmation pass hurts (net ${pass2Correct - pass2MadeWorse})`
  }`);

  console.log(`\n${'='.repeat(70)}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
