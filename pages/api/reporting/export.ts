/**
 * GET /api/reporting/export?report=…&filters=…&email=…&owner=…&exp=…&sig=…
 *
 * Serve a CSV export. Deliberately NOT behind withAuth: the signature is the credential,
 * which is what lets the URL be opened in a browser or imported by a spreadsheet.
 *
 * The scope comes from the SIGNED values, not from the request — see
 * lib/reporting/exportLinks.ts. Editing `email` or `owner` in the URL changes the
 * canonical string and the signature no longer verifies.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { toCsv, safeFilename } from '@/lib/reporting/csv';
import { isExportable, verifyExportLink } from '@/lib/reporting/exportLinks';
import {
  ACTION_ITEM_COLUMNS,
  EXPORT_MAX_ROWS,
  MEETING_COLUMNS,
  actionItemExportQuery,
  exportCountQuery,
  meetingExportQuery,
  type ActionItemExportRow,
  type MeetingExportRow,
} from '@/lib/reporting/exportQueries';
import rateLimiter from '@/lib/rateLimiter';

/** A CSV of thousands of rows is not something anyone needs repeatedly. */
const EXPORT_RATE_LIMIT = 20;
/** Applied before the signature is known, so it must be tighter and keyed on the peer. */
const UNVERIFIED_RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

/** Today in South Africa, matching the timezone the rows are rendered in. */
function sastDay(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const report = one(req.query.report);
  const filters = one(req.query.filters);
  const email = one(req.query.email);
  const owner = one(req.query.owner) === '1';

  if (!isExportable(report)) {
    return apiResponse.badRequest(res, 'Unknown report');
  }

  // Bound the UNAUTHENTICATED path first, keyed on the peer address.
  //
  // The previous shape keyed on the caller-supplied `sig` and ran before verification,
  // which meant two things: no limit at all on invalid-signature attempts, since every
  // guess got a fresh bucket; and an unauthenticated caller could insert unbounded keys
  // into the process-global in-memory Map that backs the limiter. This service has a
  // prior OOM history, so that is a cheap memory pump rather than a theoretical one.
  const peer = (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] ??
    req.socket.remoteAddress ??
    'unknown'
  ).trim();
  if (!rateLimiter.check(`report-export-ip:${peer}`, UNVERIFIED_RATE_LIMIT, RATE_WINDOW_MS).success) {
    return apiResponse.error(res, ErrorCode.RATE_LIMIT, 'Too many export requests — retry shortly.');
  }

  const { verdict, access } = verifyExportLink(
    report,
    email,
    owner,
    filters,
    req.query.exp,
    req.query.sig,
  );
  if (verdict !== 'ok' || !access) {
    // The message distinguishes expiry from invalidity only AFTER the signature checked
    // out — verifyLink orders it that way so a guess cannot learn it was otherwise valid.
    return apiResponse.unauthorized(
      res,
      verdict === 'expired'
        ? 'This export link has expired. Generate a new one from FibreFlow.'
        : 'Invalid export link.',
    );
  }

  // Now that the signature is verified, meter on the identity it was minted for. The key
  // space is bounded by the user table rather than by whatever a caller can invent.
  if (
    !rateLimiter.check(`report-export:${access.email}`, EXPORT_RATE_LIMIT, RATE_WINDOW_MS).success
  ) {
    return apiResponse.error(
      res,
      ErrorCode.RATE_LIMIT,
      'Too many export requests for this link — retry shortly.',
    );
  }

  try {
    const built =
      report === 'action-items'
        ? actionItemExportQuery(access, filters)
        : meetingExportQuery(access);

    const result = await pool.query(built.text, built.params);

    // The query asks for one more row than the cap so truncation is detectable rather
    // than assumed. A CSV that silently stops at its limit is read as the whole dataset.
    const truncated = result.rows.length > EXPORT_MAX_ROWS;
    const rows = truncated ? result.rows.slice(0, EXPORT_MAX_ROWS) : result.rows;

    // The true total, so the in-file notice can say "first 5,000 of 5,235" rather than
    // leaving the reader to guess. Only run when the cap actually bit.
    let total = rows.length;
    if (truncated) {
      const counted = exportCountQuery(report, access, filters);
      total = (await pool.query(counted.text, counted.params)).rows[0]?.n ?? rows.length;
    }

    const csv =
      report === 'action-items'
        ? toCsv(rows as ActionItemExportRow[], ACTION_ITEM_COLUMNS, { truncated, total })
        : toCsv(rows as MeetingExportRow[], MEETING_COLUMNS, { truncated, total });

    // The SAST day, matching how the rows themselves are rendered. toISOString() is UTC,
    // so between 00:00 and 02:00 SAST the file was named for the previous day.
    const today = sastDay();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeFilename(report, today)}"`,
    );
    // Per-caller content behind a shared URL — never cacheable by anything but the browser
    // that asked, and not even that once the link dies.
    res.setHeader('Cache-Control', 'private, no-store');
    // Says so out of band, because a CSV has nowhere to put a caveat without corrupting
    // a column. A client that ignores it gets correct rows, just not all of them.
    res.setHeader('X-Export-Truncated', truncated ? 'true' : 'false');
    res.setHeader('X-Export-Rows', String(rows.length));

    log.info('Served report export', {
      module: 'reporting-export',
      report,
      email,
      rows: rows.length,
      truncated,
    });

    return res.status(200).send(csv);
  } catch (error) {
    log.error('Report export failed', {
      module: 'reporting-export',
      report,
      error: (error as Error).message,
    });
    return apiResponse.internalError(res, new Error('Report export failed'));
  }
}
