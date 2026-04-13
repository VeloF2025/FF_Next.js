/**
 * Compliance Calculator
 * Handles compliance calculations and status determinations
 */

import { ComplianceStatus as ReportComplianceStatus, SupplierDocument } from './report-types';

type DocumentLike = SupplierDocument | Record<string, unknown>;
import { ComplianceChecker } from './compliance-checker';

export class ComplianceCalculator {
  /**
   * Calculate compliance status from documents
   */
  static calculateComplianceFromDocuments(
    documents: DocumentLike[],
    businessType: string
  ): ReportComplianceStatus {
    const supplierDocuments = documents as unknown as SupplierDocument[];
    const requirements = ComplianceChecker.validateRequirements(businessType, supplierDocuments);
    const expirationInfo = ComplianceChecker.checkDocumentExpiration(supplierDocuments);

    const score = ComplianceChecker.calculateComplianceScore(
      requirements.missingRequired.length + documents.length,
      documents.length,
      expirationInfo
    );

    const tempStatus = { 
      overall: 'partial' as const, 
      score, 
      lastUpdated: new Date(), 
      categories: {},
      taxCompliant: false,
      beeCompliant: false,
      insuranceValid: false
    };
    
    const overallStatus = ComplianceChecker.determineOverallStatus(
      tempStatus,
      requirements.missingRequired,
      expirationInfo
    );

    return {
      overall: overallStatus,
      score,
      lastUpdated: new Date(),
      categories: {},
      nextReviewDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      taxCompliant: requirements.missingRequired.includes('tax_clearance') ? false : true
    };
  }

  /**
   * Calculate category-specific compliance statuses
   */
  static calculateCategoryStatuses(
    _complianceStatus: ReportComplianceStatus,
    documents: DocumentLike[]
  ): Record<string, {
    status: 'compliant' | 'partial' | 'non-compliant';
    score: number;
    requiredCount: number;
    providedCount: number;
  }> {
    const supplierDocuments = documents as unknown as SupplierDocument[];
    const categories: Record<string, {
      status: 'compliant' | 'partial' | 'non-compliant';
      score: number;
      requiredCount: number;
      providedCount: number;
    }> = {};

    // Group documents by category
    const categoryGroups = new Map<string, SupplierDocument[]>();
    supplierDocuments.forEach(doc => {
      const category = doc.category || 'general';
      if (!categoryGroups.has(category)) {
        categoryGroups.set(category, []);
      }
      categoryGroups.get(category)!.push(doc);
    });

    // Calculate status for each category
    categoryGroups.forEach((categoryDocs, categoryName) => {
      const requiredCount = categoryDocs.filter(doc => doc.isRequired).length;
      const providedCount = categoryDocs.length;
      const validCount = categoryDocs.filter(doc => doc.status === 'valid').length;

      const completionRate = requiredCount > 0 ? (validCount / requiredCount) * 100 : 100;
      let status: 'compliant' | 'partial' | 'non-compliant' = 'compliant';

      if (completionRate < 60) {
        status = 'non-compliant';
      } else if (completionRate < 90) {
        status = 'partial';
      }

      categories[categoryName] = {
        status,
        score: Math.round(completionRate),
        requiredCount,
        providedCount
      };
    });

    return categories;
  }
}