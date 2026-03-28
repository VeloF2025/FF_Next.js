/**
 * Tracker Types
 * Type definitions for the editable PON Tracker tab
 */

export interface TrackerRowData {
  id: string;
  zoneNo: number | null;
  hldPon: number | null;
  zPon: number | null;
  oltPort: string | null;
  scopePoles: number | null;
  scopeDrops: number | null;
  polePermission: string | null;
  polesPlanted: number | null;
  cwcPolesDate: string | null;
  cwcStringingDate: string | null;
  readyForOptical: string | null;
  cwcQaApproved: boolean;
  opticalSplicingDate: string | null;
  opticalSubmittedDate: string | null;
  opticalActivatedDate: string | null;
  atpQaApproved: boolean;
  signUps: number | null;
  homesPo: number | null;
  homesRecon: number | null;
  activated: number | null;
  available: number | null;
  blockage: string | null;
  isNew?: boolean;
}

export type TrackerRowValue = string | number | boolean | null;

export type NumericField =
  | 'zoneNo' | 'hldPon' | 'zPon' | 'scopePoles' | 'scopeDrops'
  | 'polesPlanted' | 'signUps' | 'homesPo' | 'homesRecon'
  | 'activated' | 'available';

export type DateField =
  | 'polePermission' | 'cwcPolesDate' | 'cwcStringingDate'
  | 'readyForOptical' | 'opticalSplicingDate'
  | 'opticalSubmittedDate' | 'opticalActivatedDate';

export type BoolField = 'cwcQaApproved' | 'atpQaApproved';
export type TextField = 'oltPort' | 'blockage';
