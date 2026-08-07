/**
 * Netstar's vehicle tree — the endpoint the VigilCloud UI itself uses.
 *
 * One POST returns every vehicle on the account together with its last known
 * position, which is why this replaces both halves of the original design:
 * the vehicle list AND the per-vehicle CSV report job. The report flow issued
 * one job per vehicle per 31-day chunk and polled each export up to ten times;
 * this is a single request.
 *
 *   POST /Main/VehicleRepo/GetVehicleTreeDataPaging?page=1&pageSize=N&__ts=<ms>
 *        &treeFilter=&sortBy=&sortDir=
 *   -> { data: [ { Name, LeafId, GroupName, Lat, Long, DateTimeUtc, ... } ] }
 *
 * POST, not GET: the same path answers 404 to a GET. Captured live from the
 * running portal on 2026-08-07 — the previously documented
 * `/Reports/ReportRepo/GetReportTree` does not exist and always 404'd.
 *
 * WHAT THIS CANNOT DO: it is a snapshot, one current fix per vehicle. History
 * is not available here — see fetchHistory in client.ts.
 */
import type { ProviderPosition } from '../types';

/** A vehicle leaf, with its last fix if the node carries a usable one. */
export interface NetstarTreeNode {
  externalId: string;
  registration: string | null;
  groupName: string | null;
  position: ProviderPosition | null;
}

/**
 * ASP.NET serialises dates as `/Date(1786029116000)/` — epoch milliseconds,
 * sometimes with a trailing timezone offset (`/Date(1786029116000+0200)/`).
 * The offset is redundant (the epoch value is already UTC) and is ignored.
 *
 * Group nodes carry DateTime.MinValue, which arrives as a large negative epoch
 * (`/Date(-62135596800000)/`). That is not a fix; it is "this row has no date".
 * Treating it as one would write a year-0001 position and drag any watermark
 * built from it back to the beginning of time.
 */
const EPOCH_FLOOR_MS = Date.UTC(2000, 0, 1);

export function parseAspNetDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const m = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(raw.trim());
  if (!m) return null;
  const ms = Number(m[1]);
  if (!Number.isFinite(ms) || ms < EPOCH_FLOOR_MS) return null;
  return new Date(ms);
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * A coordinate we are willing to store.
 *
 * (0, 0) is rejected on purpose. It is the canonical "no GPS lock" sentinel —
 * a heartbeat or ignition event without a fix is a normal telematics event, not
 * an exotic one — and it is inside the WGS84 bounds, so a range check alone
 * lets it through. ./parse.ts drops it for the same reason on the CSV side,
 * after the map drew a vehicle in the Gulf of Guinea.
 */
function inRange(lat: number, lon: number): boolean {
  if (lat === 0 && lon === 0) return false;
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/**
 * Map the raw response to vehicle leaves.
 *
 * Validated element by element rather than cast: this is an untrusted response
 * from a portal that has already changed shape once under us. A malformed row
 * is skipped, not fatal — but a response that is not the expected envelope
 * throws, because "we failed to parse it" must never read downstream as "the
 * account has no vehicles".
 */
export function parseVehicleTree(body: unknown): NetstarTreeNode[] {
  if (typeof body !== 'object' || body === null || !('data' in body)) {
    throw new Error('[netstar] vehicle tree: response has no `data` envelope');
  }
  const rows = (body as { data: unknown }).data;
  if (!Array.isArray(rows)) {
    throw new Error(`[netstar] vehicle tree: \`data\` is ${typeof rows}, expected an array`);
  }

  const out: NetstarTreeNode[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;

    // LeafId 0 (or absent) is a folder: "Clients", a client company, a group.
    // The account is a multi-client reseller tree, so most rows above the
    // leaves belong to other companies entirely.
    const leafId = num(r.LeafId);
    if (leafId === null || leafId === 0) continue;

    const name = typeof r.Name === 'string' && r.Name.trim() !== '' ? r.Name : null;
    const groupName = typeof r.GroupName === 'string' ? r.GroupName : null;

    const lat = num(r.Lat);
    const lon = num(r.Long);
    const recordedAt = parseAspNetDate(r.DateTimeUtc);

    // A vehicle with no usable fix is still a vehicle: it must appear in the
    // list so discovery can map it, even though it contributes no position.
    let position: ProviderPosition | null = null;
    if (lat !== null && lon !== null && recordedAt !== null && inRange(lat, lon)) {
      position = {
        externalId: String(leafId),
        // The tree carries no per-fix id, so ingest derives a synthetic one
        // from (account, external id, recordedAt). Two polls that see the same
        // unchanged fix therefore converge on one row rather than duplicating.
        providerEventId: null,
        recordedAt,
        lat,
        lon,
        speedKph: num(r.SpeedValue),
        roadSpeedKph: null,
        isSpeeding: null,
        ignition: typeof r.IgnitionOn === 'boolean' ? r.IgnitionOn : null,
        odometerKm: null,
        linearG: null,
        lateralG: null,
        bearing: num(r.Dir),
        altitudeM: null,
        gpsFixType: null,
      };
    }

    out.push({ externalId: String(leafId), registration: name, groupName, position });
  }
  return out;
}

/**
 * The newest fix anywhere on the account, across every client on the tree.
 *
 * This is the dead-feed detector. Under a snapshot source, "we received no
 * positions" cannot mean the feed died — the portal keeps returning the same
 * stale fix forever, so a frozen tree looks exactly like a healthy one. What
 * DOES distinguish them is the account as a whole: this login sees ~11.5k
 * vehicles belonging to several commercial fleets, so at any hour of any day
 * something on it has reported recently. If the newest fix across all of them
 * is hours old, the feed is broken, not the fleet parked.
 *
 * Deliberately spans foreign vehicles too — that breadth is the entire point.
 * Restricting it to our six would make a quiet weekend indistinguishable from
 * an outage, which is the failure this exists to catch.
 */
export function newestFixAt(nodes: NetstarTreeNode[]): Date | null {
  let newest: Date | null = null;
  for (const n of nodes) {
    if (!n.position) continue;
    if (newest === null || n.position.recordedAt > newest) newest = n.position.recordedAt;
  }
  return newest;
}
