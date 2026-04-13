/**
 * Base Tracker Types
 * Core interfaces and enums for the tracker system
 */

import { Timestamp } from 'firebase/firestore';

export type TrackerType = 'pole' | 'drop' | 'fiber';

export interface BaseTracker {
  id?: string;
  projectId: string;
  projectCode: string;
  projectName?: string;
  type: TrackerType;
  
  // Import tracking
  importBatchId?: string;
  importSource?: 'Excel' | 'CSV' | 'Manual' | 'OneMap';
  importedAt?: Timestamp | Date;
  originalData?: Record<string, unknown>;
  
  // Status tracking
  status: string;
  statusHistory?: StatusHistoryEntry[];
  
  // Location
  location?: string;
  gpsCoordinates?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
  };
  
  // Assignment
  contractorId?: string;
  contractorName?: string;
  teamId?: string;
  teamName?: string;
  
  // Progress tracking
  plannedDate?: Date;
  startedDate?: Date;
  completedDate?: Date;
  progress: number; // 0-100
  
  // Quality & Validation
  qualityStatus?: 'pending' | 'pass' | 'fail' | 'na';
  qualityChecks?: QualityCheck[];
  photos?: TrackerPhoto[];
  
  // Audit
  createdAt: Timestamp | Date;
  createdBy: string;
  createdByName?: string;
  updatedAt: Timestamp | Date;
  updatedBy: string;
  updatedByName?: string;
}

export interface StatusHistoryEntry {
  status: string;
  changedAt: Timestamp | Date;
  changedBy: string;
  changedByName?: string;
  notes?: string;
  previousStatus?: string;
}

export interface QualityCheck {
  id: string;
  checkType: string;
  status: 'pass' | 'fail' | 'pending' | 'na';
  notes?: string;
  checkedBy: string;
  checkedByName?: string;
  checkedAt: Date;
  photos?: string[];
}

export interface TrackerPhoto {
  id: string;
  url: string;
  type: string;
  description?: string;
  timestamp: Date;
  gpsLocation?: {
    latitude: number;
    longitude: number;
  };
}