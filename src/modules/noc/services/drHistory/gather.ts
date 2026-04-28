/**
 * Parallel-fetch DR/ONT facts from authoritative tables. Bounded queries
 * keep the total payload around 3 KB for the LLM call.
 */

import { query } from '../../utils/db';
import type {
  DrFacts,
  DrDrop,
  DrQaPhoto,
  DrOesActivation,
  DrSerialChange,
  DrOltMismatch,
  DrOnemapProp,
  DrPriorTicket,
  DrOfflineDevice,
} from './types';

export async function gatherDrFacts(
  drNumber: string,
  ontSerial: string | null,
  excludeTicketId: string | null,
): Promise<DrFacts> {
  const [
    dropRow,
    qaPhotos,
    oesRow,
    serialChanges,
    oltMismatch,
    onemapProps,
    priorTickets,
    offlineDevices,
  ] = await Promise.all([
    query<DrDrop>(
      `SELECT project_id, pole_number, installation_date, status, qc_status,
              ont_serial, mini_ups_serial
       FROM drops
       WHERE drop_number = $1
       LIMIT 1`,
      [drNumber],
    ),
    query<DrQaPhoto>(
      `SELECT review_date, user_name, completed, completed_photos,
              outstanding_photos, project
       FROM qa_photo_reviews
       WHERE drop_number = $1
       ORDER BY review_date DESC NULLS LAST
       LIMIT 5`,
      [drNumber],
    ),
    query<DrOesActivation>(
      `SELECT activation_date, activation_datetime, serial_number, team, status
       FROM oes_activations
       WHERE drop_number = $1
       ORDER BY activation_datetime DESC NULLS LAST, activation_date DESC NULLS LAST
       LIMIT 1`,
      [drNumber],
    ),
    query<DrSerialChange>(
      `SELECT change_type, old_value, new_value, change_source, change_reason,
              actor, detected_at
       FROM serial_change_history
       WHERE drop_number = $1
       ORDER BY detected_at DESC NULLS LAST
       LIMIT 10`,
      [drNumber],
    ),
    query<DrOltMismatch>(
      `SELECT fix_status, olt_serial, wrong_onemap_serial, fix_attempted_at,
              fix_result, has_ups_swap
       FROM olt_mismatch_records
       WHERE drop_number = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [drNumber],
    ),
    query<DrOnemapProp>(
      `SELECT property_id, status, pole_permission_status
       FROM onemap_properties
       WHERE drop_number = $1
       ORDER BY status NULLS LAST
       LIMIT 10`,
      [drNumber],
    ),
    query<DrPriorTicket>(
      `SELECT ticket_uid, title, status, ticket_category, created_at
       FROM maintenance_tickets
       WHERE (dr_number = $1 OR ($2::text IS NOT NULL AND ont_serial = $2))
         AND ($3::uuid IS NULL OR id <> $3)
       ORDER BY created_at DESC
       LIMIT 5`,
      [drNumber, ontSerial, excludeTicketId],
    ),
    query<DrOfflineDevice>(
      `SELECT serial_number, last_inform_date, days_since_last_inform,
              offline_bucket, last_down_reason
       FROM offline_devices
       WHERE drop_number = $1
       ORDER BY snapshot_timestamp DESC NULLS LAST, report_date DESC NULLS LAST
       LIMIT 3`,
      [drNumber],
    ),
  ]);

  return {
    drop_number: drNumber,
    ont_serial: ontSerial,
    drop: dropRow[0] ?? null,
    qa_photos: qaPhotos,
    oes_activation: oesRow[0] ?? null,
    serial_changes: serialChanges,
    olt_mismatch: oltMismatch[0] ?? null,
    onemap_props: onemapProps,
    prior_tickets: priorTickets,
    offline_devices: offlineDevices,
  };
}

/**
 * Returns true if any of the DR-history streams contain at least one row.
 * If everything is empty, summarisation is skipped.
 */
export function hasAnyHistory(facts: DrFacts): boolean {
  return (
    !!facts.drop ||
    facts.qa_photos.length > 0 ||
    !!facts.oes_activation ||
    facts.serial_changes.length > 0 ||
    !!facts.olt_mismatch ||
    facts.onemap_props.length > 0 ||
    facts.prior_tickets.length > 0 ||
    facts.offline_devices.length > 0
  );
}

/**
 * Truncate free-text fields that originate from external systems so a
 * malicious payload cannot smuggle a multi-line "ignore previous instructions"
 * fragment into the LLM user message. The cap is generous enough to preserve
 * useful context but tight enough that an attacker cannot fit a coherent
 * role-switching payload.
 */
const MAX_FREE_TEXT = 240;

function clip(value: string | null | undefined): string | null {
  if (value == null) return null;
  const flat = String(value).replace(/[\r\n]+/g, ' ').trim();
  return flat.length > MAX_FREE_TEXT
    ? `${flat.slice(0, MAX_FREE_TEXT)}…`
    : flat;
}

/**
 * Sanitize all free-text fields populated by users / external systems before
 * the facts payload is sent to the LLM.
 */
export function sanitizeFacts(facts: DrFacts): DrFacts {
  return {
    ...facts,
    olt_mismatch: facts.olt_mismatch
      ? { ...facts.olt_mismatch, fix_result: clip(facts.olt_mismatch.fix_result) }
      : null,
    serial_changes: facts.serial_changes.map((c) => ({
      ...c,
      change_reason: clip(c.change_reason),
      actor: clip(c.actor),
    })),
    prior_tickets: facts.prior_tickets.map((t) => ({
      ...t,
      title: clip(t.title),
    })),
    offline_devices: facts.offline_devices.map((d) => ({
      ...d,
      last_down_reason: clip(d.last_down_reason),
    })),
  };
}
