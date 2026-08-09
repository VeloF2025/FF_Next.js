import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type {
  ConfirmMilestoneInput,
  DeclareHandoverInput,
  PonMilestone,
  RecordZoneQaInput,
  RegisterDocumentInput,
  ScopeStatus,
  SubmitPonInput,
  UpdateScopeInput,
  ZoneDeliveryStatus,
  ZoneKey,
  ZoneRegisterFilters,
} from '../types/zoneDelivery.types';
import {
  MAX_EFFECTIVE_AT_FUTURE_SKEW_MS,
  POSTGRES_INTEGER_MAX,
  ZoneDeliveryError,
} from './zoneDeliveryErrors';

export const READ_PERMISSION = 'construction-qa.qa-centre';
export const COMMAND_PERMISSIONS = {
  scope: 'construction-qa.zone-delivery.scope-manage',
  construction: 'construction-qa.zone-delivery.construction-confirm',
  testing: 'construction-qa.zone-delivery.testing-confirm',
  operations: 'construction-qa.zone-delivery.operations-confirm',
  zoneQa: 'construction-qa.zone-delivery.zone-qa-approve',
  document: 'construction-qa.zone-delivery.documents-manage',
} as const;


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES: ReadonlySet<ZoneDeliveryStatus> = new Set([
  'handed_over', 'scope_pending', 'handover_blocked', 'zone_qa_in_progress',
  'ready_for_zone_qa', 'go_live_in_progress', 'awaiting_port_approval',
  'ready_for_port_submission', 'testing_in_progress', 'optical_construction',
  'civil_construction',
]);
const MILESTONES: ReadonlySet<PonMilestone> = new Set([
  'civil_complete', 'optical_complete', 'testing_passed',
  'port_submitted', 'port_approved', 'technically_live',
]);

export class ZoneDeliveryHttpError extends Error {
  readonly code = 'VALIDATION_ERROR';
}
const invalid = (field: string): never => {
  throw new ZoneDeliveryHttpError(`Invalid ${field}`);
};
const objectBody = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('JSON body');
  return value as Record<string, unknown>;
};
const string = (value: unknown, field: string, required = true): string | undefined => {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || (required && !value.trim())) return invalid(field);
  return value;
};
const uuid = (value: unknown, field: string, required = true): string | undefined => {
  const result = string(value, field, required);
  if (result !== undefined && !UUID.test(result)) return invalid(field);
  return result;
};
const integer = (
  value: unknown,
  field: string,
  positive = false,
  maximum = POSTGRES_INTEGER_MAX,
): number => {
  if (!Number.isSafeInteger(value) || Number(value) > maximum
    || (positive ? Number(value) <= 0 : Number(value) < 0)) {
    return invalid(field);
  }
  return Number(value);
};
const coercedInteger = (
  value: unknown,
  field: string,
  positive = false,
  maximum = POSTGRES_INTEGER_MAX,
): number => {
  const result = typeof value === 'string' && value.trim() ? Number(value) : value;
  return integer(result, field, positive, maximum);
};
const member = <T extends string>(value: unknown, values: ReadonlySet<T>, field: string): T => {
  if (typeof value !== 'string' || !values.has(value as T)) return invalid(field);
  return value as T;
};
const singleQuery = (value: string | string[] | undefined, field: string): string | undefined => {
  if (Array.isArray(value)) return invalid(field);
  return value;
};

function commandMeta(body: Record<string, unknown>, coerceNumbers = false) {
  const effectiveAt = string(body.effectiveAt, 'effectiveAt')!;
  const effectiveTime = new Date(effectiveAt).valueOf();
  if (Number.isNaN(effectiveTime)
    || effectiveTime - Date.now() > MAX_EFFECTIVE_AT_FUTURE_SKEW_MS) {
    return invalid('effectiveAt');
  }
  const parseInteger = coerceNumbers ? coercedInteger : integer;
  return {
    projectId: uuid(body.projectId, 'projectId')!,
    zoneNo: parseInteger(body.zoneNo, 'zoneNo', true),
    expectedRowVersion: parseInteger(body.expectedRowVersion, 'expectedRowVersion'),
    effectiveAt,
    source: string(body.source, 'source')!,
    ...(body.reason === undefined ? {} : { reason: string(body.reason, 'reason')! }),
  };
}

