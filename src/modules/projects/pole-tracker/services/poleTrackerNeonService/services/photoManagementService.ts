/**
 * Photo Management Service
 * Handles pole photo uploads via local storage API
 *
 * NOTE: Firebase Storage has been removed. This service now uses local file storage.
 */

import type { PhotoType } from '../types/pole.types';
import { log } from '@/lib/logger';

export class PhotoManagementService {
  /**
   * Upload photo to local storage via API and update pole record
   */
  async uploadPolePhoto(
    poleId: number,
    photoType: PhotoType,
    file: File,
    projectId?: string
  ): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('poleId', poleId.toString());
    formData.append('photoType', photoType);
    if (projectId) {
      formData.append('projectId', projectId);
    }

    const response = await fetch('/api/pole-photos-upload', {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();

    if (!result.success) {
      throw new Error(result.error || 'Failed to upload photo');
    }

    return result.url;
  }

  /**
   * Delete photo from local storage and database
   */
  async deletePolePhoto(
    poleId: number,
    photoType: PhotoType,
    photoUrl: string
  ): Promise<void> {
    const response = await fetch('/api/pole-photos-delete', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        poleId,
        photoType,
        photoUrl,
      }),
    });

    const result = await response.json();

    if (!result.success) {
      log.warn('Failed to delete photo:', { data: result.error }, 'photoManagementService');
      throw new Error(result.error || 'Failed to delete photo');
    }
  }
}
