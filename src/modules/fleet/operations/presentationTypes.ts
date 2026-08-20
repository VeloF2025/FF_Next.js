import type { RosterStatusResult } from './statusService';
import type { OperationalFlag, OperationalStatus } from './types';

export type OperationalStatusGroup =
  | 'on_site'
  | 'approaching'
  | 'late'
  | 'wrong_site'
  | 'mismatch'
  | 'left_early'
  | 'unassigned'
  | 'unverifiable'
  | 'normal';

export interface OperationalStatusGroupCount {
  group: OperationalStatusGroup;
  count: number;
}

export interface OperationalAttentionAction {
  id: 'view_evidence';
  staffId: string;
  projectId: string | null;
}

export interface OperationalAttentionRow {
  staffId: string;
  staffName: string;
  projectId: string | null;
  projectName: string | null;
  operationalSiteId: string | null;
  operationalSiteName: string | null;
  status: OperationalStatus;
  group: OperationalStatusGroup;
  reasonCodes: string[];
  reasonText: string;
  flags: OperationalFlag[];
  evidenceLabel: string;
  evidenceTimestamps: string[];
  durationSeconds: number | null;
  ruleId: string;
  ruleVersion: number;
  actions: OperationalAttentionAction[];
}

export interface OperationalAttentionPage {
  items: OperationalAttentionRow[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface OperationalOverviewFilters {
  page: number;
  limit: number;
  attentionStatuses?: OperationalStatus[];
}

/**
 * A complete, single PR4 roster-status selection. The overview must not be
 * built from one page of a larger selection: groups and attention both need
 * every evaluated staff member before attention pagination is applied.
 */
export interface CompleteOperationalRosterSelection extends RosterStatusResult {
  hasMore: false;
}

export interface OperationalOverview {
  selectionState: 'no_scheduled_staff' | 'no_attention' | 'attention_available';
  groups: OperationalStatusGroupCount[];
  attention: OperationalAttentionPage;
  roster: Pick<CompleteOperationalRosterSelection, 'page' | 'limit' | 'total' | 'hasMore'>;
}
