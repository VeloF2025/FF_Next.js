/**
 * Pole Detail Types
 * Type definitions for pole tracker detail component
 */
import type React from 'react';

import { InstallationPhase, PoleType } from '../types/pole-tracker.types';

export interface PolePhoto {
  id: string;
  type: 'before' | 'front' | 'depth' | 'concrete' | 'completed' | 'compaction';
  url: string;
  description: string;
}

export interface QualityCheck {
  id: string;
  checkType: 'depth_compliance' | 'concrete_quality' | 'alignment' | 'grounding';
  status: 'pass' | 'pending' | 'fail';
  checkedBy: string;
  checkedAt: Date | null;
}

export interface GPSCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export interface PoleDetail {
  id: string;
  vfPoleId: string;
  poleNumber: string;
  projectName: string;
  projectCode: string;
  contractorName: string;
  status: string;
  installationPhase: InstallationPhase;
  location: string;
  dropCount: number;
  maxCapacity: number;
  dateInstalled: Date;
  hasPhotos: boolean;
  qualityStatus: 'pass' | 'pending' | 'fail';
  poleType: PoleType;
  poleHeight: number;
  installationDepth: number;
  gpsCoordinates: GPSCoordinates;
  workingTeam: string;
  ratePaid: number;
  estimatedCompletionDate: Date;
  actualCompletionDate: Date;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string;
  updatedByName: string;
  photos: PolePhoto[];
  qualityChecks: QualityCheck[];
}

export interface TabConfig {
  id: 'overview' | 'photos' | 'quality' | 'history';
  label: string;
  icon: React.ElementType;
}

export interface StatConfig {
  title: string;
  subtitle: string;
  value: string | number;
  subValue: string;
  icon: React.ElementType;
  color: string;
}