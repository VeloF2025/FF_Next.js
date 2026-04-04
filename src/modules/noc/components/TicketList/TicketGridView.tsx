'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useTickets } from '../../hooks/useTickets';
import type { TicketFilters, Ticket } from '../../types/ticket';

type SortField = 'ticket_uid' | 'priority' | 'ticket_type' | 'status' | 'title' | 'dr_number' | 'created_at';
type SortDir = 'asc' | 'desc';

interface Column {
  key: SortField | 'assigned' | 'sla';
  label: string;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

const COLUMNS: Column[] = [
  { key: 'ticket_uid', label: 'ID',       sortable: true,  width: 'w-32'   },
  { key: 'priority',   label: 'Priority', sortable: true,  width: 'w-24',  align: 'center' },
  { key: 'ticket_type',label: 'Type',     sortable: true,  width: 'w-36'   },
  { key: 'status',     label: 'Status',   sortable: true,  width: 'w-36'   },
  { key: 'title',      label: 'Title',    sortable: true,  width: 'flex-1' },
  { key: 'dr_number',  label: 'DR #',     sortable: true,  width: 'w-28'   },
  { key: 'assigned',   label: 'Assigned', sortable: false, width: 'w-24',  align: 'center' },
  { key: 'sla',        label: 'SLA',      sortable: false, width: 'w-20',  align: 'center' },
  { key: 'created_at', label: 'Created',  sortable: true,  width: 'w-32'   },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const PRIORITY_STYLES: Record<string, string> = {
  low:      'bg-gray-500/20 text-gray-300 border-gray-500/30',
  normal:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  high:     'bg-orange-500/20 text-orange-300 border-orange-500/30',
  urgent:   'bg-red-500/20 text-red-300 border-red-500/30',
  critical: 'bg-red-700/30 text-red-200 border-red-600/40 font-bold',
};

const STATUS_STYLES: Record<string, string> = {
  open:                'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  assigned:            'bg-blue-500/20 text-blue-300 border-blue-500/30',
  in_progress:         'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  pending_qa:          'bg-purple-500/20 text-purple-300 border-purple-500/30',
  qa_in_progress:      'bg-violet-500/20 text-violet-300 border-violet-500/30',
  qa_rejected:         'bg-red-500/20 text-red-300 border-red-500/30',
  qa_approved:         'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  pending_handover:    'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  handed_to_maintenance:'bg-teal-500/20 text-teal-300 border-teal-500/30',
  closed:              'bg-gray-500/15 text-gray-400 border-gray-500/20',
  cancelled:           'bg-gray-600/15 text-gray-500 border-gray-600/20',
};

function clientSort(tickets: Ticket[], field: SortField, dir: SortDir): Ticket[] {
  return [...tickets].sort((a, b) => {
    const va = (a[field as keyof Ticket] as string | number | null) ?? '';
    const vb = (b[field as keyof Ticket] as string | number | null) ?? '';
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (field !== sortField) return <ChevronsUpDown className="w-3 h-3 opacity-30 shrink-0" aria-hidden="true" />;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-blue-400 shrink-0" aria-hidden="true" />
    : <ChevronDown className="w-3 h-3 text-blue-400 shrink-0" aria-hidden="true" />;
}

interface TicketGridRowProps {
  ticket: Ticket;
  isEven: boolean;
  onTicketClick?: (t: Ticket) => void;
  rowIndex: number;
  onArrowKey: (direction: 'up' | 'down', fromIndex: number) => void;
}

function TicketGridRow({ ticket, isEven, onTicketClick, rowIndex, onArrowKey }: TicketGridRowProps) {
  const href = `/noc/tickets/${ticket.id}`;
  const linkable = !onTicketClick;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      onArrowKey('down', rowIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onArrowKey('up', rowIndex);
    } else if (onTicketClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onTicketClick(ticket);
    }
  }, [onTicketClick, onArrowKey, rowIndex, ticket]);

  return (
    <tr
      className={cn(
        'border-b border-[var(--ff-border-light)] transition-colors cursor-pointer',
        isEven ? 'bg-[var(--ff-bg-primary)]' : 'bg-[var(--ff-bg-secondary)]',
        'hover:bg-[var(--ff-primary-500)]/10',
        onTicketClick && ticket.sla_breached && 'ring-inset ring-1 ring-red-500/30',
      )}
      onClick={onTicketClick ? () => onTicketClick(ticket) : undefined}
      onKeyDown={handleKeyDown}
      tabIndex={onTicketClick ? 0 : -1}
      role={onTicketClick ? 'button' : 'row'}
      aria-label={onTicketClick
        ? `Ticket ${ticket.ticket_uid}: ${ticket.title}, priority ${ticket.priority}, status ${ticket.status.replace(/_/g, ' ')}`
        : undefined}
      data-row-index={rowIndex}
    >
      <td className="px-2 py-1.5 font-mono text-blue-400 whitespace-nowrap">
        {linkable ? <Link href={href} className="block hover:underline">{ticket.ticket_uid}</Link> : ticket.ticket_uid}
      </td>
      <td className="px-2 py-1.5 text-center">
        <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] border uppercase tracking-wide', PRIORITY_STYLES[ticket.priority] ?? 'text-gray-400')}>
          {ticket.priority}
        </span>
      </td>
      <td className="px-2 py-1.5 text-[var(--ff-text-secondary)] whitespace-nowrap">
        {(ticket.ticket_type ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      </td>
      <td className="px-2 py-1.5">
        <span className={cn('inline-block px-1.5 py-0.5 rounded text-[10px] border whitespace-nowrap capitalize', STATUS_STYLES[ticket.status] ?? 'text-gray-400')}>
          {ticket.status.replace(/_/g, ' ')}
        </span>
      </td>
      <td className="px-2 py-1.5 text-[var(--ff-text-primary)] max-w-0">
        {linkable
          ? <Link href={href} className="block truncate hover:underline" title={ticket.title}>{ticket.title}</Link>
          : <div className="truncate" title={ticket.title}>{ticket.title}</div>
        }
        {ticket.fault_cause && (
          <div className="text-[10px] text-[var(--ff-text-tertiary)] truncate capitalize">
            {ticket.fault_cause.replace(/_/g, ' ')}
          </div>
        )}
      </td>
      <td className="px-2 py-1.5 font-mono text-[var(--ff-text-secondary)] text-[11px] whitespace-nowrap">
        {ticket.dr_number ?? '\u2014'}
      </td>
      <td className="px-2 py-1.5 text-center">
        <span
          className={cn(
            'inline-flex items-center justify-center w-2 h-2 rounded-full',
            ticket.assigned_to ? 'bg-green-400' : 'bg-gray-600'
          )}
          role="img"
          aria-label={ticket.assigned_to ? `Assigned to ${ticket.assigned_to}` : 'Unassigned'}
          title={ticket.assigned_to ? 'Assigned' : 'Unassigned'}
        />
      </td>
      <td className="px-2 py-1.5 text-center">
        {ticket.sla_breached
          ? <span role="img" aria-label="SLA Breached" title="SLA Breached" className="flex justify-center"><AlertTriangle className="w-3.5 h-3.5 text-red-400" aria-hidden="true" /></span>
          : ticket.qa_ready
            ? <span role="img" aria-label="QA Ready" title="QA Ready" className="flex justify-center"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /></span>
            : <span className="text-[var(--ff-text-tertiary)]" aria-label="No SLA status">{'\u2014'}</span>
        }
      </td>
      <td className="px-2 py-1.5 text-[var(--ff-text-tertiary)] whitespace-nowrap">
        {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true })}
      </td>
    </tr>
  );
}

interface TicketGridViewProps {
  initialFilters?: TicketFilters;
  onTicketClick?: (ticket: Ticket) => void;
}

export function TicketGridView({ initialFilters = {}, onTicketClick }: TicketGridViewProps) {
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir]     = useState<SortDir>('desc');
  const [page, setPage]           = useState(1);
  const [pageSize, setPageSize]   = useState(50);

