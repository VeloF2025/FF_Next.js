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
}

export function normaliseRegistration(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function matchVehicles(
  portal: PortalVehicle[],
  fleet: FleetVehicleRow[]
): MatchResult {
  const byReg = new Map<string, FleetVehicleRow>();
  for (const f of fleet) {
    const key = normaliseRegistration(f.registration);
    if (key) byReg.set(key, f);
  }

  const matched: MatchResult['matched'] = [];
  const portalOnly: PortalVehicle[] = [];
  // A fleet row may be claimed once only. Two portal entries carrying the same
  // plate means the account has a stale duplicate; silently mapping both would
  // make positions for one vehicle arrive under two tracker rows.
  const claimed = new Set<string>();

  for (const p of portal) {
    const key = p.registration ? normaliseRegistration(p.registration) : '';
    const hit = key ? byReg.get(key) : undefined;
    if (!hit || claimed.has(hit.id)) {
      portalOnly.push(p);
      continue;
    }
    claimed.add(hit.id);
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
  };
}
