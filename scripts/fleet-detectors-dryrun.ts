/**
 * Dry run: what WOULD the vehicle telematics detectors have opened?
 *
 * Writes nothing, ever. The incident producer is replaced by a counter, the
 * whole run holds one `READ ONLY` transaction, and the only queries are SELECTs.
 * Run: npx tsx scripts/fleet-detectors-dryrun.ts [days]
 *
 * It REPLAYS the 5-minute cron rather than sweeping the window once, because
 * the detectors are tick-shaped: `lost_contact_moving` compares `now` against
 * the last fix, and a single sweep would report it as never firing. Dedup is
 * modelled the way production gets it — a `sourceEventId` seen before is an
 * `unchanged`, not a new incident — so the counts below are incidents OPENED,
 * which is the number acceptance criterion 3 caps at ~5/day.
 */
import { Pool, type PoolClient } from 'pg';
import { haversineDistanceM } from '../src/lib/geo';
import { detectLostContact } from '../src/modules/fleet/vehicleDetectors/lostContactDetector';
import { detectSevereDriving } from '../src/modules/fleet/vehicleDetectors/severeDrivingDetector';
import { detectTheftAfterHoursMovement } from '../src/modules/fleet/vehicleDetectors/theftDetector';
import { detectUnauthorizedStops } from '../src/modules/fleet/vehicleDetectors/unauthorizedStopDetector';
import type {
  DetectedVehicleEvent, DetectorPosition, DetectorVehicle, VehicleDetectorContext,
  VehicleOperationalRule,
} from '../src/modules/fleet/vehicleDetectors/types';

/**
 * CLI report output. The Zero Tolerance gate forbids `console.*` in changed
 * files and names `eslint-disable-next-line no-console` as the sanctioned
 * exception; printing a table to a terminal is the case it exists for. Declared
 * once per stream rather than repeated at every call site.
 */
function report(line: string): void {
  // eslint-disable-next-line no-console -- CLI report output; see the comment above
  console.log(line);
}

const DAYS = Number(process.argv[2] ?? 7);
/**
 * Two overrides, for answering "what would tuning this to X do" WITHOUT editing
 * a migration or a rule row. `DRYRUN_AFTER_HOURS_START=21:00:00` re-runs the
 * theft detector against a later window; `DRYRUN_ONLY=theft_after_hours_movement`
 * skips the other three, which is most of the runtime.
 */
const AFTER_HOURS_START_OVERRIDE = process.env.DRYRUN_AFTER_HOURS_START ?? null;
const ONLY = process.env.DRYRUN_ONLY ?? null;
const TICK_MINUTES = 5;
const WINDOW_HOURS = 12;
const CADENCE_HOURS = 24;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Migration 529's seeded version 1, for a database where 529 has not been
 * applied yet (PR3 merges before PR4 but the shared DB is migrated at deploy
 * time). Kept as a fallback rather than an error so the dry run can be taken
 * BEFORE the migration lands, which is when its answer is most useful.
 */
const SEEDED_RULE: VehicleOperationalRule = {
  id: 'unapplied-529', version: 0, timezone: 'Africa/Johannesburg',
  effectiveFrom: '1970-01-01T00:00:00.000Z', effectiveTo: null,
  afterHoursStartTime: '18:00:00', afterHoursEndTime: '06:00:00',
  weekendsAreAfterHours: true, publicHolidaysAreAfterHours: true,
  theftDisplacementMeters: 500, theftMinPositions: 2,
  harshLinearG: 0.35, harshLateralG: 0.35, harshMinSpeedKph: 20, speedOverLimitKph: 15,
  unauthorizedStopMinutes: 45, lostContactMinutes: 30, idleAlertMinutes: 20,
  knownSiteRadiusMeters: 500, changeReason: null, createdBy: null,
  createdAt: '1970-01-01T00:00:00.000Z',
};

async function columnExists(client: PoolClient, table: string, column: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return rows.length > 0;
}

