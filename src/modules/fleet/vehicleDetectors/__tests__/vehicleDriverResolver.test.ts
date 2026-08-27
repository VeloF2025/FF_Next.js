/**
 * Driver attribution's boundary rules.
 *
 * Attribution decides who a manager can ask about an incident and whose `/my`
 * portal it appears on, so "close enough" is the wrong answer twice over: a
 * driver who was on leave gets asked to explain someone else's accident, and
 * the driver who was actually behind the wheel never sees it.
 *
 * Every fixture here is one of the TWO shapes production actually holds, because
 * every close path writes the flag and the end date in one statement:
 *
 *   open    `{ assignmentEnd: null }`          — the current driver (22 rows)
 *   closed  `{ assignmentEnd: '<date>' }`      — a past driver (41 rows)
 *
 * An "inactive but open-ended" row does not exist, and a rule that keyed on the
 * flag would make every date bound below unreachable — dropping all 41 closed
 * rows and with them every historical attribution.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resolveVehicleDriver, selectDriverAssignmentAt } from '../vehicleDriverResolver';
import type { VehicleDriverAssignment } from '../types';

const VEHICLE = 'a1a1a1a1-1111-4111-8111-111111111111';

/** The open row: current driver, no end date. */
function open(overrides: Partial<VehicleDriverAssignment> = {}): VehicleDriverAssignment {
  return {
    assignmentId: 'assignment-open', staffId: 'staff-1', staffName: 'Jane Driver',
    assignmentStart: '2026-08-01', assignmentEnd: null, ...overrides,
  };
}

/** The closed row: a past driver, both dates present. */
function closed(overrides: Partial<VehicleDriverAssignment> = {}): VehicleDriverAssignment {
  return {
    assignmentId: 'assignment-closed', staffId: 'staff-0', staffName: 'Past Driver',
    assignmentStart: '2026-03-03', assignmentEnd: '2026-04-30', ...overrides,
  };
}

describe('selectDriverAssignmentAt', () => {
  it('picks the open assignment for an event after its start', () => {
    expect(selectDriverAssignmentAt([open()], '2026-08-18')?.staffId).toBe('staff-1');
  });

  it('attributes an event inside a CLOSED assignment to that past driver', () => {
    // The whole point of reading history. A live example: one vehicle carries
    // `2026-03-03 → 2026-04-30` closed and `2026-04-30` open. An event on the
    // 25th of March belongs to the closed row's driver, and a rule that skipped
    // closed rows would answer "nobody" for it.
    const rows = [open({ assignmentStart: '2026-04-30' }), closed()];
    expect(selectDriverAssignmentAt(rows, '2026-03-25')?.staffId).toBe('staff-0');
  });

  it('includes the first and last day of a closed assignment — both ends are inclusive', () => {
    expect(selectDriverAssignmentAt([closed()], '2026-03-03')?.staffId).toBe('staff-0');
    expect(selectDriverAssignmentAt([closed()], '2026-04-30')?.staffId).toBe('staff-0');
  });

  it('gives the HANDOVER DAY to the incoming driver — the day-granularity cost', () => {
    // A handover writes the leaving driver's end date and the incoming driver's
    // start date as the SAME day, so both rows cover it. The table cannot say
    // who held the keys at 09:00; the newest start is the most recent statement
    // about who drives this vehicle, so the incoming driver gets that day. Named
    // in `.claude/modules/fleet.md` as a known cost, not papered over.
    const rows = [open({ assignmentStart: '2026-04-30' }), closed()];
    expect(selectDriverAssignmentAt(rows, '2026-04-30')?.staffId).toBe('staff-1');
  });

  it('returns null for an event the day BEFORE the assignment starts', () => {
    // The boundary that makes `<=` vs `<` observable: an incident from the day
    // before a handover belongs to nobody this table names, and the next driver
    // must not inherit it.
    expect(selectDriverAssignmentAt([open({ assignmentStart: '2026-08-18' })], '2026-08-17')).toBeNull();
  });

  it('returns null for an event the day AFTER a closed assignment ended and before the next began', () => {
    const gap = [closed({ assignmentEnd: '2026-04-30' }), open({ assignmentStart: '2026-06-17' })];
    expect(selectDriverAssignmentAt(gap, '2026-05-01')).toBeNull();
  });

  it('picks the NEWEST start when two assignments both cover the event', () => {
    // Deliberately listed oldest-first so "return the first covering row"
    // returns the wrong driver.
    const older = closed({ assignmentId: 'old', staffId: 'staff-old', staffName: 'Old Driver', assignmentStart: '2026-08-01', assignmentEnd: '2026-08-20' });
    const newer = open({ assignmentId: 'new', staffId: 'staff-new', staffName: 'New Driver', assignmentStart: '2026-08-15' });
    expect(selectDriverAssignmentAt([older, newer], '2026-08-18')?.staffId).toBe('staff-new');
    expect(selectDriverAssignmentAt([newer, older], '2026-08-18')?.staffId).toBe('staff-new');
  });

  it('returns null when the vehicle has no assignments at all', () => {
    // Two of the eighteen tracked vehicles are in this position today.
    expect(selectDriverAssignmentAt([], '2026-08-18')).toBeNull();
  });
});

describe('resolveVehicleDriver', () => {
  it('folds the event instant to its SAST calendar date, not its UTC one', async () => {
    // 22:30 UTC on the 17th is 00:30 on the 18th in Johannesburg, and the
    // assignment starts on the 18th. A UTC-dated comparison attributes this to
    // nobody.
    const load = vi.fn(async () => [open({ assignmentStart: '2026-08-18' })]);
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-17T22:30:00.000Z', load)).resolves.toEqual({
      staffId: 'staff-1', staffName: 'Jane Driver',
    });
    expect(load).toHaveBeenCalledWith(VEHICLE);
  });

  it('returns the driver and the name snapshot together', async () => {
    const load = vi.fn(async () => [open()]);
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-18T19:00:00.000Z', load)).resolves.toEqual({
      staffId: 'staff-1', staffName: 'Jane Driver',
    });
  });

  it('returns null — the pre-attribution behaviour — when nothing covers the instant', async () => {
    const load = vi.fn(async () => [closed({ assignmentStart: '2026-07-01', assignmentEnd: '2026-08-01' })]);
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-18T19:00:00.000Z', load)).resolves.toBeNull();
  });

  it('swallows a failing lookup: attribution is lost, the incident is not', async () => {
    const load = vi.fn(async () => { throw new Error('connection terminated'); });
    await expect(resolveVehicleDriver(VEHICLE, '2026-08-18T19:00:00.000Z', load)).resolves.toBeNull();
  });
});
