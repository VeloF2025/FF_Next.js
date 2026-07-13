import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import type { ApprovalRequestRecord } from '../types';

interface POItem { description: string; quantityOrdered: number; unitOfMeasure: string; unitPrice: number; lineTotal: number; }
interface PO { supplierName: string; items: POItem[]; subtotal: number; taxAmount: number; totalAmount: number; }
const money = (v: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(v);

export function PurchaseOrderPanel({ record }: { record: ApprovalRequestRecord }) {
  const [po, setPo] = useState<PO | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/procurement/purchase-orders/${record.documentId}`);
        const data = await res.json();
        if (data.success) setPo(data.data); else setFailed(true);
      } catch (err) { log.error('PO panel load failed', { error: err }, 'procurement'); setFailed(true); }
    })();
  }, [record.documentId]);

  if (failed) return <section className="p-4 text-sm text-[var(--ff-text-secondary)]">Couldn’t load line items. Approve from the summary above, or open the full record.</section>;
  if (!po) return <section className="p-4 text-sm text-[var(--ff-text-tertiary)]">Loading items…</section>;

  return (
    <section className="p-4 space-y-3">
      <p className="text-sm text-[var(--ff-text-tertiary)]">Supplier</p>
      <p className="text-[var(--ff-text-primary)] -mt-2">{po.supplierName}</p>
      <ul className="divide-y divide-[var(--ff-border-light)] rounded-lg border border-[var(--ff-border-light)]">
        {po.items.map((it, i) => (
          <li key={i} className="p-3">
            <p className="text-sm text-[var(--ff-text-primary)]">{it.description}</p>
            <div className="mt-1 flex justify-between text-xs text-[var(--ff-text-secondary)]">
              <span>{it.quantityOrdered} {it.unitOfMeasure} × {money(it.unitPrice)}</span>
              <span className="text-[var(--ff-text-primary)]">{money(it.lineTotal)}</span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="text-sm space-y-1 pt-1">
        <div className="flex justify-between"><dt className="text-[var(--ff-text-secondary)]">Subtotal</dt><dd className="text-[var(--ff-text-primary)]">{money(po.subtotal)}</dd></div>
        <div className="flex justify-between"><dt className="text-[var(--ff-text-secondary)]">VAT</dt><dd className="text-[var(--ff-text-primary)]">{money(po.taxAmount)}</dd></div>
        <div className="flex justify-between pt-1 border-t border-[var(--ff-border-light)]"><dt className="font-semibold text-[var(--ff-text-primary)]">Total</dt><dd className="font-semibold text-[var(--ff-text-primary)]">{money(po.totalAmount)}</dd></div>
      </dl>
    </section>
  );
}
