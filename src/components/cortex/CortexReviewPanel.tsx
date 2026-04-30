'use client';

import { useCallback, useEffect, useState } from 'react';

interface ReviewItem {
  id: number;
  content_type: string;
  content: Record<string, unknown>;
  status: string;
  reviewer: string | null;
  created_at: string;
}

type Decision = 'approved' | 'rejected';

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function contentSummary(item: ReviewItem): string {
  const c = item.content;
  if (typeof c['text'] === 'string') return c['text'].slice(0, 200);
  if (typeof c['summary'] === 'string') return c['summary'].slice(0, 200);
  return JSON.stringify(c).slice(0, 200);
}

export function CortexReviewPanel() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<Set<number>>(new Set());
  const [itemErrors, setItemErrors] = useState<Map<number, string>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cortex-review');
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as { data: ReviewItem[] };
      setItems(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decide = useCallback(async (id: number, decision: Decision) => {
    setDeciding(prev => new Set(prev).add(id));
    setItemErrors(prev => { const m = new Map(prev); m.delete(id); return m; });
    try {
      const res = await fetch('/api/cortex-review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setItems(prev => prev.filter(item => item.id !== id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setItemErrors(prev => new Map(prev).set(id, msg));
    } finally {
      setDeciding(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground text-sm">
        Loading review queue…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <strong>Error:</strong> {error}
        <button onClick={() => void load()} className="ml-3 underline hover:opacity-80">
          Retry
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-8 text-muted-foreground text-sm">
        <span>Review queue is empty.</span>
        <button onClick={() => void load()} className="text-xs underline hover:opacity-80">
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between pb-1">
        <span className="text-sm text-muted-foreground">{items.length} item(s) pending review</span>
        <button onClick={() => void load()} className="text-xs text-muted-foreground underline hover:opacity-80">
          Refresh
        </button>
      </div>

      {items.map(item => {
        const busy = deciding.has(item.id);
        const itemError = itemErrors.get(item.id);
        return (
          <div key={item.id} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {item.content_type}
                </span>
                <p className="text-sm text-foreground line-clamp-3 break-words">
                  {contentSummary(item)}
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
                {formatDate(item.created_at)}
              </span>
            </div>

            {itemError && (
              <p className="text-xs text-destructive">Failed: {itemError}</p>
            )}

            <div className="flex gap-2">
              <button
                disabled={busy}
                onClick={() => void decide(item.id, 'approved')}
                className="flex-1 rounded-md bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium py-1.5 transition-colors"
              >
                {busy ? '…' : 'Approve'}
              </button>
              <button
                disabled={busy}
                onClick={() => void decide(item.id, 'rejected')}
                className="flex-1 rounded-md border border-destructive/60 text-destructive hover:bg-destructive/10 disabled:opacity-50 text-sm font-medium py-1.5 transition-colors"
              >
                {busy ? '…' : 'Reject'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
