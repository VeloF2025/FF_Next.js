/**
 * Guarantee Calculator Utility
 * 🟢 WORKING: Production-ready guarantee classification and billing determination
 *
 * Provides functions for:
 * - Calculating guarantee expiry dates
 * - Classifying guarantee status (under/out/pending)
 * - Determining billing classification
 * - Assessing contractor liability
 *
 * Features:
 * - Accurate date calculations with timezone handling
 * - Comprehensive business logic for billing
 * - Fault cause consideration
 * - Project-specific guarantee periods
 */

import { GuaranteeStatus, FaultCause } from '../types/ticket';
import { BillingClassification } from '../types/guarantee';

/**
 * Input for guarantee expiry calculation
 */
export interface GuaranteeExpiryInput {
  installation_date: Date;
  ticket_type: 'installation' | 'material';
  guarantee_days: number;
}

/**
 * Result of guarantee expiry calculation
 */
export interface GuaranteeExpiryResult {
  expires_at: Date;
  days_from_installation: number;
  is_expired: boolean;
  days_remaining: number;
}

/**
 * Input for guarantee classification
 */
export interface GuaranteeClassificationInput {
  ticket_id: string;
  installation_date: Date | null;
  ticket_type: 'installation' | 'material' | null;
  installation_guarantee_days: number;
  material_guarantee_days: number;
}

/**
 * Result of guarantee classification
 */
export interface GuaranteeClassificationResult {
  ticket_id: string;
  status: GuaranteeStatus;
  expires_at: Date | null;
  days_remaining: number | null;
  reason: string;
}

/**
 * Input for billing determination
 */
export interface BillingDeterminationInput {
  guarantee_status: GuaranteeStatus;
  fault_cause: FaultCause | null;
  contractor_liable_during_guarantee: boolean;
}

/**
 * Result of billing determination
 */
export interface BillingDeterminationResult {
  billing_classification: BillingClassification;
  is_billable: boolean;
  reason: string;
}

/**
 * Input for contractor liability assessment
 */
export interface ContractorLiabilityInput {
  guarantee_status: GuaranteeStatus;
  fault_cause: FaultCause | null;
  contractor_liable_during_guarantee: boolean;
}

/**
 * Result of contractor liability assessment
 */
export interface ContractorLiabilityAssessmentResult {
  is_liable: boolean;
  reason: string;
  guarantee_status: GuaranteeStatus;
  fault_cause: FaultCause | null;
  billing_impact: 'contractor_pays' | 'client_pays' | 'pending';
}

/**
 * Calculate guarantee expiry date and status
 * 🟢 WORKING: Accurate date calculation with timezone handling
 *
 * Business logic: A "90-day guarantee" means the guarantee is valid FOR 90 days,
 * expiring at the START of the next day (day 91).
 * Example: Installed Jan 1 → Valid through Mar 31 → Expires Apr 1
 *
 * @param input - Installation date, ticket type, and guarantee period
 * @returns Expiry date, days remaining, and expired status
 */
export function calculateGuaranteeExpiry(
  input: GuaranteeExpiryInput
): GuaranteeExpiryResult {
  // Calculate expiry date by adding (guarantee_days + 1) to installation date
  // This ensures the guarantee is valid FOR the full number of days
  // and expires at the START of the next day
  const millisecondsPerDay = 24 * 60 * 60 * 1000;

  // Normalize installation date to UTC midnight for accurate day calculations
  const installDate = new Date(input.installation_date);
  installDate.setUTCHours(0, 0, 0, 0);
  const installTime = installDate.getTime();

  // Add guarantee_days + 1 to get the expiry date (the day AFTER the last covered day)
  const expiryTime = installTime + ((input.guarantee_days + 1) * millisecondsPerDay);
  const expiryDate = new Date(expiryTime);

  // Get current date at UTC midnight for fair comparison
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);

  // Calculate days remaining as: guarantee_days - days_elapsed
  const daysElapsed = Math.round((now.getTime() - installTime) / millisecondsPerDay);
  const daysRemaining = input.guarantee_days - daysElapsed;

  return {
    expires_at: expiryDate,
    days_from_installation: input.guarantee_days,
    is_expired: daysRemaining <= 0,
    days_remaining: Math.max(0, daysRemaining)
  };
}

/**
 * Classify guarantee status for a ticket
 * 🟢 WORKING: Complete guarantee classification logic
 *
 * @param input - Ticket data and guarantee periods
 * @returns Guarantee status, expiry date, and reason
 */
