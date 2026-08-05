/**
 * Pure GPS utilities — maths, plausibility bounds, and the display ranking.
 *
 * Deliberately free of any database import. `ticketGpsService` pulls in
 * `@/lib/db` (and therefore `pg`), and several of this module's consumers reach
 * client components: ticketBatchService is imported by CreatePPTicketsModal,
 * and TicketHeader is a 'use client' component. Importing the service from
 * either drags a Postgres driver into the browser bundle — `next build` fails
 * with "Can't resolve 'fs'". Everything pure lives here; the service re-exports
 * it so server-side callers are unaffected.
 */

export interface GpsPoint {
  latitude: number;
  longitude: number;
}

/**
 * South African bounding box. 13 of 25,414 OES rows (0.05%) carry coordinates
 * from Nepal, Indonesia and Iraq — a handful of activation devices report a
 * bogus fix. `drops` has zero out-of-bounds rows, so this guard applies to the
 * OES side only and a rejected OES point falls through to the design coordinate
 * rather than replacing it with garbage.
 */
export const SA_BOUNDS = { minLat: -35, maxLat: -22, minLng: 16, maxLng: 33 } as const;

export function isPlausibleSaCoordinate(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined
): boolean {
  if (lat == null || lng == null) return false;
  const latNum = typeof lat === 'number' ? lat : parseFloat(lat);
  const lngNum = typeof lng === 'number' ? lng : parseFloat(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return false;
  if (latNum === 0 && lngNum === 0) return false;
  return (
    latNum >= SA_BOUNDS.minLat && latNum <= SA_BOUNDS.maxLat &&
    lngNum >= SA_BOUNDS.minLng && lngNum <= SA_BOUNDS.maxLng
  );
}

/** Great-circle distance in metres. */
export function haversineMeters(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rank candidate coordinates: OES activation first, then the design lineage.
 *
 * PAIR-WISE: a returned pair always comes from ONE source. Resolving latitude
 * and longitude independently would mix a latitude from the OES report with a
 * longitude from the design import and produce a plausible-looking point that
 * is nowhere.
 */
export function resolveTicketGps(
  oes: GpsPoint | null | undefined,
  design: GpsPoint | null | undefined
): { point: GpsPoint; source: 'oes_report' | 'design' } | null {
  if (oes && isPlausibleSaCoordinate(oes.latitude, oes.longitude)) {
    return { point: oes, source: 'oes_report' };
  }
  if (design && Number.isFinite(design.latitude) && Number.isFinite(design.longitude)) {
    return { point: design, source: 'design' };
  }
  return null;
}

/** Serialize for the `maintenance_tickets.gps_coordinates` text column ("lat,lng"). */
export function formatGpsColumn(point: GpsPoint): string {
  return `${point.latitude},${point.longitude}`;
}

/** Display alias for GpsPoint — same shape, read at the UI boundary. */
export type DisplayPoint = GpsPoint;

export const GPS_DIVERGENCE_THRESHOLD_M = 50;

/** A usable coordinate: both axes present and numeric. Half a pair is not a location. */
export function isDisplayPoint(p: unknown): p is DisplayPoint {
  if (!p || typeof p !== 'object') return false;
  const { latitude, longitude } = p as Partial<DisplayPoint>;
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  );
}

export interface TicketGpsDisplayInput {
  /** From the daily OES report — independent of the design lineage. */
  oesGps?: unknown;
  /** SOW drops, then 1Map — the same design lineage either way. */
  fibreflowGps?: unknown;
  onemapGps?: unknown;
  /** Whatever was stored on the ticket row, as a last resort. */
  ticketGps?: unknown;
  /** Metres between the OES and design coordinates, precomputed server-side. */
  divergenceM?: number | null;
}

export interface TicketGpsDisplay {
  /** The coordinate to show and link. */
  primary: DisplayPoint | null;
  /** True when `primary` came from the OES report, so the UI can label it. */
  primaryIsOes: boolean;
  /** The design coordinate, shown alongside only when it materially disagrees. */
  secondary: DisplayPoint | null;
  /** Separation in metres, present only when `secondary` is shown. */
  divergenceM: number | null;
}

/**
 * Rank the available coordinates for display.
 *
 * OES first: it is recorded at activation against the ONT serial, whereas the
 * design position is where the drop was *planned*. On the ticket types that
 * carry this enrichment the DR link is itself under investigation, so a
 * DR-derived location inherits the error being investigated.
 *
 * The design coordinate is not discarded — when the two disagree by more than
 * the threshold both are surfaced, because the field is the only place that
 * disagreement can actually be settled.
 */
export function selectTicketGpsDisplay(input: TicketGpsDisplayInput): TicketGpsDisplay {
  const oes = isDisplayPoint(input.oesGps) ? input.oesGps : null;
  const design = isDisplayPoint(input.fibreflowGps)
    ? input.fibreflowGps
    : isDisplayPoint(input.onemapGps)
      ? input.onemapGps
      : null;
  const stored = isDisplayPoint(input.ticketGps) ? input.ticketGps : null;

  const primary = oes ?? design ?? stored;
  if (!primary) {
    return { primary: null, primaryIsOes: false, secondary: null, divergenceM: null };
  }

  const divergence = input.divergenceM ?? null;
  const showBoth =
    !!oes && !!design && divergence !== null && divergence > GPS_DIVERGENCE_THRESHOLD_M;

  return {
    primary,
    primaryIsOes: !!oes,
    secondary: showBoth ? design : null,
    divergenceM: showBoth ? divergence : null,
  };
}
