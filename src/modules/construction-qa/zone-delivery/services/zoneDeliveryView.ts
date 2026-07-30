import type {
  MilestoneEvidence,
  PonDeliveryView,
  PonMilestone,
  ZoneDeliveryCalculation,
  ZoneDeliveryView,
  ZoneQaStatus,
} from '../types/zoneDelivery.types';
import type {
  ActivityRow,
  PonStateRow,
  ZoneAggregate,
} from '../repositories/zoneDeliveryReadRepository';
import { calculateZoneDelivery } from './zoneDeliveryCalculator';
import { calculatePonActions } from './zoneDeliveryActionCalculator';

type Time = Date | string | null;

const iso = (value: Time): string | null => {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
};

export const milestones: Array<{
  gate: PonMilestone;
  at: keyof PonStateRow;
  by: keyof PonStateRow;
  permission: string;
}> = [
  { gate: 'civil_complete', at: 'civil_complete_at', by: 'civil_confirmed_by',
    permission: 'construction-confirm' },
  { gate: 'optical_complete', at: 'optical_complete_at', by: 'optical_confirmed_by',
    permission: 'construction-confirm' },
  { gate: 'testing_passed', at: 'testing_passed_at', by: 'testing_confirmed_by',
    permission: 'testing-confirm' },
  { gate: 'port_submitted', at: 'port_submitted_at', by: 'port_submitted_by',
    permission: 'operations-confirm' },
  { gate: 'port_approved', at: 'port_approved_at', by: 'port_approved_by',
    permission: 'operations-confirm' },
  { gate: 'technically_live', at: 'technically_live_at', by: 'technically_live_by',
    permission: 'operations-confirm' },
];

export function milestoneState(pon: PonStateRow): Record<string, unknown> {
  return Object.fromEntries(milestones.flatMap(({ gate, at, by }) => {
    const effectiveAt = iso(pon[at] as Time);
    return effectiveAt ? [[gate, {
      effectiveAt,
      actorUserId: pon[by],
      ...(gate === 'testing_passed'
        ? { testPackDocumentId: pon.testing_test_pack_document_id }
        : {}),
    }]] : [];
  }));
}

function latestActivity(
  aggregate: ZoneAggregate,
  action: string,
  ponStageId?: string,
): ActivityRow | undefined {
  return [...aggregate.activities].reverse().find(row =>
    row.action === action && (!ponStageId || row.pon_stage_id === ponStageId));
}

function milestoneView(
  aggregate: ZoneAggregate,
  pon: PonStateRow,
): PonDeliveryView['milestones'] {
  const result: PonDeliveryView['milestones'] = {};
  for (const { gate, at } of milestones) {
    const effectiveAt = iso(pon[at] as Time);
    if (!effectiveAt) continue;
    const activity = latestActivity(aggregate, `${gate}_confirmed`, pon.pon_stage_id);
    const reconfirmedAt = aggregate.snagLinks
      .filter(link => link.pon_stage_id === pon.pon_stage_id
        && link.affected_gate === gate && link.reconfirmed_at)
      .map(link => iso(link.reconfirmed_at)!)
      .sort()
      .at(-1);
    const evidence: MilestoneEvidence = {
      effectiveAt,
      actorEmail: activity?.actor_email ?? 'unknown',
      source: activity?.source ?? 'unknown',
    };
    if (reconfirmedAt) evidence.reconfirmedAt = reconfirmedAt;
    result[gate] = evidence;
  }
  return result;
}

export function qaView(aggregate: ZoneAggregate, discipline: 'civil' | 'optical') {
  const zone = aggregate.zone;
  const activity = latestActivity(aggregate, `${discipline}_zone_qa_recorded`);
  return {
    status: (zone?.[`${discipline}_qa_status`] ?? 'not_started') as ZoneQaStatus,
    effectiveAt: iso(zone?.[`${discipline}_qa_effective_at`] as Time ?? null),
    approverEmail: activity?.actor_email ?? null,
    notes: String(zone?.[`${discipline}_qa_notes`] ?? ''),
  };
}

