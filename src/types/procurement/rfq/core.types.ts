// ============= Core RFQ Types =============

import { RFQStatusType } from './enums.types';

// Main RFQ interface matching database schema exactly
export interface RFQ {
  id: string;
  projectId: string;
  
  // RFQ Details
  rfqNumber: string;
  title: string;
  description?: string;
  
  // Status and Timeline
  status: RFQStatusType;
  issueDate?: Date;
  sentAt?: Date;
  responseDeadline: Date;
  extendedDeadline?: Date;
  closedAt?: Date;
  
  // Created By
  createdBy: string;
  issuedBy?: string;
  
  // Terms and Conditions
  paymentTerms?: string;
  deliveryTerms?: string;
  validityPeriod?: number; // days
  currency: string; // Default 'ZAR'
  
  // Evaluation Criteria
  evaluationCriteria?: Record<string, unknown>; // Weighted criteria object
  technicalRequirements?: string;
  
  // Supplier Management
  invitedSuppliers?: string[]; // Array of supplier IDs
  respondedSuppliers?: string[]; // Array of supplier IDs who responded
  
  // Totals and Statistics
  itemCount: number;
  totalBudgetEstimate?: number;
  lowestQuoteValue?: number;
  highestQuoteValue?: number;
  averageQuoteValue?: number;
  
  // Award Information
  awardedAt?: Date;
  awardedTo?: string; // Supplier ID
  awardNotes?: string;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// RFQ Item interface matching database schema
export interface RFQItem {
  id: string;
  rfqId: string;
  boqItemId?: string;
  projectId: string;
  
  // Item Details (copied from BOQ for historical record)
  lineNumber: number;
  itemCode?: string;
  description: string;
  category?: string;
  
  // Quantities
  quantity: number;
  uom: string;
  budgetPrice?: number;
  
  // Technical Requirements
  specifications?: Record<string, unknown>;
  technicalRequirements?: string;
  acceptableAlternatives?: string[];
  
  // Evaluation
  evaluationWeight: number; // Default 1.0
  isCriticalItem: boolean;
  
  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}