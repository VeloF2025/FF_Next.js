/** Shared types for BOQ utilization API response. */

export interface BOQLineUtilization {
  id: string;
  boqId: string;
  lineNumber: number | null;
  itemCode: string | null;
  description: string;
  uom: string;
  boqQty: number;
  orderedQty: number;
  receivedQty: number;
  outstandingQty: number;
  unitPrice: number | null;
  boqValue: number | null;
  orderedValue: number | null;
  status: 'not_ordered' | 'partial' | 'fully_ordered' | 'over_ordered' | 'partially_received' | 'received';
}

export interface NonBOQItem {
  id: string;
  itemCode: string | null;
  itemDescription: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPrice: number;
  totalPrice: number | null;
  poNumber: string;
  poId: string;
}

export interface BOQUtilizationSummary {
  totalBoqValue: number;
  totalOrderedValue: number;
  totalReceivedValue: number;
  orderedPercent: number;
  receivedPercent: number;
  boqLineCount: number;
  orderedLineCount: number;
  nonBoqItemCount: number;
}

export interface BOQUtilizationResponse {
  summary: BOQUtilizationSummary;
  lines: BOQLineUtilization[];
  nonBoqItems: NonBOQItem[];
}
