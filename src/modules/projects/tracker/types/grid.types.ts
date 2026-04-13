/**
 * Grid Display Types
 * Types for tracker grid display and data presentation
 */

import { TrackerType } from './base.types';

export interface TrackerGridItem {
  id: string;
  type: TrackerType;
  identifier: string; // poleNumber, dropNumber, or sectionId
  vfId: string; // VF generated ID
  projectName: string;
  location: string;
  status: string;
  progress: number;
  contractorName?: string;
  teamName?: string;
  plannedDate?: Date;
  completedDate?: Date;
  qualityStatus?: string;
  hasPhotos: boolean;
  
  // Additional fields
  phase?: string;
  photos?: number;
  totalPhotos?: number;
  qualityChecks?: number;
  totalChecks?: number;
  lastUpdated?: Date;
  updated?: Date;
  metadata?: {
    importSource?: string;
    importDate?: Date;
    [key: string]: unknown;
  };
  
  // Type-specific fields
  dropCount?: number; // For poles
  maxCapacity?: number; // For poles
  customerName?: string; // For drops
  cableLength?: number; // For drops and fiber
  coreCount?: number; // For fiber
}

// Legacy type alias
export type TrackerItem = TrackerGridItem;