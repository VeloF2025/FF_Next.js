/**
 * Fleet Mileage Report Page
 * Company-wide and project-level vehicle mileage with Excel export
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { fleetConfig } from '@/modules/navigation';
import { notificationService } from '@/services/core/NotificationService';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Gauge,
  Car,
  Download,
  RefreshCw,
  AlertTriangle,
  ArrowUpDown,
  FolderKanban,
} from 'lucide-react';
import type { MileagePeriod, MileageReport, ProjectMileageSummary } from '@/modules/fleet/types';

type SortKey = 'registration' | 'totalKm' | 'readingsCount' | 'averagePerDay';
type SortDir = 'asc' | 'desc';

function formatNumber(num: number): string {
  return num.toLocaleString('en-ZA');
}

function getDefaultDates(period: MileagePeriod): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  switch (period) {
    case 'daily': start.setDate(start.getDate() - 30); break;
    case 'weekly': start.setDate(start.getDate() - 91); break;
    case 'monthly': default: start.setFullYear(start.getFullYear() - 1); break;
  }
  return {
    startDate: start.toISOString().split('T')[0]!,
    endDate: end.toISOString().split('T')[0]!,
  };
}

export default function FleetMileagePage() {
  const [period, setPeriod] = useState<MileagePeriod>('monthly');
  const [startDate, setStartDate] = useState(() => getDefaultDates('monthly').startDate);
  const [endDate, setEndDate] = useState(() => getDefaultDates('monthly').endDate);
  const [projectId, setProjectId] = useState<string>('');
  const [report, setReport] = useState<MileageReport | null>(null);
  const [projects, setProjects] = useState<ProjectMileageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('totalKm');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Fetch project summaries on mount
  useEffect(() => {
    fetch('/api/fleet/mileage/project-summaries')
      .then(r => r.json())
      .then(data => { if (data.data) setProjects(data.data); })
      .catch(() => { /* non-critical: project dropdown won't populate */ });
  }, []);

  // Fetch mileage data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ period, startDate, endDate });
      if (projectId) params.set('projectId', projectId);
      const res = await fetch(`/api/fleet/mileage?${params}`);
      if (!res.ok) throw new Error('Failed to fetch mileage data');
      const data = await res.json();
      setReport(data.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load';
      setError(msg);
      notificationService.error(msg);
    } finally {
      setLoading(false);
    }
  }, [period, startDate, endDate, projectId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Export
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ period, startDate, endDate });
      if (projectId) params.set('projectId', projectId);
      const res = await fetch(`/api/fleet/mileage/export?${params}`);
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fleet-mileage-${period}-${startDate}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      notificationService.success('Mileage report downloaded');
    } catch (err) {
      notificationService.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Sorting
  const handleSort = (key: SortKey) => {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }
    else { setSortKey(key); setSortDir('desc'); }
  };

  const sortedVehicles = useMemo(() => {
    if (!report) return [];
    return [...report.vehicles].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const numA = (aVal as number) || 0;
      const numB = (bVal as number) || 0;
      return sortDir === 'asc' ? numA - numB : numB - numA;
    });
  }, [report, sortKey, sortDir]);

  const chartData = useMemo(() => {
    if (!report) return [];
    return report.periodBreakdown.map(p => ({ period: p.periodLabel, km: p.totalKm }));
  }, [report]);

  const activeVehicles = report?.vehicles.filter(v => v.readingsCount > 0).length || 0;

  return (
    <AppLayout>
      <ModulePage config={fleetConfig}>
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)] flex items-center gap-2">
                <Gauge className="w-7 h-7 text-[var(--ff-primary)]" />
                Mileage Report
              </h1>
              <p className="text-[var(--ff-text-secondary)]">
                {report?.projectName ? `Project: ${report.projectName}` : 'All Vehicles'} &bull; {startDate} to {endDate}
              </p>
            </div>
            <button
              onClick={handleExport}
              disabled={exporting || !report}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-end gap-3 bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
            <div>
              <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Period</label>
              <select
                value={period}
                onChange={e => {
                  const p = e.target.value as MileagePeriod;
                  setPeriod(p);
                  if (p !== 'custom') {
                    const d = getDefaultDates(p);
                    setStartDate(d.startDate);
                    setEndDate(d.endDate);
                  }
                }}
                className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom Range</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={e => { setStartDate(e.target.value); if (period !== 'custom') setPeriod('custom'); }}
                className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={e => { setEndDate(e.target.value); if (period !== 'custom') setPeriod('custom'); }}
                className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {projects.length > 0 && (
              <div>
                <label className="block text-xs text-[var(--ff-text-secondary)] mb-1">Project</label>
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  className="px-3 py-2 bg-[#1a1d23] text-white border border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Projects</option>
                  {projects.map(p => (
                    <option key={p.projectId} value={p.projectId}>{p.projectCode} — {p.projectName}</option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={fetchData} className="px-3 py-2 text-[var(--ff-text-secondary)] hover:text-white transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <span className="text-red-300">{error}</span>
            </div>
          )}

          {/* KPI Cards */}
          {report && !loading && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard icon={Gauge} label="Fleet Total" value={`${formatNumber(report.fleetTotalKm)} km`} />
              <KPICard icon={Car} label="Avg per Vehicle" value={`${formatNumber(report.fleetAveragePerVehicle)} km`} />
              <KPICard icon={Car} label="Vehicles with Data" value={`${activeVehicles} / ${report.vehicles.length}`} />
              <KPICard icon={FolderKanban} label="Period" value={`${period === 'custom' ? 'Custom' : period.charAt(0).toUpperCase() + period.slice(1)}`} />
            </div>
          )}

          {/* Table */}
          {report && !loading && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <SortHeader label="Registration" sortKey="registration" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Make / Model</th>
                    <SortHeader label="Total KM" sortKey="totalKm" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader label="Readings" sortKey="readingsCount" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <SortHeader label="Avg KM/Day" sortKey="averagePerDay" currentKey={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Latest Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedVehicles.map(v => (
                    <tr key={v.vehicleId} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                      <td className="py-3 px-4 font-medium text-[var(--ff-text-primary)]">{v.registration}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                        {[v.make, v.model, v.year].filter(Boolean).join(' ') || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-[var(--ff-text-primary)]">{formatNumber(v.totalKm)}</td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-secondary)]">{v.readingsCount}</td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-secondary)]">{formatNumber(v.averagePerDay)}</td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-secondary)]">{formatNumber(v.latestReading)}</td>
                    </tr>
                  ))}
                  {sortedVehicles.length === 0 && (
                    <tr><td colSpan={6} className="py-8 text-center text-[var(--ff-text-secondary)]">No mileage data for this period</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Period Chart */}
          {chartData.length > 0 && !loading && (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-6 border border-[var(--ff-border-light)]">
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">
                KM per {period === 'daily' ? 'Day' : period === 'weekly' ? 'Week' : period === 'monthly' ? 'Month' : 'Period'}
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ff-border-light)" />
                    <XAxis dataKey="period" tick={{ fill: 'var(--ff-text-secondary)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'var(--ff-text-secondary)' }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value) => [`${formatNumber(Number(value))} km`, 'Distance']}
                      contentStyle={{ backgroundColor: 'var(--ff-bg-secondary)', border: '1px solid var(--ff-border-light)', borderRadius: '8px' }}
                    />
                    <Bar dataKey="km" fill="#8B5CF6" radius={[4, 4, 0, 0]} name="KM Travelled" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Project Summary Cards (when not filtering by project) */}
          {!projectId && projects.length > 0 && !loading && (
            <div>
              <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-3">Mileage by Project</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {projects.map(p => (
                  <button
                    key={p.projectId}
                    onClick={() => setProjectId(p.projectId)}
                    className="text-left bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)] hover:border-[var(--ff-primary)] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-[var(--ff-primary)]">{p.projectCode}</span>
                      <span className="text-xs text-[var(--ff-text-tertiary)]">{p.vehicleCount} vehicles</span>
                    </div>
                    <div className="font-medium text-[var(--ff-text-primary)] text-sm mb-1">{p.projectName}</div>
                    <div className="text-lg font-bold text-[var(--ff-text-primary)]">{formatNumber(p.totalKm)} km</div>
                    <div className="text-xs text-[var(--ff-text-tertiary)]">Avg {formatNumber(p.averagePerVehicle)} km/vehicle</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading overlay */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <RefreshCw className="w-8 h-8 text-[var(--ff-primary)] animate-spin" />
            </div>
          )}
        </div>
      </ModulePage>
    </AppLayout>
  );
}

// --- Sub-components ---

function KPICard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="bg-[var(--ff-bg-secondary)] rounded-lg p-4 border border-[var(--ff-border-light)]">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-[var(--ff-primary)]" />
        <span className="text-xs text-[var(--ff-text-secondary)]">{label}</span>
      </div>
      <p className="text-xl font-bold text-[var(--ff-text-primary)]">{value}</p>
    </div>
  );
}

function SortHeader({
  label, sortKey: key, currentKey, dir, onSort, align = 'left',
}: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir;
  onSort: (key: SortKey) => void; align?: 'left' | 'right';
}) {
  const active = key === currentKey;
  return (
    <th
      className={`py-3 px-4 text-[var(--ff-text-secondary)] font-medium cursor-pointer hover:text-white transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(key)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? 'text-[var(--ff-primary)]' : 'opacity-40'}`} />
        {active && <span className="text-[10px] text-[var(--ff-primary)]">{dir === 'asc' ? '\u25B2' : '\u25BC'}</span>}
      </span>
    </th>
  );
}
