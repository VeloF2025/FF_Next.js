/**
 * ActivationsReport — OES activations by year/month/week.
 * Table: collapsible Year → Month → Week drill-down.
 * Charts: stacked horizontal bar by project (monthly/weekly) + breakdown grid below.
 */

// 🟢 WORKING: Activations Report — collapsible table + stacked bar chart by project + breakdown grid
'use client';

import { useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, LabelList,
} from '@/components/ui/DynamicChart';
import { ChevronDown, ChevronRight, Loader2, AlertCircle, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReportTabLayout } from '../ReportTabLayout';
import { useActivationsData } from './useActivationsData';
import type { ActivationYear, ActivationMonth, ActivationWeek } from './useActivationsData';

const PALETTE = [
  '#3b82f6','#f97316','#22c55e','#a855f7','#eab308',
  '#06b6d4','#ec4899','#84cc16','#f43f5e','#8b5cf6',
  '#14b8a6','#fb923c','#4ade80','#c084fc','#facc15',
  '#38bdf8','#f472b6','#a3e635','#fb7185','#818cf8',
];


const TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: '#1F2937', border: '1px solid #374151', borderRadius: 6, color: '#F9FAFB', fontSize: 12 },
  itemStyle: { color: '#F9FAFB' },
};

// ── ProjectLegend ─────────────────────────────────────────────────────────────

interface ProjectLegendProps {
  projects: string[];
  colors: string[];
  selected: Set<string>;
  onToggle: (proj: string) => void;
}

function ProjectLegend({ projects, colors, selected, onToggle }: ProjectLegendProps) {
  const anySelected = selected.size > 0;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3 px-1">
      {projects.map((proj, idx) => {
        const isActive = !anySelected || selected.has(proj);
        return (
          <Button
            key={proj}
            variant="ghost"
            size="sm"
            onClick={() => onToggle(proj)}
            className="flex items-center gap-1.5 text-xs transition-opacity"
            style={{ opacity: isActive ? 1 : 0.3 }}
          >
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: colors[idx % colors.length] }} />
            <span className={`${selected.has(proj) ? 'font-bold text-white' : 'text-gray-400'}`}>{proj}</span>
          </Button>
        );
      })}
      {anySelected && (
        <Button variant="link" size="sm" onClick={() => onToggle('__clear__')} className="ml-1">
          Clear filter
        </Button>
      )}
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────

function getProjectCount(
  projects: Array<{ projectName: string; count: number }>,
  name: string
): number {
  return projects.find((p) => p.projectName === name)?.count ?? 0;
}

interface ActivationsTableProps {
  years: ActivationYear[];
  allProjects: string[];
}

