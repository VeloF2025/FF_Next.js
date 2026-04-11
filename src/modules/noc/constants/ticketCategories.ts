/**
 * NOC Ticket Category Mapping — T1/T2 structure
 *
 * T1 = Top-level category (Snags, Non-Invoiceable, HSE, DevOps, etc.)
 * T2 = Sub-type within the category (Tera, Internal, Offline, etc.)
 *
 * Maps ticket types to their display categories for dashboard grouping,
 * filtering, and notification routing.
 */

import { TicketType } from '../types/ticket';

/** T1 category identifiers */
export type T1Category =
  | 'snags'
  | 'non_invoiceable'
  | 'hse'
  | 'devops'
  | 'sales'
  | 'fibertime'
  | 'unspecified';

/**
 * Map discipline (ticket_type) to a legacy display grouping for dashboards
 * that haven't yet adopted the two-axis ticket_category column.
 *
 * Real T1 categorisation lives in ticket.ticket_category — callers should
 * prefer that field. This map is a fallback for rendering contexts that only
 * have ticket_type available.
 */
export const T1_CATEGORY_MAP: Record<string, T1Category> = {
  [TicketType.DEV_OPS]: 'devops',
  [TicketType.CIVILS]: 'unspecified',
  [TicketType.OPTICAL]: 'unspecified',
  [TicketType.ACTIVATIONS]: 'fibertime',
  [TicketType.MAINTENANCE]: 'unspecified',
  [TicketType.UNSPECIFIED]: 'unspecified',
};

/** Display labels for T1 categories */
export const T1_LABELS: Record<T1Category, string> = {
  snags: 'Snags',
  non_invoiceable: 'Non-Invoiceable',
  hse: 'HSE',
  devops: 'DevOps',
  sales: 'Sales',
  fibertime: 'Fibertime',
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

/** Display labels for ticket_category (T1 axis) */
export const TICKET_CATEGORY_LABELS: Record<string, string> = {
  maintenance: 'Maintenance',
  snag: 'Snag',
  hse_incident: 'HSE',
  dev_ops: 'DevOps',
  sales_lead: 'Sales',
  unspecified: 'Unspecified',
};

/** Get display label for a ticket_category value */
export function getTicketCategoryLabel(category: string | null | undefined): string {
  if (!category) return '';
  return TICKET_CATEGORY_LABELS[category] ?? category;
}

/** Get display label for a source */
export function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
