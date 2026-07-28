/**
 * H&S Gate — batch and summary queries.
 *
 * Split out of gateService.ts, which had grown past the 300-line file limit.
 * These three are callers/readers of the gate rather than part of the verdict
 * logic itself: `checkContractorGate` and its helpers stay in gateService.ts.
 */

import { neon } from '@/lib/db-neon';
import type { GateCheckResult } from '../types/compliance.types';
import { checkContractorGate } from './gateService';

const sql = neon(process.env.DATABASE_URL!);

/**
 * Batch check gate status for multiple contractors
 */
export async function batchCheckGate(
  contractorIds: string[]
): Promise<Map<string, GateCheckResult>> {
  const results = new Map<string, GateCheckResult>();

  // Process in parallel for efficiency
  await Promise.all(
    contractorIds.map(async (id) => {
      const result = await checkContractorGate(id);
      results.set(id, result);
    })
  );

  return results;
}

/**
 * Quick gate check - returns just pass/fail without full details
 */
export async function quickGateCheck(contractorId: string): Promise<boolean> {
  const compliance = await sql`
    SELECT is_gate_approved FROM hs_contractor_compliance
    WHERE contractor_id = ${contractorId}
    LIMIT 1
  `;

  if (compliance.length === 0) {
    // No compliance record - needs full check
    const result = await checkContractorGate(contractorId);
    return result.can_assign;
  }

  return compliance[0]!.is_gate_approved;
}

/**
 * Get contractors blocked by H&S gate
 */
export async function getBlockedContractors(): Promise<
  { contractor_id: string; company_name: string; blockers: string[] }[]
> {
  const rows = await sql`
    SELECT
      hcc.contractor_id,
      c.company_name,
      hcc.gate_blockers as blockers
    FROM hs_contractor_compliance hcc
    JOIN contractors c ON c.id = hcc.contractor_id
    WHERE hcc.is_gate_approved = false
    ORDER BY c.company_name
  `;
  return rows.map((r) => ({
    contractor_id: String(r.contractor_id),
    company_name: String(r.company_name),
    blockers: Array.isArray(r.blockers) ? r.blockers.map(String) : [],
  }));
}
