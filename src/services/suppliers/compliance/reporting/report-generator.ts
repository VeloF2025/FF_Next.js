/**
 * Report Generator
 * Main service for generating individual supplier compliance reports
 */

import { ComplianceReport } from './report-types';
import { ComplianceChecker } from './compliance-checker';
import { ComplianceCalculator } from './compliance-calculator';
import { RecommendationEngine } from './recommendation-engine';
import { log } from '@/lib/logger';

export class ReportGenerator {
  /**
   * Generate comprehensive compliance report for a single supplier
   */
  static async generateComplianceReport(supplierId: string): Promise<ComplianceReport> {
    try {
      // Get supplier data
      const supplierCrudService = await import('../../supplier.crud');
      const supplier = await supplierCrudService.SupplierCrudService.getById(supplierId);
      
      if (!supplier) {
        throw new Error('Supplier not found');
      }

      const documents = supplier.documents || [];
      const businessType = supplier.businessType || 'unknown';
      
      // Calculate or get compliance status
      const complianceStatus = supplier.complianceStatus || 
        ComplianceCalculator.calculateComplianceFromDocuments(documents, businessType);

      // Validate requirements
      const requirements = ComplianceChecker.validateRequirements(businessType, documents);
      const missingDocuments = requirements.missingRequired;

      // Check expiration status
      const expirationInfo = ComplianceChecker.checkDocumentExpiration(documents);
      const expiringDocuments = expirationInfo.filter(info => 
        info.status === 'expired' || (info.status === 'expiring' && info.daysUntilExpiry <= 90)
      );

      // Calculate overall status and score
      const overallStatus = ComplianceChecker.determineOverallStatus(
        complianceStatus,
        missingDocuments,
        expiringDocuments
      );

      const overallScore = ComplianceChecker.calculateComplianceScore(
        requirements.missingRequired.length + documents.length,
        documents.length,
        expirationInfo
      );

      // Generate recommendations and actions
      const recommendations = RecommendationEngine.generateRecommendations(
        complianceStatus,
        missingDocuments,
        expiringDocuments,
        businessType
      );

      const nextActions = RecommendationEngine.generateNextActions(
        overallStatus,
        missingDocuments,
        expiringDocuments,
        recommendations
      );

      // Calculate category statuses
      const categoryStatuses = ComplianceCalculator.calculateCategoryStatuses(complianceStatus, documents);

      const report: ComplianceReport = {
        supplierId: supplier.id,
        supplierName: supplier.companyName || supplier.name || 'Unknown',
        businessType,
        overallStatus,
        overallScore,
        lastUpdated: (complianceStatus as { lastUpdated?: Date }).lastUpdated || new Date(),
        
        // Add properties expected by legacy interface
        complianceStatus,
        documents,
        
        totalDocuments: documents.length,
        requiredDocuments: requirements.missingRequired.length + documents.length,
        providedDocuments: documents.length,
        missingDocuments,
        expiringDocuments,
        
        categoryStatuses,
        recommendations,
        nextActions,
        
        reportGeneratedAt: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      };

      return report;
    } catch (error) {
      log.error('Error generating compliance report:', { data: error }, 'report-generator');
      throw new Error(`Failed to generate compliance report: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}