/**
 * Pole Install ACK Service
 *
 * Orchestrates real-time photo classification and WhatsApp ACK messages
 * for civil pole installation submissions. Each photo is classified by VLM,
 * tracked in a per-pole session, and acknowledged back to the field team.
 *
 * @module field-ops/services/poleInstallAckService
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import {
  classifyPolePhoto,
  extractPoleFromText,
  PoleInstallStep,
} from './poleInstallClassifier';
import { linkSessionToQaReview } from './poleInstallCompletionService';

const logger = createLogger('poleInstallAckService');
const WA_BRIDGE_URL = process.env.WHATSAPP_BRIDGE_URL || 'http://72.61.197.178:8083';

function getDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  return neon(process.env.DATABASE_URL);
}

// ============================================================================
// Types
// ============================================================================

export interface PhotoData {
  photoId: string;
  senderJid: string;
  senderName: string;
  messageTimestamp: string;
}

export interface GroupInfo {
  groupJid: string;
  projectId: string;
  projectName: string;
}

interface Session {
  id: string;
  pole_number: string | null;
  before_count: number;
  depth_count: number;
  stumping_count: number;
  compaction_count: number;
  housekeeping_count: number;
  during_count: number;
  endplate_count: number;
  level_count: number;
  signature_count: number;
  total_photos: number;
  required_photos: number;
  is_corner_pole: boolean;
  pole_verified: boolean;
  pole_exists_in_sow: boolean | null;
  status: string;
}

// ============================================================================
// Session Resolution
// ============================================================================

async function findOrCreateSession(
  groupJid: string,
  senderJid: string,
  senderName: string,
  projectId: string,
  extractedPole: string | null
): Promise<Session> {
  const sql = getDb();

  const rows = await sql`
    SELECT * FROM pole_install_sessions
    WHERE wa_group_jid = ${groupJid}
      AND status = 'in_progress'
      AND started_at > NOW() - INTERVAL '4 hours'
    ORDER BY
      CASE
        WHEN ${extractedPole}::text IS NOT NULL AND pole_number = ${extractedPole} THEN 0
        WHEN sender_jid = ${senderJid} THEN 1
        ELSE 2
      END,
      last_photo_at DESC NULLS LAST
    LIMIT 1
  `;

  if (rows.length > 0) {
    return rows[0] as unknown as Session;
  }

  const inserted = await sql`
    INSERT INTO pole_install_sessions (
      project_id, wa_group_jid, pole_number,
      sender_jid, sender_name, started_at, last_photo_at
    ) VALUES (
      ${projectId}::uuid, ${groupJid}, ${extractedPole},
      ${senderJid}, ${senderName}, NOW(), NOW()
    )
    RETURNING *
  `;

  const newSession = inserted[0];
  logger.info('New pole install session created', {
    sessionId: newSession?.id,
    poleNumber: extractedPole,
    groupJid,
  });

  return newSession as unknown as Session;
}

// ============================================================================
// Cross-reference
// ============================================================================

async function crossRefPole(
  poleNumber: string,
  projectId: string
): Promise<{ exists: boolean; zoneNo: number | null; ponNo: number | null }> {
  const sql = getDb();
  const rows = await sql`
    SELECT zone_no, pon_no FROM poles
    WHERE pole_number = ${poleNumber}
      AND project_id = ${projectId}::uuid
    LIMIT 1
  `;
  const pole = rows[0];
  if (pole) {
    return { exists: true, zoneNo: pole.zone_no as number | null, ponNo: pole.pon_no as number | null };
  }
  return { exists: false, zoneNo: null, ponNo: null };
}

// ============================================================================
// Increment Step Count
// ============================================================================

async function incrementStepCount(
  sessionId: string,
  step: PoleInstallStep,
  poleNumber: string | null,
  poleVerified: boolean,
  poleExistsInSow: boolean | null
): Promise<Session> {
  const sql = getDb();
  const rows = await sql`
    UPDATE pole_install_sessions SET
      before_count = before_count + ${step === 'BEFORE' ? 1 : 0},
      depth_count = depth_count + ${step === 'DEPTH' ? 1 : 0},
      stumping_count = stumping_count + ${step === 'STUMPING' ? 1 : 0},
      compaction_count = compaction_count + ${step === 'COMPACTION' ? 1 : 0},
      housekeeping_count = housekeeping_count + ${step === 'HOUSEKEEPING' ? 1 : 0},
      during_count = during_count + ${step === 'DURING' ? 1 : 0},
      endplate_count = endplate_count + ${step === 'ENDPLATE' ? 1 : 0},
      level_count = level_count + ${step === 'LEVEL' ? 1 : 0},
      signature_count = signature_count + ${step === 'SIGNATURE' ? 1 : 0},
      total_photos = total_photos + 1,
      last_photo_at = NOW(),
      ack_count = ack_count + 1,
      pole_number = COALESCE(pole_number, ${poleNumber}),
      pole_verified = CASE WHEN ${poleVerified} THEN TRUE ELSE pole_verified END,
      pole_exists_in_sow = CASE WHEN ${poleExistsInSow}::boolean IS NOT NULL
        THEN ${poleExistsInSow} ELSE pole_exists_in_sow END,
      updated_at = NOW()
    WHERE id = ${sessionId}::uuid
    RETURNING *
  `;
  return rows[0] as unknown as Session;
}

// ============================================================================
// Completion Check
// ============================================================================

function isSessionComplete(s: Session): boolean {
  return (
    s.before_count >= 3 &&
    s.depth_count >= 1 &&
    s.stumping_count >= 3 &&
    s.compaction_count >= 1 &&
    s.housekeeping_count >= 3
  );
}

async function markComplete(sessionId: string): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE pole_install_sessions
    SET status = 'complete', completed_at = NOW(), updated_at = NOW()
    WHERE id = ${sessionId}::uuid
  `;
}

// ============================================================================
// ACK Message Builder
// ============================================================================

const STEP_LABELS: Record<string, string> = {
  BEFORE: 'BEFORE PHOTO', DURING: 'DURING PHOTO', DEPTH: 'DEPTH PHOTO',
  ENDPLATE: 'ENDPLATE PHOTO', COMPACTION: 'COMPACTION PHOTO',
  LEVEL: 'LEVEL CHECK', STUMPING: 'STUMPING PHOTO',
  HOUSEKEEPING: 'HOUSEKEEPING PHOTO', SIGNATURE: 'SIGNATURE PHOTO',
  UNKNOWN: 'UNCLASSIFIED PHOTO',
};

function progressLine(label: string, count: number, required: number): string {
  return `${count >= required ? '✅' : '⬜'} ${label} (${count}/${required})`;
}

function buildAckMessage(
  step: PoleInstallStep,
  session: Session,
  qualityOk: boolean,
  issues: string[],
  feedback: string,
  poleExistsInSow: boolean | null
): string {
  const lines: string[] = [];
  const pole = session.pole_number || 'UNKNOWN';
  const complete = isSessionComplete(session);

  if (complete) {
    lines.push(`🎉 Pole ${pole} — ALL PHOTOS RECEIVED!`);
    lines.push(
      `✅ Before (${session.before_count}/3) ✅ Depth (${session.depth_count}/1) ` +
      `✅ Stumping (${session.stumping_count}/3)`
    );
    lines.push(
      `✅ Cement (${session.compaction_count}/1) ` +
      `✅ Housekeeping (${session.housekeeping_count}/3)`
    );
    lines.push('');
    lines.push(`Total: ${session.total_photos}/${session.required_photos} — pole install documentation complete.`);
    lines.push('QA review created. Thank you! 🏗️');
    return lines.join('\n');
  }

  const icon = qualityOk ? '✅' : '⚠️';
  const verb = qualityOk ? 'Photo received' : 'Photo issue';
  lines.push(`${icon} ${verb} — ${STEP_LABELS[step] || step}`);

  if (session.pole_number) {
    const sow = poleExistsInSow === true ? '✓ Found in SOW' :
      poleExistsInSow === false ? '✗ NOT in SOW' : '';
    lines.push(`📍 Pole: ${session.pole_number} ${sow}`.trim());
  } else {
    lines.push('📍 Pole: UNKNOWN — no pole number set');
  }

  if (!qualityOk && issues.length > 0) {
    lines.push(`❌ ${issues[0]}`);
  }
  if (feedback && !qualityOk) {
    lines.push(`💡 ${feedback}`);
  }

  lines.push('');
  lines.push(`Progress for ${pole}:`);
  lines.push(progressLine('Before', session.before_count, 3));
  lines.push(progressLine('Depth', session.depth_count, 1));
  lines.push(progressLine('Stumping', session.stumping_count, 3));
  lines.push(progressLine('Cement', session.compaction_count, 1));
  lines.push(progressLine('Housekeeping', session.housekeeping_count, 3));
  lines.push('');
  lines.push(`${session.total_photos} of ${session.required_photos} photos received`);

  return lines.join('\n');
}

// ============================================================================
// Send ACK
// ============================================================================

async function sendAckToGroup(
  groupJid: string,
  senderJid: string,
  message: string
): Promise<void> {
  try {
    const response = await fetch(`${WA_BRIDGE_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_jid: groupJid, mention_jid: senderJid, message }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      logger.error('Bridge ACK send failed', { status: response.status, groupJid });
    }
  } catch (err) {
    logger.error('Error sending ACK', {
      error: err instanceof Error ? err.message : String(err),
      groupJid,
    });
  }
}

// ============================================================================
// Public API
// ============================================================================

export async function processPoleInstallPhoto(
  photoData: PhotoData,
  photoBase64: string,
  groupInfo: GroupInfo
): Promise<void> {
  const sql = getDb();

  try {
    // 1. VLM classify
    const classification = await classifyPolePhoto(photoBase64);

    // 2. Find or create session
    const session = await findOrCreateSession(
      groupInfo.groupJid, photoData.senderJid, photoData.senderName,
      groupInfo.projectId, classification.pole_number
    );

    // 3. Cross-ref pole
    let poleExistsInSow: boolean | null = null;
    let poleVerified = false;
    const effectivePole = classification.pole_number || session.pole_number;

    if (effectivePole) {
      const ref = await crossRefPole(effectivePole, groupInfo.projectId);
      poleExistsInSow = ref.exists;
      poleVerified = ref.exists;
    }

    // 4. Increment session
    const updated = await incrementStepCount(
      session.id, classification.step, classification.pole_number,
      poleVerified, poleExistsInSow
    );

    // 5. Update photo record
    await sql`
      UPDATE field_ops_wa_photos SET
        pole_install_session_id = ${session.id}::uuid,
        classified_step = ${classification.step},
        vlm_processed = TRUE,
        vlm_valid = ${classification.quality_ok},
        vlm_confidence = ${classification.confidence},
        vlm_feedback = ${classification.feedback},
        vlm_processed_at = NOW()
      WHERE id = ${photoData.photoId}::uuid
    `;

    // 6. Check completion
    const complete = isSessionComplete(updated);
    if (complete) {
      await markComplete(updated.id);
      // Fire-and-forget: link to construction QA review
      linkSessionToQaReview(updated.id).catch((err) =>
        logger.error('QA review link failed', {
          error: err instanceof Error ? err.message : String(err),
          sessionId: updated.id,
        })
      );
    }

    // 7. Build and send ACK
    const ackMessage = buildAckMessage(
      classification.step, updated, classification.quality_ok,
      classification.issues, classification.feedback, poleExistsInSow
    );
    await sendAckToGroup(groupInfo.groupJid, photoData.senderJid, ackMessage);

    logger.info('Pole install photo processed', {
      sessionId: session.id, step: classification.step,
      totalPhotos: updated.total_photos, complete,
    });
  } catch (err) {
    logger.error('processPoleInstallPhoto failed', {
      error: err instanceof Error ? err.message : String(err),
      photoId: photoData.photoId, groupJid: groupInfo.groupJid,
    });
  }
}

export async function handlePoleTextMessage(
  messageText: string,
  senderJid: string,
  senderName: string,
  groupJid: string,
  projectId: string,
  _projectName: string
): Promise<void> {
  const poleNumber = extractPoleFromText(messageText);
  if (!poleNumber) return;

  try {
    const session = await findOrCreateSession(
      groupJid, senderJid, senderName, projectId, poleNumber
    );

    if (!session.pole_number) {
      const sql = getDb();
      await sql`
        UPDATE pole_install_sessions
        SET pole_number = ${poleNumber}, updated_at = NOW()
        WHERE id = ${session.id}::uuid
      `;
    }

    const ref = await crossRefPole(poleNumber, projectId);
    const sowTag = ref.exists ? '✓ Found in SOW' : '✗ Not in SOW';
    await sendAckToGroup(groupJid, senderJid, `📍 Pole ${poleNumber} registered ${sowTag} — send photos now`);

    logger.info('Pole text declaration processed', {
      poleNumber, sessionId: session.id, existsInSow: ref.exists,
    });
  } catch (err) {
    logger.error('handlePoleTextMessage failed', {
      error: err instanceof Error ? err.message : String(err),
      poleNumber, groupJid,
    });
  }
}
