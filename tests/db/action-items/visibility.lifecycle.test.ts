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
import { meetingForCaller } from '@/lib/actionItems/meetingFetch';

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

      CREATE TABLE ai_vis.meeting_transcripts (meeting_id INT);

      INSERT INTO ai_vis.meetings (id, participants, title, meeting_date, raw_transcript, transcript_url, summary, duration, source) VALUES
        (1, '[{"email":"alice@example.com","name":"Alice A"},{"email":"x@example.com"}]'::jsonb,
            'Alice handover',  '2026-07-10 09:00', 'said things', NULL,        '{"k":1}'::jsonb, 30, 'teams'),
        -- An empty-string participant email: 1,625 live meetings carry one. Binding '' as
        -- the caller's email must NOT match it.
        (2, '[{"email":"bob@example.com","name":""},{"email":""}]'::jsonb,
            'Bob meeting',     '2026-07-20 14:30', NULL,          NULL,        NULL,             60, 'teams'),
        (3, NULL,
            'No participants', '2026-07-30 08:00', NULL,          NULL,        NULL,             15, 'teams'),
        -- transcript_url but no raw_transcript: hasTranscript must still be true.
        (4, '[{"email":"alice@example.com"}]'::jsonb,
            'Url only',        '2026-07-25 10:00', NULL,          'http://t',  'null'::jsonb,    45, 'teams'),
        -- held 22:40 UTC on the 28th = 00:40 SAST on the 29th.
        (5, '[{"email":"alice@example.com"}]'::jsonb,
            'Late evening',    '2026-07-28 22:40', NULL,          NULL,        NULL,             20, 'teams'),
        -- Participant email stored mixed-case: the LOWER() on both sides is load-bearing.
        (6, '[{"email":"Carol@Example.COM"}]'::jsonb,
            'Mixed case',      '2026-07-05 11:00', NULL,          NULL,        NULL,             10, 'teams');

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
    async function report(access: ActionItemAccess, query = {}) {
      const parsed = parseMeetingFilter(query);
      if ('error' in parsed) throw new Error(parsed.error);
      const { sql, params } = meetingsQuery(parsed.filter, access);
      const { rows } = await pool.query(sql, params);
      return shapeMeetings(rows as never, parsed.filter, access.isOwner);
    }

    async function found(access: ActionItemAccess, query = {}): Promise<string[]> {
      return (await report(access, query)).meetings.map((m) => m.title).sort();
    }

    it('returns only the meetings the caller attended', async () => {
      expect(await found(alice)).toEqual(['Alice handover', 'Late evening', 'Url only']);
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
      expect(await found(owner)).toHaveLength(6);
    });

    it('matches a mixed-case participant email', async () => {
      // Dropping LOWER() from either side leaves this the only failing test.
      const carol: ActionItemAccess = { isOwner: false, email: 'carol@example.com', userId: '' };
      expect(await found(carol)).toEqual(['Mixed case']);
    });

    it('reports hasTranscript FALSE for a meeting with nothing captured', async () => {
      // The projection test above only covers a meeting that HAS one, so forcing the flag
      // to TRUE would pass it. This is the assertion that bites.
      const late = (await report(alice, { search: 'Late evening' })).meetings[0];
      expect(late.hasTranscript).toBe(false);
      expect(late.hasSummary).toBe(false);
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
      // 'Url only' has a transcript_url and no raw_transcript — it counts as having one.
      expect(await found(alice, { withTranscript: 'true' })).toEqual(['Alice handover', 'Url only']);
      expect(await found(alice, { withTranscript: 'false' })).toEqual(['Late evening']);
    });

    it('includes the whole of the until day rather than its midnight', async () => {
      // A meeting at any time on the until date must be included; `<= date` would drop
      // everything after 00:00.
      expect(await found(owner, { since: '2026-07-20', until: '2026-07-20' }))
        .toEqual(['Bob meeting']);
    });

    // The row SET being right says nothing about the row CONTENTS. Mapping only titles
    // left every projected column — the flags, the counts, the ordering and the LIMIT —
    // unverified, so corrupting any of them passed both suites.
    it('projects each field correctly, not just the right rows', async () => {
      const { meetings } = await report(owner, { search: 'Alice handover' });
      expect(meetings).toEqual([
        {
          id: 1,
          title: 'Alice handover',
          date: '2026-07-10',
          durationMinutes: 30,
          source: 'teams',
          participants: 2,
          hasTranscript: true,
          hasSummary: true,
          actionItems: 1,
        },
      ]);
    });

    it('counts action items PER MEETING, not globally', async () => {
      // Dropping the correlation makes every meeting report the table-wide total.
      const byTitle = Object.fromEntries(
        (await report(owner)).meetings.map((m) => [m.title, m.actionItems]),
      );
      expect(byTitle['Alice handover']).toBe(1);
      expect(byTitle['Bob meeting']).toBe(4);
      expect(byTitle['Url only']).toBe(0);
    });

    it('counts participants per meeting', async () => {
      const byTitle = Object.fromEntries(
        (await report(owner)).meetings.map((m) => [m.title, m.participants]),
      );
      expect(byTitle['Alice handover']).toBe(2);
      expect(byTitle['No participants']).toBe(0);
    });

    it('treats a transcript_url as a transcript, as the rest of the app does', async () => {
      const url = (await report(alice, { search: 'Url only' })).meetings[0];
      expect(url.hasTranscript).toBe(true);
      // ...and jsonb 'null' is not a summary.
      expect(url.hasSummary).toBe(false);
      expect(await found(alice, { withTranscript: 'true' })).toContain('Url only');
    });

    it('orders most recent first', async () => {
      const titles = (await report(owner)).meetings.map((m) => m.title);
      expect(titles[0]).toBe('No participants'); // 30 July, the latest
      expect(titles[titles.length - 1]).toBe('Mixed case'); // 5 July, earliest
    });

    it('applies the LIMIT', async () => {
      expect((await report(owner, { limit: '2' })).meetings).toHaveLength(2);
    });

    it('reports the total BEFORE the limit, so the truncation caveat is true', async () => {
      const r = await report(owner, { limit: '2' });
      expect(r.meetings).toHaveLength(2);
      expect(r.matched.value).toBe(6);
      expect(r.caveats.join(' ')).toContain('2 most recent of 6');
    });

    it('does not claim the store is empty when a filter simply matched nothing', async () => {
      const r = await report(owner, { search: 'nothing matches this' });
      expect(r.matched.value).toBe(0);
      expect(r.matched.storeEmpty).toBe(false);
    });

    it('dates a late-evening meeting by its South African day', async () => {
      // Held 22:40 UTC on the 28th = 00:40 SAST on the 29th.
      const late = (await report(alice, { search: 'Late evening' })).meetings[0];
      expect(late.date).toBe('2026-07-29');
      expect(await found(alice, { since: '2026-07-29', until: '2026-07-29' }))
        .toContain('Late evening');
    });

    it('fails CLOSED for an identity with no email', async () => {
      // '' is not "match nothing": 1,625 live meetings carry a participant whose email is
      // the empty string, so binding '' would match a third of the table.
      const noEmail: ActionItemAccess = { isOwner: false, email: '', userId: '' };
      expect(await found(noEmail)).toEqual([]);
    });

  describe('manco meeting content fetch', () => {
    // Both manco routes that read meeting content — meeting-context (returns verbatim
    // transcript excerpts and the summary) and extract-meeting-comments (copies excerpts
    // into a comment thread anyone can read) — took the meeting id straight from the
    // request and applied no attendance check at all.
    async function fetchAs(access: ActionItemAccess, meetingId: number) {
      const { text, params } = meetingForCaller(meetingId, access);
      const { rows } = await pool.query(text, params);
      return rows;
    }

    it('returns the meeting to someone who was in it', async () => {
      const rows = await fetchAs(alice, 1);
      expect(rows).toHaveLength(1);
      expect(rows[0].raw_transcript).toBe('said things');
    });

    it('returns NOTHING to someone who was not', async () => {
      expect(await fetchAs(bob, 1)).toHaveLength(0);
      expect(await fetchAs(alice, 2)).toHaveLength(0);
    });

    it('refuses an arbitrary meeting id — the id came from the request body', async () => {
      // extract-meeting-comments accepted any meeting_id, so this is the exact escalation:
      // a caller naming a meeting they have no connection to.
      expect(await fetchAs(bob, 3)).toHaveLength(0);
      expect(await fetchAs(bob, 4)).toHaveLength(0);
      expect(await fetchAs(bob, 5)).toHaveLength(0);
    });

    it('fails closed on a meeting with no participant list', async () => {
      expect(await fetchAs(alice, 3)).toHaveLength(0);
      expect(await fetchAs(owner, 3)).toHaveLength(1);
    });

    it('fails closed for an identity with no email', async () => {
      const noEmail: ActionItemAccess = { isOwner: false, email: '', userId: '' };
      for (const id of [1, 2, 3, 4, 5, 6]) {
        expect(await fetchAs(noEmail, id)).toHaveLength(0);
      }
    });

    it('gives the owner any meeting', async () => {
      expect(await fetchAs(owner, 2)).toHaveLength(1);
    });

    it('carries the transcript and summary columns the routes rely on', async () => {
      // If the column list drifted, the routes would silently render empty context rather
      // than fail — the gate would look fine while the feature quietly broke.
      const [row] = await fetchAs(alice, 1);
      expect(Object.keys(row).sort()).toEqual(
        ['id', 'meeting_date', 'raw_transcript', 'summary', 'title'],
      );
    });
  });
  });
});
