/**
 * WA Monitor Backend Service - Barrel Re-export
 *
 * All functions have been split into wa-monitor/ subdirectory.
 * This file re-exports everything for zero-import-change compatibility.
 */

// Fetch operations
export { getAllDrops, getPaginatedDrops, getDropById, getDropsByStatus } from './wa-monitor/fetchService';
export type { PaginatedDropsResult } from './wa-monitor/fetchService';

// Summary operations
export { calculateSummary, calculateSummaryFast, getCompleteProjectStats, getDailyDropsPerProject } from './wa-monitor/summaryService';

// Stats operations
export { getProjectStats, getAllProjectsStatsSummary, validateConnection } from './wa-monitor/statsService';
