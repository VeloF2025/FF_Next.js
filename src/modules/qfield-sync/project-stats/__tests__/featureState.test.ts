import { describe, expect, it } from 'vitest';
import { buildQFieldInfrastructure } from '../featureState';
import type { QFieldDelta } from '../qfieldDeltaRepo';

function delta(
  featureKey: string,
  status: string,
  createdAt: string,
  lastStatus: QFieldDelta['lastStatus'] = 'applied',
): QFieldDelta {
  return {
    id: `${featureKey}-${createdAt}-${lastStatus}`,
    featureKey,
    label: `HT_${featureKey}`,
    status,
    lastStatus,
    createdAt,
    dropNumber: null,
    cableId: null,
    cableLengthM: null,
    installationStatus: null,
    qcStatus: null,
    photoKeys: [],
  };
}

describe('buildQFieldInfrastructure', () => {
  it('keeps a planted pole planted through missing photos and QA failure', () => {
    const snapshot = buildQFieldInfrastructure([
      delta('1', 'Pole Planted - Photos Incomplete', '2026-07-29T08:00:00Z'),
      delta('1', 'Q/A Failed', '2026-07-29T09:00:00Z'),
    ]);
    expect(snapshot.poles.planted).toBe(1);
    expect(snapshot.poles.photoIncomplete).toBe(1);
    expect(snapshot.poles.qaFailed).toBe(1);
  });

  it('removal clears physical state and a later replant restores it', () => {
    const removed = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('1', 'Pole Removed/Canceled', '2026-07-29T09:00:00Z'),
    ]);
    expect(removed.poles.planted).toBe(0);

    const replanted = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('1', 'Pole Removed/Canceled', '2026-07-29T09:00:00Z'),
      delta('1', 'Pole Planted - Photos Incomplete', '2026-07-29T10:00:00Z'),
    ]);
    expect(replanted.poles.planted).toBe(1);
  });

  it('does not double count an error twin after an applied event', () => {
    const snapshot = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T09:00:00Z', 'error'),
    ]);
    expect(snapshot.poles.planted).toBe(1);
    expect(snapshot.poles.staleDuplicates).toBe(1);
  });

  it('keeps QA on the pole when pole and cable localPk values collide', () => {
    const cable = {
      ...delta('1', 'String Complete', '2026-07-29T09:00:00Z'),
      cableId: 'C-1',
      cableLengthM: 120,
    };
    const snapshot = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      cable,
      delta('1', 'Q/A Failed', '2026-07-29T10:00:00Z'),
    ]);
    expect(snapshot.poles.qfieldTotal).toBe(1);
    expect(snapshot.poles.planted).toBe(1);
    expect(snapshot.poles.qaFailed).toBe(1);
    expect(snapshot.cables.qfieldTotal).toBe(1);
  });

  it('preserves the complete latest status distribution and unknown statuses', () => {
    const snapshot = buildQFieldInfrastructure([
      delta('1', 'Pole Planted/ All Photos', '2026-07-29T08:00:00Z'),
      delta('2', 'Pole Mystery State', '2026-07-29T08:00:00Z'),
    ]);
    expect(snapshot.poles.byStatus).toEqual({
      'Pole Planted/ All Photos': 1,
      'Pole Mystery State': 1,
    });
    expect(snapshot.anomalies).toContainEqual(
      expect.objectContaining({ type: 'unknown_status', featureKey: '2' }),
    );
  });

  it('maps only unambiguous drop headlines and preserves the source labels', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('drop-1', 'Drop Updated', '2026-07-29T08:00:00Z'),
        dropNumber: 'DR-1',
        installationStatus: 'Installed',
        qcStatus: 'Approved',
      },
    ]);
    expect(snapshot.drops.installed).toBe(1);
    expect(snapshot.drops.approved).toBe(1);
    expect(snapshot.drops.installationByStatus).toEqual({ Installed: 1 });
    expect(snapshot.drops.qcByStatus).toEqual({ Approved: 1 });
  });

  it('counts a duplicated drop number once using its latest applied state', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('local-1', 'Drop Updated', '2026-07-29T08:00:00Z'),
        dropNumber: 'DR-1',
        installationStatus: 'Planned',
        qcStatus: 'Pending',
      },
      {
        ...delta('local-2', 'Drop Updated', '2026-07-29T09:00:00Z'),
        dropNumber: 'DR-1',
        installationStatus: 'Installed',
        qcStatus: 'Approved',
      },
    ]);
    expect(snapshot.drops.qfieldTotal).toBe(1);
    expect(snapshot.drops.installationByStatus).toEqual({ Installed: 1 });
    expect(snapshot.drops.approved).toBe(1);
    expect(snapshot.anomalies).toContainEqual(
      expect.objectContaining({ type: 'sync_mismatch', featureKey: 'dr-1' }),
    );
  });
});
