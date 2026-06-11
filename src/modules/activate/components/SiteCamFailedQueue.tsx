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
              filter === f ? 'bg-sky-100 text-sky-700' : 'bg-neutral-100 text-neutral-500 hover:text-neutral-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading && (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-400">No {filter} failed submissions</p>
      )}

      <div className="space-y-2">
        {items.map((e) => (
          <div key={e.id} className="rounded-xl border border-neutral-200 bg-white shadow-sm">
            <div className="flex w-full items-center justify-between px-4 py-3">
              <div>
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                  className="font-medium text-sky-700 underline-offset-2 hover:underline"
                >
                  {e.site_id}
                </button>
                <span className="mx-2 text-neutral-400">·</span>
                <span className="text-sm text-neutral-600">
                  Step {e.step_number}: {STEP_LABELS[e.step_number] ?? ''}
                </span>
                <span className="mx-2 text-neutral-400">·</span>
                <span className="text-xs text-neutral-500">{e.tech_name ?? 'Unknown'}</span>
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
