import { log } from '@/lib/logger';

/**
 * SOW Service - Main Service Facade
 * Provides high-level SOW document operations using modular components
 */

import { 
  SOWDocument, 
  SOWDocumentType, 
  DocumentStatus 
} from '../types/project.types';
import {
  SOWFileValidator,
  SOWUploadService,
  SOWDataExtractor,
  SOWDataValidator,
  SOWMetadata,
  SOWInputData,
  SOWDataExtractionResult,
  SOWValidationResult,
} from './sow';

class SOWService {
  private dataValidator: SOWDataValidator;

  constructor() {
    this.dataValidator = new SOWDataValidator();
  }

  /**
   * Upload SOW document
   */
  async uploadSOWDocument(
    projectId: string,
    file: File,
    type: SOWDocumentType,
    uploadedBy: string,
    metadata?: SOWMetadata
  ): Promise<SOWDocument> {
    try {
      // Upload document
      const document = await SOWUploadService.uploadDocument(
        projectId,
        file,
        type,
        uploadedBy,
        metadata
      );

      // Document is now handled by API endpoints - no need to add to project separately
      return document;
    } catch (error) {
      log.error('Error uploading SOW document:', { data: error }, 'sowService');
      throw new Error('Failed to upload SOW document');
    }
  }

  /**
   * Upload multiple SOW documents
   */
  async uploadMultipleSOWDocuments(
    projectId: string,
    files: {
      file: File;
      type: SOWDocumentType;
      metadata?: SOWMetadata;
    }[],
    uploadedBy: string
  ): Promise<SOWDocument[]> {
    try {
      const result = await SOWUploadService.uploadMultiple(
        projectId,
        files,
        uploadedBy
      );

      if (result.failed.length > 0) {
        log.warn('Some files failed to upload:', { data: result.failed }, 'sowService');
      }

      return result.successful;
    } catch (error) {
      log.error('Error uploading multiple SOW documents:', { data: error }, 'sowService');
      throw new Error('Failed to upload multiple SOW documents');
    }
  }

  /**
   * Update document status
   * @deprecated Use API endpoints directly for document management
   */
  async updateDocumentStatus(
    projectId: string,
    documentId: string,
    status: DocumentStatus
  ): Promise<void> {
    log.warn('updateDocumentStatus is deprecated. Use API endpoints for document management.',
      { projectId, documentId, status }, 'sowService');
    // No-op - document status is managed by the Neon database via API
  }

  /**
   * Delete SOW document
   * @deprecated Use API endpoints directly for document management
   */
  async deleteSOWDocument(
    projectId: string,
    documentId: string
  ): Promise<void> {
    log.warn('deleteSOWDocument is deprecated. Use API endpoints for document management.',
      { projectId, documentId }, 'sowService');
    // No-op - document deletion should be handled via API
  }

  /**
   * Get SOW documents by type
   * @deprecated Use API endpoints directly for data retrieval
   */
  async getSOWDocumentsByType(
    projectId: string,
    type: SOWDocumentType
  ): Promise<SOWDocument[]> {
    log.warn('getSOWDocumentsByType is deprecated. Use API endpoints for data retrieval.',
      { projectId, type }, 'sowService');
    return [];
  }

  /**
   * Extract SOW data from file
   */
  async extractSOWData(file: File): Promise<SOWDataExtractionResult> {
    try {
      return await SOWDataExtractor.extractFromFile(file);
    } catch (error) {
      log.error('Error extracting SOW data:', { data: error }, 'sowService');
      throw new Error('Failed to extract SOW data');
    }
  }

  /**
   * Validate SOW data
   */
  validateSOWData(data: SOWInputData): SOWValidationResult {
    return this.dataValidator.validate(data);
  }

  /**
   * Validate file before upload
   */
  validateFile(file: File): void {
    SOWFileValidator.validate(file);
  }

  /**
   * Get all SOW documents for a project
   * @deprecated Use API endpoints directly for data retrieval
   */
  async getAllSOWDocuments(projectId: string): Promise<SOWDocument[]> {
    log.warn('getAllSOWDocuments is deprecated. Use API endpoints for data retrieval.',
      { projectId }, 'sowService');
    return [];
  }

  /**
   * Update document metadata
   * @deprecated Use API endpoints directly for document management
   */
  async updateDocumentMetadata(
    projectId: string,
    documentId: string,
    _metadata: SOWMetadata
  ): Promise<void> {
    log.warn('updateDocumentMetadata is deprecated. Use API endpoints for document management.',
      { projectId, documentId }, 'sowService');
    // No-op - metadata is managed by the Neon database via API
  }
}

export const sowService = new SOWService();