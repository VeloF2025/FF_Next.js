/**
 * SOW Document Service
 * Handles document management operations using API endpoints
 * Replaces Firebase Firestore operations with Neon database API calls
 */

import {
  SOWDocument,
  SOWDocumentType,
  DocumentStatus
} from '../../types/project.types';
import { log } from '@/lib/logger';

export class SOWDocumentService {
  /**
   * Note: This service is no longer used for SOW upload operations.
   * SOW data is now uploaded directly to Neon via API endpoints.
   * This service is kept for backward compatibility but should be deprecated.
   */

  /**
   * Add document to project (No longer used - data goes directly to Neon)
   */
  static async addToProject(
    projectId: string,
    document: SOWDocument
  ): Promise<void> {
    log.warn('SOWDocumentService.addToProject is deprecated. Use API endpoints directly.',
      { projectId, documentType: document.type }, 'documentService');
    // No-op - data is handled by API endpoints
  }

  /**
   * Update document status (No longer used)
   */
  static async updateStatus(
    projectId: string,
    documentId: string,
    status: DocumentStatus
  ): Promise<void> {
    log.warn('SOWDocumentService.updateStatus is deprecated.',
      { projectId, documentId, status }, 'documentService');
    // No-op - status is managed by the Neon database
  }

  /**
   * Delete SOW document (No longer used)
   */
  static async deleteDocument(
    projectId: string,
    documentId: string
  ): Promise<void> {
    log.warn('SOWDocumentService.deleteDocument is deprecated.',
      { projectId, documentId }, 'documentService');
    // No-op - document deletion should be handled via API
  }

  /**
   * Get documents by type (No longer used - use API endpoints)
   */
  static async getByType(
    projectId: string,
    type: SOWDocumentType
  ): Promise<SOWDocument[]> {
    log.warn('SOWDocumentService.getByType is deprecated. Use API endpoints for data retrieval.',
      { projectId, type }, 'documentService');
    return [];
  }

  /**
   * Get all documents for a project (No longer used - use API endpoints)
   */
  static async getAll(projectId: string): Promise<SOWDocument[]> {
    log.warn('SOWDocumentService.getAll is deprecated. Use API endpoints for data retrieval.',
      { projectId }, 'documentService');
    return [];
  }

  /**
   * Update document metadata (No longer used)
   */
  static async updateMetadata(
    projectId: string,
    documentId: string,
    _metadata: Record<string, unknown>
  ): Promise<void> {
    log.warn('SOWDocumentService.updateMetadata is deprecated.',
      { projectId, documentId }, 'documentService');
    // No-op - metadata is managed by the Neon database
  }
}