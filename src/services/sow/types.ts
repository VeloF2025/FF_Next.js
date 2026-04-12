/**
 * SOW Service Types
 * Type definitions for SOW data structures and operations
 */

export interface NeonPoleData {
  pole_number: string;
  latitude: number | undefined;
  longitude: number | undefined;
  status: string;
  pole_type?: string | undefined;
  pole_spec?: string | undefined;
  height?: string | undefined;
  diameter?: string | undefined;
  owner?: string | undefined;
  pon_no?: number | undefined;
  zone_no?: number | undefined;
  address?: string | undefined;
  municipality?: string | undefined;
  project_ref?: string | undefined;
  created_date?: string | undefined;
  created_by?: string | undefined;
  comments?: string | undefined;
  installation_date?: string | undefined;
  raw_data?: Record<string, unknown>;
}

export interface NeonDropData {
  drop_number: string;
  pole_number: string;
  cable_type?: string | undefined;
  cable_spec?: string | undefined;
  cable_length?: string | undefined;
  cable_capacity?: string | undefined;
  start_point?: string | undefined;
  end_point?: string | undefined;
  latitude?: number | undefined;
  longitude?: number | undefined;
  address?: string | undefined;
  pon_no?: number | undefined;
  zone_no?: number | undefined;
  municipality?: string | undefined;
  project_ref?: string | undefined;
  created_date?: string | undefined;
  created_by?: string | undefined;
  service_type?: string | undefined;
  raw_data?: Record<string, unknown>;
}

export interface NeonFibreData {
  segment_id: string;
  cable_size: string;
  layer: string;
  length: number;
  pon_no?: number | undefined;
  zone_no?: number | undefined;
  string_completed?: number | undefined;
  date_completed?: string | undefined;
  contractor?: string | undefined;
  is_complete?: boolean | undefined;
  fibre_type?: string | undefined;
  raw_data?: Record<string, unknown>;
}

export interface SOWProjectSummary {
  id: number;
  project_id: string;
  project_name?: string;
  total_poles: number;
  total_drops: number;
  total_fibre_segments: number;
  total_fibre_length: number;
  last_updated: string;
}

export interface SOWData {
  poles: NeonPoleData[];
  drops: NeonDropData[];
  fibre: NeonFibreData[];
  summary: SOWProjectSummary | null;
}

export interface SOWOperationResult {
  success: boolean;
  count?: number;
  message?: string;
  error?: string;
  data?: SOWData;
}

export type SOWTableType = 'poles' | 'drops' | 'fibre';