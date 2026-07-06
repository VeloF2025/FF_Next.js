import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';
import { SiteCamFailedCard, STEP_LABELS } from './SiteCamFailedCard';
import type { Escalation } from './SiteCamFailedCard';

const MODULE = 'SiteCamFailedQueue';

export function SiteCamFailedQueue() {
  const [filter, setFilter] = useState<'pending' | 'resolved'>('pending');
  const [items, setItems] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: 'pending' | 'resolved') => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/activate/sitecam-failed?status=${status}`, { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { data: { escalations: Escalation[] } };
      setItems(j.data.escalations);
    } catch (err) {
      log.error('Load failed escalations failed', { err: String(err) }, MODULE);
      setError('Could not load failed submissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter); }, [filter, load]);

  async function resolve(id: string, resolution: 'approved' | 'rejected') {
    setResolving(id);
    setError(null);
    try {
      const res = await fetch('/api/sitecam/escalation-resolve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          resolution === 'rejected' ? { id, resolution, note } : { id, resolution },
        ),
      });
      if (!res.ok) {
        log.error('Resolve rejected', { id, status: res.status }, MODULE);
        setError('Could not resolve — it may already be resolved. Reloading…');
        await load(filter);
        return;
      }
      setNote('');
      setExpanded(null);
      await load(filter);
    } catch (err) {
      log.error('Resolve failed', { err: String(err) }, MODULE);
      setError('Could not resolve the escalation');
    } finally {
      setResolving(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['pending', 'resolved'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
              filter === f
                ? 'bg-[var(--ff-primary)] text-white'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ff-text-tertiary)]" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="py-10 text-center text-sm text-[var(--ff-text-tertiary)]">No {filter} failed submissions</p>
      )}

      <div className="space-y-2">
        {items.map((e) => (
          <div key={e.id} className="rounded-xl border border-[var(--ff-border-light)] bg-[var(--ff-bg-card)] shadow-sm">
            <div className="flex w-full items-center justify-between px-4 py-3">
              <div>
                <button
                  type="button"
                  aria-expanded={expanded === e.id}
                  onClick={() => {
                    const next = expanded === e.id ? null : e.id;
                    if (next !== expanded) setNote('');
                    setExpanded(next);
                  }}
                  className="font-medium text-[var(--ff-primary)] underline-offset-2 hover:underline"
                >
                  {e.site_id}
                </button>
                <span className="mx-2 text-[var(--ff-text-tertiary)]">·</span>
                <span className="text-sm text-[var(--ff-text-secondary)]">
                  Step {e.step_number}: {STEP_LABELS[e.step_number] ?? ''}
                </span>
                <span className="mx-2 text-[var(--ff-text-tertiary)]">·</span>
                <span className="text-xs text-[var(--ff-text-tertiary)]">{e.tech_name ?? 'Unknown'}</span>
              </div>
              <span className={`text-xs font-medium capitalize ${
                e.status === 'pending' ? 'text-amber-600'
                  : e.status === 'approved' ? 'text-green-600' : 'text-red-600'
              }`}>
                {e.status}
              </span>
            </div>

            {expanded === e.id && (
              <SiteCamFailedCard
                escalation={e}
                note={note}
                resolving={resolving === e.id}
                onNoteChange={setNote}
                onResolve={(resolution) => void resolve(e.id, resolution)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
