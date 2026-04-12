/**
 * Procurement Seed Data - Main Module Index  
 * Centralized exports for all procurement seed data
 */

// Constants and utilities
export * from './constants';

// BOQ data
export * from './boqSeed';

// For backward compatibility - aggregate all seed data
export { SEED_BOQS, SEED_BOQ_ITEMS, SEED_BOQ_EXCEPTIONS } from './boqSeed';

// Re-export mock IDs for easy access
export { 
  MOCK_PROJECT_IDS, 
  MOCK_USER_IDS, 
  MOCK_SUPPLIER_IDS,
  MOCK_CATALOG_IDS,
  TIME_CONSTANTS 
} from './constants';

/**
 * Utility function to get all seed data for a specific project
 */
export async function getSeedDataForProject(projectId: string) {
  const { SEED_BOQS, SEED_BOQ_ITEMS, SEED_BOQ_EXCEPTIONS } = await import('./boqSeed');

  return {
    boqs: SEED_BOQS.filter((boq) => boq.projectId === projectId),
    boqItems: SEED_BOQ_ITEMS.filter((item) => item.projectId === projectId),
    boqExceptions: SEED_BOQ_EXCEPTIONS.filter((ex) => ex.projectId === projectId)
  };
}

/**
 * Utility function to get all mock IDs
 */
export async function getAllMockIds() {
  const { MOCK_PROJECT_IDS, MOCK_USER_IDS, MOCK_SUPPLIER_IDS, MOCK_CATALOG_IDS } = await import('./constants');
  
  return {
    projects: MOCK_PROJECT_IDS,
    users: MOCK_USER_IDS, 
    suppliers: MOCK_SUPPLIER_IDS,
    catalog: MOCK_CATALOG_IDS
  };
}