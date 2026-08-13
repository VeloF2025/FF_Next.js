/**
 * Tests for the action-item list query builder.
 *
 * The point of extracting this from the route was to make the generated SQL inspectable.
 * These assert the properties that decide whether the gate holds: the visibility clause is
 * always present and always first, every user value is bound rather than interpolated, and
 * no filter can widen the result.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { buildActionItemListQuery, MAX_ROWS } from '../listQuery';
import type { ActionItemAccess } from '../meetingAccess';

const USER: ActionItemAccess = {
  isOwner: false,
  email: 'johan@velocityfibre.co.za',
  userId: '11111111-1111-4111-8111-111111111111',
};
const OWNER: ActionItemAccess = { isOwner: true, email: '', userId: '' };

function built(filters: Record<string, string>, access: ActionItemAccess = USER) {
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

  it('caps the result set', () => {
    expect(built({}).text).toContain(`LIMIT ${MAX_ROWS}`);
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
