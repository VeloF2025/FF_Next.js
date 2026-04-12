/**
 * Neon SOW Display Types and Interfaces
 */

import type { LucideIcon } from 'lucide-react';

export interface NeonSOWDisplayProps {
  projectId: string;
}

export type NeonTabType = 'summary' | 'poles' | 'drops' | 'fibre';

export interface TabConfig {
  id: string;
  label: string;
  icon: LucideIcon;
}

export interface SOWPoleRecord {
  id?: string | number;
  pole_number?: string | number;
  address?: string;
  status?: string;
  latitude?: number | string;
  longitude?: number | string;
}

export interface SOWDropRecord {
  id?: string | number;
  drop_number?: string | number;
  pole_number?: string | number;
  address?: string;
  status?: string;
}

export interface SOWFibreRecord {
  id?: string | number;
  segment_id?: string | number;
  from_point?: string;
  to_point?: string;
  distance?: number | string;
  status?: string;
}

export interface SOWData {
  poles: SOWPoleRecord[];
  drops: SOWDropRecord[];
  fibre: SOWFibreRecord[];
  summary: {
    totalPoles: number;
    totalDrops: number;
    totalFibre: number;
  };
}

export interface NeonHealthData {
  connected: boolean;
  availableTables?: string[];
  info?: {
    version?: string;
  };
}