/**
 * Compliance Checker
 * Core logic for checking and validating supplier compliance status
 */

import { ComplianceStatus, SupplierDocument, ComplianceMetrics } from './report-types';

export class ComplianceChecker {
  /**
   * Determine overall compliance status based on documents and requirements
   */
  static determineOverallStatus(
    complianceStatus: ComplianceStatus,
    missingDocuments: string[],
    expiringDocuments: Array<{ type: string; expiryDate: Date; daysUntilExpiry: number }>
  ): 'compliant' | 'partial' | 'non-compliant' {
    const hasExpiredDocuments = expiringDocuments.some(doc => doc.daysUntilExpiry < 0);
    const hasCriticalMissingDocs = missingDocuments.length > 0;
    const hasExpiringDocuments = expiringDocuments.some(doc => doc.daysUntilExpiry <= 30);

    if (hasExpiredDocuments || (hasCriticalMissingDocs && missingDocuments.length > 2)) {
      return 'non-compliant';
    }

    if (hasCriticalMissingDocs || hasExpiringDocuments || (complianceStatus.score ?? 0) < 80) {
      return 'partial';
    }

    return 'compliant';
  }

  /**
   * Calculate compliance score based on document completeness and validity
   */
  static calculateComplianceScore(
    totalRequired: number,
    providedCount: number,
    expiringDocuments: Array<{ type: string; expiryDate: Date; daysUntilExpiry: number }>
  ): number {
    if (totalRequired === 0) return 100;

    // Base score from document completeness
    const completenessScore = (providedCount / totalRequired) * 100;

    // Penalty for expired documents
    const expiredDocs = expiringDocuments.filter(doc => doc.daysUntilExpiry < 0);
    const expiringDocs = expiringDocuments.filter(doc => doc.daysUntilExpiry >= 0 && doc.daysUntilExpiry <= 30);

    let penalties = 0;
    penalties += expiredDocs.length * 15; // 15 points per expired document
    penalties += expiringDocs.length * 5;  // 5 points per expiring document

    const finalScore = Math.max(0, completenessScore - penalties);
    return Math.round(finalScore * 100) / 100;
  }

  /**
   * Check document expiration status
   */
  static checkDocumentExpiration(documents: SupplierDocument[]): Array<{
    type: string;
    expiryDate: Date;
    daysUntilExpiry: number;
    status: 'expired' | 'expiring' | 'valid';
  }> {
    const today = new Date();
    const expirationInfo: Array<{
      type: string;
      expiryDate: Date;
      daysUntilExpiry: number;
      status: 'expired' | 'expiring' | 'valid';
    }> = [];

    documents.forEach(doc => {
      if (doc.expiryDate) {
        const expiryDate = typeof doc.expiryDate === 'string' ? new Date(doc.expiryDate) : doc.expiryDate;
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        
        let status: 'expired' | 'expiring' | 'valid' = 'valid';
        if (daysUntilExpiry < 0) {
          status = 'expired';
        } else if (daysUntilExpiry <= 90) {
          status = 'expiring';
        }

        expirationInfo.push({
          type: doc.type.toString(),
          expiryDate: typeof doc.expiryDate === 'string' ? new Date(doc.expiryDate) : doc.expiryDate,
          daysUntilExpiry,
          status
        });
      }
    });

    return expirationInfo.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }

  /**
   * Validate document requirements for business type
   */
  static validateRequirements(
    businessType: string,
    documents: SupplierDocument[]
  ): {
    isValid: boolean;
    missingRequired: string[];
    optionalMissing: string[];
    errors: string[];
  } {
    const errors: string[] = [];
    const providedTypes = documents.map(doc => doc.type);
    
    // Get required documents for business type
    const requiredDocs = this.getRequiredDocuments(businessType);
    const optionalDocs = this.getOptionalDocuments(businessType);
    
    const providedTypeStrings = providedTypes.map(type => type.toString());
    const missingRequired = requiredDocs.filter(req => !providedTypeStrings.includes(req));
    const optionalMissing = optionalDocs.filter(opt => !providedTypeStrings.includes(opt));

    // Check for duplicate document types
    const typeCounts = new Map<string, number>();
    providedTypes.forEach(type => {
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });

    typeCounts.forEach((count, type) => {
      if (count > 1) {
        errors.push(`Multiple ${type} documents provided - only one should be active`);
      }
    });

    // Check for invalid document types
    const allValidTypes = [...requiredDocs, ...optionalDocs];
    providedTypes.forEach(type => {
      if (!allValidTypes.includes(type)) {
        errors.push(`Document type "${type}" not recognized for ${businessType} business type`);
      }
    });

    return {
      isValid: missingRequired.length === 0 && errors.length === 0,
      missingRequired,
      optionalMissing,
      errors
    };
  }

