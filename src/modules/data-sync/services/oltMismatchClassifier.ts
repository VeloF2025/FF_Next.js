/**
 * OLT mismatch classifier — the single source of truth for how a 1Map lookup
 * result is turned into a mismatch verdict (mismatch_type + fix_status +
 * investigation_context).
 *
 * Both queue-processing paths delegate here so classification can never drift:
 *  - the inline first-batch processor in
 *    `pages/api/system/olt-report/process-lookup-queue.ts`
 *  - the continuation service `oltQueueProcessorService.ts`
 *
 * The record-level functions are pure (no I/O) and unit-tested per branch; the
 * one DB helper (`findCrossDrOwner`) is the sole exception and is kept here so
 * the cross-DR owner lookup can't drift either.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { PoolClient } from 'pg';
import type { OneMapRecord } from '@/modules/system/services/oneMapApiService';

/** 1Map prop status that marks a home installation as actually installed. */
export const INSTALLED_STATUS = 'Home Installation: Installed';

/** A UPS serial (1Map `br_ser`) starts with GU18; an ONT does not. */
function isUpsSerial(serial: string | null): boolean {
  return !!serial && serial.toUpperCase().startsWith('GU18');
}

/**
 * Verdict for a DR that returned NO records from 1Map. `otherDr` is the result
 * of the reverse serial lookup (`findSerialOnOtherDr`): present when the OES
 * serial is installed under a different real drop.
 */
export interface EmptyClassification {
  /** Value written to `olt_onemap_lookup_queue.mismatch_type`. */
  mismatchType: 'note2_serial_other_dr' | 'note2_not_on_1map';
  /** Value written to `olt_mismatch_records.fix_status`. */
  fixStatus: 'serial_other_dr' | 'not_found';
  /** Pre-built `serial_on_other_dr` context, or null for a genuine not_found. */
  investigationContext: string | null;
}

/**
 * Classify a DR absent from 1Map: serial_other_dr when its ONT is registered
 * under a different drop, otherwise not_found. Pure.
 */
export function classifyEmptyRecords(
  otherDr: { context: string } | null,
): EmptyClassification {
  return otherDr
    ? {
        mismatchType: 'note2_serial_other_dr',
        fixStatus: 'serial_other_dr',
        investigationContext: otherDr.context,
      }
    : {
        mismatchType: 'note2_not_on_1map',
        fixStatus: 'not_found',
        investigationContext: null,
      };
}

/** The verdict written to `olt_onemap_lookup_queue.mismatch_type` for a DR with records. */
export type RecordMismatchType =
  | 'match'
  | 'note4_ups_swap'
  | 'note4_wrong_serial'
  | 'note4_empty_barcode'
  | 'status_mismatch';

/** Verdict for a DR that returned one or more records from 1Map. */
export interface RecordClassification {
  mismatchType: RecordMismatchType;
  /** olt_mismatch_records.fix_status before cross-DR finalisation: pending | needs_investigation */
  fixStatus: string;
  hasUpsSwap: boolean;
  /** wrong_onemap_serial to record on insert (null for status_mismatch). */
  wrongOneMapSerial: string | null;
  /** status_mismatch context, or null. cross-DR finalisation may replace it. */
  investigationContext: string | null;
  /** Record used to populate queue.onemap_serial / onemap_ups_serial. */
  bestRecord: OneMapRecord;
  firstWrongSerial: string | null;
  firstUpsSerial: string | null;
  correctCount: number;
  emptyCount: number;
  wrongCount: number;
  swapCount: number;
  totalPropRecords: number;
}

/**
 * Classify a DR's 1Map records against its OES serial. Pure — operates only on
 * the records array. Caller must guarantee `records.length > 0` (the empty case
 * is handled by `classifyEmptyRecords`).
 *
 * A DR can carry multiple prop_ids (sign-up, installation, etc.). We count how
 * many records have the correct serial / no serial / a wrong serial / a UPS↔ONT
 * swap, then derive the verdict. When the serial is correct but no prop has the
 * installed status, it is a `status_mismatch` (cannot auto-fix until 1Map
 * advances the prop) routed straight to Investigate.
 */
