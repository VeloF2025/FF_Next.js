/**
 * Customer Tax Invoices - Accounting view
 * Sage equivalent: Customers > Tax Invoices
 * Lists all customer invoices across projects with GL posting status
 */

import { useState, useEffect, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { AccountingNav } from '@/components/accounting/AccountingNav';
import { FileText, Loader2, AlertCircle, Plus } from 'lucide-react';
import Link from 'next/link';

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
}

interface Invoice {
  id: string;
  invoice_number: string;
  project_id: string;
  project_name?: string;
  client_name?: string;
  total_amount: number;
  amount_paid: number;
  status: string;
  invoice_date: string;
  due_date?: string;
}

export default function CustomerInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadInvoices = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/accounting/customer-invoices-list?${params}`);
      const json = await res.json();
      const data = json.data || json;
      setInvoices(data.invoices || []);
    } catch {
      setError('Failed to load customer invoices');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadInvoices(); }, [loadInvoices]);

  const statuses = ['all', 'draft', 'approved', 'sent', 'partially_paid', 'paid', 'overdue'];

  return (
    <AppLayout>
      <AccountingNav />
      <div className="min-h-screen bg-[var(--ff-bg-primary)]">
        <div className="border-b border-[var(--ff-border-light)] bg-[var(--ff-bg-secondary)]">
          <div className="px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <FileText className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-[var(--ff-text-primary)]">Tax Invoices</h1>
                  <p className="text-sm text-[var(--ff-text-secondary)]">
                    Customer invoices across all projects
                  </p>
                </div>
              </div>
              <Link href="/accounting/customer-invoices/new" className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
                <Plus className="h-4 w-4" /> New Invoice
              </Link>
            </div>
          </div>
        </div>

        <div className="p-6">
          {/* Filters */}
          <div className="flex items-center gap-3 mb-6">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-lg bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] text-[var(--ff-text-primary)] text-sm"
            >
              {statuses.map(s => (
                <option key={s} value={s}>{s === 'all' ? 'All Statuses' : s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
              ))}
            </select>
            <span className="text-sm text-[var(--ff-text-secondary)]">{invoices.length} invoices</span>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-[var(--ff-text-tertiary)] mx-auto mb-3" />
              <p className="text-[var(--ff-text-secondary)]">No customer invoices found</p>
              <p className="text-sm text-[var(--ff-text-tertiary)] mt-1">
                Customer invoices are created from project billing
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--ff-border-light)]">
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Invoice #</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Client</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Project</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Date</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Amount</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Paid</th>
                    <th className="text-left py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Status</th>
                    <th className="text-right py-3 px-4 text-[var(--ff-text-secondary)] font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-[var(--ff-border-light)] hover:bg-[var(--ff-bg-tertiary)]">
                      <td className="py-3 px-4 font-mono">
                        <Link href={`/accounting/customer-invoices/${inv.id}`} className="text-blue-400 hover:text-blue-300">{inv.invoice_number}</Link>
                      </td>
                      <td className="py-3 px-4 text-[var(--ff-text-primary)]">{inv.client_name || '-'}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{inv.project_name || '-'}</td>
                      <td className="py-3 px-4 text-[var(--ff-text-secondary)]">{inv.invoice_date?.split('T')[0]}</td>
                      <td className="py-3 px-4 text-right text-[var(--ff-text-primary)]">{formatCurrency(Number(inv.total_amount))}</td>
                      <td className="py-3 px-4 text-right text-emerald-400">{formatCurrency(Number(inv.amount_paid))}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          inv.status === 'paid' ? 'bg-emerald-500/10 text-emerald-400' :
                          inv.status === 'overdue' ? 'bg-red-500/10 text-red-400' :
                          inv.status === 'sent' ? 'bg-blue-500/10 text-blue-400' :
                          'bg-yellow-500/10 text-yellow-400'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-[var(--ff-text-primary)]">
                        {formatCurrency(Number(inv.total_amount) - Number(inv.amount_paid))}
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
