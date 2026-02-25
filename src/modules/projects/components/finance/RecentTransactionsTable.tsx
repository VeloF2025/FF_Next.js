/**
 * Recent Transactions Table
 * Shows recent financial activity for the project
 */

import type { RecentTransaction } from '@/types/finance';
import { formatDisplayDate } from '@/utils/dateFormat';

interface RecentTransactionsTableProps {
  transactions: RecentTransaction[];
}

export function RecentTransactionsTable({ transactions }: RecentTransactionsTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
        <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Recent Activity</h3>
        <div className="text-center py-8 text-[var(--ff-text-secondary)]">
          <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p>No recent financial activity</p>
        </div>
      </div>
    );
  }

  const typeConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
    invoice_created: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      color: 'text-blue-400 bg-blue-500/20',
      label: 'Invoice Created',
    },
    invoice_sent: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
        </svg>
      ),
      color: 'text-green-400 bg-green-500/20',
      label: 'Invoice Sent',
    },
    payment_received: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'text-purple-400 bg-purple-500/20',
      label: 'Payment Received',
    },
    po_created: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      color: 'text-amber-400 bg-amber-500/20',
      label: 'Supplier PO',
    },
    expense: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
      color: 'text-red-400 bg-red-500/20',
      label: 'Expense',
    },
  };

  const formatDate = (dateStr: string) => formatDisplayDate(dateStr);

  return (
    <div className="bg-[var(--ff-card-bg)] rounded-lg border border-[var(--ff-border-light)] p-6">
      <h3 className="text-lg font-semibold text-[var(--ff-text-primary)] mb-4">Recent Activity</h3>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-sm text-[var(--ff-text-secondary)] border-b border-[var(--ff-border-light)]">
              <th className="pb-3 font-medium">Type</th>
              <th className="pb-3 font-medium">Description</th>
              <th className="pb-3 font-medium">Reference</th>
              <th className="pb-3 font-medium text-right">Amount</th>
              <th className="pb-3 font-medium text-right">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ff-border-light)]">
            {transactions.map((tx) => {
              const defaultConfig = { icon: null, color: 'text-gray-400 bg-gray-500/20', label: 'Transaction' };
              const config = typeConfig[tx.type] ?? defaultConfig;
              return (
                <tr key={tx.id} className="hover:bg-[var(--ff-bg-secondary)]">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${config.color}`}>
                        {config.icon}
                      </span>
                      <span className="text-sm text-[var(--ff-text-secondary)]">{config.label}</span>
                    </div>
                  </td>
                  <td className="py-3 text-sm text-[var(--ff-text-primary)]">{tx.description}</td>
                  <td className="py-3 text-sm text-[var(--ff-text-secondary)]">{tx.reference || '-'}</td>
                  <td className={`py-3 text-sm font-medium text-right ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {tx.amount >= 0 ? '+' : ''}R {Math.abs(tx.amount).toLocaleString()}
                  </td>
                  <td className="py-3 text-sm text-[var(--ff-text-secondary)] text-right">{formatDate(tx.date)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
