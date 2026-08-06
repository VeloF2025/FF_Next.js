import { describe, it, expect } from 'vitest';
import {
  countDry, nextChunk, parseDateArg, resumeCommand, shouldContinue,
} from '../backfillPlan';

const DAY = 24 * 60 * 60 * 1000;
const MAX = 31 * DAY;
const NOW = new Date('2026-08-05T12:00:00.000Z');

describe('parseDateArg', () => {
  it('accepts a plain date and an ISO timestamp', () => {
    expect(parseDateArg('floor', '2024-08-01', NOW).toISOString())
      .toBe('2024-08-01T00:00:00.000Z');
    expect(parseDateArg('to', '2025-11-14T06:30:00.000Z', NOW).toISOString())
      .toBe('2025-11-14T06:30:00.000Z');
  });

  it('rejects an unparseable value by name, instead of a bare RangeError later', () => {
    expect(() => parseDateArg('floor', 'last-august', NOW))
      .toThrow(/--floor=last-august is not a valid date/);
  });

  // The dangerous one: the walk guard `to > floor` is immediately false, so the
  // script used to log "reached configured floor, totalInserted: 0" and exit 0.
  it('rejects a future date rather than exiting successfully having done nothing', () => {
    expect(() => parseDateArg('floor', '2099-01-01', NOW))
      .toThrow(/--floor=2099-01-01 is in the future/);
  });
});

describe('nextChunk', () => {
  const floor = new Date('2024-08-01T00:00:00.000Z');

  it('steps back by the provider maximum when there is room', () => {
    const to = new Date('2026-08-05T00:00:00.000Z');
    const { from } = nextChunk(to, floor, MAX);
    expect(to.getTime() - from.getTime()).toBe(MAX);
  });

  it('clamps the last chunk at the floor rather than overshooting it', () => {
    const to = new Date(floor.getTime() + 5 * DAY);
    const { from } = nextChunk(to, floor, MAX);
    expect(from).toEqual(floor);
  });

  // If `from` could ever equal `to`, the caller's `to = from` assignment would
  // stop making progress and the walk would spin forever against the portal.
  it('always moves strictly backwards while above the floor', () => {
    let to = new Date('2026-08-05T00:00:00.000Z');
    for (let i = 0; i < 40 && to > floor; i++) {
      const { from } = nextChunk(to, floor, MAX);
      expect(from.getTime()).toBeLessThan(to.getTime());
      to = from;
    }
    expect(to).toEqual(floor);
  });

  it('covers the range with no gap between consecutive chunks', () => {
    const start = new Date('2026-08-05T00:00:00.000Z');
    const first = nextChunk(start, floor, MAX);
    const second = nextChunk(first.from, floor, MAX);
    expect(second.to).toEqual(first.from);
  });
});

describe('shouldContinue', () => {
  const floor = new Date('2024-08-01T00:00:00.000Z');

  it('stops exactly at the floor, not one chunk past it', () => {
    expect(shouldContinue(floor, floor, 0, 2)).toBe(false);
    expect(shouldContinue(new Date(floor.getTime() + 1), floor, 0, 2)).toBe(true);
  });

  it('stops once the dry-chunk limit is reached', () => {
    const above = new Date('2026-01-01T00:00:00.000Z');
    expect(shouldContinue(above, floor, 1, 2)).toBe(true);
    expect(shouldContinue(above, floor, 2, 2)).toBe(false);
  });
});

describe('countDry', () => {
  it('counts consecutive empty chunks', () => {
    expect(countDry(0, 0)).toBe(1);
    expect(countDry(1, 0)).toBe(2);
  });

  // Retention is a run of empties, not a total: a single populated chunk after
  // a quiet month means the account still has history further back.
  it('resets on any chunk that returned data', () => {
    expect(countDry(1, 7)).toBe(0);
  });
});

describe('resumeCommand', () => {
  it('emits a command that carries both the floor and the cursor', () => {
    const cmd = resumeCommand(
      'netstar',
      new Date('2024-08-01T00:00:00.000Z'),
      new Date('2025-11-14T00:00:00.000Z')
    );
    expect(cmd).toBe(
      'npx tsx scripts/backfill-tracking.ts --provider=netstar'
      + ' --floor=2024-08-01T00:00:00.000Z --to=2025-11-14T00:00:00.000Z'
    );
  });
});
