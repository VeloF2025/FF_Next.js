/**
 * Investigation Types
 * Types for GPS processing jobs and investigation reports
 */

import type { ClassifiedTrip } from './gps.types';

/**
 * GPS processing job status
 */
export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * GPS Processing Job
 */
export interface GPSJob {
  id: string;
  vehicleId: string;
  fileName: string;
  fileSize: number | null;
  fileUrl: string | null;
  status: JobStatus;
  progress: number; // 0-100
  errorMessage: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  totalGpsPoints: number | null;
  reportUrl: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: string | null;
}

/**
 * GPS Job with vehicle info
 */
export interface GPSJobWithVehicle extends GPSJob {
  vehicle: {
    registration: string;
    make: string | null;
    model: string | null;
  };
}

/**
 * Investigation Summary (aggregated metrics)
 */
export interface InvestigationSummary {
  id: string;
  jobId: string;

  // Trip counts
  totalTrips: number;
  authorizedTrips: number;
  unauthorizedTrips: number;

  // Distance
  totalKm: number;
  authorizedKm: number;
  unauthorizedKm: number;

  // Pattern counts
  weekendTrips: number;
  afterHoursTrips: number;
  nightTravelTrips: number;
  workHoursViolations: number;
  suspiciousPOIVisits: number;
  unauthorizedNights: number;
  consecutiveUnauthorizedNights: number;

  // Financial impact
  totalCost: number;
  authorizedCost: number;
  unauthorizedCost: number;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

/**
 * Detected pattern in trip data
 */
export interface DetectedPattern {
  type: PatternType;
  severity: PatternSeverity;
  description: string;
  count: number;
  trips: string[]; // Trip IDs
  totalKm: number;
  totalCost: number;
}

/**
 * Pattern types that can be detected
 */
export type PatternType =
  | 'WEEKEND_USAGE'
  | 'AFTER_HOURS'
  | 'NIGHT_TRAVEL'
  | 'SUSPICIOUS_POI'
  | 'WORK_HOURS_VIOLATION'
  | 'UNAUTHORIZED_OVERNIGHT'
  | 'CONSECUTIVE_UNAUTHORIZED_NIGHTS';

/**
 * Pattern severity levels
 */
export type PatternSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Full investigation result
 */
export interface InvestigationResult {
  job: GPSJob;
  summary: InvestigationSummary;
  trips: ClassifiedTrip[];
  patterns: DetectedPattern[];
}

/**
 * Report generation request
 */
export interface GenerateReportRequest {
  jobId: string;
  format: 'pdf' | 'csv';
}

/**
 * Report sections (matching sample PDF format)
 */
export interface ReportSections {
  coverPage: {
    vehicleRegistration: string;
    vehicleDescription: string;
    periodStart: string;
    periodEnd: string;
    generatedDate: string;
    classification: 'AUTHORIZED' | 'UNAUTHORIZED' | 'MIXED';
  };
  executiveSummary: {
    totalTrips: number;
    authorizedTrips: number;
    unauthorizedTrips: number;
    authorizedPercentage: number;
    unauthorizedPercentage: number;
    totalKm: number;
    unauthorizedKm: number;
  };
  poiAnalysis: {
    suspiciousLocations: Array<{
      name: string;
      category: string;
      visitCount: number;
      dates: string[];
      riskLevel: string;
    }>;
  };
  workHoursViolations: {
    violations: Array<{
      date: string;
      location: string;
      duration: string;
      details: string;
    }>;
  };
  overnightAnalysis: {
    unauthorizedNights: Array<{
      date: string;
      location: string;
      distanceFromAuthorized: number;
    }>;
    consecutiveNights: number;
  };
  nightTripAnalysis: {
    trips: Array<{
      date: string;
      time: string;
      startLocation: string;
      endLocation: string;
      distanceKm: number;
    }>;
  };
  financialImpact: {
    fuelRate: number;
    depreciationRate: number;
    totalCost: number;
    authorizedCost: number;
    unauthorizedCost: number;
  };
  recommendations: {
    immediate: string[];
    longTerm: string[];
  };
}

/**
 * Database row types
 */
export interface FleetGPSJobRow {
  id: string;
  vehicle_id: string;
  file_name: string;
  file_size: number | null;
  file_url: string | null;
  status: string;
  progress: number;
  error_message: string | null;
  period_start: string | null;
  period_end: string | null;
  total_gps_points: number | null;
  report_url: string | null;
  created_at: string;
  completed_at: string | null;
  created_by: string | null;
}

export interface FleetInvestigationSummaryRow {
  id: string;
  job_id: string;
  total_trips: number;
  authorized_trips: number;
  unauthorized_trips: number;
  total_km: string;
  authorized_km: string;
  unauthorized_km: string;
  weekend_trips: number;
  after_hours_trips: number;
  night_travel_trips: number;
  work_hours_violations: number;
  suspicious_poi_visits: number;
  unauthorized_nights: number;
  consecutive_unauthorized_nights: number;
  total_cost: string;
  authorized_cost: string;
  unauthorized_cost: string;
  created_at: string;
  updated_at: string;
}

/**
 * Convert database row to GPSJob
 */
export function rowToGPSJob(row: FleetGPSJobRow): GPSJob {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    fileName: row.file_name,
    fileSize: row.file_size,
    fileUrl: row.file_url,
    status: row.status as JobStatus,
    progress: row.progress,
    errorMessage: row.error_message,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    totalGpsPoints: row.total_gps_points,
    reportUrl: row.report_url,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    createdBy: row.created_by,
  };
}

/**
 * Convert database row to InvestigationSummary
 */
export function rowToInvestigationSummary(row: FleetInvestigationSummaryRow): InvestigationSummary {
  return {
    id: row.id,
    jobId: row.job_id,
    totalTrips: row.total_trips,
    authorizedTrips: row.authorized_trips,
    unauthorizedTrips: row.unauthorized_trips,
    totalKm: parseFloat(row.total_km),
    authorizedKm: parseFloat(row.authorized_km),
    unauthorizedKm: parseFloat(row.unauthorized_km),
    weekendTrips: row.weekend_trips,
    afterHoursTrips: row.after_hours_trips,
    nightTravelTrips: row.night_travel_trips,
    workHoursViolations: row.work_hours_violations,
    suspiciousPOIVisits: row.suspicious_poi_visits,
    unauthorizedNights: row.unauthorized_nights,
    consecutiveUnauthorizedNights: row.consecutive_unauthorized_nights,
    totalCost: parseFloat(row.total_cost),
    authorizedCost: parseFloat(row.authorized_cost),
    unauthorizedCost: parseFloat(row.unauthorized_cost),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
