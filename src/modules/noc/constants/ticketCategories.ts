/**
 * NOC Ticket Category Mapping — T1/T2 structure
 *
 * T1 = Top-level category (Snags, Non-Invoiceable, HSE, DevOps, etc.)
 * T2 = Sub-type within the category (Tera, Internal, Offline, etc.)
 *
 * Maps ticket types to their display categories for dashboard grouping,
 * filtering, and notification routing.
 */

import { TicketType, TicketSubType } from '../types/ticket';

/** T1 category identifiers */
export type T1Category =
  | 'snags'
  | 'non_invoiceable'
  | 'hse'
  | 'devops'
  | 'sales'
  | 'modification'
  | 'fibertime'
  | 'unspecified';

/**
 * Map ticket types to their T1 display category.
 *
 * The new April-11 taxonomy stores the real T1 in the `category` column,
 * but this map is used as a fallback whenever a renderer only has the
 * legacy `ticket_type`. Discipline values (civils/optical/activations/
 * maintenance) don't map cleanly to the old T1 axes because their real T1
 * lives on ticket.category — they fall through to 'unspecified' here and
 * callers should prefer reading ticket.category when available.
 */
export const T1_CATEGORY_MAP: Record<string, T1Category> = {
  // Legacy vocabulary
  [TicketType.SNAG]: 'snags',
  [TicketType.INTERNAL_SNAG]: 'snags',
  [TicketType.PRE_PROVISION]: 'non_invoiceable',
  [TicketType.OLT_INVESTIGATION]: 'non_invoiceable',
  [TicketType.SERIAL_MISMATCH]: 'non_invoiceable',
  [TicketType.HSE_INCIDENT]: 'hse',
  [TicketType.HSE_NEAR_MISS]: 'hse',
  [TicketType.DEV_OPS]: 'devops',
  [TicketType.SALES_LEAD]: 'sales',
  [TicketType.MODIFICATION]: 'modification',
  [TicketType.FAULT_REPAIR]: 'fibertime',
  [TicketType.NEW_INSTALLATION]: 'fibertime',
  [TicketType.ONT_SWAP]: 'fibertime',
  [TicketType.INCIDENT]: 'fibertime',
  [TicketType.UNSPECIFIED]: 'unspecified',
  // Disciplines (April-11 taxonomy) — real T1 is on ticket.category
  [TicketType.CIVILS]: 'unspecified',
  [TicketType.OPTICAL]: 'unspecified',
  [TicketType.ACTIVATIONS]: 'unspecified',
  [TicketType.MAINTENANCE]: 'unspecified',
};

/** Display labels for T1 categories */
export const T1_LABELS: Record<T1Category, string> = {
  snags: 'Snags',
  non_invoiceable: 'Non-Invoiceable',
  hse: 'HSE',
  devops: 'DevOps',
  sales: 'Sales',
  modification: 'Modification',
  fibertime: 'Fibertime',
  unspecified: 'Unspecified',
};

/** Display labels for T2 sub-types */
export const T2_LABELS: Record<string, string> = {
  [TicketSubType.TERA]: 'Tera',
  [TicketSubType.INTERNAL]: 'Internal',
  [TicketSubType.OFFLINE]: 'Offline',
  [TicketSubType.MISMATCH]: 'Mismatch',
  [TicketSubType.NO_ENTRY]: 'No Entry',
  [TicketSubType.LEVEL]: 'Level',
  [TicketSubType.INCIDENT]: 'Incident',
  [TicketSubType.HSE]: 'HSE',
  [TicketSubType.DEVOPS]: 'DevOps',
  [TicketSubType.LEAD]: 'Lead',
  [TicketSubType.NEW]: 'New Installation',
  [TicketSubType.FAULT]: 'Fault',
  [TicketSubType.MNT]: 'MNT (ONT Swap)',
  [TicketSubType.MODIFICATION]: 'Modification',
  [TicketSubType.UNSPECIFIED]: 'Unspecified',
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

/** Get display label for a T2 sub-type */
export function getT2Label(subType: string | null): string {
  if (!subType) return '';
  return T2_LABELS[subType] ?? subType;
}

/** Get display label for a source */
export function getSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}
