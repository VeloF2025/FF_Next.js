/**
 * DocumentChecklist — Shows completion status of required PO document types.
 * GRV/Delivery Note is optional — some suppliers only provide an invoice.
 * Invoice also satisfies the GRV slot if no separate GRV exists.
 */

import { CheckCircle2, Circle, MinusCircle } from 'lucide-react';
import type { ProcurementDocument } from '@/types/procurement/document.types';

interface DocumentChecklistProps {
  documents: ProcurementDocument[];
}

interface ChecklistItem {
  label: string;
  status: 'complete' | 'optional' | 'missing';
}

export function DocumentChecklist({ documents }: DocumentChecklistProps) {
  const presentTypes = new Set(documents.map((d) => d.documentType));

  const hasQuote = presentTypes.has('quote_pdf');
  const hasPO = presentTypes.has('purchase_order');
  const hasGrv = presentTypes.has('delivery_note') || presentTypes.has('grv');
  const hasInvoice = presentTypes.has('invoice');

  const items: ChecklistItem[] = [
    { label: 'Supplier Quote', status: hasQuote ? 'complete' : 'missing' },
    { label: 'Purchase Order', status: hasPO ? 'complete' : 'missing' },
    {
      label: 'GRV / Delivery Note',
      // If invoice exists but no GRV, mark as optional (not missing)
      status: hasGrv ? 'complete' : hasInvoice ? 'optional' : 'missing',
    },
    { label: 'Supplier Invoice', status: hasInvoice ? 'complete' : 'missing' },
  ];

  const completed = items.filter((i) => i.status === 'complete').length;
  const required = items.filter((i) => i.status !== 'optional').length;
  const requiredComplete = items.filter(
    (i) => i.status === 'complete'
  ).length;
  const allGood = requiredComplete >= required;

  return (
    <div className="px-5 py-4 border-b border-[var(--ff-border-light)]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[var(--ff-text-primary)]">Document Checklist</p>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            allGood
              ? 'bg-green-500/15 text-green-400'
              : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          {completed}/{items.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-sm">
            {item.status === 'complete' ? (
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
            ) : item.status === 'optional' ? (
              <MinusCircle className="h-4 w-4 text-[var(--ff-text-tertiary)] shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-[var(--ff-text-tertiary)] shrink-0" />
            )}
            <span
              className={
                item.status === 'complete'
                  ? 'text-[var(--ff-text-primary)]'
                  : 'text-[var(--ff-text-tertiary)]'
              }
            >
              {item.label}
              {item.status === 'optional' && (
                <span className="text-xs ml-1">(n/a)</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
