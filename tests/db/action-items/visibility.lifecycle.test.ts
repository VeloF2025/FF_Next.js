/**
 * Action-item visibility against REAL Postgres.
 *
 * These tests exist because the unit suite cannot see the failures that matter. Mutation
 * testing during review proved it: three separate one-line edits to
 * `actionItemVisibility` — pushing an extra `TRUE` arm, dropping the sub-select
 * correlation `m_acc.id = ai.meeting_id`, and replacing the participant match with
 * `p_acc->>'email' IS NOT NULL` — each left all 27 unit tests green while taking a caller
 * from their own 527 rows to the entire 5,231-row table.
 *
 * Every one of those mutations preserves the generated SQL's substrings and its
 * parenthesis depth, so no amount of asserting on the query TEXT can catch them. The only
 * assertion that can is executing the predicate and comparing the row set it actually
 * returns. That needs a database, which is why this file lives here and not beside the
 * module.
 *
 * The fixtures are deliberately tiny and hand-checkable: three meetings, one attendee
 * each, and items covering every arm of the rule plus the rows that must stay invisible.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import {
  actionItemVisibility,
  type ActionItemAccess,
} from '@/lib/actionItems/meetingAccess';
import { buildActionItemListQuery } from '@/lib/actionItems/listQuery';
import { meetingsQuery, parseMeetingFilter, shapeMeetings } from '@/lib/reporting/meetings';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

const alice: ActionItemAccess = { isOwner: false, email: 'alice@example.com', userId: ALICE };
const bob: ActionItemAccess = { isOwner: false, email: 'bob@example.com', userId: BOB };
const owner: ActionItemAccess = { isOwner: true, email: '', userId: '' };

describe('action item visibility (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    // A dedicated schema, first on the search_path, holding tables named EXACTLY as
    // production names them. That is what lets the tests below execute the shipped query
    // text verbatim — no find-and-replace on the SQL under test, which would be evidence
    // about a rewritten string rather than about the query the route actually sends.
    // It also keeps the shared `public` seed untouched for the other suites in this
    // container.
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      options: '-c search_path=ai_vis,public',
    });

    await pool.query(`
      DROP SCHEMA IF EXISTS ai_vis CASCADE;
      CREATE SCHEMA ai_vis;

      CREATE TABLE ai_vis.meetings (
        id             INT PRIMARY KEY,
        participants   JSONB,
        title          TEXT,
        meeting_date   TIMESTAMP,
        transcript_url TEXT,
        raw_transcript TEXT,
        summary        JSONB,
        duration       INT,
        source         TEXT
      );

      CREATE TABLE ai_vis.users (
        id              UUID PRIMARY KEY,
        first_name      TEXT,
        last_name       TEXT,
        profile_picture TEXT
      );

      CREATE TABLE ai_vis.action_items (
        id                  TEXT PRIMARY KEY,
        meeting_id          INT,
        assignee_email      TEXT,
        assigned_to_user_id UUID,
        description         TEXT,
        assignee_name       TEXT,
        status              TEXT,
        priority            TEXT,
        due_date            TIMESTAMP,
        completed_date      TIMESTAMP,
        mentioned_at        TIMESTAMP,
        created_at          TIMESTAMP DEFAULT NOW(),
        updated_at          TIMESTAMP,
        tags                TEXT,
        notes               TEXT,
        source_type         TEXT,
        source_id           TEXT,
        project_id          UUID,
        category            TEXT
      );

      INSERT INTO ai_vis.users (id, first_name, last_name) VALUES
        ('${ALICE}', 'Alice', 'A'),
        ('${BOB}',   'Bob',   'B');

      INSERT INTO ai_vis.meetings (id, participants, title, meeting_date, raw_transcript, source) VALUES
        (1, '[{"email":"alice@example.com","name":"Alice A"}]'::jsonb, 'Alice handover', '2026-07-10', 'said things', 'teams'),
        (2, '[{"email":"bob@example.com","name":""}]'::jsonb,          'Bob meeting',    '2026-07-20 14:30', NULL,          'teams'),
        (3, NULL,                                                       'No participants','2026-07-30', NULL,          'teams');

      INSERT INTO ai_vis.action_items (id, meeting_id, assignee_email, assigned_to_user_id, source_type) VALUES
        ('alice-attended',    1,    NULL,                NULL,      'meeting'),
        ('bob-attended',      2,    NULL,                NULL,      'meeting'),
        ('null-participants', 3,    NULL,                NULL,      'meeting'),
        ('assigned-email',    2,    'alice@example.com', NULL,      'meeting'),
        ('assigned-userid',   2,    NULL,                '${ALICE}','meeting'),
        ('assigned-mixcase',  2,    'ALICE@Example.com', NULL,      'meeting'),
        ('no-meeting',        NULL, NULL,                NULL,      'procurement');
    `);
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS ai_vis CASCADE;');
    await pool.end();
  });

  async function visibleTo(access: ActionItemAccess, opts = {}): Promise<string[]> {
    const params: unknown[] = [];
    const clause = actionItemVisibility(access, params, 'ai', opts);
    const { rows } = await pool.query(
      `SELECT ai.id FROM action_items ai WHERE ${clause} ORDER BY ai.id`,
      params,
    );
    return rows.map((r) => r.id as string);
  }

  it('shows Alice exactly the rows that are hers, and nothing else', async () => {
    // The whole point: an EXACT set, not a count and not a substring. Every widening
    // mutation that survived the unit suite changes this list.
    expect(await visibleTo(alice)).toEqual([
      'alice-attended',
      'assigned-email',
      'assigned-mixcase',
      'assigned-userid',
      'no-meeting',
    ]);
  });

  it('does not leak Bob\'s meeting to Alice', async () => {
    const seen = await visibleTo(alice);
    expect(seen).not.toContain('bob-attended');
  });

  it('shows Bob his own meeting and not Alice\'s', async () => {
    // The three `assigned-*` rows sit in Bob's meeting on purpose — that is what makes
    // them prove Alice reaches them by ASSIGNMENT rather than attendance. Bob reaches the
    // same rows the ordinary way, by having been in the meeting. What he must not see is
    // Alice's meeting.
    expect(await visibleTo(bob)).toEqual([
      'assigned-email',
      'assigned-mixcase',
      'assigned-userid',
      'bob-attended',
      'no-meeting',
    ]);
    expect(await visibleTo(bob)).not.toContain('alice-attended');
  });

  it('withholds a meeting whose participants are NULL from everyone but the owner', async () => {
    // COALESCE makes it unmatchable rather than an error — failing closed.
    expect(await visibleTo(alice)).not.toContain('null-participants');
    expect(await visibleTo(bob)).not.toContain('null-participants');
    expect(await visibleTo(owner)).toContain('null-participants');
  });

  it('gives the owner every row', async () => {
    expect(await visibleTo(owner)).toHaveLength(7);
  });

  it('matches a participant email case-insensitively on both sides', async () => {
    expect(await visibleTo(alice)).toContain('assigned-mixcase');
  });

  it('correlates the sub-select to the row — attending ANY meeting is not enough', async () => {
    // Dropping `m_acc.id = ai.meeting_id` degenerates the EXISTS into "does this user
    // attend any meeting at all", which returns the entire table. Alice attends meeting 1,
    // so under that mutation she would also see bob-attended and null-participants.
    const seen = await visibleTo(alice);
    expect(seen).not.toContain('bob-attended');
    expect(seen).not.toContain('null-participants');
    expect(seen).toHaveLength(5);
  });

  it('requires a real email match — mere presence of an email is not enough', async () => {
    // Replacing the comparison with `p_acc->>'email' IS NOT NULL` would let Alice see
    // every item whose meeting has any participant at all.
    expect(await visibleTo(alice)).not.toContain('bob-attended');
  });

  describe('writes are stricter than reads', () => {
    it('lets Alice READ an item that belongs to no meeting', async () => {
      expect(await visibleTo(alice)).toContain('no-meeting');
    });

    it('does NOT let Alice EDIT or DELETE it', async () => {
      // 319 of the 324 real rows in this class are procurement items that carry an
      // assignee, so they stay editable by the person responsible; what this closes is
      // every user having destructive rights over rows they have no relation to.
      expect(await visibleTo(alice, { forWrite: true })).not.toContain('no-meeting');
    });

    it('still lets the assignee write to their own item', async () => {
      const forWrite = await visibleTo(alice, { forWrite: true });
      expect(forWrite).toContain('assigned-email');
      expect(forWrite).toContain('assigned-userid');
    });
  });

  describe('the composed list query', () => {
    async function listFor(access: ActionItemAccess, filters = {}): Promise<string[]> {
      const b = buildActionItemListQuery(filters, access);
      if ('error' in b) throw new Error(b.error);
      // The shipped query text, executed UNCHANGED except for the two enum casts —
      // status and priority are enums in production and plain text in these fixtures.
      const text = b.text
        .replace(/ai\.status::text/g, 'ai.status')
        .replace(/ai\.priority::text/g, 'ai.priority');
      const { rows } = await pool.query(text, b.params);
      return rows.map((r) => r.id as string).sort();
    }

    it('returns the gated set through the full query, joins and all', async () => {
      // The `m_acc` sub-select sits inside a query that already joins `meetings m`. If the
      // aliases collided, the correlated sub-select would resolve against the outer row
      // and match everything.
      expect(await listFor(alice)).toEqual([
        'alice-attended',
        'assigned-email',
        'assigned-mixcase',
        'assigned-userid',
        'no-meeting',
      ]);
    });

    it('narrows, never widens, when a filter is applied', async () => {
      const unfiltered = await listFor(alice);
      const filtered = await listFor(alice, { source_type: 'procurement' });
      expect(filtered).toEqual(['no-meeting']);
      expect(filtered.length).toBeLessThan(unfiltered.length);
    });

    it('cannot be widened by a repeated query parameter', async () => {
      // Next delivers `?source_type=a&source_type=b` as an array. Before normalisation
      // this threw a 500; for `overdue` it silently dropped the filter entirely.
      const repeated = await listFor(alice, { source_type: ['procurement', 'meeting'] });
      expect(repeated).toEqual(['no-meeting']);
    });

    it('cannot be widened by SQL injection through a filter', async () => {
      const injected = await listFor(alice, { source_type: "x' OR '1'='1" });
      expect(injected).toEqual([]);
    });
  });

  // NOTE: meeting 2 is at 14:30, not midnight. A meeting at exactly 00:00 satisfies
  // `meeting_date <= until::date` as well as the correct `< until::date + 1`, so a
  // midnight fixture cannot tell the two apart and the until-day test would pass
  // against the broken comparison.
  describe('meeting search (find_meetings)', () => {
    async function found(access: ActionItemAccess, query = {}): Promise<string[]> {
      const parsed = parseMeetingFilter(query);
      if ('error' in parsed) throw new Error(parsed.error);
      const { sql, params } = meetingsQuery(parsed.filter, access);
      const { rows } = await pool.query(sql, params);
      return shapeMeetings(rows as never, parsed.filter, access.isOwner)
        .meetings.map((m) => m.title).sort();
    }

    it('returns only the meetings the caller attended', async () => {
      expect(await found(alice)).toEqual(['Alice handover']);
      expect(await found(bob)).toEqual(['Bob meeting']);
    });

    it('does NOT grant access on a name match, unlike /api/meetings', async () => {
      // pages/api/meetings.ts also matches p->>'name' against the caller's display name.
      // Bob's participant record carries name:"" — under that rule a user whose computed
      // name is '' (the fallback when first/last are absent) matches it. 1,613 real
      // meetings carry such a participant.
      const nameless: ActionItemAccess = { isOwner: false, email: 'nobody@example.com', userId: '' };
      expect(await found(nameless)).toEqual([]);
    });

    it('withholds a meeting whose participants are NULL from everyone but the owner', async () => {
      expect(await found(alice)).not.toContain('No participants');
      expect(await found(owner)).toContain('No participants');
    });

    it('gives the owner every meeting', async () => {
      expect(await found(owner)).toHaveLength(3);
    });

    it('narrows on title search without widening the gate', async () => {
      expect(await found(alice, { search: 'handover' })).toEqual(['Alice handover']);
      // Bob attended no meeting titled "handover" — the search must not reach Alice's.
      expect(await found(bob, { search: 'handover' })).toEqual([]);
    });

    it('treats a bare % as a literal, not a wildcard', async () => {
      expect(await found(alice, { search: '%' })).toEqual([]);
    });

    it('filters on transcript presence', async () => {
      expect(await found(alice, { withTranscript: 'true' })).toEqual(['Alice handover']);
      expect(await found(alice, { withTranscript: 'false' })).toEqual([]);
    });

    it('includes the whole of the until day rather than its midnight', async () => {
      // A meeting at any time on the until date must be included; `<= date` would drop
      // everything after 00:00.
      expect(await found(owner, { since: '2026-07-20', until: '2026-07-20' }))
        .toEqual(['Bob meeting']);
    });
  });
});
