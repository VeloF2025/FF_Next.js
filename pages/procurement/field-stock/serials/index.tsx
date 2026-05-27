import { useEffect, useState, useCallback } from 'react';
import type { GetServerSideProps, NextPage } from 'next';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { AppLayout } from '@/components/layout';
import { SerialSearch } from '@/components/field-stock/SerialSearch';
import type { SerialSearchFilters } from '@/types/field-stock';

// Page-local mirror of searchSerials() → SerialSearchRow. Kept local because
// the page fetches over HTTP rather than calling the service directly, so the
// boundary is JSON. KEEP IN SYNC with
// src/modules/procurement/field-stock/services/serialSearchService.ts →
// SerialSearchRow. If drift becomes painful, promote SerialSearchRow to
// src/types/field-stock/.
interface ServerRow {
  id: string;
  serialNumber: string;
  macAddress: string | null;
  category: string | null;
  itemName: string | null;
  status: string;
  currentLocationName: string | null;
  allocatedProjectName: string | null;
  installedAtDropNumber: string | null;
  lastEventType: string | null;
  lastEventAt: string | null;
}

interface PageProps {
  initialFilters: SerialSearchFilters;
}

function filtersToQuery(f: SerialSearchFilters): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.q) q.q = f.q;
  if (f.status && f.status.length > 0) q.status = f.status.join(',');
  if (f.category) q.category = f.category;
  if (f.warehouseId) q.warehouseId = f.warehouseId;
  if (f.projectId) q.projectId = f.projectId;
  if (f.dropNumber) q.dropNumber = f.dropNumber;
  return q;
}

function queryToFilters(
  q: Record<string, string | string[] | undefined>
): SerialSearchFilters {
  const get = (k: string): string | undefined => {
    const v = q[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const filters: SerialSearchFilters = {};
  const qv = get('q');
  if (qv) filters.q = qv;
  const statusStr = get('status');
  if (statusStr) filters.status = statusStr.split(',').filter(Boolean);
  const category = get('category');
  if (category) filters.category = category;
  const warehouseId = get('warehouseId');
  if (warehouseId) filters.warehouseId = warehouseId;
  const projectId = get('projectId');
  if (projectId) filters.projectId = projectId;
  const dropNumber = get('dropNumber');
  if (dropNumber) filters.dropNumber = dropNumber;
  return filters;
}

const SerialsSearchPage: NextPage<PageProps> = ({ initialFilters }) => {
  const router = useRouter();
  const [rows, setRows] = useState<ServerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResults = useCallback(async (filters: SerialSearchFilters) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams(filtersToQuery(filters));
      const res = await fetch(
        `/api/procurement/field-stock/serials/search?${params}`,
        { credentials: 'include' }
      );
      const env = (await res.json()) as
        | { success: true; data: { rows: ServerRow[]; total: number; page: number; pageSize: number } }
        | { success: false; error?: { message?: string } };
      if (!env.success) {
        setError(env.error?.message ?? 'Search failed');
        return;
      }
      setRows(env.data.rows);
      setTotal(env.data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const filters = queryToFilters(router.query);
    void fetchResults(filters);
  }, [router.query, fetchResults]);

  const onFiltersChange = useCallback(
    (filters: SerialSearchFilters) => {
      void router.replace(
        {
          pathname: '/procurement/field-stock/serials',
          query: filtersToQuery(filters),
        },
        undefined,
        { shallow: true }
      );
    },
    [router]
  );

  return (
    <AppLayout>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <h1 className="mb-4 text-xl font-semibold">Serial register</h1>
        <SerialSearch
          initialFilters={initialFilters}
          onFiltersChange={onFiltersChange}
        />
        {error && (
          <div className="mt-4 rounded bg-red-950/40 p-3 text-sm text-red-200">
            {error}
          </div>
        )}
        <div className="mt-4 text-sm text-neutral-400">
          {loading ? 'Loading…' : `${total} result${total === 1 ? '' : 's'}`}
        </div>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-neutral-500">
              <th className="px-2 py-1">Serial</th>
              <th className="px-2 py-1">Category</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1">Location</th>
              <th className="px-2 py-1">Project</th>
              <th className="px-2 py-1">Last event</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-neutral-800">
                <td className="px-2 py-1">
                  <Link
                    href={`/procurement/field-stock/serials/${encodeURIComponent(r.serialNumber)}`}
                    className="text-blue-400 hover:underline"
                  >
                    {r.serialNumber}
                  </Link>
                  {r.macAddress && (
                    <div className="text-xs text-neutral-500">{r.macAddress}</div>
                  )}
                </td>
                <td className="px-2 py-1">{r.category ?? '—'}</td>
                <td className="px-2 py-1">{r.status}</td>
                <td className="px-2 py-1">
                  {r.currentLocationName ?? r.installedAtDropNumber ?? '—'}
                </td>
                <td className="px-2 py-1">{r.allocatedProjectName ?? '—'}</td>
                <td className="px-2 py-1">
                  {r.lastEventType ?? '—'}
                  {r.lastEventAt && (
                    <div className="text-xs text-neutral-500">
                      {new Date(r.lastEventAt).toISOString().slice(0, 10)}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppLayout>
  );
};

export const getServerSideProps: GetServerSideProps<PageProps> = async (ctx) => ({
  props: { initialFilters: queryToFilters(ctx.query) },
});

export default SerialsSearchPage;
