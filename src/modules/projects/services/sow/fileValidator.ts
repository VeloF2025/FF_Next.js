/**
 * SOW File Validator
 * Handles file validation for SOW document uploads
 */

import { SOW_CONFIG } from './types';

export class SOWFileValidator {
  /**
   * Validate file before upload
   */
  static validate(file: File): void {
    this.validateFileSize(file);
    this.validateFileType(file);
  }

  /**
   * Validate file size
   */
  private static validateFileSize(file: File): void {
    if (file.size > SOW_CONFIG.MAX_FILE_SIZE) {
      throw new Error('File size exceeds 50MB limit');
    }
  }

  /**
   * Validate file type
   */
  private static validateFileType(file: File): void {
    if (!(SOW_CONFIG.ALLOWED_TYPES as readonly string[]).includes(file.type)) {
      throw new Error(
        'File type not supported. Please upload PDF, Excel, Word, or image files.'
      );
    }
  }

  /**
   * Check if file is an image
   */
  static isImage(file: File): boolean {
    return file.type.startsWith('image/');
  }

  /**
   * Check if file is a document
   */
  static isDocument(file: File): boolean {
    return (
      file.type.includes('pdf') ||
      file.type.includes('word') ||
      file.type.includes('document')
    );
  }

  /**
   * Check if file is a spreadsheet
   */
  static isSpreadsheet(file: File): boolean {
    return file.type.includes('excel') || file.type.includes('spreadsheet');
  }

  /**
   * Get file extension
   */
  static getExtension(fileName: string): string {
    return fileName.split('.').pop()?.toLowerCase() || '';
  }

  /**
   * Generate unique filename
   */
  static generateFileName(
    projectId: string,
    type: string,
    originalName: string
  ): string {
    const timestamp = Date.now();
    return `${projectId}/${type}_${timestamp}_${originalName}`;
  }
}