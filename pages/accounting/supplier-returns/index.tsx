/**
 * Supplier Returns / Debit Notes
 * Sage equivalent: Suppliers > Returns
 * Process returns to suppliers and create debit notes
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { TrendingDown, Loader2, AlertCircle, Plus } from 'lucide-react';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

interface SupplierReturn {
  id: string;
  return_number: string;
  supplier_name: string;
  original_invoice_number?: string;
  amount: number;
  status: string;
  return_date: string;
  reason: string;
}

export default function SupplierReturnsPage() {
  const [returns, setReturns] = useState<SupplierReturn[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadReturns = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/accounting/supplier-returns');
      const json = await res.json();
      const data = json.data || json;
      setReturns(data.returns || []);
    } catch {
      setError('Failed to load supplier returns');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { loadReturns(); }, [loadReturns]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <TrendingDown className="h-6 w-6 text-red-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Supplier Returns</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Debit notes and returns to suppliers
                  </p>
                </div>
              </div>
              <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-2 text-sm">
                <Plus className="h-4 w-4" />
                New Return
              </button>
            </div>
          </div>
        </div>

        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-red-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : returns.length === 0 ? (
            <div className="text-center py-12">
              <TrendingDown className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">No supplier returns found</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Create a debit note to process a return to a supplier
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Return #</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Supplier</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Original Invoice</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Date</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Amount</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Reason</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                      <td className="py-3 px-4 text-[var(--ff-text-primary)] font-mono">{r.return_number}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-primary)]">{r.supplier_name}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{r.original_invoice_number || '-'}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{r.return_date?.split('T')[0]}</td>
                      <td className="py-3 px-4 text-right text-red-400">{formatCurrency(r.amount)}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{r.reason}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          r.status === 'processed' ? 'bg-emerald-500/10 text-emerald-400' :
                          'bg-yellow-500/10 text-yellow-400'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
