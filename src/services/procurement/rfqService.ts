/**
 * RFQ Service - Backward Compatibility Layer
 * @deprecated Use ./rfq/index.ts instead for improved modular RFQ management
 * 
 * This file provides backward compatibility for existing imports.
 * New code should use the modular RFQ system in ./rfq/
 */

// Re-export the main service and all modules from the new structure
// @ts-ignore
export { rfqService, RFQOperations, RFQLifecycle, RFQNotifications } from './rfq/index';