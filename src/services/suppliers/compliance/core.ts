/**
 * Supplier Compliance Core Service
 * Main orchestration for compliance management
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 * TODO: Create /api/suppliers endpoints for full functionality
 */

import { ComplianceStatus, SupplierDocument, DocumentVerificationResult } from './types';
import { DocumentManager } from './documentManager';
import { ComplianceCalculator } from './complianceCalculator';
import { RequirementsManager } from './requirementsManager';
import { ComplianceReportGenerator } from './reportGenerator';
import { log } from '@/lib/logger';

export class ComplianceCore {
  /**
   * Update supplier compliance status
   */
  static async updateCompliance(
    supplierId: string,
    complianceUpdates: Partial<ComplianceStatus>
  ): Promise<void> {
    try {
      // Calculate compliance score
      const updatedCompliance = {
        ...complianceUpdates,
        lastComplianceCheck: new Date(),
        complianceScore: ComplianceCalculator.calculateComplianceScore(complianceUpdates)
      };

      const response = await fetch(`/api/suppliers/${supplierId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complianceStatus: updatedCompliance,
          updatedAt: new Date()
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update compliance');
      }
    } catch (error) {
      log.error('Error updating compliance:', { data: error }, 'core');
      throw new Error(`Failed to update compliance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Add document to supplier
   */
  static async addDocument(
    supplierId: string,
    document: Omit<SupplierDocument, 'id'>
  ): Promise<void> {
    await DocumentManager.addDocument(supplierId, document);
    await this.updateComplianceAfterDocumentChange(supplierId);
  }

  /**
   * Remove document from supplier
   */
  static async removeDocument(supplierId: string, documentId: string): Promise<void> {
    await DocumentManager.removeDocument(supplierId, documentId);
    await this.updateComplianceAfterDocumentChange(supplierId);
  }

  /**
   * Verify document
   */
  static async verifyDocument(
    supplierId: string,
    documentId: string,
    verifiedBy: string,
    issues?: string[]
  ): Promise<DocumentVerificationResult> {
    const result = await DocumentManager.verifyDocument(supplierId, documentId, verifiedBy, issues);
    await this.updateComplianceAfterDocumentChange(supplierId);
    return result;
  }

  /**
   * Generate compliance report
   */
  static async generateComplianceReport(supplierId: string) {
    return ComplianceReportGenerator.generateComplianceReport(supplierId);
  }

  /**
   * Get compliance requirements for business type
   */
  static getComplianceRequirements(businessType: string) {
    return RequirementsManager.getComplianceRequirements(businessType);
  }

  /**
   * Update compliance status after document changes
   */
  private static async updateComplianceAfterDocumentChange(supplierId: string): Promise<void> {
    try {
      // Get current supplier data
      const supplierCrudService = await import('../supplier.crud');
      const supplier = await supplierCrudService.SupplierCrudService.getById(supplierId);

      if (!supplier) {
        throw new Error('Supplier not found');
      }

      const documents = supplier.documents || [];
      const currentCompliance = supplier.complianceStatus || {};

      // Calculate new compliance status
      const updatedCompliance = ComplianceCalculator.updateComplianceFromDocuments(
        currentCompliance,
        documents
      );

      // Update in database
      await this.updateCompliance(supplierId, updatedCompliance);

    } catch (error) {
      log.error('Error updating compliance after document change:', { data: error }, 'core');
      // Don't throw here to avoid breaking the main operation
    }
  }

  /**
   * Bulk update compliance for multiple suppliers
   */
  static async bulkUpdateCompliance(supplierIds: string[]): Promise<{
    success: number;
    failed: number;
    errors: Array<{ supplierId: string; error: string }>;
  }> {
    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ supplierId: string; error: string }>
    };

    for (const supplierId of supplierIds) {
      try {
        await this.updateComplianceAfterDocumentChange(supplierId);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          supplierId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * Get suppliers with expiring documents
   */
  static async getSuppliersWithExpiringDocuments(daysAhead: number = 30): Promise<Array<{
    supplierId: string;
    supplierName: string;
    expiringDocuments: Array<{
      type: string;
      expiryDate: Date;
      daysUntilExpiry: number;
    }>;
  }>> {
    try {
      const supplierCrudService = await import('../supplier.crud');
      const suppliers = await supplierCrudService.SupplierCrudService.getAll();

      const result: Array<{
        supplierId: string;
        supplierName: string;
        expiringDocuments: Array<{
          type: string;
          expiryDate: Date;
          daysUntilExpiry: number;
        }>;
      }> = [];

      suppliers.forEach(supplier => {
        if (supplier.documents && supplier.documents.length > 0) {
          const expiringDocs = ComplianceCalculator.getExpiringDocumentsInfo(
            supplier.documents,
            daysAhead
          );

          if (expiringDocs.length > 0) {
            result.push({
              supplierId: supplier.id,
              supplierName: supplier.companyName || supplier.name || 'Unknown',
              expiringDocuments: expiringDocs
            });
          }
        }
      });

      return result.sort((a, b) => {
        const aMinDays = Math.min(...a.expiringDocuments.map(d => d.daysUntilExpiry));
        const bMinDays = Math.min(...b.expiringDocuments.map(d => d.daysUntilExpiry));
        return aMinDays - bMinDays;
      });
    } catch (error) {
      log.error('Error getting suppliers with expiring documents:', { data: error }, 'core');
      return [];
    }
  }
}