export function parseZoneQuery(req: NextApiRequest): ZoneKey {
  return {
    projectId: uuid(singleQuery(req.query.project_id, 'project_id'), 'project_id')!,
    zoneNo: coercedInteger(singleQuery(req.query.zone_no, 'zone_no'), 'zone_no', true),
  };
}

/**
 * Submit PON is addressed by site/zone/PON, not by pon_stage_id, so it carries
 * no expectedRowVersion for the caller to supply — the row it targets may not
 * exist until the command creates it. The version check still happens, against
 * the id resolved server-side.
 */
export function parsePonSubmitBody(value: unknown): SubmitPonInput {
  const body = objectBody(value);
  const effectiveAt = string(body.effectiveAt, 'effectiveAt')!;
  const effectiveTime = new Date(effectiveAt).valueOf();
  if (Number.isNaN(effectiveTime)
    || effectiveTime - Date.now() > MAX_EFFECTIVE_AT_FUTURE_SKEW_MS) {
    return invalid('effectiveAt');
  }
  return {
    projectId: uuid(body.projectId, 'projectId')!,
    zoneNo: coercedInteger(body.zoneNo, 'zoneNo', true),
    ponNo: coercedInteger(body.ponNo, 'ponNo', true),
    effectiveAt,
    source: string(body.source, 'source')!,
    ...(body.reason === undefined ? {} : { reason: string(body.reason, 'reason')! }),
  };
}

export function parseTrackerQuery(req: NextApiRequest): string | undefined {
  const projectId = singleQuery(req.query.project_id, 'project_id');
  return projectId === undefined ? undefined : uuid(projectId, 'project_id')!;
}

export function parseRegisterQuery(req: NextApiRequest): ZoneRegisterFilters {
  const projectId = singleQuery(req.query.project_id, 'project_id');
  const zoneNo = singleQuery(req.query.zone_no, 'zone_no');
  const status = singleQuery(req.query.status, 'status');
  const handover = singleQuery(req.query.handover, 'handover');
  const blocker = singleQuery(req.query.blocker, 'blocker');
  const search = singleQuery(req.query.search, 'search');
  return {
    ...(projectId === undefined ? {} : { projectId: uuid(projectId, 'project_id')! }),
    ...(zoneNo === undefined ? {} : { zoneNo: coercedInteger(zoneNo, 'zone_no', true) }),
    ...(status === undefined ? {} : { status: member(status, STATUSES, 'status') }),
    ...(handover === undefined
      ? {}
      : { handover: member(handover, new Set<'pending' | 'complete'>(['pending', 'complete']), 'handover') }),
    ...(blocker === undefined ? {} : { blocker: string(blocker, 'blocker')! }),
    ...(search === undefined ? {} : { search: string(search, 'search')! }),
  };
}

export function parseScopeBody(value: unknown): UpdateScopeInput {
  const body = objectBody(value);
  if (!Array.isArray(body.pons)) return invalid('pons');
  return {
    ...commandMeta(body),
    pons: body.pons.map((raw, index) => {
      const pon = objectBody(raw);
      return {
        ponStageId: uuid(pon.ponStageId, `pons[${index}].ponStageId`)!,
        scopeStatus: member(
          pon.scopeStatus,
          new Set<ScopeStatus>(['included', 'excluded', 'cancelled']),
          `pons[${index}].scopeStatus`,
        ),
        ...(pon.reason === undefined ? {} : { reason: string(pon.reason, `pons[${index}].reason`)! }),
      };
    }),
  };
}

