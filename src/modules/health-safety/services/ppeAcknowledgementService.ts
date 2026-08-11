/**
 * PPE acknowledgement sheets — the signed indemnity a worker holds, and the
 * issuances it evidences.
 *
 * The paper form is one sheet per worker: an indemnity signed once at the top,
 * then issue lines signed as each item is drawn, returned to HSE when full. So a
 * worker accumulates sheets over time and exactly one is `open` — enforced by a
 * partial unique index in migration 489, not by this module. `openSheetFor`
 * therefore returns "the" current sheet without ambiguity, and `startSheet`
 * closes the previous one in the same transaction rather than racing it.
 *
 * A sheet counts as EVIDENCED when it carries the proof, which is either an
 * uploaded scan of the paper form or an in-app indemnity signature. A row with
 * neither is a placeholder, and issuances against it are reported as
 * unevidenced — a warning, never a block.
 */

import { query, queryOne, transaction } from '@/lib/db-pool';

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * The index that refuses a second open sheet.
 *
 * Matched BY NAME, not just by SQLSTATE. Today this table has only two unique
 * constraints — its primary key and this index — so any 23505 escaping
 * startSheet is necessarily this one. That is a fact about the schema right
 * now, not a property of the code: adding another unique constraint later
 * would silently start reporting a genuine bug as a benign "someone else got
 * there first". Naming it keeps the translation exact.
 */
const ONE_OPEN_SHEET_INDEX = 'hs_ppe_ack_one_open_per_worker';

/**
 * Raised when two requests race to open a sheet for the same worker.
 *
 * The partial unique index genuinely prevents the second row — it does not
 * merely narrow the window — so the loser gets a constraint violation. That is
 * a conflict, not a server fault, and must not surface as a 500.
 */
export class PpeAcknowledgementConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PpeAcknowledgementConflict';
  }
}

export type WorkerRef = { staffId: string } | { teamMemberId: string };

export type AcknowledgementSheet = {
  id: string;
  staff_id: string | null;
  team_member_id: string | null;
  contractor_id: string | null;
  worker_name: string;
  project_id: string | null;
  sheet_date: string;
  status: 'open' | 'closed';
  signature_name: string | null;
  signed_at: string | null;
  notes: string | null;
  created_at: string;
  /** Attachments on the sheet — the scanned form. Never includes file_path. */
  attachment_count: number;
  /** True when the sheet carries proof: a scan, or an in-app signature. */
  is_evidenced: boolean;
};

export type NewSheet = {
  worker: WorkerRef;
  workerName: string;
  contractorId?: string | null;
  projectId?: string | null;
  sheetDate?: string | null;
  notes?: string | null;
  actorUserId: string;
};

/**
 * Selected everywhere a sheet is returned.
 *
 * `is_evidenced` is derived rather than stored: it is a function of whether a
 * scan exists, and a stored copy would drift the moment an attachment is
 * deleted. Attachment ids are not exposed here — the client lists them through
 * the attachments API, which is the only thing allowed to reach the bytes.
 */
const SHEET_COLUMNS = `
  a.id, a.staff_id, a.team_member_id, a.contractor_id, a.worker_name,
  a.project_id, a.sheet_date::text AS sheet_date, a.status,
  a.signature_name, a.signed_at, a.notes, a.created_at,
  COALESCE(att.n, 0)::int AS attachment_count,
  (COALESCE(att.n, 0) > 0 OR a.signature_name IS NOT NULL) AS is_evidenced
`;

/**
 * Counting in a lateral rather than a GROUP BY: the sheet columns would
 * otherwise all have to appear in the grouping, and a later added column that
 * someone forgets to group by silently collapses rows.
 */
const SHEET_FROM = `
  FROM hs_ppe_acknowledgements a
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS n
      FROM hs_attachments att
     WHERE att.ppe_acknowledgement_id = a.id
  ) att ON TRUE
`;

/** `staff_id = $1` or `team_member_id = $1`, chosen by which ref was given. */
function workerClause(worker: WorkerRef): { column: string; id: string } {
  return 'staffId' in worker
    ? { column: 'a.staff_id', id: worker.staffId }
    : { column: 'a.team_member_id', id: worker.teamMemberId };
}

/** The worker's current sheet, or null if they have never had one. */
export async function openSheetFor(worker: WorkerRef): Promise<AcknowledgementSheet | null> {
  const { column, id } = workerClause(worker);
  return queryOne<AcknowledgementSheet>(
    `SELECT ${SHEET_COLUMNS} ${SHEET_FROM}
      WHERE ${column} = $1 AND a.status = 'open'`,
    [id]
  );
}

/** Every sheet the worker has held, newest first. */
export async function listSheetsFor(worker: WorkerRef): Promise<AcknowledgementSheet[]> {
  const { column, id } = workerClause(worker);
  return query<AcknowledgementSheet>(
    `SELECT ${SHEET_COLUMNS} ${SHEET_FROM}
      WHERE ${column} = $1
      ORDER BY a.status = 'open' DESC, a.sheet_date DESC, a.created_at DESC`,
    [id]
  );
}

