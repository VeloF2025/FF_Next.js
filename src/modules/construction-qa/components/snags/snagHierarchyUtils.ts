/**
 * snagHierarchyUtils — builds a Project → Zone → PON hierarchy
 * from flat HierarchyRow data returned by /api/snags/hierarchy-stats.
 */

import type {
  HierarchyRow,
  ProjectNode,
  ZoneNode,
  PonNode,
  StatusCounts,
  SnagProjectStats,
} from '../../types/snag.types';

const ZERO_COUNTS: StatusCounts = {
  total: 0,
  open: 0,
  assigned: 0,
  in_progress: 0,
  pending_qa: 0,
  resolved: 0,
  verified: 0,
  closed: 0,
};

function addCounts(acc: StatusCounts, row: StatusCounts): StatusCounts {
  return {
    total: acc.total + row.total,
    open: acc.open + row.open,
    assigned: acc.assigned + row.assigned,
    in_progress: acc.in_progress + row.in_progress,
    pending_qa: acc.pending_qa + row.pending_qa,
    resolved: acc.resolved + row.resolved,
    verified: acc.verified + row.verified,
    closed: acc.closed + row.closed,
  };
}

export function buildHierarchy(
  rows: HierarchyRow[],
  statsById: Map<string, SnagProjectStats>
): ProjectNode[] {
  // 1. Group: Map<project_id, { name, Map<zoneKey, { zoneNo, Map<ponKey, { ponNo, StatusCounts }> }> }>
  type PonEntry = { ponNo: number | null; counts: StatusCounts };
  type ZoneEntry = { zoneNo: number | null; pons: Map<string, PonEntry> };
  type ProjectEntry = { project_name: string; zones: Map<string, ZoneEntry> };

  const projects = new Map<string, ProjectEntry>();

  for (const row of rows) {
    const zoneKey = row.zone_no !== null ? String(row.zone_no) : 'NULL';
    const ponKey = row.pon_no !== null ? String(row.pon_no) : 'NULL';

    let proj = projects.get(row.project_id);
    if (!proj) {
      proj = { project_name: row.project_name, zones: new Map() };
      projects.set(row.project_id, proj);
    }

    let zone = proj.zones.get(zoneKey);
    if (!zone) {
      zone = { zoneNo: row.zone_no, pons: new Map() };
      proj.zones.set(zoneKey, zone);
    }

    let pon = zone.pons.get(ponKey);
    if (!pon) {
      pon = { ponNo: row.pon_no, counts: { ...ZERO_COUNTS } };
      zone.pons.set(ponKey, pon);
    }

    pon.counts = addCounts(pon.counts, row);
  }

  // 2. Build output
  const result: ProjectNode[] = [];

  for (const [projectId, projEntry] of projects) {
    // Build zones
    const zones: ZoneNode[] = [];

    for (const zoneEntry of projEntry.zones.values()) {
      // Build pons — sort by ponNo ASC nulls last
      const pons: PonNode[] = Array.from(zoneEntry.pons.values())
        .sort((a, b) => {
          if (a.ponNo === null && b.ponNo === null) return 0;
          if (a.ponNo === null) return 1;
          if (b.ponNo === null) return -1;
          return a.ponNo - b.ponNo;
        })
        .map((p) => ({
          ponNo: p.ponNo,
          label: p.ponNo !== null ? `PON ${p.ponNo}` : 'Unassigned',
          ...p.counts,
        }));

      // Roll up zone counts from its pons
      const zoneCounts = pons.reduce<StatusCounts>(
        (acc, p) => addCounts(acc, p),
        { ...ZERO_COUNTS }
      );

      zones.push({
        zoneNo: zoneEntry.zoneNo,
        label: zoneEntry.zoneNo !== null ? `Zone ${zoneEntry.zoneNo}` : 'Unassigned',
        pons,
        ...zoneCounts,
      });
    }

    // Sort zones by zoneNo ASC nulls last
    zones.sort((a, b) => {
      if (a.zoneNo === null && b.zoneNo === null) return 0;
      if (a.zoneNo === null) return 1;
      if (b.zoneNo === null) return -1;
      return a.zoneNo - b.zoneNo;
    });

    // Roll up project counts from all rows for this project
    const projectCounts = rows
      .filter((r) => r.project_id === projectId)
      .reduce<StatusCounts>((acc, r) => addCounts(acc, r), { ...ZERO_COUNTS });

    // Attach latest report data from statsById
    const stats = statsById.get(projectId);

    result.push({
      project_id: projectId,
      project_name: projEntry.project_name,
      zones,
      latest_report_number: stats?.latest_report_number ?? null,
      latest_report_date: stats?.latest_report_date ?? null,
      latest_report_id: stats?.latest_report_id ?? null,
      ...projectCounts,
    });
  }

  // Sort projects by name
  result.sort((a, b) => a.project_name.localeCompare(b.project_name));

  return result;
}
