/**
 * The daily check-in clearance rule.
 *
 * This is the decision that says whether a person is cleared to work, so it is
 * tested exhaustively and directly — no mocks, no query layer, because the rule
 * is a pure function on purpose.
 *
 * The graduated model being pinned here:
 *   BLOCK — self-declared unfit; missing/expired medical WHEN height or plant
 *           work is declared.
 *   WARN  — PPE gaps, hazards, an unverifiable medical, activity without permit.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveClearance,
  requiresMedical,
  medicalDrivingActivities,
  parseActivities,
  type ClearanceInput,
} from '../services/checkinClearance';
import {
  CHECKIN_ACTIVITIES,
  MEDICAL_REQUIRED_ACTIVITIES,
  type CheckinActivity,
} from '../types/checkin.types';

function input(over: Partial<ClearanceInput> = {}): ClearanceInput {
  return {
    fit_for_duty: true,
    ppe_complete: true,
    declared_activities: [],
    medical_status: 'current',
    ...over,
  };
}

describe('deriveClearance — what BLOCKS', () => {
  it('blocks a worker who declares they are not fit for duty', () => {
    const r = deriveClearance(input({ fit_for_duty: false }));
    expect(r.clearance).toBe('blocked');
    expect(r.blocked_reasons).toContain('self_declared_unfit');
  });

  it.each([['expired'], ['missing']] as const)(
    'blocks height work when the medical is %s',
    (status) => {
      const r = deriveClearance(
        input({ declared_activities: ['working_at_heights'], medical_status: status })
      );
      expect(r.clearance).toBe('blocked');
      expect(r.blocked_reasons).toContain('medical_not_current');
    }
  );

  it('reports BOTH reasons when a worker is unfit AND has no medical for height work', () => {
    const r = deriveClearance(
      input({
        fit_for_duty: false,
        declared_activities: ['working_at_heights'],
        medical_status: 'missing',
      })
    );
    expect(r.blocked_reasons).toEqual(
      expect.arrayContaining(['self_declared_unfit', 'medical_not_current'])
    );
    // The H&S officer needs every reason to clear the person properly; showing
    // only the first would let them clear a worker for the wrong thing.
    expect(r.blocked_reasons).toHaveLength(2);
  });
});

describe('deriveClearance — what does NOT block', () => {
  it('does not apply the medical gate to non-height/plant work', () => {
    // Hein's decision: the medical block is for height/plant only. An expired
    // certificate must not stop someone doing ordinary work.
    for (const activity of ['excavation', 'electrical', 'hot_work'] as CheckinActivity[]) {
      const r = deriveClearance(
        input({ declared_activities: [activity], medical_status: 'expired' })
      );
      expect(r.clearance, `${activity} must not be medical-gated`).toBe('cleared');
    }
  });

  it('does not block when no activity is declared, even with no medical on file', () => {
    const r = deriveClearance(input({ declared_activities: [], medical_status: 'missing' }));
    expect(r.clearance).toBe('cleared');
    expect(r.blocked_reasons).toEqual([]);
  });

  it('warns but never blocks on incomplete PPE', () => {
    const r = deriveClearance(input({ ppe_complete: false }));
    expect(r.clearance).toBe('cleared');
    expect(r.warnings).toContain('ppe_incomplete');
  });

  it('warns but never blocks on a reported hazard', () => {
    const r = deriveClearance(input({ hazard_reported: 'Open trench unbarricaded' }));
    expect(r.clearance).toBe('cleared');
    expect(r.warnings).toContain('hazard_reported');
  });

  it('ignores a whitespace-only hazard rather than raising a warning for nothing', () => {
    const r = deriveClearance(input({ hazard_reported: '   ' }));
    expect(r.warnings).not.toContain('hazard_reported');
  });

  it('warns but never blocks an activity with no matching permit', () => {
    const r = deriveClearance(
      input({ declared_activities: ['hot_work'], activities_without_permit: ['hot_work'] })
    );
    expect(r.clearance).toBe('cleared');
    expect(r.warnings).toContain('activity_without_permit');
  });
});

describe('deriveClearance — the unverifiable medical hole, held open deliberately', () => {
  it('warns rather than blocks when the worker cannot be identified', () => {
    // An unregistered crew worker has no id to look a certificate up by.
    // Blocking would punish the identity gap rather than the risk.
    const r = deriveClearance(
      input({ declared_activities: ['working_at_heights'], medical_status: 'unverifiable' })
    );
    expect(r.clearance).toBe('cleared');
    expect(r.blocked_reasons).toEqual([]);
    expect(r.warnings).toContain('medical_unverifiable');
  });

  it('stays silent when an unidentifiable worker declares no height/plant work', () => {
    const r = deriveClearance(
      input({ declared_activities: ['excavation'], medical_status: 'unverifiable' })
    );
    expect(r.warnings).not.toContain('medical_unverifiable');
  });
});

describe('the medical-gated activity set', () => {
  it('gates exactly height, confined space and plant operation', () => {
    expect([...MEDICAL_REQUIRED_ACTIVITIES].sort()).toEqual(
      ['confined_space', 'plant_operation', 'working_at_heights'].sort()
    );
  });

  it('keeps CHECKIN_ACTIVITIES.requires_medical in step with that set', () => {
    // Two places encode the same rule (the config drives the UI, the array
    // drives the decision) — a divergence would show the worker one thing and
    // enforce another.
    const fromConfig = Object.values(CHECKIN_ACTIVITIES)
      .filter((a) => a.requires_medical)
      .map((a) => a.value);
    expect(new Set(fromConfig)).toEqual(new Set(MEDICAL_REQUIRED_ACTIVITIES));
  });

  it('requiresMedical fires on a mixed list containing one gated activity', () => {
    expect(requiresMedical(['excavation', 'hot_work'])).toBe(false);
    expect(requiresMedical(['excavation', 'plant_operation'])).toBe(true);
    expect(medicalDrivingActivities(['excavation', 'plant_operation'])).toEqual(['plant_operation']);
  });
});

describe('parseActivities', () => {
  it('accepts a known list and de-duplicates', () => {
    expect(parseActivities(['hot_work', 'hot_work'])).toEqual(['hot_work']);
  });

  it('treats null/undefined as an empty declaration', () => {
    expect(parseActivities(null)).toEqual([]);
    expect(parseActivities(undefined)).toEqual([]);
  });

  it('rejects unknown codes and non-arrays rather than silently dropping them', () => {
    // Silently dropping an unknown activity would let a caller declare height
    // work with a typo and skip the medical gate entirely.
    expect(parseActivities(['abseiling'])).toBeNull();
    expect(parseActivities('working_at_heights')).toBeNull();
    expect(parseActivities([1, 2])).toBeNull();
  });
});
