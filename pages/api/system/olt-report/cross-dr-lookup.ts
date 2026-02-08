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

interface PropStatus {
  propId: string;
  status: string | null;
  needsFix: boolean; // true if status is not "Home Installation: Installed"
}

interface SwapLookupResult {
  drA: { drNumber: string; oesSerial: string; oneMapSerial: string; oneMapUps: string | null; propStatus: PropStatus | null };
  drB: { drNumber: string; oesSerial: string | null; oneMapSerial: string | null; oneMapUps: string | null; foundOn1Map: boolean; propStatus: PropStatus | null };
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

    const INSTALLED_STATUS = 'Home Installation: Installed';
    const drAFoundOn1Map = drASearch.success && drASearch.records.length > 0;
    // Find UPS from ANY of DR A's prop records (may have multiple, UPS could be on any)
    const drAOneMapUps = drAFoundOn1Map
      ? drASearch.records.find(r => r.br_ser)?.br_ser || null
      : null;

    // Find the prop record with the wrong serial (DR A) — this is the one we'll fix
    const drAWrongRecord = drAFoundOn1Map
      ? drASearch.records.find(r => r.ph_ont?.toUpperCase() === wrongSerial.toUpperCase())
      : null;
    const drAPropStatus: PropStatus | null = drAWrongRecord
      ? { propId: drAWrongRecord.prop_id, status: drAWrongRecord.status, needsFix: drAWrongRecord.status !== INSTALLED_STATUS }
      : null;

    const drBFoundOn1Map = drBSearch.success && drBSearch.records.length > 0;
    const drBOneMapSerial = drBFoundOn1Map
      ? (drBSearch.records.find(r => r.ph_ont)?.ph_ont || drBSearch.records[0].ph_ont)
      : null;
    const drBOneMapUps = drBFoundOn1Map
      ? drBSearch.records.find(r => r.br_ser)?.br_ser || null
      : null;

    // Find DR B's installed record status
    const drBInstalledRecord = drBFoundOn1Map
      ? drBSearch.records.find(r => r.ph_ont?.toUpperCase() === drBOesSerial?.toUpperCase()) || drBSearch.records[0]
      : null;
    const drBPropStatus: PropStatus | null = drBInstalledRecord
      ? { propId: drBInstalledRecord.prop_id, status: drBInstalledRecord.status, needsFix: drBInstalledRecord.status !== INSTALLED_STATUS }
      : null;

    // Detect UPS action needed:
    // Case 1: DR A has UPS, DR B has none → transfer (set on B, clear from A)
    // Case 2: DR A has UPS, DR B has same UPS → just clear from A (de-duplicate)
    const drAUpsMatchesDrB = !!(drAOneMapUps && drBOneMapUps && drAOneMapUps.toUpperCase() === drBOneMapUps.toUpperCase());
    const upsTransferNeeded = !!(drAOneMapUps && drBFoundOn1Map && (!drBOneMapUps || drAUpsMatchesDrB));

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
        propStatus: drAPropStatus,
      },
      drB: {
        drNumber: belongsToDr,
        oesSerial: drBOesSerial,
        oneMapSerial: drBOneMapSerial,
        oneMapUps: drBOneMapUps,
        foundOn1Map: drBFoundOn1Map,
        propStatus: drBPropStatus,
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
