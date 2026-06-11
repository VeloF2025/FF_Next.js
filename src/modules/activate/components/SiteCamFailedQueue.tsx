import { useEffect, useState, useCallback } from 'react';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { log } from '@/lib/logger';

interface AttemptPhoto {
  attempt: number;
  url: string;
  reasons: string[];
}

interface Escalation {
  id: string;
  job_type: 'activations' | 'civils';
  site_id: string;
  step_number: number;
  tech_name: string | null;
  fail_reasons: string[];
  attempt_photos: AttemptPhoto[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  resolved_by_name: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

const STEP_LABELS: Record<number, string> = {
  1: 'House Photo', 2: 'Cable from Pole', 3: 'Entry Outside',
  4: 'Entry Inside', 5: 'Wall Mount', 6: 'ONT Back After Install',
  7: 'Power Meter', 8: 'Final Installation', 9: 'Green Lights',
  10: 'Signature', 11: 'Dome Joint Open', 12: 'Dome Joint Closed',
};

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
              <div className="border-t border-neutral-100 px-4 py-4 space-y-4">
                {e.fail_reasons.length > 0 && (
                  <p className="text-sm text-neutral-700">{e.fail_reasons.join('; ')}</p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {e.attempt_photos.map((p) => (
                    <figure key={p.attempt} className="space-y-1">
                      <img
                        src={p.url}
                        alt={`Attempt ${p.attempt}`}
                        className="h-40 w-full rounded-lg object-contain border border-neutral-200 bg-neutral-50"
                      />
                      <figcaption className="text-xs text-neutral-500">
                        Attempt {p.attempt}: {p.reasons.join(', ')}
                      </figcaption>
                    </figure>
                  ))}
                </div>

                {e.status === 'pending' ? (
                  <div className="space-y-3">
                    <textarea
                      value={note}
                      onChange={(ev) => setNote(ev.target.value)}
                      placeholder="Note (required if rejecting)…"
                      rows={2}
                      className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-sky-400"
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={resolving === e.id}
                        onClick={() => void resolve(e.id, 'approved')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
                      >
                        <CheckCircle className="h-4 w-4" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={resolving === e.id || !note.trim()}
                        onClick={() => void resolve(e.id, 'rejected')}
                        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
                      >
                        <XCircle className="h-4 w-4" /> Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-neutral-500">
                    {e.status === 'approved' ? 'Approved' : 'Rejected'} by {e.resolved_by_name ?? 'unknown'}
                    {e.resolution_note ? ` — ${e.resolution_note}` : ''}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
