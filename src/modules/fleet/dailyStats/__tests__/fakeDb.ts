/**
 * A tiny SQL engine for the three statements `dailyStatsRepository` issues.
 *
 * ## Why this is not a mock of the repository
 *
 * The properties PR2 has to prove live in the SQL TEXT, not in the TypeScript around it: whether
 * the paging cursor is exclusive, whether the upsert replaces or does nothing, whether the rows
 * come back ordered. A `vi.fn()` standing in for `loadPositionsForWindow` cannot fail when the
 * operator in the query changes, so a mutation to `>=` or to `DO NOTHING` would survive every
 * test in the suite while the production job silently double-counted or froze the first partial
 * day it ever computed.
 *
 * So this double READS the operator and the conflict action out of the query it is handed, rather
 * than holding its own copy of the rule. Mutate `dailyStatsRepository.ts` and this engine's
 * behaviour changes with it -- which is the only reason the mutation table in the PR body means
 * anything.
 *
 * It is deliberately narrow. It understands exactly the statements this module sends, recognised
 * by their leading tag comment, and throws on anything else so a new query cannot quietly fall
 * through to a no-op.
 */

export interface FakePositionRow extends Record<string, unknown> {
  id: string;
  vehicle_id: string;
  recorded_at: string;
  provider_event_id: string | null;
  provider: string | null;
  account_ref: string | null;
  ignition: boolean | null;
  lat: number | null;
  lon: number | null;
  speed_kph: number | null;
  is_speeding: boolean | null;
  odometer_km: number | null;
  linear_g: number | null;
  lateral_g: number | null;
  provider_event_type: string | null;
}

export interface FakeTripRow {
  vehicle_id: string;
  ignition_on_at: string;
  ignition_off_at: string | null;
}

type Row = Record<string, unknown>;

/** The slice of `@/lib/db-pool` a test replaces with a `FakeDb`. */
export interface QueryLike {
  query(text: string, params: unknown[]): Promise<unknown[]>;
  queryOne(text: string, params: unknown[]): Promise<unknown>;
}

/** `(recorded_at, id)` as one comparable string, so a tuple comparison is a string comparison. */
function tupleKey(recordedAt: string, id: string): string {
  return `${new Date(recordedAt).toISOString()}|${id}`;
}

function tag(text: string): string {
  const m = /\/\*\s*([\w:-]+)\s*\*\//.exec(text);
  if (!m) throw new Error(`fakeDb: statement carries no tag comment: ${text.slice(0, 80)}`);
  return m[1]!;
}

/** The column list of an INSERT, read out of the statement rather than assumed. */
function insertColumns(text: string): string[] {
  const m = /INSERT INTO \w+\s*\(([^)]*)\)/i.exec(text);
  if (!m) throw new Error('fakeDb: could not read the INSERT column list');
  return m[1]!.split(',').map((c) => c.trim()).filter(Boolean);
}

/** Which columns an ON CONFLICT DO UPDATE actually assigns from EXCLUDED. */
function excludedAssignments(text: string): string[] {
  const set = /DO UPDATE SET([\s\S]*)$/i.exec(text);
  if (!set) return [];
  return [...set[1]!.matchAll(/(\w+)\s*=\s*EXCLUDED\.(\w+)/gi)].map((m) => m[1]!);
}

function conflictAction(text: string): 'update' | 'nothing' | 'none' {
  if (/ON CONFLICT[^]*?DO NOTHING/i.test(text)) return 'nothing';
  if (/ON CONFLICT[^]*?DO UPDATE/i.test(text)) return 'update';
  return 'none';
}

export interface FakeDbOptions {
  /** Statement tags that should throw, to exercise the per-vehicle failure path. */
  failOn?: (tag: string, params: readonly unknown[]) => Error | null;
}

export class FakeDb {
  positions: FakePositionRow[] = [];

  /**
   * The vehicle register, `fleet_vehicles`.
   *
   * Seeding a position registers its vehicle, because production's foreign key means a position
   * cannot exist without one. Registering a vehicle WITHOUT positions is the case the vehicle
   * query's EXISTS exists to exclude, and `registerVehicle` is how a test reaches it.
   */
  vehicles = new Set<string>();

  trips: FakeTripRow[] = [];

  dailyStats = new Map<string, Row>();

  watermarks = new Map<string, Row>();

  /** Every statement tag executed, in order — used to pin upsert-before-watermark ordering. */
  executed: { tag: string; params: readonly unknown[] }[] = [];

  constructor(private readonly options: FakeDbOptions = {}) {}

  registerVehicle(vehicleId: string): void {
    this.vehicles.add(vehicleId);
  }

