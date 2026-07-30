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

  it('leaves pole-quality events unassigned when only a cable shares the local key', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('shared', 'String Complete', '2026-07-29T08:00:00Z'),
        cableId: 'C-1',
      },
      delta('shared', 'Q/A Failed', '2026-07-29T09:00:00Z'),
    ]);

    expect(snapshot.poles.qfieldTotal).toBe(0);
    expect(snapshot.cables.byStatus).toEqual({ 'String Complete': 1 });
    expect(snapshot.anomalies).toContainEqual(
      expect.objectContaining({
        type: 'unknown_status',
        featureKey: 'shared',
        status: 'Q/A Failed',
      }),
    );
  });

  it('excludes non-applied cable and drop histories from the current snapshot', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('cable-1', 'String Complete', '2026-07-29T08:00:00Z', 'error'),
        cableId: 'C-1',
      },
      {
        ...delta('drop-1', 'Drop Updated', '2026-07-29T09:00:00Z', 'pending'),
        dropNumber: 'DR-1',
        installationStatus: 'Installed',
        qcStatus: 'Approved',
      },
    ]);

    expect(snapshot.cables.qfieldTotal).toBe(0);
    expect(snapshot.cables.byStatus).toEqual({});
    expect(snapshot.drops.qfieldTotal).toBe(0);
    expect(snapshot.drops.installationByStatus).toEqual({});
    expect(snapshot.comparisonRecords.cables.size).toBe(0);
    expect(snapshot.comparisonRecords.drops.size).toBe(0);
    expect(snapshot.anomalies.filter(({ type }) => type === 'stuck')).toHaveLength(2);
  });

  it('preserves and flags unknown drop projection labels', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('drop-1', 'Drop Updated', '2026-07-29T08:00:00Z'),
        dropNumber: 'DR-1',
        installationStatus: 'Awaiting Permit',
        qcStatus: 'Manual Review',
      },
    ]);

    expect(snapshot.drops.installationByStatus).toEqual({ 'Awaiting Permit': 1 });
    expect(snapshot.drops.qcByStatus).toEqual({ 'Manual Review': 1 });
    expect(snapshot.drops.installed).toBe(0);
    expect(snapshot.drops.approved).toBe(0);
    expect(snapshot.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'unknown_status', status: 'Awaiting Permit' }),
        expect.objectContaining({ type: 'unknown_status', status: 'Manual Review' }),
      ]),
    );
  });

  it('flags a cable identity change and keeps the latest applied identity', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('local-1', 'String Complete', '2026-07-29T08:00:00Z'),
        cableId: 'C-1',
      },
      {
        ...delta('local-1', 'String Tested', '2026-07-29T09:00:00Z'),
        cableId: 'C-2',
      },
    ]);

    expect(snapshot.comparisonRecords.cables).toEqual(
      new Map([['c-2', { status: 'String Tested' }]]),
    );
    expect(snapshot.anomalies).toContainEqual(
      expect.objectContaining({ type: 'sync_mismatch', featureKey: 'c-2' }),
    );
  });

  it('flags a drop identity change and keeps the latest applied identity', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('local-1', 'Drop Updated', '2026-07-29T08:00:00Z'),
        dropNumber: 'DR-1',
        installationStatus: 'Planned',
        qcStatus: 'Pending',
      },
      {
        ...delta('local-1', 'Drop Updated', '2026-07-29T09:00:00Z'),
        dropNumber: 'DR-2',
        installationStatus: 'Installed',
        qcStatus: 'Approved',
      },
    ]);

    expect(snapshot.drops.qfieldTotal).toBe(1);
    expect(snapshot.comparisonRecords.drops).toEqual(
      new Map([['dr-2', { installationStatus: 'Installed', qcStatus: 'Approved' }]]),
    );
    expect(snapshot.anomalies).toContainEqual(
      expect.objectContaining({ type: 'sync_mismatch', featureKey: 'dr-2' }),
    );
  });

  it('does not carry an older cable length when the latest applied projection is missing', () => {
    const snapshot = buildQFieldInfrastructure([
      {
        ...delta('local-1', 'String Complete', '2026-07-29T08:00:00Z'),
        cableId: 'C-1',
        cableLengthM: 120,
      },
      {
        ...delta('local-1', 'String Tested', '2026-07-29T09:00:00Z'),
        cableId: 'C-1',
        cableLengthM: null,
      },
    ]);

    expect(snapshot.cables.totalLengthM).toBeNull();
    expect(snapshot.anomalies).toContainEqual(
      expect.objectContaining({
        type: 'sync_mismatch',
        featureKey: 'local-1',
        status: 'String Tested',
      }),
    );
  });
});
