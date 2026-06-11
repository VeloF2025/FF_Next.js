/**
 * useHolderDetail Hook
 * Fetches the per-holder accountability detail (custody, serials, per-project
 * breakdown, days-held aging) from
 * GET /api/procurement/field-stock/accountability/holders/[holderId].
 *
 * Pass a holderId to fetch; pass null to clear/idle. Re-fetches when the id
 * changes. Postgres numeric columns arrive as JSON strings and are coerced.
 */

import { useState, useEffect } from 'react';
import type { HolderAccountability } from './useHolderAccountability';

export interface HolderCustodyItem {
  stock_item_id: string;
  item_code: string | null;
  item_name: string | null;
  lot_number: string | null;
  quantity: number;
  total_value: number;
}

export interface HolderSerial {
  id: string;
  serial_number: string;
  stock_item_id: string | null;
  status: string | null;
}

export interface HolderProjectBreakdown {
  project_id: string | null;
  project_name: string | null;
  held_count: number;
  held_value: number;
}

export interface HolderDetail extends HolderAccountability {
  custody: HolderCustodyItem[];
  serials: HolderSerial[];
  projectBreakdown: HolderProjectBreakdown[];
}

/** Postgres numeric columns arrive as strings over JSON; coerce to real numbers. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toCustody(r: Record<string, unknown>): HolderCustodyItem {
  return {
    stock_item_id: String(r.stock_item_id),
    item_code: (r.item_code as string) ?? null,
    item_name: (r.item_name as string) ?? null,
    lot_number: (r.lot_number as string) ?? null,
    quantity: num(r.quantity),
    total_value: num(r.total_value),
  };
}

function toSerial(r: Record<string, unknown>): HolderSerial {
  return {
    id: String(r.id),
    serial_number: String(r.serial_number),
    stock_item_id: (r.stock_item_id as string) ?? null,
    status: (r.status as string) ?? null,
  };
}

function toProjectBreakdown(r: Record<string, unknown>): HolderProjectBreakdown {
  return {
    project_id: (r.project_id as string) ?? null,
    project_name: (r.project_name as string) ?? null,
    held_count: num(r.held_count),
    held_value: num(r.held_value),
  };
}

function toHolderDetail(r: Record<string, unknown>): HolderDetail {
  const rows = (key: string): Record<string, unknown>[] =>
    Array.isArray(r[key]) ? (r[key] as Record<string, unknown>[]) : [];
  return {
    holder_id: String(r.holder_id),
    holder_type: r.holder_type as HolderAccountability['holder_type'],
    staff_id: (r.staff_id as string) ?? null,
    contractor_id: (r.contractor_id as string) ?? null,
    name: String(r.name),
    is_active: Boolean(r.is_active),
    issued_count: num(r.issued_count),
    issued_value: num(r.issued_value),
    consumed_count: num(r.consumed_count),
    consumed_value: num(r.consumed_value),
    returned_count: num(r.returned_count),
    returned_value: num(r.returned_value),
    held_count: num(r.held_count),
    held_value: num(r.held_value),
    unaccounted_count: num(r.unaccounted_count),
    is_blocked: Boolean(r.is_blocked),
    blocked_reason: (r.blocked_reason as string) ?? null,
    blocked_at: (r.blocked_at as string) ?? null,
    blocked_by: (r.blocked_by as string) ?? null,
    pending_recovery_amount: num(r.pending_recovery_amount),
    recovered_amount: num(r.recovered_amount),
    held_age_0_7: num(r.held_age_0_7),
    held_age_8_30: num(r.held_age_8_30),
    held_age_31_plus: num(r.held_age_31_plus),
    oldest_held_days: num(r.oldest_held_days),
    oldest_held_at: (r.oldest_held_at as string) ?? null,
    custody: rows('custody').map(toCustody),
    serials: rows('serials').map(toSerial),
    projectBreakdown: rows('projectBreakdown').map(toProjectBreakdown),
  };
}

interface UseHolderDetailReturn {
  detail: HolderDetail | null;
  loading: boolean;
  error: string | null;
}

export function useHolderDetail(holderId: string | null): UseHolderDetailReturn {
  const [detail, setDetail] = useState<HolderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!holderId) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    fetch(`/api/procurement/field-stock/accountability/holders/${encodeURIComponent(holderId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch holder detail');
        const result = await res.json();
        if (cancelled) return;
        const row = result.data as Record<string, unknown> | undefined;
        setDetail(row ? toHolderDetail(row) : null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [holderId]);

  return { detail, loading, error };
}