export function parseMilestoneBody(value: unknown): ConfirmMilestoneInput {
  const body = objectBody(value);
  return {
    ...commandMeta(body),
    ponStageId: uuid(body.ponStageId, 'ponStageId')!,
    milestone: member(body.milestone, MILESTONES, 'milestone'),
    action: member(body.action, new Set(['confirm', 'reopen', 'link_maintenance']), 'action'),
    ...(body.snagId === undefined ? {} : { snagId: uuid(body.snagId, 'snagId')! }),
    ...(body.affectedGate === undefined
      ? {}
      : { affectedGate: member(body.affectedGate, MILESTONES, 'affectedGate') }),
  };
}

export function parseHandoverBody(value: unknown): DeclareHandoverInput {
  const body = objectBody(value);
  return {
    ...commandMeta(body),
  };
}

export function parseZoneQaBody(value: unknown): RecordZoneQaInput {
  const body = objectBody(value);
  if (!Array.isArray(body.snagIds)) return invalid('snagIds');
  return {
    ...commandMeta(body),
    discipline: member(body.discipline, new Set(['civil', 'optical']), 'discipline'),
    status: member(body.status, new Set(['in_progress', 'passed', 'failed']), 'status'),
    notes: string(body.notes, 'notes', false) ?? '',
    snagIds: body.snagIds.map((id, index) => uuid(id, `snagIds[${index}]`)!),
  };
}

export function parseDocumentBody(
  value: unknown,
  options: { coerceCommandNumbers?: boolean } = {},
): RegisterDocumentInput {
  const body = objectBody(value);
  const checksum = string(body.checksumSha256, 'checksumSha256')!;
  if (!/^[0-9a-f]{64}$/i.test(checksum)) return invalid('checksumSha256');
  return {
    ...commandMeta(body, options.coerceCommandNumbers),
    documentType: member(body.documentType, new Set(['test_pack', 'fac', 'cac']), 'documentType'),
    ...(body.ponStageId === undefined ? {} : { ponStageId: uuid(body.ponStageId, 'ponStageId')! }),
    documentSource: member(body.documentSource, new Set(['vf_storage', 'exfo_result']), 'documentSource'),
    sourceRef: string(body.sourceRef, 'sourceRef')!,
    filename: string(body.filename, 'filename')!,
    mimeType: string(body.mimeType, 'mimeType')!,
    sizeBytes: integer(body.sizeBytes, 'sizeBytes', false, Number.MAX_SAFE_INTEGER),
    checksumSha256: checksum,
  };
}

const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  SCOPE_REQUIRED: 422,
  PREREQUISITE_BLOCKED: 422,
  EVIDENCE_REQUIRED: 422,
  VERSION_CONFLICT: 409,
  HANDOVER_LOCKED: 409,
  ZONE_NOT_FOUND: 404,
} as const;

export function respondToZoneDeliveryError(res: NextApiResponse, error: unknown): void {
  if (error instanceof ZoneDeliveryHttpError) {
    res.status(400).json({ success: false, error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZoneDeliveryError) {
    const details = (error as ZoneDeliveryError & { details?: unknown; blockers?: unknown }).details
      ?? ((error as ZoneDeliveryError & { blockers?: unknown }).blockers === undefined
        ? undefined
        : { blockers: (error as ZoneDeliveryError & { blockers?: unknown }).blockers });
    res.status(ERROR_STATUS[error.code]).json({
      success: false,
      error: { code: error.code, message: error.message, ...(details === undefined ? {} : { details }) },
    });
    return;
  }
  log.error('Zone delivery API error', {
    error: error instanceof Error ? error.message : String(error),
  });
  apiResponse.internalError(res, error);
}

export async function zoneDeliveryResponse<T>(
  res: NextApiResponse,
  work: () => Promise<T>,
): Promise<void> {
  try {
    apiResponse.success(res, await work());
  } catch (error) {
    respondToZoneDeliveryError(res, error);
  }
}

export async function zoneDeliveryErrorBoundary(
  res: NextApiResponse,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    respondToZoneDeliveryError(res, error);
  }
}

export function parseZoneDeliveryJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    log.warn('Invalid zone delivery JSON body', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ZoneDeliveryHttpError('Invalid JSON body');
  }
}
