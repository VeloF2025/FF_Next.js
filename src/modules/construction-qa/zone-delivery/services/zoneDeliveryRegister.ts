import type { Pool } from 'pg';
import * as read from '../repositories/zoneDeliveryReadRepository';
import type {
  ZoneRegisterFilters,
  ZoneRegisterResult,
} from '../types/zoneDelivery.types';
import { buildZoneView, calculateAggregate } from './zoneDeliveryHandover';
import { withClient } from './zoneDeliveryTransactions';

export async function getZoneDeliveryRegister(
  pool: Pool,
  filters: ZoneRegisterFilters,
): Promise<ZoneRegisterResult> {
  return withClient(pool, async client => {
    const rows = [];
    for (const key of await read.listZoneKeys(client, filters.projectId, filters.zoneNo)) {
      const aggregate = await read.readZoneAggregate(client, key);
      const view = buildZoneView(aggregate);
      const calculation = calculateAggregate(aggregate);
      const text = `${view.projectName} ${view.zoneNo}`.toLowerCase();
      if (filters.status && view.status !== filters.status) continue;
      if (filters.handover === 'complete' && !view.handedOverAt) continue;
      if (filters.handover === 'pending' && view.handedOverAt) continue;
      if (filters.search && !text.includes(filters.search.toLowerCase())) continue;
      if (filters.blocker && !view.blockers.some(blocker =>
        `${blocker.code} ${blocker.message}`
          .toLowerCase()
          .includes(filters.blocker!.toLowerCase()))) continue;
      const included = view.pons.filter(pon => pon.scopeStatus === 'included');
      rows.push({
        ...key,
        projectName: view.projectName,
        status: view.status,
        includedPons: included.length,
        livePons: included.filter(pon => pon.milestones.technically_live).length,
        earliestIncompleteGate: calculation.earliestIncompleteGate,
        blockerCount: view.blockers.length,
        civilQa: view.civilQa.status,
        opticalQa: view.opticalQa.status,
        handedOverAt: view.handedOverAt,
      });
    }
    return {
      rows,
      summary: {
        zones: rows.length,
        includedPons: rows.reduce((sum, row) => sum + row.includedPons, 0),
        livePons: rows.reduce((sum, row) => sum + row.livePons, 0),
        readyForQa: rows.filter(row => row.status === 'ready_for_zone_qa').length,
        handedOver: rows.filter(row => row.handedOverAt).length,
      },
    };
  });
}
