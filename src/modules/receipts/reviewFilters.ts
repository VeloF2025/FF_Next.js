/**
 * Server-side parser for the /staff/receipts review queue filter set.
 *
 * Single source of truth shared by:
 *   - GET /api/staff/receipts          (list + summary)
 *   - GET /api/staff/receipts-export   (CSV)
 *
 * The page-side parser lives in components/review/filters.ts; both
 * agree on what's a valid value, but the server enforcement is here —
 * never trust the client copy.
 */

import { isValidReceiptCategory, type ReceiptCategory } from './categories';
import type { ReceiptStatus } from './queries';
import type { ReviewListFilters } from './queries-review';

export const RECEIPT_STATUSES: ReceiptStatus[] = [
  'submitted',
  'approved',
  'rejected',
  'reconciled',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function singleParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function parseUuid(value: string | null): string | null {
  if (!value) return null;
  return UUID_RE.test(value) ? value : null;
}

function parseMonth(value: string | null): string | null {
  if (!value) return null;
  return MONTH_RE.test(value) ? value : null;
}

function parseStatus(value: string | null): ReceiptStatus | null {
  if (!value) return null;
  return (RECEIPT_STATUSES as string[]).includes(value)
    ? (value as ReceiptStatus)
    : null;
}

function parseCategory(value: string | null): ReceiptCategory | null {
  if (!value) return null;
  return isValidReceiptCategory(value) ? value : null;
}

export interface ParseInt32Options {
  fallback: number;
  min: number;
  max: number;
}

export function parseInt32(
  value: string | null,
  { fallback, min, max }: ParseInt32Options
): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

export interface ParsedReviewFilters extends ReviewListFilters {
  staffId: string | null;
  projectId: string | null;
  category: ReceiptCategory | null;
  status: ReceiptStatus | null;
  month: string | null;
  limit: number;
  offset: number;
}

export interface ParseReviewFiltersOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

/**
 * Parse the request query string into a ParsedReviewFilters value.
 * Invalid values are silently nulled — callers should trust the
 * returned shape and rely on the underlying SQL to enforce bounds.
 */
export function parseReviewFilters(
  query: Record<string, string | string[] | undefined>,
  opts: ParseReviewFiltersOptions = {}
): ParsedReviewFilters {
  const defaultLimit = opts.defaultLimit ?? 200;
  const maxLimit = opts.maxLimit ?? 500;

  return {
    staffId: parseUuid(singleParam(query.staffId)),
    projectId: parseUuid(singleParam(query.projectId)),
    category: parseCategory(singleParam(query.category)),
    status: parseStatus(singleParam(query.status)),
    month: parseMonth(singleParam(query.month)),
    limit: parseInt32(singleParam(query.limit), {
      fallback: defaultLimit,
      min: 1,
      max: maxLimit,
    }),
    offset: parseInt32(singleParam(query.offset), {
      fallback: 0,
      min: 0,
      max: 1_000_000,
    }),
  };
}
