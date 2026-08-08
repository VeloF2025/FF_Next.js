import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import type {
  PonStateRow,
  ZoneAggregate,
  ZoneStateRow,
} from '../../repositories/zoneDeliveryReadRepository';
import type { ConfirmMilestoneInput, PonMilestone } from '../../types/zoneDelivery.types';
import { ZoneDeliveryError } from '../zoneDeliveryErrors';
import { validateMilestoneConfirmation } from '../zoneDeliveryMilestoneActions';

const PON_STAGE_ID = '22222222-2222-4222-8222-222222222222';

/**
 * Only the civil/optical gates query the DB (construction_qa_reviews). No rows
 * means "not approved", which is what a legacy PON with no QA record looks like.
 */
const client = { query: async () => ({ rows: [] }) } as unknown as PoolClient;

const pon = (over: Partial<PonStateRow> = {}): PonStateRow => ({
  pon_stage_id: PON_STAGE_ID,
  pon_no: 191,
  scope_status: 'included',
  civil_qa_approved: false,
  optical_qa_approved: false,
  row_version: 1,
  civil_complete_at: null,
  optical_complete_at: null,
  testing_passed_at: null,
  port_submitted_at: null,
  port_approved_at: null,
  technically_live_at: null,
  testing_test_pack_document_id: null,
  ...over,
} as unknown as PonStateRow);

const zone = (over: Partial<ZoneStateRow> = {}): ZoneStateRow => ({
  scope_approved_at: '2026-07-01T00:00:00.000Z',
  handed_over_at: null,
  row_version: 1,
  ...over,
} as unknown as ZoneStateRow);

const aggregate = (): ZoneAggregate => ({
  documents: [],
  snagLinks: [],
} as unknown as ZoneAggregate);

const input = (milestone: PonMilestone): ConfirmMilestoneInput => ({
  projectId: '33333333-3333-4333-8333-333333333333',
  zoneNo: 17,
  ponStageId: PON_STAGE_ID,
  milestone,
  action: 'confirm',
  effectiveAt: '2026-08-05T00:00:00.000Z',
  source: 'works-qa',
  expectedRowVersion: 1,
} as ConfirmMilestoneInput);

const run = (milestone: PonMilestone, overrideAllowed: boolean, state = pon()) =>
  validateMilestoneConfirmation(
    client, input(milestone), zone(), state, state, aggregate(), null, overrideAllowed,
  );

describe('validateMilestoneConfirmation — prerequisite override', () => {
  it('blocks Submit PON on a legacy PON without an override', async () => {
    await expect(run('port_submitted', false)).rejects.toThrow(ZoneDeliveryError);
    await expect(run('port_submitted', false)).rejects.toThrow(/Testing must pass first/i);
  });

  it('allows Submit PON when the override is authorised', async () => {
    // Johan's case: the zone was delivered before FibreFlow tracked the site,
    // so testing_passed will never exist for it.
    await expect(run('port_submitted', true)).resolves.toBeTruthy();
  });

  it('STILL blocks testing_passed with no test pack, even when overriding', async () => {
    // The sequence blocker (PON_OPTICAL_INCOMPLETE) is reported first; waiving
    // it must not confirm testing with no evidence behind it.
    await expect(run('testing_passed', true)).rejects.toThrow(/test pack/i);
    // The code, not just the text — callers branch on it.
    await expect(run('testing_passed', true)).rejects.toMatchObject({
      code: 'EVIDENCE_REQUIRED',
    });
  });

  it('STILL blocks optical_complete with no optical QA, even when overriding', async () => {
    await expect(run('optical_complete', true)).rejects.toThrow(/optical construction QA/i);
    await expect(run('optical_complete', true)).rejects.toMatchObject({
      code: 'EVIDENCE_REQUIRED',
    });
  });

  it('reports a sequencing block as PREREQUISITE_BLOCKED, not EVIDENCE_REQUIRED', async () => {
    await expect(run('port_submitted', false)).rejects.toMatchObject({
      code: 'PREREQUISITE_BLOCKED',
    });
  });

  it('does not run the gate check at all for a correction (current already set)', async () => {
    // `current` non-null means this is a re-confirmation; prerequisites are not
    // re-litigated, which is pre-existing behaviour this change must preserve.
    const state = pon();
    await expect(validateMilestoneConfirmation(
      client, input('port_submitted'), zone(), state, state, aggregate(),
      '2026-07-01T00:00:00.000Z', false,
    )).resolves.toBeTruthy();
  });

  it('defaults to no override when the argument is omitted', async () => {
    const state = pon();
    await expect(validateMilestoneConfirmation(
      client, input('port_submitted'), zone(), state, state, aggregate(), null,
    )).rejects.toThrow(/Testing must pass first/i);
  });
});
