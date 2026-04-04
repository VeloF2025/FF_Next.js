/**
 * POTransactionDetail — Expandable PO transaction list for BOQ Spend Summary.
 */

import Link from 'next/link';
import { InlineSpinner } from '@/components/ui/LoadingSpinner';

export interface POTransaction {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string | null;
  supplierName: string;
  totalAmount: number;
  itemCount: number;
  confirmed: boolean;
}

function fmtZAR(n: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
  }).format(n);
}

interface Props {
  transactions: POTransaction[];
  loading: boolean;
}

export function POTransactionDetail({ transactions, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-[var(--ff-text-tertiary)]">
        <InlineSpinner size="sm" /> Loading transactions...
      </div>
    );
  }

  if (transactions.length === 0) {
    return <div className="text-xs text-[var(--ff-text-tertiary)] py-2">No purchase orders found.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[var(--ff-text-tertiary)] uppercase">
            <th className="text-left py-1.5 pr-3 font-medium">PO #</th>
            <th className="text-left py-1.5 pr-3 font-medium">Supplier</th>
            <th className="text-left py-1.5 pr-3 font-medium">Date</th>
            <th className="text-left py-1.5 pr-3 font-medium">Status</th>
            <th className="text-right py-1.5 pr-3 font-medium">Items</th>
            <th className="text-right py-1.5 font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--ff-border-light)]">
          {transactions.map((tx) => (
            <tr key={tx.id} className="hover:bg-[var(--ff-bg-hover)]">
              <td className="py-1.5 pr-3 font-mono">
                <Link
                  href={`/procurement/purchase-orders/${tx.id}`}
                  className="text-purple-400 hover:text-purple-300 underline decoration-purple-400/30 hover:decoration-purple-300"
                  onClick={(e) => e.stopPropagation()}
                >
                  {tx.poNumber}
                </Link>
              </td>
              <td className="py-1.5 pr-3 text-[var(--ff-text-secondary)]">{tx.supplierName}</td>
              <td className="py-1.5 pr-3 text-[var(--ff-text-tertiary)]">
                {tx.orderDate ? new Date(tx.orderDate).toLocaleDateString('en-ZA') : '—'}
              </td>
              <td className="py-1.5 pr-3">
                <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  tx.confirmed
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-purple-500/15 text-purple-400'
                }`}>
                  {tx.status.replace('_', ' ')}
                </span>
              </td>
              <td className="py-1.5 pr-3 text-right text-[var(--ff-text-tertiary)]">{tx.itemCount}</td>
              <td className="py-1.5 text-right font-medium text-[var(--ff-text-primary)]">
                {fmtZAR(tx.totalAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
