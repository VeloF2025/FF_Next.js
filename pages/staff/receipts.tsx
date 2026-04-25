/**
 * /staff/receipts — finance / HR review queue (PRD-040 receipts Phase 2).
 *
 * Lists every staff-submitted receipt across the org with filters
 * (status, staff, project, category, month). Reviewers can approve /
 * reject / reconcile, view the captured image (server-proxied via
 * /api/staff/receipts-image), and export the filtered slice as CSV
 * for accounting.
 *
 * RBAC: receipts.review (gated server-side; UI degrades to 403 panel).
 *
 * Default view: submitted (oldest first) — that's the active backlog.
 *
 * This file is intentionally thin — it owns the state machine that
 * coordinates fetch/filter/action. Each visual piece lives under
 * src/modules/receipts/components/review/ (CLAUDE.md: ≤300 lines/file).
 */

import React from 'react';
import { useRouter } from 'next/router';
import { Download, AlertCircle } from 'lucide-react';

import { AppLayout } from '@/components/layout/AppLayout';
import { SummaryBar } from '@/modules/receipts/components/review/SummaryBar';
import { FilterBar } from '@/modules/receipts/components/review/FilterBar';
import { ReceiptsTable } from '@/modules/receipts/components/review/ReceiptsTable';
import { RejectDrawer } from '@/modules/receipts/components/review/RejectDrawer';
import {
  buildQueryString,
  coerceSummary,
  takeCategory,
  takeMonth,
  takeRawString,
  takeStatus,
} from '@/modules/receipts/components/review/filters';
import {
  DEFAULT_FILTERS,
  emptySummary,
  type Filters,
  type ReviewAction,
  type ReviewListItem,
  type SummaryShape,
} from '@/modules/receipts/components/review/types';

export default function ReceiptsReviewPage() {
  const router = useRouter();
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [items, setItems] = React.useState<ReviewListItem[] | null>(null);
  const [summary, setSummary] = React.useState<SummaryShape | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [drawer, setDrawer] = React.useState<{ item: ReviewListItem; action: ReviewAction } | null>(null);

  // Hydrate filters from URL on first mount + when route query changes.
  React.useEffect(() => {
    if (!router.isReady) return;
    const q = router.query;
    setFilters((prev) => ({
      status: takeStatus(q.status) ?? prev.status,
      staffId: takeRawString(q.staffId) ?? prev.staffId,
      projectId: takeRawString(q.projectId) ?? prev.projectId,
      category: takeCategory(q.category) ?? prev.category,
      month: takeMonth(q.month) ?? prev.month,
    }));
  }, [router.isReady, router.query]);

  // Re-fetch whenever filters or refreshTick change.
  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setErrorMsg(null);
      try {
        const qs = buildQueryString(filters, { summary: '1' });
        const res = await fetch(`/api/staff/receipts${qs}`, { credentials: 'include' });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setErrorMsg(
            res.status === 403
              ? 'You do not have permission to review receipts.'
              : json?.error?.message ?? `Server returned HTTP ${res.status}`
          );
          setItems([]);
          setSummary(emptySummary());
          return;
        }
        setItems(json.data.items as ReviewListItem[]);
        setSummary(coerceSummary(json.data.summary));
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Failed to load receipts');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [filters, refreshTick]);

  const onResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    router.replace('/staff/receipts', undefined, { shallow: true });
  };

  const requestAction = (item: ReviewListItem, action: ReviewAction) => {
    setDrawer({ item, action });
  };

  const submitAction = async (note: string | null) => {
    if (!drawer) return;
    const { item, action } = drawer;
    setPendingId(item.id);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/staff/receipts-review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, action, note }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMsg(json?.error?.message ?? `Server returned HTTP ${res.status}`);
        return;
      }
      setDrawer(null);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setPendingId(null);
    }
  };

  const exportHref = `/api/staff/receipts-export${buildQueryString(filters)}`;

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Review receipts</h1>
            <p className="text-sm text-neutral-400 mt-1">
              Approve, reject, or reconcile staff-submitted slips.
            </p>
          </div>
          <a
            href={exportHref}
            className="inline-flex items-center gap-2 min-h-[48px] rounded-lg bg-neutral-800 hover:bg-neutral-700 px-4 text-sm font-semibold text-neutral-100"
            data-testid="export-csv"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </header>

        <SummaryBar summary={summary} loading={loading && summary === null} />

        <FilterBar filters={filters} onChange={setFilters} onReset={onResetFilters} />

        {errorMsg && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-200">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <ReceiptsTable
          items={items}
          loading={loading}
          pendingId={pendingId}
          onAction={requestAction}
        />

        {drawer && (
          <RejectDrawer
            item={drawer.item}
            action={drawer.action}
            pending={pendingId === drawer.item.id}
            onConfirm={submitAction}
            onCancel={() => {
              if (pendingId === null) setDrawer(null);
            }}
          />
        )}
      </div>
    </AppLayout>
  );
}
