/**
 * NOC Ticket Category Mapping — discipline (T1) / subcategory (T2) structure
 *
 * T1 = Discipline: which team resolves the ticket (civils/optical/activations/maintenance/devops)
 *      Stored in maintenance_tickets.type (shrunk to 6 values by migration 279)
 * T2 = Subcategory: what kind of ticket (snag/hse_incident/sales_lead/etc.)
 *      Stored in maintenance_tickets.ticket_category (added by migration 277)
 */

import { TicketType } from '../types/ticket';

/** T1 category identifiers — aligned with the 6-discipline type vocabulary */
export type T1Category =
  | 'civils'
  | 'optical'
  | 'activations'
  | 'maintenance'
  | 'devops'
  | 'unspecified';

/**
 * Map discipline (ticket_type) → T1 display category.
 * Each discipline maps to its own bucket after migration 279.
 */
export const T1_CATEGORY_MAP: Record<string, T1Category> = {
  [TicketType.CIVILS]:      'civils',
  [TicketType.OPTICAL]:     'optical',
  [TicketType.ACTIVATIONS]: 'activations',
  [TicketType.MAINTENANCE]: 'maintenance',
  [TicketType.DEV_OPS]:     'devops',
  [TicketType.UNSPECIFIED]: 'unspecified',
};

/** Display labels for T1 (discipline) categories */
export const T1_LABELS: Record<T1Category, string> = {
  civils:      'Civils',
  optical:     'Optical',
  activations: 'Activations',
  maintenance: 'Maintenance',
  devops:      'DevOps',
  unspecified: 'Unspecified',
};

/** Source display labels for the UI */
export const SOURCE_LABELS: Record<string, string> = {
  qcontact: 'QContact',
  weekly_report: 'Weekly Import',
  pp_data: 'PP Data Import',
  olt_mismatch: 'OLT Mismatch Report',
  snags: 'SharePoint (TQR)',
  manual: 'Manual (FibreFlow)',
  internal: 'Internal',
  dev_ops: 'DevOps',
  construction: 'Construction QA',
  hse_report: 'H&S Report',
  ont_swap: 'ONT Swap',
  offline_report: 'Offline Report',
  qa_review: 'QA Review',
  wa_maintenance: 'WhatsApp',
  ad_hoc: 'Ad Hoc',
  incident: 'Incident',
  revenue: 'Revenue',
};

/** Get T1 category for a ticket type */
export function getT1Category(type: string): T1Category {
  return T1_CATEGORY_MAP[type] ?? 'unspecified';
}

/** Get display label for a T1 category */
export function getT1Label(type: string): string {
  const cat = getT1Category(type);
  return T1_LABELS[cat];
}

/** Display labels for ticket_category (T1 + T2 axis) */
export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  // T1 operational categories
  maintenance: 'Maintenance',
  snag: 'Snag',
  hse_incident: 'HSE',
  dev_ops: 'DevOps',
  sales_lead: 'Sales',
  unspecified: 'Unspecified',
  // T2 sub-type tags (PP Data + OLT mismatch)
  pre_provision: 'Pre-Provision',
  fault_repair: 'Fault Repair',
  modification: 'Modification',
  ont_swap: 'ONT Swap',
  new_installation: 'New Installation',
  serial_mismatch: 'Serial Mismatch',
  olt_investigation: 'OLT Investigation',
};

/** The sub-type tags valid as ticket_category on PP/OLT ingest paths. */
export const PP_OLT_SUBTYPES = [
  'pre_provision',
  'fault_repair',
  'modification',
  'ont_swap',
  'new_installation',
  'serial_mismatch',
  'olt_investigation',
] as const;

export type PPOLTSubtype = (typeof PP_OLT_SUBTYPES)[number];

/** Get display label for a ticket_category value */
export function getTicketCategoryLabel(category: string | null | undefined): string {
  if (!category) return '';
  return TICKET_CATEGORY_LABELS[category] ?? category;
}

/** Get display label for a source */
export function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
