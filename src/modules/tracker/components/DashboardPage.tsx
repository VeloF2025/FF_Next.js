'use client';

import { useState, useEffect } from 'react';
import { BarChart3, CheckCircle2, Zap } from 'lucide-react';
import { log } from '@/lib/logger';

interface ProjectKpi {
  project_id: string;
  project_name: string;
  total_pons: number;
  permissions_approved: number;
  permissions_total: number;
  poles_planted: number;
  poles_total: number;
  cwc_complete: number;
  cwc_total: number;
  optical_complete: number;
  optical_total: number;
  atp_passed: number;
  atp_total: number;
  activation_complete: number;
  activation_total: number;
  pons_complete: number;
  sign_ups: number;
  homes_po: number;
  last_synced_at: string | null;
}

function pct(n: number, d: number): string {
  if (!d) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

export function DashboardPage() {
  const [projects, setProjects] = useState<ProjectKpi[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tracker/dashboard')
      .then((r) => r.json() as Promise<{ data?: ProjectKpi[] }>)
      .then((j) => setProjects(j.data ?? []))
      .catch((err: unknown) => log.error('DashboardPage: fetch failed', { err }, 'tracker'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-16 text-center text-slate-500">Loading dashboard…</div>;
  if (projects.length === 0) return <div className="py-16 text-center text-slate-500">No active projects.</div>;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <BarChart3 className="w-5 h-5 text-blue-400" />
        <h2 className="text-base font-semibold text-slate-100">Cross-project Overview</h2>
        <span className="text-xs text-slate-500">{projects.length} active projects</span>
      </div>

      <div className="overflow-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-slate-800/80 text-slate-300 text-xs">
              <th className="px-4 py-2.5 text-left font-medium">Project</th>
              <th className="px-4 py-2.5 text-right font-medium">PONs</th>
              <th className="px-4 py-2.5 text-right font-medium">Done</th>
              <th className="px-4 py-2.5 text-right font-medium">Perms</th>
              <th className="px-4 py-2.5 text-right font-medium">Poles</th>
              <th className="px-4 py-2.5 text-right font-medium">CWC</th>
              <th className="px-4 py-2.5 text-right font-medium">Optical</th>
              <th className="px-4 py-2.5 text-right font-medium">ATP</th>
              <th className="px-4 py-2.5 text-right font-medium">Activated</th>
              <th className="px-4 py-2.5 text-right font-medium">Sign-ups</th>
              <th className="px-4 py-2.5 text-left font-medium">Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p, i) => (
              <tr
                key={p.project_id}
                className={`border-t border-slate-700/40 hover:bg-slate-800/40 ${i % 2 !== 0 ? 'bg-slate-800/20' : ''}`}
              >
                <td className="px-4 py-3 font-medium text-slate-200">{p.project_name}</td>
                <td className="px-4 py-3 text-right text-slate-400">{p.total_pons}</td>
                <td className="px-4 py-3 text-right">
                  <span className="flex items-center justify-end gap-1 text-green-400">
                    <CheckCircle2 className="w-3 h-3" />
                    {p.pons_complete}
                    <span className="text-slate-500 text-xs">/{p.total_pons}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.permissions_approved, p.permissions_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.poles_planted, p.poles_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.cwc_complete, p.cwc_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.optical_complete, p.optical_total)}</td>
                <td className="px-4 py-3 text-right text-slate-400">{pct(p.atp_passed, p.atp_total)}</td>
                <td className="px-4 py-3 text-right">
                  <span className="flex items-center justify-end gap-1 text-violet-400">
                    <Zap className="w-3 h-3" />
                    {pct(p.activation_complete, p.activation_total)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-slate-400">{p.sign_ups || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {p.last_synced_at
                    ? new Date(p.last_synced_at).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: '2-digit' })
                    : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
