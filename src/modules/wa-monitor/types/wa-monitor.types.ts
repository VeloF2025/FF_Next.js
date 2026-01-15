/**
 * WA Monitor Types
 * Type definitions for WhatsApp QA drop monitoring system
 * Created: Jan 6, 2025
 */

// ==================== ENUMS ====================

/**
 * Drop status - QA review completion status
 */
export type DropStatus = 'incomplete' | 'complete';

// ==================== CORE INTERFACES ====================

/**
 * QA Steps - 12 required steps for installation QA (WA Monitor schema)
 * Each step represents a photo/verification requirement
 * Maps to qa_photo_reviews table in Neon PostgreSQL
 */
export interface QaSteps {
  step_01_house_photo: boolean;
  step_02_cable_from_pole: boolean;
  step_03_cable_entry_outside: boolean;
  step_04_cable_entry_inside: boolean;
  step_05_wall_for_installation: boolean;
  step_06_ont_back_after_install: boolean;
  step_07_power_meter_reading: boolean;
  step_08_ont_barcode: boolean;
  step_09_ups_serial: boolean;
  step_10_final_installation: boolean;
  step_11_green_lights: boolean;
  step_12_customer_signature: boolean;
}

/**
 * QA Step Labels - Human-readable names for each database column
 * NOTE: Database columns (step_01, step_02...) do NOT match display order!
 * Use ORDERED_STEP_KEYS for correct display order
 */
export const QA_STEP_LABELS: Record<keyof QaSteps, string> = {
  step_01_house_photo: 'Property Photo',
  step_02_cable_from_pole: 'Cable from Pole',
  step_03_cable_entry_outside: 'Cable Entry Outside',
  step_04_cable_entry_inside: 'Cable Entry Inside',
  step_05_wall_for_installation: 'Location on Wall',
  step_06_ont_back_after_install: 'Fibre Entry to ONT',
  step_07_power_meter_reading: 'Powermeter at ONT',
  step_08_ont_barcode: 'ONT Barcode',
  step_09_ups_serial: 'UPS Serial number',
  step_10_final_installation: 'Overall Work area - final installation',
  step_11_green_lights: 'Green Lights',
  step_12_customer_signature: 'Customer Signature',
};

/**
 * Ordered Step Keys - Defines the correct display order (1-12)
 * Use this array to iterate through steps in the correct order
 */
export const ORDERED_STEP_KEYS: Array<keyof QaSteps> = [
  'step_01_house_photo',           // 1. Property Photo
  'step_05_wall_for_installation', // 2. Location on Wall
  'step_02_cable_from_pole',       // 3. Cable from Pole
  'step_03_cable_entry_outside',   // 4. Cable Entry Outside
  'step_04_cable_entry_inside',    // 5. Cable Entry Inside
  'step_06_ont_back_after_install', // 6. Fibre Entry to ONT
  'step_10_final_installation',    // 7. Overall Work area
  'step_08_ont_barcode',           // 8. ONT Barcode
  'step_09_ups_serial',            // 9. UPS Serial number
  'step_07_power_meter_reading',   // 10. Powermeter at ONT
  'step_11_green_lights',          // 11. Green Lights
  'step_12_customer_signature',    // 12. Customer Signature
];

/**
 * QA Review Drop - Main data structure
 * Maps to qa_photo_reviews table in Neon PostgreSQL (WA Monitor)
 */
export interface QaReviewDrop extends QaSteps {
  id: string;
  dropNumber: string;
  status: DropStatus;
  reviewDate: Date;
  userName: string;
  completedPhotos: number;
  outstandingPhotos: number;
  outstandingPhotosLoadedTo1map: boolean;
  comment: string | null;
  createdAt: Date;
  updatedAt: Date;
  project: string | null;
  assignedAgent: string | null;
  completed: boolean;
  incomplete: boolean;
  feedbackSent: Date | null;
  senderPhone: string | null;
  resubmitted: boolean;
  lockedBy: string | null;
  lockedAt: Date | null;
  incorrectSteps: string[];
  incorrectComments: Record<string, string>;
  // Serial scanning fields (Stage 3 of Stock Tracking)
  ontSerialScanned: string | null;
  upsSerialScanned: string | null;
  ontConsumptionId: string | null;
  upsConsumptionId: string | null;
  scanGpsLat: number | null;
  scanGpsLng: number | null;
  // OneMap serial data (fetched from 1Map by drop_number)
  onemapOntBarcode: string | null;
  onemapOntActivationCode: string | null;
  onemapUpsSerial: string | null;
  onemapInstallerName: string | null;
  onemapInstallationDate: string | null;
}

/**
 * API Response for drop list
 */
export interface WaMonitorApiResponse {
  success: boolean;
  data: QaReviewDrop[];
  summary?: WaMonitorSummary;
  meta?: {
    timestamp: string;
  };
}

/**
 * Summary statistics for dashboard
 */
export interface WaMonitorSummary {
  total: number;
  incomplete: number;
  complete: number;
  averageFeedbackCount: number;
  totalFeedback: number;
  dailyStats?: Array<{
    project: string;
    date: string;
    total: number;
    complete: number;
    incomplete: number;
  }>;
}

/**
 * Daily drops per project
 */
export interface DailyDropsPerProject {
  date: string;
  project: string;
  count: number;
}

/**
 * Daily drops API response
 */
export interface DailyDropsResponse {
  success: boolean;
  data: {
    drops: DailyDropsPerProject[];
    total: number;
    date: string;
  };
  meta?: {
    timestamp: string;
  };
}

// ==================== FILTER & SORT ====================

/**
 * Filter options for WA Monitor dashboard
 */
export interface WaMonitorFilter {
  status?: DropStatus[];
  searchTerm?: string; // Search drop number
  dateRange?: {
    startDate: Date;
    endDate: Date;
  };
}

/**
 * Sort configuration
 */
export interface WaMonitorSort {
  field: keyof QaReviewDrop;
  order: 'asc' | 'desc';
}

// ==================== DISPLAY CONFIG ====================

/**
 * Drop status display configuration
 */
export const DROP_STATUS_CONFIG = {
  incomplete: {
    label: 'Incomplete',
    color: 'red',
    bgColor: 'bg-red-100',
    textColor: 'text-red-800',
    borderColor: 'border-red-300',
    emoji: '🔴',
    description: 'QA review not yet complete',
  },
  complete: {
    label: 'Complete',
    color: 'green',
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-300',
    emoji: '🟢',
    description: 'QA review completed',
  },
} as const;

// ==================== VALIDATION ====================

/**
 * Check if a value is a valid drop status
 */
export function isValidDropStatus(value: any): value is DropStatus {
  return value === 'incomplete' || value === 'complete';
}

/**
 * Validate drop number format (DR########)
 */
export function isValidDropNumber(dropNumber: string): boolean {
  return /^DR\d{8}$/.test(dropNumber);
}
