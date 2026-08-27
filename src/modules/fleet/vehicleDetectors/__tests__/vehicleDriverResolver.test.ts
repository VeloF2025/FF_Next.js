/**
 * Driver attribution's boundary rules.
 *
 * Attribution decides who a manager can ask about an incident and whose `/my`
 * portal it appears on, so "close enough" is the wrong answer twice over: a
 * driver who was on leave gets asked to explain someone else's accident, and
 * the driver who was actually behind the wheel never sees it. The four cases
 * below are the whole rule — covered, not yet started, already ended, and more
 * than one — plus the failure direction (null, never a throw).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resolveVehicleDriver, selectDriverAssignmentAt } from '../vehicleDriverResolver';
import type { VehicleDriverAssignment } from '../types';

const VEHICLE = 'a1a1a1a1-1111-4111-8111-111111111111';

function assignment(overrides: Partial<VehicleDriverAssignment> = {}): VehicleDriverAssignment {
  return {
    assignmentId: 'assignment-1', staffId: 'staff-1', staffName: 'Jane Driver',
    isActive: true, assignmentStart: '2026-08-01', assignmentEnd: null, ...overrides,
  };
}

describe('selectDriverAssignmentAt', () => {
  it('picks an open assignment that started before the event date', () => {
    expect(selectDriverAssignmentAt([assignment()], '2026-08-18')?.staffId).toBe('staff-1');
  });

  it('includes the first and last day of the assignment — both ends are inclusive', () => {
    const bounded = assignment({ assignmentStart: '2026-08-18', assignmentEnd: '2026-08-20' });
    expect(selectDriverAssignmentAt([bounded], '2026-08-18')?.staffId).toBe('staff-1');
    expect(selectDriverAssignmentAt([bounded], '2026-08-20')?.staffId).toBe('staff-1');
  });

  it('returns null for an event the day BEFORE the assignment starts', () => {
    // The boundary that makes `<=` vs `<` observable: an incident from the day
    // before a handover belongs to nobody this table names, and the next
    // driver must not inherit it.
    expect(selectDriverAssignmentAt([assignment({ assignmentStart: '2026-08-18' })], '2026-08-17')).toBeNull();
  });

  it('returns null for an event the day AFTER the assignment ended', () => {
    expect(selectDriverAssignmentAt([assignment({ assignmentEnd: '2026-08-17' })], '2026-08-18')).toBeNull();
  });

  it('ignores an assignment flagged inactive even when its dates cover the event', () => {
    expect(selectDriverAssignmentAt([assignment({ isActive: false })], '2026-08-18')).toBeNull();
  });

  it('picks the NEWEST start when two assignments both cover the event', () => {
    // Deliberately listed oldest-first so "return the first covering row"
    // returns the wrong driver.
    const older = assignment({ assignmentId: 'old', staffId: 'staff-old', staffName: 'Old Driver', assignmentStart: '2026-08-01' });
    const newer = assignment({ assignmentId: 'new', staffId: 'staff-new', staffName: 'New Driver', assignmentStart: '2026-08-15' });
    expect(selectDriverAssignmentAt([older, newer], '2026-08-18')?.staffId).toBe('staff-new');
    expect(selectDriverAssignmentAt([newer, older], '2026-08-18')?.staffId).toBe('staff-new');
  });

  it('returns null when the vehicle has no assignments at all', () => {
    expect(selectDriverAssignmentAt([], '2026-08-18')).toBeNull();
  });
});

describe('resolveVehicleDriver', () => {
  it('folds the event instant to its SAST calendar date, not its UTC one', async () => {
    // 22:30 UTC on the 17th is 00:30 on the 18th in Johannesburg, and the
    // assignment starts on the 18th. A UTC-dated comparison attributes this to
    // nobody.
    const load = vi.fn(async () => [assignment({ assignmentStart: '2026-08-18' })]);
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-17T22:30:00.000Z', load)).resolves.toEqual({
      staffId: 'staff-1', staffName: 'Jane Driver',
    });
    expect(load).toHaveBeenCalledWith(VEHICLE);
  });

  it('returns the driver and the name snapshot together', async () => {
    const load = vi.fn(async () => [assignment()]);
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-18T19:00:00.000Z', load)).resolves.toEqual({
      staffId: 'staff-1', staffName: 'Jane Driver',
    });
  });

  it('returns null — the pre-attribution behaviour — when nothing covers the instant', async () => {
    const load = vi.fn(async () => [assignment({ assignmentEnd: '2026-08-01' })]);
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-18T19:00:00.000Z', load)).resolves.toBeNull();
  });

  it('swallows a failing lookup: attribution is lost, the incident is not', async () => {
    const load = vi.fn(async () => { throw new Error('connection terminated'); });
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-18T19:00:00.000Z', load)).resolves.toBeNull();
  });
});
