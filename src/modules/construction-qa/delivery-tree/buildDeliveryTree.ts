/**
 * Pure assembly of the flat delivery-tree SQL result into Project → Zone → PON.
 *
 * Ordering is applied here rather than relied upon from SQL so the shape is
 * deterministic for any row order: projects by name, zones and PONs ascending.
 */

import { derivePonStatus, deriveZoneStatus, sumCounts } from './deriveStatus';
import type {
  DeliveryTreeProject,
  DeliveryTreePon,
  DeliveryTreeQueryRow,
  DeliveryTreeResult,
  DeliveryTreeZone,
  ZoneDocumentFlags,
} from './types';

interface ZoneAccumulator extends ZoneDocumentFlags {
  zone_no: number;
  pons: DeliveryTreePon[];
}

interface ProjectAccumulator {
  id: string;
  name: string;
  zones: Map<number, ZoneAccumulator>;
}

function toPon(row: DeliveryTreeQueryRow): DeliveryTreePon {
  return {
    pon_no: row.pon_no,
    status: derivePonStatus(row.port_submitted_at),
    counts: {
      poles_total: row.poles_total,
      poles_planted: row.poles_planted,
      activation_total: row.activation_total,
      activation_complete: row.activation_complete,
    },
    opticalSubmittedAt: row.port_submitted_at,
  };
}

function toZone(accumulator: ZoneAccumulator): DeliveryTreeZone {
  const pons = [...accumulator.pons].sort((left, right) => left.pon_no - right.pon_no);
  return {
    zone_no: accumulator.zone_no,
    status: deriveZoneStatus(accumulator),
    counts: sumCounts(pons.map(pon => pon.counts)),
    pons,
  };
}

function toProject(accumulator: ProjectAccumulator): DeliveryTreeProject {
  return {
    id: accumulator.id,
    name: accumulator.name,
    zones: [...accumulator.zones.values()]
      .map(toZone)
      .sort((left, right) => left.zone_no - right.zone_no),
  };
}

/** Group flat PON rows into the Project → Zone → PON tree the API returns. */
export function buildDeliveryTree(rows: readonly DeliveryTreeQueryRow[]): DeliveryTreeResult {
  const projects = new Map<string, ProjectAccumulator>();

  for (const row of rows) {
    let project = projects.get(row.project_id);
    if (!project) {
      project = { id: row.project_id, name: row.project_name, zones: new Map() };
      projects.set(row.project_id, project);
    }

    let zone = project.zones.get(row.zone_no);
    if (!zone) {
      zone = {
        zone_no: row.zone_no,
        hasActiveFac: row.hasActiveFac,
        hasActiveCac: row.hasActiveCac,
        pons: [],
      };
      project.zones.set(row.zone_no, zone);
    } else {
      // Every row of a zone carries the same certificate flags; OR-ing keeps the
      // result stable if a row ever arrives without them.
      zone.hasActiveFac = zone.hasActiveFac || row.hasActiveFac;
      zone.hasActiveCac = zone.hasActiveCac || row.hasActiveCac;
    }

    zone.pons.push(toPon(row));
  }

  return {
    projects: [...projects.values()]
      .map(toProject)
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}
