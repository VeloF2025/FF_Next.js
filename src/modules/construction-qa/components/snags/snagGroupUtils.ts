/**
 * snagGroupUtils — Pure grouping utilities for the Snags module.
 * Separated from useSnagsPage to keep file sizes under 300 lines.
 */

import type { Snag, ZonePonGroup, PonGroup } from '../../types/snag.types';

const OPEN_STATUSES = new Set(['open', 'assigned', 'in_progress', 'reopened']);
const FIXED_STATUSES = new Set(['pending_qa', 'fixed', 'resolved', 'verified', 'closed']);

/**
 * Groups a flat snag list into a Zone → PON hierarchy.
 * Zones and PONs are sorted numerically ascending; null values sort to the bottom.
 * Snags within each PON are ordered by snag_number.
 */
export function groupByZonePon(snags: Snag[]): ZonePonGroup[] {
  const zoneMap = new Map<number | null, Map<number | null, Snag[]>>();

  for (const snag of snags) {
    const zone = snag.pole_zone_no ?? null;
    const pon = snag.pole_pon_no ?? null;
    if (!zoneMap.has(zone)) zoneMap.set(zone, new Map());
    const ponMap = zoneMap.get(zone)!;
    if (!ponMap.has(pon)) ponMap.set(pon, []);
    ponMap.get(pon)!.push(snag);
  }

  const sortedZones = [...zoneMap.keys()].sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    return a - b;
  });

  return sortedZones.map((zone) => {
    const ponMap = zoneMap.get(zone)!;
    const pons: PonGroup[] = [...ponMap.entries()]
      .sort(([a], [b]) => {
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      })
      .map(([ponNo, ponSnags]) => ({
        ponNo,
        snags: [...ponSnags].sort((a, b) => (a.snag_number ?? 0) - (b.snag_number ?? 0)),
      }));

    const allSnags = pons.flatMap((p) => p.snags);
    return {
      zoneNo: zone,
      label: zone != null ? `Zone ${zone}` : 'Unassigned',
      pons,
      totalSnags: allSnags.length,
      openCount: allSnags.filter((s) => OPEN_STATUSES.has(s.status)).length,
      fixedCount: allSnags.filter((s) => FIXED_STATUSES.has(s.status)).length,
    };
  });
}
