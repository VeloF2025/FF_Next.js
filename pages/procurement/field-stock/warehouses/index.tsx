import { useEffect, useState } from 'react';
import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout';
import { HoldingsTable, type HoldingRow } from '@/components/field-stock/HoldingsTable';
import { log } from '@/lib/logger';
import type { WarehouseHolding } from '@/types/field-stock';

const WarehouseHoldingsPage: NextPage = () => {
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/procurement/field-stock/serials/warehouses', {
          credentials: 'include',
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const env = (await res.json()) as
          | { success: true; data: { rows: WarehouseHolding[] } }
          | { success: false; error?: { message?: string } };
        if (cancelled) return;
        if (!env.success) {
          setError(env.error?.message ?? 'Failed to load warehouses');
          return;
        }
        setRows(
          env.data.rows.map((w) => ({
            href: `/procurement/field-stock/warehouses/${w.id}`,
            label: w.name,
            sublabel: [w.code, w.locationType].filter(Boolean).join(' · ') || null,
            count: w.serialCount,
          }))
        );
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Network error');
        log.error('load warehouse holdings failed', { error: err }, 'WarehouseHoldingsPage');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <h1 className="text-xl font-semibold text-neutral-100">Serials by warehouse</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Warehouses currently holding serials. Select one to see its serial register.
        </p>
        <HoldingsTable
          rows={rows}
          loading={loading}
          error={error}
          entityHeader="Warehouse"
          emptyLabel="No warehouses are currently holding serials."
        />
      </div>
    </AppLayout>
  );
};

export default WarehouseHoldingsPage;
