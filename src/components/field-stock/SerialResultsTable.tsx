import Link from 'next/link';
import type { SerialSearchRowView } from '@/types/field-stock';

interface SerialResultsTableProps {
  rows: SerialSearchRowView[];
  total: number;
  loading: boolean;
  error: string | null;
}

/** Presentational serial-register results table shared by the drill-down pages. */
export function SerialResultsTable({ rows, total, loading, error }: SerialResultsTableProps) {
  return (
    <div>
      {error && (
        <div className="mt-4 rounded bg-red-950/40 p-3 text-sm text-red-200">{error}</div>
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
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="px-2 py-6 text-center text-sm text-neutral-500">
                No serials found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
