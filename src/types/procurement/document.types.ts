/**
 * Procurement & Accounting Document Types
 * For uploaded documents on POs, GRNs, Invoices, RFQs, Quotes, and accounting entities
 */

export interface ProcurementDocument {
  id: string;
  entityType: string;
  entityId: string;
  documentType: ProcurementDocumentType | AccountingDocumentType;
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

/** Document with cross-module link information */
export interface LinkedDocument extends ProcurementDocument {
  source: 'direct' | 'linked';
  linkReason?: string;
}

export type ProcurementEntityType =
  | 'purchase_order'
  | 'goods_receipt_note'
  | 'vendor_invoice'
  | 'rfq_response'
  | 'supplier_quote';

export type AccountingEntityType =
  | 'supplier_invoice'
  | 'supplier_payment'
  | 'customer_invoice'
  | 'customer_payment'
  | 'credit_note';

export type DocumentEntityType = ProcurementEntityType | AccountingEntityType;

export type ProcurementDocumentType =
  | 'quote_pdf'
  | 'invoice'
  | 'delivery_note'
  | 'grv'
  | 'receipt'
  | 'contract'
  | 'image'
  | 'other';

export type AccountingDocumentType =
  | 'proof_of_payment'
  | 'bank_statement'
  | 'remittance_advice'
  | 'credit_note_doc'
  | 'invoice'
  | 'receipt'
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

export const ACCOUNTING_DOCUMENT_TYPE_LABELS: Record<AccountingDocumentType, string> = {
  proof_of_payment: 'Proof of Payment',
  bank_statement: 'Bank Statement',
  remittance_advice: 'Remittance Advice',
  credit_note_doc: 'Credit Note',
  invoice: 'Invoice',
  receipt: 'Receipt',
  other: 'Other',
};
