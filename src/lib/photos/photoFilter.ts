/**
 * The photo filter grammar: what a caller may ask for, and how a request is parsed
 * into it. Split from photoQuery.ts to keep both files inside the 300-line rule.
 */

export type PhotoSource = 'qa' | 'qfield' | 'both';

export interface PhotoFilter {
  project?: string;
  source: PhotoSource;
  /** Matched against step_label / work_type, e.g. "depth" finds "Depth Photo". */
  type?: string;
  /**
   * The VLM verdict — QA photos only.
   *
   * qfield_photo_validations has no boolean verdict column, so this filter EXCLUDES
   * that corpus rather than substituting `needs_retake` for it. Those are different
   * facts: a photo can be flagged for retake for reasons the VLM never assessed, and
   * answering a question about one with the other is a wrong answer, not a partial one.
   */
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
  filename: string | null;
  step_label: string | null;
  vlm_valid: boolean | null;
  needs_retake: boolean | null;
  captured_at: string | null;
  /**
   * What `captured_at` actually measures for this row: 'captured' is EXIF capture time,
   * 'validated' is when the QField validation ran. They are not interchangeable — a
   * photo taken in June can be validated in August — so the basis travels with the row
   * instead of being silently assumed.
   */
  date_basis: 'captured' | 'validated';
  file_size_bytes: string | null;
  pole_number: string | null;
  zone_no: number | null;
  pon_no: number | null;
  project_name: string | null;
}

/** Page size for browsing. NOT a download ceiling — manifests are deliberately uncapped. */
export const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 25;

/**
 * Accept only a date Postgres will also accept.
 *
 * `Date.parse` is far looser than `::timestamptz`: it rolls '2026-02-30' over to March 2
 * and accepts a bare '2026'. Letting those through turns a bad parameter into a generic
 * 500 from the query layer instead of a 400 naming the field.
 */
function isRejectableDate(raw: string): boolean {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return true;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!ymd) return !/^\d{4}-\d{2}-\d{2}/.test(raw);

  // A real calendar date survives the round trip; a rolled-over one does not.
  return (
    parsed.getUTCFullYear() !== Number(ymd[1]) ||
    parsed.getUTCMonth() + 1 !== Number(ymd[2]) ||
    parsed.getUTCDate() !== Number(ymd[3])
  );
}

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
    if (raw && isRejectableDate(raw)) {
      return { error: `${name} must be a real calendar date — got "${raw}"` };
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
