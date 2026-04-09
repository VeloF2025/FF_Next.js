import { 
  collection, 
  query, 
  where, 
  getDocs,
  Timestamp
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import { 
  PoleImportRow, 
  DropImportRow, 
  FiberImportRow,
  SOWImportSummary 
} from '../types/sowImport.types';
import { sowPoleImportService } from './sowPoleImport';
import { sowDropImportService } from './sowDropImport';
import { sowFiberImportService } from './sowFiberImport';
import { log } from '@/lib/logger';

export class SOWTrackerService {
  /**
   * Import all SOW data (poles, drops, fiber)
   */
  async importAll(
    projectId: string,
    projectCode: string,
    data: {
      poles: PoleImportRow[];
      drops: DropImportRow[];
      fiberSections: FiberImportRow[];
    }
  ): Promise<{
    poles: { success: number; failed: number; errors: string[] };
    drops: { success: number; failed: number; errors: string[] };
    fiber: { success: number; failed: number; errors: string[] };
  }> {
    // Import in order: poles first, then drops (which reference poles), then fiber
    const poleResults = await sowPoleImportService.importPoles(
      projectId,
      projectCode,
      data.poles
    );

    const dropResults = await sowDropImportService.importDrops(
      projectId,
      projectCode,
      data.drops
    );

    const fiberResults = await sowFiberImportService.importFiber(
      projectId,
      projectCode,
      data.fiberSections
    );

    return {
      poles: poleResults,
      drops: dropResults,
      fiber: fiberResults
    };
  }

  /**
   * Get import summary for a project
   */
  async getImportSummary(projectId: string): Promise<SOWImportSummary> {
    try {
      // Get poles count
      const polesQuery = query(
        collection(db, 'poles'),
        where('projectId', '==', projectId)
      );
      const polesSnapshot = await getDocs(polesQuery);

      // Get drops count
      const dropsQuery = query(
        collection(db, 'drops'),
        where('projectId', '==', projectId)
      );
      const dropsSnapshot = await getDocs(dropsQuery);

      // Get fiber sections count
      const fiberQuery = query(
        collection(db, 'fiberSections'),
        where('projectId', '==', projectId)
      );
      const fiberSnapshot = await getDocs(fiberQuery);

      return {
        totalPoles: polesSnapshot.size,
        totalDrops: dropsSnapshot.size,
        totalFiberSections: fiberSnapshot.size,
        importDate: Timestamp.now(),
        status: 'completed',
        errors: []
      };
    } catch (error) {
      log.error('Error getting import summary:', { data: error }, 'sowTrackerService');
      throw error;
    }
  }

  /**
   * Validate all import data before processing
   */
  async validateImportData(
    _projectId: string,
    poles: PoleImportRow[],
    drops: DropImportRow[],
    fiberSections: FiberImportRow[]
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Validate poles
    const poleValidation = sowPoleImportService.validatePoleData(poles);
    errors.push(...poleValidation.errors);

    // Get valid pole numbers for drop validation
    const validPoleNumbers = new Set(poles.map(p => p.poleNumber));

    // Validate drops
    const dropValidation = sowDropImportService.validateDropData(drops, validPoleNumbers);
    errors.push(...dropValidation.errors);

    // Validate fiber sections
    const fiberValidation = sowFiberImportService.validateFiberData(fiberSections);
    errors.push(...fiberValidation.errors);

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get import statistics for dashboard
   */
  async getImportStatistics(projectId: string): Promise<{
    totalImported: number;
    byType: { poles: number; drops: number; fiber: number };
    byStatus: Record<string, number>;
    lastImportDate: Date | null;
  }> {
    const summary = await this.getImportSummary(projectId);
    
    // Get status breakdown
    const statusCounts: Record<string, number> = {};
    
    // Count poles by status
    const polesQuery = query(
      collection(db, 'poles'),
      where('projectId', '==', projectId)
    );
    const polesSnapshot = await getDocs(polesQuery);
    polesSnapshot.forEach((doc: { data: () => Record<string, any> }) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const status = doc.data().status || 'pending';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    });

    return {
      totalImported: summary.totalPoles + summary.totalDrops + summary.totalFiberSections,
      byType: {
        poles: summary.totalPoles,
        drops: summary.totalDrops,
        fiber: summary.totalFiberSections
      },
      byStatus: statusCounts,
      lastImportDate: summary.importDate.toDate()
    };
  }
}

export const sowTrackerService = new SOWTrackerService();