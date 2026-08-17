/**
 * Action items are meeting content — descriptions extracted verbatim from transcripts.
 * FibreFlow gates meetings on ATTENDANCE, so these tests exist mainly to prove this
 * report cannot become a way around that.
 */
import { actionItemVisibility } from '@/lib/actionItems/meetingAccess';
import { describe, expect, it } from 'vitest';

import { actionItemsQuery, parseActionFilter, shapeActionItems, type ActionItemsRow } from '../actionItems';

const OPEN = { state: 'open' as const, limit: 25 };

function row(over: Partial<ActionItemsRow> = {}): ActionItemsRow {
  return {
    matched: '0', unassigned: '0', over_30d: '0', over_90d: '0',
    distinct_assignees: '0', oldest: null, created_30d: '0', completed_30d: '0',
    by_assignee: null, by_source: null, oldest_items: null, ...over,
  };
}

describe('attendance scoping', () => {
  it('delegates to the shared visibility module rather than carrying its own copy', () => {
    // Asserts DELEGATION, not SQL text. Two independently-maintained visibility rules over
    // action_items is how they drift — they had already reached 528 vs 200 rows for one
    // real user before being converged. If someone re-inlines a predicate here, the
    // generated clause stops matching the module's and this fails.
    //
    // The substantive proof that the predicate returns the right ROWS lives in
    // tests/db/action-items/visibility.lifecycle.test.ts, which executes it. Asserting on
    // query text cannot establish it: three separate widening mutations preserve every
    // substring while returning the whole table.
    const { sql, params } = actionItemsQuery(OPEN, { isOwner: false, email: 'Johan@Velocityfibre.co.za' });

    const expectedParams: unknown[] = [];
    const expectedClause = actionItemVisibility(
      { isOwner: false, email: 'johan@velocityfibre.co.za', userId: '' },
      expectedParams,
      'a',
      { meetingsOnly: true },
    );
    expect(sql).toContain(expectedClause);
    // Lower-cased before binding, because participants[].email is compared lower-cased.
    expect(params).toContain('johan@velocityfibre.co.za');
    expect(expectedParams).toEqual(['johan@velocityfibre.co.za']);
  });

  it('scopes on attendance ALONE — not the wider rule the HTTP routes use', () => {
    // The browser routes also grant access by assignment and to items with no meeting.
    // This report deliberately does not: its payload is verbatim meeting content sent to
    // an agent, and a procurement row belongs in no meeting report.
    const { sql } = actionItemsQuery(OPEN, { isOwner: false, email: 'a@b.com' });
    expect(sql).not.toContain('a.meeting_id IS NULL');
    expect(sql).not.toContain('assignee_email');
    expect(sql).not.toContain('assigned_to_user_id =');
  });

  it('gives the owner unconditional access, as the meeting routes do', () => {
    const { sql } = actionItemsQuery(OPEN, { isOwner: true, email: 'owner@x.com' });
    expect(sql).not.toContain('FROM meetings m_acc');
  });

  it('access-scopes the create/close rate without state-scoping it', () => {
    // Two failure modes, opposite directions. Reading the whole table leaks
    // organisation-wide volume. Reading `scoped` excludes completed rows on the default
    // state=open path, so completed_30d is structurally zero and the report claims
    // "none recorded as completed" while 53 were.
    const { sql } = actionItemsQuery(OPEN, { isOwner: false, email: 'a@b.com' });
    const flow = sql.slice(sql.indexOf('flow AS ('), sql.indexOf('by_assignee AS ('));
    expect(flow).toContain('FROM action_items a');
    expect(flow).toContain('EXISTS');            // access predicate present
    expect(flow).not.toContain("<> 'completed'"); // state filter absent
  });

  it('joins the WHERE with AND — an OR would match every row', () => {
    // Changing the join to OR turns the clause into `1=1 OR EXISTS(...)`, which matched
    // ALL 5,227 items for a caller entitled to 716. Substring assertions on the presence
    // of the predicate cannot see that, because the predicate is still present.
    const { sql } = actionItemsQuery(
      { ...OPEN, assignee: 'x', source: 'transcript' },
      { isOwner: false, email: 'a@b.com' },
    );
    const whereClause = sql.slice(sql.indexOf('WHERE 1=1'), sql.indexOf('      ),'));
    expect(whereClause).not.toMatch(/\bOR\b\s+EXISTS/);
    expect(whereClause).not.toMatch(/1=1\s+OR/);
    // Each additional filter must NARROW: every one is AND-joined.
    expect(whereClause.match(/\bAND\b/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('fails closed: an item whose meeting cannot be resolved is withheld', () => {
    // 164 items carry no meeting_id and 263 meetings record no participants. EXISTS is
    // false for both, so they are excluded rather than shown to everyone.
    const { sql } = actionItemsQuery(OPEN, { isOwner: false, email: 'a@b.com' });
    expect(sql).toContain('m_acc.id = a.meeting_id');
    expect(sql).toContain("COALESCE(m_acc.participants, '[]'::jsonb)");
  });

  it('tells a scoped caller that the totals are theirs, not the organisation\'s', () => {
    expect(shapeActionItems(row(), false, false).caveats.join(' ')).toContain('meetings you attended');
    expect(shapeActionItems(row(), false, true).caveats.join(' ')).not.toContain('meetings you attended');
  });
});

describe('reading the backlog honestly', () => {
  it('names machine extraction rather than implying broken promises', () => {
    const r = shapeActionItems(row({
      matched: '1000',
      by_source: [{ source: 'transcript', count: '900' }, { source: 'manual', count: '100' }],
    }));
    expect(r.caveats.join(' ')).toContain('extracted automatically');
    expect(r.caveats.join(' ')).toContain('not a dropped commitment');
  });

  it('reports the create/close ratio as a pipeline shape, not a delivery measure', () => {
    const r = shapeActionItems(row({ created_30d: '1910', completed_30d: '53' }));
    expect(r.flow.ratio).toBe(36);
    expect(r.flow.note).toContain('not as a measure');
  });

  it('warns that a per-person total is a floor — including on a single match', () => {
    // The single-spelling case is the MOST misleading and used to emit no warning at
    // all: "Llewelyn Hofmeyr" matches one spelling and one item, while the same person
    // carries 255 more under "Lew Hofmeyr", "Lew Hofmeyr - Velo" and "Lew".
    const many = shapeActionItems(row({ matched: '262', distinct_assignees: '4' }), true);
    expect(many.caveats.join(' ')).toContain('4 spellings');
    expect(many.caveats.join(' ')).toContain('floor');

    const one = shapeActionItems(row({ matched: '1', distinct_assignees: '1' }), true);
    expect(one.caveats.join(' ')).toContain('1 spelling');
    expect(one.caveats.join(' ')).toContain('floor');
  });

  it('always states that project and due-date cannot be filtered', () => {
    expect(shapeActionItems(row()).caveats.join(' ')).toContain('Not filterable by project');
  });
});

describe('parseActionFilter', () => {
  it('rejects an unknown state rather than silently widening', () => {
    expect(parseActionFilter({ state: 'everything' })).toHaveProperty('error');
  });

  it('rejects a negative or fractional age window', () => {
    expect(parseActionFilter({ olderThanDays: '-1' })).toHaveProperty('error');
    expect(parseActionFilter({ olderThanDays: '1.5' })).toHaveProperty('error');
    expect(parseActionFilter({ olderThanDays: '0' })).toHaveProperty('filter');
  });

  it('escapes LIKE wildcards in the assignee search', () => {
    const parsed = parseActionFilter({ assignee: '%' });
    expect('filter' in parsed).toBe(true);
    if ('filter' in parsed) {
      const { params } = actionItemsQuery(parsed.filter, { isOwner: true, email: 'o@x.com' });
      expect(params).toContain('%\\%%');
    }
  });
});
