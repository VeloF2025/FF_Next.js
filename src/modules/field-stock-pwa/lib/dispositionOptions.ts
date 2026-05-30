/**
 * Inspect-time disposition vocabulary. Phase 3 UI exposes a 3-option subset of
 * the stock_return_lines.disposition CHECK ('restock', 'repair', 'scrap',
 * 'supplier_return'). supplier_return is not yet wired up in the accept handler.
 *
 * resultingSerialStatus values (available | faulty | scrapped) match what
 * pages/api/procurement/field-stock/returns/[returnId]/accept.ts writes to
 * stock_serials.status — confirmed by Task A.1 schema probe (CHECK accepts
 * 'available', 'reserved', 'issued', 'installed', 'faulty', 'returned',
 * 'scrapped', 'in_transit').
 */

export type ReturnDisposition = 'restock' | 'repair' | 'scrap';

export interface DispositionOption {
  code: ReturnDisposition;
  label: string;
  description: string;
  /** Resulting stock_serials.status applied by POST /accept. */
  resultingSerialStatus: 'in_stock' | 'faulty' | 'scrapped';
}

export const DISPOSITION_OPTIONS: DispositionOption[] = [
  {
    code: 'restock',
    label: 'Restock',
    description: 'Return to warehouse stock as in-stock',
    resultingSerialStatus: 'in_stock',
  },
  {
    code: 'repair',
    label: 'Repair',
    description: 'Send to repair queue; serial marked faulty',
    resultingSerialStatus: 'faulty',
  },
  {
    code: 'scrap',
    label: 'Scrap',
    description: 'Write off; serial marked scrapped',
    resultingSerialStatus: 'scrapped',
  },
];
