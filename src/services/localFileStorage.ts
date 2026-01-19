/**
 * Local File Storage Service
 * Replaces Firebase Storage with local filesystem storage
 * Files are stored on the Velo server and served via nginx
 */

import fs from 'fs';
import path from 'path';

export interface UploadResult {
  url: string;
  path: string;
  fileName: string;
  size: number;
}

// Storage configuration
const STORAGE_CONFIG = {
  // Base path for uploads on the server
  basePath: process.env.FILE_STORAGE_PATH || '/var/www/fibreflow/uploads',
  // Base URL for serving files (nginx serves /uploads from the basePath)
  baseUrl: process.env.FILE_STORAGE_URL || '/uploads',
  // Fallback path for local development (public/uploads in project root)
  localFallbackPath: path.join(process.cwd(), 'public', 'uploads'),
};

export class LocalFileStorageService {
  /**
   * Upload a file to local filesystem
   * @param buffer - File buffer to upload
   * @param storagePath - Storage path (e.g., 'staff-documents/123/id_document')
   * @param fileName - Original filename
   * @param mimeType - File MIME type
   * @returns Upload result with URL and metadata
   */
  static async uploadFile(
    buffer: Buffer,
    storagePath: string,
    fileName: string,
    mimeType?: string
  ): Promise<UploadResult> {
    try {
      // Sanitize and prepare filename
      const sanitizedFileName = this.sanitizeFileName(fileName);
      const timestamp = Date.now();
      const finalFileName = `${timestamp}_${sanitizedFileName}`;

      // Create full directory path
      const dirPath = path.join(STORAGE_CONFIG.basePath, storagePath);
      const filePath = path.join(dirPath, finalFileName);

      // Ensure directory exists
      await fs.promises.mkdir(dirPath, { recursive: true });

      // Write file to disk
      await fs.promises.writeFile(filePath, buffer);

      // Generate URL for the file
      const relativePath = path.join(storagePath, finalFileName);
      const url = `${STORAGE_CONFIG.baseUrl}/${relativePath}`;

      return {
        url,
        path: relativePath,
        fileName: sanitizedFileName,
        size: buffer.length,
      };
    } catch (error) {
      console.error('Local storage upload error:', error);
      throw new Error(
        `Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete a file from local filesystem
   * @param storagePath - Relative path to the file
   */
  static async deleteFile(storagePath: string): Promise<void> {
    try {
      const filePath = path.join(STORAGE_CONFIG.basePath, storagePath);

      // Check if file exists before deleting
      if (await this.fileExists(storagePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.error('Local storage delete error:', error);
      throw new Error(
        `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Check if a file exists (checks both server path and local fallback)
   * @param storagePath - Relative path to the file
   */
  static async fileExists(storagePath: string): Promise<boolean> {
    // Try server path first
    try {
      const serverPath = path.join(STORAGE_CONFIG.basePath, storagePath);
      await fs.promises.access(serverPath, fs.constants.F_OK);
      return true;
    } catch {
      // Try local fallback path (for development)
      try {
        const localPath = path.join(STORAGE_CONFIG.localFallbackPath, storagePath);
        await fs.promises.access(localPath, fs.constants.F_OK);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get file from local filesystem (checks both server path and local fallback)
   * @param storagePath - Relative path to the file
   * @returns File buffer or null if not found
   */
  static async getFile(storagePath: string): Promise<Buffer | null> {
    // Try server path first
    try {
      const serverPath = path.join(STORAGE_CONFIG.basePath, storagePath);
      return await fs.promises.readFile(serverPath);
    } catch {
      // Try local fallback path (for development)
      try {
        const localPath = path.join(STORAGE_CONFIG.localFallbackPath, storagePath);
        return await fs.promises.readFile(localPath);
      } catch {
        return null;
      }
    }
  }

  /**
   * List files in a directory
   * @param dirPath - Relative directory path
   * @returns Array of file names
   */
  static async listFiles(dirPath: string): Promise<string[]> {
    try {
      const fullPath = path.join(STORAGE_CONFIG.basePath, dirPath);
      const files = await fs.promises.readdir(fullPath);
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Get the full URL for a stored file
   * @param storagePath - Relative storage path
   */
  static getFileUrl(storagePath: string): string {
    return `${STORAGE_CONFIG.baseUrl}/${storagePath}`;
  }

  /**
   * Sanitize filename to prevent path traversal and issues
   */
  private static sanitizeFileName(fileName: string): string {
    // Get file extension
    const lastDot = fileName.lastIndexOf('.');
    const name = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;
    const ext = lastDot > 0 ? fileName.substring(lastDot) : '';

    // Remove special characters, keep only alphanumeric, dash, underscore
    const sanitized = name
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .replace(/_+/g, '_')
      .substring(0, 100); // Limit length

    return sanitized + ext.toLowerCase();
  }

  /**
   * Validate file before upload
   * @param file - File info to validate
   * @param allowedTypes - Array of allowed MIME types
   * @param maxSize - Maximum file size in bytes
   */
  static validateFile(
    mimeType: string,
    size: number,
    allowedTypes: string[] = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    maxSize: number = 10 * 1024 * 1024 // 10MB default
  ): { valid: boolean; error?: string } {
    // Check file type
    if (!allowedTypes.includes(mimeType)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed: ${allowedTypes.join(', ')}`,
      };
    }

    // Check file size
    if (size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(1);
      return {
        valid: false,
        error: `File too large. Maximum size: ${maxSizeMB}MB`,
      };
    }

    return { valid: true };
  }

  /**
   * Get storage paths for different document types
   */
  static getStaffDocumentPath(staffId: string, documentType: string): string {
    return `staff-documents/${staffId}/${documentType}`;
  }

  static getContractorDocumentPath(contractorId: string): string {
    return `contractors/${contractorId}/documents`;
  }

  static getMaintenanceAttachmentPath(ticketId: string): string {
    return `maintenance-attachments/${ticketId}`;
  }

  static getProfilePicturePath(userId: string): string {
    return `profile-pictures/${userId}`;
  }

  static getPolePhotoPath(projectId: string, poleId: number | string): string {
    return `poles/${projectId}/${poleId}`;
  }
}

// Export singleton instance methods for convenience
export const localFileStorage = LocalFileStorageService;
