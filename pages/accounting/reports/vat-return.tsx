/**
 * VAT Return Report Page
 * PRD-060 Phase 5: Output VAT, Input VAT, Net VAT
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import { ArrowLeft, Receipt, Loader2, AlertCircle } from 'lucide-react';
import type { VATReturnReport } from '@/modules/accounting/types/gl.types';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

function getDefaultDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    periodStart: start.toISOString().split('T')[0],
    periodEnd: end.toISOString().split('T')[0],
  };
}

export default function VATReturnPage() {
  const defaults = getDefaultDates();
  const [periodStart, setPeriodStart] = useState(defaults.periodStart);
  const [periodEnd, setPeriodEnd] = useState(defaults.periodEnd);
  const [report, setReport] = useState<VATReturnReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    if (!periodStart || !periodEnd) return;
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ period_start: periodStart, period_end: periodEnd });
      const res = await fetch(`/api/accounting/reports-vat-return?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Failed to load');
      setReport(json.data || json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load VAT return');
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
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Receipt className="h-6 w-6 text-amber-500" />
              </div>
              <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">VAT Return</h1>
            </div>
          </div>
        </div>

        <div className="p-6 max-w-3xl space-y-6">
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
              <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
            </div>
          ) : report ? (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
                  <p className="text-xs text-[var(--ff-text-tertiary)]">Output VAT (Collected)</p>
                  <p className="text-xl font-bold text-red-400">{formatCurrency(report.outputVAT)}</p>
                </div>
                <div className="p-4 rounded-lg bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)]">
                  <p className="text-xs text-[var(--ff-text-tertiary)]">Input VAT (Paid)</p>
                  <p className="text-xl font-bold text-emerald-400">{formatCurrency(report.inputVAT)}</p>
                </div>
                <div className={`p-4 rounded-lg border ${report.netVAT > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/30'}`}>
                  <p className="text-xs text-[var(--ff-text-tertiary)]">Net VAT {report.netVAT > 0 ? '(Payable)' : '(Refundable)'}</p>
                  <p className={`text-xl font-bold ${report.netVAT > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatCurrency(Math.abs(report.netVAT))}
                  </p>
                </div>
              </div>

              {/* Detail */}
              <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)]">
                {report.outputDetails.length > 0 && (
                  <div>
                    <div className="px-6 py-2 bg-red-500/5 border-b border-[var(--ff-border-light)]">
                      <span className="text-sm font-semibold text-red-400">Output VAT</span>
                    </div>
                    {report.outputDetails.map(d => (
                      <div key={d.accountCode} className="px-6 py-2 flex justify-between text-sm border-b border-[var(--ff-border-light)]">
                        <span className="text-[var(--ff-text-secondary)]">
                          <span className="font-mono text-xs mr-2">{d.accountCode}</span>{d.accountName}
                        </span>
                        <span className="font-mono text-[var(--ff-text-primary)]">{formatCurrency(d.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {report.inputDetails.length > 0 && (
                  <div>
                    <div className="px-6 py-2 bg-emerald-500/5 border-b border-[var(--ff-border-light)]">
                      <span className="text-sm font-semibold text-emerald-400">Input VAT</span>
                    </div>
                    {report.inputDetails.map(d => (
                      <div key={d.accountCode} className="px-6 py-2 flex justify-between text-sm border-b border-[var(--ff-border-light)]">
                        <span className="text-[var(--ff-text-secondary)]">
                          <span className="font-mono text-xs mr-2">{d.accountCode}</span>{d.accountName}
                        </span>
                        <span className="font-mono text-[var(--ff-text-primary)]">{formatCurrency(d.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {report.outputDetails.length === 0 && report.inputDetails.length === 0 && (
                  <div className="px-6 py-8 text-center text-[var(--ff-text-tertiary)]">No VAT activity in this period</div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </AppLayout>
  );
}
