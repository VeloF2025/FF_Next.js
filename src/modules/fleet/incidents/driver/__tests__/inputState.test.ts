import { describe, expect, it } from 'vitest';

import { calculateRespondBy, deriveDriverInputState } from '../inputState';

describe('calculateRespondBy', () => {
  it('falls back to Monday-Friday when no scheduled weekdays are supplied', () => {
    // Monday 2026-08-10T08:00:00Z (SAST 10:00) + 2 scheduled workdays, Mon-Fri fallback -> Wednesday end of day SAST.
    const respondBy = calculateRespondBy({
      requestedAt: '2026-08-10T08:00:00.000Z', responseWindowWorkdays: 2, scheduledWeekdays: null,
    });

    expect(respondBy.toISOString()).toBe('2026-08-12T21:59:59.999Z');
  });

  it('falls back to Monday-Friday when the scheduled weekdays array is empty', () => {
    const respondBy = calculateRespondBy({
      requestedAt: '2026-08-10T08:00:00.000Z', responseWindowWorkdays: 2, scheduledWeekdays: [],
    });

    expect(respondBy.toISOString()).toBe('2026-08-12T21:59:59.999Z');
  });

  it('skips days the driver is not scheduled to work', () => {
    // Only Mon/Wed/Fri scheduled. From Monday, the 2nd scheduled workday after is Friday.
    const respondBy = calculateRespondBy({
      requestedAt: '2026-08-10T08:00:00.000Z', responseWindowWorkdays: 2, scheduledWeekdays: [1, 3, 5],
    });

    expect(respondBy.toISOString()).toBe('2026-08-14T21:59:59.999Z');
  });

  it('skips the weekend under the Monday-Friday fallback', () => {
    // Friday late SAST evening -> next scheduled days are Monday and Tuesday.
    const respondBy = calculateRespondBy({
      requestedAt: '2026-08-14T21:30:00.000Z', responseWindowWorkdays: 2, scheduledWeekdays: null,
    });

    expect(respondBy.toISOString()).toBe('2026-08-18T21:59:59.999Z');
  });

  it('resolves the SAST calendar day from the Intl-formatted instant, not a naive UTC truncation', () => {
    // 2026-08-10T22:30:00Z is already 2026-08-11 00:30 SAST (Tuesday) -> +1 scheduled day (Mon-Fri) -> Wednesday.
    const respondBy = calculateRespondBy({
      requestedAt: '2026-08-10T22:30:00.000Z', responseWindowWorkdays: 1, scheduledWeekdays: null,
    });

    expect(respondBy.toISOString()).toBe('2026-08-12T21:59:59.999Z');
  });

  it('rejects a non-positive response window', () => {
    expect(() => calculateRespondBy({ requestedAt: '2026-08-10T08:00:00.000Z', responseWindowWorkdays: 0, scheduledWeekdays: null }))
      .toThrow(RangeError);
    expect(() => calculateRespondBy({ requestedAt: '2026-08-10T08:00:00.000Z', responseWindowWorkdays: -1, scheduledWeekdays: null }))
      .toThrow(RangeError);
  });

  it('rejects an unparsable requestedAt', () => {
    expect(() => calculateRespondBy({ requestedAt: 'not-a-date', responseWindowWorkdays: 1, scheduledWeekdays: null }))
      .toThrow(RangeError);
  });
});

describe('deriveDriverInputState', () => {
  const BASE_REQUEST = { requestedAt: '2026-08-10T08:00:00.000Z', respondBy: '2026-08-12T21:59:59.999Z' };

  it('is not_requested when no request has ever been made', () => {
    expect(deriveDriverInputState({
      now: '2026-08-11T00:00:00.000Z', currentRequest: null, respondedAt: null, incidentTerminalAt: null,
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('not_requested');
  });

  it('stays not_requested even if the incident is terminal, absent any request', () => {
    expect(deriveDriverInputState({
      now: '2026-08-11T00:00:00.000Z', currentRequest: null, respondedAt: null, incidentTerminalAt: '2026-08-11T00:00:00.000Z',
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('not_requested');
  });

  it('is requested while the response window remains open on a non-terminal incident', () => {
    expect(deriveDriverInputState({
      now: '2026-08-11T00:00:00.000Z', currentRequest: BASE_REQUEST, respondedAt: null, incidentTerminalAt: null,
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('requested');
  });

  it('treats the respondBy instant itself as still within the window (inclusive boundary)', () => {
    expect(deriveDriverInputState({
      now: BASE_REQUEST.respondBy, currentRequest: BASE_REQUEST, respondedAt: null, incidentTerminalAt: null,
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('requested');
  });

  it('is expired one millisecond after respondBy while the incident remains active', () => {
    expect(deriveDriverInputState({
      now: '2026-08-12T22:00:00.000Z', currentRequest: BASE_REQUEST, respondedAt: null, incidentTerminalAt: null,
      postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('expired');
  });

  it('is responded once a submission lands at or after the current request', () => {
    expect(deriveDriverInputState({
      now: '2026-08-11T00:00:00.000Z', currentRequest: BASE_REQUEST, respondedAt: '2026-08-10T09:00:00.000Z',
      incidentTerminalAt: null, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('responded');
  });

  it('stays responded even after the incident later becomes terminal', () => {
    expect(deriveDriverInputState({
      now: '2026-08-20T00:00:00.000Z', currentRequest: BASE_REQUEST, respondedAt: '2026-08-10T09:00:00.000Z',
      incidentTerminalAt: '2026-08-13T00:00:00.000Z', postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('responded');
  });

  it('is closed when the incident is terminal, response policy has no post-closure window, and no response was received', () => {
    expect(deriveDriverInputState({
      now: '2026-08-13T00:00:00.000Z', currentRequest: BASE_REQUEST, respondedAt: null,
      incidentTerminalAt: '2026-08-11T00:00:00.000Z', postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('closed');
  });

  it('stays requested inside an enabled post-closure response window', () => {
    expect(deriveDriverInputState({
      now: '2026-08-13T00:00:00.000Z', currentRequest: BASE_REQUEST, respondedAt: null,
      incidentTerminalAt: '2026-08-12T00:00:00.000Z', postClosureResponseEnabled: true, postClosureResponseWindowDays: 3,
    })).toBe('requested');
  });

  it('becomes closed once the post-closure response window elapses', () => {
    expect(deriveDriverInputState({
      now: '2026-08-16T00:00:01.000Z', currentRequest: BASE_REQUEST, respondedAt: null,
      incidentTerminalAt: '2026-08-12T00:00:00.000Z', postClosureResponseEnabled: true, postClosureResponseWindowDays: 3,
    })).toBe('closed');
  });

  it('reflects only the current (superseding) request, ignoring a response recorded against a prior request', () => {
    // The repository only ever passes the latest non-superseded request; a submission that
    // predates it must not be mistaken for a response to the new one.
    const newerRequest = { requestedAt: '2026-08-14T08:00:00.000Z', respondBy: '2026-08-18T21:59:59.999Z' };

    expect(deriveDriverInputState({
      now: '2026-08-15T00:00:00.000Z', currentRequest: newerRequest, respondedAt: null,
      incidentTerminalAt: null, postClosureResponseEnabled: false, postClosureResponseWindowDays: 0,
    })).toBe('requested');
  });
});
