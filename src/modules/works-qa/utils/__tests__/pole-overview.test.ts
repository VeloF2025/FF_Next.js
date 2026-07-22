import { describe, it, expect } from 'vitest';
import { computePoleSummary, plantedOnlyPoleSummary, type PoleOverviewRow } from '../pole-overview';
import { SLOT_META } from '../slot-keys';

const ALL_KEYS = SLOT_META.map(s => s.key);
const CIVIL_KEYS = SLOT_META.filter(s => s.discipline === 'civil').map(s => s.key);

function row(overrides: Partial<PoleOverviewRow> = {}): PoleOverviewRow {
  return {
    id: 'p1',
    pole_label: 'MAM.P.A137',
    zone_no: 6,
    pon_no: 74,
    approved_at: null,
    tray_count: 0,
    unassigned_count: 0,
    outstanding_snag_count: 0,
    has_open_verification_snag: false,
    has_verified_planted: false,
    present_slots: [],
    vlm_fail_keys: [],
    scored_slots: [],
    slot_approvals: null,
    ...overrides,
  };
}

describe('computePoleSummary — per-slot dot states', () => {
  it('empty slot → empty; filled VLM-clean scored slot → pass (faint green)', () => {
    const s = computePoleSummary(row({ present_slots: ['civil_01'], scored_slots: ['civil_01'] }));
    expect(s.civil_slots[0]).toBe('pass');   // civil_01 present, scored, no fail/approval
    expect(s.civil_slots[1]).toBe('empty');  // civil_02 absent
  });

  it('human approval beats a VLM failure on the same slot → approved (strong green)', () => {
    const s = computePoleSummary(row({
      present_slots: ['civil_01'],
      vlm_fail_keys: ['civil_01'],
      slot_approvals: { civil_01: { decision: 'approved', by: 'u', at: 't' } },
    }));
    expect(s.civil_slots[0]).toBe('approved');
  });

  it('human snag beats a VLM pass on the same slot → fail (red)', () => {
    const s = computePoleSummary(row({
      present_slots: ['civil_01'],
      slot_approvals: { civil_01: { decision: 'snagged', by: 'u', at: 't' } },
    }));
    expect(s.civil_slots[0]).toBe('fail');
  });

  it('un-overridden VLM failure with no human decision → fail (red)', () => {
    const s = computePoleSummary(row({ present_slots: ['dome_03'], vlm_fail_keys: ['dome_03'] }));
    const idx = SLOT_META.filter(x => x.discipline === 'dome').findIndex(x => x.key === 'dome_03');
    expect(s.dome_slots[idx]).toBe('fail');
  });

  it('marks a present-but-unscored slot as pending, not pass', () => {
    expect(computePoleSummary(row({ present_slots: ['civil_01'] })).civil_slots[0]).toBe('pending');
  });

  it('marks a scored-valid slot as pass', () => {
    expect(computePoleSummary(row({ present_slots: ['civil_01'], scored_slots: ['civil_01'] })).civil_slots[0]).toBe('pass');
  });

  it('marks a scored-invalid slot as fail', () => {
    expect(computePoleSummary(row({ present_slots: ['civil_01'], vlm_fail_keys: ['civil_01'], scored_slots: ['civil_01'] })).civil_slots[0]).toBe('fail');
  });

  it('human approval/snag still wins over pending', () => {
    const approved = row({ present_slots: ['civil_01'], slot_approvals: { civil_01: { decision: 'approved', by: 'x', at: 't' } } });
    expect(computePoleSummary(approved).civil_slots[0]).toBe('approved');
    const snagged = row({ present_slots: ['civil_01'], slot_approvals: { civil_01: { decision: 'snagged', by: 'x', at: 't' } } });
    expect(computePoleSummary(snagged).civil_slots[0]).toBe('fail');
  });

  it('pending slots are not counted as vlm_failures', () => {
    expect(computePoleSummary(row({ present_slots: ['civil_01', 'civil_02'] })).vlm_failures).toBe(0);
  });

  it('a fully-photographed pole is NOT ready while any slot is still unscored', () => {
    // ALL_KEYS present + tray but scored_slots empty → pending, so not "ready".
    expect(computePoleSummary(row({ present_slots: ALL_KEYS, tray_count: 2 })).status).toBe('in_progress');
  });
});

