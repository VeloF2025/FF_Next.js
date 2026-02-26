/**
 * Customer Statement Detail Page
 * Shows full transaction history with running balance for a single client
 */

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { AppLayout } from '@/components/layout/AppLayout';
import Link from 'next/link';
import { ArrowLeft, ClipboardList, Loader2, AlertCircle, Download } from 'lucide-react';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Transaction {
  date: string;
  type: 'invoice' | 'payment' | 'credit_note';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface ClientInfo {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

interface Summary {
  totalInvoiced: number;
  totalPaid: number;
  totalCredits: number;
  balance: number;
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    invoice: 'bg-blue-500/10 text-blue-400',
    payment: 'bg-emerald-500/10 text-emerald-400',
    credit_note: 'bg-amber-500/10 text-amber-400',
  };
  const labels: Record<string, string> = {
    invoice: 'Invoice',
    payment: 'Payment',
    credit_note: 'Credit Note',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[type] || ''}`}>
      {labels[type] || type}
    </span>
  );
}

export default function CustomerStatementDetailPage() {
  const router = useRouter();
  const clientId = router.query.clientId as string;

  const [client, setClient] = useState<ClientInfo | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStatement = useCallback(async () => {
    if (!clientId) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/accounting/customer-statement-detail?client_id=${clientId}`);
      const json = await res.json();
      const data = json.data || json;
      setClient(data.client || null);
      setTransactions(data.transactions || []);
      setSummary(data.summary || null);
    } catch {
      setError('Failed to load customer statement');
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadStatement(); }, [loadStatement]);

  function handleExportCSV() {
    if (!client || transactions.length === 0) return;
    const header = 'Date,Type,Reference,Description,Debit,Credit,Balance';
    const rows = transactions.map(t =>
      [formatDate(t.date), t.type, `"${t.reference}"`, `"${t.description.replace(/"/g, '""')}"`,
       t.debit.toFixed(2), t.credit.toFixed(2), t.balance.toFixed(2)].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `statement-${client.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppLayout>
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Link href="/accounting/customer-statements" className="p-2 rounded-lg hover:bg-[var(--ff-bg-tertiary)]">
                  <ArrowLeft className="h-5 w-5 text-[var(--ff-text-secondary)]" />
                </Link>
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <ClipboardList className="h-6 w-6 text-purple-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">
                    {client?.name || 'Customer Statement'}
                  </h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Full transaction history
                  </p>
                </div>
              </div>
              {transactions.length > 0 && (
                <button onClick={handleExportCSV}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm font-medium">
                  <Download className="h-4 w-4" /> Export CSV
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" /><span>{error}</span>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    { label: 'Total Invoiced', value: summary.totalInvoiced, color: 'blue' },
                    { label: 'Total Paid', value: summary.totalPaid, color: 'emerald' },
                    { label: 'Credits Applied', value: summary.totalCredits, color: 'amber' },
                    { label: 'Balance Outstanding', value: summary.balance, color: summary.balance > 0 ? 'red' : 'emerald' },
                  ].map(card => (
                    <div key={card.label} className="p-4 rounded-lg border border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
                      <p className="text-xs text-[var(--ff-text-tertiary)] mb-1">{card.label}</p>
                      <p className={`text-xl font-bold text-${card.color}-400`}>{formatCurrency(card.value)}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Transactions Table */}
              {transactions.length === 0 ? (
                <div className="text-center py-12 text-[var(--ff-text-secondary)]">
                  No transactions found for this customer
                </div>
              ) : (
                <div className="bg-[var(--ff-bg-secondary)] rounded-lg border border-[var(--ff-border-light)] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-tertiary)]">
                        <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Date</th>
                        <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Type</th>
                        <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Reference</th>
                        <th className="text-left px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Description</th>
                        <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Debit</th>
                        <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Credit</th>
                        <th className="text-right px-4 py-3 text-[var(--ff-text-secondary)] font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map((txn, i) => (
                        <tr key={`${txn.type}-${txn.reference}-${i}`}
                          className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                          <td className="px-4 py-3 text-[var(--ff-text-secondary)] whitespace-nowrap">{formatDate(txn.date)}</td>
                          <td className="px-4 py-3"><TypeBadge type={txn.type} /></td>
                          <td className="px-4 py-3 font-mono text-[var(--ff-text-primary)]">{txn.reference}</td>
                          <td className="px-4 py-3 text-[var(--ff-text-tertiary)] max-w-[240px] truncate">{txn.description || '-'}</td>
                          <td className="px-4 py-3 text-right font-mono text-[var(--ff-text-primary)]">
                            {txn.debit > 0 ? formatCurrency(txn.debit) : ''}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono ${txn.type === 'payment' ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {txn.credit > 0 ? formatCurrency(txn.credit) : ''}
                          </td>
                          <td className={`px-4 py-3 text-right font-mono font-medium ${txn.balance > 0 ? 'text-[var(--ff-text-primary)]' : 'text-emerald-400'}`}>
                            {formatCurrency(txn.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
