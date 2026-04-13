/**
 * Serial Recheck Service
 *
 * Orchestrates second-pass VLM re-analysis for serial mismatches.
 * Called by /api/activate/recheck-serial-mismatch.
 *
 * Status: WORKING
 */

import { neon } from '@/lib/db-neon';
import { log } from '@/lib/logger';
import { recordVlmCorrection } from '@/services/vlmLearningService';
import { extractUpsSerialRecheck, extractOntSerialRecheck } from './waPhotoExtraction';

const sql = neon(process.env.DATABASE_URL!);

const WA_FEEDBACK_URL = process.env.WA_FEEDBACK_URL || 'http://100.96.203.105:8092';
const VPS_PHOTO_BASE = process.env.VPS_PHOTO_BASE || 'http://72.61.197.178';

// ============================================================================
// TYPES
// ============================================================================

export type RecheckOutcome = 'correction' | 'verify' | 'unclear';
export type RecheckSerialType = 'ups' | 'ont' | 'both';

export interface RecheckResult {
  outcome: RecheckOutcome;
  serialType: RecheckSerialType;
  secondPassSerial: string | null;
  confidence: number | null;
  waMessageSent: boolean;
  learningLogged: boolean;
}

export interface OutcomeInput {
  secondPassSerial: string | null;
  confidence: number;
  onemapSerial: string | null;
}

export interface WaMessageInput {
  dropNumber: string;
  serialType: RecheckSerialType;
  outcome: RecheckOutcome;
  onemapSerial: string | null;
  firstPassSerial: string | null;
  secondPassSerial: string | null;
  confidence: number;
}

// ============================================================================
// THRESHOLD LOGIC (exported for testing)
// ============================================================================

export function determineRecheckOutcome(input: OutcomeInput): RecheckOutcome {
  const { secondPassSerial, confidence, onemapSerial } = input;

  if (!secondPassSerial || confidence < 0.65) {
    return 'unclear';
  }

  if (
    confidence > 0.85 &&
    onemapSerial &&
    secondPassSerial.toUpperCase() === onemapSerial.toUpperCase()
  ) {
    return 'correction';
  }

  return 'verify';
}

// ============================================================================
// WA MESSAGE BUILDER (exported for testing)
// ============================================================================

export function buildRecheckWaMessage(input: WaMessageInput): string {
  const { dropNumber, serialType, outcome, onemapSerial, firstPassSerial, secondPassSerial, confidence } = input;
  const typeLabel = serialType === 'ups' ? 'UPS' : serialType === 'ont' ? 'ONT' : 'UPS & ONT';

  let message = `🔍 Second Look — ${dropNumber}\n\n`;

  if (outcome === 'correction') {
    message += `We re-analysed the ${typeLabel} serial photo.\n`;
    message += `✅ 1Map serial confirmed: ${onemapSerial}\n`;
    message += `❌ Our first read was incorrect: ${firstPassSerial}\n\n`;
    message += `No action needed — 1Map is correct.`;
  } else if (outcome === 'verify') {
    const pct = Math.round(confidence * 100);
    message += `We re-analysed the ${typeLabel} serial photo (${pct}% confidence).\n`;
    message += `⚠️ Please verify the serial on the physical box vs 1Map.\n\n`;
    message += `📦 1Map: ${onemapSerial}\n`;
    message += `📸 We read: ${secondPassSerial ?? firstPassSerial}`;
  } else {
    message += `⚠️ We couldn't read the ${typeLabel} serial clearly.\n`;
    message += `Please verify the physical box serial against 1Map.\n\n`;
    message += `📦 1Map: ${onemapSerial}`;
  }

  return message;
}

// ============================================================================
// DB ROW TYPES
// ============================================================================

interface WaPhotoRow {
  id: number;
  local_path: string;
  original_filename: string | null;
  vlm_ups_serial: string | null;
  vlm_ont_serial: string | null;
}

