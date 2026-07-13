import { useEffect, useState } from 'react';
import { log } from '@/lib/logger';
import type { ApprovalRequestRecord } from '../types';

interface ReqItem { itemDescription: string; quantity: number; uom?: string; suggestedSupplierName?: string; }
interface Requisition { requestedByName: string | null; items: ReqItem[]; }

export function RequisitionPanel({ record }: { record: ApprovalRequestRecord }) {
  const [req, setReq] = useState<Requisition | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/procurement/requisitions/${record.documentId}`);
        const data = await res.json();
        if (data.success) setReq(data.data); else setFailed(true);
      } catch (err) { log.error('Requisition panel load failed', { error: err }, 'procurement'); setFailed(true); }
    })();
  }, [record.documentId]);

  if (failed) return <section className="p-4 text-sm text-[var(--ff-text-secondary)]">Couldn’t load items. Approve from the summary above, or open the full record.</section>;
  if (!req) return <section className="p-4 text-sm text-[var(--ff-text-tertiary)]">Loading items…</section>;

  return (
    <section className="p-4 space-y-3">
      <ul className="divide-y divide-[var(--ff-border-light)] rounded-lg border border-[var(--ff-border-light)]">
        {req.items.map((it, i) => (
          <li key={i} className="p-3">
            <p className="text-sm text-[var(--ff-text-primary)]">{it.itemDescription}</p>
            <div className="mt-1 flex justify-between text-xs text-[var(--ff-text-secondary)]">
              <span>{it.quantity} {it.uom ?? ''}</span>
              {it.suggestedSupplierName && <span className="truncate">{it.suggestedSupplierName}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
