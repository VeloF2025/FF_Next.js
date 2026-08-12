/**
 * One filter grammar over BOTH photo corpora, shared by /api/photos/search and
 * /api/photos/manifest so a search and its download return the same rows.
 *
 * The two corpora are not two views of one table:
 *   construction_qa_photos    ~90k  project_id is a real column; step/VLM verdict live here
 *   qfield_photo_validations  ~61k  project_id is NULL on EVERY row — the project is only
 *                                   recoverable from the key path, via qfield_projects
 *
 * Built with explicit $n parameters rather than tagged-template fragments: a conditional
 * sql`` fragment breaks both the webpack Neon shim and the @/lib/db-pool tag (see
 * CLAUDE.md), and this grammar is nothing but conditionals.
 */

export type PhotoSource = 'qa' | 'qfield' | 'both';

export interface PhotoFilter {
  project?: string;
  source: PhotoSource;
  /** Matched against step_label / work_type, e.g. "depth" finds "Depth Photo". */
  type?: string;
  /** 'pass' | 'fail' — the VLM verdict. Manual review status is unpopulated, so it is not offered. */
  vlm?: 'pass' | 'fail';
  needsRetake?: boolean;
  pole?: string;
  zone?: number;
  pon?: number;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface PhotoRow {
  photo_id: string;
  corpus: 'qa' | 'qfield';
  storage_key: string;
  proxy_source: string;
  filename: string | null;
  step_label: string | null;
  vlm_valid: boolean | null;
  needs_retake: boolean | null;
  captured_at: string | null;
  file_size_bytes: string | null;
  pole_number: string | null;
  zone_no: number | null;
  pon_no: number | null;
  project_name: string | null;
}

/** Page size for browsing. NOT a download ceiling — manifests are deliberately uncapped. */
export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

/** Parse a request query into a filter, or explain what was wrong with it. */
export function parseFilter(query: Record<string, string | string[] | undefined>):
  | { filter: PhotoFilter }
  | { error: string } {
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const source = (one(query.source) ?? 'both') as PhotoSource;
  if (!['qa', 'qfield', 'both'].includes(source)) {
    return { error: `source must be qa, qfield or both — got "${source}"` };
  }

  const vlmRaw = one(query.vlm);
  if (vlmRaw !== undefined && vlmRaw !== 'pass' && vlmRaw !== 'fail') {
    return { error: `vlm must be pass or fail — got "${vlmRaw}"` };
  }

  const int = (name: string, raw: string | undefined): number | undefined | { error: string } => {
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n)) return { error: `${name} must be an integer — got "${raw}"` };
    return n;
  };
  const zone = int('zone', one(query.zone));
  if (zone && typeof zone === 'object') return zone;
  const pon = int('pon', one(query.pon));
  if (pon && typeof pon === 'object') return pon;

  for (const name of ['from', 'to'] as const) {
    const raw = one(query[name]);
    if (raw && Number.isNaN(Date.parse(raw))) {
      return { error: `${name} must be a date — got "${raw}"` };
    }
  }

  const limitRaw = Number(one(query.limit) ?? DEFAULT_PAGE_SIZE);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const offsetRaw = Number(one(query.offset) ?? 0);
  const offset = Number.isFinite(offsetRaw) ? Math.max(Math.trunc(offsetRaw), 0) : 0;

  const retakeRaw = one(query.needsRetake);

  return {
    filter: {
      project: one(query.project) || undefined,
      source,
      type: one(query.type) || undefined,
      vlm: vlmRaw,
      needsRetake: retakeRaw === undefined ? undefined : retakeRaw === 'true',
      pole: one(query.pole) || undefined,
      zone: zone as number | undefined,
      pon: pon as number | undefined,
      from: one(query.from) || undefined,
      to: one(query.to) || undefined,
      limit,
      offset,
    },
  };
}

/** Photo keys under `projects/` are MinIO objects; everything else is on local disk. */
export function proxySourceForKey(key: string): 'qfield' | 'local' {
  return key.startsWith('projects/') ? 'qfield' : 'local';
}

interface Clause {
  sql: string;
  params: unknown[];
}

