import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import {
  resolveSlotKey,
  domeLabelToPole,
  syncQfieldForProject,
} from '@/modules/works-qa/services/syncQfieldCore';

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

// syncQfieldForProject takes an injected `pg.Pool`, so a plain object with a
// routed `query` mock is enough — no vi.mock('@/lib/db') needed. Each query the
// sync issues is routed by a distinguishing SQL substring:
//   - the qfield_photo_validations SELECT (the one QField row under test)
//   - the `AS col_val` slot-column SELECT (empty, so the upsert path runs)
//   - the `vlm_results = vlm_results ||` UPDATE, whose 2nd bind param (the
//     vlm_results JSON) is captured for assertions
// Anything else (the pole_qa_photos upsert INSERT) gets an empty-rows default.
interface FakeQfieldRow {
  vlm_confidence: number | null;
  checklist_step: number;
  work_type: string;
  feature_type: 'pole' | 'joint';
  feature_id: string;
}

async function runSyncCapturingVlmEntry(row: FakeQfieldRow): Promise<{ vlmEntryJson: string }> {
  let vlmEntryJson: string | undefined;

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('FROM qfield_photo_validations')) {
      return {
        rows: [
          {
            feature_id: row.feature_id,
            feature_type: row.feature_type,
            photo_key: 'HT_X/files/test-photo.jpg',
            checklist_step: row.checklist_step,
            work_type: row.work_type,
            vlm_confidence: row.vlm_confidence,
            vlm_feedback: null,
          },
        ],
      };
    }
    if (sql.includes('AS col_val')) {
      return { rows: [{ col_val: null }] };
    }
    if (sql.includes('vlm_results = vlm_results ||')) {
      vlmEntryJson = params?.[1] as string;
      return { rows: [], rowCount: 1 };
    }
    // pole_qa_photos upsert INSERT (and anything else) — no rows needed.
    return { rows: [], rowCount: 0 };
  });

  await syncQfieldForProject({ query } as unknown as Pool, 'proj-1');

  if (vlmEntryJson === undefined) {
    throw new Error('vlm_results UPDATE was never issued — check the mock query routing');
  }
  return { vlmEntryJson };
}

describe('syncQfieldForProject — vlm_results entry', () => {
  it('writes a pending marker (scored:false, no valid) when upstream confidence is NULL', async () => {
    const captured = await runSyncCapturingVlmEntry({
      vlm_confidence: null,
      checklist_step: 1,
      work_type: 'pole_installation',
      feature_type: 'pole',
      feature_id: 'HT_X_F0001PL',
    });
    const entry = JSON.parse(captured.vlmEntryJson);
    expect(entry.civil_01).toEqual({ scored: false });
  });

  it('writes a scored result (valid + scored:true) when upstream confidence is present', async () => {
    const captured = await runSyncCapturingVlmEntry({
      vlm_confidence: 0.82,
      checklist_step: 1,
      work_type: 'pole_installation',
      feature_type: 'pole',
      feature_id: 'HT_X_F0001PL',
    });
    const entry = JSON.parse(captured.vlmEntryJson);
    expect(entry.civil_01.valid).toBe(true);
    expect(entry.civil_01.confidence).toBe(0.82);
    expect(entry.civil_01.scored).toBe(true);
  });
});
