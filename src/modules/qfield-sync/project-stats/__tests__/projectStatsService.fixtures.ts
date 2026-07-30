import { vi } from 'vitest';
import type { ProjectStatsDependencies } from '../projectStatsService';
import type { QFieldDelta } from '../qfieldDeltaRepo';

export const project = {
  fibreflow: { id: 'ff-1', code: 'PRJ-1', name: 'Mahikeng' },
  qfield: {
    registrationId: 'reg-1',
    projectId: 'qf-1',
    name: 'HT_Mahikeng',
    lastUpdatedAt: null,
  },
};

export const query = {
  project: 'Mahikeng',
  section: 'summary' as const,
  page: 1,
  limit: 50,
};

export const context = {
  userId: 'u1',
  userEmail: 'user@example.com',
  requestId: 'r1',
};

export function baseDelta(identity: string, status: string): QFieldDelta {
  return {
    id: `${identity}-${status}`,
    featureKey: identity,
    label: identity,
    status,
    lastStatus: 'applied',
    createdAt: '2026-07-29T10:00:00Z',
    dropNumber: null,
    cableId: null,
    cableLengthM: null,
    installationStatus: null,
    qcStatus: null,
    photoKeys: [],
  };
}

export function qfieldCable(identity: string, status: string): QFieldDelta {
  return { ...baseDelta(identity, status), cableId: identity };
}

export function qfieldDrop(
  identity: string,
  installationStatus: string,
  qcStatus: string,
): QFieldDelta {
  return {
    ...baseDelta(identity, 'Drop Updated'),
    dropNumber: identity,
    installationStatus,
    qcStatus,
  };
}

export function dependencies(): ProjectStatsDependencies {
  return {
    resolveProject: vi.fn().mockResolvedValue(project),
    loadQField: vi.fn().mockResolvedValue({
      lastUpdatedAt: '2026-07-29T11:34:04Z',
      deltas: [],
    }),
    loadFibreFlow: vi.fn().mockResolvedValue({
      poles: { total: 0, byStatus: {} },
      cables: { total: 0, byStatus: {}, records: new Map() },
      drops: { total: 0, byStatus: {}, qcByStatus: {}, records: new Map() },
      warnings: [],
    }),
    loadQa: vi.fn().mockResolvedValue({
      total: 0,
      pending: 0,
      inReview: 0,
      approved: 0,
      rejected: 0,
      escalated: 0,
      overdue: 0,
      needsRetake: 0,
      completedRetake: 0,
      myQueue: 0,
      confidence: {},
      byWorkType: {},
      byPriority: {},
    }),
    loadSync: vi.fn().mockResolvedValue({
      scope: 'system',
      currentJob: null,
      lastCompletedAt: null,
      successful: 0,
      failed: 0,
      recordsProcessed: 0,
      recordsCreated: 0,
      recordsUpdated: 0,
      recordsFailed: 0,
      unresolvedConflicts: 0,
    }),
    loadDesign: vi.fn().mockResolvedValue({
      available: false,
      designTotal: null,
      labels: null,
    }),
    loadPhotoKeys: vi.fn().mockResolvedValue(new Set()),
    now: () => new Date('2026-07-30T08:00:00Z'),
  };
}