export function calculateAggregate(aggregate: ZoneAggregate): ZoneDeliveryCalculation {
  const pons: PonDeliveryView[] = aggregate.pons.map(pon => ({
    ponStageId: pon.pon_stage_id,
    ponNo: pon.pon_no,
    scopeStatus: pon.scope_status,
    scopeReason: pon.scope_reason,
    milestones: milestoneView(aggregate, pon),
    actions: calculatePonActions({
      ponStageId: pon.pon_stage_id,
      ponNo: pon.pon_no,
      scopeApproved: Boolean(aggregate.zone?.scope_approved_at),
      scopeStatus: pon.scope_status,
      handedOver: Boolean(aggregate.zone?.handed_over_at),
      milestones: milestoneView(aggregate, pon),
      civilQaApproved: pon.civil_qa_approved,
      opticalQaApproved: pon.optical_qa_approved,
      hasActiveTestPack: aggregate.documents.some(document =>
        document.document_type === 'test_pack'
        && document.pon_stage_id === pon.pon_stage_id
        && !document.superseded_at),
      reconfirmationBlockers: aggregate.snagLinks
        .filter(link => link.pon_stage_id === pon.pon_stage_id && link.requires_reconfirmation)
        .map(link => ({ gate: link.affected_gate as PonMilestone, status: link.status })),
    }),
    rowVersion: pon.row_version,
  }));
  const openBlockingSnags = aggregate.snagLinks.filter(link =>
    link.requires_reconfirmation || (link.handover_blocking && link.status !== 'closed')).length;
  return calculateZoneDelivery({
    scopeApproved: aggregate.zone?.scope_approved_at !== null
      && aggregate.zone?.scope_approved_at !== undefined,
    pons,
    civilQa: qaView(aggregate, 'civil').status,
    opticalQa: qaView(aggregate, 'optical').status,
    hasFac: aggregate.documents.some(doc =>
      doc.document_type === 'fac' && doc.superseded_at === null),
    hasCac: aggregate.documents.some(doc =>
      doc.document_type === 'cac' && doc.superseded_at === null),
    openBlockingSnags,
    handedOverAt: iso(aggregate.zone?.handed_over_at ?? null),
  });
}

export function buildZoneView(aggregate: ZoneAggregate): ZoneDeliveryView {
  const calculation = calculateAggregate(aggregate);
  const scopeApproved = Boolean(aggregate.zone?.scope_approved_at);
  return {
    ...aggregate.key,
    projectName: aggregate.projectName,
    scopeApproved,
    pons: aggregate.pons.map(pon => ({
      ponStageId: pon.pon_stage_id,
      ponNo: pon.pon_no,
      scopeStatus: pon.scope_status,
      scopeReason: pon.scope_reason,
      milestones: milestoneView(aggregate, pon),
      actions: calculatePonActions({
        ponStageId: pon.pon_stage_id,
        ponNo: pon.pon_no,
        scopeApproved,
        scopeStatus: pon.scope_status,
        handedOver: Boolean(aggregate.zone?.handed_over_at),
        milestones: milestoneView(aggregate, pon),
        civilQaApproved: pon.civil_qa_approved,
        opticalQaApproved: pon.optical_qa_approved,
        hasActiveTestPack: aggregate.documents.some(document =>
          document.document_type === 'test_pack'
          && document.pon_stage_id === pon.pon_stage_id
          && !document.superseded_at),
        reconfirmationBlockers: aggregate.snagLinks
          .filter(link => link.pon_stage_id === pon.pon_stage_id && link.requires_reconfirmation)
          .map(link => ({ gate: link.affected_gate as PonMilestone, status: link.status })),
      }),
      rowVersion: pon.row_version,
    })),
    civilQa: qaView(aggregate, 'civil'),
    opticalQa: qaView(aggregate, 'optical'),
    documents: aggregate.documents.map(doc => ({
      id: doc.id,
      documentType: doc.document_type,
      ...(doc.pon_stage_id ? { ponStageId: doc.pon_stage_id } : {}),
      url: doc.source_ref,
      checksumSha256: doc.checksum_sha256,
      active: doc.superseded_at === null,
    })),
    status: calculation.status,
    blockers: calculation.blockers,
    eligibleForZoneQaAt: iso(aggregate.zone?.eligible_for_zone_qa_at ?? null),
    handedOverAt: iso(aggregate.zone?.handed_over_at ?? null),
    rowVersion: aggregate.zone?.row_version ?? 0,
  };
}
