/**
 * Action Centre — Items tab
 *
 * Flat list of open action items across sources (deductions + PP + OLT
 * mismatches + offline). Each row is clickable into the DR detail page,
 * with inline ticket UID link when present. Source/note/project filters
 * are query-param driven so Overview cards can deep-link.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ChevronRight, Ticket as TicketIcon, ExternalLink } from 'lucide-react';

type Source = 'deduction' | 'pre_prov' | 'olt_mismatch' | 'offline';

interface Item {
  source: Source;
  sourceId: string;
  drNumber: string | null;
  serial: string | null;
  project: string | null;
  team: string | null;
  weekEnding: string | null;
  noteCode: string | null;
  summary: string;
  status: string;
  ticketId: string | null;
  ticketUid: string | null;
  createdAt: string;
}

const SOURCE_LABELS: Record<Source | 'all', string> = {
  all: 'All sources',
  deduction: 'Billing deductions',
  pre_prov: 'Pre-provisioned',
  olt_mismatch: 'OLT mismatches',
  offline: 'Offline devices',
};

const SOURCE_BADGE: Record<Source, string> = {
  deduction: 'bg-red-500/10 text-red-400 border-red-500/20',
  pre_prov: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  olt_mismatch: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  offline: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export function ItemsTab() {
  const router = useRouter();
  const sourceQuery = typeof router.query.source === 'string' ? router.query.source : 'all';
  const noteQuery = typeof router.query.note === 'string' ? router.query.note : '';
  const projectQuery = typeof router.query.project === 'string' ? router.query.project : '';
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (sourceQuery && sourceQuery !== 'all') params.set('source', sourceQuery);
        if (noteQuery) params.set('note', noteQuery);
        if (projectQuery) params.set('project', projectQuery);
        if (search.trim()) params.set('search', search.trim());
        params.set('limit', '200');
        const res = await fetch(`/api/activate/action-centre/items?${params.toString()}`);
        const j = await res.json();
        if (cancelled) return;
        if (j.success) {
          setItems(j.data.items as Item[]);
          setCount(j.data.count as number);
        } else {
          setError(j.error?.message ?? 'Failed to load items');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load items');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceQuery, noteQuery, projectQuery, search]);

  const setSourceFilter = (s: Source | 'all') => {
    const q: Record<string, string> = { ...router.query as Record<string, string>, tab: 'items' };
    if (s === 'all') delete q.source;
    else q.source = s;
    // Clear note filter when switching away from deduction
    if (s !== 'deduction') delete q.note;
    router.push({ pathname: '/activate/action-centre', query: q }, undefined, { shallow: true });
  };

  return (
    <div className="space-y-4">
      {/* Source filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'deduction', 'pre_prov', 'olt_mismatch', 'offline'] as const).map((s) => {
          const active = sourceQuery === s || (s === 'all' && (!sourceQuery || sourceQuery === 'all'));
          return (
            <button
              key={s}
              onClick={() => setSourceFilter(s)}
              className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-transparent border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] hover:bg-[var(--ff-bg-secondary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              {SOURCE_LABELS[s]}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search DR number or serial…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-md text-sm text-[var(--ff-text-primary)] focus:ring-2 focus:ring-[var(--ff-accent)] focus:border-transparent"
        />
        <span className="text-xs text-[var(--ff-text-tertiary)] whitespace-nowrap">
          {loading ? 'Loading…' : `${items.length} of ${count}`}
        </span>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {items.length === 0 && !loading ? (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          No open action items match these filters.
        </div>
      ) : (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <ul className="divide-y divide-[var(--ff-border-light)]">
            {items.map((item) => (
              <li
                key={`${item.source}:${item.sourceId}`}
                className="p-3 hover:bg-[var(--ff-bg-secondary)] transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${SOURCE_BADGE[item.source]}`}
                      >
                        {item.source.replace('_', ' ')}
                      </span>
                      {item.drNumber && (
                        <a
                          href={`/activate/qa-centre/${item.drNumber}`}
                          className="text-sm font-medium text-[var(--ff-text-primary)] hover:text-blue-400"
                        >
                          {item.drNumber}
                        </a>
                      )}
                      {item.project && (
                        <span className="text-xs text-[var(--ff-text-tertiary)]">
                          · {item.project}
                        </span>
                      )}
                      {item.team && (
                        <span className="text-xs text-[var(--ff-text-tertiary)]">
                          · {item.team}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--ff-text-tertiary)] mt-1">
                      {item.summary}
                      {item.serial ? ` · ${item.serial}` : ''}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--ff-text-tertiary)]">
                      <span>
                        Status: <span className="text-[var(--ff-text-primary)]">{item.status}</span>
                      </span>
                      {item.ticketId && item.ticketUid && (
                        <a
                          href={`/noc/tickets/${item.ticketId}`}
                          className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                        >
                          <TicketIcon className="w-3 h-3" />
                          {item.ticketUid}
                        </a>
                      )}
                    </div>
                  </div>
                  {item.drNumber && (
                    <a
                      href={`/activate/qa-centre/${item.drNumber}`}
                      className="flex-shrink-0 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
                      aria-label="Open DR detail"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </a>
                  )}
                  {!item.drNumber && item.source === 'pre_prov' && (
                    <ExternalLink className="w-4 h-4 text-[var(--ff-text-tertiary)] flex-shrink-0" aria-hidden="true" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
