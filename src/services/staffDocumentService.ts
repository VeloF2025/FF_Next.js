/**
 * Staff Document Service
 * Handles CRUD operations for staff HR documents with verification workflow
 */

import { createLogger } from '@/lib/logger';
import type {
  StaffDocument,
  StaffDocumentUpdate,
  ComplianceStatus,
} from '@/types/staff-document.types';

const logger = createLogger('StaffDocumentService');

// API base URL
const API_BASE = '/api';

export interface StaffDocumentServiceError {
  message: string;
  code?: string;
  statusCode?: number;
}

class StaffDocumentServiceClass {
  /**
   * Get all documents for a staff member
   */
  async getByStaffId(
    staffId: string,
    filters?: {
      documentType?: DocumentType;
      verificationStatus?: VerificationStatus;
    }
  ): Promise<StaffDocument[]> {
    try {
      const params = new URLSearchParams();
      if (filters?.documentType) params.set('documentType', filters.documentType);
      if (filters?.verificationStatus) params.set('verificationStatus', filters.verificationStatus);

      const queryString = params.toString();
      const url = `${API_BASE}/staff/${staffId}/documents${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch documents');
      }

      const data = await response.json();
      return data.documents || [];
    } catch (error: unknown) {
      logger.error('Failed to fetch staff documents', { staffId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Get a single document by ID
   */
  async getById(documentId: string): Promise<StaffDocument> {
    try {
      const response = await fetch(`${API_BASE}/staff-documents/${documentId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch document');
      }

      const data = await response.json();
      return data.document;
    } catch (error: unknown) {
      logger.error('Failed to fetch document', { documentId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Upload a new document
   */
  async upload(
    staffId: string,
    documentType: DocumentType,
    documentName: string,
    file: File,
    metadata?: {
      expiryDate?: string;
      issuedDate?: string;
      issuingAuthority?: string;
      documentNumber?: string;
    }
  ): Promise<StaffDocument> {
    try {
      const formData = new FormData();
      formData.append('staffId', staffId);
      formData.append('documentType', documentType);
      formData.append('documentName', documentName);
      formData.append('file', file);

      if (metadata?.expiryDate) formData.append('expiryDate', metadata.expiryDate);
      if (metadata?.issuedDate) formData.append('issuedDate', metadata.issuedDate);
      if (metadata?.issuingAuthority) formData.append('issuingAuthority', metadata.issuingAuthority);
      if (metadata?.documentNumber) formData.append('documentNumber', metadata.documentNumber);

      const response = await fetch(`${API_BASE}/staff-documents-upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to upload document');
      }

      const data = await response.json();
      logger.info('Document uploaded successfully', { staffId, documentType, documentName });
      return data.document;
    } catch (error: unknown) {
      logger.error('Failed to upload document', { staffId, documentType, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Update document metadata
   */
  async update(documentId: string, updates: StaffDocumentUpdate): Promise<StaffDocument> {
    try {
      const response = await fetch(`${API_BASE}/staff-documents/${documentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update document');
      }

      const data = await response.json();
      logger.info('Document updated successfully', { documentId });
      return data.document;
    } catch (error: unknown) {
      logger.error('Failed to update document', { documentId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Delete a document
   */
  async delete(documentId: string): Promise<void> {
    try {
      const response = await fetch(`${API_BASE}/staff-documents/${documentId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete document');
      }

      logger.info('Document deleted successfully', { documentId });
    } catch (error: unknown) {
      logger.error('Failed to delete document', { documentId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Verify or reject a document
   */
  async verify(
    documentId: string,
    status: 'verified' | 'rejected',
    notes?: string
  ): Promise<StaffDocument> {
    try {
      const response = await fetch(`${API_BASE}/staff-documents/${documentId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to verify document');
      }

      const data = await response.json();
      logger.info('Document verified', { documentId, status });
      return data.document;
    } catch (error: unknown) {
      logger.error('Failed to verify document', { documentId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Get documents expiring within N days
   */
  async getExpiring(days: number = 30, staffId?: string): Promise<StaffDocument[]> {
    try {
      const params = new URLSearchParams();
      params.set('days', days.toString());
      if (staffId) params.set('staffId', staffId);

      const response = await fetch(`${API_BASE}/staff-documents/expiring?${params.toString()}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to fetch expiring documents');
      }

      const data = await response.json();
      return data.documents || [];
    } catch (error: unknown) {
      logger.error('Failed to fetch expiring documents', { days, staffId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Get compliance status for a staff member
   */
  async getComplianceStatus(staffId: string): Promise<ComplianceStatus> {
    try {
      const documents = await this.getByStaffId(staffId);

      // Count by status
      const verified = documents.filter(d => d.verificationStatus === 'verified').length;
      const pending = documents.filter(d => d.verificationStatus === 'pending').length;
      const rejected = documents.filter(d => d.verificationStatus === 'rejected').length;
      const expired = documents.filter(d => d.verificationStatus === 'expired').length;

      // Check expiring documents
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const expiringIn7Days = documents.filter(d => {
        if (!d.expiryDate) return false;
        const expiry = new Date(d.expiryDate);
        return expiry > now && expiry <= in7Days;
      }).length;

      const expiringIn30Days = documents.filter(d => {
        if (!d.expiryDate) return false;
        const expiry = new Date(d.expiryDate);
        return expiry > in7Days && expiry <= in30Days;
      }).length;

      // Check for missing required documents
      const requiredTypes: DocumentType[] = ['sa_id', 'employment_contract'];
      const existingTypes = new Set(documents.map(d => d.documentType));
      const missingRequired = requiredTypes.filter(t => !existingTypes.has(t));

      // Calculate compliance percentage
      const totalRequired = requiredTypes.length;
      const presentRequired = requiredTypes.filter(t => existingTypes.has(t)).length;
      const compliancePercentage = totalRequired > 0 ? Math.round((presentRequired / totalRequired) * 100) : 100;

      // Determine overall status
      let status: 'compliant' | 'warning' | 'non_compliant' = 'compliant';
      if (missingRequired.length > 0 || expired > 0) {
        status = 'non_compliant';
      } else if (expiringIn7Days > 0 || pending > 0) {
        status = 'warning';
      }

      return {
        staffId,
        totalDocuments: documents.length,
        verifiedDocuments: verified,
        pendingDocuments: pending,
        rejectedDocuments: rejected,
        expiredDocuments: expired,
        expiringIn30Days,
        expiringIn7Days,
        missingRequired,
        compliancePercentage,
        status,
      };
    } catch (error: unknown) {
      logger.error('Failed to get compliance status', { staffId, error: error instanceof Error ? error.message : 'Unknown error' });
      throw error;
    }
  }

  /**
   * Download a document (returns the file URL for download)
   */
  getDownloadUrl(document: StaffDocument): string {
    return document.fileUrl;
  }
}

// Export singleton instance
export const staffDocumentService = new StaffDocumentServiceClass();

// Export class for testing
export { StaffDocumentServiceClass };
