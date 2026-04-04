/**
 * OltRecordTable — shared record table used by Fixable, Investigate, Escalations tabs
 */

'use client';

import React from 'react';
import {
  ExternalLink,
  Wrench,
  CheckCircle,
  CheckSquare,
  Square,
  Info,
} from 'lucide-react';
import type { OltRecord, InvestigationContext, DisplacedInfo } from '../../../types';
import { LoadingSpinner, InlineSpinner } from '@/components/ui/LoadingSpinner';

type TabMode = 'pending' | 'investigate' | 'escalations';

interface OltRecordTableProps {
  records: OltRecord[];
  mode: TabMode;
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (p: number | ((prev: number) => number)) => void;
  isLoading: boolean;

  // Fixable-specific
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  allSelected?: boolean;
  fixableCount?: number;

  // Fix actions
  fixing?: string | null;
  fixErrors?: Record<string, string>;
  onFix?: (record: OltRecord) => void;
  bulkFixing?: boolean;

  // Investigate-specific
  onResolve?: (recordId: string) => void;
  onEscalate?: (recordId: string) => void;

  // Helpers
  isStatusMismatch: (record: OltRecord) => boolean;
  getInvestigationContext: (record: OltRecord) => InvestigationContext | null;

  // Displaced info (pending tab only)
  displacedInfo?: Record<string, DisplacedInfo>;

  // Investigation context expansion
  expandedContexts?: Set<string>;
  onToggleContext?: (id: string) => void;

  // Render investigation context row
  renderContextRow?: (record: OltRecord) => React.ReactNode;

  // Investigate ticketing selection
  isSelectable?: (record: OltRecord) => boolean;
}

