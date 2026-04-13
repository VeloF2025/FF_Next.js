/**
 * SOW Upload Service
 * Handles file upload operations for SOW documents
 * Now uses API endpoints instead of Firebase Storage
 */

import {
  SOWDocument,
  SOWDocumentType,
  DocumentStatus
} from '../../types/project.types';
import { SOWFileValidator } from './fileValidator';
import { SOW_CONFIG, SOWMetadata } from './types';
import { log } from '@/lib/logger';
import { neonSOWService } from '@/services/neonSOWService';

export class SOWUploadService {
  /**
   * Upload single SOW document
   * Now processes the file and uploads data directly to Neon via API
   */
  static async uploadDocument(
    projectId: string,
    file: File,
    type: SOWDocumentType,
    uploadedBy: string,
    metadata?: SOWMetadata
  ): Promise<SOWDocument> {
    // Validate file
    SOWFileValidator.validate(file);

    // Process the file to extract data
    const processedData = await this.processFileForUpload(file, type);
    
    if (!processedData || processedData.length === 0) {
      throw new Error('No valid data found in file');
    }

    // Upload data to Neon via API
    let uploadResult;
    switch (type) {
      case 'poles':
        uploadResult = await neonSOWService.uploadPoles(projectId, processedData);
        break;
      case 'drops':
        uploadResult = await neonSOWService.uploadDrops(projectId, processedData);
        break;
      case 'fibre':
        uploadResult = await neonSOWService.uploadFibre(projectId, processedData);
        break;
      default:
        throw new Error(`Unsupported document type: ${type}`);
    }

    if (!uploadResult.success) {
      throw new Error(uploadResult.message || `Failed to upload ${type} data`);
    }

    // Create document object (for UI consistency, but data is now in Neon)
    const timestamp = Date.now();
    const sowDocument: SOWDocument = {
      id: `${type}_${timestamp}`,
      name: file.name,
      type,
      fileUrl: '', // No longer storing files in Firebase Storage
      uploadDate: new Date().toISOString(),
      uploadedBy,
      version: 1,
      status: DocumentStatus.APPROVED, // Direct upload to Neon is complete
      metadata: {
        ...(metadata || {}),
        poleCount: type === 'poles' ? processedData.length : undefined,
        dropCount: type === 'drops' ? processedData.length : undefined,
      },
    };

    return sowDocument;
  }

  /**
   * Process file for data extraction
   */
  // PARTIAL: return type still needs proper typing once NeonPoleData/NeonDropData types are stabilized
  private static async processFileForUpload(file: File, type: SOWDocumentType): Promise<any[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Parse Excel file using the data processor service
      // For now, return empty array - actual processing should be handled by the data processor service
      // This service should focus on API communication, not file processing
      log.info('File processing delegated to data processor service', { fileName: file.name, type }, 'uploadService');
      return [];
    } catch (error) {
      log.error('Error processing file for upload:', { data: error }, 'uploadService');
      throw new Error(`Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload multiple SOW documents
   */
  static async uploadMultiple(
    projectId: string,
    files: Array<{
      file: File;
      type: SOWDocumentType;
      metadata?: SOWMetadata;
    }>,
    uploadedBy: string
  ): Promise<{
    successful: SOWDocument[];
    failed: string[];
  }> {
    const uploadPromises = files.map(({ file, type, metadata }) =>
      this.uploadDocument(projectId, file, type, uploadedBy, metadata)
        .then(doc => ({ status: 'success' as const, value: doc }))
        .catch(error => ({
          status: 'error' as const,
          fileName: file.name,
          error
        }))
    );

    const results = await Promise.all(uploadPromises);
    
    const successful: SOWDocument[] = [];
    const failed: string[] = [];

    results.forEach(result => {
      if (result.status === 'success') {
        successful.push(result.value);
      } else {
        failed.push(result.fileName);
        log.warn(`Failed to upload ${result.fileName}:`, { data: result.error }, 'uploadService');
      }
    });

    return { successful, failed };
  }
}