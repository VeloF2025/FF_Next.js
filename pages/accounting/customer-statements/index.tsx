/**
 * Customer Statements
 * Sage equivalent: Customers > Reports > Statements
 * Generate and email customer account statements
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { ClipboardList, Loader2, AlertCircle, Mail, Download } from 'lucide-react';
import toast from 'react-hot-toast';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

interface CustomerBalance {
  client_id: string;
  client_name: string;
  total_invoiced: number;
  total_paid: number;
  balance: number;
  last_payment_date?: string;
  invoice_count: number;
}

/** Triggers a CSV download in the browser using a temporary anchor element. */
function triggerCsvDownload(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Builds CSV content from a list of CustomerBalance rows. */
function buildCsv(rows: CustomerBalance[]): string {
  const header = 'Customer,Total Invoiced,Total Paid,Balance,# Invoices,Last Payment';
  const lines = rows.map((c) =>
    [
      `"${c.client_name.replace(/"/g, '""')}"`,
      c.total_invoiced.toFixed(2),
      c.total_paid.toFixed(2),
      c.balance.toFixed(2),
      c.invoice_count,
      c.last_payment_date?.split('T')[0] ?? '',
    ].join(',')
  );
  return [header, ...lines].join('\n');
}

export default function CustomerStatementsPage() {
  const [customers, setCustomers] = useState<CustomerBalance[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [asAtDate, setAsAtDate] = useState(new Date().toISOString().split('T')[0]);

  /** Downloads a single customer row as a CSV statement. */
  function handleDownloadStatement(customer: CustomerBalance): void {
    const csv = buildCsv([customer]);
    const safeName = customer.client_name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    triggerCsvDownload(csv, `statement-${safeName}-${asAtDate}.csv`);
  }

  /** Downloads all loaded customer balances as a single CSV file. */
  function handleDownloadAll(): void {
    if (customers.length === 0) return;
    const csv = buildCsv(customers);
    triggerCsvDownload(csv, `statements-all-${asAtDate}.csv`);
  }

  const loadStatements = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/accounting/customer-statements?as_at_date=${asAtDate}`);
      const json = await res.json();
      const data = json.data || json;
      setCustomers(data.customers || []);
    } catch {
      setError('Failed to load customer statements');
    } finally {
      setIsLoading(false);
    }
  }, [asAtDate]);

  useEffect(() => { loadStatements(); }, [loadStatements]);

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <ClipboardList className="h-6 w-6 text-purple-500" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Customer Statements</h1>
                <p className="text-sm text-[var(--ff-text-secondary)]">
                  Account balances and statement generation
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-4 mb-6 flex-wrap">
            <label className="text-sm text-[var(--ff-text-secondary)]">As at:</label>
            <input
              type="date"
              value={asAtDate}
              onChange={(e) => setAsAtDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            />
            {customers.length > 0 && (
              <button
                onClick={handleDownloadAll}
                className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm font-medium transition-colors"
                title="Download all customer balances as CSV"
              >
                <Download className="h-4 w-4" />
                Download All
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : customers.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardList className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">No customer balances found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Customer</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Invoiced</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Paid</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Balance</th>
                    <th className="text-center py-3 px-4 text-[var(--ff-text-secondary)] font-medium"># Invoices</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Last Payment</th>
                    <th className="text-center py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.client_id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                      <td className="py-3 px-4 text-[var(--ff-text-primary)] font-medium">{c.client_name}</td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-primary)]">{formatCurrency(c.total_invoiced)}</td>
                      <td className="py-3 px-4 text-right text-emerald-400">{formatCurrency(c.total_paid)}</td>
                      <td className="py-3 px-4 text-right font-medium text-[var(--ff-text-primary)]">{formatCurrency(c.balance)}</td>
                      <td className="py-3 px-4 text-center text-[var(--ff-text-secondary)]">{c.invoice_count}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{c.last_payment_date?.split('T')[0] || '-'}</td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleDownloadStatement(c)}
                            className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] text-blue-400"
                            title="Download statement as CSV"
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => toast('Email functionality coming soon', { icon: '📧' })}
                            className="p-1.5 rounded hover:bg-[var(--ff-bg-tertiary)] text-purple-400"
                            title="Email Statement"
                          >
                            <Mail className="h-4 w-4" />
                          </button>
                        </div>
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
