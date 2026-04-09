/**
 * P&L Report Component
 *
 * Standard P&L table with expandable sections.
 * Toggle between BU and Site view, date range filter, CSV export.
 */

import React, { useState, useEffect } from 'react';
import {
  Building2,
  MapPin,
  Download,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { usePnLReport, PnLViewMode } from '../hooks/usePnLReport';

const SECTION_ORDER = ['Revenue', 'Cost of Sales', 'Other Income', 'Expenses', 'Other Expenses', 'Other'];

function formatCurrency(amount: number): string {
  return `R ${amount.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PnLReport() {
  const { data, loading, error, fetchReport } = usePnLReport();
  const [viewMode, setViewMode] = useState<PnLViewMode>('bu');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(SECTION_ORDER)
  );

  useEffect(() => {
    fetchReport(viewMode, fromDate || undefined, toDate || undefined);
  }, [viewMode, fetchReport, fromDate, toDate]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const columns = viewMode === 'bu'
    ? data?.businessUnits || []
    : (data?.sites || []).map(s => s.siteName);

  const handleExportCSV = () => {
    if (!data) return;

    const headers = ['Account', 'Category', ...columns, 'Total'];
    const csvRows = [headers.join(',')];

    for (const row of data.rows) {
      const values = [
        `"${row.accountName}"`,
        `"${row.categoryGroup}"`,
        ...columns.map(col => row.amounts[col]?.toFixed(2) || '0.00'),
        row.total.toFixed(2),
      ];
      csvRows.push(values.join(','));
    }

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pnl-by-${viewMode}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Group rows by section
  const sections = new Map<string, typeof data extends { rows: infer R } ? R : never>();
  if (data) {
    for (const row of data.rows) {
      const group = row.categoryGroup || 'Other';
      if (!sections.has(group)) {
        sections.set(group, []);
      }
      sections.get(group)!.push(row);
    }
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setViewMode('bu')}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center transition-colors ${
              viewMode === 'bu'
                ? 'bg-[var(--ff-accent)] text-white'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-border)]'
            }`}
          >
            <Building2 className="w-4 h-4 mr-1.5" />
            By Business Unit
          </button>
          <button
            onClick={() => setViewMode('site')}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center transition-colors ${
              viewMode === 'site'
                ? 'bg-[var(--ff-accent)] text-white'
                : 'bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] hover:bg-[var(--ff-border)]'
            }`}
          >
            <MapPin className="w-4 h-4 mr-1.5" />
            By Site
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--ff-text-primary)]"
          />
          <span className="text-[var(--ff-text-tertiary)]">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border)] rounded-lg px-3 py-1.5 text-sm text-[var(--ff-text-primary)]"
          />
          <button
            onClick={handleExportCSV}
            disabled={!data || loading}
            className="bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-border)] disabled:opacity-50 text-[var(--ff-text-primary)] px-3 py-1.5 rounded-lg text-sm flex items-center"
          >
            <Download className="w-4 h-4 mr-1" />
            CSV
          </button>
        </div>
      </div>

      {/* Date Range Display */}
      {data?.dateRange && (
        <p className="text-xs text-[var(--ff-text-tertiary)]">
          Period: {data.dateRange.from} to {data.dateRange.to}
        </p>
      )}

      {/* Loading / Error */}
      {loading && <LoadingSpinner className="py-12" label="Loading report..." />}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center">
          <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {/* P&L Table */}
      {!loading && data && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--ff-border)]">
                <th className="text-left p-3 text-[var(--ff-text-tertiary)] font-medium sticky left-0 bg-[var(--ff-bg-secondary)] min-w-[200px]">
                  Account
                </th>
                {columns.map((col) => (
                  <th key={col} className="text-right p-3 text-[var(--ff-text-tertiary)] font-medium min-w-[120px]">
                    {col}
                  </th>
                ))}
                <th className="text-right p-3 text-[var(--ff-text-primary)] font-semibold min-w-[120px]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {SECTION_ORDER.map((section) => {
                const sectionRows = sections.get(section);
                if (!sectionRows || sectionRows.length === 0) return null;

                const isExpanded = expandedSections.has(section);
                const sectionTotal = sectionRows.reduce((sum: number, r: { total: number }) => sum + r.total, 0);

                return (
                  <React.Fragment key={section}>
                    {/* Section Header */}
                    <tr
                      onClick={() => toggleSection(section)}
                      className="cursor-pointer hover:bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border)]"
                    >
                      <td className="p-3 font-semibold text-[var(--ff-text-primary)] sticky left-0 bg-[var(--ff-bg-secondary)] flex items-center">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 mr-1.5 text-[var(--ff-text-tertiary)]" />
                        ) : (
                          <ChevronRight className="w-4 h-4 mr-1.5 text-[var(--ff-text-tertiary)]" />
                        )}
                        {section}
                      </td>
                      {columns.map((col) => {
                        const colTotal = sectionRows.reduce(
                          (sum: number, r: { amounts: Record<string, number> }) => sum + (r.amounts[col] || 0), 0
                        );
                        return (
                          <td key={col} className="p-3 text-right font-semibold text-[var(--ff-text-secondary)]">
                            {formatCurrency(colTotal)}
                          </td>
                        );
                      })}
                      <td className="p-3 text-right font-bold text-[var(--ff-text-primary)]">
                        {formatCurrency(sectionTotal)}
                      </td>
                    </tr>

                    {/* Section Rows */}
                    {isExpanded && sectionRows.map((row: { accountId: string; accountName: string; category: string; amounts: Record<string, number>; total: number }) => (
                      <tr
                        key={row.accountId}
                        className="hover:bg-[var(--ff-bg-tertiary)]"
                      >
                        <td className="p-3 pl-8 text-[var(--ff-text-secondary)] sticky left-0 bg-[var(--ff-bg-secondary)]">
                          {row.accountName}
                        </td>
                        {columns.map((col) => (
                          <td key={col} className="p-3 text-right text-[var(--ff-text-secondary)]">
                            {row.amounts[col]
                              ? formatCurrency(row.amounts[col])
                              : <span className="text-[var(--ff-text-tertiary)]">-</span>}
                          </td>
                        ))}
                        <td className="p-3 text-right font-medium text-[var(--ff-text-primary)]">
                          {formatCurrency(row.total)}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}

              {/* Grand Total */}
              <tr className="border-t-2 border-[var(--ff-accent)] bg-[var(--ff-bg-tertiary)]">
                <td className="p-3 font-bold text-[var(--ff-text-primary)] sticky left-0 bg-[var(--ff-bg-tertiary)]">
                  Net Income
                </td>
                {columns.map((col) => {
                  const colTotal = data.rows.reduce(
                    (sum, r) => sum + (r.amounts[col] || 0), 0
                  );
                  return (
                    <td key={col} className="p-3 text-right font-bold text-[var(--ff-text-primary)]">
                      {formatCurrency(colTotal)}
                    </td>
                  );
                })}
                <td className="p-3 text-right font-bold text-[var(--ff-accent)]">
                  {formatCurrency(data.rows.reduce((sum, r) => sum + r.total, 0))}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
