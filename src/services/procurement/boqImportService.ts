/**
 * BOQ Import Service - Legacy Compatibility Layer
 * 
 * This file now imports from modular BOQ import system for better maintainability.
 * New code should import directly from ./import/ directory.
 */

// Re-exports the four symbols this layer's consumers actually use, rather than
// the whole ./import barrel.
//
// `export * from './import'` pulled BOQImportEnhanced, MaterialMatcher and
// CategoryMapper in behind it, each of which opens its own database
// connection. Every consumer of this file is a client component under
// src/components/procurement/boq/, so the barrel put the @neondatabase driver
// into the /procurement/boq/new browser bundle — verified in .next/static
// before this change, absent after.
//
// Verified against all eight consumers (BOQUpload, BOQDashboard, BOQDataLoader,
// BOQOverview, BOQUploadConfig, BOQUploadProgress, BOQImportStatistics,
// BOQActiveImportJobs): between them they reference only these four names.
// Anything needing the rest should import from './import' directly, as the
// note above says.
export { BOQImportService } from './import/boqImportService';
export type { ImportJob, ImportStats, ImportConfig } from './import/boqImportService';
