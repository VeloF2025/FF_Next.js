/**
 * Action Centre — Recon tab
 *
 * Side-by-side view per DR: what Fibertime billed for ↔ what OES shows ↔
 * what we last wrote to 1Map. Each row is classified to make disputes
 * obvious.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { AlertTriangle, CheckCircle, Clock, HelpCircle, XCircle } from 'lucide-react';

type Classification =
  | 'already_fixed_still_billed'
  | 'actionable'
  | 'blocked_no_installed'
  | 'no_oes'
  | 'unknown';

interface ReconRow {
  drNumber: string;
  noteCode: string;
  project: string | null;
  team: string | null;
  ftSerial: string | null;
  oesSerial: string | null;
  oesActivatedAt: string | null;
  lastFixSerial: string | null;
  lastFixAt: string | null;
  oltRejected: boolean;
  classification: Classification;
  weeksFlagged: number;
  resolutionStatus: string | null;
  ticketUid: string | null;
}

interface ReconResponse {
  week: string | null;
  count: number;
  breakdown: Record<Classification, number>;
  rows: ReconRow[];
}

const CLASSIFICATION_STYLE: Record<
  Classification,
  { label: string; icon: JSX.Element; color: string; description: string }
> = {
  already_fixed_still_billed: {
    label: 'Dispute',
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    description: 'We fixed 1Map but Fibertime still billed. Dispute candidate.',
  },
  actionable: {
    label: 'Actionable',
    icon: <Clock className="w-3.5 h-3.5" />,
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    description: 'OES has a serial. Fix 1Map if it differs.',
  },
  blocked_no_installed: {
    label: 'Blocked',
    icon: <XCircle className="w-3.5 h-3.5" />,
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    description: 'No Home Installation: Installed prop on 1Map. Fibertime must advance the status first.',
  },
  no_oes: {
    label: 'No OES',
    icon: <HelpCircle className="w-3.5 h-3.5" />,
    color: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    description: 'No OES activation for this drop — can\'t fix without OES data.',
  },
  unknown: {
    label: 'Investigate',
    icon: <HelpCircle className="w-3.5 h-3.5" />,
    color: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    description: 'Manual investigation needed.',
  },
};

export function ReconTab() {
  const router = useRouter();
  const weekQ = typeof router.query.week === 'string' ? router.query.week : '';
  const noteQ = typeof router.query.note === 'string' ? router.query.note : '';
  const projectQ = typeof router.query.project === 'string' ? router.query.project : '';
  const [data, setData] = useState<ReconResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<Classification | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (weekQ) params.set('week', weekQ);
        if (noteQ) params.set('note', noteQ);
        if (projectQ) params.set('project', projectQ);
        const res = await fetch(`/api/activate/action-centre/recon?${params.toString()}`);
        const j = await res.json();
        if (cancelled) return;
        if (j.success) setData(j.data as ReconResponse);
        else setError(j.error?.message ?? 'Failed to load recon');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load recon');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekQ, noteQ, projectQ]);

  const filteredRows = data?.rows.filter(
    (r) => classFilter === 'all' || r.classification === classFilter,
  ) ?? [];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-[var(--ff-text-tertiary)]">
          Side-by-side reconciliation of Fibertime billing ↔ OES ↔ our last 1Map fix for each flagged DR
          {data?.week ? ` on week ending ${data.week}` : ''}.
        </p>
      </div>

      {/* Breakdown cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <BreakdownChip
            active={classFilter === 'all'}
            label="All"
            count={data.count}
            icon={<CheckCircle className="w-3.5 h-3.5" />}
            color="bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)]"
            onClick={() => setClassFilter('all')}
          />
          {(Object.keys(CLASSIFICATION_STYLE) as Classification[]).map((c) => {
            const style = CLASSIFICATION_STYLE[c];
            return (
              <BreakdownChip
                key={c}
                active={classFilter === c}
                label={style.label}
                count={data.breakdown[c] ?? 0}
                icon={style.icon}
                color={style.color}
                onClick={() => setClassFilter(c)}
              />
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-[var(--ff-text-tertiary)]">Loading…</div>
      ) : filteredRows.length === 0 ? (
        <div className="text-center py-8 text-[var(--ff-text-tertiary)]">
          No rows match the current filters.
        </div>
      ) : (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr className="text-left text-[var(--ff-text-tertiary)] text-xs uppercase tracking-wide">
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">DR</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Team</th>
                  <th className="px-3 py-2">FT billed</th>
                  <th className="px-3 py-2">OES serial</th>
                  <th className="px-3 py-2">Last fix</th>
                  <th className="px-3 py-2 text-right">Weeks</th>
                  <th className="px-3 py-2">Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {filteredRows.map((r) => {
                  const style = CLASSIFICATION_STYLE[r.classification];
                  return (
                    <tr key={`${r.drNumber}:${r.noteCode}`} className="hover:bg-[var(--ff-bg-secondary)]">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${style.color}`}
                          title={style.description}
                        >
                          {style.icon}
                          {style.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <a
                          href={`/activate/qa-centre/${r.drNumber}`}
                          className="text-[var(--ff-text-primary)] hover:text-blue-400 font-medium"
                        >
                          {r.drNumber}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-tertiary)] uppercase text-xs">
                        {r.noteCode}
                      </td>
                      <td className="px-3 py-2 text-[var(--ff-text-tertiary)]">{r.project ?? '—'}</td>
                      <td className="px-3 py-2 text-[var(--ff-text-tertiary)]">{r.team ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.ftSerial ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {r.oesSerial ?? <span className="text-red-400">none</span>}
                      </td>
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
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-[var(--ff-text-tertiary)]">
                        {r.weeksFlagged}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.ticketUid ? (
                          <span className="text-blue-400">{r.ticketUid}</span>
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
        </div>
      )}
    </div>
  );
}

function BreakdownChip({
  active,
  label,
  count,
  icon,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  icon: JSX.Element;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`border rounded-lg p-2.5 text-left transition-colors ${
        active ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-[var(--ff-bg-primary)]' : ''
      } ${color}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <p className="text-xl font-bold tabular-nums mt-0.5">{count.toLocaleString()}</p>
    </button>
  );
}
