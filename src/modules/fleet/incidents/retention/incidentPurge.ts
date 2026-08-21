/**
 * The database half of a purge: every PR4-7 record that belongs to ONE Fleet
 * operational incident, deleted in dependency order inside one transaction.
 *
 * The statement list is exported because it IS the contract for what retention
 * can reach. Every statement is keyed on `incident_id` (or, for the bell
 * notifications, on this module's own `source_module` plus the incident id),
 * so the blast radius is one incident's programme-owned rows. Attendance,
 * GPS/telematics, H&S, and project/site/vehicle/staff master data are not in
 * this list and cannot be reached through it: the attendance CORRECTION LINK
 * is deleted, the `attendance_adjustments` row it points at is not.
 *
 * Nothing here touches another INCIDENT. An incident that a second incident
 * points at as its duplicate is not purgeable at all: clearing that pointer
 * would violate `fleet_operational_incidents_duplicate_link_check` (a
 * duplicate outcome requires a target), and rewriting the other incident's
 * OUTCOME to get around it would be editing a record whose own retention
 * period has not expired. Such incidents are excluded from candidacy instead,
 * and become eligible once the incident referencing them is itself purged.
 *
 * `tests/migrations/518_fleet_retention_purge.test.ts` executes this list
 * against a real Postgres, including under `SET ROLE fibreflow_user`, so the
 * privileges the application actually runs with are part of the test rather
 * than an assumption.
 */
import type { TxnClient } from '@/lib/db-pool';
import { purgeTransaction } from './retentionDb';

/**
 * Ordered child deletions. Order is dependency order, not preference: the
 * correction link references a driver submission, the submission references an
 * input request, and every one of them is `ON DELETE RESTRICT` against the
 * incident, so nothing here is optional or reorderable.
 */
export const PURGE_CHILD_STATEMENTS: readonly string[] = [
  `DELETE FROM fleet_incident_attendance_correction_links WHERE incident_id = $1::uuid`,
  `DELETE FROM fleet_incident_driver_submissions WHERE incident_id = $1::uuid`,
  `DELETE FROM fleet_incident_driver_input_requests WHERE incident_id = $1::uuid`,
  `DELETE FROM fleet_operational_incident_evidence WHERE incident_id = $1::uuid`,
  `DELETE FROM fleet_operational_incident_actions WHERE incident_id = $1::uuid`,
  `DELETE FROM fleet_operational_incident_observations WHERE incident_id = $1::uuid`,
  // The bell notifications this module produced. Scoped by source_module as
  // well as id so a coincidental id from another module is out of reach.
  //
  // source_id is UUID in production, NOT text: a ::text cast here parses
  // against a text-typed fixture and fails with 42883 (`operator does not
  // exist: uuid = text`) against the real column. That mattered more than a
  // wrong cast usually does — storage deletion runs BEFORE this transaction,
  // so the failure mode was destroyed attachments plus an aborted purge that
  // removed no rows at all.
  `DELETE FROM user_notifications WHERE source_module = 'fleet-incidents' AND source_id = $1::uuid`,
];

/**
 * The incident itself. `trg_fleet_incident_purge_guard` re-checks terminal
 * state and active holds here, inside the same transaction — a hold raised
 * mid-run makes this statement fail with 23514 rather than delete.
 */
export const PURGE_INCIDENT_STATEMENT =
  `DELETE FROM fleet_operational_incidents WHERE id = $1::uuid`;

/**
 * Clears the item's identity and marks it complete. Runs AFTER the incident
 * delete, which has already nulled `incident_id` through the FK's SET NULL —
 * this makes that explicit and stamps completion, which the table's CHECK only
 * permits once the identity is gone and every storage object is accounted for.
 */
export const PURGE_ITEM_COMPLETION_STATEMENT =
  `UPDATE fleet_operational_retention_items
      SET incident_id = NULL, stage = 'database_complete', completed_at = now(), updated_at = now()
    WHERE id = $1::uuid`;

/**
 * Deletes one incident's programme-owned records and completes its retention
 * item, atomically. A failure anywhere rolls the whole thing back, leaving the
 * item resumable with its evidence intact.
 *
 * Runs through `purgeTransaction`, so WHICH database role performs these
 * deletions is configuration (`retentionDb.ts`) rather than a hard-wired
 * import of the shared application pool.
 */
/**
 * A uuid that matches nothing. Every purge statement is keyed on an incident
 * id, so running them against this parses and plans the real SQL, exercises
 * the real privileges, and touches no row.
 */
const SENTINEL_ID = '00000000-0000-0000-0000-000000000000';

class PreflightRollback extends Error {}

/**
 * Proves, before the run deletes its first file, that the purge statements can
 * actually execute as the configured identity.
 *
 * This exists because of a specific failure class: a deterministic, RUN-WIDE
 * fault discovered per item, after storage deletion has already destroyed
 * attachments. A missing DELETE grant (42501), a wrong cast (42883), a renamed
 * column (42703) all behave that way — identically for every item, every
 * night, with files gone and rows intact each time.
 *
 * Running each statement against a sentinel id inside a transaction that is
 * always rolled back catches every one of them for the cost of one round trip.
 * It deliberately does NOT prove the trigger behaviour or the FK ordering —
 * no rows match, so nothing fires. It proves the statements are executable.
 */
export async function preflightPurgeStatements(): Promise<void> {
  try {
    await purgeTransaction(async (txn: TxnClient) => {
      for (const statement of PURGE_CHILD_STATEMENTS) {
        await txn.query(statement, [SENTINEL_ID]);
      }
      await txn.query(PURGE_INCIDENT_STATEMENT, [SENTINEL_ID]);
      await txn.query(PURGE_ITEM_COMPLETION_STATEMENT, [SENTINEL_ID]);
      throw new PreflightRollback('preflight');
    });
  } catch (error) {
    // The sentinel rollback is the success path; anything else is a real
    // problem with privileges, types, or the schema.
    if (!(error instanceof PreflightRollback)) throw error;
  }
}

export async function purgeIncidentRecords(params: { itemId: string; incidentId: string }): Promise<void> {
  await purgeTransaction(async (txn: TxnClient) => {
    for (const statement of PURGE_CHILD_STATEMENTS) {
      await txn.query(statement, [params.incidentId]);
    }
    await txn.query(PURGE_INCIDENT_STATEMENT, [params.incidentId]);
    await txn.query(PURGE_ITEM_COMPLETION_STATEMENT, [params.itemId]);
  });
}
