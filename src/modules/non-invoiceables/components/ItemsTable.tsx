'use client';

/**
 * ItemsTable — Unified filterable/selectable/paginated items list
 * for the Non-Invoiceable Action Centre.
 *
 * Fetches from GET /api/activate/non-invoiceables/items and surfaces
 * per-row selection so callers can bulk-create QContact tickets.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';
import { log } from '@/lib/logger';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type ActionStatus,
  type NonInvoiceableCategory,
  type NonInvoiceableItem,
  type NonInvoiceableItemsResponse,
} from '@/modules/non-invoiceables/types';

export interface ItemsTableProps {
  /** Pre-filter to one category (hides category column). */
  category?: NonInvoiceableCategory;
  /** Pre-filter to one project (hides project dropdown). */
  project?: string;
  /** Opens the ticket creation modal with the chosen items. */
  onCreateTickets: (items: NonInvoiceableItem[]) => void;
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS: { value: ActionStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'ticketed', label: 'Ticketed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'false_positive', label: 'False Positive' },
];

const SELECT_CLASS = 'px-2 py-1.5 rounded bg-[#161b22] border border-gray-700 text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500';

const STATUS_STYLE: Record<ActionStatus, [string, string]> = {
  open:           ['bg-amber-500/15 text-amber-400',   'Open'],
  ticketed:       ['bg-blue-500/15 text-blue-400',     'Ticketed'],
  in_progress:    ['bg-indigo-500/15 text-indigo-300', 'In Progress'],
  resolved:       ['bg-green-500/15 text-green-400',   'Resolved'],
  false_positive: ['bg-gray-500/15 text-gray-400',     'False Positive'],
};

const statusBadge = (s: ActionStatus) => {
  const [cls, label] = STATUS_STYLE[s];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{label}</span>;
};

const daysOpenCell = (days: number) => {
  const c = days > 30 ? 'text-red-400' : days > 14 ? 'text-amber-400' : 'text-gray-300';
  return <span className={`text-sm tabular-nums ${c}`}>{days}d</span>;
};

// ---------------------------------------------------------------------------
// ItemRow
// ---------------------------------------------------------------------------

type RowProps = { item: NonInvoiceableItem; isSelected: boolean; showCategory: boolean; showProject: boolean; onToggle: (id: string, sel: boolean) => void };

