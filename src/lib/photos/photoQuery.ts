/**
 * SQL over BOTH photo corpora, shared by /api/photos/search and /api/photos/manifest so
 * a search and its download return the same rows.
 *
 * The two corpora are not two views of one table:
 *   construction_qa_photos    ~90k  project_id is a real column; step/VLM verdict live here
 *   qfield_photo_validations  ~61k  project_id is NULL on EVERY row — the project is only
 *                                   recoverable from the key path, via qfield_projects
 *
 * Built with explicit $n parameters rather than tagged-template fragments: a conditional
 * sql`` fragment breaks both the webpack Neon shim and the @/lib/db-pool tag (see
 * CLAUDE.md), and this grammar is nothing but conditionals.
 *
 * BOTH branch builders share ONE params array, so `$n` numbering runs continuously
 * across the UNION. Give either branch its own array and the second branch's
 * placeholders silently bind to the first branch's values.
 */
import type { PhotoFilter } from './photoFilter';
import { WORKS_QA_SLOT_UNPIVOT, WORKS_QA_VLM_VALID } from './worksQaSource';

export type { PhotoFilter, PhotoRow, PhotoSource } from './photoFilter';
export { MAX_PAGE_SIZE, parseFilter, proxySourceForKey } from './photoFilter';

interface Clause {
  sql: string;
  params: unknown[];
}

/**
 * Escape LIKE wildcards in a user value.
 *
 * Without this, `project=%` matches every project and `project=_` matches any one-letter
 * name — so a filter could never be relied on to BOUND a manifest, which matters because
 * a manifest has no size cap. Backslash is Postgres's default LIKE escape and these are
 * bound parameters, so no ESCAPE clause is needed.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function push(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

/**
 * Resolve a project by UUID or by name. Returns a clause fragment, never interpolation.
 * Name matching is deliberately loose (ILIKE) — users say "Etwatwa", the row says
 * "Etwatwa"; QField calls the same place "FT_Etwatwa_POP_2".
 */
function projectClause(column: string, project: string, params: unknown[]): string {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(project);
  if (isUuid) return `${column} = ${push(params, project)}::uuid`;
  return `${column} IN (SELECT id FROM projects WHERE project_name ILIKE ${push(params, `%${escapeLike(project)}%`)})`;
}

/** construction_qa_photos, joined to its review for pole/zone/PON identity. */
function qaQuery(filter: PhotoFilter, params: unknown[]): Clause {
  const where: string[] = ['1=1'];

  if (filter.project) where.push(projectClause('p.project_id', filter.project, params));
  if (filter.type) where.push(`p.step_label ILIKE ${push(params, `%${escapeLike(filter.type)}%`)}`);
  if (filter.vlm === 'pass') where.push('p.vlm_valid IS TRUE');
  // IS NOT TRUE would sweep in the ~197 unscored rows as failures. A photo the VLM never
  // looked at is not a photo the VLM rejected.
  if (filter.vlm === 'fail') where.push('p.vlm_valid IS FALSE');
  if (filter.needsRetake !== undefined) {
    where.push(`p.needs_retake IS ${filter.needsRetake ? 'TRUE' : 'NOT TRUE'}`);
  }
  if (filter.pole) where.push(`r.extracted_pole_number ILIKE ${push(params, `%${escapeLike(filter.pole)}%`)}`);
  if (filter.zone !== undefined) where.push(`r.zone_no = ${push(params, filter.zone)}`);
  if (filter.pon !== undefined) where.push(`r.pon_no = ${push(params, filter.pon)}`);
  if (filter.from) where.push(`p.captured_at >= ${push(params, filter.from)}::timestamptz`);
  if (filter.to) where.push(`p.captured_at < ${push(params, filter.to)}::timestamptz`);

  return {
    sql: `
      SELECT p.id::text            AS photo_id,
             'qa'                  AS corpus,
             0                     AS corpus_rank,
             p.storage_key,
             p.filename,
             p.step_label,
             p.vlm_valid,
             p.needs_retake,
             p.captured_at,
             'captured'            AS date_basis,
             p.file_size_bytes,
             r.extracted_pole_number AS pole_number,
             r.zone_no,
             r.pon_no,
             proj.project_name
      FROM construction_qa_photos p
      LEFT JOIN construction_qa_reviews r ON r.id = p.review_id
      LEFT JOIN projects proj ON proj.id = p.project_id
      WHERE ${where.join(' AND ')}`,
    params,
  };
}

/**
 * qfield_photo_validations. The project association exists ONLY in the key path:
 * `projects/<qfieldcloud-uuid>/files/DCIM/...`. Filtering this corpus on its own
 * project_id column returns zero rows, always — every row is NULL.
 *
 * Its only timestamp is `validated_at`, the validation-run time, NOT capture time. It is
 * surfaced under `captured_at` for the union but tagged `date_basis='validated'` so no
 * caller can mistake one for the other.
 */
