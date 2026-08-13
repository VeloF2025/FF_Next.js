/**
 * Tests for the meeting-search filter and query builder.
 *
 * The row-level guarantee — that a caller sees exactly the meetings they attended — is
 * proven by execution in tests/db/action-items/visibility.lifecycle.test.ts. Asserting on
 * query text cannot establish it; widening mutations preserve the text. What is tested
 * here is the input handling: what the route accepts, rejects, and binds.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  MAX_MEETINGS,
  meetingsQuery,
  parseMeetingFilter,
  shapeMeetings,
  type MeetingRow,
} from '../meetings';
import type { ActionItemAccess } from '@/lib/actionItems/meetingAccess';

const USER: ActionItemAccess = {
  isOwner: false,
  email: 'johan@velocityfibre.co.za',
  userId: '11111111-1111-4111-8111-111111111111',
};
const OWNER: ActionItemAccess = { isOwner: true, email: '', userId: '' };

function filter(query: Record<string, string | string[] | undefined> = {}) {
  const parsed = parseMeetingFilter(query);
  if ('error' in parsed) throw new Error(`unexpected rejection: ${parsed.error}`);
  return parsed.filter;
}

beforeEach(() => vi.stubEnv('FF_OWNER_EMAILS', 'hein@velocityfibre.co.za'));
afterEach(() => vi.unstubAllEnvs());

describe('parseMeetingFilter', () => {
  it.each(['not-a-date', '2026-7-1', '01-01-2026', "2026-07-01'; DROP TABLE meetings", '2026-07-01T00:00:00'])(
    'rejects %j as a date',
    (value) => {
      expect('error' in parseMeetingFilter({ since: value })).toBe(true);
      expect('error' in parseMeetingFilter({ until: value })).toBe(true);
    },
  );

  it('accepts an ISO date', () => {
    expect(filter({ since: '2026-07-01' }).since).toBe('2026-07-01');
  });

  it('defaults limit to the ceiling rather than to 1', () => {
    // `Number('')` is 0 and `|| 1` patterns yield 1 — a limit of 1 reads to a model as
    // "there is only one meeting", which is a false statement rather than a small answer.
    expect(filter({}).limit).toBe(MAX_MEETINGS);
    expect(filter({ limit: '' }).limit).toBe(MAX_MEETINGS);
  });

  it('clamps an oversized limit to the ceiling', () => {
    expect(filter({ limit: '999999' }).limit).toBe(MAX_MEETINGS);
  });

  it('rejects a non-integer limit instead of silently defaulting', () => {
    expect('error' in parseMeetingFilter({ limit: 'abc' })).toBe(true);
    expect('error' in parseMeetingFilter({ limit: '-5' })).toBe(true);
  });

  it('distinguishes withTranscript=false from unset', () => {
    expect(filter({ withTranscript: 'false' }).withTranscript).toBe(false);
    expect(filter({ withTranscript: 'true' }).withTranscript).toBe(true);
    expect(filter({}).withTranscript).toBeUndefined();
  });

  it('rejects a withTranscript value that is neither', () => {
    expect('error' in parseMeetingFilter({ withTranscript: 'yes' })).toBe(true);
  });

  it('takes the first value of a repeated parameter rather than throwing', () => {
    expect(filter({ search: ['a', 'b'] }).search).toBe('a');
    expect(filter({ since: ['2026-07-01', '2026-08-01'] }).since).toBe('2026-07-01');
  });
});

describe('meetingsQuery', () => {
  it('gates on attendance before any filter', () => {
    const { sql } = meetingsQuery(filter(), USER);
    const where = sql.slice(sql.indexOf('WHERE '));
    expect(where).toContain('jsonb_array_elements');
  });

  it('binds the email rather than interpolating it', () => {
    const { sql, params } = meetingsQuery(filter(), USER);
    expect(sql).not.toContain('johan@velocityfibre.co.za');
    expect(params).toContain('johan@velocityfibre.co.za');
  });

  it('does NOT match on participant name or displayName', () => {
    // pages/api/meetings.ts grants access on a name string too. Two active accounts share
    // the name "hein van vuuren", and 1,613 meetings carry a participant whose name is ''.
    const { sql } = meetingsQuery(filter(), USER);
    expect(sql).not.toContain("p_acc->>'name'");
    expect(sql).not.toContain("displayName");
  });

  it('gives the owner TRUE and binds nothing for the gate', () => {
    const { sql, params } = meetingsQuery(filter(), OWNER);
    expect(sql).toContain('WHERE TRUE');
    expect(params).toHaveLength(0);
  });

  it('escapes LIKE metacharacters in the title search', () => {
    const { params } = meetingsQuery(filter({ search: '%' }), USER);
    expect(params).toContain('%\\%%');
  });

  it('includes the whole of the until day', () => {
    // `<= until` would drop every meeting after midnight on that date.
    const { sql } = meetingsQuery(filter({ until: '2026-07-31' }), USER);
    expect(sql).toContain('::date + 1');
    expect(sql).not.toMatch(/meeting_date\s*<=/);
  });

  it('composes filters with AND and no top-level OR', () => {
    const { sql } = meetingsQuery(filter({ search: 'x', since: '2026-01-01' }), USER);
    const where = sql.slice(sql.indexOf('WHERE '), sql.indexOf('      )'));
    const depth = (i: number) =>
      where.slice(0, i).split('(').length - where.slice(0, i).split(')').length;
    expect([...where.matchAll(/\bOR\b/g)].filter((m) => depth(m.index!) === 0)).toHaveLength(0);
  });
});

describe('shapeMeetings', () => {
  const row = (over: Partial<MeetingRow & { total_matched: number }> = {}) => ({
    id: 1,
    title: 'Handover',
    meeting_date: new Date(2026, 6, 15),
    duration: 30,
    source: 'teams',
    participant_count: 4,
    has_transcript: true,
    has_summary: true,
    action_item_count: 2,
    total_matched: 1,
    ...over,
  });

  it('formats the date from local parts, not toISOString', () => {
    // A midnight timestamp rendered with toISOString() lands on the previous day in SAST.
    expect(shapeMeetings([row()], filter(), false).meetings[0].date).toBe('2026-07-15');
  });

  it('tells a scoped caller that absence is not evidence', () => {
    const caveats = shapeMeetings([row()], filter(), false).caveats.join(' ');
    expect(caveats).toContain('absence says nothing');
  });

  it('does not tell the owner their view is scoped', () => {
    const caveats = shapeMeetings([row()], filter(), true).caveats.join(' ');
    expect(caveats).not.toContain('absence says nothing');
  });

  it('says so when the list is truncated', () => {
    const caveats = shapeMeetings([row({ total_matched: 900 })], filter(), true).caveats.join(' ');
    expect(caveats).toContain('900');
  });

  it('warns that a meeting with no transcript cannot answer content questions', () => {
    const caveats = shapeMeetings([row({ has_transcript: false })], filter(), true).caveats.join(' ');
    expect(caveats).toContain('no transcript');
  });

  it('reports zero matched without inventing a total', () => {
    const report = shapeMeetings([], filter(), false);
    expect(report.meetings).toEqual([]);
    expect(report.matched.value).toBe(0);
  });
});
