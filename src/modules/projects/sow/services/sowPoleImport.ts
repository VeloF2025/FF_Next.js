import { 
  collection, 
  doc, 
  writeBatch, 
  query, 
  where, 
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { PoleImportRow } from '../types/sowImport.types';
import { log } from '@/lib/logger';

export class SOWPoleImportService {
  private readonly BATCH_SIZE = 500;

  /**
   * Import poles from SOW data
   */
  async importPoles(
    projectId: string,
    projectCode: string,
    poles: PoleImportRow[]
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const results = { success: 0, failed: 0, errors: [] as string[] };
    const batch = writeBatch(db);
    let batchCount = 0;

    try {
      // Check for existing poles
      const existingPolesQuery = query(
        collection(db, 'poles'),
        where('projectId', '==', projectId)
      );
      const existingPoles = await getDocs(existingPolesQuery);
      const existingPoleNumbers = new Set(
        existingPoles.docs.map((doc: { data: () => Record<string, any> }) => doc.data().poleNumber) // eslint-disable-line @typescript-eslint/no-explicit-any
      );

      for (const pole of poles) {
        try {
          // Validate pole number uniqueness
          if (existingPoleNumbers.has(pole.poleNumber)) {
            results.errors.push(`Pole ${pole.poleNumber} already exists`);
            results.failed++;
            continue;
          }

          const poleRef = doc(collection(db, 'poles'));
          const poleData = {
            projectId,
            projectCode,
            poleNumber: pole.poleNumber,
            location: pole.location || '',
            coordinates: pole.coordinates ? {
              lat: pole.coordinates.lat,
              lng: pole.coordinates.lng
            } : null,
            phase: pole.phase || 'Phase 1',
            status: 'pending',
            dropCount: pole.dropCount || 0,
            maxDrops: 12,
            installationDate: null,
            photos: {
              beforeInstallation: null,
              duringInstallation: null,
              afterInstallation: null,
              poleLabel: null,
              cableRouting: null,
              qualityCheck: null
            },
            qualityChecks: {
              poleCondition: null,
              cableRouting: null,
              connectorQuality: null,
              labelingCorrect: null,
              groundingProper: null,
              heightCompliant: null,
              tensionCorrect: null,
              documentationComplete: null
            },
            metadata: {
              importedAt: serverTimestamp(),
              importedFrom: 'SOW',
              lastUpdated: serverTimestamp(),
              createdBy: 'system',
              syncStatus: 'synced'
            }
          };

          batch.set(poleRef, poleData);
          batchCount++;
          results.success++;

          // Commit batch if size reached
          if (batchCount >= this.BATCH_SIZE) {
            await batch.commit();
            batchCount = 0;
          }
        } catch (error) {
          results.errors.push(`Failed to import pole ${pole.poleNumber}: ${error}`);
          results.failed++;
        }
      }

      // Commit remaining batch
      if (batchCount > 0) {
        await batch.commit();
      }

      return results;
    } catch (error) {
      log.error('Error importing poles:', { data: error }, 'sowPoleImport');
      throw error;
    }
  }

  /**
   * Validate pole import data
   */
  validatePoleData(poles: PoleImportRow[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const poleNumbers = new Set<string>();

    for (const pole of poles) {
      if (!pole.poleNumber) {
        errors.push('Pole missing pole number');
        continue;
      }
      if (poleNumbers.has(pole.poleNumber)) {
        errors.push(`Duplicate pole number: ${pole.poleNumber}`);
      }
      poleNumbers.add(pole.poleNumber);

      if (pole.dropCount && pole.dropCount > 12) {
        errors.push(`Pole ${pole.poleNumber} exceeds maximum drop count of 12`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export const sowPoleImportService = new SOWPoleImportService();