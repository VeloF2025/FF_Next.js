/**
 * Data Sync Module Types
 * Unified data sync page types for maintenance, activate, and OLT report groups
 */

import type { LucideIcon } from 'lucide-react';

// Tab group identifiers
export type TabGroupId = 'maintenance' | 'activate' | 'olt';

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
