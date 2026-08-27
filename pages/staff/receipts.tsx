/**
 * /staff/receipts — finance / HR review queue (PRD-040 receipts Phase 2).
 *
 * Lists every staff-submitted receipt across the org with filters
 * (status, staff, project, category, month). Reviewers can approve /
 * reject / reconcile — one row at a time or in bulk — view the captured
 * image (server-proxied via /api/staff/receipts-image), and export the
 * filtered slice as CSV for accounting.
 *
 * RBAC: receipts.review (gated server-side; UI degrades to 403 panel).
 *
 * Default view: submitted (oldest first) — that's the active backlog.
 *
 * This file is intentionally thin — it owns the state machine that
 * coordinates fetch/filter/selection/action. Each visual piece lives
 * under src/modules/receipts/components/review/ (CLAUDE.md: <=300 lines/file).
 */

import React from 'react';
import { useRouter } from 'next/router';
import { Download, AlertCircle } from 'lucide-react';

import { log } from '@/lib/logger';
import { AppLayout } from '@/components/layout/AppLayout';
import { SummaryBar } from '@/modules/receipts/components/review/SummaryBar';
import { FilterBar } from '@/modules/receipts/components/review/FilterBar';
import { ReceiptsTable } from '@/modules/receipts/components/review/ReceiptsTable';
import { RejectDrawer } from '@/modules/receipts/components/review/RejectDrawer';
import { BulkActionBar } from '@/modules/receipts/components/review/BulkActionBar';
import { LoadMoreButton } from '@/modules/receipts/components/review/LoadMoreButton';
import { useReceiptsList } from '@/modules/receipts/components/review/useReceiptsList';
import {
  buildQueryString,
  takeCategory,
  takeMonth,
  takeRawString,
  takeStatus,
} from '@/modules/receipts/components/review/filters';
import {
  DEFAULT_FILTERS,
  type Filters,
  type ReviewAction,
  type ReviewListItem,
} from '@/modules/receipts/components/review/types';

type Drawer =
  | { kind: 'single'; item: ReviewListItem; action: ReviewAction }
  | { kind: 'bulk'; items: ReviewListItem[]; action: ReviewAction };

export default function ReceiptsReviewPage() {
  const router = useRouter();
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [bulkPending, setBulkPending] = React.useState(false);
  const [refreshTick, setRefreshTick] = React.useState(0);
  const [drawer, setDrawer] = React.useState<Drawer | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const { items, summary, loading, loadingMore, errorMsg, setErrorMsg, loadMore, totalForFilters } =
    useReceiptsList(filters, refreshTick, () => setSelectedIds(new Set()));

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

  const onResetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    router.replace('/staff/receipts', undefined, { shallow: true });
  };

  const requestAction = (item: ReviewListItem, action: ReviewAction) => {
    setDrawer({ kind: 'single', item, action });
  };

  const requestBulkAction = (action: ReviewAction) => {
    const selected = (items ?? []).filter((i) => selectedIds.has(i.id));
    if (selected.length === 0) return;
    setDrawer({ kind: 'bulk', items: selected, action });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const allSelected = (items ?? []).every((i) => prev.has(i.id));
      return allSelected ? new Set() : new Set((items ?? []).map((i) => i.id));
    });
  };

  const submitAction = async (note: string | null) => {
    if (!drawer) return;
    if (drawer.kind === 'single') {
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
        log.error('[receipts-review] single action failed', err instanceof Error ? { message: err.message } : { err });
        setErrorMsg(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setPendingId(null);
      }
      return;
    }

    // Bulk
    const { items: selected, action } = drawer;
    setBulkPending(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/staff/receipts-review-bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selected.map((i) => i.id), action, note }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setErrorMsg(json?.error?.message ?? `Server returned HTTP ${res.status}`);
        return;
      }
      if (json.data.skippedIds?.length > 0) {
        setErrorMsg(
          `${json.data.updatedIds.length} updated, ${json.data.skippedIds.length} skipped (not eligible for this action — check their current status).`
        );
      }
      setDrawer(null);
      setSelectedIds(new Set());
      setRefreshTick((t) => t + 1);
    } catch (err) {
      log.error('[receipts-review] bulk action failed', err instanceof Error ? { message: err.message } : { err });
      setErrorMsg(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setBulkPending(false);
    }
  };

  const exportHref = `/api/staff/receipts-export${buildQueryString(filters)}`;
  const selectedItems = (items ?? []).filter((i) => selectedIds.has(i.id));

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--ff-text-primary)' }}>
              Review receipts
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--ff-text-secondary)' }}>
              Approve, reject, or reconcile staff-submitted slips.
            </p>
          </div>
          <a href={exportHref} className="ff-button ff-button--secondary min-h-[48px]" data-testid="export-csv">
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </header>

        <SummaryBar
          summary={summary}
          loading={loading && summary === null}
          activeStatus={filters.status}
          onSelect={(status) => setFilters((f) => ({ ...f, status }))}
        />

        <FilterBar filters={filters} onChange={setFilters} onReset={onResetFilters} />

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--ff-error-light)', color: 'var(--ff-error)' }}
          >
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <BulkActionBar
          selected={selectedItems}
          pending={bulkPending}
          onAction={requestBulkAction}
          onClear={() => setSelectedIds(new Set())}
        />

        <ReceiptsTable
          items={items}
          loading={loading}
          pendingId={pendingId}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onAction={requestAction}
        />

        {items && !loading && (
          <LoadMoreButton
            loadedCount={items.length}
            total={totalForFilters}
            loading={loadingMore}
            onClick={loadMore}
          />
        )}

        {drawer && (
          <RejectDrawer
            action={drawer.action}
            subtitle={
              drawer.kind === 'single'
                ? `${drawer.item.vendor ?? 'Unknown vendor'} · ${drawer.item.staff_name ?? 'Unknown staff'}`
                : `${drawer.items.length} receipts selected`
            }
            pending={drawer.kind === 'single' ? pendingId === drawer.item.id : bulkPending}
            onConfirm={submitAction}
            onCancel={() => {
              const isPending = drawer.kind === 'single' ? pendingId !== null : bulkPending;
              if (!isPending) setDrawer(null);
            }}
          />
        )}
      </div>
    </AppLayout>
  );
}