describe('computePoleSummary — status', () => {
  it('no photos → empty', () => {
    expect(computePoleSummary(row()).status).toBe('empty');
  });

  it('some photos → in_progress', () => {
    expect(computePoleSummary(row({ present_slots: CIVIL_KEYS })).status).toBe('in_progress');
  });

  it('all slots + tray + zero VLM failures → ready', () => {
    expect(computePoleSummary(row({ present_slots: ALL_KEYS, tray_count: 2, scored_slots: ALL_KEYS })).status).toBe('ready');
  });

  it('an approved-but-unscored slot does not block ready (human approval resolves it)', () => {
    const s = computePoleSummary(row({
      present_slots: ALL_KEYS,
      tray_count: 2,
      scored_slots: ALL_KEYS.filter(k => k !== 'civil_01'), // civil_01 present but never scored
      slot_approvals: { civil_01: { decision: 'approved', by: 'x', at: 't' } },
    }));
    expect(s.status).toBe('ready');
  });

  it('all slots filled but a VLM failure remains → in_progress (not ready)', () => {
    const s = computePoleSummary(row({ present_slots: ALL_KEYS, tray_count: 1, vlm_fail_keys: ['civil_05'] }));
    expect(s.status).toBe('in_progress');
  });

  it('outstanding snag outranks ready/in_progress → snagged', () => {
    const s = computePoleSummary(row({ present_slots: ALL_KEYS, tray_count: 1, outstanding_snag_count: 2 }));
    expect(s.status).toBe('snagged');
  });

  it('approved_at set outranks everything → approved', () => {
    const s = computePoleSummary(row({ approved_at: '2026-06-15T08:00:00Z', outstanding_snag_count: 3 }));
    expect(s.status).toBe('approved');
  });
});

describe('computePoleSummary — photo count', () => {
  it('total_photos includes slot photos, trays and unassigned', () => {
    const s = computePoleSummary(row({
      present_slots: ['civil_01', 'civil_02', 'dome_01'], // 3 slotted
      tray_count: 2,
      unassigned_count: 4,
    }));
    expect(s.total_photos).toBe(3 + 2 + 4);
    expect(s.unassigned_count).toBe(4);
    expect(s.civil_filled).toBe(2);
    expect(s.dome_filled).toBe(1);
  });

  it('unassigned-only pole: counts toward total but stays empty (not progress)', () => {
    // Photos uploaded but none assigned to a slot — Johan still wants to see
    // them in the count, but they must not advance QA status.
    const s = computePoleSummary(row({ present_slots: [], tray_count: 0, unassigned_count: 3 }));
    expect(s.total_photos).toBe(3);
    expect(s.unassigned_count).toBe(3);
    expect(s.status).toBe('empty');
  });
});

describe('computePoleSummary — photographed flag', () => {
  it('marks computed rows as having photos', () => {
    expect(computePoleSummary(row()).has_photos).toBe(true);
  });
});

describe('plantedOnlyPoleSummary — field-planted, no QA photos', () => {
  const planted = plantedOnlyPoleSummary({
    pole_number: 'MOA.P.F107',
    zone_no: 15,
    pon_no: 223,
    field_status: 'Pole Planted/ All Photos',
  });

  it('status is planted with no photos and a synthetic, non-uuid id', () => {
    expect(planted.status).toBe('planted');
    expect(planted.has_photos).toBe(false);
    expect(planted.id).toBe('planted:MOA.P.F107');
    expect(planted.field_status).toBe('Pole Planted/ All Photos');
  });

  it('all dots empty and zero counts (nothing to QA yet)', () => {
    expect(planted.civil_slots).toHaveLength(8);
    expect(planted.dome_slots).toHaveLength(8);
    expect(planted.joint_slots).toHaveLength(6);
    expect([...planted.civil_slots, ...planted.dome_slots, ...planted.joint_slots].every(s => s === 'empty')).toBe(true);
    expect(planted.total_photos).toBe(0);
    expect(planted.outstanding_snag_count).toBe(0);
  });
});
