/**
 * THE DESTRUCTIVE REGION. Nothing else in the pipeline destroys anything.
 *
 * This module exists to make one invariant structural rather than remembered:
 *
 *   Between the first storage deletion and the purge transaction, the ONLY
 *   thing that may fail is the deletion of one specific storage object.
 *
 * Three rounds of review found three separate violations of that rule — a
 * wrong cast, a configuration check, and a counter guard — each discovered
 * only after files had been destroyed and each fixed as if it were the last
 * one. They were instances of a class: the item path did work between the
 * first delete and the commit, so every statement in between was a candidate.
 *
 * The containment is the import list of this file. It takes a plain array of
 * already-validated storage paths and returns counts; it cannot reach the
 * database, the repositories, the settings, or the item, because it does not
 * import them. Adding a call that can throw for a run-level or item-level
 * reason requires adding an import here, which
 * `__tests__/storageDeletionRunner.test.ts` fails on.
 *
 * Planning (which objects, is the incident still purgeable, is the accounting
 * consistent) happens BEFORE this runs, in `retentionItemProcessor.planItemPurge`.
 * Committing happens after, in one transaction.
 */
import { deleteIncidentStorageObject } from './storageDeletion';

export interface StorageDeletionOutcomeCounts {
  /** Objects this attempt actually removed from storage. */
  deleted: number;
  /** Objects a previous attempt had already removed. Not deletions this run performed. */
  alreadyAbsent: number;
}

/**
 * Deletes every planned object, in order.
 *
 * Throws only what `deleteIncidentStorageObject` throws — a failure to delete
 * one object — which the caller treats as "stop this item, keep its database
 * evidence, retry later". The already-deleted objects stay deleted; a retry
 * re-plans and finds them `already_absent`.
 */
export async function deletePlannedObjects(
  storagePaths: readonly string[],
): Promise<StorageDeletionOutcomeCounts> {
  const counts: StorageDeletionOutcomeCounts = { deleted: 0, alreadyAbsent: 0 };
  for (const storagePath of storagePaths) {
    const outcome = await deleteIncidentStorageObject(storagePath);
    if (outcome === 'deleted') counts.deleted += 1;
    else counts.alreadyAbsent += 1;
  }
  return counts;
}
