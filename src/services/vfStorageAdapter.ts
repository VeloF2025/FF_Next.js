/**
 * VF Storage Adapter
 * Connects to the VF Server storage service (100.96.203.105:8091)
 * Replaces Firebase Storage with self-hosted solution
 *
 * Environment Variables:
 * - NEXT_PUBLIC_USE_VF_STORAGE: Set to 'true' to use VF Storage
 * - VF_STORAGE_URL: Override the base URL (default: http://100.96.203.105:8091)
 */

import { log } from '@/lib/logger';
import {
  VF_STORAGE_CONFIG,
  VFStorageUploadResponse,
  VFStorageFile,
} from '@/types/staff-document.types';

// Use environment variable to override default URL
const VF_STORAGE_BASE_URL =
  process.env.VF_STORAGE_URL || VF_STORAGE_CONFIG.baseUrl;

/**
 * Check if VF Storage is enabled
 */
export function isVFStorageEnabled(): boolean {
  return process.env.NEXT_PUBLIC_USE_VF_STORAGE === 'true';
}

/**
 * VF Storage Service for file operations
 */
export class VFStorageService {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || VF_STORAGE_BASE_URL;
  }

  /**
   * Check if VF Storage server is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });
      return response.ok;
    } catch (error) {
      log.warn('VF Storage health check failed:', { data: error });
      return false;
    }
  }

  /**
   * Upload a file to VF Storage
   * @param file - File or Buffer to upload
   * @param type - Storage type (e.g., 'staff', 'contractors')
   * @param category - Category within type (e.g., 'documents', 'images')
   * @param fileName - Original filename
   */
  async uploadFile(
    file: Buffer | File | Blob,
    type: string,
    category: string,
    fileName: string
  ): Promise<VFStorageUploadResponse> {
    try {
      const formData = new FormData();

      // Handle different file types
      if (file instanceof Buffer) {
        const blob = new Blob([file as unknown as BlobPart]);
        formData.append('file', blob, fileName);
      } else {
        formData.append('file', file as Blob, fileName);
      }

      const url = `${this.baseUrl}/upload/${type}/${encodeURIComponent(category)}`;
      log.info(`Uploading to VF Storage: ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      // Use the server's response directly - it returns the actual hashed filename and path
      const actualFilename = result.filename || fileName;
      const actualPath = result.path || `${type}/${category}/${actualFilename}`;

      // Return relative /storage/ URL for browser access via nginx proxy
      // Each environment (dev/production) has its own /storage/ proxy to port 8091
      const actualUrl = `/storage/${actualPath}`;

      return {
        success: true,
        filename: actualFilename,
        path: actualPath,
        url: actualUrl,
        size: result.size || (file instanceof Buffer ? file.length : 0),
      };
    } catch (error) {
      log.error('VF Storage upload error:', { data: error });
      throw error;
    }
  }

  /**
   * List files in a directory
   * @param type - Storage type
   * @param category - Category within type
   */
  async listFiles(type: string, category: string): Promise<VFStorageFile[]> {
    try {
      const url = `${this.baseUrl}/list/${type}/${category}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`List failed: ${response.status}`);
      }

      const result = await response.json();
      return result.files || [];
    } catch (error) {
      log.error('VF Storage list error:', { data: error });
      return [];
    }
  }

  /**
   * Delete a file from VF Storage
   * @param type - Storage type
   * @param category - Category within type
   * @param filename - Name of file to delete
   */
  async deleteFile(
    type: string,
    category: string,
    filename: string
  ): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/delete/${type}/${category}/${filename}`;

      const response = await fetch(url, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }

      return true;
    } catch (error) {
      log.error('VF Storage delete error:', { data: error });
      return false;
    }
  }

  /**
   * Get the full URL for a stored file (public HTTPS URL via /storage/ proxy)
   */
  getFileUrl(type: string, category: string, filename: string): string {
    return `/storage/${type}/${category}/${filename}`;
  }
}

// Singleton instance
const vfStorage = new VFStorageService();

/**
 * Upload a staff document to VF Storage
 * @param staffId - Staff member ID
 * @param file - File to upload
 * @param fileName - Original filename
 * @param documentType - Type of document (e.g., 'id_document', 'contract')
 */
export async function uploadStaffDocument(
  staffId: string,
  file: Buffer | File | Blob,
  fileName: string,
  documentType: string
): Promise<VFStorageUploadResponse> {
  // Upload to staff/documents with staffId prefix in filename for organization
  const prefixedFileName = `${staffId}_${fileName}`;
  return vfStorage.uploadFile(
    file,
    'staff',
    'documents',
    prefixedFileName
  );
}

/**
 * Delete a staff document from VF Storage
 */
export async function deleteStaffDocument(
  staffId: string,
  filename: string
): Promise<boolean> {
  return vfStorage.deleteFile('staff', 'documents', filename);
}

/**
 * List staff documents for a staff member
 * Note: Lists all documents in staff/documents - filter by staffId prefix if needed
 */
export async function listStaffDocuments(
  staffId: string
): Promise<VFStorageFile[]> {
  const allFiles = await vfStorage.listFiles('staff', 'documents');
  // Filter by staffId prefix
  return allFiles.filter(f => f.name.startsWith(`${staffId}_`));
}

/**
 * Check if VF Storage server is available
 */
export async function isVFStorageAvailable(): Promise<boolean> {
  return vfStorage.checkHealth();
}

/**
 * Normalize a storage URL to ensure it uses the /storage/ proxy path
 * Handles legacy URLs that were stored without the /storage/ prefix
 *
 * @param url - The storage URL to normalize
 * @returns Normalized URL with /storage/ prefix, or original URL if not a VF storage URL
 */
export function normalizeStorageUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;

  // Only process URLs from our domains
  const vfDomains = ['vf.fibreflow.app', 'dev.fibreflow.app', 'app.fibreflow.app'];
  const isVFUrl = vfDomains.some(domain => url.includes(domain));

  if (!isVFUrl) return url;

  // If URL already has /storage/, it's correct
  if (url.includes('/storage/')) return url;

  // Check if this is a storage path (procurement, staff, fleet, etc.)
  const storagePaths = ['/procurement/', '/accounting/', '/staff/', '/fleet/', '/contractors/', '/assets/'];
  const needsStorage = storagePaths.some(path => url.includes(path));

  if (!needsStorage) return url;

  // Insert /storage/ before the storage path
  for (const path of storagePaths) {
    if (url.includes(path)) {
      return url.replace(path, `/storage${path}`);
    }
  }

  return url;
}

// Export the service and helpers
export { vfStorage };
export default VFStorageService;
