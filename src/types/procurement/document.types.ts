/**
 * Procurement Document Types
 * For uploaded documents on POs, GRNs, Invoices, RFQs, Quotes
 */

export interface ProcurementDocument {
  id: string;
  entityType: string;
  entityId: string;
  documentType: ProcurementDocumentType;
  documentName: string;
  fileUrl: string;
  filePath?: string;
  fileSize?: number;
  mimeType?: string;
  uploadedBy: string;
  uploadedByName?: string;
  uploadedAt: string;
  notes?: string;
  isActive: boolean;
}

export type ProcurementEntityType =
  | 'purchase_order'
  | 'goods_receipt_note'
  | 'vendor_invoice'
  | 'rfq_response'
  | 'supplier_quote';

export type ProcurementDocumentType =
  | 'quote_pdf'
  | 'invoice'
  | 'delivery_note'
  | 'grv'
  | 'receipt'
  | 'contract'
  | 'image'
  | 'other';

export const DOCUMENT_TYPE_LABELS: Record<ProcurementDocumentType, string> = {
  quote_pdf: 'Supplier Quote',
  invoice: 'Invoice',
  delivery_note: 'Delivery Note',
  grv: 'GRV (Goods Return)',
  receipt: 'Receipt',
  contract: 'Contract',
  image: 'Photo/Image',
  other: 'Other',
};
