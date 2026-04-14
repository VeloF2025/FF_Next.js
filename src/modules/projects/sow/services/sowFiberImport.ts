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
import { FiberImportRow } from '../types/sowImport.types';
import { log } from '@/lib/logger';

export class SOWFiberImportService {
  private readonly BATCH_SIZE = 500;

  /**
   * Import fiber sections from SOW data
   */
  async importFiber(
    projectId: string,
    projectCode: string,
    fiberSections: FiberImportRow[]
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const results = { success: 0, failed: 0, errors: [] as string[] };
    const batch = writeBatch(db);
    let batchCount = 0;

    try {
      // Check for existing fiber sections
      const existingFiberQuery = query(
        collection(db, 'fiberSections'),
        where('projectId', '==', projectId)
      );
      const existingFiber = await getDocs(existingFiberQuery);
      const existingSectionIds = new Set(
        existingFiber.docs.map((doc: { data: () => Record<string, any> }) => doc.data().sectionId) // eslint-disable-line @typescript-eslint/no-explicit-any
      );

      for (const fiber of fiberSections) {
        try {
          // Validate section ID uniqueness
          if (existingSectionIds.has(fiber.sectionId)) {
            results.errors.push(`Fiber section ${fiber.sectionId} already exists`);
            results.failed++;
            continue;
          }

          const fiberRef = doc(collection(db, 'fiberSections'), crypto.randomUUID());
          const fiberData = {
            projectId,
            projectCode,
            sectionId: fiber.sectionId,
            startPoint: fiber.startPoint || '',
            endPoint: fiber.endPoint || '',
            startCoordinates: fiber.startCoordinates ? {
              lat: fiber.startCoordinates.lat,
              lng: fiber.startCoordinates.lng
            } : null,
            endCoordinates: fiber.endCoordinates ? {
              lat: fiber.endCoordinates.lat,
              lng: fiber.endCoordinates.lng
            } : null,
            length: fiber.length || 0,
            cableType: fiber.cableType || '12-core',
            phase: fiber.phase || 'Phase 1',
            status: 'pending',
            installationMethod: fiber.installationMethod || 'aerial',
            stringingDate: null,
            splicingDate: null,
            testingDate: null,
            photos: {
              startPoint: null,
              endPoint: null,
              midSpan: null,
              splicing: null,
              testing: null,
              completion: null
            },
            testResults: {
              otdrTest: null,
              continuityTest: null,
              lossTest: null,
              reflectionTest: null
            },
            qualityChecks: {
              cableIntegrity: null,
              splicingQuality: null,
              tensionCorrect: null,
              sagCompliant: null,
              routingProper: null,
              documentationComplete: null
            },
            notes: fiber.notes || '',
            metadata: {
              importedAt: serverTimestamp(),
              importedFrom: 'SOW',
              lastUpdated: serverTimestamp(),
              createdBy: 'system',
              syncStatus: 'synced'
            }
          };

          batch.set(fiberRef, fiberData);
          batchCount++;
          results.success++;

          // Commit batch if size reached
          if (batchCount >= this.BATCH_SIZE) {
            await batch.commit();
            batchCount = 0;
          }
        } catch (error) {
          results.errors.push(`Failed to import fiber section ${fiber.sectionId}: ${error}`);
          results.failed++;
        }
      }

      // Commit remaining batch
      if (batchCount > 0) {
        await batch.commit();
      }

      return results;
    } catch (error) {
      log.error('Error importing fiber sections:', { data: error }, 'sowFiberImport');
      throw error;
    }
  }

  /**
   * Validate fiber import data
   */
  validateFiberData(fiberSections: FiberImportRow[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const sectionIds = new Set<string>();

    for (const fiber of fiberSections) {
      if (!fiber.sectionId) {
        errors.push('Fiber section missing section ID');
        continue;
      }
      if (sectionIds.has(fiber.sectionId)) {
        errors.push(`Duplicate fiber section ID: ${fiber.sectionId}`);
      }
      sectionIds.add(fiber.sectionId);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export const sowFiberImportService = new SOWFiberImportService();