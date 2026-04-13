/**
 * Pole Tracker Service Types
 * Core type definitions for pole tracking
 */

export interface PoleCoordinates {
  lat: number;
  lng: number;
}

export interface PolePhotos {
  beforeInstallation: string | null;
  duringInstallation: string | null;
  afterInstallation: string | null;
  poleLabel: string | null;
  cableRouting: string | null;
  qualityCheck: string | null;
}

export interface PoleQualityChecks {
  poleCondition: boolean | null;
  cableRouting: boolean | null;
  connectorQuality: boolean | null;
  labelingCorrect: boolean | null;
  groundingProper: boolean | null;
  heightCompliant: boolean | null;
  tensionCorrect: boolean | null;
  documentationComplete: boolean | null;
}

export interface PoleStatusHistory {
  status: string;
  timestamp: Date;
  changedBy: string;
  notes?: string;
  previousStatus?: string;
}

export interface PoleMetadata {
  createdAt?: Date | string;
  updatedAt?: Date | string;
  createdBy?: string;
  syncStatus?: 'synced' | 'pending' | 'error';
  lastSyncAttempt?: Date;
}

export type PoleStatus = 'pending' | 'in_progress' | 'completed' | 'issue';

export interface Pole {
  id?: string;
  poleNumber: string;
  projectId: string;
  projectCode: string;
  location: string;
  coordinates?: PoleCoordinates;
  phase: string;
  status: PoleStatus;
  dropCount: number;
  maxDrops: number;
  installationDate?: Date | null;
  photos: PolePhotos;
  qualityChecks: PoleQualityChecks;
  statusHistory?: PoleStatusHistory[];
  metadata: PoleMetadata;
}

export interface PoleFilters {
  status?: string;
  phase?: string;
  search?: string;
}

export const POLE_COLLECTION = 'poles';
export const DEFAULT_MAX_DROPS = 12;