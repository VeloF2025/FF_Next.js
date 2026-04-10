/**
 * Maintenance Module - Ticket Types, Priorities, and Sources
 * 🟢 WORKING: Ticket classification constants with labels and descriptions
 *
 * Defines all ticket types, priority levels, and source channels
 * to maintain consistency across the application.
 */

import { TicketType, TicketPriority, TicketSource } from '../types/ticket';

/**
 * Ticket type metadata
 */
export interface TicketTypeMetadata {
  value: TicketType;
  label: string;
  description: string;
  icon?: string;
  requiresDR: boolean; // Does this ticket type require DR number?
}

/**
 * Complete ticket type definitions
 * 🟢 WORKING: All ticket types with metadata for UI display
 */
export const TICKET_TYPE_DEFINITIONS: Record<TicketType, TicketTypeMetadata> = {
  [TicketType.FAULT_REPAIR]: {
    value: TicketType.FAULT_REPAIR,
    label: 'Maintenance',
    description: 'Repair or fix existing fiber network issue or fault',
    icon: 'Build',
    requiresDR: true,
  },
  [TicketType.NEW_INSTALLATION]: {
    value: TicketType.NEW_INSTALLATION,
    label: 'New Installation',
    description: 'New fiber installation or drop activation',
    icon: 'FiberNew',
    requiresDR: true,
  },
  [TicketType.MODIFICATION]: {
    value: TicketType.MODIFICATION,
    label: 'Modification',
    description: 'Modify existing installation (relocation, upgrade)',
    icon: 'Edit',
    requiresDR: true,
  },
  [TicketType.ONT_SWAP]: {
    value: TicketType.ONT_SWAP,
    label: 'ONT Swap',
    description: 'Replace or swap ONT device',
    icon: 'SwapHoriz',
    requiresDR: true,
  },
  [TicketType.INCIDENT]: {
    value: TicketType.INCIDENT,
    label: 'Incident',
    description: 'Network incident or outage affecting multiple customers',
    icon: 'Warning',
    requiresDR: false,
  },
  [TicketType.PRE_PROVISION]: {
    value: TicketType.PRE_PROVISION,
    label: 'Pre-Provision',
    description: 'Pre-provisioning investigation or check',
    icon: 'Search',
    requiresDR: true,
  },
  [TicketType.OLT_INVESTIGATION]: {
    value: TicketType.OLT_INVESTIGATION,
    label: 'OLT Investigation',
    description: 'OLT port or configuration investigation',
    icon: 'Search',
    requiresDR: true,
  },
  [TicketType.SERIAL_MISMATCH]: {
    value: TicketType.SERIAL_MISMATCH,
    label: 'Serial Mismatch',
    description: 'ONT serial number mismatch between OLT and records',
    icon: 'Search',
    requiresDR: true,
  },
  [TicketType.HSE_INCIDENT]: {
    value: TicketType.HSE_INCIDENT,
    label: 'H&S Incident',
    description: 'Health and safety incident on site',
    icon: 'ShieldAlert',
    requiresDR: false,
  },
  [TicketType.HSE_NEAR_MISS]: {
    value: TicketType.HSE_NEAR_MISS,
    label: 'H&S Near Miss',
    description: 'Health and safety near miss event',
    icon: 'ShieldAlert',
    requiresDR: false,
  },
  [TicketType.DEV_OPS]: {
    value: TicketType.DEV_OPS,
    label: 'DevOps',
    description: 'FibreFlow application issue or bug',
    icon: 'BugReport',
    requiresDR: false,
  },
  [TicketType.SNAG]: {
    value: TicketType.SNAG,
    label: 'Snag',
    description: 'Construction quality snag from TQR audit',
    icon: 'BugReport',
    requiresDR: false,
  },
  [TicketType.INTERNAL_SNAG]: {
    value: TicketType.INTERNAL_SNAG,
    label: 'Internal Snag',
    description: 'Internal quality snag raised by FibreFlow team',
    icon: 'BugReport',
    requiresDR: false,
  },
  [TicketType.SALES_LEAD]: {
    value: TicketType.SALES_LEAD,
    label: 'Sales Lead',
    description: 'Sales enquiry or new customer lead',
    icon: 'TrendingUp',
    requiresDR: false,
  },
  [TicketType.UNSPECIFIED]: {
    value: TicketType.UNSPECIFIED,
    label: 'Unspecified',
    description: 'Ticket type not yet determined or does not fit other categories',
    icon: 'HelpOutline',
    requiresDR: false,
  },
};