/**
 * Escape LIKE wildcards in a user value.
 *
 * Without this, `project=%` matches every project and `project=_` matches any one-letter
 * name — so a filter could never be relied on to BOUND a manifest, which matters because
 * a manifest has no size cap.
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
  // IS NOT TRUE would sweep in the 197 unscored rows as failures. A photo the VLM never
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
             p.storage_key,
             p.filename,
             p.step_label,
             p.vlm_valid,
             p.needs_retake,
             p.captured_at,
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
 */
function qfieldQuery(filter: PhotoFilter, params: unknown[]): Clause {
  const where: string[] = ['1=1'];

  if (filter.project) where.push(projectClause('l.fibreflow_project_id', filter.project, params));
  if (filter.type) where.push(`q.work_type ILIKE ${push(params, `%${escapeLike(filter.type)}%`)}`);
  if (filter.vlm === 'pass') where.push('q.needs_retake IS NOT TRUE');
  if (filter.vlm === 'fail') where.push('q.needs_retake IS TRUE');
  if (filter.needsRetake !== undefined) {
    where.push(`q.needs_retake IS ${filter.needsRetake ? 'TRUE' : 'NOT TRUE'}`);
  }
  if (filter.pole) where.push(`q.feature_id ILIKE ${push(params, `%${escapeLike(filter.pole)}%`)}`);
  if (filter.from) where.push(`q.validated_at >= ${push(params, filter.from)}::timestamptz`);
  if (filter.to) where.push(`q.validated_at < ${push(params, filter.to)}::timestamptz`);
  // zone/PON have no counterpart on this corpus; asking for one must return nothing
  // rather than silently ignoring the filter and dumping the whole project.
  if (filter.zone !== undefined || filter.pon !== undefined) where.push('FALSE');

  return {
    sql: `
      SELECT q.id::text        AS photo_id,
             'qfield'          AS corpus,
             q.photo_key       AS storage_key,
             NULL              AS filename,
             q.work_type       AS step_label,
             NULL::boolean     AS vlm_valid,
             q.needs_retake,
             q.validated_at    AS captured_at,
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

function union(filter: PhotoFilter): Clause {
  const params: unknown[] = [];
  if (filter.source === 'qa') return qaQuery(filter, params);
  if (filter.source === 'qfield') return qfieldQuery(filter, params);
  const qa = qaQuery(filter, params);
  const qf = qfieldQuery(filter, params);
  // UNION ALL, then DISTINCT ON the key below: the ~106 construction-QA rows whose
  // storage_key starts with `projects/` are the same objects as rows in the QField
  // corpus, and a duplicate here becomes a photo downloaded twice.
  return { sql: `${qa.sql} UNION ALL ${qf.sql}`, params };
}

/**
 * Rows for one page, newest first.
 *
 * The ORDER BY is doubled deliberately. DISTINCT ON dictates its own leading sort key,
 * so the inner ORDER BY is alphabetical-by-key and exists only to pick which duplicate
 * survives; without the OUTER sort, "the 20 most recent depth photos" silently returns
 * the 20 alphabetically-first ones.
 */
export function pageQuery(filter: PhotoFilter): Clause {
  const base = union(filter);
  const params = [...base.params];
  return {
    sql: `
      SELECT * FROM (
        SELECT DISTINCT ON (storage_key) *
        FROM (${base.sql}) matched
        ORDER BY storage_key, captured_at DESC NULLS LAST
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
      FROM (SELECT DISTINCT ON (storage_key) storage_key, file_size_bytes, captured_at
            FROM (${base.sql}) m
            ORDER BY storage_key, captured_at DESC NULLS LAST) deduped`,
    params: base.params,
  };
}

/** Every matching key, for building a download manifest. No limit — that is the point. */
export function allKeysQuery(filter: PhotoFilter): Clause {
  const base = union(filter);
  return {
    sql: `
      SELECT DISTINCT ON (storage_key) storage_key, filename, step_label, file_size_bytes, captured_at
      FROM (${base.sql}) matched
      ORDER BY storage_key, captured_at DESC NULLS LAST`,
    params: base.params,
  };
}
