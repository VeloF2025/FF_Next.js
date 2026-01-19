/**
 * Ticketing Module - 12 Standard Verification Steps
 * 🟢 WORKING: Defines the 12-step verification checklist for ticket completion
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
  category: 'preparation' | 'installation' | 'testing' | 'documentation';
}

/**
 * 12 Standard Verification Steps
 * 🟢 WORKING: Complete verification checklist based on fiber installation best practices
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
 * 🟢 WORKING: Complete ordered list of steps
 */
export const VERIFICATION_STEPS = Object.values(VERIFICATION_STEP_TEMPLATES).sort(
  (a, b) => a.step_number - b.step_number
);

/**
 * Total number of verification steps
 * 🟢 WORKING: Constant for progress calculation
 */
export const TOTAL_VERIFICATION_STEPS = 12;

/**
 * Steps that require photos
 * 🟢 WORKING: Filter for photo-required steps
 */
export const PHOTO_REQUIRED_STEPS = VERIFICATION_STEPS.filter(
  (step) => step.photo_required
);

/**
 * Steps required for QA
 * 🟢 WORKING: Critical steps that must be complete before QA
 */
export const QA_REQUIRED_STEPS = VERIFICATION_STEPS.filter(
  (step) => step.required_for_qa
);

/**
 * Steps by category
 * 🟢 WORKING: Grouped steps for organized display
 */
export const VERIFICATION_STEPS_BY_CATEGORY = {
  preparation: VERIFICATION_STEPS.filter((step) => step.category === 'preparation'),
  installation: VERIFICATION_STEPS.filter((step) => step.category === 'installation'),
  testing: VERIFICATION_STEPS.filter((step) => step.category === 'testing'),
  documentation: VERIFICATION_STEPS.filter((step) => step.category === 'documentation'),
};

/**
 * Minimum required photos for QA
 * 🟢 WORKING: Minimum photo count for QA readiness
 */
export const MINIMUM_REQUIRED_PHOTOS = PHOTO_REQUIRED_STEPS.length;

/**
 * Helper functions
 * 🟢 WORKING: Utility functions for verification steps
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
 * 🟢 WORKING: Helper to calculate progress from completed steps
 */
export function calculateVerificationProgress(completedSteps: number): number {
  return Math.round((completedSteps / TOTAL_VERIFICATION_STEPS) * 100);
}

/**
 * Format verification progress (e.g., "7/12")
 * 🟢 WORKING: Helper to format progress for display
 */
export function formatVerificationProgress(completedSteps: number): string {
  return `${completedSteps}/${TOTAL_VERIFICATION_STEPS}`;
}

/**
 * Check if all verification steps are complete
 * 🟢 WORKING: Helper to check completion status
 */
export function areAllStepsComplete(completedSteps: number): boolean {
  return completedSteps === TOTAL_VERIFICATION_STEPS;
}

/**
 * Get step category color for UI
 * 🟢 WORKING: Helper for color-coded category display
 */
export function getStepCategoryColor(
  category: 'preparation' | 'installation' | 'testing' | 'documentation'
): 'primary' | 'secondary' | 'success' | 'info' {
  const categoryColors = {
    preparation: 'info' as const,
    installation: 'primary' as const,
    testing: 'success' as const,
    documentation: 'secondary' as const,
  };
  return categoryColors[category];
}

/**
 * Verification step validation rules
 * 🟢 WORKING: Rules for step completion validation
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
 * Validation rules per step
 * 🟢 WORKING: Detailed validation requirements
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
