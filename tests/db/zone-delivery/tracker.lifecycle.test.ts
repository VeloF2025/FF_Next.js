import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { getZoneDeliveryTracker } from '@/modules/construction-qa/zone-delivery/services/zoneDeliveryTracker';
import { PROJECT_ID } from './zoneHandoverTestSupport';

/**
 * The tracker's read path, against real Postgres.
 *
 * Every other test of this feature mocks `fetch` with a pre-shaped result, so
 * the SQL that spans v_pole_planning, pole_qa_photos, oes_activations, drops
 * and the delivery tables — and the fold that turns PON rows into the zone
 * overview — never executes. That SQL is the entire feature: it is what makes
 * the screen show a live network rather than the zeros the gate tables hold.
 */
describe('delivery tracker read path', () => {
  let pool: Pool;

  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST }); });
  afterAll(async () => { await pool.end(); });

  beforeEach(async () => {
    await pool.query(`
      TRUNCATE zone_delivery_activity, zone_delivery_snag_links,
        pon_delivery_state, zone_delivery_documents, zone_delivery_state
      RESTART IDENTITY CASCADE
    `);
    await pool.query(
      `DELETE FROM pon_stage_tracking WHERE project_id = $1 AND zone_no IN (8, 9)`,
      [PROJECT_ID],
    );
  });

  const zone = async (zoneNo: number) => {
    const result = await getZoneDeliveryTracker(pool, PROJECT_ID);
    return result.zones.find(row => row.zoneNo === zoneNo);
  };
  const pons = async (zoneNo: number) => {
    const result = await getZoneDeliveryTracker(pool, PROJECT_ID);
    return result.pons.filter(row => row.zoneNo === zoneNo).sort((a, b) => a.ponNo - b.ponNo);
  };

  it('lists PONs from both Works QA sources, including PONs no delivery table knows', async () => {
    // 91 and 92 come from sow_poles, 92 and 93 from pole_qa_photos, and none of
    // them has a pon_stage_tracking row — the tracker must not need one.
    expect((await pons(9)).map(row => row.ponNo)).toEqual([91, 92, 93]);
  });

  it('reaches PONs that only public.poles carries', async () => {
    // The arm feeding the eight projects sow_poles does not cover. If the view
    // in the fixture ever collapses to sow_poles alone, this is what fails.
    expect((await pons(8)).map(row => row.ponNo)).toEqual([81, 82]);
  });

  it('counts live homes from activations, not from the technically_live gate', async () => {
    const zone9 = await pons(9);
    expect(zone9.find(row => row.ponNo === 91)?.homesActive).toBe(2);
    // Uninstalled is not a live home.
    expect(zone9.find(row => row.ponNo === 92)?.homesActive).toBe(0);
    expect(zone9.find(row => row.ponNo === 93)?.homesActive).toBe(0);

    // No PON here has technically_live stamped, so a gate-derived count would
    // report zero live PONs on a zone that is demonstrably carrying traffic.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS live FROM pon_delivery_state WHERE technically_live_at IS NOT NULL`,
    );
    expect(rows[0].live).toBe(0);
    expect((await zone(9))?.livePons).toBe(1);
  });

  it('folds the zone overview so it cannot disagree with the PON table', async () => {
    const overview = await zone(9);
    const rows = await pons(9);

    expect(overview?.totalPons).toBe(rows.length);
    expect(overview?.livePons).toBe(rows.filter(row => row.homesActive > 0).length);
    expect(overview?.homesActive).toBe(rows.reduce((sum, row) => sum + row.homesActive, 0));
  });

  it('reports no handover date until one is recorded', async () => {
    expect((await zone(9))?.handedOverAt).toBeNull();
  });

  it('surfaces a recorded handover date on the zone row', async () => {
    // zone_delivery_state is guarded by migration 470's "requires a canonical
    // PON" trigger, so the tracking row has to exist first.
    await pool.query(`
      INSERT INTO pon_stage_tracking (project_id, zone_no, pon_no) VALUES ($1, 9, 91)
    `, [PROJECT_ID]);
    // handed_over_at and handover_snapshot are constrained to move together.
    await pool.query(`
      INSERT INTO zone_delivery_state (project_id, zone_no, handed_over_at, handover_snapshot)
      VALUES ($1, 9, '2026-05-08T10:00:00Z', '{"pons": []}'::jsonb)
    `, [PROJECT_ID]);

    expect((await zone(9))?.handedOverAt).toBe('2026-05-08T10:00:00.000Z');
  });

  it('shows a submitted date once the PON is attested, and not before', async () => {
    expect((await pons(9)).every(row => row.portSubmittedAt === null)).toBe(true);

    await pool.query(`
      INSERT INTO pon_stage_tracking (project_id, zone_no, pon_no) VALUES ($1, 9, 91)
    `, [PROJECT_ID]);
    await pool.query(`
      INSERT INTO pon_delivery_state (pon_stage_id, port_submitted_at, port_submitted_by)
      SELECT id, '2026-08-05T09:00:00Z', $2
      FROM pon_stage_tracking WHERE project_id = $1 AND zone_no = 9 AND pon_no = 91
    `, [PROJECT_ID, '22222222-2222-2222-2222-222222222222']);

    const submitted = (await pons(9)).find(row => row.ponNo === 91);
    expect(submitted?.portSubmittedAt).toBe('2026-08-05T09:00:00.000Z');
    // Its homes count is unaffected by the attestation.
    expect(submitted?.homesActive).toBe(2);
  });
});