export function OltRecordTable({
  records,
  mode,
  page,
  total,
  pageSize,
  onPageChange,
  isLoading,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  fixableCount: _fixableCount,
  fixing,
  fixErrors,
  onFix,
  bulkFixing,
  onResolve,
  onEscalate,
  isStatusMismatch,
  getInvestigationContext,
  displacedInfo,
  renderContextRow,
  isSelectable,
}: OltRecordTableProps) {
  const showCheckboxes = mode === 'pending' || (mode === 'investigate' && !!onToggleSelect);
  if (isLoading) {
    return (
      <LoadingSpinner className="py-12" size="md" label="Loading records..." />
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--ff-text-tertiary)]">
        No records found
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
              {showCheckboxes && (
                <th className="w-12 py-3 px-4">
                  <button
                    onClick={onToggleSelectAll}
                    className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)]"
                  >
                    {allSelected ? (
                      <CheckSquare className="w-5 h-5 text-[var(--ff-accent)]" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>
                </th>
              )}
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">DR Number</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Project</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">OLT Serial</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">1Map Serial</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Status</th>
              <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Ticket</th>
              <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <React.Fragment key={record.id}>
                <tr
                  className={`border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)] ${
                    selectedIds?.has(record.id) ? 'bg-[var(--ff-accent)]/10' : ''
                  }`}
                >
                  {showCheckboxes && (
                    <td className="w-12 py-3 px-4">
                      {(mode === 'pending' ? record.olt_serial : isSelectable?.(record)) ? (
                        <button
                          onClick={() => onToggleSelect?.(record.id)}
                          className="text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)]"
                        >
                          {selectedIds?.has(record.id) ? (
                            <CheckSquare className="w-5 h-5 text-[var(--ff-accent)]" />
                          ) : (
                            <Square className="w-5 h-5" />
                          )}
                        </button>
                      ) : (
                        <span className="w-5 h-5 block" />
                      )}
                    </td>
                  )}
                  <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">{record.drop_number}</td>
                  <td className="py-3 px-4 text-[var(--ff-text-secondary)] text-xs truncate max-w-[140px]">{record.project || '-'}</td>
                  <td className="py-3 px-4 text-green-400 font-mono">{record.olt_serial || '-'}</td>
                  <td className={`py-3 px-4 font-mono ${isStatusMismatch(record) ? 'text-green-400' : 'text-red-400'}`}>
                    {isStatusMismatch(record)
                      ? <span title="Serial matches OES">{record.olt_serial} <CheckCircle className="w-3 h-3 inline" /></span>
                      : (record.wrong_onemap_serial || record.onemap_serial || '-')}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        record.fix_status === 'fixed'
                          ? 'bg-green-500/20 text-green-400'
                          : record.fix_status === 'escalated'
                          ? 'bg-red-500/20 text-red-400'
                          : record.fix_status === 'needs_investigation'
                          ? 'bg-purple-500/20 text-purple-400'
                          : 'bg-amber-500/20 text-amber-400'
                      }`}
                    >
                      {record.fix_status || 'pending'}
                    </span>
                    {record.has_ups_swap && (
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-orange-500/20 text-orange-400">UPS Swap</span>
                    )}
                    {isStatusMismatch(record) && (() => {
                      const ctx = getInvestigationContext(record);
                      return (
                        <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-400" title={ctx?.message}>
                          Status: {ctx?.currentStatus || 'wrong'}
                        </span>
                      );
                    })()}
                    {mode === 'pending' && record.wrong_onemap_serial && displacedInfo?.[record.wrong_onemap_serial] && (() => {
                      const info = displacedInfo![record.wrong_onemap_serial!]!;
                      if (info.activated && info.ownerDr && info.ownerDr !== record.drop_number) {
                        return (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400 inline-flex items-center gap-0.5" title={`Displaced ONT belongs to ${info.ownerDr} (${info.ownerTeam || 'unknown team'})`}>
                            <Info className="w-3 h-3" /> {info.ownerDr}
                          </span>
                        );
                      }
                      if (!info.activated) {
                        const ws = record.wrong_onemap_serial!.toUpperCase();
                        const isOntSerial = /^ALCL|^HWTC/.test(ws);
                        const isUpsSerial = ws.startsWith('GU18');
                        const label = isOntSerial ? 'Unactivated ONT' : isUpsSerial ? 'UPS Serial' : 'Invalid Serial';
                        const tooltip = isOntSerial
                          ? 'Displaced ONT is not activated in OES — untracked physical ONT'
                          : isUpsSerial
                          ? 'Wrong serial is a UPS, not an ONT'
                          : 'Wrong serial does not match any known ONT or UPS pattern';
                        return (
                          <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-400 inline-flex items-center gap-0.5" title={tooltip}>
                            <Info className="w-3 h-3" /> {label}
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </td>
                  <td className="py-3 px-4">
                    {record.ticket_uid ? (
                      <a
                        href={`/noc/tickets/${record.maintenance_ticket_id}`}
                        className="text-blue-400 hover:text-blue-300 text-xs font-mono"
                      >
                        {record.ticket_uid}
                      </a>
                    ) : (
                      <span className="text-[var(--ff-text-tertiary)]">-</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={`https://www.1map.co.za/apps/app?workspace=Fibertime%20Installations&selected=${record.drop_number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1.5 text-[var(--ff-text-secondary)] hover:text-[var(--ff-accent)] transition-colors"
                        title="View in 1Map"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      {mode === 'pending' && record.olt_serial && (
                        <div className="flex flex-col items-end gap-1">
                          <button
                            onClick={() => onFix?.(record)}
                            disabled={fixing === record.id || bulkFixing}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[var(--ff-accent)] text-white text-xs rounded hover:bg-[var(--ff-accent)]/80 disabled:opacity-50"
                          >
                            {fixing === record.id ? (
                              <InlineSpinner size="sm" />
                            ) : (
                              <Wrench className="w-3 h-3" />
                            )}
                            {isStatusMismatch(record) ? 'Fix Status' : 'Fix'}
                          </button>
                          {fixErrors?.[record.id] && (
                            <span className="text-[10px] text-red-400 max-w-[160px] text-right leading-tight">
                              {fixErrors[record.id]}
                            </span>
                          )}
                        </div>
                      )}
                      {mode === 'investigate' && (
                        <>
                          <button
                            onClick={() => onResolve?.(record.id)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700"
                            title="Mark as resolved"
                          >
                            <CheckCircle className="w-3 h-3" />
                            Resolve
                          </button>
                          <button
                            onClick={() => onEscalate?.(record.id)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-xs rounded hover:bg-red-700"
                            title="Escalate to admin"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Escalate
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                {renderContextRow?.(record)}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between p-4 border-t border-[var(--ff-border-light)]">
          <span className="text-sm text-[var(--ff-text-secondary)]">
            Showing {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange((p: number) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => onPageChange((p: number) => p + 1)}
              disabled={page * pageSize >= total}
              className="px-3 py-1 text-sm bg-[var(--ff-bg-tertiary)] rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
