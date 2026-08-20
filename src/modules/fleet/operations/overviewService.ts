import type { RosterStatusResult } from './statusService';
import type {
  CompleteOperationalRosterSelection,
  OperationalAttentionRow,
  OperationalOverview,
  OperationalOverviewFilters,
  OperationalStatusGroup,
} from './presentationTypes';
import type { OperationalStatus, OperationalStatusSummary } from './types';

const GROUP_ORDER: OperationalStatusGroup[] = [
  'on_site', 'approaching', 'late', 'wrong_site', 'mismatch', 'left_early', 'unassigned', 'unverifiable', 'normal',
];

const DEFAULT_ATTENTION_STATUSES: OperationalStatus[] = [
  'late', 'wrong_site', 'evidence_mismatch', 'left_early', 'unassigned', 'unverifiable', 'vehicle_on_site_driver_unconfirmed',
];

export class OperationalOverviewIncompleteRosterError extends Error {
  constructor() {
    super('Operational overview requires a complete roster selection');
    this.name = 'OperationalOverviewIncompleteRosterError';
  }
}

function completeRoster(result: RosterStatusResult): CompleteOperationalRosterSelection {
  if (result.hasMore || result.items.length !== result.total) throw new OperationalOverviewIncompleteRosterError();
  return { ...result, hasMore: false };
}

export function groupForOperationalStatus(status: OperationalStatus): OperationalStatusGroup {
  if (status === 'on_site_dual' || status === 'attendance_confirmed') return 'on_site';
  if (status === 'vehicle_on_site_driver_unconfirmed' || status === 'unverifiable') return 'unverifiable';
  if (status === 'evidence_mismatch') return 'mismatch';
  if (status === 'wrong_site' || status === 'late' || status === 'left_early' || status === 'unassigned' || status === 'approaching') return status;
  return 'normal';
}

function reasonText(reasonCodes: string[]): string {
  return reasonCodes.length === 0 ? 'No reason recorded' : reasonCodes.map((code) => code.replaceAll('_', ' ')).join('; ');
}

function evidenceLabel(status: OperationalStatus, timestamps: string[]): string {
  if (status === 'vehicle_on_site_driver_unconfirmed') return 'Vehicle on site; driver presence unconfirmed';
  if (timestamps.length === 0) return 'No evidence timestamp recorded';
  return timestamps.length === 1 ? 'One evidence timestamp recorded' : `${timestamps.length} evidence timestamps recorded`;
}

function toAttentionRow(item: OperationalStatusSummary): OperationalAttentionRow {
  return {
    staffId: item.staffId,
    staffName: item.staffName,
    projectId: item.projectId,
    projectName: item.projectName,
    operationalSiteId: item.operationalSiteId,
    operationalSiteName: item.operationalSiteName,
    status: item.status,
    group: groupForOperationalStatus(item.status),
    reasonCodes: item.reasonCodes,
    reasonText: reasonText(item.reasonCodes),
    flags: item.flags,
    evidenceLabel: evidenceLabel(item.status, item.sourceTimestamps),
    evidenceTimestamps: item.sourceTimestamps,
    durationSeconds: null,
    ruleId: item.ruleId,
    ruleVersion: item.ruleVersion,
    actions: [{ id: 'view_evidence', staffId: item.staffId, projectId: item.projectId }],
  };
}

function selectedAttentionStatuses(filters: OperationalOverviewFilters): OperationalStatus[] {
  return filters.attentionStatuses ?? DEFAULT_ATTENTION_STATUSES;
}

export function buildOperationalOverview(result: RosterStatusResult, filters: OperationalOverviewFilters): OperationalOverview {
  const roster = completeRoster(result);
  const counts = new Map<OperationalStatusGroup, number>();
  for (const item of roster.items) {
    const group = groupForOperationalStatus(item.status);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }

  const statuses = new Set(selectedAttentionStatuses(filters));
  const attentionRows = roster.items.filter((item) => statuses.has(item.status)).map(toAttentionRow);
  const offset = (filters.page - 1) * filters.limit;
  const items = attentionRows.slice(offset, offset + filters.limit);
  const selectionState = roster.total === 0
    ? 'no_scheduled_staff'
    : attentionRows.length === 0 ? 'no_attention' : 'attention_available';

  return {
    selectionState,
    groups: GROUP_ORDER.flatMap((group) => {
      const count = counts.get(group);
      return count === undefined ? [] : [{ group, count }];
    }),
    attention: { items, page: filters.page, limit: filters.limit, total: attentionRows.length, hasMore: offset + items.length < attentionRows.length },
    roster: { page: roster.page, limit: roster.limit, total: roster.total, hasMore: roster.hasMore },
  };
}
