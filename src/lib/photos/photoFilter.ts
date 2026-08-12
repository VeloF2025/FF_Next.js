/**
 * The photo filter grammar: what a caller may ask for, and how a request is parsed
 * into it. Split from photoQuery.ts to keep both files inside the 300-line rule.
 */

/**
 * `worksqa` is `pole_qa_photos` — the acceptance-QA store, one row per pole with named
 * photo slots. It is the only corpus carrying BOTH a step label and a VLM verdict.
 */
export type PhotoSource = 'qa' | 'qfield' | 'worksqa' | 'both';

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
  /**
   * Whether the caller may see the works-QA corpus.
   *
   * `pole_qa_photos` is gated on `construction-qa.works-qa` everywhere else in the app —
   * a SIBLING of `construction-qa.qa-centre`, not a child. Routes set this from the
   * caller's own permissions so adding a corpus to a search cannot quietly widen who
   * can read it. Defaults to allowed so non-HTTP callers are unaffected.
   */
  includeWorksQa?: boolean;
}

export interface PhotoRow {
  photo_id: string;
  corpus: 'qa' | 'qfield' | 'worksqa';
  storage_key: string;
  filename: string | null;
  step_label: string | null;
  vlm_valid: boolean | null;
  needs_retake: boolean | null;
  captured_at: string | null;
  /**
   * What `captured_at` actually measures for this row: 'captured' is EXIF capture time,
   * 'validated' is when the QField validation ran, and 'unknown' means the corpus records
   * no photo timestamp (works-QA) — those rows carry a NULL date and are excluded from
   * date filters rather than answered with a row's last-write time. A photo taken in
   * June can be validated in August, so the basis travels with the row.
   */
  date_basis: 'captured' | 'validated' | 'unknown';
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
 * Reject a date `::timestamptz` would reject, and NOTHING ELSE.
 *
 * `Date.parse` alone is too loose: it rolls '2026-02-30' over to March 2 and accepts a
 * bare '2026', turning a bad parameter into a generic 500 from the query layer instead
 * of a 400 naming the field.
 *
 * But the calendar check must run on the LITERAL Y-M-D components, never on the parsed
 * instant. Comparing `getUTC*()` against the literal prefix looks equivalent and is not:
 * for '2026-06-15T01:00:00+02:00' the instant is 2026-06-14T23:00Z, so the day differs
 * and a perfectly valid timestamp is rejected — and whether it is rejected depends on
 * the SERVER's timezone, so the same request behaves differently on a UTC box and on
 * the SAST deploy host.
 */
function isRejectableDate(raw: string): boolean {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(raw);
  if (!ymd) return true; // bare '2026', '15/06/2026', prose — none reach Postgres intact

  const [, year, month, day] = ymd;
  // Built from the components themselves, so nothing here depends on any offset.
  const asUtc = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const rolledOver =
    asUtc.getUTCFullYear() !== Number(year) ||
    asUtc.getUTCMonth() + 1 !== Number(month) ||
    asUtc.getUTCDate() !== Number(day);
  if (rolledOver) return true;

  // The date is a real calendar day; the time/offset part still has to parse.
  return Number.isNaN(Date.parse(raw));
}

/** Parse a request query into a filter, or explain what was wrong with it. */
export function parseFilter(query: Record<string, string | string[] | undefined>):
  | { filter: PhotoFilter }
  | { error: string } {
  const one = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;

  const source = (one(query.source) ?? 'both') as PhotoSource;
  if (!['qa', 'qfield', 'worksqa', 'both'].includes(source)) {
    return { error: `source must be qa, qfield, worksqa or both — got "${source}"` };
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
