/**
 * GET /api/photos/search
 *
 * One query surface over both photo corpora — construction QA and QField — so a caller
 * can ask by project, photo type, VLM verdict, pole, zone, PON or date without knowing
 * which table the photos live in.
 *
 * Returns metadata only. Bytes come from /api/photos/download (bulk) or the MCP
 * view_photo tool (one photo, as an image).
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import {
  pageQuery,
  parseFilter,
  proxySourceForKey,
  summaryQuery,
  type PhotoRow,
} from '@/lib/photos/photoQuery';

interface SummaryRow {
  matched: number;
  sized: number;
  total_bytes: string;
}

/**
 * Size is unknown for most rows: qfield_photo_validations has no size column at all, and
 * 82% of construction_qa_photos rows have a NULL one. Reporting sum() alone would tell a
 * caller a 10,980-photo pull weighs 0 MB. So the known bytes and the unsized count are
 * both reported, plus an estimate that is labelled as one.
 */
function sizing(summary: SummaryRow) {
  const knownBytes = Number(summary.total_bytes);
  const unsized = summary.matched - summary.sized;
  const meanKnown = summary.sized > 0 ? knownBytes / summary.sized : 0;
  return {
    matched: summary.matched,
    sizeKnownFor: summary.sized,
    sizeUnknownFor: unsized,
    knownMb: Math.round(knownBytes / 1048576),
    estimatedTotalMb:
      summary.sized > 0 ? Math.round((meanKnown * summary.matched) / 1048576) : null,
    estimateNote:
      unsized === 0
        ? 'Exact: every matching photo has a recorded size.'
        : `Estimated. ${unsized} of ${summary.matched} photos have no recorded size; ` +
          `the estimate extrapolates from the ${summary.sized} that do.`,
  };
}

function toDto(row: PhotoRow) {
  const source = proxySourceForKey(row.storage_key);
  return {
    photoId: row.photo_id,
    corpus: row.corpus,
    storageKey: row.storage_key,
    filename: row.filename,
    type: row.step_label,
    vlmValid: row.vlm_valid,
    needsRetake: row.needs_retake,
    capturedAt: row.captured_at,
    // 'validated' means this timestamp is when QField validation RAN, not when the
    // photo was taken. Filtering or sorting the two as one thing gives wrong answers.
    dateBasis: row.date_basis,
    sizeBytes: row.file_size_bytes === null ? null : Number(row.file_size_bytes),
    pole: row.pole_number,
    zone: row.zone_no,
    pon: row.pon_no,
    project: row.project_name,
    // Handed back ready to use so a caller never has to guess the source dispatch.
    view: {
      path: '/api/construction-qa/photo-proxy',
      query: `key=${encodeURIComponent(row.storage_key)}&source=${source}`,
    },
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const parsed = parseFilter(req.query);
  if ('error' in parsed) return apiResponse.badRequest(res, parsed.error);
  const { filter } = parsed;

  try {
    const summarySql = summaryQuery(filter);
    const pageSql = pageQuery(filter);
    const [summary, page] = await Promise.all([
      pool.query<SummaryRow>(summarySql.sql, summarySql.params as unknown[]),
      pool.query<PhotoRow>(pageSql.sql, pageSql.params as unknown[]),
    ]);

    // count()/sum() without GROUP BY always yields one row; the type system cannot know
    // that, and defaulting to zeros would report "0 matches" for a real result set.
    const summaryRow = summary.rows[0];
    if (!summaryRow) {
      return apiResponse.internalError(res, new Error('Photo summary returned no rows'));
    }

    return apiResponse.success(res, {
      ...sizing(summaryRow),
      returned: page.rows.length,
      offset: filter.offset,
      photos: page.rows.map(toDto),
    });
  } catch (error) {
    log.error(
      'Photo search failed',
      { module: 'photos-search', error: (error as Error).message },
      'photos-search',
    );
    return apiResponse.internalError(res, new Error('Photo search failed'));
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