  // Live region for screen reader announcements
  const liveRegionRef = useRef<HTMLDivElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const announce = useCallback((message: string) => {
    if (liveRegionRef.current) {
      liveRegionRef.current.textContent = '';
      // Slight delay ensures AT picks up the change even for identical messages
      requestAnimationFrame(() => {
        if (liveRegionRef.current) {
          liveRegionRef.current.textContent = message;
        }
      });
    }
  }, []);

  const filters: TicketFilters = useMemo(() => ({
    ...initialFilters, page, pageSize,
  }), [initialFilters, page, pageSize]);

  const { tickets, pagination, isLoading, isError, error, refetch } = useTickets(filters);
  const sorted = useMemo(() => clientSort(tickets, sortField, sortDir), [tickets, sortField, sortDir]);

  const handleSort = (field: SortField, label: string) => {
    let newDir: SortDir;
    if (field === sortField) {
      newDir = sortDir === 'asc' ? 'desc' : 'asc';
      setSortDir(newDir);
    } else {
      newDir = 'asc';
      setSortField(field);
      setSortDir(newDir);
    }
    announce(`${label} sorted ${newDir === 'asc' ? 'ascending' : 'descending'}`);
  };

  // Announce page changes to screen readers
  useEffect(() => {
    if (pagination && !isLoading) {
      const start = ((pagination.page - 1) * pagination.pageSize) + 1;
      const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
      announce(`Page ${pagination.page} of ${pagination.totalPages}. Showing tickets ${start} to ${end} of ${pagination.total}.`);
    }
  }, [pagination?.page, pagination?.totalPages, isLoading, announce]);