  seedPositions(rows: FakePositionRow[]): void {
    for (const row of rows) this.vehicles.add(row.vehicle_id);
    this.positions.push(...rows);
    this.positions.sort((a, b) => tupleKey(a.recorded_at, a.id).localeCompare(tupleKey(b.recorded_at, b.id)));
  }

  statsRow(vehicleId: string, workDate: string): Row | undefined {
    return this.dailyStats.get(`${vehicleId}|${workDate}`);
  }

  /** A stable digest of a stats row, for the batch-invariance comparison. */
  statsHashes(): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, row] of this.dailyStats) {
      const stable = Object.keys(row).sort().map((k) => `${k}=${String(row[k])}`).join(';');
      out.set(key, stable);
    }
    return out;
  }

  async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
    const name = tag(text);
    this.executed.push({ tag: name, params });
    const failure = this.options.failOn?.(name, params);
    if (failure) throw failure;

    if (name === 'fleet-daily-stats:vehicles') return this.selectVehicles(text) as T[];
    if (name.startsWith('fleet-daily-stats:positions')) return this.selectPositions(text, params) as T[];
    if (name === 'fleet-daily-stats:position-before') return this.selectPositionBefore(text, params) as T[];
    if (name.startsWith('fleet-daily-stats:trips')) return this.selectTrips(text, params) as T[];
    if (name === 'fleet-daily-stats:watermark-read') return this.selectWatermark(params) as T[];
    if (name === 'fleet-daily-stats:watermark-write') return this.writeWatermark(text, params) as T[];
    if (name === 'fleet-daily-stats:upsert') return this.upsertStats(text, params) as T[];
    throw new Error(`fakeDb: unrecognised statement tag ${name}`);
  }

  private selectVehicles(text: string): Row[] {
    // The semi-join is applied only if the statement actually asks for it. Hardcoding it here
    // would make the fake produce the right answer from the wrong query -- the same defect that
    // let a mutation deleting the EXISTS pass the entire suite.
    const semiJoined = /EXISTS\s*\(\s*SELECT[\s\S]*?fleet_vehicle_positions[\s\S]*?\)/i.test(text);
    const withPositions = new Set(this.positions.map((p) => p.vehicle_id));
    const ids = semiJoined ? [...this.vehicles].filter((id) => withPositions.has(id)) : [...this.vehicles];
    return ids.sort().map((id) => ({ id }));
  }

  private selectPositions(text: string, params: readonly unknown[]): Row[] {
    if (!/ORDER BY recorded_at,\s*id/i.test(text)) {
      throw new Error('fakeDb: the positions query must ORDER BY recorded_at, id — paging depends on it');
    }
    const vehicleId = params[0];
    let rows = this.positions.filter((p) => p.vehicle_id === vehicleId);

    // The operators come out of the statement, so mutating them mutates this engine too.
    const lower = /recorded_at\s*(>=|>)\s*\$(\d+)::timestamptz/i.exec(text);
    if (lower) {
      const bound = new Date(String(params[Number(lower[2]) - 1])).toISOString();
      rows = rows.filter((p) => (lower[1] === '>'
        ? new Date(p.recorded_at).toISOString() > bound
        : new Date(p.recorded_at).toISOString() >= bound));
    }
    const upper = /recorded_at\s*(<=|<)\s*\$(\d+)::timestamptz/i.exec(text);
    if (upper) {
      const bound = new Date(String(params[Number(upper[2]) - 1])).toISOString();
      rows = rows.filter((p) => (upper[1] === '<'
        ? new Date(p.recorded_at).toISOString() < bound
        : new Date(p.recorded_at).toISOString() <= bound));
    }
    const cursor = /\(recorded_at,\s*id\)\s*(>=|>)\s*\(\s*\$(\d+)::timestamptz,\s*\$(\d+)\s*\)/i.exec(text);
    if (cursor) {
      const at = tupleKey(String(params[Number(cursor[2]) - 1]), String(params[Number(cursor[3]) - 1]));
      rows = rows.filter((p) => (cursor[1] === '>'
        ? tupleKey(p.recorded_at, p.id) > at
        : tupleKey(p.recorded_at, p.id) >= at));
    }

    const limit = /LIMIT \$(\d+)/i.exec(text);
    if (!limit) throw new Error('fakeDb: the positions query must carry a LIMIT');
    return rows.slice(0, Number(params[Number(limit[1]) - 1]));
  }

  private selectPositionBefore(text: string, params: readonly unknown[]): Row[] {
    if (!/ORDER BY recorded_at DESC,\s*id DESC/i.test(text)) {
      throw new Error('fakeDb: the primer query must take the LAST fix before the window');
    }
    const bound = /recorded_at\s*(<=|<)\s*\$(\d+)::timestamptz/i.exec(text);
    if (!bound) throw new Error('fakeDb: the primer query must bound recorded_at');
    const at = new Date(String(params[Number(bound[2]) - 1])).toISOString();
    const rows = this.positions.filter((p) => p.vehicle_id === params[0]
      && (bound[1] === '<'
        ? new Date(p.recorded_at).toISOString() < at
        : new Date(p.recorded_at).toISOString() <= at));
    const last = rows[rows.length - 1];
    return last ? [last] : [];
  }

  private selectTrips(text: string, params: readonly unknown[]): Row[] {
    const vehicleId = params[0];
    let rows = this.trips.filter((t) => t.vehicle_id === vehicleId && t.ignition_off_at !== null);
    // Both operators come out of the statement. An earlier version of this method CAPTURED the
    // lower one and then compared with a hardcoded `>=` regardless -- so a mutation from `>=` to
    // `>` changed the SQL, changed nothing here, and survived the whole suite. A double that
    // parses a rule and then ignores it is worse than one that never looked: it reads as coverage.
    const lower = /ignition_off_at\s*(>=|>)\s*\$(\d+)::timestamptz/i.exec(text);
    if (lower) {
      const bound = new Date(String(params[Number(lower[2]) - 1])).toISOString();
      rows = rows.filter((t) => (lower[1] === '>'
        ? new Date(t.ignition_off_at!).toISOString() > bound
        : new Date(t.ignition_off_at!).toISOString() >= bound));
    }
    const upper = /ignition_off_at\s*(<=|<)\s*\$(\d+)::timestamptz/i.exec(text);
    if (upper) {
      const bound = new Date(String(params[Number(upper[2]) - 1])).toISOString();
      rows = rows.filter((t) => (upper[1] === '<'
        ? new Date(t.ignition_off_at!).toISOString() < bound
        : new Date(t.ignition_off_at!).toISOString() <= bound));
    }
    return [...rows].sort((a, b) => a.ignition_on_at.localeCompare(b.ignition_on_at))
      .map((t) => ({ ignition_on_at: t.ignition_on_at, ignition_off_at: t.ignition_off_at }));
  }

  private selectWatermark(params: readonly unknown[]): Row[] {
    const row = this.watermarks.get(String(params[0]));
    return row ? [row] : [];
  }

  private writeWatermark(text: string, params: readonly unknown[]): Row[] {
    const cols = insertColumns(text);
    const vehicleId = String(params[0]);
    const incoming = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    const existing = this.watermarks.get(vehicleId);
    if (!existing) {
      this.watermarks.set(vehicleId, {
        ...incoming,
        last_built_at: new Date().toISOString(),
        positions_processed: Number(incoming.positions_processed ?? 0),
      });
      return [];
    }
    if (conflictAction(text) === 'nothing') return [];
    const previous = existing.last_position_at === null || existing.last_position_at === undefined
      ? null
      : String(existing.last_position_at);
    const next = incoming.last_position_at === null || incoming.last_position_at === undefined
      ? null
      : String(incoming.last_position_at);
    // Whether the mark can move BACKWARDS is read out of the statement, not decided here. This
    // method used to take the max unconditionally, so deleting GREATEST from the SQL changed the
    // anti-rewind guarantee and changed nothing any test could see.
    const antiRewind = /last_position_at\s*=\s*GREATEST\s*\(/i.test(text);
    existing.last_position_at = antiRewind && previous !== null && next !== null
      ? (previous > next ? previous : next)
      : (next ?? previous);
    existing.last_built_at = new Date().toISOString();
    existing.positions_processed = Number(existing.positions_processed ?? 0)
      + Number(incoming.positions_processed ?? 0);
    return [];
  }

  private upsertStats(text: string, params: readonly unknown[]): Row[] {
    const cols = insertColumns(text);
    if (cols.length !== params.length) {
      throw new Error(`fakeDb: upsert has ${cols.length} columns but ${params.length} parameters`);
    }
    const incoming: Row = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    const key = `${String(incoming.vehicle_id)}|${String(incoming.work_date)}`;
    const existing = this.dailyStats.get(key);
    if (!existing) {
      this.dailyStats.set(key, { ...incoming });
      return [];
    }
    const action = conflictAction(text);
    if (action !== 'update') return [];
    // Only the columns the statement actually assigns are replaced. A column dropped from the SET
    // list keeps its stale value here exactly as it would in Postgres.
    for (const col of excludedAssignments(text)) existing[col] = incoming[col];
    return [];
  }

  async queryOne<T>(text: string, params: readonly unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }
}
