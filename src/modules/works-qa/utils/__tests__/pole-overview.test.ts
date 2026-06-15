import { describe, it, expect } from 'vitest';
import { computePoleSummary, type PoleOverviewRow } from '../pole-overview';
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
    slot_approvals: null,
    ...overrides,
  };
}

describe('computePoleSummary — per-slot dot states', () => {
  it('empty slot → empty; filled VLM-clean slot → pass (faint green)', () => {
    const s = computePoleSummary(row({ present_slots: ['civil_01'] }));
    expect(s.civil_slots[0]).toBe('pass');   // civil_01 present, no fail/approval
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
});

describe('computePoleSummary — status', () => {
  it('no photos → empty', () => {
    expect(computePoleSummary(row()).status).toBe('empty');
  });

  it('some photos → in_progress', () => {
    expect(computePoleSummary(row({ present_slots: CIVIL_KEYS })).status).toBe('in_progress');
  });

  it('all slots + tray + zero VLM failures → ready', () => {
    expect(computePoleSummary(row({ present_slots: ALL_KEYS, tray_count: 2 })).status).toBe('ready');
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