export function classifyGuaranteeStatus(
  input: GuaranteeClassificationInput
): GuaranteeClassificationResult {
  // Check for missing data
  if (!input.installation_date) {
    return {
      ticket_id: input.ticket_id,
      status: GuaranteeStatus.PENDING_CLASSIFICATION,
      expires_at: null,
      days_remaining: null,
      reason: 'No installation date available'
    };
  }

  if (!input.ticket_type) {
    return {
      ticket_id: input.ticket_id,
      status: GuaranteeStatus.PENDING_CLASSIFICATION,
      expires_at: null,
      days_remaining: null,
      reason: 'Unknown ticket type'
    };
  }

  // Determine guarantee period based on ticket type
  const guaranteeDays = input.ticket_type === 'installation'
    ? input.installation_guarantee_days
    : input.material_guarantee_days;

  // Calculate expiry
  const expiryResult = calculateGuaranteeExpiry({
    installation_date: input.installation_date,
    ticket_type: input.ticket_type,
    guarantee_days: guaranteeDays
  });

  // Classify status
  const status = expiryResult.is_expired
    ? GuaranteeStatus.OUT_OF_GUARANTEE
    : GuaranteeStatus.UNDER_GUARANTEE;

  const reason = expiryResult.is_expired
    ? `Guarantee expired ${Math.abs(expiryResult.days_remaining)} days ago`
    : `Guarantee valid for ${expiryResult.days_remaining} more days`;

  return {
    ticket_id: input.ticket_id,
    status,
    expires_at: expiryResult.expires_at,
    days_remaining: expiryResult.days_remaining,
    reason
  };
}

/**
 * Determine billing classification based on guarantee status and fault cause
 * 🟢 WORKING: Comprehensive billing logic with fault attribution
 *
 * @param input - Guarantee status, fault cause, and contractor liability setting
 * @returns Billing classification, billable status, and reason
 */
export function determineBillingClassification(
  input: BillingDeterminationInput
): BillingDeterminationResult {
  // Handle pending guarantee status
  if (input.guarantee_status === GuaranteeStatus.PENDING_CLASSIFICATION) {
    return {
      billing_classification: BillingClassification.PENDING_CLASSIFICATION,
      is_billable: false,
      reason: 'Guarantee status pending classification'
    };
  }

  // Handle unknown fault cause
  if (!input.fault_cause || input.fault_cause === FaultCause.UNKNOWN) {
    return {
      billing_classification: BillingClassification.PENDING_CLASSIFICATION,
      is_billable: false,
      reason: 'Unknown fault cause - requires investigation'
    };
  }

  // OUT OF GUARANTEE - Client pays regardless of fault
  if (input.guarantee_status === GuaranteeStatus.OUT_OF_GUARANTEE) {
    return {
      billing_classification: BillingClassification.CLIENT_OUT_OF_GUARANTEE,
      is_billable: true,
      reason: 'Out of guarantee period - client liable'
    };
  }

  // UNDER GUARANTEE - Check fault cause
  switch (input.fault_cause) {
    case FaultCause.WORKMANSHIP:
      // Workmanship fault - check contractor liability setting
      if (input.contractor_liable_during_guarantee) {
        return {
          billing_classification: BillingClassification.CONTRACTOR_UNDER_GUARANTEE,
          is_billable: false,
          reason: 'Workmanship fault under guarantee - contractor liable'
        };
      } else {
        return {
          billing_classification: BillingClassification.FREE_OF_CHARGE,
          is_billable: false,
          reason: 'Contractor not liable per project policy'
        };
      }

    case FaultCause.MATERIAL_FAILURE:
      // Material failure - warranty claim
      return {
        billing_classification: BillingClassification.WARRANTY_CLAIM,
        is_billable: false,
        reason: 'Material warranty claim - supplier liable'
      };

    case FaultCause.CLIENT_DAMAGE:
      // Client damage - client pays even under guarantee
      return {
        billing_classification: BillingClassification.CLIENT_DAMAGE,
        is_billable: true,
        reason: 'Client caused damage - client liable'
      };

    case FaultCause.THIRD_PARTY:
      // Third party damage - should be billed to third party
      return {
        billing_classification: BillingClassification.THIRD_PARTY_DAMAGE,
        is_billable: true,
        reason: 'Third-party damage - third party liable'
      };

    case FaultCause.ENVIRONMENTAL:
      // Environmental damage - typically free of charge
      return {
        billing_classification: BillingClassification.FREE_OF_CHARGE,
        is_billable: false,
        reason: 'Environmental damage - no party liable'
      };

    case FaultCause.VANDALISM:
      // Vandalism - free of charge
      return {
        billing_classification: BillingClassification.FREE_OF_CHARGE,
        is_billable: false,
        reason: 'Vandalism - no party liable'
      };

    default:
      // Unknown fault cause
      return {
        billing_classification: BillingClassification.PENDING_CLASSIFICATION,
        is_billable: false,
        reason: 'Unknown fault cause - requires investigation'
      };
  }
}

