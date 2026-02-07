/**
 * Offline Submission Handler
 * Manages saving and syncing offline fuel transactions and check-ins
 */

import { v4 as uuidv4 } from 'uuid';
import {
  offlineStorage,
  PendingFuelTransaction,
  PendingCheckIn,
  PendingPhoto,
} from './offlineStorage';
import { captureGPS } from './gpsCapture';

export interface OfflineFuelSubmission {
  vehicleId: string;
  vehicleRegistration: string;
  transactionDate: string;
  amountRand: number;
  litres: number;
  pricePerLitre?: number;
  odometerReading?: number;
  stationName?: string;
  fuelLevelAfter?: number;
  driverName?: string;
  receiptPhoto?: {
    file: File;
    previewUrl: string;
  };
  odometerPhoto?: {
    file: File;
    previewUrl: string;
  };
}

export interface OfflineCheckInSubmission {
  vehicleId: string;
  vehicleRegistration: string;
  checkType: 'daily' | 'weekly';
  checkDate: string;
  driverName: string;
  odometerReading?: number;
  fuelLevel?: number;
  photos: Array<{
    type: string;
    file: File;
    previewUrl: string;
  }>;
  checklistResponses?: Record<string, unknown>;
}

export interface OfflineSubmitResult {
  success: boolean;
  id?: string;
  error?: string;
  isOffline: boolean;
}

/**
 * Convert File to Blob for IndexedDB storage
 */
async function fileToBlob(file: File): Promise<Blob> {
  return new Blob([await file.arrayBuffer()], { type: file.type });
}

/**
 * Save a fuel transaction offline
 */
export async function saveOfflineFuelTransaction(
  submission: OfflineFuelSubmission
): Promise<OfflineSubmitResult> {
  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Capture GPS
    const gpsResult = await captureGPS();

    // Create pending transaction record
    const transaction: PendingFuelTransaction = {
      id,
      vehicleId: submission.vehicleId,
      vehicleRegistration: submission.vehicleRegistration,
      transactionDate: submission.transactionDate,
      amountRand: submission.amountRand,
      litres: submission.litres,
      pricePerLitre: submission.pricePerLitre,
      odometerReading: submission.odometerReading,
      stationName: submission.stationName,
      fuelLevelAfter: submission.fuelLevelAfter,
      driverName: submission.driverName,
      gpsLat: gpsResult.coordinates?.latitude,
      gpsLng: gpsResult.coordinates?.longitude,
      captureTimestamp: now,
      createdAt: now,
      syncStatus: 'pending',
      syncAttempts: 0,
    };

    // Save photos if provided
    if (submission.receiptPhoto) {
      const receiptPhotoId = `${id}-receipt`;
      const photoRecord: PendingPhoto = {
        id: receiptPhotoId,
        parentId: id,
        parentType: 'fuel',
        photoType: 'receipt',
        blob: await fileToBlob(submission.receiptPhoto.file),
        mimeType: submission.receiptPhoto.file.type,
        fileName: submission.receiptPhoto.file.name,
        gpsLat: gpsResult.coordinates?.latitude,
        gpsLng: gpsResult.coordinates?.longitude,
        capturedAt: now,
        createdAt: now,
      };
      await offlineStorage.savePhoto(photoRecord);
      transaction.receiptPhotoId = receiptPhotoId;
    }

    if (submission.odometerPhoto) {
      const odoPhotoId = `${id}-odometer`;
      const photoRecord: PendingPhoto = {
        id: odoPhotoId,
        parentId: id,
        parentType: 'fuel',
        photoType: 'odometer',
        blob: await fileToBlob(submission.odometerPhoto.file),
        mimeType: submission.odometerPhoto.file.type,
        fileName: submission.odometerPhoto.file.name,
        gpsLat: gpsResult.coordinates?.latitude,
        gpsLng: gpsResult.coordinates?.longitude,
        capturedAt: now,
        createdAt: now,
      };
      await offlineStorage.savePhoto(photoRecord);
      transaction.odometerPhotoId = odoPhotoId;
    }

    // Save transaction
    await offlineStorage.saveFuelTransaction(transaction);

    console.log('[OfflineSubmit] Fuel transaction saved offline:', id);

    return {
      success: true,
      id,
      isOffline: true,
    };
  } catch (error) {
    console.error('[OfflineSubmit] Failed to save fuel transaction:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save offline',
      isOffline: true,
    };
  }
}

/**
 * Save a check-in offline
 */
export async function saveOfflineCheckIn(
  submission: OfflineCheckInSubmission
): Promise<OfflineSubmitResult> {
  try {
    const id = uuidv4();
    const now = new Date().toISOString();

    // Capture GPS
    const gpsResult = await captureGPS();

    const photoIds: string[] = [];

    // Save photos
    for (const photo of submission.photos) {
      const photoId = `${id}-${photo.type}-${uuidv4().slice(0, 8)}`;
      const photoRecord: PendingPhoto = {
        id: photoId,
        parentId: id,
        parentType: 'checkin',
        photoType: photo.type,
        blob: await fileToBlob(photo.file),
        mimeType: photo.file.type,
        fileName: photo.file.name,
        gpsLat: gpsResult.coordinates?.latitude,
        gpsLng: gpsResult.coordinates?.longitude,
        capturedAt: now,
        createdAt: now,
      };
      await offlineStorage.savePhoto(photoRecord);
      photoIds.push(photoId);
    }

    // Create pending check-in record
    const checkIn: PendingCheckIn = {
      id,
      vehicleId: submission.vehicleId,
      vehicleRegistration: submission.vehicleRegistration,
      checkType: submission.checkType,
      checkDate: submission.checkDate,
      driverName: submission.driverName,
      odometerReading: submission.odometerReading,
      fuelLevel: submission.fuelLevel,
      photoIds,
      checklistResponses: submission.checklistResponses,
      gpsLat: gpsResult.coordinates?.latitude,
      gpsLng: gpsResult.coordinates?.longitude,
      captureTimestamp: now,
      createdAt: now,
      syncStatus: 'pending',
      syncAttempts: 0,
    };

    // Save check-in
    await offlineStorage.saveCheckIn(checkIn);

    console.log('[OfflineSubmit] Check-in saved offline:', id);

    return {
      success: true,
      id,
      isOffline: true,
    };
  } catch (error) {
    console.error('[OfflineSubmit] Failed to save check-in:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to save offline',
      isOffline: true,
    };
  }
}

/**
 * Get pending items summary
 */
export async function getPendingSummary(): Promise<{
  fuelTransactions: number;
  checkIns: number;
  total: number;
}> {
  const [fuelTransactions, checkIns] = await Promise.all([
    offlineStorage.getAllPendingFuelTransactions(),
    offlineStorage.getAllPendingCheckIns(),
  ]);

  return {
    fuelTransactions: fuelTransactions.length,
    checkIns: checkIns.length,
    total: fuelTransactions.length + checkIns.length,
  };
}
