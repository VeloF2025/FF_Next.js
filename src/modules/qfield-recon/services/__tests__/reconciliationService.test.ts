import { describe, it, expect } from 'vitest';
import { buildReconciliation } from '../reconciliationService';
import type { AuditDelta, PonMap, BuildInput } from '../../types';

const project = { id: 'p1', name: 'FT_Mohadin' };

function optical(featureKey: string, pon: number, lastStatus: AuditDelta['lastStatus'], photos: string[] = []): AuditDelta {
  return { id: `${featureKey}-${lastStatus}`, featureKey, label: `MOA.STS.${featureKey}`, kind: 'optical',
    status: 'Optical Complete', lastStatus, ponNo: pon, zone: '12', createdAt: '2026-07-23T11:43:00Z', photoKeys: photos };
}
function civil(label: string, lastStatus: AuditDelta['lastStatus'], status = 'Pole Planted/ All Photos', photos: string[] = []): AuditDelta {
  return { id: `${label}-${lastStatus}`, featureKey: label, label, kind: 'civil',
    status, lastStatus, ponNo: null, zone: '12', createdAt: '2026-07-08T12:39:00Z', photoKeys: photos };
}
const emptyMap: PonMap = { available: false, gpkgVersion: null, resolvedAt: null, designPons: [], poleToPon: {} };

describe('buildReconciliation', () => {
  it('PON 161: 14 error deltas each with an applied twin are stale duplicates, PON net-complete', () => {
    const deltas: AuditDelta[] = [];
    for (let i = 0; i < 14; i++) {
      deltas.push(optical(String(3506 + i), 161, 'applied'));
      deltas.push(optical(String(3506 + i), 161, 'error'));
    }
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [161], poleToPon: {} };
    const input: BuildInput = { project, deltas, ponMap: map, presentPhotoKeys: new Set() };
    const model = buildReconciliation(input);
    const pon161 = model.optical.find(p => p.ponNo === 161)!;
    expect(pon161.applied).toBe(14);
    expect(pon161.staleDuplicate).toBe(14);
    expect(pon161.stuckRecoverable).toBe(0);
    expect(pon161.neverCaptured).toBe(0);
    expect(model.stuckDeltas.filter(s => s.lastStatus === 'error')).toHaveLength(14);
    expect(model.stuckDeltas.every(s => s.supersededByAppliedTwin)).toBe(true);
    expect(model.totals.stuckRecoverable).toBe(0);
  });

  it('PON 164: in design, zero optical deltas -> never_captured', () => {
    const deltas = [optical('3506', 163, 'applied'), optical('3600', 165, 'applied')];
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [163, 164, 165], poleToPon: {} };
    const model = buildReconciliation({ project, deltas, ponMap: map, presentPhotoKeys: new Set() });
    const pon164 = model.optical.find(p => p.ponNo === 164)!;
    expect(pon164.neverCaptured).toBe(1);
    expect(pon164.applied).toBe(0);
    expect(model.totals.neverCaptured).toBeGreaterThanOrEqual(1);
  });

  it('PON 164 civil: 23 design poles, 5 planted -> 5 applied, 18 never_captured', () => {
    const poleToPon: PonMap['poleToPon'] = {};
    const labels: string[] = [];
    for (let i = 744; i <= 764; i++) { const l = `MOA.P.D${i}`; poleToPon[l] = { pon: 164, zone: '12' }; labels.push(l); }
    poleToPon['MOA.P.A208'] = { pon: 164, zone: '12' }; labels.push('MOA.P.A208');
    poleToPon['MOA.P.A209'] = { pon: 164, zone: '12' }; labels.push('MOA.P.A209'); // 23 total
    const deltas = ['MOA.P.D753','MOA.P.D756','MOA.P.D757','MOA.P.D758','MOA.P.D759']
      .map(l => civil(l, 'applied', 'Pole Planted/ All Photos', [`DCIM/civil-${l}.jpg`]));
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [164], poleToPon };
    const present = new Set(deltas.flatMap(d => d.photoKeys));
    const model = buildReconciliation({ project, deltas, ponMap: map, presentPhotoKeys: present });
    const pon164 = model.civil.find(p => p.ponNo === 164)!;
    expect(pon164.designFeatures).toBe(23);
    expect(pon164.applied).toBe(5);
    expect(pon164.neverCaptured).toBe(18);
    expect(pon164.missingPhotos).toBe(0);
  });

  it('missing photo is flagged', () => {
    const deltas = [civil('MOA.P.D753', 'applied', 'Pole Planted/ All Photos', ['DCIM/present.jpg', 'DCIM/gone.jpg'])];
    const map: PonMap = { available: true, gpkgVersion: 'v', resolvedAt: 'now', designPons: [164], poleToPon: { 'MOA.P.D753': { pon: 164, zone: '12' } } };
    const model = buildReconciliation({ project, deltas, ponMap: map, presentPhotoKeys: new Set(['DCIM/present.jpg']) });
    expect(model.photoFlags).toHaveLength(1);
    expect(model.photoFlags[0].photoKey).toBe('DCIM/gone.jpg');
  });

  it('no design layer: optical never_captured via observed-sequence gap', () => {
    const deltas = [163, 165, 166].map(pon => optical(`s${pon}`, pon, 'applied'));
    const model = buildReconciliation({ project, deltas, ponMap: emptyMap, presentPhotoKeys: new Set() });
    expect(model.designLayer.available).toBe(false);
    const gap = model.optical.find(p => p.ponNo === 164);
    expect(gap?.neverCaptured).toBe(1);
    // civil with no design layer lands in the null-PON bucket, not per-PON
    expect(model.civil.every(p => p.ponNo === null || p.designFeatures === 0)).toBe(true);
  });
});