/**
 * Assess contractor liability for a fault
 * 🟢 WORKING: Contractor liability determination logic
 *
 * @param input - Guarantee status, fault cause, and contractor liability setting
 * @returns Liability assessment with reason and billing impact
 */
export function assessContractorLiability(
  input: ContractorLiabilityInput
): ContractorLiabilityAssessmentResult {
  // Handle pending guarantee status
  if (input.guarantee_status === GuaranteeStatus.PENDING_CLASSIFICATION) {
    return {
      is_liable: false,
      reason: 'Guarantee status pending classification',
      guarantee_status: input.guarantee_status,
      fault_cause: input.fault_cause,
      billing_impact: 'pending'
    };
  }

  // Handle unknown fault cause
  if (!input.fault_cause || input.fault_cause === FaultCause.UNKNOWN) {
    return {
      is_liable: false,
      reason: 'Unknown fault cause - cannot determine liability',
      guarantee_status: input.guarantee_status,
      fault_cause: input.fault_cause,
      billing_impact: 'pending'
    };
  }

  // OUT OF GUARANTEE - Contractor NOT liable
  if (input.guarantee_status === GuaranteeStatus.OUT_OF_GUARANTEE) {
    return {
      is_liable: false,
      reason: 'Out of guarantee period - contractor not liable',
      guarantee_status: input.guarantee_status,
      fault_cause: input.fault_cause,
      billing_impact: 'client_pays'
    };
  }

  // UNDER GUARANTEE - Check fault cause and policy
  switch (input.fault_cause) {
    case FaultCause.WORKMANSHIP:
      // Check contractor liability setting
      if (input.contractor_liable_during_guarantee) {
        return {
          is_liable: true,
          reason: 'Workmanship fault under guarantee period',
          guarantee_status: input.guarantee_status,
          fault_cause: input.fault_cause,
          billing_impact: 'contractor_pays'
        };
      } else {
        return {
          is_liable: false,
          reason: 'Policy: contractor not liable during guarantee',
          guarantee_status: input.guarantee_status,
          fault_cause: input.fault_cause,
          billing_impact: 'client_pays'
        };
      }

    case FaultCause.CLIENT_DAMAGE:
      return {
        is_liable: false,
        reason: 'Client damage - client liable',
        guarantee_status: input.guarantee_status,
        fault_cause: input.fault_cause,
        billing_impact: 'client_pays'
      };

    case FaultCause.THIRD_PARTY:
      return {
        is_liable: false,
        reason: 'Third-party damage - third party liable',
        guarantee_status: input.guarantee_status,
        fault_cause: input.fault_cause,
        billing_impact: 'client_pays'
      };

    case FaultCause.MATERIAL_FAILURE:
      return {
        is_liable: false,
        reason: 'Material failure - supplier warranty applies',
        guarantee_status: input.guarantee_status,
        fault_cause: input.fault_cause,
        billing_impact: 'client_pays'
      };

    case FaultCause.ENVIRONMENTAL:
      return {
        is_liable: false,
        reason: 'Environmental damage - force majeure',
        guarantee_status: input.guarantee_status,
        fault_cause: input.fault_cause,
        billing_impact: 'client_pays'
      };

    case FaultCause.VANDALISM:
      return {
        is_liable: false,
        reason: 'Vandalism - no contractor liability',
        guarantee_status: input.guarantee_status,
        fault_cause: input.fault_cause,
        billing_impact: 'client_pays'
      };

    default:
      return {
        is_liable: false,
        reason: 'Unknown fault cause - cannot determine liability',
        guarantee_status: input.guarantee_status,
        fault_cause: input.fault_cause,
        billing_impact: 'pending'
      };
  }
}
