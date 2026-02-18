/**
 * Stock Management Enums - All enumeration types for stock/inventory
 */

// Stock Status enumeration matching database schema
export enum StockStatus {
  NORMAL = 'normal',
  LOW = 'low',
  CRITICAL = 'critical',
  EXCESS = 'excess',
  OBSOLETE = 'obsolete'
}

export type StockStatusType = 'normal' | 'low' | 'critical' | 'excess' | 'obsolete';

// Movement Type enumeration
export enum MovementType {
  ASN = 'ASN',           // Advanced Shipping Notice
  GRN = 'GRN',           // Goods Receipt Note
  ISSUE = 'ISSUE',       // Material Issue
  RETURN = 'RETURN',     // Material Return
  TRANSFER = 'TRANSFER', // Inter-project Transfer
  ADJUSTMENT = 'ADJUSTMENT' // Stock Adjustment
}

export type MovementTypeType = 'ASN' | 'GRN' | 'ISSUE' | 'RETURN' | 'TRANSFER' | 'ADJUSTMENT';

// Movement Status enumeration
export enum MovementStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export type MovementStatusType = 'pending' | 'confirmed' | 'completed' | 'cancelled';

// Item Status for movement items
export enum ItemStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  COMPLETED = 'completed',
  DAMAGED = 'damaged',
  REJECTED = 'rejected'
}

export type ItemStatusType = 'pending' | 'confirmed' | 'completed' | 'damaged' | 'rejected';

// Quality Check Status
export enum QualityCheckStatus {
  PENDING = 'pending',
  PASSED = 'passed',
  FAILED = 'failed',
  WAIVED = 'waived'
}

export type QualityCheckStatusType = 'pending' | 'passed' | 'failed' | 'waived';

// Drum Condition enumeration
export enum DrumCondition {
  GOOD = 'good',
  DAMAGED = 'damaged',
  RETURNABLE = 'returnable'
}

export type DrumConditionType = 'good' | 'damaged' | 'returnable';

// Installation Status for drums
export enum InstallationStatus {
  AVAILABLE = 'available',
  IN_USE = 'in_use',
  COMPLETED = 'completed',
  RETURNED = 'returned'
}

export type InstallationStatusType = 'available' | 'in_use' | 'completed' | 'returned';

// Installation Type
export type InstallationType = 'overhead' | 'underground' | 'building';

// Currency type
export type CurrencyType = 'USD' | 'EUR' | 'GBP' | 'ZAR';

// Unit of Measure (legacy compatibility)
export type UnitOfMeasure = string;

// ============= Serial Tracking Enums =============

// Serial item lifecycle status
export enum SerialStatus {
  AVAILABLE = 'available',
  RESERVED = 'reserved',
  ISSUED = 'issued',
  IN_TRANSIT = 'in_transit',
  INSTALLED = 'installed',
  FAULTY = 'faulty',
  RETURNED = 'returned',
  SCRAPPED = 'scrapped',
}

export type SerialStatusValue =
  | 'available'
  | 'reserved'
  | 'issued'
  | 'in_transit'
  | 'installed'
  | 'faulty'
  | 'returned'
  | 'scrapped';

// Storage bin / location type
export enum BinType {
  MAIN = 'main',
  DEPARTMENT = 'department',
  PROJECT = 'project',
  TECHNICIAN = 'technician',
  IN_TRANSIT = 'in_transit',
  FAULTY = 'faulty',
  QUARANTINE = 'quarantine',
}

export type BinTypeValue =
  | 'main'
  | 'department'
  | 'project'
  | 'technician'
  | 'in_transit'
  | 'faulty'
  | 'quarantine';