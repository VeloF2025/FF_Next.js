/**
 * Dispute candidates panel — deductions the auto-verifier judged
 * 'disputable' that have not been raised with Fibertime yet. Operator
 * reviews the evidence, selects rows, and raises them in bulk; raised
 * rows move to the Disputes view and the weekly dispute pack.
 */

import { useCallback, useEffect, useState } from 'react';
import { Gavel, RefreshCw } from 'lucide-react';

interface CandidateRow {
  deductionId: string;
  drNumber: string;
  noteCode: string;
  project: string | null;
  weekEnding: string;
  ftSerial: string | null;
  oesSerial: string | null;
  weeksFlagged: number;
  verdictReasons: string[];
  verdictComputedAt: string | null;
}

interface CandidatesResponse {
  count: number;
  byNote: Record<string, number>;
  items: CandidateRow[];
}

const NOTE_LABELS: Record<string, string> = {
  note1: 'Low Signal',
  note2: 'No Field App',
  note4: 'Serial Mismatch',
  note5: 'Offline',
};

export function DisputeCandidatesPanel({ onRaised }: { onRaised?: () => void }) {
  const [data, setData] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/activate/action-centre/disputes?view=candidates&limit=500');
      const j = await res.json();
      if (j.success) {
        setData(j.data as CandidatesResponse);
        setError(null);
      } else {
        setError(j.error?.message ?? 'Failed to load candidates');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load candidates');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchCandidates(); }, [fetchCandidates]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const items = data?.items ?? [];
    setSelected((prev) => (prev.size === items.length
      ? new Set()
      : new Set(items.map((i) => i.deductionId))));
  };

  const raiseSelected = async () => {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/activate/action-centre/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deductionIds: Array.from(selected), action: 'raise' }),
      });
      const j = await res.json();
      if (j.success) setError(null);
      else setError(j.error?.message ?? 'Failed to raise disputes');
      setSelected(new Set());
      await fetchCandidates();
      onRaised?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to raise disputes');
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--ff-text-tertiary)] flex-1 min-w-[16rem]">
          Auto-verifier candidates: deductions our own evidence contradicts. Review, then raise to add them to the dispute pack.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void fetchCandidates()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-[var(--ff-border-light)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-bg-tertiary)] disabled:opacity-40"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            onClick={() => void raiseSelected()}
            disabled={selected.size === 0 || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40"
          >
            <Gavel className="w-3.5 h-3.5" />
            {busy ? 'Raising…' : `Raise ${selected.size || ''} selected`}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">{error}</div>
      )}

      {!loading && items.length === 0 ? (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          No dispute candidates — every judged deduction is either legitimate or already raised.
        </div>
      ) : (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ff-bg-tertiary)]">
                <tr className="text-left text-[var(--ff-text-tertiary)] text-xs uppercase tracking-wide">
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all candidates"
                      checked={items.length > 0 && selected.size === items.length}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-2">DR</th>
                  <th className="px-3 py-2">Note</th>
                  <th className="px-3 py-2">Week</th>
                  <th className="px-3 py-2">Project</th>
                  <th className="px-3 py-2">Wks</th>
                  <th className="px-3 py-2">Our evidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ff-border-light)]">
                {items.map((r) => (
                  <tr key={r.deductionId} className="hover:bg-[var(--ff-bg-secondary)]">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.drNumber}`}
                        checked={selected.has(r.deductionId)}
                        onChange={() => toggle(r.deductionId)}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <a
                        href={`/activate/qa-centre/${r.drNumber}`}
                        className="font-medium text-[var(--ff-text-primary)] hover:text-blue-400"
                      >
                        {r.drNumber}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      {NOTE_LABELS[r.noteCode] ?? r.noteCode}
                    </td>
                    <td className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">{r.weekEnding}</td>
                    <td className="px-3 py-2 text-xs text-[var(--ff-text-tertiary)]">{r.project ?? '—'}</td>
                    <td className="px-3 py-2 text-xs tabular-nums">{r.weeksFlagged}</td>
                    <td className="px-3 py-2 text-xs text-[var(--ff-text-secondary)]">
                      {r.verdictReasons.join('; ') || '—'}
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
