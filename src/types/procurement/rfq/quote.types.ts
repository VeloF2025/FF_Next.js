// ============= Quote Types =============

import { QuoteStatusType, QuoteDocumentType } from './enums.types';

// Quote interface matching database schema
export interface Quote {
  id: string;
  rfqId: string;
  supplierId: string;
  supplierInvitationId?: string;
  projectId: string;
  
  // Quote Details
  quoteNumber?: string;
  quoteReference?: string;
  
  // Status and Dates
  status: QuoteStatusType;
  submissionDate: Date;
  validUntil: Date;
  
  // Financial Summary
  totalValue: number;
  subtotal?: number;
  taxAmount?: number;
  discountAmount?: number;
  currency: string; // Default 'ZAR'
  
  // Terms
  leadTime?: number; // days
  paymentTerms?: string;
  deliveryTerms?: string;
  warrantyTerms?: string;
  validityPeriod?: number; // days
  
  // Additional Information
  notes?: string;
  terms?: string;
  conditions?: string;
  
  // Evaluation
  evaluationScore?: number;
  technicalScore?: number;
  commercialScore?: number;
  evaluationNotes?: string;
  isWinner: boolean;
  
  // Award Information
  awardedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Quote Item interface matching database schema
export interface QuoteItem {
  id: string;
  quoteId: string;
  rfqItemId: string;
  projectId: string;
  
  // Item Reference (from RFQ)
  lineNumber: number;
  itemCode?: string;
  description: string;
  
  // Quoted Quantities and Pricing
  quotedQuantity?: number;
  unitPrice: number;
  totalPrice: number;
  discountPercentage?: number;
  discountAmount?: number;
  
  // Alternative Offerings
  alternateOffered: boolean;
  alternateDescription?: string;
  alternatePartNumber?: string;
  alternateUnitPrice?: number;
  
  // Delivery and Terms
  leadTime?: number; // days
  minimumOrderQuantity?: number;
  packagingUnit?: string;
  
  // Technical Information
  manufacturerName?: string;
  partNumber?: string;
  modelNumber?: string;
  technicalNotes?: string;
  complianceCertificates?: unknown[];
  
  // Evaluation
  technicalCompliance: boolean;
  commercialScore?: number;
  technicalScore?: number;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// Quote Document interface matching database schema
export interface QuoteDocument {
  id: string;
  quoteId: string;
  quoteItemId?: string;
  
  // Document Details
  documentType: QuoteDocumentType;
  documentName: string;
  fileName: string;
  fileUrl: string;
  fileSize?: number; // bytes
  mimeType?: string;
  
  // Metadata
  description?: string;
  isRequired: boolean;
  validUntil?: Date;
  
  // Timestamps
  uploadedAt: Date;
  createdAt: Date;
}