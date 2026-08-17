/**
 * Who a meeting's participant list identifies — written BEFORE the implementation.
 *
 * pages/api/meetings.ts grants access when the caller's email OR their display name
 * appears in the participant list. Measured against live data, the name arm is
 * load-bearing rather than stray: 13 active users depend on it, and three of them —
 * including a super_admin and an admin — reach ZERO meetings by email alone, because the
 * participant records carry a display name with a different or absent address.
 *
 * So it stays. What must not stay are its two failure modes:
 *
 *   1. FAIL-OPEN on an empty name. `user.name` falls back to '', and 1,649 meetings carry
 *      a participant whose name is the empty string, so any user created without a first
 *      or last name would inherit all of them. No such user exists today, which is what
 *      makes it latent rather than live.
 *
 *   2. COLLISION. A display name is not an identity. Two active accounts share
 *      "hein van vuuren" — a super_admin and a technician-role phone login — and the
 *      technician one reaches 443 meetings on the strength of the string alone.
 *
 * The rule these tests pin: match on email always; match on name only when that name
 * identifies exactly ONE active user.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

import { resolveParticipantIdentity } from '@/lib/meetings/participantScope';

describe('meeting participant scope (real Postgres)', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL_TEST,
      options: '-c search_path=part_scope,public',
    });

    await pool.query(`
      DROP SCHEMA IF EXISTS part_scope CASCADE;
      CREATE SCHEMA part_scope;
      CREATE TABLE part_scope.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT, first_name TEXT, last_name TEXT, is_active BOOLEAN DEFAULT true
      );
      CREATE TABLE part_scope.meetings (id INT PRIMARY KEY, title TEXT, participants JSONB);

      INSERT INTO part_scope.users (email, first_name, last_name) VALUES
        ('unique@example.com', 'Unique',  'Person'),   -- name identifies one user
        ('twin.a@example.com', 'Twin',    'Name'),     -- these two share a name
        ('twin.b@example.com', 'Twin',    'Name');

      INSERT INTO part_scope.meetings (id, title, participants) VALUES
        -- reachable by email
        (1, 'By email',        '[{"email":"unique@example.com","name":"Someone Else"}]'::jsonb),
        -- reachable by name only: the participant has a different address
        (2, 'By name only',    '[{"email":"personal@gmail.com","name":"Unique Person"}]'::jsonb),
        -- the collision: only a shared name links either twin
        (3, 'Twin meeting',    '[{"email":"someone@external.com","name":"Twin Name"}]'::jsonb),
        -- the fail-open: an empty participant name
        (4, 'Empty name',      '[{"email":"x@example.com","name":""}]'::jsonb),
        (5, 'Empty display',   '[{"email":"y@example.com","displayName":""}]'::jsonb),
        -- reachable by displayName
        (6, 'By displayName',  '[{"email":"z@example.com","displayName":"Unique Person"}]'::jsonb);
    `);
  });

  afterAll(async () => {
    await pool.query('DROP SCHEMA IF EXISTS part_scope CASCADE;');
    await pool.end();
  });

  /**
   * The route's OWN participant match, run against the resolved identity — the same shape
   * as pages/api/meetings.ts, so this tests what that route will actually do.
   */
  async function visibleTo(email: string, name: string): Promise<string[]> {
    const id = await resolveParticipantIdentity(pool, { email, name });
    const { rows } = await pool.query(
      `SELECT m.title FROM meetings m
        WHERE EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(m.participants, '[]'::jsonb)) AS p
          WHERE LOWER(p->>'email') = $1
             OR LOWER(p->>'name') = $2
             OR LOWER(p->>'displayName') = $2
        )
        ORDER BY m.id`,
      [id.email, id.nameForMatch],
    );
    return rows.map((r) => r.title as string);
  }

  it('matches on email', async () => {
    expect(await visibleTo('unique@example.com', 'Unique Person')).toContain('By email');
  });

  it('still matches on a name that identifies exactly one user', async () => {
    // 13 live users depend on this arm; three reach nothing at all without it.
    const seen = await visibleTo('unique@example.com', 'Unique Person');
    expect(seen).toContain('By name only');
    expect(seen).toContain('By displayName');
  });

  it('does NOT match on a name shared by more than one active user', async () => {
    // The live case: a technician-role phone login reaching 443 meetings because it
    // shares a display name with a super_admin.
    expect(await visibleTo('twin.a@example.com', 'Twin Name')).not.toContain('Twin meeting');
    expect(await visibleTo('twin.b@example.com', 'Twin Name')).not.toContain('Twin meeting');
  });

  it('does NOT match an empty participant name, even for a caller with no name', async () => {
    // The fail-open: 1,649 live meetings carry an empty-name participant.
    const seen = await visibleTo('nameless@example.com', '');
    expect(seen).not.toContain('Empty name');
    expect(seen).not.toContain('Empty display');
    expect(seen).toEqual([]);
  });

  it('does not let a caller with no name reach anything by name', async () => {
    expect(await visibleTo('nobody@example.com', '   ')).toEqual([]);
  });

  it('is case-insensitive on both sides', async () => {
    expect(await visibleTo('UNIQUE@Example.com', 'UNIQUE PERSON')).toContain('By email');
    expect(await visibleTo('UNIQUE@Example.com', 'UNIQUE PERSON')).toContain('By name only');
  });

  it('an injection attempt matches nothing', async () => {
    expect(await visibleTo("' OR 1=1 --", "' OR 1=1 --")).toEqual([]);
  });

  describe('the resolved identity itself', () => {
    it('offers a unique name for matching', async () => {
      const id = await resolveParticipantIdentity(pool, { email: 'unique@example.com', name: 'Unique Person' });
      expect(id.nameForMatch).toBe('unique person');
    });

    it('withholds a shared name', async () => {
      const id = await resolveParticipantIdentity(pool, { email: 'twin.a@example.com', name: 'Twin Name' });
      expect(id.nameForMatch).toBeNull();
    });

    it('withholds an empty name without querying for it', async () => {
      expect((await resolveParticipantIdentity(pool, { email: 'x@y.com', name: '   ' })).nameForMatch).toBeNull();
      expect((await resolveParticipantIdentity(pool, { email: 'x@y.com', name: null })).nameForMatch).toBeNull();
    });

    it('withholds a name that belongs to nobody', async () => {
      // A name held by no active user cannot identify the caller either.
      const id = await resolveParticipantIdentity(pool, { email: 'x@y.com', name: 'Ghost Person' });
      expect(id.nameForMatch).toBeNull();
    });

    it('lower-cases the email it returns', async () => {
      const id = await resolveParticipantIdentity(pool, { email: 'MiXeD@Example.COM', name: '' });
      expect(id.email).toBe('mixed@example.com');
    });
  });
});
