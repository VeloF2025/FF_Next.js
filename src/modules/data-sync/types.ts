/**
 * Data Sync Module Types
 * Unified data sync page types for maintenance, activate, and OLT report groups
 */

import type { LucideIcon } from 'lucide-react';

// Tab group identifiers
export type TabGroupId = 'maintenance' | 'activate' | 'olt' | 'qfield';

// Individual tab within a group
export interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  description?: string;
}

// Tab group configuration
export interface TabGroup {
  id: TabGroupId;
  label: string;
  icon: LucideIcon;
  description: string;
  color: string; // Tailwind color class for card accent
  tabs: Tab[];
}

// Overview dashboard stats
export interface DataSyncStats {
  maintenance: {
    lastQContactSync: string | null;
    pendingTickets: number;
    weeklyImportsThisMonth: number;
    syncHealthy: boolean;
  };
  activate: {
    lastOESImport: string | null;
    lastARCHImport: string | null;
    totalDRs: number;
    pendingReview: number;
  };
  olt: {
    pendingFixes: number;
    needsInvestigation: number;
    escalated: number;
    fixedThisWeek: number;
    totalImported: number;
  };
}

// API response type
export interface DataSyncStatsResponse {
  success: boolean;
  data: DataSyncStats;
  error?: string;
}

// Maintenance tab IDs
export type MaintenanceTabId =
  | 'qcontact'
  | 'alignment'
  | 'three-way'
  | 'weekly'
  | 'wa-tracking';

// Activate tab IDs
export type ActivateTabId = 'oes' | 'arch' | 'manual';

// OLT Report tab IDs
export type OltTabId =
  | 'import'
  | 'pending'
  | 'investigate'
  | 'escalations'
  | 'history'
  | 'reporting';

// QField tab IDs
export type QFieldTabId = 'projects';

// QField project from DB
export interface QFieldProject {
  id: string;
  qfield_project_id: string;
  name: string;
  description: string | null;
  qfield_url: string | null;
  is_active: boolean;
  is_default: boolean;
  sync_enabled: boolean;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
  linked_projects: { id: string; project_name: string; project_code: string }[];
}

// QFieldCloud project from discovery
export interface QFieldCloudProject {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
  already_registered: boolean;
}
