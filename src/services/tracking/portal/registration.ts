/**
 * Matching portal vehicle lists onto fleet_vehicles by registration.
 *
 * Registration is the only identifier shared across four tracking platforms and
 * FibreFlow, and every platform formats it differently ("LN40MGGP", "ln 40 mggp",
 * "LN40-MGGP"). Normalising to bare alphanumerics is what makes them comparable.
 *
 * The reconciliation is deliberately bidirectional. A portal vehicle we cannot
 * place is as interesting as a fleet vehicle we cannot find: during recon, the
 * first case surfaced a live Cartrack subscription attached to no known vehicle,
 * and the second is the coverage gap this whole project exists to close.
 *
 * Ambiguity in EITHER direction refuses the match rather than picking a winner.
 * A wrong mapping attributes one driver's movements to another, and — because
 * the position dedup key does not include vehicle_id — a position stored under
 * the wrong vehicle cannot be corrected later by a re-ingest.
 */

export interface PortalVehicle {
  externalId: string;
  registration: string | null;
}

export interface FleetVehicleRow {
  id: string;
  registration: string;
}

export interface MatchResult {
  matched: Array<{ externalId: string; vehicleId: string; registration: string }>;
  portalOnly: PortalVehicle[];
  fleetOnly: FleetVehicleRow[];
  /**
   * Matches refused because two rows collided on a normalised key — two fleet
   * vehicles normalising the same ("LN40 MGGP" vs "LN40-MGGP", both legal under
   * the raw-string UNIQUE on fleet_vehicles.registration), or one portal
   * external id appearing twice under different plates. Neither is a fleet
   * vehicle "not on the portal", so neither belongs in fleetOnly: they are a
   * data fault somebody has to resolve, and they need to say so.
   */
  ambiguous: Array<{ reason: 'duplicate-fleet-registration' | 'duplicate-portal-id'; key: string }>;
}

export function normaliseRegistration(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function matchVehicles(
  portal: PortalVehicle[],
  fleet: FleetVehicleRow[]
): MatchResult {
  const ambiguous: MatchResult['ambiguous'] = [];

  // fleet_vehicles.registration is UNIQUE on the RAW string only, so two rows
  // can differ by a hyphen or a space and still normalise to one key. A plain
  // Map.set would let the later row silently overwrite the earlier one and
  // demote the loser to fleetOnly, indistinguishable from a vehicle the portal
  // genuinely does not carry. Drop both instead, and say why.
  const byReg = new Map<string, FleetVehicleRow>();
  const duplicateRegs = new Set<string>();
  for (const f of fleet) {
    const key = normaliseRegistration(f.registration);
    if (!key) continue;
    if (byReg.has(key)) {
      duplicateRegs.add(key);
      continue;
    }
    byReg.set(key, f);
  }
  for (const key of duplicateRegs) {
    byReg.delete(key);
    ambiguous.push({ reason: 'duplicate-fleet-registration', key });
  }

  const matched: MatchResult['matched'] = [];
  const portalOnly: PortalVehicle[] = [];
  // A fleet row may be claimed once only. Two portal entries carrying the same
  // plate means the account has a stale duplicate; silently mapping both would
  // make positions for one vehicle arrive under two tracker rows.
  const claimed = new Set<string>();
  // An external id may be claimed once only, for the mirror-image reason.
  // fleet_vehicle_trackers is UNIQUE on (provider, account_ref, external_id)
  // with ON CONFLICT DO UPDATE SET vehicle_id, so two matches carrying the same
  // external id do not both land — the second STEALS the tracker from the
  // first, inside a single tick, leaving that vehicle with no active tracker
  // while the run still reports both as upserted.
  const usedExternalIds = new Set<string>();

  for (const p of portal) {
    if (usedExternalIds.has(p.externalId)) {
      ambiguous.push({ reason: 'duplicate-portal-id', key: p.externalId });
      portalOnly.push(p);
      continue;
    }
    const key = p.registration ? normaliseRegistration(p.registration) : '';
    const hit = key ? byReg.get(key) : undefined;
    if (!hit || claimed.has(hit.id)) {
      portalOnly.push(p);
      continue;
    }
    claimed.add(hit.id);
    usedExternalIds.add(p.externalId);
    matched.push({
      externalId: p.externalId,
      vehicleId: hit.id,
      registration: normaliseRegistration(hit.registration),
    });
  }

  return {
    matched,
    portalOnly,
    fleetOnly: fleet.filter((f) => !claimed.has(f.id)),
    ambiguous,
  };
}
