/**
 * Cost Breakdown Matrix
 *
 * Heatmap matrix: BU columns x expense account rows.
 * Color intensity shows relative spend magnitude.
 */

import { useState, useEffect } from 'react';
import { Loader2, AlertCircle, Download } from 'lucide-react';
import { useCostBreakdown } from '../hooks/useCostBreakdown';

function formatCurrency(amount: number): string {
  if (Math.abs(amount) >= 1000000) {
    return `R ${(amount / 1000000).toFixed(1)}M`;
  }
  if (Math.abs(amount) >= 1000) {
    return `R ${(amount / 1000).toFixed(0)}K`;
  }
  return `R ${amount.toFixed(0)}`;
}

function getHeatColor(value: number, max: number): string {
  if (value === 0 || max === 0) return 'transparent';
  const intensity = Math.min(value / max, 1);
  // Orange scale: more intense = more red
  const r = Math.round(234 + (255 - 234) * intensity);
  const g = Math.round(179 - 100 * intensity);
  const b = Math.round(100 - 80 * intensity);
  return `rgba(${r}, ${g}, ${b}, ${0.15 + intensity * 0.45})`;
}

export function CostBreakdownMatrix() {
  const { data, loading, error, fetchBreakdown } = useCostBreakdown();
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    fetchBreakdown(fromDate || undefined, toDate || undefined);
  }, [fetchBreakdown, fromDate, toDate]);

  const handleExportCSV = () => {
    if (!data) return;

    const headers = ['Account', 'Category', ...data.businessUnits, 'Total'];
    const csvRows = [headers.join(',')];

    for (const row of data.matrix) {
      const values = [
        `"${row.accountName}"`,
        `"${row.category}"`,
        ...data.businessUnits.map(bu => (row.amounts[bu] || 0).toFixed(2)),
        row.total.toFixed(2),
      ];
      csvRows.push(values.join(','));
    }

    // Column totals
    csvRows.push([
      '"TOTAL"',
      '""',
      ...data.businessUnits.map(bu => (data.columnTotals[bu] || 0).toFixed(2)),
      data.grandTotal.toFixed(2),
    ].join(','));

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-breakdown-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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
        </div>
        <button
          onClick={handleExportCSV}
          disabled={!data || loading}
          className="bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-border)] disabled:opacity-50 text-[var(--ff-text-primary)] px-3 py-1.5 rounded-lg text-sm flex items-center"
        >
          <Download className="w-4 h-4 mr-1" />
          CSV
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-[var(--ff-accent)]" />
          <span className="ml-2 text-[var(--ff-text-secondary)]">Loading...</span>
        </div>
      )}

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center">
          <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
          <span className="text-red-400">{error}</span>
        </div>
      )}

      {!loading && data && (
        <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border)] overflow-x-auto">
          {data.matrix.length === 0 ? (
            <div className="p-8 text-center text-[var(--ff-text-tertiary)]">
              No expense data found for this period.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ff-border)]">
                  <th className="text-left p-3 text-[var(--ff-text-tertiary)] font-medium sticky left-0 bg-[var(--ff-bg-secondary)] min-w-[200px]">
                    Expense Account
                  </th>
                  {data.businessUnits.map((bu) => (
                    <th key={bu} className="text-right p-3 text-[var(--ff-text-tertiary)] font-medium min-w-[100px]">
                      {bu}
                    </th>
                  ))}
                  <th className="text-right p-3 text-[var(--ff-text-primary)] font-semibold min-w-[100px]">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.matrix.map((row) => (
                  <tr key={row.accountId} className="hover:bg-[var(--ff-bg-tertiary)]">
                    <td className="p-3 text-[var(--ff-text-secondary)] sticky left-0 bg-[var(--ff-bg-secondary)]">
                      <div className="font-medium">{row.accountName}</div>
                      <div className="text-xs text-[var(--ff-text-tertiary)]">{row.category}</div>
                    </td>
                    {data.businessUnits.map((bu) => {
                      const amount = row.amounts[bu] || 0;
                      return (
                        <td
                          key={bu}
                          className="p-3 text-right text-[var(--ff-text-secondary)]"
                          style={{
                            backgroundColor: getHeatColor(amount, data.maxAmount),
                          }}
                        >
                          {amount !== 0 ? formatCurrency(amount) : (
                            <span className="text-[var(--ff-text-tertiary)]">-</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-3 text-right font-medium text-[var(--ff-text-primary)]">
                      {formatCurrency(row.total)}
                    </td>
                  </tr>
                ))}

                {/* Column Totals */}
                <tr className="border-t-2 border-[var(--ff-accent)] bg-[var(--ff-bg-tertiary)]">
                  <td className="p-3 font-bold text-[var(--ff-text-primary)] sticky left-0 bg-[var(--ff-bg-tertiary)]">
                    Total
                  </td>
                  {data.businessUnits.map((bu) => (
                    <td key={bu} className="p-3 text-right font-bold text-[var(--ff-text-primary)]">
                      {formatCurrency(data.columnTotals[bu] || 0)}
                    </td>
                  ))}
                  <td className="p-3 text-right font-bold text-[var(--ff-accent)]">
                    {formatCurrency(data.grandTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
