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

import { TicketSource } from '@/modules/noc/types/ticket';

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

/**
 * Is this serial specific enough to identify one installation?
 *
 * `oes_activations` stores 50 rows whose serial_number is literally "-", spread
 * across 50 unrelated DRs in at least three suburbs ~115km apart; 105
 * olt_mismatch_records carry the same placeholder in olt_serial. An exact
 * LOWER(serial)=LOWER($1) match on "-" therefore resolves to an arbitrary one
 * of those rows — a real address, belonging to a stranger.
 *
 * The by-DR lookup shields this today, but the serial fallback exists precisely
 * for the cases where the DR misses: `not_found` and `empty_serial` are both
 * eligible statuses, and wa_no_oes guarantees a DR miss by definition. One
 * placeholder-serial record without an OES row by DR is all it takes.
 *
 * Real ONT serials are 12+ alphanumerics (e.g. ALCLB48E394B); requiring 6 is
 * well below any genuine serial and well above any placeholder seen.
 */
export function isResolvableSerial(serial: string | null | undefined): serial is string {
  if (!serial) return false;
  const trimmed = serial.trim();
  if (trimmed.length < 6) return false;
  // Reject strings with no alphanumeric substance ("------", "??????").
  return /[A-Za-z0-9]{6,}/.test(trimmed);
}

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

/**
 * The only ticket sources for which the OES coordinate outranks everything else.
 *
 * These three exist BECAUSE the DR<->serial link is in doubt, so a DR-derived
 * location inherits the very error under investigation and the OES coordinate —
 * anchored to the serial — is the better bet.
 *
 * That reasoning does NOT generalise. A snags ticket's stored coordinate is the
 * technician's own on-site capture; a manual or construction ticket's is
 * whoever raised it standing at the fault. Ranking OES above those is strictly
 * worse, and measurably so: DR1734917 carries four open snags tickets whose
 * captured position sits 6m from the design point, while its OES row (team
 * law5, a Lawley drop) is pinned 94.7km away near Brits. Applying the OES
 * ranking everywhere moved the pin on 447 open out-of-scope tickets.
 */
export const OES_RANKED_TICKET_SOURCES: readonly string[] = [
  TicketSource.OLT_MISMATCH,
  TicketSource.WA_NO_OES,
  TicketSource.PP_DATA,
];

export function ranksOesFirst(source: string | null | undefined): boolean {
  return !!source && OES_RANKED_TICKET_SOURCES.includes(source);
}

/**
 * Coerce whatever `maintenance_tickets.gps_coordinates` arrives as into a point.
 *
 * It is a TEXT column and reaches the client as the raw "lat,lng" string —
 * getTicketById does `SELECT t.*` and the route spreads the row straight into
 * the JSON response. An earlier version of this file only accepted the object
 * form, so the stored tier silently never fired.
 */
export function parseStoredGps(value: unknown): DisplayPoint | null {
  let point: DisplayPoint | null = null;

  if (isDisplayPoint(value)) {
    point = value;
  } else if (typeof value === 'string') {
    const parts = value.split(',');
    if (parts.length !== 2) return null;
    const latitude = Number.parseFloat(parts[0] as string);
    const longitude = Number.parseFloat(parts[1] as string);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    point = { latitude, longitude };
  }

  if (!point) return null;

  // Bounds-check the stored value like any other source. 19 open tickets hold
  // their pair the wrong way round (lng,lat — e.g. 27.81,-26.38), which plots
  // in the Atlantic. They don't surface today only because they all have a NULL
  // dr_number and the panel never opens; that is incidental, not a guarantee.
  if (!isPlausibleSaCoordinate(point.latitude, point.longitude)) return null;
  return point;
}

export interface TicketGpsDisplayInput {
  /**
   * The ticket's `source`. The OES coordinate is only ranked first for the
   * sources in OES_RANKED_TICKET_SOURCES; for anything else it is ignored
   * entirely rather than quietly demoted, so no other ticket type changes
   * behaviour.
   */
  ticketSource?: string | null;
  /** From the daily OES report — independent of the design lineage. */
  oesGps?: unknown;
  /** SOW drops, then 1Map — the same design lineage either way. */
  fibreflowGps?: unknown;
  onemapGps?: unknown;
  /** Whatever was stored on the ticket row; a "lat,lng" string or a point. */
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
  // Scoped, not global — see OES_RANKED_TICKET_SOURCES.
  const oes = ranksOesFirst(input.ticketSource) && isDisplayPoint(input.oesGps)
    ? input.oesGps
    : null;
  const design = isDisplayPoint(input.fibreflowGps)
    ? input.fibreflowGps
    : isDisplayPoint(input.onemapGps)
      ? input.onemapGps
      : null;
  const stored = parseStoredGps(input.ticketGps);

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
