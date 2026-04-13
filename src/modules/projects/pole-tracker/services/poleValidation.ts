import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';

export class PoleValidationService {
  /**
   * Check if a pole number is globally unique
   */
  async isPoleNumberUnique(poleNumber: string, excludeId?: string): Promise<boolean> {
    const polesRef = collection(db, 'poles');
    const q = query(polesRef, where('poleNumber', '==', poleNumber));
    const snapshot = await getDocs(q);
    
    if (excludeId) {
      return snapshot.docs.every((doc: { id: string }) => doc.id === excludeId);
    }
    
    return snapshot.empty;
  }

  /**
   * Validate drop count doesn't exceed maximum
   */
  validateDropCount(currentDrops: number, maxDrops: number = 12): boolean {
    return currentDrops <= maxDrops;
  }

  /**
   * Validate required photos are present
   */
  validatePhotos(photos: Record<string, string | null>): {
    isValid: boolean;
    missingPhotos: string[];
  } {
    const requiredPhotos = [
      'beforeInstallation',
      'duringInstallation', 
      'afterInstallation',
      'poleLabel',
      'cableRouting',
      'qualityCheck'
    ];

    const missingPhotos = requiredPhotos.filter(
      photo => !photos[photo]
    );

    return {
      isValid: missingPhotos.length === 0,
      missingPhotos
    };
  }

  /**
   * Validate quality checks completion
   */
  validateQualityChecks(checks: Record<string, boolean | null>): {
    isValid: boolean;
    failedChecks: string[];
    pendingChecks: string[];
  } {
    const failedChecks: string[] = [];
    const pendingChecks: string[] = [];

    Object.entries(checks).forEach(([check, value]) => {
      if (value === false) {
        failedChecks.push(check);
      } else if (value === null) {
        pendingChecks.push(check);
      }
    });

    return {
      isValid: failedChecks.length === 0 && pendingChecks.length === 0,
      failedChecks,
      pendingChecks
    };
  }

  /**
   * Validate pole data completeness
   */
  validatePoleData(data: { poleNumber?: unknown; location?: unknown; projectId?: unknown; dropCount?: number | null; coordinates?: { lat?: unknown; lng?: unknown } | null }): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!data.poleNumber) {
      errors.push('Pole number is required');
    }

    if (!data.location) {
      errors.push('Location is required');
    }

    if (!data.projectId) {
      errors.push('Project ID is required');
    }

    if (data.dropCount && data.dropCount > 12) {
      errors.push('Drop count cannot exceed 12');
    }

    if (data.coordinates) {
      if (!data.coordinates.lat || !data.coordinates.lng) {
        errors.push('Invalid coordinates');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export const poleValidationService = new PoleValidationService();