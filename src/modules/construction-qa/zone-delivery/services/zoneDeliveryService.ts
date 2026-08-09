import { Pool } from 'pg';
import type {
  CommandMeta, ConfirmMilestoneInput, DeclareHandoverInput, DeliveryActor, RecordZoneQaInput,
  RegisterDocumentInput, UpdateScopeInput, ZoneDeliveryActivity,
  ZoneDeliveryView, ZoneKey, ZoneRegisterFilters, ZoneRegisterResult,
} from '../types/zoneDelivery.types';
import * as read from '../repositories/zoneDeliveryReadRepository';
import * as write from '../repositories/zoneDeliveryWriteRepository';
import {
  buildZoneView, milestoneState, milestones, recalculateZone,
} from './zoneDeliveryHandover';
import {
  deliveryError, handoverLocked, hasReason, requirePermission,
  validateMeta, versionConflict,
} from './zoneDeliveryErrors';
import { getZoneDeliveryRegister } from './zoneDeliveryRegister';
import { transaction, withClient } from './zoneDeliveryTransactions';
import { assertCanonicalZone, ensureCanonicalPons } from './zoneDeliveryCanonical';
import { validateMilestoneConfirmation } from './zoneDeliveryMilestoneActions';
import { invalidateZoneEvidence } from './zoneDeliveryInvalidation';
import { requireSupervisedDocumentSource } from './zoneDeliveryDocumentSecurity';
import { recordZoneQaCommand } from './zoneDeliveryQaCommands';
import { declareZoneHandoverCommand } from './zoneDeliveryHandoverCommand';
export interface ZoneDeliveryService {
  getRegister(filters: ZoneRegisterFilters): Promise<ZoneRegisterResult>; getZone(key: ZoneKey): Promise<ZoneDeliveryView>;
  updateScope(input: UpdateScopeInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  confirmPonMilestone(input: ConfirmMilestoneInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  recordZoneQa(input: RecordZoneQaInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  declareZoneHandover(input: DeclareHandoverInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  registerDocument(input: RegisterDocumentInput, actor: DeliveryActor): Promise<ZoneDeliveryView>;
  recalculateForSnag(snagId: string, actor: DeliveryActor): Promise<void>; getActivity(key: ZoneKey): Promise<ZoneDeliveryActivity[]>;
}
const iso = (value: Date | string | null): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();
const audit = (input: ZoneKey & CommandMeta, actor: DeliveryActor) => ({
  key: input, effectiveAt: input.effectiveAt, actor,
  source: input.source, reason: input.reason,
});
class PgZoneDeliveryService implements ZoneDeliveryService {
  constructor(private readonly pool: Pool) {}
  getZone(key: ZoneKey): Promise<ZoneDeliveryView> {
    return withClient(this.pool, async client => {
      await assertCanonicalZone(client, key);
      return buildZoneView(await read.readZoneAggregate(client, key));
    }); }
  getActivity(key: ZoneKey): Promise<ZoneDeliveryActivity[]> {
    return withClient(this.pool, async client => {
      await assertCanonicalZone(client, key);
      return read.readActivity(client, key);
    }); }
  async getRegister(filters: ZoneRegisterFilters): Promise<ZoneRegisterResult> {
    return getZoneDeliveryRegister(this.pool, filters);
  }
  updateScope(input: UpdateScopeInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return transaction(this.pool, async client => {
      requirePermission(actor, 'scope-manage');
      await assertCanonicalZone(client, input);
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
      if (input.pons.length !== canonical.size
        || input.pons.some(pon => !canonical.has(pon.ponStageId))) {
        deliveryError('SCOPE_REQUIRED', 'Scope must contain every canonical zone PON exactly once');
      }
      for (const pon of input.pons) {
        if (pon.scopeStatus !== 'included' && !hasReason(pon.reason))
          deliveryError('VALIDATION_ERROR', 'Excluded or cancelled PONs require a reason');
      }
      // "Never scoped" used to be inferred from row_version 0, which a PON with
      // no pon_delivery_state row reported via COALESCE. Those rows are now
      // materialised ahead of the first command on a zone, and the schema
      // forbids row_version 0, so the inference is asked of the zone directly:
      // if its scope has never been approved, every PON in it is first-time and
      // is audited, exactly as before.
      const firstApproval = !zone?.scope_approved_at;
      const neverScoped = (previous: { row_version: number }) =>
        firstApproval || previous.row_version === 0;
      const changes = input.pons.filter(pon => {
        const previous = canonical.get(pon.ponStageId)!;
        return neverScoped(previous)
          || previous.scope_status !== pon.scopeStatus
          || (previous.scope_reason ?? '') !== (pon.reason?.trim() ?? '');
      });
      const changing = Boolean(zone?.scope_approved_at) && changes.length > 0;
      const materialChange = Boolean(zone?.scope_approved_at) && changes.some(pon => {
        const previous = canonical.get(pon.ponStageId)!;
        return previous.row_version === 0 || previous.scope_status !== pon.scopeStatus;
      });
      validateMeta(input, now, changing);
      if (zone?.scope_approved_at && !changing) return buildZoneView(aggregate);
      const savedZone = await write.writeScopeApproval(client, input, input.expectedRowVersion, input.effectiveAt, actor.userId);
      if (!savedZone) versionConflict();
      for (const pon of changes) {
        const previous = canonical.get(pon.ponStageId)!;
        await write.writePonScope(client, pon.ponStageId, pon.scopeStatus, pon.reason);
        await write.appendActivity(client, {
          ...audit(input, actor), ponStageId: pon.ponStageId,
          entityType: 'pon', entityId: pon.ponStageId, action: 'scope_updated',
          reason: pon.reason ?? input.reason,
          previousValue: neverScoped(previous) ? null
            : { scopeStatus: previous.scope_status, scopeReason: previous.scope_reason },
          newValue: { scopeStatus: pon.scopeStatus, scopeReason: pon.reason?.trim() || null },
        });
      }
      await write.appendActivity(client, {
        ...audit(input, actor),
        entityType: 'zone',
        entityId: savedZone!.id,
        action: zone?.scope_approved_at ? 'zone_scope_updated' : 'zone_scope_approved',
        previousValue: zone?.scope_approved_at ? aggregate.pons.map(pon => ({
          ponStageId: pon.pon_stage_id,
          scopeStatus: pon.scope_status,
          scopeReason: pon.scope_reason,
        })) : null,
        newValue: input.pons.map(pon => ({
          ponStageId: pon.ponStageId,
          scopeStatus: pon.scopeStatus,
          scopeReason: pon.reason?.trim() || null,
        })),
      });
      if (materialChange && zone) {
        await invalidateZoneEvidence(client, input, actor, {
          ...zone,
          row_version: savedZone!.row_version,
        });
      }
      return recalculateZone(client, input, actor);
    });
  }
  confirmPonMilestone(input: ConfirmMilestoneInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return transaction(this.pool, async client => {
      const config = milestones.find(item => item.gate === input.milestone)!;
      requirePermission(actor, input.action === 'link_maintenance' ? 'operations-confirm' : config.permission);
      await ensureCanonicalPons(client, input);
      await assertCanonicalZone(client, input);
      // zone_delivery_activity carries a foreign key to zone_delivery_state, so
      // the audit row this command always writes needs the zone row to exist.
      // Scope approval and document registration each create it as part of
      // their own flow; confirming a milestone had no equivalent, which made
      // every milestone on a zone that had never been touched fail on the audit
      // write rather than on anything to do with the milestone. Created before
      // lockZone so the row is locked with the rest of the command, and not
      // inside ensureCanonicalPons because registerDocument compares the
      // caller's expectedRowVersion against a zone that is meant to be absent.
      await write.insertZone(client, input);
      const now = await read.readTransactionTime(client);
      validateMeta(input, now);
      const zone = await write.lockZone(client, input);
      const aggregate = await read.readZoneAggregate(client, input);
      const canonical = aggregate.pons.find(pon => pon.pon_stage_id === input.ponStageId);
      if (!canonical) deliveryError('VALIDATION_ERROR', 'PON does not belong to the zone');
      const pon = await write.lockPon(client, input.ponStageId);
      if (!pon) versionConflict();
      const state = pon!;
      if (state.row_version !== input.expectedRowVersion) versionConflict();
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
      // Mirrors the rule in zoneDeliveryActionCalculator.confirmBlocker: an
      // unapproved scope does not block port_submitted, because it is an
      // attestation about work done outside FibreFlow on zones that predate it.
      // This check is a second, independent copy of that gate — the calculator
      // below runs too late to be reached while this one still fires, so both
      // have to agree or the exemption is dead code.
      const attested = input.milestone === 'port_submitted';
      if ((!attested && !zone?.scope_approved_at) || state.scope_status !== 'included')
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
        if (zone) await invalidateZoneEvidence(client, input, actor, zone);
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
      const { testPack, reconfirmations } = await validateMilestoneConfirmation(
        client,
        input,
        zone,
        state,
        canonical,
        aggregate,
        current,
      );
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
    return recordZoneQaCommand(this.pool, input, actor);
  }
  declareZoneHandover(input: DeclareHandoverInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return declareZoneHandoverCommand(this.pool, input, actor);
  }
  registerDocument(input: RegisterDocumentInput, actor: DeliveryActor): Promise<ZoneDeliveryView> {
    return transaction(this.pool, async client => {
      requirePermission(actor, 'documents-manage');
      await ensureCanonicalPons(client, input);
      await assertCanonicalZone(client, input);
      const now = await read.readTransactionTime(client);
      const zone = await write.lockZone(client, input);
      if (zone?.handed_over_at) handoverLocked();
      if ((zone?.row_version ?? 0) !== input.expectedRowVersion) versionConflict();
      const aggregate = await read.readZoneAggregate(client, input);
      if (!zone && aggregate.zone) versionConflict();
      requireSupervisedDocumentSource(input.documentSource);
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
