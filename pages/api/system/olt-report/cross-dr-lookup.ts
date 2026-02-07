/**
 * Cross-DR Lookup API
 *
 * POST: Look up DR B's 1Map + OES state for cross-DR conflict resolution
 *
 * Given a cross-DR conflict (DR A has serial belonging to DR B),
 * this endpoint checks DR B's current state and recommends an action.
 *
 * Request body:
 * - recordId: string (the olt_mismatch_records id for DR A)
 * - drNumber: string (DR A's drop number)
 * - wrongSerial: string (the serial currently on DR A's 1Map, belongs to DR B)
 * - belongsToDr: string (DR B's drop number from investigation_context)
 *
 * Returns scenario classification and swap recommendation.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import { oneMapApi } from '@/modules/system/services/oneMapApiService';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export const config = {
  maxDuration: 30,
};

type SwapScenario = 'clean_swap' | 'fix_a_only' | 'fix_a_flag_b' | 'fix_a_b_missing';

interface SwapLookupResult {
  drA: { drNumber: string; oesSerial: string; oneMapSerial: string; oneMapUps: string | null };
  drB: { drNumber: string; oesSerial: string | null; oneMapSerial: string | null; oneMapUps: string | null; foundOn1Map: boolean };
  upsTransfer: { needed: boolean; serial: string | null; from: string; to: string } | null;
  scenario: SwapScenario;
  recommendation: string;
  canAutoSwap: boolean;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { recordId, drNumber, wrongSerial, belongsToDr } = req.body;

  if (!recordId || !drNumber || !wrongSerial || !belongsToDr) {
    return apiResponse.badRequest(res, 'recordId, drNumber, wrongSerial, and belongsToDr are required');
  }

  const client = await pool.connect();

  try {
    // Get DR A's correct serial from the mismatch record
    const drARecord = await client.query(
      `SELECT olt_serial, wrong_onemap_serial FROM olt_mismatch_records WHERE id = $1`,
      [recordId]
    );
    if (drARecord.rows.length === 0) {
      return apiResponse.notFound(res, 'Mismatch record', recordId);
    }
    const drAOesSerial = drARecord.rows[0].olt_serial;

    // Look up DR B's correct serial from OES activations
    const drBOesLookup = await client.query(
      `SELECT serial_number FROM oes_activations
       WHERE drop_number = $1
       ORDER BY created_at DESC LIMIT 1`,
      [belongsToDr]
    );
    const drBOesSerial = drBOesLookup.rows[0]?.serial_number || null;

    // Search both DRs on 1Map (DR A for UPS info, DR B for full state)
    const [drASearch, drBSearch] = await Promise.all([
      oneMapApi.searchDR(drNumber),
      oneMapApi.searchDR(belongsToDr),
    ]);

    const drAFoundOn1Map = drASearch.success && drASearch.records.length > 0;
    // Find the record with the wrong serial to get its UPS (DR may have multiple prop records)
    const drAWrongRecord = drAFoundOn1Map
      ? drASearch.records.find(r => r.ph_ont?.toUpperCase() === wrongSerial.toUpperCase()) || drASearch.records[0]
      : null;
    const drAOneMapUps = drAWrongRecord?.br_ser || null;

    const drBFoundOn1Map = drBSearch.success && drBSearch.records.length > 0;
    const drBFirstRecord = drBFoundOn1Map ? drBSearch.records[0] : null;
    const drBOneMapSerial = drBFirstRecord?.ph_ont || null;
    const drBOneMapUps = drBFirstRecord?.br_ser || null;

    // Detect UPS transfer: DR A has a UPS serial that likely belongs to DR B (DR B's UPS is empty)
    const upsTransferNeeded = !!(drAOneMapUps && drBFoundOn1Map && !drBOneMapUps);

    // Classify scenario
    let scenario: SwapScenario;
    let recommendation: string;
    let canAutoSwap: boolean;

    if (!drBFoundOn1Map) {
      // Scenario 4: DR B not on 1Map
      scenario = 'fix_a_b_missing';
      recommendation = `DR B (${belongsToDr}) not found on 1Map. Fix DR A only — DR B is a separate problem.`;
      canAutoSwap = true;
    } else if (drBOneMapSerial?.toUpperCase() === drAOesSerial?.toUpperCase()) {
      // Scenario 1: Clean swap — DR B has DR A's serial
      scenario = 'clean_swap';
      recommendation = `Clean swap detected. DR B has ${drAOesSerial} and DR A has ${wrongSerial}. Both can be fixed atomically.`;
      canAutoSwap = true;
    } else if (drBOneMapSerial?.toUpperCase() === drBOesSerial?.toUpperCase()) {
      // Scenario 2: DR B ONT already correct (may still need UPS transfer + photo sync)
      scenario = 'fix_a_only';
      recommendation = upsTransferNeeded
        ? `DR B (${belongsToDr}) ONT is correct (${drBOneMapSerial}). Fix DR A ONT + transfer UPS to DR B + sync photos.`
        : `DR B (${belongsToDr}) already has correct serial ${drBOneMapSerial}. Only DR A needs fixing.`;
      canAutoSwap = true;
    } else {
      // Scenario 3: DR B has a different wrong serial
      scenario = 'fix_a_flag_b';
      recommendation = `DR B (${belongsToDr}) has wrong serial ${drBOneMapSerial} (should be ${drBOesSerial || 'unknown'}). Fix DR A and flag DR B for separate investigation.`;
      canAutoSwap = true;
    }

    // Append UPS transfer info to recommendation
    if (upsTransferNeeded) {
      recommendation += ` UPS serial ${drAOneMapUps} on DR A will be transferred to DR B (currently empty).`;
    }

    const result: SwapLookupResult = {
      drA: {
        drNumber,
        oesSerial: drAOesSerial,
        oneMapSerial: wrongSerial,
        oneMapUps: drAOneMapUps,
      },
      drB: {
        drNumber: belongsToDr,
        oesSerial: drBOesSerial,
        oneMapSerial: drBOneMapSerial,
        oneMapUps: drBOneMapUps,
        foundOn1Map: drBFoundOn1Map,
      },
      upsTransfer: upsTransferNeeded ? {
        needed: true,
        serial: drAOneMapUps,
        from: drNumber,
        to: belongsToDr,
      } : null,
      scenario,
      recommendation,
      canAutoSwap,
    };

    log.info('CrossDRLookup', 'Lookup complete', {
      drA: drNumber,
      drB: belongsToDr,
      scenario,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    log.error('CrossDRLookup', 'Lookup failed', { error });
    return apiResponse.internalError(res, error);
  } finally {
    client.release();
  }
}

export default withAuth(withRole('manager')(handler));
