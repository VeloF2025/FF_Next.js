import type {
  AuditDelta, BuildInput, PonSummary, ReconModel, StuckDelta, PhotoFlag,
} from '../types';

const STUCK: ReadonlySet<string> = new Set(['error', 'not_applied', 'conflict']);

interface FeatureAgg {
  featureKey: string;
  label: string | null;
  kind: AuditDelta['kind'];
  ponNo: number | null;
  hasApplied: boolean;
  hasStuck: boolean;
  deltas: AuditDelta[];
}

function aggregateFeatures(deltas: AuditDelta[]): Map<string, FeatureAgg> {
  const map = new Map<string, FeatureAgg>();
  for (const d of deltas) {
    // localPk (featureKey) is unique only WITHIN a QField layer — a splitter
    // (optical) and a pole (civil) can share the same localPk. Key on
    // (kind, featureKey) so the two layers never merge.
    const key = `${d.kind}:${d.featureKey}`;
    let a = map.get(key);
    if (!a) {
      a = { featureKey: d.featureKey, label: d.label, kind: d.kind, ponNo: d.ponNo,
            hasApplied: false, hasStuck: false, deltas: [] };
      map.set(key, a);
    }
    a.deltas.push(d);
    if (d.lastStatus === 'applied') a.hasApplied = true;
    if (STUCK.has(d.lastStatus)) a.hasStuck = true;
    // Prefer a non-null label / pon / zone from any delta.
    if (!a.label && d.label) a.label = d.label;
    if (a.ponNo == null && d.ponNo != null) a.ponNo = d.ponNo;
  }
  return map;
}

/** Empty per-PON accumulator. */
function emptySummary(ponNo: number | null, kind: AuditDelta['kind']): PonSummary {
  return { ponNo, kind, designFeatures: 0, applied: 0, stuckRecoverable: 0,
           staleDuplicate: 0, neverCaptured: 0, missingPhotos: 0 };
}

export function buildReconciliation(input: BuildInput): ReconModel {
  const { project, deltas, ponMap, presentPhotoKeys } = input;
  const notes = [...(input.notes ?? [])];

  const features = aggregateFeatures(deltas);

  // Resolve a feature's PON: optical carries pon on the delta; civil resolves via label.
  const ponOf = (a: FeatureAgg): number | null => {
    if (a.kind === 'optical') return a.ponNo;
    const label = a.label ?? '';
    return ponMap.poleToPon[label]?.pon ?? null;
  };

  const optical = new Map<number | null, PonSummary>();
  const civil = new Map<number | null, PonSummary>();
  const bucket = (kind: AuditDelta['kind'], pon: number | null): PonSummary => {
    const m = kind === 'optical' ? optical : civil;
    let s = m.get(pon);
    if (!s) { s = emptySummary(pon, kind); m.set(pon, s); }
    return s;
  };

  const stuckDeltas: StuckDelta[] = [];
  const photoFlags: PhotoFlag[] = [];
  const totals = { applied: 0, stuckRecoverable: 0, staleDuplicate: 0, neverCaptured: 0 };

  // Track observed PON per kind (for design comparison / sequence-gap fallback).
  const observedOpticalPons = new Set<number>();
  // Track which design pole labels were audited (by label).
  const auditedLabels = new Set<string>();

  for (const a of features.values()) {
    const pon = ponOf(a);
    const s = bucket(a.kind, pon);
    if (a.kind === 'optical' && pon != null) observedOpticalPons.add(pon);
    if (a.kind === 'civil' && a.label) auditedLabels.add(a.label);

    if (a.hasApplied) {
      s.applied += 1; totals.applied += 1;
      if (a.hasStuck) { s.staleDuplicate += 1; totals.staleDuplicate += 1; }
    } else if (a.hasStuck) {
      s.stuckRecoverable += 1; totals.stuckRecoverable += 1;
    } else {
      // only started/pending — not applied yet; surface as recoverable/attention.
      s.stuckRecoverable += 1; totals.stuckRecoverable += 1;
    }

    // Stuck-delta rows + supersession (superseded iff the feature has an applied twin).
    for (const d of a.deltas) {
      if (STUCK.has(d.lastStatus)) {
        stuckDeltas.push({
          deltaId: d.id, featureKey: d.featureKey, label: d.label, kind: d.kind,
          status: d.status, lastStatus: d.lastStatus, ponNo: pon, createdAt: d.createdAt,
          supersededByAppliedTwin: a.hasApplied,
        });
      }
      // Photo integrity (check every referenced key once).
      for (const key of d.photoKeys) {
        if (!presentPhotoKeys.has(key)) {
          photoFlags.push({ deltaId: d.id, featureKey: d.featureKey, label: d.label, photoKey: key });
          s.missingPhotos += 1;
        }
      }
    }
  }

  // never_captured — optical
  if (ponMap.available && ponMap.designPons.length > 0) {
    for (const pon of ponMap.designPons) {
      if (!observedOpticalPons.has(pon)) {
        const s = bucket('optical', pon);
        s.neverCaptured += 1; totals.neverCaptured += 1;
      }
    }
  } else if (observedOpticalPons.size > 0) {
    // Fallback: gaps in the observed PON sequence (min..max) with no delta.
    const arr = [...observedOpticalPons].sort((x, y) => x - y);
    for (let p = arr[0]!; p <= arr[arr.length - 1]!; p++) {
      if (!observedOpticalPons.has(p)) {
        const s = bucket('optical', p);
        s.neverCaptured += 1; totals.neverCaptured += 1;
      }
    }
  }

  // never_captured — civil (design poles that were never audited)
  if (ponMap.available) {
    const designByPon = new Map<number, number>();
    for (const [label, { pon }] of Object.entries(ponMap.poleToPon)) {
      designByPon.set(pon, (designByPon.get(pon) ?? 0) + 1);
      if (!auditedLabels.has(label)) {
        const s = bucket('civil', pon);
        s.neverCaptured += 1; totals.neverCaptured += 1;
      }
    }
    for (const [pon, count] of designByPon) bucket('civil', pon).designFeatures = count;
  }

  const byPon = (a: PonSummary, b: PonSummary) =>
    (a.ponNo ?? Number.POSITIVE_INFINITY) - (b.ponNo ?? Number.POSITIVE_INFINITY);

  return {
    project,
    designLayer: { available: ponMap.available, gpkgVersion: ponMap.gpkgVersion, resolvedAt: ponMap.resolvedAt },
    totals,
    optical: [...optical.values()].sort(byPon),
    civil: [...civil.values()].sort(byPon),
    stuckDeltas: stuckDeltas.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    photoFlags,
    notes,
  };
}