function qfieldQuery(filter: PhotoFilter, params: unknown[]): Clause {
  const where: string[] = ['1=1'];

  if (filter.project) where.push(projectClause('l.fibreflow_project_id', filter.project, params));
  if (filter.type) where.push(`q.work_type ILIKE ${push(params, `%${escapeLike(filter.type)}%`)}`);
  if (filter.needsRetake !== undefined) {
    where.push(`q.needs_retake IS ${filter.needsRetake ? 'TRUE' : 'NOT TRUE'}`);
  }
  if (filter.pole) where.push(`q.feature_id ILIKE ${push(params, `%${escapeLike(filter.pole)}%`)}`);
  if (filter.from) where.push(`q.validated_at >= ${push(params, filter.from)}::timestamptz`);
  if (filter.to) where.push(`q.validated_at < ${push(params, filter.to)}::timestamptz`);
  // Filters this corpus cannot answer must return NOTHING rather than be ignored.
  // zone/PON have no counterpart here at all; `vlm` has no boolean verdict column, and
  // substituting needs_retake for it would answer a question about the VLM's judgement
  // with a different fact — and `vlm='fail'` + `needsRetake=false` would compile to a
  // self-contradicting pair that is silently always empty.
  const unanswerable =
    filter.zone !== undefined || filter.pon !== undefined || filter.vlm !== undefined;
  if (unanswerable) where.push('FALSE');

  return {
    sql: `
      SELECT q.id::text        AS photo_id,
             'qfield'          AS corpus,
             3                 AS corpus_rank,
             q.photo_key       AS storage_key,
             NULL              AS filename,
             q.work_type       AS step_label,
             NULL::boolean     AS vlm_valid,
             q.needs_retake,
             q.validated_at    AS captured_at,
             'validated'       AS date_basis,
             NULL::bigint      AS file_size_bytes,
             q.feature_id      AS pole_number,
             NULL::integer     AS zone_no,
             NULL::integer     AS pon_no,
             proj.project_name
      FROM qfield_photo_validations q
      JOIN qfield_projects qp ON qp.qfield_project_id = split_part(q.photo_key, '/', 2)
      LEFT JOIN qfield_project_links l ON l.qfield_project_id = qp.id
      LEFT JOIN projects proj ON proj.id = l.fibreflow_project_id
      WHERE ${where.join(' AND ')}`,
    params,
  };
}

/**
 * pole_qa_photos, unpivoted from one-row-per-pole into one-row-per-photo.
 *
 * The richest corpus for reporting: step label, VLM verdict, pole label, zone and PON all
 * present. It records NO photo timestamp, so rows carry a NULL date, `date_basis` of
 * 'unknown', and are excluded from date filters entirely.
 */
function worksQaQuery(filter: PhotoFilter, params: unknown[]): Clause {
  const where: string[] = ['slot.storage_key IS NOT NULL'];

  if (filter.project) where.push(projectClause('w.project_id', filter.project, params));
  if (filter.type) where.push(`slot.slot_label ILIKE ${push(params, `%${escapeLike(filter.type)}%`)}`);
  if (filter.vlm === 'pass') where.push(`${WORKS_QA_VLM_VALID} IS TRUE`);
  if (filter.vlm === 'fail') where.push(`${WORKS_QA_VLM_VALID} IS FALSE`);
  if (filter.pole) where.push(`w.pole_label ILIKE ${push(params, `%${escapeLike(filter.pole)}%`)}`);
  if (filter.zone !== undefined) where.push(`w.zone_no = ${push(params, filter.zone)}`);
  if (filter.pon !== undefined) where.push(`w.pon_no = ${push(params, filter.pon)}`);
  // Neither a retake flag nor ANY photo timestamp exists on this corpus, so both filters
  // exclude it rather than answer with something else. `updated_at` is the pole row's
  // last-write time — shared by all 22 unpivoted photos and bumped by 20+ unrelated
  // paths, including merely marking a pole seen (recent-seen.ts). Filtering on it would
  // return a 2024 photo because someone opened the pole last week.
  if (filter.needsRetake !== undefined) where.push('FALSE');
  if (filter.from !== undefined || filter.to !== undefined) where.push('FALSE');

  return {
    sql: `
      SELECT w.id::text || ':' || slot.slot_key AS photo_id,
             'worksqa'         AS corpus,
             1                 AS corpus_rank,
             slot.storage_key,
             NULL              AS filename,
             slot.slot_label   AS step_label,
             ${WORKS_QA_VLM_VALID} AS vlm_valid,
             NULL::boolean     AS needs_retake,
             -- NULL, not updated_at: this corpus records no photo timestamp at all, and
             -- surfacing a row's last-write time as a capture time would float every
             -- works-QA photo to the top of "most recent" whenever anyone edited a pole.
             NULL::timestamptz AS captured_at,
             'unknown'         AS date_basis,
             NULL::bigint      AS file_size_bytes,
             w.pole_label      AS pole_number,
             w.zone_no,
             w.pon_no,
             proj.project_name
      FROM pole_qa_photos w${WORKS_QA_SLOT_UNPIVOT}
      LEFT JOIN projects proj ON proj.id = w.project_id
      WHERE ${where.join(' AND ')}`,
    params,
  };
}

