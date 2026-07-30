import type { QFieldDelta } from './qfieldDeltaRepo';
import type { CableStats, DropStats, PoleStats, ProjectStatsAnomaly } from './types';

const PLANTING_EVENTS = new Set([
  'Pole Planted/ All Photos',
  'Pole Planted - Photos Incomplete',
  'Pole Verified/ Civil Complete',
]);
const REMOVAL_EVENTS = new Set(['Pole Removed/Canceled', 'Pole Canceled / Removed']);
const STUCK = new Set(['error', 'not_applied', 'conflict']);
type FeatureKind = 'pole' | 'cable' | 'drop';
interface FeatureHistory {
  kind: FeatureKind;
  rows: QFieldDelta[];
}
interface ComparisonCandidate<T> { row: QFieldDelta; value: T }
export interface QFieldInfrastructureSnapshot {
  poles: PoleStats;
  cables: CableStats;
  drops: DropStats;
  anomalies: ProjectStatsAnomaly[];
  photoKeys: Set<string>;
  civilLabels: Set<string>;
  comparisonRecords: {
    cables: Map<string, { status: string | null }>;
    drops: Map<string, { installationStatus: string | null; qcStatus: string | null }>;
  };
}
function statusOf(row: QFieldDelta): string | null {
  return row.status?.trim() || null;
}
function normalize(value: string | null): string | null {
  return value?.trim().toLowerCase() || null;
}
function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}
function compareRows(a: QFieldDelta, b: QFieldDelta): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}
function ordered(rows: QFieldDelta[]): QFieldDelta[] {
  return [...rows].sort(compareRows);
}
function kindOf(row: QFieldDelta): FeatureKind | 'unknown' {
  const status = statusOf(row);
  if (normalize(row.dropNumber)) return 'drop';
  if (normalize(row.cableId) || status?.startsWith('String ')) return 'cable';
  if (status?.startsWith('Pole ')) return 'pole';
  return 'unknown';
}
function isPoleQualityEvent(status: string | null): boolean {
  return Boolean(
    status?.startsWith('Q/A ') ||
      status?.startsWith('(ADMIN) Q/A ') ||
      status?.startsWith('Photo '),
  );
}
function groupHistories(deltas: QFieldDelta[]): {
  groups: FeatureHistory[];
  unassigned: QFieldDelta[];
} {
  const candidates = new Map<string, Set<FeatureKind>>();
  for (const row of deltas) {
    const kind = kindOf(row);
    if (kind === 'unknown') continue;
    const kinds = candidates.get(row.featureKey) ?? new Set<FeatureKind>();
    kinds.add(kind);
    candidates.set(row.featureKey, kinds);
  }
  const grouped = new Map<string, FeatureHistory>();
  const unassigned: QFieldDelta[] = [];
  for (const row of ordered(deltas)) {
    const explicitKind = kindOf(row);
    const kinds = candidates.get(row.featureKey) ?? new Set<FeatureKind>();
    let kind: FeatureKind | undefined;
    if (explicitKind !== 'unknown') kind = explicitKind;
    else if (isPoleQualityEvent(statusOf(row)) && kinds.has('pole')) kind = 'pole';
    else if (kinds.size === 1) kind = [...kinds][0];
    if (!kind) {
      unassigned.push(row);
      continue;
    }
    const key = `${kind}:${row.featureKey}`;
    const history = grouped.get(key) ?? { kind, rows: [] };
    history.rows.push(row);
    grouped.set(key, history);
  }
  return { groups: [...grouped.values()], unassigned };
}
function anomaly(
  type: ProjectStatsAnomaly['type'],
  row: QFieldDelta,
  featureKey = row.featureKey,
): ProjectStatsAnomaly {
  return {
    type,
    featureKey,
    label: row.label?.trim() || null,
    status: statusOf(row),
    occurredAt: row.createdAt || null,
  };
}
function knownStatus(status: string, kind: FeatureKind): boolean {
  if (PLANTING_EVENTS.has(status) || REMOVAL_EVENTS.has(status)) return true;
  if (
    status.startsWith('Q/A ') ||
    status.startsWith('(ADMIN) Q/A ') ||
    status.startsWith('Photo ') ||
    status.startsWith('WIP') ||
    status.startsWith('Optical ')
  ) {
    return true;
  }
  if (kind === 'cable' && status.startsWith('String ')) return true;
  return kind === 'drop' && status.startsWith('Drop ');
}
function inspectHistory(
  history: FeatureHistory,
  anomalies: ProjectStatsAnomaly[],
): QFieldDelta[] {
  const applied = history.rows.filter((row) => row.lastStatus === 'applied');
  const stuckRows = history.rows.filter((row) => STUCK.has(row.lastStatus));
  if (applied.length === 0) {
    anomalies.push(anomaly('stuck', stuckRows.at(-1) ?? history.rows.at(-1)!));
  } else if (stuckRows.length > 0) {
    anomalies.push(anomaly('stale_duplicate', stuckRows.at(-1)!));
  }
  for (const row of applied) {
    const status = statusOf(row);
    if (status && !knownStatus(status, history.kind)) {
      anomalies.push(anomaly('unknown_status', row));
    }
  }
  return applied;
}
function emptyPoles(): PoleStats {
  return {
    qfieldTotal: 0, planted: 0, photoComplete: 0, photoIncomplete: 0,
    qaPassed: 0, qaFailed: 0, applied: 0, stuckRecoverable: 0,
    staleDuplicates: 0, designTotal: null, neverCaptured: null,
    referencedPhotos: 0, presentPhotos: null, missingPhotos: null, byStatus: {},
  };
}
function emptyCables(): CableStats {
  return {
    qfieldTotal: 0, fibreflowTotal: null, totalLengthM: null,
    synchronized: null, needsSync: null, qfieldOnly: null, fibreflowOnly: null,
    byStatus: {},
  };
}
function emptyDrops(): DropStats {
  return {
    qfieldTotal: 0, fibreflowTotal: null, installed: 0, planned: 0,
    inProgress: 0, approved: 0, pending: 0, failed: 0, synchronized: null,
    needsSync: null, qfieldOnly: null, fibreflowOnly: null,
    installationByStatus: {}, qcByStatus: {},
  };
}
function addCandidate<T>(
  candidates: Map<string, ComparisonCandidate<T>[]>,
  key: string,
  candidate: ComparisonCandidate<T>,
): void {
  candidates.set(key, [...(candidates.get(key) ?? []), candidate]);
}
function latestCandidate<T>(candidates: ComparisonCandidate<T>[]): ComparisonCandidate<T> {
  return [...candidates].sort((a, b) => compareRows(a.row, b.row)).at(-1)!;
}
export function buildQFieldInfrastructure(deltas: QFieldDelta[]): QFieldInfrastructureSnapshot {
  const poles = emptyPoles();
  const cables = emptyCables();
  const drops = emptyDrops();
  const anomalies: ProjectStatsAnomaly[] = [];
  const photoKeys = new Set<string>();
  const civilLabels = new Set<string>();
  const cableCandidates = new Map<string, ComparisonCandidate<{ status: string | null }>[]>();
  const dropCandidates = new Map<string, ComparisonCandidate<{
    installationStatus: string | null;
    qcStatus: string | null;
  }>[]>();
  let cableLength = 0;
  let cableLengths = 0;
  const { groups, unassigned } = groupHistories(deltas);
  for (const row of unassigned) anomalies.push(anomaly('unknown_status', row));
  for (const history of groups) {
    const applied = inspectHistory(history, anomalies);
    const latestApplied = applied.at(-1);
    if (history.kind === 'pole') {
      poles.qfieldTotal += 1;
      if (applied.length > 0) poles.applied += 1;
      else poles.stuckRecoverable += 1;
      if (applied.length > 0 && history.rows.some((row) => STUCK.has(row.lastStatus))) {
        poles.staleDuplicates += 1;
      }
      for (const row of history.rows) {
        const label = row.label?.trim();
        if (label) civilLabels.add(label);
        for (const key of row.photoKeys) if (key.trim()) photoKeys.add(key.trim());
      }
      let planted = false;
      let photo: 'complete' | 'incomplete' | null = null;
      let qa: 'passed' | 'failed' | null = null;
      for (const row of applied) {
        const status = statusOf(row);
        if (!status) continue;
        if (PLANTING_EVENTS.has(status)) planted = true;
        else if (REMOVAL_EVENTS.has(status)) planted = false;
        if (status === 'Pole Planted/ All Photos' || status === 'Photo Complete') photo = 'complete';
        if (status === 'Pole Planted - Photos Incomplete' || status === 'Photo Incomplete') {
          photo = 'incomplete';
        }
        const qualityStatus = status.replace(/^\(ADMIN\) /, '');
        if (qualityStatus === 'Q/A Passed') qa = 'passed';
        if (qualityStatus === 'Q/A Failed') qa = 'failed';
      }
      if (planted) {
        poles.planted += 1;
        if (photo === 'complete') poles.photoComplete += 1;
        if (photo === 'incomplete') poles.photoIncomplete += 1;
      }
      if (qa === 'passed') poles.qaPassed += 1;
      if (qa === 'failed') poles.qaFailed += 1;
      const status = latestApplied && statusOf(latestApplied);
      if (status) increment(poles.byStatus, status);
      continue;
    }
    if (history.kind === 'cable') {
      cables.qfieldTotal += 1;
      const status = latestApplied && statusOf(latestApplied);
      if (status) increment(cables.byStatus, status);
      const lengthRow = [...applied].reverse().find(
        (row) => row.cableLengthM !== null && Number.isFinite(row.cableLengthM) &&
          row.cableLengthM >= 0,
      );
      if (lengthRow?.cableLengthM !== null && lengthRow?.cableLengthM !== undefined) {
        cableLength += lengthRow.cableLengthM;
        cableLengths += 1;
      }
      const identityRow = [...applied].reverse().find((row) => normalize(row.cableId));
      const identity = identityRow ? normalize(identityRow.cableId) : null;
      if (latestApplied && identity) {
        addCandidate(cableCandidates, identity, { row: latestApplied, value: { status } });
      } else anomalies.push(anomaly('sync_mismatch', latestApplied ?? history.rows.at(-1)!));
      continue;
    }
    const identityRow = [...applied].reverse().find((row) => normalize(row.dropNumber)) ??
      [...history.rows].reverse().find((row) => normalize(row.dropNumber));
    const identity = identityRow ? normalize(identityRow.dropNumber) : null;
    if (!identity || !identityRow) {
      anomalies.push(anomaly('sync_mismatch', latestApplied ?? history.rows.at(-1)!));
      continue;
    }
    const value = {
      installationStatus: latestApplied?.installationStatus?.trim() || null,
      qcStatus: latestApplied?.qcStatus?.trim() || null,
    };
    addCandidate(dropCandidates, identity, { row: latestApplied ?? identityRow, value });
  }
  cables.totalLengthM = cableLengths > 0 ? cableLength : null;
  const cableRecords = new Map<string, { status: string | null }>();
  for (const [identity, candidates] of cableCandidates) {
    const winner = latestCandidate(candidates);
    cableRecords.set(identity, winner.value);
    if (candidates.length > 1) anomalies.push(anomaly('sync_mismatch', winner.row, identity));
  }
  const dropRecords = new Map<string, {
    installationStatus: string | null;
    qcStatus: string | null;
  }>();
  for (const [identity, candidates] of dropCandidates) {
    const appliedCandidates = candidates.filter(({ row }) => row.lastStatus === 'applied');
    const winner = latestCandidate(appliedCandidates.length > 0 ? appliedCandidates : candidates);
    drops.qfieldTotal += 1;
    dropRecords.set(identity, winner.value);
    const { installationStatus, qcStatus } = winner.value;
    if (installationStatus) increment(drops.installationByStatus, installationStatus);
    if (qcStatus) increment(drops.qcByStatus, qcStatus);
    const installation = installationStatus?.toLowerCase();
    const qc = qcStatus?.toLowerCase();
    if (installation === 'installed') drops.installed += 1;
    if (installation === 'planned') drops.planned += 1;
    if (installation === 'in progress') drops.inProgress += 1;
    if (qc === 'approved') drops.approved += 1;
    if (qc === 'pending') drops.pending += 1;
    if (qc === 'failed') drops.failed += 1;
    if (candidates.length > 1) anomalies.push(anomaly('sync_mismatch', winner.row, identity));
  }
  poles.referencedPhotos = photoKeys.size;
  return {
    poles, cables, drops, anomalies, photoKeys, civilLabels,
    comparisonRecords: { cables: cableRecords, drops: dropRecords },
  };
}
