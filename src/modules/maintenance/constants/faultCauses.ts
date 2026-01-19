/**
 * Ticketing Module - Fault Cause Categories
 * 🟢 WORKING: 7 fault attribution categories for maintenance tickets
 *
 * Critical for preventing blanket contractor blame and enabling
 * accurate trend analysis. Required on all maintenance tickets.
 */

import { FaultCause } from '../types/ticket';

/**
 * Fault cause metadata
 */
export interface FaultCauseMetadata {
  value: FaultCause;
  label: string;
  description: string;
  examples: string[];
  color: 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success';
  requiresDetails: boolean; // Does this fault cause require additional details?
  contractorLiable: boolean; // Is contractor typically liable for this fault type?
}

/**
 * Complete fault cause definitions
 * 🟢 WORKING: All 7 fault categories with attribution guidance
 */
export const FAULT_CAUSE_DEFINITIONS: Record<FaultCause, FaultCauseMetadata> = {
  [FaultCause.WORKMANSHIP]: {
    value: FaultCause.WORKMANSHIP,
    label: 'Workmanship',
    description: 'Poor installation quality or incorrect procedures by contractor',
    examples: [
      'Improper fiber splicing',
      'Loose connections',
      'Incorrect cable routing',
      'Poor weather sealing',
      'Installation not per specification',
    ],
    color: 'error',
    requiresDetails: true,
    contractorLiable: true,
  },
  [FaultCause.MATERIAL_FAILURE]: {
    value: FaultCause.MATERIAL_FAILURE,
    label: 'Material Failure',
    description: 'Equipment or material defect (Homedrop, Fiber, ONT, Gizzu, etc.)',
    examples: [
      'Defective ONT device',
      'Faulty fiber cable',
      'Failed Gizzu enclosure',
      'Broken connector',
      'Defective drop cable',
    ],
    color: 'warning',
    requiresDetails: true,
    contractorLiable: false,
  },
  [FaultCause.CLIENT_DAMAGE]: {
    value: FaultCause.CLIENT_DAMAGE,
    label: 'Client Damage',
    description: 'Damage caused by customer actions',
    examples: [
      'Customer unplugged ONT',
      'Cable cut by customer',
      'ONT moved by customer',
      'Power supply removed',
      'Fiber cable damaged during customer renovation',
    ],
    color: 'info',
    requiresDetails: true,
    contractorLiable: false,
  },
  [FaultCause.THIRD_PARTY]: {
    value: FaultCause.THIRD_PARTY,
    label: 'Third Party Damage',
    description: 'Damage caused by external parties (not customer)',
    examples: [
      'Cable cut by excavation',
      'Damage by municipality workers',
      'Construction vehicle damage',
      'Pole damage by vehicle collision',
      'Cable severed by tree trimming service',
    ],
    color: 'warning',
    requiresDetails: true,
    contractorLiable: false,
  },
  [FaultCause.ENVIRONMENTAL]: {
    value: FaultCause.ENVIRONMENTAL,
    label: 'Environmental',
    description: 'Natural causes (wind, storm, water, lightning)',
    examples: [
      'Wind damage to aerial cable',
      'Lightning strike',
      'Water ingress from rain',
      'Storm damage',
      'Tree branch falling on cable',
    ],
    color: 'default',
    requiresDetails: true,
    contractorLiable: false,
  },
  [FaultCause.VANDALISM]: {
    value: FaultCause.VANDALISM,
    label: 'Vandalism',
    description: 'Intentional malicious damage',
    examples: [
      'Cable intentionally cut',
      'ONT stolen',
      'Equipment deliberately damaged',
      'Gizzu box vandalized',
      'Fiber cable stripped',
    ],
    color: 'error',
    requiresDetails: true,
    contractorLiable: false,
  },
  [FaultCause.UNKNOWN]: {
    value: FaultCause.UNKNOWN,
    label: 'Unknown',
    description: 'Cannot determine root cause (requires investigation)',
    examples: [
      'Intermittent signal loss - cause unclear',
      'Equipment failure - root cause unknown',
      'No visible damage - investigating',
    ],
    color: 'default',
    requiresDetails: true,
    contractorLiable: false,
  },
};

