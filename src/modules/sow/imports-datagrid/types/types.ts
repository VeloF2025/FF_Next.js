// ============= Imports Data Grid Types =============

export interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

/** Minimal project option for SOW imports data grid */
export interface ProjectOption {
  id: string;
  name: string;
}

/** @deprecated Use ProjectOption instead */
export type Project = ProjectOption;

export interface LinkingStats {
  total: number;
  linked: number;
  linkingRate: number;
  matchTypes?: {
    exact: number;
    normalized: number;
    proximity: number;
  };
}

export type MatchingMode = 'enhanced' | 'exact';

export interface PoleData {
  id?: string;
  pole_number: string;
  latitude?: number;
  longitude?: number;
  status?: string;
  address?: string;
  municipality?: string;
  owner?: string;
  height?: number;
  created_at?: string;
}

export interface FibreData {
  id?: string;
  segment_id: string;
  start_point?: string;
  end_point?: string;
  cable_type?: string;
  cable_length?: number;
  layer?: string;
  status?: string;
  contractor?: string;
  created_at?: string;
}

export interface DropData {
  id?: string;
  drop_number: string;
  pole_number?: string;
  start_point?: string;
  end_point?: string;
  cable_length?: number;
  cable_type?: string;
  status?: string;
  address?: string;
  created_at?: string;
}

export interface OneMapData {
  id?: string;
  property_id: string;
  onemap_id?: string;
  location_address?: string;
  pole_number?: string;
  drop_number?: string;
  status?: string;
  latitude?: number;
  longitude?: number;
  contact_name?: string;
  contact_surname?: string;
  contact_number?: string;
  sow_pole_number?: string;
  match_type?: 'exact' | 'normalized' | 'proximity';
  drop_cable_length?: string;
  home_signup_date?: string;
}

export interface NokiaData {
  id?: string;
  drop_number: string;
  property_id: string;
  ont_barcode?: string;
  status?: string;
  pole_number?: string;
  stand_number?: string;
  installation_date?: string;
  latitude?: number;
  longitude?: number;
}
