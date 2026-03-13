/**
 * Maintenance Module - Verification Step Templates
 * // WORKING: Defines step checklists for all ticket types
 *
 * Standard verification workflow for fiber installations and maintenance.
 * Each step must be completed and verified before QA approval.
 */

import { VerificationStepNumber } from '../types/verification';

/**
 * Verification step template
 */
export interface VerificationStepTemplate {
  step_number: VerificationStepNumber;
  step_name: string;
  step_description: string;
  photo_required: boolean;
  required_for_qa: boolean;
  category: 'preparation' | 'installation' | 'testing' | 'documentation' | 'investigation';
}

/**
 * 12 Standard Verification Steps (new_installation default)
 * // WORKING: Complete verification checklist based on fiber installation best practices
 */
export const VERIFICATION_STEP_TEMPLATES: Record<VerificationStepNumber, VerificationStepTemplate> = {
  1: {
    step_number: 1,
    step_name: 'Site Assessment',
    step_description: 'Verify site conditions, access, and DR location. Confirm pole, PON, and zone details.',
    photo_required: true,
    required_for_qa: true,
    category: 'preparation',
  },
  2: {
    step_number: 2,
    step_name: 'Material Verification',
    step_description: 'Verify all required materials are available and correct (fiber, ONT, Gizzu, cables, connectors).',
    photo_required: true,
    required_for_qa: true,
    category: 'preparation',
  },
  3: {
    step_number: 3,
    step_name: 'Fiber Installation',
    step_description: 'Install fiber drop from PON to customer premises. Ensure proper routing, securing, and protection.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  4: {
    step_number: 4,
    step_name: 'Fiber Splicing',
    step_description: 'Splice fiber connection at PON. Verify splice quality and protection.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  5: {
    step_number: 5,
    step_name: 'ONT Installation',
    step_description: 'Install ONT at customer premises. Verify mounting, power supply, and cable connections.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  6: {
    step_number: 6,
    step_name: 'Fiber Termination',
    step_description: 'Terminate fiber at ONT. Ensure clean, secure connection and proper strain relief.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  7: {
    step_number: 7,
    step_name: 'ONT Activation & Testing',
    step_description: 'Power on ONT, verify activation, and check signal levels. Record ONT serial and RX power level.',
    photo_required: true,
    required_for_qa: true,
    category: 'testing',
  },
  8: {
    step_number: 8,
    step_name: 'Signal Quality Test',
    step_description: 'Measure and record fiber RX/TX power levels. Verify within acceptable range (-28dBm to -8dBm).',
    photo_required: true,
    required_for_qa: true,
    category: 'testing',
  },
  9: {
    step_number: 9,
    step_name: 'End-to-End Connectivity',
    step_description: 'Test internet connectivity, speed, and stability. Verify customer can access services.',
    photo_required: false,
    required_for_qa: true,
    category: 'testing',
  },
  10: {
    step_number: 10,
    step_name: 'Cable Management & Labeling',
    step_description: 'Ensure proper cable management, labeling, and weather protection. Label ONT and connections.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  11: {
    step_number: 11,
    step_name: 'Site Cleanup',
    step_description: 'Remove all waste materials, excess cable, and packaging. Leave site clean and safe.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  12: {
    step_number: 12,
    step_name: 'Documentation & Handover',
    step_description: 'Complete all documentation, update SOW tracker, take as-built photos, and obtain customer sign-off.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
};

/**
 * Array of all verification steps (ordered 1-12)
 * // WORKING: Complete ordered list of steps
 */
export const VERIFICATION_STEPS = Object.values(VERIFICATION_STEP_TEMPLATES).sort(
  (a, b) => a.step_number - b.step_number
);

/**
 * Total number of verification steps (default: new_installation)
 * // WORKING: Constant for progress calculation — use steps.length for type-specific progress
 */
export const TOTAL_VERIFICATION_STEPS = 12;

/**
 * Steps that require photos
 * // WORKING: Filter for photo-required steps
 */
export const PHOTO_REQUIRED_STEPS = VERIFICATION_STEPS.filter(
  (step) => step.photo_required
);

/**
 * Steps required for QA
 * // WORKING: Critical steps that must be complete before QA
 */
export const QA_REQUIRED_STEPS = VERIFICATION_STEPS.filter(
  (step) => step.required_for_qa
);

/**
 * Steps by category
 * // WORKING: Grouped steps for organized display
 */
export const VERIFICATION_STEPS_BY_CATEGORY = {
  preparation: VERIFICATION_STEPS.filter((step) => step.category === 'preparation'),
  installation: VERIFICATION_STEPS.filter((step) => step.category === 'installation'),
  testing: VERIFICATION_STEPS.filter((step) => step.category === 'testing'),
  documentation: VERIFICATION_STEPS.filter((step) => step.category === 'documentation'),
};

/**
 * Minimum required photos for QA
 * // WORKING: Minimum photo count for QA readiness
 */
export const MINIMUM_REQUIRED_PHOTOS = PHOTO_REQUIRED_STEPS.length;

/**
 * Type-specific step definitions for fault_repair tickets
 */
const FAULT_REPAIR_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Fault Assessment',
    step_description: 'Document the fault, affected services, and symptoms. Take photos of the issue.',
    photo_required: true,
    required_for_qa: true,
    category: 'preparation',
  },
  {
    step_number: 2,
    step_name: 'Safety Check',
    step_description: 'Verify safe working conditions at site.',
    photo_required: false,
    required_for_qa: true,
    category: 'preparation',
  },
  {
    step_number: 3,
    step_name: 'Root Cause Identification',
    step_description: 'Identify what caused the fault (cut fiber, damaged ONT, power issue).',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 4,
    step_name: 'Repair Work',
    step_description: 'Perform the repair (splice, replace, re-route). Document work done.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  {
    step_number: 5,
    step_name: 'Signal Verification',
    step_description: 'Test signal levels after repair. RX power within range (-28dBm to -8dBm).',
    photo_required: true,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 6,
    step_name: 'Connectivity Test',
    step_description: 'Verify end-to-end connectivity restored. Customer can access services.',
    photo_required: false,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 7,
    step_name: 'Documentation',
    step_description: 'Document repair, update records, before/after photos.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for ont_swap tickets
 */
const ONT_SWAP_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Current ONT Documentation',
    step_description: 'Record old ONT serial number and current RX power level.',
    photo_required: true,
    required_for_qa: true,
    category: 'preparation',
  },
  {
    step_number: 2,
    step_name: 'ONT Removal',
    step_description: 'Safely remove the old ONT device.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  {
    step_number: 3,
    step_name: 'New ONT Installation',
    step_description: 'Install replacement ONT. Verify mounting and cable connections.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  {
    step_number: 4,
    step_name: 'ONT Activation',
    step_description: 'Activate new ONT on OLT. Record new serial number.',
    photo_required: true,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 5,
    step_name: 'Signal Verification',
    step_description: 'Verify signal levels. RX power within acceptable range.',
    photo_required: true,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 6,
    step_name: 'Connectivity Test',
    step_description: 'Test internet connectivity. Verify customer can access services.',
    photo_required: false,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 7,
    step_name: 'System Update',
    step_description: 'Update ONT serial in 1Map and all tracking systems.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for modification tickets
 */
const MODIFICATION_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Current State Assessment',
    step_description: 'Document existing installation before modification.',
    photo_required: true,
    required_for_qa: true,
    category: 'preparation',
  },
  {
    step_number: 2,
    step_name: 'Modification Planning',
    step_description: 'Confirm scope of changes with customer/project manager.',
    photo_required: false,
    required_for_qa: true,
    category: 'preparation',
  },
  {
    step_number: 3,
    step_name: 'Modification Work',
    step_description: 'Perform the modification (relocation, upgrade, re-route).',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  {
    step_number: 4,
    step_name: 'Signal Verification',
    step_description: 'Test signal levels after modification.',
    photo_required: true,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 5,
    step_name: 'Connectivity Test',
    step_description: 'Verify end-to-end connectivity.',
    photo_required: false,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 6,
    step_name: 'Documentation',
    step_description: 'Update all records to reflect changes. Take as-built photos.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for incident tickets
 */
const INCIDENT_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Incident Assessment',
    step_description: 'Document scope, affected area, and number of customers impacted.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 2,
    step_name: 'Impact Analysis',
    step_description: 'Determine severity and business impact. List affected DRs/PONs.',
    photo_required: false,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 3,
    step_name: 'Root Cause Investigation',
    step_description: 'Identify root cause of incident.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 4,
    step_name: 'Containment Actions',
    step_description: 'Implement immediate containment to limit impact.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  {
    step_number: 5,
    step_name: 'Service Restoration',
    step_description: 'Fix the issue and restore services.',
    photo_required: true,
    required_for_qa: true,
    category: 'installation',
  },
  {
    step_number: 6,
    step_name: 'Verification',
    step_description: 'Verify all affected services are restored.',
    photo_required: false,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 7,
    step_name: 'Incident Report',
    step_description: 'Complete incident report with timeline, root cause, and preventive actions.',
    photo_required: false,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for olt_investigation tickets
 */
const OLT_INVESTIGATION_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'OLT Data Review',
    step_description: 'Review OLT report data for this DR. Confirm mismatch details.',
    photo_required: false,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 2,
    step_name: '1Map Cross-Reference',
    step_description: 'Check 1Map for the DR. Verify current serial recorded.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 3,
    step_name: 'Physical ONT Verification',
    step_description: 'Visit site if needed. Physically verify ONT serial on device.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 4,
    step_name: 'Resolution',
    step_description: 'Update records (fix serial in 1Map, mark as resolved, or escalate).',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for serial_mismatch tickets
 */
const SERIAL_MISMATCH_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Serial Data Review',
    step_description: 'Compare OLT serial, 1Map serial, and OES records for this DR.',
    photo_required: false,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 2,
    step_name: 'Physical ONT Check',
    step_description: 'Visit site, photograph ONT serial label to confirm actual serial.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 3,
    step_name: 'Resolution Action',
    step_description: 'Update the correct serial in 1Map/tracking systems.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for pre_provision tickets
 */
const PRE_PROVISION_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'OES Data Review',
    step_description: 'Review Pre-Provision data from OES. Check activation status.',
    photo_required: false,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 2,
    step_name: '1Map Search',
    step_description: 'Search 1Map for the ONT serial. Verify if DR exists.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 3,
    step_name: 'Status Resolution',
    step_description: 'Determine actual activation status. Update resolution.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for hse_incident tickets
 */
const HSE_INCIDENT_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Scene Documentation',
    step_description: 'Photograph the incident scene from multiple angles.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 2,
    step_name: 'Injury/Damage Assessment',
    step_description: 'Document any injuries or property damage.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 3,
    step_name: 'Witness Statements',
    step_description: 'Collect statements from witnesses and involved parties.',
    photo_required: false,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 4,
    step_name: 'Root Cause Analysis',
    step_description: 'Investigate contributing factors and root cause.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 5,
    step_name: 'Corrective Actions',
    step_description: 'Document immediate corrective actions taken.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
  {
    step_number: 6,
    step_name: 'Regulatory Reporting',
    step_description: 'Complete required regulatory reports if applicable.',
    photo_required: false,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for hse_near_miss tickets
 */
const HSE_NEAR_MISS_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Near Miss Documentation',
    step_description: 'Document what happened and the potential consequence.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 2,
    step_name: 'Contributing Factors',
    step_description: 'Identify hazards and contributing factors.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 3,
    step_name: 'Corrective Actions',
    step_description: 'Document preventive measures implemented.',
    photo_required: false,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Type-specific step definitions for dev_ops tickets
 */
const DEV_OPS_STEPS: VerificationStepTemplate[] = [
  {
    step_number: 1,
    step_name: 'Issue Reproduction',
    step_description: 'Reproduce the reported issue. Confirm environment, URL, and steps.',
    photo_required: true,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 2,
    step_name: 'Root Cause Analysis',
    step_description: 'Identify the root cause. Check logs, stack traces, and related code.',
    photo_required: false,
    required_for_qa: true,
    category: 'investigation',
  },
  {
    step_number: 3,
    step_name: 'Fix Implementation',
    step_description: 'Implement the fix on a feature branch. Link PR to ticket.',
    photo_required: false,
    required_for_qa: true,
    category: 'installation',
  },
  {
    step_number: 4,
    step_name: 'Testing & Verification',
    step_description: 'Test the fix in dev environment. Verify the issue is resolved.',
    photo_required: true,
    required_for_qa: true,
    category: 'testing',
  },
  {
    step_number: 5,
    step_name: 'Deployment',
    step_description: 'Deploy fix to production. Verify in production environment.',
    photo_required: true,
    required_for_qa: true,
    category: 'documentation',
  },
];

/**
 * Map of ticket types to their verification step arrays.
 * new_installation uses the default 12-step template.
 * // WORKING: Type-specific step checklists
 */
export const VERIFICATION_STEPS_BY_TICKET_TYPE: Record<string, VerificationStepTemplate[]> = {
  new_installation: VERIFICATION_STEPS,
  fault_repair: FAULT_REPAIR_STEPS,
  ont_swap: ONT_SWAP_STEPS,
  modification: MODIFICATION_STEPS,
  incident: INCIDENT_STEPS,
  olt_investigation: OLT_INVESTIGATION_STEPS,
  serial_mismatch: SERIAL_MISMATCH_STEPS,
  pre_provision: PRE_PROVISION_STEPS,
  hse_incident: HSE_INCIDENT_STEPS,
  hse_near_miss: HSE_NEAR_MISS_STEPS,
  dev_ops: DEV_OPS_STEPS,
};

/**
 * Return the verification step array for the given ticket type.
 * Falls back to the default 12-step new_installation checklist for unknown types.
 *
 * @param ticketType - The `type` column value from maintenance_tickets
 * @returns Ordered array of VerificationStepTemplate
 */
export function getStepsForTicketType(ticketType: string): VerificationStepTemplate[] {
  return VERIFICATION_STEPS_BY_TICKET_TYPE[ticketType] ?? VERIFICATION_STEPS;
}

/**
 * Helper functions
 * // WORKING: Utility functions for verification steps
 */

export function getVerificationStepTemplate(stepNumber: VerificationStepNumber): VerificationStepTemplate {
  return VERIFICATION_STEP_TEMPLATES[stepNumber];
}

export function getVerificationStepName(stepNumber: VerificationStepNumber): string {
  return VERIFICATION_STEP_TEMPLATES[stepNumber].step_name;
}

export function getVerificationStepDescription(stepNumber: VerificationStepNumber): string {
  return VERIFICATION_STEP_TEMPLATES[stepNumber].step_description;
}

export function isPhotoRequired(stepNumber: VerificationStepNumber): boolean {
  return VERIFICATION_STEP_TEMPLATES[stepNumber].photo_required;
}

export function isRequiredForQA(stepNumber: VerificationStepNumber): boolean {
  return VERIFICATION_STEP_TEMPLATES[stepNumber].required_for_qa;
}

/**
 * Calculate verification progress percentage
 * // WORKING: Helper to calculate progress from completed steps
 */
export function calculateVerificationProgress(completedSteps: number): number {
  return Math.round((completedSteps / TOTAL_VERIFICATION_STEPS) * 100);
}

/**
 * Format verification progress (e.g., "7/12")
 * // WORKING: Helper to format progress for display
 */
export function formatVerificationProgress(completedSteps: number): string {
  return `${completedSteps}/${TOTAL_VERIFICATION_STEPS}`;
}

/**
 * Check if all verification steps are complete
 * // WORKING: Helper to check completion status
 */
export function areAllStepsComplete(completedSteps: number): boolean {
  return completedSteps === TOTAL_VERIFICATION_STEPS;
}

/**
 * Get step category color for UI
 * // WORKING: Helper for color-coded category display
 */
export function getStepCategoryColor(
  category: 'preparation' | 'installation' | 'testing' | 'documentation' | 'investigation'
): 'primary' | 'secondary' | 'success' | 'info' | 'warning' {
  const categoryColors = {
    preparation: 'info' as const,
    installation: 'primary' as const,
    testing: 'success' as const,
    documentation: 'secondary' as const,
    investigation: 'warning' as const,
  };
  return categoryColors[category];
}

/**
 * Verification step validation rules
 * // WORKING: Rules for step completion validation
 */
export interface VerificationStepValidation {
  step_number: VerificationStepNumber;
  rules: {
    photo_required: boolean;
    ont_serial_required: boolean;
    rx_level_required: boolean;
    notes_required: boolean;
  };
}

/**
 * Validation rules per step (new_installation default)
 * // WORKING: Detailed validation requirements
 */
export const VERIFICATION_STEP_VALIDATION: Record<VerificationStepNumber, VerificationStepValidation['rules']> = {
  1: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
  2: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
  3: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
  4: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
  5: { photo_required: true, ont_serial_required: true, rx_level_required: false, notes_required: false },
  6: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
  7: { photo_required: true, ont_serial_required: true, rx_level_required: true, notes_required: false },
  8: { photo_required: true, ont_serial_required: false, rx_level_required: true, notes_required: true },
  9: { photo_required: false, ont_serial_required: false, rx_level_required: false, notes_required: false },
  10: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
  11: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
  12: { photo_required: true, ont_serial_required: false, rx_level_required: false, notes_required: false },
};
