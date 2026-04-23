/**
 * /my/attendance/corrections — staff view of their own correction
 * submissions.
 *
 * Read + cancel surface. The submit form lands in a follow-up PR so
 * this stays focused and reviewable. What's here:
 *   - Tabs for each status (pending / approved / rejected / cancelled
 *     / all) with live count badges.
 *   - List rows showing the kind, work-date context, reason, and (when
 *     applicable) the reviewer's note.
 *   - Cancel button on pending rows — optimistic update with rollback
 *     on API failure so the staff sees instant feedback.
 *
 * Session check matches other /my pages: 401 on any call punts to /my
 * to log in again.
 */

import React from 'react';
import type { NextPage } from 'next';
import { useRouter } from 'next/router';
import { AlertTriangle, CheckCircle2, Clock, X, XCircle } from 'lucide-react';

import {
  ApiError,
  cancelMyCorrection,
  getCorrectionHints,
  getSession,
  listMyCorrections,
  type CorrectionCounts,
  type CorrectionHints,
  type CorrectionKind,
  type CorrectionRow,
  type CorrectionStatus,
  type CorrectionStatusFilter,
  type SessionResponse,
} from '@/modules/attendance/portal/client/api';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';

const STATUS_TABS: readonly { key: CorrectionStatusFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
];

const VALID_STATUS_FILTERS: readonly CorrectionStatusFilter[] =
  STATUS_TABS.map((t) => t.key);

const DEFAULT_STATUS_FILTER: CorrectionStatusFilter = 'pending';

function parseStatusParam(raw: unknown): CorrectionStatusFilter {
  return typeof raw === 'string' &&
    VALID_STATUS_FILTERS.includes(raw as CorrectionStatusFilter)
    ? (raw as CorrectionStatusFilter)
    : DEFAULT_STATUS_FILTER;
}

const ZERO_COUNTS: CorrectionCounts = {
  pending: 0,
  approved: 0,
  rejected: 0,
  cancelled: 0,
};

