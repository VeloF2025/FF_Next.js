import { cleanupLeaseUntil, processAcknowledgementCleanup } from './acknowledgementCleanup';
import type { ExportTransitionUpdates, VelocityReviewExport } from './exportRepository';
import { HighLevelRequestError, type HighLevelContact } from './ghlClient';
import { normalizeSaMobileMsisdn, toE164 } from './phone';
import { nextRetryAt } from './retry';
import { ENROLLED_TAG, READY_TAG, type ExportState } from './types';
import type {
  ExportProcessResult, ProcessableExport, ProcessorDependencies,
} from './dependencies';

// Seeing either tag already present on readback means someone or something else
// is mid-handshake, so the export parks as `ambiguous` rather than risking a
// second message. The literals live in types.ts — see the note there.
const POLL_INTERVAL_MS = 5_000;
const POLL_LIMIT_MS = 30_000;

function result(row: VelocityReviewExport, workflowAcknowledged = false,
  contactUpserted = false): ExportProcessResult {
  return { exportId: row.id, state: row.state, errorCode: row.errorCode,
    nextAttemptAt: row.nextAttemptAt, workflowAcknowledged, contactUpserted };
}

async function move(deps: ProcessorDependencies, row: VelocityReviewExport, next: ExportState,
  updates: ExportTransitionUpdates = {}): Promise<VelocityReviewExport> {
  const changed = await deps.exports.transitionExportState(row.id, row.state, next, updates);
  if (!changed) throw new Error('Velocity review export state changed concurrently');
  return changed;
}
async function failRequest(deps: ProcessorDependencies, row: VelocityReviewExport,
  error: unknown, code: string, contactUpserted = false): Promise<ExportProcessResult> {
  if (error instanceof HighLevelRequestError && error.ambiguousMutation) {
    return result(await move(deps, row, 'ambiguous', {
      errorCode: `${code}_ambiguous`, nextAttemptAt: null,
    }), false, contactUpserted);
  }
  if (error instanceof HighLevelRequestError && error.retryable) {
    const retryAt = nextRetryAt(deps.now(), row.attemptCount, error.retryAfterSeconds);
    if (retryAt) return result(await move(deps, row, 'retryable_failure', {
      errorCode: code, nextAttemptAt: retryAt,
    }), false, contactUpserted);
  }
  // A permanent_failure is terminal: claimNextExport only claims 'ready' and
  // 'retryable_failure', and the permanent UNIQUE (dr_number, phone_e164) means the pair
  // can never be re-exported. Record WHY, so a terminal row can be triaged from the
  // ledger alone. On 2026-08-03, 225 rows landed here as bare 'ghl_upsert_failed' and the
  // responsible HTTP status could not be recovered afterwards — the per-export status is
  // not logged anywhere else. Suffix convention matches rollback_478's 'prefix:detail'.
  return result(await move(deps, row, 'permanent_failure', {
    errorCode: error instanceof HighLevelRequestError && error.status !== null
      ? `${code}:${error.status}`
      : code,
    nextAttemptAt: null,
  }), false, contactUpserted);
}
function verifiedPhone(contact: HighLevelContact, expected: string): boolean {
  const normalized = normalizeSaMobileMsisdn(contact.phone);
  return normalized !== null && toE164(normalized) === expected;
}
export async function processOneExport(item: ProcessableExport,
  deps: ProcessorDependencies): Promise<ExportProcessResult> {
  let row = item.export;
  let consent: 'granted' | 'withdrawn';
  try {
    consent = await deps.consent.recordOneMapConsent({ msisdn: item.candidate.msisdn,
      drNumber: item.candidate.drNumber, consentEvidence: item.candidate.consentEvidence });
  } catch {
    const retryAt = nextRetryAt(deps.now(), row.attemptCount);
    const state = retryAt ? 'retryable_failure' : 'permanent_failure';
    return result(await move(deps, row, state, { errorCode: 'consent_verification_failed', nextAttemptAt: retryAt }));
  }
  if (consent === 'withdrawn') {
    return result(await move(deps, row, 'permanent_failure', { errorCode: 'consent_withdrawn' }));
  }
  let upserted: HighLevelContact;
  try {
    upserted = await deps.ghl.upsertContact({ phoneE164: row.phoneE164,
      firstName: item.candidate.firstName, lastName: item.candidate.lastName,
      drNumber: row.drNumber, eventDate: row.firstTargetDate, sources: row.sourceFlags,
      exportKey: row.exportKey, installContext: item.candidate.installContext });
  } catch (error) {
    return failRequest(deps, row, error, 'ghl_upsert_failed');
  }
  let current: HighLevelContact;
  try {
    current = await deps.ghl.getContact(upserted.id);
  } catch (error) {
    return failRequest(deps, row, error, 'ghl_readback_failed', true);
  }
  if (current.whatsappDndBlocked) {
    return result(await move(deps, row, 'permanent_failure', { ghlContactId: current.id,
      errorCode: 'ghl_whatsapp_dnd' }), false, true);
  }
  if (!verifiedPhone(current, row.phoneE164) || current.customFields[deps.exportKeyFieldId] !== row.exportKey) {
    return result(await move(deps, row, 'ambiguous', { ghlContactId: current.id,
      errorCode: 'contact_verification_failed' }), false, true);
  }
  const hasTransientTag = current.tags.includes(READY_TAG) || current.tags.includes(ENROLLED_TAG);
  if (hasTransientTag) {
    return result(await move(deps, row, 'ambiguous', {
      ghlContactId: current.id, errorCode: 'stale_transient_tag',
    }), false, true);
  }
  row = await move(deps, row, 'contact_upserted', { ghlContactId: current.id, upsertedAt: deps.now() });
  try {
    await deps.ghl.addTags(current.id, [READY_TAG]);
  } catch (error) {
    return failRequest(deps, row, error, 'tag_add', true);
  }
  row = await move(deps, row, 'trigger_requested', { triggerRequestedAt: deps.now() });
  for (let elapsed = 0; elapsed < POLL_LIMIT_MS; elapsed += POLL_INTERVAL_MS) {
    await deps.sleep(POLL_INTERVAL_MS);
    try {
      current = await deps.ghl.getContact(current.id);
    } catch {
      continue;
    }
    const acknowledged = current.customFields[deps.exportKeyFieldId] === row.exportKey
      && current.tags.includes(ENROLLED_TAG) && !current.tags.includes(READY_TAG);
    if (!acknowledged) continue;
    const acknowledgedAt = deps.now();
    row = await move(deps, row, 'ack_cleanup_pending', { workflowAcknowledgedAt: acknowledgedAt,
      nextAttemptAt: cleanupLeaseUntil(acknowledgedAt) });
    return { ...await processAcknowledgementCleanup(row, deps), contactUpserted: true };
  }
  return result(await move(deps, row, 'ambiguous', {
    errorCode: 'workflow_acknowledgement_timeout',
  }), false, true);
}
