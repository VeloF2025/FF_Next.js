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
import { DropImportRow } from '../types/sowImport.types';
import { log } from '@/lib/logger';

export class SOWDropImportService {
  private readonly BATCH_SIZE = 500;

  /**
   * Import home drops from SOW data
   */
  async importDrops(
    projectId: string,
    projectCode: string,
    drops: DropImportRow[]
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const results = { success: 0, failed: 0, errors: [] as string[] };
    const batch = writeBatch(db);
    let batchCount = 0;

    try {
      // Check for existing drops
      const existingDropsQuery = query(
        collection(db, 'drops'),
        where('projectId', '==', projectId)
      );
      const existingDrops = await getDocs(existingDropsQuery);
      const existingDropNumbers = new Set(
        existingDrops.docs.map((doc: { data: () => Record<string, any> }) => doc.data().dropNumber) // eslint-disable-line @typescript-eslint/no-explicit-any
      );

      for (const drop of drops) {
        try {
          // Validate drop number uniqueness
          if (existingDropNumbers.has(drop.dropNumber)) {
            results.errors.push(`Drop ${drop.dropNumber} already exists`);
            results.failed++;
            continue;
          }

          const dropRef = doc(collection(db, 'drops'), crypto.randomUUID());
          const dropData = {
            projectId,
            projectCode,
            dropNumber: drop.dropNumber,
            poleNumber: drop.poleNumber,
            address: drop.address || '',
            coordinates: drop.coordinates ? {
              lat: drop.coordinates.lat,
              lng: drop.coordinates.lng
            } : null,
            homeOwner: drop.homeOwner || '',
            contactNumber: drop.contactNumber || '',
            phase: drop.phase || 'Phase 1',
            status: 'pending',
            installationType: drop.installationType || 'standard',
            cableLength: drop.cableLength || 0,
            installationDate: null,
            photos: {
              houseEntrance: null,
              cableRoute: null,
              termination: null,
              speedTest: null,
              completion: null,
              customerSignoff: null
            },
            qualityChecks: {
              cableIntegrity: null,
              connectorQuality: null,
              signalStrength: null,
              speedTestPassed: null,
              customerSatisfied: null,
              documentationComplete: null
            },
            notes: drop.notes || '',
            metadata: {
              importedAt: serverTimestamp(),
              importedFrom: 'SOW',
              lastUpdated: serverTimestamp(),
              createdBy: 'system',
              syncStatus: 'synced'
            }
          };

          batch.set(dropRef, dropData);
          batchCount++;
          results.success++;

          // Commit batch if size reached
          if (batchCount >= this.BATCH_SIZE) {
            await batch.commit();
            batchCount = 0;
          }
        } catch (error) {
          results.errors.push(`Failed to import drop ${drop.dropNumber}: ${error}`);
          results.failed++;
        }
      }

      // Commit remaining batch
      if (batchCount > 0) {
        await batch.commit();
      }

      return results;
    } catch (error) {
      log.error('Error importing drops:', { data: error }, 'sowDropImport');
      throw error;
    }
  }

  /**
   * Validate drop import data
   */
  validateDropData(
    drops: DropImportRow[],
    validPoleNumbers: Set<string>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const dropNumbers = new Set<string>();

    for (const drop of drops) {
      if (!drop.dropNumber) {
        errors.push('Drop missing drop number');
        continue;
      }
      if (dropNumbers.has(drop.dropNumber)) {
        errors.push(`Duplicate drop number: ${drop.dropNumber}`);
      }
      dropNumbers.add(drop.dropNumber);

      if (drop.poleNumber && !validPoleNumbers.has(drop.poleNumber)) {
        errors.push(`Drop ${drop.dropNumber} references non-existent pole: ${drop.poleNumber}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export const sowDropImportService = new SOWDropImportService();