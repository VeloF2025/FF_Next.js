'use client';

/**
 * PwaEscalationsTab
 *
 * Supervisor view for SiteCam step escalations.
 * Shows all pending escalations (steps that failed 3× on device).
 * Supervisors can approve (photo acceptable despite AI failure) or reject.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { log } from '@/lib/logger';

interface AttemptPhoto {
  attempt: number;
  url: string;
  reasons: string[];
}

interface Escalation {
  id: string;
  job_type: string;
  site_id: string;
  step_number: number;
  fail_reasons: string[];
  attempt_photos: AttemptPhoto[];
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  tech_name: string | null;
}

interface ApiResponse {
  success: boolean;
  data?: { escalations: Escalation[] };
}

export function PwaEscalationsTab() {
  const [escalations, setEscalations] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/sitecam/escalations?status=pending', { credentials: 'include' })
      .then((r) => r.json() as Promise<ApiResponse>)
      .then((d) => {
        if (d.success && d.data?.escalations) setEscalations(d.data.escalations);
        else setError('Could not load escalations.');
      })
      .catch((err) => {
        log.warn('Failed to load escalations', { error: String(err) }, 'PwaEscalationsTab');
        setError('Could not load escalations.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const resolve = async (id: string, resolution: 'approved' | 'rejected') => {
    setResolving(id);
    try {
      const resp = await fetch('/api/sitecam/escalation-resolve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          resolution,
          note: resolution === 'approved'
            ? 'Supervisor override — photo acceptable'
            : 'Photo does not meet quality standard',
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      setEscalations((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      log.warn('Failed to resolve escalation', { id, error: String(err) }, 'PwaEscalationsTab');
      setError('Could not resolve that escalation. Please retry.');
    } finally {
      setResolving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading escalations…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--ff-text-tertiary)]">
          {escalations.length === 0
            ? 'No pending PWA escalations.'
            : `${escalations.length} pending escalation${escalations.length !== 1 ? 's' : ''} awaiting supervisor review`}
        </p>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--ff-border-light)] px-3 py-1.5 text-sm text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {escalations.map((e) => (
        <div
          key={e.id}
          className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
        >
          <div className="mb-2 flex items-start justify-between">
            <div>
              <span className="font-medium text-sm text-[var(--ff-text-primary)]">{e.site_id}</span>
              <span className="ml-2 text-xs text-[var(--ff-text-tertiary)]">
                Step {e.step_number} · {e.job_type} · {e.tech_name ?? 'Unknown technician'}
              </span>
            </div>
            <span className="text-xs text-[var(--ff-text-tertiary)]">
              {new Date(e.created_at).toLocaleString()}
            </span>
          </div>

          {e.fail_reasons.length > 0 && (
            <div className="mb-3 space-y-0.5">
              {e.fail_reasons.map((r, i) => (
                <div key={i} className="text-xs text-red-600 dark:text-red-400">• {r}</div>
              ))}
            </div>
          )}

          {e.attempt_photos.length > 0 && (
            <div className="mb-3 flex gap-2 flex-wrap">
              {e.attempt_photos.map((p) => {
                const key = `${e.id}-${p.attempt}`;
                return (
                  <div key={p.attempt} className="text-center">
                    {imgErrors[key] ? (
                      <div className="flex h-20 w-20 items-center justify-center rounded border bg-gray-100 text-xs text-gray-400 dark:bg-gray-800">
                        No img
                      </div>
                    ) : (
                      <img
                        src={p.url}
                        className="h-20 w-20 rounded border object-cover"
                        alt={`Attempt ${p.attempt}`}
                        onError={() => setImgErrors((prev) => ({ ...prev, [key]: true }))}
                      />
                    )}
                    <div className="mt-0.5 text-xs text-[var(--ff-text-tertiary)]">
                      Attempt {p.attempt}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => void resolve(e.id, 'approved')}
              disabled={resolving === e.id}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              onClick={() => void resolve(e.id, 'rejected')}
              disabled={resolving === e.id}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
