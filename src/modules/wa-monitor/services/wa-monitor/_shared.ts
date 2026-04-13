/**
 * Shared helpers for WA Monitor services
 * Private - not re-exported from barrel
 */

import { neon } from '@/lib/db-neon';
import type { QaReviewDrop } from '../../types/wa-monitor.types';

/**
 * Database connection - initialized lazily at runtime
 */
export function getDbConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

export interface QaReviewDbRow {
  id: string;
  dropNumber: string;
  reviewDate: string | Date;
  userName?: string;
  completedPhotos?: number;
  outstandingPhotos?: number;
  outstandingPhotosLoadedTo1map?: boolean;
  comment?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  project?: string | null;
  assignedAgent?: string | null;
  completed?: boolean;
  incomplete?: boolean;
  feedbackSent?: string | Date | null;
  senderPhone?: string | null;
  resubmitted?: boolean;
  lockedBy?: string | null;
  lockedAt?: string | Date | null;
  incorrectSteps?: string[];
  incorrectComments?: Record<string, string>;
  step_01_house_photo?: boolean;
  step_02_cable_from_pole?: boolean;
  step_03_cable_entry_outside?: boolean;
  step_04_cable_entry_inside?: boolean;
  step_05_wall_for_installation?: boolean;
  step_06_ont_back_after_install?: boolean;
  step_07_power_meter_reading?: boolean;
  step_08_ont_barcode?: boolean;
  step_09_ups_serial?: boolean;
  step_10_final_installation?: boolean;
  step_11_green_lights?: boolean;
  step_12_customer_signature?: boolean;
  ontSerialScanned?: string | null;
  upsSerialScanned?: string | null;
  ontConsumptionId?: string | null;
  upsConsumptionId?: string | null;
  scanGpsLat?: string | number | null;
  scanGpsLng?: string | number | null;
  onemapOntBarcode?: string | null;
  onemapOntActivationCode?: string | null;
  onemapUpsSerial?: string | null;
  onemapInstallerName?: string | null;
  onemapInstallationDate?: string | null;
}

/**
 * Transform database row to QaReviewDrop object
 * Handles date parsing and type conversion
 * Maps qa_photo_reviews table to QaReviewDrop interface
 * Status is calculated from the 12 QA checklist steps
 */
export function transformDbRowToDrop(row: QaReviewDbRow): QaReviewDrop {
  // Parse all 12 QA steps
  const step_01 = row.step_01_house_photo || false;
  const step_02 = row.step_02_cable_from_pole || false;
  const step_03 = row.step_03_cable_entry_outside || false;
  const step_04 = row.step_04_cable_entry_inside || false;
  const step_05 = row.step_05_wall_for_installation || false;
  const step_06 = row.step_06_ont_back_after_install || false;
  const step_07 = row.step_07_power_meter_reading || false;
  const step_08 = row.step_08_ont_barcode || false;
  const step_09 = row.step_09_ups_serial || false;
  const step_10 = row.step_10_final_installation || false;
  const step_11 = row.step_11_green_lights || false;
  const step_12 = row.step_12_customer_signature || false;

  // Calculate status: Complete = ALL 12 steps are true
  const allStepsComplete = step_01 && step_02 && step_03 && step_04 && step_05 && step_06 &&
                           step_07 && step_08 && step_09 && step_10 && step_11 && step_12;

  const status: 'incomplete' | 'complete' = allStepsComplete ? 'complete' : 'incomplete';

  // Use database values for completed/incomplete (tracks if QA reviewed it)
  // Don't calculate from steps - that would make all unreviewed drops appear incomplete
  const completed = row.completed || false;
  const incomplete = row.incomplete || false;

  return {
    id: row.id,
    dropNumber: row.dropNumber,
    status,
    reviewDate: new Date(row.reviewDate),
    userName: row.userName || '',
    completedPhotos: row.completedPhotos || 0,
    outstandingPhotos: row.outstandingPhotos || 12,
    outstandingPhotosLoadedTo1map: row.outstandingPhotosLoadedTo1map || false,
    comment: row.comment || null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    project: row.project || null,
    assignedAgent: row.assignedAgent || null,
    completed,
    incomplete,
    feedbackSent: row.feedbackSent ? new Date(row.feedbackSent) : null,
    senderPhone: row.senderPhone || null,
    resubmitted: row.resubmitted || false,
    lockedBy: row.lockedBy || null,
    lockedAt: row.lockedAt ? new Date(row.lockedAt) : null,
    incorrectSteps: row.incorrectSteps || [],
    incorrectComments: row.incorrectComments || {},
    // QA Steps (12 steps from WA Monitor)
    step_01_house_photo: step_01,
    step_02_cable_from_pole: step_02,
    step_03_cable_entry_outside: step_03,
    step_04_cable_entry_inside: step_04,
    step_05_wall_for_installation: step_05,
    step_06_ont_back_after_install: step_06,
    step_07_power_meter_reading: step_07,
    step_08_ont_barcode: step_08,
    step_09_ups_serial: step_09,
    step_10_final_installation: step_10,
    step_11_green_lights: step_11,
    step_12_customer_signature: step_12,
    // Serial scanning fields (Stage 3 - Stock Tracking)
    ontSerialScanned: row.ontSerialScanned || null,
    upsSerialScanned: row.upsSerialScanned || null,
    ontConsumptionId: row.ontConsumptionId || null,
    upsConsumptionId: row.upsConsumptionId || null,
    scanGpsLat: row.scanGpsLat != null ? parseFloat(String(row.scanGpsLat)) : null,
    scanGpsLng: row.scanGpsLng != null ? parseFloat(String(row.scanGpsLng)) : null,
    // OneMap serial data (fetched from 1Map by drop_number)
    onemapOntBarcode: row.onemapOntBarcode || null,
    onemapOntActivationCode: row.onemapOntActivationCode || null,
    onemapUpsSerial: row.onemapUpsSerial || null,
    onemapInstallerName: row.onemapInstallerName || null,
    onemapInstallationDate: row.onemapInstallationDate || null,
  };
}
