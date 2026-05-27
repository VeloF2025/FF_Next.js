import Link from 'next/link';

export interface HoldingRow {
  href: string;
  label: string;
  sublabel?: string | null;
  count: number;
}

interface HoldingsTableProps {
  rows: HoldingRow[];
  loading: boolean;
  error: string | null;
  /** Heading for the first (entity) column, e.g. "Warehouse" / "Project". */
  entityHeader: string;
  emptyLabel: string;
}

/**
 * Presentational list of entities (warehouses or projects) holding serials,
 * each linking to its drill-down page. Shared by the field-stock holdings
 * landing pages (Wave 2 PR-12 / PR-13).
 */
export function HoldingsTable({ rows, loading, error, entityHeader, emptyLabel }: HoldingsTableProps) {
  return (
    <div>
      {error && (
        <div className="mt-4 rounded bg-red-950/40 p-3 text-sm text-red-200">{error}</div>
      )}
      <div className="mt-4 text-sm text-neutral-400">
        {loading ? 'Loading…' : `${rows.length} ${entityHeader.toLowerCase()}${rows.length === 1 ? '' : 's'}`}
      </div>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-neutral-500">
            <th className="px-2 py-1">{entityHeader}</th>
            <th className="px-2 py-1 text-right">Serials</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.href} className="border-t border-neutral-800">
              <td className="px-2 py-1">
                <Link href={r.href} className="text-blue-400 hover:underline">
                  {r.label}
                </Link>
                {r.sublabel && (
                  <div className="text-xs text-neutral-500">{r.sublabel}</div>
                )}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">{r.count}</td>
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={2} className="px-2 py-6 text-center text-sm text-neutral-500">
                {emptyLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
