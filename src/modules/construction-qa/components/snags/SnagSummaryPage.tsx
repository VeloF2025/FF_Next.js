/**
 * SnagSummaryPage — Per-project snag count breakdown table.
 * Displays total, open, in_progress, fixed, verified, closed, reopened,
 * and latest TQR report number/date for each project.
 */

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import type { SnagProjectStats } from '../../types/snag.types';
import { fetchSnagStats } from '../../services/snagService';

// ============================================================
// CountCell helper
// ============================================================

interface CountCellProps {
  value: number;
  colorClass: string;
  bgClass: string;
}

function CountCell({ value, colorClass, bgClass }: CountCellProps) {
  if (value === 0) {
    return (
      <td className="px-3 py-2 text-xs tabular-nums text-zinc-500 whitespace-nowrap text-right">
        0
      </td>
    );
  }
  return (
    <td className={`px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right ${bgClass}`}>
      <span className={`font-medium ${colorClass}`}>{value}</span>
    </td>
  );
}

// ============================================================
// Skeleton row
// ============================================================

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div
            className="h-3 rounded bg-zinc-700 animate-pulse"
            style={{ width: `${60 + (i % 3) * 20}%` }}
          />
        </td>
      ))}
    </tr>
  );
}

const COL_COUNT = 9;

// ============================================================
// Main component
// ============================================================

export function SnagSummaryPage() {
  const router = useRouter();
  const [stats, setStats] = useState<SnagProjectStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchSnagStats()
      .then((data) => {
        if (!cancelled) {
          setStats(data);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load snag stats');
          setIsLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  // Totals row
  const totals = stats.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      open: acc.open + s.open,
      in_progress: acc.in_progress + s.in_progress,
      fixed: acc.fixed + s.fixed,
      verified: acc.verified + s.verified,
      closed: acc.closed + s.closed,
      reopened: acc.reopened + s.reopened,
    }),
    { total: 0, open: 0, in_progress: 0, fixed: 0, verified: 0, closed: 0, reopened: 0 }
  );

  function formatDate(iso: string | null): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-ZA', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return iso;
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-zinc-200">Snags by Project</h2>
        <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
          Per-project snag count breakdown across all statuses.
        </p>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-900/20 border border-red-700/40 px-4 py-3 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-y-auto max-h-[calc(100vh-280px)]">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="sticky top-0 z-10 bg-[var(--ff-bg-tertiary)]">
              <tr>
                {[
                  'Project',
                  'Total',
                  'Open',
                  'In Progress',
                  'Fixed',
                  'Verified',
                  'Closed',
                  'Reopened',
                  'Latest TQR',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-xs font-medium text-[var(--ff-text-secondary)] tracking-wide whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
              {/* Loading state */}
              {isLoading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <SkeletonRow key={i} cols={COL_COUNT} />
                ))}

              {/* Empty state */}
              {!isLoading && stats.length === 0 && !error && (
                <tr>
                  <td
                    colSpan={COL_COUNT}
                    className="px-4 py-12 text-center text-sm text-[var(--ff-text-secondary)]"
                  >
                    No snag data available
                  </td>
                </tr>
              )}

              {/* Data rows */}
              {!isLoading &&
                stats.map((s) => (
                  <tr key={s.project_id} className="hover:bg-[var(--ff-bg-hover)] transition-colors">
                    {/* Project — clickable link */}
                    <td className="px-3 py-2 text-xs whitespace-nowrap max-w-[200px] truncate">
                      <button
                        type="button"
                        onClick={() => void router.push(`/field-ops/snags/list?projectId=${s.project_id}`)}
                        className="text-blue-400 hover:text-blue-300 hover:underline text-left truncate max-w-[190px]"
                      >
                        {s.project_name}
                      </button>
                    </td>

                    {/* Total — always tinted zinc */}
                    <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right bg-zinc-100/5">
                      <span className="font-medium text-zinc-200">{s.total}</span>
                    </td>

                    {/* Open */}
                    <CountCell value={s.open} colorClass="text-red-300" bgClass="bg-red-900/20" />

                    {/* In Progress */}
                    <CountCell value={s.in_progress} colorClass="text-amber-300" bgClass="bg-amber-900/20" />

                    {/* Fixed */}
                    <CountCell value={s.fixed} colorClass="text-blue-300" bgClass="bg-blue-900/20" />

                    {/* Verified */}
                    <CountCell value={s.verified} colorClass="text-green-300" bgClass="bg-green-900/20" />

                    {/* Closed */}
                    <CountCell value={s.closed} colorClass="text-green-300" bgClass="bg-green-900/20" />

                    {/* Reopened */}
                    <CountCell value={s.reopened} colorClass="text-red-300" bgClass="bg-red-900/20" />

                    {/* Latest TQR */}
                    <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">
                      {s.latest_report_number ? (
                        <span className="text-zinc-300 font-medium">{s.latest_report_number}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                      {s.latest_report_date && (
                        <span className="text-zinc-400 ml-1.5">
                          {formatDate(s.latest_report_date)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}

              {/* Totals row */}
              {!isLoading && stats.length > 0 && (
                <tr className="bg-[var(--ff-bg-tertiary)] border-t-2 border-[var(--ff-border-light)]">
                  <td className="px-3 py-2 text-xs font-bold text-zinc-200 whitespace-nowrap">
                    Totals
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-zinc-200 whitespace-nowrap text-right bg-zinc-100/5">
                    {totals.total}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-red-300 whitespace-nowrap text-right">
                    {totals.open}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-amber-300 whitespace-nowrap text-right">
                    {totals.in_progress}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-blue-300 whitespace-nowrap text-right">
                    {totals.fixed}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-green-300 whitespace-nowrap text-right">
                    {totals.verified}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-green-300 whitespace-nowrap text-right">
                    {totals.closed}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-red-300 whitespace-nowrap text-right">
                    {totals.reopened}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
