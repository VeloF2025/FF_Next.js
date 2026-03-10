/**
 * BOQSpendSummary — Cross-project BOQ spend overview.
 * Shows spend vs BOQ value for all projects with active BOQs.
 */

import { useEffect, useState } from 'react';
import { Loader2, TrendingUp, AlertTriangle } from 'lucide-react';
import { log } from '@/lib/logger';

interface ProjectSpend {
  projectId: string;
  projectName: string;
  boqVersion: string;
  boqLineCount: number;
  boqValue: number;
  totalOrdered: number;
  confirmedSpend: number;
  remainingBudget: number;
  orderedPercent: number;
  confirmedPercent: number;
  poCount: number;
}

interface Totals {
  boqValue: number;
  totalOrdered: number;
  confirmedSpend: number;
}

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

function ProgressBar({ ordered, confirmed, total }: { ordered: number; confirmed: number; total: number }) {
  if (total <= 0) return <div className="h-2 bg-[var(--ff-bg-tertiary)] rounded-full" />;
  const ordPct = Math.min((ordered / total) * 100, 100);
  const confPct = Math.min((confirmed / total) * 100, 100);
  const overBudget = ordered > total;

  return (
    <div className="relative h-2 rounded-full overflow-hidden" style={{ background: overBudget ? 'rgba(239,68,68,0.15)' : 'var(--ff-bg-tertiary)' }}>
      <div
        className="absolute inset-y-0 left-0 transition-all"
        style={{ width: `${ordPct}%`, background: overBudget ? 'rgba(239,68,68,0.4)' : 'rgba(168,85,247,0.35)' }}
      />
      <div
        className="absolute inset-y-0 left-0 bg-green-500 transition-all"
        style={{ width: `${confPct}%` }}
      />
    </div>
  );
}

export function BOQSpendSummary() {
  const [projects, setProjects] = useState<ProjectSpend[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/procurement/boq-spend-summary');
        const json = await res.json() as {
          success: boolean;
          data?: { projects: ProjectSpend[]; totals: Totals };
          error?: { message: string };
        };
        if (json.success && json.data) {
          setProjects(json.data.projects);
          setTotals(json.data.totals);
        } else {
          setError(json.error?.message ?? 'Failed to load');
        }
      } catch (err) {
        log.error('BOQSpendSummary load failed', { err }, 'BOQSpendSummary');
        setError('Failed to load BOQ spend data');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin text-purple-500" />
        <span className="ml-2 text-sm text-[var(--ff-text-secondary)]">Loading BOQ spend...</span>
      </div>
    );
  }

  if (error) {
    return <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{error}</div>;
  }

  if (!totals || projects.length === 0) {
    return <div className="text-center py-8 text-[var(--ff-text-tertiary)] text-sm">No active BOQs found.</div>;
  }

  const overallOrdPct = totals.boqValue > 0 ? Math.round((totals.totalOrdered / totals.boqValue) * 100) : 0;
  const overallConfPct = totals.boqValue > 0 ? Math.round((totals.confirmedSpend / totals.boqValue) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Total BOQ Budget</p>
          <p className="text-xl font-bold text-[var(--ff-text-primary)]">{fmtZAR(totals.boqValue)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{projects.length} projects</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-purple-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Total Ordered</p>
          <p className="text-xl font-bold text-purple-400">{fmtZAR(totals.totalOrdered)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{overallOrdPct}% of budget</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-green-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Confirmed Spend</p>
          <p className="text-xl font-bold text-green-400">{fmtZAR(totals.confirmedSpend)}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{overallConfPct}% of budget</p>
        </div>
        <div className="bg-[var(--ff-bg-secondary)] border border-amber-500/30 rounded-lg p-4">
          <p className="text-xs text-[var(--ff-text-tertiary)] uppercase tracking-wide mb-1">Remaining Budget</p>
          <p className="text-xl font-bold text-amber-400">{fmtZAR(Math.max(0, totals.boqValue - totals.totalOrdered))}</p>
          <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">{100 - overallOrdPct}% unallocated</p>
        </div>
      </div>

      {/* Overall progress */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg px-4 py-3">
        <div className="flex justify-between text-xs text-[var(--ff-text-tertiary)] mb-1.5">
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />
            Confirmed {overallConfPct}%
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-purple-500/40 mr-1" />
            Ordered {overallOrdPct}%
          </span>
        </div>
        <ProgressBar ordered={totals.totalOrdered} confirmed={totals.confirmedSpend} total={totals.boqValue} />
      </div>

      {/* Project Table */}
      <div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--ff-border-light)]">
          <TrendingUp className="h-4 w-4 text-purple-400" />
          <h4 className="text-sm font-medium text-[var(--ff-text-primary)]">BOQ Spend by Project</h4>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">Project</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">BOQ Budget</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-purple-400/80 uppercase">Ordered</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-green-400/80 uppercase">Confirmed</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-amber-400/80 uppercase">Remaining</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-[var(--ff-text-tertiary)] uppercase w-44">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ff-border-light)]">
              {projects.map((p) => {
                const overBudget = p.totalOrdered > p.boqValue;
                return (
                  <tr key={p.projectId} className="hover:bg-[var(--ff-bg-hover)] transition-colors">
                    <td className="px-4 py-3">
                      <div className="text-[var(--ff-text-primary)] font-medium">{p.projectName}</div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">
                        v{p.boqVersion} · {p.boqLineCount} items · {p.poCount} POs
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-[var(--ff-text-primary)] font-medium">{fmtZAR(p.boqValue)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={overBudget ? 'text-red-400 font-semibold' : 'text-purple-400'}>
                        {fmtZAR(p.totalOrdered)}
                      </span>
                      {overBudget && (
                        <div className="flex items-center justify-end gap-1 text-xs text-red-400 mt-0.5">
                          <AlertTriangle className="h-3 w-3" />
                          {p.orderedPercent}%
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-green-400">{fmtZAR(p.confirmedSpend)}</td>
                    <td className="px-4 py-3 text-right text-[var(--ff-text-secondary)]">{fmtZAR(p.remainingBudget)}</td>
                    <td className="px-4 py-3">
                      <ProgressBar ordered={p.totalOrdered} confirmed={p.confirmedSpend} total={p.boqValue} />
                      <div className="text-[10px] text-[var(--ff-text-tertiary)] mt-1">
                        {p.confirmedPercent}% confirmed · {p.orderedPercent}% ordered
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

            <tfoot>
              <tr className="border-t-2 border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                <td className="px-4 py-3 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase">
                  Total ({projects.length} projects)
                </td>
                <td className="px-4 py-3 text-right font-semibold text-[var(--ff-text-primary)]">{fmtZAR(totals.boqValue)}</td>
                <td className="px-4 py-3 text-right font-semibold text-purple-400">{fmtZAR(totals.totalOrdered)}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-400">{fmtZAR(totals.confirmedSpend)}</td>
                <td className="px-4 py-3 text-right font-semibold text-[var(--ff-text-secondary)]">
                  {fmtZAR(Math.max(0, totals.boqValue - totals.totalOrdered))}
                </td>
                <td className="px-4 py-3">
                  <ProgressBar ordered={totals.totalOrdered} confirmed={totals.confirmedSpend} total={totals.boqValue} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
