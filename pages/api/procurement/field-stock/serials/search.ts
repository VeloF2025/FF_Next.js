/**
 * GET /api/procurement/field-stock/serials/search
 *
 * FLAT route. Returns paginated serial-register rows matching the supplied filter.
 *
 * Auth: withAuth + withPermission('procurement.field-stock','view') — gated
 * to roles with the procurement.field-stock page permission (technician
 * and viewer have explicit deny rows per PR #1599).
 *
 * Query params (all optional, all strings):
 *   q          — prefix-match against serial_number OR mac_address (LIKE
 *                wildcards `%` and `_` are escaped server-side; only literal
 *                prefix matching is supported)
 *   status     — comma-separated list (e.g. "available,installed")
 *   category   — exact match on stock_items.category
 *   warehouseId — UUID of stock_locations row (rejected as 400 if malformed)
 *   projectId   — UUID of allocated project (rejected as 400 if malformed)
 *   dropNumber  — text match on stock_serials.installed_at_drop_number
 *   page        — positive integer, default 1
 *   pageSize    — positive integer, default 50, hard-capped at 200
 *                 (out-of-range → 400, not silently clamped)
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { searchSerials } from '@/modules/procurement/field-stock/services/serialSearchService';
import type { SerialSearchFilters } from '@/types/field-stock';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 200;

type ParseResult =
  | { ok: true; filters: SerialSearchFilters; page: number; pageSize: number }
  | { ok: false; field: string; reason: string };

function parseQuery(query: NextApiRequest['query']): ParseResult {
  const f: SerialSearchFilters = {};
  if (typeof query.q === 'string' && query.q.trim()) f.q = query.q.trim();
  if (typeof query.status === 'string' && query.status.length > 0) {
    f.status = query.status.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof query.category === 'string' && query.category) f.category = query.category;
  if (typeof query.warehouseId === 'string' && query.warehouseId) {
    if (!UUID_RE.test(query.warehouseId)) {
      return { ok: false, field: 'warehouseId', reason: 'must be a UUID' };
    }
    f.warehouseId = query.warehouseId;
  }
  if (typeof query.projectId === 'string' && query.projectId) {
    if (!UUID_RE.test(query.projectId)) {
      return { ok: false, field: 'projectId', reason: 'must be a UUID' };
    }
    f.projectId = query.projectId;
  }
  if (typeof query.dropNumber === 'string' && query.dropNumber) f.dropNumber = query.dropNumber;

  let page = 1;
  let pageSize = 50;
  if (typeof query.page === 'string') {
    if (!/^[0-9]+$/.test(query.page)) {
      return { ok: false, field: 'page', reason: 'must be a positive integer' };
    }
    page = parseInt(query.page, 10);
    if (page < 1) return { ok: false, field: 'page', reason: 'must be >= 1' };
  }
  if (typeof query.pageSize === 'string') {
    if (!/^[0-9]+$/.test(query.pageSize)) {
      return { ok: false, field: 'pageSize', reason: 'must be a positive integer' };
    }
    pageSize = parseInt(query.pageSize, 10);
    if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      return { ok: false, field: 'pageSize', reason: `must be between 1 and ${MAX_PAGE_SIZE}` };
    }
  }

  return { ok: true, filters: f, page, pageSize };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  const parsed = parseQuery(req.query);
  if (!parsed.ok) {
    return apiResponse.badRequest(res, `Invalid query parameter ${parsed.field}: ${parsed.reason}`);
  }
  try {
    const result = await searchSerials(parsed.filters, { page: parsed.page, pageSize: parsed.pageSize });
    return apiResponse.success(res, result);
  } catch (err) {
    log.error(
      'search serials failed',
      { err: err instanceof Error ? err.message : String(err) },
      'SerialSearchAPI'
    );
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('procurement.field-stock', 'view')(handler));
