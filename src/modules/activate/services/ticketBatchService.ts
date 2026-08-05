/**
 * Normalizes ticket creation request bodies to a uniform batch array.
 * Supports both old single-batch shape and new multi-batch shape.
 */

import type { ProjectTeamAssignment } from '@/modules/noc/types/team';
import {
  formatGpsColumn,
  haversineMeters,
  GPS_DIVERGENCE_THRESHOLD_M,
  type GpsPoint,
} from '@/modules/noc/utils/gps';

export interface TicketBatchInput {
  ids: number[];
  assigned_team_id?: string;
}

export interface OltTicketBatchInput {
  ids: string[]; // UUID primary keys
  assigned_team_id?: string;
}

export function normalizePPTicketBatches(body: Record<string, unknown>): TicketBatchInput[] {
  if (Array.isArray(body.batches)) {
    return (body.batches as Record<string, unknown>[]).map((b) => ({
      ids: (b.pp_data_ids as number[]) ?? [],
      assigned_team_id: (b.assigned_team_id as string | undefined) ?? undefined,
    }));
  }
  return [{ ids: (body.pp_data_ids as number[]) ?? [], assigned_team_id: (body.assigned_team_id as string | undefined) ?? undefined }];
}

export function normalizeOltTicketBatches(body: Record<string, unknown>): OltTicketBatchInput[] {
  if (Array.isArray(body.batches)) {
    return (body.batches as Record<string, unknown>[]).map((b) => ({
      ids: (b.record_ids as string[]) ?? [],
      assigned_team_id: (b.assigned_team_id as string | undefined) ?? undefined,
    }));
  }
  return [{ ids: (body.record_ids as string[]) ?? [], assigned_team_id: (body.assigned_team_id as string | undefined) ?? undefined }];
}

/**
 * Group records by project. Generic over id type (PP uses number, OLT uses string).
 * Records with null/undefined project are grouped under 'Unknown'.
 */
export function groupRecordsByProject<T extends string | number>(
  records: Array<{ id: T; project?: string | null }>
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of records) {
    const project = r.project || 'Unknown';
    if (!map.has(project)) map.set(project, []);
    map.get(project)!.push(r.id);
  }
  return map;
}

export function resolveTeamForProject(
  projectName: string,
  assignments: ProjectTeamAssignment[]
): { team_id: string; team_name: string } | null {
  const match = assignments.find(
    (a) => a.project_name === projectName && a.role === 'activations'
  );
  if (!match) return null;
  return { team_id: match.team_id, team_name: match.team_name || match.team_id };
}

/**
 * GPS for a PP ticket, in accuracy order:
 *
 *   1. the daily OES report (`oes_activations`) — recorded at activation,
 *      keyed to the ONT serial, independent of the design lineage;
 *   2. DR enrichment (drops/1Map, already ::text strings) — the *planned* drop
 *      position from the SOW/HLD import;
 *   3. the PP row's own coordinates (pg numeric — arrives as string).
 *
 * (2) and (3) are not independent of each other: measured across 830 open PP
 * tickets the PP sheet's Address-link coordinate matches `drops` to a median of
 * 0.0 m, because Fibertime populates it from the same design data we do. Only
 * (1) is a genuine second opinion, which is why it now leads.
 *
 * PAIR-WISE: a coordinate pair always comes from ONE source — mixing a latitude
 * from drops with a longitude from the PP sheet would produce a
 * plausible-looking but geographically wrong point.
 */
export function resolvePpTicketGps(
  enrichLat: string | undefined,
  enrichLng: string | undefined,
  ppLat: string | number | null | undefined,
  ppLng: string | number | null | undefined,
  oesLat?: string | number | null | undefined,
  oesLng?: string | number | null | undefined
): { lat: string; lng: string } | null {
  if (oesLat != null && oesLng != null) return { lat: String(oesLat), lng: String(oesLng) };
  if (enrichLat && enrichLng) return { lat: enrichLat, lng: enrichLng };
  if (ppLat != null && ppLng != null) return { lat: String(ppLat), lng: String(ppLng) };
  return null;
}

/**
 * The GPS block appended to an OLT-mismatch ticket description.
 *
 * Extracted from the route handler so it is testable without standing up a
 * Pages Router request: the route had no test file at all, and this composition
 * — which coordinate wins, whether the technician is warned that the planned
 * location disagrees — is the part worth pinning.
 *
 * Returns '' when there is no coordinate, so the caller can append
 * unconditionally.
 */
export function buildGpsDescriptionSuffix(
  resolved: { point: GpsPoint; source: 'oes_report' | 'design' } | null,
  designGps: GpsPoint | null
): string {
  if (!resolved) return '';

  const coords = formatGpsColumn(resolved.point);
  const label = resolved.source === 'oes_report' ? 'OES report' : 'planned SOW/1Map';
  let out = `\nGPS (${label}): ${coords} — https://maps.google.com/?q=${coords}`;

  // Only meaningful when the OES coordinate won AND a design position exists to
  // disagree with it. When the design position IS what we're showing, there is
  // no second opinion to report.
  if (resolved.source === 'oes_report' && designGps) {
    const apart = Math.round(haversineMeters(resolved.point, designGps));
    if (apart > GPS_DIVERGENCE_THRESHOLD_M) {
      out += `\nNote: the planned SOW/1Map location is ${apart}m away `
        + `(${formatGpsColumn(designGps)}) — verify on site.`;
    }
  }
  return out;
}
