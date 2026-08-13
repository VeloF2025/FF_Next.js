/**
 * Tests for the action-item list query builder.
 *
 * The point of extracting this from the route was to make the generated SQL inspectable.
 * These assert the properties that decide whether the gate holds: the visibility clause is
 * always present and always first, every user value is bound rather than interpolated, and
 * no filter can widen the result.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { buildActionItemListQuery, MAX_ROWS, type ActionItemListFilters } from '../listQuery';
import type { ActionItemAccess } from '../meetingAccess';

const USER: ActionItemAccess = {
  isOwner: false,
  email: 'johan@velocityfibre.co.za',
  userId: '11111111-1111-4111-8111-111111111111',
};
const OWNER: ActionItemAccess = { isOwner: true, email: '', userId: '' };

function built(filters: ActionItemListFilters, access: ActionItemAccess = USER) {
  const result = buildActionItemListQuery(filters, access);
  if ('error' in result) throw new Error(`unexpected rejection: ${result.error}`);
  return result;
}

beforeEach(() => vi.stubEnv('FF_OWNER_EMAILS', 'hein@velocityfibre.co.za'));
afterEach(() => vi.unstubAllEnvs());

describe('buildActionItemListQuery', () => {
  it('always emits a WHERE whose first clause is the visibility predicate', () => {
    for (const filters of [{}, { status: 'pending' }, { search: 'x' }, { overdue: 'true' }]) {
      const { text } = built(filters);
      const where = text.slice(text.indexOf('WHERE '));
      expect(where).toContain('jsonb_array_elements');
      // First, so every AND that follows narrows it.
      expect(where.indexOf('jsonb_array_elements')).toBeLessThan(
        where.indexOf('\n      AND ') === -1 ? Infinity : where.indexOf('\n      AND '),
      );
    }
  });

  it('composes filters with AND, never OR, at the top level of the WHERE', () => {
    // The mutation that defeated the previous test suite was a join(' AND ') -> join(' OR ').
    // Here it would attach every filter as an alternative to the gate, returning everything.
    const { text } = built({ status: 'pending', priority: 'high', search: 'cable' });
    const where = text.slice(text.indexOf('WHERE '), text.indexOf('ORDER BY'));
    const depth = (i: number) =>
      where.slice(0, i).split('(').length - where.slice(0, i).split(')').length;
    const topLevelOr = [...where.matchAll(/\bOR\b/g)].filter((m) => depth(m.index!) === 0);
    expect(topLevelOr).toHaveLength(0);
    expect(where).toContain('\n      AND ');
  });

  it('binds every user-supplied value instead of interpolating it', () => {
    const nasty = "' OR 1=1 --";
    const { text, params } = built({
      search: nasty,
      assignee_name: nasty,
      source_type: nasty,
      priority: nasty,
      project_id: nasty,
    });
    expect(text).not.toContain('1=1');
    expect(text).not.toContain(nasty);
    expect(params.filter((p) => String(p).includes('1=1')).length).toBeGreaterThan(0);
  });

  it('escapes LIKE metacharacters so a bare % matches nothing rather than everything', () => {
    const { params } = built({ search: '%' });
    expect(params).toContain('%\\%%');
  });

  it('escapes a backslash before the wildcards it protects', () => {
    // Escaping % and _ but not \ leaves `\%` meaning "literal percent" — the escape the
    // caller supplied, not the one we added.
    const { params } = built({ search: '\\' });
    expect(params).toContain('%\\\\%');
  });

  it('compares enum columns as text so an unknown value returns nothing, not a 500', () => {
    const { text } = built({ priority: 'not-a-priority', status: 'nonsense' });
    expect(text).toContain('ai.priority::text =');
    expect(text).toContain('ai.status::text = ANY(');
  });

  it('rejects a non-numeric meeting_id rather than dropping the filter', () => {
    // Number.parseInt('abc') is NaN; silently discarding it widened the result from one
    // meeting to every meeting the caller can see.
    const result = buildActionItemListQuery({ meeting_id: 'abc' }, USER);
    expect('error' in result).toBe(true);
  });

  it('splits and trims a comma-separated status list', () => {
    const { params } = built({ status: 'pending, in_progress' });
    expect(params).toContainEqual(['pending', 'in_progress']);
  });

  it('caps the result set at a pinned value', () => {
    // Pinning the NUMBER, not just the interpolation. `toContain(`LIMIT ${MAX_ROWS}`)`
    // is a tautology — it asserts the template substitutes, so raising MAX_ROWS to 100000
    // left it green and the cap silently gone.
    expect(MAX_ROWS).toBe(100);
    expect(built({}).text).toContain('LIMIT 100');
  });

  it('emits every filter it was given', () => {
    // Deleting the project_id branch entirely used to survive the suite. Filter loss only
    // widens within the caller's own scope, never past the gate — but it silently answers
    // a different question than the one asked.
    const { text } = built({
      project_id: '11111111-1111-4111-8111-111111111111',
      assigned_to_user_id: '22222222-2222-4222-8222-222222222222',
      source_type: 'meeting',
    });
    expect(text).toContain('ai.project_id =');
    expect(text).toContain('ai.assigned_to_user_id =');
    expect(text).toContain('ai.source_type =');
  });

  describe('repeated query parameters', () => {
    // Next delivers `?x=a&x=b` as string[]. Typing these as `string` was a lie the runtime
    // punished: .split/.replace threw a 500 from a URL anyone can construct, and `overdue`
    // compared an array to 'true', dropped the filter and returned the whole backlog.
    it('does not throw on a repeated string filter', () => {
      expect(() => built({ status: ['pending', 'completed'] })).not.toThrow();
      expect(() => built({ search: ['a', 'b'] })).not.toThrow();
      expect(() => built({ assignee_name: ['a', 'b'] })).not.toThrow();
    });

    it('takes the first value, keeping the filter narrowing', () => {
      const { params } = built({ status: ['pending', 'completed'] });
      expect(params).toContainEqual(['pending']);
    });

    it('still applies overdue when the parameter repeats', () => {
      const { text } = built({ overdue: ['true', 'true'] });
      expect(text).toContain('ai.due_date < NOW()');
    });

    it('treats an empty repeated parameter as absent rather than as an empty string', () => {
      const { text } = built({ source_type: [] });
      expect(text).not.toContain('ai.source_type =');
    });
  });

  describe('meeting_id parsing', () => {
    // Number.parseInt prefix-parses: '1abc', '1 OR 1=1', '1.9' and '1e999' all yielded 1,
    // so the filter answered a different question than the caller asked while the test
    // name claimed non-numeric input was rejected.
    it.each(['abc', '1abc', '1 OR 1=1', '1.9', '0x10', '', ' ', '-1', '1e999'])(
      'rejects %j',
      (value) => {
        const result = buildActionItemListQuery({ meeting_id: value }, USER);
        if (value === '') {
          // Only the empty string is falsy and so means "no filter" — the pre-existing
          // contract. A whitespace-only value is a malformed one and is rejected.
          expect('error' in result).toBe(false);
        } else {
          expect('error' in result).toBe(true);
        }
      },
    );

    it('accepts a plain integer', () => {
      const { params } = built({ meeting_id: '266213' });
      expect(params).toContain(266213);
    });
  });

  it('gives the owner a TRUE gate and binds nothing for it', () => {
    const { text, params } = built({}, OWNER);
    expect(text).toContain('WHERE TRUE');
    expect(params).toHaveLength(0);
  });

  it('still gates the owner query when filters are present', () => {
    const { text } = built({ status: 'pending' }, OWNER);
    expect(text).toContain('WHERE TRUE');
    expect(text).toContain('ai.status::text = ANY(');
  });

  it('numbers placeholders contiguously from 1 with no gaps or repeats', () => {
    // An off-by-one here binds a filter value into the visibility clause — the gate would
    // then test the wrong string and silently match nothing or everything.
    const { text, params } = built({
      status: 'pending',
      priority: 'high',
      search: 'x',
      assignee_name: 'y',
      source_type: 'meeting',
    });
    const used = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    expect(new Set(used).size).toBe(params.length);
    expect(Math.min(...used)).toBe(1);
    expect(Math.max(...used)).toBe(params.length);
  });

  it('applies overdue as one grouped clause, not two loose ones', () => {
    // Unparenthesised `a AND b` appended to an OR-composed list would rebind the gate.
    const { text } = built({ overdue: 'true' });
    expect(text).toContain("(ai.due_date < NOW() AND ai.status::text <> 'completed')");
  });
});
