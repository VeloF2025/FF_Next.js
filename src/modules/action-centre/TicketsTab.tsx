/**
 * Action Centre — Tickets tab
 *
 * All NOC tickets originating from Action Centre flows: billing
 * deductions, pre-prov follow-ups, OLT mismatches. Filters by status,
 * source bucket, and search.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ExternalLink, Ticket as TicketIcon } from 'lucide-react';

type SourceBucket = 'deduction' | 'pre_prov' | 'olt';

interface Ticket {
  ticketId: string;
  ticketUid: string;
  drNumber: string | null;
  title: string;
  status: string;
  priority: string | null;
  sourceBucket: SourceBucket | null;
  source: string | null;
  sourceType: string | null;
  category: string | null;
  project: string | null;
  ontSerial: string | null;
  createdAt: string;
  updatedAt: string;
}

const BUCKET_LABELS: Record<SourceBucket | 'unknown', { label: string; color: string }> = {
  deduction: { label: 'Billing', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
  pre_prov: { label: 'Pre-Prov', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  olt: { label: 'OLT mismatch', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  unknown: { label: 'Other', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
};

const STATUS_COLOR: Record<string, string> = {
  open: 'text-blue-400',
  assigned: 'text-blue-400',
  in_progress: 'text-blue-400',
  pending_qa: 'text-yellow-400',
  qa_in_progress: 'text-yellow-400',
  qa_rejected: 'text-red-400',
  qa_approved: 'text-green-400',
  resolved: 'text-green-400',
  verified: 'text-green-400',
  closed: 'text-gray-500',
  cancelled: 'text-gray-500',
};

export function TicketsTab() {
  const router = useRouter();
  const statusQ = typeof router.query.status === 'string' ? router.query.status : 'open';
  const sourceQ = typeof router.query.source === 'string' ? router.query.source : 'all';
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Ticket[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusQ && statusQ !== 'open') params.set('status', statusQ);
        if (sourceQ && sourceQ !== 'all') params.set('source', sourceQ);
        if (search.trim()) params.set('search', search.trim());
        params.set('limit', '300');
        const res = await fetch(`/api/activate/action-centre/tickets?${params.toString()}`);
        const j = await res.json();
        if (cancelled) return;
        if (j.success) {
          setItems(j.data.items as Ticket[]);
          setCount(j.data.count as number);
        } else {
          setError(j.error?.message ?? 'Failed to load tickets');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load tickets');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusQ, sourceQ, search]);

  const setFilter = (key: 'status' | 'source', value: string) => {
    const q: Record<string, string> = { ...router.query as Record<string, string>, tab: 'tickets' };
    if ((key === 'status' && value === 'open') || (key === 'source' && value === 'all')) {
      delete q[key];
    } else {
      q[key] = value;
    }
    router.push({ pathname: '/activate/action-centre', query: q }, undefined, { shallow: true });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ff-text-tertiary)]">
        NOC tickets originating from Action Centre flows: billing disputes, pre-prov chases, OLT mismatch escalations.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium text-[var(--ff-text-tertiary)] self-center">Status:</span>
          {(['open', 'resolved', 'all'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter('status', s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                (statusQ || 'open') === s
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-transparent border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium text-[var(--ff-text-tertiary)] self-center">Source:</span>
          {(['all', 'deduction', 'pre_prov', 'olt'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter('source', s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                (sourceQ || 'all') === s
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-transparent border-[var(--ff-border-light)] text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]'
              }`}
            >
              {s === 'all' ? 'All' : s === 'deduction' ? 'Billing' : s === 'pre_prov' ? 'Pre-Prov' : 'OLT'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search ticket UID, DR, or title…"
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

      {items.length === 0 && !loading ? (
        <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
          No tickets match these filters.
        </div>
      ) : (
        <div className="border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
          <ul className="divide-y divide-[var(--ff-border-light)]">
            {items.map((t) => {
              const bucket = BUCKET_LABELS[t.sourceBucket ?? 'unknown'];
              return (
                <li key={t.ticketId} className="p-3 hover:bg-[var(--ff-bg-secondary)] transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded border ${bucket.color}`}>
                          {bucket.label}
                        </span>
                        <a
                          href={`/noc/tickets/${t.ticketId}`}
                          className="text-sm font-medium text-[var(--ff-text-primary)] hover:text-blue-400 inline-flex items-center gap-1"
                        >
                          <TicketIcon className="w-3.5 h-3.5" />
                          {t.ticketUid}
                        </a>
                        {t.drNumber && (
                          <a
                            href={`/activate/qa-centre/${t.drNumber}`}
                            className="text-xs text-blue-400 hover:underline"
                          >
                            {t.drNumber}
                          </a>
                        )}
                        {t.project && (
                          <span className="text-xs text-[var(--ff-text-tertiary)]">· {t.project}</span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--ff-text-primary)] mt-1 truncate">
                        {t.title}
                      </p>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-[var(--ff-text-tertiary)]">
                        <span>
                          Status: <span className={STATUS_COLOR[t.status] ?? 'text-[var(--ff-text-primary)]'}>{t.status}</span>
                        </span>
                        {t.priority && t.priority !== 'normal' && (
                          <span>Priority: <span className="text-[var(--ff-text-primary)]">{t.priority}</span></span>
                        )}
                        {t.ontSerial && (
                          <span className="font-mono">Serial: {t.ontSerial}</span>
                        )}
                        <span>Created {new Date(t.createdAt).toISOString().slice(0, 10)}</span>
                      </div>
                    </div>
                    <a
                      href={`/noc/tickets/${t.ticketId}`}
                      className="flex-shrink-0 text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)]"
                      aria-label="Open ticket"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