interface ReviewRow {
  ont_serial_scanned: string | null;
  ups_serial_scanned: string | null;
  wa_group_jid: string | null;
  project: string | null;
}

// ============================================================================
// CORE ORCHESTRATION
// ============================================================================

/**
 * Run the full serial mismatch recheck flow for a drop.
 * Fetches photos, runs second-pass VLM, applies threshold, logs learning, sends WA.
 */
export async function runSerialRecheck(
  dropNumber: string,
  source: 'auto' | 'manual',
  userId?: string
): Promise<RecheckResult> {
  log.info(`Starting recheck for ${dropNumber} (source=${source})`, undefined, 'SerialRecheck');

  // 1. Fetch 1Map serials + WA group JID
  const reviewRows = await sql`
    SELECT ont_serial_scanned, ups_serial_scanned, wa_group_jid, project
    FROM dr_photo_unified_reviews
    WHERE drop_number = ${dropNumber}
    LIMIT 1
  ` as ReviewRow[];

  if (reviewRows.length === 0) {
    log.warn(`No unified review found for ${dropNumber}`, undefined, 'SerialRecheck');
    return {
      outcome: 'unclear',
      serialType: 'ups',
      secondPassSerial: null,
      confidence: null,
      waMessageSent: false,
      learningLogged: false,
    };
  }

  const review = reviewRows[0]!;
  const onemapUps = review.ups_serial_scanned;
  const onemapOnt = review.ont_serial_scanned;

  // 2. Fetch WA photos
  const photos = await sql`
    SELECT id, local_path, original_filename, vlm_ups_serial, vlm_ont_serial
    FROM wa_photos
    WHERE drop_number = ${dropNumber}
      AND vlm_processed = true
    ORDER BY created_at DESC
    LIMIT 5
  ` as WaPhotoRow[];

  if (photos.length === 0) {
    log.warn(`No processed WA photos found for ${dropNumber}`, undefined, 'SerialRecheck');
    return {
      outcome: 'unclear',
      serialType: 'ups',
      secondPassSerial: null,
      confidence: null,
      waMessageSent: false,
      learningLogged: false,
    };
  }

  // 3. Find mismatching photos
  const upsMismatches = photos.filter(
    p => p.vlm_ups_serial && onemapUps && p.vlm_ups_serial.toUpperCase() !== onemapUps.toUpperCase()
  );
  const ontMismatches = photos.filter(
    p => p.vlm_ont_serial && onemapOnt && p.vlm_ont_serial.toUpperCase() !== onemapOnt.toUpperCase()
  );

  const hasUpsMismatch = upsMismatches.length > 0;
  const hasOntMismatch = ontMismatches.length > 0;

  if (!hasUpsMismatch && !hasOntMismatch) {
    log.info(`No active mismatch for ${dropNumber} — skipping`, undefined, 'SerialRecheck');
    return {
      outcome: 'unclear',
      serialType: 'ups',
      secondPassSerial: null,
      confidence: null,
      waMessageSent: false,
      learningLogged: false,
    };
  }

  const serialType: RecheckSerialType =
    hasUpsMismatch && hasOntMismatch ? 'both' : hasUpsMismatch ? 'ups' : 'ont';
  const targetPhoto = (hasUpsMismatch ? upsMismatches[0] : ontMismatches[0])!;
  const urlPath = targetPhoto.local_path.replace(
    '/var/lib/docker/volumes/boss-vps_dr_photos/_data/',
    '/photos/'
  );
  const photoUrl = `${VPS_PHOTO_BASE}${urlPath}`;

  const firstPassSerial = hasUpsMismatch
    ? (upsMismatches[0]?.vlm_ups_serial ?? null)
    : (ontMismatches[0]?.vlm_ont_serial ?? null);
  const onemapSerial = hasUpsMismatch ? onemapUps : onemapOnt;

  // 4. Run VLM second pass
  let secondPassSerial: string | null = null;
  let confidence = 0;
  try {
    const extraction = hasUpsMismatch
      ? await extractUpsSerialRecheck(photoUrl)
      : await extractOntSerialRecheck(photoUrl);
    secondPassSerial = extraction.serial;
    confidence = extraction.confidence;
  } catch (vlmError) {
    log.error(`VLM recheck failed for ${dropNumber}`, { action: 'vlmRecheck', dropNumber, error: vlmError }, 'SerialRecheck');
  }

  // 5. Apply threshold
  const outcome = determineRecheckOutcome({ secondPassSerial, confidence, onemapSerial });
  log.info(`Outcome for ${dropNumber}: ${outcome} (conf=${confidence.toFixed(2)}, serial=${secondPassSerial})`, undefined, 'SerialRecheck');

  // 6. Log to VLM learning
  let learningLogged = false;
  try {
    await recordVlmCorrection({
      module: 'activate',
      analysisType: 'wa_serial_recheck',
      sourceId: dropNumber,
      sourceTable: 'dr_photo_unified_reviews',
      photoUrl,
      vlmExtractedValue: firstPassSerial || '',
      vlmConfidence: confidence,
      correctedValue:
        outcome === 'correction'
          ? (onemapSerial || '')
          : (secondPassSerial || firstPassSerial || ''),
      correctionReason: outcome === 'correction' ? 'digit_confusion' : 'ocr_failure',
      correctionNotes: `Recheck: outcome=${outcome}, source=${source}`,
      context: { dropNumber, serialType, outcome, onemapSerial, firstPassSerial, secondPassSerial },
    });
    learningLogged = true;
  } catch (learningError) {
    log.warn(`VLM learning log failed for ${dropNumber}`, { action: 'logLearning', dropNumber, error: learningError }, 'SerialRecheck');
  }

  // 7. Write to serial_recheck_log
  try {
    await sql`
      INSERT INTO serial_recheck_log (
        drop_number, triggered_by, rechecker_user_id, serial_type,
        first_pass_serial, second_pass_serial, second_pass_confidence,
        outcome, onemap_serial
      ) VALUES (
        ${dropNumber}, ${source}, ${userId ?? null}, ${serialType},
        ${firstPassSerial}, ${secondPassSerial}, ${confidence || null},
        ${outcome}, ${onemapSerial}
      )
    `;
  } catch (dbError) {
    log.error(`DB log failed for ${dropNumber}`, { action: 'logToDb', dropNumber, error: dbError }, 'SerialRecheck');
  }

  // 8. Send WA follow-up
  let waMessageSent = false;
  const waGroupJid = review.wa_group_jid;

  if (waGroupJid) {
    const message = buildRecheckWaMessage({
      dropNumber,
      serialType,
      outcome,
      onemapSerial,
      firstPassSerial,
      secondPassSerial,
      confidence,
    });
    try {
      const waRes = await fetch(`${WA_FEEDBACK_URL}/send-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: waGroupJid, message }),
        signal: AbortSignal.timeout(30000),
      });
      if (waRes.ok) {
        waMessageSent = true;
        await sql`
          UPDATE serial_recheck_log
          SET wa_message_sent = true, wa_message_at = NOW()
          WHERE drop_number = ${dropNumber}
            AND recheck_at = (
              SELECT MAX(recheck_at) FROM serial_recheck_log WHERE drop_number = ${dropNumber}
            )
        `;
        log.info(`WA follow-up sent for ${dropNumber}`, undefined, 'SerialRecheck');
      } else {
        log.warn(`WA send failed for ${dropNumber}: HTTP ${waRes.status}`, undefined, 'SerialRecheck');
      }
    } catch (waError) {
      log.error(`WA send error for ${dropNumber}`, { action: 'sendWa', dropNumber, error: waError }, 'SerialRecheck');
    }
  } else {
    log.warn(`No wa_group_jid for ${dropNumber} — cannot send WA message`, undefined, 'SerialRecheck');
  }

  return { outcome, serialType, secondPassSerial, confidence, waMessageSent, learningLogged };
}
