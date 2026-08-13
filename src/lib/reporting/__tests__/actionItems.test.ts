/**
 * Action items are meeting content — descriptions extracted verbatim from transcripts.
 * FibreFlow gates meetings on ATTENDANCE, so these tests exist mainly to prove this
 * report cannot become a way around that.
 */
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
  it('restricts a normal caller to meetings they attended', () => {
    // Verified live: owner 5,049 items; Johan 716; someone who attended nothing 0.
    const { sql, params } = actionItemsQuery(OPEN, { isOwner: false, email: 'Johan@Velocityfibre.co.za' });
    expect(sql).toContain('FROM meetings m');
    expect(sql).toContain("LOWER(p->>'email')");
    // Lower-cased before binding, because participants[].email is compared lower-cased.
    expect(params).toContain('johan@velocityfibre.co.za');
  });

  it('gives the owner unconditional access, as the meeting routes do', () => {
    const { sql } = actionItemsQuery(OPEN, { isOwner: true, email: 'owner@x.com' });
    expect(sql).not.toContain('FROM meetings m');
  });

  it('scopes the create/close rate too, not just the list', () => {
    // Reading the whole table for the flow figures would leak organisation-wide volume
    // to a caller entitled to two meetings.
    const { sql } = actionItemsQuery(OPEN, { isOwner: false, email: 'a@b.com' });
    const flow = sql.slice(sql.indexOf('flow AS ('), sql.indexOf('by_assignee AS ('));
    expect(flow).toContain('FROM scoped');
    expect(flow).not.toContain('FROM action_items');
  });

  it('fails closed: an item whose meeting cannot be resolved is withheld', () => {
    // 164 items carry no meeting_id and 263 meetings record no participants. EXISTS is
    // false for both, so they are excluded rather than shown to everyone.
    const { sql } = actionItemsQuery(OPEN, { isOwner: false, email: 'a@b.com' });
    expect(sql).toContain('m.id = a.meeting_id');
    expect(sql).toContain("COALESCE(m.participants, '[]'::jsonb)");
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

  it('says a per-person total is a floor when the name is fragmented', () => {
    // One person appears as "Lew Hofmeyr", "Lew Hofmeyr - Velo", "Lew", "Llewellyn".
    const r = shapeActionItems(row({ matched: '262', distinct_assignees: '4' }), true);
    expect(r.caveats.join(' ')).toContain('4 different spellings');
    expect(r.caveats.join(' ')).toContain('floor');
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
