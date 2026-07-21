import { describe, it, expect } from 'vitest';
import { eligibleSlotsForRow, type ScorableRow } from '../worksQaScoreEligibility';

function row(overrides: Partial<ScorableRow>): ScorableRow {
  return {
    id: 'r1',
    civil_step_01_key: null, civil_step_02_key: null, civil_step_03_key: null, civil_step_04_key: null,
    civil_step_05_key: null, civil_step_06_key: null, civil_step_07_key: null, civil_step_08_key: null,
    optical_dome_01_key: null, optical_dome_02_key: null, optical_dome_03_key: null, optical_dome_04_key: null,
    optical_dome_05_key: null, optical_dome_06_key: null, optical_dome_07_key: null, optical_dome_08_key: null,
    main_joint_11_key: null, main_joint_12_key: null, main_joint_13_key: null,
    main_joint_14_key: null, main_joint_15_key: null, main_joint_16_key: null,
    vlm_results: {}, slot_approvals: null,
    civil_approved: false, dome_approved: false, joint_approved: false,
    ...overrides,
  };
}

describe('eligibleSlotsForRow', () => {
  it('includes a slot with a photo and no score and no human decision', () => {
    const r = row({ civil_step_01_key: 'k1' });
    expect(eligibleSlotsForRow(r)).toEqual([{ slotKey: 'civil_01', photoKey: 'k1' }]);
  });
  it('excludes a slot without a photo', () => {
    expect(eligibleSlotsForRow(row({}))).toEqual([]);
  });
  it('excludes an already-scored slot (entry has boolean valid)', () => {
    const r = row({ civil_step_01_key: 'k1', vlm_results: { civil_01: { valid: true, confidence: 0.9, feedback: '' } } });
    expect(eligibleSlotsForRow(r)).toEqual([]);
  });
  it('includes a slot whose entry is a pending marker (scored:false, no valid)', () => {
    const r = row({ civil_step_01_key: 'k1', vlm_results: { civil_01: { scored: false } as never } });
    expect(eligibleSlotsForRow(r)).toEqual([{ slotKey: 'civil_01', photoKey: 'k1' }]);
  });
  it('excludes a slot with a per-slot human decision', () => {
    const r = row({ civil_step_01_key: 'k1', slot_approvals: { civil_01: { decision: 'approved', by: 'u', at: 't' } } });
    expect(eligibleSlotsForRow(r)).toEqual([]);
  });
  it('excludes all civil slots when the civil discipline is human-approved', () => {
    const r = row({ civil_step_01_key: 'k1', civil_approved: true });
    expect(eligibleSlotsForRow(r)).toEqual([]);
  });
  it('excludes dome slots when dome_approved, main_joint slots when joint_approved', () => {
    const dome = row({ optical_dome_01_key: 'd1', dome_approved: true });
    expect(eligibleSlotsForRow(dome)).toEqual([]);
    const mj = row({ main_joint_11_key: 'm1', joint_approved: true });
    expect(eligibleSlotsForRow(mj)).toEqual([]);
  });
});
