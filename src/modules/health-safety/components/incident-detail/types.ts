/**
 * Shared types + color maps for the incident detail view
 */

import type { HSIncidentType, HSSeverity } from '@/modules/health-safety/types/ticket.types';

export interface InjuredPerson {
  name?: string;
  role?: string;
  injuries?: string;
}

export interface IncidentPhoto {
  url?: string;
}

export interface IncidentDetail {
  id: string;
  ticket_uid: string;
  title: string;
  status: string;
  priority: string;
  created_at: string;
  incident_type: HSIncidentType;
  severity: HSSeverity;
  incident_date: string | null;
  incident_time: string | null;
  location: string | null;
  description: string | null;
  immediate_actions: string | null;
  dol_reportable: boolean;
  dol_reported: boolean;
  injured_persons: (InjuredPerson | string)[] | null;
  witnesses: string[] | null;
  photos: (IncidentPhoto | string)[] | null;
  project_name: string | null;
  contractor_name: string | null;
}

// Copied from IncidentCard (pages/health-safety/incidents/index.tsx). 'fatal' added —
// HSSeverity has no 'critical' value, and without it fatal incidents fell back to 'UNKNOWN'.
export const severityColors: Record<string, string> = {
  fatal: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  major: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  moderate: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  minor: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300',
};

export const statusColors: Record<string, string> = {
  open: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  investigating: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  resolved: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  closed: 'bg-gray-100 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300',
};
