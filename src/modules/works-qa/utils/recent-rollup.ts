import type {
  RecentDiscipline,
  RecentLane,
  RecentSite,
} from '../types/works-qa.types';

/** One grouped row as returned by the recent.ts SQL: per (project, zone, pon, discipline). */
export interface RecentFeedRow {
  project_id: string;
  project_name: string;
  zone_no: number | null;
  pon_no: number;
  discipline: RecentDiscipline;
  ready_count: number;
  partial_count: number;
  latest_ready_at: string | null;
  latest_partial_at: string | null;
}

function emptyLane(): RecentLane {
  return { readyPoles: 0, partialPoles: 0, sites: [] };
}

/**
 * Fold the flat per-(project,zone,pon,discipline) rows into three discipline
 * lanes, each a Site → Zone → PON tree with summed ready/partial counts.
 */
export function rollupRecent(rows: RecentFeedRow[]): Record<RecentDiscipline, RecentLane> {
  const lanes: Record<RecentDiscipline, RecentLane> = {
    civil: emptyLane(), dome: emptyLane(), main_joint: emptyLane(),
  };
  // key = `${discipline}:${projectId}` → site + its zone index
  const idx = new Map<string, { site: RecentSite; zones: Map<number | null, RecentSite['zones'][number]> }>();

  for (const r of rows) {
    const lane = lanes[r.discipline];
    lane.readyPoles += r.ready_count;
    lane.partialPoles += r.partial_count;

    const key = `${r.discipline}:${r.project_id}`;
    let entry = idx.get(key);
    if (!entry) {
      const site: RecentSite = { projectId: r.project_id, projectName: r.project_name, zones: [] };
      lane.sites.push(site);
      entry = { site, zones: new Map() };
      idx.set(key, entry);
    }
    let zone = entry.zones.get(r.zone_no);
    if (!zone) {
      zone = { zoneNo: r.zone_no, pons: [] };
      entry.site.zones.push(zone);
      entry.zones.set(r.zone_no, zone);
    }
    zone.pons.push({
      ponNo: r.pon_no,
      readyCount: r.ready_count,
      partialCount: r.partial_count,
      latestAt: r.latest_ready_at ?? r.latest_partial_at,
    });
  }
  return lanes;
}

/** A PON is "NEW" when its latest activity is after the user's last-opened watermark. */
export function isNewSinceWatermark(latestAt: string | null, watermarkAt: string | null): boolean {
  if (!latestAt || !watermarkAt) return false;
  return new Date(latestAt).getTime() > new Date(watermarkAt).getTime();
}
