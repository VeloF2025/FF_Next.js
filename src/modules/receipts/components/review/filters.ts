/**
 * Client-side filter helpers — parsing query params, normalising
 * URL-roundtripped values, building the query string the API expects.
 *
 * The server-side parser lives in src/modules/receipts/reviewFilters.ts.
 * Both sides MUST agree on what's a valid value; this file only deals
 * with the page-side concerns (browser URL → typed Filters and back).
 */

import {
  RECEIPT_CATEGORIES,
  type ReceiptCategory,
} from '@/modules/receipts/categories';
import type { ReceiptStatus } from '@/modules/receipts/queries';

import type { Filters, SummaryBucket, SummaryShape } from './types';
import { emptySummary } from './types';

const STATUSES: ReceiptStatus[] = ['submitted', 'approved', 'rejected', 'reconciled'];

export function buildQueryString(f: Filters, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  if (f.status) sp.set('status', f.status);
  if (f.staffId) sp.set('staffId', f.staffId);
  if (f.projectId) sp.set('projectId', f.projectId);
  if (f.category) sp.set('category', f.category);
  if (f.month) sp.set('month', f.month);
  for (const [k, v] of Object.entries(extra)) {
    if (v) sp.set(k, v);
  }
  const s = sp.toString();
  return s.length > 0 ? `?${s}` : '';
}

function takeString(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' ? v : null;
}

export function takeStatus(v: string | string[] | undefined): ReceiptStatus | '' | null {
  const s = takeString(v);
  if (s === null) return null;
  if (s === '') return '';
  return (STATUSES as string[]).includes(s) ? (s as ReceiptStatus) : null;
}

export function takeCategory(v: string | string[] | undefined): ReceiptCategory | '' | null {
  const s = takeString(v);
  if (s === null) return null;
  if (s === '') return '';
  return (RECEIPT_CATEGORIES as readonly string[]).includes(s)
    ? (s as ReceiptCategory)
    : null;
}

export function takeMonth(v: string | string[] | undefined): string | null {
  const s = takeString(v);
  if (s === null) return null;
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : null;
}

export function takeRawString(v: string | string[] | undefined): string | null {
  return takeString(v);
}

export function coerceSummary(raw: unknown): SummaryShape {
  if (!raw || typeof raw !== 'object') return emptySummary();
  const empty: SummaryBucket = { count: 0, totalCents: 0 };
  const out = emptySummary();
  for (const k of ['submitted', 'approved', 'rejected', 'reconciled'] as const) {
    const bucket = (raw as Record<string, unknown>)[k];
    if (bucket && typeof bucket === 'object') {
      const b = bucket as Record<string, unknown>;
      out[k] = {
        count: Number(b.count ?? empty.count) || 0,
        totalCents: Number(b.totalCents ?? empty.totalCents) || 0,
      };
    }
  }
  return out;
}
