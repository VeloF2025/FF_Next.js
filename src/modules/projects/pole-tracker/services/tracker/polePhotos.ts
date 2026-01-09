/**
 * Pole Photos Management Service
 * Handles photo management for poles
 *
 * NOTE: Firebase Firestore has been removed. This service now uses API endpoints.
 */

import { PolePhotos } from './types';
import { log } from '@/lib/logger';

export class PolePhotosService {
  /**
   * Update pole photos via API
   */
  static async updatePhotos(
    id: string,
    photos: Partial<PolePhotos>
  ): Promise<void> {
    // Update each photo type via API
    for (const [photoType, photoUrl] of Object.entries(photos)) {
      if (photoUrl !== undefined) {
        try {
          const response = await fetch('/api/pole-photos-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              poleId: id,
              photoType: this.mapPhotoTypeToColumn(photoType as keyof PolePhotos),
              photoUrl,
            }),
          });

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'Failed to update photo');
          }
        } catch (error) {
          log.error(`Error updating photo ${photoType}:`, { data: error }, 'polePhotos');
          throw error;
        }
      }
    }
  }

  /**
   * Map photo type to database column name
   */
  private static mapPhotoTypeToColumn(photoType: keyof PolePhotos): string {
    const mapping: Record<keyof PolePhotos, string> = {
      beforeInstallation: 'before',
      duringInstallation: 'during',
      afterInstallation: 'after',
      poleLabel: 'label',
      cableRouting: 'cable_routing',
      qualityCheck: 'quality_check',
    };
    return mapping[photoType] || photoType;
  }

  /**
   * Add a single photo
   */
  static async addPhoto(
    id: string,
    photoType: keyof PolePhotos,
    photoUrl: string
  ): Promise<void> {
    await this.updatePhotos(id, { [photoType]: photoUrl });
  }

  /**
   * Remove a photo
   */
  static async removePhoto(
    id: string,
    photoType: keyof PolePhotos
  ): Promise<void> {
    try {
      const response = await fetch('/api/pole-photos-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poleId: id,
          photoType: this.mapPhotoTypeToColumn(photoType),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete photo');
      }
    } catch (error) {
      log.error(`Error removing photo ${photoType}:`, { data: error }, 'polePhotos');
      throw error;
    }
  }

  /**
   * Get all photos for a pole
   * Note: This would typically fetch from the poles API
   */
  static async getPhotos(id: string): Promise<PolePhotos> {
    try {
      const response = await fetch(`/api/poles/${id}`);
      if (!response.ok) {
        throw new Error('Pole not found');
      }
      const pole = await response.json();
      return {
        beforeInstallation: pole.photo_before || null,
        duringInstallation: pole.photo_during || null,
        afterInstallation: pole.photo_after || null,
        poleLabel: pole.photo_label || null,
        cableRouting: pole.photo_cable_routing || null,
        qualityCheck: pole.photo_quality_check || null,
      };
    } catch (error) {
      log.error(`Error fetching photos for pole ${id}:`, { data: error }, 'polePhotos');
      return this.getEmptyPhotos();
    }
  }

  /**
   * Check if all required photos are uploaded
   */
  static async hasAllRequiredPhotos(id: string): Promise<boolean> {
    const photos = await this.getPhotos(id);
    const requiredPhotos: (keyof PolePhotos)[] = [
      'beforeInstallation',
      'afterInstallation',
      'poleLabel'
    ];

    return requiredPhotos.every(photoType => photos[photoType] !== null);
  }

  /**
   * Get photo upload progress
   */
  static async getPhotoProgress(id: string): Promise<{
    uploaded: number;
    total: number;
    percentage: number;
  }> {
    const photos = await this.getPhotos(id);
    const photoValues = Object.values(photos);
    const uploaded = photoValues.filter(photo => photo !== null).length;
    const total = photoValues.length;

    return {
      uploaded,
      total,
      percentage: Math.round((uploaded / total) * 100)
    };
  }

  /**
   * Get empty photos object
   */
  private static getEmptyPhotos(): PolePhotos {
    return {
      beforeInstallation: null,
      duringInstallation: null,
      afterInstallation: null,
      poleLabel: null,
      cableRouting: null,
      qualityCheck: null
    };
  }
}
