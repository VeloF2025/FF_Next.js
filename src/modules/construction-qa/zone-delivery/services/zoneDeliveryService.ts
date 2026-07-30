import { Pool, type PoolClient } from 'pg';
import type {
  CommandMeta, ConfirmMilestoneInput, DeliveryActor, RecordZoneQaInput,
  RegisterDocumentInput, UpdateScopeInput, ZoneDeliveryActivity,
  ZoneDeliveryView, ZoneKey, ZoneRegisterFilters, ZoneRegisterResult,
} from '../types/zoneDelivery.types';
import * as read from '../repositories/zoneDeliveryReadRepository';
import * as write from '../repositories/zoneDeliveryWriteRepository';
import {
  buildZoneView, calculateAggregate, milestoneState, milestones, recalculateZone,
} from './zoneDeliveryHandover';
import {
  deliveryError, handoverLocked, hasReason, requirePermission,
  validateMeta, versionConflict,
} from './zoneDeliveryErrors';
export interface ZoneDeliveryService {
  getRegister(filters: ZoneRegisterFilters): Promise<ZoneRegisterResult>; getZone(key: ZoneKey): Promise<ZoneDeliveryView>;
  updateScope(input: UpdateScopeInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  confirmPonMilestone(input: ConfirmMilestoneInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  recordZoneQa(input: RecordZoneQaInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  registerDocument(input: RegisterDocumentInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  recalculateForSnag(snagId: string, actor: DeliveryActor): Promise<void>; getActivity(key: ZoneKey): Promise<ZoneDeliveryActivity[]>;
}
const iso = (value: Date | string | null): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();
const audit = (input: ZoneKey & CommandMeta, actor: DeliveryActor) => ({
  key: input, effectiveAt: input.effectiveAt, actor,
  source: input.source, reason: input.reason,
});
async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK'); throw error;
  } finally { client.release(); }
}
async function withClient<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { return await work(client); } finally { client.release(); }
}
class PgZoneDeliveryService implements ZoneDeliveryService {
  constructor(private readonly pool: Pool) {}
  getZone(key: ZoneKey): Promise<ZoneDeliveryView> {
    return withClient(this.pool, async client => buildZoneView(await read.readZoneAggregate(client, key))); }
  getActivity(key: ZoneKey): Promise<ZoneDeliveryActivity[]> {
    return withClient(this.pool, client => read.readActivity(client, key)); }
  async getRegister(filters: ZoneRegisterFilters): Promise<ZoneRegisterResult> {
    return withClient(this.pool, async client => {
      const rows = [];
      for (const key of await read.listZoneKeys(client, filters.projectId, filters.zoneNo)) {
        const aggregate = await read.readZoneAggregate(client, key);
        const view = buildZoneView(aggregate);
        const calculation = calculateAggregate(aggregate);
        const text = `${view.projectName} ${view.zoneNo}`.toLowerCase();
        if (filters.status && view.status !== filters.status) continue;
        if (filters.handover === 'complete' && !view.handedOverAt) continue;
        if (filters.handover === 'pending' && view.handedOverAt) continue;
        if (filters.search && !text.includes(filters.search.toLowerCase())) continue;
        if (filters.blocker && !view.blockers.some(blocker => `${blocker.code} ${blocker.message}`
          .toLowerCase().includes(filters.blocker!.toLowerCase()))) continue;
        const included = view.pons.filter(pon => pon.scopeStatus === 'included');
        rows.push({
          ...key, projectName: view.projectName, status: view.status,
          includedPons: included.length, livePons: included.filter(pon => pon.milestones.technically_live).length,
          earliestIncompleteGate: calculation.earliestIncompleteGate, blockerCount: view.blockers.length,
          civilQa: view.civilQa.status, opticalQa: view.opticalQa.status,
          handedOverAt: view.handedOverAt,
        });
      }
      return { rows, summary: {
          zones: rows.length,
          includedPons: rows.reduce((sum, row) => sum + row.includedPons, 0),
          livePons: rows.reduce((sum, row) => sum + row.livePons, 0),
          readyForQa: rows.filter(row => row.status === 'ready_for_zone_qa').length,
          handedOver: rows.filter(row => row.handedOverAt).length,
        } };
    });
  }
  updateScope(input: UpdateScopeInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return transaction(this.pool, async client => {
      requirePermission(actor, 'scope-manage');
      const now = await read.readTransactionTime(client);
      validateMeta(input, now);
      if (input.pons.length === 0 || new Set(input.pons.map(pon => pon.ponStageId)).size !== input.pons.length) {
        deliveryError('SCOPE_REQUIRED', 'A unique non-empty PON scope is required');
      }
      const zone = await write.lockZone(client, input);
      if (zone?.handed_over_at) handoverLocked();
      if ((zone?.row_version ?? 0) !== input.expectedRowVersion) versionConflict();
      const aggregate = await read.readZoneAggregate(client, input);
      const canonical = new Map(aggregate.pons.map(pon => [pon.pon_stage_id, pon]));
      if (input.pons.some(pon => !canonical.has(pon.ponStageId)))
        deliveryError('VALIDATION_ERROR', 'Every scoped PON must belong to the zone');
      for (const pon of input.pons) {
        if (pon.scopeStatus !== 'included' && !hasReason(pon.reason))
          deliveryError('VALIDATION_ERROR', 'Excluded or cancelled PONs require a reason');
      }
      const changing = Boolean(zone?.scope_approved_at) && input.pons.some(pon => {
        const previous = canonical.get(pon.ponStageId)!;
        return previous.scope_status !== pon.scopeStatus || (previous.scope_reason ?? '') !== (pon.reason?.trim() ?? '');
      });
      validateMeta(input, now, changing);
      if (zone?.scope_approved_at && !changing) return buildZoneView(aggregate);
      const savedZone = await write.writeScopeApproval(client, input, input.expectedRowVersion, input.effectiveAt, actor.userId);
      if (!savedZone) versionConflict();
      for (const pon of input.pons) {
        const previous = canonical.get(pon.ponStageId)!;
        await write.writePonScope(client, pon.ponStageId, pon.scopeStatus, pon.reason);
        await write.appendActivity(client, {
          ...audit(input, actor), ponStageId: pon.ponStageId,
          entityType: 'pon', entityId: pon.ponStageId, action: 'scope_updated',
          reason: pon.reason ?? input.reason,
          previousValue: previous.row_version === 0 ? null
            : { scopeStatus: previous.scope_status, scopeReason: previous.scope_reason },
          newValue: { scopeStatus: pon.scopeStatus, scopeReason: pon.reason?.trim() || null },
        });
      }
      return recalculateZone(client, input, actor);
    });
  }
  confirmPonMilestone(input: ConfirmMilestoneInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return transaction(this.pool, async client => {
      const config = milestones.find(item => item.gate === input.milestone)!;
      requirePermission(actor, input.action === 'link_maintenance' ? 'operations-confirm' : config.permission);
      const now = await read.readTransactionTime(client);
      validateMeta(input, now);
      const zone = await write.lockZone(client, input);
      const aggregate = await read.readZoneAggregate(client, input);
      const canonical = aggregate.pons.find(pon => pon.pon_stage_id === input.ponStageId);
      if (!canonical) deliveryError('VALIDATION_ERROR', 'PON does not belong to the zone');
      let pon = await write.lockPon(client, input.ponStageId);
      const projectionExists = Boolean(pon);
      if (!pon && input.expectedRowVersion === 0 && zone?.scope_approved_at) {
        await write.writePonScope(client, input.ponStageId, 'included'); pon = await write.lockPon(client, input.ponStageId); }
      if (!pon) versionConflict();
      const state = pon!;
      if (projectionExists && state.row_version !== input.expectedRowVersion) versionConflict();
      if (input.action === 'link_maintenance') {
        if (!zone?.handed_over_at)
          deliveryError('VALIDATION_ERROR', 'Maintenance links require a handed-over zone');
        if (!input.snagId || !input.affectedGate
          || !(await read.readSnag(client, input.projectId, input.snagId)))
          deliveryError('VALIDATION_ERROR', 'An existing snag and affected gate are required');
        if (!(await write.touchPon(client, input.ponStageId, state.row_version))) versionConflict();
        await write.linkSnag(client, input, input.snagId, actor.userId, {
          ponStageId: input.ponStageId, affectedGate: input.affectedGate, blocking: false, reconfirmation: false,
        });
        await write.appendActivity(client, {
          ...audit(input, actor), ponStageId: input.ponStageId,
          entityType: 'snag', entityId: input.snagId, action: 'maintenance_linked', previousValue: null,
          newValue: { affectedGate: input.affectedGate, handoverBlocking: false },
        });
        return recalculateZone(client, input, actor);
      }
      if (zone?.handed_over_at) handoverLocked();
      if (!zone?.scope_approved_at || state.scope_status !== 'included')
        deliveryError('SCOPE_REQUIRED', 'PON must be in approved scope');
      const current = state[config.at] as Date | string | null;
      if (input.action === 'reopen') {
        validateMeta(input, now, true);
        if (!current || !input.snagId || input.affectedGate !== input.milestone
          || !(await read.readSnag(client, input.projectId, input.snagId)))
          deliveryError('VALIDATION_ERROR', 'Reopen requires evidence and an existing affected snag');
        const previousValue = milestoneState(state);
        const updated = await write.reopenMilestone(client, input.ponStageId, input.milestone, state.row_version);
        if (!updated) versionConflict();
        await write.linkSnag(client, input, input.snagId, actor.userId, {
          ponStageId: input.ponStageId, affectedGate: input.affectedGate, blocking: true, reconfirmation: true,
        });
        await write.appendActivity(client, {
          ...audit(input, actor), ponStageId: input.ponStageId,
          entityType: 'pon', entityId: input.ponStageId, action: `${input.milestone}_reopened`,
          previousValue, newValue: milestoneState(updated!),
        });
        return recalculateZone(client, input, actor);
      }
      validateMeta(input, now, Boolean(current));
      const index = milestones.indexOf(config);
      if (index > 0 && !state[milestones[index - 1]!.at])
        deliveryError('PREREQUISITE_BLOCKED', `${milestones[index - 1]!.gate} is required first`);
      if (input.milestone === 'civil_complete' || input.milestone === 'optical_complete') {
        const discipline = input.milestone === 'civil_complete' ? 'civil' : 'optical';
        if (!(await read.constructionQaIsApproved(client, input, canonical.pon_no, discipline)))
          deliveryError('EVIDENCE_REQUIRED', `Complete approved ${discipline} QA is required`);
      }
      const testPack = aggregate.documents.find(document =>
        document.document_type === 'test_pack' && document.pon_stage_id === input.ponStageId && !document.superseded_at);
      if (input.milestone === 'testing_passed' && !testPack)
        deliveryError('EVIDENCE_REQUIRED', 'An active same-PON test pack is required');
      const reconfirmations = aggregate.snagLinks.filter(link =>
        link.pon_stage_id === input.ponStageId && link.affected_gate === input.milestone && link.requires_reconfirmation);
      if (reconfirmations.some(link => link.status !== 'closed'))
        deliveryError('PREREQUISITE_BLOCKED', 'The affected snag must be closed first');
      const updated = await write.confirmMilestone(
        client, input.ponStageId, input.milestone, state.row_version, input.effectiveAt, actor.userId, testPack?.id,
      );
      if (!updated) versionConflict();
      if (reconfirmations.length > 0)
        await write.markGateReconfirmed(client, input.ponStageId, input.milestone, actor.userId);
      await write.appendActivity(client, {
        ...audit(input, actor), ponStageId: input.ponStageId,
        entityType: 'pon', entityId: input.ponStageId,
        action: `${input.milestone}_confirmed`,
        previousValue: current ? {
          effectiveAt: iso(current), actorUserId: state[config.by],
          ...(input.milestone === 'testing_passed' ? { testPackDocumentId: state.testing_test_pack_document_id } : {}),
        } : null,
        newValue: { effectiveAt: input.effectiveAt, actorUserId: actor.userId,
          ...(testPack ? { testPackDocumentId: testPack.id } : {}) },
      });
      return recalculateZone(client, input, actor);
    });
  }
  recordZoneQa(input: RecordZoneQaInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return transaction(this.pool, async client => {
      requirePermission(actor, 'zone-qa-approve');
      const now = await read.readTransactionTime(client);
      const zone = await write.lockZone(client, input);
      if (!zone || zone.row_version !== input.expectedRowVersion) versionConflict();
      const state = zone!;
      if (state.handed_over_at) handoverLocked();
      const aggregate = await read.readZoneAggregate(client, input);
      if (!calculateAggregate(aggregate).eligibleForZoneQa)
        deliveryError('PREREQUISITE_BLOCKED', 'Every included PON must be technically live');
      const previousStatus = input.discipline === 'civil'
        ? state.civil_qa_status : state.optical_qa_status;
      validateMeta(input, now, previousStatus === input.status);
      if (input.status === 'failed' && input.snagIds.length === 0)
        deliveryError('VALIDATION_ERROR', 'Failed Zone QA requires existing snag IDs');
      for (const snagId of [...new Set(input.snagIds)]) {
        if (!(await read.readSnag(client, input.projectId, snagId)))
          deliveryError('VALIDATION_ERROR', `Snag ${snagId} does not belong to the project`);
        await write.linkSnag(client, input, snagId, actor.userId, { blocking: true, reconfirmation: false });
      }
      const saved = await write.writeZoneQa(
        client, input, input.discipline, input.status, input.notes, input.effectiveAt, actor.userId, input.expectedRowVersion,
      );
      if (!saved) versionConflict();
      const prefix = input.discipline === 'civil' ? 'civil' : 'optical';
      await write.appendActivity(client, {
        ...audit(input, actor), entityType: 'zone', entityId: state.id,
        action: `${input.discipline}_zone_qa_recorded`,
        previousValue: {
          status: previousStatus, notes: state[`${prefix}_qa_notes`],
          effectiveAt: iso(state[`${prefix}_qa_effective_at`] as Date | string | null),
          approverUserId: state[`${prefix}_qa_approved_by`] },
        newValue: { status: input.status, notes: input.notes,
          effectiveAt: input.effectiveAt, approverUserId: actor.userId },
      });
      return recalculateZone(client, input, actor);
    });
  }
  registerDocument(input: RegisterDocumentInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return transaction(this.pool, async client => {
      requirePermission(actor, 'documents-manage');
      const now = await read.readTransactionTime(client);
      const zone = await write.lockZone(client, input);
      if (zone?.handed_over_at) handoverLocked();
      if ((zone?.row_version ?? 0) !== input.expectedRowVersion) versionConflict();
      const aggregate = await read.readZoneAggregate(client, input);
      if (!zone && aggregate.zone) versionConflict();
      const testPack = input.documentType === 'test_pack';
      if (testPack !== Boolean(input.ponStageId) || (input.ponStageId
          && !aggregate.pons.some(pon => pon.pon_stage_id === input.ponStageId))
        || !input.sourceRef.trim() || !input.filename.trim() || !input.mimeType.trim()
        || input.sizeBytes < 0 || !/^[0-9a-f]{64}$/i.test(input.checksumSha256))
        deliveryError('VALIDATION_ERROR', 'Document metadata or owner is invalid');
      const active = aggregate.documents.find(document =>
        document.document_type === input.documentType && !document.superseded_at
          && (testPack ? document.pon_stage_id === input.ponStageId : !document.pon_stage_id));
      validateMeta(input, now, Boolean(active));
      if (!zone && !(await write.insertZone(client, input))) versionConflict();
      const previous = await write.supersedeActiveDocument(client, input, actor.userId);
      const document = await write.insertDocument(client, input, actor.userId);
      if (zone && !(await write.touchZone(client, input, input.expectedRowVersion))) versionConflict();
      await write.appendActivity(client, {
        ...audit(input, actor), ponStageId: input.ponStageId,
        entityType: 'document', entityId: document.id, action: 'document_registered',
        previousValue: previous ? {
          id: previous.id, checksumSha256: previous.checksum_sha256,
          sourceRef: previous.source_ref } : null,
        newValue: {
          id: document.id, documentType: document.document_type,
          ponStageId: document.pon_stage_id, checksumSha256: document.checksum_sha256,
          sourceRef: document.source_ref },
      });
      return recalculateZone(client, input, actor);
    });
  }
  async recalculateForSnag(snagId: string, actor: DeliveryActor): Promise<void> {
    const keys = await withClient(this.pool, client => read.listSnagZoneKeys(client, snagId));
    for (const key of keys)
      await transaction(this.pool, client => recalculateZone(client, key, actor));
  }
}
export function createZoneDeliveryService(pool: Pool): ZoneDeliveryService {
  return new PgZoneDeliveryService(pool); }