/**
 * Ticket priority metadata
 */
export interface TicketPriorityMetadata {
  value: TicketPriority;
  label: string;
  description: string;
  color: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  slaDays: number; // Default SLA in days
  order: number;
}

/**
 * Complete ticket priority definitions
 * 🟢 WORKING: All priority levels with SLA defaults
 */
export const TICKET_PRIORITY_DEFINITIONS: Record<TicketPriority, TicketPriorityMetadata> = {
  [TicketPriority.LOW]: {
    value: TicketPriority.LOW,
    label: 'Low',
    description: 'Non-urgent, can be scheduled normally',
    color: 'default',
    slaDays: 7,
    order: 1,
  },
  [TicketPriority.NORMAL]: {
    value: TicketPriority.NORMAL,
    label: 'Normal',
    description: 'Standard priority, normal scheduling',
    color: 'info',
    slaDays: 3,
    order: 2,
  },
  [TicketPriority.HIGH]: {
    value: TicketPriority.HIGH,
    label: 'High',
    description: 'Important issue, prioritize in schedule',
    color: 'warning',
    slaDays: 1,
    order: 3,
  },
  [TicketPriority.URGENT]: {
    value: TicketPriority.URGENT,
    label: 'Urgent',
    description: 'Urgent issue, immediate attention needed',
    color: 'error',
    slaDays: 0.5, // 12 hours
    order: 4,
  },
  [TicketPriority.CRITICAL]: {
    value: TicketPriority.CRITICAL,
    label: 'Critical',
    description: 'Critical outage or emergency, drop everything',
    color: 'error',
    slaDays: 0.25, // 6 hours
    order: 5,
  },
};

/**
 * Ticket source metadata
 */
export interface TicketSourceMetadata {
  value: TicketSource;
  label: string;
  description: string;
  icon?: string;
  automated: boolean; // Is this source automated/imported?
}

/**
 * Complete ticket source definitions
 * 🟢 WORKING: All ticket sources with metadata
 */
export const TICKET_SOURCE_DEFINITIONS: Record<TicketSource, TicketSourceMetadata> = {
  [TicketSource.QCONTACT]: {
    value: TicketSource.QCONTACT,
    label: 'QContact',
    description: 'Imported from QContact CRM system',
    icon: 'PhoneInTalk',
    automated: true,
  },
  [TicketSource.WEEKLY_REPORT]: {
    value: TicketSource.WEEKLY_REPORT,
    label: 'Weekly Report',
    description: 'Imported from weekly Excel report',
    icon: 'TableChart',
    automated: true,
  },
  [TicketSource.CONSTRUCTION]: {
    value: TicketSource.CONSTRUCTION,
    label: 'Construction',
    description: 'Created during construction activities',
    icon: 'Construction',
    automated: false,
  },
  [TicketSource.AD_HOC]: {
    value: TicketSource.AD_HOC,
    label: 'Ad Hoc',
    description: 'Ad hoc request or special case',
    icon: 'Info',
    automated: false,
  },
  [TicketSource.INCIDENT]: {
    value: TicketSource.INCIDENT,
    label: 'Incident',
    description: 'Created from network incident or outage',
    icon: 'Warning',
    automated: false,
  },
  [TicketSource.REVENUE]: {
    value: TicketSource.REVENUE,
    label: 'Revenue',
    description: 'Revenue-related ticket (billing, activation)',
    icon: 'AttachMoney',
    automated: false,
  },
  [TicketSource.ONT_SWAP]: {
    value: TicketSource.ONT_SWAP,
    label: 'ONT Swap',
    description: 'ONT swap or replacement request',
    icon: 'SwapHoriz',
    automated: false,
  },
  [TicketSource.MANUAL]: {
    value: TicketSource.MANUAL,
    label: 'Manual',
    description: 'Manually created via FibreFlow UI',
    icon: 'Person',
    automated: false,
  },
  [TicketSource.OFFLINE_REPORT]: {
    value: TicketSource.OFFLINE_REPORT,
    label: 'Offline Report',
    description: 'From offline device (ARCH) report',
    icon: 'OfflineBolt',
    automated: true,
  },
  [TicketSource.QA_REVIEW]: {
    value: TicketSource.QA_REVIEW,
    label: 'QA Review',
    description: 'Created from QA Centre review process',
    icon: 'FactCheck',
    automated: true,
  },
  [TicketSource.HSE_REPORT]: {
    value: TicketSource.HSE_REPORT,
    label: 'H&S Report',
    description: 'From Health and Safety module',
    icon: 'HealthAndSafety',
    automated: false,
  },
  [TicketSource.WA_MAINTENANCE]: {
    value: TicketSource.WA_MAINTENANCE,
    label: 'WhatsApp',
    description: 'From WhatsApp maintenance tracking group',
    icon: 'WhatsApp',
    automated: true,
  },
  [TicketSource.PP_DATA]: {
    value: TicketSource.PP_DATA,
    label: 'PP Data',
    description: 'From PP Data investigation',
    icon: 'Search',
    automated: true,
  },
  [TicketSource.OLT_MISMATCH]: {
    value: TicketSource.OLT_MISMATCH,
    label: 'OLT Mismatch',
    description: 'From OLT report serial mismatch',
    icon: 'SearchOff',
    automated: true,
  },
  [TicketSource.DEV_OPS]: {
    value: TicketSource.DEV_OPS,
    label: 'DevOps',
    description: 'FibreFlow application issue',
    icon: 'BugReport',
    automated: false,
  },
  [TicketSource.SNAGS]: {
    value: TicketSource.SNAGS,
    label: 'Snags',
    description: 'From TQR snag reports',
    icon: 'BugReport',
    automated: true,
  },
};

