/**
 * Dry run: segment REAL positions in memory and report. Writes nothing, needs no migration.
 * Run: npx tsx scripts/fleet-trips-dryrun.ts [days]
 */
import { Pool } from 'pg';
import { DEFAULT_SEGMENT_OPTIONS, segmentTrips, type TripPosition } from '../src/modules/fleet/trips/tripSegmenter';

const days = Number(process.argv[2] ?? 7);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}

async function main() {
  const { rows: vehicles } = await pool.query<{ vehicle_id: string; registration: string; provider: string }>(
    `SELECT DISTINCT ON (p.vehicle_id) p.vehicle_id, v.registration, p.provider
     FROM fleet_vehicle_positions p JOIN fleet_vehicles v ON v.id = p.vehicle_id
     WHERE p.recorded_at > now() - ($1 || ' days')::interval
     ORDER BY p.vehicle_id, p.recorded_at DESC`, [String(days)]);

  const opts = { ...DEFAULT_SEGMENT_OPTIONS, now: new Date().toISOString() };
  let totals = { trips: 0, ignitionOff: 0, timeout: 0, open: 0, km: 0, idle: 0, moving: 0 };

  console.log(`\nvehicle      prov      trips  ign_off  timeout  open   km      idle_h  longest_h`);
  console.log('-'.repeat(78));

  for (const v of vehicles) {
    const { rows } = await pool.query(
      `SELECT recorded_at, ignition, lat, lon, speed_kph, odometer_km
       FROM fleet_vehicle_positions
       WHERE vehicle_id = $1 AND recorded_at > now() - ($2 || ' days')::interval
       ORDER BY recorded_at`, [v.vehicle_id, String(days)]);

    const positions: TripPosition[] = rows.map((r) => ({
      recordedAt: new Date(r.recorded_at).toISOString(),
      ignition: r.ignition, lat: num(r.lat), lon: num(r.lon),
      speedKph: num(r.speed_kph), odometerKm: num(r.odometer_km),
    }));

    const { trips } = segmentTrips(positions, opts);
    const off = trips.filter((t) => t.closeReason === 'ignition_off').length;
    const to = trips.filter((t) => t.closeReason === 'timeout').length;
    const op = trips.filter((t) => t.closeReason === 'open').length;
    const km = trips.reduce((s, t) => s + t.distanceKm, 0);
    const idle = trips.reduce((s, t) => s + t.idleSeconds, 0);
    const moving = trips.reduce((s, t) => s + t.movingSeconds, 0);
    const longest = Math.max(0, ...trips.map((t) => t.durationSeconds)) / 3600;

    totals = { trips: totals.trips + trips.length, ignitionOff: totals.ignitionOff + off,
      timeout: totals.timeout + to, open: totals.open + op, km: totals.km + km,
      idle: totals.idle + idle, moving: totals.moving + moving };

    console.log(
      `${(v.registration ?? '?').padEnd(12)} ${(v.provider ?? '').padEnd(9)} ` +
      `${String(trips.length).padStart(5)} ${String(off).padStart(8)} ${String(to).padStart(8)} ` +
      `${String(op).padStart(5)} ${km.toFixed(0).padStart(6)} ${(idle/3600).toFixed(1).padStart(7)} ` +
      `${longest.toFixed(1).padStart(9)}`);
  }

  console.log('-'.repeat(78));
  console.log(`TOTAL over ${days}d: ${totals.trips} trips — ${totals.ignitionOff} genuine, ` +
    `${totals.timeout} timeout, ${totals.open} open`);
  console.log(`  distance ${totals.km.toFixed(0)} km | moving ${(totals.moving/3600).toFixed(1)}h | idle ${(totals.idle/3600).toFixed(1)}h`);
  const pct = totals.trips ? (100 * totals.ignitionOff / totals.trips) : 0;
  console.log(`  metric-eligible: ${pct.toFixed(1)}% of trips`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
