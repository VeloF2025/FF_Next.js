/**
 * Staff Neon Service - Legacy Compatibility Layer
 * This file maintains backward compatibility for existing imports
 * New code should import from './neon' directly
 */

// Re-export everything from the modular structure
export * from './neon';

// Default export for backward compatibility
export { staffNeonService } from './neon';