export async function getSheet(sheetId: string): Promise<AcknowledgementSheet | null> {
  return queryOne<AcknowledgementSheet>(
    `SELECT ${SHEET_COLUMNS} ${SHEET_FROM} WHERE a.id = $1`,
    [sheetId]
  );
}

/**
 * Start a new sheet, closing the worker's previous one.
 *
 * Both statements run in one transaction because the partial unique index
 * permits only one open sheet: closing and inserting separately leaves a window
 * where a concurrent request sees no open sheet and opens a second, and the
 * index would then reject one of them at random.
 */
export async function startSheet(sheet: NewSheet): Promise<AcknowledgementSheet> {
  const isStaff = 'staffId' in sheet.worker;
  const workerId = isStaff
    ? (sheet.worker as { staffId: string }).staffId
    : (sheet.worker as { teamMemberId: string }).teamMemberId;

  const created = await runStartSheet(async (txn) => {
    await txn.query(
      `UPDATE hs_ppe_acknowledgements
          SET status = 'closed', updated_at = NOW()
        WHERE ${isStaff ? 'staff_id' : 'team_member_id'} = $1
          AND status = 'open'`,
      [workerId]
    );

    const rows = await txn.query<{ id: string }>(
      `INSERT INTO hs_ppe_acknowledgements
         (${isStaff ? 'staff_id' : 'team_member_id'}, worker_name, contractor_id,
          project_id, sheet_date, status, notes, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), 'open', $6, $7)
       RETURNING id`,
      [
        workerId,
        sheet.workerName,
        sheet.contractorId ?? null,
        sheet.projectId ?? null,
        sheet.sheetDate ?? null,
        sheet.notes ?? null,
        sheet.actorUserId,
      ]
    );
    return rows[0];
  });

  if (!created) throw new Error('PPE acknowledgement insert returned no row');

  const full = await getSheet(created.id);
  if (!full) throw new Error('PPE acknowledgement disappeared immediately after insert');
  return full;
}

/**
 * Runs the start-sheet transaction, translating the index's unique violation.
 *
 * Split out so the translation sits on the transaction boundary rather than
 * being repeated at each call site.
 */
async function runStartSheet<T>(
  work: (txn: Parameters<Parameters<typeof transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  try {
    return await transaction(work);
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === UNIQUE_VIOLATION && pg.constraint === ONE_OPEN_SHEET_INDEX) {
      throw new PpeAcknowledgementConflict(
        'Another sheet was opened for this worker at the same time. Reload and try again.'
      );
    }
    throw error;
  }
}

/** Close a sheet — the paper one is full, or has been returned to HSE. */
export async function closeSheet(sheetId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE hs_ppe_acknowledgements
        SET status = 'closed', updated_at = NOW()
      WHERE id = $1 AND status = 'open'
      RETURNING id`,
    [sheetId]
  );
  return rows.length > 0;
}

/**
 * Issuances whose worker has no evidenced sheet — and could have one.
 *
 * Reported, never enforced. The count is what makes "we issue PPE without a
 * signed indemnity" visible; blocking the issue instead would push the storeman
 * back to paper, which is the state this register is trying to leave.
 *
 * **Name-only issuances are excluded, deliberately.** `hs_ppe_issuance` permits
 * an issue with NEITHER staff_id nor team_member_id — its constraint is
 * `at_most_one_worker`, and migration 453 records that field crews routinely
 * include workers in neither table. Such a row can never match a sheet, so
 * counting it would (a) inflate this number permanently and (b) tell the user to
 * "upload the signed sheet" for a row that `PPEAcknowledgementPanel` correctly
 * refuses to offer a sheet for. The count must only include rows somebody can
 * actually act on, or the banner is an instruction that cannot be followed.
 *
 * Those rows are not evidenced either — they are un-evidenceable, which is a
 * different problem (the worker is not registered) and needs its own surface
 * rather than being folded in here.
 */
/**
 * The exact SQL behind `countUnevidencedIssuances`, exported so the migration
 * test can run IT against real Postgres rather than a paraphrase. Asserting on
 * the query text alone proves nothing about what the query returns — and the
 * name-only exclusion below is precisely the sort of thing a substring check
 * cannot verify.
 */
export const UNEVIDENCED_ISSUANCE_COUNT_SQL = `
  SELECT COUNT(*)::int AS n
    FROM hs_ppe_issuance i
   WHERE (i.staff_id IS NOT NULL OR i.team_member_id IS NOT NULL)
     AND NOT EXISTS (
           SELECT 1
             FROM hs_ppe_acknowledgements a
             LEFT JOIN LATERAL (
               SELECT COUNT(*) AS n
                 FROM hs_attachments att
                WHERE att.ppe_acknowledgement_id = a.id
             ) att ON TRUE
            WHERE (
                    (i.staff_id       IS NOT NULL AND a.staff_id       = i.staff_id)
                 OR (i.team_member_id IS NOT NULL AND a.team_member_id = i.team_member_id)
                  )
              AND (att.n > 0 OR a.signature_name IS NOT NULL)
         )
`;

export async function countUnevidencedIssuances(): Promise<number> {
  const row = await queryOne<{ n: number }>(UNEVIDENCED_ISSUANCE_COUNT_SQL);
  return row?.n ?? 0;
}
