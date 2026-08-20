import { query, type SqlRow } from '@/lib/db-pool';
import { ENROLLED_TAG, READY_TAG } from './types';

export interface StaleHandshakeRow {
  id: string;
  ghlContactId: string | null;
}

interface StaleRow extends SqlRow {
  id: string;
  ghl_contact_id: string | null;
}

export interface StaleHandshakeSweepDependencies {
  ghl: { removeTags(contactId: string, tags: readonly string[]): Promise<void> };
  exports: {
    expireStalledHandshakes(cutoff: Date, now: Date): Promise<StaleHandshakeRow[]>;
    markHandshakeTagsLeft(id: string): Promise<void>;
  };
}

// `ambiguous` and `ack_cleanup_pending` park a row whose GHL mutation may or may not
// have landed, so neither is re-claimed — a blind retry risks a duplicate customer
// message. Correct for the handshake, fatal for the run: finishDate reads both as
// incomplete, so the date never reaches `complete`, stays due forever, and trips the
// 7-day gap guard that blocks every date. Live 2026-08-15 to 08-20: six days, nothing
// exported. Past this window the handshake is over, so resolve it terminally, freeing
// the one-phone-inflight index for any later install. A row whose own retry is still
// scheduled is left alone — nextRetryAt caps nothing above a GHL Retry-After header.
// That guard only ever bites on `ack_cleanup_pending`: every `ambiguous` transition in
// contactExport.ts leaves next_attempt_at NULL.
export async function expireStalledHandshakes(cutoff: Date, now: Date): Promise<StaleHandshakeRow[]> {
  const rows = await query<StaleRow>(`
    UPDATE velocity_review_exports
    SET state = 'permanent_failure',
        error_code = COALESCE(error_code || ':', '') || 'handshake_expired',
        next_attempt_at = NULL,
        completed_at = COALESCE(completed_at, NOW()),
        updated_at = NOW()
    WHERE state IN ('ambiguous', 'ack_cleanup_pending')
      AND updated_at < $1
      AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
    RETURNING id, ghl_contact_id
  `, [cutoff, now]);
  return rows.map((row) => ({ id: row.id, ghlContactId: row.ghl_contact_id }));
}

// Expiry is not enough on its own. `ack_cleanup_pending` exists solely to take
// ENROLLED_TAG off the contact, and an `ambiguous` row can leave READY_TAG behind the
// same way. Marking the row terminal without clearing the tag strands it on the contact
// forever, and UNIQUE (dr_number, phone_e164) is a pair — so the next install at that
// same number under a new DR reads the contact back, sees a transient tag, and parks
// itself `ambiguous` on `stale_transient_tag`. That customer is never greeted and the
// stall silently regenerates. Both tags are meant to live seconds; one still present a
// day later is stale whoever wrote it, and the run lock plus the one-phone-inflight
// index mean no live handshake can own it at this point.
export async function markHandshakeTagsLeft(id: string): Promise<void> {
  await query(`
    UPDATE velocity_review_exports
    SET error_code = COALESCE(error_code || ':', '') || 'tags_left', updated_at = NOW()
    WHERE id = $1
  `, [id]);
}

// Expire first, clear tags second: the deadlock fix must hold even when GHL is down.
// A failed removal is recorded on the row rather than retried — the row is terminal by
// then — and the contact heals anyway, because the next export for that number parks on
// the leftover tag and this sweep retries the removal when that row expires.
export async function sweepStalledHandshakes(
  cutoff: Date, now: Date, deps: StaleHandshakeSweepDependencies,
): Promise<number> {
  const expired = await deps.exports.expireStalledHandshakes(cutoff, now);
  // Two DR numbers at one address share a GHL contact, so remove once per contact and
  // reuse the outcome — every row on a contact whose removal failed gets the marker.
  const attempted = new Map<string, boolean>();
  for (const row of expired) {
    const contactId = row.ghlContactId;
    if (contactId === null) continue;
    let removed = attempted.get(contactId);
    if (removed === undefined) {
      removed = await deps.ghl.removeTags(contactId, [READY_TAG, ENROLLED_TAG])
        .then(() => true).catch(() => false);
      attempted.set(contactId, removed);
    }
    if (!removed) await deps.exports.markHandshakeTagsLeft(row.id);
  }
  return expired.length;
}
