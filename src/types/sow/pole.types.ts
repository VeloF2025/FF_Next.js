/**
 * SOW Pole Types - Pole-related data structures
 */

/** Timestamp values from Neon PostgreSQL are returned as strings or Date objects */
type Timestamp = string | Date;

import { PoleStatus, PoleType, ValidationStatus } from './enums.types';

// Pole Data Structure
export interface PoleData {
  id?: string;
  projectId: string;
  
  // Core Identifiers
  label_1: string;        // Unique pole number (e.g., "LAW.P.B001")
  pole_number?: string;   // Alternative pole identifier
  
  // Status and Classification
  status: PoleStatus;
  pole_type?: PoleType;
  
  // Location Data
  latitude: number;
  longitude: number;
  address?: string;
  zone_no?: string;
  
  // Network Information
  pon_no?: string;        // PON network number
  network_segment?: string;
  
  // Installation Details
  installation_date?: Date;
  completion_date?: Date;
  assigned_contractor?: string;
  assigned_team?: string;
  
  // Capacity and Connections
  max_drops: number;      // Maximum drops per pole (default 12)
  current_drops: number;  // Current number of connected drops
  available_capacity: number; // Calculated available capacity
  
  // Import Metadata
  source_file?: string;
  source_row?: number;
  import_date?: Timestamp;
  validation_status: ValidationStatus;
  validation_errors: string[];
  
  // Audit Fields
  createdAt: Timestamp;
  updatedAt: Timestamp;
}