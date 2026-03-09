/**
 * DocumentChecklist — Shows completion status of 4 required PO document types.
 * Renders inline above the document list in ProcurementDocumentPanel.
 */

import { CheckCircle2, Circle } from 'lucide-react';
import { PO_REQUIRED_DOC_TYPES, type ProcurementDocument } from '@/types/procurement/document.types';

interface DocumentChecklistProps {
  documents: ProcurementDocument[];
}

export function DocumentChecklist({ documents }: DocumentChecklistProps) {
  const presentTypes = new Set(documents.map((d) => d.documentType));
  // delivery_note and grv both count for the delivery_note checklist item
  const hasDeliveryOrGrv = presentTypes.has('delivery_note') || presentTypes.has('grv');

  const items = PO_REQUIRED_DOC_TYPES.map((req) => ({
    ...req,
    complete: req.type === 'delivery_note' ? hasDeliveryOrGrv : presentTypes.has(req.type),
  }));

  const completed = items.filter((i) => i.complete).length;
  const total = items.length;
  const allComplete = completed === total;

  return (
    <div className="px-5 py-4 border-b border-[var(--ff-border-light)]">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-[var(--ff-text-primary)]">Document Checklist</p>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            allComplete
              ? 'bg-green-500/15 text-green-400'
              : 'bg-amber-500/15 text-amber-400'
          }`}
        >
          {completed}/{total}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div
            key={item.type}
            className="flex items-center gap-2 text-sm"
          >
            {item.complete ? (
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
            ) : (
              <Circle className="h-4 w-4 text-[var(--ff-text-tertiary)] shrink-0" />
            )}
            <span
              className={
                item.complete
                  ? 'text-[var(--ff-text-primary)]'
                  : 'text-[var(--ff-text-tertiary)]'
              }
            >
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
