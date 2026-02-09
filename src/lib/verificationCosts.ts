/**
 * Verification Cost Utilities
 * Separated from types to avoid circular dependency / initialization issues
 */

import type { VerificationType, VerificationBundle } from '@/types/contractor-verification.types';

export const VERIFICATION_COSTS: Record<VerificationType, number> = {
  cipc_company: 1770,
  id_verification: 510,
  id_photo: 2955,
  criminal_record: 37460,
  pep_sanctions: 2810,
  qualification: 16855,
  drivers_license: 12990,
  adverse_news: 2815,
};

export const BUNDLE_CHECKS: Record<VerificationBundle, VerificationType[]> = {
  basic: ['cipc_company'],
  standard: ['cipc_company', 'id_verification', 'pep_sanctions'],
  enhanced: ['cipc_company', 'id_verification', 'id_photo', 'criminal_record', 'pep_sanctions'],
  full_due_diligence: ['cipc_company', 'id_verification', 'id_photo', 'criminal_record', 'pep_sanctions', 'qualification', 'adverse_news'],
};

export function estimateBundleCost(bundle: VerificationBundle, directorCount: number): number {
  const checks = BUNDLE_CHECKS[bundle];
  let total = 0;
  for (const check of checks) {
    if (check === 'cipc_company') {
      total += VERIFICATION_COSTS[check];
    } else {
      total += VERIFICATION_COSTS[check] * directorCount;
    }
  }
  return total;
}

export function formatCostRands(cents: number): string {
  return `R${(cents / 100).toFixed(2)}`;
}
