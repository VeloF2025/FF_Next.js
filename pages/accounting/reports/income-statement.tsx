/**
 * Income Statement (P&L) Report Page
 * PRD-060 Phase 5: Revenue, Cost of Sales, Operating Expenses
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Loader2, AlertCircle } from 'lucide-react';
import type { IncomeStatementReport } from '@/modules/accounting/types/gl.types';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

function getDefaultDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    periodStart: start.toISOString().split('T')[0],
    periodEnd: now.toISOString().split('T')[0],
  };
}

export default function IncomeStatementPage() {
  const defaults = getDefaultDates();
  const [periodStart, setPeriodStart] = useState(defaults.periodStart);
  const [periodEnd, setPeriodEnd] = useState(defaults.periodEnd);
  const [report, setReport] = useState<IncomeStatementReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    if (!periodStart || !periodEnd) return;
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period_start: periodStart, period_end: periodEnd });
      const res = await fetch(`/api/accounting/reports-income-statement?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Failed to load');
      setReport(json.data || json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load income statement');
    } finally {
      setIsLoading(false);
    }
  }, [periodStart, periodEnd]);

  useEffect(() => { loadReport(); }, [loadReport]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <Link href="/accounting?tab=reports" className="inline-flex items-center gap-1 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-2">
              <ArrowLeft className="h-4 w-4" /> Back to Reports
            </Link>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <BarChart3 className="h-6 w-6 text-emerald-500" />
              </div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Income Statement</h1>
            </div>
          </div>
        </div>

        <div className="p-6 max-w-4xl space-y-6">
          {/* Date Range */}
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">From</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="ff-input text-sm" />
            </div>
            <div>
              <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">To</label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="ff-input text-sm" />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
            </div>
          ) : report ? (
            <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--ff-border-light)]">
                <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">
                  Profit &amp; Loss — {periodStart} to {periodEnd}
                </h2>
              </div>

              <div className="divide-y divide-[var(--ff-border-light)]">
                {/* Revenue */}
                <Section label="Revenue" items={report.revenue} total={report.totalRevenue} color="emerald" />

                {/* Cost of Sales */}
                {report.costOfSales.length > 0 && (
                  <Section label="Cost of Sales" items={report.costOfSales} total={report.totalCostOfSales} color="orange" />
                )}

                {/* Gross Profit */}
                <div className="px-6 py-3 flex justify-between bg-emerald-500/5">
                  <span className="font-semibold text-[var(--ff-text-primary)]">Gross Profit</span>
                  <span className={`font-bold font-mono ${report.grossProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(report.grossProfit)}
                  </span>
                </div>

                {/* Operating Expenses */}
                <Section label="Operating Expenses" items={report.operatingExpenses} total={report.totalOperatingExpenses} color="red" />

                {/* Net Profit */}
                <div className="px-6 py-4 flex justify-between bg-[var(--ff-bg-primary)]">
                  <span className="text-lg font-bold text-[var(--ff-text-primary)]">Net Profit / (Loss)</span>
                  <span className={`text-xl font-bold font-mono ${report.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(report.netProfit)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}

function Section({ label, items, total, color }: {
  label: string;
  items: Array<{ accountCode: string; accountName: string; amount: number }>;
  total: number;
  color: string;
}) {
  return (
    <div>
      <div className={`px-6 py-2 bg-${color}-500/5`}>
        <span className={`text-sm font-semibold text-${color}-400`}>{label}</span>
      </div>
      {items.map(item => (
        <div key={item.accountCode} className="px-6 py-2 flex justify-between text-sm">
          <span className="text-[var(--ff-text-secondary)]">
            <span className="font-mono text-xs mr-2">{item.accountCode}</span>
            {item.accountName}
          </span>
          <span className="font-mono text-[var(--ff-text-primary)]">{formatCurrency(item.amount)}</span>
        </div>
      ))}
      {items.length === 0 && (
        <div className="px-6 py-2 text-sm text-[var(--ff-text-tertiary)]">No entries</div>
      )}
      <div className="px-6 py-2 flex justify-between border-t border-[var(--ff-border-light)]">
        <span className="text-sm font-medium text-[var(--ff-text-primary)]">Total {label}</span>
        <span className="font-mono font-medium text-[var(--ff-text-primary)]">{formatCurrency(total)}</span>
      </div>
    </div>
  );
}
