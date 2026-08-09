import type { Pool } from 'pg';
import type {
  TrackerPonRow,
  TrackerResult,
  TrackerZoneRow,
} from '../types/zoneDelivery.types';
import {
  readTrackerHandovers,
  readTrackerPons,
  type TrackerPonQueryRow,
} from '../repositories/zoneDeliveryTrackerRepository';
import { withClient } from './zoneDeliveryTransactions';

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

const zoneKey = (projectId: string, zoneNo: number): string => `${projectId}:${zoneNo}`;

const toPonRow = (row: TrackerPonQueryRow): TrackerPonRow => ({
  projectId: row.project_id,
  projectName: row.project_name,
  zoneNo: row.zone_no,
  ponNo: row.pon_no,
  portSubmittedAt: iso(row.port_submitted_at),
  homesActive: row.homes_active,
});

/**
 * The zone overview is folded from the PON rows rather than queried separately,
 * so the two tables cannot disagree: "total PONs" is exactly the number of rows
 * the PON table shows for that zone, and "PONs live" is exactly how many of
 * them carry a live home. Two independent aggregates over the same tables would
 * drift the first time either query grew a filter the other did not.
 */
function foldZones(pons: TrackerPonRow[]): Map<string, TrackerZoneRow> {
  const zones = new Map<string, TrackerZoneRow>();
  for (const pon of pons) {
    const key = zoneKey(pon.projectId, pon.zoneNo);
    const zone = zones.get(key) ?? {
      projectId: pon.projectId,
      projectName: pon.projectName,
      zoneNo: pon.zoneNo,
      totalPons: 0,
      livePons: 0,
      homesActive: 0,
      handedOverAt: null,
    };
    zone.totalPons += 1;
    if (pon.homesActive > 0) zone.livePons += 1;
    zone.homesActive += pon.homesActive;
    zones.set(key, zone);
  }
  return zones;
}

export function getZoneDeliveryTracker(
  pool: Pool,
  projectId?: string,
): Promise<TrackerResult> {
  return withClient(pool, async client => {
    const [ponRows, handovers] = await Promise.all([
      readTrackerPons(client, projectId),
      readTrackerHandovers(client, projectId),
    ]);
    const pons = ponRows.map(toPonRow);
    const zones = foldZones(pons);
    for (const handover of handovers) {
      const zone = zones.get(zoneKey(handover.project_id, handover.zone_no));
      // A handover on a zone Works QA has no PONs for is not rendered: the
      // tracker's spine is the PON list, and a zone with no PONs has no row to
      // hang the date on. It stays visible in the gate register at /field-ops.
      if (zone) zone.handedOverAt = iso(handover.handed_over_at);
    }
    return { zones: [...zones.values()], pons };
  });
}
