/**
 * Bootstock Reports Page
 * ONT and UPS serial stock tracking from FT delivery through installation.
 * Toggle between ONT and UPS views.
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Cpu, BatteryCharging, Loader2, Package, CheckCircle, AlertTriangle, Zap, Download } from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/button';

interface ReconStats {
  total: number;
  available: number;
  issued: number;
  installed: number;
  faulty: number;
  returned: number;
  oesMatched: number;
  waMatched: number;
}

interface ReconRow {
  serial_number: string;
  status: string;
  location_name: string | null;
  wa_drop: string | null;
  oes_drop: string | null;
  activation_date: string | null;
  pp_flagged: boolean;
  pp_date: string | null;
  pp_resolution_status: string | null;
}

export function BootstockReportsPage() {
  const [type, setType] = useState<'ont' | 'ups'>('ont');
  const [stats, setStats] = useState<ReconStats | null>(null);
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [projectFilter, setProjectFilter] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [ppStatus, setPpStatus] = useState('');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, page: String(page), limit: '50', filter: filterMode });
      if (projectFilter) params.set('project', projectFilter);
      if (search) params.set('search', search);
      if (ppStatus && filterMode === 'pp_flagged') params.set('ppStatus', ppStatus);

      const res = await fetch(`/api/procurement/field-stock/serial-recon?${params}`);
      const json = await res.json();
      if (json.success) {
        setStats(json.data.stats);
        setRows(json.data.rows);
        setTotal(json.data.total);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [type, page, projectFilter, filterMode, ppStatus, search]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ type, filter: filterMode });
      if (projectFilter) params.set('project', projectFilter);
      if (search) params.set('search', search);
      if (ppStatus && filterMode === 'pp_flagged') params.set('ppStatus', ppStatus);

      const res = await fetch(`/api/procurement/field-stock/export-serials?${params}`);
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const count = res.headers.get('X-Export-Count') || '?';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bootstock-${type}-${filterMode}-${new Date().toISOString().split('T')[0]}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [type, filterMode, projectFilter, search, ppStatus]);

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-6">
      {/* Toggle ONT / UPS */}
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-semibold text-[var(--ff-text-primary)]">Bootstock Reports</h2>
        <div className="flex bg-[var(--ff-bg-tertiary)] rounded-lg p-1 border border-[var(--ff-border-light)]">
          <button
            onClick={() => { setType('ont'); setPage(1); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              type === 'ont'
                ? 'bg-[var(--ff-accent)] text-white'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <Cpu className="w-4 h-4" />
            ONT Devices
          </button>
          <button
            onClick={() => { setType('ups'); setPage(1); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              type === 'ups'
                ? 'bg-[var(--ff-accent)] text-white'
                : 'text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            <BatteryCharging className="w-4 h-4" />
            UPS Devices
          </button>
        </div>
      </div>

      {/* Summary Cards — clickable to filter */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <StatCard icon={Package} label="Total from FT" value={stats.total} color="text-blue-400" onClick={() => { setFilterMode('all'); setPage(1); }} active={filterMode === 'all'} />
          <StatCard icon={Package} label="In Stock" value={type === 'ont' ? stats.total - stats.oesMatched - ((stats.ppFlagged || 0) - (stats.ppActivated || 0)) : stats.total - stats.waMatched} color="text-green-400" onClick={() => { setFilterMode('not_installed'); setPage(1); }} active={filterMode === 'not_installed'} />
          <StatCard icon={Zap} label="Installed (WA)" value={stats.waMatched} color="text-purple-400" onClick={() => { setFilterMode('installed'); setPage(1); }} active={filterMode === 'installed'} />
          {type === 'ont' && (
            <StatCard icon={CheckCircle} label="Activated (OES)" value={stats.oesMatched} color="text-teal-400" onClick={() => { setFilterMode('activated'); setPage(1); }} active={filterMode === 'activated'} />
          )}
          {type === 'ont' && (
            <StatCard icon={AlertTriangle} label="PP Flagged" value={stats.ppFlagged || 0} color="text-red-400" onClick={() => { setFilterMode('pp_flagged'); setPage(1); }} active={filterMode === 'pp_flagged'} />
          )}
          <StatCard icon={AlertTriangle} label="Not Installed" value={stats.total - stats.waMatched} color="text-amber-400" onClick={() => { setFilterMode('not_installed'); setPage(1); }} active={false} />
          <StatCard
            icon={CheckCircle}
            label="Install Rate"
            value={`${stats.total > 0 ? Math.round((stats.waMatched / stats.total) * 100) : 0}%`}
            color="text-green-400"
          />
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 items-center flex-wrap">
        <select
          value={projectFilter}
          onChange={(e) => { setProjectFilter(e.target.value); setPage(1); }}
          className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-3 py-2 text-sm text-[var(--ff-text-primary)]"
        >
          <option value="">All Projects</option>
          <option value="Lawley">Lawley</option>
          <option value="Mohadin">Mohadin</option>
          <option value="Mamelodi">Mamelodi</option>
          <option value="Tembisa">Tembisa</option>
          <option value="Etwatwa">Etwatwa</option>
        </select>
        <select
          value={filterMode}
          onChange={(e) => { setFilterMode(e.target.value); setPage(1); }}
          className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-3 py-2 text-sm text-[var(--ff-text-primary)]"
        >
          <option value="all">All Serials</option>
          <option value="installed">Installed (has WA DR)</option>
          <option value="not_installed">Not Installed</option>
          {type === 'ont' && <option value="activated">Activated (OES)</option>}
          {type === 'ont' && <option value="pp_flagged">PP Flagged</option>}
        </select>
        {filterMode === 'pp_flagged' && type === 'ont' && (
          <select
            value={ppStatus}
            onChange={(e) => { setPpStatus(e.target.value); setPage(1); }}
            className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-3 py-2 text-sm text-[var(--ff-text-primary)]"
          >
            <option value="">All PP Statuses</option>
            <option value="activated">Activated</option>
            <option value="not_found">Not Found</option>
            <option value="located_1map">Found (1Map)</option>
            <option value="located_unified">Found (Unified)</option>
            <option value="located_local">Found (Local)</option>
            <option value="located_oes">Found (OES)</option>
          </select>
        )}
        <input
          type="text"
          placeholder="Search serial..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-3 py-2 text-sm text-[var(--ff-text-primary)] w-48 focus:outline-none focus:border-[var(--ff-accent)]"
        />
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          {total.toLocaleString()} {type === 'ont' ? 'ONTs' : 'UPS devices'}
        </span>
        <Button
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto"
        >
          <Download className={`w-4 h-4 ${exporting ? 'animate-bounce' : ''}`} />
          {exporting ? 'Exporting...' : 'Export Excel'}
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <LoadingSpinner className="py-12" size="lg" label="" />
      )}

      {/* Per-Project Breakdown */}
      {stats && !loading && !projectFilter && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--ff-border-light)]">
            <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Stock by Project</h3>
          </div>
          <ProjectBreakdown type={type} />
        </div>
      )}

      {/* Serial Detail Table */}
      {!loading && rows.length > 0 && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--ff-border-light)]">
            <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Serial Details</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                  <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Serial</th>
                  <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Project</th>
                  <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">WA DR</th>
                  {type === 'ont' && <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">OES Drop</th>}
                  {type === 'ont' && <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">PP Status</th>}
                  {type === 'ont' && <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Activated</th>}
                  <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                    <td className="px-4 py-2 font-mono text-xs text-[var(--ff-text-primary)]">{row.serial_number}</td>
                    <td className="px-4 py-2 text-[var(--ff-text-secondary)]">{row.location_name || '\u2014'}</td>
                    <td className="px-4 py-2 text-[var(--ff-text-primary)]">{row.wa_drop || '\u2014'}</td>
                    {type === 'ont' && <td className="px-4 py-2 text-[var(--ff-text-primary)]">{row.oes_drop || '\u2014'}</td>}
                    {type === 'ont' && (
                      <td className="px-4 py-2">
                        {row.pp_resolution_status ? (
                          <PpBadge status={row.pp_resolution_status} />
                        ) : row.pp_flagged ? (
                          <span className="text-xs text-amber-400">PP</span>
                        ) : '\u2014'}
                      </td>
                    )}
                    {type === 'ont' && <td className="px-4 py-2 text-[var(--ff-text-secondary)] text-xs">{row.activation_date || '\u2014'}</td>}
                    <td className="px-4 py-2">
                      <StatusBadge status={row.wa_drop ? 'installed' : row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--ff-border-light)]">
              <span className="text-xs text-[var(--ff-text-tertiary)]">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50 text-[var(--ff-text-secondary)]">Prev</button>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50 text-[var(--ff-text-secondary)]">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color, onClick, active }: { icon: React.ElementType; label: string; value: number | string; color: string; onClick?: () => void; active?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`bg-[var(--ff-bg-secondary)] rounded-lg p-4 border transition-colors ${
        active ? 'border-[var(--ff-accent)] ring-1 ring-[var(--ff-accent)]' : 'border-[var(--ff-border-light)]'
      } ${onClick ? 'cursor-pointer hover:border-[var(--ff-accent)]' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-[var(--ff-text-secondary)]">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string }> = {
    available: { bg: 'bg-green-500/10', text: 'text-green-400' },
    issued: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
    installed: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
    faulty: { bg: 'bg-red-500/10', text: 'text-red-400' },
    returned: { bg: 'bg-amber-500/10', text: 'text-amber-400' },
  };
  const c = config[status] || { bg: 'bg-gray-500/10', text: 'text-gray-400' };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {status}
    </span>
  );
}

function PpBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    activated: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Activated' },
    not_found: { bg: 'bg-red-500/10', text: 'text-red-400', label: 'Not Found' },
    located_1map: { bg: 'bg-blue-500/10', text: 'text-blue-400', label: 'Found (1Map)' },
    located_unified: { bg: 'bg-purple-500/10', text: 'text-purple-400', label: 'Found (Unified)' },
    located_local: { bg: 'bg-teal-500/10', text: 'text-teal-400', label: 'Found (Local)' },
    located_oes: { bg: 'bg-green-500/10', text: 'text-green-400', label: 'Found (OES)' },
  };
  const c = config[status] || { bg: 'bg-gray-500/10', text: 'text-gray-400', label: status };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  );
}

function ProjectBreakdown({ type }: { type: 'ont' | 'ups' }) {
  const [data, setData] = useState<Array<{ project: string; total: number; available: number; waMatched: number; oesMatched: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const projects = ['Lawley', 'Mohadin', 'Mamelodi', 'Tembisa', 'Etwatwa'];
        const results = await Promise.all(
          projects.map(async (p) => {
            const res = await fetch(`/api/procurement/field-stock/serial-recon?type=${type}&project=${p}&limit=1`);
            const json = await res.json();
            if (!json.success) return null;
            return {
              project: p,
              total: json.data.stats.total,
              available: json.data.stats.available,
              waMatched: json.data.stats.waMatched,
              oesMatched: json.data.stats.oesMatched,
            };
          })
        );
        setData(results.filter(Boolean) as any[]);
      } finally {
        setLoading(false);
      }
    })();
  }, [type]);

  if (loading) return <LoadingSpinner className="p-4 min-h-[80px]" size="sm" label="" />;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
          <th className="text-left px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Project</th>
          <th className="text-right px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Total</th>
          <th className="text-right px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Available</th>
          <th className="text-right px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Installed (WA)</th>
          {type === 'ont' && <th className="text-right px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Activated (OES)</th>}
          <th className="text-right px-4 py-2 text-[var(--ff-text-secondary)] font-medium">Install %</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.project} className="border-b border-[var(--ff-border-light)]">
            <td className="px-4 py-2 text-[var(--ff-text-primary)] font-medium">{row.project}</td>
            <td className="px-4 py-2 text-right text-[var(--ff-text-primary)]">{row.total.toLocaleString()}</td>
            <td className="px-4 py-2 text-right text-green-400">{row.available.toLocaleString()}</td>
            <td className="px-4 py-2 text-right text-purple-400">{row.waMatched.toLocaleString()}</td>
            {type === 'ont' && <td className="px-4 py-2 text-right text-teal-400">{row.oesMatched.toLocaleString()}</td>}
            <td className="px-4 py-2 text-right text-[var(--ff-text-primary)]">
              {row.total > 0 ? Math.round((row.waMatched / row.total) * 100) : 0}%
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
