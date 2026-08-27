/**
 * Delivery-tree query against a real Postgres fixture.
 *
 * Exercises the SQL the QA Centre route runs (`fetchDeliveryTree`), not a
 * re-implementation of it: the join to `pon_delivery_state`, the superseded
 * filter on `zone_delivery_documents`, the zone count sums, and both filter
 * branches.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { fetchDeliveryTree } from '@/modules/construction-qa/delivery-tree/deliveryTreeQuery';
import type { DeliveryTreeProject } from '@/modules/construction-qa/delivery-tree/types';

const ALPHA = '5a000000-0000-4000-8000-000000000001';
const BETA = '5a000000-0000-4000-8000-000000000002';
const ALPHA_Z1_PON1 = '5b000000-0000-4000-8000-000000000001';
const ALPHA_Z1_PON2 = '5b000000-0000-4000-8000-000000000002';
const ALPHA_Z2_PON1 = '5b000000-0000-4000-8000-000000000003';
const BETA_Z5_PON1 = '5b000000-0000-4000-8000-000000000004';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const SUBMITTED_AT = '2026-08-20T09:15:00.000Z';
const BETA_SUBMITTED_AT = '2026-08-21T06:00:00.000Z';

const checksum = (seed: string) => seed.repeat(64).slice(0, 64);

const project = (tree: { projects: DeliveryTreeProject[] }, id: string) =>
  tree.projects.find(candidate => candidate.id === id);

describe('delivery tree query', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL_TEST });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Scoped teardown in FK order. The shared fixture's PON rows are left
    // alone — other suites in this container depend on them — so assertions
    // below address these two projects by id rather than by position.
    await pool.query(
      `DELETE FROM zone_delivery_documents WHERE project_id = ANY($1::uuid[])`, [[ALPHA, BETA]]);
    await pool.query(
      `DELETE FROM pon_delivery_state WHERE pon_stage_id = ANY($1::uuid[])`,
      [[ALPHA_Z1_PON1, ALPHA_Z1_PON2, ALPHA_Z2_PON1, BETA_Z5_PON1]]);
    await pool.query(
      `DELETE FROM zone_delivery_state WHERE project_id = ANY($1::uuid[])`, [[ALPHA, BETA]]);
    await pool.query(
      `DELETE FROM pon_stage_tracking WHERE project_id = ANY($1::uuid[])`, [[ALPHA, BETA]]);
    await pool.query(`DELETE FROM projects WHERE id = ANY($1::uuid[])`, [[ALPHA, BETA]]);

    await pool.query(
      `INSERT INTO projects (id, project_name) VALUES ($1, 'QA Tree Alpha'), ($2, 'QA Tree Beta')`,
      [ALPHA, BETA]);

    await pool.query(`
      INSERT INTO pon_stage_tracking
        (id, project_id, zone_no, pon_no,
         poles_total, poles_planted, activation_total, activation_complete)
      VALUES
        ($1, $5, 1, 1, 10, 4, 120, 9),
        ($2, $5, 1, 2, 5, 5, 30, 30),
        ($3, $5, 2, 1, 7, 2, 40, 1),
        ($4, $6, 5, 1, 3, 3, 10, 10)
    `, [ALPHA_Z1_PON1, ALPHA_Z1_PON2, ALPHA_Z2_PON1, BETA_Z5_PON1, ALPHA, BETA]);

    // Zone rows exist only where documents hang off them (the documents FK
    // targets zone_delivery_state). Beta zone 5 deliberately has neither.
    await pool.query(`
      INSERT INTO zone_delivery_state (project_id, zone_no) VALUES ($1, 1), ($1, 2)
    `, [ALPHA]);

    // Alpha zone 1: active FAC + active CAC  -> Maintenance.
    // Alpha zone 2: active FAC + SUPERSEDED CAC -> WIP. The superseded row is
    // the point of this fixture: a query that ignored superseded_at would call
    // this zone Maintenance.
    await pool.query(`
      INSERT INTO zone_delivery_documents
        (project_id, zone_no, document_type, document_source, source_ref, filename,
         mime_type, size_bytes, checksum_sha256, uploaded_by, superseded_at, superseded_by)
      VALUES
        ($1, 1, 'fac', 'vf_storage', 'z1-fac.pdf', 'z1-fac.pdf',
         'application/pdf', 10, $2, $6, NULL, NULL),
        ($1, 1, 'cac', 'vf_storage', 'z1-cac.pdf', 'z1-cac.pdf',
         'application/pdf', 10, $3, $6, NULL, NULL),
        ($1, 2, 'fac', 'vf_storage', 'z2-fac.pdf', 'z2-fac.pdf',
         'application/pdf', 10, $4, $6, NULL, NULL),
        ($1, 2, 'cac', 'vf_storage', 'z2-cac.pdf', 'z2-cac.pdf',
         'application/pdf', 10, $5, $6, NOW(), $6)
    `, [ALPHA, checksum('a'), checksum('b'), checksum('c'), checksum('d'), USER_ID]);

    // Alpha z1 PON 1 and Beta are submitted; Alpha z1 PON 2 has a delivery-state
    // row with no submission; Alpha z2 PON 1 has no delivery-state row at all,
    // which is the LEFT JOIN's null path.
    await pool.query(`
      INSERT INTO pon_delivery_state (pon_stage_id, port_submitted_at, port_submitted_by)
      VALUES ($1, $4::timestamptz, $6), ($2, NULL, NULL), ($3, $5::timestamptz, $6)
    `, [ALPHA_Z1_PON1, ALPHA_Z1_PON2, BETA_Z5_PON1, SUBMITTED_AT, BETA_SUBMITTED_AT, USER_ID]);
  });

  it('groups both projects into zones and PONs, sorted by name', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: null, opticalSubmittedOnly: false });
    const names = tree.projects.map(candidate => candidate.name)
      .filter(name => name.startsWith('QA Tree '));

    expect(names).toEqual(['QA Tree Alpha', 'QA Tree Beta']);
    expect(project(tree, ALPHA)!.zones.map(zone => zone.zone_no)).toEqual([1, 2]);
    expect(project(tree, ALPHA)!.zones[0]!.pons.map(pon => pon.pon_no)).toEqual([1, 2]);
    expect(project(tree, BETA)!.zones.map(zone => zone.zone_no)).toEqual([5]);
  });

  it('is Maintenance with an active FAC and CAC, and WIP when the CAC is superseded', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: ALPHA, opticalSubmittedOnly: false });
    const [zoneOne, zoneTwo] = project(tree, ALPHA)!.zones;

    expect(zoneOne!.status).toBe('Maintenance');
    expect(zoneTwo!.status).toBe('WIP');
  });

  it('is WIP for a zone with no documents at all', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: BETA, opticalSubmittedOnly: false });

    expect(project(tree, BETA)!.zones[0]!.status).toBe('WIP');
  });

  it('sums PON counts into the zone row as numbers', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: ALPHA, opticalSubmittedOnly: false });
    const zoneOne = project(tree, ALPHA)!.zones[0]!;

    expect(zoneOne.counts).toEqual({
      poles_total: 15,
      poles_planted: 9,
      activation_total: 150,
      activation_complete: 39,
    });
    // ::int plus node-postgres must yield numbers; a string would make the
    // sums above concatenate instead of add.
    expect(typeof zoneOne.pons[0]!.counts.poles_total).toBe('number');
  });

  it('exposes port_submitted_at as opticalSubmittedAt and derives the PON status', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: ALPHA, opticalSubmittedOnly: false });
    const [zoneOne, zoneTwo] = project(tree, ALPHA)!.zones;

    expect(zoneOne!.pons[0]).toMatchObject({
      pon_no: 1, status: 'Optical Submitted', opticalSubmittedAt: SUBMITTED_AT,
    });
    // Delivery-state row present, submission null.
    expect(zoneOne!.pons[1]).toMatchObject({
      pon_no: 2, status: 'WIP', opticalSubmittedAt: null,
    });
    // No delivery-state row at all — the LEFT JOIN null path.
    expect(zoneTwo!.pons[0]).toMatchObject({
      pon_no: 1, status: 'WIP', opticalSubmittedAt: null,
    });
  });

  it('restricts to one project when projectId is given', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: BETA, opticalSubmittedOnly: false });

    expect(tree.projects.map(candidate => candidate.id)).toEqual([BETA]);
  });

  it('keeps only submitted PONs across all projects when opticalSubmittedOnly is set', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: null, opticalSubmittedOnly: true });
    const alpha = project(tree, ALPHA)!;

    // Zone 2 held only an unsubmitted PON, so the zone drops out entirely.
    expect(alpha.zones.map(zone => zone.zone_no)).toEqual([1]);
    expect(alpha.zones[0]!.pons.map(pon => pon.pon_no)).toEqual([1]);
    expect(project(tree, BETA)!.zones[0]!.pons.map(pon => pon.pon_no)).toEqual([1]);
    // The surviving zone's counts are the filtered PON's, not the full zone's.
    expect(alpha.zones[0]!.counts.poles_total).toBe(10);
  });

  it('applies projectId and opticalSubmittedOnly together', async () => {
    const tree = await fetchDeliveryTree(pool, { projectId: ALPHA, opticalSubmittedOnly: true });

    expect(tree.projects.map(candidate => candidate.id)).toEqual([ALPHA]);
    expect(tree.projects[0]!.zones).toHaveLength(1);
    expect(tree.projects[0]!.zones[0]!.pons).toHaveLength(1);
  });
});
