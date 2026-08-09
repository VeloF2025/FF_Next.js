export type ScopeStatus = 'included' | 'excluded' | 'cancelled';

export type PonMilestone =
  | 'civil_complete'
  | 'optical_complete'
  | 'testing_passed'
  | 'port_submitted'
  | 'port_approved'
  | 'technically_live';

export type ZoneQaDiscipline = 'civil' | 'optical';
export type ZoneQaStatus = 'not_started' | 'in_progress' | 'passed' | 'failed';

export type ZoneDeliveryStatus =
  | 'handed_over'
  | 'scope_pending'
  | 'handover_blocked'
  | 'zone_qa_in_progress'
  | 'ready_for_zone_qa'
  | 'go_live_in_progress'
  | 'awaiting_port_approval'
  | 'ready_for_port_submission'
  | 'testing_in_progress'
  | 'optical_construction'
  | 'civil_construction';

export interface ZoneKey {
  projectId: string;
  zoneNo: number;
}

export interface DeliveryActor {
  userId: string;
  email: string;
  permission: string;
}

export interface CommandMeta {
  expectedRowVersion: number;
  effectiveAt: string;
  source: string;
  reason?: string;
}

export interface UpdateScopeInput extends ZoneKey, CommandMeta {
  pons: Array<{ ponStageId: string; scopeStatus: ScopeStatus; reason?: string }>;
}

/**
 * Record a zone handover on a date the operator chooses, rather than the date
 * the system noticed the gates had passed. Re-issuing it corrects the date.
 */
export interface DeclareHandoverInput extends ZoneKey, CommandMeta {}

/**
 * Submit PON addressed the way the operator sees it — site, zone, PON. It
 * carries no expectedRowVersion because the delivery row it targets may not
 * exist yet; the command resolves the id and checks the version server-side.
 */
export interface SubmitPonInput extends ZoneKey {
  ponNo: number;
  effectiveAt: string;
  source: string;
  reason?: string;
}

export interface ConfirmMilestoneInput extends ZoneKey, CommandMeta {
  ponStageId: string;
  milestone: PonMilestone;
  action: 'confirm' | 'reopen' | 'link_maintenance';
  snagId?: string;
  affectedGate?: PonMilestone;
}

export interface RecordZoneQaInput extends ZoneKey, CommandMeta {
  discipline: ZoneQaDiscipline;
  status: Exclude<ZoneQaStatus, 'not_started'>;
  notes: string;
  snagIds: string[];
}

export interface RegisterDocumentInput extends ZoneKey, CommandMeta {
  documentType: 'test_pack' | 'fac' | 'cac';
  ponStageId?: string;
  documentSource: 'vf_storage' | 'exfo_result';
  sourceRef: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
}

export interface DeliveryBlocker {
  code: string;
  message: string;
  ponNo?: number;
  entityId?: string;
}

export interface MilestoneEvidence {
  effectiveAt: string;
  actorEmail: string;
  source: string;
  reconfirmedAt?: string;
}

export interface MilestoneActionAvailability {
  action: 'confirm' | 'reopen';
  enabled: boolean;
  blocker: DeliveryBlocker | null;
}

export interface PonDeliveryView {
  ponStageId: string;
  ponNo: number;
  scopeStatus: ScopeStatus;
  scopeReason: string | null;
  milestones: Partial<Record<PonMilestone, MilestoneEvidence>>;
  actions: Record<PonMilestone, MilestoneActionAvailability>;
  rowVersion: number;
}

export interface ZoneDeliveryActivity {
  id: string;
  action: string;
  effectiveAt: string;
  recordedAt: string;
  actorEmail: string;
  permission: string;
  source: string;
  reason: string | null;
  previousValue: unknown;
  newValue: unknown;
}

export interface ZoneQaView {
  status: ZoneQaStatus;
  effectiveAt: string | null;
  approverEmail: string | null;
  notes: string;
}

export interface ZoneDocumentView {
  id: string;
  documentType: 'test_pack' | 'fac' | 'cac';
  ponStageId?: string;
  sourceRef: string;
  url: string | null;
  checksumSha256: string;
  active: boolean;
}

export interface ZoneSnagView {
  snagId: string;
  status: string;
  closedAt: string | null;
  qaDiscipline: ZoneQaDiscipline | null;
  ponStageId?: string;
  ponNo?: number;
  affectedGate: PonMilestone | null;
  handoverBlocking: boolean;
  requiresReconfirmation: boolean;
  reconfirmedAt: string | null;
}

export interface ZoneDeliveryView extends ZoneKey {
  projectName: string;
  scopeApproved: boolean;
  pons: PonDeliveryView[];
  civilQa: ZoneQaView;
  opticalQa: ZoneQaView;
  documents: ZoneDocumentView[];
  snags: ZoneSnagView[];
  status: ZoneDeliveryStatus;
  blockers: DeliveryBlocker[];
  eligibleForZoneQaAt: string | null;
  handedOverAt: string | null;
  rowVersion: number;
}

export interface ZoneRegisterFilters {
  projectId?: string;
  zoneNo?: number;
  status?: ZoneDeliveryStatus;
  blocker?: string;
  handover?: 'pending' | 'complete';
  search?: string;
}

export interface ZoneRegisterRow extends ZoneKey {
  projectName: string;
  scopeApproved: boolean;
  status: ZoneDeliveryStatus;
  includedPons: number | null;
  livePons: number | null;
  earliestIncompleteGate: PonMilestone | null;
  blockerCount: number;
  civilQa: ZoneQaStatus;
  opticalQa: ZoneQaStatus;
  handedOverAt: string | null;
}

export interface ZoneRegisterResult {
  rows: ZoneRegisterRow[];
  summary: {
    zones: number;
    includedPons: number;
    livePons: number;
    readyForQa: number;
    handedOver: number;
  };
}

/**
 * The flat tracker Johan Scott described: two tables, no gates, no blockers.
 * Deliberately separate from ZoneRegisterRow, which reports what FibreFlow has
 * been told; these report what is true of the network.
 */
export interface TrackerPonRow {
  projectId: string;
  projectName: string;
  zoneNo: number;
  ponNo: number;
  portSubmittedAt: string | null;
  homesActive: number;
}

export interface TrackerZoneRow {
  projectId: string;
  projectName: string;
  zoneNo: number;
  totalPons: number;
  livePons: number;
  homesActive: number;
  handedOverAt: string | null;
}

export interface TrackerResult {
  zones: TrackerZoneRow[];
  pons: TrackerPonRow[];
}

export interface ZoneDeliveryInput {
  scopeApproved: boolean;
  pons: PonDeliveryView[];
  civilQa: ZoneQaStatus;
  opticalQa: ZoneQaStatus;
  hasFac: boolean;
  hasCac: boolean;
  openBlockingSnags: number;
  handedOverAt: string | null;
}

export interface ZoneDeliveryCalculation {
  status: ZoneDeliveryStatus;
  earliestIncompleteGate: PonMilestone | null;
  blockers: DeliveryBlocker[];
  eligibleForZoneQa: boolean;
  eligibleForHandover: boolean;
}
