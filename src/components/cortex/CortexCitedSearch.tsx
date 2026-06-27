'use client';

import { useCallback, useState } from 'react';
import { citationMeta } from '@/lib/cortex/citationFormat';

/** Mirrors the bridge citation envelope (apps/bridge/routes/query.py :: Citation). */
interface Citation {
  n: number;
  source: string;
  source_id: string;
  channel: string;
  author: string;
  timestamp: string;
  score: number;
  snippet: string;
}

/**
 * Cited knowledge search. Calls /api/cortex/query, which forwards a per-user
 * gateway JWT to the bridge — so the results are ALREADY ACL-filtered for the
 * signed-in reviewer (a channel-scoped user never sees derived synthesis/dream
 * insights; a super-admin does). This component only renders what the
 * fail-closed API returns; React escapes all interpolated text.
 */
export function CortexCitedSearch() {
  const [query, setQuery] = useState('');
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const run = useCallback(async (q: string) => {
    setLoading(true);
    setStatus('Searching the knowledge base…');
    try {
      const res = await fetch(`/api/cortex/query?q=${encodeURIComponent(q)}&limit=10`);
      if (!res.ok) throw new Error(`${res.status}`);
      const json = (await res.json()) as { data?: { citations?: Citation[] } };
      const found = json.data?.citations ?? [];
      setCitations(found);
      setStatus(
        found.length
          ? `${found.length} cited source${found.length === 1 ? '' : 's'}`
          : "No evidence you're authorized to see matched that query.",
      );
    } catch (e) {
      setCitations([]);
      setStatus(`Query failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, []);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const q = query.trim();
      if (!q) return;
      void run(q);
    },
    [query, run],
  );

  return (
    <div className="cx-glass flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-0.5">
        <span className="cx-eyebrow">Grounded Retrieval</span>
        <span className="text-base font-semibold text-foreground">Cited knowledge search</span>
        <span className="text-xs text-muted-foreground">
          Every result is backed by source-attributed citations you&apos;re authorized to see.
        </span>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. rollout risks this week, SLA breaches, decisions pending approval"
          aria-label="Knowledge base query"
          className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={loading}
          className="cx-btn-gold rounded-md px-4 py-1.5 text-sm"
        >
          {loading ? '…' : 'Search'}
        </button>
      </form>

      {status && <p className="text-xs text-muted-foreground">{status}</p>}

      {citations.length > 0 && (
        <ol className="flex flex-col gap-2">
          {citations.map((c) => (
            <li
              key={`${c.n}-${c.source_id}`}
              className="flex gap-3 rounded-md border border-border border-l-2 border-l-primary bg-background p-3"
            >
              <span className="shrink-0 font-mono text-xs font-semibold text-primary">[{c.n}]</span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-medium text-foreground">{citationMeta(c) || '—'}</span>
                  {c.score > 0 && (
                    <span className="font-mono text-[10px] text-muted-foreground">{c.score.toFixed(3)}</span>
                  )}
                  {c.author && <span className="text-[11px] text-muted-foreground">{c.author}</span>}
                </div>
                <p className="break-words text-xs leading-relaxed text-muted-foreground">
                  {c.snippet || '(no excerpt)'}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}

      {searched && !loading && citations.length === 0 && !status?.startsWith('Query failed') && (
        <p className="text-xs text-muted-foreground">No citations to display.</p>
      )}
    </div>
  );
}
