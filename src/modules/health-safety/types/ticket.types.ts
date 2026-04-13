/**
 * H&S Ticket Types
 *
 * Extensions to maintenance ticket types for H&S incidents.
 * These types are used alongside the hs_ticket_details table.
 */

// H&S-specific incident types
export type HSIncidentType =
  | 'injury'
  | 'near_miss'
  | 'property_damage'
  | 'environmental'
  | 'vehicle'
  | 'other';

// H&S severity levels (maps to ticket priority)
export type HSSeverity = 'minor' | 'moderate' | 'major' | 'fatal';

// Person involved in an incident
export interface PersonInvolved {
  name: string;
  role: string; // employee, contractor, visitor, public
  injuries?: string;
  treatment?: string;
  contractor_id?: number;
  staff_id?: number;
}

// GPS coordinates for incident location
export interface IncidentGPS {
  lat: number;
  lng: number;
}

// H&S Ticket Details (extends maintenance ticket)
export interface HSTicketDetails {
  id: string;
  ticket_id: string;

  // H&S classification
  hs_incident_type: HSIncidentType | null;
  hs_severity: HSSeverity | null;

  // Incident details
  incident_date: string | null;
  incident_location: string | null;
  incident_gps: IncidentGPS | null;
  witness_names: string[];
  immediate_actions: string | null;

  // Persons involved
  persons_involved: PersonInvolved[];

  // DoL reporting (SA requirement)
  is_dol_reportable: boolean;
  dol_reference: string | null;
  dol_reported_at: string | null;
  dol_reported_by: number | null;

  // Investigation
  root_cause: string | null;
  contributing_factors: string[];
  investigation_findings: string | null;
  investigation_recommendations: string | null;
  investigated_by: number | null;
  investigation_started_at: string | null;
  investigation_completed_at: string | null;

  // Source audit (if from failed audit item)
  source_audit_id: string | null;
  source_checklist_item_id: string | null;

  // Evidence
  photos: { url: string; caption?: string; timestamp: string }[];

  created_at: string;
  updated_at: string;
}

export interface HSTicketDetailsInput {
  ticket_id: string;
  hs_incident_type?: HSIncidentType;
  hs_severity?: HSSeverity;
  incident_date?: string;
  incident_location?: string;
  incident_gps?: IncidentGPS;
  witness_names?: string[];
  immediate_actions?: string;
  persons_involved?: PersonInvolved[];
  is_dol_reportable?: boolean;
  source_audit_id?: string;
  source_checklist_item_id?: string;
}

// Severity to ticket priority mapping
export const SEVERITY_TO_PRIORITY: Record<HSSeverity, string> = {
  minor: 'normal',
  moderate: 'high',
  major: 'urgent',
  fatal: 'critical',
};

// Severity to SLA hours mapping
export const SEVERITY_SLA_HOURS: Record<HSSeverity, number> = {
  minor: 72, // 3 days
  moderate: 24, // 1 day
  major: 12, // 12 hours
  fatal: 6, // 6 hours
};

// Incident type configuration
export const INCIDENT_TYPE_CONFIG: Record<
  HSIncidentType,
  { label: string; icon: string; color: string; description: string }
> = {
  injury: {
    label: 'Injury',
    icon: 'UserX',
    color: 'red',
    description: 'Personal injury to worker or third party',
  },
  near_miss: {
    label: 'Near Miss',
    icon: 'AlertCircle',
    color: 'amber',
    description: 'Close call that could have resulted in injury or damage',
  },
  property_damage: {
    label: 'Property Damage',
    icon: 'Home',
    color: 'orange',
    description: 'Damage to property, equipment, or infrastructure',
  },
  environmental: {
    label: 'Environmental',
    icon: 'Leaf',
    color: 'green',
    description: 'Environmental spill, contamination, or impact',
  },
  vehicle: {
    label: 'Vehicle Incident',
    icon: 'Truck',
    color: 'blue',
    description: 'Vehicle accident or incident',
  },
  other: {
    label: 'Other',
    icon: 'AlertTriangle',
    color: 'gray',
    description: 'Other H&S related incident',
  },
};

// Severity configuration
export const SEVERITY_CONFIG: Record<
  HSSeverity,
  { label: string; color: string; description: string; dol_reportable: boolean }
> = {
  minor: {
    label: 'Minor',
    color: 'yellow',
    description: 'No or minor injury, minimal impact',
    dol_reportable: false,
  },
  moderate: {
    label: 'Moderate',
    color: 'orange',
    description: 'Injury requiring medical treatment, significant property damage',
    dol_reportable: false,
  },
  major: {
    label: 'Major',
    color: 'red',
    description: 'Serious injury, hospitalization required, major property damage',
    dol_reportable: true,
  },
  fatal: {
    label: 'Fatal',
    color: 'red',
    description: 'Fatality or permanent disability',
    dol_reportable: true,
  },
};

// DoL (Department of Labour) reporting requirements per OHS Act
export const DOL_REPORTING = {
  reportable_severities: ['major', 'fatal'] as HSSeverity[],
  reporting_deadline_hours: 24, // Must report within 24 hours
  form_reference: 'WCA Form 1', // Workers Compensation Act Form 1
  regulations: [
    'OHS Act Section 24(1) - Report any incident that causes death',
    'OHS Act Section 24(2) - Report serious injuries within 24 hours',
    'Compensation for Occupational Injuries and Diseases Act (COIDA)',
  ],
};

// H&S ticket summary for lists
export interface HSTicketSummary {
  ticket_id: string;
  ticket_uid: string;
  title: string;
  status: string;
  priority: string;
  hs_incident_type: HSIncidentType | null;
  hs_severity: HSSeverity | null;
  incident_date: string | null;
  project_name: string | null;
  contractor_name: string | null;
  assigned_to_name: string | null;
  is_dol_reportable: boolean;
  investigation_status: 'pending' | 'in_progress' | 'completed' | null;
  created_at: string;
}

// Constants for ticket type and source (to add to maintenance module)
export const HS_TICKET_TYPES = {
  HSE_INCIDENT: 'hse_incident',
  HSE_NEAR_MISS: 'hse_near_miss',
} as const;

export const HS_TICKET_SOURCE = 'hse_report' as const;

// H&S ticket type configuration (for UI)
export const HS_TICKET_TYPE_CONFIG = {
  [HS_TICKET_TYPES.HSE_INCIDENT]: {
    value: HS_TICKET_TYPES.HSE_INCIDENT,
    label: 'H&S Incident',
    description: 'Health & Safety incident requiring investigation',
    icon: 'AlertTriangle',
    color: 'red',
    requiresDR: false,
    defaultPriority: 'urgent',
  },
  [HS_TICKET_TYPES.HSE_NEAR_MISS]: {
    value: HS_TICKET_TYPES.HSE_NEAR_MISS,
    label: 'H&S Near Miss',
    description: 'Near miss for tracking and prevention',
    icon: 'AlertCircle',
    color: 'amber',
    requiresDR: false,
    defaultPriority: 'high',
  },
};
