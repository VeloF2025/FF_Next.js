'use client';

import { useCallback, useState } from 'react';
import { citationMeta } from '@/lib/cortex/citationFormat';
import { confidenceLabel, gapLabel, type AnswerGap } from '@/lib/cortex/answerFormat';

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

/** Tailwind classes for the confidence badge, keyed by bridge level (defaults muted). */
function confidenceBadgeClass(confidence: string): string {
  switch (confidence) {
    case 'high':
      return 'text-emerald-600 dark:text-emerald-500 bg-emerald-500/10';
    case 'medium':
      return 'text-amber-600 dark:text-amber-500 bg-amber-500/10';
    case 'low':
      return 'text-red-600 dark:text-red-500 bg-red-500/10';
    default:
      return 'text-muted-foreground bg-muted';
  }
}

/**
 * Cited knowledge search. Calls /api/cortex/answer, which forwards a per-user gateway
 * JWT to the bridge's GROUNDED answer endpoint — so the answer + citations are ALREADY
 * ACL-filtered for the signed-in reviewer (a channel-scoped user never sees derived
 * synthesis/dream insights; a super-admin does). The bridge synthesises a cited answer
 * that abstains when evidence is thin, and returns deterministic gaps + a confidence
 * level. This component only renders what the fail-closed API returns; React escapes
 * all interpolated text.
 */
export function CortexCitedSearch() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [confidence, setConfidence] = useState('');
  const [confidenceReason, setConfidenceReason] = useState('');
  const [gaps, setGaps] = useState<AnswerGap[]>([]);
  const [citations, setCitations] = useState<Citation[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const resetResults = useCallback(() => {
    setAnswer('');
    setConfidence('');
    setConfidenceReason('');
    setGaps([]);
    setCitations([]);
  }, []);

  const run = useCallback(
    async (q: string) => {
      setLoading(true);
      resetResults();
      setStatus('Searching the knowledge base…');
      try {
        const res = await fetch('/api/cortex/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, limit: 10 }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const json = (await res.json()) as {
          data?: {
            answer?: string;
            confidence?: string;
            confidence_reason?: string;
            citations?: Citation[];
            gaps?: AnswerGap[];
          };
        };
        const d = json.data ?? {};
        // The grounded answer — synthesis OR the bridge's honest abstention; either way
        // the user never sees raw chunks masquerading as an answer.
        setAnswer(d.answer ?? '');
        setConfidence(d.confidence ?? '');
        setConfidenceReason(d.confidence_reason ?? '');
        setGaps(Array.isArray(d.gaps) ? d.gaps : []);
        const found = Array.isArray(d.citations) ? d.citations : [];
        setCitations(found);
        setStatus(
          found.length
            ? `${found.length} cited source${found.length === 1 ? '' : 's'}`
            : d.answer
              ? 'No supporting sources to display.'
              : "No evidence you're authorized to see matched that query.",
        );
      } catch (e) {
        resetResults();
        setStatus(`Query failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    },
    [resetResults],
  );

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
          Cortex answers only from sources you&apos;re authorized to see, flags when evidence is thin or stale, and
          shows the citations behind it.
        </span>
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. how many pre-provisions did we have yesterday, rollout risks this week"
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

      {answer && (
        <div className="flex flex-col gap-2 rounded-md border border-border border-l-2 border-l-primary bg-background p-3">
          {confidence && (
            <span
              className={`inline-block w-fit rounded px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide ${confidenceBadgeClass(confidence)}`}
              title={confidenceReason || undefined}
            >
              {confidenceLabel(confidence)}
            </span>
          )}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{answer}</p>
          {gaps.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {gaps.map((g, i) => (
                <li key={`${g.type}-${i}`} className="flex items-baseline gap-2 text-xs leading-snug">
                  <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-500">
                    {gapLabel(g.type)}
                  </span>
                  <span className="text-muted-foreground">{g.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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

      {searched && !loading && !answer && citations.length === 0 && !status?.startsWith('Query failed') && (
        <p className="text-xs text-muted-foreground">No results to display.</p>
      )}
    </div>
  );
}
