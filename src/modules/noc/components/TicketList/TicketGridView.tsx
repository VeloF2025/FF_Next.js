'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
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
  const ariaLabel = sortDir === 'asc' ? `${field} sorted ascending` : `${field} sorted descending`;
  return sortDir === 'asc'
    ? <ChevronUp className="w-3 h-3 text-blue-400 shrink-0" aria-label={ariaLabel} />
    : <ChevronDown className="w-3 h-3 text-blue-400 shrink-0" aria-label={ariaLabel} />;
}

function TicketGridRow({ ticket, isEven, onTicketClick }: { ticket: Ticket; isEven: boolean; onTicketClick?: (t: Ticket) => void }) {
  const href = `/noc/tickets/${ticket.id}`;
  const linkable = !onTicketClick;

  const handleKeyDown = onTicketClick
    ? (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTicketClick(ticket); } }
    : undefined;

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
      tabIndex={onTicketClick ? 0 : undefined}
      role={onTicketClick ? 'button' : undefined}
      aria-label={onTicketClick ? `Open ticket ${ticket.ticket_uid}: ${ticket.title}` : undefined}
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
        {ticket.ticket_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
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
        <span className={cn('inline-block w-2 h-2 rounded-full', ticket.assigned_to ? 'bg-green-400' : 'bg-gray-600')}
          aria-label={ticket.assigned_to ? `Assigned to ${ticket.assigned_to}` : 'Unassigned'}
          title={ticket.assigned_to ? 'Assigned' : 'Unassigned'} />
      </td>
      <td className="px-2 py-1.5 text-center">
        {ticket.sla_breached
          ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 mx-auto" aria-label="SLA Breached" title="SLA Breached" />
          : ticket.qa_ready
            ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mx-auto" aria-label="QA Ready" title="QA Ready" />
            : <span className="text-[var(--ff-text-tertiary)]" aria-label="No status">{'\u2014'}</span>
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

  const filters: TicketFilters = useMemo(() => ({
    ...initialFilters, page, pageSize,
  }), [initialFilters, page, pageSize]);

  const { tickets, pagination, isLoading, isError, error, refetch } = useTickets(filters);
  const sorted = useMemo(() => clientSort(tickets, sortField, sortDir), [tickets, sortField, sortDir]);
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  if (isLoading && tickets.length === 0) return (
    <div className="flex items-center justify-center p-12">
      <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-text-secondary)]" />
      <span className="ml-3 text-[var(--ff-text-secondary)]">Loading tickets...</span>
    </div>
  );
  if (isError && tickets.length === 0) return (
    <div className="p-8">
      <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-6 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium text-red-400">Error loading tickets</p>
          <p className="text-sm text-red-300 mt-1">{error?.message ?? 'Unknown error'}</p>
          <button onClick={() => refetch()} className="mt-3 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm">Retry</button>
        </div>
      </div>
    </div>
  );
  if (tickets.length === 0 && !isLoading) return (
    <div className="flex flex-col items-center justify-center p-16 text-center">
      <FileText className="w-12 h-12 text-[var(--ff-text-tertiary)] mb-3" />
      <p className="text-[var(--ff-text-secondary)]">No tickets found</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <span className="text-xs text-[var(--ff-text-tertiary)]">
          {pagination ? `${pagination.total.toLocaleString()} tickets` : ''}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--ff-text-tertiary)]">Rows:</span>
          {PAGE_SIZE_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => { setPageSize(n); setPage(1); }}
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium border transition-colors',
                pageSize === n
                  ? 'bg-[var(--ff-primary-500)] text-white border-transparent'
                  : 'bg-[var(--ff-bg-secondary)] text-[var(--ff-text-secondary)] border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]'
              )}
              aria-label={`Show ${n} rows per page`}
              aria-pressed={pageSize === n}
            >{n}</button>
          ))}
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="ml-1 p-1.5 rounded text-[var(--ff-text-tertiary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-40"
            title="Refresh"
            aria-label="Refresh tickets"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border border-[var(--ff-border-light)] min-h-0">
        <table className="w-full text-xs border-collapse min-w-[900px]">
          <caption className="sr-only">NOC tickets list with sortable columns for ticket ID, priority, type, status, title, DR number, assignment, SLA status, and age</caption>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-2 py-2 font-semibold text-[var(--ff-text-secondary)] whitespace-nowrap select-none text-left',
                    col.width,
                    col.align === 'center' && 'text-center',
                    col.align === 'right' && 'text-right',
                  )}
                  scope="col"
                >
                  {col.sortable ? (
                    <button
                      onClick={() => handleSort(col.key as SortField)}
                      className={cn(
                        'flex items-center gap-1 w-full p-0 font-semibold text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] rounded px-1 py-0.5 transition-colors',
                        col.align === 'center' && 'justify-center',
                        col.align === 'right' && 'justify-end'
                      )}
                      aria-label={`Sort by ${col.label}, currently ${sortField === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'unsorted'}`}
                      aria-pressed={sortField === col.key}
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
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((ticket, idx) => (
              <TicketGridRow key={ticket.id} ticket={ticket} isEven={idx % 2 === 0} onTicketClick={onTicketClick} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between shrink-0 pt-1">
          <span className="text-xs text-[var(--ff-text-tertiary)]">
            {((pagination.page - 1) * pagination.pageSize) + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={pagination.page === 1 || isLoading}
              className="p-1 rounded text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="text-xs text-[var(--ff-text-secondary)] px-2" aria-label={`Page ${pagination.page} of ${pagination.totalPages}`}>{pagination.page} / {pagination.totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
              disabled={pagination.page === pagination.totalPages || isLoading}
              className="p-1 rounded text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] hover:bg-[var(--ff-bg-secondary)] disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
