/**
 * Import Types
 * Types for data import and batch processing
 */

import { Timestamp } from 'firebase/firestore';
import { TrackerType } from './base.types';

export interface ImportBatch {
  id?: string;
  projectId: string;
  projectName: string;
  importType: 'initial' | 'update' | 'additional';
  fileName: string;
  fileSize: number;
  
  // Statistics
  totalRecords: number;
  polesCount: number;
  dropsCount: number;
  fiberCount: number;
  successCount: number;
  errorCount: number;
  
  // Status
  status: 'pending' | 'processing' | 'completed' | 'failed';
  errors?: ImportError[];
  
  // Audit
  importedAt: Timestamp | Date;
  importedBy: string;
  importedByName?: string;
  processingTime?: number; // milliseconds
}

export interface ImportError {
  row: number;
  type: TrackerType;
  identifier: string;
  error: string;
  data?: Record<string, unknown>;
}