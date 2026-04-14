/**
 * Procurement Module Seed Data - Legacy Compatibility Layer
 * 
 * This file maintains backward compatibility while delegating to the new modular structure.
 * Previous file size: 850+ lines
 * Current file size: <100 lines
 * 
 * New modular structure:
 * - procurement/constants.ts: Mock IDs, constants, and common specifications
 * - procurement/boqSeed.ts: BOQ, BOQ Items, and BOQ Exceptions data
 * - procurement/index.ts: Centralized exports and utility functions
 * 
 * Note: Due to the large size of the original file, this has been split into the BOQ core data.
 * Additional modules (RFQ, Quote, Stock data) would be created as separate files when needed.
 */

// Re-export everything from the new modular structure
export * from './procurement';

// Maintain legacy exports for backward compatibility
export { 
  SEED_BOQS,
  SEED_BOQ_ITEMS, 
  SEED_BOQ_EXCEPTIONS,
  MOCK_PROJECT_IDS,
  MOCK_USER_IDS,
  MOCK_SUPPLIER_IDS,
  getSeedDataForProject,
  getAllMockIds
} from './procurement';

// Legacy type aliases and utilities
export type { BOQ, BOQItem, BOQException } from '@/types/procurement/boq.types';

/**
 * Legacy function to get all seed data (simplified version)
 * For full functionality, use the modular exports directly
 */
export async function getAllSeedData() {
  const { SEED_BOQS, SEED_BOQ_ITEMS, SEED_BOQ_EXCEPTIONS } = await import('./procurement');
  
  return {
    boqs: SEED_BOQS,
    boqItems: SEED_BOQ_ITEMS,
    boqExceptions: SEED_BOQ_EXCEPTIONS,
    // Additional data types would be imported here when implemented
    rfqs: [],
    quotes: [],
    stockPositions: [],
    stockMovements: []
  };
}

/**
 * Get test data for development environment
 */
export function getTestData() {
  return {
    ...getAllSeedData(),
    mockIds: [] // TODO: Implement getAllMockIds if needed
  };
}