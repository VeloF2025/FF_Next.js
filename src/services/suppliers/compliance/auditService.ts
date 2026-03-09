/**
 * Compliance Audit Service
 * Perform compliance audits across supplier base
 */

import { ComplianceAuditResult, SupplierDocument } from './types';
import { log } from '@/lib/logger';

export class ComplianceAuditService {
  /**
   * Perform comprehensive compliance audit
   */
  static async performComplianceAudit(): Promise<ComplianceAuditResult> {
    try {
      // Get all suppliers
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();

      const result: ComplianceAuditResult = {
        totalSuppliers: suppliers.length,
        compliantSuppliers: 0,
        nonCompliantSuppliers: 0,
        pendingDocuments: 0,
        expiringDocuments: [],
        complianceByType: {},
        recommendations: []
      };

      // Analyze each supplier
      for (const supplier of suppliers) {
        const isCompliant = this.isSupplierCompliant(supplier);
        
        if (isCompliant) {
          result.compliantSuppliers++;
        } else {
          result.nonCompliantSuppliers++;
        }

        // Check for expiring documents
        if (supplier.documents) {
          const expiringDocs = this.getExpiringDocuments(supplier.documents);
          expiringDocs.forEach(doc => {
            result.expiringDocuments.push({
              supplierId: supplier.id,
              supplierName: supplier.companyName || supplier.name || 'Unknown',
              documentType: doc.type,
              expiryDate: typeof doc.expiryDate === 'string' ? new Date(doc.expiryDate) : doc.expiryDate!,
              daysUntilExpiry: Math.ceil(((typeof doc.expiryDate === 'string' ? new Date(doc.expiryDate) : doc.expiryDate!).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
            });
          });
        }

        // Count pending documents
        if (supplier.documents) {
          const pendingDocs = supplier.documents.filter(doc => {
            // Handle both compliance and base document types
            const complianceDoc = doc as any;
            return !complianceDoc.verified;
          });
          result.pendingDocuments += pendingDocs.length;
        }

        // Analyze by business type
        const businessType = supplier.businessType || 'unknown';
        if (!result.complianceByType[businessType]) {
          result.complianceByType[businessType] = {
            compliant: 0,
            nonCompliant: 0,
            percentage: 0
          };
        }

        if (isCompliant) {
          result.complianceByType[businessType].compliant++;
        } else {
          result.complianceByType[businessType].nonCompliant++;
        }
      }

      // Calculate percentages for business types
      Object.keys(result.complianceByType).forEach(businessType => {
        const typeData = result.complianceByType[businessType]!;
        const total = typeData.compliant + typeData.nonCompliant;
        typeData.percentage = total > 0 ? Math.round((typeData.compliant / total) * 100) : 0;
      });

      // Sort expiring documents by expiry date
      result.expiringDocuments.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

      // Generate recommendations
      result.recommendations = this.generateAuditRecommendations(result);

      return result;
    } catch (error) {
      log.error('Error performing compliance audit:', { data: error }, 'auditService');
      throw new Error(`Failed to perform compliance audit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if supplier is compliant
   */
  private static isSupplierCompliant(supplier: any): boolean {
    if (!supplier.complianceStatus) {
      return false;
    }

    const compliance = supplier.complianceStatus;
    return (
      compliance.taxCompliant &&
      compliance.registrationValid &&
      compliance.documentsComplete &&
      // Calculate basic compliance score for threshold check
      this.calculateBasicComplianceScore(compliance) >= 80
    );
  }

  /**
   * Get expiring documents
   */
  private static getExpiringDocuments(
    documents: SupplierDocument[],
    daysAhead: number = 60
  ): SupplierDocument[] {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return documents.filter(doc => 
      doc.expiryDate && 
      doc.expiryDate <= futureDate &&
      doc.verified
    );
  }

  /**
   * Generate audit recommendations
   */
  private static generateAuditRecommendations(auditResult: ComplianceAuditResult): string[] {
    const recommendations: string[] = [];

    // Overall compliance rate
    const complianceRate = auditResult.totalSuppliers > 0 
      ? (auditResult.compliantSuppliers / auditResult.totalSuppliers) * 100 
      : 0;

    if (complianceRate < 80) {
      recommendations.push(
        `Overall compliance rate is ${Math.round(complianceRate)}%. Target should be above 80%.`
      );
    }

    // Expiring documents
    if (auditResult.expiringDocuments.length > 0) {
      const urgentCount = auditResult.expiringDocuments.filter(doc => doc.daysUntilExpiry <= 30).length;
      if (urgentCount > 0) {
        recommendations.push(
          `${urgentCount} documents expire within 30 days. Immediate action required.`
        );
      }
      
      recommendations.push(
        `Total of ${auditResult.expiringDocuments.length} documents expiring soon. Plan renewal schedule.`
      );
    }

    // Pending documents
    if (auditResult.pendingDocuments > 0) {
      recommendations.push(
        `${auditResult.pendingDocuments} documents pending verification. Review and approve/reject.`
      );
    }

    // Business type analysis
    Object.entries(auditResult.complianceByType).forEach(([businessType, data]) => {
      if (data.percentage < 70 && (data.compliant + data.nonCompliant) >= 5) {
        recommendations.push(
          `${businessType} suppliers have low compliance rate (${data.percentage}%). Focus improvement efforts.`
        );
      }
    });

    // General recommendations
    if (auditResult.nonCompliantSuppliers > auditResult.compliantSuppliers) {
      recommendations.push(
        'More suppliers are non-compliant than compliant. Review compliance requirements and support processes.'
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('Compliance status is good. Continue regular monitoring and maintenance.');
    }

    return recommendations;
  }

  /**
   * Get suppliers by compliance status
   */
  static async getSuppliersByComplianceStatus(status: 'compliant' | 'non_compliant' | 'pending'): Promise<any[]> {
    try {
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();

      return suppliers.filter(supplier => {
        const isCompliant = this.isSupplierCompliant(supplier);
        // Calculate basic compliance score from available data
        const compliance = supplier.complianceStatus;
        let complianceScore = 0;
        if (compliance) {
          let factors = 0;
          if (compliance.taxCompliant) { complianceScore += 30; factors++; }
          if (compliance.beeCompliant) { complianceScore += 25; factors++; }
          if (compliance.isoCompliant) { complianceScore += 25; factors++; }
          if (compliance.documentsVerified) { complianceScore += 20; factors++; }
          complianceScore = factors > 0 ? complianceScore : 0;
        }

        switch (status) {
          case 'compliant':
            return isCompliant;
          case 'non_compliant':
            return !isCompliant && complianceScore < 50;
          case 'pending':
            return !isCompliant && complianceScore >= 50;
          default:
            return false;
        }
      });
    } catch (error) {
      log.error('Error getting suppliers by compliance status:', { data: error }, 'auditService');
      return [];
    }
  }

  /**
   * Get compliance statistics summary
   */
  static async getComplianceStatistics(): Promise<{
    totalSuppliers: number;
    complianceRate: number;
    averageScore: number;
    documentStats: {
      total: number;
      verified: number;
      pending: number;
      expiring: number;
    };
  }> {
    try {
      const auditResult = await this.performComplianceAudit();
      
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();
      
      const scores = suppliers
        .map(s => this.calculateBasicComplianceScore(s.complianceStatus))
        .filter(score => score > 0);
      
      const averageScore = scores.length > 0 
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length 
        : 0;

      const allDocuments = suppliers.flatMap(s => s.documents || []);
      
      return {
        totalSuppliers: auditResult.totalSuppliers,
        complianceRate: auditResult.totalSuppliers > 0 
          ? (auditResult.compliantSuppliers / auditResult.totalSuppliers) * 100 
          : 0,
        averageScore: Math.round(averageScore),
        documentStats: {
          total: allDocuments.length,
          verified: allDocuments.length, // Base documents don't track verified status
          pending: auditResult.pendingDocuments,
          expiring: auditResult.expiringDocuments.length
        }
      };
    } catch (error) {
      log.error('Error getting compliance statistics:', { data: error }, 'auditService');
      return {
        totalSuppliers: 0,
        complianceRate: 0,
        averageScore: 0,
        documentStats: {
          total: 0,
          verified: 0,
          pending: 0,
          expiring: 0
        }
      };
    }
  }

  /**
   * Calculate basic compliance score from available data
   */
  private static calculateBasicComplianceScore(compliance: any): number {
    if (!compliance) return 0;
    
    let score = 0;
    let factors = 0;
    
    if (compliance.taxCompliant) { score += 30; factors++; }
    if (compliance.beeCompliant) { score += 25; factors++; }
    if (compliance.isoCompliant) { score += 25; factors++; }
    if (compliance.documentsVerified) { score += 20; factors++; }
    
    return factors > 0 ? score : 0;
  }
}