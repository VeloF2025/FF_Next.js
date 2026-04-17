/**
 * Action Centre — Disputes tab
 *
 * Workflow view for deductions currently flagged as dispute candidates
 * (resolution_status IN 'disputing','disputed','acknowledged'). Each
 * row can be marked with an outcome (won / lost / partial) or withdrawn.
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle, XCircle, Undo2, Scale } from 'lucide-react';

interface DisputeRow {
  deductionId: string;
  drNumber: string;
  noteCode: string;
  project: string | null;
  team: string | null;
  weekEnding: string;
  ftSerial: string | null;
  oesSerial: string | null;
  oesActivatedAt: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  ticketId: string | null;
  ticketUid: string | null;
  resolutionStatus: string;
  disputeReason: string | null;
  disputeOutcome: 'won' | 'lost' | 'partial' | null;
  disputeOpenedAt: string | null;
  weeksFlagged: number;
}

interface Breakdown {
  disputing: number;
  disputed: number;
  acknowledged: number;
  won: number;
  lost: number;
  no_outcome: number;
}

interface Response {
  count: number;
  breakdown: Breakdown;
  items: DisputeRow[];
}

export function DisputesTab() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'none' | 'won' | 'lost' | 'partial'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (outcomeFilter !== 'all') params.set('outcome', outcomeFilter);
      params.set('limit', '300');
      const res = await fetch(`/api/activate/action-centre/disputes?${params.toString()}`);
      const j = await res.json();
      if (j.success) setData(j.data as Response);
      else setError(j.error?.message ?? 'Failed to load disputes');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load disputes');
    }
  }, [search, outcomeFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await fetchAll();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  const markOutcome = async (
    deductionId: string,
    outcome: 'won' | 'lost' | 'partial',
  ) => {
    if (busyId) return;
    setBusyId(deductionId);
    try {
      await fetch('/api/activate/action-centre/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deductionId, action: 'mark_outcome', outcome }),
      });
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark outcome');
    } finally {
      setBusyId(null);
    }
  };

  const withdraw = async (deductionId: string) => {
    if (busyId) return;
    setBusyId(deductionId);
    try {
      await fetch('/api/activate/action-centre/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deductionId, action: 'withdraw' }),
      });
      await fetchAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to withdraw');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-[var(--ff-text-tertiary)] flex-1 min-w-[16rem]">
          Deductions flagged for dispute with Fibertime. Set outcomes after each weekly meeting to track win rate.
        </p>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Breakdown cards + outcome filter */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <BreakdownChip
            active={outcomeFilter === 'all'}
            label="All"
            count={data.count}
            color="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)]"
            onClick={() => setOutcomeFilter('all')}
          />
          <BreakdownChip
            active={outcomeFilter === 'none'}
            label="Open (no outcome)"
            count={data.breakdown.no_outcome}
            color="bg-blue-500/10 text-blue-400 border-blue-500/20"
            onClick={() => setOutcomeFilter('none')}
          />
          <BreakdownChip
            active={outcomeFilter === 'won'}
            label="Won"
            count={data.breakdown.won}
            color="bg-green-500/10 text-green-400 border-green-500/20"
            onClick={() => setOutcomeFilter('won')}
          />
          <BreakdownChip
            active={outcomeFilter === 'lost'}
            label="Lost"
            count={data.breakdown.lost}
            color="bg-red-500/10 text-red-400 border-red-500/20"
            onClick={() => setOutcomeFilter('lost')}
          />
          <BreakdownChip
            active={outcomeFilter === 'partial'}
            label="Partial"
            count={(data.items || []).filter((i) => i.disputeOutcome === 'partial').length}
            color="bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
            onClick={() => setOutcomeFilter('partial')}
          />
          <BreakdownChip
            active={false}
            label="Win rate"
            count={winRate(data.breakdown)}
            suffix="%"
            color="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)]"
          />
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search DR or serial…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
        />
        <span className="text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap">
          {loading ? 'Loading…' : `${data?.items.length ?? 0} rows`}
        </span>
      </div>

      {!loading && (data?.items.length ?? 0) === 0 ? (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          No disputes match the current filters.
        </div>
      ) : (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr className="text-left text-[var(--ff-text-tertiary)] text-xs uppercase tracking-wide">
                  <th className="px-3 py-2">DR</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Week</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">FT billed</th>
                  <th className="px-3 py-2">OES</th>
                  <th className="px-3 py-2">Last fix</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Outcome</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {data?.items.map((r) => (
                  <tr key={r.deductionId} className="hover:bg-[var(--ff-bg-secondary)]">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`/activate/qa-centre/${r.drNumber}`}
                        className="font-medium text-[var(--ff-text-primary)] hover:text-blue-400"
                      >
                        {r.drNumber}
                      </a>
                      {r.ticketUid && (
                        <a
                          href={`/noc/tickets/${r.ticketId}`}
                          className="ml-2 text-[11px] text-blue-400 hover:underline"
                        >
                          {r.ticketUid}
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 uppercase text-xs">{r.noteCode}</td>
                    <td className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">{r.weekEnding}</td>
                    <td className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">{r.project ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.ftSerial ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.oesSerial ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.lastFixSerial ? (
                        <span>
                          {r.lastFixSerial}
                          <span className="block text-[10px] text-[var(--ff-text-tertiary)]">
                            {r.lastFixAt ? new Date(r.lastFixAt).toISOString().slice(0, 10) : ''}
                          </span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)] max-w-[14rem] truncate">
                      {r.disputeReason ?? '—'}
                    </td>
                    <td className="px-3 py-2">
                      <OutcomeBadge outcome={r.disputeOutcome} status={r.resolutionStatus} />
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {r.disputeOutcome ? (
                        <span className="text-[11px] text-[var(--ff-text-tertiary)]">locked</span>
                      ) : (
                        <div className="inline-flex items-center gap-1">
                          <ActionButton
                            onClick={() => markOutcome(r.deductionId, 'won')}
                            disabled={busyId !== null}
                            title="Mark dispute won"
                            icon={<CheckCircle className="w-3.5 h-3.5" />}
                            color="text-green-400 hover:bg-green-500/10"
                          />
                          <ActionButton
                            onClick={() => markOutcome(r.deductionId, 'partial')}
                            disabled={busyId !== null}
                            title="Mark partial"
                            icon={<Scale className="w-3.5 h-3.5" />}
                            color="text-yellow-400 hover:bg-yellow-500/10"
                          />
                          <ActionButton
                            onClick={() => markOutcome(r.deductionId, 'lost')}
                            disabled={busyId !== null}
                            title="Mark dispute lost"
                            icon={<XCircle className="w-3.5 h-3.5" />}
                            color="text-red-400 hover:bg-red-500/10"
                          />
                          <ActionButton
                            onClick={() => withdraw(r.deductionId)}
                            disabled={busyId !== null}
                            title="Withdraw dispute (back to open)"
                            icon={<Undo2 className="w-3.5 h-3.5" />}
                            color="text-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-tertiary)]"
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function winRate(b: Breakdown): number {
  const decided = b.won + b.lost;
  if (decided === 0) return 0;
  return Math.round((b.won / decided) * 100);
}

function OutcomeBadge({
  outcome,
  status,
}: {
  outcome: 'won' | 'lost' | 'partial' | null;
  status: string;
}) {
  if (outcome === 'won')
    return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20 uppercase tracking-wide">Won</span>;
  if (outcome === 'lost')
    return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20 uppercase tracking-wide">Lost</span>;
  if (outcome === 'partial')
    return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/20 uppercase tracking-wide">Partial</span>;
  return <span className="text-[10px] px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20 uppercase tracking-wide">{status}</span>;
}

function ActionButton({
  onClick,
  disabled,
  title,
  icon,
  color,
}: {
  onClick: () => void;
  disabled: boolean;
  title: string;
  icon: JSX.Element;
  color: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`p-1 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${color}`}
    >
      {icon}
    </button>
  );
}

function BreakdownChip({
  active,
  label,
  count,
  color,
  onClick,
  suffix,
}: {
  active: boolean;
  label: string;
  count: number;
  color: string;
  onClick?: () => void;
  suffix?: string;
}) {
  const body = (
    <>
      <div className="text-[11px] font-medium uppercase tracking-wide">{label}</div>
      <p className="text-xl font-bold tabular-nums mt-0.5">
        {count.toLocaleString()}{suffix}
      </p>
    </>
  );
  const className = `border rounded-lg p-2.5 text-left transition-colors ${
    active ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-[var(--ff-bg-primary)]' : ''
  } ${color}`;
  if (onClick) {
    return (
      <button onClick={onClick} className={className}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}
