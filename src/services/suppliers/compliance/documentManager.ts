/**
 * Supplier Document Management
 * Handle document upload, verification, and lifecycle
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 * TODO: Create /api/suppliers endpoints for full functionality
 */

import { SupplierDocument, DocumentVerificationResult } from './types';
import { log } from '@/lib/logger';

export class DocumentManager {
  /**
   * Add document to supplier
   */
  static async addDocument(
    supplierId: string,
    document: Omit<SupplierDocument, 'id'>
  ): Promise<void> {
    try {
      const newDocument: SupplierDocument = {
        id: `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        ...document,
        uploadedDate: new Date(),
        verified: false
      };

      // Get current supplier and update documents
      const supplierCrudService = await import('../supplier.crud');
      const supplier = await supplierCrudService.SupplierCrudService.getById(supplierId);

      if (!supplier) {
        throw new Error('Supplier not found');
      }

      const documents = [...(supplier.documents || []), newDocument];
      await supplierCrudService.SupplierCrudService.update(supplierId, { documents } as never);
    } catch (error) {
      log.error('Error adding document:', { data: error }, 'documentManager');
      throw new Error(`Failed to add document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Remove document from supplier
   */
  static async removeDocument(supplierId: string, documentId: string): Promise<void> {
    try {
      // Get the current documents
      const supplierCrudService = await import('../supplier.crud');
      const supplier = await supplierCrudService.SupplierCrudService.getById(supplierId);

      if (!supplier || !supplier.documents) {
        throw new Error('Supplier or documents not found');
      }

      const documents = supplier.documents.filter(doc => doc.id !== documentId);
      await supplierCrudService.SupplierCrudService.update(supplierId, { documents } as never);
    } catch (error) {
      log.error('Error removing document:', { data: error }, 'documentManager');
      throw new Error(`Failed to remove document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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
    try {
      // Get current supplier data
      const supplierCrudService = await import('../supplier.crud');
      const supplier = await supplierCrudService.SupplierCrudService.getById(supplierId);

      if (!supplier || !supplier.documents) {
        throw new Error('Supplier or documents not found');
      }

      // Find and update the document
      const documents = supplier.documents.map(doc => {
        if (doc.id === documentId) {
          return {
            ...doc,
            verified: issues ? false : true,
            verifiedAt: new Date(),
            verifiedBy: verifiedBy
          };
        }
        return doc;
      });

      await supplierCrudService.SupplierCrudService.update(supplierId, { documents } as never);

      const result: DocumentVerificationResult = {
        success: !issues || issues.length === 0,
        documentId,
        verifiedBy,
        verifiedAt: new Date(),
        ...(issues && issues.length > 0 && { issues })
      };

      return result;
    } catch (error) {
      log.error('Error verifying document:', { data: error }, 'documentManager');
      throw new Error(`Failed to verify document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get documents by type
   */
  static getDocumentsByType(
    documents: SupplierDocument[],
    type: SupplierDocument['type']
  ): SupplierDocument[] {
    return documents.filter(doc => doc.type === type);
  }

  /**
   * Get expiring documents
   */
  static getExpiringDocuments(
    documents: SupplierDocument[],
    daysAhead: number = 30
  ): Array<SupplierDocument & { daysUntilExpiry: number }> {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return documents
      .filter(doc => doc.expiryDate)
      .map(doc => {
        const expiryDate = typeof doc.expiryDate === 'string' ? new Date(doc.expiryDate) : doc.expiryDate!;
        return {
          ...doc,
          daysUntilExpiry: Math.ceil((expiryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        };
      })
      .filter(doc => {
        const expiryDate = typeof doc.expiryDate === 'string' ? new Date(doc.expiryDate) : doc.expiryDate!;
        return expiryDate <= futureDate;
      })
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  }

  /**
   * Get verified documents
   */
  static getVerifiedDocuments(documents: SupplierDocument[]): SupplierDocument[] {
    return documents.filter(doc => doc.verified);
  }

  /**
   * Get pending verification documents
   */
  static getPendingDocuments(documents: SupplierDocument[]): SupplierDocument[] {
    return documents.filter(doc => !doc.verified);
  }

  /**
   * Calculate document completeness percentage
   */
  static calculateDocumentCompleteness(
    documents: SupplierDocument[],
    requiredTypes: string[]
  ): number {
    if (requiredTypes.length === 0) return 100;

    const providedTypes = new Set(documents.map(doc => doc.type.toString()));
    const completedRequired = requiredTypes.filter(type => providedTypes.has(type));

    return Math.round((completedRequired.length / requiredTypes.length) * 100);
  }
}