function union(filter: PhotoFilter): Clause {
  const params: unknown[] = [];
  // Callers without `construction-qa.works-qa` never reach this branch (the routes 403 an
  // explicit source=worksqa), and a `both` search silently omits it rather than leaking.
  const withWorksQa = filter.includeWorksQa !== false;

  if (filter.source === 'qa') return qaQuery(filter, params);
  if (filter.source === 'qfield') return qfieldQuery(filter, params);
  if (filter.source === 'worksqa') return worksQaQuery(filter, params);

  const qa = qaQuery(filter, params);
  const qf = qfieldQuery(filter, params);
  if (!withWorksQa) return { sql: `${qa.sql} UNION ALL ${qf.sql}`, params };
  const wq = worksQaQuery(filter, params);
  // UNION ALL, then DISTINCT ON the key below: the ~102 construction-QA rows whose
  // storage_key starts with `projects/` are the same objects as rows in the QField
  // corpus, and a duplicate here becomes a photo downloaded twice.
  return { sql: `${qa.sql} UNION ALL ${qf.sql} UNION ALL ${wq.sql}`, params };
}

/**
 * `DISTINCT ON (storage_key)` keyed by how much each corpus knows about a photo:
 * construction-QA (0) > works-QA (1) > QField (3).
 *
 * Ordering the tiebreak by time instead would hand every duplicate to whichever row was
 * written last — and QField, the poorest of the three, always wins that race because its
 * timestamp is a validation run and validation postdates capture. QField carries no
 * step label, no zone, no PON and no file size; works-QA carries a step label AND a VLM
 * verdict. The richer row wins by rank, not by accident of clock.
 */
const DEDUPE = 'DISTINCT ON (storage_key)';
const DEDUPE_ORDER = 'ORDER BY storage_key, corpus_rank, captured_at DESC NULLS LAST';

/**
 * Rows for one page, newest first.
 *
 * The ORDER BY is doubled deliberately. DISTINCT ON dictates its own leading sort key,
 * so the inner ORDER BY exists only to pick which duplicate survives; without the OUTER
 * sort, "the 20 most recent depth photos" silently returns the 20 alphabetically-first.
 */
export function pageQuery(filter: PhotoFilter): Clause {
  const base = union(filter);
  const params = [...base.params];
  return {
    sql: `
      SELECT * FROM (
        SELECT ${DEDUPE} *
        FROM (${base.sql}) matched
        ${DEDUPE_ORDER}
      ) deduped
      ORDER BY captured_at DESC NULLS LAST, storage_key
      LIMIT ${push(params, filter.limit)} OFFSET ${push(params, filter.offset)}`,
    params,
  };
}

/**
 * Total matches and total bytes, ignoring limit/offset.
 *
 * `sized` is not decoration. qfield_photo_validations carries no file_size_bytes at all,
 * so summing it yields 0 for a 10,980-photo result — a caller that printed that as the
 * download size would tell the user a gigabyte-scale pull costs nothing. Callers must
 * report the unsized remainder rather than treat total_bytes as the whole answer.
 */
export function summaryQuery(filter: PhotoFilter): Clause {
  const base = union(filter);
  return {
    sql: `
      SELECT count(*)::int AS matched,
             count(file_size_bytes)::int AS sized,
             COALESCE(sum(file_size_bytes), 0)::bigint AS total_bytes
      FROM (SELECT ${DEDUPE} storage_key, file_size_bytes, captured_at, corpus_rank
            FROM (${base.sql}) m
            ${DEDUPE_ORDER}) deduped`,
    params: base.params,
  };
}

/** Every matching key, for building a download manifest. No limit — that is the point. */
export function allKeysQuery(filter: PhotoFilter): Clause {
  const base = union(filter);
  return {
    sql: `
      SELECT ${DEDUPE} storage_key, filename, step_label, file_size_bytes, captured_at, corpus_rank
      FROM (${base.sql}) matched
      ${DEDUPE_ORDER}`,
    params: base.params,
  };
}
