/**
 * Data Sync Module Types
 * Unified data sync page types for maintenance, activate, OLT report, and QField groups
 */

import type { LucideIcon } from 'lucide-react';

// Tab group identifiers
export type TabGroupId = 'maintenance' | 'activate' | 'olt' | 'qfield' | 'history';

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
  qfield: {
    totalProjects: number;
    activeProjects: number;
    lastSync: string | null;
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
export type ActivateTabId = 'oes' | 'arch' | 'manual' | 'pp-data';

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

// History tab IDs
export type HistoryTabId = 'timeline';

// Sync operation type for history
export type SyncOperationType =
  | 'oes_import'
  | 'arch_import'
  | 'qcontact_sync'
  | 'qfield_sync'
  | 'olt_import';

// Unified sync history entry (from UNION query)
export interface SyncHistoryEntry {
  id: string;
  operation_type: SyncOperationType;
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  completed_at: string | null;
  duration_seconds: number | null;
  summary: string; // human-readable summary
  details: Record<string, unknown>;
  error_message: string | null;
  triggered_by: string | null;
}

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

// ─── OLT Report Types ───────────────────────────────────────────────────────

export type DateFilter = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'custom';
export type ReportPeriod = 'today' | 'yesterday' | 'week' | '30days' | 'all';

/** Compute date range from a DateFilter preset */
export function getDateRange(filter: DateFilter, customDate?: string): { dateFrom?: string; dateTo?: string } {
  if (filter === 'all') return {};
  const now = new Date();
  if (filter === 'custom' && customDate) {
    const d = new Date(customDate);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return { dateFrom: d.toISOString(), dateTo: next.toISOString() };
  }
  if (filter === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { dateFrom: start.toISOString() };
  }
  if (filter === 'yesterday') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
  }
  if (filter === '7d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    return { dateFrom: start.toISOString() };
  }
  if (filter === '30d') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);
    return { dateFrom: start.toISOString() };
  }
  return {};
}

export interface OltRecord {
  id: string;
  drop_number: string;
  zone?: string | null;
  address?: string | null;
  olt_serial: string | null;
  onemap_serial?: string | null;
  wrong_onemap_serial?: string | null;
  onemap_prop_id?: string | null;
  offline_serial?: string | null;
  oes_serial?: string | null;
  onemap_fix_attempted?: boolean;
  onemap_fix_result?: string | null;
  onemap_fix_old_value?: string | null;
  onemap_fix_at?: string | null;
  fix_status?: string;
  fix_attempted_at?: string | null;
  created_at?: string | null;
  fix_result?: string | null;
  fix_old_value?: string | null;
  investigation_context?: string | null;
  has_ups_swap?: boolean;
  detection_source?: string;
  status?: string;
  comparison_status?: string;
  row_index?: number;
  import_filename?: string;
  import_date?: string;
  project?: string;
}

export interface InvestigationContext {
  reason: string;
  wrongSerial: string;
  wrongUps?: string | null;
  belongsToDr: string;
  belongsToTeam: string;
  belongsToStatus: string;
  totalPropRecords: number;
  correctRecords: number;
  wrongRecords: number;
  swappedRecords: number;
  message: string;
  currentStatus?: string;
  propId?: string;
}

export interface SwapLookupResult {
  drA: { drNumber: string; oesSerial: string; oneMapSerial: string; oneMapUps: string | null };
  drB: { drNumber: string; oesSerial: string | null; oneMapSerial: string | null; oneMapUps: string | null; foundOn1Map: boolean };
  upsTransfer: { needed: boolean; serial: string | null; from: string; to: string } | null;
  scenario: 'clean_swap' | 'fix_a_only' | 'fix_a_flag_b' | 'fix_a_b_missing';
  recommendation: string;
  canAutoSwap: boolean;
}

export interface ImportRecord {
  id: string;
  filename: string;
  project: string | null;
  total_records: number;
  match_count: number;
  mismatch_count: number;
  empty_serial_count: number;
  not_found_count: number;
  imported_at: string;
  imported_by_email: string | null;
}

export interface OltStats {
  pending: number;
  needs_investigation: number;
  fixed: number;
  resolved: number;
  escalated: number;
  empty: number;
  total: number;
  investigateBreakdown?: { cross_dr: number; not_found: number; other: number };
}

export interface AutoDetectStatus {
  hasRun: boolean;
  run?: {
    id: number;
    totalOesRows: number;
    cacheHits: number;
    cacheMisses: number;
    matches: number;
    mismatchesNote2: number;
    mismatchesNote4: number;
    upsSwaps: number;
    duplicatesSkipped: number;
    apiLookupsQueued: number;
    status: string;
    startedAt: string;
    completedAt: string | null;
  };
  queue?: {
    pending: number;
    completed: number;
    errors: number;
    total: number;
  };
}

export interface UploadResult {
  success: boolean;
  stats: {
    totalRecords: number;
    matchCount: number;
    mismatchCount: number;
    emptySerialCount: number;
    updatedCount: number;
  };
}

export interface ReportData {
  summary: {
    total: number;
    fixed: number;
    pending: number;
    empty_serial: number;
    not_found: number;
  };
  records: OltRecord[];
  fixesByDay: Array<{ date: string; count: number }>;
  imports: Array<{
    id: string;
    filename: string;
    project: string;
    mismatch_count: number;
    fixed_count: number;
    pending_count: number;
    imported_at: string;
  }>;
}

export interface DisplacedReport {
  total: number;
  unactivated: number;
  activated: number;
  records: Array<{
    drop_number: string;
    old_value: string;
    new_value: string;
    displaced_serial: string;
    displaced_activated: boolean;
    displaced_owner_dr: string | null;
    displaced_owner_team: string | null;
    created_at: string;
  }>;
}

export interface DisplacedInfo {
  activated: boolean;
  ownerDr?: string;
  ownerTeam?: string;
  ownerStatus?: string;
}

export interface BulkFixResult {
  total: number;
  successCount: number;
  failCount: number;
}
