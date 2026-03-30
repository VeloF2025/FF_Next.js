/**
 * Shared types, constants, and utilities for PP Data components.
 */

export interface PPRecord {
  id: number;
  serial_number: string;
  project: string;
  date_registered: string | null;
  resolution_status: string;
  resolved_drop_number: string | null;
  resolved_source: string | null;
  resolved_at: string | null;
  maintenance_ticket_id: string | null;
  ticket_uid: string | null;
  ticket_priority: string | null;
  ticket_created_at: string | null;
  oes_team: string | null;
  activation_date: string | null;
  wa_phone: string | null;
  wa_name: string | null;
  wa_team: string | null;
}

export type PPCardCategory = 'total' | 'activated' | 'located' | 'not_found' | 'ticketed';

export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  not_found:       { bg: 'bg-amber-100 dark:bg-amber-900/30',   text: 'text-amber-800 dark:text-amber-300',   label: 'Not Found' },
  located_oes:     { bg: 'bg-blue-100 dark:bg-blue-900/30',     text: 'text-blue-800 dark:text-blue-300',     label: 'Found (OES)' },
  located_unified: { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-800 dark:text-indigo-300', label: 'Found (Unified)' },
  located_onemap:  { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300', label: 'Found (OneMap)' },
  located_1map:    { bg: 'bg-teal-100 dark:bg-teal-900/30',     text: 'text-teal-800 dark:text-teal-300',     label: 'Found (1Map)' },
  located_local:   { bg: 'bg-cyan-100 dark:bg-cyan-900/30',     text: 'text-cyan-800 dark:text-cyan-300',     label: 'Found (Local)' },
  activated:       { bg: 'bg-green-100 dark:bg-green-900/30',   text: 'text-green-800 dark:text-green-300',   label: 'Activated' },
};

export function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const created = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
}

export function ageBadgeStyle(days: number): string {
  if (days >= 14) return 'bg-red-900/40 text-red-300 border-red-700';
  if (days >= 7) return 'bg-orange-900/40 text-orange-300 border-orange-700';
  return 'bg-gray-800/40 text-gray-300 border-gray-600';
}

export function isSelectable(r: PPRecord): boolean {
  return r.maintenance_ticket_id === null && r.resolution_status !== 'activated';
}

export interface PPStats {
  total: number;
  activated: number;
  located: number;
  notFound: number;
  projects: number;
  ticketed: number;
  unticketed: number;
  lastImport: { date: string; filename: string; totalRows: number } | null;
}

export interface LookupStatus {
  status: 'running' | 'success' | 'failed';
  startedAt: string;
  completedAt: string | null;
  total: number;
  searched: number;
  resolved: number;
  not_found: number;
  errors: number;
  elapsed_seconds?: number;
}
