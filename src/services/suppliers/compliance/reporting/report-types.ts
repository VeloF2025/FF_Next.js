/**
 * Compliance Report Types
 * Type definitions for compliance reporting system
 */

import {
  ComplianceStatus as BaseComplianceStatus,
  DocumentType
} from '../../../../types/supplier/base.types';

// Re-export base SupplierDocument for compatibility
export type { SupplierDocument as BaseSupplierDocument } from '../../../../types/supplier/base.types';

// Export enhanced version as SupplierDocument for this module
export type SupplierDocument = SupplierDocumentReport;

export interface ComplianceReport {
  supplierId: string;
  supplierName: string;
  businessType: string;
  overallStatus: 'compliant' | 'partial' | 'non-compliant';
  overallScore: number;
  lastUpdated: Date;
  
  // Legacy properties for backward compatibility
  complianceStatus: ComplianceStatus;
  documents: SupplierDocumentReport[];
  
  // Document status
  totalDocuments: number;
  requiredDocuments: number;
  providedDocuments: number;
  missingDocuments: string[];
  expiringDocuments: Array<{
    type: string;
    expiryDate: Date;
    daysUntilExpiry: number;
  }>;
  
  // Category breakdown
  categoryStatuses: Record<string, {
    status: 'compliant' | 'partial' | 'non-compliant';
    score: number;
    requiredCount: number;
    providedCount: number;
  }>;
  
  // Recommendations
  recommendations: string[];
  nextActions: string[];
  
  // Metadata
  reportGeneratedAt: Date;
  validUntil?: Date;
}

export interface ComplianceSummaryReport {
  totalSuppliers: number;
  complianceBreakdown: {
    compliant: number;
    partial: number;
    nonCompliant: number;
  };
  
  averageComplianceScore: number;
  topIssues: Array<{
    issue: string;
    affectedSuppliers: number;
    severity: 'high' | 'medium' | 'low';
  }>;
  
  expirationAlerts: {
    expiredDocuments: number;
    expiringSoon: number;
    expiringNextMonth: number;
  };
  
  businessTypeBreakdown: Record<string, {
    total: number;
    compliant: number;
    averageScore: number;
  }>;
  
  reportPeriod: {
    startDate: Date;
    endDate: Date;
  };
  
  generatedAt: Date;
}

export interface ComplianceStatus extends BaseComplianceStatus {
  overall?: 'compliant' | 'partial' | 'non-compliant';
  score?: number;
  lastUpdated?: Date | string;
  
  categories?: Record<string, {
    status: 'compliant' | 'partial' | 'non-compliant';
    score: number;
    requirements: Array<{
      type: string;
      required: boolean;
      provided: boolean;
      expiryDate?: Date;
      status: 'valid' | 'expired' | 'expiring' | 'missing';
    }>;
  }>;
  
  nextReviewDate?: Date;
  complianceOfficer?: string;
}

export interface SupplierDocumentReport {
  // Base document fields
  id: string;
  type: DocumentType;
  name: string;
  url: string;
  expiryDate?: Date | string;
  uploadedDate: Date | string;
  uploadedBy: string;
  
  // Additional report fields
  category?: string;
  title?: string;
  description?: string;
  isRequired?: boolean;
  
  // File information
  filename?: string;
  fileSize?: number;
  fileType?: string;
  filePath?: string;
  
  // Document details
  issueDate?: Date;
  issuingAuthority?: string;
  documentNumber?: string;
  
  // Status - base statuses match BaseSupplierDocument; 'valid' and 'expiring' are report-level display states
  status?: 'pending' | 'approved' | 'rejected' | 'expired';
  verificationStatus?: 'verified' | 'pending' | 'rejected';
  
  // Audit trail
  lastModified?: Date;
  
  // Metadata
  tags?: string[];
  notes?: string;
}

export interface ReportExportOptions {
  format: 'json' | 'csv' | 'xlsx' | 'pdf' | 'text';
  includeDetails?: boolean;
  includeRecommendations?: boolean;
  includeCategoryBreakdown?: boolean;
  filterStatus?: ('compliant' | 'partial' | 'non-compliant')[];
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  sections: Array<{
    id: string;
    title: string;
    type: 'summary' | 'detailed' | 'chart' | 'table' | 'recommendations';
    config: Record<string, unknown>;
    order: number;
  }>;
  businessTypes?: string[];
  isDefault?: boolean;
  createdBy: string;
  createdAt: Date;
  lastModified: Date;
}

export interface ComplianceMetrics {
  complianceRate: number;
  averageScore: number;
  documentCompletionRate: number;
  expirationRisk: number;
  
  trends: {
    period: string;
    complianceRateChange: number;
    scoreChange: number;
    newCompliantSuppliers: number;
  };
  
  benchmarks: {
    industryAverage: number;
    topPerformer: number;
    minimumAcceptable: number;
  };
}

export interface ComplianceAlert {
  id: string;
  type: 'expiring' | 'expired' | 'missing' | 'rejected' | 'review_due';
  severity: 'high' | 'medium' | 'low';
  supplierId: string;
  supplierName: string;
  documentType?: string;
  message: string;
  dueDate?: Date;
  createdAt: Date;
  resolvedAt?: Date;
  resolvedBy?: string;
  isActive: boolean;
}