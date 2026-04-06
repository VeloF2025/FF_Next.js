/**
 * SnagSummaryPage — Expandable project → zone → PON snag count breakdown.
 * Displays total, open, in_progress, fixed, verified, closed, reopened,
 * and latest TQR report number/date for each project.
 */

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ProjectNode, ZoneNode, PonNode } from '../../types/snag.types';
import { fetchSnagStats } from '../../services/snagService';
import { fetchSnagHierarchyStats } from '../../services/snagService';
import { buildHierarchy } from './snagHierarchyUtils';

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

const COL_COUNT = 10;

// ============================================================
// Main component
// ============================================================

export function SnagSummaryPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    Promise.all([fetchSnagStats(), fetchSnagHierarchyStats()])
      .then(([statsData, hierarchyRows]) => {
        if (!cancelled) {
          const statsById = new Map(statsData.map((s) => [s.project_id, s]));
          const built = buildHierarchy(hierarchyRows, statsById);
          setProjects(built);
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

  function toggleProject(id: string) {
    setExpandedProjects(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleZone(pid: string, zoneNo: number | null) {
    const key = `${pid}::${zoneNo ?? 'null'}`;
    setExpandedZones(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  }

  // Totals computed from ProjectNode counts
  const totals = projects.reduce(
    (acc, p) => ({
      total: acc.total + p.total,
      open: acc.open + p.open,
      assigned: acc.assigned + p.assigned,
      in_progress: acc.in_progress + p.in_progress,
      fixed: acc.fixed + p.fixed,
      verified: acc.verified + p.verified,
      closed: acc.closed + p.closed,
      reopened: acc.reopened + p.reopened,
    }),
    { total: 0, open: 0, assigned: 0, in_progress: 0, fixed: 0, verified: 0, closed: 0, reopened: 0 }
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
                  'Assigned',
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

              {/* Error state */}
              {!isLoading && error && (
                <tr>
                  <td
                    colSpan={COL_COUNT}
                    className="px-4 py-12 text-center text-sm text-red-400"
                  >
                    {error}
                  </td>
                </tr>
              )}

              {/* Empty state */}
              {!isLoading && projects.length === 0 && !error && (
                <tr>
                  <td
                    colSpan={COL_COUNT}
                    className="px-4 py-12 text-center text-sm text-[var(--ff-text-secondary)]"
                  >
                    No snag data available
                  </td>
                </tr>
              )}

              {/* Data rows — flat tbody via flatMap */}
              {!isLoading &&
                projects.flatMap((p: ProjectNode) => {
                  const isProjectExpanded = expandedProjects.has(p.project_id);
                  const rows = [];

                  // Project row
                  rows.push(
                    <tr
                      key={`project-${p.project_id}`}
                      className="hover:bg-[var(--ff-bg-hover)] transition-colors"
                    >
                      <td className="px-3 py-2 text-xs whitespace-nowrap max-w-[200px]">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleProject(p.project_id)}
                            className="flex-shrink-0 text-zinc-400 hover:text-zinc-200 transition-colors"
                            aria-label={isProjectExpanded ? 'Collapse project' : 'Expand project'}
                          >
                            {isProjectExpanded
                              ? <ChevronDown className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />
                            }
                          </button>
                          <button
                            type="button"
                            onClick={() => void router.push(`/field-ops/snags/list?projectId=${p.project_id}`)}
                            className="text-blue-400 hover:text-blue-300 hover:underline text-left truncate max-w-[170px]"
                          >
                            {p.project_name}
                          </button>
                        </div>
                      </td>

                      {/* Total */}
                      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right bg-zinc-100/5">
                        <span className="font-medium text-zinc-200">{p.total}</span>
                      </td>

                      <CountCell value={p.open} colorClass="text-red-300" bgClass="bg-red-900/20" />
                      <CountCell value={p.assigned} colorClass="text-amber-300" bgClass="bg-amber-900/20" />
                      <CountCell value={p.in_progress} colorClass="text-amber-300" bgClass="bg-amber-900/20" />
                      <CountCell value={p.fixed} colorClass="text-blue-300" bgClass="bg-blue-900/20" />
                      <CountCell value={p.verified} colorClass="text-green-300" bgClass="bg-green-900/20" />
                      <CountCell value={p.closed} colorClass="text-green-300" bgClass="bg-green-900/20" />
                      <CountCell value={p.reopened} colorClass="text-red-300" bgClass="bg-red-900/20" />

                      {/* Latest TQR */}
                      <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">
                        {p.latest_report_number ? (
                          <span className="text-zinc-300 font-medium">{p.latest_report_number}</span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                        {p.latest_report_date && (
                          <span className="text-zinc-400 ml-1.5">
                            {formatDate(p.latest_report_date)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );

                  if (isProjectExpanded) {
                    p.zones.forEach((z: ZoneNode) => {
                      const zoneKey = `${p.project_id}::${z.zoneNo ?? 'null'}`;
                      const isZoneExpanded = expandedZones.has(zoneKey);

                      // Zone row
                      rows.push(
                        <tr
                          key={`zone-${zoneKey}`}
                          className="bg-[var(--ff-bg-tertiary)]/30 hover:bg-[var(--ff-bg-hover)] transition-colors"
                        >
                          <td className="px-3 py-2 text-xs whitespace-nowrap pl-6">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => toggleZone(p.project_id, z.zoneNo)}
                                className="flex-shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
                                aria-label={isZoneExpanded ? 'Collapse zone' : 'Expand zone'}
                              >
                                {isZoneExpanded
                                  ? <ChevronDown className="w-3.5 h-3.5" />
                                  : <ChevronRight className="w-3.5 h-3.5" />
                                }
                              </button>
                              {/* WORKING: zone deep-link — zone_no param parsed by useSnagListPage when supported */}
                              <button
                                type="button"
                                onClick={() =>
                                  void router.push(
                                    `/field-ops/snags/list?projectId=${p.project_id}${z.zoneNo !== null ? `&zone_no=${z.zoneNo}` : ''}`
                                  )
                                }
                                className="text-blue-400 hover:text-blue-300 hover:underline text-left"
                              >
                                {z.label}
                              </button>
                            </div>
                          </td>

                          <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right bg-zinc-100/5">
                            <span className="font-medium text-zinc-200">{z.total}</span>
                          </td>

                          <CountCell value={z.open} colorClass="text-red-300" bgClass="bg-red-900/20" />
                          <CountCell value={z.assigned} colorClass="text-amber-300" bgClass="bg-amber-900/20" />
                          <CountCell value={z.in_progress} colorClass="text-amber-300" bgClass="bg-amber-900/20" />
                          <CountCell value={z.fixed} colorClass="text-blue-300" bgClass="bg-blue-900/20" />
                          <CountCell value={z.verified} colorClass="text-green-300" bgClass="bg-green-900/20" />
                          <CountCell value={z.closed} colorClass="text-green-300" bgClass="bg-green-900/20" />
                          <CountCell value={z.reopened} colorClass="text-red-300" bgClass="bg-red-900/20" />

                          <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">—</td>
                        </tr>
                      );

                      if (isZoneExpanded) {
                        z.pons.forEach((pon: PonNode) => {
                          rows.push(
                            <tr
                              key={`pon-${p.project_id}-${z.zoneNo ?? 'null'}-${pon.ponNo ?? 'null'}`}
                              className="bg-[var(--ff-bg-tertiary)]/15 hover:bg-[var(--ff-bg-hover)] transition-colors"
                            >
                              <td className="px-3 py-2 text-xs whitespace-nowrap pl-12">
                                <div className="flex items-center gap-1">
                                  <span className="w-3.5 inline-block flex-shrink-0" />
                                  {/* WORKING: PON deep-link — zone_no+pon_no params parsed by useSnagListPage when supported */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void router.push(
                                        `/field-ops/snags/list?projectId=${p.project_id}${z.zoneNo !== null ? `&zone_no=${z.zoneNo}` : ''}${pon.ponNo !== null ? `&pon_no=${pon.ponNo}` : ''}`
                                      )
                                    }
                                    className="text-blue-400 hover:text-blue-300 hover:underline text-left"
                                  >
                                    {pon.label}
                                  </button>
                                </div>
                              </td>

                              <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap text-right bg-zinc-100/5">
                                <span className="font-medium text-zinc-200">{pon.total}</span>
                              </td>

                              <CountCell value={pon.open} colorClass="text-red-300" bgClass="bg-red-900/20" />
                              <CountCell value={pon.assigned} colorClass="text-amber-300" bgClass="bg-amber-900/20" />
                              <CountCell value={pon.in_progress} colorClass="text-amber-300" bgClass="bg-amber-900/20" />
                              <CountCell value={pon.fixed} colorClass="text-blue-300" bgClass="bg-blue-900/20" />
                              <CountCell value={pon.verified} colorClass="text-green-300" bgClass="bg-green-900/20" />
                              <CountCell value={pon.closed} colorClass="text-green-300" bgClass="bg-green-900/20" />
                              <CountCell value={pon.reopened} colorClass="text-red-300" bgClass="bg-red-900/20" />

                              <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">—</td>
                            </tr>
                          );
                        });
                      }
                    });
                  }

                  return rows;
                })}

              {/* Totals row */}
              {!isLoading && projects.length > 0 && (
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
                    {totals.assigned}
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