async function loadRule(client: PoolClient): Promise<VehicleOperationalRule> {
  const { rows: exists } = await client.query(`SELECT to_regclass('fleet_vehicle_operational_rules') AS t`);
  if (!exists[0]?.t) {
    report('WARNING: migration 529 is not applied — using its seeded defaults, and treating every');
    report('         vehicle as NOT after_hours_exempt.');
    return SEEDED_RULE;
  }
  const { rows } = await client.query(
    `SELECT * FROM fleet_vehicle_operational_rules
      WHERE effective_from <= now() AND (effective_to IS NULL OR effective_to > now())
      ORDER BY version DESC LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return SEEDED_RULE;
  return {
    id: r.id, version: r.version, timezone: r.timezone,
    effectiveFrom: new Date(r.effective_from).toISOString(), effectiveTo: null,
    afterHoursStartTime: r.after_hours_start_time, afterHoursEndTime: r.after_hours_end_time,
    weekendsAreAfterHours: r.weekends_are_after_hours,
    publicHolidaysAreAfterHours: r.public_holidays_are_after_hours,
    theftDisplacementMeters: r.theft_displacement_meters, theftMinPositions: r.theft_min_positions,
    harshLinearG: Number(r.harsh_linear_g), harshLateralG: Number(r.harsh_lateral_g),
    harshMinSpeedKph: Number(r.harsh_min_speed_kph), speedOverLimitKph: Number(r.speed_over_limit_kph),
    unauthorizedStopMinutes: r.unauthorized_stop_minutes, lostContactMinutes: r.lost_contact_minutes,
    idleAlertMinutes: r.idle_alert_minutes, knownSiteRadiusMeters: r.known_site_radius_meters,
    changeReason: null, createdBy: null, createdAt: new Date(r.created_at).toISOString(),
  };
}

async function loadVehicles(client: PoolClient): Promise<DetectorVehicle[]> {
  // Two explicit branches, not an interpolated column: 529 may not be applied.
  const withExempt = await columnExists(client, 'fleet_vehicles', 'after_hours_exempt');
  const { rows } = withExempt
    ? await client.query(
        `SELECT v.id, v.registration, v.after_hours_exempt
           FROM fleet_vehicles v
           JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
          ORDER BY v.id`,
      )
    : await client.query(
        `SELECT v.id, v.registration, false AS after_hours_exempt
           FROM fleet_vehicles v
           JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
          ORDER BY v.id`,
      );
  return rows.map((r) => ({
    vehicleId: r.id, registration: r.registration, afterHoursExempt: r.after_hours_exempt === true,
  }));
}

async function loadPositions(
  client: PoolClient, vehicleId: string, sinceIso: string, withEventType: boolean,
): Promise<DetectorPosition[]> {
  // Two explicit branches: 528 may not be applied to this database yet, in
  // which case severe_driving can only be measured on its g fallback.
  const { rows } = withEventType
    ? await client.query(
        `SELECT recorded_at, provider_event_id, provider, account_ref, ignition, lat, lon,
                speed_kph, linear_g, lateral_g, provider_event_type
           FROM fleet_vehicle_positions
          WHERE vehicle_id = $1 AND recorded_at >= $2::timestamptz
          ORDER BY recorded_at, id`,
        [vehicleId, sinceIso],
      )
    : await client.query(
        `SELECT recorded_at, provider_event_id, provider, account_ref, ignition, lat, lon,
                speed_kph, linear_g, lateral_g, NULL AS provider_event_type
           FROM fleet_vehicle_positions
          WHERE vehicle_id = $1 AND recorded_at >= $2::timestamptz
          ORDER BY recorded_at, id`,
        [vehicleId, sinceIso],
      );
  return rows.map((r) => ({
    recordedAt: new Date(r.recorded_at).toISOString(),
    providerEventId: r.provider_event_id, provider: r.provider, accountRef: r.account_ref,
    ignition: r.ignition, lat: num(r.lat), lon: num(r.lon), speedKph: num(r.speed_kph),
    linearG: num(r.linear_g), lateralG: num(r.lateral_g), providerEventType: r.provider_event_type,
  }));
}

async function loadHolidays(client: PoolClient): Promise<Set<string>> {
  const { rows } = await client.query(
    `SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date FROM public_holidays
      WHERE date >= (now() - interval '40 days')::date AND date <= (now() + interval '2 days')::date`,
  );
  return new Set(rows.map((r) => r.date as string));
}

/** Declared places, loaded once and matched in memory — the same union `findNearestPlace` queries. */
interface Place { id: string; kind: 'parking' | 'project_aoi'; label: string | null; lat: number; lon: number }

async function loadPlaces(client: PoolClient): Promise<Place[]> {
  const { rows } = await client.query(
    `SELECT p.id, 'parking' AS kind, COALESCE(p.label, p.address_text) AS label, p.lat, p.lon
       FROM fleet_vehicle_parking_locations p
      WHERE p.superseded_at IS NULL AND p.lat IS NOT NULL AND p.lon IS NOT NULL
      UNION ALL
     SELECT a.project_id AS id, 'project_aoi' AS kind, pr.project_name AS label,
            ST_Y(ST_Centroid(a.aoi::geometry)) AS lat, ST_X(ST_Centroid(a.aoi::geometry)) AS lon
       FROM project_aois a LEFT JOIN projects pr ON pr.id = a.project_id
      WHERE a.aoi IS NOT NULL`,
  );
  return rows.map((r) => ({
    id: r.id, kind: r.kind === 'parking' ? 'parking' : 'project_aoi',
    label: r.label, lat: Number(r.lat), lon: Number(r.lon),
  }));
}

function nearestPlace(places: Place[], lat: number, lon: number) {
  let best: { id: string; kind: 'parking' | 'project_aoi'; label: string | null; distanceM: number } | null = null;
  for (const place of places) {
    const distanceM = haversineDistanceM({ lat, lon }, { lat: place.lat, lon: place.lon });
    if (distanceM > 500) continue;
    if (!best || distanceM < best.distanceM) {
      best = { id: place.id, kind: place.kind, label: place.label, distanceM };
    }
  }
  return best;
}

function p90Gap(positions: DetectorPosition[]): number | null {
  const gaps: number[] = [];
  let previous: number | null = null;
  for (const p of positions) {
    const t = Date.parse(p.recordedAt);
    if (previous !== null) gaps.push((t - previous) / 1000);
    previous = t;
  }
  if (gaps.length === 0) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.9))] ?? null;
}

function sastDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(iso));
}

interface Counters { byDay: Map<string, number>; byVehicle: Map<string, number>; total: number }

function emptyCounters(): Counters { return { byDay: new Map(), byVehicle: new Map(), total: 0 }; }

function record(counters: Counters, day: string, registration: string): void {
  counters.byDay.set(day, (counters.byDay.get(day) ?? 0) + 1);
  counters.byVehicle.set(registration, (counters.byVehicle.get(registration) ?? 0) + 1);
  counters.total += 1;
}

function wanted(detector: string): boolean {
  return ONLY === null || ONLY === detector;
}

async function runTick(
  ctx: VehicleDetectorContext, places: Place[],
): Promise<Record<string, DetectedVehicleEvent[]>> {
  return {
    theft_after_hours_movement: wanted('theft_after_hours_movement') ? detectTheftAfterHoursMovement(ctx) : [],
    severe_driving: wanted('severe_driving') ? detectSevereDriving(ctx) : [],
    prolonged_unauthorized_stop: wanted('prolonged_unauthorized_stop')
      ? await detectUnauthorizedStops(ctx, async (lat, lon) => nearestPlace(places, lat, lon))
      : [],
    lost_contact_moving: wanted('lost_contact_moving') ? detectLostContact(ctx) : [],
  };
}

async function main(): Promise<void> {
  const client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SET TRANSACTION READ ONLY');
  try {
    const [loaded, vehicles, holidays, places] = await Promise.all([
      loadRule(client), loadVehicles(client), loadHolidays(client), loadPlaces(client),
    ]);
    const rule: VehicleOperationalRule = AFTER_HOURS_START_OVERRIDE
      ? { ...loaded, afterHoursStartTime: AFTER_HOURS_START_OVERRIDE }
      : loaded;
    if (AFTER_HOURS_START_OVERRIDE) {
      report(`OVERRIDE: after_hours_start_time = ${AFTER_HOURS_START_OVERRIDE} (not what the database holds)`);
    }
    const withEventType = await columnExists(client, 'fleet_vehicle_positions', 'provider_event_type');
    if (!withEventType) {
      report('WARNING: migration 528 is not applied — provider_event_type is unavailable, so');
      report('         severe_driving is measured on its g FALLBACK ONLY. The provider-event path');
      report('         (HARSH_BRAKING / HARSH_CORNERING) is not represented in these counts.');
    }
    const endMs = Date.now();
    const startMs = endMs - DAYS * 86_400_000;
    const loadFrom = new Date(startMs - CADENCE_HOURS * 3_600_000).toISOString();

    report(`\nRule v${rule.version}: theft ${rule.theftDisplacementMeters} m / ${rule.theftMinPositions} fixes, `
      + `harsh ${rule.harshLinearG}g @ ${rule.harshMinSpeedKph} km/h, stop ${rule.unauthorizedStopMinutes} min, `
      + `lost contact floor ${rule.lostContactMinutes} min`);
    report(`Replaying ${DAYS} days of ${TICK_MINUTES}-minute ticks over ${vehicles.length} tracked vehicles.\n`);

    const counters: Record<string, Counters> = {
      theft_after_hours_movement: emptyCounters(), severe_driving: emptyCounters(),
      prolonged_unauthorized_stop: emptyCounters(), lost_contact_moving: emptyCounters(),
    };
    const opened = new Set<string>();

    for (const vehicle of vehicles) {
      const all = await loadPositions(client, vehicle.vehicleId, loadFrom, withEventType);
      const label = vehicle.registration ?? vehicle.vehicleId.slice(0, 8);
      if (all.length === 0) continue;

      for (let tickMs = startMs; tickMs <= endMs; tickMs += TICK_MINUTES * 60_000) {
        const now = new Date(tickMs).toISOString();
        const windowFrom = tickMs - WINDOW_HOURS * 3_600_000;
        const cadenceFrom = tickMs - CADENCE_HOURS * 3_600_000;
        const upTo = all.filter((p) => Date.parse(p.recordedAt) <= tickMs);
        if (upTo.length === 0) continue;

        const ctx: VehicleDetectorContext = {
          vehicle, rule, holidays, now,
          positions: upTo.filter((p) => Date.parse(p.recordedAt) >= windowFrom),
          lastPosition: upTo[upTo.length - 1] ?? null,
          gapP90Seconds: p90Gap(upTo.filter((p) => Date.parse(p.recordedAt) >= cadenceFrom)),
        };

        const results = await runTick(ctx, places);
        for (const [detector, events] of Object.entries(results)) {
          for (const event of events) {
            if (opened.has(event.sourceEventId)) continue;
            opened.add(event.sourceEventId);
            record(counters[detector] as Counters, sastDay(event.occurredAt), label);
          }
        }
      }
    }

    report('detector                      total   per day   worst day   vehicles');
    report('-'.repeat(72));
    for (const [detector, c] of Object.entries(counters)) {
      const worst = Math.max(0, ...c.byDay.values());
      report(`${detector.padEnd(30)}${String(c.total).padStart(5)}`
        + `${(c.total / DAYS).toFixed(2).padStart(10)}${String(worst).padStart(12)}`
        + `${String(c.byVehicle.size).padStart(11)}`);
    }

    for (const [detector, c] of Object.entries(counters)) {
      if (c.total === 0) continue;
      report(`\n${detector} — per day:`);
      for (const day of [...c.byDay.keys()].sort()) report(`  ${day}  ${c.byDay.get(day)}`);
      report(`${detector} — per vehicle:`);
      for (const [reg, n] of [...c.byVehicle.entries()].sort((a, b) => b[1] - a[1])) {
        report(`  ${reg.padEnd(14)} ${n}`);
      }
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  }
}

void main();
