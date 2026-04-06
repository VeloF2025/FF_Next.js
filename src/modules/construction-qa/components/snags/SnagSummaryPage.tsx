/**
 * SnagSummaryPage — Expandable project → zone → PON snag count breakdown.
 * Displays total, open, in_progress, fixed, verified, closed, reopened,
 * and latest TQR report number/date for each project.
 *
 * Row sub-components live in SnagProjectRow, SnagZoneRow, SnagPonRow.
 * Shared helpers (CountCell, SkeletonRow, formatDate) live in SnagSummaryHelpers.
 */

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { FileSpreadsheet, Search, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { ProjectNode, ZoneNode, PonNode } from '../../types/snag.types';
import { fetchSnagStats, fetchSnagHierarchyStats } from '../../services/snagService';
import { buildHierarchy } from './snagHierarchyUtils';
import { COL_COUNT, SkeletonRow } from './SnagSummaryHelpers';
import { SnagProjectRow } from './SnagProjectRow';
import { SnagZoneRow } from './SnagZoneRow';
import { SnagPonRow } from './SnagPonRow';

export function SnagSummaryPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedZones, setExpandedZones] = useState<Set<string>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearchTerm(value.trim()), 400);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchInput('');
    setSearchTerm('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    Promise.all([fetchSnagStats(), fetchSnagHierarchyStats(undefined, searchTerm || undefined)])
      .then(([statsData, hierarchyRows]) => {
        if (!cancelled) {
          const statsById = new Map(statsData.map((s) => [s.project_id, s]));
          setProjects(buildHierarchy(hierarchyRows, statsById));
          setIsLoading(false);
          // Auto-expand all projects when searching
          if (searchTerm) {
            const allIds = new Set(hierarchyRows.map((r) => r.project_id));
            setExpandedProjects(allIds);
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load snag stats');
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [searchTerm]);

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

  function navigateToProject(projectId: string) {
    void router.push(`/field-ops/snags/list?projectId=${projectId}`);
  }

  function navigateToZone(projectId: string, zoneNo: number | null) {
    const q = `/field-ops/snags/list?projectId=${projectId}${zoneNo !== null ? `&zone_no=${zoneNo}` : ''}`;
    void router.push(q);
  }

  function navigateToPon(projectId: string, zoneNo: number | null, ponNo: number | null) {
    const q = `/field-ops/snags/list?projectId=${projectId}${zoneNo !== null ? `&zone_no=${zoneNo}` : ''}${ponNo !== null ? `&pon_no=${ponNo}` : ''}`;
    void router.push(q);
  }

  const totals = projects.reduce(
    (acc, p) => ({
      total:       acc.total       + p.total,
      open:        acc.open        + p.open,
      assigned:    acc.assigned    + p.assigned,
      in_progress: acc.in_progress + p.in_progress,
      fixed:       acc.fixed       + p.fixed,
      verified:    acc.verified    + p.verified,
      closed:      acc.closed      + p.closed,
      reopened:    acc.reopened    + p.reopened,
    }),
    { total: 0, open: 0, assigned: 0, in_progress: 0, fixed: 0, verified: 0, closed: 0, reopened: 0 }
  );

  function exportExcel() {
    const rows: Record<string, string | number>[] = [];

    for (const p of projects) {
      rows.push({ Tier: 'Project', Label: p.project_name, Project: p.project_name, Total: p.total, Open: p.open, Assigned: p.assigned, 'In Progress': p.in_progress, Fixed: p.fixed, Verified: p.verified, Closed: p.closed, Reopened: p.reopened });
      for (const z of p.zones) {
        rows.push({ Tier: 'Zone', Label: z.label, Project: p.project_name, Total: z.total, Open: z.open, Assigned: z.assigned, 'In Progress': z.in_progress, Fixed: z.fixed, Verified: z.verified, Closed: z.closed, Reopened: z.reopened });
        for (const pon of z.pons) {
          rows.push({ Tier: 'PON', Label: pon.label, Project: p.project_name, Total: pon.total, Open: pon.open, Assigned: pon.assigned, 'In Progress': pon.in_progress, Fixed: pon.fixed, Verified: pon.verified, Closed: pon.closed, Reopened: pon.reopened });
        }
      }
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Snag Summary');

    // Auto-size columns
    const colWidths = Object.keys(rows[0] ?? {}).map((key) => {
      const maxLen = Math.max(key.length, ...rows.map((r) => String(r[key] ?? '').length));
      return { wch: maxLen + 2 };
    });
    ws['!cols'] = colWidths;

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `snags-summary-${dateStr}.xlsx`);
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-200">Snags by Project</h2>
          <p className="text-xs text-[var(--ff-text-secondary)] mt-0.5">
            Per-project snag count breakdown across all statuses.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search DR, pole, description..."
              className="w-56 pl-8 pr-7 py-1.5 text-xs rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {!isLoading && projects.length > 0 && (
            <button
              type="button"
              onClick={exportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors flex-shrink-0"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Export Excel
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-red-900/20 border border-red-700/40 px-4 py-3 text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Outer wrapper: border/bg only. Inner div handles both scroll axes so sticky thead works */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg">
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
            <thead className="sticky top-0 z-10 bg-[var(--ff-bg-tertiary)]">
              <tr>
                {['Project', 'Total', 'Open', 'Assigned', 'In Progress', 'Fixed', 'Verified', 'Closed', 'Reopened', 'Latest TQR'].map((h) => (
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
              {isLoading && Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={COL_COUNT} />)}

              {!isLoading && error && (
                <tr>
                  <td colSpan={COL_COUNT} className="px-4 py-12 text-center text-sm text-red-400">{error}</td>
                </tr>
              )}

              {!isLoading && projects.length === 0 && !error && (
                <tr>
                  <td colSpan={COL_COUNT} className="px-4 py-12 text-center text-sm text-[var(--ff-text-secondary)]">
                    No snag data available
                  </td>
                </tr>
              )}

              {!isLoading && projects.flatMap((p: ProjectNode) => {
                const isProjectExpanded = expandedProjects.has(p.project_id);
                const rows = [
                  <SnagProjectRow
                    key={`project-${p.project_id}`}
                    project={p}
                    isExpanded={isProjectExpanded}
                    onToggle={toggleProject}
                    onNavigate={navigateToProject}
                  />,
                ];

                if (isProjectExpanded) {
                  p.zones.forEach((z: ZoneNode) => {
                    const zoneKey = `${p.project_id}::${z.zoneNo ?? 'null'}`;
                    const isZoneExpanded = expandedZones.has(zoneKey);

                    rows.push(
                      <SnagZoneRow
                        key={`zone-${zoneKey}`}
                        zone={z}
                        projectId={p.project_id}
                        isExpanded={isZoneExpanded}
                        onToggle={toggleZone}
                        onNavigate={navigateToZone}
                      />
                    );

                    if (isZoneExpanded) {
                      z.pons.forEach((pon: PonNode) => {
                        rows.push(
                          <SnagPonRow
                            key={`pon-${p.project_id}-${z.zoneNo ?? 'null'}-${pon.ponNo ?? 'null'}`}
                            pon={pon}
                            projectId={p.project_id}
                            zoneNo={z.zoneNo}
                            onNavigate={navigateToPon}
                          />
                        );
                      });
                    }
                  });
                }

                return rows;
              })}

              {!isLoading && projects.length > 0 && (
                <tr className="bg-[var(--ff-bg-tertiary)] border-t-2 border-[var(--ff-border-light)]">
                  <td className="px-3 py-2 text-xs font-bold text-zinc-200 whitespace-nowrap">Totals</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-zinc-200 whitespace-nowrap text-right bg-zinc-100/5">{totals.total}</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-red-300 whitespace-nowrap text-right">{totals.open}</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-amber-300 whitespace-nowrap text-right">{totals.assigned}</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-amber-300 whitespace-nowrap text-right">{totals.in_progress}</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-blue-300 whitespace-nowrap text-right">{totals.fixed}</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-green-300 whitespace-nowrap text-right">{totals.verified}</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-green-300 whitespace-nowrap text-right">{totals.closed}</td>
                  <td className="px-3 py-2 text-xs tabular-nums font-bold text-red-300 whitespace-nowrap text-right">{totals.reopened}</td>
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