function ItemRow({ item, isSelected, showCategory, showProject, onToggle }: RowProps) {
  const sel = item.action_status === 'open';
  const DASH = <span className="text-gray-600">—</span>;
  return (
    <tr className={`border-b border-gray-800 hover:bg-[#161b22] ${isSelected ? 'bg-blue-900/10' : ''}`}>
      <td className="px-3 py-2">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(item.id, sel)}
          disabled={!sel} className="accent-blue-500 disabled:opacity-30" aria-label={`Select ${item.dr_number}`} />
      </td>
      <td className="px-3 py-2 font-mono text-white whitespace-nowrap">{item.dr_number}</td>
      {showCategory && (
        <td className="px-3 py-2 hidden sm:table-cell">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[item.category]}`}>
            {CATEGORY_LABELS[item.category]}
          </span>
        </td>
      )}
      {showProject && <td className="px-3 py-2 text-gray-300 hidden md:table-cell">{item.project}</td>}
      <td className="px-3 py-2">{statusBadge(item.action_status)}</td>
      <td className="px-3 py-2 hidden sm:table-cell">
        {item.ticket_uid && item.ticket_id
          ? <a href={`/noc/tickets/${item.ticket_id}`} className="text-blue-400 hover:underline font-mono text-xs">{item.ticket_uid}</a>
          : DASH}
      </td>
      <td className="px-3 py-2 hidden lg:table-cell">{daysOpenCell(item.days_open)}</td>
      <td className="px-3 py-2 hidden lg:table-cell">
        {item.billing_deduction_count > 0
          ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400">{item.billing_deduction_count}</span>
          : DASH}
      </td>
      <td className="px-3 py-2 text-right"><Button variant="ghost" size="sm" disabled>View</Button></td>
    </tr>
  );
}

export function ItemsTable({ category, project, onCreateTickets }: ItemsTableProps) {
  const [projectFilter, setProjectFilter] = useState<string>(project ?? '');
  const [statusFilter, setStatusFilter] = useState<ActionStatus | 'all'>('all');
  const [searchRaw, setSearchRaw] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NonInvoiceableItemsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [projectOptions, setProjectOptions] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((value: string) => {
    setSearchRaw(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setSearchDebounced(value); setPage(1); }, 300);
  }, []);

  useEffect(() => { setPage(1); }, [projectFilter, statusFilter, searchDebounced, category]);
  useEffect(() => { setSelectedIds(new Set()); }, [data]);

  useEffect(() => {
    const controller = new AbortController();
    const fetchItems = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (category) params.set('category', category);
        if (projectFilter) params.set('project', projectFilter);
        if (statusFilter !== 'all') params.set('action_status', statusFilter);
        if (searchDebounced) params.set('search', searchDebounced);
        params.set('page', String(page));
        params.set('limit', String(PAGE_SIZE));

        const res = await fetch(`/api/activate/non-invoiceables/items?${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { message?: string };
          throw new Error(err.message ?? `HTTP ${res.status}`);
        }
        const envelope = await res.json() as { success: boolean; data: NonInvoiceableItemsResponse };
        setData(envelope.data);
        if (!projectFilter && !searchDebounced && page === 1) {
          const projects = Array.from(new Set(envelope.data.items.map((i) => i.project))).sort();
          setProjectOptions((prev) => Array.from(new Set([...prev, ...projects])).sort());
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Failed to load items';
        log.error('ItemsTable: fetch failed', { error: msg });
        toast.error(msg);
      } finally {
        setLoading(false);
      }
    };
    void fetchItems();
    return () => controller.abort();
  }, [category, projectFilter, statusFilter, searchDebounced, page]);

  const selectableItems = useMemo(
    () => (data?.items ?? []).filter((i) => i.action_status === 'open'),
    [data],
  );
  const allPageSelected =
    selectableItems.length > 0 && selectableItems.every((i) => selectedIds.has(i.id));
  const selectedItems = useMemo(
    () => (data?.items ?? []).filter((i) => selectedIds.has(i.id)),
    [data, selectedIds],
  );

  const toggleRow = useCallback((id: string, selectable: boolean) => {
    if (!selectable) return;
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const ids = selectableItems.map((i) => i.id);
      const all = ids.every((id) => prev.has(id));
      const n = new Set(prev);
      ids.forEach((id) => (all ? n.delete(id) : n.add(id)));
      return n;
    });
  }, [selectableItems]);

  const showCategory = !category;
  const showProject = !project;

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {showProject && (
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
            className={SELECT_CLASS} aria-label="Filter by project">
            <option value="">All projects</option>
            {projectOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ActionStatus | 'all')}
          className={SELECT_CLASS} aria-label="Filter by status">
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="search" placeholder="Search DR #, project, zone…" value={searchRaw}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="px-2 py-1.5 rounded bg-[#161b22] border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 min-w-[200px]"
          aria-label="Search items" />
        {loading && <InlineSpinner className="text-gray-400" />}
        <span className="ml-auto text-xs text-gray-500">
          {data ? `${data.total} item${data.total !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      {/* Selection bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-blue-600/15 border border-blue-500/30">
          <span className="text-sm text-blue-300 font-medium">
            {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <Button variant="primary" size="sm" onClick={() => onCreateTickets(selectedItems)}>
            Create Tickets
          </Button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto text-xs text-gray-400 hover:text-white">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-700">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-gray-700 bg-[#161b22]">
              <th className="px-3 py-2 w-8">
                <input type="checkbox" checked={allPageSelected} onChange={toggleAll}
                  disabled={selectableItems.length === 0} className="accent-blue-500"
                  aria-label="Select all on page" />
              </th>
              <th className="px-3 py-2 font-medium text-gray-400">DR #</th>
              {showCategory && <th className="px-3 py-2 font-medium text-gray-400 hidden sm:table-cell">Category</th>}
              {showProject && <th className="px-3 py-2 font-medium text-gray-400 hidden md:table-cell">Project</th>}
              <th className="px-3 py-2 font-medium text-gray-400">Status</th>
              <th className="px-3 py-2 font-medium text-gray-400 hidden sm:table-cell">Ticket</th>
              <th className="px-3 py-2 font-medium text-gray-400 hidden lg:table-cell">Days Open</th>
              <th className="px-3 py-2 font-medium text-gray-400 hidden lg:table-cell">Billing</th>
              <th className="px-3 py-2 font-medium text-gray-400 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {!loading && data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-gray-500 text-sm">
                  No items match the current filters.
                </td>
              </tr>
            )}
            {(data?.items ?? []).map((item) => (
              <ItemRow key={item.id} item={item} isSelected={selectedIds.has(item.id)}
                showCategory={showCategory} showProject={showProject} onToggle={toggleRow} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>Page {data.page} of {data.total_pages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={data.page <= 1 || loading}>
              Previous
            </Button>
            <Button variant="secondary" size="sm"
              onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))} disabled={data.page >= data.total_pages || loading}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
