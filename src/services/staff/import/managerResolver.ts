import { log } from '@/lib/logger';
import { StaffImportRow } from '@/types/staff/import.types';

/**
 * Manager Resolver
 * Handles manager lookup and resolution for staff imports
 */

/**
 * Find manager UUID by name in existing staff
 */
export async function findManagerByName(managerName: string): Promise<string | null> {
  try {
    // Browser gets the HTTP service, server gets Neon.
    //
    // This used to import staffNeonService unconditionally. The staff import UI
    // (/staff/import -> StaffImportAdvanced -> useStaffImportAdvanced ->
    // staffImportService -> processImportRows -> here) runs in the BROWSER, so
    // every imported row carrying a manager name downloaded the 144KB Neon
    // driver and then failed: getSql() refuses to build a client in a browser,
    // and the catch below turned that into a silent `return null`. Manager
    // resolution has therefore been quietly failing on every UI-driven import.
    //
    // Still imported dynamically, and still not via staffService — that is the
    // circular dependency the original comment was avoiding.
    const staffService = typeof window !== 'undefined'
      ? (await import('../staffApiService')).staffApiService
      : (await import('../staffNeonService')).staffNeonService;

    // Get all existing staff to search for the manager
    const allStaff = await staffService.getAll();
    
    // Find manager by exact name match (case-insensitive)
    const manager = allStaff.find(staff => 
      staff.name.toLowerCase().trim() === managerName.toLowerCase().trim()
    );
    
    if (manager && manager.id) {
      return manager.id;
    }
    
    // Try partial name matching if exact match fails
    const partialMatch = allStaff.find(staff => 
      staff.name.toLowerCase().includes(managerName.toLowerCase().trim()) ||
      managerName.toLowerCase().includes(staff.name.toLowerCase().trim())
    );
    
    if (partialMatch && partialMatch.id) {

      return partialMatch.id;
    }
    
    return null;
  } catch (error) {
    log.error('Error looking up manager by name:', { data: error }, 'managerResolver');
    return null;
  }
}

/**
 * Get unique manager names from import rows
 */
export function extractUniqueManagers(rows: StaffImportRow[]): Set<string> {
  const managerNames = new Set<string>();
  
  rows.forEach(row => {
    if (row.managerName && row.managerName.trim()) {
      managerNames.add(row.managerName.trim());
    }
  });
  
  return managerNames;
}

/**
 * Sort rows to process managers first
 */
export function sortByManagerHierarchy(rows: StaffImportRow[], managerNames: Set<string>): StaffImportRow[] {
  return [...rows].sort((a, b) => {
    // If A is a manager and B is not, A comes first
    const aIsManager = managerNames.has(a.name?.trim() || '');
    const bIsManager = managerNames.has(b.name?.trim() || '');
    
    if (aIsManager && !bIsManager) return -1;
    if (!aIsManager && bIsManager) return 1;
    
    // If neither or both are managers, maintain original order
    return 0;
  });
}