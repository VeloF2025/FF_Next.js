/**
 * Storage Adapter - Unified File Storage Service
 *
 * Supports both VF Server storage and local file storage with automatic fallback.
 * Drop-in replacement for Firebase Storage with environment-based switching.
 *
 * Configuration:
 *   NEXT_PUBLIC_USE_VF_STORAGE=true  - Use VF Server storage (port 8091)
 *   NEXT_PUBLIC_USE_VF_STORAGE=false - Use local file storage (default)
 *   VF_STORAGE_URL - VF Server storage URL (default: http://100.96.203.105:8091)
 */

import { log } from '@/lib/logger';

// Configuration
const VF_STORAGE_URL = process.env.VF_STORAGE_URL || 'http://100.96.203.105:8091';
const USE_VF_STORAGE = process.env.NEXT_PUBLIC_USE_VF_STORAGE === 'true';

export interface StorageUploadResult {
  success: boolean;
  url: string;
  path: string;
  fileName: string;
  size?: number;
  source: 'vf-server' | 'local';
}

export interface StorageFile {
  name: string;
  url: string;
  size?: number;
  createdAt?: string;
}

/**
 * Storage Adapter - Unified interface for file storage
 */
export class StorageAdapter {
  /**
   * Upload a file to storage
   * @param file - File or Buffer to upload
   * @param type - Storage type (e.g., 'contractors', 'staff', 'tickets', 'poles')
   * @param category - Category/subfolder (e.g., 'documents', 'images')
   * @param fileName - Optional custom filename
   */
  static async uploadFile(
    file: File | Buffer,
    type: string,
    category: string,
    fileName?: string
  ): Promise<StorageUploadResult> {
    if (USE_VF_STORAGE) {
      try {
        return await this.uploadToVFServer(file, type, category, fileName);
      } catch (error) {
        log.warn('VF Server upload failed, falling back to local storage', { data: error }, 'storageAdapter');
        return await this.uploadToLocal(file, type, category, fileName);
      }
    }
    return await this.uploadToLocal(file, type, category, fileName);
  }

  /**
   * Upload to VF Server (port 8091)
   */
  private static async uploadToVFServer(
    file: File | Buffer,
    type: string,
    category: string,
    fileName?: string
  ): Promise<StorageUploadResult> {
    const formData = new FormData();

    if (file instanceof Buffer) {
      const blob = new Blob([file as unknown as BlobPart]);
      formData.append('file', blob, fileName || `file_${Date.now()}`);
    } else {
      formData.append('file', file as Blob, fileName || (file as File).name);
    }

    const response = await fetch(`${VF_STORAGE_URL}/upload/${type}/${category}`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`VF Server upload failed: ${response.statusText}`);
    }

    const result = await response.json();
    const actualFileName = result.filename || result.fileName;
    const path = `${type}/${category}/${actualFileName}`;

    // Always return public HTTPS URL for browser access
    // Public URLs need /storage/ prefix (nginx proxy routes /storage/ → port 8091)
    const url = `https://vf.fibreflow.app/storage/${path}`;

    return {
      success: true,
      url,
      path,
      fileName: actualFileName,
      size: result.size,
      source: 'vf-server',
    };
  }

  /**
   * Upload to local storage via Next.js API
   */
  private static async uploadToLocal(
    file: File | Buffer,
    type: string,
    category: string,
    fileName?: string
  ): Promise<StorageUploadResult> {
    const formData = new FormData();

    if (file instanceof Buffer) {
      const blob = new Blob([file as unknown as BlobPart]);
      formData.append('file', blob, fileName || `file_${Date.now()}`);
    } else {
      formData.append('file', file as Blob, fileName || (file as File).name);
    }

    formData.append('type', type);
    formData.append('category', category);

    const response = await fetch('/api/storage/upload', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || 'Local upload failed');
    }

    const result = await response.json();

    return {
      success: true,
      url: result.url,
      path: result.path,
      fileName: result.fileName,
      size: result.size,
      source: 'local',
    };
  }

  /**
   * Delete a file from storage
   */
  static async deleteFile(
    type: string,
    category: string,
    fileName: string
  ): Promise<boolean> {
    if (USE_VF_STORAGE) {
      try {
        return await this.deleteFromVFServer(type, category, fileName);
      } catch (error) {
        log.warn('VF Server delete failed, trying local storage', { data: error }, 'storageAdapter');
        return await this.deleteFromLocal(type, category, fileName);
      }
    }
    return await this.deleteFromLocal(type, category, fileName);
  }

  /**
   * Delete from VF Server
   */
  private static async deleteFromVFServer(
    type: string,
    category: string,
    fileName: string
  ): Promise<boolean> {
    const response = await fetch(
      `${VF_STORAGE_URL}/delete/${type}/${category}/${fileName}`,
      { method: 'DELETE' }
    );
    return response.ok;
  }

  /**
   * Delete from local storage
   */
  private static async deleteFromLocal(
    type: string,
    category: string,
    fileName: string
  ): Promise<boolean> {
    const response = await fetch('/api/storage/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, category, fileName }),
    });
    return response.ok;
  }

  /**
   * List files in a directory
   */
  static async listFiles(type: string, category: string): Promise<StorageFile[]> {
    if (USE_VF_STORAGE) {
      try {
        return await this.listFromVFServer(type, category);
      } catch (error) {
        log.warn('VF Server list failed, trying local storage', { data: error }, 'storageAdapter');
        return await this.listFromLocal(type, category);
      }
    }
    return await this.listFromLocal(type, category);
  }

  /**
   * List files from VF Server
   */
  private static async listFromVFServer(type: string, category: string): Promise<StorageFile[]> {
    const response = await fetch(`${VF_STORAGE_URL}/list/${type}/${category}`);
    if (!response.ok) {
      throw new Error('Failed to list files from VF Server');
    }
    const result = await response.json();
    return result.files || [];
  }

  /**
   * List files from local storage
   */
  private static async listFromLocal(type: string, category: string): Promise<StorageFile[]> {
    const response = await fetch(`/api/storage/list?type=${type}&category=${category}`);
    if (!response.ok) {
      return [];
    }
    const result = await response.json();
    return result.files || [];
  }

  /**
   * Get file URL (public HTTPS URL for browser access)
   */
  static getFileUrl(type: string, category: string, fileName: string): string {
    if (USE_VF_STORAGE) {
      // Return public HTTPS URL, not internal IP
      return `https://vf.fibreflow.app/${type}/${category}/${fileName}`;
    }
    return `/uploads/${type}/${category}/${fileName}`;
  }

  /**
   * Check storage health
   */
  static async checkHealth(): Promise<{ vfServer: boolean; local: boolean }> {
    const results = { vfServer: false, local: true };

    try {
      const response = await fetch(`${VF_STORAGE_URL}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      results.vfServer = response.ok;
    } catch {
      results.vfServer = false;
    }

    return results;
  }

  /**
   * Get current storage mode
   */
  static getStorageMode(): 'vf-server' | 'local' {
    return USE_VF_STORAGE ? 'vf-server' : 'local';
  }
}

// Export convenience functions
export const uploadFile = StorageAdapter.uploadFile.bind(StorageAdapter);
export const deleteFile = StorageAdapter.deleteFile.bind(StorageAdapter);
export const listFiles = StorageAdapter.listFiles.bind(StorageAdapter);
export const getFileUrl = StorageAdapter.getFileUrl.bind(StorageAdapter);
export const checkStorageHealth = StorageAdapter.checkHealth.bind(StorageAdapter);
