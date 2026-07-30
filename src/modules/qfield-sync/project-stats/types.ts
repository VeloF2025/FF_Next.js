export const PROJECT_STATS_SECTIONS = [
  'summary',
  'poles',
  'cables',
  'drops',
  'qa',
  'sync',
  'anomalies',
] as const;

export type ProjectStatsSection = (typeof PROJECT_STATS_SECTIONS)[number];
export type ProjectStatsStatus = 'complete' | 'partial' | 'unavailable';
export type FreshnessState = 'fresh' | 'stale' | 'unknown';
export type SourceState = 'ok' | 'unavailable' | 'timeout';

export interface ProjectStatsQuery {
  project: string;
  section: ProjectStatsSection;
  page: number;
  limit: number;
}

export interface ResolvedProject {
  fibreflow: { id: string; code: string; name: string };
  qfield: {
    registrationId: string;
    projectId: string;
    name: string;
    lastUpdatedAt: string | null;
  };
}

export interface ProjectStatsProject {
  fibreflow: { id: string; code: string; name: string };
  qfield: { id: string; name: string };
}

export interface Freshness {
  lastQFieldUpdateAt: string | null;
  weekdayAgeHours: number | null;
  state: FreshnessState;
  warningSuppressed: boolean;
  policy: 'stale after 24 weekday hours; weekend warnings suppressed';
}

export interface SourceHealthEntry {
  state: SourceState;
  durationMs: number;
  message?: string;
}

export type SourceHealth = Record<
  'qfield' | 'fibreflow' | 'qa' | 'sync' | 'design' | 'minio',
  SourceHealthEntry
>;

export interface PoleStats {
  qfieldTotal: number;
  planted: number;
  photoComplete: number;
  photoIncomplete: number;
  qaPassed: number;
  qaFailed: number;
  applied: number;
  stuckRecoverable: number;
  staleDuplicates: number;
  designTotal: number | null;
  neverCaptured: number | null;
  referencedPhotos: number;
  presentPhotos: number | null;
  missingPhotos: number | null;
  byStatus: Record<string, number>;
}

export interface CableStats {
  qfieldTotal: number;
  fibreflowTotal: number | null;
  totalLengthM: number | null;
  synchronized: number | null;
  needsSync: number | null;
  qfieldOnly: number | null;
  fibreflowOnly: number | null;
  byStatus: Record<string, number>;
}

export interface DropStats {
  qfieldTotal: number;
  fibreflowTotal: number | null;
  installed: number;
  planned: number;
  inProgress: number;
  approved: number;
  pending: number;
  failed: number;
  synchronized: number | null;
  needsSync: number | null;
  qfieldOnly: number | null;
  fibreflowOnly: number | null;
  installationByStatus: Record<string, number>;
  qcByStatus: Record<string, number>;
}

export interface QaStats {
  total: number;
  pending: number;
  inReview: number;
  approved: number;
  rejected: number;
  escalated: number;
  overdue: number;
  needsRetake: number;
  completedRetake: number;
  myQueue: number;
  confidence: Record<string, number>;
  byWorkType: Record<string, number>;
  byPriority: Record<string, number>;
}

export interface SyncStats {
  scope: 'system';
  currentJob: null | { id: string; type: string; status: string; startedAt: string };
  lastCompletedAt: string | null;
  successful: number;
  failed: number;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsFailed: number;
  unresolvedConflicts: number;
}

export interface ProjectStatsAnomaly {
  type: 'stuck' | 'stale_duplicate' | 'unknown_status' | 'missing_photo' | 'sync_mismatch';
  featureKey: string;
  label: string | null;
  status: string | null;
  occurredAt: string | null;
}

export interface ProjectStatsResponse {
  status: ProjectStatsStatus;
  section: ProjectStatsSection;
  project: ProjectStatsProject;
  freshness: Freshness;
  poles: PoleStats | null;
  cables: CableStats | null;
  drops: DropStats | null;
  qa: QaStats | null;
  sync: SyncStats | null;
  anomalies: {
    total: number;
    page: number;
    limit: number;
    items: ProjectStatsAnomaly[];
  } | null;
  sourceHealth: SourceHealth;
  warnings: string[];
  generatedAt: string;
}
