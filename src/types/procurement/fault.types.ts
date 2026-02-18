/**
 * Fault Report Types - Equipment/material fault tracking for procurement
 * Tracks dead-on-arrival, field failures, physical damage, and configuration errors
 */

// ============= Enums =============

export enum FaultType {
  DEAD_ON_ARRIVAL = 'dead_on_arrival',
  FIELD_FAILURE = 'field_failure',
  PHYSICAL_DAMAGE = 'physical_damage',
  CONFIGURATION_ERROR = 'configuration_error',
  UNKNOWN = 'unknown',
}

export type FaultTypeValue =
  | 'dead_on_arrival'
  | 'field_failure'
  | 'physical_damage'
  | 'configuration_error'
  | 'unknown';

export enum FaultSeverity {
  MINOR = 'minor',
  MAJOR = 'major',
  CRITICAL = 'critical',
}

export type FaultSeverityValue = 'minor' | 'major' | 'critical';

export enum FaultResolutionStatus {
  OPEN = 'open',
  INVESTIGATING = 'investigating',
  CONFIRMED = 'confirmed',
  RESOLVED = 'resolved',
  WARRANTY_CLAIM = 'warranty_claim',
  SCRAPPED = 'scrapped',
}

export type FaultResolutionStatusValue =
  | 'open'
  | 'investigating'
  | 'confirmed'
  | 'resolved'
  | 'warranty_claim'
  | 'scrapped';

// ============= Core Interfaces =============

/** Full fault report record matching DB table columns (camelCase) */
export interface FaultReport {
  id: string;
  projectId: string;

  // Serial / Item Reference
  serialId?: string;
  stockItemId?: string;
  itemCode?: string;
  itemName?: string;
  serialNumber?: string;

  // Fault Details
  faultType: FaultTypeValue;
  severity: FaultSeverityValue;
  resolutionStatus: FaultResolutionStatusValue;
  description: string;
  rootCause?: string;

  // Context
  supplierId?: string;
  supplierName?: string;
  purchaseOrderId?: string;
  grnId?: string;
  batchNumber?: string;

  // Discovery
  discoveredBy: string;
  discoveredByName?: string;
  discoveredAt: Date;
  discoveredLocation?: string;

  // Resolution
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: Date;
  resolutionNotes?: string;

  // Warranty
  warrantyClaimRef?: string;
  warrantyClaimed: boolean;
  warrantyExpiresAt?: Date;

  // Evidence
  photoUrls?: string[];

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ============= Form / List Types =============

/** Data required to create a new fault report */
export interface FaultReportFormData {
  projectId: string;
  serialId?: string;
  stockItemId?: string;
  itemCode?: string;
  itemName?: string;
  serialNumber?: string;
  faultType: FaultTypeValue;
  severity: FaultSeverityValue;
  description: string;
  supplierId?: string;
  supplierName?: string;
  purchaseOrderId?: string;
  grnId?: string;
  batchNumber?: string;
  discoveredBy: string;
  discoveredAt: Date;
  discoveredLocation?: string;
  photoUrls?: string[];
}

/** Lightweight row for table display */
export interface FaultReportListItem {
  id: string;
  projectId: string;
  itemCode?: string;
  itemName?: string;
  serialNumber?: string;
  faultType: FaultTypeValue;
  severity: FaultSeverityValue;
  resolutionStatus: FaultResolutionStatusValue;
  description: string;
  supplierName?: string;
  discoveredByName?: string;
  discoveredAt: Date;
  resolvedAt?: Date;
  createdAt: Date;
}

// ============= Analytics =============

/** Aggregated fault analytics for dashboards */
export interface FaultAnalytics {
  faultsByType: Record<FaultTypeValue, number>;
  faultsBySupplier: Array<{ supplierId: string; supplierName: string; count: number }>;
  faultsByTechnician: Array<{ userId: string; userName: string; count: number }>;
  faultsByProject: Array<{ projectId: string; projectName: string; count: number }>;
  /** Mean time between failures in hours (null when insufficient data) */
  mtbf: number | null;
  totalOpen: number;
  totalResolved: number;
  totalWarrantyClaims: number;
}

/** Filter parameters for fault report queries */
export interface FaultReportFilter {
  projectId?: string;
  faultType?: FaultTypeValue;
  severity?: FaultSeverityValue;
  resolutionStatus?: FaultResolutionStatusValue;
  supplierId?: string;
  discoveredBy?: string;
  startDate?: Date;
  endDate?: Date;
  searchTerm?: string;
}
