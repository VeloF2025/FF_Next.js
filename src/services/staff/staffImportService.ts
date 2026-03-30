/**
 * Staff Import Service - Legacy Compatibility Layer
 * This file maintains backward compatibility for existing imports
 * New code should import from './import' directly
 */

// Re-export everything from the modular structure
export * from './import';

// Default export for backward compatibility
export { staffImportService } from './import';