function ActivationsTable({ years, allProjects }: ActivationsTableProps) {
  const initExpand = () => {
    const m = new Map<string, boolean>();
    for (const y of years) m.set(`year-${y.year}`, true);
    return m;
  };
  const [expanded, setExpanded] = useState<Map<string, boolean>>(initExpand);

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Map(prev);
      next.set(key, !prev.get(key));
      return next;
    });
  }

  const th = 'px-3 py-2.5 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = 'px-3 py-2.5 text-right text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';

  const totalActivations = years.reduce((s, y) => s + y.activations, 0);

  // Grand total per project across all years
  const projectGrandTotals = allProjects.map((name) =>
    years.reduce((s, y) => s + getProjectCount(y.projects, name), 0)
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 220 }}>Period</th>
            {allProjects.map((name) => (
              <th key={name} className={thR} style={{ minWidth: 90 }}>{name}</th>
            ))}
            <th className={thR} style={{ minWidth: 100 }}>Total Activations</th>
          </tr>
        </thead>
        <tbody>
          {years.map((year) => {
            const yearKey = `year-${year.year}`;
            const yearOpen = expanded.get(yearKey) ?? true;
            return (
              <>
                {/* Year row */}
                <tr
                  key={yearKey}
                  className="cursor-pointer select-none"
                  style={{ backgroundColor: '#1a3a4a' }}
                  onClick={() => toggle(yearKey)}
                >
                  <td className="px-3 py-2.5 text-white font-bold flex items-center gap-2" style={{ minWidth: 220 }}>
                    {yearOpen ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                    {year.year}
                  </td>
                  {allProjects.map((name) => {
                    const count = getProjectCount(year.projects, name);
                    return (
                      <td key={name} className="px-3 py-2.5 text-right tabular-nums text-white font-bold whitespace-nowrap">
                        {count > 0 ? count.toLocaleString() : '—'}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-right tabular-nums text-white font-bold whitespace-nowrap">{year.activations.toLocaleString()}</td>
                </tr>

                {/* Month rows */}
                {yearOpen && year.months.map((month) => {
                  const monthKey = `month-${month.monthKey}`;
                  const monthOpen = expanded.get(monthKey) ?? false;
                  return (
                    <>
                      <tr
                        key={monthKey}
                        className="cursor-pointer select-none"
                        style={{ backgroundColor: '#1e3a4a' }}
                        onClick={() => toggle(monthKey)}
                      >
                        <td className="px-3 py-2 text-gray-200 font-semibold whitespace-nowrap pl-8 flex items-center gap-2">
                          {monthOpen ? <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />}
                          {month.monthLabel}
                        </td>
                        {allProjects.map((name) => {
                          const count = getProjectCount(month.projects, name);
                          return (
                            <td key={name} className="px-3 py-2 text-right tabular-nums text-gray-200 font-semibold whitespace-nowrap">
                              {count > 0 ? count.toLocaleString() : '—'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right tabular-nums text-gray-200 font-semibold whitespace-nowrap">{month.activations.toLocaleString()}</td>
                      </tr>

                      {/* Week rows */}
                      {monthOpen && month.weeks.map((week, wi) => (
                        <tr key={week.weekStart} className={wi % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap pl-14">{week.weekLabel}</td>
                          {allProjects.map((name) => {
                            const count = getProjectCount(week.projects, name);
                            return (
                              <td key={name} className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">
                                {count > 0 ? count.toLocaleString() : '—'}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">{week.activations.toLocaleString()}</td>
                        </tr>
                      ))}
                    </>
                  );
                })}
              </>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-3 py-2.5 text-white">Total</td>
            {projectGrandTotals.map((total, idx) => (
              <td key={allProjects[idx]} className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">
                {total > 0 ? total.toLocaleString() : '—'}
              </td>
            ))}
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">{totalActivations.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Breakdown Grid ────────────────────────────────────────────────────────────

interface BreakdownColumn {
  key: string;
  label: string;
  projects: Array<{ projectName: string; count: number }>;
}

function BreakdownGrid({
  columns,
  allProjects,
  selectedProjects,
}: {
  columns: BreakdownColumn[];
  allProjects: string[];
  selectedProjects: Set<string>;
}) {
  const anySelected = selectedProjects.size > 0;
  const projectRows = allProjects
    .filter((name) => !anySelected || selectedProjects.has(name))
    .map((name) => ({
      name,
      counts: columns.map((col) => col.projects.find((p) => p.projectName === name)?.count ?? 0),
    }))
    .filter((row) => row.counts.some((c) => c > 0));

  if (columns.length === 0 || projectRows.length === 0) return null;

  const th = 'px-3 py-2 text-left text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';
  const thR = 'px-3 py-2 text-right text-xs font-bold text-white uppercase tracking-wide whitespace-nowrap';

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700 mt-4">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr style={{ backgroundColor: '#1a3a4a' }}>
            <th className={th} style={{ minWidth: 150 }}>Project</th>
            {columns.map((col) => <th key={col.key} className={thR}>{col.label}</th>)}
            <th className={thR}>Total</th>
          </tr>
        </thead>
        <tbody>
          {projectRows.map(({ name, counts }, ri) => {
            const total = counts.reduce((s, c) => s + c, 0);
            return (
              <tr key={name} className={ri % 2 === 0 ? 'bg-gray-900' : 'bg-gray-800/60'}>
                <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{name}</td>
                {counts.map((c, ci) => (
                  <td key={ci} className="px-3 py-2 text-right tabular-nums text-gray-300 whitespace-nowrap">
                    {c > 0 ? c.toLocaleString() : '—'}
                  </td>
                ))}
                <td className="px-3 py-2 text-right tabular-nums text-white font-semibold whitespace-nowrap">{total.toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-500 font-bold" style={{ backgroundColor: '#1a3a4a' }}>
            <td className="px-3 py-2.5 text-white">Total</td>
            {columns.map((col) => {
              const t = col.projects
                .filter((p) => !anySelected || selectedProjects.has(p.projectName))
                .reduce((s, p) => s + p.count, 0);
              return (
                <td key={col.key} className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">
                  {t > 0 ? t.toLocaleString() : '—'}
                </td>
              );
            })}
            <td className="px-3 py-2.5 text-right tabular-nums text-white whitespace-nowrap">
              {projectRows.reduce((s, r) => s + r.counts.reduce((ss, c) => ss + c, 0), 0).toLocaleString()}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────

type ChartEntry = Record<string, number | string | undefined>;

function ActivationsChart({ years, allProjects }: { years: ActivationYear[]; allProjects: string[] }) {
  const [drillMonth, setDrillMonth] = useState<string | null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());

  const toggleProject = useCallback((proj: string) => {
    if (proj === '__clear__') { setSelectedProjects(new Set()); return; }
    setSelectedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(proj)) next.delete(proj); else next.add(proj);
      return next;
    });
  }, []);

  const anySelected = selectedProjects.size > 0;

  // Build flat chronological month list with project data
  const allMonthsData: Array<{
    key: string; label: string; activations: number;
    projects: Array<{ projectName: string; count: number }>;
  }> = [];
  for (const yr of [...years].sort((a, b) => a.year - b.year)) {
    for (const mo of [...yr.months].sort((a, b) => a.monthKey.localeCompare(b.monthKey))) {
      allMonthsData.push({ key: mo.monthKey, label: mo.monthLabel, activations: mo.activations, projects: mo.projects });
    }
  }

  // Find drilled month
  let drilledMonth: ActivationMonth | undefined;
  if (drillMonth) {
    for (const yr of years) {
      drilledMonth = yr.months.find((m) => m.monthKey === drillMonth);
      if (drilledMonth) break;
    }
  }

  // Build chart data entries — zero out non-selected projects, recompute __total__
  const chartData: ChartEntry[] = drillMonth && drilledMonth
    ? [...drilledMonth.weeks]
        .sort((a: ActivationWeek, b: ActivationWeek) => a.weekStart.localeCompare(b.weekStart))
        .map((w: ActivationWeek) => {
          const entry: ChartEntry = { label: w.weekLabel.split(' – ')[0] ?? w.weekStart };
          let total = 0;
          for (const p of w.projects) {
            const effective = anySelected && !selectedProjects.has(p.projectName) ? 0 : p.count;
            entry[p.projectName] = effective;
            total += effective;
          }
          entry.__total__ = total;
          return entry;
        })
    : allMonthsData.map((m) => {
        const [mon, yr] = m.label.split(' ');
        const entry: ChartEntry = {
          label: `${(mon ?? '').substring(0, 3)} ${(yr ?? '').slice(-2)}`,
          _key: m.key,
        };
        let total = 0;
        for (const p of m.projects) {
          const effective = anySelected && !selectedProjects.has(p.projectName) ? 0 : p.count;
          entry[p.projectName] = effective;
          total += effective;
        }
        entry.__total__ = total;
        return entry;
      });

  // Build breakdown grid columns
  const gridColumns: BreakdownColumn[] = drillMonth && drilledMonth
    ? [...drilledMonth.weeks]
        .sort((a: ActivationWeek, b: ActivationWeek) => a.weekStart.localeCompare(b.weekStart))
        .map((w: ActivationWeek) => ({
          key: w.weekStart,
          label: w.weekLabel.split(' – ')[0] ?? w.weekStart,
          projects: w.projects,
        }))
    : allMonthsData.map((m) => {
        const [mon, yr] = m.label.split(' ');
        return {
          key: m.key,
          label: `${(mon ?? '').substring(0, 3)} ${(yr ?? '').slice(-2)}`,
          projects: m.projects,
        };
      });

  return (
    <div className="space-y-3">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Button
          variant={drillMonth ? 'link' : 'ghost'}
          size="sm"
          className="font-medium"
          onClick={() => drillMonth && setDrillMonth(null)}
        >
          All Months
        </Button>
        {drillMonth && drilledMonth && (
          <>
            <span className="text-gray-500">›</span>
            <span className="text-white font-medium">{drilledMonth.monthLabel}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDrillMonth(null)}
              className="ml-2"
            >
              <ChevronLeft className="w-3 h-3" /> Back
            </Button>
          </>
        )}
      </div>

      <p className="text-xs text-gray-500">
        {drillMonth ? 'Weekly activations for selected month' : 'Click a bar to drill into weekly view'}
      </p>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 24, right: 16, bottom: 60, left: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
            <XAxis
              type="category"
              dataKey="label"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={{ stroke: '#4B5563' }}
              tickLine={false}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              {...TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [value.toLocaleString(), name]}
            />
            {allProjects.map((projectName, idx) => {
              const isLast = idx === allProjects.length - 1;
              return (
                <Bar
                  key={projectName}
                  dataKey={projectName}
                  stackId="acts"
                  fill={PALETTE[idx % PALETTE.length]}
                  maxBarSize={48}
                  isAnimationActive={false}
                  cursor={drillMonth ? 'default' : 'pointer'}
                  onClick={(entry: ChartEntry) => {
                    if (!drillMonth && typeof entry._key === 'string') setDrillMonth(entry._key);
                  }}
                >
                  {isLast && (
                    <LabelList
                      dataKey="__total__"
                      position="top"
                      style={{ fill: '#E5E7EB', fontSize: 11, fontWeight: 600 }}
                      formatter={(v: number) => (v > 0 ? v.toLocaleString() : '')}
                    />
                  )}
                </Bar>
              );
            })}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <ProjectLegend
        projects={allProjects}
        colors={PALETTE}
        selected={selectedProjects}
        onToggle={toggleProject}
      />

      {/* Breakdown grid — project × period matrix */}
      <BreakdownGrid columns={gridColumns} allProjects={allProjects} selectedProjects={selectedProjects} />
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────────────

export default function ActivationsReport() {
  const { data, isLoading, error } = useActivationsData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin mr-2" />
        Loading activations&hellip;
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 text-red-400 p-4">
        <AlertCircle className="w-5 h-5 flex-shrink-0" />
        <span>{error.message}</span>
      </div>
    );
  }

  const years = data?.data?.years ?? [];
  const allProjects = data?.data?.allProjects ?? [];

  return (
    <ReportTabLayout
      tableContent={<ActivationsTable years={years} allProjects={allProjects} />}
      chartsContent={<ActivationsChart years={years} allProjects={allProjects} />}
    />
  );
}
