/**
 * Activate Reporting Service - Barrel Re-export
 *
 * All reporting functions have been split into reporting/ subdirectory.
 * This file re-exports everything for zero-import-change compatibility.
 */

// Shared pool access
export { getPool } from './reporting/_shared';

// Daily counts with zone/PON breakdown
export { getDailyCountsWithBreakdown } from './reporting/dailyCountsService';

// Discrepancy report (WhatsApp vs OES)
export { getDiscrepancyReport } from './reporting/discrepancyService';

// Serial validation report
export { getSerialValidationReport } from './reporting/serialValidationService';

// User/Team attribution report
export { getUserTeamAttributionReport } from './reporting/userAttributionService';

// Trend analysis report
export { getTrendAnalysisReport } from './reporting/trendAnalysisService';

// Resubmission analysis report
export { getResubmissionReport } from './reporting/resubmissionService';

// QA workflow funnel report
export { getQAFunnelReport } from './reporting/qaFunnelService';

// Enhanced team performance report
export { getTeamPerformanceReport } from './reporting/teamPerformanceService';

// Offline devices report
export { getOfflineDevicesReport } from './reporting/offlineDevicesService';
