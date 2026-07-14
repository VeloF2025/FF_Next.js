import { describe, it, expect } from 'vitest';
import { resolveSlotKey, domeLabelToPole } from '@/modules/works-qa/services/syncQfieldCore';

// Pure mapping functions in the sync core. These now run on the unattended cron
// path (scripts/works-qa-sync.ts --all-active), where a silent mapping regression
// would write bad data to the shared prod DB on a schedule — so they're gated here.

describe('resolveSlotKey', () => {
  it('maps civil steps 1-8 to civil slots (non-optical work_type)', () => {
    expect(resolveSlotKey(1, 'pole_installation')).toBe('civil_01');
    expect(resolveSlotKey(8, 'pole_installation')).toBe('civil_08');
  });

  it('treats a null work_type as civil', () => {
    expect(resolveSlotKey(3, null)).toBe('civil_03');
  });

  it('maps optical dome steps 1-8 to dome slots', () => {
    expect(resolveSlotKey(1, 'dome_joint')).toBe('dome_01');
    expect(resolveSlotKey(8, 'optical')).toBe('dome_08');
  });

  it('maps optical joint steps 11-16 to main_joint slots', () => {
    expect(resolveSlotKey(11, 'dome_joint')).toBe('main_joint_11');
    expect(resolveSlotKey(16, 'joint')).toBe('main_joint_16');
  });

  it('returns null for a null checklist_step', () => {
    expect(resolveSlotKey(null, 'pole_installation')).toBeNull();
  });

  it('returns null for an out-of-range step', () => {
    expect(resolveSlotKey(9, 'pole_installation')).toBeNull(); // no civil step 9
    expect(resolveSlotKey(9, 'dome_joint')).toBeNull(); // optical has 1-8, 11-16, not 9
  });
});

describe('domeLabelToPole', () => {
  it('extracts the pole label from a dome/splice label', () => {
    expect(domeLabelToPole('MAM.STS.16.DIS.DM.P.A352-C2P11.L5')).toBe('MAM.P.A352');
  });

  it('stops the pole segment at the first non-alphanumeric char', () => {
    expect(domeLabelToPole('LAW.STS.03.DIS.DM.P.B100-X')).toBe('LAW.P.B100');
  });

  it('accepts non-STS discipline segments (AGG / FTS)', () => {
    expect(domeLabelToPole('ETW.AGG.DM.P.H275')).toBe('ETW.P.H275');
    expect(domeLabelToPole('ETW.FTS.16.AGG.DM.P.H328-O')).toBe('ETW.P.H328');
  });

  it('passes a bare pole label straight through (Lawley/Mohadin key optical by pole)', () => {
    expect(domeLabelToPole('LAW.P.B078')).toBe('LAW.P.B078');
    expect(domeLabelToPole('MOA.P.A032')).toBe('MOA.P.A032');
    expect(domeLabelToPole('MAM.P.A352')).toBe('MAM.P.A352');
  });

  it('returns null for a dome-on-manhole label (.DM.MH. — not pole-attached)', () => {
    expect(domeLabelToPole('TEM.FTS.8.AGG.DM.MH.A058-OLT.02.C4P16')).toBeNull();
  });

  it('returns null for a null label', () => {
    expect(domeLabelToPole(null)).toBeNull();
  });

  it('returns null for corrupt / placeholder labels', () => {
    expect(domeLabelToPole('New pole')).toBeNull();
    expect(domeLabelToPole('LAW.S.A133')).toBeNull(); // .S. splice, not a pole
    expect(domeLabelToPole('random-string')).toBeNull();
  });
});
