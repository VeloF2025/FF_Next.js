import { useEffect, useState } from 'react';
import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout';
import { HoldingsTable, type HoldingRow } from '@/components/field-stock/HoldingsTable';
import { log } from '@/lib/logger';
import type { ProjectHolding } from '@/types/field-stock';

const ProjectHoldingsPage: NextPage = () => {
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/procurement/field-stock/serials/projects', {
          credentials: 'include',
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const env = (await res.json()) as
          | { success: true; data: { rows: ProjectHolding[] } }
          | { success: false; error?: { message?: string } };
        if (cancelled) return;
        if (!env.success) {
          setError(env.error?.message ?? 'Failed to load projects');
          return;
        }
        setRows(
          env.data.rows.map((p) => ({
            href: `/procurement/field-stock/projects/${p.id}`,
            label: p.projectName,
            count: p.serialCount,
          }))
        );
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Network error');
        log.error('load project holdings failed', { error: err }, 'ProjectHoldingsPage');
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
        <h1 className="text-xl font-semibold text-neutral-100">Serials by project</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Projects with allocated serials. Select one to see its serial register.
        </p>
        <HoldingsTable
          rows={rows}
          loading={loading}
          error={error}
          entityHeader="Project"
          emptyLabel="No projects currently have allocated serials."
        />
      </div>
    </AppLayout>
  );
};

export default ProjectHoldingsPage;
