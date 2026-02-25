/**
 * Balance Sheet Report Page
 * PRD-060 Phase 5: Assets, Liabilities, Equity
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import { ArrowLeft, BarChart3, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { BalanceSheetReport } from '@/modules/accounting/types/gl.types';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

export default function BalanceSheetPage() {
  const [asAtDate, setAsAtDate] = useState(new Date().toISOString().split('T')[0]);
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    if (!asAtDate) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/accounting/reports-balance-sheet?as_at_date=${asAtDate}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Failed to load');
      setReport(json.data || json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load balance sheet');
    } finally {
      setIsLoading(false);
    }
  }, [asAtDate]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const balanced = report ? Math.abs(report.totalAssets - (report.totalLiabilities + report.totalEquity)) < 0.02 : false;

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <Link href="/accounting?tab=reports" className="inline-flex items-center gap-1 text-sm text-[var(--ff-text-secondary)] hover:text-[var(--ff-text-primary)] mb-2">
              <ArrowLeft className="h-4 w-4" /> Back to Reports
            </Link>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <BarChart3 className="h-6 w-6 text-blue-500" />
              </div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Balance Sheet</h1>
            </div>
          </div>
        </div>

        <div className="p-6 max-w-4xl space-y-6">
          <div className="flex items-center gap-4">
            <label className="text-sm text-[var(--ff-text-secondary)]">As at:</label>
            <input type="date" value={asAtDate} onChange={e => setAsAtDate(e.target.value)} className="ff-input text-sm" />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
              <AlertCircle className="h-4 w-4" /> {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            </div>
          ) : report ? (
            <div className="space-y-4">
              {/* Balance Check */}
              {balanced && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm">
                  <CheckCircle2 className="h-4 w-4" /> Balance sheet is balanced (A = L + E)
                </div>
              )}
              {!balanced && report.totalAssets > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400 text-sm">
                  <AlertCircle className="h-4 w-4" /> Out of balance by {formatCurrency(Math.abs(report.totalAssets - (report.totalLiabilities + report.totalEquity)))}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Assets */}
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                  <div className="px-6 py-3 border-b border-[var(--ff-border-light)] bg-blue-500/5">
                    <h3 className="font-semibold text-blue-400">Assets</h3>
                  </div>
                  <div className="divide-y divide-[var(--ff-border-light)]">
                    {report.assets.map(a => (
                      <div key={a.accountCode} className="px-6 py-2 flex justify-between text-sm">
                        <span className="text-[var(--ff-text-secondary)]">
                          <span className="font-mono text-xs mr-2">{a.accountCode}</span>{a.accountName}
                        </span>
                        <span className="font-mono text-[var(--ff-text-primary)]">{formatCurrency(a.balance)}</span>
                      </div>
                    ))}
                    {report.assets.length === 0 && (
                      <div className="px-6 py-3 text-sm text-[var(--ff-text-tertiary)]">No asset balances</div>
                    )}
                  </div>
                  <div className="px-6 py-3 border-t border-[var(--ff-border-light)] flex justify-between bg-[var(--ff-bg-primary)]">
                    <span className="font-semibold text-[var(--ff-text-primary)]">Total Assets</span>
                    <span className="font-bold font-mono text-blue-400">{formatCurrency(report.totalAssets)}</span>
                  </div>
                </div>

                {/* Liabilities + Equity */}
                <div className="space-y-4">
                  {/* Liabilities */}
                  <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                    <div className="px-6 py-3 border-b border-[var(--ff-border-light)] bg-amber-500/5">
                      <h3 className="font-semibold text-amber-400">Liabilities</h3>
                    </div>
                    <div className="divide-y divide-[var(--ff-border-light)]">
                      {report.liabilities.map(l => (
                        <div key={l.accountCode} className="px-6 py-2 flex justify-between text-sm">
                          <span className="text-[var(--ff-text-secondary)]">
                            <span className="font-mono text-xs mr-2">{l.accountCode}</span>{l.accountName}
                          </span>
                          <span className="font-mono text-[var(--ff-text-primary)]">{formatCurrency(l.balance)}</span>
                        </div>
                      ))}
                      {report.liabilities.length === 0 && (
                        <div className="px-6 py-3 text-sm text-[var(--ff-text-tertiary)]">No liability balances</div>
                      )}
                    </div>
                    <div className="px-6 py-2 border-t border-[var(--ff-border-light)] flex justify-between">
                      <span className="font-medium text-sm text-[var(--ff-text-primary)]">Total Liabilities</span>
                      <span className="font-medium font-mono text-amber-400">{formatCurrency(report.totalLiabilities)}</span>
                    </div>
                  </div>

                  {/* Equity */}
                  <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                    <div className="px-6 py-3 border-b border-[var(--ff-border-light)] bg-purple-500/5">
                      <h3 className="font-semibold text-purple-400">Equity</h3>
                    </div>
                    <div className="divide-y divide-[var(--ff-border-light)]">
                      {report.equity.map(e => (
                        <div key={e.accountCode} className="px-6 py-2 flex justify-between text-sm">
                          <span className="text-[var(--ff-text-secondary)]">
                            <span className="font-mono text-xs mr-2">{e.accountCode}</span>{e.accountName}
                          </span>
                          <span className="font-mono text-[var(--ff-text-primary)]">{formatCurrency(e.balance)}</span>
                        </div>
                      ))}
                      {report.equity.length === 0 && (
                        <div className="px-6 py-3 text-sm text-[var(--ff-text-tertiary)]">No equity balances</div>
                      )}
                    </div>
                    <div className="px-6 py-2 border-t border-[var(--ff-border-light)] flex justify-between">
                      <span className="font-medium text-sm text-[var(--ff-text-primary)]">Total Equity</span>
                      <span className="font-medium font-mono text-purple-400">{formatCurrency(report.totalEquity)}</span>
                    </div>
                  </div>

                  {/* L + E Total */}
                  <div className="px-6 py-3 bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] flex justify-between">
                    <span className="font-semibold text-[var(--ff-text-primary)]">Total L + E</span>
                    <span className="font-bold font-mono text-blue-400">
                      {formatCurrency(report.totalLiabilities + report.totalEquity)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
