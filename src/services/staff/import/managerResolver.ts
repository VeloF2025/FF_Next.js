import { log } from '@/lib/logger';

/**
 * Manager Resolver
 * Handles manager lookup and resolution for staff imports
 */

/**
 * Find manager UUID by name in existing staff
 */
export async function findManagerByName(managerName: string): Promise<string | null> {
  try {
    // Import staffNeonService directly to avoid circular dependency with staffService
    const { staffNeonService } = await import('../staffNeonService');
    
    // Get all existing staff to search for the manager
    const allStaff = await staffNeonService.getAll();
    
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
export function extractUniqueManagers(rows: any[]): Set<string> {
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
export function sortByManagerHierarchy(rows: any[], managerNames: Set<string>): any[] {
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