/**
 * Ticketing Module - Guarantee & Billing Types
 * 🟢 WORKING: Type definitions match database schema from migrations
 *
 * Defines TypeScript types for guarantee periods, classifications,
 * and billing determinations.
 */

import { GuaranteeStatus } from './ticket';

/**
 * Guarantee Period Configuration
 * Defines guarantee rules per project
 */
export interface GuaranteePeriod {
  // Primary identification
  id: string; // UUID
  project_id: string; // UUID reference to projects

  // Guarantee rules
  installation_guarantee_days: number; // Default: 90 days
  material_guarantee_days: number; // Default: 365 days

  // Billing rules
  contractor_liable_during_guarantee: boolean;
  auto_classify_out_of_guarantee: boolean;

  // Timestamps
  created_at: Date;
  updated_at: Date;
}

/**
 * Create guarantee period payload
 */
export interface CreateGuaranteePeriodPayload {
  project_id: string;
  installation_guarantee_days?: number;
  material_guarantee_days?: number;
  contractor_liable_during_guarantee?: boolean;
  auto_classify_out_of_guarantee?: boolean;
}

/**
 * Update guarantee period payload
 */
export interface UpdateGuaranteePeriodPayload {
  installation_guarantee_days?: number;
  material_guarantee_days?: number;
  contractor_liable_during_guarantee?: boolean;
  auto_classify_out_of_guarantee?: boolean;
}

/**
 * Guarantee classification result
 */
export interface GuaranteeClassification {
  ticket_id: string;
  status: GuaranteeStatus;
  expires_at: Date | null;
  is_billable: boolean;
  billing_classification: BillingClassification;
  days_remaining: number | null;
  contractor_liable: boolean;
  reason: string;
}

/**
 * Billing classification types
 */
export enum BillingClassification {
  CONTRACTOR_UNDER_GUARANTEE = 'contractor_under_guarantee',
  CLIENT_OUT_OF_GUARANTEE = 'client_out_of_guarantee',
  CLIENT_DAMAGE = 'client_damage',
  THIRD_PARTY_DAMAGE = 'third_party_damage',
  WARRANTY_CLAIM = 'warranty_claim',
  FREE_OF_CHARGE = 'free_of_charge',
  PENDING_CLASSIFICATION = 'pending_classification',
}

/**
 * Guarantee expiry calculation input
 */
export interface GuaranteeExpiryInput {
  installation_date: Date;
  ticket_type: 'installation' | 'material';
  project_id: string;
}

/**
 * Guarantee expiry calculation result
 */
export interface GuaranteeExpiryResult {
  expires_at: Date;
  days_from_installation: number;
  is_expired: boolean;
  days_remaining: number;
}

/**
 * Contractor liability assessment
 */
export interface ContractorLiabilityAssessment {
  is_liable: boolean;
  reason: string;
  guarantee_status: GuaranteeStatus;
  fault_cause: string | null;
  billing_impact: 'contractor_pays' | 'client_pays' | 'pending';
}
