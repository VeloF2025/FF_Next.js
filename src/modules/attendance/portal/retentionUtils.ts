/**
 * POPIA retention + access-audit helpers for attendance selfies.
 *
 * Two responsibilities:
 *   1. Delete selfies older than the retention window (90 days by default)
 *      from VF Storage and clear the `selfie_(in|out)_url` columns on the
 *      associated `attendance_entries` rows. Required by POPIA s14 — the
 *      operator may not retain personal information for longer than needed.
 *   2. Record every admin view of a selfie in `attendance_selfie_access_log`.
 *      Required by POPIA s17 (record-keeping) and by FibreFlow internal
 *      policy — if HR pulls up a selfie during a dispute we want an audit
 *      row showing who looked and when.
 *
 * Deliberately split from the handler layer so the sweep logic is unit-
 * testable with mocked sql/storage and doesn't depend on Next.js req/res.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { VFStorageService } from '@/services/vfStorageAdapter';

export const DEFAULT_RETENTION_DAYS = 90;

// =============================================================================
// Access log
// =============================================================================

export type SelfieType = 'in' | 'out';

export interface LogSelfieAccessArgs {
  entryId: string;
  selfieType: SelfieType;
  viewedBy: string;            // users.id of the admin who viewed the selfie
  ipAddress?: string | null;
  /**
   * Short free-form context string stored verbatim. Caller-supplied values
   * are trimmed + length-capped; callers should prefer a stable enum-like
   * string (`'staff_detail'`, `'exception_review'`, `'correction_review'`,
   * `'retention_delete'`). Not enum-typed at the DB level because the list
   * will grow with each new admin surface.
   */
  context?: string | null;
}

/**
 * Insert one row in `attendance_selfie_access_log`. Best-effort: a failure
 * to write the audit row must NOT block the admin view it describes — but
 * we log loudly so ops sees the miss.
 */
export async function logSelfieAccess(args: LogSelfieAccessArgs): Promise<void> {
  const ctx = typeof args.context === 'string' ? args.context.slice(0, 32) : null;
  try {
    await sql`
      INSERT INTO attendance_selfie_access_log (
        entry_id, selfie_type, viewed_by, ip_address, context
      ) VALUES (
        ${args.entryId}, ${args.selfieType}, ${args.viewedBy},
        ${args.ipAddress ?? null}, ${ctx}
      )
    `;
  } catch (err) {
    log.error('[attendance-retention] logSelfieAccess INSERT failed', {
      entryId: args.entryId,
      selfieType: args.selfieType,
      viewedBy: args.viewedBy,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// =============================================================================
// Retention sweep
// =============================================================================

export interface SweepOptions {
  retentionDays?: number;
  /** When true, the function logs everything it would delete but does not
   *  call storage.deleteFile or mutate the DB. Intended for ops dry-runs
   *  before enabling the cron in production. */
  dryRun?: boolean;
  /** Optional cap so the cron never spends > N hours in a single run. */
  maxEntries?: number;
  /** Injection point for tests. */
  storage?: Pick<VFStorageService, 'deleteFile'>;
}

export interface SweepReport {
  entriesScanned: number;
  inSelfiesDeleted: number;
  outSelfiesDeleted: number;
  storageFailures: number;
  dbFailures: number;
  dryRun: boolean;
}

/**
 * Entries whose oldest timestamp (clock_in_at) is older than the cutoff AND
 * that still hold at least one selfie URL. We compute the cutoff server-side
 * to avoid any client/server clock drift.
 *
 * The storage delete happens BEFORE the DB update. If the storage delete
 * fails we keep the URL in the DB — a broken storage + nulled URL would be
 * worse (audit trail points at a missing file with no way to confirm the
 * delete actually happened).
 */
export async function sweepExpiredSelfies(opts: SweepOptions = {}): Promise<SweepReport> {
  const retentionDays = opts.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const maxEntries = opts.maxEntries ?? 1000;
  const dryRun = opts.dryRun ?? false;
  const storage = opts.storage ?? new VFStorageService();

  interface ExpiredRow extends Record<string, unknown> {
    id: string;
    staff_id: string;
    work_date: string;
    selfie_in_url: string | null;
    selfie_out_url: string | null;
  }

  const rows = await sql<ExpiredRow>`
    SELECT id, staff_id, work_date::text AS work_date, selfie_in_url, selfie_out_url
    FROM attendance_entries
    WHERE clock_in_at < NOW() - (${retentionDays}::text || ' days')::interval
      AND (selfie_in_url IS NOT NULL OR selfie_out_url IS NOT NULL)
    ORDER BY clock_in_at ASC
    LIMIT ${maxEntries}
  `;

  const report: SweepReport = {
    entriesScanned: rows.length,
    inSelfiesDeleted: 0,
    outSelfiesDeleted: 0,
    storageFailures: 0,
    dbFailures: 0,
    dryRun,
  };

  for (const row of rows) {
    const category = `${row.staff_id}/${row.work_date}`;

    if (row.selfie_in_url) {
      const ok = await deleteAndNullify({
        storage,
        entryId: row.id,
        category,
        filename: 'in.jpg',
        column: 'in',
        dryRun,
      });
      if (ok === 'deleted') report.inSelfiesDeleted++;
      else if (ok === 'storage_failed') report.storageFailures++;
      else if (ok === 'db_failed') report.dbFailures++;
    }

    if (row.selfie_out_url) {
      const ok = await deleteAndNullify({
        storage,
        entryId: row.id,
        category,
        filename: 'out.jpg',
        column: 'out',
        dryRun,
      });
      if (ok === 'deleted') report.outSelfiesDeleted++;
      else if (ok === 'storage_failed') report.storageFailures++;
      else if (ok === 'db_failed') report.dbFailures++;
    }
  }

  return report;
}

type DeleteResult = 'deleted' | 'storage_failed' | 'db_failed' | 'dry_run';

async function deleteAndNullify(args: {
  storage: Pick<VFStorageService, 'deleteFile'>;
  entryId: string;
  category: string;
  filename: string;
  column: 'in' | 'out';
  dryRun: boolean;
}): Promise<DeleteResult> {
  if (args.dryRun) {
    log.info('[attendance-retention] would delete selfie (dry-run)', {
      entryId: args.entryId,
      category: args.category,
      filename: args.filename,
    });
    return 'dry_run';
  }

  const storageOk = await args.storage.deleteFile('attendance', args.category, args.filename);
  if (!storageOk) {
    log.error('[attendance-retention] VF Storage delete failed', {
      entryId: args.entryId,
      category: args.category,
      filename: args.filename,
    });
    return 'storage_failed';
  }

  try {
    if (args.column === 'in') {
      await sql`
        UPDATE attendance_entries
        SET selfie_in_url = NULL, updated_at = NOW()
        WHERE id = ${args.entryId}
      `;
    } else {
      await sql`
        UPDATE attendance_entries
        SET selfie_out_url = NULL, updated_at = NOW()
        WHERE id = ${args.entryId}
      `;
    }
    log.info('[attendance-retention] selfie retention delete', {
      entryId: args.entryId,
      selfieType: args.column,
    });
    return 'deleted';
  } catch (err) {
    log.error('[attendance-retention] UPDATE after storage delete failed', {
      entryId: args.entryId,
      column: args.column,
      error: err instanceof Error ? err.message : String(err),
    });
    return 'db_failed';
  }
}