export function classifyOltRecords(
  rawOesSerial: string,
  records: OneMapRecord[],
): RecordClassification {
  const oesSerial = rawOesSerial.trim().toUpperCase();
  let correctCount = 0;
  let emptyCount = 0;
  let wrongCount = 0;
  let swapCount = 0;
  let firstWrongSerial: string | null = null;
  let firstUpsSerial: string | null = null;

  for (const rec of records) {
    const ont = rec.ph_ont?.trim().toUpperCase() || null;
    const ups = rec.br_ser?.trim().toUpperCase() || null;
    if (ont === oesSerial) {
      correctCount++;
    } else if (!ont) {
      emptyCount++;
    } else if (ups === oesSerial && isUpsSerial(ont)) {
      swapCount++;
      if (!firstWrongSerial) {
        firstWrongSerial = rec.ph_ont;
        firstUpsSerial = rec.br_ser;
      }
    } else {
      wrongCount++;
      if (!firstWrongSerial) {
        firstWrongSerial = rec.ph_ont;
        firstUpsSerial = rec.br_ser;
      }
    }
  }

  let mismatchType: RecordMismatchType = 'match';
  let fixStatus = 'pending';
  let hasUpsSwap = false;
  if (swapCount > 0) {
    mismatchType = 'note4_ups_swap';
    hasUpsSwap = true;
  } else if (wrongCount > 0) {
    mismatchType = 'note4_wrong_serial';
  } else if (emptyCount > 0 && correctCount === 0) {
    mismatchType = 'note4_empty_barcode';
  }

  // Status mismatch: the serial is correct but NO prop_id with that serial has
  // "Installed" status. Flag the closest correct-serial record and route to
  // Investigate — it cannot be auto-fixed until 1Map advances the prop status.
  let investigationContext: string | null = null;
  if (mismatchType === 'match' && correctCount > 0) {
    const correctSerialRecords = records.filter(
      (r) => r.ph_ont?.trim().toUpperCase() === oesSerial,
    );
    const hasInstalledRecord = correctSerialRecords.some((r) => r.status === INSTALLED_STATUS);
    if (!hasInstalledRecord) {
      const wrongStatusRecord = correctSerialRecords[0];
      if (wrongStatusRecord) {
        mismatchType = 'status_mismatch';
        fixStatus = 'needs_investigation';
        investigationContext = JSON.stringify({
          reason: 'status_mismatch',
          propId: wrongStatusRecord.prop_id,
          currentStatus: wrongStatusRecord.status || 'unknown',
          expectedStatus: INSTALLED_STATUS,
          message: `No prop record with correct serial has "${INSTALLED_STATUS}" status. Best match: "${wrongStatusRecord.status || 'unknown'}"`,
        });
      }
    }
  }

  const bestRecord = (records.find((r) => r.ph_ont) || records[0])!;
  const wrongOneMapSerial =
    mismatchType === 'status_mismatch' ? null : firstWrongSerial || bestRecord.ph_ont;

  return {
    mismatchType,
    fixStatus,
    hasUpsSwap,
    wrongOneMapSerial,
    investigationContext,
    bestRecord,
    firstWrongSerial,
    firstUpsSerial,
    correctCount,
    emptyCount,
    wrongCount,
    swapCount,
    totalPropRecords: records.length,
  };
}

/** OES-side owner of a serial found on a different DR than the one searched. */
export interface CrossDrOwner {
  drop_number: string;
  serial_number: string;
  team: string | null;
  status: string | null;
}

/**
 * Look up which OES drop a wrong/swapped serial actually belongs to. The one
 * impure helper in this module — shared so the cross-DR lookup can't drift.
 */
export async function findCrossDrOwner(
  client: PoolClient,
  wrongSerial: string,
): Promise<CrossDrOwner | null> {
  const ownerLookup = await client.query(
    `SELECT drop_number, serial_number, team, status
     FROM oes_activations
     WHERE UPPER(serial_number) = $1
     ORDER BY created_at DESC LIMIT 1`,
    [wrongSerial.toUpperCase()],
  );
  return ownerLookup.rows.length > 0 ? (ownerLookup.rows[0] as CrossDrOwner) : null;
}

/**
 * Finalise a wrong/swap verdict against the resolved owner. When the serial
 * belongs to a *different* drop it is a `cross_dr_conflict` — flip to
 * needs_investigation and build the context. Returns null (no override) when
 * the owner is unknown or sits on the same drop. Pure.
 */
export function buildCrossDrContext(
  cls: RecordClassification,
  owner: CrossDrOwner | null,
  dropNumber: string,
): { fixStatus: string; investigationContext: string } | null {
  if (!owner || owner.drop_number === dropNumber) return null;
  return {
    fixStatus: 'needs_investigation',
    investigationContext: JSON.stringify({
      reason: 'cross_dr_conflict',
      wrongSerial: cls.firstWrongSerial,
      wrongUps: cls.firstUpsSerial,
      belongsToDr: owner.drop_number,
      belongsToTeam: owner.team,
      belongsToStatus: owner.status,
      totalPropRecords: cls.totalPropRecords,
      correctRecords: cls.correctCount,
      wrongRecords: cls.wrongCount,
      swappedRecords: cls.swapCount,
      message: `ONT ${cls.firstWrongSerial} on 1Map belongs to ${owner.drop_number} (${owner.team}). Cannot auto-fix without losing equipment tracking.`,
    }),
  };
}
