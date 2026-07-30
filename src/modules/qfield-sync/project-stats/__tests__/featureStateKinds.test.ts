import { describe, expect, it } from 'vitest';
import { buildQFieldInfrastructure } from '../featureState';
import type { QFieldDelta } from '../qfieldDeltaRepo';

function delta(featureKey: string, status: string, createdAt: string): QFieldDelta {
  return {
    id: `${featureKey}-${status}-${createdAt}`,
    featureKey,
    label: `HT_${featureKey}`,
    status,
    lastStatus: 'applied',
    createdAt,
    dropNumber: null,
    cableId: null,
    cableLengthM: null,
    installationStatus: null,
    qcStatus: null,
    photoKeys: [],
  };
}

describe('buildQFieldInfrastructure feature kinds', () => {
  it.each(['Optical Complete', 'Optical WIP'])(
    'ignores an optical-only %s delta without totals or anomalies',
    (status) => {
      const snapshot = buildQFieldInfrastructure([
        delta('shared', status, '2026-07-29T08:00:00Z'),
      ]);

      expect(snapshot.poles.qfieldTotal).toBe(0);
      expect(snapshot.cables.qfieldTotal).toBe(0);
      expect(snapshot.drops.qfieldTotal).toBe(0);
      expect(snapshot.anomalies).toEqual([]);
    },
  );

  it('does not let a later optical event overwrite a pole sharing its localPk', () => {
    const snapshot = buildQFieldInfrastructure([
      delta('shared', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('shared', 'Optical Complete', '2026-07-29T09:00:00Z'),
    ]);

    expect(snapshot.poles.qfieldTotal).toBe(1);
    expect(snapshot.poles.planted).toBe(1);
    expect(snapshot.poles.byStatus).toEqual({ 'Pole Planted/ All Photos': 1 });
    expect(snapshot.anomalies).toEqual([]);
  });

  it('counts To be Planted as known civil state without marking it planted', () => {
    const snapshot = buildQFieldInfrastructure([
      delta('planned', 'To be Planted', '2026-07-29T08:00:00Z'),
    ]);

    expect(snapshot.poles.qfieldTotal).toBe(1);
    expect(snapshot.poles.planted).toBe(0);
    expect(snapshot.poles.byStatus).toEqual({ 'To be Planted': 1 });
    expect(snapshot.civilLabels).toEqual(new Set(['HT_planned']));
    expect(snapshot.anomalies).toEqual([]);
  });
});
