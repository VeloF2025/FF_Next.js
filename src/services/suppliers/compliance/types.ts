/**
 * Supplier Compliance Types and Interfaces
 */

import { 
  SupplierDocument as BaseSupplierDocument, 
  ComplianceStatus as BaseComplianceStatus
} from '../../../types/supplier/base.types';

/**
 * Extended document types for supplier compliance - extends base type
 */
export interface SupplierDocument extends BaseSupplierDocument {
  verified?: boolean;
  verifiedAt?: Date | string;
  verifiedBy?: string;
  fileSize?: number;
  mimeType?: string;
}

/**
 * Extended compliance status interface - extends base type
 */
export interface ComplianceStatus extends BaseComplianceStatus {
  taxClearanceExpiry?: Date | string;
  beeCertificateExpiry?: Date | string;
  insuranceExpiry?: Date | string;
  registrationValid?: boolean;
  registrationExpiry?: Date | string;
  documentsComplete?: boolean;
  lastComplianceCheck?: Date | string;
  complianceScore?: number; // 0-100
}

/**
 * Compliance requirements by business type
 */
export interface ComplianceRequirements {
  required: string[];
  optional: string[];
  exemptions?: string[];
  specialRules?: Record<string, unknown>;
}

/**
 * Compliance audit result
 */
export interface ComplianceAuditResult {
  totalSuppliers: number;
  compliantSuppliers: number;
  nonCompliantSuppliers: number;
  pendingDocuments: number;
  expiringDocuments: Array<{
    supplierId: string;
    supplierName: string;
    documentType: string;
    expiryDate: Date;
    daysUntilExpiry: number;
  }>;
  complianceByType: Record<string, {
    compliant: number;
    nonCompliant: number;
    percentage: number;
  }>;
  recommendations: string[];
}

/**
 * Compliance report data
 */
export interface ComplianceReport {
  supplierId: string;
  supplierName: string;
  complianceStatus: ComplianceStatus;
  documents: SupplierDocument[];
  missingDocuments: string[];
  expiringDocuments: Array<{
    type: string;
    expiryDate: Date;
    daysUntilExpiry: number;
  }>;
  recommendations: string[];
  lastUpdated: Date;
  overallStatus: 'compliant' | 'partial' | 'non-compliant';
}

/**
 * Document verification result
 */
export interface DocumentVerificationResult {
  success: boolean;
  documentId: string;
  verifiedBy: string;
  verifiedAt: Date;
  issues?: string[];
  nextReviewDate?: Date;
}