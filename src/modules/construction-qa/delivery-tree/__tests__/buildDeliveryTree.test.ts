import { describe, expect, it } from 'vitest';
import { buildDeliveryTree } from '../buildDeliveryTree';
import type { DeliveryTreeQueryRow } from '../types';

const PROJECT_A = '11111111-1111-4111-8111-111111111111';
const PROJECT_B = '22222222-2222-4222-8222-222222222222';

function row(overrides: Partial<DeliveryTreeQueryRow> = {}): DeliveryTreeQueryRow {
  return {
    project_id: PROJECT_A,
    project_name: 'Mohadin',
    zone_no: 1,
    pon_no: 1,
    poles_total: 10,
    poles_planted: 4,
    activation_total: 120,
    activation_complete: 9,
    port_submitted_at: null,
    hasActiveFac: false,
    hasActiveCac: false,
    ...overrides,
  };
}

describe('buildDeliveryTree', () => {
  it('returns no projects for no rows', () => {
    expect(buildDeliveryTree([])).toEqual({ projects: [] });
  });

  it('groups PONs under their zone and project', () => {
    const tree = buildDeliveryTree([
      row({ zone_no: 1, pon_no: 1 }),
      row({ zone_no: 1, pon_no: 2 }),
      row({ zone_no: 2, pon_no: 1 }),
    ]);

    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0]!.zones.map(zone => zone.zone_no)).toEqual([1, 2]);
    expect(tree.projects[0]!.zones[0]!.pons.map(pon => pon.pon_no)).toEqual([1, 2]);
  });

  it('sorts projects by name, zones and PONs ascending regardless of row order', () => {
    const tree = buildDeliveryTree([
      row({ project_id: PROJECT_B, project_name: 'Zenzele', zone_no: 3, pon_no: 9 }),
      row({ zone_no: 4, pon_no: 2 }),
      row({ zone_no: 2, pon_no: 7 }),
      row({ zone_no: 2, pon_no: 3 }),
    ]);

    expect(tree.projects.map(project => project.name)).toEqual(['Mohadin', 'Zenzele']);
    expect(tree.projects[0]!.zones.map(zone => zone.zone_no)).toEqual([2, 4]);
    expect(tree.projects[0]!.zones[0]!.pons.map(pon => pon.pon_no)).toEqual([3, 7]);
  });

  it('sums PON counts into the zone row', () => {
    const tree = buildDeliveryTree([
      row({ pon_no: 1, poles_total: 10, poles_planted: 4, activation_total: 120, activation_complete: 9 }),
      row({ pon_no: 2, poles_total: 5, poles_planted: 5, activation_total: 30, activation_complete: 30 }),
    ]);

    expect(tree.projects[0]!.zones[0]!.counts).toEqual({
      poles_total: 15,
      poles_planted: 9,
      activation_total: 150,
      activation_complete: 39,
    });
  });

  it('marks a zone Maintenance only when both certificates are active', () => {
    const maintenance = buildDeliveryTree([row({ hasActiveFac: true, hasActiveCac: true })]);
    const facOnly = buildDeliveryTree([row({ hasActiveFac: true, hasActiveCac: false })]);

    expect(maintenance.projects[0]!.zones[0]!.status).toBe('Maintenance');
    expect(facOnly.projects[0]!.zones[0]!.status).toBe('WIP');
  });

  it('exposes the port submission timestamp as opticalSubmittedAt', () => {
    const tree = buildDeliveryTree([
      row({ pon_no: 1, port_submitted_at: '2026-08-20T09:15:00.000Z' }),
      row({ pon_no: 2, port_submitted_at: null }),
    ]);

    const [submitted, pending] = tree.projects[0]!.zones[0]!.pons;
    expect(submitted).toMatchObject({
      status: 'Optical Submitted',
      opticalSubmittedAt: '2026-08-20T09:15:00.000Z',
    });
    expect(pending).toMatchObject({ status: 'WIP', opticalSubmittedAt: null });
  });
});