/**
 * Array of all fault causes
 * 🟢 WORKING: Complete list for dropdowns
 */
export const FAULT_CAUSES = Object.values(FaultCause);

/**
 * Fault cause options for dropdowns
 * 🟢 WORKING: Ordered list for UI display
 */
export const FAULT_CAUSE_OPTIONS = Object.values(FAULT_CAUSE_DEFINITIONS);

/**
 * Fault causes that indicate contractor liability
 * 🟢 WORKING: Filter for contractor-liable faults
 */
export const CONTRACTOR_LIABLE_FAULT_CAUSES = FAULT_CAUSES.filter(
  (cause) => FAULT_CAUSE_DEFINITIONS[cause].contractorLiable
);

/**
 * Fault causes that do NOT indicate contractor liability
 * 🟢 WORKING: Filter for non-contractor faults
 */
export const NON_CONTRACTOR_FAULT_CAUSES = FAULT_CAUSES.filter(
  (cause) => !FAULT_CAUSE_DEFINITIONS[cause].contractorLiable
);

/**
 * Fault causes that should trigger special handling
 * 🟢 WORKING: Faults requiring escalation or special attention
 */
export const ESCALATION_FAULT_CAUSES = [
  FaultCause.MATERIAL_FAILURE, // May indicate supplier issue
  FaultCause.VANDALISM, // May need security measures
];

/**
 * Helper functions
 * 🟢 WORKING: Utility functions for fault cause metadata
 */

export function getFaultCauseMetadata(cause: FaultCause): FaultCauseMetadata {
  return FAULT_CAUSE_DEFINITIONS[cause];
}

export function getFaultCauseLabel(cause: FaultCause): string {
  return FAULT_CAUSE_DEFINITIONS[cause].label;
}

export function getFaultCauseDescription(cause: FaultCause): string {
  return FAULT_CAUSE_DEFINITIONS[cause].description;
}

export function getFaultCauseExamples(cause: FaultCause): string[] {
  return FAULT_CAUSE_DEFINITIONS[cause].examples;
}

/**
 * Check if fault cause requires additional details
 * 🟢 WORKING: Helper to check if details field is mandatory
 */
export function faultCauseRequiresDetails(cause: FaultCause): boolean {
  return FAULT_CAUSE_DEFINITIONS[cause].requiresDetails;
}

/**
 * Check if contractor is liable for fault cause
 * 🟢 WORKING: Helper to determine contractor liability
 */
export function isContractorLiable(cause: FaultCause): boolean {
  return FAULT_CAUSE_DEFINITIONS[cause].contractorLiable;
}

/**
 * Check if fault cause should trigger escalation
 * 🟢 WORKING: Helper to identify faults needing escalation
 */
export function shouldEscalateFaultCause(cause: FaultCause): boolean {
  return ESCALATION_FAULT_CAUSES.includes(cause);
}

/**
 * Fault cause statistics interface
 * For trend analysis and reporting
 */
export interface FaultCauseStats {
  cause: FaultCause;
  count: number;
  percentage: number;
  contractorLiable: boolean;
}

/**
 * Fault trend filters
 * 🟢 WORKING: Common filters for fault analysis
 */
export const FAULT_TREND_FILTERS = {
  ALL: 'all',
  CONTRACTOR_LIABLE: 'contractor_liable',
  NON_CONTRACTOR: 'non_contractor',
  MATERIAL_ISSUES: 'material_issues',
  EXTERNAL_DAMAGE: 'external_damage',
} as const;

export type FaultTrendFilter = typeof FAULT_TREND_FILTERS[keyof typeof FAULT_TREND_FILTERS];
