/**
 * Cash Flow Statement
 * Sage equivalent: Reports > Cash Flow
 * Operating, Investing, Financing activities
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Banknote, Loader2, AlertCircle, Download } from 'lucide-react';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

interface CashFlowSection {
  section: string;
  items: { label: string; amount: number }[];
  total: number;
}

interface CashFlowReport {
  period_start: string;
  period_end: string;
  sections: CashFlowSection[];
  net_change: number;
  opening_cash: number;
  closing_cash: number;
}

export default function CashFlowPage() {
  const [report, setReport] = useState<CashFlowReport | null>(null);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      const res = await fetch(`/api/accounting/reports-cash-flow?${params}`);
      const json = await res.json();
      const data = json.data || json;
      setReport(data.report || data);
    } catch {
      setError('Failed to load cash flow statement');
    } finally {
      setIsLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { loadReport(); }, [loadReport]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <Banknote className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Cash Flow Statement</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Operating, investing and financing activities
                  </p>
                </div>
              </div>
              <button className="px-4 py-2 bg-[var(--ff-bg-tertiary)] hover:bg-[var(--ff-border-light)] text-[var(--ff-text-primary)] rounded-lg flex items-center gap-2 text-sm border border-[var(--ff-border-light)]">
                <Download className="h-4 w-4" />
                Export PDF
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 max-w-4xl">
          {/* Date filters */}
          <div className="flex items-center gap-4 mb-6">
            <div>
              <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">From</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-[var(--ff-text-tertiary)] mb-1">To</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-green-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : !report ? (
            <div className="text-center py-12">
              <Banknote className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">No cash flow data available for this period</p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Opening Cash */}
              <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
                <div className="flex justify-between">
                  <span className="font-medium text-[var(--ff-text-primary)]">Opening Cash Balance</span>
                  <span className="font-mono font-bold text-[var(--ff-text-primary)]">{formatCurrency(report.opening_cash)}</span>
                </div>
              </div>

              {/* Sections */}
              {(report.sections || []).map((section) => (
                <div key={section.section} className="rounded-xl bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] overflow-hidden">
                  <div className="px-4 py-3 bg-[var(--ff-bg-tertiary)] border-b border-[var(--ff-border-light)]">
                    <h3 className="font-semibold text-[var(--ff-text-primary)]">{section.section}</h3>
                  </div>
                  <div className="divide-y divide-[var(--ff-border-light)]">
                    {section.items.map((item, i) => (
                      <div key={i} className="flex justify-between px-4 py-2.5">
                        <span className="text-sm text-[var(--ff-text-secondary)]">{item.label}</span>
                        <span className={`text-sm font-mono ${item.amount >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatCurrency(item.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between px-4 py-3 bg-[var(--ff-bg-tertiary)] border-t border-[var(--ff-border-light)]">
                    <span className="font-medium text-[var(--ff-text-primary)]">Net {section.section}</span>
                    <span className={`font-mono font-bold ${section.total >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {formatCurrency(section.total)}
                    </span>
                  </div>
                </div>
              ))}

              {/* Net Change & Closing */}
              <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] space-y-3">
                <div className="flex justify-between">
                  <span className="text-[var(--ff-text-secondary)]">Net Change in Cash</span>
                  <span className={`font-mono font-bold ${report.net_change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatCurrency(report.net_change)}
                  </span>
                </div>
                <div className="flex justify-between pt-3 border-t border-[var(--ff-border-light)]">
                  <span className="font-medium text-[var(--ff-text-primary)]">Closing Cash Balance</span>
                  <span className="font-mono font-bold text-lg text-[var(--ff-text-primary)]">{formatCurrency(report.closing_cash)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