const MyCorrectionsPage: NextPage & {
  getLayout?: (page: React.ReactElement) => React.ReactElement;
} = () => {
  const router = useRouter();
  const [session, setSession] = React.useState<SessionResponse | null>(null);
  const [hints, setHints] = React.useState<CorrectionHints | null>(null);
  const [statusFilter, setStatusFilter] = React.useState<CorrectionStatusFilter>(
    DEFAULT_STATUS_FILTER
  );
  const [rows, setRows] = React.useState<CorrectionRow[] | null>(null);
  const [counts, setCounts] = React.useState<CorrectionCounts>(ZERO_COUNTS);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  // URL ↔ tab sync: the ?status= query param is the source of truth.
  // Handles deep-links, bookmarks, and browser back from nested routes
  // (e.g. corrections/new). Same-page tab clicks use router.replace so
  // we don't pollute history with every click.
  React.useEffect(() => {
    if (!router.isReady) return;
    const next = parseStatusParam(router.query.status);
    setStatusFilter((prev) => (prev === next ? prev : next));
  }, [router.isReady, router.query.status]);

  const handleTabChange = React.useCallback(
    (next: CorrectionStatusFilter) => {
      setStatusFilter(next);
      if (!router.isReady) return;
      const { status: _prev, ...restQuery } = router.query;
      const nextQuery =
        next === DEFAULT_STATUS_FILTER
          ? restQuery
          : { ...restQuery, status: next };
      router.replace(
        { pathname: router.pathname, query: nextQuery },
        undefined,
        { shallow: true }
      );
    },
    [router]
  );

  // Session + hints — fetched once on mount.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sess = await getSession();
        if (cancelled) return;
        if (!sess.session) {
          await router.replace('/my');
          return;
        }
        setSession(sess);
        const hintsResp = await getCorrectionHints();
        if (cancelled) return;
        setHints(hintsResp.hints);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setLoadError(
          err instanceof Error ? err.message : 'Could not load your corrections.'
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // List + counts — re-fetched whenever the status filter changes.
  React.useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadError(null);
        const resp = await listMyCorrections({ status: statusFilter });
        if (cancelled) return;
        setRows(resp.adjustments);
        setCounts(resp.counts);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          await router.replace('/my');
          return;
        }
        setLoadError(
          err instanceof Error ? err.message : 'Could not load the list.'
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, session, statusFilter]);

  const handleCancel = React.useCallback(
    async (adjustmentId: string) => {
      // Optimistic: drop the row immediately, roll back on failure.
      // Matches existing portal UX (clock-in is also optimistic).
      const confirmed = window.confirm(
        'Cancel this pending correction? You can submit a new one if you change your mind.'
      );
      if (!confirmed) return;

      setCancellingId(adjustmentId);
      setCancelError(null);
      const beforeRows = rows;
      const beforeCounts = counts;
      setRows((prev) =>
        prev ? prev.filter((r) => r.id !== adjustmentId) : prev
      );
      setCounts((prev) => ({
        ...prev,
        pending: Math.max(0, prev.pending - 1),
        cancelled: prev.cancelled + 1,
      }));
      try {
        await cancelMyCorrection(adjustmentId);
      } catch (err) {
        setRows(beforeRows);
        setCounts(beforeCounts);
        setCancelError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Could not cancel the correction.'
        );
      } finally {
        setCancellingId(null);
      }
    },
    [rows, counts]
  );

  return (
    <MyPortalShell
      title="My corrections"
      staffName={session?.profile?.name ?? null}
    >
      {!session && !loadError && (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">
          Loading…
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-800 mb-4"
        >
          {loadError}
        </div>
      )}

      {session && (
        <>
          <StatusTabs
            active={statusFilter}
            counts={counts}
            onChange={handleTabChange}
          />

          {cancelError && (
            <div
              role="alert"
              className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900"
            >
              {cancelError}
            </div>
          )}

          <div className="mt-3">
            {rows === null ? (
              <div className="py-8 text-center text-sm text-gray-500">
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <EmptyState statusFilter={statusFilter} />
            ) : (
              <ul className="rounded-2xl bg-white border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {rows.map((row) => (
                  <CorrectionListItem
                    key={row.id}
                    row={row}
                    hints={hints}
                    cancelling={cancellingId === row.id}
                    onCancel={handleCancel}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </MyPortalShell>
  );
};

function StatusTabs({
  active,
  counts,
  onChange,
}: {
  active: CorrectionStatusFilter;
  counts: CorrectionCounts;
  onChange: (next: CorrectionStatusFilter) => void;
}) {
  return (
    <nav
      role="tablist"
      aria-label="Correction status filter"
      className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1"
    >
      {STATUS_TABS.map((tab) => {
        const count =
          tab.key === 'all'
            ? counts.pending +
              counts.approved +
              counts.rejected +
              counts.cancelled
            : counts[tab.key];
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            aria-selected={isActive}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full border text-sm font-medium transition ${
              isActive
                ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
            <span
              className={`ml-2 inline-block min-w-[1.25rem] px-1 py-0.5 rounded-full text-xs tabular-nums ${
                isActive
                  ? 'bg-white/20 text-white'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function EmptyState({ statusFilter }: { statusFilter: CorrectionStatusFilter }) {
  const message =
    statusFilter === 'pending'
      ? 'No pending corrections.'
      : statusFilter === 'all'
        ? 'You haven\'t submitted any corrections yet.'
        : `No ${statusFilter} corrections.`;
  return (
    <div className="rounded-2xl bg-white border border-gray-200 py-10 text-center text-sm text-gray-500">
      {message}
    </div>
  );
}

function CorrectionListItem({
  row,
  hints,
  cancelling,
  onCancel,
}: {
  row: CorrectionRow;
  hints: CorrectionHints | null;
  cancelling: boolean;
  onCancel: (adjustmentId: string) => void;
}) {
  const kindLabel = hints?.[row.adjustment_kind]?.label ?? prettyKind(row.adjustment_kind);
  return (
    <li className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={row.status} />
            <span className="text-sm font-medium text-gray-900">{kindLabel}</span>
          </div>
          {row.entry_work_date && (
            <div className="mt-1 text-xs text-gray-500">
              For shift on {formatWorkDate(row.entry_work_date)}
            </div>
          )}
          <p className="mt-2 text-sm text-gray-700 break-words">{row.reason}</p>
          {row.review_note && row.status !== 'pending' && (
            <p className="mt-2 text-xs text-gray-500 italic">
              Reviewer: {row.review_note}
            </p>
          )}
        </div>
        {row.status === 'pending' && (
          <button
            type="button"
            onClick={() => onCancel(row.id)}
            disabled={cancelling}
            className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-700 hover:border-red-300 hover:text-red-700 disabled:opacity-50"
            aria-label={`Cancel ${kindLabel} correction`}
          >
            <X className="w-3.5 h-3.5" />
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
    </li>
  );
}

function StatusBadge({ status }: { status: CorrectionStatus }) {
  const map: Record<
    CorrectionStatus,
    { bg: string; text: string; label: string; icon: React.ReactNode }
  > = {
    pending: {
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      label: 'Pending',
      icon: <Clock className="w-3 h-3" />,
    },
    approved: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-800',
      label: 'Approved',
      icon: <CheckCircle2 className="w-3 h-3" />,
    },
    rejected: {
      bg: 'bg-red-50',
      text: 'text-red-800',
      label: 'Rejected',
      icon: <XCircle className="w-3 h-3" />,
    },
    cancelled: {
      bg: 'bg-gray-100',
      text: 'text-gray-700',
      label: 'Cancelled',
      icon: <AlertTriangle className="w-3 h-3" />,
    },
  };
  const s = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${s.bg} ${s.text}`}
    >
      {s.icon}
      {s.label}
    </span>
  );
}

function prettyKind(kind: CorrectionKind): string {
  return kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function formatWorkDate(yyyyMmDd: string): string {
  try {
    const [y, m, d] = yyyyMmDd.split('-').map(Number);
    if (!y || !m || !d) return yyyyMmDd;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('en-ZA', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: 'UTC',
    });
  } catch {
    return yyyyMmDd;
  }
}

MyCorrectionsPage.getLayout = (page: React.ReactElement) => page;

export default MyCorrectionsPage;
