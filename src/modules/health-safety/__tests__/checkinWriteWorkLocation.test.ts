/**
 * createCheckin — work_location column.
 *
 * Migration 504 added hs_daily_checkins.work_location NOT NULL, and made
 * project_id nullable only for an office declaration (the DB CHECK rejects a
 * null project on a site row).
 *
 * This pins createCheckin's INSERT by POSITION, not by membership: the
 * statement names 24 columns, and `values` holds nine nulls, so asserting that
 * the array merely contains 'office' or null would pass for a site row and
 * would survive a transposition of any two columns. The indices below are the
 * column order in checkinWrite.ts — checkin_date, project_id, work_location.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));

vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sqlMock),
  neonConfig: { fetchConnectionCache: false },
}));

import { createCheckin, type CreateCheckinInput } from '../services/checkinWrite';

function baseInput(over: Partial<CreateCheckinInput> = {}): CreateCheckinInput {
  return {
    checkinDate: '2026-08-20',
    projectId: '11111111-1111-4111-8111-111111111111',
    workLocation: 'site',
    contractorId: null,
    staffId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    teamMemberId: null,
    workerName: 'Test Worker',
    captureMode: 'self',
    submissionId: '22222222-2222-4222-8222-222222222222',
    submittedByStaffId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
    signatureName: 'Test Worker',
    fitForDuty: true,
    ppeComplete: true,
    declaredActivities: [],
    hazardReported: null,
    activitiesWithoutPermit: [],
    clearance: 'cleared',
    blockedReasons: [],
    gpsLat: null,
    gpsLon: null,
    attendanceEntryId: null,
    riskRegisterId: null,
    createdBy: null,
    ...over,
  };
}

/**
 * Reconstruct the SQL text and the positional values from the tagged-template
 * call the writer makes, the way the neon() driver sees it.
 */
async function captureInsert(over: Partial<CreateCheckinInput>) {
  sqlMock.mockImplementation(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.reduce(
        (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
        ''
      );
      return Promise.resolve([{ id: 'row', text, values }]);
    }
  );
  const row = (await createCheckin(baseInput(over))) as unknown as {
    text: string;
    values: unknown[];
  };
  return row;
}

describe('createCheckin — work_location', () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it('writes work_location and a null project for an office row', async () => {
    const captured = await captureInsert({ workLocation: 'office', projectId: null });
    expect(captured.text).toMatch(/work_location/);
    expect(captured.values[0]).toBe('2026-08-20');
    expect(captured.values[1]).toBeNull();
    expect(captured.values[2]).toBe('office');
  });

  it('writes the project for a site row', async () => {
    const captured = await captureInsert({
      workLocation: 'site',
      projectId: '11111111-1111-4111-8111-111111111111',
    });
    expect(captured.values[1]).toBe('11111111-1111-4111-8111-111111111111');
    expect(captured.values[2]).toBe('site');
  });
});
