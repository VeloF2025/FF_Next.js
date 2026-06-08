/**
 * OLT serial reverse-lookup.
 *
 * When a DR returns nothing from 1Map, check whether its OES serial is
 * registered on 1Map under a *different* real drop — distinguishing a genuine
 * `not_found` from `serial_other_dr` (the unit is installed, the drop linkage
 * is wrong). Shared by the queue processor, the queue endpoint, and the
 * re-examine backfill so the classification stays identical everywhere.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { PoolClient } from 'pg';
import { createLogger } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';

const log = createLogger('OltSerialReverseLookup');

/** Minimal shape the reverse lookup needs (a QueueItem satisfies it). */
export interface SerialLookupItem {
  drop_number: string;
  oes_serial: string;
}

/**
 * Returns the other drop the serial sits on (plus a ready-built
 * investigation_context), or null when the serial is also absent (genuine
 * not_found) or only found on the same DR.
 */
export async function findSerialOnOtherDr(
  client: PoolClient,
  item: SerialLookupItem
): Promise<{ foundOnDr: string; context: string } | null> {
  const oesSerial = item.oes_serial.trim().toUpperCase();
  if (!oesSerial) return null;

  let serialResult;
  try {
    serialResult = await oneMapApi.searchBySerial(item.oes_serial);
  } catch (err) {
    // Reverse lookup is best-effort; fall back to not_found on any failure,
    // but log it so we can tell "serial genuinely absent" from "lookup failed".
    log.warn('Reverse serial lookup failed; defaulting to not_found', {
      dropNumber: item.drop_number,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (!serialResult.success || serialResult.records.length === 0) return null;

  // Prefer a record on a different *real* DR than the one we searched.
  // 'no drop allocated' is a 1Map placeholder (the auto-detect cache JOIN
  // excludes it too) — a serial sitting on it is not a real other-DR case.
  const match = serialResult.records.find(
    (r) =>
      r.drp &&
      r.drp.trim().toLowerCase() !== 'no drop allocated' &&
      r.drp.toUpperCase() !== item.drop_number.toUpperCase()
  );
  if (!match || !match.drp) return null;

  // Enrich with OES-side team/status for the drop the serial actually sits on.
  let foundOnTeam: string | null = null;
  let foundOnStatus: string | null = match.status ?? null;
  const owner = await client.query(
    `SELECT team, status FROM oes_activations
     WHERE UPPER(drop_number) = $1 ORDER BY created_at DESC LIMIT 1`,
    [match.drp.toUpperCase()]
  );
  if (owner.rows.length > 0) {
    foundOnTeam = owner.rows[0].team ?? null;
    foundOnStatus = owner.rows[0].status ?? foundOnStatus;
  }

  const where = [foundOnTeam, foundOnStatus].filter(Boolean).join(', ');
  const context = JSON.stringify({
    reason: 'serial_on_other_dr',
    oesDr: item.drop_number,
    oesSerial,
    foundOnDr: match.drp,
    foundOnTeam,
    foundOnStatus,
    message: `${item.drop_number} is not on 1Map, but its ONT serial ${oesSerial} is registered under ${match.drp}${where ? ` (${where})` : ''}. Unit is installed — the OES drop number is wrong, not the serial.`,
  });

  return { foundOnDr: match.drp, context };
}

export interface OneMapStateSnapshot {
  /** match = 1Map now agrees with OES; the others are flavours of "not fixed". */
  state: 'match' | 'mismatch' | 'absent_serial_elsewhere' | 'absent_serial_missing' | 'unknown';
  /** True only when 1Map now matches the OES serial (a genuine fix). */
  changed: boolean;
  /** Factual one-liner for the resolution note / NOC comment. */
  summary: string;
}

/**
 * Live 1Map re-check at manual-resolve time: what does 1Map show *now* for this
 * DR + OES serial? Produces a factual one-line delta so the operator doesn't
 * have to describe the change by hand, and so a resolve that isn't backed by an
 * actual 1Map change is visible in the note.
 *
 * Advisory only — it never blocks a resolve. Best-effort: any 1Map failure
 * returns state 'unknown' with an explanatory summary; never throws.
 */
export async function describeCurrentOneMapState(
  dropNumber: string,
  oesSerial: string | null,
): Promise<OneMapStateSnapshot> {
  const serial = oesSerial?.trim().toUpperCase() ?? '';
  if (!serial) {
    return { state: 'unknown', changed: false, summary: 'no OES serial on record — 1Map not checked' };
  }

  try {
    const drResult = await oneMapApi.searchDR(dropNumber);
    if (!drResult.success) {
      return { state: 'unknown', changed: false, summary: `1Map check unavailable (${drResult.error || 'lookup failed'})` };
    }

    if (drResult.records.length > 0) {
      const matched = drResult.records.some((r) => r.ph_ont?.trim().toUpperCase() === serial);
      if (matched) {
        return { state: 'match', changed: true, summary: `${dropNumber} now on 1Map with ONT ${oesSerial} ✓ (matches OES)` };
      }
      const current = drResult.records.find((r) => r.ph_ont)?.ph_ont ?? 'none';
      return { state: 'mismatch', changed: false, summary: `${dropNumber} on 1Map with ONT ${current} — does not match OES ${oesSerial}` };
    }

    // DR absent from 1Map — locate where the serial currently sits.
    const serialResult = await oneMapApi.searchBySerial(serial);
    const elsewhere = serialResult.success
      ? serialResult.records.find(
          (r) =>
            r.drp &&
            r.drp.trim().toLowerCase() !== 'no drop allocated' &&
            r.drp.toUpperCase() !== dropNumber.toUpperCase(),
        )
      : undefined;
    if (elsewhere?.drp) {
      const status = elsewhere.status ? ` (${elsewhere.status})` : '';
      return {
        state: 'absent_serial_elsewhere',
        changed: false,
        summary: `${dropNumber} still absent from 1Map; ONT ${oesSerial} is registered under ${elsewhere.drp}${status}`,
      };
    }
    return { state: 'absent_serial_missing', changed: false, summary: `${dropNumber} absent from 1Map; ONT ${oesSerial} not found on 1Map` };
  } catch (err) {
    return { state: 'unknown', changed: false, summary: `1Map check unavailable (${err instanceof Error ? err.message : String(err)})` };
  }
}