  /**
   * Check for compliance violations
   */
  static checkViolations(
    documents: SupplierDocument[],
    _complianceStatus: ComplianceStatus
  ): Array<{
    type: 'expired' | 'missing' | 'invalid' | 'duplicate';
    severity: 'high' | 'medium' | 'low';
    message: string;
    documentType?: string;
    recommendedAction: string;
  }> {
    const violations: Array<{
      type: 'expired' | 'missing' | 'invalid' | 'duplicate';
      severity: 'high' | 'medium' | 'low';
      message: string;
      documentType?: string;
      recommendedAction: string;
    }> = [];

    // Check for expired documents
    const expirationInfo = this.checkDocumentExpiration(documents);
    expirationInfo.forEach(info => {
      if (info.status === 'expired') {
        violations.push({
          type: 'expired',
          severity: 'high',
          message: `${info.type} expired ${Math.abs(info.daysUntilExpiry)} days ago`,
          documentType: info.type,
          recommendedAction: `Renew ${info.type} immediately to maintain compliance`
        });
      } else if (info.status === 'expiring' && info.daysUntilExpiry <= 30) {
        violations.push({
          type: 'expired',
          severity: 'medium',
          message: `${info.type} expires in ${info.daysUntilExpiry} days`,
          documentType: info.type,
          recommendedAction: `Schedule renewal for ${info.type} before expiration`
        });
      }
    });

    // Check for rejected or invalid documents
    documents.forEach(doc => {
      if (doc.status === 'rejected') {
        violations.push({
          type: 'invalid',
          severity: 'high',
          message: `${doc.type} document was rejected`,
          documentType: doc.type,
          recommendedAction: `Resubmit valid ${doc.type} document`
        });
      }

      if (doc.verificationStatus === 'rejected') {
        violations.push({
          type: 'invalid',
          severity: 'medium',
          message: `${doc.type} verification failed`,
          documentType: doc.type,
          recommendedAction: `Provide additional verification for ${doc.type}`
        });
      }
    });

    return violations.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * Calculate compliance metrics for reporting
   */
  static calculateMetrics(
    supplierStatuses: ComplianceStatus[]
  ): ComplianceMetrics {
    const totalSuppliers = supplierStatuses.length;
    
    if (totalSuppliers === 0) {
      return {
        complianceRate: 0,
        averageScore: 0,
        documentCompletionRate: 0,
        expirationRisk: 0,
        trends: {
          period: 'current',
          complianceRateChange: 0,
          scoreChange: 0,
          newCompliantSuppliers: 0
        },
        benchmarks: {
          industryAverage: 75,
          topPerformer: 95,
          minimumAcceptable: 60
        }
      };
    }

    const compliantCount = supplierStatuses.filter(s => s.overall === 'compliant').length;
    const complianceRate = (compliantCount / totalSuppliers) * 100;

    const totalScore = supplierStatuses.reduce((sum, status) => sum + (status.score ?? 0), 0);
    const averageScore = totalScore / totalSuppliers;

    // Calculate document completion rate
    let totalRequired = 0;
    let totalProvided = 0;

    supplierStatuses.forEach(status => {
      if (status.categories) {
        Object.values(status.categories).forEach((category) => {
          category.requirements.forEach((req) => {
            if (req.required) {
              totalRequired++;
              if (req.provided) {
                totalProvided++;
              }
            }
          });
        });
      }
    });

    const documentCompletionRate = totalRequired > 0 ? (totalProvided / totalRequired) * 100 : 100;

    // Calculate expiration risk
    let expiringCount = 0;
    supplierStatuses.forEach(status => {
      if (status.categories) {
        Object.values(status.categories).forEach((category) => {
          category.requirements.forEach((req) => {
            if (req.expiryDate) {
              const daysUntilExpiry = Math.ceil((req.expiryDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
              if (daysUntilExpiry <= 90) {
                expiringCount++;
              }
            }
          });
        });
      }
    });

    const expirationRisk = totalRequired > 0 ? (expiringCount / totalRequired) * 100 : 0;

    return {
      complianceRate: Math.round(complianceRate * 100) / 100,
      averageScore: Math.round(averageScore * 100) / 100,
      documentCompletionRate: Math.round(documentCompletionRate * 100) / 100,
      expirationRisk: Math.round(expirationRisk * 100) / 100,
      trends: {
        period: 'current',
        complianceRateChange: 0, // Would need historical data
        scoreChange: 0, // Would need historical data
        newCompliantSuppliers: 0 // Would need historical data
      },
      benchmarks: {
        industryAverage: 75,
        topPerformer: 95,
        minimumAcceptable: 60
      }
    };
  }

  /**
   * Get required documents for business type
   */
  private static getRequiredDocuments(businessType: string): string[] {
    const requirements: Record<string, string[]> = {
      'corporation': [
        'certificate_of_incorporation',
        'tax_certificate',
        'insurance_certificate',
        'bbbee_certificate'
      ],
      'pty_ltd': [
        'company_registration',
        'tax_certificate',
        'insurance_certificate',
        'bbbee_certificate'
      ],
      'sole_proprietorship': [
        'business_registration',
        'tax_certificate',
        'insurance_certificate'
      ],
      'partnership': [
        'partnership_agreement',
        'tax_certificate',
        'insurance_certificate'
      ],
      'trust': [
        'trust_deed',
        'tax_certificate',
        'insurance_certificate'
      ]
    };

    return requirements[businessType.toLowerCase()] ?? requirements['corporation']!;
  }

  /**
   * Get optional documents for business type
   */
  private static getOptionalDocuments(_businessType: string): string[] {
    return [
      'bank_statement',
      'audited_financials',
      'quality_certificate',
      'health_safety_certificate',
      'environmental_certificate',
      'professional_indemnity',
      'trade_license'
    ];
  }
}