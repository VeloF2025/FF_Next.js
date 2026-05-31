/**
 * VLM correction provenance validation (issue #1862, Group D).
 *
 * Pure, dependency-free guard used by recordVlmCorrection to keep
 * vlm_corrections referentially sane at write time:
 *   - `source_table`, when set, must name a KNOWN source — a real table that
 *     corrections legitimately point at, OR a recognized VIRTUAL source. An
 *     unknown value (e.g. a typo, or a dropped table) is a FATAL provenance
 *     error: the historical `source_table='gallery'`-style breakage came from
 *     writing a name with no matching table, and the audit could not tell a
 *     dropped table from a virtual one.
 *   - A correction with a `source_table` but NEITHER `source_id` NOR `photo_url`
 *     has no way to reach its origin record — a WARNING (recorded but flagged),
 *     not fatal, because some live harvest paths legitimately lack a row id yet.
 *
 * Kept separate from vlmLearningService so it can be unit-tested without pulling
 * in the DB client.
 */

/**
 * Source tables corrections may reference. Six are physical tables; `gallery`
 * is a VIRTUAL source — gallery-curated few-shot examples have no physical row,
 * they are linked by `photo_url` (+ a parallel vlm_visual_photo_examples row).
 *
 * KEEP IN SYNC: add any new physical source table here. Derived from a live
 * `information_schema.tables` cross-check of distinct vlm_corrections.source_table
 * on 2026-05-31.
 */
export const KNOWN_VLM_SOURCE_TABLES = [
  'dr_photo_unified_reviews',
  'construction_qa_photos',
  'wa_photos',
  'eod_install_sheets',
  'fleet_check_records',
  'qfield_photo_validations',
  'gallery', // virtual — linked by photo_url, no physical table
] as const;

export type KnownVlmSourceTable = (typeof KNOWN_VLM_SOURCE_TABLES)[number];

export interface VlmCorrectionSourceInput {
  sourceTable?: string | null;
  sourceId?: string | null;
  photoUrl?: string | null;
}

export interface VlmSourceCheckResult {
  /** Non-null → caller MUST throw; provenance is unrecoverably wrong. */
  fatal: string | null;
  /** Non-null → caller should log.warn; recorded but provenance is incomplete. */
  warning: string | null;
}

function isNonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export function isKnownVlmSourceTable(table: string): table is KnownVlmSourceTable {
  return (KNOWN_VLM_SOURCE_TABLES as readonly string[]).includes(table);
}

/**
 * Validate a correction's provenance fields. Pure — performs no logging or I/O;
 * the caller decides what to do with `fatal` / `warning`.
 */
export function checkVlmCorrectionSource(input: VlmCorrectionSourceInput): VlmSourceCheckResult {
  const table = isNonEmpty(input.sourceTable) ? input.sourceTable!.trim() : null;
  const hasLinkage = isNonEmpty(input.sourceId) || isNonEmpty(input.photoUrl);

  if (table && !isKnownVlmSourceTable(table)) {
    return {
      fatal: `unknown source_table '${table}' — must be one of: ${KNOWN_VLM_SOURCE_TABLES.join(', ')}`,
      warning: null,
    };
  }

  if (table && !hasLinkage) {
    return {
      fatal: null,
      warning: `source_table '${table}' has neither source_id nor photo_url — provenance incomplete`,
    };
  }

  return { fatal: null, warning: null };
}
