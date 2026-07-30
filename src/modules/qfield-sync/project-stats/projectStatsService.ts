import { ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { listDcimKeys } from '../../../lib/qfieldcloud/minio';
import { buildQFieldInfrastructure } from './featureState';
import {
  getFibreFlowInfrastructure,
  type FibreFlowInfrastructureSnapshot,
} from './fibreflowInfrastructureRepo';
import { calculateFreshness } from './freshness';
import { resolveProject } from './projectResolver';
import { ProjectStatsError } from './errors';
import { qfieldDeltaRepo, type QFieldDeltaSnapshot } from './qfieldDeltaRepo';
import { getCachedPoleDesign, type CachedPoleDesign } from './qfieldDesignRepo';
import { getQaStats } from './qfieldQaRepo';
import { getSystemSyncStats } from './qfieldSyncStatsRepo';
import {
  addPhotoIntegrity,
  normalizeStatsValue,
  reconcileStatsRecords,
} from './projectStatsAggregation';
import type {
  ProjectStatsAnomaly,
  ProjectStatsQuery,
  ProjectStatsResponse,
  QaStats,
  ResolvedProject,
  SourceHealth,
  SourceHealthEntry,
  SyncStats,
} from './types';

export interface ProjectStatsContext {
  userId: string;
  userEmail: string;
  requestId: string;
}

export interface ProjectStatsDependencies {
  resolveProject: (identifier: string) => Promise<ResolvedProject>;
  loadQField: (projectId: string) => Promise<QFieldDeltaSnapshot>;
  loadFibreFlow: (projectId: string) => Promise<FibreFlowInfrastructureSnapshot>;
  loadQa: (projectId: string, userEmail: string) => Promise<QaStats>;
  loadSync: () => Promise<SyncStats>;
  loadDesign: (projectId: string) => Promise<CachedPoleDesign>;
  loadPhotoKeys: (projectId: string) => Promise<Set<string>>;
  now: () => Date;
}

type SourceResult<T> = { value: T | null; health: SourceHealthEntry };
const SOURCE_TIMEOUT = Symbol('SOURCE_TIMEOUT');

const defaultDependencies: ProjectStatsDependencies = {
  resolveProject,
  loadQField: (projectId) => qfieldDeltaRepo.load(projectId),
  loadFibreFlow: getFibreFlowInfrastructure,
  loadQa: getQaStats,
  loadSync: getSystemSyncStats,
  loadDesign: getCachedPoleDesign,
  loadPhotoKeys: listDcimKeys,
  now: () => new Date(),
};

async function settleSource<T>(
  name: keyof SourceHealth,
  timeoutMs: number,
  task: () => Promise<T>,
): Promise<SourceResult<T>> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(SOURCE_TIMEOUT), timeoutMs);
    });
    const value = await Promise.race([task(), timeout]);
    return { value, health: { state: 'ok', durationMs: Date.now() - started } };
  } catch (error) {
    const timedOut = error === SOURCE_TIMEOUT;
    return {
      value: null,
      health: {
        state: timedOut ? 'timeout' : 'unavailable',
        durationMs: Date.now() - started,
        message: `${name} source ${timedOut ? 'timed out' : 'unavailable'}`,
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function warningsFor(
  sourceHealth: SourceHealth,
  freshness: ProjectStatsResponse['freshness'],
  design: CachedPoleDesign | null,
  anomalies: ProjectStatsAnomaly[],
  fibreflowWarnings: string[],
  sync: SyncStats | null,
): string[] {
  const warnings = [...fibreflowWarnings];
  const sourceWarnings: Partial<Record<keyof SourceHealth, string>> = {
    fibreflow: 'FibreFlow infrastructure statistics unavailable',
    qa: 'QA statistics unavailable',
    sync: 'System sync statistics unavailable',
    design: 'Pole design statistics unavailable',
    minio: 'Photo storage statistics unavailable',
  };
  for (const [name, message] of Object.entries(sourceWarnings)) {
    if (sourceHealth[name as keyof SourceHealth].state !== 'ok') warnings.push(message);
  }
  if (freshness.state === 'unknown') warnings.push('QField freshness is unknown');
  if (freshness.state === 'stale' && !freshness.warningSuppressed) {
    warnings.push('QField data is stale');
  }
  if (design && !design.available) warnings.push('Pole design data unavailable');
  const unknown = anomalies.filter((item) => item.type === 'unknown_status').length;
  if (unknown > 0) {
    warnings.push(`${unknown} QField ${unknown === 1 ? 'record has' : 'records have'} an unknown status`);
  }
  const mismatches = anomalies.filter((item) => item.type === 'sync_mismatch').length;
  if (mismatches > 0) {
    warnings.push(`${mismatches} ${mismatches === 1 ? 'record could' : 'records could'} not be reconciled`);
  }
  if (sync?.scope === 'system') warnings.push('Sync statistics are system-wide');
  return [...new Set(warnings)];
}

function sortAnomalies(anomalies: ProjectStatsAnomaly[]): ProjectStatsAnomaly[] {
  return [...anomalies].sort(
    (a, b) =>
      (a.occurredAt ?? '').localeCompare(b.occurredAt ?? '') ||
      a.featureKey.localeCompare(b.featureKey),
  );
}

export async function getProjectStats(
  query: ProjectStatsQuery,
  context: ProjectStatsContext,
  dependencies: ProjectStatsDependencies = defaultDependencies,
): Promise<ProjectStatsResponse> {
  const project = await dependencies.resolveProject(query.project);
  const qfieldId = project.qfield.projectId;
  const [qfield, fibreflow, qa, sync, design, minio] = await Promise.all([
    settleSource('qfield', 10_000, () => dependencies.loadQField(qfieldId)),
    settleSource('fibreflow', 5_000, () => dependencies.loadFibreFlow(project.fibreflow.id)),
    settleSource('qa', 5_000, () => dependencies.loadQa(qfieldId, context.userEmail)),
    settleSource('sync', 5_000, () => dependencies.loadSync()),
    settleSource('design', 5_000, () => dependencies.loadDesign(qfieldId)),
    settleSource('minio', 10_000, () => dependencies.loadPhotoKeys(qfieldId)),
  ]);

  if (!qfield.value) {
    throw new ProjectStatsError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'QField project statistics are currently unavailable',
      { requestId: context.requestId },
    );
  }

  const infrastructure = buildQFieldInfrastructure(qfield.value.deltas);
  const { poles, cables, drops } = infrastructure;
  const anomalies = [...infrastructure.anomalies];
  if (fibreflow.value) {
    cables.fibreflowTotal = fibreflow.value.cables.total;
    drops.fibreflowTotal = fibreflow.value.drops.total;
    const cableComparison = reconcileStatsRecords(
      infrastructure.comparisonRecords.cables,
      fibreflow.value.cables.records,
      (left, right) =>
        normalizeStatsValue(left.status) === normalizeStatsValue(right.status),
    );
    Object.assign(cables, {
      synchronized: cableComparison.synchronized,
      needsSync: cableComparison.needsSync,
      qfieldOnly: cableComparison.leftOnly,
      fibreflowOnly: cableComparison.rightOnly,
    });
    const dropComparison = reconcileStatsRecords(
      infrastructure.comparisonRecords.drops,
      fibreflow.value.drops.records,
      (left, right) =>
        normalizeStatsValue(left.installationStatus) ===
          normalizeStatsValue(right.installationStatus) &&
        normalizeStatsValue(left.qcStatus) === normalizeStatsValue(right.qcStatus),
    );
    Object.assign(drops, {
      synchronized: dropComparison.synchronized,
      needsSync: dropComparison.needsSync,
      qfieldOnly: dropComparison.leftOnly,
      fibreflowOnly: dropComparison.rightOnly,
    });
  }
  if (design.value?.available && design.value.labels) {
    const captured = new Set([...infrastructure.civilLabels].map(normalizeStatsValue));
    const labels = new Set(
      [...design.value.labels].map(normalizeStatsValue).filter(Boolean),
    );
    poles.designTotal = labels.size;
    poles.neverCaptured = [...labels].filter((label) => !captured.has(label)).length;
  }
  const photoIntegrity = addPhotoIntegrity(infrastructure.photoKeys, minio.value, anomalies);
  poles.presentPhotos = photoIntegrity.present;
  poles.missingPhotos = photoIntegrity.missing;

  const generatedAt = dependencies.now();
  const freshness = calculateFreshness(qfield.value.lastUpdatedAt, generatedAt);
  const sourceHealth: SourceHealth = {
    qfield: qfield.health,
    fibreflow: fibreflow.health,
    qa: qa.health,
    sync: sync.health,
    design: design.health,
    minio: minio.health,
  };
  const resultStatus = [fibreflow, qa, sync, design, minio].every(
    ({ health }) => health.state === 'ok',
  )
    ? 'complete'
    : 'partial';
  const allAnomalies = sortAnomalies(anomalies);
  const start = (query.page - 1) * query.limit;
  const summary = query.section === 'summary';
  const response: ProjectStatsResponse = {
    status: resultStatus,
    section: query.section,
    project: {
      fibreflow: project.fibreflow,
      qfield: { id: qfieldId, name: project.qfield.name },
    },
    freshness,
    poles: summary || query.section === 'poles' ? poles : null,
    cables: summary || query.section === 'cables' ? cables : null,
    drops: summary || query.section === 'drops' ? drops : null,
    qa: summary || query.section === 'qa' ? qa.value : null,
    sync: summary || query.section === 'sync' ? sync.value : null,
    anomalies:
      query.section === 'anomalies'
        ? {
            total: allAnomalies.length,
            page: query.page,
            limit: query.limit,
            items: allAnomalies.slice(start, start + query.limit),
          }
        : null,
    sourceHealth,
    warnings: warningsFor(
      sourceHealth,
      freshness,
      design.value,
      allAnomalies,
      fibreflow.value?.warnings ?? [],
      sync.value,
    ),
    generatedAt: generatedAt.toISOString(),
  };
  log.info(
    'QField project statistics generated',
    {
      requestId: context.requestId,
      userId: context.userId,
      fibreflowProjectId: project.fibreflow.id,
      qfieldProjectId: qfieldId,
      section: query.section,
      resultStatus,
      sourceHealth,
    },
    'qfield-project-stats',
  );
  return response;
}