/**
 * Arrays of all values
 * 🟢 WORKING: Complete lists for dropdowns and filters
 */
export const TICKET_TYPES = Object.values(TicketType);
export const TICKET_PRIORITIES = Object.values(TicketPriority);
export const TICKET_SOURCES = Object.values(TicketSource);

/**
 * Sorted options for dropdowns
 * 🟢 WORKING: Ordered lists for UI display
 */
export const TICKET_TYPE_OPTIONS = Object.values(TICKET_TYPE_DEFINITIONS);

export const TICKET_PRIORITY_OPTIONS = Object.values(TICKET_PRIORITY_DEFINITIONS).sort(
  (a, b) => a.order - b.order
);

export const TICKET_SOURCE_OPTIONS = Object.values(TICKET_SOURCE_DEFINITIONS);

/**
 * Automated sources (for filtering)
 * 🟢 WORKING: Filter for imported tickets
 */
export const AUTOMATED_SOURCES = TICKET_SOURCES.filter(
  (source) => TICKET_SOURCE_DEFINITIONS[source].automated
);

/**
 * Manual sources (for filtering)
 * 🟢 WORKING: Filter for manually created tickets
 */
export const MANUAL_SOURCES = TICKET_SOURCES.filter(
  (source) => !TICKET_SOURCE_DEFINITIONS[source].automated
);

/**
 * Ticket types that require DR number
 * 🟢 WORKING: Filter for DR-required ticket types
 */
export const DR_REQUIRED_TYPES = TICKET_TYPES.filter(
  (type) => TICKET_TYPE_DEFINITIONS[type].requiresDR
);

/**
 * Helper functions
 * 🟢 WORKING: Utility functions for getting metadata
 */

export function getTicketTypeMetadata(type: TicketType): TicketTypeMetadata {
  return TICKET_TYPE_DEFINITIONS[type];
}

export function getTicketPriorityMetadata(priority: TicketPriority): TicketPriorityMetadata {
  return TICKET_PRIORITY_DEFINITIONS[priority];
}

export function getTicketSourceMetadata(source: TicketSource): TicketSourceMetadata {
  return TICKET_SOURCE_DEFINITIONS[source];
}

export function getTicketTypeLabel(type: TicketType): string {
  return TICKET_TYPE_DEFINITIONS[type].label;
}

export function getTicketPriorityLabel(priority: TicketPriority): string {
  return TICKET_PRIORITY_DEFINITIONS[priority].label;
}

export function getTicketSourceLabel(source: TicketSource): string {
  return TICKET_SOURCE_DEFINITIONS[source].label;
}

/**
 * Get SLA days for priority
 * 🟢 WORKING: Helper to get default SLA for a priority level
 */
export function getPrioritySLADays(priority: TicketPriority): number {
  return TICKET_PRIORITY_DEFINITIONS[priority].slaDays;
}

/**
 * Check if ticket type requires DR number
 * 🟢 WORKING: Helper to check DR requirement
 */
export function requiresDRNumber(type: TicketType): boolean {
  return TICKET_TYPE_DEFINITIONS[type].requiresDR;
}

/**
 * Check if source is automated
 * 🟢 WORKING: Helper to check if source is automated/imported
 */
export function isAutomatedSource(source: TicketSource): boolean {
  return TICKET_SOURCE_DEFINITIONS[source].automated;
}
