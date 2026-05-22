/**
 * tests/db/services/field-stock/serialTimeline.test.ts
 *
 * Integration tests for getSerialTimeline(). Runs against the Wave-1
 * docker-compose harness (boot via:
 *   docker-compose -f tests/db/setup/docker-compose.test.yml up -d).
 *
 * Pattern mirrors searchSerials.test.ts:
 *   INSERT-only with PR9A-prefixed UUIDs and serial numbers; targeted
 *   DELETE in afterAll inside try/finally so pool.end() always fires.
 *   No TRUNCATE — would wipe the shared seed used by tests/db/triggers.
 *
 * Schema confirmed against prod 2026-05-22:
 *   stock_serials.previous_status        varchar(50) NULL
 *   stock_serials.status_changed_at      timestamptz NULL
 * Both UNVERIFIED markers from the plan resolved — the "Status changed"
 * pseudo branch ships.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { getSerialTimeline } from '@/modules/procurement/field-stock/services/serialTimelineService';

const TEST_DB_URL = process.env.DATABASE_URL_TEST;
if (!TEST_DB_URL) {
  throw new Error(
    'DATABASE_URL_TEST not set — boot tests/db/setup/docker-compose.test.yml or run via `npm run test:db`.'
  );
}

const ITEM_ONT      = 'bbbbbbbb-0000-0000-0000-000000000001';
const WAREHOUSE     = 'bbbbbbbb-0000-0000-0000-000000000002';
const PROJECT_PR9A  = 'bbbbbbbb-0000-0000-0000-000000000003';

const SN_EMPTY        = 'PR9A-SN-EMPTY-01';
const SN_PSEUDO_ONLY  = 'PR9A-SN-PSEUDO-01';
const SN_PSEUDO_ACT   = 'PR9A-SN-PSEUDO-ACT-01';
const SN_STATUS_CHG   = 'PR9A-SN-STATUS-CHG-01';
const SN_WITH_EVENTS  = 'PR9A-SN-EVT-01';

const pool = new Pool({ connectionString: TEST_DB_URL });

beforeAll(async () => {
  await pool.query(
    `INSERT INTO stock_items (id, item_code, name, category, tracking_type)
     VALUES ($1, 'PR9A-ONT', 'PR9A Test ONT', 'ONT', 'serial')
     ON CONFLICT (id) DO NOTHING`,
    [ITEM_ONT]
  );
  await pool.query(
    `INSERT INTO stock_locations (id, code, name, location_type)
     VALUES ($1, 'PR9A-WH', 'PR9A Warehouse', 'warehouse')
     ON CONFLICT (id) DO NOTHING`,
    [WAREHOUSE]
  );
  await pool.query(
    `INSERT INTO projects (id, name)
     VALUES ($1, 'PR9A Test Project')
     ON CONFLICT (id) DO NOTHING`,
    [PROJECT_PR9A]
  );

  // SN_EMPTY — available, no dates, no events. Expect entries=[].
  await pool.query(
    `INSERT INTO stock_serials (stock_item_id, serial_number, status)
     VALUES ($1, $2, 'available')`,
    [ITEM_ONT, SN_EMPTY]
  );

  // SN_PSEUDO_ONLY — installed, has received_date + installed_date + drop_number,
  // no events. Expect 2 pseudo entries (Received + Installed at drop), reverse-chrono.
  await pool.query(
    `INSERT INTO stock_serials
       (stock_item_id, serial_number, status, current_location_id,
        allocated_to_project_id, installed_at_drop_number,
        received_date, installed_date)
     VALUES ($1, $2, 'installed', $3, $4, 'PR9A-DR-0001',
             '2026-04-01', '2026-05-01T08:00:00Z')`,
    [ITEM_ONT, SN_PSEUDO_ONLY, WAREHOUSE, PROJECT_PR9A]
  );

  // SN_PSEUDO_ACT — activated, has activated_at_olt_id, status_changed_at,
  // received_date, installed_date. No events. Expect 3 pseudo entries
  // (Received + Installed at drop + Activated on OLT). The "Status changed"
  // pseudo MUST NOT fire because previous_status IS NULL.
  await pool.query(
    `INSERT INTO stock_serials
       (stock_item_id, serial_number, status, allocated_to_project_id,
        installed_at_drop_number, received_date, installed_date,
        activated_at_olt_id, status_changed_at)
     VALUES ($1, $2, 'activated', $3, 'PR9A-DR-0002',
             '2026-04-01', '2026-05-01T08:00:00Z',
             'OLT-PR9A-01', '2026-05-15T14:00:00Z')`,
    [ITEM_ONT, SN_PSEUDO_ACT, PROJECT_PR9A]
  );

  // SN_STATUS_CHG — faulty with previous_status + status_changed_at populated.
  // No events. Expect the "Status changed" pseudo (4th rule) to fire because
  // previous_status != status AND there are no real events.
  await pool.query(
    `INSERT INTO stock_serials
       (stock_item_id, serial_number, status,
        previous_status, status_changed_at)
     VALUES ($1, $2, 'faulty', 'installed', '2026-05-18T09:00:00Z')`,
    [ITEM_ONT, SN_STATUS_CHG]
  );

  // SN_WITH_EVENTS — activated with received_date populated AND two real
  // events: installed_at_drop + activated. Expect 3 entries total: 2 real
  // events + 1 pseudo (Received). The "Installed at drop" pseudo MUST NOT
  // fire (real installed_at_drop event covers it). The "Activated on OLT"
  // pseudo MUST NOT fire (real activated event covers it AND there is no
  // activated_at_olt_id set).
  const sidRes = await pool.query<{ id: string }>(
    `INSERT INTO stock_serials
       (stock_item_id, serial_number, status, received_date)
     VALUES ($1, $2, 'activated', '2026-04-01')
     RETURNING id`,
    [ITEM_ONT, SN_WITH_EVENTS]
  );
  const sid = sidRes.rows[0].id;
  await pool.query(
    `INSERT INTO stock_serial_events
       (serial_id, event_type, from_state, to_state, occurred_at, payload)
     VALUES
       ($1, 'installed_at_drop', 'issued',    'installed', '2026-05-10T08:00:00Z', '{"drop_number":"PR9A-DR-EVT"}'::jsonb),
       ($1, 'activated',         'installed', 'activated', '2026-05-15T14:00:00Z', '{"resolution_status":"activated"}'::jsonb)`,
    [sid]
  );
});

afterAll(async () => {
  try {
    await pool.query(
      `DELETE FROM stock_serial_events
       WHERE serial_id IN (SELECT id FROM stock_serials WHERE serial_number LIKE 'PR9A-%')`
    );
    await pool.query(`DELETE FROM stock_serials WHERE serial_number LIKE 'PR9A-%'`);
    await pool.query(`DELETE FROM projects WHERE id = $1`, [PROJECT_PR9A]);
    await pool.query(`DELETE FROM stock_locations WHERE id = $1`, [WAREHOUSE]);
    await pool.query(`DELETE FROM stock_items WHERE id = $1`, [ITEM_ONT]);
  } finally {
    await pool.end();
  }
});

describe('getSerialTimeline', () => {
  it('returns null for unknown serial', async () => {
    const result = await getSerialTimeline('PR9A-SN-DOES-NOT-EXIST');
    expect(result).toBeNull();
  });

  it('returns empty entries when no events and no pseudo triggers', async () => {
    const result = await getSerialTimeline(SN_EMPTY);
    expect(result).not.toBeNull();
    expect(result!.entries).toEqual([]);
    expect(result!.hasRealEvents).toBe(false);
    expect(result!.serial.serialNumber).toBe(SN_EMPTY);
    expect(result!.serial.status).toBe('available');
  });

  it('emits pseudo Received + Installed-at-drop when no events but columns populated', async () => {
    const result = await getSerialTimeline(SN_PSEUDO_ONLY);
    expect(result).not.toBeNull();
    expect(result!.hasRealEvents).toBe(false);
    expect(result!.entries).toHaveLength(2);
    expect(result!.entries.every((e) => e.kind === 'pseudo')).toBe(true);
    // Reverse-chrono: Installed (2026-05-01) before Received (2026-04-01).
    const labels = result!.entries.map((e) => (e.kind === 'pseudo' ? e.label : ''));
    expect(labels).toEqual(['Installed at drop', 'Received into stock']);
    expect(result!.serial.installedAtDropNumber).toBe('PR9A-DR-0001');
    expect(result!.serial.allocatedProjectName).toBe('PR9A Test Project');
    expect(result!.serial.currentLocationName).toBe('PR9A Warehouse');
  });

  it('emits Activated-on-OLT pseudo when activated_at_olt_id set and no real activated event', async () => {
    const result = await getSerialTimeline(SN_PSEUDO_ACT);
    expect(result).not.toBeNull();
    expect(result!.hasRealEvents).toBe(false);
    expect(result!.entries).toHaveLength(3);
    const labels = result!.entries.map((e) => (e.kind === 'pseudo' ? e.label : ''));
    // Reverse-chrono: Activated (2026-05-15) → Installed (2026-05-01) → Received (2026-04-01).
    expect(labels).toEqual(['Activated on OLT', 'Installed at drop', 'Received into stock']);
    // Description carries the OLT id.
    const activated = result!.entries[0];
    expect(activated.kind).toBe('pseudo');
    if (activated.kind === 'pseudo') {
      expect(activated.description).toContain('OLT-PR9A-01');
    }
  });

  it('emits Status-changed pseudo when previous_status set and no real events', async () => {
    const result = await getSerialTimeline(SN_STATUS_CHG);
    expect(result).not.toBeNull();
    expect(result!.hasRealEvents).toBe(false);
    expect(result!.entries).toHaveLength(1);
    const e = result!.entries[0];
    expect(e.kind).toBe('pseudo');
    if (e.kind === 'pseudo') {
      expect(e.label).toBe('Status changed');
      expect(e.description).toBe('installed → faulty');
    }
  });

  it('returns real events + non-duplicating pseudo entries when events exist', async () => {
    const result = await getSerialTimeline(SN_WITH_EVENTS);
    expect(result).not.toBeNull();
    expect(result!.hasRealEvents).toBe(true);
    expect(result!.entries).toHaveLength(3);
    // 2 real events newest-first + 1 pseudo Received at the bottom.
    const realEventTypes = result!.entries
      .filter((e) => e.kind === 'event')
      .map((e) => (e.kind === 'event' ? e.eventType : ''));
    expect(realEventTypes).toEqual(['activated', 'installed_at_drop']);
    expect(result!.entries[result!.entries.length - 1].kind).toBe('pseudo');
    if (result!.entries[result!.entries.length - 1].kind === 'pseudo') {
      const last = result!.entries[result!.entries.length - 1] as { label: string };
      expect(last.label).toBe('Received into stock');
    }
    // The "Installed at drop" pseudo must NOT fire because a real
    // installed_at_drop event already covers that fact.
    const pseudoLabels = result!.entries
      .filter((e) => e.kind === 'pseudo')
      .map((e) => (e.kind === 'pseudo' ? e.label : ''));
    expect(pseudoLabels).not.toContain('Installed at drop');
  });

  it('serializes occurredAt as ISO string for real events', async () => {
    const result = await getSerialTimeline(SN_WITH_EVENTS);
    expect(result).not.toBeNull();
    const realEvents = result!.entries.filter((e) => e.kind === 'event');
    expect(realEvents).toHaveLength(2);
    for (const e of realEvents) {
      expect(typeof e.occurredAt).toBe('string');
      expect(e.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});
