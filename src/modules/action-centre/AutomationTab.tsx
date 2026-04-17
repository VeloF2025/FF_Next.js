/**
 * Action Centre — Automation tab
 *
 * Operator-facing view of the rule engine + recon crons: last runs,
 * per-rule watermarks, 24h totals, any errors. Read-only.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw, Zap } from 'lucide-react';

interface RuleRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  dryRun: boolean;
  eventsProcessed: number;
  actionsTaken: number;
  rulesSummary: Record<string, { processed: number; actions: number }>;
  errors: Array<{ rule: string; message: string }>;
}

interface Checkpoint {
  ruleName: string;
  lastEventAt: string | null;
  updatedAt: string;
}

interface RuleRunsResponse {
  recentRuns: RuleRun[];
  checkpoints: Checkpoint[];
  last24h: {
    runs: number;
    eventsProcessed: number;
    actionsTaken: number;
    runsWithErrors: number;
    dryRuns: number;
  };
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function fmtDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return 'in progress';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export function AutomationTab() {
  const [data, setData] = useState<RuleRunsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/activate/action-centre/rule-runs');
      const j = await res.json();
      if (j.success) setData(j.data as RuleRunsResponse);
      else setError(j.error?.message ?? 'Failed to load rule runs');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rule runs');
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-[var(--ff-text-tertiary)] flex-1">
          Rule engine runs every 5 minutes (auto-close + dispute flagging). Weekly recon runs Mondays 04:00 UTC
          (persistent-note, maintenance reopens, stale PP, tech on site).
        </p>
        <button
          onClick={refresh}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-tertiary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Last 24h cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          icon={<Zap className="w-4 h-4 text-blue-400" />}
          label="Runs (24h)"
          value={data?.last24h.runs ?? null}
          loading={loading}
        />
        <StatCard
          icon={<Clock className="w-4 h-4 text-purple-400" />}
          label="Events processed (24h)"
          value={data?.last24h.eventsProcessed ?? null}
          loading={loading}
        />
        <StatCard
          icon={<Zap className="w-4 h-4 text-green-400" />}
          label="Actions taken (24h)"
          value={data?.last24h.actionsTaken ?? null}
          loading={loading}
        />
        <StatCard
          icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          label="Runs with errors (24h)"
          value={data?.last24h.runsWithErrors ?? null}
          loading={loading}
          highlight={(data?.last24h.runsWithErrors ?? 0) > 0}
        />
        <StatCard
          icon={<RefreshCw className="w-4 h-4 text-yellow-400" />}
          label="Dry-runs (24h)"
          value={data?.last24h.dryRuns ?? null}
          loading={loading}
        />
      </div>

      {/* Per-rule watermarks */}
      <section>
        <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">Per-rule watermarks</h3>
        {loading ? (
          <p className="text-sm text-[var(--ff-text-tertiary)]">Loading…</p>
        ) : data?.checkpoints.length === 0 ? (
          <p className="text-sm text-[var(--ff-text-tertiary)]">No checkpoints yet — rule engine has not run.</p>
        ) : (
          <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr className="text-left text-[var(--ff-text-tertiary)] text-xs uppercase tracking-wide">
                  <th className="px-3 py-2">Rule</th>
                  <th className="px-3 py-2">Last event processed</th>
                  <th className="px-3 py-2">Watermark updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {data?.checkpoints.map((c) => (
                  <tr key={c.ruleName} className="hover:bg-[var(--ff-bg-secondary)]">
                    <td className="px-3 py-2 font-mono text-xs">{c.ruleName}</td>
                    <td className="px-3 py-2">{fmtTime(c.lastEventAt)}</td>
                    <td className="px-3 py-2 text-[var(--ff-text-tertiary)]">{fmtTime(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent runs */}
      <section>
        <h3 className="text-sm font-medium text-[var(--ff-text-secondary)] mb-2">Recent runs</h3>
        {loading ? (
          <p className="text-sm text-[var(--ff-text-tertiary)]">Loading…</p>
        ) : (data?.recentRuns.length ?? 0) === 0 ? (
          <p className="text-sm text-[var(--ff-text-tertiary)]">No runs yet.</p>
        ) : (
          <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr className="text-left text-[var(--ff-text-tertiary)] text-xs uppercase tracking-wide">
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Mode</th>
                  <th className="px-3 py-2 text-right">Events</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                  <th className="px-3 py-2">Per-rule</th>
                  <th className="px-3 py-2">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {data?.recentRuns.map((r) => {
                  const errCount = r.errors.length;
                  const ruleSummary = Object.entries(r.rulesSummary)
                    .map(([name, s]) => `${name}: ${s.actions}/${s.processed}`)
                    .join(', ');
                  return (
                    <tr key={r.id} className="hover:bg-[var(--ff-bg-secondary)]">
                      <td className="px-3 py-2 whitespace-nowrap">{fmtTime(r.startedAt)}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-tertiary)] whitespace-nowrap">
                        {fmtDuration(r.startedAt, r.completedAt)}
                      </td>
                      <td className="px-3 py-2">
                        {r.dryRun ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 uppercase tracking-wide">
                            dry
                          </span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-wide">
                            live
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.eventsProcessed}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{r.actionsTaken}</td>
                      <td className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">{ruleSummary || '—'}</td>
                      <td className="px-3 py-2">
                        {errCount > 0 ? (
                          <span
                            className="inline-flex items-center gap-1 text-red-400 text-xs cursor-help"
                            title={r.errors.map((e) => `${e.rule}: ${e.message}`).join('\n')}
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {errCount}
                          </span>
                        ) : (
                          <span className="text-[var(--ff-text-tertiary)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  loading,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`border rounded-lg p-3 ${
        highlight
          ? 'bg-red-500/10 border-red-500/20'
          : 'bg-[var(--ff-bg-secondary)] border-[var(--ff-border-light)]'
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ff-text-tertiary)] uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold text-[var(--ff-text-primary)] tabular-nums mt-0.5">
        {loading ? '—' : (value ?? 0).toLocaleString()}
      </p>
    </div>
  );
}
