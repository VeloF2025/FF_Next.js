/**
 * OltFixLogTab — import history + recent fixes with date/status filters
 * (Renamed from "History" to "Fix Log" to avoid confusion with universal History group)
 */

'use client';

import { Loader2 } from 'lucide-react';
import type { OltRecord, OltStats, ImportRecord, DateFilter } from '../../../types';
import { OltDateFilterBar } from './OltDateFilterBar';
import { OltStatsBar } from './OltStatsBar';

interface OltFixLogTabProps {
  fixHistory: OltRecord[];
  imports: ImportRecord[];
  stats: OltStats;
  isLoading: boolean;
  total: number;
  dateFilter: DateFilter;
  customDate: string;
  statusFilter: string;
  setDateFilter: (f: DateFilter) => void;
  setCustomDate: (d: string) => void;
  setStatusFilter: (s: string) => void;
}

export function OltFixLogTab({
  fixHistory,
  imports,
  stats,
  isLoading,
  total,
  dateFilter,
  customDate,
  statusFilter,
  setDateFilter,
  setCustomDate,
  setStatusFilter,
}: OltFixLogTabProps) {
  return (
    <div className="space-y-6">
      {/* Date + Stats filters */}
      <OltDateFilterBar
        dateFilter={dateFilter}
        customDate={customDate}
        onDateFilterChange={setDateFilter}
        onCustomDateChange={setCustomDate}
      />
      <OltStatsBar
        stats={stats}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      {/* Fix Activity */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="px-5 py-3 border-b border-[var(--ff-border-light)]">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">
            {statusFilter === 'all' ? 'All Records' : statusFilter === 'fixed' ? 'Fixes' : statusFilter === 'pending' ? 'Pending' : statusFilter === 'needs_investigation' ? 'Investigate' : statusFilter === 'escalated' ? 'Escalated' : statusFilter === 'resolved' ? 'Resolved' : 'Records'}{' '}
            {fixHistory.length < total ? `(${fixHistory.length} of ${total})` : `(${total})`}
          </h3>
        </div>
        {fixHistory.length === 0 ? (
          <div className="text-center py-8 text-[var(--ff-text-tertiary)] text-sm">
            No records found for this filter
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">DR Number</th>
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">OLT Serial</th>
                  {statusFilter !== 'fixed' && (
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Status</th>
                  )}
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                    {statusFilter === 'fixed' ? 'Result' : '1Map Serial'}
                  </th>
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">
                    {statusFilter === 'fixed' ? 'Old Value' : 'Details'}
                  </th>
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {fixHistory.map((record) => {
                  let oldVal = '-';
                  try {
                    const parsed = record.fix_old_value ? JSON.parse(record.fix_old_value) : null;
                    oldVal = parsed?.ont_old || '-';
                  } catch { oldVal = record.fix_old_value || '-'; }

                  const statusBadge = (() => {
                    const s = record.fix_status || 'pending';
                    if (s === 'fixed') return { cls: 'bg-green-500/20 text-green-400', text: 'fixed' };
                    if (s === 'pending') return { cls: 'bg-amber-500/20 text-amber-400', text: 'pending' };
                    if (s === 'needs_investigation') return { cls: 'bg-orange-500/20 text-orange-400', text: 'investigate' };
                    if (s === 'not_found') return { cls: 'bg-red-500/20 text-red-400', text: 'not found' };
                    if (s === 'escalated') return { cls: 'bg-red-500/20 text-red-400', text: 'escalated' };
                    if (s === 'resolved') return { cls: 'bg-blue-500/20 text-blue-400', text: 'resolved' };
                    return { cls: 'bg-gray-500/20 text-gray-400', text: s };
                  })();

                  return (
                    <tr key={record.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                      <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">{record.drop_number}</td>
                      <td className="py-3 px-4 text-green-400 font-mono text-xs">{record.olt_serial || '-'}</td>
                      {statusFilter !== 'fixed' && (
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-xs ${statusBadge.cls}`}>{statusBadge.text}</span>
                        </td>
                      )}
                      <td className="py-3 px-4 font-mono text-xs">
                        {statusFilter === 'fixed' ? (
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            record.fix_result === 'success' ? 'bg-green-500/20 text-green-400' :
                            record.fix_result === 'already_correct' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-amber-500/20 text-amber-400'
                          }`}>
                            {record.fix_result === 'already_correct' ? 'verified' : record.fix_result || 'fixed'}
                          </span>
                        ) : (
                          <span className="text-red-400">{record.wrong_onemap_serial || '-'}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-red-400 font-mono text-xs">
                        {statusFilter === 'fixed' ? oldVal : (record.wrong_onemap_serial && record.wrong_onemap_serial !== record.olt_serial ? `Wrong: ${record.wrong_onemap_serial}` : '-')}
                      </td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">
                        {(record.fix_attempted_at || record.created_at)
                          ? new Date(record.fix_attempted_at || record.created_at || '').toLocaleString()
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Import History */}
      <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
        <div className="px-5 py-3 border-b border-[var(--ff-border-light)]">
          <h3 className="text-sm font-semibold text-[var(--ff-text-primary)]">Import History</h3>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
          </div>
        ) : imports.length === 0 ? (
          <div className="text-center py-8 text-[var(--ff-text-tertiary)] text-sm">No imports yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Filename</th>
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Project</th>
                  <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Total</th>
                  <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Mismatches</th>
                  <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Imported</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((imp) => (
                  <tr key={imp.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                    <td className="py-3 px-4 text-[var(--ff-text-primary)]">{imp.filename}</td>
                    <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{imp.project || '-'}</td>
                    <td className="py-3 px-4 text-right text-[var(--ff-text-primary)]">{imp.total_records}</td>
                    <td className="py-3 px-4 text-right text-amber-400">{imp.mismatch_count}</td>
                    <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{new Date(imp.imported_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