  // Arrow key row navigation
  const handleArrowKey = useCallback((direction: 'up' | 'down', fromIndex: number) => {
    if (!tbodyRef.current) return;
    const targetIndex = direction === 'down' ? fromIndex + 1 : fromIndex - 1;
    const targetRow = tbodyRef.current.querySelector<HTMLTableRowElement>(`tr[data-row-index="${targetIndex}"]`);
    if (targetRow) {
      targetRow.focus();
    } else if (direction === 'down' && pagination && pagination.page < pagination.totalPages) {
      // At last row — move to next page and announce
      setPage(p => p + 1);
      announce('Moving to next page');
    } else if (direction === 'up' && page > 1) {
      // At first row — move to previous page
      setPage(p => Math.max(1, p - 1));
      announce('Moving to previous page');
    }
  }, [pagination, page, announce]);

  // Focus first row after page change (keyboard nav context)
  const prevPageRef = useRef(page);
  useEffect(() => {
    if (prevPageRef.current !== page && tbodyRef.current && !isLoading) {
      const firstRow = tbodyRef.current.querySelector<HTMLTableRowElement>('tr[data-row-index="0"]');
      if (firstRow) firstRow.focus();
    }
    prevPageRef.current = page;
  }, [page, isLoading]);

  if (isLoading && tickets.length === 0) return (
    <div className="flex items-center justify-center p-12" role="status" aria-live="polite">
      <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-text-secondary)]" aria-hidden="true" />
      <span className="ml-3 text-[var(--ff-text-secondary)]">Loading tickets…</span>
    </div>
  );
  if (isError && tickets.length === 0) return (
    <div className="p-8" role="alert">
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium text-red-400">Error loading tickets</p>
          <p className="text-sm text-red-300 mt-1">{error?.message ?? 'Unknown error'}</p>
          <Button variant="danger" size="sm" onClick={() => refetch()} className="mt-3">Retry</Button>
        </div>
      </div>
    </div>
  );
  if (tickets.length === 0 && !isLoading) return (
    <div className="flex flex-col items-center justify-center p-16 text-center" role="status">
      <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-3" aria-hidden="true" />
      <p className="text-[var(--ff-text-secondary)]">No tickets found</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Screen reader live region — invisible, polite announcements */}
      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 shrink-0" role="toolbar" aria-label="Ticket grid controls">
        <span className="text-xs text-[var(--ff-text-tertiary)]" aria-live="polite">
          {pagination ? `${pagination.total.toLocaleString()} tickets` : ''}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--ff-text-tertiary)]" id="rows-label">Rows:</span>
          <div role="group" aria-labelledby="rows-label">
            {PAGE_SIZE_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => { setPageSize(n); setPage(1); announce(`Showing ${n} rows per page`); }}
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium border transition-colors min-w-[44px] min-h-[44px]',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ff-primary-500)]',
                  pageSize === n
                    ? 'bg-[var(--ff-primary-500)] text-white border-transparent'
                    : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
                )}
                aria-label={`Show ${n} rows per page`}
                aria-pressed={pageSize === n}
              >{n}</button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { refetch(); announce('Refreshing tickets'); }}
            disabled={isLoading}
            className="ml-1"
            title="Refresh"
            aria-label="Refresh tickets"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-[var(--ff-border-light)] min-h-0">
        <table
          className="w-full text-xs border-collapse min-w-[900px]"
          aria-busy={isLoading}
          aria-label="NOC Tickets"
        >
          <caption className="sr-only">
            NOC tickets list. Use arrow keys to navigate between rows. Columns: ID, Priority, Type, Status, Title, DR number, Assignment, SLA, and Age. {pagination ? `${pagination.total} tickets total.` : ''}
          </caption>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
              {COLUMNS.map(col => {
                // Derive aria-sort for sortable columns per WCAG 1.3.1 / ARIA 1.2
                const ariaSortValue: 'ascending' | 'descending' | 'none' | undefined = col.sortable
                  ? sortField === col.key
                    ? sortDir === 'asc' ? 'ascending' : 'descending'
                    : 'none'
                  : undefined;

                return (
                  <th
                    key={col.key}
                    className={cn(
                      'px-2 py-2 font-semibold text-[var(--ff-text-secondary)] whitespace-nowrap select-none text-left',
                      col.width,
                      col.align === 'center' && 'text-center',
                      col.align === 'right' && 'text-right',
                    )}
                    scope="col"
                    aria-sort={ariaSortValue}
                  >
                    {col.sortable ? (
                      <button
                        onClick={() => handleSort(col.key as SortField, col.label)}
                        className={cn(
                          'flex items-center gap-1 w-full p-0 font-semibold text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] rounded px-1 py-0.5 transition-colors',
                          'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ff-primary-500)]',
                          col.align === 'center' && 'justify-center',
                          col.align === 'right' && 'justify-end'
                        )}
                        aria-label={
                          sortField === col.key
                            ? `${col.label}, sorted ${sortDir === 'asc' ? 'ascending' : 'descending'}, click to sort descending`
                            : `${col.label}, unsorted, click to sort ascending`
                        }
                      >
                        {col.label}
                        <SortIcon field={col.key} sortField={sortField} sortDir={sortDir} />
                      </button>
                    ) : (
                      <div className={cn('flex items-center gap-1', col.align === 'center' && 'justify-center', col.align === 'right' && 'justify-end')}>
                        {col.label}
                      </div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {sorted.map((ticket, idx) => (
              <TicketGridRow
                key={ticket.id}
                ticket={ticket}
                isEven={idx % 2 === 0}
                onTicketClick={onTicketClick}
                rowIndex={idx}
                onArrowKey={handleArrowKey}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <nav
          className="flex items-center justify-between shrink-0 pt-1"
          aria-label={`Pagination, page ${pagination.page} of ${pagination.totalPages}`}
        >
          <span className="text-xs text-[var(--ff-text-tertiary)]" aria-live="polite" aria-atomic="true">
            Showing {((pagination.page - 1) * pagination.pageSize) + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total.toLocaleString()} tickets
          </span>
          <div className="flex items-center gap-1" role="group" aria-label="Page navigation">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={pagination.page === 1 || isLoading}
              className="p-2.5 rounded text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ff-primary-500)] min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label={`Previous page, go to page ${pagination.page - 1} of ${pagination.totalPages}`}
              aria-disabled={pagination.page === 1 || isLoading}
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <span
              className="text-xs text-[var(--ff-text-secondary)] px-2 min-w-[64px] text-center"
              aria-current="page"
              aria-label={`Page ${pagination.page} of ${pagination.totalPages}`}
            >
              {pagination.page} / {pagination.totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page === pagination.totalPages || isLoading}
              className="p-2.5 rounded text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--ff-primary-500)] min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label={`Next page, go to page ${pagination.page + 1} of ${pagination.totalPages}`}
              aria-disabled={pagination.page === pagination.totalPages || isLoading}
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
